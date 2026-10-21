'use strict'
// The bot's Discord ban snapshot on the game ban list (a private copy of bans.js on a temp list). With the Punishments
// panel's game bans on (PUNISH_ACTIONS bans area 'on'): a Discord ban never overwrites a game ban, a Discord unban never
// lifts one, an unreadable list is never replaced. With them off (the default) the bot does as it did before. A ban the
// dashboard claimed gets no second journal row. Also the list's fail-closed writes the Punishments panel uses.

const { test, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const stub = (file, exports) => { const p = require.resolve(file, { paths: [ROOT] }); require.cache[p] = { id: p, filename: p, loaded: true, exports } }
// Test-only ids
const GUILD = '500000000000000005', ZED = '209000000000000209', AMY = '209000000000000210'
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-banlist-'))
fs.mkdirSync(path.join(DIR, 'sources'))
fs.mkdirSync(path.join(DIR, 'data'))
for (const f of ['bans.js', 'storeFile.js']) fs.copyFileSync(path.join(ROOT, 'sources', f), path.join(DIR, 'sources', f))
process.env.BAN_LOG_DIR = path.join(DIR, 'logs')
const bans = require(path.join(DIR, 'sources', 'bans.js'))
const BANS = path.join(DIR, 'data', 'bans.json')
const JOURNAL = path.join(DIR, 'moderation.jsonl')

const handlers = {}
class FakeClient { on(ev, fn) { handlers[ev] = fn; return this } once() { return this } }
stub('discord.js', { Client: FakeClient, GatewayIntentBits: { Guilds: 1, GuildMembers: 2, GuildModeration: 4 }, AuditLogEvent: { MemberBanAdd: 22, MemberBanRemove: 23, MemberUpdate: 24 }, PermissionFlagsBits: {} })
const SWITCH = path.join(DIR, 'punish-actions')
const config = { discordGuildId: GUILD, discordBotToken: '', discordLogChannelId: '', punishJournalFile: JOURNAL, punishActions: 'on', punishActionsSwitchFile: SWITCH }
stub(path.join(ROOT, 'config.js'), config)
stub(path.join(ROOT, 'sources/bans.js'), bans)
stub(path.join(ROOT, 'sources/players.js'), { load: () => ({ [ZED]: { lastIp: '81.2.69.160' } }) })
stub(path.join(ROOT, 'sources/profiles.js'), { load: () => ({ nextId: 300, map: { [ZED]: 209 } }) })
stub(path.join(ROOT, 'sources/discord/tickets.js'), { ensurePanel: async () => {}, handleInteraction: async () => false })
stub(path.join(ROOT, 'sources/discord/serverStatus.js'), { start: () => {} })
const lines = []
stub(path.join(ROOT, 'sources/discord/audit.js'), { log: text => lines.push(text) })
stub(path.join(ROOT, 'routes/site-auth.js'), { internals: { readStore: () => [], dynamicFields: cf => cf.dynamicFields, ownedBy: () => true } })

require('../sources/discord/bot')
const w = require('../sources/discord/banAudit').WAITS_MS
w.splice(0, w.length, 0, 5, 10)
const journal = require('../sources/discord/moderationJournal')

const guild = { id: GUILD, fetchAuditLogs: async () => ({ entries: new Map() }) }
const ban = (id = ZED) => ({ guild, user: { id, username: 'zed_user' } })
const settle = () => new Promise(r => setTimeout(r, 80))
const list = () => JSON.parse(fs.readFileSync(BANS, 'utf8'))
const rows = () => (fs.existsSync(JOURNAL) ? fs.readFileSync(JOURNAL, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [])
const gameBan = { discordId: ZED, ref: 'B-GAME01', hwid: null, ip: null, reason: 'Duping gold at the bank', bannedAt: '2026-10-21T10:00:00.000Z', bannedBy: 'jake (dashboard)' }

beforeEach(() => { fs.rmSync(BANS, { force: true }); fs.rmSync(JOURNAL, { force: true }); fs.rmSync(SWITCH, { force: true }); lines.length = 0; config.punishActions = 'on' })
after(() => fs.rmSync(DIR, { recursive: true, force: true }))

test('a Discord ban adds its copy to the game ban list; a game ban already there is kept, reason, ref and all', async () => {
  handlers.guildBanAdd(ban())
  await settle()
  const copy = list()[0]
  assert.deepEqual([copy.discordId, copy.reason, copy.bannedBy], [ZED, 'discord ban', 'discord'])
  assert.match(lines.at(-1), new RegExp(`added to the game ban list as ${copy.ref}`))
  fs.writeFileSync(BANS, JSON.stringify([gameBan]))
  handlers.guildBanAdd(ban())
  await settle()
  assert.deepEqual(list(), [gameBan])
  assert.match(lines.at(-1), /already on the game ban list as B-GAME01; kept/)
})

test('a Discord unban lifts only the Discord copy; a game ban stays, and the audit line says where to lift it', async () => {
  fs.writeFileSync(BANS, JSON.stringify([gameBan, { discordId: AMY, ref: 'B-C0PY01', reason: 'discord ban', bannedBy: 'discord', bannedAt: '2026-10-21T10:00:00.000Z' }]))
  handlers.guildBanRemove(ban(ZED))
  await settle()
  assert.deepEqual(list().map(e => e.ref), ['B-GAME01', 'B-C0PY01'])
  assert.match(lines.at(-1), /the game ban B-GAME01 stays; lift it on the dashboard/)
  handlers.guildBanRemove(ban(AMY))
  await settle()
  assert.deepEqual(list().map(e => e.ref), ['B-GAME01'])
  assert.match(lines.at(-1), /lifted from the game ban list/)
})

test('a ban list that cannot be read is never replaced by a Discord ban or unban', async () => {
  fs.writeFileSync(BANS, '[{"discordId": "1"')
  handlers.guildBanAdd(ban())
  await settle()
  assert.match(lines.at(-1), /the game ban list could not be written/)
  handlers.guildBanRemove(ban())
  await settle()
  assert.match(lines.at(-1), /the game ban list could not be updated/)
  assert.equal(fs.readFileSync(BANS, 'utf8'), '[{"discordId": "1"')
})

test('a ban or unban the dashboard claimed gets no second journal row from the bot; one it did not claim does', async () => {
  journal.claimBan(ZED, 'discord_ban')
  handlers.guildBanAdd(ban())
  await settle()
  assert.equal(rows().length, 0)
  handlers.guildBanRemove(ban())
  await settle()
  assert.deepEqual(rows().map(r => [r.kind, r.via]), [['discord_unban', 'discord']])
  journal.claimBan(ZED, 'discord_unban')
  handlers.guildBanRemove(ban())
  await settle()
  assert.equal(rows().length, 1)
})

test('the panel\'s writes fail closed: a new ban only, never an address, and a list that cannot be read is an error', () => {
  const made = bans.addNew({ discordId: ZED, reason: 'Griefing at the bank', bannedBy: 'jake (dashboard)' })
  assert.match(made.entry.ref, /^B-[0-9A-HJKMNP-TV-Z]{6}$/)
  assert.deepEqual([made.entry.ip, made.entry.hwid], [null, null])
  assert.deepEqual(bans.addNew({ discordId: ZED, reason: 'again' }), { existing: list()[0] })
  assert.equal(bans.findEntry(ZED).ref, made.entry.ref)
  assert.equal(bans.findEntry(AMY), null)
  assert.deepEqual(bans.removeEntry(AMY), { none: true })
  assert.equal(bans.removeEntry(ZED).removed.ref, made.entry.ref)
  assert.deepEqual(list(), [])
  fs.rmSync(BANS)
  assert.equal(bans.findEntry(ZED), null, 'no list yet is no ban')
  fs.writeFileSync(BANS, '{"not": "a list"}')
  for (const call of [() => bans.findEntry(ZED), () => bans.addNew({ discordId: ZED, reason: 'x' }), () => bans.removeEntry(ZED)]) {
    assert.throws(call, e => e.code === 'ESTOREUNREADABLE')
  }
  assert.equal(fs.readFileSync(BANS, 'utf8'), '{"not": "a list"}')
})

// The guard follows the panel's game bans: PUNISH_ACTIONS (unset is off) narrowed by the switch file
const banLog = () => { try { return fs.readFileSync(path.join(DIR, 'logs', 'ban.log'), 'utf8') } catch { return '' } }
const offs = [
  ['PUNISH_ACTIONS unset', () => { config.punishActions = undefined }],
  ['PUNISH_ACTIONS off', () => { config.punishActions = 'off' }],
  ['PUNISH_ACTIONS dry-run', () => { config.punishActions = 'dry-run' }],
  ['PUNISH_ACTIONS on bans=dry-run', () => { config.punishActions = 'on bans=dry-run' }],
  ['PUNISH_ACTIONS on bans=off', () => { config.punishActions = 'on bans=off' }],
  ['the switch file says off', () => { fs.writeFileSync(SWITCH, 'off\n') }],
  ['the switch file is malformed', () => { fs.writeFileSync(SWITCH, 'yes please\n') }],
]
for (const [name, set] of offs) {
  test(`switch off (${name}): a Discord ban replaces a game ban and a Discord unban lifts it, as before the guard`, async () => {
    set()
    fs.writeFileSync(BANS, JSON.stringify([gameBan]))
    const logBefore = banLog()
    handlers.guildBanAdd(ban())
    await settle()
    const copy = list()
    assert.equal(copy.length, 1)
    assert.deepEqual([copy[0].discordId, copy[0].ref, copy[0].reason, copy[0].bannedBy, copy[0].ip], [ZED, 'B-GAME01', 'discord ban', 'discord', '81.2.69.160'])
    assert.match(lines.at(-1), /added to the game ban list as B-GAME01/)
    assert.match(banLog().slice(logBefore.length), /discord ban: discordId=209000000000000209 username=zed_user hwid=none ip=81\.2\.69\.160/)
    fs.writeFileSync(BANS, JSON.stringify([gameBan]))
    handlers.guildBanRemove(ban())
    await settle()
    assert.deepEqual(list(), [])
    assert.match(lines.at(-1), /lifted from the game ban list/)
    assert.deepEqual(rows().map(r => [r.kind, r.via]), [['discord_ban', 'discord'], ['discord_unban', 'discord']])
  })
}

test('switch off: an unreadable list is read as bans.load reads it (no fail-closed refusal), as before the guard', async () => {
  config.punishActions = undefined
  fs.writeFileSync(BANS, '[{"discordId": "1"')
  handlers.guildBanAdd(ban())
  await settle()
  assert.doesNotMatch(lines.at(-1), /could not be written/)
  assert.deepEqual(list().map(e => e.discordId), [ZED], 'bans.load() reads an unreadable list as empty, the hazard the guard closes once bans are on')
})

test('the guard is on only for bans=on: PUNISH_ACTIONS on, or on with discord or send narrowed, and a switch file that leaves bans on', async () => {
  for (const [env, file] of [['on', null], ['on discord=off send=off', null], ['on', 'on\n'], ['on', 'on send=dry-run\n']]) {
    config.punishActions = env
    fs.rmSync(SWITCH, { force: true })
    if (file) fs.writeFileSync(SWITCH, file)
    fs.writeFileSync(BANS, JSON.stringify([gameBan]))
    handlers.guildBanAdd(ban())
    await settle()
    assert.deepEqual(list(), [gameBan], `${env} / ${file}`)
    handlers.guildBanRemove(ban())
    await settle()
    assert.deepEqual(list(), [gameBan], `${env} / ${file}`)
  }
})
