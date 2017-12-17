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
    // console.log('current: ', wData.info.current);
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
  $scope.getMonthId = () => {   // TESTING
    console.log('id: ', wData.monthUser.idd());
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

    // console.log('Running cityChg');
    
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
.controller('monthCtrl', function($scope, $http, $q, $timeout, wDB, wData, wDates, weather) {
  function newMonthFromDB(zip, yr, mon) {
    // DEPRECATED 1.30, USE FUNCTION IN WEATHER SERVICE.
    /* if it exists, retrieves from indexedDB or creates a new month object to display */
    let _id       = wData.createMonthId(zip, yr, mon),
        deferred  =  $q.defer();
    
    // wData.info.month.id = _id;
    // $timeout.cancel(wData.info.month.timeout); // Do not think I'm setting timeouts anymore.
    wDB._get(_id).then(r => {
      wData.info.month = r && r.value ? r.value : wData.createMonthObj(zip, yr, mon);
      deferred.resolve();
    })
    return deferred.promise;
  }
  function resetRequestBtn() {
    $scope.requestDisabled = false;
    $scope.requestText = 'Add to Server Queue';    
  }
  function setMonthFetch(future) {
    /**
     * Month fetch is independant of the month displayed to user. Set values here
     * for http request later. future is boolean, once month is complete begin
     * prefetching either previous or next month.
     * May be DEPRECATED at 1.30.
     */
    wData.info.monthFetch.year    = wData.info.month.year;
    wData.info.monthFetch.month   = wData.info.month.month;
    wData.info.monthFetch.zip     = wData.info.zip;
    wData.info.monthFetch.future  = future;
  }
  function getYearsArr() {
    let year  = new Date().getFullYear(),
        years = [year];

    while(year > 1970){
      years.push(--year);
    }

    return years;
  }
  function updateMonthVal(next){
    let m = wData.info.month;

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
  }
  
  wDB.waitFor('loaded').then(r => {
    $scope.o      = wData;                // For html page
    $scope.months = wData.months;
    $scope.years  = getYearsArr();

    resetRequestBtn();
    // setMonthFetch(false);
    weather.refreshForecasts();
  })
    
  $scope.newMonth = function(){
    /* Month and year are modifiable by user using input pull downs */
    // let m         = wData.info.monthUser,
    let m         = wData.monthUser,
        // zip       = wData.info.zip,
        curMonth  = wData.info.month.month,
        curYear   = wData.info.month.year,
        newMonth  = wData.months.indexOf(m.monthText),  // From dropdown input in UI.
        newYear   = m.year;                             // From dropdown input in UI.

    // let cur = {
    //   month:  wData.info.month.month,
    //   year:   wData.info.month.year
    // }, 
    // user = {
    //   month:  wData.months.indexOf(m.monthText),
    //   year:   m.year
    // };
        
    m.month   = newMonth;
    // m.id      = wData.createMonthId(zip, newYear, newMonth);
    // m.future  = newMonth > curMonth;  // Used by prefetching.
    // future property is used by prefetching.
    m.prefetch  = wDates.isMoreRecent([newYear, newMonth], [curYear, curMonth]);
    // m.future  = wDates.isMoreRecent([user.year, user.month], [cur.year, cur.month]);  
    resetRequestBtn();

    // setMonthFetch(newMonth > curMonth);
  
    weather.newMonthFromDB().then(r => { 
      weather.refreshForecasts(); 
    })
    // newMonthFromDB(zip, newYear, newMonth).then(r => { 
    //   weather.refreshForecasts(); 
    // })
  }
  $scope.nextMonth = function(next) {
    // var m       = wData.info.monthUser,
    //     zip     = wData.info.zip;
    
    resetRequestBtn();
    wData.incrementMonth(next);
    wData.monthUser.prefetch = next;
    // m.monthText = wData.months.indexOf(m.month)
    // setMonthFetch(next);
    weather.newMonthFromDB().then(r => { 
      weather.refreshForecasts(); 
    })
    // newMonthFromDB(zip, m.year, m.month).then(r => { 
    //   weather.refreshForecasts(); 
    // })
  }
  $scope.requestQueue = function() {
    $scope.requestDisabled = true;
    $scope.requestText = 'Request Sent';
    let url = window.location.origin + '/addtoqueue',
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