'use strict'

// The raw Windows machine id older launchers send is personal data: the old routes answer as before and store none of it (security audit L3-01)
const { test, before, after } = require('node:test')
const assert  = require('node:assert/strict')
const express = require('express')
const fs      = require('fs')
const http    = require('http')
const os      = require('os')
const path    = require('path')
const { loadWithDataIn } = require('./helpers/dataDir')

// Never read a real .env, and keep the faction, access, ban and legal stores out of this test
require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
function stub(file, exports) {
  const p = require.resolve(file)
  require.cache[p] = { id: p, filename: p, loaded: true, exports }
}
stub('../sources/factionWhitelist', { getPlayerAssignments: () => [], getPlayerFactionPermissions: () => [], getPlayerGameFactions: () => [] })
stub('../sources/serverAccess', { getDiscordAccess: async () => ({ allowed: true, roles: [] }) })
stub('../sources/bans', { isBanned: () => null, logBan: () => {}, list: () => [] })
stub('../sources/legal', { gate: () => ({ ok: true }) })
// The device check only counts a discarded value; counted here once the module exists
let discarded = 0
const DEVICE_CHECKS = path.join(__dirname, '..', 'sources', 'deviceChecks.js')
if (fs.existsSync(DEVICE_CHECKS)) stub(DEVICE_CHECKS, { legacyHwidDiscarded: () => { discarded++ } })
const config = require('../config')
const KEY = 'public-master-key'
Object.assign(config, { serverMasterKey: KEY, launchCheckEnforce: false })

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'me-hwid-no-raw-'))
const { masterApi, compat } = loadWithDataIn(tmp, ['sessions.json', 'profiles.json', 'players.json', 'auth-states.json'], () => ({
  masterApi: require('../routes/master-api'),
  compat: require('../routes/skymp-compat'),
}))
// Test-only Discord id and a made-up machine id in the MachineGuid format
const PLAYER = '310000000000000031'
const FAKE_GUID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'

let server, root, session
before(async () => {
  session = masterApi.createSession({ id: PLAYER, username: 'fake-player' }).session
  const app = express()
  app.use(express.json())
  app.use('/api/users', compat)
  server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  root = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  await new Promise(resolve => server.close(resolve))
  fs.rmSync(tmp, { recursive: true, force: true })
})

const post = async (url, headers, body) => {
  const r = await fetch(`${root}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) })
  return { status: r.status, body: await r.json() }
}
const stored = () => ['players.json', 'sessions.json'].map(f => fs.readFileSync(path.join(tmp, f), 'utf8')).join('\n')

test('POST /me/hwid answers as before and writes the machine id nowhere', async () => {
  const before = stored()
  assert.deepEqual(await post('/api/users/me/hwid', { authorization: `Bearer ${session}` }, { hwid: FAKE_GUID }), { status: 200, body: { ok: true } })
  assert.deepEqual(await post('/api/users/me/hwid', {}, { token: session, hwid: FAKE_GUID.toUpperCase() }), { status: 200, body: { ok: true } })
  assert.equal(stored(), before, 'players.json and sessions.json are unchanged')
  assert.ok(!stored().toLowerCase().includes(FAKE_GUID))
  assert.deepEqual(await post('/api/users/me/hwid', {}, { hwid: FAKE_GUID }), { status: 401, body: { error: 'Missing authorization header.' } })
})

test('POST /me/play with an hwid answers as before and writes it nowhere', async () => {
  const before = stored()
  assert.deepEqual(await post(`/api/users/me/play/${KEY}`, { authorization: session }, { hwid: FAKE_GUID }), { status: 200, body: { session } })
  assert.equal(stored(), before)
  const record = JSON.parse(fs.readFileSync(path.join(tmp, 'players.json'), 'utf8'))[PLAYER]
  assert.equal(record.hwid ?? null, null)
  const [, entry] = JSON.parse(fs.readFileSync(path.join(tmp, 'sessions.json'), 'utf8')).find(([t]) => t === session)
  assert.equal(entry.hwid, undefined)
  if (fs.existsSync(DEVICE_CHECKS)) assert.equal(discarded, 3, 'each discarded value is counted')
})
