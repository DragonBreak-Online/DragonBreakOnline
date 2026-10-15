'use strict'

// The staff dashboard's player list shows a device link only as a ban ref, never the hwid, the last ip or a code, and
// staff with players.manage can mark an account "not an alt" of a ban (security audit L3-01)
const { test, before, after } = require('node:test')
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
// Test-only Discord ids, profiles and dashboard tokens
const ULFR = '150000000000000015', AELA = '160000000000000016'
const PROFILES = { 15: ULFR, 16: AELA }
const REF = 'B-7KQ2MX'
const BANS = [{ discordId: ULFR, ref: REF, hwid: null, ip: null, reason: 'test', bannedAt: '2026-10-14T12:00:00.000Z', bannedBy: 'rowan_staff' }]
const RECORDS = {
  [ULFR]: { profileId: 15, discordId: ULFR, username: 'ulfr', hwid: 'FAKE-RAW-MACHINE-GUID', lastIp: '203.0.113.5', createdAt: '2026-09-01T00:00:00.000Z' },
  [AELA]: { profileId: 16, discordId: AELA, username: 'aela', hwid: null, lastIp: '203.0.113.6', createdAt: '2026-10-16T13:00:00.000Z' },
}
const DASH = {
  'token-manage': { username: 'rowan_staff', discordId: '170000000000000017', permissions: ['players.view', 'players.manage'] },
  'token-view': { username: 'viewer', discordId: '180000000000000018', permissions: ['players.view'] },
  'token-noname': { discordId: '190000000000000019', permissions: ['players.manage'] },
}
stub('../sources/dashboardSessions', { validate: token => DASH[token] || null })
stub('../sources/serverAccess', { getDiscordAccess: async () => ({ allowed: true, roles: [] }), setBanned: async () => ({}), setWhitelisted: async () => ({}) })
stub('../sources/factionWhitelist', { getPlayerAssignments: () => [], getPlayerFactionPermissions: () => [], getPlayerGameFactions: () => [] })
stub('../sources/profiles', {
  getDiscordIdByProfileId: id => PROFILES[id] || null,
  load: () => ({ nextId: 20, map: Object.fromEntries(Object.entries(PROFILES).map(([id, discordId]) => [discordId, Number(id)])) }),
})
// The site's cached character store, for the names in audit lines: Aela's characters, a deleted one, one stamped with another Discord id
const form = (profileId, name, tag, extra = {}) => ({
  cf: { displayName: name, dynamicFields: { ...(tag ? { 'private.charTag': tag } : {}), 'private.indexed.discordId': extra.stamp || AELA } },
  char: { profileId, deleted: !!extra.deleted, appearance: {} },
})
stub('../routes/site-auth', { internals: {
  readStore: () => [form(16, 'Aela Ironhand', 'K7Q2'), form(16, 'Aela Second', 'ZZ22'), form(16, 'Gone', 'DEAD', { deleted: true }),
    form(16, 'Not Hers', 'XXXX', { stamp: ULFR }), form(16, 'Name 1234567890', 'AB34'), form(16, 'Fourth', null)],
  dynamicFields: cf => cf.dynamicFields,
  ownedBy: (cf, id) => cf.dynamicFields['private.indexed.discordId'] === id,
  characterName: cf => cf.displayName,
} })
const row = id => ({ ...RECORDS[id], assignments: [], factionPermissions: [], gameFactions: [] })
stub('../sources/players', {
  list: () => Object.keys(RECORDS).map(row),
  getByProfileId: id => (PROFILES[id] ? row(PROFILES[id]) : null),
  load: () => RECORDS,
})
stub('../sources/bans', {
  isBanned: ({ discordId }) => BANS.find(b => b.discordId === discordId) || null,
  list: () => BANS,
  add: () => { throw new Error('not in this test') },
  removeByDiscordId: () => false,
  logBan: () => {},
})

const dc = require('../sources/deviceChecks')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'players-not-alt-'))
const lines = []
dc._test.reset()
dc._test.use({
  audit: text => lines.push(text),
  log: () => {},
  config: { deviceIdHmacKey: 'c3'.repeat(32), deviceMatch: 'report', deviceRetentionDays: 30, newAccountFlagDays: 0 },
  bans: () => BANS,
  players: () => RECORDS,
  who: id => ({ [ULFR]: 'Ulfr #AB12', [AELA]: 'Aela Ironhand #K7Q2' }[id]),
  store: path.join(tmp, 'device-ids.json'),
})
const code = pc => `v1.${crypto.createHash('sha256').update(`DragonBreak device v1\n${pc}`).digest('hex')}`
dc.onLaunchCheck('session-ulfr', { discordId: ULFR }, { device: code('shared-pc') })
dc.onLaunchCheck('session-aela', { discordId: AELA }, { device: code('shared-pc') })
assert.equal(lines.filter(l => l.startsWith('ALT CHECK')).length, 1)
lines.length = 0
const route = require('../routes/players')

let server, root
before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/players', route)
  server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  root = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  await new Promise(resolve => server.close(resolve))
  dc._test.reset()
  fs.rmSync(tmp, { recursive: true, force: true })
})

async function call(method, url, token, body) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }
  const r = await fetch(`${root}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) })
  const text = await r.text()
  return { status: r.status, text, body: JSON.parse(text) }
}

test('the player list carries no hwid, last ip or code; a banned account shows its ref, a linked one the link', async () => {
  const r = await call('GET', '/api/players', 'token-view')
  assert.equal(r.status, 200)
  assert.ok(!r.text.includes('FAKE-RAW-MACHINE-GUID'))
  assert.ok(!r.text.includes('203.0.113.'))
  assert.doesNotMatch(r.text, /"hwid"|"lastIp"/)
  assert.doesNotMatch(r.text, /[0-9a-f]{32}/, 'no stored code')
  const [ulfr, aela] = r.body.players
  assert.equal(ulfr.ban.ref, REF)
  assert.deepEqual(ulfr.device, { links: [] })
  assert.equal(aela.ban, null)
  assert.deepEqual(aela.device, { links: [{ banRef: REF, notAlt: false, sharedAccounts: 0, bound: false, createdVsBanDays: 2 }] })
})

test('marking "not an alt" needs players.manage', async () => {
  assert.equal((await call('PUT', '/api/players/16/not-alt', null, { banRef: REF, notAlt: true })).status, 401)
  assert.equal((await call('PUT', '/api/players/16/not-alt', 'token-view', { banRef: REF, notAlt: true })).status, 403)
  assert.deepEqual(lines, [])
})

test('the ban ref must be one, and a link to it must exist', async () => {
  for (const body of [{ banRef: 'B-OOOOOO', notAlt: true }, { banRef: 'nonsense', notAlt: true }, { banRef: REF }, { banRef: REF, notAlt: 'yes' }, {}]) {
    assert.equal((await call('PUT', '/api/players/16/not-alt', 'token-manage', body)).status, 400, JSON.stringify(body))
  }
  assert.deepEqual((await call('PUT', '/api/players/16/not-alt', 'token-manage', { banRef: 'B-NNNNNN', notAlt: true })).body, { error: 'noSuchLink' })
  assert.deepEqual((await call('PUT', '/api/players/15/not-alt', 'token-manage', { banRef: REF, notAlt: true })).body, { error: 'noSuchLink' }, 'not on the banned account itself')
  assert.equal((await call('PUT', '/api/players/99/not-alt', 'token-manage', { banRef: REF, notAlt: true })).status, 404)
  assert.deepEqual(lines, [])
})

test('"Not an alt" writes the audit line, and pressing Undo takes it back', async () => {
  const marked = await call('PUT', '/api/players/16/not-alt', 'token-manage', { banRef: REF, notAlt: true })
  assert.equal(marked.status, 200)
  assert.equal(marked.body.changed, true)
  assert.equal(marked.body.player.device.links[0].notAlt, true)
  assert.deepEqual(lines, ['NOT AN ALT Aela Ironhand #K7Q2 for ban B-7KQ2MX, marked by rowan_staff.'])
  const undone = await call('PUT', '/api/players/16/not-alt', 'token-noname', { banRef: REF, notAlt: false })
  assert.equal(undone.status, 200)
  assert.equal(undone.body.player.device.links[0].notAlt, false)
  assert.equal(lines[1], 'NOT AN ALT Aela Ironhand #K7Q2 for ban B-7KQ2MX, mark removed by a staff member.', 'never the staff member\'s id')
  assert.ok(!marked.text.includes('FAKE-RAW-MACHINE-GUID') && !undone.text.includes('203.0.113.'))
})

test('players are named by up to 3 characters and their #TAGs, from the site\'s character store, never by an id', async () => {
  dc._test.use({ who: null })
  lines.length = 0
  await call('PUT', '/api/players/16/not-alt', 'token-manage', { banRef: REF, notAlt: true })
  await call('PUT', '/api/players/16/not-alt', 'token-manage', { banRef: REF, notAlt: false })
  assert.deepEqual(lines, [
    'NOT AN ALT Aela Ironhand #K7Q2, Aela Second #ZZ22, Name … #AB34 and 1 more for ban B-7KQ2MX, marked by rowan_staff.',
    'NOT AN ALT Aela Ironhand #K7Q2, Aela Second #ZZ22, Name … #AB34 and 1 more for ban B-7KQ2MX, mark removed by rowan_staff.',
  ])
  dc.onLaunchCheck('session-third', { discordId: '200000000000000020' }, { device: code('shared-pc') })
  assert.match(lines[2], /^ALT CHECK \(report only\) a player with no character yet: plays on a PC linked to banned account a player with no character yet \(ban B-7KQ2MX, /)
  for (const line of lines) assert.doesNotMatch(line, /\d{5,}|profile/)
})
