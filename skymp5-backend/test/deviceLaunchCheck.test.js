'use strict'

// POST /api/launch-check answers the same bytes with or without a device code, and with or without a match (security audit L3-01)
const { test, before, after, mock } = require('node:test')
const assert  = require('node:assert/strict')
const crypto  = require('crypto')
const express = require('express')
const fs      = require('fs')
const http    = require('http')
const os      = require('os')
const path    = require('path')

require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
function stub(rel, exports) {
  const file = require.resolve(rel)
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
// Test-only Discord ids and session tokens
const BANNED = '120000000000000012', ALT = '130000000000000013', OLD = '140000000000000014'
const SESSIONS = {
  'session-banned': { discordId: BANNED, profileId: 12 },
  'session-alt': { discordId: ALT, profileId: 13, flow: 'loopback' },
  'session-old': { discordId: OLD, profileId: 14 },
}
const checks = []
stub('../routes/master-api', {
  lookupSession: token => SESSIONS[token] || null,
  recordLaunchCheck: (token, check) => { checks.push([token, check]) },
  currentFilesVersion: () => 'files-7',
})
stub('../routes/serverinfo', { getGameLoadOrder: async () => ['Skyrim.esm', 'DragonBreak.esp'] })

const dc = require('../sources/deviceChecks')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'device-launch-check-'))
const STORE = path.join(tmp, 'device-ids.json')
const lines = []
dc._test.reset()
dc._test.use({
  audit: text => lines.push(text),
  log: () => {},
  config: { deviceIdHmacKey: 'b2'.repeat(32), deviceMatch: 'report', deviceRetentionDays: 30, newAccountFlagDays: 0 },
  bans: () => [{ discordId: BANNED, ref: 'B-7KQ2MX', bannedAt: '2026-10-14T12:00:00.000Z' }],
  players: () => ({}),
  who: () => 'a player with no character yet',
  store: STORE,
})
const route = require('../routes/launch-check')

let server, root
before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/launch-check', route)
  server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  root = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  await new Promise(resolve => server.close(resolve))
  dc._test.reset()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const code = pc => `v1.${crypto.createHash('sha256').update(`DragonBreak device v1\n${pc}`).digest('hex')}`
const settle = () => new Promise(resolve => setTimeout(resolve, 20))
async function check(session, extra = {}, files = 'files-7') {
  const r = await fetch(`${root}/api/launch-check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session': session },
    body: JSON.stringify({ filesVersion: files, plugins: ['DragonBreak.esp'], ...extra }),
    signal: AbortSignal.timeout(5000),
  })
  const text = await r.text()
  await settle()
  return { status: r.status, type: r.headers.get('content-type'), length: r.headers.get('content-length'), text }
}

test('the answer is byte-identical with a device code, without one, and when it matches a banned account', async () => {
  const plain = await check('session-old')
  assert.equal(plain.status, 200)
  assert.deepEqual(JSON.parse(plain.text), { ok: true, filesOk: true, pluginsOk: true, requiredVersion: 'files-7' })
  assert.deepEqual(await check('session-old', { device: code('pc-old') }), plain)
  assert.deepEqual(await check('session-banned', { device: code('pc-shared') }), plain)
  assert.deepEqual(await check('session-alt', { device: code('pc-shared') }), plain)
  assert.equal(lines.filter(l => l.startsWith('ALT CHECK')).length, 1, 'the match was found, after the answer')
  assert.deepEqual(await check('session-alt', { device: 'not-a-code' }), plain)
  assert.deepEqual(await check('session-alt', { deviceStatus: 'unavailable' }), plain)
  const stale = await check('session-old', {}, 'files-6')
  assert.equal(JSON.parse(stale.text).ok, false)
  assert.deepEqual(await check('session-old', { device: code('pc-old') }, 'files-6'), stale)
  assert.deepEqual(await check('session-alt', { device: code('pc-shared') }, 'files-6'), stale)
  assert.equal((await check('no-such-session', { device: code('pc-old') })).status, 401)
})

test('an older launcher\'s body stores nothing; "unavailable" is counted', async () => {
  fs.rmSync(STORE, { force: true })
  dc._test.reset()
  dc._test.use({ store: STORE })
  await check('session-old')
  await check('session-old', { deviceStatus: 'unavailable' })
  assert.equal(fs.existsSync(STORE), false)
  assert.equal(dc._test.state().counts.none, 1)
  assert.equal(dc._test.state().counts.unavailable, 1)
  await check('session-old', { device: code('pc-old') })
  const text = fs.readFileSync(STORE, 'utf8')
  assert.ok(!text.includes(code('pc-old').slice(3)), 'only the keyed code is stored')
  assert.deepEqual(Object.keys(JSON.parse(text).accounts), [OLD])
})

test('a device store that cannot be read leaves launch-check answering 200 and the file as it was', async () => {
  dc._test.reset()
  dc._test.use({ store: STORE })
  fs.writeFileSync(STORE, 'not json')
  const errors = []
  mock.method(console, 'error', (...args) => { errors.push(args.join(' ')) })
  try {
    const r = await check('session-alt', { device: code('pc-shared') })
    assert.equal(r.status, 200)
    assert.equal(JSON.parse(r.text).ok, true)
    assert.equal((await check('session-alt', { device: code('pc-shared') })).status, 200)
  } finally { mock.restoreAll() }
  assert.equal(fs.readFileSync(STORE, 'utf8'), 'not json')
  assert.equal(errors.length, 1)
  assert.equal(checks.at(-1)[1].filesOk, true, 'the launch check itself was still recorded')
})
