'use strict'
// website/dashboard.html's Punishments panel against a small fake DOM: hidden unless the backend answers, text only,
// a Lead GM's page asks for nothing but /me and the panel, and the history, search, filters and paging send the right requests

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { webcrypto } = require('crypto')

const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'website', 'dashboard.html'), 'utf8')
const SCRIPT = [...PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])[0]
const PU = '/api/site/staff/punishments'
const HOUR = 3600000

class FakeEl {
  constructor(tag) { Object.assign(this, { tag, kids: [], own: '', className: '', hidden: false, value: '', disabled: false, href: '', listeners: {}, attrs: {} }) }
  set textContent(v) { this.kids = []; this.own = String(v) }
  get textContent() { return this.own + this.kids.map(k => k.textContent).join('') }
  set innerHTML(_v) { throw new Error('innerHTML is not allowed') }
  append(...nodes) { for (const n of nodes) this.kids.push(typeof n === 'string' ? Object.assign(new FakeEl('#text'), { own: n }) : n) }
  addEventListener(type, fn) { this.listeners[type] = fn }
  setAttribute(k, v) { this.attrs[k] = v }
  showModal() {} close() {} focus() {}
}
const all = (node, pred, out = []) => { if (pred(node)) out.push(node); for (const k of node.kids || []) all(k, pred, out); return out }
const button = (node, text) => all(node, n => n.tag === 'button' && n.textContent === text)[0]

const ROW = (id, kind, extra = {}) => ({
  id, kind, source: 'discipline', by: 'Lena #LED1', state: 'running', active: true, reason: 'Harassment', ref: '#7', ticket: null, told: null,
  outside: null, undid: null, lifts: null, hours: 38, count: null, how: null, leftMs: null, totalMs: null, concordat: null, alsoHolds: null,
  target: { profileId: 10, name: 'Bob', tag: 'BOB1', discordName: 'Bobby' }, at: '2026-10-21T14:00:00.000Z', until: '2026-10-23T05:00:00.000Z',
  from: null, endsInMs: 37 * HOUR, lifted: null, overturned: null, items: null, ...extra,
})
const INFO = {
  v: 1, tier: 'leadgm', label: 'Lead GM', kinds: ['warn', 'strike', 'suspend', 'lift', 'overturn', 'tempban', 'ban', 'ipban', 'kick', 'jail', 'restitution'],
  strikeDays: 90, strikesForReview: 3,
  sources: { discipline: { status: 'ok', asOf: '2026-10-21T14:00:00.000Z' }, panelBans: { status: 'missing', asOf: null }, bans: { status: 'unreadable', asOf: '2026-10-21T13:00:00.000Z' },
    jail: { status: 'ok' }, restitution: { status: 'ok' }, journal: { status: 'missing' }, playerLog: { status: 'ok', from: '2026-10-13', days: 90 } },
}
const ACTIVE = {
  v: 1, next: 'c2',
  rows: [
    ROW('jail:ff000010', 'jail', { source: 'jail', by: 'Guard Gus #GRD1', reason: null, ref: null, hours: null, leftMs: 20 * 60000, totalMs: 30 * 60000, concordat: true, until: null, endsInMs: 20 * 60000 }),
    ROW('dsc:10:7', 'suspend', { reason: '<img src=x onerror=alert(1)>' }),
    ROW('dsc:101:1', 'suspend', { target: { profileId: 101, name: null, tag: 'VKRS', discordName: 'Vex' }, by: 'Jake', outside: 'rep-0305', ticket: 'rep-0305', alsoHolds: 2, ref: '#1', from: '2026-10-21T15:00:00.000Z' }),
    ROW('ban:B-WG6QYG', 'discord_ban', { source: 'bans', target: { profileId: null, name: null, tag: null, discordName: 'Ghost' }, by: 'Discord', reason: 'discord ban', ref: 'B-WG6QYG', until: null, endsInMs: null, hours: null }),
  ],
  strikes: [{ target: { profileId: 10, name: 'Bob', tag: 'BOB1', discordName: 'Bobby' }, count: 2, review: 3, days: 90 }],
}
const RECENT = { v: 1, next: null, from: '2026-09-21T00:00:00.000Z', to: null, rows: [ROW('dsc:10:3', 'suspend', { state: 'lifted', active: false, lifted: { by: 'Jake #JAKE', at: '2026-10-13T10:00:00.000Z', reason: 'Apologised' } }), ROW('plog:gen1:2', 'kick', { source: 'playerLog', how: 'panel', count: 1, by: 'Gina #GIN1', reason: null, ref: null })] }
const PLAYER = { v: 1, player: { profileId: 10, discordName: 'Bobby', characters: [{ name: 'Bob', tag: 'BOB1', status: 'alive' }, { name: 'Old Bob', tag: 'BOB2', status: 'deleted' }] },
  strikes: { count: 2, review: 3, days: 90 }, active: [ACTIVE.rows[1]], history: [ROW('dsc:10:2', 'strike', { state: 'counting', active: false, told: false, until: null, endsInMs: null })], next: 'h2' }
const SEARCH = { v: 1, accounts: [{ profileId: 10, discordName: 'Bobby', characters: PLAYER.player.characters, records: 7, active: 3 }] }

function answer(status, body) { return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body }) }

// The page with fetch answered by route(url); every URL asked is kept
function load(route, { me = { signedIn: true, staff: false, owner: false, punish: 'leadgm', name: 'Lena' } } = {}) {
  const asked = []
  const byId = new Map()
  const $ = id => { if (!byId.has(id)) byId.set(id, new FakeEl('div')); return byId.get(id) }
  const document = { getElementById: $, createElement: tag => new FakeEl(tag), createElementNS: (_ns, tag) => new FakeEl(tag) }
  const fetch = url => {
    asked.push(url)
    if (url === '/api/site/staff/me') return answer(200, me)
    const hit = route(url)
    return hit ? answer(...hit) : new Promise(() => {})
  }
  const ctx = vm.createContext({ document, fetch, crypto: webcrypto, setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, console, location: { hash: '' } })
  vm.runInContext(SCRIPT, ctx)
  return { $, asked, run: code => vm.runInContext(code, ctx), ctx }
}
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(done => setImmediate(done)) }
const panel = url => {
  if (url === PU) return [200, INFO]
  if (url.startsWith(`${PU}/active`)) return [200, ACTIVE]
  if (url.startsWith(`${PU}/recent`)) return [200, RECENT]
  if (url.startsWith(`${PU}/player/30`)) return [403, { error: 'ownAccount' }]
  if (url.startsWith(`${PU}/player/`)) return [200, PLAYER]
  if (url.startsWith(`${PU}/search`)) return [200, SEARCH]
  return null
}

test('the panel never writes HTML and keeps nothing in the browser', () => {
  const start = SCRIPT.indexOf("const PU = '/api/site/staff/punishments'")
  assert.ok(start > 0)
  for (const banned of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'Storage', 'indexedDB', 'document.cookie', 'eval(', 'new Function']) {
    assert.ok(!SCRIPT.slice(start).includes(banned), banned)
  }
})

test('a Lead GM gets the panel alone: only /me and the panel are asked for, the rest of the board is hidden', async () => {
  const p = load(panel)
  await settle()
  assert.equal(p.$('board').hidden, false)
  assert.equal(p.$('notStaff').hidden, true)
  assert.equal(p.$('staffOnly').hidden, true)
  assert.equal(p.$('punish').hidden, false)
  assert.equal(p.$('heroTag').textContent, 'Punishments')
  assert.ok(p.asked.length >= 4)
  for (const url of p.asked) assert.ok(url === '/api/site/staff/me' || url === PU || url.startsWith(`${PU}/`), url)
})

test('staff with no punish rank, and anyone without either, get the not-staff page', async () => {
  const p = load(panel, { me: { signedIn: true, staff: false, owner: false, punish: null, name: 'Pat' } })
  await settle()
  assert.equal(p.$('notStaff').hidden, false)
  assert.deepEqual(p.asked, ['/api/site/staff/me'])
})

test('the section stays hidden when the backend has no panel (404), cannot read (503) or refuses the rank (403)', async () => {
  for (const status of [404, 503, 403]) {
    const p = load(url => (url.startsWith(PU) ? [status, { error: 'x' }] : null), { me: { signedIn: true, staff: true, owner: true, punish: 'owner', name: 'Jake' } })
    await settle()
    assert.equal(p.$('punish').hidden, true, String(status))
    assert.equal(p.$('notStaff').hidden, true, `${status}: full staff keep the rest of the dashboard`)
  }
  const only = load(url => (url.startsWith(PU) ? [403, { error: 'notStaff' }] : null))
  await settle()
  assert.equal(only.$('notStaff').hidden, false, 'a Lead GM whose rank is refused gets the not-staff page')
})

test('Active now: kind, player, time left, given by, reason as text, ref; strikes counting', async () => {
  const p = load(panel)
  await settle()
  const head = p.$('puHead').textContent
  assert.match(head, /Lead GM/)
  assert.match(head, /Player log from 13 Oct/)
  assert.match(head, /Panel bans: none on file/)
  assert.match(head, /Ban list: could not be read, showing the copy from 21 Oct 13:00 UTC/)
  assert.match(head, /Records on your own account are shown to Owners only/)
  const act = p.$('puActive').textContent
  assert.ok(act.includes('<img src=x onerror=alert(1)>'), 'a reason is shown as text, never parsed')
  assert.match(act, /37 h 0 min left \(23 Oct 05:00 UTC\)/)
  assert.match(act, /20 min left to serve; counts only while they are online in the jail/)
  assert.match(act, /permanent/)
  assert.match(act, /#1 · ticket rep-0305|#1/)
  assert.match(act, /Strikes counting: Bob #BOB1 \(profile 10\): 2 of 3 in 90 days/)
  assert.match(act, /Ghostno game account/)
  assert.ok(button(p.$('puActive'), 'Load older'), 'more rows come by cursor')
})

test('Recent shows lifts with who, when and why; the player cell opens that account\'s history', async () => {
  const p = load(panel)
  await settle()
  const rec = p.$('puRecent').textContent
  assert.match(rec, /lifted by Jake #JAKE on 13 Oct 10:00 UTC: Apologised/)
  assert.match(rec, /Kicked \(admin panel\)/)
  assert.match(rec, /The last 30 days/)
  const bob = all(p.$('puRecent'), n => n.tag === 'button' && n.textContent === 'Bob #BOB1')[0]
  bob.listeners.click()
  await settle()
  assert.ok(p.asked.includes(`${PU}/player/10?limit=50`))
  assert.equal(p.$('puHistBlk').hidden, false)
  const hist = p.$('puHist').textContent
  assert.match(hist, /Bob #BOB1, Old Bob #BOB2 \(deleted\)/)
  assert.match(hist, /2 of 3 strikes in 90 days/)
  assert.match(hist, /Running now: Suspension/)
  assert.match(hist, /counts now · player told at their next login/)
})

test('kind chips and dates filter, Load older sends the cursor, the own account is refused with a reason', async () => {
  const p = load(panel)
  await settle()
  button(p.$('puRecent'), 'Strike').listeners.click()
  await settle()
  assert.ok(p.asked.includes(`${PU}/recent?kind=strike&limit=50`), p.asked.join(' '))
  const from = all(p.$('puRecent'), n => n.tag === 'input')[0]
  from.value = '2026-10-01'
  from.listeners.change()
  await settle()
  assert.ok(p.asked.includes(`${PU}/recent?kind=strike&from=2026-10-01&limit=50`))
  button(p.$('puActive'), 'Load older').listeners.click()
  await settle()
  assert.ok(p.asked.includes(`${PU}/active?limit=100&cursor=c2`))
  p.run('openHistory(30)')
  await settle()
  assert.match(p.$('puHist').textContent, /Records about your own account are shown to Owners only/)
})

test('Find a player sends the query and lists accounts that open their history', async () => {
  const p = load(panel)
  await settle()
  p.$('puQ').value = '#BOB1'
  p.$('puFind').listeners.submit({ preventDefault() {} })
  await settle()
  assert.ok(p.asked.includes(`${PU}/search?q=%23BOB1`))
  const found = p.$('puFound').textContent
  assert.match(found, /profile 10 · Bobby/)
  assert.match(found, /Old Bob #BOB2 \(deleted\)/)
  assert.match(found, /7 records, 3 running/)
  button(p.$('puFound'), 'Bob #BOB1').listeners.click()
  await settle()
  assert.ok(p.asked.includes(`${PU}/player/10?limit=50`))
})

test('a chip pressed while a list is loading is not lost: the newest answer is the one shown', async () => {
  let slow = null
  const p = load(url => (url === `${PU}/recent?kind=strike%2Cwarn&limit=50`
    ? [200, { ...RECENT, rows: [ROW('dsc:10:1', 'warn', { state: 'recorded', active: false, reason: 'Spamming the trade chat' })] }]
    : panel(url)))
  await settle()
  const fetch0 = p.ctx.fetch
  p.ctx.fetch = url => (url === `${PU}/recent?kind=strike&limit=50` ? new Promise(done => { slow = done }) : fetch0(url))
  button(p.$('puRecent'), 'Strike').listeners.click()
  await settle()
  assert.ok(slow, 'the Strike load is still in flight')
  button(p.$('puRecent'), 'Warning').listeners.click()
  await settle()
  assert.ok(p.asked.includes(`${PU}/recent?kind=strike%2Cwarn&limit=50`), p.asked.join(' '))
  slow({ ok: true, status: 200, json: async () => RECENT })
  await settle()
  const text = p.$('puRecent').textContent
  assert.match(text, /Spamming the trade chat/)
  assert.doesNotMatch(text, /Kicked/)
})

test('a ban only the player log has is not called permanent; a timed IP ban shows its end', async () => {
  const p = load(url => (url.startsWith(`${PU}/recent`)
    ? [200, { ...RECENT, rows: [ROW('plog:gen1:9', 'ban', { source: 'playerLog', state: 'recorded', active: false, until: null, endsInMs: null, hours: null }),
      ROW('abn:ip2', 'ipban', { source: 'panelBans', until: '2026-10-22T05:00:00.000Z' })] }]
    : panel(url)))
  await settle()
  const text = p.$('puRecent').textContent
  assert.match(text, /Banned in the admin panel \(the log does not say for how long\)/)
  assert.doesNotMatch(text, /Banned, permanent/)
  assert.match(text, /IP ban, until 22 Oct 05:00 UTC/)
})
