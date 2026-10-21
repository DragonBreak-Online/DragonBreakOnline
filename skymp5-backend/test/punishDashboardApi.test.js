'use strict'
// website/dashboard.html's Punishments panel fed by the real routes/site-punish.js on fixture record files: the page and
// the API agree on every field, for an Owner on the full dashboard and a Lead GM on the panel alone

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const path = require('path')
const vm = require('vm')
const { webcrypto } = require('crypto')
const { createPunishFixture, PEOPLE, SECRET_STRINGS } = require('./helpers/punishFixture')

const F = createPunishFixture()
const byId = Object.fromEntries(Object.values(PEOPLE).map(p => [p.discordId, p]))
const stub = (rel, exports) => {
  const file = require.resolve(path.join('..', rel))
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
stub('routes/site-auth.js', {
  internals: {
    currentSession: req => { const p = PEOPLE[req.headers['x-test-user']]; return p ? { discordId: p.discordId, username: p.name } : null },
    readStore: () => F.forms, dynamicFields: cf => cf.dynamicFields || {}, characterName: cf => cf.displayName,
    profileIdOf: d => F.profiles.map[d] ?? null, toSiteCharacter: () => ({}),
  },
})
stub('sources/discordBot.js', {
  memberHasRole: async (d, role) => ((byId[d] && byId[d].roles) || []).includes(role),
  getMemberRoles: async d => (byId[d] && byId[d].roles) || [],
  isGuildMember: async d => (byId[d] ? byId[d].roles !== null : false),
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
const { staffStatusOf } = require('../sources/punish/tier')
const route = require('../routes/site-punish')

const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'website', 'dashboard.html'), 'utf8')
const SCRIPT = [...PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])[0]
class FakeEl {
  constructor(tag) { Object.assign(this, { tag, kids: [], own: '', className: '', hidden: false, value: '', disabled: false, href: '', listeners: {} }) }
  set textContent(v) { this.kids = []; this.own = String(v) }
  get textContent() { return this.own + this.kids.map(k => k.textContent).join('') }
  set innerHTML(_v) { throw new Error('innerHTML is not allowed') }
  append(...nodes) { for (const n of nodes) this.kids.push(typeof n === 'string' ? Object.assign(new FakeEl('#text'), { own: n }) : n) }
  addEventListener(type, fn) { this.listeners[type] = fn }
  setAttribute() {}
  showModal() {} close() {} focus() {}
}
const textOf = node => (node.tag === '#text' ? node.own : node.own + node.kids.map(k => textOf(k)).join(node.tag === 'tr' || node.tag === 'td' || node.tag === 'div' ? ' | ' : ''))

let server, base, plog
const asked = []
function page(user) {
  const byIdMap = new Map()
  const $ = id => { if (!byIdMap.has(id)) byIdMap.set(id, new FakeEl('div')); return byIdMap.get(id) }
  const document = { getElementById: $, createElement: tag => new FakeEl(tag), createElementNS: (_ns, tag) => new FakeEl(tag) }
  // The rest of the staff dashboard never answers here; the panel's own requests go to the real route
  const fetchFn = url => {
    asked.push([user, url])
    if (url !== '/api/site/staff/me' && !url.startsWith('/api/site/staff/punishments')) return new Promise(() => {})
    return fetch(`${base}${url}`, { headers: { 'x-test-user': user } })
  }
  const ctx = vm.createContext({ document, fetch: fetchFn, crypto: webcrypto, setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, console, location: { hash: '' } })
  vm.runInContext(SCRIPT, ctx)
  return { $, run: code => vm.runInContext(code, ctx) }
}
async function until(fn) {
  for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise(done => setTimeout(done, 20)) }
  throw new Error('the page never got there')
}

before(async () => {
  plog = createPlayerLog({ dir: F.plog, days: 90, minIntervalMs: 0 })
  route.internals.setService(createPunishments({
    config, readStore: () => F.forms, dynamicFields: cf => cf.dynamicFields || {}, characterName: cf => cf.displayName, staffStatusOf,
    loadProfiles: () => F.profiles, loadPlayers: () => F.players, playerLog: plog, tailIntervalMs: 0,
  }))
  const app = express()
  app.use('/api/site/staff/punishments', route)
  app.use('/api/site/staff', require('../routes/site-staff'))
  server = http.createServer(app)
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${server.address().port}`
  plog.refresh()
  await until(() => plog.view().status === 'ok')
})

after(async () => {
  await plog.stop()
  server?.close()
  F.cleanup()
})

test('a Lead GM\'s page: the panel alone, filled from the real API, no id or address anywhere on it', async () => {
  const p = page('lead')
  await until(() => !p.$('punish').hidden && p.$('puRecent').textContent.includes('Kicked'))
  assert.equal(p.$('staffOnly').hidden, true)
  for (const [user, url] of asked.filter(([u]) => u === 'lead')) assert.ok(url === '/api/site/staff/me' || url.startsWith('/api/site/staff/punishments'), `${user} ${url}`)
  const active = textOf(p.$('puActive'))
  assert.match(active, /Bob #BOB1/)
  assert.match(active, /Threats to \[id\] from \[address\], mail \[email\]/)
  assert.match(active, /20 min left to serve/)
  assert.match(active, /#VKRS/)
  assert.match(active, /Ghost/)
  assert.match(active, /until all is taken back/)
  assert.match(active, /Jake \(profile 1\)/)
  const recent = textOf(p.$('puRecent'))
  assert.match(recent, /Kicked \(enforcing a suspension\), 3 times within the hour/)
  assert.match(recent, /lifted by Jake #JAKE on .* UTC: Apologised to the player/)
  assert.match(recent, /overturned by Lena #LED1/)
  assert.ok(!recent.includes('Gave items to a friend'), 'the Lead GM\'s own strike is not shown')
  const all = ['puHead', 'puActive', 'puFound', 'puHist', 'puRecent'].map(id => textOf(p.$(id))).join('\n')
  for (const s of SECRET_STRINGS) assert.ok(!all.includes(s), s)
  if (process.env.PUNISH_PRINT_SCREENS) console.log(['puHead', 'puActive', 'puRecent'].map(id => `== ${id}\n${textOf(p.$(id))}`).join('\n'))

  p.$('puQ').value = 'bob'
  p.$('puFind').listeners.submit({ preventDefault() {} })
  await until(() => p.$('puFound').textContent.includes('profile 10'))
  p.run('openHistory(10)')
  await until(() => p.$('puHist').textContent.includes('strikes in 90 days'))
  const hist = textOf(p.$('puHist'))
  assert.match(hist, /Bob #BOB1, Old Bob #BOB2 \(deleted\)/)
  assert.match(hist, /1 of 3 strikes in 90 days/)
  assert.match(hist, /Running now: /)
  if (process.env.PUNISH_PRINT_SCREENS) console.log(['puFound', 'puHist'].map(id => `== ${id}\n${textOf(p.$(id))}`).join('\n'))
})

test('an Owner\'s full dashboard shows the panel beside the rest, with their own record', async () => {
  const p = page('owner')
  await until(() => !p.$('punish').hidden && p.$('puRecent').textContent.includes('Owner test warning'))
  assert.equal(p.$('staffOnly').hidden, false)
  assert.match(p.$('puHead').textContent, /Owner/)
})
