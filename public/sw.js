// Service worker for recipes.minlorien.net
//
// - No precache list: the old one listed /src/... paths that don't exist in dist/,
//   so install failed and phones stayed on a stale worker forever.
// - Pages (HTML/navigation): network-first, cached copy only when offline.
// - Hashed build assets (/assets/*): cache-first, they never change.
// - /api/* and other origins: never touched.
//
// Bump CACHE to force old caches to be deleted on activate.
// v3: v2 could cache an HTML fallback page under an /assets/ URL (white screen).
const CACHE = 'recipes-v3';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(cacheFirst(req));
  } else {
    e.respondWith(networkFirst(req));
  }
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  // Never keep an HTML page under an asset URL (a missing file can come back as HTML).
  const type = res.headers.get('content-type') || '';
  if (res.ok && !type.includes('text/html')) {
    const cache = await caches.open(CACHE);
    cache.put(req, res.clone());
  }
  return res;
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    // Offline and this exact URL was never cached: fall back to the app shell.
    if (req.mode === 'navigate') {
      const shell = await caches.match('/');
      if (shell) return shell;
    }
    throw err;
  }
}
