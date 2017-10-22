var CACHE_NAME = 'sonny-v1.24i';

var urlsToCache = [
    '/favicon.ico'   
];

this.addEventListener('install', function(event){
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
this.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(cacheNames){
      return Promise.all(
        cacheNames.map(function(cacheName){
          if (cacheName !== CACHE_NAME){
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Returns file from cache for a fetch/GET request, not POST, as POST is not supported
// Helpful document: https://developers.google.com/web/fundamentals/primers/service-workers/
this.addEventListener('fetch', function(event) {  
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