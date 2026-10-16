'use strict'
// Referral links: the shared link (/api/join/<code>) and the tap on the Discord login that binds a brand-new account to
// the code its browser carried. Everything else (codes, play time, qualification, rewards) is the gameplay's
// (server branch referrals.js; docs/referrals.md). See sources/referrals.js.
//
// Registered in server.js, the tap BEFORE the /api/users routes so it sees each login first:
//   app.use('/api/join', referralsRoute.join)
//   app.use('/api/users/login-discord', referralsRoute.loginTap)
// The tap never answers a request and never changes one: it notes the state on the browser step and reads the JSON the
// login route sends back.

const express   = require('express')
const rateLimit = require('express-rate-limit')
const config    = require('../config')
const { visitorIp } = require('../sources/visitorIp')
const { createReferralStore, normCode, readCookie, COOKIE, COOKIE_PATH, TTL } = require('../sources/referrals')

function landingUrl(code) {
  const base = process.env.REFERRAL_LANDING_URL || `${String(config.websiteUrl || '').replace(/\/+$/, '')}/`
  try {
    const u = new URL(base)
    if (code) u.searchParams.set('ref', code)
    return u.href
  } catch { return '/' }
}

function createReferralRoutes({ store = createReferralStore(), players = require('../sources/players') } = {}) {
  const secure = String(config.websiteUrl || '').startsWith('https:')

  const join = express.Router()
  join.use(rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
    skip: req => !visitorIp(req), keyGenerator: req => rateLimit.ipKeyGenerator(visitorIp(req)) }))
  join.get('/:code', (req, res) => {
    res.set({ 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' })
    const code = normCode(req.params.code)
    if (code) {
      store.visit({ code, ip: visitorIp(req), ua: req.get('user-agent') })
      res.cookie(COOKIE, code, { path: COOKIE_PATH, maxAge: TTL.cookie, httpOnly: true, sameSite: 'lax', secure })
    }
    res.redirect(302, landingUrl(code))
  })

  function loginTap(req, res, next) {
    try {
      const p = req.path
      if (req.method === 'GET' && (p === '/' || p === '')) {
        store.noteLogin({ state: req.query && req.query.state, cookieCode: readCookie(req, COOKIE), ip: visitorIp(req), ua: req.get('user-agent') })
        return next()
      }
      const collect = (req.method === 'POST' && (p === '/token' || p === '/poll')) || (req.method === 'GET' && p === '/status')
      if (!collect) return next()
      const state = req.method === 'POST' ? req.body && req.body.state : req.query && req.query.state
      if (!store.pendingFor(state)) return next()
      const json = res.json.bind(res)
      res.json = (body) => {
        try {
          if (res.statusCode === 200 && body && typeof body.token === 'string' && Number.isSafeInteger(body.masterApiId)) {
            let player = null
            try { player = players.getByProfileId(body.masterApiId) } catch (err) { console.error('[referral] player lookup failed:', err.message) }
            store.deliver({ state, profileId: body.masterApiId, player })
          }
        } catch (err) { console.error('[referral] tap failed:', err.message) }
        return json(body)
      }
    } catch (err) { console.error('[referral] tap failed:', err.message) }
    next()
  }

  return { join, loginTap }
}

const routes = createReferralRoutes()
module.exports = { join: routes.join, loginTap: routes.loginTap, createReferralRoutes, landingUrl }
