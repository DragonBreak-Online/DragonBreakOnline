'use strict'

// Report-only ban check on PCs (security audit L3-01): only a keyed code is kept, a PC linked to a banned account is a lead
// for staff, and nothing is ever refused, evicted or shown with an id or a code
const { test, beforeEach, afterEach, after, mock } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs     = require('fs')
const os     = require('os')
const path   = require('path')

const dc = require('../sources/deviceChecks')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'device-checks-'))
const STORE = path.join(tmp, 'device-ids.json')
// Test-only secret, in the format openssl rand -hex 32 gives
const KEY = 'a1'.repeat(32)
const DAY = 24 * 60 * 60 * 1000
const T0 = Date.parse('2026-10-16T14:00:00.000Z')

// Test-only Discord ids made at the given time, as Discord makes them (ms since 2015 shifted left 22 bits)
const madeAt = (iso, n) => String(((BigInt(Date.parse(iso)) - 1420070400000n) << 22n) + BigInt(n))
const ULFR = madeAt('2024-02-01T10:00:00.000Z', 1)
const AELA = madeAt('2026-10-13T13:00:00.000Z', 2)
const BRYN = madeAt('2025-05-05T05:00:00.000Z', 3)
const NEWBIE = madeAt('2026-10-13T12:00:00.000Z', 4)
const VETERAN = madeAt('2026-10-13T12:00:00.000Z', 5)
const OLDTIMER = madeAt('2025-01-01T00:00:00.000Z', 6)
const NAMES = { [ULFR]: 'Ulfr #AB12', [AELA]: 'Aela Ironhand #K7Q2', [BRYN]: 'Brynjolf #BR77', [NEWBIE]: 'Newbie #NW01' }
const REF = 'B-7KQ2MX'

// What a launcher sends: v1. and the sha256 of its label and the machine id (here a made-up one per PC)
const code = pc => `v1.${crypto.createHash('sha256').update(`DragonBreak device v1\n${pc}`).digest('hex')}`
const stored = pc => crypto.createHmac('sha256', Buffer.from(KEY, 'hex')).update(`device:v1:${code(pc).slice(3)}`).digest('hex').slice(0, 32)

let now, lines, logs, errors, bans, players
const everything = []
// The new-account check is off unless a test turns it on, so each test sees only the lines it is about
function setup({ key = KEY, match = 'report', retention = 30, newDays = 0 } = {}) {
  dc._test.reset()
  fs.rmSync(STORE, { force: true })
  now = T0
  lines = []
  logs = []
  bans = []
  players = {}
  dc._test.use({
    now: () => now,
    audit: text => { lines.push(text); everything.push(text) },
    log: text => { logs.push(text); everything.push(text) },
    config: { deviceIdHmacKey: key, deviceMatch: match, deviceRetentionDays: retention, newAccountFlagDays: newDays },
    bans: () => bans,
    players: () => players,
    who: id => NAMES[id] || 'a player with no character yet',
    store: STORE,
  })
}
beforeEach(() => {
  errors = []
  mock.method(console, 'error', (...args) => { const t = args.join(' '); errors.push(t); everything.push(t) })
})
afterEach(() => mock.restoreAll())
after(() => { dc._test.reset(); fs.rmSync(tmp, { recursive: true, force: true }) })

const launch = (id, pc, { token = `token-${id}`, flow, body } = {}) =>
  dc.onLaunchCheck(token, { discordId: id, flow }, body || { filesVersion: 'files-1', plugins: [], ...(pc ? { device: code(pc) } : {}) })
const store = () => JSON.parse(fs.readFileSync(STORE, 'utf8'))
const devicesOf = id => (store().accounts[id] || { d: [] }).d.map(d => d.h)
const ban = (id, ref = REF, bannedAt = '2026-10-14T12:00:00.000Z') => { bans = bans.filter(b => b.discordId !== id).concat([{ discordId: id, ref, bannedAt, reason: 'test' }]) }
const counts = () => dc._test.state().counts

test('off without a key, or with one shorter than 64 hex characters: nothing is stored or flagged, said once', () => {
  for (const key of ['', 'a1'.repeat(31), 'z'.repeat(64), `${'a1'.repeat(32)}f`]) {
    setup({ key })
    ban(ULFR)
    launch(ULFR, 'pc-1')
    launch(AELA, 'pc-1', { token: 'other' })
    assert.equal(fs.existsSync(STORE), false, `key of length ${key.length}`)
    assert.deepEqual(lines, [])
    assert.equal(logs.length, 1)
    assert.match(logs[0], key ? /^\[device-check\] DEVICE_ID_HMAC_KEY is not 64 or more hex characters: the device check is off and nothing is stored$/
      : /^\[device-check\] DEVICE_ID_HMAC_KEY is not set: the device check is off and nothing is stored$/)
    assert.deepEqual(dc.statusFor(AELA, null), { links: [] })
  }
})

test('only the 32-hex keyed code is stored, never the launcher\'s value, in a 0600 file', () => {
  setup()
  launch(AELA, 'pc-1')
  const text = fs.readFileSync(STORE, 'utf8')
  assert.deepEqual(devicesOf(AELA), [stored('pc-1')])
  assert.match(stored('pc-1'), /^[0-9a-f]{32}$/)
  assert.ok(!text.includes(code('pc-1').slice(3)), 'the launcher value is not in the store')
  assert.ok(!text.includes(code('pc-1').slice(3, 35)), 'nor a piece of it')
  assert.doesNotMatch(text, /[0-9a-f]{33,}/)
  assert.equal(fs.statSync(STORE).mode & 0o777, 0o600)
  assert.deepEqual(Object.keys(store()), ['v', 'accounts'])
  assert.equal(store().v, 1)
  assert.deepEqual(store().accounts[AELA], { first: '2026-10-16', last: '2026-10-16', d: [{ h: stored('pc-1'), first: '2026-10-16', last: '2026-10-16', bound: false }], notAlt: {}, flags: {} })
})

test('a malformed value is dropped and counted; an older launcher\'s missing one and "unavailable" are counted', () => {
  setup()
  const bad = ['v1.xyz', `v2.${'a'.repeat(64)}`, 'a'.repeat(64), `v1.${'A'.repeat(64)}`, `v1.${'a'.repeat(63)}`, `v1.${'a'.repeat(65)}`, 42, {}, [code('pc-1')], 'x'.repeat(5000)]
  bad.forEach((device, i) => launch(AELA, null, { token: `t${i}`, body: { device } }))
  launch(AELA, null, { token: 'u', body: { deviceStatus: 'unavailable' } })
  launch(AELA, null, { token: 'n', body: { filesVersion: 'files-1', plugins: [] } })
  launch(AELA, null, { token: 'n2', body: null })
  assert.equal(fs.existsSync(STORE), false, 'a launch without a usable code stores nothing')
  assert.equal(counts().malformed, bad.length)
  assert.equal(counts().unavailable, 1)
  assert.equal(counts().none, 2)
  assert.equal(counts().withDevice, 0)
})

test('one code per session: a different one later on the same session is ignored and counted', () => {
  setup()
  launch(AELA, 'pc-1', { token: 's1' })
  launch(AELA, 'pc-2', { token: 's1' })
  launch(AELA, 'pc-1', { token: 's1' })
  assert.deepEqual(devicesOf(AELA), [stored('pc-1')])
  assert.equal(counts().sessionChanges, 1)
  launch(AELA, 'pc-2', { token: 's2' })
  assert.deepEqual(devicesOf(AELA), [stored('pc-1'), stored('pc-2')])
})

test('at most 3 new PCs a day and 5 in all; the extra ones are dropped, never the first, and churn is flagged once', () => {
  setup()
  for (const pc of ['pc-1', 'pc-2', 'pc-3', 'pc-4', 'pc-5']) launch(AELA, pc, { token: pc })
  assert.deepEqual(devicesOf(AELA), [stored('pc-1'), stored('pc-2'), stored('pc-3')])
  assert.equal(counts().capDrops, 2)
  assert.deepEqual(lines, ['DEVICE CHURN Aela Ironhand #K7Q2: more than 3 new PCs in one day; the extra ones were not recorded (a modified launcher is one possible cause).'])
  now += DAY
  for (const pc of ['pc-4', 'pc-5', 'pc-6']) launch(AELA, pc, { token: `${pc}-b` })
  assert.deepEqual(devicesOf(AELA), ['pc-1', 'pc-2', 'pc-3', 'pc-4', 'pc-5'].map(stored))
  assert.equal(lines.length, 1, 'churn is flagged once in 30 days')
  now += 30 * DAY
  for (const pc of ['pc-1', 'pc-7']) launch(AELA, pc, { token: `${pc}-c` })
  assert.deepEqual(devicesOf(AELA), ['pc-1', 'pc-2', 'pc-3', 'pc-4', 'pc-5'].map(stored), 'a known PC still refreshes; nothing is evicted')
  assert.equal(lines[1], 'DEVICE CHURN Aela Ironhand #K7Q2: more than 5 PCs on record; the extra ones were not recorded (a modified launcher is one possible cause).')
})

test('an account on a banned account\'s PC is an ALT CHECK lead, once in 30 days, with its context', () => {
  setup()
  now = Date.parse('2026-10-13T09:00:00.000Z')
  launch(ULFR, 'pc-1')
  ban(ULFR)
  now = T0
  players = { [AELA]: { createdAt: '2026-10-16T13:00:00.000Z' } }
  launch(AELA, 'pc-1')
  assert.deepEqual(lines, ['ALT CHECK (report only) Aela Ironhand #K7Q2: plays on a PC linked to banned account Ulfr #AB12 (ban B-7KQ2MX, banned 14 Oct). ' +
    'First seen here 2 days after the ban. Discord account 3 days old. Older launcher login, so this could be someone else\'s PC. ' +
    'A lead, not proof. Not an alt? Dashboard, search B-7KQ2MX, Not an alt.'])
  for (let d = 0; d < 29; d++) { now += DAY; launch(AELA, 'pc-1') }
  assert.equal(lines.length, 1)
  now += DAY
  launch(AELA, 'pc-1')
  assert.equal(lines.length, 2, 'again after 30 days while the link stands')
  assert.equal(counts().flags.alt, 2)
})

test('staff marking "not an alt" stops the lead for that ban until the ban is gone; the mark can be taken back', () => {
  setup()
  launch(ULFR, 'pc-1')
  ban(ULFR)
  launch(AELA, 'pc-1')
  assert.equal(lines.length, 1)
  assert.deepEqual(dc.setNotAlt(AELA, 'B-NNNNNN', true, 'rowan_staff'), { ok: false, error: 'noSuchLink' })
  assert.deepEqual(dc.setNotAlt(AELA, 'bad ref', true, 'rowan_staff'), { ok: false, error: 'invalidBanRef' })
  assert.deepEqual(dc.setNotAlt(AELA, REF, true, 'rowan_staff'), { ok: true, changed: true })
  assert.deepEqual(dc.setNotAlt(AELA, REF, true, 'rowan_staff'), { ok: true, changed: false })
  assert.equal(lines[1], 'NOT AN ALT Aela Ironhand #K7Q2 for ban B-7KQ2MX, marked by rowan_staff.')
  assert.deepEqual(store().accounts[AELA].notAlt, { [REF]: { by: 'rowan_staff', at: '2026-10-16' } })
  assert.deepEqual(dc.statusFor(AELA, null).links.map(l => [l.banRef, l.notAlt]), [[REF, true]])
  now += 31 * DAY
  launch(AELA, 'pc-1')
  launch(ULFR, 'pc-1')
  dc._test.sweep()
  assert.equal(lines.length, 2, 'no lead while the mark stands')
  // The ban is lifted: the mark goes with it, and a new ban of the same account is a new lead
  bans = []
  dc._test.prune()
  assert.deepEqual(store().accounts[AELA].notAlt, {})
  ban(ULFR, 'B-8ZZZZZ')
  launch(AELA, 'pc-1')
  assert.match(lines[2], /^ALT CHECK \(report only\) Aela Ironhand #K7Q2: .*\(ban B-8ZZZZZ, banned 14 Oct\)/)
  assert.deepEqual(dc.setNotAlt(AELA, 'B-8ZZZZZ', true, 'rowan_staff').ok, true)
  assert.deepEqual(dc.setNotAlt(AELA, 'B-8ZZZZZ', false, 'rowan_staff'), { ok: true, changed: true })
  assert.equal(lines.at(-1), 'NOT AN ALT Aela Ironhand #K7Q2 for ban B-8ZZZZZ, mark removed by rowan_staff.')
  assert.equal(counts().notAlt, 3)
})

test('a banned account back on a new PC puts that PC on its ban and flags the accounts that use it', () => {
  setup()
  ban(ULFR)
  players = { [AELA]: { createdAt: '2026-09-01T00:00:00.000Z' }, [BRYN]: { createdAt: '2026-09-02T00:00:00.000Z' } }
  launch(AELA, 'pc-9')
  launch(BRYN, 'pc-9')
  assert.deepEqual(lines, [])
  launch(ULFR, 'pc-9')
  assert.equal(lines.length, 3)
  assert.match(lines[0], /^ALT CHECK \(report only\) Aela Ironhand #K7Q2: plays on a PC linked to banned account Ulfr #AB12 \(ban B-7KQ2MX, banned 14 Oct\)\. Account existed 44 days before the ban\. Discord account 3 days old\. 1 other active account also plays on this PC\. /)
  assert.match(lines[1], /^ALT CHECK \(report only\) Brynjolf #BR77: .* Account existed 43 days before the ban\. Discord account 529 days old\. 1 other active account also plays on this PC\. /)
  assert.equal(lines[2], 'BANNED ACCOUNT BACK Ulfr #AB12 (ban B-7KQ2MX): played again from a PC not seen before; that PC is now on the ban.')
  launch(ULFR, 'pc-9', { token: 'again' })
  launch(AELA, 'pc-9', { token: 'again2' })
  assert.equal(lines.length, 3)
  assert.equal(counts().flags.back, 1)
})

test('after a new ban, the sweep flags every account on that account\'s PCs once', () => {
  setup()
  launch(ULFR, 'pc-3')
  launch(AELA, 'pc-3')
  dc._test.sweep()
  assert.deepEqual(lines, [])
  ban(ULFR)
  dc._test.sweep()
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^ALT CHECK \(report only\) Aela Ironhand #K7Q2: plays on a PC linked to banned account Ulfr #AB12 /)
  dc._test.sweep()
  ban(BRYN, 'B-AAAAAA')
  dc._test.sweep()
  assert.equal(lines.length, 1, 'the same lead is not posted twice')
})

test('retention: a PC goes 30 days after its last day, kept while its account is banned, gone after the unban', () => {
  setup()
  launch(AELA, 'pc-1')
  launch(ULFR, 'pc-2')
  ban(ULFR)
  now += 29 * DAY
  dc._test.prune()
  assert.deepEqual(devicesOf(AELA), [stored('pc-1')])
  now += DAY
  dc._test.prune()
  assert.equal(store().accounts[AELA], undefined, 'the PC and then the empty account entry are deleted')
  now += 70 * DAY
  dc._test.prune()
  assert.deepEqual(devicesOf(ULFR), [stored('pc-2')], 'kept for the life of the ban')
  bans = []
  dc._test.prune()
  assert.deepEqual(store().accounts, {})
})

test('DEVICE_RETENTION_DAYS shortens the keep time', () => {
  setup({ retention: 7 })
  launch(AELA, 'pc-1')
  now += 6 * DAY
  dc._test.prune()
  assert.deepEqual(devicesOf(AELA), [stored('pc-1')])
  now += DAY
  dc._test.prune()
  assert.deepEqual(store().accounts, {})
})

test('forgetting an account removes its entry, except a banned account\'s, and is safe to run twice', () => {
  setup()
  launch(AELA, 'pc-1')
  launch(ULFR, 'pc-1')
  ban(ULFR)
  assert.equal(dc.forgetAccount(AELA), 'removed')
  assert.equal(dc.forgetAccount(AELA), 'nothing')
  assert.equal(dc.forgetAccount(ULFR), 'kept-banned')
  assert.deepEqual(Object.keys(store().accounts), [ULFR])
  assert.equal(dc.forgetAccount('not-an-account'), 'nothing')
})

test('the Discord account age comes from the id itself', () => {
  setup()
  now = Date.parse('2016-05-01T11:18:25.796Z')
  // Discord's documented example id, made 2016-04-30T11:18:25.796Z
  assert.equal(dc.discordAgeDays('175928847299117063'), 1)
  now = T0
  assert.equal(dc.discordAgeDays(AELA), 3)
  assert.equal(dc.discordAgeDays(OLDTIMER), 653)
  for (const bad of ['123', 'abc', '9'.repeat(21), '', null, madeAt('2026-10-17T00:00:00.000Z', 7), '1'.repeat(16)]) assert.equal(dc.discordAgeDays(bad), null, String(bad))
})

test('NEW ACCOUNT: a young Discord account at its first launch, only if it never joined the game, older launchers too', () => {
  setup({ newDays: 30 })
  players = { [VETERAN]: { createdAt: '2026-10-13T12:00:00.000Z', lastGameJoinAt: '2026-10-14T12:00:00.000Z' }, [OLDTIMER]: {} }
  launch(NEWBIE, null)
  launch(NEWBIE, null, { token: 'second' })
  launch(VETERAN, 'pc-1')
  launch(OLDTIMER, 'pc-2')
  assert.deepEqual(lines, ['NEW ACCOUNT Newbie #NW01: Discord account 3 days old at first launch.'])
  assert.equal(counts().flags.new, 1)
  assert.deepEqual(store().accounts[NEWBIE], { first: '2026-10-16', last: '2026-10-16', d: [], notAlt: {}, flags: { new: '2026-10-16' } }, 'kept so it is flagged once')
  assert.deepEqual(Object.keys(store().accounts).sort(), [NEWBIE, VETERAN, OLDTIMER].sort())
  setup({ newDays: 0 })
  launch(NEWBIE, null)
  assert.deepEqual(lines, [], '0 turns it off')
  setup({ newDays: 2 })
  launch(NEWBIE, null)
  assert.deepEqual(lines, [])
  setup({ newDays: 30 })
  ban(NEWBIE)
  launch(NEWBIE, null)
  assert.deepEqual(lines, [], 'not for a banned account')
})

test('DEVICE_MATCH=off collects and flags nothing; enforce is not built and only reports', () => {
  setup({ match: 'off' })
  ban(ULFR)
  launch(ULFR, 'pc-1')
  launch(NEWBIE, 'pc-1')
  assert.equal(fs.existsSync(STORE), false)
  assert.deepEqual(lines, [])
  assert.deepEqual(logs, ['[device-check] DEVICE_MATCH=off: no device codes are collected and nothing is flagged'])
  setup({ match: 'enforce' })
  ban(ULFR)
  launch(ULFR, 'pc-1')
  launch(AELA, 'pc-1')
  assert.equal(logs[0], '[device-check] DEVICE_MATCH=enforce is not available yet; reporting only')
  assert.match(logs[1], /^\[device-check\] on, report only: /)
  assert.match(lines.at(-1), /^ALT CHECK \(report only\) /)
})

test('evidence from PC-bound logins says so; an older launcher login says it could be someone else\'s PC', () => {
  setup()
  launch(ULFR, 'pc-1', { flow: 'loopback' })
  ban(ULFR)
  launch(AELA, 'pc-1', { flow: 'loopback' })
  launch(BRYN, 'pc-1', { flow: 'server' })
  assert.match(lines[0], / PC-bound launcher login\. A lead, not proof\./)
  assert.match(lines[1], / Older launcher login, so this could be someone else's PC\. A lead, not proof\./)
  assert.deepEqual(dc.statusFor(AELA, null).links.map(l => l.bound), [true])
  assert.deepEqual(dc.statusFor(BRYN, null).links.map(l => l.bound), [false])
})

test('the dashboard view carries ban refs and counts, never a code', () => {
  setup()
  players = { [AELA]: { createdAt: '2026-10-16T13:00:00.000Z' } }
  launch(ULFR, 'pc-1')
  ban(ULFR)
  launch(AELA, 'pc-1')
  launch(BRYN, 'pc-1')
  const status = dc.statusFor(AELA)
  assert.deepEqual(status, { links: [{ banRef: REF, notAlt: false, sharedAccounts: 1, bound: false, createdVsBanDays: 2 }] })
  assert.deepEqual(dc.statusFor(ULFR, null), { links: [] }, 'the banned account itself is found by its own ref')
})

test('a store that cannot be read turns the check off and is left exactly as it was', () => {
  setup()
  fs.writeFileSync(STORE, '{"v":1,"accounts":{"cut')
  ban(ULFR)
  assert.doesNotThrow(() => launch(AELA, 'pc-1'))
  assert.doesNotThrow(() => { dc._test.prune(); dc._test.sweep(); dc.statusFor(AELA, null) })
  launch(AELA, 'pc-2', { token: 'again' })
  assert.equal(fs.readFileSync(STORE, 'utf8'), '{"v":1,"accounts":{"cut')
  assert.equal(errors.filter(e => e.includes('device-ids.json')).length, 1, 'said once')
  assert.throws(() => dc.forgetAccount(AELA), /cannot be read/)
  assert.deepEqual(lines, [])
})

test('the old raw-hwid routes and the hour\'s counts are counted in one line without values', () => {
  setup()
  dc.legacyHwidDiscarded()
  launch(AELA, 'pc-1')
  launch(BRYN, null)
  dc._test.logCounts()
  assert.equal(logs.at(-1), '[device-check] last hour: launch-checks with a device code 1, unavailable 0, none (older launcher) 1; malformed 0; ' +
    'session changes 0; cap drops 0; flags: alt check 0, new account 0, banned account back 0, churn 0; not-alt marks 0; legacy hwid discarded 1; until 2026-10-16T14:00Z')
  assert.equal(counts().withDevice, 0, 'counts start again')
  const before = logs.length
  dc._test.logCounts()
  assert.equal(logs.length, before, 'an hour with nothing counted prints nothing')
})

test('the count line is printed every hour, so a restart loses at most the last hour', t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const HOUR = 60 * 60 * 1000
  const hourLines = () => logs.filter(l => l.startsWith('[device-check] last hour:'))
  const withCode = line => Number(line.match(/with a device code (\d+),/)[1])
  try {
    setup()
    dc.start()
    launch(AELA, 'pc-1')
    t.mock.timers.tick(HOUR - 1)
    assert.equal(hourLines().length, 0, 'not before the hour')
    t.mock.timers.tick(1)
    assert.equal(hourLines().length, 1, 'printed on the hour')
    assert.equal(withCode(hourLines()[0]), 1)
    t.mock.timers.tick(3 * HOUR)
    assert.equal(hourLines().length, 1, 'hours with nothing counted print nothing')
    // One launch every 10 minutes for 5.5 hours, then a restart: only the launches since the last line are lost
    let launched = 0
    for (let i = 0; i < 33; i++) {
      launch(BRYN, null, { token: `t${i}` })
      launched++
      t.mock.timers.tick(10 * 60 * 1000)
    }
    const printed = hourLines().slice(1).reduce((sum, line) => sum + Number(line.match(/none \(older launcher\) (\d+);/)[1]), 0)
    assert.equal(hourLines().length, 6, 'one line for each hour with launches')
    assert.equal(launched - printed, counts().none, 'what is not yet printed is what a restart would lose')
    assert.ok(counts().none <= 6, `at most an hour of launches unprinted, got ${counts().none}`)
  } finally {
    dc._test.reset()
  }
})

test('requiring the module does nothing: no file, no timer, no log line', () => {
  const file = require.resolve('../sources/deviceChecks')
  const child = require('child_process').spawnSync(process.execPath, ['-e', `
    const before = process.getActiveResourcesInfo().length
    require(${JSON.stringify(file)})
    if (process.getActiveResourcesInfo().length !== before) process.exit(3)
  `], { encoding: 'utf8', cwd: tmp, timeout: 10000 })
  assert.equal(child.status, 0)
  assert.equal(child.stdout + child.stderr, '')
  assert.deepEqual(fs.readdirSync(tmp).filter(f => f !== 'device-ids.json'), [])
})

test('no audit line or log line holds a Discord id, a hex code or a profile number', () => {
  assert.ok(everything.length > 20)
  for (const text of everything) {
    assert.doesNotMatch(text, /\d{17,}/, text)
    assert.doesNotMatch(text, /[0-9a-f]{16,}/i, text)
    assert.doesNotMatch(text, /profile \d/i, text)
  }
})
