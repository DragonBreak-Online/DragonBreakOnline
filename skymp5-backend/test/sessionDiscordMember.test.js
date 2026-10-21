'use strict'
// The game server's session check carries the backend's Discord membership answer, which the game server uses when its own lookup is rate limited

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const http   = require('http')
const os     = require('os')
const path   = require('path')
const { loadWithDataIn } = require('./helpers/dataDir')

require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'session-member-'))
function stub(rel, exports) {
  const file = require.resolve(rel)
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
const PROFILES = { 31: '300000000000000001', 32: '300000000000000002', 33: '300000000000000003' }
const MEMBER = { [PROFILES[31]]: true, [PROFILES[32]]: null, [PROFILES[33]]: false }
stub('../sources/players', {
  upsertFromDiscordUser: u => ({ profileId: Number(Object.keys(PROFILES).find(k => PROFILES[k] === u.id)) }),
  load: () => ({}),
  markGameJoin: () => {},
})
stub('../sources/serverAccess', {
  getDiscordAccess: async id => (MEMBER[id] === false
    ? { allowed: false, error: 'notWhitelisted', reason: 'notInDiscord', roles: [], member: false }
    : { allowed: true, roles: ['R1'], member: MEMBER[id] }),
})
stub('../sources/bans', { isBanned: () => null, logBan: () => {} })
stub('../sources/profiles', { getDiscordIdByProfileId: id => PROFILES[id] || null })
stub('../sources/factionWhitelist', { getPlayerFactionPermissions: () => [], getPlayerGameFactions: () => [], getPlayerAssignments: () => [] })
const config = require('../config')
Object.assign(config, { serverMasterKey: 'test-key', masterApiAuthToken: 'test-token', launchCheckEnforce: false, legalRequired: false })

const express = require('express')
const masterApi = loadWithDataIn(tmp, ['sessions.json'], () => require('../routes/master-api'))
let server, base
const tokens = {}

before(async () => {
  for (const id of Object.keys(PROFILES)) tokens[id] = masterApi.createSession({ id: PROFILES[id], username: `p${id}` }).session
  const app = express()
  app.use('/api/servers', masterApi)
  server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}/api/servers/test-key`
})

after(async () => {
  await new Promise(resolve => server.close(resolve))
  fs.rmSync(tmp, { recursive: true, force: true })
})

const session = async token => {
  const r = await fetch(`${base}/sessions/${token}`, { headers: { 'x-auth-token': 'test-token' } })
  return { status: r.status, body: await r.json() }
}

test('a member found in the Discord is sent as discordMember true, with the roles', async () => {
  const { status, body } = await session(tokens[31])
  assert.equal(status, 200)
  assert.equal(body.user.discordMember, true)
  assert.deepEqual(body.user.roles, ['R1'])
})

test('membership the backend could not read is sent as null, never true', async () => {
  const { status, body } = await session(tokens[32])
  assert.equal(status, 200)
  assert.equal(body.user.discordMember, null)
})

test('someone not in the Discord is still refused by the backend itself', async () => {
  assert.deepEqual(await session(tokens[33]), { status: 403, body: { error: 'notWhitelisted' } })
})
