const express = require('express')
const HttpError = require('http-errors')
const Storage = require('@google-cloud/storage')
const { auth, database } = require('firebase-admin')
const gcsFileStreamer = require('./gcs-streamer')

const storageOpts = {}
if (!process.env.GAE_SERVICE) storageOpts.keyFilename = './bookcreator-dev.json'
const gcs = new Storage(storageOpts)
const bucket = gcs.bucket('bc-gae-test')

const requestNodeName = process.env.DEBUG ? 'request-debug' : 'request'

const servingRoute = express.Router()

servingRoute.get('/video', (req, res, next) => {
   const file = bucket.file('video.m4v')
   file.getMetadata(err => {
      if (err) return next(err)
      req.gcsFile = file
      return next()
   })
}, gcsFileStreamer)

servingRoute.get('/image', (req, res, next) => {
   const file = bucket.file('image.jpg')
   file.getMetadata(err => {
      if (err) return next(err)
      req.gcsFile = file
      return next()
   })
}, gcsFileStreamer)

const userRoute = express.Router()
userRoute.use((req, res, next) => {
   if (!req.authedUserId) return next(new HttpError.Unauthorized('No authed user'))
   return next()
})
userRoute.get('/', (req, res, next) => {
   database().ref(requestNodeName).child(req.authedUserId).limitToLast(parseInt(req.query.last) || 20).once('value').then(data => {
      const items = []
      data.forEach(d => {
         items.push(Object.assign({
            key: d.key
         }, d.val()))
      })
      res.json(items.reverse())
   }).catch(next)
})
// Log requests from now
userRoute.use((req, res, next) => {
   database().ref(requestNodeName).child(req.authedUserId).push({
      date: new Date().toISOString(),
      url: req.url,
      headers: req.headers
   }).then(() => next()).catch(next)
})
userRoute.use(servingRoute)

const route = express.Router()

route.post('/auth', (req, res, next) => {
   logger.debug('Authing with', req.body)

   const age = 5 /* mins */ * 60 * 1000
   const expires = new Date(Date.now() + age)

   auth().createSessionCookie(req.body, {
      expiresIn: age,
      secure: !process.env
   }).then(cookie => {
      res.cookie('firebase', cookie, {
         expires
      }).status(201).end()
   }).catch(next)
})

route.use('/users', userRoute)
route.use(servingRoute)

module.exports = route
