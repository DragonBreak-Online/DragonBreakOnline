'use strict'
// The launcher's dev server option (routes/dev-server.js): only Lead GM and above get a ticket, the ticket verifies with the
// public key the dev server holds, dev's files come from this server's disk only against a ticket, and the whole thing is
// off until its settings are present. Discord is faked.

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
const ADMIN = '1569131695897313290'
const TRIAL = '1558248795932860507'
const ROLES = { lead: [LEAD_GM], owner: [OWNER], player: ['111111111111111111'], slow: null, admin: [ADMIN], trial: [TRIAL] }
const SESSIONS = {
  lead: { profileId: 42, discordId: '310000000000000042', username: 'Lead' },
  owner: { profileId: 1, discordId: '310000000000000001', username: 'Nat' },
  player: { profileId: 77, discordId: '310000000000000077', username: 'Player' },
  slow: { profileId: 78, discordId: '310000000000000078', username: 'Slow' },
  admin: { profileId: 79, discordId: '310000000000000079', username: 'Jake' },
  trial: { profileId: 80, discordId: '310000000000000080', username: 'Trial' },
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

const ENV = {
  DEV_TICKET_PRIVATE_KEY: PRIVATE, DEV_SERVER_ADDRESS: '198.51.100.20', DEV_SERVER_PORT: '7777',
  DEV_FILES_URL: 'https://dragonbreakonline.com/api/files/dev/',
}
// Dev's files on disk, as the publisher leaves them: manifest.json and files/<sha256>
const fs = require('fs')
const os = require('os')
const pathMod = require('path')
const filesDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'dev-files-'))
const BLOB = Buffer.from('a dev plugin, hosted')
const BLOB_SHA = crypto.createHash('sha256').update(BLOB).digest('hex')
fs.mkdirSync(pathMod.join(filesDir, 'files'))
fs.writeFileSync(pathMod.join(filesDir, 'files', BLOB_SHA), BLOB)
fs.writeFileSync(pathMod.join(filesDir, 'manifest.json'), JSON.stringify({ version: 'dev1', files: [] }))
fs.writeFileSync(pathMod.join(filesDir, 'secret.txt'), 'not served')
ENV.DEV_FILES_DIR = filesDir
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
beforeEach(() => {
  Object.assign(process.env, ENV); delete process.env.DEV_SERVER_TIERS; process.env.DEV_SERVER_ROLE_IDS = ADMIN; roleCalls = 0
})

async function call(method, route, session, headers = {}) {
  const res = await fetch(base + route, { method, redirect: 'manual', headers: { ...(session ? { 'x-session': session } : {}), ...headers } })
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body, cache: res.headers.get('cache-control'), location: res.headers.get('location') }
}
const withTicket = t => ({ authorization: `DevTicket ${t}` })

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
  assert.deepEqual(t.body.server, { name: 'DragonBreak DEV', address: '198.51.100.20', port: 7777 })
  assert.equal(t.body.filesUrl, 'https://dragonbreakonline.com/api/files/dev')
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

test('a role listed in DEV_SERVER_ROLE_IDS (above Lead GM, no named tier) gets the selector and a leadgm pass', async () => {
  assert.deepEqual((await call('GET', '/access', 'admin')).body, { enabled: true, allowed: true, tier: 'leadgm' })
  const t = await call('POST', '/ticket', 'admin')
  assert.equal(t.status, 200)
  assert.equal(t.body.tier, 'leadgm')
})

test('a Trial GM and a player get no selector and no pass', async () => {
  for (const who of ['trial', 'player']) {
    assert.equal((await call('GET', '/access', who)).body.allowed, false)
    assert.equal((await call('POST', '/ticket', who)).status, 403)
  }
})

test('without DEV_SERVER_ROLE_IDS the extra role gets nothing', async () => {
  delete process.env.DEV_SERVER_ROLE_IDS
  assert.equal((await call('GET', '/access', 'admin')).body.allowed, false)
})

test('DEV_SERVER_TIERS narrows the list', async () => {
  process.env.DEV_SERVER_TIERS = 'owner'
  assert.equal((await call('POST', '/ticket', 'lead')).status, 403)
  assert.equal((await call('POST', '/ticket', 'owner')).status, 200)
})

for (const missing of ['DEV_TICKET_PRIVATE_KEY', 'DEV_SERVER_ADDRESS', 'DEV_FILES_URL']) {
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
  process.env.DEV_FILES_URL = 'http://dragonbreakonline.com/api/files/dev'
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

test('a Lead GM ticket reads dev\'s manifest from the dev files folder', async () => {
  const t = (await call('POST', '/ticket', 'lead')).body.ticket
  const m = await call('GET', '/manifest.json', null, withTicket(t))
  assert.equal(m.status, 200)
  assert.equal(m.body.version, 'dev1')
  assert.equal(m.cache, 'no-store, private')
})

test('a file is served by its sha256 only, with Range for a resumed download', async () => {
  const t = (await call('POST', '/ticket', 'lead')).body.ticket
  const f = await call('GET', `/files/${BLOB_SHA}`, null, withTicket(t))
  assert.equal(f.status, 200)
  assert.equal(f.body, BLOB.toString())
  const part = await fetch(`${base}/files/${BLOB_SHA}`, { headers: { ...withTicket(t), Range: 'bytes=6-' } })
  assert.equal(part.status, 206)
  assert.equal(await part.text(), BLOB.subarray(6).toString())
  assert.equal((await call('GET', `/files/${'d'.repeat(64)}`, null, withTicket(t))).status, 404)
  assert.equal((await call('GET', `/files/${BLOB_SHA.toUpperCase()}`, null, withTicket(t))).status, 404)
  for (const p of ['/secret.txt', '/files/..%2fsecret.txt', '/files/..%2f..%2fsecret.txt', '/files/', '/files']) {
    assert.equal((await call('GET', p, null, withTicket(t))).status, 404, p)
  }
})

test('the dev files need a good ticket: none, a session alone, a GM one, an expired one and a forged one are refused', async () => {
  assert.equal((await call('GET', '/manifest.json')).status, 401)
  assert.equal((await call('GET', '/manifest.json', 'lead')).status, 401, 'a session alone is not a ticket')
  const claims = { profileId: 42, discordId: '310000000000000042', tier: 'gm' }
  assert.equal((await call('GET', '/manifest.json', null, withTicket(signDevTicket(privateKey, claims).ticket))).status, 403)
  const old = signDevTicket(privateKey, { ...claims, tier: 'leadgm' }, { nowSec: Math.floor(Date.now() / 1000) - 13 * 3600 }).ticket
  assert.equal((await call('GET', '/manifest.json', null, withTicket(old))).status, 403)
  const other = crypto.generateKeyPairSync('ed25519').privateKey
  assert.equal((await call('GET', `/files/${BLOB_SHA}`, null, withTicket(signDevTicket(other, { ...claims, tier: 'owner' }).ticket))).status, 403)
})

test('a missing dev files folder answers 503 for the manifest, not a crash', async () => {
  process.env.DEV_FILES_DIR = pathMod.join(filesDir, 'nope')
  const t = (await call('POST', '/ticket', 'lead')).body.ticket
  assert.equal((await call('GET', '/manifest.json', null, withTicket(t))).status, 503)
})
