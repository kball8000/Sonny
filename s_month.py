from google.appengine.api import urlfetch
from datetime import datetime, timedelta
import calendar
import functools
import json

# custom modules
import models
import s_utils

# debugging
#import time
import logging

LOG_OBJ = {}
W_OBJ   = {}    # shared data

def process_day(day, data):
    day['high']                 = data['maxtempi']
    day['low']                  = data['mintempi']

    # WU will report 'trace' for precip and rain, setting to 0, so it doesn't break summing.
    p = data['precipi']
    day['precip']               = p if p != 'T' else '0'
    s = data['snowfalli']
    day['snowfall']             = s if s != 'T' else '0'
    day['snow_depth']           = data['snowdepthi']
    day['rain']                 = data['rain']
    day['snow']                 = data['snow']

    day['mean_temp']            = data['meantempi']
    day['humidity']             = data['humidity']
    day['mean_wind_dir']        = data['meanwdird']
    day['mean_wind_speed']      = data['meanwindspdi']

    day['heatingdegreedays']    = data['heatingdegreedays']
    day['coolingdegreedays']    = data['coolingdegreedays']

    day['html']                 = ''
    day['updated']              = True
    
    # Only mark complete if not close to today. WU will report before day is over
    # and may not get actual high or total precip/snow.
    now = datetime.utcnow()
    d   = day['date']
    req = datetime(d[0], d[1], d[2])
    
    
    day['complete'] = now - req > timedelta(days=2)
    # if now - req > timedelta(days=2):
    #     day['complete'] = True
    # else:
    #     day['complete'] = False
    #     day['last_updated'] = 0
    
    return day
def create_month(info): 
    m           = calendar.Calendar(6)
    cal, week   = [], []
    yr, _mon    = info['year'], info['month']
    first_week  = True
            
    for i, d in enumerate(m.itermonthdates(yr, _mon)):
        obj = {'date':      [d.year, d.month, d.day],
               'complete':  False,
               'updated':   False
              }

        if not i%7:
            if not first_week:
                cal.append(week)
            else:
                first_week = False
            week = [obj]
        else:
            week.append(obj)
    cal.append(week)
    
    info['cal']     = cal
    info['weather'] = {
        'totalrainfall':        0.0,
        'totalsnowfall':        0.0,
        'mean_temp':            0.0,
        'coolingdegreedays':    0,
        'heatingdegreedays':    0
    }


    return models.Forecast.new_obj(info)
def get_urls_to_update(month): 
    """ There are 2 reasons to return dates, api usage restriction from weather underground, 
    i.e. 4 of 10 call/min have been used by current / tenday / other month request or less 
    days in month need to be populated then are available, i.e. 27 of 30 days were previously 
    populated with data from wu."""
    calls_reserved      = 9         # TESTING FOR SUPER LONG LOCAL DELAY.
    # calls_reserved      = 2       # COMMENTING THIS LINE IS TESTING.
    calls_requesting    = s_utils.max_calls('minute') - calls_reserved
    
    dates               = models.APILock.get(calls_requesting)
    temp_dates          = [dates.pop() for x in xrange(calls_requesting)]
    
    _zip                = month.info['zip']
    cal                 = month.info['cal']
    urls                = []

    # Now check how many calls are actually available and return the rest.
    # Also checking against daily quota and leaving ~40 for forecast calls.
    avail               = s_utils.api_calls_avail(dates) - calls_reserved
    day_avail           = s_utils.day_api_calls_avail(dates)
    avail               = max(avail, 0) if day_avail else 0
    num_to_return       = len(temp_dates) - avail
    
    logging.info('month, avail: %s' %avail)

    now = datetime.utcnow()
    for week in cal:
        for day in week:
            d       = day['date']
            req     = datetime(d[0], d[1], d[2])
            history = req < now
            if avail and not day['complete'] and history:
                urls.append(s_utils.create_url('month', _zip, day['date']))
                avail -= 1
            elif not avail or not history:
                break
            else:
                pass
    num_to_return += avail - len(urls)

    if num_to_return:
        return_dates = [temp_dates.pop() for x in xrange(num_to_return)]
        models.APILock.return_dates(return_dates)
        
    return urls
def update_month(month, urls):
    rpcs, results   = [], []
    cal             = month.info['cal']

    def handle_rpc(rpc):
        r = rpc.get_result()
        try:
            logging.info('Handling RPC in cb: r {}'.format(r))
            results.append(json.loads(r.content))
        except:
            logging.info('failed to load history on date, %s' %r)

    for url in urls:
        logging.info('Req2Wu url: %s' %url)
        rpc = urlfetch.create_rpc()
        rpc.callback = functools.partial(handle_rpc, rpc)
        urlfetch.make_fetch_call(rpc, url)
        rpcs.append(rpc)

    if len(urls):                                           # TESTING
        logging.info('Requests sent, now we wait...')       # TESTING

    for rpc in rpcs:
        rpc.wait()
    
    logging.info('Requests from WU COMPLETE\n\n')

    for week in cal:
        for day in week:
            for result in results:
                try:
                    d = result['history']['date']
                    date = [int(d['year']), int(d['mon']), int(d['mday'])]
                except:
                    logging.info('Failed to update day with data from WU.')
                    date = None
                if date == day['date']:
                    logging.info('Going to load history on date for date: %s' %date)
                    try:
                        r = result['history']['dailysummary'][0]
                        day = process_day(day, r)
                        results.remove(result)
                        # logging.info('hi about to update month:')
                        # logging.info('updated: %s' %month['updated'])
                        month.info['updated'] = True
                    except:
                        logging.info('could not get weather')
            if not len(results):
                break
    
    return month
def create_month_id(_zip, yr, mon):
    return 'month-' + _zip + '-' + str(yr) + str(mon).zfill(2)
def update_end_month(month, end):
    """ End month being one of the non-current months at the beginning and end of a calendar page. 
    new_info should mostly imitate data sent in http request form webpage. """

    _zip    = month.info['zip']
    yr      = month.info['year']
    mon     = month.info['month']
    
    if end:
        if mon == 12:
            mon = 1
            yr  += 1
        else:
            mon += 1
    else:
        if mon == 1:
            mon = 12
            yr  -= 1
        else:
            mon -= 1

    new_info = {
        'view':     'month',
        'zip':      _zip,
        'year':     yr,
        'month':    mon,
        'id':       create_month_id(_zip, yr, mon),
        'complete': False
    }

    obj = models.Forecast.get(new_info)
    if not obj:
        obj = create_month(new_info)

    current_cal     = month.info['cal']
    non_current_cal = obj.info['cal']
    if end:
        last_row        = len(current_cal) - 1
        current_row     = current_cal[last_row]
        non_current_row = non_current_cal[0]
    else:
        last_row        = len(non_current_cal) - 1
        current_row     = current_cal[0]
        non_current_row = non_current_cal[last_row]
        
    # Insure there really is a tail month, i.e. Sun of first week could be 1st.
    if current_row[0]['date'] == non_current_row[0]['date']:
        for i, d in enumerate(current_row):
            non_current_row[i]  = d.copy()
    
    return obj
def save_month(_month):
    # month_complete, month_updated = True, False
    # Assume these next 2 statements and verify in next steps.
    _month.info['complete'] = True
    # _month.info['updated']  = False
    cal = _month.info['cal']

    # Determine if month is updated and/or complete.
    for week in cal:
        for day in week:
            # if day['updated'] and not _month.info['updated']:
            #     _month.info['updated']  = True
            if not day['complete'] and _month.info['complete']:
                _month.info['complete'] = False
            day['updated'] = False
    
    # TODO CHANGE THIS SO THAT IT WORKS EVEN WHEN NOT MONTH COMPLETE
    # if _month.info['complete']:
    w               = _month.info['weather']
    current_month   = int(_month.info['id'][-2:])
    num_days        = 0.0

    # logging.info('wmeantemp: %s, type: %s' %(w['mean_temp'], type(w['mean_temp'])))
    # w['mean_temp'] = float(w['mean_temp'])
    # Not 100% sure why, but seem to need to reset these to 0.
    w['mean_temp'] = 0.0
    w['totalrainfall']  = 0.0
    w['totalsnowfall']  = 0.0
    w['coolingdegreedays'] = 0
    w['heatingdegreedays'] = 0

    for week in cal:
        for day in week:
            if current_month == day['date'][1] and day['complete']:
                w['totalrainfall']      += float(day['precip'])
                w['totalsnowfall']      += float(day['snowfall'])
                w['heatingdegreedays']  += int(day['heatingdegreedays'])
                w['coolingdegreedays']  += int(day['coolingdegreedays'])
                w['mean_temp']          += float(day['mean_temp'])
                num_days                 += 1
                    
    w['totalrainfall']  = round(w['totalrainfall'], 2)
    w['totalsnowfall']  = round(w['totalsnowfall'], 2)
    w['mean_temp']      = round(w['mean_temp']/num_days, 1) if num_days else 0.0

    if _month.info['updated']:
        _month.info['updated'] = False
        models.Forecast.put(_month)
def build_html_table(_month):
    HTML_VERSION = '0.1r'
    old_version = ('html_version' not in _month.info or _month.info['html_version'] != HTML_VERSION)

    # if ('html_version' not in _month.info or _month.info['html_version'] != HTML_VERSION ):
    if (old_version or _month.info['updated']):
        cal             = _month.info['cal']
        current_month   = int(_month.info['id'][-2:])
        html            = ""
        headers         = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        week_html       = ''

        html += "<table class='table'>\n  <tr>\n    "
        for h in headers:
            html += '<th>'+ h +'</th> '
        html += '\n  </tr>\n'

        for week in cal:
            week_html = '  <tr>'
            for day in week:
                if day['updated'] or old_version:
                    day['html'] = "    <td><span class='"
                    day['html'] += 'dayHeader' if day['date'][1] == current_month else 'noncurrent'
                    day['html'] += "'>" + str(day['date'][2]) + '</span>'

                    if 'high' in day:
                        day['html'] += '<br>H <b>' + day['high'] + '&deg;</b><br>L <b>' + day['low'] + '&deg;</b>';
                        day['html'] += '<br>Rain ' + day['precip'] + '"' if day['rain'] == '1' else ''
                        day['html'] += '<br>Snow ' + day['snowfall'] + '"' if day['snow'] == '1' else ''
                    else:
                        day['html'] += '<br>H<br>L';
                    day['html'] += '</td>'

                    _month.info['updated'] = True
                week_html += '\n' + day['html']
            html += week_html + '\n' + '  </tr>' + '\n'

        html += '</table>'

        _month.info['weather']['html']   = html
        _month.info['html_version'] = HTML_VERSION

        # for k, v in _month.info.iteritems():
        #     logging.info('key: %s' %(k))
            # logging.info('key: %s, value: %s' %(k,v))
        # logging.info('weather below:')
        # for key in _month.info['weather']:
        #     logging.info('key: %s' %(key))

    return _month 
def get_month(info):
    info['id'] = create_month_id(info['zip'], info['year'], info['month'])
    months = []

    month = models.Forecast.get(info)
    if not month:
        month = create_month(info)

    if not month.info['complete']:
        urls = get_urls_to_update(month)
        months.append(update_month(month, urls))
        months.append(update_end_month(month, end=False))
        months.append(update_end_month(month, end=True))

        for m in months:
            m = build_html_table(m)
            save_month(m)

    if not len(months):
        m = build_html_table(month)
        # logging.info('updated: : %s' %m.info['updated'])
        if m.info['updated']:
            save_month(m)
    
    return month
