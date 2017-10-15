#from google.appengine.ext import ndb
#import models
import webapp2
import json
import s_month

#Debugging
#import logging
#import time

class aPushQueue(webapp2.RequestHandler):
    def post(self):
        info = json.loads(self.request.body)
        s_month.get_month(info)
                
app = webapp2.WSGIApplication([
    ('/apushqueue', aPushQueue)
], debug=True)
