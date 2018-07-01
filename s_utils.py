from datetime import datetime, timedelta
import keys
import logging

def max_calls(_typ):
    """ For notes, see method: api_calls_avail."""
    obj = {
        'minute':   10,
        'daily':    500
    }
    return obj[_typ]
def api_calls_avail(dates):
    """ With a free Weather Underground (wu) account you only get so many API calls. If exceeded too 
    many times, account could be suspended. This throttles the app to avoid exceeding limits."""
    def get_avail(_dates, avail, time_delta):
        """ Takes the actual dates used previously, not the temporary dates I resevered and returns number
        dates available."""
        for date_time in reversed(_dates):
            if (now - date_time) < time_delta:
                avail -= 1
            else:
                break
        return max(avail, 0)

    max_per_minute  = max_calls('minute')
    max_per_day     = max_calls('daily')
    now             = datetime.utcnow()
    len_dates       = len(dates)
    _range          = min(max_per_minute, len_dates)
    
    # check against minute limit of wu API usage
    avail = get_avail(dates[-_range:], max_per_minute, timedelta(minutes=1))

    # Check if daily limit restricts available API calls
    unused = max_per_day - len_dates
    if len_dates > (max_per_day - max_per_minute) and unused < avail:
        _range    = avail - unused
        avail_day = get_avail(dates[:_range], _range, timedelta(days=1))
        avail     = avail_day + unused
        
    return avail
def day_api_calls_avail(dates):
    """ Checking that there are at least 'reserved' calls left for month. Leave some for 
    now/tenday use. Also, start further into array if not full. """
    
    avail       = True
    reserved    = 40
    start_point = len(dates) - max_calls('daily') + reserved
    
    if start_point > -1:
        yesterday = datetime.utcnow() - timedelta(days=1)
        if dates[start_point] > yesterday:
            logging.info('Now into the 40 reserved API calls left for day')
            avail = False
            
    return avail
def create_url(data):
    view        = data['view']
    location    = data['request']['val']

    if view == 'current' or view == 'hourly':
        features    = ['conditions', 'forecast', 'alerts', 'astronomy', 'almanac', 'hourly', 'geolookup']
        api_calls   = '/'.join(features)
    elif view == 'tenday':
        features    = ['forecast10day', 'geolookup']
        api_calls   = '/'.join(features)
    elif view == 'radar':
        k = {      
            'height':       data['height'],
            'width':        data['width'],
            'radius':       data['radius'],
            'newmaps':      '1',
            'timelabel':    '1',
            'timelabel.x':  '20',
            'timelabel.y' : '20',
            'num' :         '5',
            'delay':        '50'
        }
        api_calls = ''.join(['&%s=%s' %(key, k[key]) for key in k])
        # api_calls = ''.join(['&%s=%s' %(key, k[key]) for key in k.keys()])
        api_calls = api_calls[1:]   # Remove initial ampersand sign.
    else:   # month
        year    = str(data['date'][0])
        _mon    = str(data['date'][1]).zfill(2)
        day     = str(data['date'][2]).zfill(2)
        api_calls = 'history_' + year + _mon + day

    base = 'https://api.wunderground.com/api/' + keys.key + '/'
    if view == 'radar':
        url = base + 'animatedradar/q/' + location + '.gif?' + api_calls
    else:
        url = base + api_calls + '/q/'  + location + '.json'

    return url