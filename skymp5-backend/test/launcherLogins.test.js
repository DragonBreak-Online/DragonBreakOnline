'use strict'
// F1: the launcher login store (sources/launcherLogins.js) on a fake clock: lifetimes, one-time use, the PKCE check and the file it keeps

const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs     = require('fs')
const os     = require('os')
const path   = require('path')
const { createLoginStore, TTL, s256, b64url } = require('../sources/launcherLogins')

const quiet = { log: () => {}, error: () => {} }
const clock = () => { let t = 1_800_000_000_000; return { now: () => t, tick: ms => { t += ms } } }
const user = { id: '320000000000000001', username: 'gamma', avatar: null }
const verifierPair = () => { const v = b64url(crypto.randomBytes(32)); return { v, c: s256(v) } }

function loopbackAtCode(store) {
  const { v, c } = verifierPair()
  const { state } = store.issue('loopback', { challenge: c, port: 50000 })
  store.beginCallback(state)
  const { code } = store.discordDone(state, user)
  return { state, code, verifier: v }
}

test('an old launcher state expires 5 minutes after it was first opened, however often it is reopened', () => {
  const c = clock()
  const store = createLoginStore({ now: c.now, log: quiet })
  const state = crypto.randomBytes(32).toString('hex')
  assert.equal(store.registerLegacy(state), 'created')
  c.tick(TTL.legacyPending - 1000)
  assert.equal(store.registerLegacy(state), 'exists')
  c.tick(2000)
  assert.equal(store.peek(state), null)
  for (const bad of ['a', 'G'.repeat(64), 'a'.repeat(63), 42, null]) assert.equal(store.registerLegacy(bad), 'invalid')
})

test('a loopback code lives 30 seconds and is traded only with its own verifier', () => {
  const c = clock()
  const store = createLoginStore({ now: c.now, log: quiet })
  const a = loopbackAtCode(store)
  assert.equal(store.exchange(a.state, a.code, verifierPair().v), null)
  assert.deepEqual(store.exchange(a.state, a.code, a.verifier), user)
  assert.equal(store.exchange(a.state, a.code, a.verifier), null, 'once')
  const b = loopbackAtCode(store)
  c.tick(TTL.code + 1)
  assert.equal(store.exchange(b.state, b.code, b.verifier), null, 'expired')
})

test('five failed exchanges drop the login', () => {
  const store = createLoginStore({ log: quiet })
  const a = loopbackAtCode(store)
  for (let i = 0; i < 5; i++) assert.equal(store.exchange(a.state, 'f'.repeat(64), a.verifier), null)
  assert.equal(store.exchange(a.state, a.code, a.verifier), null)
})

test('a state is taken by one Discord callback only', () => {
  const store = createLoginStore({ log: quiet })
  const { state } = store.issue('device')
  assert.deepEqual(store.beginCallback(state), { flow: 'device' })
  assert.equal(store.beginCallback(state), null)
  const loop = store.issue('loopback', { challenge: verifierPair().c, port: 50001 }).state
  assert.deepEqual(store.beginCallback(loop), { flow: 'loopback', port: 50001 })
})

test('the old status route never answers for a loopback or device login', () => {
  const store = createLoginStore({ log: quiet })
  const { state, deviceCode, userCode } = store.issue('device')
  store.beginCallback(state)
  const { nonce } = store.discordDone(state, user)
  assert.equal(store.confirm(state, nonce, userCode).result, 'ok')
  assert.deepEqual(store.legacyStatus(state), { gone: true })
  assert.deepEqual(store.poll(state, deviceCode), { user })
})

test('an issued state the browser never opened expires after 10 minutes', () => {
  const c = clock()
  const store = createLoginStore({ now: c.now, log: quiet })
  const { state } = store.issue('device')
  c.tick(TTL.pending + 1)
  assert.equal(store.beginCallback(state), null)
})

test('a full store pushes out the oldest login still waiting for its browser, not one at Discord', () => {
  const store = createLoginStore({ max: 3, log: quiet })
  const first = store.issue('device').state
  store.beginCallback(first)
  const second = store.issue('device').state
  store.issue('device')
  store.issue('device')
  assert.ok(store.peek(first), 'the login at Discord stays')
  assert.equal(store.peek(second), null, 'the oldest waiting one went')
  assert.equal(store.size(), 3)
})

test('the file keeps in-flight logins across a restart, 0600, and the old format is wiped at load', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-logins-'))
  try {
    const file = path.join(dir, 'auth-states.json')
    fs.writeFileSync(file, JSON.stringify([['abc', { status: 'done', session: 'old-session-token', expiresAt: Date.now() + 60000 }]]))
    const store = createLoginStore({ file, log: quiet })
    assert.ok(!fs.readFileSync(file, 'utf8').includes('old-session-token'), 'the old file is overwritten at load')
    assert.equal(store.size(), 0)
    const { state, deviceCode } = store.issue('device')
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    const again = createLoginStore({ file, log: quiet })
    assert.deepEqual(again.poll(state, deviceCode), { pending: true }, 'restored after a restart')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
