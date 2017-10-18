// Move more autocomplete to service
// add location request to webpage since no api required, also very async.

var app = angular.module('weatherServices', [])
.service('wDates', function($filter){
/* Dates are stored with UTC time. Beware javascript date function displaying a new date in local time. */
  this.getLimit     = function(view) {
    var obj = {
      current:            15*60*1000,   // cache
      hourly:             15*60*1000,   // cache
      tenday:           6*60*60*1000,   // cache
      radar:              20*60*1000,   // cache
      weather_DB:   11*24*60*60*1000,   // removal from indexedDB
      radar_DB:         4*60*60*1000    // removal from indexedDB
    };
    return obj[view];
  }
  this.utcFromArr   = function(a) {
    var d = new Date(a[0], a[1], a[2], a[3], a[4], a[5]);
    //Setting to local time, date comes from server and is stored in UTC time.
    d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
    return d;
  }
  this.isFresh      = function(dateArray, view) {
    var limit       = this.getLimit(view),
        now         = Date.now(),
        lastUpdated = this.utcFromArr(dateArray);
    return now - lastUpdated < limit;
  }
  this.convStr      = function(s) {
    var d = [];
    d[0] = parseInt(s.substr(0, 4));
    d[1] = parseInt(s.substr(4, 2)) - 1;    // convert to JS month, i.e. Jan=0
    d[2] = parseInt(s.substr(6, 2));
    d[3] = parseInt(s.substr(8, 2));
    d[4] = parseInt(s.substr(10, 2));
    d[5] = parseInt(s.substr(12, 2));
      
    return d;
  }
  this.freshWarning = function(dateArr, view) {
    var message = '', datetime;
    if(!this.isFresh(dateArr, view)){
      datetime  = this.utcFromArr(dateArr);
      message   = 'Last updated: ' + $filter('date')(datetime, 'medium');
    }
    return message;    
  }
})
.service('wData', function($location, $timeout, wDates) {
 /* This object is the main object displayed. It is common / reused among the different pages, i.e. current / hourly... data object contains all weather info per zip code. */
  
  var data = {};
  
  data.createWeatherObj = function(city) {
    this.view     = ''; // Current page or request, i.e. current, tenday
    this.zip      = city.zip;
    this.location = city.text; // city / state
    this.id       = 'weather-' + city.zip;
    this.current  = data.createForecastObj(true);
    this.hourly   = data.createForecastObj();
    this.tenday   = data.createForecastObj();
    this.month    = data.createMonthObj(city.zip);
    this.radar    = data.createRadarObj(city.zip);
  }  
  data.months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  data.createForecastObj = function(dict) {
    return {
      weather:      (dict) ? {} : [],
      lastUpdated:  [],     // Store all lastUpdated in UTC time
      message:      '',
      progress:     false
    };
  }
  data.createMonthObj = function(zip, yr, mon) {
    if (!yr){
      var date = new Date();
      yr  = date.getFullYear();
      mon = date.getMonth();      
    }

    return {
      year:       yr,
      month:      mon,
      monthText:  data.months[mon], 
      complete:   false,
      id:         data.createMonthId(zip, yr, mon),
      retries:    0,
      timeout:    null,
      weather:    {} // includes calendar and monthly totals.
    }
  }
  data.createRadarObj = function(zip, zoom) {
    zoom = zoom || 200;
    return {
      weather:      {}, //img, imgUrl, imgId
      lastUpdated:  [], // Store all lastUpdated in UTC time
      id:           data.createRadarId(zip, zoom),
      progress:     false,
      zoom:         zoom
    };
    
  }
  data.createMonthId = function(zip, yr, mon) {
    // convert to  wu/python month format for id.
    mon += 1;   
    mon = (mon > 9) ? mon.toString() : '0' + mon.toString();
    yr  = yr.toString();
      
    return 'month-' + zip + '-' + yr + mon;
  }
  data.createRadarId = function(zip, zoom) {
    var height  = screen.height,
        width   = screen.width,
        radius  = zoom.toString();
    return ['radar', zip, height, width, radius].join('-')
  };
  data.removeOld = function() {
/* This is intended to remove data from wData.info object so that the screen does not display old data while it refreshes from the server. Month is not handled here as it is historical and has no sense of being fresh. Look at controller for month. */
    var _d = {
      current: {},
      hourly:  [],
      tenday:  [],
      radar:   {}
    }, fresh, d = data.info;

    for(let view of Object.keys(_d)){
      fresh = wDates.isFresh(d[view].lastUpdated, view);
          
      if(!fresh){
        d[view].weather = _d[view];
      }
    }
  }
  data.setRequestView = function() {
    data.info.view = $location.path().substring(1);
    return data.info.view;
  }
  data.zoom = function(z) {
    // Left out limit checks since zoom button disables on limits.
    var radar  = data.info.radar;
    
    if(z){  // zoom in 
      if(radar.zoom <= 100) {
        radar.zoom -= 50;
      } else {
        radar.zoom -= 100;
      }
    } else{  // zoom out
      if(radar.zoom < 100) {
        radar.zoom += 50
      } else {
        radar.zoom += 100;
      }
    }
    radar.id = data.createRadarId(data.info.zip, radar.zoom);
    radar.lastUpdated = [2000, 1, 1];   // Force it to get new image.
  }

  return data;
})
.service('wDB', function($q, $interval, wDates){
  const DB_NAME     = 'weatherDB';
  const DB_VERSION  = 1.0;
  
  var db = {};
  var checks = {open: false, loaded: false};
    
  this.openDB = function() {
    var defer = $q.defer();
    var request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = function(e){
      db = this.result;
      checks.open = true;
      defer.resolve();
    }
    request.onerror = function(e){
      defer.reject();
    }
    
    request.onupgradeneeded = function(e){
      var db = e.target.result;
      var wStore = db.createObjectStore('weather', {keyPath: 'id'});
    }
    return defer.promise;
  }
  this.waitFor = function(val) {
    var wait_defer = $q.defer();
    var timer, retries = 20;
    var max_interval = retries + 1;

    function check(){
      if(checks[val]){
        $interval.cancel(timer);
        wait_defer.resolve();
      } else if(retries){
        retries--;
      } else{
        $interval.cancel(timer);
      }
    }
    
    if(checks[val]){
      wait_defer.resolve();      
    } else{
      timer = $interval(check, 2*(max_interval - retries));
    }

    return wait_defer.promise;
  }
  this.setLoaded = function() {
    checks.loaded = true;
  }
  this._put = function(id, value) {
    this.waitFor('open').then(r => {
      var request = db.transaction(['weather'], 'readwrite')
      .objectStore('weather')
      .put({id: id, value: value});
    })
  }
  this._get = function(id) {
    var deferred = $q.defer();
    
    function get_val(){
      var request = db.transaction(['weather'], 'readonly')
      .objectStore('weather')
      .get(id);
      
      request.onsuccess = function(r){
        deferred.resolve(r.target.result);
      }
      request.onerror = function(e){
        deferred.reject('could not retrieve entry from DB');
      }
    }
    
    this.waitFor('open').then(r => get_val())

    return deferred.promise;
  }
  this._getAll = function() {
    var deferred = $q.defer();

    function get_val(){
      var request = db.transaction(['weather'], 'readonly')
      .objectStore('weather')
      .getAll();
      
      request.onsuccess = function(r){
        deferred.resolve(r.target.result);
      }
      request.onerror = function(e){
        deferred.reject('could not retrieve entry from DB');
      }
    }
    
    this.waitFor('open').then(r => get_val())

    return deferred.promise;
  }
  this.cleanupCache = function() {
    var view, dateArray, request;
    function removeElem(id){
      view += '_DB';
      if(!wDates.isFresh(dateArray, view)){
        request = db.transaction(['weather'], 'readwrite')
        .objectStore('weather')
        .delete(id); 
      }
    }
    this._getAll().then(results => {
      for(let result of results){
        view = result.id.split('-')[0];
        if(view === 'radar'){
          dateArray = result.value.lastUpdated;
          removeElem(result.id);
        } else if(view === 'weather'){
          dateArray = result.value.tenday.lastUpdated;
          removeElem(result.id);
        } else{
          continue;
        }
      }
    })
  }
})
.service('autocomp', function(wDB, $http) {
  ac = {
    citySearch:   citySearch,     // UPDATED
    savedCities:  [],             // NEW
    setHomeCity:  setHomeCity,    // UPDATED
    addCity:      addCity
  };
  function setHomeCity(index) {
    var newHome = ac.savedCities.splice(index, 1);
    ac.savedCities.unshift(newHome[0]);
    wDB._put('savedCities', ac.savedCities);
  }  
  function wuAutocompleteRequest(query) {
    var url = 'https://autocomplete.wunderground.com/aq?cb=JSON_CALLBACK&c=US&query=' + query;
    
    return $http.jsonp(url).then(r => {
      return r.data.RESULTS.map( m => {
        var name = isNaN(m.name) ? m.name : m.name.substr(8);
        return {
          zip: m.zmw.substr(0,5),
          text: name
        }
      })
      .filter( city => {
        let lowerCaseQuery = angular.lowercase(query),
            test = city.zip + angular.lowercase(city.text);
        return (test.indexOf(lowerCaseQuery) >= 0);
      });
    })
  }
  function citySearch(query) {
    return query ? wuAutocompleteRequest(query) : ac.savedCities;
  }

  function addCity(newCity) {
    // Add user entered zip to the top of the 'most recent' list
    // and remove duplicate entry, if it was already in list.


    /*
    WORKING HERE.
    CURRENTLY BORKEN. TRY EITHER B = [...A, 3, 4, 5] OR B = A.PUSH.APPLY(A,B)
     */

    let home;
    if (ac.savedCities.includes(newCity)) {

    } else {
      ac.savedCities.unshift(newCity);
      ac.savedCities.unshift(home);
    }
    
    let home = ac.savedCities.shift();
    console.log('saved cites: ', );
    let index = ac.savedCities.indexOf(newCity);
    if ( index !== -1 ) {
      ac.savedCities.splice(index, 1);
    }
    ac.savedCities.unshift(newCity);
    ac.savedCities.unshift(home);
    ac.savedCities.splice(20);
    wDB._put('savedCities', ac.savedCities);
  }
  
  
  return ac;
})
.service('weather', function($http, $timeout, wData, wDates, wDB){
  function httpReq(view){
    var _url, config = {},
        data = {
            view: view,
            zip: wData.info.zip
        };
    if (view === 'radar'){
      var r = wData.info.radar;
      data.height = screen.height;
      data.width  = screen.width;
      data.radius = r.zoom.toString();
      data.id     = r.id;
      _url        = '/getradar';
      config      = {responseType: 'blob'};
    } else if(view === 'month'){
      // id is set on server to verify it always matches.
      var m = wData.info.month;
      data.year       = m.year;
      data.month      = m.month + 1;  // convert to python / wu month, i.e. Jan=1
      data.complete   = false;
      _url            = '/getmonth';
    } else{
      data.id = wData.info.id;
      _url    = '/getweather';
    }
    var url = window.location.origin + _url;
    return $http.post(url, data, config); 
  }
  function createTempRadarObj(r, zip) {
    var str   = r.headers('X-Wid'),
        idx   = str.lastIndexOf('-'),
        zoom  = str.substr(idx+1);
    var obj = wData.createRadarObj(zip, zoom);
    obj.weather.img = r.data;
    
    return obj;
  } 
  function requestRadar(radar) {
    
    var radar = wData.info.radar;
    radar.progress = true;
    
    httpReq('radar').then(r => {
      try {
        if(!r.headers('X-Werror')){
          var _id = r.headers('X-Wid');
          if(_id === wData.info.radar.id){
            updateView('radar', r);
            wDB._put(wData.info.id, wData.info);
            wDB._put(radar.id, radar);
          } else {
            var zip       = _id.substr(6,5),
                radarObj  = createTempRadarObj(r, zip);
            wDB._put(_id, radarObj);
          } 
        } else {
          radar.message = r.headers('X-Werror');
        }
        radar.progress = false;
      } catch(e) {
        radar.message = 'error processing successful server data from wu';
        radar.progress = false;        
      } 
    }, e => {
      radar.progress = false;        
      wDB._get(radar.id).then(r => {
        try {
          // DUPLICATE CODE HERE AND INITIAL DB REQUEST, NEXT 2 LINES.
          var _r = r.value.weather;
          _r.imgUrl = URL.createObjectURL(_r.img);
          wData.info.radar = r.value;
        } catch(e) {
          radar.message = 'no data available';
        }
      })
    })            
  }
  function updateView(view, newData) {
    // This function is intended to be wrapped in a try/catch above it.
    var obj     = wData.info[view];
    
    if(view === 'radar') {
      obj.weather.img     = newData.data;
      obj.weather.imgUrl  = URL.createObjectURL(obj.weather.img);
      obj.lastUpdated     = wDates.convStr(newData.headers('X-Wdate'));
    } else if(view === 'month') {
      /* Only setting these 2 params, the rest should match because of id check in refresh radar.*/
      obj.complete = newData.complete;
      obj.weather  = newData.weather;
    } else {    // current / hourly / tenday
      if(Object.keys(newData).indexOf('error') === -1){
//          newData.lastUpdated[1]--;   // convert from python to JS month.
          obj.weather     = newData[view];
          obj.lastUpdated = newData.lastUpdated;
      } else {
        obj.message = newData.error;
      }      
    }    
  }
  // NEED TO REWRITE / RENAME CHECKWDB FUNCTION
  function checkWDB(view) {
/* Checks indexDB for data before server request and as a fallback if there is a server error. Checks zip is still current, as this can be called after a server request, within that time the zip could be changed by user. */
    var obj = wData.info[view];
    if(!obj.progress && obj.weather){
      obj.message = wDates.freshWarning(obj.lastUpdated, view);
    } else if(!obj.progress) {
      obj.message = 'No ' + view + ' data available';
    }    
  }
  function refreshCurrent() {
    var current = wData.info.current,
        hourly  = wData.info.hourly;
    
    current.message = '';
    hourly.message  = '';
    
    if(!wDates.isFresh(current.lastUpdated, 'current')){
      current.progress = true;                // start the spinner
      hourly.progress = true;                 // start the spinner
      httpReq('current').then(r => {
        
        try {
          if(wData.info.zip === r.data.zip) {
            r.data.lastUpdated[1]--;          // convert from python to JS month.
            updateView('current', r.data);
            updateView('hourly', r.data);
            wDB._put(wData.info.id, wData.info);
          }
        } catch(e) {
          checkWDB('current');
          checkWDB('hourly');          
        }
        current.progress  = false;
        hourly.progress   = false;
    }, e => {
        checkWDB('current');
        checkWDB('hourly');
        current.progress  = false;
        hourly.progress   = false;
      })
    }
  }
  function refreshTenday() {
    /* Update with server data and display a message if no server data and data is getting stale. */
    var tenday = wData.info.tenday;
    tenday.message = '';
    
    if(!wDates.isFresh(tenday.lastUpdated, 'tenday')){
      tenday.progress = true;                // start the spinner
      httpReq('tenday').then(r => {
        try{
          if(wData.info.zip === r.data.zip) {
            r.data.lastUpdated[1]--;          // convert from python to JS month.
            updateView('tenday', r.data);
          }
        } catch(e) {
          checkWDB('tenday');
        }
        tenday.progress = false;
      }, e => {
        checkWDB('tenday');
        tenday.progress = false;
      })
    }
  }
  function refreshMonth() {
    function convert_month(month){
      /* for each day in the calendar convert the month val from wu/python to JS. */
      for(let week of month.weather.cal) {
        for(let day of week){
          day.date[1]--;  // convert from wu/python month to javascript, i.e. Jan=0
        }
      }
    }
    function createNewMonth(data) {
      /* Create a month object for storing in the DB. Do this to avoid async problem with what is in the main weather.month object vs the month of the returned data */
      var zip       = data.zip,
          yr        = data.year,
          mon       = data.month - 1,
          newMonth  = wData.createMonthObj(zip, yr, mon);
      
      newMonth.id       = data.id;
      newMonth.weather  = data.weather;

      return newMonth;      
    }
    httpReq('month').then(r => {
      var month = wData.info.month;
      try{
        convert_month(r.data);  // convert back to javascript monthtype, Jan = 0.
        if (month.id === r.data.id){
          // Update view
          updateView('month', r.data);
          wDB._put(wData.info.id, wData.info);
        }
          // Save to DB
        var newMonth = createNewMonth(r.data);
        wDB._put(newMonth.id, newMonth);          
      } finally {
        if(month.retries && !month.complete){
          month.timeout = $timeout(refreshMonth, 60*1000);
          month.retries--;
        }
      }
    }, e => { 
      if(month.retries && !month.complete){
        month.timeout = $timeout(refreshMonth, 60*1000);
        month.retries--;
      }
    })
  }
  function refreshRadar() {
    var radar = wData.info.radar;
    radar.message = '';

    if(!wDates.isFresh(radar.lastUpdated, 'radar')){
      wDB._get(radar.id).then(r => {
        try {
          if(wDates.isFresh(r.value.lastUpdated, 'radar')){
            var _r = r.value.weather;
            _r.imgUrl = URL.createObjectURL(_r.img);
            wData.info.radar = r.value;
          } else{
            requestRadar(radar);
//          requestRadar(radar).then(r => {radar.progress = false;})
          }
        } catch(e) {
          requestRadar(radar);
//          requestRadar(radar).then(r => {radar.progress = false;})
        }
      })
    } else {
      radar.weather.imgUrl = URL.createObjectURL(radar.weather.img);
    }
  }
  this.refreshForecasts = function() {
    /* The goal here is to refresh as much as possible with the current page taking priority. Expensive calls like radar (filesize / not used as often as other features) and month (uses lots of limited wu api calls on server) are more on demand. */
    var view = wData.setRequestView();
    wData.removeOld();

    if(view === 'tenday'){
      refreshTenday();    // generally faster than current, so no timeout reqd.
      refreshCurrent();
      
    } else if(view === 'current' || view === 'hourly'){
      refreshCurrent();
      $timeout(refreshTenday, 300);
      
    } else if(view === 'radar'){
      // radar has extra DB check, added timeout so radar will still be first 
      // request to wu and first dibs if api calls available is low.
      refreshRadar();
      $timeout(refreshCurrent, 300);
      $timeout(refreshTenday, 300);
      
    } else {    // Month
    /* Same comment as radar. 3 ways to get here, on load-wDB, on date chg, or zipcode chg. */
      var month = wData.info.month;
      $timeout.cancel(month.timeout);

      if(!month.complete){
        month.retries = 5;
        refreshMonth(month);
      }
      
      $timeout(refreshCurrent, 500);
      $timeout(refreshTenday, 500);
    }
    wDB.cleanupCache();
  }

  // Probably remove getCityFromZip
  this.getCityFromZip = function() {
    wDB._get('zip-city-xref').then(r => {
      var zipCrossRef = (r) ? r.value : {};
      var obj = wData.info;
      obj.location = zipCrossRef[obj.zip];

      if (!obj.location){
        var url = 'https://autocomplete.wunderground.com/aq?query=';
        url = url + obj.zip + '&cb=JSON_CALLBACK';
        $http.jsonp(url).then(r => {
          try{
            obj.location = r.data.RESULTS[0].name.substring(8);
            zipCrossRef[wData.info.zip] = obj.location;
            wDB._put('zip-city-xref', zipCrossRef);            
          } catch(e) {
            console.log('error cross referencing zip at wu');
          }
        })      
      }
    })
  }
});
