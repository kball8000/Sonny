// wu = Weather Underground
// gae = Google App Engine
// 2016 

var cont = angular.module('weatherCtrl', ['weatherServices', 'ngMaterial'])
.config(function($mdGestureProvider) {
  $mdGestureProvider.skipClickHijack();
})
.controller('mainCtrl', function($scope, $location, $timeout, $http, $q, wData, wDB, wLog, weather, autocomp) {
  $scope.$location    = $location;    // For Navbar links
  $scope.main         = wData;
  $scope.citySearch   = autocomp.citySearch;
  $scope.setHomeFlag  = autocomp.setHomeFlag;

  /* Get the weather data. */
  function newWeatherObj(city) {
    /* if it exists, retrieves from indexedDB or creates a new weather object to display */
    var _id =       'weather-' + city.zip, 
        deferred =  $q.defer();
    
    try {
      $timeout.cancel(wData.info.month.timeout);
    } finally {
      wDB._get(_id).then(r => {
        wData.info = r ? r.value : new wData.createWeatherObj(city);
        deferred.resolve();
      })
      return deferred.promise;
    }
  }
  wDB.openDB().then(r => {
    wDB._get('savedCities').then( r => {
      if (r) {
        autocomp.savedCities  = r.value;
      } else{
        var initCities = [
          {zip: '61601', text: 'Peoria, Illinois'},
          {zip: '45201', text: 'Cincinnati, Ohio'},
          {zip: '37501', text: 'Memphis, Tennessee'}
        ];
        autocomp.savedCities  = initCities;
        wDB._put('savedCities', initCities);
      }
      newWeatherObj(autocomp.savedCities[0]).then(r => { 
        wDB.setLoaded(); 
      })
    })
  })
/**
  $scope.logData = () => {    // TESTING
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
 */
  /* textChg and itemChg belong to the autocomplete (ng) input box. */
  $scope.textChg = function(query) {
    /* If 5 digit number is input, assume zip code and automatically send off request for weather data. */
    
    if( query.length === 5 && !isNaN(query) && query != wData.info.zip ) {
      let newZip = query,
          url = 'https://autocomplete.wunderground.com/aq?cb=JSON_CALLBACK&query=' + newZip;
      
      newWeatherObj({zip: newZip, text: ''}).then(r => {
        weather.refreshForecasts();
      })
      
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
      newWeatherObj(city).then(r => { 
        weather.refreshForecasts();
      })
      
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
  function getRadar(){
    wDB.waitFor('loaded').then(r => {
      $scope.o  = wData;
      weather.refreshForecasts();
    })
  }
  $scope.zoom = function(z){
    wData.zoom(z);
    getRadar();
  }
  getRadar(); 
});