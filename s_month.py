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

LOG_OBJ = {}
W_OBJ   = {}    # shared data
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
    # old_version = ('html_version' not in day or day['html_version'] != HTML_VERSION)

    # if day['updated'] or old_version:
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
        
        # day['html']         = html
        # day['html_version'] = HTML_VERSION
    # else:
    #     html = day['html']

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
    
    # return day
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

    # day['updated']              = True

    # day = mark_complete_or_recent(day)    
    
    # return day
def create_month(info): 
    info['cal']                 = create_cal(info['year'], info['month'])
    info['complete']            = False
    info['updated']             = True

    return models.Forecast.new_obj(info)
def is_month_complete(month):

    # Assert month is complete, then verify assertion is true or false.
    complete = True

    for week in month.info['cal']:
        for day in week:
            if not day['complete'] and complete:
                complete = False

    return complete
def clear_day_updates(month):
    for week in month.info['cal']:
        for day in week:
            day['updated'] = False

    # return month
def get_totals(month):
    w               = month.info
    # REPLACE THIS WITH MONTH.INFO['MONTH']
    # logging.info('current month val, to replace getting from id: %s' %month.info['month'])
    # current_month   = int(_month.info['id'][-2:])
    current_month   = int(month.info['month'])
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
    
    # return month
def check_recent(day):
    if 'last_updated' in day:
        now = int(time.time())
        if now - day['last_updated'] < 5*60*60:
            return True
    return False
def get_urls_to_update(month): 
    """ There are 2 reasons to return dates, api usage restriction from weather underground, 
    i.e. 4 of 10 call/min have been used by current / tenday / other month request or less 
    days in month need to be populated then are available, i.e. 27 of 30 days were previously 
    populated with data from wu."""
    # Calls are reserved or left alone so there are still some available for a current or tenday request.
    # calls_reserved      = 7         # TESTING FOR SUPER LONG LOCAL DELAY.
    calls_reserved      = 2       # COMMENTING THIS LINE IS TESTING.
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
            d                   = day['date']
            req                 = datetime(d[0], d[1], d[2])
            history             = req < now         # To avoid asking WU for weather data on a future date.
            recently_checked    = check_recent(day)
            if avail and not day['complete'] and history and not recently_checked:
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
def create_date_key(date):
    return '-'.join([str(int(x)) for x in date])
def create_cal_dict(cal):
    o = {}
    for week in cal:
        for day in week:
            key = '-'.join([str(x) for x in day['date']])
            key1 = create_date_key(day['date'])
            o[key] = day
            # logging.info('will update day key:  %s' %key)
            # logging.info('will update day key1: %s' %key1)

            # o[day['date']] = day
            # TODO USE SOMETHING LIKE THIS
            # obj6 = '-'.join([str(x) for x in li6])

            # This did not work because keys need to be immutable and arrays are not.
            # o[day['date'][2]] = day
    return o
def update_month(month, urls):
    rpcs, results   = [], []
    cal             = month.info['cal']
    # old_version     = ('html_version' not in month.info or month.info['html_version'] != HTML_VERSION)

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
    
    # logging.info('Requests from WU COMPLETE\n\n')
    logging.info('Requests from WU COMPLETE')

    # RIGHT HERE CREATE THE MONTH DICTIONARY SO NOT CYCLING THRU SO MANY TIMES.
    # SEE IF THERE IS ANY OTHER PLACE IT MAY COME IN HANDY AND MOVE IT ACCORDINGLY.

    # SHOULD MOVE EVERYTHING BELOW AND CAL, OLD_VERSION VARS TO A PROCESS MONTH FUNCTION.

    i = 0
    t0 = time.time()

    i = len(results)
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

    # for week in cal:
    #     for day in week:
    #         for result in results:
    #             i += 1
    #             try:
    #                 d = result['history']['date']
    #                 date = [int(d['year']), int(d['mon']), int(d['mday'])]
    #             except:
    #                 logging.info('Failed to update day with data from WU.')
    #                 date = None
    #             if date == day['date']:
    #                 logging.info('Going to load history on date for date: %s' %date)
    #                 try:
    #                     r = result['history']['dailysummary'][0]
    #                     process_day(day, r)
    #                     mark_complete_or_recent(day)
    #                     day['updated'] = True
    #                     month.info['updated'] = True

    #                     results.remove(result)

    #                 except:
    #                     logging.info('could not get weather')
    #         if not len(results):
    #             break
    logging.info('cycling %s results took: %ss' %(i, round(time.time()-t0, 5)))
    
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
                logging.info('day %s is updated: : %s' %(d['date'], d['updated']))
                non_current_row[i]  = d.copy()
                obj.info['updated'] = True

    return obj
def save_month(_month):
    # Assume these next 2 statements and verify in next steps.
    # _month.info['complete'] = True
    cal = _month.info['cal']

    _month.info['complete'] = is_month_complete(_month)
    # _month = get_totals(_month)
    get_totals(_month)

    
    if _month.info['updated']:
        logging.info('savemonth, month %s %s is updated?: %s' %(_month.info['month'], _month.info['year'], _month.info['updated']))
        # _month = clear_day_updates(_month)
        clear_day_updates(_month)
        _month.info['updated'] = False
        models.Forecast.put(_month)
def build_html_table(_month):
    # HTML_VERSION = '0.1r'
    old_version = ('html_version' not in _month.info or _month.info['html_version'] != HTML_VERSION)

    t0 = time.time()

    # if ('html_version' not in _month.info or _month.info['html_version'] != HTML_VERSION ):
    if (old_version or _month.info['updated']):
    # I AM CONSIDERING GETTING RID OF ANY CHECKS AND JUST REBUILING EVERY TIME, DOES NOT TAKE THAT LONG
    # AND SAVES STORING THE DAY['HTML'] INDEFINITELY. EVENTUALLY REMOVE THIS IF TRUE
    # if True:
        cal             = _month.info['cal']
        # current_month   = int(_month.info['id'][-2:])
        current_month   = int(_month.info['month'])
        html            = ""
        headers         = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        week_html       = ''

        html += "<table class='table'>\n  <tr>\n    "
        for h in headers:
            html += '<th>'+ h +'</th> '
        html += '\n  </tr>\n'

        # TODO FIX THE WAY I HANDLE DAY HTML
        # NOT SURE WHY I AM STORING HTML IN DAY AND IN MONTH, JUST PROCESS IT EVERY TIME???

        for week in cal:
            week_html = '  <tr>'
            for day in week:
                # day = create_day_html(day)
                # create_day_html(day)
                # week_html += '\n' + day['html']
                week_html += '\n' + create_day_html(day, current_month)
            html += week_html + '\n' + '  </tr>' + '\n'

        html += '</table>'

        _month.info['html']         = html
        _month.info['html_version'] = HTML_VERSION

        t1 = round(time.time()-t0, 5)
        logging.info('Updating html table for month %s took %ss, ' %(_month.info['month'], t1))

    # return _month 
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
            # m = build_html_table(m)
            build_html_table(m)
            save_month(m)

    if not len(months):
        # m = build_html_table(month)
        # if m.info['updated']:
        #     save_month(m)
        build_html_table(month)
        if month.info['updated']:
            save_month(month)
    
    return month
