'use strict'
// GET /api/site/staff/punishments and /me's punish rank, on fixture record files: sign-in and rank checks, what each
// rank sees, no Discord id, hwid or address in any answer, pagination, the switch, and record files that are broken

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const path = require('path')
const { createPunishFixture, PEOPLE, SECRET_STRINGS, HOUR } = require('./helpers/punishFixture')

const F = createPunishFixture()
let clock = F.now
const byId = Object.fromEntries(Object.entries(PEOPLE).map(([k, p]) => [p.discordId, { ...p, key: k }]))

const stub = (rel, exports) => {
  const file = require.resolve(path.join('..', rel))
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
stub('routes/site-auth.js', {
  internals: {
    currentSession: req => { const p = PEOPLE[req.headers['x-test-user']]; return p ? { discordId: p.discordId, username: p.name } : null },
    readStore: () => F.forms,
    dynamicFields: cf => cf.dynamicFields || {},
    characterName: cf => cf.displayName,
    profileIdOf: d => F.profiles.map[d] ?? null,
    toSiteCharacter: () => ({}),
  },
})
let roleLookups = 0
let discordDown = false
stub('sources/discordBot.js', {
  memberHasRole: async (d, role) => { roleLookups++; return ((byId[d] && byId[d].roles) || []).includes(role) },
  getMemberRoles: async d => (byId[d] && byId[d].roles) || [],
  isGuildMember: async d => (discordDown ? null : byId[d] ? byId[d].roles !== null : false),
})
stub('sources/profiles.js', { load: () => F.profiles })
stub('sources/players.js', { load: () => F.players })
stub('sources/nameTable.js', { load: () => ({}) })
stub('routes/servers.js', { getHeartbeat: () => null })

const express = require('express')
const config = require('../config')
Object.assign(config, {
  gameServerDir: F.game, punishBansFile: F.bansFile, punishJournalFile: F.journalFile, punishPlayerLogDir: F.plog, punishPlayerLogDays: 90,
  siteOwnerRoleIds: ['role-owner'], siteStaffRoleIds: ['role-owner', 'role-dev'], punishLeadGmRoleIds: ['role-lead'], punishGmRoleIds: ['role-gm'],
  discordStaffRoleIds: ['role-trial'], consoleRoleIds: '', punishPanel: true,
})
const { createPunishments } = require('../sources/punish')
const { createPlayerLog } = require('../sources/punish/playerLog')
const route = require('../routes/site-punish')
const { staffStatusOf } = require('../sources/punish/tier')

let service, server, base
const plog = createPlayerLog({ dir: F.plog, days: 90, now: () => clock, minIntervalMs: 0 })

function get(url, user, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${url}`, { agent: false, headers: { ...(user ? { 'x-test-user': user } : {}), ...headers } }, res => {
      let text = ''
      res.on('data', c => { text += c })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: text ? JSON.parse(text) : null }))
    })
    req.on('error', reject)
    req.end()
  })
}
const P = '/api/site/staff/punishments'
const tick = (ms = 2500) => { clock += ms }

async function playerLogReady(user = 'owner') {
  for (let i = 0; i < 100; i++) {
    tick()
    const r = await get(P, user)
    if (r.json?.sources?.playerLog?.status === 'ok') return r
    await new Promise(done => setTimeout(done, 50))
  }
  throw new Error('the player log was never read')
}

before(async () => {
  service = createPunishments({
    config, readStore: () => F.forms, dynamicFields: cf => cf.dynamicFields || {}, characterName: cf => cf.displayName, staffStatusOf,
    loadProfiles: () => F.profiles, loadPlayers: () => F.players, now: () => clock, playerLog: plog, tailIntervalMs: 0,
  })
  route.internals.setService(service)
  const app = express()
  app.use(P, route)
  app.use('/api/site/staff', require('../routes/site-staff'))
  server = http.createServer(app)
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${server.address().port}`
  await playerLogReady()
})

after(async () => {
  await plog.stop()
  server?.close()
  F.cleanup()
})

const ENDPOINTS = [P, `${P}/active`, `${P}/recent`, `${P}/search?q=Bob`, `${P}/player/10`]
const FORBIDDEN_KEYS = new Set(['discordId', '_discordId', '_byDiscordId', '_lastMs', 'hwid', 'ip', 'lastIp', 'avatar', 'avatarUrl', 'd', 'a', 'where', 'concordatBy'])
function assertClean(res, label) {
  const walk = (v, at) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`))
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { assert.ok(!FORBIDDEN_KEYS.has(k), `${label}: key ${at}.${k}`); walk(x, `${at}.${k}`) }
  }
  walk(res.json, '')
  for (const s of SECRET_STRINGS) assert.ok(!res.text.includes(s), `${label}: ${s} in the answer`)
  assert.doesNotMatch(res.text, /\d{15,}/, `${label}: a long digit run`)
}
const rowsOf = async (user, url = `${P}/recent?limit=100&from=2000-01-01`) => (await get(url, user)).json.rows

test('signed out gets 401 everywhere, never cached', async () => {
  for (const url of ENDPOINTS) {
    const r = await get(url)
    assert.equal(r.status, 401, url)
    assert.deepEqual(r.json, { error: 'signedOut' })
    assert.equal(r.headers['cache-control'], 'no-store, private')
  }
})

test('a member with no rank, a Trial GM included, gets 403', async () => {
  for (const user of ['none', 'trial']) {
    for (const url of ENDPOINTS) {
      const r = await get(url, user)
      assert.equal(r.status, 403, `${user} ${url}`)
      assert.deepEqual(r.json, { error: 'notStaff' })
    }
  }
})

test('/me gives each viewer their punish rank, null without one', async () => {
  const me = async u => (await get('/api/site/staff/me', u)).json
  assert.deepEqual(await me('owner'), { signedIn: true, staff: true, owner: true, punish: 'owner', name: 'Jake' })
  assert.deepEqual(await me('dev'), { signedIn: true, staff: true, owner: false, punish: 'dev', name: 'Nate' })
  assert.deepEqual(await me('lead'), { signedIn: true, staff: false, owner: false, punish: 'leadgm', name: 'Lena' })
  assert.deepEqual(await me('gm'), { signedIn: true, staff: false, owner: false, punish: 'gm', name: 'Gus' })
  assert.equal((await me('trial')).punish, null)
})

test('no answer carries a Discord id, hwid, address, email or mention, for any rank', async () => {
  for (const user of ['owner', 'dev', 'lead', 'gm']) {
    for (const url of [...ENDPOINTS, `${P}/player/40`, `${P}/player/101`, `${P}/search?q=%23VKRS`, `${P}/active?limit=100`, `${P}/recent?limit=100&from=2000-01-01`]) {
      const r = await get(url, user)
      assertClean(r, `${user} ${url}`)
    }
  }
})

test('the overview names the rank, its kinds and every source', async () => {
  const r = await get(P, 'owner')
  assert.equal(r.status, 200)
  assert.equal(r.json.tier, 'owner')
  assert.equal(r.json.label, 'Owner')
  assert.ok(r.json.kinds.includes('restitution'))
  assert.deepEqual(Object.keys(r.json.sources).sort(), ['bans', 'discipline', 'jail', 'journal', 'panelBans', 'playerLog', 'restitution'])
  for (const [k, s] of Object.entries(r.json.sources)) assert.equal(s.status, 'ok', k)
  assert.equal(r.json.sources.playerLog.days, 90)
  assert.ok(r.json.sources.playerLog.from, 'the player log says from which day it covers')
  assert.equal(r.json.strikeDays, 90)
})

test('an Owner sees everything running, ending soonest first, and the strikes counting', async () => {
  const r = await get(`${P}/active?limit=100`, 'owner')
  assert.equal(r.status, 200)
  const kinds = r.json.rows.map(x => `${x.kind}:${x.id}`)
  for (const want of ['suspend:dsc:10:7', 'suspend:dsc:101:1', 'tempban:abn:tb1', 'ipban:abn:ip1', 'discord_ban:ban:B-WG6QYG', 'ban:ban:i1', 'jail:jail:ff000010', 'jail:jail:ff000020', 'restitution:rst:0138', 'discord_timeout:mod:M-AAAAAA']) {
    assert.ok(kinds.includes(want), `${want} in ${kinds.join(', ')}`)
  }
  assert.ok(!kinds.includes('discord_timeout:mod:M-BBBBBB'), 'an ended timeout is not running')
  assert.ok(!kinds.includes('suspend:dsc:10:3'), 'a lifted suspension is not running')
  const ends = r.json.rows.map(x => (x.endsInMs === null ? Infinity : x.endsInMs))
  assert.deepEqual(ends, [...ends].sort((a, b) => a - b), 'ending soonest first, permanent last')
  const rep = r.json.rows.find(x => x.id === 'dsc:101:1')
  assert.equal(rep.ticket, 'rep-0305')
  assert.equal(rep.outside, 'rep-0305')
  assert.equal(rep.alsoHolds, 2, 'the two Discord accounts held out are counted, never listed')
  assert.equal(rep.state, 'running')
  assert.equal(rep.hours, 38)
  assert.equal(rep.target.tag, 'VKRS')
  const susp = r.json.rows.find(x => x.id === 'dsc:10:7')
  assert.ok(Math.abs(susp.endsInMs - 37 * HOUR) < 60000)
  assert.equal(susp.reason, 'Threats to [id] from [address], mail [email]')
  assert.equal(susp.target.discordName, 'Bobby')
  const ip = r.json.rows.find(x => x.id === 'abn:ip1')
  assert.equal(ip.target.name, 'Ivan')
  assert.equal(ip.by, 'Jake (profile 1)', 'the panel\'s "profile N" is named')
  const dash = r.json.rows.find(x => x.id === 'ban:i1')
  assert.equal(dash.by, 'Old Admin', 'a raw Discord id in bannedBy becomes the Discord name')
  assert.equal(dash.target.profileId, 40)
  const ghost = r.json.rows.find(x => x.id === 'ban:B-WG6QYG')
  assert.equal(ghost.target.profileId, null)
  assert.equal(ghost.target.discordName, 'Ghost')
  assert.equal(ghost.ref, 'B-WG6QYG')
  const jail = r.json.rows.find(x => x.id === 'jail:ff000010')
  assert.equal(jail.leftMs, 20 * 60000)
  assert.equal(jail.concordat, true)
  assert.equal(jail.by, 'Guard Gus #GRD1')
  const rst = r.json.rows.find(x => x.id === 'rst:0138')
  assert.deepEqual(rst.items, { items: 9, itemsBack: 4, gold: 100, goldBack: 100 })
  assert.equal(rst.ticket, '#0138')
  assert.equal(rst.target.profileId, 10)
  assert.deepEqual(r.json.strikes.map(s => [s.target.profileId, s.count, s.review, s.days]).sort(), [[10, 1, 3, 90], [30, 1, 3, 90]])
})

test('lifts and overturns show on the record they undid and as rows of their own', async () => {
  const rows = await rowsOf('owner')
  const s3 = rows.find(x => x.id === 'dsc:10:3')
  assert.equal(s3.state, 'lifted')
  assert.deepEqual({ by: s3.lifted.by, reason: s3.lifted.reason }, { by: 'Jake #JAKE', reason: 'Apologised to the player' })
  assert.equal(rows.find(x => x.id === 'dsc:10:4').lifts, 3)
  const s5 = rows.find(x => x.id === 'dsc:10:5')
  assert.equal(s5.state, 'overturned')
  assert.equal(s5.overturned.by, 'Lena #LED1')
  assert.equal(rows.find(x => x.id === 'dsc:10:6').undid, 5)
  assert.equal(rows.find(x => x.id === 'dsc:10:2').state, 'counting')
  assert.equal(rows.find(x => x.id === 'dsc:10:2').told, false)
})

test('the player log gives kicks and Discord bans once each, never a sleep, an old day or the forwarder copy', async () => {
  const rows = (await rowsOf('owner')).filter(x => x.source === 'playerLog')
  const kicks = rows.filter(x => x.kind === 'kick')
  const panel = kicks.filter(x => x.how === 'panel')
  assert.equal(panel.length, 1, 'the hook and the GM line are one kick')
  assert.equal(panel[0].by, 'Gina #GIN1')
  assert.equal(kicks.filter(x => x.how === 'command').length, 1, 'only today\'s /kick: not the 120-day-old one, not the forwarder\'s')
  const enforce = kicks.find(x => x.how === 'suspension')
  assert.equal(enforce.count, 3, 'three login tries in an hour are one row')
  assert.ok(!kicks.some(x => x.how === 'sleep'))
  const dban = rows.find(x => x.kind === 'discord_ban')
  assert.equal(dban.target.tag, 'IVN1')
  assert.ok(!rows.some(x => x.kind === 'suspend'), 'discipline comes from discipline.json, not twice')
})

test('Dev and Lead GM never see their own account; an Owner does', async () => {
  const has = (rows, id) => rows.some(x => x.id === id)
  const owner = await rowsOf('owner'), dev = await rowsOf('dev'), lead = await rowsOf('lead')
  assert.ok(has(owner, 'dsc:1:1') && has(owner, 'dsc:2:1') && has(owner, 'dsc:30:1'))
  assert.ok(!has(dev, 'dsc:2:1') && has(dev, 'dsc:1:1') && has(dev, 'dsc:30:1'))
  assert.ok(!has(lead, 'dsc:30:1') && has(lead, 'dsc:2:1') && has(lead, 'rst:0138'))
  assert.equal((await get(`${P}/player/30`, 'lead')).status, 403)
  assert.deepEqual((await get(`${P}/player/30`, 'lead')).json, { error: 'ownAccount' })
  assert.equal((await get(`${P}/player/1`, 'owner')).status, 200)
  assert.deepEqual((await get(`${P}/search?q=%23LED1`, 'lead')).json.accounts, [])
  assert.equal((await get(`${P}/active?limit=100`, 'lead')).json.strikes.some(s => s.target.profileId === 30), false)
})

test('a GM sees discipline, kicks and jail, bans only while they run, nothing on staff, no restitution', async () => {
  const info = (await get(P, 'gm')).json
  assert.equal(info.tier, 'gm')
  assert.ok(!info.kinds.includes('restitution') && !info.kinds.includes('discord_unban'))
  const rows = await rowsOf('gm')
  assert.ok(rows.length > 0)
  assert.ok(!rows.some(x => x.kind === 'restitution'))
  assert.ok(!rows.some(x => x.target.profileId === 20), 'Gina is staff')
  assert.ok(!rows.some(x => x.target.profileId === 4), 'their own account')
  assert.ok(rows.some(x => x.id === 'ban:B-WG6QYG'), 'an account no longer in the guild is not staff')
  assert.ok(!rows.some(x => x.id === 'mod:M-BBBBBB'), 'an ended timeout is history a GM does not see')
  for (const x of rows.filter(r => ['tempban', 'ban', 'ipban', 'discord_ban', 'discord_timeout'].includes(r.kind))) {
    assert.equal(x.active, true, x.id)
    assert.equal(x.by, null, `${x.id}: who banned is not shown to a GM`)
  }
  assert.ok(rows.some(x => x.id === 'abn:tb1') && rows.some(x => x.id === 'dsc:10:7') && rows.some(x => x.kind === 'kick'))
  assert.equal((await get(`${P}/player/20`, 'gm')).status, 404)
  assert.deepEqual((await get(`${P}/search?q=Gina`, 'gm')).json.accounts, [])
  assert.equal((await get(`${P}/recent?kind=restitution`, 'gm')).status, 400)
})

test('when Discord cannot say who is staff, a GM sees nothing rather than a staff member\'s record', async () => {
  discordDown = true
  staffStatusOf.clear()
  try {
    assert.deepEqual(await rowsOf('gm'), [])
    assert.equal((await get(`${P}/player/10`, 'gm')).status, 404)
    assert.ok((await rowsOf('lead')).length > 0, 'other ranks do not depend on it')
  } finally { discordDown = false; staffStatusOf.clear() }
})

test('search finds an account by character name, #TAG, TAG, profile and Discord name', async () => {
  const find = async q => (await get(`${P}/search?q=${encodeURIComponent(q)}`, 'owner')).json.accounts.map(a => a.profileId)
  assert.deepEqual(await find('bo'), [10])
  assert.deepEqual(await find('#BOB1'), [10])
  assert.deepEqual(await find('bob2'), [10], 'a deleted character still finds its account')
  assert.deepEqual(await find('profile 101'), [101])
  assert.deepEqual(await find('101'), [101])
  assert.deepEqual(await find('Bobb'), [10], 'the start of a Discord name')
  const bob = (await get(`${P}/search?q=Bob`, 'owner')).json.accounts[0]
  assert.equal(bob.discordName, 'Bobby')
  assert.deepEqual(bob.characters.map(c => [c.name, c.tag, c.status]), [['Bob', 'BOB1', 'alive'], ['Old Bob', 'BOB2', 'deleted']])
  assert.ok(bob.records >= 7 && bob.active >= 3)
  for (const q of ['', 'x', 'y'.repeat(41)]) assert.equal((await get(`${P}/search?q=${q}`, 'owner')).status, 400, q)
  assert.equal((await get(`${P}/search?q=a&q=b`, 'owner')).status, 400)
})

test('one account\'s page: what runs now, the history newest first, filters by kind and date', async () => {
  const r = await get(`${P}/player/10`, 'owner')
  assert.equal(r.status, 200)
  assert.equal(r.json.player.discordName, 'Bobby')
  assert.deepEqual(r.json.strikes, { count: 1, review: 3, days: 90 })
  assert.ok(r.json.active.some(x => x.id === 'dsc:10:7'))
  const at = r.json.history.map(x => Date.parse(x.at || 0))
  assert.deepEqual(at, [...at].sort((a, b) => b - a))
  const strikes = (await get(`${P}/player/10?kind=strike`, 'owner')).json.history
  assert.deepEqual(strikes.map(x => x.id).sort(), ['dsc:10:2', 'dsc:10:5'])
  const day = new Date(F.now - 10 * 86400000).toISOString().slice(0, 10)
  const one = (await get(`${P}/player/10?from=${day}&to=${day}`, 'owner')).json.history
  assert.deepEqual(one.map(x => x.id), ['dsc:10:2'])
  assert.equal((await get(`${P}/player/999`, 'owner')).status, 404)
  assert.equal((await get(`${P}/player/abc`, 'owner')).status, 400)
  for (const q of ['kind=nope', 'from=2026-13-01', 'from=2026-10-10&to=2026-10-01', 'limit=0', 'limit=101', 'cursor=@@']) {
    assert.equal((await get(`${P}/player/10?${q}`, 'owner')).status, 400, q)
  }
})

test('pagination: every row once, in order, by an opaque cursor that is checked', async () => {
  const all = await rowsOf('owner')
  const seen = []
  let url = `${P}/recent?limit=3&from=2000-01-01`
  for (let i = 0; i < 50 && url; i++) {
    const r = await get(url, 'owner')
    assert.equal(r.status, 200)
    assert.ok(r.json.rows.length <= 3)
    seen.push(...r.json.rows.map(x => x.id))
    url = r.json.next ? `${P}/recent?limit=3&from=2000-01-01&cursor=${r.json.next}` : null
  }
  assert.deepEqual(seen, all.map(x => x.id))
  assert.equal(new Set(seen).size, seen.length)
  const forged = Buffer.from(JSON.stringify([1, '../../etc'])).toString('base64url')
  for (const c of [forged, 'bm90IGpzb24', Buffer.from('[1]').toString('base64url')]) {
    const r = await get(`${P}/recent?cursor=${c}`, 'owner')
    assert.equal(r.status, 400, c)
    assert.deepEqual(r.json, { error: 'badCursor' })
  }
  const def = (await get(`${P}/recent?limit=100`, 'owner')).json
  assert.ok(Date.parse(def.from) <= clock - 29 * 86400000, 'the last 30 days by default')
  assert.ok(!def.rows.some(x => Date.parse(x.at) < Date.parse(def.from)))
})

test('the record files are read only: a ref-less bans.json, and every other file, are never changed', async () => {
  const files = [F.bansFile, F.journalFile, path.join(F.state, 'discipline.json'), path.join(F.game, 'admin-bans.json'), path.join(F.state, 'restitution-state.json')]
  const before_ = files.map(f => [fs.readFileSync(f, 'utf8'), fs.statSync(f).mtimeMs])
  tick()
  for (const url of ENDPOINTS) await get(url, 'owner')
  files.forEach((f, i) => {
    assert.equal(fs.readFileSync(f, 'utf8'), before_[i][0], f)
    assert.equal(fs.statSync(f).mtimeMs, before_[i][1], f)
  })
  assert.ok(!fs.existsSync(`${F.bansFile}.tmp`))
})

test('a broken record file keeps its last good copy and is flagged; a missing one is nothing on record', async () => {
  const file = path.join(F.state, 'discipline.json')
  const good = fs.readFileSync(file, 'utf8')
  const asOf = (await get(P, 'owner')).json.sources.discipline.asOf
  fs.writeFileSync(file, good.slice(0, 200))
  tick()
  const info = (await get(P, 'owner')).json
  assert.equal(info.sources.discipline.status, 'unreadable')
  assert.equal(info.sources.discipline.asOf, asOf)
  assert.ok((await rowsOf('owner')).some(x => x.id === 'dsc:10:7'), 'the last good copy is still shown')
  fs.writeFileSync(F.bansFile, '[{"discordId": 1,')
  fs.writeFileSync(path.join(F.game, 'gamemode-config.json'), 'not json')
  fs.rmSync(path.join(F.game, 'admin-bans.json'))
  tick()
  const r = await get(`${P}/active?limit=100`, 'owner')
  assert.equal(r.status, 200)
  assert.ok(!r.json.rows.some(x => x.source === 'panelBans'))
  const s = (await get(P, 'owner')).json.sources
  assert.equal(s.panelBans.status, 'missing')
  assert.equal(s.bans.status, 'unreadable')
  fs.writeFileSync(file, good)
  tick()
  assert.equal((await get(P, 'owner')).json.sources.discipline.status, 'ok')
})

test('read only and same-site: POST is refused, a cross-site read is refused', async () => {
  const post = await new Promise((resolve, reject) => {
    const req = http.request(`${base}${P}`, { method: 'POST', agent: false, headers: { 'x-test-user': 'owner' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
    req.on('error', reject)
    req.end()
  })
  assert.equal(post, 405)
  assert.equal((await get(P, 'owner', { 'sec-fetch-site': 'cross-site' })).status, 403)
  assert.equal((await get(P, 'owner', { 'sec-fetch-site': 'same-origin' })).status, 200)
})

test('PUNISH_PANEL=off answers 404 to everyone, and /me gives no rank', async () => {
  config.punishPanel = false
  try {
    for (const user of [undefined, 'owner']) for (const url of ENDPOINTS) assert.equal((await get(url, user)).status, 404, `${user} ${url}`)
    assert.equal((await get('/api/site/staff/me', 'owner')).json.punish, null)
  } finally { config.punishPanel = true }
})

test('signed-out and rankless callers meet the limit before any role lookup', async () => {
  const first = roleLookups
  for (let i = 0; i < 5; i++) await get(P)
  assert.equal(roleLookups, first, 'no lookup for a signed-out caller')
})
