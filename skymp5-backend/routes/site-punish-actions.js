'use strict'
// Staff dashboard Punishments panel actions (sources/punish/actions.js), behind PUNISH_ACTIONS (off unless set). Mounted
// before the read-only panel route, and it ends every request itself. Every request first meets a limit per account or
// visitor; a POST then needs the console's same-origin checks, and its body is read only after the caller's checks.
//
//   GET  /api/site/staff/punishments/actions               what the viewer may do (any panel rank)
//   POST /api/site/staff/punishments/actions/<action>      send, ban, unban, discord-timeout, discord-timeout-end,
//                                                          discord-ban, discord-unban: {requestId, profileId, ..., confirm}
//   GET  /api/site/staff/punishments/actions/jobs/<id>     one of the viewer's own jobs

const path = require('path')
const express = require('express')
const router = express.Router()
const rateLimit = require('express-rate-limit')
const config = require('../config')
const { currentSession, sessionToken, sameOrigin } = require('./site-auth').internals
const { visitorIp } = require('../sources/visitorIp')
const { bodyErrors } = require('../sources/problemReport')
const { tierOf } = require('../sources/punish/tier')
const { createPunishActions, ACTIONS } = require('../sources/punish/actions')

const BASE = '/api/site/staff/punishments/actions'
// For server.js: the global JSON parser stays off these, so a body is read only after this route's checks
const OWN_PARSER_PATHS = Object.keys(ACTIONS).map(a => `${BASE}/${a}`)

let service = null
function actions() {
  if (service) return service
  const tier = require('../sources/punish/tier')
  const profiles = require('../sources/profiles')
  service = createPunishActions({
    config,
    consoleApi: require('../sources/console').consoleApi,
    bot: require('../sources/discordBot'),
    bans: require('../sources/bans'),
    journal: require('../sources/discord/moderationJournal'),
    audit: require('../sources/discord/audit'),
    targetOf: profileId => require('./site-punish').internals.punishments().targetOf(profileId),
    profileIdOf: discordId => { const id = profiles.load().map[discordId]; return Number.isInteger(id) ? id : null },
    tierFromRoles: tier.tierFromRoles,
    rankOfRoles: tier.rankOfRoles,
    bannedRoleId: () => require('../sources/serverAccess').load().bannedRoleId,
    jobsFile: path.join(__dirname, '..', 'data', 'punish-actions.json'),
    auditFile: path.join(__dirname, '..', 'data', 'punish-actions.jsonl'),
  })
  return service
}

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, private')
  next()
})

const limiter = (windowMs, limit, keyGenerator) => rateLimit({
  windowMs, limit, keyGenerator, standardHeaders: true, legacyHeaders: false, message: { error: 'tooMany' },
})

// Before any rank check, so a caller that is signed out or has no rank never reaches the Discord role lookup unlimited
router.use(limiter(60 * 1000, 120, req => {
  const session = currentSession(req)
  return session?.discordId ? `s:${session.discordId}` : `anon:${rateLimit.ipKeyGenerator(visitorIp(req) || req.ip)}`
}))

router.use((_req, res, next) => (config.punishPanel ? next() : res.status(404).json({ error: 'notFound' })))

const answer = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next)

// The panel's rank from the 60 s role cache: enough to read what one may do; every action asks Discord again
async function requireRank(req, res, next) {
  const session = currentSession(req)
  if (!session) return res.status(401).json({ error: 'signedOut' })
  const tier = await tierOf(session.discordId)
  if (!tier) return res.status(403).json({ error: 'notStaff' })
  req.punishTier = tier
  next()
}
const rank = (req, res, next) => requireRank(req, res, next).catch(next)
const perViewer = limit => limiter(60 * 1000, limit, req => `d:${currentSession(req).discordId}`)

router.get('/', rank, perViewer(60), (req, res) => res.json(actions().info(sessionToken(req), req.punishTier)))

router.get('/jobs/:id', rank, perViewer(120), (req, res) => {
  const job = actions().job(sessionToken(req), req.params.id)
  if (!job) return res.status(404).json({ error: 'notFound' })
  res.json({ v: 1, job })
})

// Same-origin JSON from the dashboard only (exact Origin, fetch metadata when sent, the control header), then a session
function actionRequest(req, res, next) {
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, req.params.action)) return res.status(404).json({ error: 'notFound' })
  // A body some earlier parser already read is refused, so this route only ever acts on a body it read after its checks
  if (req._body) return res.status(400).json({ error: 'badRequest' })
  const site = req.get('sec-fetch-site')
  if (!sameOrigin(req) || (site && site !== 'same-origin')) return res.status(403).json({ error: 'badOrigin' })
  if (!req.is('application/json')) return res.status(415).json({ error: 'badContentType' })
  if (req.get('x-dbo-control') !== '1') return res.status(403).json({ error: 'badHeader' })
  if (!currentSession(req)) return res.status(401).json({ error: 'signedOut' })
  next()
}

// The switch, tries, the fresh sign-in, the pin and the roles asked of Discord now, all before the body is read
function authorize(req, res, next) {
  actions().authorize(sessionToken(req), req.params.action).then(r => {
    if (r.refused) return res.status(r.refused.status).json(r.refused.body)
    req.punishCtx = r.ctx
    next()
  }).catch(next)
}

// rank (the cached panel rank) only refuses: a caller with none never reaches the tries, the pin or the audit channel
router.post('/:action', actionRequest, rank, authorize, express.json({ limit: '2kb', inflate: false }), answer(async (req, res) => {
  const { status, body } = await actions().perform(req.punishCtx, req.params.action, req.body)
  res.status(status).json(body)
}))
router.use(bodyErrors)

router.use((_req, res) => res.status(404).json({ error: 'notFound' }))

router.use((err, _req, res, _next) => {
  console.error('[site-punish-actions]', err.code || 'error', err.message)
  if (!res.headersSent) res.status(503).json({ error: 'unavailable' })
})

// Run once by server.js at start: jobs a backend restart cut short
router.recover = () => { try { actions().recover() } catch (err) { console.error('[site-punish-actions] recover failed:', err.message) } }

module.exports = router
module.exports.OWN_PARSER_PATHS = OWN_PARSER_PATHS
module.exports.internals = { actions, setService: s => { service = s } }
