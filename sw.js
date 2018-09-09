let CACHE_NAME = 'sonny-v1.30m';

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
    '/css/lib/angular-material.min.css',
    '/css/lib/bootstrap.min.css',
    '/favicon.ico',
    '/js/controllers.js',
    '/js/main.js',
    '/js/services.js',
    '/js/lib/angular.min.js',
    '/js/lib/angular-animate.min.js',
    '/js/lib/angular-aria.min.js',
    '/js/lib/angular-material.min.js',
    '/js/lib/angular-route.min.js',
    '/partials/current.html',
    '/partials/hourly.html',
    '/partials/tenday.html',
    '/partials/month.html',
    '/partials/radar.html',
    'images/icons/fog.gif',
    'images/icons/hazy.gif',
    'images/icons/clear.gif',
    'images/icons/sunny.gif',
    'images/icons/mostlysunny.gif',
    'images/icons/partlycloudy.gif',
    'images/icons/partlysunny.gif',
    'images/icons/mostlycloudy.gif',
    'images/icons/cloudy.gif',
    'images/icons/chancerain.gif',
    'images/icons/rain.gif',
    'images/icons/chancetstorms.gif',
    'images/icons/tstorms.gif',
    'images/icons/chanceflurries.gif',
    'images/icons/flurries.gif',
    'images/icons/chancesleet.gif',
    'images/icons/sleet.gif',
    'images/icons/chancesnow.gif',
    'images/icons/snow.gif',
    'images/icons/nt_fog.gif',
    'images/icons/nt_hazy.gif',
    'images/icons/nt_clear.gif',
    'images/icons/nt_sunny.gif',
    'images/icons/nt_mostlysunny.gif',
    'images/icons/nt_partlycloudy.gif',
    'images/icons/nt_partlysunny.gif',
    'images/icons/nt_mostlycloudy.gif',
    'images/icons/nt_cloudy.gif',
    'images/icons/nt_chancerain.gif',
    'images/icons/nt_rain.gif',
    'images/icons/nt_chancetstorms.gif',
    'images/icons/nt_tstorms.gif',
    'images/icons/nt_chanceflurries.gif',
    'images/icons/nt_flurries.gif',
    'images/icons/nt_chancesleet.gif',
    'images/icons/nt_sleet.gif',
    'images/icons/nt_chancesnow.gif',
    'images/icons/nt_snow.gif'
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
// self.addEventListener('fetch', function(event) {
//   event.respondWith(
//     caches.match(event.request).then(function(resp) {
//       return resp || fetch(event.request).then(function(response) {
//         return caches.open(CACHE_NAME).then(function(cache) {
//           if (event.request.method === 'GET') {    // only difference from help doc above.
//             cache.put(event.request, response.clone());
//           }            
//           return response;
//         });  
//       });
//     })
//   );
// });
