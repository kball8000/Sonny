// wu = Weather Underground
// gae = Google App Engine
// 2016 

var cont = angular.module('weatherCtrl', ['weatherServices', 'ngMaterial'])
.config(function($mdGestureProvider) {
  $mdGestureProvider.skipClickHijack();
})
.controller('mainCtrl', function($scope, $interval, $location, $timeout, $http, $q, wData, wDB, wLog, weather, autocomp) {
  $scope.$location    = $location;    // For Navbar links
  $scope.main         = wData;
  $scope.citySearch   = autocomp.citySearch;
  $scope.setHomeFlag  = autocomp.setHomeFlag;

  wData.t0 = performance.now();

  $interval(weather.refreshForecasts, 10000);

  /* Get the weather data. */
  function cancelMonthTimeouts() {
    /**
     * Just in case there are pending month timeouts. Maybe overkill, I guess they could just fizzle
     * out on their own.
     */
    try {
      $timeout.cancel(wData.info.month.timeout);
    } catch (e){
      angular.noop();
    }    
  }
  function loadCityList(r) {
    if (r && r.value) {
      autocomp.savedCities  = r.value;
    } else{
      autocomp.initializeCities();
    }
  }
  function changeCity(city, initialLoad) {
    let _id = 'weather-' + city.zip;

    cancelMonthTimeouts();

    wData.info.zip = city.zip;
    weather.refreshForecasts();     // fire off server request.

    wDB._get(_id).then(r => {       // load local data.      
      wData.info = r ? r.value : new wData.createWeatherObj(city);
      wData.updateFreshnessMsg();
      if (initialLoad) {
        wDB.setLoaded();
      };
    })
  }
  // Load the app data.
  wDB.openDB().then(() => {
    wDB._get('savedCities').then( cities => {
      loadCityList(cities);
      let homeCity = autocomp.savedCities[0];
      changeCity(homeCity, true);
    })
  })
  $scope.logData = () => {    // TESTING
    function logTimeStamps(){
      let views = ['current', 'hourly', 'tenday', 'radar'],
          w     = wData.info, lu, lc, hr, min, s;
      for(let view of views) {
        console.log(view, 'lastUpdated: ',  w[view].lastUpdated);
        lc = new Date(w[view].lastChecked);
        console.log(view, 'lastChecked (h:m:s): ', lc.getHours(), ':', lc.getMinutes(), ':', lc.getSeconds() , '\n\n');
      }
    }
    logTimeStamps();
    console.log('data: ', wData);
    console.log('autocomp: ', autocomp);
    wDB._getAll().then(r => console.log('wDB: ', r))
    wLog.getLogs().then(r => console.log('logs: ', r))
  }
  $scope.downloadWeather = () => {   // TESTING
    console.log('downloading weather');
    let storageObj = wData.info;
    let dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(storageObj));
    let dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href",     dataStr     );
    dlAnchorElem.setAttribute("download", wData.info.zip + "-weather.json");
    dlAnchorElem.click();      
  }
  
  /* textChg and itemChg belong to the autocomplete (ng) input box. */
  $scope.textChg = function(query) {
    /* If 5 digit number is input, assume zip code and automatically send off request for weather data. */
    
    if( query.length === 5 && !isNaN(query) && query != wData.info.zip ) {
      let newZip = query,
          url = 'https://autocomplete.wunderground.com/aq?cb=JSON_CALLBACK&query=' + newZip;
      
      changeCity({zip: newZip, text: ''});
      
      $http.jsonp(url).then( r => {
        let c           = r.data.RESULTS[0],
            returnedZip = c.name.substr(0,5);
        
        if (wData.info.zip === returnedZip) {
          let city = c.name.substr(8);
          wData.info.location = city;
          autocomp.addCity({zip: query, text: city});
        }
      })

      document.getElementById('acInputId').blur();
      $scope.searchText = '';
    }
  }
  $scope.cityChg = function(city) {
    /* When editing text from 5 char to 4, itemChg fires again, but is undefined since it 
       is not in the list, be sure not to send server request for 4 char zip code. Maybe 
       server can check for 5 char zip. 
    */
    if(city && city.zip !== wData.info.zip){
      changeCity(city);
      
      autocomp.addCity(city);
      $scope.searchText = '';
      document.getElementById('acInputId').blur();
    }
  }
})
.controller('currentCtrl', function($scope, wData, wDB, weather) {
  wDB.waitFor('loaded').then(r => {
    $scope.o = wData;
    weather.refreshForecasts();
  })
})
.controller('hourlyCtrl', function($scope, wDB, wData, weather) {
  wDB.waitFor('loaded').then(r => {
    $scope.o = wData;
    weather.refreshForecasts();
  })
})
.controller('monthCtrl', function($scope, $http, $q, $timeout, wDB, wData, weather) {
  function newMonthFromDB(zip, yr, mon) {
    /* if it exists, retrieves from indexedDB or creates a new month object to display */
    var _id       = wData.createMonthId(zip, yr, mon), 
        deferred  =  $q.defer();
    
    wData.info.month.id = _id;
    $timeout.cancel(wData.info.month.timeout);
    wDB._get(_id).then(r => {
      wData.info.month = r ? r.value : wData.createMonthObj(zip, yr, mon);
      deferred.resolve();
    })
    return deferred.promise;
  }
  function resetRequestBtn() {
    $scope.requestDisabled = false;
    $scope.requestText = 'Add to Server Queue';    
  }
  
  wDB.waitFor('loaded').then(r => {
    $scope.o      = wData;                // For html page
    $scope.months = wData.months;

    var yr        = new Date().getFullYear();
    $scope.years  = [yr];
    while(yr > 1970){
      $scope.years.push(--yr);
    }

    resetRequestBtn();    
    weather.refreshForecasts();
  })
    
  $scope.newMonth = function(){
    /* Month and year are modifiable by user using input pull downs */
    var m       = wData.info.month,
        zip     = wData.info.zip;

    m.month = wData.months.indexOf(m.monthText);
    resetRequestBtn();
  
    newMonthFromDB(zip, m.year, m.month).then(r => { 
      weather.refreshForecasts(); 
    })
  }
  $scope.nextMonth = function(next) {
    var m       = wData.info.month,
        zip     = wData.info.zip;
    
    resetRequestBtn();

    if(next) {
      if(m.month !== 11) {
        m.month++;
      } else {
        m.month = 0;
        m.year++;
      }
    } else {
      if(m.month !== 0) {
        m.month--;
      } else {
        m.month = 11;
        m.year--;
      }
    }
    m.monthText = wData.months[m.month];
    newMonthFromDB(zip, m.year, m.month).then(r => { 
      weather.refreshForecasts(); 
    })
  }
  $scope.requestQueue = function() {
    $scope.requestDisabled = true;
    $scope.requestText = 'Request Sent';
    var url = window.location.origin + '/addtoqueue',
        data = {
          zip:      wData.info.zip,
          year:     wData.info.month.year,
          month:    wData.info.month.month + 1,
          complete: false,
          view:     'month'
        };
    $http.post(url, data);
  }
})
.controller('tendayCtrl', function($scope, wDB, wData, weather) {
  wDB.waitFor('loaded').then(r => {
    $scope.o = wData;
    // Each day has text details of the weather, by default I hide them.
    $scope.details = false;
    weather.refreshForecasts();
  })
})
.controller('radarCtrl', function($scope, wDB, wData, weather) {
  wDB.waitFor('loaded').then(r => {
    $scope.o  = wData;
    weather.refreshForecasts();
  })
  $scope.zoom = function(_in){
    // _in: true = zoom in, false = zoom out.
    wData.setZoom(_in);
    wData.updateRadarId();
    weather.refreshForecasts();
  }
});