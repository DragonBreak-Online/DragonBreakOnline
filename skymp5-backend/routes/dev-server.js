'use strict'

/**
 * The dev server option in the launcher, for Lead GM and above. Mounted by routes/files.js under /api/files/dev, a prefix the
 * public proxy already forwards. Off until DEV_TICKET_PRIVATE_KEY, DEV_SERVER_ADDRESS and an https DEV_FILES_URL are set.
 *   GET  /api/files/dev/access          (x-session)  -> { enabled, allowed, tier }: whether the launcher shows the selector
 *   POST /api/files/dev/ticket          (x-session)  -> { ticket, expiresAt, tier, server: { name, address, port }, filesUrl }
 *   GET  /api/files/dev/manifest.json   (Authorization: DevTicket <ticket>) -> dev's file list
 *   GET  /api/files/dev/files/<sha256>  (Authorization: DevTicket <ticket>) -> one file, by content hash (Range for resumes)
 * The files live on this server's disk in DEV_FILES_DIR (default <client files>/dev: manifest.json, files/<sha256>), pushed
 * there by the dev box's publisher with an rrsync-only key; nothing in that folder is served without a pass.
 * The ticket (scripts/dev-ticket.js) is what the dev server and the home server's UDP gate check; they never call this backend.
 * Tiers come from the Discord roles through the bot's role cache (sources/punish/tier.js order); no answer is no tier.
 */

const router = require('express').Router()
const { rateLimit } = require('express-rate-limit')
const discordBot = require('../sources/discordBot')
const { tierFromRoles } = require('../sources/punish/tier')
const { visitorKey } = require('../sources/clientFiles')
const { loadPrivateKey, signDevTicket, verifyDevTicket } = require('../scripts/dev-ticket')
const fs = require('fs')
const path = require('path')
const config = require('../config')

const ROLE_CHECK_MS = 8000
const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean)

// Read per request, so tests and an env reload need no restart of this module
function settings() {
  const env = process.env
  let key = null
  let keyError = null
  try { key = loadPrivateKey(env.DEV_TICKET_PRIVATE_KEY) } catch (err) { keyError = err.message }
  const port = parseInt(env.DEV_SERVER_PORT || '7777', 10)
  const ttlHours = Math.min(Math.max(parseFloat(env.DEV_TICKET_TTL_HOURS || '12') || 12, 0.25), 168)
  const filesUrl = String(env.DEV_FILES_URL || '').replace(/\/+$/, '')
  return {
    key, keyError,
    tiers: list(env.DEV_SERVER_TIERS || 'owner,dev,leadgm'),
    // Nat, 9 Nov 2026: "Lead GMs and above roles". Discord roles that sit above Lead GM without being one of the named
    // tiers (ADMIN Admin, Lore Master, Concept Artist, Map Dev, 3D Modeler...): holding one counts as leadgm here
    roleIds: list(env.DEV_SERVER_ROLE_IDS),
    ttlSec: Math.round(ttlHours * 3600),
    server: { name: env.DEV_SERVER_NAME || 'DragonBreak DEV', address: String(env.DEV_SERVER_ADDRESS || ''), port },
    filesUrl: /^https:\/\//i.test(filesUrl) ? filesUrl : '',
    filesDir: path.resolve(env.DEV_FILES_DIR || path.join(config.clientFilesDir, 'dev')),
  }
}
// The tier a member uses the dev server with: their named tier if it is allowed, else leadgm when they hold one of
// DEV_SERVER_ROLE_IDS (and leadgm is allowed), else null
function devTier(roles, s) {
  const tier = tierFromRoles(roles)
  if (tier && s.tiers.includes(tier)) return tier
  if (s.tiers.includes('leadgm') && roles.some(r => s.roleIds.includes(String(r)))) return 'leadgm'
  return null
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

// The dev file routes take the ticket, not the session: no Discord lookup per file, and a file request proves the same pass
function requireTicket(req, res, next) {
  const s = settings()
  if (!enabled(s)) return res.status(503).json({ error: 'devServerOff' })
  const m = String(req.headers.authorization || '').match(/^DevTicket (\S+)$/)
  if (!m) return res.status(401).json({ error: 'noTicket' })
  const v = verifyDevTicket(m[1], s.key, Math.floor(Date.now() / 1000), s.tiers)
  if (!v.ok) return res.status(403).json({ error: v.reason })
  req.devSettings = s
  req.devTicket = v.ticket
  next()
}

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: visitorKey,
  message: { error: 'Too many requests. Please try again later.' },
})
// A first dev install asks for every hosted file once (about 9,600 on 9 Nov), so the ceiling sits well above that
const fileLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30000,
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
  const tier = roles ? devTier(roles, s) : null
  res.json({ enabled: true, allowed: !!tier, tier })
})

router.post('/ticket', limiter, async (req, res) => {
  const s = settings()
  if (s.keyError) console.error('[dev-server] DEV_TICKET_PRIVATE_KEY is unusable:', s.keyError)
  if (!enabled(s)) return res.status(503).json({ error: 'devServerOff' })
  const session = sessionOf(req, res)
  if (!session) return
  const roles = await rolesOf(session.discordId)
  if (!roles) return res.status(503).json({ error: 'rolesUnavailable' })
  const tier = devTier(roles, s)
  if (!tier) {
    const named = tierFromRoles(roles)
    console.log(`[dev-server] refused a ticket for ${session.username || session.profileId}: tier ${named || 'none'}`)
    return res.status(403).json({ error: 'notAllowed', tier: named })
  }
  const { ticket, payload } = signDevTicket(s.key, {
    profileId: session.profileId, discordId: session.discordId, username: session.username, tier, roles,
  }, { ttlSec: s.ttlSec })
  console.log(`[dev-server] ticket ${payload.n.slice(0, 8)} for ${session.username || session.profileId} (${tier}), until ${new Date(payload.exp * 1000).toISOString()}`)
  res.json({ ticket, expiresAt: payload.exp * 1000, tier, server: s.server, filesUrl: s.filesUrl })
})

router.get('/manifest.json', limiter, requireTicket, (req, res) => {
  const file = path.join(req.devSettings.filesDir, 'manifest.json')
  fs.readFile(file, 'utf8', (err, text) => {
    if (err) return res.status(503).json({ error: 'manifestUnavailable' })
    try { JSON.parse(text) } catch { return res.status(503).json({ error: 'manifestUnreadable' }) }
    res.type('application/json').send(text)
  })
})

router.get(/^\/files\/([0-9a-f]{64})$/, fileLimiter, requireTicket, (req, res) => {
  const root = path.join(req.devSettings.filesDir, 'files')
  res.sendFile(req.params[0], { root, dotfiles: 'deny', cacheControl: false, headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store, private' } },
    err => { if (err && !res.headersSent) res.status(err.status === 404 ? 404 : 500).json({ error: err.status === 404 ? 'notFound' : 'readFailed' }) })
})

module.exports = router
module.exports.settings = settings
