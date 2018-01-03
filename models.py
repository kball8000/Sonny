from google.appengine.ext import ndb
from datetime import datetime
import threading

# debugging
import logging
import time

def valid_data(data, view=None):
    is_valid    = False
    view        = view or data.info['view']
        
    if view == 'current':
        try: 
            float(data.info['current']['temp'])
            float(data.info['hourly'][0]['temp'])
            if 'error' not in data.info:
                is_valid = True
        except:
            pass
    elif view == 'tenday':
        try: 
            float(data.info['tenday'][0]['high'])
            if 'error' not in data.info:
                is_valid = True
        except:
            pass
    elif view == 'radar':
        try:
            is_valid = data.image[:3] == "GIF"
            if not radar.error:
                is_valid = True
        except:
            pass
    else:   # month
        is_valid = True
    
    return is_valid
def get_id(info):
    """ Recreating the id, even though this is done in javascript (JS), it is not always identical. 
        JS only has weather, python stores current and tenday independently. """

    _id = info['view'] + '-' + info['zip']

    if info['view'] == 'month':
        _id += '-' + str(info['year']) + str(info['month']).zfill(2)
    
    return _id

class LogObj(ndb.Model):
    """Dataset for current, hourly and tenday objects"""
    logs    = ndb.JsonProperty(compressed=True)
    _obj    = None
    
    # STILL A WORK IN PROGRESS.

    @classmethod
    def w_get(self, info):
        self._obj = self.get_by_id('logs', use_cache=False, use_memcache=False)

        if not self._obj:
            self._obj = self(id='logs')
        else:
            del self._obj.logs[:-500]

        return self._obj

    @classmethod
    def w_put(self, obj):
        return obj.put() if valid_data(obj) else None

class Forecast(ndb.Model):
    """Dataset for current, hourly and tenday objects"""
    info    = ndb.JsonProperty(compressed=True)
    date    = ndb.DateTimeProperty(auto_now=True)
        
    @classmethod
    def new_obj(self, info):
        return Forecast(info=info, id=get_id(info))
    
    @classmethod
    def get(self, info):
        return ndb.Key(self, get_id(info)).get()
    
    @classmethod
    def get_async(self, info):
        return ndb.Key(self, get_id(info)).get_async()

    @classmethod
    def w_put(self, obj):
        return obj.put() if valid_data(obj) else None
    
    @classmethod
    def w_put_async(self, obj):
        return obj.put_async() if valid_data(obj) else None
class Radar(ndb.Model):
    """Holds radar images. WU sends them for each zip / radius / screen size"""
    image   = ndb.BlobProperty()
    error   = ndb.StringProperty(indexed=False)
    date    = ndb.DateTimeProperty(auto_now=True)
    
    @classmethod
    def _get_async(self, _id):
        return ndb.Key(self, _id).get_async()
    
    @classmethod
    def new_obj(self, _id):
        return Radar(image='', error='', id=_id)
    
    @classmethod    
    def w_put(self, obj):
        return obj.put() if valid_data(obj, 'radar') else None

    @classmethod    
    def w_put_async(self, obj):
        return obj.put_async() if valid_data(obj, 'radar') else None

class APILock(ndb.Model):
    """This limits API use so I do not go over weather underground quota and with enough overages, eventually lose API key.  When retreiving lock from datastore assume we will get to use a date, so add a placeholder to the list. If main program decides it is unavailable, remove the placeholder date. Lock is used for data consistency, since main program is multithreaded."""
    dates       = ndb.DateTimeProperty(repeated=True, indexed=False)
    _api_lock   = threading.Lock()
    _lock       = None
        
    @classmethod
    def get(self, calls=1):        
        with self._api_lock:
            self._lock = self.get_by_id('apilock', use_cache=False, use_memcache=False)
            if not self._lock:
                self._lock = self(id='apilock')
            else:
                del self._lock.dates[:-500]

            logging.info('\n\nSTARTING, num dates: %s, calls: %s' %(len(self._lock.dates), calls))
            # log_dates(self._lock.dates)
            for x in xrange(calls):
                self._lock.dates.append(datetime.utcnow())
            logging.info('ENDING, num dates: %s' %len(self._lock.dates))

            self._lock.put()

        return self._lock.dates
    
    @classmethod
    def return_dates(self, dates):
        with self._api_lock:
            self._lock = self.get_by_id('apilock', use_cache=False, use_memcache=False)
            for date in dates:
                self._lock.dates.remove(date)
            # logging.info('removing number of dates: %s' %len(dates))
            # logging.info('after removing dates, length: %s' %len(self._lock.dates))
            self._lock.put()
        return True
