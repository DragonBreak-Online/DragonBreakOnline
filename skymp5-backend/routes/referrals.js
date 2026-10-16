'use strict'
// Referral links: the shared link. Everything else (codes, play time, qualification, rewards) is the gameplay's (server
// branch referrals.js; docs/referrals.md). The login hooks live in sources/referrals.js and are called from inside
// routes/skymp-compat.js. Registered in server.js before the /api/users routes:
//   app.use('/api/users/login-discord/join', referralsRoute.join)   (the prefix the public proxy forwards)
//   app.use('/api/join', referralsRoute.join)

const express   = require('express')
const rateLimit = require('express-rate-limit')
const config    = require('../config')
const { visitorIp } = require('../sources/visitorIp')
const { normCode, linksOn, COOKIE, COOKIE_PATH, TTL } = require('../sources/referrals')

function landingUrl(code) {
  const base = process.env.REFERRAL_LANDING_URL || `${String(config.websiteUrl || '').replace(/\/+$/, '')}/`
  try {
    const u = new URL(base)
    if (code) u.searchParams.set('ref', code)
    return u.href
  } catch { return '/' }
}

// A top-level navigation only: a browser that says what it fetches must say 'document' (no image, frame or script)
const navigation = req => { const dest = req.get('sec-fetch-dest'); return !dest || dest === 'document' }

function createReferralRoutes() {
  const secure = String(config.websiteUrl || '').startsWith('https:')

  const join = express.Router()
  join.use(rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
    skip: req => !visitorIp(req), keyGenerator: req => rateLimit.ipKeyGenerator(visitorIp(req)) }))
  join.get('/:code', (req, res) => {
    res.set({ 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' })
    const code = normCode(req.params.code)
    if (code && linksOn() && navigation(req)) {
      res.cookie(COOKIE, code, { path: COOKIE_PATH, maxAge: TTL.cookie, httpOnly: true, sameSite: 'lax', secure })
    }
    res.redirect(302, landingUrl(code))
  })

  return { join }
}

const routes = createReferralRoutes()
module.exports = { join: routes.join, createReferralRoutes, landingUrl }
