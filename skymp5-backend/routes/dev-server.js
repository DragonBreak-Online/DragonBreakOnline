'use strict'

/**
 * The dev server option in the launcher, for Lead GM and above. Mounted by routes/files.js under /api/files/dev, a prefix the
 * public proxy already forwards. Off until DEV_TICKET_PRIVATE_KEY, DEV_RELAY_ADDRESS and DEV_FILES_URL are all set.
 *   GET  /api/files/dev/access  (x-session)  -> { enabled, allowed, tier }: whether the launcher shows the server selector
 *   POST /api/files/dev/ticket  (x-session)  -> { ticket, expiresAt, tier, server: { name, address, port }, filesUrl }
 * The ticket (scripts/dev-ticket.js) is what the dev server and the relay's file server check; they never call this backend.
 * Tiers come from the Discord roles through the bot's role cache (sources/punish/tier.js order); no answer is no tier.
 */

const router = require('express').Router()
const { rateLimit } = require('express-rate-limit')
const discordBot = require('../sources/discordBot')
const { tierFromRoles } = require('../sources/punish/tier')
const { visitorKey } = require('../sources/clientFiles')
const { loadPrivateKey, signDevTicket } = require('../scripts/dev-ticket')

const ROLE_CHECK_MS = 8000
const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean)

// Read per request, so tests and an env reload need no restart of this module
function settings() {
  const env = process.env
  let key = null
  let keyError = null
  try { key = loadPrivateKey(env.DEV_TICKET_PRIVATE_KEY) } catch (err) { keyError = err.message }
  const port = parseInt(env.DEV_RELAY_PORT || '7777', 10)
  const ttlHours = Math.min(Math.max(parseFloat(env.DEV_TICKET_TTL_HOURS || '12') || 12, 0.25), 168)
  const filesUrl = String(env.DEV_FILES_URL || '').replace(/\/+$/, '')
  return {
    key, keyError,
    tiers: list(env.DEV_SERVER_TIERS || 'owner,dev,leadgm'),
    ttlSec: Math.round(ttlHours * 3600),
    server: { name: env.DEV_SERVER_NAME || 'DragonBreak DEV', address: String(env.DEV_RELAY_ADDRESS || ''), port },
    filesUrl: /^https:\/\//i.test(filesUrl) ? filesUrl : '',
  }
}
const enabled = s => !!(s.key && s.server.address && Number.isInteger(s.server.port) && s.server.port > 0 && s.filesUrl)

function withDeadline(promise) {
  let timer
  const deadline = new Promise(resolve => { timer = setTimeout(resolve, ROLE_CHECK_MS, null) })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

async function rolesOf(discordId) {
  try {
    const roles = await withDeadline(discordBot.getMemberRoles(discordId))
    return Array.isArray(roles) ? roles.map(String) : null
  } catch (err) {
    console.error('[dev-server] role lookup failed:', err.message)
    return null
  }
}

function sessionOf(req, res) {
  const token = req.headers['x-session']
  if (typeof token !== 'string' || !token) { res.status(401).json({ error: 'signedOut' }); return null }
  const { lookupSession } = require('./master-api')
  const session = lookupSession(token)
  if (!session) { res.status(401).json({ error: 'sessionExpired' }); return null }
  return session
}

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: visitorKey,
  message: { error: 'Too many requests. Please try again later.' },
})

router.use((_req, res, next) => { res.set('Cache-Control', 'no-store, private'); next() })

router.get('/access', limiter, async (req, res) => {
  const s = settings()
  if (!enabled(s)) return res.json({ enabled: false, allowed: false, tier: null })
  const session = sessionOf(req, res)
  if (!session) return
  const roles = await rolesOf(session.discordId)
  const tier = roles ? tierFromRoles(roles) : null
  res.json({ enabled: true, allowed: !!tier && s.tiers.includes(tier), tier })
})

router.post('/ticket', limiter, async (req, res) => {
  const s = settings()
  if (s.keyError) console.error('[dev-server] DEV_TICKET_PRIVATE_KEY is unusable:', s.keyError)
  if (!enabled(s)) return res.status(503).json({ error: 'devServerOff' })
  const session = sessionOf(req, res)
  if (!session) return
  const roles = await rolesOf(session.discordId)
  if (!roles) return res.status(503).json({ error: 'rolesUnavailable' })
  const tier = tierFromRoles(roles)
  if (!tier || !s.tiers.includes(tier)) {
    console.log(`[dev-server] refused a ticket for ${session.username || session.profileId}: tier ${tier || 'none'}`)
    return res.status(403).json({ error: 'notAllowed', tier })
  }
  const { ticket, payload } = signDevTicket(s.key, {
    profileId: session.profileId, discordId: session.discordId, username: session.username, tier, roles,
  }, { ttlSec: s.ttlSec })
  console.log(`[dev-server] ticket ${payload.n.slice(0, 8)} for ${session.username || session.profileId} (${tier}), until ${new Date(payload.exp * 1000).toISOString()}`)
  res.json({ ticket, expiresAt: payload.exp * 1000, tier, server: s.server, filesUrl: s.filesUrl })
})

module.exports = router
module.exports.settings = settings
