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
    var obj = {
      current:            15*60*1000,   // cache
      hourly:             15*60*1000,   // cache
      tenday:           6*60*60*1000,   // cache
      radar:              20*60*1000,   // cache
      weather_DB:   11*24*60*60*1000,   // removal from indexedDB
      radar_DB:         8*60*60*1000    // removal from indexedDB
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
  this.freshWarning = function(timestamp, view) {
    if(this.isExpired(timestamp, view)){
      return 'Last updated: ' + $filter('date')(timestamp, 'medium');
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
.service('wData', function($location, $timeout, wDates, wUtils) {
 /* This object is the main object displayed. It is common / reused among the different pages, i.e. current / hourly... data object contains all weather info per zip code. */
  
  var data = {
    info: {
      current:  {},
      hourly:   {},
      tenday:   {},
      month:    {},
      radar:    {}
    }
  };
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
  // See autocomplete service for explanation of setHome.
  data.setHome            = {flag: false, city: {}};
  data.createForecastObj  = function(dict) {
    return {
      weather:      (dict) ? {} : [],
      lastUpdated:  0,     // Store timestamps as seconds since epoch, i.e. 1970.
      lastChecked:  0,
      message:      '',
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
  data.createRadarId      = function(zip, zoom) {
    var height  = screen.height,
        width   = screen.width,
        radius  = zoom.toString();
    return ['radar', zip, height, width, radius].join('-');
  };
  data.updateRadarId      = function() {
    data.info.radar.idUserSel = data.createRadarId(data.info.zip, data.info.radar.zoomUserSel);
  }
  data.createRadarWeathObj = function(zip, zoom, id) {
    id = id || data.createRadarId(zip, zoom);
    return {
      id:           id,
      img:          null,
      imgUrl:       '',
      lastChecked:  0,
      lastUpdated:  0,    // Store timestamps as seconds since epoch, i.e. 1970.
      message:      '',
      zip:          zip,
      zoom:         zoom
    }
  }
  data.createRadarObj     = function(zip, zoom) {
    zoom = zoom || 200;

    return {
      idUserSel:    data.createRadarId(zip, zoom),
      spinner:      false,
      spinnerId:    0,
      weather:      data.createRadarWeathObj(zip,zoom),
      zoomUserSel:  zoom
    };
    
  }
  data.setZoom            = function(z) {
    // Left out limit checks since zoom button disables on limits.
    var radar  = data.info.radar;
    
    if(z){  // zoom in 
      if(radar.zoomUserSel <= 100) {
        radar.zoomUserSel -= 50;
      } else {
        radar.zoomUserSel -= 100;
      }
    } else{  // zoom out
      if(radar.zoomUserSel < 100) {
        radar.zoomUserSel += 50
      } else {
        radar.zoomUserSel += 100;
      }
    }
    // TESTING
    // NEEDS WORK, THIS IS UBER HACK AND I DON'T LIKE IT.
    radar.lastUpdated = 0;    // Forces app to look for new image.
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
  data.updateFreshnessMsg = function(_view) {
    /**
     * Will update an individual view if requested, otherwise all views.
     */
    let views = _view ? [_view] : ['current', 'hourly', 'tenday', 'radar.weather'];

    if (_view === 'current') {
      views.push('hourly');
    } else if (_view === 'hourly'){
      views.push('current');
    }

    for (let view of views) {
      let lastUpdated = wUtils.objProp(data.info, view + '.lastUpdated'),
          message     = wDates.freshWarning(lastUpdated, view);

      wUtils.objProp(data.info, view + '.message', message);
    }
  }
  data.clearMessage      = function(view) {
    if (view === 'current' || view === 'hourly'){
      data.info.current.message = '';
      data.info.hourly.message  = '';
    } else {
      wUtils.objProp(data.info, view + '.message', '');
    }
  }
  data.setSpinner         = function(view, status, id) {
    /**
     * The concept of the spinner is to only run if has been a while since last requesting data from
     * the server. So, I create a 'last request/checked' id when turning on spinner, then turn it off 
     * after the timeout if the timeout sends the correct id. This allows city change to still get a 
     * spinner if it has been a long time sine request.
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
      newSpinnerId = setSpinnerId(Math.ceil(Math.random()*1000,0));
      $timeout(data.setSpinner, 2000, true, view, false, newSpinnerId);
    } else if (id === data.info[view].spinnerId) {
      // turn spinner off only if this returned data request / timeout actually turned it on.
      chgSpinner();
      setSpinnerId(0);  // setting to a value the id could never be because of Math.ceil.
    }
    // in case we turn spinner off without getting new data from server.
    data.updateFreshnessMsg(view);

    return newSpinnerId;
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
    var view, timestamp, request;
    function removeElem(id){
      view += '_DB';
      if(wDates.isExpired(timestamp, view)){
        request = db.transaction(['weather'], 'readwrite')
        .objectStore('weather')
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
})
.service('weather', function($http, $timeout, wData, wDates, wDB, wLog, wUtils, autocomp){
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
      data.radius = r.zoomUserSel.toString();
      data.id     = r.idUserSel;
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
  function createTempRadarObj(r) {
      /** 
     * Example id: radar-61603-768-1024-200, zip/screen height/screen width/zoom
     */

    let id      = r.headers('X-Wid');
        params  = id.split('-'),
        zip     = params[1],
        zoom    = params[4],
        obj     = wData.createRadarWeathObj(zip, zoom, id),
        date    = wDates.convStr(r.headers('X-Wdate'));

    obj.img         = r.data;
    obj.lastChecked = Date.now();
    obj.lastUpdated = date;
    
    console.log('returning obj create temp radar', obj);

    return obj;
  }
  function requestRadar(radar) {
    
    let recentCheck = wDates.recentCheck(wData.info.radar.weather.lastChecked, 'radar');
    wData.updateLastChecked('radar.weather');
    
      wData.info.radar.spinner = !recentCheck;

      httpReq('radar').then(r => {
        try {
          if(!r.headers('X-Werror')){

            let newRadar = createTempRadarObj(r);
            
            if(newRadar.id === wData.info.radar.idUserSel){
              updateViewData('radar', newRadar);
              wDB._put(wData.info.id, wData.info);
              wDB._put(newRadar.id, newRadar);
            } else {
              wDB._put(newRadar.id, newRadar);
            }

          } else {
            wData.info.radar.weather.message = r.headers('X-Werror');
          }
        } catch(e) {
          wData.info.radar.weather.message = 'error processing successful server radar image from wu';
        }
        wData.info.radar.spinner = false;
      }, e => {
        wData.info.radar.progress = false;
        wData.info.radar.weather.message  = 'Error getting Radar image from server!';
        wLog.log('warning', 'Did not get radar image from server, online status: ', navigator.onLine);
      })
  }
  function updateViewData(view, newData) {
    // This function is intended to be wrapped in a try/catch above it.
    var obj = wData.info[view];

    if(view === 'radar') {
      obj.weather = newData;
    } else if(view === 'month') {
      /* Only setting these 2 params, the rest should match because of id check in refresh radar.*/
      obj.complete = newData.complete;
      obj.weather  = newData.weather;
    } else {    // current / hourly / tenday
      if(!Object.keys(newData).indexOf('error') !== -1){
        obj.weather     = newData[view];
        obj.lastUpdated = Date.now();
      } else {
        obj.message = newData.error;
      }
    }
    wData.updateFreshnessMsg(view);
  }
  function refreshView(view) {
    let expiredData     = wDates.isExpired(wData.info[view].lastUpdated, view),
        recentCheck     = wDates.recentCheck(wData.info[view].lastChecked, view),
        validTempRegex  = /^-?\d+/,
        spinnerId;

    wData.updateLastChecked(view);

    if(expiredData){
      console.log('expired data for ', view, 'recentCheck: ', recentCheck);
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

            wData.clearMessage(view);
            wDB._put(wData.info.id, wData.info);
          } // Could have done else > cache for later, but seemed super rare case and more code.
        } catch(e) {
          wLog.log('error', 'httpReq ' + view + ' success, but catch on updatingView');
        }

        wData.setSpinner(view, false, spinnerId);

      }, e => {
        wLog.log('warning', 'Did not get ' + view + ' data from server, online status: ', navigator.onLine);
        wData.setSpinner(view, false, spinnerId);
      })
    }
  }
  function refreshMonth() {

    // ADD EXPIRED STUFF HERE TO AVOID FLASHING SCREEN ???

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
          updateViewData('month', r.data);
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
    /**
     * This is a bit different then current/hourly/daily since there are multiple datasets per zip.
     * On each refreshRadar, check local first to see if the individual image is stored separate from
     * the main object and display if so, otherwise, request from server.
     */

    // NOTE that expired data essentially also checks that an image exists on startup. By default
    // it is set to old, so we start looking to local db, then server.

    let expiredData = wDates.isExpired(wData.info.radar.weather.lastUpdated, 'radar'),
        sameZoom    = wData.info.radar.zoomUserSel === wData.info.radar.weather.zoom;

    if (!sameZoom ) {
      wDB._get(wData.info.radar.idUserSel).then( r => {
        try {

          // WORKING HERE / TESTING. TRY TO FIGURE OUT HOW TO TEST IF URL IS STILL OK BEFORE CREATING A NEW URL.

          r.value.imgUrl            = URL.createObjectURL(r.value.img);
          wData.info.radar.weather  = r.value;
          wData.updateFreshnessMsg('radar');
        } catch (e) {
          console.log('No radar image in db, requesting from server.');
          requestRadar();
        }

        expiredData = wDates.isExpired(wData.info.radar.weather.lastUpdated, 'radar');
        (expiredData) ? requestRadar() : 0;
      })
    } else if (sameZoom && expiredData) {
      console.log('samezoom and expired, checking with server');
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
    
    let t = new Date();
    console.log('refreshing forecasts, VIEW: ', view, ', time: ', t.getHours() + ':' + t.getUTCMinutes() + ':' + t.getSeconds());

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
      
    } else {    // Month
    /* Same comment as radar. 3 ways to get here, on load-wDB, on date chg, or zipcode chg. */
      let month = wData.info.month;
      $timeout.cancel(month.timeout);

      if(!month.complete){
        month.retries = 5;
        refreshMonth(month);
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
