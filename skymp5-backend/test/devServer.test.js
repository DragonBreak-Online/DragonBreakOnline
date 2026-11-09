'use strict'
// The launcher's dev server option (routes/dev-server.js): only Lead GM and above get a ticket, the ticket verifies with the
// public key the dev server holds, dev's files come from a private R2 bucket only against a ticket, and the whole thing is
// off until its settings are present. Discord and R2 are faked.

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

const ENV = {
  DEV_TICKET_PRIVATE_KEY: PRIVATE, DEV_SERVER_ADDRESS: '198.51.100.20', DEV_SERVER_PORT: '7777',
  DEV_FILES_URL: 'https://dragonbreakonline.com/api/files/dev/',
  DEV_R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com', DEV_R2_BUCKET: 'dragonbreak-dev', DEV_R2_ACCESS_KEY_ID: 'AKID', DEV_R2_SECRET_ACCESS_KEY: 'SECRET',
}
// R2 is faked: the manifest object answers, anything else on the R2 host is 404
const realFetch = global.fetch
const r2Calls = []
const r2Manifest = JSON.stringify({ version: 'dev1', files: [] })
global.fetch = async (url, opts) => {
  const u = new URL(String(url))
  if (u.host !== 'acct.r2.cloudflarestorage.com') return realFetch(url, opts)
  r2Calls.push(u)
  if (u.pathname === '/dragonbreak-dev/manifest.json' && u.searchParams.get('X-Amz-Signature')) return new Response(r2Manifest, { status: 200 })
  return new Response('no', { status: 404 })
}
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
  Object.assign(process.env, ENV); delete process.env.DEV_SERVER_TIERS; roleCalls = 0; r2Calls.length = 0
  require('../routes/dev-server').resetCache()
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

test('DEV_SERVER_TIERS narrows the list', async () => {
  process.env.DEV_SERVER_TIERS = 'owner'
  assert.equal((await call('POST', '/ticket', 'lead')).status, 403)
  assert.equal((await call('POST', '/ticket', 'owner')).status, 200)
})

for (const missing of ['DEV_TICKET_PRIVATE_KEY', 'DEV_SERVER_ADDRESS', 'DEV_FILES_URL', 'DEV_R2_ENDPOINT', 'DEV_R2_BUCKET', 'DEV_R2_ACCESS_KEY_ID', 'DEV_R2_SECRET_ACCESS_KEY']) {
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

test('a Lead GM ticket reads dev\'s manifest from the private bucket, through a presigned URL, cached for a minute', async () => {
  const t = (await call('POST', '/ticket', 'lead')).body.ticket
  const m = await call('GET', '/manifest.json', null, withTicket(t))
  assert.equal(m.status, 200)
  assert.equal(m.body.version, 'dev1')
  assert.equal(r2Calls.length, 1)
  assert.equal(r2Calls[0].searchParams.get('X-Amz-Credential').split('/')[0], 'AKID')
  assert.ok(!r2Calls[0].href.includes('SECRET'), 'the secret never goes in a URL')
  await call('GET', '/manifest.json', null, withTicket(t))
  assert.equal(r2Calls.length, 1, 'the second read comes from the cache')
})

test('a file is a 302 to a 10-minute presigned R2 URL, and only by its sha256', async () => {
  const t = (await call('POST', '/ticket', 'lead')).body.ticket
  const sha = 'b'.repeat(64)
  const f = await call('GET', `/files/${sha}`, null, withTicket(t))
  assert.equal(f.status, 302)
  const loc = new URL(f.location)
  assert.equal(loc.host, 'acct.r2.cloudflarestorage.com')
  assert.equal(loc.pathname, `/dragonbreak-dev/files/${sha}`)
  assert.equal(loc.searchParams.get('X-Amz-Expires'), '600')
  assert.match(loc.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/)
  assert.equal((await call('GET', `/files/${'B'.repeat(64)}`, null, withTicket(t))).status, 404)
  assert.equal((await call('GET', '/files/..%2fmanifest.json', null, withTicket(t))).status, 404)
})

test('the dev files need a good ticket: none, a GM one, an expired one and a forged one are refused, and R2 is never asked', async () => {
  assert.equal((await call('GET', '/manifest.json')).status, 401)
  assert.equal((await call('GET', '/manifest.json', 'lead')).status, 401, 'a session alone is not a ticket')
  const claims = { profileId: 42, discordId: '310000000000000042', tier: 'gm' }
  assert.equal((await call('GET', '/manifest.json', null, withTicket(signDevTicket(privateKey, claims).ticket))).status, 403)
  const old = signDevTicket(privateKey, { ...claims, tier: 'leadgm' }, { nowSec: Math.floor(Date.now() / 1000) - 13 * 3600 }).ticket
  assert.equal((await call('GET', '/manifest.json', null, withTicket(old))).status, 403)
  const other = crypto.generateKeyPairSync('ed25519').privateKey
  assert.equal((await call('GET', `/files/${'c'.repeat(64)}`, null, withTicket(signDevTicket(other, { ...claims, tier: 'owner' }).ticket))).status, 403)
  assert.equal(r2Calls.length, 0)
})

test('the presigner reproduces the AWS SigV4 documented example', () => {
  const { presignGet } = require('../scripts/r2-presign')
  const u = presignGet('https://examplebucket.s3.amazonaws.com/test.txt', {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1', expiresSec: 86400, now: new Date('2013-05-24T00:00:00Z'),
  })
  assert.equal(new URL(u).searchParams.get('X-Amz-Signature'), 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')
})
