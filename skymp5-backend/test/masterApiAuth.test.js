'use strict'
// F4 (security audit, 15 Oct 2026): the master key is public, so only the game server's X-Auth-Token may open the master-api routes that hand out player data

const { test, before, after } = require('node:test')
const assert  = require('node:assert/strict')
const express = require('express')
const fs      = require('fs')
const http    = require('http')
const os      = require('os')
const path    = require('path')
const { loadWithDataIn } = require('./helpers/dataDir')

// Never read a real .env, and keep the player, profile, access, ban and legal stores out of this test
require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
function stub(rel, exports) {
  const file = require.resolve(rel)
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
const KEY = 'public-master-key'
const TOKEN = 'server-only-token'
const PROFILES = { 21: '100000000000000021', 22: '100000000000000022' }
let accessLookups = 0
stub('../sources/players', {
  upsertFromDiscordUser: u => ({ profileId: Number(Object.keys(PROFILES).find(k => PROFILES[k] === u.id)) }),
  load: () => ({}),
  list: () => [],
  markGameJoin: () => {},
})
stub('../sources/profiles', {
  getDiscordIdByProfileId: id => PROFILES[id] || null,
  load: () => ({ map: Object.fromEntries(Object.entries(PROFILES).map(([id, discordId]) => [discordId, Number(id)])) }),
})
stub('../sources/serverAccess', { getDiscordAccess: async () => { accessLookups++; return { allowed: true, roles: ['fake-staff-role'] } } })
stub('../sources/bans', { isBanned: () => null, logBan: () => {} })
stub('../sources/legal', { gate: () => ({ ok: true }) })
const config = require('../config')
Object.assign(config, { serverMasterKey: KEY, masterApiAuthToken: TOKEN, launchCheckEnforce: false })

// Fake faction data: one staff-made hold rank with a staff note, as the dashboard writes it
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'master-api-auth-'))
const ROW = {
  id: 'fake-assignment-1', requirementId: 'hold:whiterun:steward', discordId: PROFILES[21], slot: null,
  playerName: 'Fake Steward', notes: 'fake staff-only note', createdAt: '2026-10-01T00:00:00.000Z',
  createdBy: '100000000000000099', updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: '100000000000000099',
}
fs.writeFileSync(path.join(tmp, 'faction-whitelist.json'), JSON.stringify({
  requirements: [{ id: 'hold:whiterun:steward', scope: 'hold', group: 'Whiterun', rank: 'Steward', permission: 'hold.whiterun.steward', capacity: 4 }],
  assignments: [ROW],
}))
const masterApi = loadWithDataIn(tmp, ['sessions.json', 'balances.json', 'faction-whitelist.json'], () => require('../routes/master-api'))

let server, root, session
before(async () => {
  session = masterApi.createSession({ id: PROFILES[21], username: 'fake-steward' }).session
  const app = express()
  app.use(express.json())
  app.use('/auth', masterApi)
  app.use('/api/servers', masterApi)
  server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  root = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  await new Promise(resolve => server.close(resolve))
  fs.rmSync(tmp, { recursive: true, force: true })
})

const call = async (method, url, token) => {
  const r = await fetch(`${root}${url}`, { method, headers: token === undefined ? {} : { 'x-auth-token': token }, signal: AbortSignal.timeout(5000) })
  return { status: r.status, body: await r.json() }
}
const base = `/api/servers/${KEY}`
const REFUSED = { status: 403, body: { error: 'Invalid auth token.' } }

test('the public master key alone opens neither the faction check nor the hold roster', async () => {
  accessLookups = 0
  assert.deepEqual(await call('GET', `${base}/profiles/21/check`), REFUSED)
  assert.deepEqual(await call('GET', `${base}/holds/whiterun/roster`), REFUSED)
  assert.deepEqual(await call('GET', `${base}/profiles/21/check`, 'wrong-token'), REFUSED)
  assert.deepEqual(await call('GET', `${base}/holds/whiterun/roster`, ''), REFUSED)
  // An unknown profile answers the same, so profile ids cannot be counted or probed for bans
  assert.deepEqual(await call('GET', `${base}/profiles/999/check`), REFUSED)
  assert.equal(accessLookups, 0, 'no Discord member lookup is made for a caller without the token')
})

test('the game server with its X-Auth-Token still gets the faction check and the hold roster', async () => {
  const check = await call('GET', `${base}/profiles/21/check`, TOKEN)
  assert.equal(check.status, 200)
  assert.equal(check.body.allowed, true)
  assert.deepEqual(check.body.factions.map(f => [f.id, f.requirementId, f.slot]), [[ROW.id, ROW.requirementId, null]])
  assert.deepEqual(await call('GET', `${base}/profiles/999/check`, TOKEN), { status: 404, body: { error: 'profileNotFound' } })
  const roster = await call('GET', `${base}/holds/whiterun/roster`, TOKEN)
  assert.equal(roster.status, 200)
  assert.deepEqual(roster.body.members.map(m => [m.profileId, m.playerName, m.rankSlug]), [[21, 'Fake Steward', 'steward']])
})

test('the login check still needs only the master key and the player\'s session, as the game server sends it', async () => {
  const r = await call('GET', `${base}/sessions/${session}`)
  assert.equal(r.status, 200)
  assert.equal(r.body.user.id, 21)
  assert.equal(r.body.user.discordId, PROFILES[21])
  assert.equal((await call('GET', `${base}/sessions/${session}/balance`)).status, 200)
  assert.equal((await call('GET', `${base}/sessions/not-a-session`)).status, 404)
})

// Only these routes open with the public key alone: each also needs a live session token, which only its player holds
const KEY_AND_SESSION = new Set(['GET /:key/sessions/:session', 'GET /:key/sessions/:session/balance'])
const SAMPLE = { key: KEY, session: 'not-a-session', profileId: '21', holdSlug: 'whiterun', assignmentId: ROW.id, discordId: PROFILES[22] }

test('every other master-api route refuses a caller with the master key but no X-Auth-Token', async () => {
  const routes = masterApi.stack.filter(layer => layer.route).flatMap(layer =>
    Object.keys(layer.route.methods).map(method => ({ method: method.toUpperCase(), path: layer.route.path })))
  assert.ok(routes.length >= 12, `found ${routes.length} routes`)
  for (const { method, path: routePath } of routes) {
    const name = `${method} ${routePath}`
    const url = routePath.replace(/:(\w+)/g, (_, p) => encodeURIComponent(SAMPLE[p]))
    const r = await call(method, routePath.startsWith('/:key') ? `/api/servers${url}` : `/auth${url}`)
    if (KEY_AND_SESSION.has(name)) assert.deepEqual(r, { status: 404, body: { error: 'Session not found or expired.' } }, name)
    else assert.deepEqual(r, REFUSED, name)
  }
})
