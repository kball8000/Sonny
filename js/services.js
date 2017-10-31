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
    ];
    return new Date(...d).valueOf();
  }
  this.freshWarning = function(timestamp, view) {
    if(this.isExpired(timestamp, view)){
      return 'Last updated: ' + $filter('date')(timestamp, 'medium');
    }
    return '';    
  }
})
.service('wData', function($location, $timeout, wDates) {
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
  data.setHome = {flag: false, city: {}};
  data.createForecastObj  = function(dict) {
    return {
      weather:      (dict) ? {} : [],
      lastUpdated:  0,     // Store timestamps as seconds since epoch, i.e. 1970.
      lastChecked:  0,
      message:      '',
      spinner:     false
    };
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
  data.createRadarObj     = function(zip, zoom) {
    zoom = zoom || 200;

    return {
      // idUserSel ??? instead of id...
      id:           data.createRadarId(zip, zoom),
      lastChecked:  0,
      lastUpdated:  0,    // Store timestamps as seconds since epoch, i.e. 1970.
      spinner:      false,
      spinnerId:    0,
      weather:      {},   // id, img, imgUrl, zoom
      zoomUserSel:  zoom  //
    };
    
  }
  data.createMonthId      = function(zip, yr, mon) {
    // convert to  wu/python month format for id.
    mon += 1;   
    mon = (mon > 9) ? mon.toString() : '0' + mon.toString();
    yr  = yr.toString();
      
    return 'month-' + zip + '-' + yr + mon;
  }
  data.createRadarId      = function(zip, zoom) {
    var height  = screen.height,
        width   = screen.width,
        radius  = zoom.toString();
    return ['radar', zip, height, width, radius].join('-');
  };
  data.updateRadarId      = function() {
    data.info.radar.id = data.createRadarId(data.info.zip, data.info.radar.zoom);
  }
  data.setRequestView     = function() {
    data.info.view = $location.path().substring(1);
    return data.info.view;
  }
  data.setZoom            = function(z) {
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
    // TESTING
    // NEEDS WORK, THIS IS UBER HACK AND I DON'T LIKE IT.
    radar.lastUpdated = 0;    // Forces app to look for new image.
  }
  data.updateFreshnessMsg = function(_view) {
    /**
     * Will update an individual view if requested, otherwise all views.
     */
    let views = _view ? [_view] : ['current', 'hourly', 'tenday', 'radar'];

    _view === 'current' ? views.push('hourly') : 0;

    for(let view of views) {
      let obj     = data.info[view];
      obj.message = wDates.freshWarning(obj.lastUpdated, view);
    }
  }
  data.setSpinner         = function(view, status, id) {
    /**
     * The concept of the spinner is to only run if has been a while since last requesting data from
     * the server. So, I create a 'last request' id when turning on spinner, then turn it off after the
     * timeout if the timeout sends the correct id. This allows city change to still get a spinner if it
     * has been a long time sine request.
     */
    let newSpinnerId;

    function chgSpinner() {
      data.info[view].spinner = status;
      if (view === 'current') {
        data.info.hourly.spinner = status;
      }
    }

    console.log('setting spinner for', view, ', status: ', status, ', id: ', id, 'dataId: ', data.info[view].spinnerId);

    if (status) {
      chgSpinner();
      newSpinnerId              = Math.ceil(Math.random()*1000,0);
      console.log('setting spinner for ', view, ', got a newID: ', newSpinnerId);
      data.info[view].spinnerId = newSpinnerId;
      $timeout(data.setSpinner, 2000, true, view, false, newSpinnerId);
    } else if (id === data.info[view].spinnerId) {
      chgSpinner();
      data.info[view].id  = 0;  // setting to a value the id could never be because of Math.ceil.
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
  this.savedCities = []
  this.initializeCities = function() {
    this.savedCities = [
      {zip: '61601', text: 'Peoria, Illinois'},
      {zip: '45201', text: 'Cincinnati, Ohio'},
      {zip: '37501', text: 'Memphis, Tennessee'}
    ];
    wDB._put('savedCities', this.savedCities);
  }
  this.setHomeFlag = function(city){
    wData.setHome.flag = true;
    wData.setHome.city = city;
  }
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
  this.citySearch = function(query) {
    return query ? wuAutocompleteRequest(query) : this.savedCities;
  }
  this.addCity = function(newCity){
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

    if (idx > 1 || idx === -1) {
      wDB._put('savedCities', this.savedCities);
    }
  }
})
.service('weather', function($http, $timeout, wData, wDates, wDB, wLog, autocomp){
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

    /** 
     * DO A SPLIT BY DASH, THEN ARR[1] WILL BE ZIP AND ARR[4] WILL BE ZOOM.
     * NO NEED TO PASS IN ZIP, GET IT HERE.
     */

    var str   = r.headers('X-Wid'),
        idx   = str.lastIndexOf('-'),
        zoom  = str.substr(idx+1);
    var obj = wData.createRadarObj(zip, zoom);
    obj.weather.img = r.data;
    
    return obj;
  } 
  function requestRadar(radar) {
    
    let expiredData = wDates.isExpired(wData.info.radar.lastUpdated, 'radar'),
        recentCheck = wDates.recentCheck(wData.info.radar.lastChecked, 'radar');

    wData.info.radar.lastChecked = Date.now();
        
    if(expiredData){

      wData.info.radar.spinner = !recentCheck;

      httpReq('radar').then(r => {
        try {

          // WORKING HERE. IDEA: CREATE A RADAR OBJ, PUT 1 IN DB, 1 IN WDATA.INFO.RADAR.WEATHER.
          // THAT GETS RID OF THIS R.HEADER(X-Wid) UGLINESS, IT'LL BE OBJ.ID LIKE EVERYWHERE ELSE.
          // MAY JUST NEED TO DUPLICATE LAST UPDATED TO WDATA.INFO.RADAR.LASTUPDATED...

          if(!r.headers('X-Werror')){
            let _id = r.headers('X-Wid');
            if(_id === wData.info.radar.id){
              updateView('radar', r);
              wDB._put(wData.info.id, wData.info);
              wDB._put(wData.info.radar.id, wData.info.radar);
            } else {
              /**
               * SEEMS LIKE LET ZIP SHOULD BE A PART OF THE NEW CREATE OBJ IN THE BEGINNING.
               * STORING TOO MUCH IN THE INDIVIDUAL RADAR CACHE, JUST THE 'WEATHER' PORTION OF THE OBJ.
               * ONLY ID, IMGURL, IMG, ZIP, ZOOM.
               * WILL NEED TO FIX ANYWHERE I PULL IT OUT OF WDB TO HANDLE IT CORRECTLY.
               * MOVE LAST UPDATED TO 'WEATHER OBJ'.
               */ 

              let zip       = _id.substr(6,5),    
                  radarObj  = createTempRadarObj(r, zip);
              wDB._put(_id, radarObj);
            } 
          } else {
            wData.info.radar.message = r.headers('X-Werror');
          }
        } catch(e) {
          wData.info.radar.message = 'error processing successful server radar image from wu';
        }
        wData.info.radar.spinner = false;
      }, e => {
        wData.info.radar.progress = false;
        wData.info.radar.message  = 'Error getting Radar image from server!';
        wLog.log('warning', 'Did not get radar image from server, online status: ', navigator.onLine);
      })
    }
  }
  function updateView(view, newData) {
    // This function is intended to be wrapped in a try/catch above it.
    var obj = wData.info[view];

    if(view === 'radar') {
      obj.weather.img     = newData.data;
      obj.weather.imgUrl  = URL.createObjectURL(obj.weather.img);

      // WORKING HERE, ADD OBJ.WEATHER.LASTUPDATED???

      obj.lastUpdated     = wDates.convStr(newData.headers('X-Wdate'));
      
    } else if(view === 'month') {
      /* Only setting these 2 params, the rest should match because of id check in refresh radar.*/
      obj.complete = newData.complete;
      obj.weather  = newData.weather;
    } else {    // current / hourly / tenday
      if(!Object.keys(newData).indexOf('error') !== -1){
        obj.weather     = newData[view];
        obj.lastUpdated = Date.now();
      } else if(dataError) {
        obj.message = newData.error;
      }      
    }    
  }
  function refreshCurrent() {
    let expiredData = wDates.isExpired(wData.info.current.lastUpdated, 'current'),
        recentCheck = wDates.recentCheck(wData.info.current.lastChecked, 'current'),
        spinnerId;
        
    function clearMessages() {
      // Need to keep this in case spinner does not go.
      wData.info.current.message  = '';
      wData.info.hourly.message   = '';
    }

    wData.info.current.lastChecked = Date.now();

    if(expiredData){

      // Stops spinner from going all the time on a bad network connection / slow device.      
      if (!recentCheck) {
        spinnerId = wData.setSpinner('current', true);
      }

      httpReq('current').then(r => { 
        try {
          let validTemp = /^-?\d+/;

          if(wData.info.zip === r.data.zip) {

            validTemp.test(r.data.current.temp)   ? updateView('current', r.data) : 0;
            validTemp.test(r.data.hourly[0].temp) ? updateView('hourly', r.data)  : 0;

            console.log('do I need to clear current message, should be taken care of with spinner');
            clearMessages();
            wDB._put(wData.info.id, wData.info);
          } // Could have done else > cache for later, but seemed super rare case and more code.
        } catch(e) {
          wLog.log('error', 'httpReq cur/hr success, but catch on updatingView');
        }

        wData.setSpinner('current', false, spinnerId);
        // setSpinners(false);

      }, e => {
        wLog.log('warning', 'Did not get cur/hr data from server, online status: ', navigator.onLine);
        console.log('do I need to set current spinner to false?');
        wData.setSpinner('current', false, spinnerId);
        // wData.setSpinner('current', false);
      })
    }
  }
  function refreshTenday() {
    /**
     * Update with server data and display a message if no server data and data is getting stale.
     */

    let expiredData = wDates.isExpired(wData.info.tenday.lastUpdated, 'tenday'),
        recentCheck = wDates.recentCheck(wData.info.tenday.lastChecked, 'tenday'),
        spinnerId;

    wData.info.tenday.lastChecked = Date.now();

    if(expiredData){

      // Set the auto-stopping spinner if it has been a shile since last request.
      if (!recentCheck) {
        spinnerId = wData.setSpinner('tenday', true);
      }

      httpReq('tenday').then(r => {
        try{
          let validTemp   = /^-?\d+/;
          if(wData.info.zip === r.data.zip && validTemp.test(r.data.tenday[0].high)) {
            updateView('tenday', r.data);
            wData.info.tenday.message   = '';
            wDB._put(wData.info.id, wData.info);
          }
        } catch(e) {
          wLog.log('error', 'httpReq cur/hr success, but catch on updatingView');
        }
        wData.setSpinner('tenday', false, spinnerId);
      }, e => {
        wLog.log('warning', 'Did not get tenday data from server, online status: ', navigator.onLine);
        console.log('do I need to set tenday spinner to false?');
        wData.setSpinner('tenday', false, spinnerId);
        // wData.info.tenday.spinner = false;
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
    /**
     * This is a bit different then current/hourly/daily since there are multiple datasets per zip.
     * On each refreshRadar, check local first to see if the individual image is stored separate from
     * the main object and display if so, otherwise, request from server.
     */

    // This is flakey on startup, but seems ok afterwards.
    wDB._get(wData.info.radar.id).then(r => {
      try {
        // super slight bug, if zip changed since image was request from wDB, we have wrong image
        r.value.weather.imgUrl = URL.createObjectURL(r.value.weather.img);
        wData.info.radar       = r.value;
        wData.updateFreshnessMsg('radar');
      } catch(e) {
        angular.noop();
        // requestRadar(radar);
      }
      requestRadar(radar);
    })
  }
  this.refreshForecasts = function() {
    /**
     * The goal here is to refresh as much as possible with the current page taking priority. 
     * Expensive calls like radar (filesize / not used as often as other features) and month 
     * (uses lots of limited wu api calls on server) are more on demand. 
     */ 

    let view  = wData.setRequestView();
        
    if(view === 'tenday'){
      refreshTenday();    // generally faster than current, so no timeout reqd.
      refreshCurrent();
      
    } else if(view === 'current' || view === 'hourly'){
      refreshCurrent();
      $timeout(refreshTenday, 300);
      
    } else if(view === 'radar'){
      // Radar has extra DB check, added timeout so radar will still be first 
      // request to wu and first dibs if api calls available is low.
      refreshRadar();
      $timeout(refreshCurrent, 1000);
      $timeout(refreshTenday, 1000);
      
    } else {    // Month
    /* Same comment as radar. 3 ways to get here, on load-wDB, on date chg, or zipcode chg. */
      let month = wData.info.month;
      $timeout.cancel(month.timeout);

      if(!month.complete){
        month.retries = 5;
        refreshMonth(month);
      }      
      $timeout(refreshCurrent, 1000);
      $timeout(refreshTenday, 1000);
    }

    if (wData.setHome.flag) {
      autocomp.setHomeCity();
    }

    wDB.cleanupCache();
  }
});
