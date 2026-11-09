'use strict'
// Dev server tickets (routes/dev-server.js signs them, skymp5-server ts/systems/devTicket.ts checks them on the dev server)
// Format: dbodev1.<base64url payload>.<base64url Ed25519 signature over "dbodev1.<payload>">
//
//   node scripts/dev-ticket.js keygen   prints a new key pair: the private key goes in the backend's DEV_TICKET_PRIVATE_KEY,
//                                        the public key in the dev server's server-settings devTickets.publicKey and the
//                                        home server's UDP gate (dev-gate.js)

const crypto = require('crypto')

const PREFIX = 'dbodev1'
const AUDIENCE = 'dbo-dev'

function loadPrivateKey(text) {
  const t = String(text || '').trim()
  if (!t) return null
  const key = t.includes('BEGIN PRIVATE KEY')
    ? crypto.createPrivateKey(t)
    : crypto.createPrivateKey({ key: Buffer.from(t, 'base64'), format: 'der', type: 'pkcs8' })
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`DEV_TICKET_PRIVATE_KEY is ${key.asymmetricKeyType}, not ed25519`)
  return key
}

const publicKeyOf = privateKey => crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64')

// claims: { profileId, discordId, username, tier, roles }; ttlSec capped at 7 days, as the dev server refuses longer
function signDevTicket(privateKey, claims, { nowSec = Math.floor(Date.now() / 1000), ttlSec = 12 * 3600 } = {}) {
  const payload = {
    v: 1,
    aud: AUDIENCE,
    p: claims.profileId,
    d: String(claims.discordId),
    u: String(claims.username || '').slice(0, 64),
    t: claims.tier,
    r: (claims.roles || []).map(String),
    iat: nowSec,
    exp: nowSec + Math.min(ttlSec, 7 * 24 * 3600),
    n: crypto.randomBytes(12).toString('hex'),
  }
  const head = `${PREFIX}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
  const sig = crypto.sign(null, Buffer.from(head), privateKey).toString('base64url')
  return { ticket: `${head}.${sig}`, payload }
}

// The same rules as skymp5-server ts/systems/devTicket.ts; key is a public KeyObject (or the private one, whose public half is used)
function verifyDevTicket(ticket, key, nowSec = Math.floor(Date.now() / 1000), tiers = ['owner', 'dev', 'leadgm']) {
  if (typeof ticket !== 'string' || ticket.length > 4096) return { ok: false, reason: 'notAString' }
  const parts = ticket.split('.')
  const b64 = /^[A-Za-z0-9_-]+$/
  if (parts.length !== 3 || parts[0] !== PREFIX || !b64.test(parts[1]) || !b64.test(parts[2])) return { ok: false, reason: 'malformed' }
  const sig = Buffer.from(parts[2], 'base64url')
  if (sig.length !== 64) return { ok: false, reason: 'malformed' }
  const pub = key.type === 'private' ? crypto.createPublicKey(key) : key
  let valid = false
  try { valid = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), pub, sig) } catch { valid = false }
  if (!valid) return { ok: false, reason: 'badSignature' }
  let t
  try { t = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) } catch { return { ok: false, reason: 'malformed' } }
  if (!t || t.v !== 1 || t.aud !== AUDIENCE) return { ok: false, reason: 'wrongAudience' }
  if (!Number.isSafeInteger(t.p) || t.p <= 0 || typeof t.d !== 'string' || !/^\d{5,25}$/.test(t.d)) return { ok: false, reason: 'badClaims' }
  if (!Number.isSafeInteger(t.iat) || !Number.isSafeInteger(t.exp) || t.iat > nowSec + 120 || t.exp - t.iat > 7 * 24 * 3600) return { ok: false, reason: 'badTimes' }
  if (t.exp <= nowSec) return { ok: false, reason: 'expired' }
  if (!tiers.includes(t.t)) return { ok: false, reason: 'tierNotAllowed' }
  return { ok: true, ticket: t }
}

module.exports = { PREFIX, AUDIENCE, loadPrivateKey, publicKeyOf, signDevTicket, verifyDevTicket }

if (require.main === module && process.argv[2] === 'keygen') {
  const { privateKey } = crypto.generateKeyPairSync('ed25519')
  console.log('DEV_TICKET_PRIVATE_KEY=' + privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'))
  console.log('devTickets.publicKey  =' + publicKeyOf(privateKey))
}
