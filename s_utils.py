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
# def create_url(view, zipcode, options=None):
def create_url(data):
    view = data['view']
    zipcode = data['zip']
    if view == 'current':
        p=['conditions', 'forecast', 'alerts', 'astronomy', 'almanac', 'hourly']
        api_calls = '/'.join(p)
    elif view == 'tenday':
        api_calls = 'forecast10day'
    elif view == 'radar':
        api_call = ''
        k = {      
            # 'height':       options['height'],
            # 'width':        options['width'],
            # 'radius':       options['radius'],
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
        api_calls = api_call.join(['&%s=%s' %(key, k[key]) for key in k.keys()])
        api_calls = api_calls[1:]
    else:   # month
        # year    = str(options[0])
        # _mon    = str(options[1]).zfill(2)
        # day     = str(options[2]).zfill(2)
        year    = str(data['date'][0])
        _mon    = str(data['date'][1]).zfill(2)
        day     = str(data['date'][2]).zfill(2)
        api_calls = 'history_' + year + _mon + day

    base = 'https://api.wunderground.com/api/' + keys.key + '/'
    url = {
        'current': base + api_calls + '/q/' + zipcode + '.json',
        'tenday' : base + api_calls + '/q/' + zipcode + '.json',
        'month'  : base + api_calls + '/q/' + zipcode + '.json',
        'radar'  : base + 'animatedradar/q/' + zipcode + '.gif?' + api_calls
    }
    return url[view]