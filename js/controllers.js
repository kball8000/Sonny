// wu = Weather Underground
// gae = Google App Engine
// 2016 

var cont = angular.module('weatherCtrl', ['weatherServices', 'ngMaterial', 'ngSanitize'])
.config(function($mdGestureProvider) {
  $mdGestureProvider.skipClickHijack();
})
.controller('mainCtrl', function($scope, $interval, $location, $timeout, $http, $q, wData, wDB, wLog, wUtils, weather, autocomp) {
  $scope.$location    = $location;    // For Navbar links
  $scope.main         = wData;
  $scope.citySearch   = autocomp.citySearch;
  $scope.setHomeFlag  = autocomp.setHomeFlag;

  $interval(weather.refreshForecasts, 10*1000);

  /* Get the weather data. */
  function cancelMonthTimeouts() {
    /**
     * DEPRECATED IN 1.28g
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
      autocomp.savedCities = r.value;
    } else{
      autocomp.initializeCities();
    }
  }
  function setImgUrl() {
    try  {
      r.value.radar.imgUrl = URL.createObjectURL(r.value.radar.img);
    } catch (e) {
      console.log('no radar image to create a URL.');
      // angular.noop();
    }
  }
  function clearSpinners() {
    /**
     * In case current/hourly... were stored in db with spinner set to true, reset them here.
     * This can cause grief because spinner is only activated / turned off when it has been a long
     * time between weather update checks to server. If db accidentally stores spinner info, app
     * spins forever on next load.
     */
    let arr = ['current', 'hourly', 'tenday'];
    for (let el of arr) {
      wData.info[el].spinner    = false;
      wData.info[el].spinnerId  = 0;
    }
    console.log('current: ', wData.info.current);
  }
  function changeCity(city, initialLoad) {
    let _id = 'weather-' + city.zip;

    // cancelMonthTimeouts();   // Do not think I'm setting timeoutouts anymore.

    wData.info.zip = city.zip;

    wDB._get(_id).then(r => {       // load local data.
      if(r && r.value) {
        setImgUrl();
        wData.info = r.value;
        clearSpinners();
      } else {
        wData.info = new wData.createWeatherObj(city);
      }

      wData.updateExpiredMsg();
      
      if (initialLoad) {
        wDB.setLoaded();  // server request will be fired off by each page's controller.
      } else {
        weather.refreshForecasts();
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
          lu, lc;
      
      console.log('\n');
      for(let view of views) {
        lc = new Date(wUtils.objProp(wData.info, view + '.lastChecked'));
        lu = new Date(wUtils.objProp(wData.info, view + '.lastUpdated'));
        console.log(view, 'lastChecked (h:m:s): ', lc.getHours(), ':', lc.getMinutes(), ':', lc.getSeconds());
        console.log(view, 'lastUpdated (h:m:s): ', lu.getHours(), ':', lu.getMinutes(), ':', lu.getSeconds());
      }
      console.log('\n');
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
  $scope.addErrors = () => {   // TESTING
    wData.info.current.expiredMsg = 'currentExpired';
    wData.info.hourly.expiredMsg = 'hourlyExpired';
    wData.info.tenday.expiredMsg = 'tendayExpired';
    wData.info.current.errorMsg = 'currentError';
    wData.info.hourly.errorMsg = 'hourlyError';
    wData.info.tenday.errorMsg = 'tendayError';
  }
  $scope.clearErrors = () => {   // TESTING
    wData.info.current.expiredMsg = '';
    wData.info.hourly.expiredMsg = '';
    wData.info.tenday.expiredMsg = '';
    wData.info.current.errorMsg = '';
    wData.info.hourly.errorMsg = '';
    wData.info.tenday.errorMsg = '';
  }
  $scope.editMonths = () => {   // TESTING
    let url = window.location.origin + '/modifycal';
    console.log('url: ', url);
    $http.post(url).then(r => {
      console.log('editmonths response: ', r);
    })
  }
  $scope.hi = () => {   // TESTING
    let url = window.location.origin + '/hi';
    console.log('running url: ', url);
    $http.get(url).then(r => {
      console.log('hi response: ', r);
    })
  }
  $scope.getMonthObj = () => {   // TESTING
    let url = window.location.origin + '/getmonthobj';
    console.log('running url: ', url);
    $http.post(url).then(r => {
      console.log(url + ' response: ', r);
    })
  }
  function testGeoLocation() {      // NEW FUNCTIONALITY TESTING
    navigator.geolocation.getCurrentPosition(function(position) {
      autocomp.getCityFromGeo(position.coords.latitude, position.coords.longitude);
    })
  }
  testGeoLocation();
  
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

    console.log('Running cityChg');
    
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
    // $timeout.cancel(wData.info.month.timeout); // Do not think I'm setting timeouts anymore.
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

    wData.concatDayText(wData.info.month);
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
    console.log('radar tab clicked');
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