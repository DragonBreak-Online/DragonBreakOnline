'use strict'
// Record files for the Punishments panel tests, laid out as on CT 115: a game server folder whose world/ links to a state
// folder (discipline.json, restitution-state.json beside it), the backend's bans.json and moderation journal, and a
// player log folder. Every Discord id here is made up (15 to 18 digits), so the tests can look for any of them in a response.

const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')

const HOUR = 3600000
const DAY = 24 * HOUR

// Viewers (sessions) and the accounts records are about
const PEOPLE = {
  owner: { discordId: '900000000000000001', profileId: 1, roles: ['role-owner'], name: 'Jake' },
  dev: { discordId: '900000000000000002', profileId: 2, roles: ['role-dev'], name: 'Nate' },
  lead: { discordId: '900000000000000003', profileId: 30, roles: ['role-lead'], name: 'Lena' },
  gm: { discordId: '900000000000000004', profileId: 4, roles: ['role-gm'], name: 'Gus' },
  trial: { discordId: '900000000000000005', profileId: 5, roles: ['role-trial'], name: 'Tia' },
  none: { discordId: '900000000000000006', profileId: 6, roles: [], name: 'Pat' },
  bob: { discordId: '800000000000000010', profileId: 10, roles: [], name: 'Bobby' },
  gina: { discordId: '800000000000000020', profileId: 20, roles: ['role-gm'], name: 'Gina' },
  rep: { discordId: '800000000000000101', profileId: 101, roles: [], name: 'Vex' },
  ivan: { discordId: '800000000000000040', profileId: 40, roles: [], name: 'Ivan' },
  // Banned on Discord before ever playing: no profile, not in the guild
  ghost: { discordId: '800000000000000444', profileId: null, roles: null, name: 'Ghost' },
  // Whose raw Discord id the old /dashboard wrote as bannedBy
  actor: { discordId: '800000000000000555', profileId: 55, roles: [], name: 'Old Admin' },
}
const SECRET_STRINGS = ['81.2.69.', '2001:db8', 'bob@example.com', 'hwid-raw-value', '<@', ...Object.values(PEOPLE).map(p => p.discordId),
  '222222222222222222', '333333333333333333']

function forms() {
  const cf = (desc, profileId, name, tag, extra = {}) => ({
    cf: { recType: 1, profileId, formDesc: desc, displayName: name, dynamicFields: { 'private.charTag': tag, ...(extra.df || {}) }, isDeleted: !!extra.deleted },
    char: { profileId, formDesc: desc, name, deleted: !!extra.deleted, dead: false, appearance: { name } },
    mtime: new Date(),
  })
  return [
    cf('ff000010', 10, 'Bob', 'BOB1', { df: { 'private.dboSentence': { door: 1, cell: 'x', totalMs: 30 * 60000, servedMs: 10 * 60000, by: 'Guard Gus #GRD1', at: Date.now() - HOUR, arrester: 5, concordat: { by: 'Gus #GRD1 (profile 4, <@900000000000000004>)', at: Date.now() - HOUR } } } }),
    cf('ff000011', 10, 'Old Bob', 'BOB2', { deleted: true }),
    cf('ff000020', 20, 'Gina', 'GIN1', { df: { 'private.dboSentence': { totalMs: 20 * 60000, servedMs: 0, by: 'Lena #LED1', at: Date.now() } } }),
    cf('ff000030', 30, 'Lena', 'LED1'),
    cf('ff000101', 101, 'Vexa', 'VKRS'),
    cf('ff000040', 40, 'Ivan', 'IVN1'),
    cf('ff000001', 1, 'Jake', 'JAKE'),
    cf('ff000002', 2, 'Nate', 'NATE'),
    cf('ff000055', 55, 'Admin', 'ADM1'),
  ]
}

function createPunishFixture(now = Date.now()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-punish-'))
  const game = path.join(root, 'server')
  const state = path.join(root, 'state')
  const data = path.join(root, 'data')
  const plog = path.join(root, 'playerlog')
  for (const d of [game, state, path.join(state, 'world'), data, path.join(plog, 'events'), path.join(plog, 'archive'), path.join(plog, 'forwarder')]) fs.mkdirSync(d, { recursive: true })
  fs.symlinkSync(path.join(state, 'world'), path.join(game, 'world'))
  const iso = t => new Date(t).toISOString()
  const write = (file, value) => fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 1))

  const discipline = {
    profiles: {
      10: [
        { n: 1, kind: 'warn', reason: 'Spamming the trade chat', by: 'Lena #LED1', byProfile: 30, at: iso(now - 20 * DAY), char: 'Bob #BOB1', seen: true },
        { n: 2, kind: 'strike', reason: 'Killed a player at the bank', by: 'Lena #LED1', byProfile: 30, at: iso(now - 10 * DAY), char: 'Bob #BOB1', seen: false },
        { n: 3, kind: 'suspend', reason: 'Harassment', by: 'Lena #LED1', byProfile: 30, at: iso(now - 9 * DAY), char: 'Bob #BOB1', seen: false, until: now - 5 * DAY, lifted: true },
        { n: 4, kind: 'lift', reason: 'Apologised to the player', by: 'Jake #JAKE', byProfile: 1, at: iso(now - 8 * DAY), char: 'Bob #BOB1', seen: true },
        { n: 5, kind: 'strike', reason: 'Exploit that the game allowed', by: 'Gus #GRD1', byProfile: 4, at: iso(now - 7 * DAY), char: 'Bob #BOB1', seen: true, overturned: { by: 'Lena #LED1', byProfile: 30, at: iso(now - 6 * DAY), reason: 'The game allowed it' } },
        { n: 6, kind: 'overturn', reason: 'The game allowed it', by: 'Lena #LED1', byProfile: 30, at: iso(now - 6 * DAY), char: 'Bob #BOB1', seen: true, undid: 5 },
        { n: 7, kind: 'suspend', reason: 'Threats to <@800000000000000020> from 81.2.69.160, mail bob@example.com', by: 'Lena #LED1', byProfile: 30, at: iso(now - HOUR), char: 'Bob #BOB1', seen: false, until: now + 37 * HOUR },
      ],
      20: [{ n: 1, kind: 'warn', reason: 'Teleported a player without asking', by: 'Jake #JAKE', byProfile: 1, at: iso(now - 3 * DAY), char: 'Gina #GIN1', seen: true }],
      30: [{ n: 1, kind: 'strike', reason: 'Gave items to a friend', by: 'Jake #JAKE', byProfile: 1, at: iso(now - 2 * DAY), char: 'Lena #LED1', seen: true }],
      2: [{ n: 1, kind: 'warn', reason: 'Dev test warning', by: 'Jake #JAKE', byProfile: 1, at: iso(now - 4 * DAY), char: 'Nate #NATE', seen: true }],
      1: [{ n: 1, kind: 'warn', reason: 'Owner test warning', by: 'Nate #NATE', byProfile: 2, at: iso(now - 4 * DAY), char: 'Jake #JAKE', seen: true }],
      101: [{ n: 1, kind: 'suspend', reason: 'Temporary ban for 38 hours (ticket rep-0305)', by: 'Jake', byProfile: 0, at: iso(now - HOUR), char: 'profile 101', seen: false, key: 'rep-0305', from: now - HOUR, until: now + 37 * HOUR }],
    },
  }
  write(path.join(state, 'discipline.json'), discipline)
  write(path.join(state, 'discipline-discord.json'), { 'rep-0305': ['222222222222222222', '333333333333333333'] })
  write(path.join(game, 'gamemode-config.json'), {
    discipline: { enabled: true, strikeDays: 90, strikesForReview: 3, record: [] },
    restitution: { enabled: true, cases: ['0138'], sweepSeconds: 60 },
    other: { secretish: 'never read past the two keys' },
  })
  write(path.join(game, 'restitution-cases.json'), { '0138': { _comment: 'Ticket #0138: what Bob #BOB1 took', tag: 'BOB1', bankGold: true, notice: 'Staff have taken back goods you took (ticket #0138).', items: { '1397f': 9, f: 100 } } })
  write(path.join(state, 'restitution-state.json'), { cases: { '0138': { recovered: { '1397f': 4, f: 100 }, fromContainer: {}, log: [{ at: iso(now - 9 * DAY), where: 'bank of Bob #BOB1 (profile 10, <@800000000000000010>)', taken: { f: 100 } }] } } })
  write(path.join(game, 'admin-bans.json'), {
    bans: [
      { id: 'tb1', profileId: 10, name: 'Bob', ip: '', until: now + 5 * HOUR, reason: 'Griefing', by: 'profile 1', at: now - HOUR },
      { id: 'ip1', profileId: 40, name: 'Ivan', ip: '81.2.69.161', until: 0, reason: 'Ban evasion', by: 'profile 1', at: now - 2 * HOUR },
    ],
  })
  const bansFile = path.join(data, 'bans.json')
  write(bansFile, [
    { discordId: PEOPLE.ghost.discordId, ref: 'B-WG6QYG', hwid: null, ip: null, reason: 'discord ban', bannedAt: iso(now - 3 * HOUR), bannedBy: 'discord' },
    { discordId: PEOPLE.ivan.discordId, hwid: 'hwid-raw-value', ip: '81.2.69.162', reason: 'dashboard ban', bannedAt: iso(now - 4 * HOUR), bannedBy: PEOPLE.actor.discordId },
  ])
  const journalFile = path.join(data, 'moderation.jsonl')
  write(journalFile, [
    JSON.stringify({ v: 1, id: 'M-AAAAAA', at: iso(now - 2 * HOUR), kind: 'discord_timeout', discordId: PEOPLE.bob.discordId, profileId: 10, tags: ['BOB1'], name: 'Bob', discordName: 'Bobby', until: iso(now + 2 * HOUR), reason: 'Spam in <#123456789012345678>', by: { name: 'Lena', profileId: 30, discordName: 'Lena' }, ticket: 'rep-0305', via: 'bot' }),
    '{ not json',
    JSON.stringify({ v: 1, id: 'M-BBBBBB', at: iso(now - 30 * HOUR), kind: 'discord_timeout', discordId: PEOPLE.ivan.discordId, profileId: 40, tags: ['IVN1'], until: iso(now - 29 * HOUR), reason: 'Spam', by: { discordName: 'Gina' }, via: 'discord' }),
    '{"v":1,"id":"M-CCCCCC","kind":"discord_ban","at":"half a line',
  ].join('\n'))

  // Player log: an archived panel kick (the hook and the GM line both wrote it), today's /kick, a sleep (not a punishment),
  // a Discord ban, three suspension kicks in an hour; and the forwarder's copy, which must never be read
  const day = t => new Date(t).toISOString().slice(0, 10)
  const ev = (t, s, ev, p, c, n, f, extra = {}) => JSON.stringify({ v: 1, t, ev, p, c, n, d: PEOPLE.bob.discordId, a: 'ff000010', src: extra.src || 'hook:leave', g: 'gen1', s, f, ...(extra.o ? { o: extra.o } : {}) })
  const staffParty = (role, p) => [{ r: role, p: p.profileId, c: 'GIN1', n: 'Gina', a: 'ff000020', d: p.discordId }]
  const old = now - 5 * DAY
  fs.writeFileSync(path.join(plog, 'archive', `${day(old)}.jsonl.gz`), zlib.gzipSync([
    ev(old, 1, 'session.kick', 10, 'BOB1', 'Bob', { kind: 'panel' }),
    ev(old + 300, 2, 'session.kick', 10, 'BOB1', 'Bob', { kind: 'panel' }, { src: 'audit:GM', o: staffParty('staff', PEOPLE.gina) }),
    ev(old + 1000, 3, 'session.move', 10, 'BOB1', 'Bob', {}),
  ].join('\n') + '\n'))
  // Older than the window: never shown
  fs.writeFileSync(path.join(plog, 'archive', `${day(now - 120 * DAY)}.jsonl.gz`), zlib.gzipSync(ev(now - 120 * DAY, 1, 'session.kick', 10, 'BOB1', 'Bob', { kind: 'command' }) + '\n'))
  const today = now - 30 * 60000
  fs.writeFileSync(path.join(plog, 'events', `${day(now)}.jsonl`), [
    ev(today, 10, 'session.kick', 40, 'IVN1', 'Ivan', { kind: 'command' }, { src: 'audit:GM', o: staffParty('staff', PEOPLE.gina) }),
    ev(today + 1, 11, 'session.kick', 40, 'IVN1', 'Ivan', { kind: 'sleep' }),
    ev(today + 2, 12, 'session.ban', 40, 'IVN1', 'Ivan', { kind: 'ban' }, { src: 'audit:BAN' }),
    ev(today + 3, 13, 'session.ban', 10, 'BOB1', 'Bob', { kind: 'suspend', entry: 7 }, { src: 'audit:DISCIPLINE' }),
    ev(today + 10, 14, 'session.kick', 10, 'BOB1', 'Bob', { kind: 'suspension' }),
    ev(today + 600000, 15, 'session.kick', 10, 'BOB1', 'Bob', { kind: 'suspension' }),
    ev(today + 1200000, 16, 'session.kick', 10, 'BOB1', 'Bob', { kind: 'suspension' }),
  ].join('\n') + '\n' + '{"v":1,"t":1,"ev":"session.kick","p":10,"f":{"kind":"comm')
  fs.writeFileSync(path.join(plog, 'events', `${day(now)}.fwd.jsonl`), ev(today, 99, 'session.kick', 10, 'BOB1', 'Bob', { kind: 'command' }, { src: 'forwarded' }) + '\n')
  fs.writeFileSync(path.join(plog, 'forwarder', 'state.jsonl'), ev(today, 98, 'session.kick', 10, 'BOB1', 'Bob', { kind: 'command' }) + '\n')

  const profilesMap = Object.fromEntries(Object.values(PEOPLE).filter(p => p.profileId).map(p => [p.discordId, p.profileId]))
  const players = Object.fromEntries(Object.values(PEOPLE).map(p => [p.discordId, { profileId: p.profileId, discordId: p.discordId, username: p.name.toLowerCase().replace(/ /g, ''), displayName: p.name, avatar: 'https://cdn.discordapp.com/avatars/x.png', lastIp: '81.2.69.170', hwid: 'hwid-raw-value', notes: '' }]))

  return {
    root, game, state, data, plog, bansFile, journalFile, now,
    profiles: { nextId: 200, map: profilesMap },
    players,
    forms: forms(),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}

module.exports = { createPunishFixture, PEOPLE, SECRET_STRINGS, HOUR, DAY }
