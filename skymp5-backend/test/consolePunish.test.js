'use strict'
// The remote console's /discipline rule (tagKindReason): parseAllow, the pre-check, its wording, runStaffCommand and the page's kinds

const { test, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
const rules = require('../sources/console/allowlist')
const { createConsoleFixture, uuid, ALLOW } = require('./helpers/consoleFixture')

const ch = n => String.fromCodePoint(n)
// The entry as console.js (gameplay branch punish-actions-1021) writes it with the repo config
const DISCIPLINE = {
  name: 'discipline', usage: '/discipline #TAG warn|strike|lift <reason>; suspend <1-720h|1-30d> <reason>; overturn <n> <reason>', rule: 'tagKindReason',
  help: "A warning, strike, suspension, lift or overturn on the player's account record, as in game; the player is told. The record view and list stay in game.",
  kinds: ['warn', 'strike', 'suspend', 'lift', 'overturn'], maxSuspendDays: 30,
}
const allowWith = (...extra) => rules.parseAllow(JSON.stringify([...ALLOW, ...extra]))
const pre = (text, allow = allowWith(DISCIPLINE), raw) => {
  const line = rules.cleanCommand(text)
  return line === null ? { why: 'clean' } : rules.precheck(line, allow, raw === undefined ? text : raw)
}
const R300 = `Took ${'a'.repeat(289)} goods`

test('parseAllow takes the game\'s /discipline entry: rule tagKindReason, its kinds, the longest suspension, the whole usage', () => {
  const allow = allowWith(DISCIPLINE)
  const d = allow.find(a => a.name === 'discipline')
  assert.deepEqual(d, { name: 'discipline', rule: 'tagKindReason', usage: DISCIPLINE.usage, help: DISCIPLINE.help, kinds: DISCIPLINE.kinds, maxSuspendDays: 30 })
  assert.equal(allow.length, ALLOW.length + 1)
  assert.ok(allow.filter(a => a.name !== 'discipline').every(a => a.kinds === undefined && a.maxSuspendDays === undefined), 'no other rule carries kinds')
  const narrow = allowWith({ ...DISCIPLINE, kinds: ['warn', 'strike', 'lift'], maxSuspendDays: undefined, usage: '/discipline #TAG warn|strike|lift <reason>' })
  assert.deepEqual(narrow.find(a => a.name === 'discipline').kinds, ['warn', 'strike', 'lift'], 'the config can leave kinds out, and then no length is needed')
})

test('parseAllow drops an allow.json whose /discipline entry is malformed (the game then decides alone)', () => {
  const bad = [
    { kinds: undefined }, { kinds: [] }, { kinds: 'warn' }, { kinds: ['warn', 'warn'] }, { kinds: ['warn', 'ban'] }, { kinds: ['__proto__'] }, { kinds: ['constructor'] },
    { kinds: ['warn', 'strike', 'suspend', 'lift', 'overturn', 'warn'] }, { kinds: [1] }, { maxSuspendDays: undefined }, { maxSuspendDays: '30' }, { maxSuspendDays: 0 },
    { maxSuspendDays: 0.01 }, { maxSuspendDays: 400 }, { maxSuspendDays: -1 }, { maxSuspendDays: null },
  ]
  for (const b of bad) assert.equal(allowWith({ ...DISCIPLINE, ...b }), null, JSON.stringify(b))
  assert.equal(rules.parseAllow(JSON.stringify([{ name: 'players', rule: 'any' }])), null, 'SEC-2: still no any rule')
})

test('the pre-check runs every kind: warn, strike, suspend 1h..720h and 1d..30d, lift, overturn 1..99999', () => {
  const ok = [
    '/discipline #8KWH warn Spamming the market chat', '/discipline #8kwh strike Griefing at the Bruma gate', '/discipline #8KWH suspend 12h stole from a barrel',
    '/discipline #8KWH suspend 3d stole from a barrel', '/discipline #8KWH suspend 720h the longest in hours', '/discipline #8KWH suspend 30d the longest in days',
    '/discipline #8KWH suspend 1h short one', '/discipline #8KWH lift appeal accepted by Nate', '/discipline #8KWH overturn 3 wrong person, see ticket 0141',
    '/discipline #8KWH overturn 99999 the largest number', '/discipline #8KWH WARN Upper case kind word', `/discipline #8KWH warn ${R300}`,
    `/discipline #8KWH warn Plain: . , ; : ! ? ' " ( ) - / & + % all allowed`, '/discipline #8KWH warn Åsa über Женя letters in any script',
    `/discipline #8KWH warn Caf${'e'}${ch(0x301)} composed by NFC`, `/discipline #8KWH warn spam${ch(0x202e)}med bidi folded to a space`,
  ]
  for (const t of ok) assert.equal(pre(t), null, t)
  let n = 0
  for (let h = 0; h <= 1000; h++) if (pre(`/discipline #8KWH suspend ${h}h stole goods`) === null) n++
  for (let d = 0; d <= 100; d++) if (pre(`/discipline #8KWH suspend ${d}d stole goods`) === null) n++
  assert.equal(n, 750, '1h..720h and 1d..30d')
})

test('the pre-check refuses names, wrong words, bad durations, record numbers, short or long reasons, bad characters, colour codes', () => {
  const no = [
    ['/discipline Bob warn spamming the chat', 'needTag'], ['/discipline Bob #8KWH warn spamming the chat', 'needTag'], ['/discipline 5 warn spamming the chat', 'needTag'],
    ['/discipline #8KW warn spamming the chat', 'needTag'], ['/discipline #8KWHX warn spamming the chat', 'needTag'], ['/discipline 8KWH warn spamming the chat', 'needTag'],
    ['/discipline', 'badKind'], ['/discipline #8KWH', 'badKind'], ['/discipline list', 'badKind'], ['/discipline #8KWH note quiet staff note', 'badKind'],
    ['/discipline #8KWH ban spamming the chat', 'badKind'], ['/discipline #8KWH tempban 3d spamming', 'badKind'], ['/discipline #8KWH kick spamming the chat', 'badKind'],
    ['/discipline #8KWH constructor spamming', 'badKind'], ['/discipline #8KWH __proto__ spamming', 'badKind'], ['/discipline #8KWH #LLX8 warn spamming', 'badKind'],
    ['/discipline #8KWH suspend stole from a barrel', 'badLength'], ['/discipline #8KWH suspend 0h stole goods', 'badLength'], ['/discipline #8KWH suspend 721h stole goods', 'badLength'],
    ['/discipline #8KWH suspend 31d stole goods', 'badLength'], ['/discipline #8KWH suspend 1.5d stole goods', 'badLength'], ['/discipline #8KWH suspend 0.01h stole goods', 'badLength'],
    ['/discipline #8KWH suspend 012h stole goods', 'badLength'], ['/discipline #8KWH suspend 3 stole goods', 'badLength'], ['/discipline #8KWH suspend 3w stole goods', 'badLength'],
    ['/discipline #8KWH suspend -3d stole goods', 'badLength'], ['/discipline #8KWH suspend 1e2h stole goods', 'badLength'], [`/discipline #8KWH suspend ${ch(0x663)}d stole goods`, 'badLength'],
    ['/discipline #8KWH overturn wrong person here', 'badRecord'], ['/discipline #8KWH overturn #3 wrong person', 'badRecord'], ['/discipline #8KWH overturn 03 wrong person', 'badRecord'],
    ['/discipline #8KWH overturn 0 wrong person', 'badRecord'], ['/discipline #8KWH overturn 123456 wrong person', 'badRecord'], ['/discipline #8KWH overturn 1.0 wrong person', 'badRecord'],
    ['/discipline #8KWH warn', 'reasonShort'], ['/discipline #8KWH warn abcd', 'reasonShort'], ['/discipline #8KWH lift 3', 'reasonShort'], ['/discipline #8KWH suspend 3d', 'reasonShort'],
    [`/discipline #8KWH warn ${R300}x`, 'reasonLong'],
    ['/discipline #8KWH warn #{ff0000}red text', 'reasonChars'], ['/discipline #8KWH warn [[S]]Server: fake', 'reasonChars'], ['/discipline #8KWH warn end ]] markup', 'reasonChars'],
    ['/discipline #8KWH warn <@300000000000000001> pinged', 'reasonChars'], ['/discipline #8KWH warn hi @everyone', 'reasonChars'], ['/discipline #8KWH warn a > b here', 'reasonChars'],
    ['/discipline #8KWH warn `code` in audit', 'reasonChars'], ['/discipline #8KWH warn pipe | here', 'reasonChars'], ['/discipline #8KWH warn back \\ slash', 'reasonChars'],
    ['/discipline #8KWH warn **bold** text', 'reasonChars'], ['/discipline #8KWH warn under_score', 'reasonChars'], ['/discipline #8KWH warn ~~struck~~', 'reasonChars'],
    ['/discipline #8KWH warn Ticket #0141 here', 'reasonChars'], [`/discipline #8KWH warn faces ${ch(0x1f600)} here`, 'reasonChars'],
    [`/discipline #8KWH warn ${ch(0x1d400)}${ch(0x1d401)}cdef astral letters`, 'reasonChars'], [`/discipline #8KWH warn x${ch(0x301)}${ch(0x301)} marks`, 'reasonChars'],
    ['/discipline #8KWH suspend 3d #{ff0000}red', 'reasonChars'], ['/discipline #8KWH overturn 2 [[A]]admin tab', 'reasonChars'],
  ]
  for (const [t, why] of no) assert.equal((pre(t) || {}).why, why, t)
  assert.equal(pre(`/discipline #8KWH warn ${'a'.repeat(478)}`).why, 'clean', 'over 500 characters is no command at all (badCommand)')
})

test('a reason holding a Hangul filler, a letter that draws nothing, is refused as reasonChars (review, 21 Oct; console.js BLANK_RE)', () => {
  for (const r of [ch(0x3164).repeat(5), ch(0x115f).repeat(5), ch(0x1160).repeat(5), ch(0xffa0).repeat(5), `ok ${ch(0x3164)} reason`]) {
    assert.equal(pre(`/discipline #8KWH warn ${r}`).why, 'reasonChars', JSON.stringify(r))
  }
  assert.equal(pre('/discipline #8KWH warn Hangul \uD55C\uAE00 letters stay fine'), null, 'real Hangul letters still pass')
})

test('a reason line typed with a line break is refused (oneLine); the folded line alone is not refused for it', () => {
  for (const t of ['/discipline #8KWH warn spamming the chat\n/kick #LLX8', '/discipline #8KWH warn first line\nsecond line', `/discipline #8KWH warn one${ch(0x2028)}two lines`,
    '/discipline #8KWH warn one\r\ntwo lines', `/discipline #8KWH warn one${ch(0x85)}two lines`]) assert.equal((pre(t) || {}).why, 'oneLine', JSON.stringify(t))
  assert.equal(pre('/discipline #8KWH warn spamming the chat\n'), null, 'a line break at the end is only trimmed')
  assert.equal(pre('/discipline #8KWH warn first line second line'), null)
  assert.equal(rules.precheck('/discipline #8KWH warn first line second line', allowWith(DISCIPLINE)), null, 'without the raw text (older callers) the cleaned line decides')
})

test('kinds the game left out of allow.json are refused as switched off, with the kind named; maxSuspendDays comes from allow.json', () => {
  const narrow = allowWith({ ...DISCIPLINE, kinds: ['warn', 'strike', 'lift'], maxSuspendDays: undefined, usage: '/discipline #TAG warn|strike|lift <reason>' })
  const s = pre('/discipline #8KWH suspend 3d stole goods', narrow)
  assert.deepEqual(s, { why: 'denied', cmd: 'discipline', subject: 'discipline suspend' })
  assert.equal(rules.whyText(s.why, s.cmd, '', s.subject), "/discipline suspend is switched off for the console in the game's config.")
  assert.equal((pre('/discipline #8KWH overturn 2 wrong person', narrow) || {}).why, 'denied')
  assert.equal(pre('/discipline #8KWH warn stole goods', narrow), null)
  const seven = allowWith({ ...DISCIPLINE, maxSuspendDays: 7 })
  assert.equal(pre('/discipline #8KWH suspend 7d stole goods', seven), null)
  assert.equal(pre('/discipline #8KWH suspend 168h stole goods', seven), null)
  const l = pre('/discipline #8KWH suspend 8d stole goods', seven)
  assert.deepEqual(l, { why: 'badLength', cmd: 'discipline', subject: 7 })
  assert.equal(rules.whyText(l.why, l.cmd, '', l.subject), 'Give a length in whole hours or days, 1h to 168h or 1d to 7d, like 12h or 3d.')
  assert.equal((pre('/discipline #8KWH warn stole goods', allowWith()) || {}).why, 'notYet', 'a game that does not publish /discipline: refused as before')
})

test('the refusals read as the game words them (console.js TEXT)', () => {
  const W = (why, subject) => rules.whyText(why, 'discipline', DISCIPLINE.usage, subject)
  assert.equal(W('badKind'), `From the console: ${DISCIPLINE.usage}. A player's record and /discipline list stay in game.`)
  assert.equal(W('badLength', 30), 'Give a length in whole hours or days, 1h to 720h or 1d to 30d, like 12h or 3d.')
  assert.equal(W('badRecord'), 'Give the record number in digits, like overturn 3 <reason>. /discipline #TAG in game shows the record.')
  assert.equal(W('reasonShort'), 'Give a reason of at least 5 characters. The player is shown it.')
  assert.equal(W('reasonLong'), 'The reason can be at most 300 characters.')
  assert.equal(W('reasonChars'), 'A reason from the console takes letters, numbers, spaces and . , ; : ! ? \' " ( ) - / & + % only: no colour codes, markup, mentions, symbols or line breaks.')
  assert.equal(W('oneLine'), 'From the console: one line of at most 500 characters.')
  assert.equal(W('needTag'), 'Name the player by #TAG from the console.')
})

// runStaffCommand and the page's state, against a scratch spool and a fake game
let F
const run = (text, id = uuid()) => F.api.runStaffCommand(F.api.webCaller(F.session(require('./helpers/consoleFixture').ID.jake)), { uuid: id, text })
before(() => { F = createConsoleFixture('dbo-console-punish-') })
after(() => F.cleanup())
beforeEach(() => {
  F.audits.length = 0; F.logs.length = 0; F.requests.length = 0; F.answer = null
  fs.writeFileSync(F.switchFile, 'on\n')
  fs.writeFileSync(path.join(F.dir, 'allow.json'), JSON.stringify([...ALLOW, DISCIPLINE]), { mode: 0o600 })
  F.make()
  F.startGame()
})

test('runStaffCommand sends a good /discipline line once, cleaned, and refuses a bad one before anything reaches the game', async () => {
  F.answer = () => ({ target: 'Bob #8KWH', lines: [{ to: 'you', text: 'Recorded: strike #2 on Bob #8KWH.' }] })
  const ok = await run('/discipline #8KWH strike  Griefing at the   Bruma gate')
  assert.equal(ok.status, 200)
  assert.equal(ok.body.job.state, 'ran')
  assert.equal(ok.body.job.summary, '/discipline #8KWH strike Griefing at the Bruma gate: ran - Recorded: strike #2 on Bob #8KWH.')
  assert.equal(F.requests.length, 1)
  assert.equal(F.requests[0].text, '/discipline #8KWH strike Griefing at the Bruma gate')
  for (const [t, why] of [['/discipline Bob strike griefing at the gate', 'needTag'], ['/discipline #8KWH warn #{ff0000}red text', 'reasonChars'],
    ['/discipline #8KWH suspend 1.5d stole goods', 'badLength'], ['/discipline #8KWH overturn #2 wrong person', 'badRecord'], ['/discipline #8KWH', 'badKind'],
    ['/discipline #8KWH warn spamming\n/kick #LLX8', 'oneLine']]) {
    const r = await run(t)
    assert.equal(r.status, 422, t)
    assert.equal(r.body.error, 'notRemote', t)
    assert.equal(r.body.why, why, t)
    assert.equal(r.body.reason, rules.whyText(why, 'discipline', DISCIPLINE.usage, why === 'badLength' ? 30 : undefined), t)
  }
  F.stopGame()
  assert.equal(F.requests.length, 1, 'no refused line was sent')
})

test('the page reads the kinds and the longest suspension with /discipline, and /kick as before', () => {
  const s = F.api.state('web')
  const d = s.commands.find(c => c.name === 'discipline')
  assert.deepEqual(d, { name: 'discipline', usage: DISCIPLINE.usage, help: DISCIPLINE.help, kinds: DISCIPLINE.kinds, maxSuspendDays: 30 })
  assert.deepEqual(s.commands.find(c => c.name === 'kick'), { name: 'kick', usage: '/kick #TAG', help: 'x' })
  fs.writeFileSync(path.join(F.dir, 'allow.json'), JSON.stringify([...ALLOW, { ...DISCIPLINE, kinds: ['warn', 'strike'], maxSuspendDays: undefined, usage: '/discipline #TAG warn|strike <reason>' }]), { mode: 0o600 })
  assert.deepEqual(F.api.state('web').commands.find(c => c.name === 'discipline').kinds, ['warn', 'strike'], 'a kind the game denies is not offered')
  fs.writeFileSync(path.join(F.dir, 'allow.json'), JSON.stringify([...ALLOW, { ...DISCIPLINE, kinds: ['warn', 'ban'] }]), { mode: 0o600 })
  assert.deepEqual(F.api.state('web').commands, [], 'a malformed allow.json lists nothing (the game still checks)')
})
