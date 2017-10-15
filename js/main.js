var app = angular.module('sonny', ['ngRoute', 'weatherCtrl']);

app.config(function($routeProvider, $locationProvider, $httpProvider) {

  $httpProvider.defaults.useXDomain = true;
  
  $routeProvider
  .when('/current', {
    templateUrl: 'partials/current.html'
  })
  .when('/hourly', {
    templateUrl: 'partials/hourly.html'
  })
  .when('/tenday', {
    templateUrl: 'partials/tenday.html'
  })
  .when('/radar', {
    templateUrl: 'partials/radar.html'
  })
  .when('/month', {
    templateUrl: 'partials/month.html'
  })
  .otherwise({
    redirectTo: '/current'
  });

  $locationProvider.html5Mode(true);

});