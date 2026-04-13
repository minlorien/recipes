const CACHE = 'recipes-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/src/styles/main.css',
  '/src/main.js',
  '/src/config.js',
  '/src/lib/state.js',
  '/src/lib/sheets.js',
  '/src/lib/ai.js',
  '/src/lib/units.js',
  '/src/lib/ui.js',
  '/src/pages/recipes.js',
  '/src/pages/detail.js',
  '/src/pages/scan.js',
  '/src/pages/shopping.js',
  '/src/pages/chat.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Network-first for API calls, cache-first for app shell
  const url = new URL(e.request.url);
  const isAPI = url.hostname.includes('googleapis') || url.hostname.includes('anthropic');

  if (isAPI) {
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
