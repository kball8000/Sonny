from datetime import datetime, timedelta
import webapp2
import models

class Basic(webapp2.RequestHandler):
    def get(self):
        
        def purge(li, _typ):
            for x in li:
                if _typ == 'weather':
                    limit = delta[x.info['view']]
                else:    # _typ == 'radar':
                    limit = delta[x.key.kind()]
                    
                if now - x.date > limit:
                    x.key.delete()
        
        now = datetime.utcnow()
        delta = {
            # Hourly is in current object.
            'current':  timedelta(days = 3),
            'tenday':   timedelta(days = 11),
            'month':    timedelta(days = 365*1000),
            'Radar':    timedelta(hours = 6)  # capital 'R' is important
        }

        li = models.Forecast.query().fetch(1000)
        purge(li, 'weather')
        li = models.Radar.query().fetch(1000)
        purge(li, 'radar')

app = webapp2.WSGIApplication([
    ('/purgecache', Basic)
], debug=False)
