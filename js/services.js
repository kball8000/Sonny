// Move more autocomplete to service
// add location request to webpage since no api required, also very async.

var app = angular.module('weatherServices', [])
.service('wLog', function(wDB, $q, $filter){
  this.log = function(level, value) {
    // AacceptableKeys = 'error', 'warning' or 'info'
    wDB._get('logs').then(r => {
      let ts = $filter('date')(Date.now(), 'medium'),
          logs = (r && r.value) ? r.value : [];
      logs.push({level: level, timestamp: ts, value: value})
      logs.splice(100);
      wDB._put('logs', logs);
    })
  }
  this.getLogs = function() {
    let deferred = $q.defer();

    wDB._get('logs').then(r => {
      if (r && r.value) {
        deferred.resolve(r.value) 
      } else {
        deferred.reject({level: 'info', value: 'No logs available'}); 
      }      
    })

    return deferred.promise;
  }
})
.service('wDates', function($filter){
  /**
   * Dates are stored with UTC time. Beware javascript date function displays a new 
   * date in local time in console.
   */
  function getLimit(view) {
    let obj = {
      current:            15*60*1000,   // cache
      hourly:             15*60*1000,   // cache
      tenday:           6*60*60*1000,   // cache
      radar:              20*60*1000,   // cache, 20 minutes
      month:            6*60*60*1000,   // verifies we have latest html or current month
      weather_DB:   11*24*60*60*1000,   // removal from indexedDB
      radar_DB:         8*60*60*1000    // removal from indexedDB, 8 hours
    };
    return obj[view];
  }
  this.months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  this.recentCheck  = function (timestamp, view) {
    timestamp = timestamp || 0;
    // 2x stops spinner from running just because we at limit, but it has really been a while.
    let limit = 2*(getLimit(view));
        
    return Date.now() - timestamp < limit;
  }
  this.isExpired    = function (timestamp, view) {
    timestamp = timestamp || 0;
    let limit = getLimit(view);

    return Date.now() - timestamp > limit;
  }
  this.convStr      = function (s) {
    let d = [
      parseInt(s.substr(0, 4)),
      parseInt(s.substr(4, 2)) - 1,    // convert to JS month, i.e. Jan=0
      parseInt(s.substr(6, 2)),
      parseInt(s.substr(8, 2)),
      parseInt(s.substr(10, 2)),
      parseInt(s.substr(12, 2))  
    ], 
    date = new Date(...d);

    return date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  }
  this.expiredWarning = function (timestamp, view) {

    if(this.isExpired(timestamp, view)){
      let format = 'MMM d, y h:mm a'
          ts = (timestamp === 0) ? 'Never' : $filter('date')(timestamp, format);

      return ' may be old, last updated: ' + ts;
    }
    return '';    
  }
  this.incrementMonth = function (obj, next) {
    if (next) {
      if(obj.month < 11) {
        obj.month++;
      } else {
        obj.month = 0;
        obj.year++;
      }
    } else {
      if(obj.month > 0) {
        obj.month--;
      } else {
        obj.month = 11;
        obj.year--;
      }
    }
    if ('monthText' in obj) {
      obj.monthText = this.months[obj.month];
    }
  }
})
.service('wData', function($filter, $location, $timeout, wDates) {
  /**
   * This object is the main object displayed. It is common / reused among the different pages, 
   * i.e. current / hourly... data object contains all weather info per zip code.
   */ 
  
  // let months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let data = {
    info: {
      current:    {},
      hourly:     {},
      tenday:     {},
      month:      {},
      radar:      {},
      radarUser:  {}
    },
    monthUser:  createMonthUser()
  };
  data.createWeatherObj = function(city) {
    this.view       = ''; // Current page or request, i.e. current, tenday
    this.zip        = city.zip;
    this.location   = city.text; // city / state
    this.id         = 'weather-' + city.zip;
    this.current    = data.createForecastObj(true);
    this.hourly     = data.createForecastObj();
    this.tenday     = data.createForecastObj();
    this.month      = data.createMonthObj(city.zip);
    // this.monthUser  = data.createMonthUser(city.zip);
    this.radar      = data.createRadarObj(city.zip);
    this.radarUser  = data.createRadarUserObj(city.zip);
  }  
  // data.months = months;
  // See autocomplete service for explanation of setHome.
  data.setHome            = {flag: false, city: {}};
  data.createForecastObj  = function(dict) {
    return {
      weather:      (dict) ? {} : [],
      lastUpdated:  0,     // Store timestamps as seconds since epoch, i.e. 1970.
      lastChecked:  0,
      errorMsg:     '',
      expiredMsg:   '',
      spinner:     false
    };
  }
  data.createMonthId      = function(obj) {

    // convert to  wu/python month format for id.
    let month = obj.month,
        year  = obj.year.toString(),
        zip   = obj.zip || data.info.zip;

    month += 1;
    month = (month > 9) ? month.toString() : '0' + month.toString();

    return 'month-' + zip + '-' + year + month;
  }
  data.createMonthObj     = function() {
    return {
      year:       0,
      month:      0,
      monthText:  wDates.months[0],
      // monthText:  data.months[0],
      complete:   false,
      html:       '',
      id:         ''
    }
  }
  function createMonthUser() {
    let d   = new Date(),
      yr  = d.getFullYear(),
      mon = d.getMonth();      

    return {
      year:       yr,
      month:      mon,
      monthText:  wDates.months[mon],
      // monthText:  months[mon],
      id:        function() {
        let zip = data.info.zip,
            mon = this.month,
            yr  = this.year;

        mon += 1; // convert to  wu/python month format for id.
        mon = (mon > 9) ? mon.toString() : '0' + mon.toString();
        yr  = yr.toString();
          
        return 'month-' + zip + '-' + yr + mon;
      }
    }
  }
  data.createRadarId      = function(zip, zoom) {
    let height  = screen.height,
        width   = screen.width,
        radius  = zoom.toString();
    return ['radar', zip, height, width, radius].join('-');
  }
  data.updateRadarId      = function() {
    data.info.radarUser.id = data.createRadarId(data.info.zip, data.info.radarUser.zoom);
  }
  data.createRadarObj     = function(zip, zoom, id) {
    zoom  = zoom  || 200;
    id    = id    || data.createRadarId(zip, zoom);

    return {
      id:           id,
      img:          null,
      imgUrl:       '',
      lastChecked:  0,
      lastUpdated:  0,    // Store timestamps as seconds since epoch, i.e. 1970.
      errorMsg:     '',
      expiredMsg:   '',
      zip:          zip,
      zoom:         zoom
    }
  }
  data.createRadarUserObj = function(zip) {
    /**
     * Created this property since there are many images per zipcode, unlike current / hourly...
     * This allows the user to adjust the requested zoom and the image will update when it can, but
     * the image has it's own fixed zoom.
     */

    let zoom = 200;

    return {
      id:   data.createRadarId(zip, zoom),
      zoom: zoom
    }
  }
  data.setZoom            = function(z) {
    // Left out limit checks since zoom button disables on limits.
    let radarUser  = data.info.radarUser;
    
    if(z){  // zoom in 
      if(radarUser.zoom <= 100) {
        radarUser.zoom -= 50;
      } else {
        radarUser.zoom -= 100;
      }
    } else{  // zoom out
      if(radarUser.zoom < 100) {
        radarUser.zoom += 50
      } else {
        radarUser.zoom += 100;
      }
    }
    // TESTING
    // NEEDS WORK, THIS IS UBER HACK AND I DON'T LIKE IT.
    radarUser.lastUpdated = 0;    // Forces app to look for new image.
  }
  data.setRequestView     = function() {
    data.info.view = $location.path().substring(1);
    return data.info.view;
  }
  data.updateLastChecked  = function(view) {
    let d = Date.now();
    if (view === 'current' || view === 'hourly') {
      data.info.current.lastChecked = d;
      data.info.hourly.lastChecked  = d;
    } else {
      data.info[view].lastChecked = d;
    }
  }
  data.updateExpiredMsg = function(_view) {
    /**
     * Will update an individual view if requested, otherwise all views.
     * Run when going to a page and whenever updating data to the screen either from local db or server.
     */
    let views = _view ? [_view] : ['current', 'hourly', 'tenday', 'radar'];

    if (_view === 'current') {
      views.push('hourly');
    } else if (_view === 'hourly'){
      views.push('current');
    }

    for (let view of views) {
      let lastUpdated = data.info[view].lastUpdated,
          expiredMsg  = wDates.expiredWarning(lastUpdated, view);

      data.info[view].expiredMsg = expiredMsg;
    }
  }
  data.setSpinner         = function(view, status, id) {
    /**
     * The concept of the spinner is to only run if has been a while since last requesting data from
     * the server. So, I create a 'last request/checked' id when turning on spinner, then turn it off 
     * after the timeout if the timeout sends the correct id. This allows city change to still get a 
     * spinner if it has been a long time since requesting data.
     */
    let newSpinnerId;

    function chgSpinner() {
      if (view === 'current' || view === 'hourly'){
        data.info.current.spinner = status;
        data.info.hourly.spinner  = status;
      } else {
        data.info[view].spinner   = status;
      }
    }
    function setSpinnerId(id) {
      if (view === 'current' || view === 'hourly'){
        data.info.current.spinnerId = id;
        data.info.hourly.spinnerId  = id;
      } else {
        data.info[view].spinnerId   = id;
      }
      return id;
    }

    if (status) {
      chgSpinner();
      newSpinnerId = setSpinnerId(Date.now());
      // newSpinnerId = setSpinnerId(Math.ceil(Math.random()*1000));
      $timeout(data.setSpinner, 2000, true, view, false, newSpinnerId);
    } else if (id === data.info[view].spinnerId) {
      // turn spinner off only if this returned data request / timeout actually turned it on.
      chgSpinner();
      setSpinnerId(0);  // setting to a value the id could never be because of Math.ceil.
    }
    // in case we turn spinner off without getting new data from server.
    // data.updateExpiredMsg(view);

    return newSpinnerId;
  }
  data.radarRequestTS     = {};
  data.setRadarTS         = function(id, ts) {
    // ts - timestamp, id - radar image id.
    if (ts) {   // unset 
      let latestTs = data.radarRequestTS[id]
      if (ts === latestTs) {
        data.radarRequestTS[id] = null;
      }
    } else {    // set
      ts = Date.now();
      data.radarRequestTS[id] = ts;
    }

    return ts;
  }

  return data;
})
.service('wDB', function($q, $interval, wDates){
  const DB_NAME           = 'weatherDB';
  const DB_VERSION        = 6;            // long long integer, so can be up to a very large integer.
  const STORE_NAME        = 'weather2';
  const DEPRECATED_STORES = ['weather', 'weather0', 'weather1']
  // If there are breaking changes in the data structure:
  //   - rev DB_VERSION to next integer
  //   - add current storename to DEPRECATED_STORES array
  //   - create a new storename

  // ALSO CONSIDER indexedDB.deleteDatabase(databaseName) IF I JUST WANT TO TOTALLY START OVER, BUT 
  // WOULD NEED TO FIGURE OUT HOW I WOULD KNOW TO DELETE.
  
  var db = {};
  var checks = {open: false, loaded: false};
    
  this.openDB = function() {
    var defer = $q.defer();
    var request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = function(e){
      db = this.result;
      // BELOW CLEARS THE DATASTORE, NEED TO FIGURE OUT HOW TO RUN IT BASED ON SOME SORT OF VERSION.
      // db.transaction('weather', 'readwrite').objectStore('weather').clear();

      checks.open = true;
      defer.resolve();
    }
    request.onerror = function(e){
      defer.reject();
    }
    request.onupgradeneeded = function(e){
      var db = e.target.result;
      // console.log('db: ', db);
      // console.log('objectstorenames: ', db.objectStoreNames);
      // let li = db.objectStoreNames;
      // console.log('first el: ', li[0], 'length: ', li.length, ', array? ', Array.isArray(li));
      // if (li.contains('weather')) {
      //   console.log('weather exists!!4!!!');
      //   // db.createObjectStore('weather1', {keyPath: 'id'})
      // } else {
      //   console.log('weather DOES NOT exist!');
      // }
      // var wStore = db.createObjectStore('weather', {keyPath: 'id'});

      // let currentStores     = db.objectStoreNames;
          // latestStores      = ['weather0'],
          // deprecatedStores  = ['weather'];

      for (let store of DEPRECATED_STORES) {
        if (db.objectStoreNames.contains(store)) {
          console.log('will remove store: ', store);
          db.deleteObjectStore(store);
        }
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        console.log('will add store: ', STORE_NAME);
        db.createObjectStore(STORE_NAME, {keyPath: 'id'});
      }
      // db.createObjectStore('weather', {keyPath: 'id'});
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
      // var request = db.transaction(['weather'], 'readwrite')
      //                 .objectStore('weather')
      //                 .put({id: id, value: value});
      db.transaction([STORE_NAME], 'readwrite')
      .objectStore(STORE_NAME)
      .put({id: id, value: value});
    })
  }
  this._get = function(id) {
    var deferred = $q.defer();
    
    function get_val(){
      var request = db.transaction([STORE_NAME], 'readonly')
      .objectStore(STORE_NAME)
      .get(id);
      
      request.onsuccess = function(r){
        deferred.resolve(r.target.result);
      }
      request.onerror = function(e){
        console.log('wDB._get error:', e);
        deferred.reject(id);
      }
    }
    
    this.waitFor('open').then(r => get_val())

    return deferred.promise;
  }
  this._getAll = function() {
    var deferred = $q.defer();

    function get_val(){
      var request = db.transaction([STORE_NAME], 'readonly')
      .objectStore(STORE_NAME)
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
    let view, timestamp, request;
    function removeElem(id){
      view += '_DB';
      if(wDates.isExpired(timestamp, view)) {
          request = db.transaction([STORE_NAME], 'readwrite')
        .objectStore(STORE_NAME)
        .delete(id); 
      }
    }
    this._getAll().then(results => {
      for(let result of results){
        view = result.id.split('-')[0];
        if(view === 'radar'){
          // Removing individually saved radar images, not the one with the zip/city weather object.
          timestamp = result.value.lastUpdated;
          removeElem(result.id);
        } else if(view === 'weather'){
          // Chose tenday, as it has the longest cache expiration. Remove entire city at that point.
          timestamp = result.value.tenday.lastUpdated;
          removeElem(result.id);
        } else{
          continue;
        }
      }
    })
  }
})
.service('autocomp', function(wData, wDB, $http) {
  /** 
   * Created this setHome flag concept so I could refresh weather using selected city
   * which runs after the checkbox function. Checkbox function will alter cities list causing
   * it to refresh weather on wrong city. Now flag allows weather to be retrieved first and list
   * altered second.
   */
  function setHomeCity() {
    let idx     = this.savedCities.indexOf(wData.setHome.city);
    let newHome = this.savedCities.splice(idx, 1);
    this.savedCities.unshift(newHome[0]);

    wData.setHome.flag = false;
    wDB._put('savedCities', this.savedCities);
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
        let lowerCaseQuery  = angular.lowercase(query),
            test            = city.zip + angular.lowercase(city.text);
        return (test.indexOf(lowerCaseQuery) >= 0);
      });
    })
  }
  let _this = this;
  this.savedCities      = [];
  this.initializeCities = function() {
    this.savedCities = [
      {zip: '61601', text: 'Peoria, Illinois'},
      {zip: '45201', text: 'Cincinnati, Ohio'},
      {zip: '37501', text: 'Memphis, Tennessee'}
    ];
    wDB._put('savedCities', this.savedCities);
  }
  this.setHomeFlag      = function(city){
    wData.setHome.flag = true;
    wData.setHome.city = city;
  }
  this.citySearch       = function(query) {
    return query ? wuAutocompleteRequest(query) : _this.savedCities;
  }
  this.addCity          = function(newCity){
    /**
     * Add user entered/selected zip to the top of the 'most recent' list
     * and remove duplicate entry, if it was already in list.
     */
    let max_length  = 15,
        idx         = this.savedCities.indexOf(newCity);

    if (idx > 1) {
      this.savedCities.splice(idx, 1);
      this.savedCities.splice(1, 0, newCity);
    } else if (idx === -1) {
      this.savedCities.splice(1, 0, newCity);
      this.savedCities.splice(max_length);
    }

    if (idx !== 0 && idx !== 1) {
      wDB._put('savedCities', this.savedCities);
    }
  }
  this.getCityFromGeo   = function(lat, long) {
    let url = 'https://api.wunderground.com/api/85e2c1e705673981/geolookup/q/';
    url = url + lat + ',' + long + '.json';
    
    // console.log('will ping wu with latitude longitude information.');
    $http.get(url).then(r => {
      console.log('zip back from WU GET Request ', r.data.location.zip );
    })

  }
})
.service('weather', function($http, $q, $timeout, wData, wDates, wDB, wLog, autocomp){
  function httpReqObj(obj, relativeUrl){
    /**
     * For requesting data, at the moment only month data, which is outside of what is displayed 
     * to the user, i.e. prefetching data.
     */
    let url   = window.location.origin + relativeUrl,
        data  = Object.assign({}, obj);

    data.month += 1; // Convert for python, i.e. Jan = 1.

    return $http.post(url, data);
  }
  this.httpReqObj = function(obj, url){
    httpReqObj(obj, url)
  }

  function httpReq(view){
    let url     = window.location.origin, 
        config  = {},
        data    = {
            view: view,
            zip: wData.info.zip
        };
    if (view === 'radar'){
      data.id             = wData.info.radarUser.id;
      data.height         = screen.height;
      data.width          = screen.width;
      data.radius         = wData.info.radarUser.zoom.toString();
      url                 += '/getradar';
      config.responseType = 'blob';
    } else{
      data.id = wData.info.id;
      url     += '/getweather';
    }
    return $http.post(url, data, config); 
  }
  function createTempRadarObj(r, lastServReq) {
      /** 
     * Example id: radar-61603-768-1024-200, zip/screen height/screen width/zoom
     */

    let id      = r.headers('X-Wid');
        params  = id.split('-'),
        zip     = params[1],
        zoom    = parseInt(params[4]),
        obj     = wData.createRadarObj(zip, zoom, id),
        date    = wDates.convStr(r.headers('X-Wdate'));

    obj.img         = r.data;
    obj.imgUrl      = URL.createObjectURL(obj.img);

    obj.lastChecked = lastServReq;    // may be used for spinner, not currently.
    obj.lastServReq = lastServReq;    // used to avoid too many server requests.
    obj.lastUpdated = date;
    
    return obj;
  }
  function requestRadar(radar) {
    /**
     * Request a radar image from server with a 30s time limit to wait for server response.
     */
    
    let lastServReq = wData.info.radar.lastServReq || 0;

    if (Date.now() - lastServReq > 30*1000) {
      let requestedId = wData.info.radarUser.id,
          requestTS   = wData.setRadarTS(requestedId);

      console.log('sending radar request for id: ', requestedId, ', ts: ', requestTS);
          
      wData.info.radar.lastServReq = Date.now();
      
      httpReq('radar').then(r => {
        try {
          if(!r.headers('X-Werror')){

            let newRadar = createTempRadarObj(r, lastServReq);
            
            if(newRadar.id === requestedId){
              updateViewData('radar', newRadar);
              wDB._put(wData.info.id, wData.info);
            }
            wDB._put(newRadar.id, newRadar);        // CONSIDER REPLACING ABOVE WITH THIS LINE.
            wData.info.radar.errorMsg = '';
          } else {
            wData.info.radar.errorMsg = r.headers('X-Werror');
          }
          console.log('retrieved radar request for id: ', requestedId);    // TESTING
        } catch(e) {
          wData.info.radar.errorMsg = 'error processing successful server radar image from wu';
        }
        wData.setRadarTS(requestedId, requestTS);
        console.log('radar request obj after clearing: ', wData.radarRequestTS);  // TESTING
      }, e => {
        wData.setRadarTS(requestedId, requestTS);
        wData.info.radar.errorMsg  = 'Error getting Radar image from server!';
        wLog.log('warning', 'Did not get radar image from server, online status: ', navigator.onLine);
      })
    }
  }
  function updateViewData(view, newData) {
    // This function is intended to be wrapped in a try/catch above it.
    var obj = wData.info[view];

    if(view === 'radar') {
      wData.info.radar = newData;
    } else {    // current / hourly / tenday
      if( 'error' in newData ) {
        obj.errorMsg    = newData.error;
      } else {
        obj.weather     = newData[view];
        obj.lastUpdated = Date.now();
        obj.errorMsg    = '';
      }
    }
  }
  function refreshView(view) {
    /**
     * This refreshes Now / Hourly / Tenday tabs.
     */
    function updateExpiredMsg() {
      if (view !== 'month') {
        wData.updateExpiredMsg(view);
      }
    }

    let expiredData     = wDates.isExpired(wData.info[view].lastUpdated, view),
        recentCheck     = wDates.recentCheck(wData.info[view].lastChecked, view),
        validTempRegex  = /^-?\d+/,
        spinnerId;

    wData.updateLastChecked(view);

    if(expiredData){
      // Stops spinner from going all the time on a bad network connection / slow device.      
      if (!recentCheck) {
        spinnerId = wData.setSpinner(view, true);
      }

      httpReq(view).then(r => { 
        try {
          if(wData.info.zip === r.data.zip) {
            if (view === 'current' || view == 'hourly') {
              validTempRegex.test(r.data.current.temp)    ? updateViewData('current', r.data) : 0;
              validTempRegex.test(r.data.hourly[0].temp)  ? updateViewData('hourly', r.data) : 0;
            } else {
              validTempRegex.test(r.data.tenday[0].high)  ? updateViewData('tenday', r.data) : 0;
            }

            wDB._put(wData.info.id, wData.info);
          } // Could have done else > cache for later, but seemed super rare case and more code.
        } catch(e) {
          wLog.log('error', 'httpReq ' + view + ' success, but catch on updatingView, error: ' + e);
        }

        updateExpiredMsg();
        wData.setSpinner(view, false, spinnerId);

      }, e => {
        wLog.log('warning', 'Did not get ' + view + ' data from server, online status: ' + navigator.onLine + ', error: ' + e);
        updateExpiredMsg();
        wData.setSpinner(view, false, spinnerId);
      })
    }
  }
  function setMonthFromDB() {
    /* if it exists, retrieves from indexedDB or creates a new month object to display */
    let id = wData.monthUser.id();
    
    wDB._get(id).then(r => {
      if (r && r.value && r.value.id === id){
        wData.info.month = r.value;
      }
    })
  }  
  function createArrMonths(seedMonth, offsets) {
    /**
     * Creates an array of months offset from the seed month.
     */
    let arr = [], newMonth;
    for(let i of offsets) {
      newMonth = {
        month:  seedMonth.month,
        year:   seedMonth.year,
        view:   'month',
        zip:    wData.info.zip
      }
      while (i !== 0) {
        wDates.incrementMonth(newMonth, (i > 0));
        i = (i > 0) ? --i : ++i;
      }
      newMonth.id = wData.createMonthId(newMonth);
      arr.push(newMonth);
    }
    return arr;
  }
  function wDBMonthNeedsUpdating(month) {
    /**
     * Determines if the month obj in the localDB needs updating. Returns the month obj if true, otherwise, false.
     */
    let defer = $q.defer();

    wDB._get(month.id).then(r => {
      if (r && r.value) {
        let expired = wDates.isExpired(r.value.lastSuccessfulCheck, 'month');
        if (r.value.complete && !expired) {
          defer.resolve(false);
        }
      }
      defer.resolve(month);
    })

    return defer.promise;
  }
  function refreshMonth() {
    let arrInd = [0, -1, -2, 1],
        months = createArrMonths(wData.monthUser, arrInd),
        promises = [],
        monthToUpdate;

    setMonthFromDB();

    for (let month of months) {
      promises.push(wDBMonthNeedsUpdating(month));
    }
    Promise.all(promises).then( responses => {
      for (let r of responses) {
        if (!monthToUpdate) {
          monthToUpdate = r;
        }
      }

      if (monthToUpdate) {
        httpReqObj(monthToUpdate, '/getmonth').then(r => {
          try {
            r.data.lastSuccessfulCheck = Date.now();
            if (r.data.id === wData.monthUser.id()) {
              wData.info.month = r.data;      // Display data to screen.
            }
            wDB._put(r.data.id, r.data);      // Save data to local DB.
          } catch (e) {
            console.log('Could not set month object from server to screen or DB.');
          }
        })
      }
    })
  }
  function refreshRadar() {
    /**
     * This is a bit different then current/hourly/daily since there are multiple datasets per zip.
     * On each refreshRadar, check local first to see if the individual image is stored separate from
     * the main object and display if so, otherwise, request from server.
     */

    // NOTE that expired data essentially also checks that an image exists on startup. By default
    // it is set to old, so we start looking to local db, then server.

    let expiredData = wDates.isExpired(wData.info.radar.lastUpdated, 'radar'),
        sameZoom    = wData.info.radarUser.zoom === wData.info.radar.zoom;

    console.log('refreshRadar, checking expired on current object: ', expiredData, ', sameZoom: ', sameZoom);
    if (!sameZoom ) {
      console.log('refreshRadar, !sameZoom, getting from wDB');
      wDB._get(wData.info.radarUser.id).then( r => {
        try {

          // WORKING HERE / TESTING. TRY TO FIGURE OUT HOW TO TEST IF URL IS STILL OK BEFORE CREATING A NEW URL.

          r.value.imgUrl    = URL.createObjectURL(r.value.img);
          console.log('image url for wDB image', r.value.imgUrl); 
          wData.info.radar  = r.value;
          wData.updateExpiredMsg('radar');

          console.log('checking expiration of wDB data: ', r.value.lastUpdated);
          if(wDates.isExpired(r.value.lastUpdated, 'radar')) {
            console.log('wDB expired, so firing off a requestRadar');
            requestRadar();
          }
        } catch (e) {


          // I WOULD NOT EXPECT THIS TO CATCH SO MUCH, WHY???

          console.log('wDB catch, so firing off a requestRadar');
          requestRadar();
        }
      })
    } else if (sameZoom && expiredData) {
      console.log('expired so firing off a requestRadar');
      requestRadar();
    }      
  }
  this.refreshForecasts = function() {
    /**
     * The goal here is to refresh as much as possible with the current page taking priority. 
     * Expensive calls like radar (filesize / not used as often as other features) and month 
     * (uses lots of limited wu api calls on server) are more on demand. 
     */ 

    let view  = wData.setRequestView();
    
    if(view === 'tenday'){
      refreshView('tenday');    // generally faster than current, so no timeout reqd.
      refreshView('current');
            
    } else if(view === 'current' || view === 'hourly'){
      refreshView('current');
      $timeout(refreshView, 300, true, 'tenday');
      
    } else if(view === 'radar'){
      // Radar has extra DB check, added timeout so radar will still be first 
      // request to wu and first dibs if api calls available is low.
      refreshRadar();
      $timeout(refreshView, 1000, true, 'current');
      $timeout(refreshView, 1000, true, 'tenday');
      
    } else if(view === 'month'){
      /**
       * Same comment as radar. 3 ways to get here, on load-wDB, on date chg, or zipcode chg. 
       */ 
      refreshMonth();

      $timeout(refreshView, 1000, true, 'current');
      $timeout(refreshView, 1000, true, 'tenday');
    }

    if (wData.setHome.flag) {
      autocomp.setHomeCity();
    }

    wDB.cleanupCache();
  }
});
