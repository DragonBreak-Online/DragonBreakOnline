'use strict'
// Staff dashboard Punishments panel, read only (sources/punish): warnings, strikes, suspensions, bans, Discord timeouts,
// kicks, jail and restitution, for the viewer's rank. GET only. Every request meets a limit per account or visitor first,
// then the switch, then the rank check against Discord (sources/punish/tier.js), and is never cached.
//
//   GET /api/site/staff/punishments                     the viewer's rank, the kinds they may see, each source's state
//   GET /api/site/staff/punishments/search?q=           up to 20 accounts by character name, #TAG, profile or Discord name
//   GET /api/site/staff/punishments/player/<profile>    one account: what runs now and its history (kind, from, to, cursor, limit)
//   GET /api/site/staff/punishments/active              everything running, ending soonest first (kind, cursor, limit)
//   GET /api/site/staff/punishments/recent              every account, newest first, the last 30 days by default (kind, from, to, cursor, limit)

const router = require('express').Router()
const rateLimit = require('express-rate-limit')
const config = require('../config')
const profiles = require('../sources/profiles')
const players = require('../sources/players')
const { currentSession, readStore, dynamicFields, characterName, profileIdOf } = require('./site-auth').internals
const { visitorIp } = require('../sources/visitorIp')
const { tierOf, staffStatusOf } = require('../sources/punish/tier')
const { createPunishments, BadRequest } = require('../sources/punish')

let service = null
const punishments = () => service || (service = createPunishments({
  config, readStore, dynamicFields, characterName, staffStatusOf, loadProfiles: () => profiles.load(), loadPlayers: () => players.load(),
}))

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, private')
  next()
})

const limiter = (limit, keyGenerator) => rateLimit({
  windowMs: 60 * 1000, limit, keyGenerator, standardHeaders: true, legacyHeaders: false, message: { error: 'tooMany' },
})

// Before the rank check, so a caller that is signed out or has no rank never reaches the Discord role lookup unlimited
router.use(limiter(120, req => {
  const session = currentSession(req)
  return session?.discordId ? `s:${session.discordId}` : `anon:${rateLimit.ipKeyGenerator(visitorIp(req) || req.ip)}`
}))

router.use((req, res, next) => {
  if (!config.punishPanel) return res.status(404).json({ error: 'notFound' })
  if (req.method !== 'GET') return res.status(405).json({ error: 'readOnly' })
  // Read only, so there is nothing to forge; a cross-site read is still refused when the browser says it is one
  const site = req.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'badOrigin' })
  next()
})

async function requireRank(req, res, next) {
  const session = currentSession(req)
  if (!session) return res.status(401).json({ error: 'signedOut' })
  const tier = await tierOf(session.discordId)
  if (!tier) return res.status(403).json({ error: 'notStaff' })
  // The viewer's own profile hides their own records, so a profile store that cannot be read refuses the request
  req.punishViewer = { tier, discordId: session.discordId, profileId: profileIdOf(session.discordId) }
  next()
}
router.use((req, res, next) => requireRank(req, res, next).catch(next))

const searchLimiter = limiter(60, req => `d:${req.punishViewer.discordId}`)

const answer = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next)

router.get('/', answer((req, res) => res.json(punishments().info(req.punishViewer))))

router.get('/search', searchLimiter, answer(async (req, res) => res.json(await punishments().search(req.punishViewer, req.query.q))))

router.get('/player/:profileId', answer(async (req, res) => {
  if (!/^\d{1,9}$/.test(req.params.profileId)) return res.status(400).json({ error: 'badProfile' })
  const { status, body } = await punishments().player(req.punishViewer, Number(req.params.profileId), req.query)
  res.status(status).json(body)
}))

router.get('/active', answer(async (req, res) => res.json(await punishments().active(req.punishViewer, req.query))))

router.get('/recent', answer(async (req, res) => res.json(await punishments().recent(req.punishViewer, req.query))))

router.use((_req, res) => res.status(404).json({ error: 'notFound' }))

// A bad filter answers 400 with its code; any failure reading the records answers 503, never a stack trace
router.use((err, _req, res, _next) => {
  if (err instanceof BadRequest) return res.status(400).json({ error: err.code })
  console.error('[site-punish]', err.code || 'error', err.message)
  if (!res.headersSent) res.status(503).json({ error: 'unavailable' })
})

module.exports = router
module.exports.internals = { punishments, setService: s => { service = s } }
