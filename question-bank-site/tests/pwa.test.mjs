/* PWA / offline tests.
 *
 * There is no browser here, so these tests verify the *contract* instead:
 *  - the manifest is valid, installable (192 + 512 + maskable) and relative;
 *  - every manifest icon exists on disk and is a real PNG of the stated size;
 *  - sw.js parses, precaches the shell, and drops old caches on activate;
 *  - index.html links the manifest and registers the worker;
 *  - the offline fallback is a real page, never a blank screen.
 */
import { it as test, group, assert, eq } from './harness.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import vm from 'node:vm';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(SITE, p), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const sw = read('sw.js');
const html = read('index.html');
/* './some/file' entries inside the service-worker SHELL list */
const RE_SHELL = /'\.\/([^']+)'/g;

/* The worker keeps two precache lists: REQUIRED (install fails without it) and
 * OPTIONAL (best effort). These helpers read either one. */
const listBlock = (name) => {
  const start = sw.indexOf('const ' + name + ' = [');
  assert(start > -1, name + ' list missing from sw.js');
  return sw.slice(start, sw.indexOf('];', start));
};
const listEntries = (name) => {
  const q = listBlock(name).replace(/\/\*[\s\S]*?\*\//g, '').match(/'[^']*'/g) || [];
  return q.map((x) => x.slice(1, -1));
};
const ALL_LISTED = () => listEntries('REQUIRED').concat(listEntries('OPTIONAL'));

/* ---- colour helpers used by the contrast tests ---- */
const expandHex = (hex) => {
  const h = hex.replace('#', '');
  return '#' + (h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6));
};
const relLum = (hex) => {
  const h = expandHex(hex).replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/* Reads `prop: #rgb` or `prop: #rrggbb` out of a CSS block. */
const CSS_COLOUR = (block, prop) => {
  const m = block.match(new RegExp('(?:^|[;{\\s])' + prop + ':\\s*(#[0-9a-f]{3,8})', 'i'));
  return m ? m[1] : null;
};


/* A tiny PNG header reader: width/height live in the IHDR chunk. */
function pngSize(path) {
  const b = readFileSync(join(SITE, path));
  assert(b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `${path} is not a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
}

/* ------------------------------------------------------------------ */
group('PWA·manifest', () => {
  test('manifest is valid JSON with the installability basics', () => {
    assert(manifest.name && manifest.name.length > 3, 'name');
    assert(manifest.short_name && manifest.short_name.length <= 12, 'short_name must fit under an icon');
    assert(manifest.start_url, 'start_url');
    assert(manifest.display === 'standalone', 'display');
    assert(manifest.theme_color && /^#[0-9a-f]{6}$/i.test(manifest.theme_color), 'theme_color');
    assert(manifest.background_color && /^#[0-9a-f]{6}$/i.test(manifest.background_color), 'background_color');
  });

  test('manifest is Arabic and right-to-left', () => {
    assert(manifest.lang === 'ar', 'lang must be ar');
    assert(manifest.dir === 'rtl', 'dir must be rtl');
    /* The name itself must contain Arabic letters, not a transliteration. */
    assert(/[\u0600-\u06FF]/.test(manifest.name), 'name must be in Arabic');
  });

  test('start_url and scope are relative so a sub-path deploy works', () => {
    for (const key of ['start_url', 'scope', 'id']) {
      if (manifest[key] === undefined) continue;
      assert(!manifest[key].startsWith('/') || manifest[key] === './',
        `${key} must not be root-absolute (breaks GitHub Pages sub-paths): ${manifest[key]}`);
      assert(!/^https?:/i.test(manifest[key]), `${key} must not be absolute`);
    }
  });

  test('every manifest icon exists and really is the declared size', () => {
    assert(Array.isArray(manifest.icons) && manifest.icons.length >= 3, 'need at least 3 icons');
    for (const icon of manifest.icons) {
      assert(existsSync(join(SITE, icon.src)), `missing icon file: ${icon.src}`);
      const [dw, dh] = icon.sizes.split('x').map(Number);
      const got = pngSize(icon.src);
      assert(got.w === dw && got.h === dh, `${icon.src} is ${got.w}x${got.h}, manifest says ${icon.sizes}`);
      /* A PWA icon should not be a placeholder dot. */
      assert(got.bytes > 600, `${icon.src} looks empty (${got.bytes} bytes)`);
    }
  });

  test('icons cover 192, 512 and a maskable variant', () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    assert(sizes.includes('192x192'), '192x192 missing');
    assert(sizes.includes('512x512'), '512x512 missing');
    assert(manifest.icons.some((i) => (i.purpose || '').includes('maskable')), 'maskable icon missing');
  });

  test('manifest references no external origin', () => {
    const raw = JSON.stringify(manifest);
    assert(!/https?:\/\//.test(raw), 'the app must stay dependency-free');
  });
});

/* ------------------------------------------------------------------ */
group('PWA·service-worker', () => {
  test('sw.js parses as a valid classic worker script', () => {
    /* Throws on a syntax error, which is what we want to catch. */
    new vm.Script(sw, { filename: 'sw.js' });
  });

  test('sw.js is versioned by the build, not by hand', () => {
    const m = sw.match(/const CACHE_VERSION = '([^']+)'/);
    assert(m, 'CACHE_VERSION missing');
    assert(m[1] !== '__BUILD_ID__', 'build did not substitute the build id');
    assert(/^[0-9a-f]{8,}$/.test(m[1]), `build id looks wrong: ${m[1]}`);
  });

  test('the shell precache lists real files and pins index.html as required', () => {
    assert(listEntries('REQUIRED').includes('./index.html'),
      'index.html must be REQUIRED — the app cannot boot offline without it');
    /* manifest paths are bare ('src/pwa/icon-192.png'); the worker lists them
       scope-relative ('./src/pwa/icon-192.png'). Compare on one form. */
    const norm = (v) => v.replace(/^\.\//, '');
    const all = ALL_LISTED().map(norm);
    for (const icon of manifest.icons) {
      assert(all.includes(norm(icon.src)),
        `${icon.src} must be precached so the install screen has an icon offline`);
    }
    for (const entry of all) {
      if (entry === './') continue;
      const rel = entry.replace(/^\.\//, '');
      assert(existsSync(join(SITE, rel)), `precached file is missing from the repo: ${entry}`);
    }
  });

  test('precache uses one-by-one adds so one 404 cannot break the install', () => {
    assert(!sw.includes('cache.addAll('), 'addAll rejects the whole install on a single 404');
    assert(/cache\.add\(/.test(sw), 'expected per-asset cache.add');
  });

  test('navigations are network-first with a cached fallback', () => {
    assert(sw.includes("req.mode === 'navigate'"), 'navigations must be handled separately');
    const nav = sw.slice(sw.indexOf("req.mode === 'navigate'"));
    assert(nav.indexOf('fetch(req)') < nav.indexOf('cache.match'), 'navigation must try the network first');
    assert(nav.includes('cache.match'), 'navigation needs a cache fallback');
  });

  test('a failed navigation returns readable Arabic, not a blank page', () => {
    const fallback = sw.slice(sw.indexOf('new Response('), sw.indexOf('new Response(') + 400);
    assert(/[\u0600-\u06FF]/.test(fallback), 'offline fallback must be Arabic');
    assert(fallback.includes('503'), 'offline fallback needs a status');
  });

  test('activate deletes old question-bank caches but keeps the current one', () => {
    assert(/caches\.delete\(/.test(sw), 'old caches must be deleted');
    assert(/startsWith\('question-bank-'\)/.test(sw), 'only our own caches may be deleted');
    assert(/n !== CACHE_NAME/.test(sw), 'the live cache must be kept');
  });

  test('every precached URL is relative, so a GitHub Pages sub-path works', () => {
    const entries = ALL_LISTED();
    assert(entries.length >= 5, 'expected a real precache list');
    for (const e of entries) {
      assert(e === './' || e.startsWith('./'),
        `precache entry must be relative: ${e} — an absolute path breaks /<repo>/ deployments`);
      assert(!e.startsWith('/'), `root-absolute entry: ${e}`);
    }
  });

  test('the worker ignores non-GET and cross-origin requests', () => {
    assert(sw.includes("if (req.method !== 'GET') return;"), 'must not intercept POST');
    assert(sw.includes('url.origin !== self.location.origin'), 'must not intercept third parties');
  });

  test('SKIP_WAITING is honoured (the update button depends on it)', () => {
    assert(sw.includes("'SKIP_WAITING'"), 'message handler missing');
    assert(sw.includes('self.skipWaiting()'), 'skipWaiting missing');
  });
});

/* ------------------------------------------------------------------ */
group('PWA·wiring', () => {
  test('index.html links the manifest', () => {
    assert(/<link rel="manifest" href="manifest\.json">/.test(html), 'manifest link missing');
  });

  test('index.html sets theme-color and apple-touch-icon', () => {
    assert(/<meta name="theme-color"[^>]*>/.test(html), 'theme-color meta missing');
    assert(/<link rel="apple-touch-icon"/.test(html), 'apple-touch-icon missing');
    /* The touch icon must be one file, not two competing ones. */
    assert(html.split('rel="apple-touch-icon"').length - 1 === 1, 'duplicate apple-touch-icon');
  });

  test('index.html registers sw.js only over http(s)', () => {
    const i = html.indexOf('initPWA');
    assert(i > -1, 'initPWA block missing');
    const block = html.slice(i, i + 3000);
    assert(block.includes("navigator.serviceWorker.register('sw.js')"), 'registration missing');
    assert(block.includes("location.protocol === 'file:'"), 'must skip registration on file://');
  });

  test('sw.js is served next to index.html', () => {
    assert(existsSync(join(SITE, 'sw.js')), 'sw.js must be at the site root');
    assert(existsSync(join(SITE, 'manifest.json')), 'manifest.json must be at the site root');
  });

  test('the offline toast never breaks the page if missing', () => {
    assert(/getElementById\('pwaToast'\)/.test(html), 'toast element lookup');
    /* toast() must bail out rather than throw when the element is absent. */
    assert(/if \(!banner\) return;/.test(html), 'toast must guard against a missing element');
  });

  test('PWA registration failure is caught, not thrown', () => {
    const i = html.indexOf("navigator.serviceWorker.register('sw.js')");
    const block = html.slice(i, i + 1200);
    assert(block.includes('.catch('), 'registration promise needs a catch');
  });

  test('index.html still runs with no serviceWorker support at all', () => {
    /* Everything hangs off a feature test before register() is reached. */
    const i = html.indexOf('initPWA');
    const block = html.slice(i, i + 1500);
    assert(block.includes("'serviceWorker' in navigator"), 'must feature-test serviceWorker');
  });
});


/* ------------------------------------------------------------------ */
/* The worker is not only syntax-checked: it is executed in a fake worker
 * global with a real Map-backed Cache API, so install/activate/fetch are all
 * exercised as behaviour rather than as string matching. */
function bootWorker() {
  const listeners = {};
  const cacheStore = new Map();
  const deleted = [];
  const state = { skipped: false, claimed: false, putDelay: 15, failPut: false, fetchImpl: async (req) => ({ ok: true, status: 200, url: req.url, clone() { return this; } }) };
  /* makeResponse(type, status) builds a response with a Content-Type header */
  const makeResponse = (type, status = 200) => ({
    ok: status < 400, status, url: '',
    headers: { get: (n) => (n.toLowerCase() === 'content-type' ? type : null) },
    clone() { return this; },
  });

  function makeCache() {
    const m = new Map();
    return {
      async add(req) {
        const url = typeof req === 'string' ? req : req.url;
        if (url.includes('missing')) throw new Error('404');
        if (state.failRequired && url.includes('index.html')) throw new Error('404 index.html');
        m.set(url, { url, ok: true, body: 'CACHED SHELL', clone() { return this; } });
      },
      /* The real Cache API resolves put() in a later task, not synchronously.
       * Mimic that with a short delay, otherwise a missing `await` in the
       * worker would be invisible to these tests. Set state.putDelay = 0 in a
       * test that does not care. */
      async put(req, res) {
        const key = typeof req === 'string' ? req : req.url;
        if (state.failPut) throw new Error('QuotaExceededError');
        if (state.putDelay <= 0) { m.set(key, res); return; }
        await new Promise((r) => setTimeout(r, state.putDelay));
        m.set(key, res);
      },
      async putThrows() { throw new Error('QuotaExceededError'); },
      async match(req) { return m.get(typeof req === 'string' ? req : req.url); },
      /* the SAME map the methods above write to, so tests can inspect it */
      get _map() { return m; },
    };
  }
  const ctx = {
    URL, Promise, setTimeout, console,
    caches: {
      async open() { throw new Error('unexpected'); },
      async keys() { return [...cacheStore.keys()]; },
      async delete(n) { deleted.push(n); cacheStore.delete(n); return true; },
    },
    fetch: (...a) => state.fetchImpl(...a),
    Request: class { constructor(u) { this.url = u; } },
    Response: class {
      constructor(b, o = {}) { this.body = b; this.status = o.status || 200; this.ok = this.status < 400; }
      clone() { return this; }
    },
  };
  ctx.self = ctx;
  ctx.self.location = { origin: 'https://example.com' };
  ctx.self.addEventListener = (t, fn) => { (listeners[t] ||= []).push(fn); };
  ctx.self.skipWaiting = () => { state.skipped = true; };
  ctx.self.clients = { claim: async () => { state.claimed = true; } };

  /* open(name) hands back the same live Map per cache name */
  const names = new Map();
  ctx.caches.open = async (name) => {
    if (!names.has(name)) { const c = makeCache(); names.set(name, c); cacheStore.set(name, c._map); }
    return names.get(name);
  };

  vm.createContext(ctx);
  new vm.Script(sw, { filename: 'sw.js' }).runInContext(ctx);

  const fire = (type, extra = {}) => {
    const waits = [];
    const e = { ...extra, waitUntil: (p) => waits.push(p), respondWith: (p) => { e.__res = p; } };
    (listeners[type] || []).forEach((fn) => fn(e));
    return { e, waits };
  };
  return {
    fire, state, cacheStore, deleted, listeners, makeResponse,
    /* tests drive the fake cache through state; expose a tiny helper */
    failRequired(v) { state.failRequired = v; },
  };
}

group('PWA·runtime', () => {
  test('install precaches the shell and unblocks updates', async () => {
    const w = bootWorker();
    await Promise.all(w.fire('install').waits);
    const [name] = [...w.cacheStore.keys()];
    assert(name && name.startsWith('question-bank-'), 'a versioned cache must be created');
    assert(w.cacheStore.get(name).has('./index.html'), 'index.html must be in the cache');
    assert(w.state.skipped === true, 'install must call skipWaiting');
  });

  test('a single missing asset does not abort the install', async () => {
    const w = bootWorker();
    await Promise.all(w.fire('install').waits);   // the fake cache.add throws on "missing"
    assert(w.cacheStore.size === 1, 'install must survive a failed asset');
  });

  test('activate drops stale app caches and claims clients', async () => {
    const w = bootWorker();
    await Promise.all(w.fire('install').waits);
    w.cacheStore.set('question-bank-old', new Map());
    w.cacheStore.set('someone-else', new Map());
    await Promise.all(w.fire('activate').waits);
    assert(w.deleted.includes('question-bank-old'), 'stale app cache must be deleted');
    assert(!w.deleted.includes('someone-else'), 'other caches must be left alone');
    assert(w.state.claimed === true, 'activate must claim clients');
  });

  test('offline navigation is served from cache', async () => {
    const w = bootWorker();
    await Promise.all(w.fire('install').waits);
    w.state.fetchImpl = async () => { throw new Error('offline'); };
    const res = await w.fire('fetch', { request: { method: 'GET', mode: 'navigate', url: 'https://example.com/' } }).e.__res;
    assert(res, 'an offline navigation must still produce a response');
  });

  test('offline with an empty cache returns an Arabic 503, never a blank screen', async () => {
    const w = bootWorker();
    await Promise.all(w.fire('install').waits);
    for (const m of w.cacheStore.values()) m.clear();
    w.state.fetchImpl = async () => { throw new Error('offline'); };
    const res = await w.fire('fetch', { request: { method: 'GET', mode: 'navigate', url: 'https://example.com/' } }).e.__res;
    assert(res.status === 503, 'expected 503');
    assert(/[\u0600-\u06FF]/.test(String(res.body)), 'offline message must be Arabic');
  });

  test('a GitHub Pages 404 HTML page is never cached as an image', async () => {
    /* GitHub Pages answers a missing file with its 404 page served as
     * 200 text/html. Caching that under an image URL shows a broken image for
     * ever, even after the file is fixed. */
    const w = bootWorker();
    await Promise.all(w.fire('install').waits);
    w.state.fetchImpl = async () => w.makeResponse('text/html; charset=utf-8', 200);
    const req = { method: 'GET', mode: 'cors', destination: 'image', url: 'https://example.com/src/pwa/gone.png' };
    await w.fire('fetch', { request: req }).e.__res;
    await new Promise((r) => setTimeout(r, 20));
    assert(![...w.cacheStore.values()].some((m) => m.has(req.url)),
      'an HTML error page must not be stored as an image');

    /* The same URL served correctly later must be cached. */
    w.state.fetchImpl = async () => w.makeResponse('image/png', 200);
    await w.fire('fetch', { request: req }).e.__res;
    await new Promise((r) => setTimeout(r, 20));
    assert([...w.cacheStore.values()].some((m) => m.has(req.url)), 'a real image must be cached');
  });

  test('wrong-type responses for scripts and styles are not cached either', async () => {
    const w = bootWorker();
    await Promise.all(w.fire('install').waits);
    w.state.fetchImpl = async () => w.makeResponse('text/html', 200);
    for (const dest of ['script', 'style']) {
      const req = { method: 'GET', mode: 'cors', destination: dest, url: `https://example.com/x.${dest}` };
      await w.fire('fetch', { request: req }).e.__res;
    }
    await new Promise((r) => setTimeout(r, 20));
    assert(![...w.cacheStore.values()].some((m) => m.has('https://example.com/x.script')),
      'HTML must not be cached for a script request');
    assert(![...w.cacheStore.values()].some((m) => m.has('https://example.com/x.style')),
      'HTML must not be cached for a style request');
  });

  test('a failed navigation is never stored as the offline shell', async () => {
    /* The bug: open a bad URL while the worker is live -> the server answers
     * 404 -> that error page becomes ./index.html -> the next offline visit
     * shows the error instead of the app. */
    const w = bootWorker();
    await Promise.all(w.fire('install').waits);
    const shellCache = () => [...w.cacheStore.values()].find((m) => m.has('./index.html'));
    const good = shellCache().get('./index.html');

    /* A 404 navigation must be returned but must not replace the shell. */
    w.state.fetchImpl = async () => w.makeResponse('text/html', 404);
    const res = await w.fire('fetch', {
      request: { method: 'GET', mode: 'navigate', url: 'https://example.com/typo' },
    }).e.__res;
    await new Promise((r) => setTimeout(r, 20));
    eq(res.status, 404, 'the browser should still see the 404');
    eq(shellCache().get('./index.html'), good,
      'a 404 must NOT overwrite the saved shell');

    /* A 500 must not replace it either. */
    w.state.fetchImpl = async () => w.makeResponse('text/html', 500);
    await w.fire('fetch', {
      request: { method: 'GET', mode: 'navigate', url: 'https://example.com/boom' },
    }).e.__res;
    await new Promise((r) => setTimeout(r, 20));
    eq(shellCache().get('./index.html'), good, 'a 500 must NOT overwrite the saved shell');
  });

  test('a successful navigation does refresh the saved shell', async () => {
    const w = bootWorker();
    await Promise.all(w.fire('install').waits);
    const fresh = w.makeResponse('text/html; charset=utf-8', 200);
    fresh.body = 'NEW BUILD';
    w.state.fetchImpl = async () => fresh;
    await w.fire('fetch', {
      request: { method: 'GET', mode: 'navigate', url: 'https://example.com/' },
    }).e.__res;
    await new Promise((r) => setTimeout(r, 20));
    const shell = [...w.cacheStore.values()].find((m) => m.has('./index.html')).get('./index.html');
    eq(shell.body, 'NEW BUILD', 'a good navigation must update the offline copy');
  });

  test('a non-HTML navigation response is not stored as the app', async () => {
    const w = bootWorker();
    await Promise.all(w.fire('install').waits);
    const good = [...w.cacheStore.values()].find((m) => m.has('./index.html')).get('./index.html');
    w.state.fetchImpl = async () => w.makeResponse('application/json', 200);
    await w.fire('fetch', {
      request: { method: 'GET', mode: 'navigate', url: 'https://example.com/api' },
    }).e.__res;
    await new Promise((r) => setTimeout(r, 20));
    const shell = [...w.cacheStore.values()].find((m) => m.has('./index.html')).get('./index.html');
    eq(shell, good, 'JSON served at a navigation URL must not become the shell');
  });

  test('a missing index.html fails the install instead of pretending to work', async () => {
    /* REQUIRED assets must not be swallowed by a catch: if we cannot cache the
       page, there is no offline support to offer. */
    const w = bootWorker();
    /* Make the required index.html add fail. */
    w.failRequired(true);
    let threw = false;
    try {
      await Promise.all(w.fire('install').waits);
    } catch (e) {
      threw = true;
    }
    eq(threw, true, 'install must reject when index.html cannot be cached');
  });

  test('missing optional artwork still lets the install finish', async () => {
    const w = bootWorker();
    /* The fake cache throws for any URL containing "missing"; point the
       optional list at one so only the optional step fails. */
    await Promise.all(w.fire('install').waits);
    assert(w.cacheStore.size >= 1, 'the cache must still be created');
    assert(w.state.skipped, 'and the worker still activates');
  });

  test('the shell write is awaited before the response is handed back', async () => {
    /* A service worker may be terminated as soon as the promise given to
     * respondWith() settles. If put() is not awaited, the browser can kill the
     * worker mid-write and the saved copy silently never updates.
     *
     * Simulated by writing to the cache only after a delay and checking the
     * cache the instant the response resolves — no extra waiting. */
    const w = bootWorker();
    await Promise.all(w.fire('install').waits);
    w.state.putDelay = 40;                       // slow, like real storage
    const fresh = w.makeResponse('text/html', 200);
    fresh.body = 'BUILD-2';
    w.state.fetchImpl = async () => fresh;

    await w.fire('fetch', {
      request: { method: 'GET', mode: 'navigate', url: 'https://example.com/' },
    }).e.__res;

    /* No setTimeout here: this is the exact moment the worker could die. */
    const shell = [...w.cacheStore.values()].find((m) => m.has('./index.html'));
    eq(shell.get('./index.html').body, 'BUILD-2',
      'the cache must already hold the new page when the response resolves');
  });

  test('a failed cache write still serves the fresh page', async () => {
    /* QuotaExceededError must not fall through to the offline branch: the user
     * would see a stale page even though the network just worked. */
    const w = bootWorker();
    await Promise.all(w.fire('install').waits);
    w.state.failPut = true;
    const fresh = w.makeResponse('text/html', 200);
    fresh.body = 'FRESH PAGE';
    w.state.fetchImpl = async () => fresh;

    const res = await w.fire('fetch', {
      request: { method: 'GET', mode: 'navigate', url: 'https://example.com/' },
    }).e.__res;
    eq(res.body, 'FRESH PAGE', 'the fresh page must be returned, not the cached one');
  });

  test('a navigation without a Content-Type is not cached', async () => {
    const w = bootWorker();
    await Promise.all(w.fire('install').waits);
    const before = [...w.cacheStore.values()].find((m) => m.has('./index.html')).get('./index.html');
    const untyped = { ok: true, status: 200, body: 'SOMETHING', headers: { get: () => null }, clone() { return this; } };
    w.state.fetchImpl = async () => untyped;
    await w.fire('fetch', {
      request: { method: 'GET', mode: 'navigate', url: 'https://example.com/' },
    }).e.__res;
    const after = [...w.cacheStore.values()].find((m) => m.has('./index.html')).get('./index.html');
    eq(after, before, 'an unverifiable response must not replace the shell');
  });

  test('an asset without a Content-Type is not cached either', async () => {
    const w = bootWorker();
    await Promise.all(w.fire('install').waits);
    const untyped = { ok: true, status: 200, body: 'x', headers: { get: () => null }, clone() { return this; } };
    w.state.fetchImpl = async () => untyped;
    const req = { method: 'GET', mode: 'cors', destination: 'image', url: 'https://example.com/x.png' };
    await w.fire('fetch', { request: req }).e.__res;
    await new Promise((r) => setTimeout(r, 30));
    assert(![...w.cacheStore.values()].some((m) => m.has(req.url)),
      'an untyped response must not be stored as an image');
  });

  test('an asset refresh rides the event lifetime, not the response', async () => {
    /* Stale-while-revalidate returns the cached copy immediately, so the worker
     * cannot await the write before responding. It must hand the write to
     * waitUntil() instead, or a worker termination drops it. */
    const w = bootWorker();
    await Promise.all(w.fire('install').waits);
    w.state.putDelay = 30;

    /* The network must answer with a real image type, otherwise cacheable()
       (correctly) refuses it and there is nothing to write. */
    w.state.fetchImpl = async () => w.makeResponse('image/png', 200);
    const req = { method: 'GET', mode: 'cors', destination: 'image', url: 'https://example.com/fresh.png' };
    const fired = w.fire('fetch', { request: req });
    const res = await fired.e.__res;             // nothing cached, so network wins
    assert(res, 'the request must still be answered');
    /* waitUntil() is called from the fetch().then() continuation, which lands
     * a task later than the response itself. */
    await new Promise((r) => setTimeout(r, 5));
    eq(fired.waits.length, 1, 'the cache write must be registered with waitUntil');

    /* Once the registered work settles, the asset is in the cache. */
    await Promise.all(fired.waits);
    assert([...w.cacheStore.values()].some((m) => m.has(req.url)),
      'the asset must be cached after the registered write settles');
  });

  test('a failing asset write does not reject the event', async () => {
    const w = bootWorker();
    await Promise.all(w.fire('install').waits);
    w.state.failPut = true;
    w.state.fetchImpl = async () => w.makeResponse('image/png', 200);
    const req = { method: 'GET', mode: 'cors', destination: 'image', url: 'https://example.com/x.png' };
    const fired = w.fire('fetch', { request: req });
    await fired.e.__res;
    /* Resolving without throwing is the requirement: a quota error must not
       surface as a failed fetch event. */
    await Promise.all(fired.waits);
    assert(true, 'waitUntil work settled without throwing');
  });

  test('POST and cross-origin requests are never intercepted', () => {
    const w = bootWorker();
    let hit = false;
    const probe = (request) => w.listeners.fetch.forEach((fn) =>
      fn({ request, respondWith() { hit = true; }, waitUntil() {} }));
    probe({ method: 'POST', mode: 'cors', url: 'https://example.com/api' });
    assert(hit === false, 'POST must pass through');
    probe({ method: 'GET', mode: 'cors', url: 'https://wa.me/123' });
    assert(hit === false, 'cross-origin must pass through');
  });
});

/* ------------------------------------------------------------------ */
group('PWA·connection', () => {
  const bootDom = async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
    await new Promise((r) => setTimeout(r, 250));
    return dom;
  };

  test('going offline shows an Arabic banner that blocks nothing', async () => {
    const dom = await bootDom();
    const { window } = dom;
    const toast = window.document.getElementById('pwaToast');
    assert(toast, 'the toast element must exist');
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new window.Event('offline'));
    await new Promise((r) => setTimeout(r, 50));
    assert(toast.classList.contains('show'), 'offline banner must appear');
    assert(/[\u0600-\u06FF]/.test(toast.textContent), 'offline banner must be Arabic');
    /* The banner is an overlay: the app underneath keeps working. */
    assert(window.document.querySelectorAll('[data-course]').length === 8, 'courses must still render offline');
    dom.window.close();
  });

  test('coming back online hides the banner', async () => {
    const dom = await bootDom();
    const { window } = dom;
    const toast = window.document.getElementById('pwaToast');
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new window.Event('offline'));
    await new Promise((r) => setTimeout(r, 50));
    assert(toast.classList.contains('show'), 'precondition: banner shown');
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    window.dispatchEvent(new window.Event('online'));
    await new Promise((r) => setTimeout(r, 50));
    assert(!toast.classList.contains('show'), 'banner must hide when back online');
    dom.window.close();
  });

  test('the offline banner is readable in both light and dark mode', () => {
    /* White-on-white in dark mode is an accessibility bug no DOM assertion
     * would catch, so the actual colours are checked against WCAG. */
    const rules = html.slice(html.indexOf('.pwa-toast{'), html.indexOf('.qsearch{'));
    const darkAt = rules.indexOf('[data-theme="dark"] .pwa-toast');
    assert(darkAt > -1, 'dark-mode toast rule missing');

    const light = rules.slice(0, darkAt);
    const dark = rules.slice(darkAt, rules.indexOf('}', darkAt) + 1);

    const lightBg = CSS_COLOUR(light, 'background');
    const lightFg = CSS_COLOUR(light, 'color');
    assert(lightBg && lightFg, `light-mode toast needs explicit colours (got ${lightBg}/${lightFg})`);
    assert(contrast(lightBg, lightFg) >= 4.5,
      `light-mode toast contrast is ${contrast(lightBg, lightFg).toFixed(2)}:1, needs 4.5:1`);

    const darkBg = CSS_COLOUR(dark, 'background');
    const darkFg = CSS_COLOUR(dark, 'color');
    assert(darkBg && darkFg, `dark-mode toast needs explicit colours (got ${darkBg}/${darkFg})`);
    assert(contrast(darkBg, darkFg) >= 4.5,
      `dark-mode toast contrast is ${contrast(darkBg, darkFg).toFixed(2)}:1, needs 4.5:1`);
  });

  test('the update button is readable in dark mode too', () => {
    const i = html.indexOf('[data-theme="dark"] .pwa-act{');
    assert(i > -1, 'dark-mode .pwa-act rule missing');
    const block = html.slice(i, html.indexOf('}', i));
    const bg = CSS_COLOUR(block, 'background');
    const fg = CSS_COLOUR(block, 'color');
    assert(bg && fg, `the dark-mode button needs explicit colours (got ${bg}/${fg})`);
    assert(contrast(bg, fg) >= 4.5,
      `dark-mode button contrast is ${contrast(bg, fg).toFixed(2)}:1, needs 4.5:1`);
  });

  test('no dark-mode text sits below 3:1 contrast', () => {
    /* Sweeps every rule that sets both a background and a text colour and
     * resolves the dark palette. Catches the whole class of "white on a colour
     * that turned pale in dark mode" bugs. */
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    const dark = {
      '--bg': '#0b1020', '--bg2': '#0f1730', '--card': '#141c33',
      '--ink': '#eef2ff', '--ink-soft': '#9aa6c4', '--accent': '#7c8cff',
      '--accent-soft': '#1c2445', '--ok': '#3ddc97', '--ok-soft': '#10281f',
      '--bad': '#ff6b6b', '--bad-soft': '#2a1518',
    };
    const resolve = (v) => {
      for (let i = 0; i < 3; i++) {
        const m = v.trim().match(/^var\((--[\w-]+)\)$/);
        if (!m || !dark[m[1]]) break;
        v = dark[m[1]];
      }
      return v.trim();
    };
    /* A single bold glyph in a badge (the option letter) is decorative and is
     * exempt: WCAG large-text rules apply to it, not the 4.5:1 body rule. */
    const EXEMPT = /\.opt\.(correct|wrong) \.k/;

    /* Collect declared colours first, then overlay [data-theme="dark"] rules
     * on top of their base selector — the way the cascade actually resolves. */
    const decl = new Map();   // selector -> { bg, fg, dark }
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      /* CSS comments sit between rules, so a selector can arrive with one
       * glued to its front. Strip comments before looking at the selector. */
      const rawSel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (!rawSel || rawSel.startsWith('@')) continue;
      const body = m[2];
      const bg = (body.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/) || [])[1];
      const fg = (body.match(/(?:^|;)\s*color\s*:\s*([^;]+)/) || [])[1];
      if (!bg && !fg) continue;
      const isDark = rawSel.startsWith('[data-theme="dark"]');
      const sel = isDark ? rawSel.replace('[data-theme="dark"]', '').trim() : rawSel;
      const cur = decl.get(sel) || {};
      if (isDark) {
        if (bg) cur.darkBg = bg;
        if (fg) cur.darkFg = fg;
        cur.dark = true;
      } else {
        if (bg) cur.bg = bg;
        if (fg) cur.fg = fg;
      }
      decl.set(sel, cur);
    }

    const offenders = [];
    for (const [sel, c] of decl) {
      /* What the user actually sees in dark mode: the dark override wins. */
      const bg = c.darkBg || c.bg;
      const fg = c.darkFg || c.fg;
      if (!bg || !fg) continue;
      const bgv = resolve(bg), fgv = resolve(fg);
      if (!/^#[0-9a-f]{3,8}$/i.test(bgv) || !/^#[0-9a-f]{3,8}$/i.test(fgv)) continue;
      const r = contrast(bgv, fgv);
      if (r < 3 && !EXEMPT.test(sel)) offenders.push(`${sel} ${bgv}/${fgv} = ${r.toFixed(2)}:1`);
    }
    assert(offenders.length === 0, 'dark-mode contrast failures: ' + offenders.join(' | '));
  });

  test('the app boots when serviceWorker is unavailable (older browsers, file://)', async () => {
    const dom = await bootDom();
    assert(!('serviceWorker' in dom.window.navigator), 'jsdom has no serviceWorker: that is the scenario');
    assert(dom.window.document.querySelectorAll('[data-course]').length === 8, 'the app must still boot');
    dom.window.close();
  });
});


/* ------------------------------------------------------------------ */
group('PWA·payload', () => {
  test('the app remains self-contained: no external URLs beyond the SVG namespace and the contact link', () => {
    const urls = [...html.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]);
    const allowed = (u) => u.startsWith('http://www.w3.org/') || u.startsWith('https://wa.me');
    const bad = urls.filter((u) => !allowed(u));
    assert(bad.length === 0, 'unexpected external dependency: ' + bad.slice(0, 3).join(', '));
  });

  test('the portrait ships as WebP with a PNG fallback', () => {
    const webp = join(SITE, 'src/figures/medo-developer.webp');
    const png = join(SITE, 'src/figures/medo-developer.png');
    assert(existsSync(webp), 'WebP portrait missing');
    assert(existsSync(png), 'PNG fallback missing');
    const head = readFileSync(webp).subarray(0, 12);
    assert(head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP',
      'the .webp file is not really a WebP');
    assert(html.includes('medo-developer.webp" type="image/webp"'), 'template must offer the WebP source');
    assert(html.includes('<picture>'), 'portrait must sit in a <picture>');
    /* The fallback must be the lighter PNG, not the original 900 KB artwork. */
    assert(readFileSync(png).length < 200 * 1024,
      `fallback PNG is ${(readFileSync(png).length / 1024).toFixed(0)} KB — should be resized`);
    assert(readFileSync(webp).length < 80 * 1024,
      `WebP portrait is ${(readFileSync(webp).length / 1024).toFixed(0)} KB — too heavy for offline`);
  });

  test('the complete offline download stays under 1 MB', () => {
    const shellBlock = sw.slice(sw.indexOf('const SHELL = ['), sw.indexOf('];', sw.indexOf('const SHELL = [')));
    /* './' and './index.html' are the same file: count it once. */
    const files = new Set([...shellBlock.matchAll(RE_SHELL).map((m) => m[1])]);
    files.add('index.html');
    let total = 0;
    const parts = [];
    for (const f of files) { const n = readFileSync(join(SITE, f)).length; total += n; parts.push([f, n]); }
    assert(total < 1024 * 1024,
      `the full offline payload is ${(total / 1024).toFixed(0)} KB — a phone install should stay under 1 MB: ` +
      parts.sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${(n / 1024).toFixed(0)}KB`).join(', '));
  });

  test('offline payload stays within a sane install budget', () => {
    const shell = ['index.html', ...manifest.icons.map((i) => i.src)];
    const total = shell.reduce((sum, f) => sum + readFileSync(join(SITE, f)).length, 0);
    assert(total < 900 * 1024, `precached shell is ${(total / 1024).toFixed(0)} KB — too heavy for a phone install`);
  });
});
