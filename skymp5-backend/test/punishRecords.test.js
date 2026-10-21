'use strict'
// sources/punish: the scrub, the cursor, the record parsers and the file readers on their own

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { scrub } = require('../sources/punish/scrub')
const R = require('../sources/punish/records')
const { jsonFile, jsonlTail } = require('../sources/punish/files')
const { decodeCursor, encodeCursor, paginate } = require('../sources/punish')

test('scrub: mentions, ids, addresses, emails and secrets go; one line; capped', () => {
  assert.equal(scrub('to <@123456789012345678> and <@!123456789012345678> in <#123456789012345678> for <@&123456789012345678>'), 'to [id] and [id] in [id] for [id]')
  assert.equal(scrub('id 123456789012345678 here'), 'id [id] here')
  assert.equal(scrub('from 81.2.69.160 or 81.2.69.160:7777 or 2001:db8::1'), 'from [address] or [address] or [address]')
  assert.equal(scrub('mail bob@example.com now'), 'mail [email] now')
  assert.equal(scrub('until 23 Oct 05:00 UTC, client 0.3.98'), 'until 23 Oct 05:00 UTC, client 0.3.98')
  assert.equal(scrub('two\nlines\u202e\u200b here'), 'two lines here')
  assert.equal([...scrub('x'.repeat(500))].length, 300)
  assert.equal([...scrub('x'.repeat(500), 40)].length, 40)
  for (const v of [null, undefined, '', '   ', {}, []]) assert.equal(scrub(v), null)
})

test('ticketOf reads rep-0305 and "ticket #0141"', () => {
  assert.equal(R.ticketOf('rep-0305'), 'rep-0305')
  assert.equal(R.ticketOf(null, 'Temporary ban for 38 hours (ticket rep-0305)'), 'rep-0305')
  assert.equal(R.ticketOf('Ticket #0138 (11 Oct)'), '#0138')
  assert.equal(R.ticketOf('nothing', undefined), null)
})

test('cursor: round trip, and anything else is refused', () => {
  const c = encodeCursor(1792540800000, 'dsc:10:7')
  assert.deepEqual(decodeCursor(c), { key: 1792540800000, id: 'dsc:10:7' })
  assert.equal(decodeCursor(undefined), null)
  for (const bad of ['!!', 'a'.repeat(201), encodeCursor(1.5, 'dsc:1:1'), encodeCursor(1, 'x:1'), Buffer.from('{"a":1}').toString('base64url'), ['a']]) {
    assert.throws(() => decodeCursor(bad), err => err.code === 'badCursor', String(bad))
  }
})

test('paginate: key then id, from just after the cursor, ties included', () => {
  const rows = [5, 4, 4, 4, 3, 1].map((k, i) => ({ id: `ban:i${i}`, k }))
  const seen = []
  let cursor = null
  for (;;) {
    const p = paginate(rows, r => r.k, -1, cursor, 2)
    seen.push(...p.rows.map(r => r.id))
    if (!p.next) break
    cursor = decodeCursor(p.next)
  }
  assert.deepEqual(seen, rows.map(r => r.id))
})

test('discipline: lifts found, strikes counted in their window, suspensions by state', () => {
  const now = Date.parse('2026-10-21T15:00:00Z')
  const at = d => new Date(now - d * 86400000).toISOString()
  const entries = R.parseDiscipline({ profiles: { 7: [
    { n: 1, kind: 'strike', reason: 'old', by: 'A #AAAA', at: at(100), char: 'P #PPPP' },
    { n: 2, kind: 'strike', reason: 'new', by: 'A #AAAA', at: at(1), char: 'P #PPPP' },
    { n: 3, kind: 'suspend', reason: 'x', by: 'A #AAAA', at: at(2), char: 'P #PPPP', until: now + 3600000, lifted: true },
    { n: 4, kind: 'suspend', reason: 'y', by: 'cfg', at: at(0), char: 'profile 7', key: 'k1', from: now + 3600000, until: now + 7200000 },
    { n: 5, kind: 'lift', reason: 'sorry', by: 'B #BBBB', at: at(1), char: 'P #PPPP' },
    { n: 6, kind: 'bogus' }, 'junk',
  ], x: 'not a list' } })
  assert.equal(entries.length, 5)
  const { rows, strikes } = R.disciplineRows(entries, { now, strikeDays: 90, held: new Map([['k1', 2]]) })
  const by = Object.fromEntries(rows.map(r => [r.id, r]))
  assert.equal(by['dsc:7:1'].state, 'expired')
  assert.equal(by['dsc:7:2'].state, 'counting')
  assert.equal(strikes.get(7), 1)
  assert.equal(by['dsc:7:3'].state, 'lifted')
  assert.equal(by['dsc:7:3'].lifted.by, 'B #BBBB')
  assert.equal(by['dsc:7:5'].lifts, 3)
  assert.equal(by['dsc:7:4'].state, 'scheduled')
  assert.equal(by['dsc:7:4'].active, true)
  assert.equal(by['dsc:7:4'].alsoHolds, 2)
  assert.deepEqual(by['dsc:7:4'].target, { profileId: 7, name: null, tag: null, discordName: null })
  assert.throws(() => R.parseDiscipline({ nope: 1 }))
})

test('parsers keep no address, hwid or Concordat "by", and bans.json is parsed without sources/bans.js', () => {
  const ab = R.parseAdminBans({ bans: [{ id: 'a1', profileId: 3, name: 'X', ip: '81.2.69.1', until: 0, reason: 'r', by: 'profile 1', at: 5 }, { id: '../x' }] })
  assert.equal(ab.length, 1)
  assert.equal(JSON.stringify(ab).includes('81.2.69.1'), false)
  assert.equal(R.adminBanRows(ab, { now: 10 })[0].kind, 'ipban')
  const bans = R.parseBans([{ discordId: '123456789012345678', hwid: 'h', ip: '81.2.69.2', reason: 'dashboard ban', bannedAt: '2026-10-01T00:00:00Z', bannedBy: '123456789012345679' }, 7])
  assert.deepEqual(Object.keys(bans[0]).sort(), ['_byDiscordId', '_discordId', 'atMs', 'by', 'i', 'reason', 'ref'])
  assert.equal(bans[0].by, null)
  const jail = R.jailRows([{ key: 'ff01', profileId: 1, name: 'N', tag: 'TTTT', sentence: { totalMs: 600000, servedMs: 0, by: 'G #GGGG', at: 1, concordat: { by: 'G #GGGG (profile 2, <@123456789012345678>)' } } }], { now: 0 })
  assert.equal(jail[0].concordat, true)
  assert.equal(JSON.stringify(jail).includes('<@'), false)
  assert.deepEqual(R.jailRows([{ key: 'ff02', sentence: { totalMs: 600000, servedMs: 600000 } }], { now: 0 }), [], 'a served sentence is over')
})

test('journal: a later timeout or a timeout_end ends a running timeout', () => {
  const now = Date.parse('2026-10-21T15:00:00Z')
  const line = (id, kind, at, until) => R.parseJournalLine({ v: 1, id, kind, at, until, discordId: '123456789012345678', reason: 'r' })
  const rows = R.journalRows([
    line('M-AAAAAA', 'discord_timeout', '2026-10-21T10:00:00Z', '2026-10-22T10:00:00Z'),
    line('M-BBBBBB', 'discord_timeout_end', '2026-10-21T11:00:00Z'),
    line('M-CCCCCC', 'discord_timeout', '2026-10-21T12:00:00Z', '2026-10-21T20:00:00Z'),
  ], { now })
  assert.deepEqual(rows.map(r => [r.id, r.state]), [['mod:M-AAAAAA', 'ended'], ['mod:M-BBBBBB', 'recorded'], ['mod:M-CCCCCC', 'running']])
  assert.equal(R.parseJournalLine({ v: 2, id: 'M-AAAAAA', kind: 'discord_timeout', at: '2026-10-21T10:00:00Z' }), null)
  assert.equal(R.parseJournalLine({ v: 1, id: 'nope', kind: 'discord_timeout', at: '2026-10-21T10:00:00Z' }), null)
})

test('jsonFile: changes picked up, a file over the cap or broken keeps the last good copy, a missing one is empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-punish-files-'))
  try {
    const file = path.join(dir, 'a.json')
    fs.writeFileSync(file, '{"n":1}')
    const f = jsonFile(file, v => v.n, { maxBytes: 64 })
    assert.deepEqual(f.read(), { status: 'ok', asOf: fs.statSync(file).mtime.toISOString(), value: 1 })
    fs.writeFileSync(file, '{"n":2,"pad":"' + 'x'.repeat(100) + '"}')
    assert.equal(f.read().status, 'unreadable')
    assert.equal(f.read().value, 1)
    fs.writeFileSync(file, '{"n":3}')
    assert.equal(f.read().value, 3)
    fs.writeFileSync(file, '{"n":')
    assert.deepEqual([f.read().status, f.read().value], ['unreadable', 3])
    fs.rmSync(file)
    assert.deepEqual(f.read(), { status: 'missing', asOf: null, value: null })
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('jsonlTail: reads on from where it stopped, never a half line, starts again on a new file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-punish-tail-'))
  try {
    const file = path.join(dir, 'j.jsonl')
    fs.writeFileSync(file, '{"a":1}\n{bad\n{"a":2')
    const t = jsonlTail(file, o => (typeof o.a === 'number' ? o.a : null), { minIntervalMs: 0 })
    assert.deepEqual([t.read().rows, t.read().bad], [[1], 1])
    fs.appendFileSync(file, '}\n{"a":3}\n')
    assert.deepEqual(t.read().rows, [1, 2, 3])
    fs.rmSync(file)
    fs.writeFileSync(file, '{"a":9}\n')
    assert.deepEqual(t.read().rows, [9])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('player log: the names of a kick\'s player and staff member are scrubbed like every other name', () => {
  const id = '1'.repeat(18)
  const rows = R.playerLogRows([{ g: 'g1', s: 1, t: 1000, ev: 'session.kick', kind: 'command', p: 10, c: 'BOB1', n: `Bo‮b ${id}`,
    by: { p: 20, c: 'GIN1', n: `Gi​na <@${id}>` } }])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].target.name, 'Bo b [id]')
  assert.equal(rows[0].by, 'Gi na [id] #GIN1')
  assert.doesNotMatch(JSON.stringify(rows), /\d{15,}|<@|[​‮]/)
})
