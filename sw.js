let CACHE_NAME = 'sonny-v1.25';

/**
 * Caching essential assets seems critical, otherwise requires user to have browsed
 * to all of these places for caching. Also, during development, they are not updated
 * on the 'service worker updated on page reload if not listed here.'
 */
let urlsToCache = [
    '/',
    '/current',
    '/hourly',
    '/tenday',
    '/radar',
    '/month',
    '/css/sonny.css',
    '/favicon.ico',
    '/js/controllers.js',
    '/js/services.js',
    '/partials/current.html',
    '/partials/hourly.html',
    '/partials/tenday.html',
    '/partials/month.html',
    '/partials/radar.html'
  ];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE_NAME)
        .then(function(cache){
            return cache.addAll(urlsToCache);
        })
        .then(function(){
          return self.skipWaiting(); 
        })
    );
});

// Clean up old caches, runs anytime sw.js file is modified.
self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(cacheNames){
      return Promise.all(
        cacheNames.map(function(cacheName){
          console.log('onActivate, cacheName:', cacheName);
          if (cacheName !== CACHE_NAME){
            console.log('will delete cacheName: ', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Returns file from cache for a fetch/GET request, not POST, as POST is not supported
// Helpful document: https://developers.google.com/web/fundamentals/primers/service-workers/
self.addEventListener('fetch', function(event) {  
  event.respondWith(
    caches.match(event.request).then(function(resp) {
      return resp || fetch(event.request).then(function(response) {
        return caches.open(CACHE_NAME).then(function(cache) {
          if (event.request.method === 'GET') {    // only difference from help doc above.
            cache.put(event.request, response.clone());
          }            
          return response;
        });  
      });
    })
  );
});