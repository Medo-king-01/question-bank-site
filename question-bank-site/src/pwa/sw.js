/* Service worker — offline support for the question bank.
 *
 * Strategy
 *   navigation requests  -> network-first, fall back to the cached shell
 *   same-origin assets   -> stale-while-revalidate
 *   anything else        -> left alone (the app makes no third-party requests)
 *
 * Why network-first for navigations: the whole app is a single HTML file, so a
 * stale shell would pin the user to an old question bank for ever. Network
 * first means an online user always gets the newest build, while an offline
 * user still gets the last one they loaded.
 */
/* CACHE_VERSION is filled in at build time from a hash of the generated
 * index.html, so shipping new content rolls the cache over automatically and
 * there is nothing to bump by hand. */
const CACHE_VERSION = '__BUILD_ID__';
const CACHE_NAME = 'question-bank-' + CACHE_VERSION;

/* Everything the app needs to boot with no network. Paths are relative to the
 * service worker scope, so the site works both at a domain root and under a
 * GitHub Pages sub-path.
 *
 * REQUIRED: without these the app cannot boot offline, so a failure to cache
 * them must fail the whole install. Claiming offline support while the page
 * itself is missing is worse than not installing at all — the previously
 * installed worker stays in charge and keeps working.
 *
 * OPTIONAL: icons and artwork. A 404 here must never block the install. */
const REQUIRED = [
  './index.html',
];

const OPTIONAL = [
  './',
  './manifest.json',
  './src/pwa/icon-192.png',
  './src/pwa/icon-512.png',
  './src/pwa/icon-maskable-512.png',
  './src/pwa/apple-touch-icon.png',
  './src/figures/medo-developer.webp',
  './src/figures/medo-developer.png',   /* fallback for browsers without WebP */
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    /* Required assets: no catch. A throw here aborts the install, which is the
       honest outcome — no offline promise we cannot keep. */
    for (const url of REQUIRED) {
      await cache.add(new Request(url, { cache: 'reload' }));
    }

    /* Optional assets: best effort, one at a time so a single 404 cannot
       reject the batch. */
    await Promise.all(OPTIONAL.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (e) {
        /* a missing optional asset must not break the install */
      }
    }));
    // Activate this worker as soon as it is ready; the page prompts the user.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n.startsWith('question-bank-') && n !== CACHE_NAME)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

/* GitHub Pages answers a missing file with its custom 404 page served as
 * `200 text/html`. Caching that under, say, `icon-192.png` would show a broken
 * image for ever — even after the file is fixed — because the cache outlives
 * the deploy. Only cache a response when its type matches what was asked for. */
function cacheable(req, res) {
  const dest = req.destination || '';
  const type = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
  if (!type) return true;                       // no info: keep the old behaviour
  if (dest === 'image') return type.startsWith('image/');
  if (dest === 'script') return /javascript|ecmascript/.test(type);
  if (dest === 'style') return type.startsWith('text/css');
  if (dest === 'font') return /font|woff/.test(type);
  /* Documents and anything else may legitimately be HTML. */
  return true;
}

/* Is this navigation response good enough to become the saved shell?
 * It must be a success AND actually be an HTML document. */
function shellWorthCaching(res, req) {
  if (!res || !res.ok) return false;                 // 404, 500, opaque errors
  if (res.type === 'opaqueredirect' || res.redirected) return false;
  const type = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
  if (!type) return true;                            // no header: trust res.ok
  /* The shell is the single-page app, so it must be HTML. A JSON or image body
     served at a navigation URL means we did not get the app. */
  return type.includes('text/html') || type.includes('application/xhtml');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // never touch third parties

  // --- navigations: network first, cache as the fallback -------------------
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        /* Only a successful HTML response may replace the saved shell.
         *
         * Without this check a single bad URL could destroy the offline copy:
         * open /typo -> server answers 404 -> that error page is stored as
         * ./index.html -> the next offline visit shows the error instead of
         * the app. So: a 4xx/5xx is returned to the browser but never cached,
         * and a non-HTML body (an asset, a redirect stub) is not cached either.
         */
        if (shellWorthCaching(fresh, req)) {
          const cache = await caches.open(CACHE_NAME);
          cache.put('./index.html', fresh.clone());
        }
        return fresh;
      } catch (e) {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match('./index.html'))
            || (await cache.match('./'))
            || new Response('<h1>غير متصل</h1><p>افتح الموقع مرة واحدة وأنت متصل ليعمل دون اتصال.</p>',
                            { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 });
      }
    })());
    return;
  }

  // --- same-origin assets: stale-while-revalidate --------------------------
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok && cacheable(req, res)) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await network) || new Response('', { status: 504 });
  })());
});

/* The page can ask which version is live, so it can offer an update prompt. */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'VERSION') {
    event.source?.postMessage({ type: 'VERSION', version: CACHE_VERSION });
  }
});
