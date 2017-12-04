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
   * Dates are stored with UTC time. Beware javascript date function displaying a new 
   * date in local time.
   */
  function getLimit(view) {
    let obj = {
      current:            15*60*1000,   // cache
      hourly:             15*60*1000,   // cache
      tenday:           6*60*60*1000,   // cache
      radar:              20*60*1000,   // cache, 20 minutes
      // month:                    1000,   // verifies we have latest html  ---  TESTING
      month:         1*24*60*60*1000,   // verifies we have latest html
      weather_DB:   11*24*60*60*1000,   // removal from indexedDB
      radar_DB:         8*60*60*1000    // removal from indexedDB, 8 hours
    };
    return obj[view];
  }
  this.recentCheck  = function(timestamp, view) {
    timestamp = timestamp || 0;
    // 2x stops spinner from running just because we at limit, but it has really been a while.
    let limit = 2*(getLimit(view));
        
    return Date.now() - timestamp < limit;
  }
  this.isExpired    = function(timestamp, view) {
    timestamp = timestamp || 0;
    let limit = getLimit(view);

    return Date.now() - timestamp > limit;
  }
  this.convStr      = function(s) {
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
  this.expiredWarning = function(timestamp, view) {

    if(this.isExpired(timestamp, view)){
      let format = 'MMM d, y h:mm a'
          ts = (timestamp === 0) ? 'Never' : $filter('date')(timestamp, format);

      return ' may be old, last updated: ' + ts;
    }
    return '';    
  }
})
.service('wUtils', function() {
  this.objProp = function(obj, prop, value) {
    /** 
     * This is a getter and a setter, so value is an optional input.
     * Takes an array or dotted string, i.e. 'group.user.lastname', then sets and returns the property 
     * of the object. It is useful for nested objects.
     */
    function setP(_obj, _prop, _val){
      try {
        if (_val !== undefined && _obj.hasOwnProperty(_prop)) {
          _obj[_prop] = _val;
        }
        return _obj[_prop];
      } catch(e) {
        return;
      }    
    }

    if(typeof prop === 'string') {
      prop = prop.split('.');
    }

    let len     = prop ? prop.length : 0,
        counter = 1,
        val;
    
    for (let p of prop) {
      val = (len === counter) ? value : undefined;
      obj = setP(obj, p, val);
      counter++;
    }

    return obj;
  }
})
.service('wData', function($filter, $location, $timeout, wDates, wUtils) {
  /**
   * This object is the main object displayed. It is common / reused among the different pages, 
   * i.e. current / hourly... data object contains all weather info per zip code.
   */ 
  
  var data = {
    info: {
      current:    {},
      hourly:     {},
      tenday:     {},
      month:      {},
      radar:      {},
      radarUser:  {}
    }
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
    this.radar      = data.createRadarObj(city.zip);
    this.radarUser  = data.createRadarUserObj(city.zip);
  }  
  data.months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
  data.createMonthId      = function(zip, yr, mon) {
    // convert to  wu/python month format for id.
    mon += 1;   
    mon = (mon > 9) ? mon.toString() : '0' + mon.toString();
    yr  = yr.toString();
      
    return 'month-' + zip + '-' + yr + mon;
  }
  data.createMonthObj     = function(zip, yr, mon) {
    if (!yr){
      let d = new Date();
      yr  = d.getFullYear();
      mon = d.getMonth();      
    }

    return {
      year:       yr,
      month:      mon,
      monthText:  data.months[mon], 
      complete:   false,
      id:         data.createMonthId(zip, yr, mon),
      // timeout:    null,
      weather:    {} // includes html calendar and monthly totals.
    }
  }
  data.concatDayText      = function(m) {   // DEPRECATED, MOVING TO SERVER IN 1.28g.
    // month
    //  displayVersion
    //  weather
    //    cal
    let VERSION = '0.1g';
    console.log('running concatDayText', m);
    if (!m.displayTextVersion || m.displayTextVersion !== VERSION ) {
      if (m.weather && m.weather.cal) {
        for(let week of m.weather.cal) {
          for (let day of week) {


            // A COUPLE MORE IFS:
            //  -IF COMPLETE SET, OTHERWISE, ONLY H AND L, NO VALUES.
            //  -IF MONTH !== DAY[1], SET CLASS TO .noncurrent


            day.displayText = "<span class='dayHeader'>" + day.date[2] + '</span>' + 
            '<br>H ' + day.high + '&deg<br>L ' + day.low + '&deg';
            if (day.rain == 1) {    // only double == is intentional since it is probably a string.
              day.displayText = day.displayText + '<br>Rain ' + day.precip + '"';
            }
            if (day.snow == 1) {    // only double == is intentional since it is probably a string.
              day.displayText = day.displayText + '<br>Snow ' + day.snowfall + '"';
            }
          }
          console.log('updated day 1 of week: ', week[0]);
        }
      }
    }
  
    console.log('setting displayTextVersion', VERSION);
    m.displayTextVersion = VERSION;

    return m;
  }
  data.createRadarId      = function(zip, zoom) {
    let height  = screen.height,
        width   = screen.width,
        radius  = zoom.toString();
    return ['radar', zip, height, width, radius].join('-');
  };
  data.updateRadarId      = function() {
    data.info.radarUser.id = data.createRadarId(data.info.zip, data.info.radarUser.zoom);
  }
  data.createRadarObj = function(zip, zoom, id) {
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
  data.createRadarUserObj     = function(zip) {
    /**
     * Created this property since there are many images per zipcode, unlike current / hourly...
     * This allows the user to adjust the requested zoom and the image will update when it can, but
     * the image has it's own fixed zoom.
     */

    // STILL NEED TO FIGURE OUT WHAT I WANT TO DO WITH THE SPINNER. I ONLY WANT IT TO SHOW IF NO
    // IMAGE EXITS ON THE SCREEN AT ALL, BUT NOT SURE I KNOW HOW TO DO THAT NOR IF IT SHOULD BE
    // HERE OR IN THE MAIN RADAR OBJECT.

    let zoom = 200;

    return {
      id:   data.createRadarId(zip, zoom),
      zoom: zoom
    }
  };
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
      wUtils.objProp(data.info, view + '.lastChecked', d);
    }
  };
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
  data.setDurations       = function(duration, count) {   // TESTING
    let timestamp = $filter('date')(new Date(), 'M/d/yy h:mm:ss a'),
        str       = duration + 's for '+ count +' days from WU ' + timestamp;

    data.requestDurations.unshift(str);
    data.requestDurations.splice(10);
  }

  data.requestDurations   = [];   // TESTING
  data.radarRequestTS     = {}    // TESTING NEW FEATURE
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
  const DB_VERSION        = 5;            // long long integer, so can be up to a very large integer.
  const STORE_NAME        = 'weather0';
  const DEPRECATED_STORES = ['weather']
  // const WEATHER_DB_VERSION = '0.0.1'
  // const STORE_NAME = 'weather'
  // MAYBE JUST CREATE A NEW STORE NAME IF YOU CHANGE PARAMETERS BREAKING THE OLD DB.

  // CREATE A LIST OF DEPRECATED STORE_NAMES AND CYCLE THRU THEM TO DELETE WHAT IS NEEDED.
  // ONUPGRADENEEDED, USE e.target.result.objectStoreNames (.contains(latest_store_name) SINCE
  // IT IS A DOMSTRINGLIST AND NOT AN ARRAY) TO 
  // DETERMINE IF I NEED TO CREATE THE DATASTORE NAME.
  // DEPRECATED LIST WILL BE REQUIRED IF I MAKE BREAKING CHANGE TO THE DATA STRUCTURE.

  // ALSO CONSIDER indexedDB.deleteDatabase(databaseName) IF I JUST WANT TO TOTALLY START OVER, BUT 
  // NEED TO FIGURE OUT HOW I WOULD KNOW TO DELETE.
  
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
        deferred.reject('could not retrieve entry from DB');
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
    
    console.log('will ping wu with latitude longitude information.');
    $http.get(url).then(r => {
      console.log('zip back from WU GET Request ', r.data.location.zip );
    })

  }
})
.service('weather', function($http, $timeout, wData, wDates, wDB, wLog, wUtils, autocomp){
  function httpReq(view){
    let _url, config,
        data = {
            view: view,
            zip: wData.info.zip
        };
    if (view === 'radar'){
      data.id     = wData.info.radarUser.id;
      data.height = screen.height;
      data.width  = screen.width;
      data.radius = wData.info.radarUser.zoom.toString();
      _url        = '/getradar';
      config      = {responseType: 'blob'};
    } else if(view === 'month'){
      // id is set on server to verify it always matches.
      data.year       = wData.info.month.year;
      data.month      = wData.info.month.month + 1;  // convert to python / wu month, i.e. Jan=1
      data.complete   = false;
      _url            = '/getmonth';
    } else{
      data.id = wData.info.id;
      _url    = '/getweather';
    }
    // TODO TESTING: MOVE URL = ...ORIGIN TO TOP AND DO A URL += IN THE IF'S
    let url = window.location.origin + _url;
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
              // wDB._put(newRadar.id, newRadar);      // CONSIDER REPLACING WITH BELOW
            // } else {                                // CONSIDER REPLACING WITH BELOW
              // wDB._put(newRadar.id, newRadar);      // CONSIDER REPLACING WITH BELOW
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
      console.log('HI, setting RADAR DATA FOR VIEW, newData: ', newData);
      wData.info.radar = newData;
      console.log('Date.now(): ', Date.now());
      console.log('HI, setting RADAR DATA FOR VIEW, obj: ', wData.info.radar);
      // wData.updateExpiredMsg('radar');
    } else if(view === 'month') {
      console.log('updateviewdata, obj.weather > newdata: ', newData);
      obj.complete = newData.complete;
      obj.weather  = newData.weather;

    } else {    // current / hourly / tenday
      if( 'error' in newData ) {
        obj.errorMsg    = newData.error;
      } else {
        obj.weather     = newData[view];
        obj.lastUpdated = Date.now();
        obj.errorMsg    = '';
        // wData.updateExpiredMsg(view);
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
        console.log('starting spinner for ', view);
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

        // console.log('end of requestView try');
      }, e => {
        wLog.log('warning', 'Did not get ' + view + ' data from server, online status: ' + navigator.onLine + ', error: ' + e);
        updateExpiredMsg();
        wData.setSpinner(view, false, spinnerId);
      // }, () => {
      //   console.log('finally of requestView try');
      //   updateExpiredMsg();
      //   wData.setSpinner(view, false, spinnerId);        
      })
    }
  }
  function refreshMonth() {

    // ADD EXPIRED STUFF HERE TO AVOID FLASHING SCREEN ???

    function createNewMonth(data) {
      /* Create a month object for storing in the DB. Do this to avoid async problem with what is
       in the main weather.month object vs the month of the returned data */
      var zip       = data.zip,
          yr        = data.year,
          mon       = data.month - 1, // Convert to JS month, i.e. Jan=0.
          newMonth  = wData.createMonthObj(zip, yr, mon);
      
      newMonth.id       = data.id;
      newMonth.weather  = data.weather;

      return newMonth;
    }

    httpReq('month').then(r => {
      console.log('httpReq(month).then(r =>', r);
      var month = wData.info.month;
      try{
        if (month.id === r.data.id){
          console.log('month ids are equal, month', month);
          // Update Screen
          // Does update view convert month back to JS??? Seems to be working 11/26/17.

          updateViewData('month', r.data);
          console.log('just ran updateViewData');

          wData.info.month.lastSuccessfulCheck = Date.now();

          wDB._put(wData.info.id, wData.info);
        }
        // Save to DB
        let newMonth = createNewMonth(r.data);    // CONSIDER REPLACING WITH BELOW
        wDB._put(newMonth.id, newMonth);          // CONSIDER REPLACING WITH BELOW
        // wDB._put(wData.info.month.id, Object.assign({}, wData.info.month)); // TRY THIS INSTEAD OF ABOVE 2 LINES.
      } catch (e) {
        wLog.log('error', 'Failed to update Month with successful server request data, error: ', e);
        console.log('Failed to update Month with successful server req, error: ', e);
      }
    }, e => { 
      wLog.log('error', 'Failed to update Month with successful server request data, error: ', e);
      console.log('Failed to update Month with failed server request.');
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
      /* Same comment as radar. 3 ways to get here, on load-wDB, on date chg, or zipcode chg. */
      let month   = wData.info.month;
      let expired = wDates.isExpired(month.lastSuccessfulCheck, 'month');

      if(!month.complete || expired){
        refreshMonth();
      }
      $timeout(refreshView, 1000, true, 'current');
      $timeout(refreshView, 1000, true, 'tenday');
    }

    if (wData.setHome.flag) {
      autocomp.setHomeCity();
    }

    wDB.cleanupCache();
  }
});
