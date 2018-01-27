// wu = Weather Underground
// gae = Google App Engine
// 2016 

var cont = angular.module('weatherCtrl', ['weatherServices', 'ngMaterial', 'ngSanitize'])
.config(function($mdGestureProvider, $sceDelegateProvider) {
  $mdGestureProvider.skipClickHijack();
  // $sceDelegateProvider.resourceUrlWhitelist([
  //   // Allow same origin resource loads.
  //   'self',
  //   // Allow loading from our assets domain.  Notice the difference between * and **.
  //   'https://autocomplete.wunderground.com/**'
  // ]);

})
.controller('mainCtrl', function($scope, $interval, $location, $http, $sce, wData, wDB, wLog, weather, autocomp) {
  $scope.$location    = $location;    // For Navbar links
  $scope.main         = wData;
  $scope.citySearch   = autocomp.citySearch;
  $scope.setHomeFlag  = autocomp.setHomeFlag;

  $interval(weather.refreshForecasts, 10*1000);    // comment is for testing
  // $interval(weather.refreshForecasts, 20*1000);       // TESTING


  function goJson(data) {
    console.log('running goJson!', data);
  }
  let goJson2 = function(data) {
    console.log('running goJson2!:', data);
  }
  let goJson3 = function(data) {
    console.log('running goJson3!:', data);
  }
  $scope.goJson4 = function(data) {
    console.log('running goJson4!:', data);
  }
  TOMMY = function(d) {
  // let TOMMY = function(d) {
    console.log('TOMMY:', d);
  }
  $scope.testWU = function(query) {
    let url = 'https://autocomplete.wunderground.com/aq';
    let trustedUrl = $sce.trustAsResourceUrl(url);

    $http.defaults.jsonpCallbackParam = 'cb';

    let params = {
      c: 'US',
      format: 'JSON',
      query: 'gre'
    };
    
    console.log('url:', url);
    console.log('trustedUrl:', trustedUrl);
    $http.jsonp(trustedUrl, {params: params}).then ( r => {
        console.log('r:', r.data.RESULTS[0]);
    }, e => {
      console.log('ERROR:', e);
    })
  }

  /* Get the weather data. */
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
      // console.log('no radar image to create a URL.');
      angular.noop();
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
  }
  function changeCity(city, initialLoad) {
    let _id = 'weather-' + city.zip;

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
        lc = new Date(wData.info[view].lastChecked);
        lu = new Date(wData.info[view].lastUpdated);
        console.log(view, 'lastChecked (h:m:s): ', lc.getHours(), ':', lc.getMinutes(), ':', lc.getSeconds());
        console.log(view, 'lastUpdated (h:m:s): ', lu.getHours(), ':', lu.getMinutes(), ':', lu.getSeconds());
      }
      console.log('\n');
    }
    logTimeStamps();
    console.log('data: ', wData);
    console.log('autocomp: ', autocomp);
    wDB._getAll().then(r => console.log('wDB: ', r))
    wLog.getLogs().then(r => {
      console.log('logs: ', r)},
      e => {
        console.log('Msg:', e.value);
      }
    )
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
  $scope.getMonthObj = () => {   // TESTING
    let url = window.location.origin + '/getmonthobj';
    $http.post(url).then(r => {
      console.log('Got month from server:', r);
    })
  }
  $scope.getDates = () => {   // TESTING
    let url = window.location.origin + '/getdates';
    $http.post(url).then(r => {
      console.log('Dates:', r);
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
    
    console.log('running test change will check location:');

    if( query.length === 5 && !isNaN(query) && query != wData.info.zip ) {
      let newZip = query,
          url = 'https://autocomplete.wunderground.com/aq?cb=JSON_CALLBACK&query=' + newZip;
      
      changeCity({zip: newZip, text: ''});
      
      $http.jsonp(url).then( r => {
        let c           = r.data.RESULTS[0],
            newZip      = c.name.substr(0,5),
            newCityText = c.name.substr(8);
        
        if (wData.info.zip === newZip) {
          wData.info.location = newCityText;
        }
        autocomp.addCity({zip: newZip, text: newCityText});
      })

      document.getElementById('acInputId').blur();
      $scope.searchText = '';
    }
  }
  $scope.cityChg = function(city) {
    /**
     * Runs when user selects city from pull down list.
    */

    if(city && city.zip !== wData.info.zip){
      changeCity(city);
      autocomp.addCity(city);
    }
    $scope.searchText = '';
    document.getElementById('acInputId').blur();
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
.controller('monthCtrl', function($scope, $http, $q, wData, wDates, wDB, weather) {
  function resetRequestBtn() {
    $scope.requestDisabled  = false;
    $scope.requestText      = 'Add to Server Queue';    
  }
  function getYearsArr() {
    let year  = new Date().getFullYear(),
        years = [year];

    while(year > 1970){
      years.push(--year);
    }

    return years;
  }  
  wDB.waitFor('loaded').then(r => {
    $scope.o      = wData;                // For html page
    $scope.months = wDates.months;
    $scope.years  = getYearsArr();

    resetRequestBtn();
    weather.refreshForecasts();
  })
  $scope.newMonth = function(){
    wData.monthUser.month = wDates.months.indexOf(wData.monthUser.monthText);
    resetRequestBtn();
    weather.refreshForecasts();
  }
  $scope.nextMonth = function(next) {
    resetRequestBtn();
    wDates.incrementMonth(wData.monthUser, next);
    weather.refreshForecasts();
  }
  $scope.requestQueue = function() {
    $scope.requestDisabled = true;
    $scope.requestText = 'Request Sent';
    let data = {
          zip:      wData.info.zip,
          year:     wData.monthUser.year,
          month:    wData.monthUser.month,
          view:     'month'
        };
    weather.httpReqObj(data, '/addtoqueue');
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