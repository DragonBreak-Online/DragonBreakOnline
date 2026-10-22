'use strict'
// Staff dashboard Console panel: GET / (setting, commands, freshness), POST /run {requestId, command[, targetProfileId]}, GET /jobs/<id> (own only)

const express = require('express')
const router = express.Router()
const rateLimit = require('express-rate-limit')
const { requireStaff } = require('./site-staff').internals
const { currentSession, sessionToken, sameOrigin } = require('./site-auth').internals
const { visitorIp } = require('../sources/visitorIp')
const { bodyErrors } = require('../sources/problemReport')
const { consoleApi } = require('../sources/console')
const rules = require('../sources/console/allowlist')
const { SIGN_IN_URL } = require('../sources/console/staffConsole')

const BODY_KEYS = ['requestId', 'command']
// The account the Punishments page showed; the game refuses a #TAG that is not one of its characters
const OPTIONAL_KEYS = ['targetProfileId']
const MAX_COMMAND = 600

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, private')
  next()
})

const limiter = (windowMs, limit, keyGenerator) => rateLimit({
  windowMs, limit, keyGenerator, standardHeaders: true, legacyHeaders: false, message: { error: 'tooMany' },
})

// Before requireStaff, so a caller that is signed out or not staff never reaches the Discord role lookup unlimited
router.use(limiter(60 * 1000, 120, req => {
  const session = currentSession(req)
  return session?.discordId ? `s:${session.discordId}` : `anon:${rateLimit.ipKeyGenerator(visitorIp(req) || req.ip)}`
}))
const perStaff = limit => limiter(60 * 1000, limit, req => `d:${req.staff.discordId}`)

const answer = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next)

router.get('/', requireStaff, perStaff(60), (req, res) => {
  const api = consoleApi()
  const s = api.state('web')
  res.json({ v: 1, setting: s.setting, ready: s.ready, fresh: api.isFresh(api.webCaller(sessionToken(req))), signInUrl: SIGN_IN_URL,
    commands: s.commands, maxLength: rules.MAX_TEXT })
})

// Same-origin JSON from the dashboard only (exact Origin, fetch metadata when sent, the control header), then a session
function consoleRequest(req, res, next) {
  // A body some earlier parser already read is refused, so this route only ever acts on a body it read after its checks
  if (req._body) return res.status(400).json({ error: 'badRequest' })
  const site = req.get('sec-fetch-site')
  if (!sameOrigin(req) || (site && site !== 'same-origin')) return res.status(403).json({ error: 'badOrigin' })
  if (!req.is('application/json')) return res.status(415).json({ error: 'badContentType' })
  if (req.get('x-dbo-control') !== '1') return res.status(403).json({ error: 'badHeader' })
  if (!currentSession(req)) return res.status(401).json({ error: 'signedOut' })
  next()
}

function consoleBody(req, res, next) {
  const b = req.body
  const keys = b && typeof b === 'object' && !Array.isArray(b) ? Object.keys(b) : null
  if (!keys || !BODY_KEYS.every(k => keys.includes(k)) || !keys.every(k => BODY_KEYS.includes(k) || OPTIONAL_KEYS.includes(k))) return res.status(400).json({ error: 'badRequest' })
  if (typeof b.requestId !== 'string' || !rules.UUID_RE.test(b.requestId)) return res.status(400).json({ error: 'badRequest' })
  if (keys.includes('targetProfileId') && !(Number.isSafeInteger(b.targetProfileId) && b.targetProfileId >= 0)) return res.status(400).json({ error: 'badRequest' })
  if (typeof b.command !== 'string' || b.command.length > MAX_COMMAND) return res.status(400).json({ error: 'badCommand' })
  next()
}

// requireStaff only keeps non-staff from a parsed body; the checks that count, and the identity, are inside runStaffCommand
router.post('/run', consoleRequest, requireStaff, express.json({ limit: '2kb', inflate: false }), consoleBody, answer(async (req, res) => {
  const api = consoleApi()
  const caller = api.webCaller(sessionToken(req))
  if (!caller) return res.status(401).json({ error: 'signedOut' })
  const { status, body } = await api.runStaffCommand(caller, { uuid: req.body.requestId, text: req.body.command, ...(req.body.targetProfileId !== undefined ? { targetProfileId: req.body.targetProfileId } : {}) })
  res.status(status).json(body)
}))
router.use('/run', bodyErrors)

router.get('/jobs/:id', requireStaff, perStaff(120), (req, res) => {
  const api = consoleApi()
  const id = String(req.params.id || '').toLowerCase()
  const job = rules.UUID_RE.test(id) ? api.job(`w-${id}`, api.webCaller(sessionToken(req))) : null
  if (!job) return res.status(404).json({ error: 'notFound' })
  res.json({ v: 1, job })
})

router.use((err, _req, res, _next) => {
  console.error('[site-console]', err.code || 'error', err.message)
  if (!res.headersSent) res.status(503).json({ error: 'unavailable' })
})

module.exports = router
