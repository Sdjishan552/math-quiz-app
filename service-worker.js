const CACHE_NAME = 'mathquiz-v3.7';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
  // ❌ removed questions.json (dynamic loading handled separately)
];

// INSTALL
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ACTIVATE
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// FETCH (advanced)
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => {

      // 1. Return cache if available
      if (cached) return cached;

      // 2. Otherwise fetch from network
      return fetch(event.request)
        .then(response => {

          // 3. Cache new request (runtime caching)
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, response.clone());
            return response;
          });

        })
        .catch(() => {
          // 4. Offline fallback (important)
          return caches.match('./index.html');
        });

    })
  );
});
