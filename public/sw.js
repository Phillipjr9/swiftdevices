const CACHE_VERSION = 'swiftdevices-v4-' + '20260323';
const CACHE_NAME = CACHE_VERSION;
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/support.html',
  '/contact.html',
  '/returns.html',
  '/warranty.html',
  '/privacy.html',
  '/terms.html',
  '/giftcards.html',
  '/tradein.html',
  '/payment-success.html',
  '/404.html',
  '/logo.png',
  '/manifest.json'
];

// Install: cache static assets
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; })
            .map(function(key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

// Fetch: network first, fallback to cache
self.addEventListener('fetch', function(event) {
  // Skip non-GET requests and cross-origin requests for Firebase/CDN
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  // Let Firebase and external CDN requests go through network only
  if (url.origin !== location.origin) return;

  event.respondWith(
    fetch(event.request).then(function(response) {
      // Cache successful responses
      if (response.ok) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, clone);
        });
      }
      return response;
    }).catch(function() {
      return caches.match(event.request);
    })
  );
});
