'use strict'
// Dev server tickets (routes/dev-server.js signs them, skymp5-server ts/systems/devTicket.ts checks them on the dev server)
// Format: dbodev1.<base64url payload>.<base64url Ed25519 signature over "dbodev1.<payload>">
//
//   node scripts/dev-ticket.js keygen   prints a new key pair: the private key goes in the backend's DEV_TICKET_PRIVATE_KEY,
//                                        the public key in the dev server's server-settings devTickets.publicKey and the relay's file server

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

module.exports = { PREFIX, AUDIENCE, loadPrivateKey, publicKeyOf, signDevTicket }

if (require.main === module && process.argv[2] === 'keygen') {
  const { privateKey } = crypto.generateKeyPairSync('ed25519')
  console.log('DEV_TICKET_PRIVATE_KEY=' + privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'))
  console.log('devTickets.publicKey  =' + publicKeyOf(privateKey))
}
