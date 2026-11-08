'use strict'
// The launcher's dev server option (routes/dev-server.js): only Lead GM and above get a ticket, the ticket verifies with the
// public key the dev server holds, and the whole thing is off until its three settings are present. Discord is faked.

const { test, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const http   = require('http')

require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
function stub(rel, exports) {
  const file = require.resolve(rel)
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}

const LEAD_GM = '1494126618065506425'
const OWNER = '1494126527489507369'
const ROLES = { lead: [LEAD_GM], owner: [OWNER], player: ['111111111111111111'], slow: null }
const SESSIONS = {
  lead: { profileId: 42, discordId: '310000000000000042', username: 'Lead' },
  owner: { profileId: 1, discordId: '310000000000000001', username: 'Nat' },
  player: { profileId: 77, discordId: '310000000000000077', username: 'Player' },
  slow: { profileId: 78, discordId: '310000000000000078', username: 'Slow' },
}
let roleCalls = 0
stub('../sources/discordBot', {
  getMemberRoles: async id => {
    roleCalls++
    const who = Object.keys(SESSIONS).find(k => SESSIONS[k].discordId === id)
    if (who === 'slow') throw new Error('discord down')
    return ROLES[who] || []
  },
  memberHasRole: async () => false,
})
stub('../routes/master-api', { lookupSession: t => SESSIONS[t] || null })

const express = require('express')
const { signDevTicket, publicKeyOf } = require('../scripts/dev-ticket')
const { privateKey } = crypto.generateKeyPairSync('ed25519')
const PRIVATE = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')
const PUBLIC = crypto.createPublicKey({ key: Buffer.from(publicKeyOf(privateKey), 'base64'), format: 'der', type: 'spki' })

const ENV = { DEV_TICKET_PRIVATE_KEY: PRIVATE, DEV_RELAY_ADDRESS: 'dev-relay.example.net', DEV_RELAY_PORT: '7777', DEV_FILES_URL: 'https://dev-relay.example.net/' }
let server, base
before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/files/dev', require('../routes/dev-server'))
  server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}/api/files/dev`
})
after(() => server.close())
beforeEach(() => { Object.assign(process.env, ENV); delete process.env.DEV_SERVER_TIERS; roleCalls = 0 })

async function call(method, route, session) {
  const res = await fetch(base + route, { method, headers: session ? { 'x-session': session } : {} })
  return { status: res.status, body: await res.json(), cache: res.headers.get('cache-control') }
}

function verify(ticket) {
  const [p, payload, sig] = ticket.split('.')
  assert.equal(p, 'dbodev1')
  assert.ok(crypto.verify(null, Buffer.from(`${p}.${payload}`), PUBLIC, Buffer.from(sig, 'base64url')), 'signature verifies with the public key')
  return JSON.parse(Buffer.from(payload, 'base64url'))
}

test('a Lead GM is told the selector applies and gets a ticket for the relay', async () => {
  const a = await call('GET', '/access', 'lead')
  assert.deepEqual(a.body, { enabled: true, allowed: true, tier: 'leadgm' })
  assert.equal(a.cache, 'no-store, private')
  const t = await call('POST', '/ticket', 'lead')
  assert.equal(t.status, 200)
  assert.deepEqual(t.body.server, { name: 'DragonBreak DEV', address: 'dev-relay.example.net', port: 7777 })
  assert.equal(t.body.filesUrl, 'https://dev-relay.example.net')
  const claims = verify(t.body.ticket)
  assert.equal(claims.aud, 'dbo-dev')
  assert.equal(claims.p, 42)
  assert.equal(claims.d, '310000000000000042')
  assert.equal(claims.t, 'leadgm')
  assert.deepEqual(claims.r, [LEAD_GM])
  assert.equal(claims.exp - claims.iat, 12 * 3600)
  assert.equal(t.body.expiresAt, claims.exp * 1000)
})

test('an owner gets one too', async () => {
  const t = await call('POST', '/ticket', 'owner')
  assert.equal(t.status, 200)
  assert.equal(verify(t.body.ticket).t, 'owner')
})

test('a player without a staff role is refused and never sees the selector', async () => {
  assert.deepEqual((await call('GET', '/access', 'player')).body, { enabled: true, allowed: false, tier: null })
  const t = await call('POST', '/ticket', 'player')
  assert.equal(t.status, 403)
  assert.equal(t.body.error, 'notAllowed')
  assert.equal(t.body.ticket, undefined)
})

test('when Discord cannot answer, nobody gets a ticket', async () => {
  assert.equal((await call('GET', '/access', 'slow')).body.allowed, false)
  const t = await call('POST', '/ticket', 'slow')
  assert.equal(t.status, 503)
  assert.equal(t.body.ticket, undefined)
})

test('no session or an unknown one is 401', async () => {
  assert.equal((await call('POST', '/ticket')).status, 401)
  assert.equal((await call('POST', '/ticket', 'nope')).status, 401)
  assert.equal((await call('GET', '/access', 'nope')).status, 401)
})

test('DEV_SERVER_TIERS narrows the list', async () => {
  process.env.DEV_SERVER_TIERS = 'owner'
  assert.equal((await call('POST', '/ticket', 'lead')).status, 403)
  assert.equal((await call('POST', '/ticket', 'owner')).status, 200)
})

for (const missing of ['DEV_TICKET_PRIVATE_KEY', 'DEV_RELAY_ADDRESS', 'DEV_FILES_URL']) {
  test(`off without ${missing}: no selector, no ticket, no Discord lookup`, async () => {
    delete process.env[missing]
    assert.deepEqual((await call('GET', '/access', 'lead')).body, { enabled: false, allowed: false, tier: null })
    const t = await call('POST', '/ticket', 'lead')
    assert.equal(t.status, 503)
    assert.equal(t.body.error, 'devServerOff')
    assert.equal(roleCalls, 0)
  })
}

test('a files URL that is not https leaves it off', async () => {
  process.env.DEV_FILES_URL = 'http://dev-relay.example.net'
  assert.equal((await call('POST', '/ticket', 'lead')).status, 503)
})

test('a key that is not Ed25519 leaves it off', async () => {
  process.env.DEV_TICKET_PRIVATE_KEY = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')
  assert.equal((await call('POST', '/ticket', 'lead')).status, 503)
})

test('the signer caps a ticket at 7 days, which the dev server also refuses past', () => {
  const { payload } = signDevTicket(privateKey, { profileId: 1, discordId: '310000000000000001', tier: 'owner' }, { ttlSec: 30 * 24 * 3600 })
  assert.equal(payload.exp - payload.iat, 7 * 24 * 3600)
})
