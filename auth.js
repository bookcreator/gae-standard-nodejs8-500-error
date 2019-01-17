const HttpError = require('http-errors')
const { auth } = require('firebase-admin')

const debugAuthUserHeader = 'x-bc-authed-user'

const reqTokenAuther = (req, cb) => {
   if (process.env.DEBUG && req.get(debugAuthUserHeader)) {
      return auth().getUser(req.get(debugAuthUserHeader)).then(({ uid, customClaims, displayName: name, email, emailVerified: email_verified, photoURL: picture }) => {
         const now = Math.floor(Date.now() / 1000)
         const aud = process.env.GCLOUD_PROJECT
         // Create dummy decodedToken
         const token = Object.assign({}, customClaims, {
            uid,
            email,
            email_verified,
            picture,
            user_id: uid,
            name,
            auth_time: now,
            iat: now,
            exp: now + (60 * 60),
            aud,
            iss: `https://securetoken.google.com/${aud}`,
            sub: uid,
            firebase: {
               identities: {},
               sign_in_provider: 'custom'
            }
         })
         logger.info(`Using '${debugAuthUserHeader}' header`, token)
         cb(null, token)
      }).catch(err => {
         logger.warn(`Failed to get user for use with '${debugAuthUserHeader}' header`, err)
         // Remove bad header
         delete req.headers[debugAuthUserHeader]
         // ... and fallback to default auth
         reqTokenAuther(req, cb)
      })
   }

   const cookie = req.cookies.firebase
   if (!cookie) return cb()
   // Verify Firebase auth cookie
   auth().verifySessionCookie(cookie).catch(err => {
      if (err.code === 'auth/session-cookie-expired' || err.message.indexOf('auth/session-cookie-expired') !== -1) {
         // Expired cookie
         return
      } else if (err.code === 'auth/argument-error' || err.code === 'auth/session-cookie-revoked') {
         const e = new HttpError.Unauthorized(err.message)
         e.underlyingErr = err
         return Promise.reject(e)
      } else {
         const e = new HttpError.InternalServerError(err.message)
         e.underlyingErr = err
         return Promise.reject(e)
      }
   }).then(decodedToken => cb(null, decodedToken)).catch(cb)
}

module.exports = (req, res, next) => {

   reqTokenAuther(req, (err, authedUser) => {
      if (err) return next(err)

      if (authedUser) {
         Object.defineProperty(req, 'authedUser', { value: authedUser })
         Object.defineProperty(req, 'authedUserId', { get: function () { return this.authedUser.uid } })
      }

      return next()
   })
}
