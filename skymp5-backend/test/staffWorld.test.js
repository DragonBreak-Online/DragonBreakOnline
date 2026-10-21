'use strict'
// GET /api/site/staff/world: the game's supernatural counts for Owners and Dragon Break Dev only, counts alone, never in /api/metrics

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

const ROLES = { 'id-owner': ['role-owner'], 'id-dev': ['role-dev'], 'id-lead': ['role-lead'], 'id-gm': ['role-gm'], 'id-none': [] }
const USERS = Object.fromEntries(Object.keys(ROLES).map(id => [id, { discordId: id, username: id.slice(3) }]))
const stub = (rel, exports) => {
  const file = require.resolve(path.join('..', rel))
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
stub('routes/site-auth.js', {
  internals: { currentSession: req => USERS[req.headers['x-test-user']] || null, readStore: () => [], toSiteCharacter: () => ({}), profileIdOf: () => 0, dynamicFields: () => ({}) },
})
stub('sources/discordBot.js', { memberHasRole: async (id, role) => (ROLES[id] || []).includes(role), getMemberRoles: async id => ROLES[id] || [] })
stub('sources/players.js', { load: () => ({}) })
stub('sources/nameTable.js', { load: () => ({}) })
stub('routes/servers.js', { getHeartbeat: () => null })

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-staff-world-'))
const STAFF = path.join(DIR, 'staff-stats.json')
const PUBLIC = path.join(DIR, 'server-stats.json')
process.env.WORLD_STATS_FILE = PUBLIC

const express = require('express')
const config = require('../config')

const t = (total, online, accounts) => ({ total, online, accounts })
const RANKS = (names, counts) => names.map((name, i) => ({ name, count: counts[i] }))
const BLOOD = ['Fledgling', 'Vampire', 'Nightstalker', 'Mistwalker', 'Master Vampire']
const HUNT = ['Fledgling', 'Prowler', 'Hunter', 'Blood-Howler', 'Elder']
// What worldstats.js writes, plus what a careless writer might add: none of the extras may reach the page
const FILE = (at = new Date().toISOString()) => ({
  v: 1, updatedAt: at, characters: 296, accounts: 210, online: 40,
  ids: [4278845441], names: ['Valerica Bloodmoon'],
  vampire: { ...t(28, 3, 25), pure: 27, unfed: 0, thirst: [6, 1, 0, 21], ranks: RANKS(BLOOD, [10, 7, 2, 8, 1]), crown: 'held', holder: 4278845441, holderName: 'Valerica Bloodmoon', lordForm: 0, who: ['Valerica Bloodmoon'] },
  werewolf: { ...t(10, 1, 10), blessed: 1, inPack: 0, lone: 10, ranks: RANKS(HUNT, [2, 3, 1, 1, 3]), beastForm: 0, discordIds: ['123456789012345678'] },
  fever: { vampire: t(10, 0, 9), werewolf: t(5, 0, 5) },
  grant: { werewolf: t(3, 0, 3), vampireLord: t(0, 0, 0) },
  houses: [
    { name: 'Clan Volkihar', circle: 'vampire', pack: false, members: 0, cursed: 0, online: 0, roster: ['Valerica Bloodmoon'] },
    { name: "Hircine's Pack of the Jerall", circle: 'werewolf', pack: true, members: 0, cursed: 0, online: 0 },
    { name: 'Cult of Molag Bal', circle: 'cult', pack: false, members: 4, cursed: 0, online: 0 },
  ],
})
const EXPECTED = {
  stale: false, characters: 296, accounts: 210, online: 40,
  vampire: { ...t(28, 3, 25), pure: 27, unfed: 0, thirst: [6, 1, 0, 21], ranks: RANKS(BLOOD, [10, 7, 2, 8, 1]), crown: 'held', lordForm: 0 },
  werewolf: { ...t(10, 1, 10), blessed: 1, inPack: 0, lone: 10, ranks: RANKS(HUNT, [2, 3, 1, 1, 3]), beastForm: 0 },
  fever: { vampire: t(10, 0, 9), werewolf: t(5, 0, 5) },
  grant: { werewolf: t(3, 0, 3), vampireLord: t(0, 0, 0) },
  houses: [
    { name: 'Clan Volkihar', circle: 'vampire', pack: false, members: 0, cursed: 0, online: 0 },
    { name: "Hircine's Pack of the Jerall", circle: 'werewolf', pack: true, members: 0, cursed: 0, online: 0 },
  ],
}
const SECRETS = ['Valerica', '4278845441', '123456789012345678', 'holder', 'roster', 'Molag Bal', 'names', 'ids']

let server, base, fakeGame
function get(url, user) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${url}`, { agent: false, headers: user ? { 'x-test-user': `id-${user}` } : {} }, res => {
      let text = ''
      res.on('data', c => { text += c })
      res.on('end', () => { let json = null; try { json = JSON.parse(text) } catch { /* not JSON */ } resolve({ status: res.statusCode, headers: res.headers, text, json }) })
    })
    req.on('error', reject)
    req.end()
  })
}
const listen = srv => new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)))

before(async () => {
  // A stand-in for the game's Prometheus endpoint, so /api/metrics never asks the live game
  fakeGame = http.createServer((_req, res) => res.end('skymp_logins_total 3\n'))
  Object.assign(config, {
    gameServerDir: DIR, siteStaffRoleIds: ['role-owner', 'role-dev'], siteOwnerRoleIds: ['role-owner'],
    punishLeadGmRoleIds: ['role-lead'], punishGmRoleIds: ['role-gm'], skyrimServerHost: '127.0.0.1', skympUiPort: await listen(fakeGame),
  })
  const app = express()
  app.use('/api/metrics', require('../routes/metrics'))
  app.use('/api/site/staff', require('../routes/site-staff'))
  server = http.createServer(app)
  base = `http://127.0.0.1:${await listen(server)}`
  fs.writeFileSync(PUBLIC, JSON.stringify({ updatedAt: new Date().toISOString(), online: 40, peakToday: 44, characters: 296, players: 210, gold: { total: 1, carried: 1, stored: 0 }, races: [{ race: 'Nord', count: 50 }], clock: null }))
})

after(() => {
  server?.close()
  fakeGame?.close()
  fs.rmSync(DIR, { recursive: true, force: true })
})

test('signed out gets 401, never the counts, with no-store caching', async () => {
  fs.writeFileSync(STAFF, JSON.stringify(FILE()))
  const res = await get('/api/site/staff/world', null)
  assert.equal(res.status, 401)
  assert.deepEqual(res.json, { error: 'signedOut' })
  assert.equal(res.headers['cache-control'], 'no-store, private')
})

test('a player with no staff role, a GM and a Lead GM get 403', async () => {
  fs.writeFileSync(STAFF, JSON.stringify(FILE()))
  for (const who of ['none', 'gm', 'lead']) {
    const res = await get('/api/site/staff/world', who)
    assert.equal(res.status, 403, who)
    assert.deepEqual(res.json, { error: 'notStaff' }, who)
    assert.doesNotMatch(res.text, /vampire|werewolf/i, who)
  }
})

test('an Owner and a Dev get the counts, field by field, and nothing else the file holds', async () => {
  const at = new Date(Date.now() - 30000).toISOString()
  fs.writeFileSync(STAFF, JSON.stringify(FILE(at)))
  for (const who of ['owner', 'dev']) {
    const res = await get('/api/site/staff/world', who)
    assert.equal(res.status, 200, who)
    assert.equal(res.headers['cache-control'], 'no-store, private')
    assert.deepEqual(res.json, { updatedAt: at, ...EXPECTED }, who)
    for (const s of SECRETS) assert.ok(!res.text.includes(s), `${who}: ${s}`)
  }
})

test('counts older than five minutes are marked stale; nonsense reads as 0, an unknown crown as null', async () => {
  fs.writeFileSync(STAFF, JSON.stringify(FILE(new Date(Date.now() - 6 * 60000).toISOString())))
  assert.equal((await get('/api/site/staff/world', 'dev')).json.stale, true)
  fs.writeFileSync(STAFF, JSON.stringify({ updatedAt: 'never', characters: -3, vampire: { total: '7', thirst: [1.5, null], crown: 'Valerica', ranks: [{ name: 'x'.repeat(500), count: 2 }] }, houses: 'all' }))
  const { json, text } = await get('/api/site/staff/world', 'dev')
  assert.equal(json.stale, true)
  assert.equal(json.updatedAt, null)
  assert.equal(json.characters, 0)
  assert.equal(json.vampire.total, 0)
  assert.deepEqual(json.vampire.thirst, [0, 0, 0, 0])
  assert.equal(json.vampire.crown, null)
  assert.equal(json.vampire.ranks[0].name.length, 80)
  assert.deepEqual(json.houses, [])
  assert.ok(!text.includes('Valerica'))
})

test('no file yet, a broken one or an array: 503 noCounts, so the page can say the game has not counted', async () => {
  fs.rmSync(STAFF, { force: true })
  for (const body of [null, '{not json', '[1,2]']) {
    if (body !== null) fs.writeFileSync(STAFF, body)
    const res = await get('/api/site/staff/world', 'owner')
    assert.equal(res.status, 503, String(body))
    assert.deepEqual(res.json, { error: 'noCounts' })
  }
})

test('the public /api/metrics never carries the counts', async () => {
  fs.writeFileSync(STAFF, JSON.stringify(FILE()))
  const res = await get('/api/metrics', null)
  assert.equal(res.status, 200)
  assert.equal(res.json.ok, true)
  assert.deepEqual(res.json.world.sections.map(s => s.type), ['cards', 'board'])
  assert.equal(res.json.world.sections[1].title, 'Races of the Realm')
  assert.doesNotMatch(res.text, /vampire|werewolf|fever|volkihar|hircine|pure|thirst|crown/i)
})
