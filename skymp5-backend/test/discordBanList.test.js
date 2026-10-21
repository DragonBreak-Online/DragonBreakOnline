'use strict'
// The bot's Discord ban snapshot on the game ban list (a private copy of bans.js on a temp list): a Discord ban never
// overwrites a game ban, a Discord unban never lifts one, an unreadable list is never replaced, and a ban the dashboard
// claimed gets no second journal row. Also the list's fail-closed writes the Punishments panel uses.

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
stub(path.join(ROOT, 'config.js'), { discordGuildId: GUILD, discordBotToken: '', discordLogChannelId: '', punishJournalFile: JOURNAL })
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

beforeEach(() => { fs.rmSync(BANS, { force: true }); fs.rmSync(JOURNAL, { force: true }); lines.length = 0 })
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
