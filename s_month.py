from google.appengine.api import urlfetch
from datetime import datetime, timedelta
import calendar
import functools
import json
import time

# custom modules
import models
import s_utils

# debugging
import logging

LOG_OBJ = {}    # UNUSED ???
W_OBJ   = {}    # shared data UNUSED ???
HTML_VERSION = '0.1r'

def create_cal(yr, mon):
    """Creates an array calendar, i.e. each row is a week, each week is an arry of 7 day data objects."""
    m           = calendar.Calendar(6)
    cal, week   = [], []
    first_week  = True
            
    for i, d in enumerate(m.itermonthdates(yr, mon)):
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

    return cal
def create_day_html(day, current_month):
    html = "    <td><span class='"
    html += 'dayHeader' if day['date'][1] == current_month else 'noncurrent'
    html += "'>" + str(day['date'][2]) + '</span>'

    if 'high' in day:
        html += '<br>H <b>' + day['high'] + '&deg;</b><br>L <b>' + day['low'] + '&deg;</b>';
        html += '<br>Rain ' + day['precip'] + '"' if day['rain'] == '1' else ''
        html += '<br>Snow ' + day['snowfall'] + '"' if day['snow'] == '1' else ''
    else:
        html += '<br>H<br>L';
    html += '</td>'
        
    return html
def mark_complete_or_recent(day):
    # Only mark complete if not close to today. WU will report before day is over
    # and may not get actual high or total precip/snow at the time we are checking.
    now     = datetime.utcnow()
    d       = day['date']
    req     = datetime(d[0], d[1], d[2])

    # old     = now - req > timedelta(days=2)
    recent  = now - req < timedelta(days=2) and now - req > timedelta(seconds=0)

    day['complete'] = now - req > timedelta(days=2)

    if recent:
        day['last_updated'] = int(time.time())
    else:
        if 'last_updated' in day:
            del day['last_updated']
    
def process_day(day, data):
    day['high']                 = data['maxtempi']
    day['low']                  = data['mintempi']

    # WU will report 'trace' for precip and rain, setting to 0, so it doesn't break summing.
    p = data['precipi']
    day['precip']               = p if p != 'T' else '0.0'
    s = data['snowfalli']
    day['snowfall']             = s if s != 'T' else '0.0'
    day['snow_depth']           = data['snowdepthi']
    day['rain']                 = data['rain']
    day['snow']                 = data['snow']

    day['mean_temp']            = data['meantempi']
    day['humidity']             = data['humidity']
    day['mean_wind_dir']        = data['meanwdird']
    day['mean_wind_speed']      = data['meanwindspdi']

    day['heatingdegreedays']    = data['heatingdegreedays']
    day['coolingdegreedays']    = data['coolingdegreedays']

def create_month(info): 
    info['cal']                 = create_cal(info['year'], info['month'])
    info['complete']            = False
    info['updated']             = True

    return models.Forecast.new_obj(info)
def set_month_complete(month):
    # Considered a temporary complete for current month to stop client from pingging server constantly
    # when on current month, but it was a lot of code for little payoff.

    # Assert month is complete, then verify assertion is true or false.
    month['complete']   = True

    for week in month['cal']:
        for day in week:
            if not day['complete'] and month['complete']:
                month['complete'] = False
def clear_day_updates(month):
    for week in month.info['cal']:
        for day in week:
            day['updated'] = False

    # return month
def set_totals(month):
    # w               = month.info
    w               = month
    current_month   = int(month['month'])
    num_days        = 0.0

    w['mean_temp'] = 0.0
    w['totalrainfall']  = 0.0
    w['totalsnowfall']  = 0.0
    w['coolingdegreedays'] = 0
    w['heatingdegreedays'] = 0

    for week in w['cal']:
        for day in week:
            if current_month == day['date'][1] and day['complete']:
                w['mean_temp']          += float(day['mean_temp'])
                w['totalrainfall']      += float(day['precip'])
                w['totalsnowfall']      += float(day['snowfall'])
                w['heatingdegreedays']  += int(day['heatingdegreedays'])
                w['coolingdegreedays']  += int(day['coolingdegreedays'])
                num_days                += 1.0
                    
    w['totalrainfall']  = round(w['totalrainfall'], 2)
    w['totalsnowfall']  = round(w['totalsnowfall'], 2)
    w['mean_temp']      = round(w['mean_temp']/num_days, 1) if num_days else 0.0
def create_date_key(date):
    return '-'.join([str(int(x)) for x in date])
def create_cal_dict(cal):
    o = {}
    for week in cal:
        for day in week:
            key     = create_date_key(day['date'])
            o[key]  = day
    return o
def update_month(month, urls):
    rpcs, results   = [], []
    cal             = month.info['cal']

    def handle_rpc(rpc):
        try:
            r = rpc.get_result()
            logging.info('Handling RPC in cb: r {}'.format(r))
            results.append(json.loads(r.content))
        except Exception as inst:
            logging.info('month error: %s' %inst)


    for url in urls:
        logging.info('Req2Wu url: %s' %(url[:5] + '...' + url[50:]))
        rpc = urlfetch.create_rpc()
        rpc.callback = functools.partial(handle_rpc, rpc)
        urlfetch.make_fetch_call(rpc, url)
        rpcs.append(rpc)

    for rpc in rpcs:
        rpc.wait()

    # SHOULD MOVE EVERYTHING BELOW AND CAL, OLD_VERSION VARS TO A PROCESS MONTH FUNCTION.

    cal_dict = create_cal_dict(cal)
    for result in results:
        try:
            r           = result['history']['dailysummary'][0]
            d           = result['history']['date']
            date        = [d['year'], d['mon'], d['mday']]
        except:
            logging.info('Failed to update day with data from WU.')
        else:
            date_key    = create_date_key(date)
            day         = cal_dict[date_key]
            process_day(day, r)
            mark_complete_or_recent(day)
            day['updated']          = True
            month.info['updated']   = True

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
        'id':       create_month_id(_zip, yr, mon)
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
            if d['updated']:
                non_current_row[i]  = d.copy()
                obj.info['updated'] = True

    return obj
def save_month(_month):
    cal = _month.info['cal']

    set_month_complete(_month.info)
    set_totals(_month.info)
    
    if _month.info['updated']:
        clear_day_updates(_month)
        _month.info['updated'] = False
        models.Forecast.put(_month)
def build_html_table(_month):
    old_version = ('html_version' not in _month.info or _month.info['html_version'] != HTML_VERSION)

    if (old_version or _month.info['updated']):
        cal             = _month.info['cal']
        current_month   = int(_month.info['month'])
        html            = ""
        headers         = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        week_html       = ''

        html += "<table class='table'>\n  <tr>\n    "
        for header in headers:
            html += '<th>'+ header +'</th> '
        html += '\n  </tr>\n'

        for week in cal:
            week_html = '  <tr>'
            for day in week:
                week_html += '\n' + create_day_html(day, current_month)
            html += week_html + '\n' + '  </tr>' + '\n'

        html += '</table>'

        _month.info['html']         = html
        _month.info['html_version'] = HTML_VERSION

def get_month(info):
    info['id'] = create_month_id(info['zip'], info['year'], info['month'])
    months = []

    month = models.Forecast.get(info)
    if not month:
        logging.info('creating new month for year: %s, month: %s' %(info['year'], info['month']))
        month = create_month(info)

    if not month.info['complete']:
        urls = models.APILock.get(month.info)
        months.append(update_month(month, urls))
        months.append(update_end_month(month, end=False))
        months.append(update_end_month(month, end=True))

        for m in months:
            build_html_table(m)
            save_month(m)

    if not len(months):
        build_html_table(month)
        if month.info['updated']:
            save_month(month)
    
    return month
