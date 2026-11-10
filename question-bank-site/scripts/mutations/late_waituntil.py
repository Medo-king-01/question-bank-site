"""Regress sw.js to the shape that registers the asset refresh too late.

Kept as a file rather than inlined in the workflow: the arrow functions inside
the replacement break the YAML parser.

The bad shape, for reference:

    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res && res.ok && cacheable(req, res)) {
          event.waitUntil(cache.put(req, res.clone()).catch(() => {}));
        }
        return res;
      }).catch(() => null);
      return cached || (await network) || new Response('', { status: 504 });
    })());

With a cache hit the response settles immediately, the event ends, and the
waitUntil() above runs too late. The test suite must fail on this.
"""
from pathlib import Path

BUGGY = """  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok && cacheable(req, res)) {
        event.waitUntil(cache.put(req, res.clone()).catch(() => {}));
      }
      return res;
    }).catch(() => null);
    return cached || (await network) || new Response('', { status: 504 });
  })());"""

path = Path("src/pwa/sw.js")
src = path.read_text(encoding="utf-8")

start = src.index("  const network = fetch(req);")
end = src.index("  })());", src.index("event.respondWith((async () => {", start)) + len("  })());")

path.write_text(src[:start] + BUGGY + src[end:], encoding="utf-8")
print("sw.js regressed to the late-waitUntil shape")
