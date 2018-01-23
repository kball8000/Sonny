# wu  = Weather Underground
# ds  = Datastore, Google App Engine
# -view = view on app, i.e. current or hourly forcast.
# -Current / tenday / hourly are sort of grouped together as they are more now / 
# future oriented and changing regularly.
# -Radar is by itself as it returns a gif instead of json among other differences
# -Month is in own category, as it is historical
# -Moved month to separate module so it can be used here and by worker to allow
# user to request server to get entire month and/or year in the background

from google.appengine.api import urlfetch
from google.appengine.api import taskqueue
from datetime import datetime, timedelta
import json
import webapp2

# CUSTOM MODULES
import keys
import models   # ndb.Model from app engine datastore
import s_utils
import s_month

# DEBUGGING
import time
import logging


# Classes for server objects and their methods    
def fresh_weather(obj):
    """ Determines if stored data is reasonably current, datastore acts like a cache and this saves on API calls to WU."""

    time_limit = {
        'current':  timedelta(minutes=15),
        'radar':    timedelta(minutes=20),
        'tenday':   timedelta(hours=6)
    }
    delta_ds = datetime.utcnow() - obj.date
    if obj.key.kind() == 'Radar':
        fresh = delta_ds < time_limit['radar']
    else:
        fresh = delta_ds < time_limit[obj.info['view']]
    return fresh
  
def get_weather_underground_data(url, _json=True):
    def error_obj():
        return {
            'response':{
                'error':{
                    'description': 'urllib2.URLError'
                } 
            }
        }
    try:
        logging.info('get from wu: %s' %(url[:5] + '...' + url[50:]))
        response = urlfetch.fetch(url)

        if response.status_code != 200:
            result = error_obj()
        elif _json:
            result = json.loads(response.content)
        else:
            logging.info('completed from wu: %s' %url)
            result = response.content
    except:
        result = error_obj()
    return result

def conv_py_date(d, _typ):
    """ Converts a python date object to a list or string. """
    _d = [d.year, d.month, d.day, d.hour, d.minute, d.second]
    if _typ == 'str':
        _str    = ''
        li      = [str(d).zfill(2) for d in _d]
        _d      = _str.join(li)
    return _d
def trim_month(d):
    """ Shortens month in date string to 3 character. """
    # sample date string: Last Updated on June 27, 5:27 PM PDT
    li = d.split(' ')
    li[3] = li[3][:3]
    li[0] = li[0].lower()   # lowercase the word 'Last'
    return ' '.join(li)

def process_current(raw):
    """This includes both current conditions and hourly forecast"""

    d = {}  # current weather
    h = []  # hourly weather

    c = raw['current_observation']  # Just a line shortner
    d['conditions'] = c['weather']
    d['temp']       = str(c['temp_f'])
    d['feels']      = c['feelslike_f']
    d['wind']       = str(c['wind_mph']) 
    d['winddir']    = c['wind_dir']
    d['icon_url']   = c['icon_url'].replace('http://', 'https://')
    d['observation_time']   = trim_month(c['observation_time'])

    f = raw['forecast']['simpleforecast']['forecastday']
    d['high']           = f[0]['high']['fahrenheit']
    d['low']            = f[0]['low']['fahrenheit']
    d['precipchance']   = str(f[0]['pop'])
    
    fcttxt = raw['forecast']['txt_forecast']['forecastday']
    d['forecastTitle0'] = fcttxt[0]['title']
    d['forecastText0'] = fcttxt[0]['fcttext']
    d['forecastTitle1'] = fcttxt[1]['title']
    d['forecastText1'] = fcttxt[1]['fcttext']

    a = raw['alerts']
    d['alerts'] = []
    for i, v in enumerate(a):
        d['alerts'].append({})
        d['alerts'][i]['description']   = v['description']
        d['alerts'][i]['date']          = v['date']
        d['alerts'][i]['expires']       = v['expires']
        d['alerts'][i]['message']       = v['message']

    ast = raw['sun_phase']
    d['sunriseHour']    = ast['sunrise']['hour']
    d['sunriseMin']     = ast['sunrise']['minute']
    hr = ast['sunset']['hour']
    d['sunsetHour']     = str(int(hr)-12)
    d['sunsetMin']      = ast['sunset']['minute']
    
    al = raw['almanac']
    d['high_avg']           = al['temp_high']['normal']['F']
    d['high_record']        = al['temp_high']['record']['F']
    d['high_recordyear']    = al['temp_high']['recordyear']
    d['low_avg']            = al['temp_low']['normal']['F']
    d['low_record']         = al['temp_low']['record']['F']
    d['low_recordyear']     = al['temp_low']['recordyear']
    
    hourly = raw['hourly_forecast']
    for t in hourly:
        _h = {}
        hr = int(t['FCTTIME']['hour'])
        if hr == 0:
            hr = 12
        elif hr > 12:
            hr = hr -12
        _h['hour']          = str(hr) + ' ' + t['FCTTIME']['ampm']
        _h['temp']          = t['temp']['english']
        _h['feels']         = t['feelslike']['english']
        _h['precipchance']  = t['pop']
        _h['condition']     = t['condition']
        _h['icon_url']      = t['icon_url'].replace('http://', 'https://')
        _h['wind']          = str(t['wspd']['english']) + ' ' + t['wdir']['dir']
        h.append(_h)
    return {'current': d, 'hourly': h}
def process_tenday(raw):
    
    tenday = []
    
    forecast = raw['forecast']['simpleforecast']['forecastday']
    for w in forecast:
        d = {}
        d['high']   = w['high']['fahrenheit']
        d['low']    = w['low']['fahrenheit']
        d['precipchance'] = w['pop']
        d['conditions'] = w['conditions']
        d['icon_url']   = w['icon_url'].replace('http://', 'https://')
        d['day']    = w['date']['weekday_short']
        d['date']   = w['date']['monthname_short'] + ' ' + str(w['date']['day'])
        d['wind']   = str(w['avewind']['mph'])
        d['winddir']    = w['avewind']['dir']
        tenday.append(d)
        
    detail = raw['forecast']['txt_forecast']['forecastday']
    for i, _d in enumerate(tenday):
        _d['detail_am'] = detail[2*i]['fcttext']
        _d['detail_pm'] = detail[2*i+1]['fcttext']

    return {'tenday': tenday}

def update_forecast(obj, url):
    """For current, hourly, tenday and radar 
    Input: Data is datastore object. 
    Handles API lock as well as getting updated data from weather underground.
    Output: data.weather which is Javascript object."""
    
    view    = obj.info['view']
    _zip    = obj.info['zip']
    func    = {
        'current'   : process_current,
        'tenday'    : process_tenday
    }

    raw = get_weather_underground_data(url)

    # Consider moving this up to thd if else, they are not that commmon with each other.
    if 'error' not in raw['response']:
        result = func[view](raw)
        for key in result.keys():
            obj.info['lastUpdated'] = conv_py_date(datetime.utcnow(), 'li')
            obj.info[key] = result[key]
    else:
        try:
            obj.info['error'] = raw['response']['error']['description']
        except:
            obj.info['error'] = 'unknown error getting data from wu'

    return obj

def update_radar(radar, info, url):
    radar.error = ''
    try:
        radar.image = get_weather_underground_data(url, False)
    except:
        radar.error = 'wu retrieval error'

    return radar
def send_radar(self, success, radar=None):
    """Return radar to webpage, success = successfully got an image from weather underground"""
     
    if success:
        date = radar.date or datetime.utcnow() # new radar will not have date
        
        self.response.headers['Content-Type']   = 'image/gif'
        self.response.headers['X-Wdate']        = conv_py_date(date, 'str')
        self.response.headers['X-Wid']          = str(radar.key.id())
        self.response.headers['X-Werror']       = str(radar.error)
        self.response.write(radar.image)
    else:
        self.response.headers['X-Werror']       = 'no api keys available'
        self.response.write('')
        
# webapp2 classes for handling get and post requests
class Basic(webapp2.RequestHandler):
    def get(self):
        page = open('index.html')

        self.response.write(page.read())
class GetWeather(webapp2.RequestHandler):
    def post(self):

        info        = json.loads(self.request.body)     # weather obj from page
        forecast_p  = models.Forecast.get_async(info)
        url         = models.APILock.get(info)         # url for Weather Underground.

        if url:
            forecast = forecast_p.get_result()
            if not forecast:
                forecast    = models.Forecast.new_obj(info)
                forecast    = update_forecast(forecast, url)
                models.Forecast.w_put(forecast)
            elif not fresh_weather(forecast):
                forecast    = update_forecast(forecast, url)
                models.Forecast.w_put(forecast)
            else:
                pass
            _response = forecast.info
        else:
            _response = {'error': 'no api keys available'}
        
        self.response.headers['Content-Type'] = 'text/javascript'
        self.response.write(json.dumps(_response))
class GetRadar(webapp2.RequestHandler):
    def post(self):
        # since fetching the radar often takes longer then default 5s.
        urlfetch.set_default_fetch_deadline(15)

        info    = json.loads(self.request.body)        
        radar_p = models.Radar._get_async(info['id'])
        url     = models.APILock.get(info)     # url for Weather Underground

        if url:
            radar = radar_p.get_result()
        
            if not radar:
                radar   = models.Radar.new_obj(info['id'])
                radar   = update_radar(radar, info, url)
                # update_radar(radar, info, url)    # consider replacing line above with this.

                models.Radar.w_put(radar)
            elif not fresh_weather(radar) or radar.error:
                radar   = update_radar(radar, info, url)
                # update_radar(radar, info, url)    # consider replacing line above with this.
                models.Radar.w_put(radar)
            else:
                pass
            send_radar(self, True, radar)

        else:
            send_radar(self, False)
class GetMonth(webapp2.RequestHandler):
    """ Gets historical month data, highs/lows/rainfall... which will save to the datastore indefinitely. """ 
    def post(self):

        info        = json.loads(self.request.body)     # weather obj from page
        logging.info('%s' %info)
        month                   = s_month.get_month(info)
        response                = month.info
        if 'cal' in response and 'updated' in response:
            del response['cal']
            del response['updated']

        self.response.headers['Content-Type'] = 'text/javascript'
        self.response.write(json.dumps(response))
class AddToQueue(webapp2.RequestHandler):
    def post(self):
        for x in xrange(10):
            task = taskqueue.add(
                method = 'POST',
                url = '/apushqueue',
                target = 'worker',
                payload = self.request.body
            )
        
        self.response.headers['Content-Type'] = 'text/javascript'
        self.response.write(json.dumps({'task': 'succeeded adding task'}))
class GetMonthObj(webapp2.RequestHandler):
    def post(self):
        logging.info('Getting Month Obj...')
        obj = models.Forecast.get({
            'zip':      '61601',
            'view':     'month',
            'year':     2017,
            'month':    12
        })
        
        self.response.headers['Content-Type'] = 'text/javascript'
        if obj:
            self.response.write(json.dumps(obj.info))
        else:
            self.response.write(json.dumps({'msg':'nothing retrieved from datastore'}))

# NOTE when testing functions. Get requests get intercepted by web app, so they only run once.
# Easiest fix is to run Post requests.
class GetDates(webapp2.RequestHandler):     # TESTING
    def post(self):

        dates       = models.APILock.get_dates()
        attr        = ['year', 'month', 'day', 'hour', 'minute', 'second']
        response    = []

        # create array of string type dates in yyyy-mm-dd-hh-mm-ss format.
        for d in dates:
            t1  = [getattr(d, att) for att in attr]
            t2  = [str(x).zfill(2) for x in t1]
            v   = '-'.join(t2)
            response.append(v)

        if dates:
            self.response.write(json.dumps(response))
        else:
            self.response.write(json.dumps({'msg':'nothing retrieved from datastore'}))


app = webapp2.WSGIApplication([
    ('/', Basic),
    # The next 5 are just so refreshing individual pages works.
    ('/current', Basic),
    ('/hourly', Basic),
    ('/month', Basic),
    ('/tenday', Basic),
    ('/radar', Basic),    
    ('/getweather', GetWeather),
    ('/getradar', GetRadar),
    
    # TESTING
    ('/addtoqueue', AddToQueue),
    ('/getmonthobj', GetMonthObj),
    ('/getdates', GetDates),
    # ('/modifycal', ModifyCal),
    
    # At end of list so I do not need to worry about EOL comma
    ('/getmonth', GetMonth)
], debug=False)