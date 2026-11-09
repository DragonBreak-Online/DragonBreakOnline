'use strict'

/**
 * The dev server option in the launcher, for Lead GM and above. Mounted by routes/files.js under /api/files/dev, a prefix the
 * public proxy already forwards. Off until DEV_TICKET_PRIVATE_KEY, DEV_SERVER_ADDRESS, an https DEV_FILES_URL and the
 * DEV_R2_* settings are all set.
 *   GET  /api/files/dev/access          (x-session)  -> { enabled, allowed, tier }: whether the launcher shows the selector
 *   POST /api/files/dev/ticket          (x-session)  -> { ticket, expiresAt, tier, server: { name, address, port }, filesUrl }
 *   GET  /api/files/dev/manifest.json   (Authorization: DevTicket <ticket>) -> dev's file list, read from the private R2 bucket
 *   GET  /api/files/dev/files/<sha256>  (Authorization: DevTicket <ticket>) -> 302 to a 10-minute presigned R2 URL
 * The ticket (scripts/dev-ticket.js) is what the dev server and the home server's UDP gate check; they never call this backend.
 * Tiers come from the Discord roles through the bot's role cache (sources/punish/tier.js order); no answer is no tier.
 * The bucket is private: DEV_R2_ACCESS_KEY_ID should be a read-only token for that bucket alone.
 */

const router = require('express').Router()
const { rateLimit } = require('express-rate-limit')
const discordBot = require('../sources/discordBot')
const { tierFromRoles } = require('../sources/punish/tier')
const { visitorKey } = require('../sources/clientFiles')
const { loadPrivateKey, signDevTicket, verifyDevTicket } = require('../scripts/dev-ticket')
const { presignGet } = require('../scripts/r2-presign')

const ROLE_CHECK_MS = 8000
const MANIFEST_CACHE_MS = 60 * 1000
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
  const r2 = {
    endpoint: String(env.DEV_R2_ENDPOINT || '').replace(/\/+$/, ''),
    bucket: String(env.DEV_R2_BUCKET || ''),
    accessKeyId: String(env.DEV_R2_ACCESS_KEY_ID || ''),
    secretAccessKey: String(env.DEV_R2_SECRET_ACCESS_KEY || ''),
  }
  return {
    key, keyError,
    tiers: list(env.DEV_SERVER_TIERS || 'owner,dev,leadgm'),
    ttlSec: Math.round(ttlHours * 3600),
    server: { name: env.DEV_SERVER_NAME || 'DragonBreak DEV', address: String(env.DEV_SERVER_ADDRESS || ''), port },
    filesUrl: /^https:\/\//i.test(filesUrl) ? filesUrl : '',
    r2: /^https:\/\//i.test(r2.endpoint) && /^[a-z0-9][a-z0-9-]{1,61}$/.test(r2.bucket) && r2.accessKeyId && r2.secretAccessKey ? r2 : null,
  }
}
const enabled = s => !!(s.key && s.server.address && Number.isInteger(s.server.port) && s.server.port > 0 && s.filesUrl && s.r2)
const objectUrl = (r2, key) => presignGet(`${r2.endpoint}/${r2.bucket}/${key}`, { ...r2, expiresSec: 600 })

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
// A first dev install asks for every hosted file once; the files are few (11 today), the ceiling is generous
const fileLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 2000,
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

let manifestCache = { at: 0, body: null, source: '' }
router.get('/manifest.json', limiter, requireTicket, async (req, res) => {
  const r2 = req.devSettings.r2
  const source = `${r2.endpoint}/${r2.bucket}`
  if (!manifestCache.body || manifestCache.source !== source || Date.now() - manifestCache.at > MANIFEST_CACHE_MS) {
    let r
    try { r = await fetch(objectUrl(r2, 'manifest.json'), { signal: AbortSignal.timeout(10000) }) }
    catch (err) { console.error('[dev-server] manifest fetch failed:', err.message); return res.status(502).json({ error: 'manifestUnavailable' }) }
    if (!r.ok) { console.error(`[dev-server] manifest fetch: HTTP ${r.status}`); return res.status(502).json({ error: 'manifestUnavailable' }) }
    const text = await r.text()
    try { JSON.parse(text) } catch { return res.status(502).json({ error: 'manifestUnreadable' }) }
    manifestCache = { at: Date.now(), body: text, source }
  }
  res.type('application/json').send(manifestCache.body)
})

router.get(/^\/files\/([0-9a-f]{64})$/, fileLimiter, requireTicket, (req, res) => {
  res.redirect(302, objectUrl(req.devSettings.r2, `files/${req.params[0]}`))
})

module.exports = router
module.exports.settings = settings
module.exports.resetCache = () => { manifestCache = { at: 0, body: null, source: '' } }
