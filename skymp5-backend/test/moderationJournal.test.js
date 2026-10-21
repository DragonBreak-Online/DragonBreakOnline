'use strict'
// Discord timeouts, bans and unbans go to the moderation journal (data/moderation.jsonl) as they happen, in the shape the
// Punishments panel reads; a journal that cannot be written changes nothing else the bot does

const { test, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const stub = (file, exports) => { const p = require.resolve(file, { paths: [ROOT] }); require.cache[p] = { id: p, filename: p, loaded: true, exports } }
// Test-only ids
const GUILD = '500000000000000005', ZED = '209000000000000209', MOD = '100000000000000001', BOT = '100000000000000002'
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-modjournal-'))
const FILE = path.join(DIR, 'moderation.jsonl')

const handlers = {}
class FakeClient { on(ev, fn) { handlers[ev] = fn; return this } once() { return this } }
stub('discord.js', { Client: FakeClient, GatewayIntentBits: { Guilds: 1, GuildMembers: 2, GuildModeration: 4 }, AuditLogEvent: { MemberBanAdd: 22, MemberBanRemove: 23, MemberUpdate: 24 } })
const config = { discordGuildId: GUILD, discordBotToken: '', discordLogChannelId: '', punishJournalFile: FILE }
stub(path.join(ROOT, 'config.js'), config)
const banList = new Set()
stub(path.join(ROOT, 'sources/bans.js'), { add: e => { banList.add(e.discordId); return { ...e, ref: 'B-AAAAAA' } }, logBan: () => {}, removeByDiscordId: id => banList.delete(id) })
stub(path.join(ROOT, 'sources/players.js'), { load: () => ({}) })
stub(path.join(ROOT, 'sources/profiles.js'), { load: () => ({ nextId: 300, map: { [ZED]: 209 } }) })
stub(path.join(ROOT, 'sources/discord/tickets.js'), { ensurePanel: async () => {}, handleInteraction: async () => false })
stub(path.join(ROOT, 'sources/discord/serverStatus.js'), { start: () => {} })
const lines = []
stub(path.join(ROOT, 'sources/discord/audit.js'), { log: text => lines.push(text) })
stub(path.join(ROOT, 'routes/site-auth.js'), { internals: {
  readStore: () => [{ cf: { dynamicFields: { 'private.charTag': 'RC9H' } }, char: { profileId: 209, deleted: false } }],
  dynamicFields: cf => cf.dynamicFields,
  ownedBy: () => true,
} })

require('../sources/discord/bot')
const w = require('../sources/discord/banAudit').WAITS_MS
w.splice(0, w.length, 0, 5, 10)
require('../sources/discord/moderationJournal').TIMING.auditGraceMs = 20
const R = require('../sources/punish/records')
const { jsonlTail } = require('../sources/punish/files')

let entries = []
const users = { [ZED]: { id: ZED, username: 'zed_user', globalName: 'Zed', bot: false }, [MOD]: { id: MOD, username: 'rowan_staff', bot: false }, [BOT]: { id: BOT, username: 'dbo_bot', bot: true } }
const fetched = []
const client = { users: { fetch: async id => { fetched.push(id); if (users[id]) return users[id]; throw Object.assign(new Error('Unknown User'), { code: 10013 }) } } }
const guild = { id: GUILD, client, roles: { cache: new Map() }, fetchAuditLogs: async ({ type }) => ({ entries: new Map(entries.filter(e => e.action === type).map((e, i) => [String(i), e])) }) }
const entry = (action, extra) => ({ action, targetId: ZED, executorId: MOD, executor: { username: 'rowan_staff', bot: false }, reason: 'spam in <#123456789012345678>', createdTimestamp: Date.now() - 1000, ...extra })
// A gateway audit log entry as discord.js builds it: executor and target are null when the bot has not cached them
const iso = ms => (ms ? new Date(ms).toISOString() : undefined)
const gateway = (wasUntil, until, extra = {}) => ({ action: 24, targetId: ZED, target: null, executorId: MOD, executor: null, reason: 'spam in <#123456789012345678>',
  changes: [{ key: 'communication_disabled_until', ...(wasUntil ? { old: iso(wasUntil) } : {}), ...(until ? { new: iso(until) } : {}) }], ...extra })
const member = (until, extra = {}) => ({ id: ZED, guild, user: { id: ZED, username: 'zed_user', globalName: 'Zed' }, roles: { cache: new Map() }, nickname: null, communicationDisabledUntilTimestamp: until, ...extra })
const settle = () => new Promise(r => setTimeout(r, 120))
const journal = () => (fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [])

beforeEach(() => { fs.rmSync(FILE, { force: true }); entries = []; lines.length = 0; fetched.length = 0; config.punishJournalFile = FILE })
after(() => fs.rmSync(DIR, { recursive: true, force: true }))

test('a timeout given in Discord is journalled with who, why, until and the account, as the panel reads it', async () => {
  const until = Date.now() + 38 * 3600000
  entries = [entry(24, { changes: [{ key: 'nick' }], executor: { username: 'wrong_entry' } }), entry(24, { changes: [{ key: 'communication_disabled_until' }] })]
  handlers.guildMemberUpdate(member(null), member(until))
  await settle()
  const [e] = journal()
  assert.equal(e.kind, 'discord_timeout')
  assert.equal(e.until, new Date(until).toISOString())
  assert.equal(e.by.discordName, 'rowan_staff', 'the timeout\'s own audit entry, not a nickname change')
  assert.equal(e.reason, 'spam in [id]')
  assert.equal(e.profileId, 209)
  assert.deepEqual(e.tags, ['RC9H'])
  assert.equal(e.discordName, 'Zed')
  assert.match(e.id, /^M-[0-9A-HJKMNP-TV-Z]{6}$/)
  assert.equal(fs.statSync(FILE).mode & 0o777, 0o600)
  const rows = R.journalRows(jsonlTail(FILE, R.parseJournalLine, { minIntervalMs: 0 }).read().rows, { now: Date.now() })
  assert.deepEqual(rows.map(r => [r.kind, r.state, r.target.profileId]), [['discord_timeout', 'running', 209]])
})

test('a timeout taken off early is journalled; one running out by itself, or a nickname change, is not', async () => {
  handlers.guildMemberUpdate(member(Date.now() + 3600000), member(null))
  handlers.guildMemberUpdate(member(Date.now() - 1000), member(null))
  handlers.guildMemberUpdate(member(null, { nickname: 'a' }), member(null, { nickname: 'b' }))
  await settle()
  assert.deepEqual(journal().map(e => e.kind), ['discord_timeout_end'])
})

test('a Discord ban and unban are journalled after their audit line, and the ban list still changes', async () => {
  entries = [entry(22, { reason: 'threats (ticket rep-0305)' }), entry(23, { reason: 'appeal accepted' })]
  handlers.guildBanAdd({ guild, user: { id: ZED, username: 'zed_user' } })
  await settle()
  handlers.guildBanRemove({ guild, user: { id: ZED, username: 'zed_user' } })
  await settle()
  const j = journal()
  assert.deepEqual(j.map(e => [e.kind, e.reason, e.ticket, e.by.discordName]), [['discord_ban', 'threats (ticket rep-0305)', 'rep-0305', 'rowan_staff'], ['discord_unban', 'appeal accepted', null, 'rowan_staff']])
  assert.equal(lines.filter(l => /^(BAN|UNBAN) /.test(l)).length, 2)
  assert.equal(banList.has(ZED), false)
})

test('another guild, or a journal that cannot be written, changes nothing else', async () => {
  handlers.guildMemberUpdate(member(null, { guild: { id: '1' } }), member(Date.now() + 3600000, { guild: { id: '1' } }))
  await settle()
  assert.deepEqual(journal(), [])
  config.punishJournalFile = path.join(DIR, 'no-such-folder', 'moderation.jsonl')
  entries = [entry(22)]
  handlers.guildBanAdd({ guild, user: { id: ZED, username: 'zed_user' } })
  await settle()
  assert.equal(banList.has(ZED), true)
  assert.equal(lines.filter(l => /^BAN /.test(l)).length, 1)
  config.punishJournalFile = ''
  handlers.guildMemberUpdate(member(null), member(Date.now() + 3600000))
  await settle()
})

test('a timeout on a member the bot has not cached is journalled from the audit log entry, with who and why', async () => {
  const until = Date.now() + 37 * 3600000 + 1000
  handlers.guildAuditLogEntryCreate(gateway(null, until), guild)
  await settle()
  const [e, more] = journal()
  assert.equal(more, undefined)
  assert.deepEqual([e.kind, e.until, e.by.discordName, e.reason, e.via], ['discord_timeout', iso(until), 'rowan_staff', 'spam in [id]', 'discord'])
  assert.deepEqual([e.profileId, e.tags, e.discordName], [209, ['RC9H'], 'Zed'])
  assert.deepEqual(fetched.sort(), [MOD, ZED].sort(), 'the executor and the member are fetched when not cached')
  const rows = R.journalRows(jsonlTail(FILE, R.parseJournalLine, { minIntervalMs: 0 }).read().rows, { now: Date.now() })
  assert.deepEqual(rows.map(r => [r.kind, r.state, r.target.profileId]), [['discord_timeout', 'running', 209]])
  handlers.guildAuditLogEntryCreate(gateway(until, null, { reason: null }), guild)
  await settle()
  assert.deepEqual(journal().map(x => [x.kind, x.until, x.reason]), [['discord_timeout', iso(until), 'spam in [id]'], ['discord_timeout_end', null, null]])
})

test('the audit log entry and the member update of one timeout give one row, whichever comes first, with the entry\'s who', async () => {
  entries = [entry(24, { changes: [{ key: 'communication_disabled_until' }], executor: { username: 'from_rest', bot: false } })]
  const known = { executor: users[MOD], target: users[ZED] }
  const a = Date.now() + 2 * 3600000 + 3000, b = Date.now() + 3 * 3600000 + 3000
  handlers.guildMemberUpdate(member(null), member(a))
  handlers.guildAuditLogEntryCreate(gateway(null, a, known), guild)
  handlers.guildAuditLogEntryCreate(gateway(a, b, known), guild)
  handlers.guildMemberUpdate(member(a), member(b))
  await settle()
  handlers.guildMemberUpdate(member(b), member(null))
  handlers.guildAuditLogEntryCreate(gateway(b, null, known), guild)
  await settle()
  assert.deepEqual(journal().map(e => [e.kind, e.until, e.by.discordName]), [['discord_timeout', iso(a), 'rowan_staff'], ['discord_timeout', iso(b), 'rowan_staff'], ['discord_timeout_end', null, 'rowan_staff']])
  assert.deepEqual(fetched, [], 'nothing fetched for a cached executor and member')
})

test('audit log entries for a nickname, an expired timeout, another guild or no journal give nothing; a bot\'s timeout reads via bot', async () => {
  const until = Date.now() + 4 * 3600000 + 5000
  handlers.guildAuditLogEntryCreate(gateway(null, null, { changes: [{ key: 'nick', old: 'a', new: 'b' }] }), guild)
  handlers.guildAuditLogEntryCreate(gateway(Date.now() - 1000, null), guild)
  handlers.guildAuditLogEntryCreate(gateway(null, until, { action: 22 }), guild)
  handlers.guildAuditLogEntryCreate(gateway(null, until), { id: '1', client })
  await settle()
  assert.deepEqual(journal(), [])
  config.punishJournalFile = ''
  handlers.guildAuditLogEntryCreate(gateway(null, until + 1000), guild)
  await settle()
  config.punishJournalFile = FILE
  handlers.guildAuditLogEntryCreate(gateway(null, until + 2000, { executorId: BOT }), guild)
  await settle()
  assert.deepEqual(journal().map(e => [e.kind, e.by.discordName, e.via]), [['discord_timeout', 'dbo_bot', 'bot']])
})

test('with no audit log access, a member update is still journalled after the wait, with no moderator', async () => {
  const fetchAuditLogs = guild.fetchAuditLogs
  guild.fetchAuditLogs = async () => { throw Object.assign(new Error('Missing Permissions'), { code: 50013 }) }
  try {
    handlers.guildMemberUpdate(member(null), member(Date.now() + 5 * 3600000 + 7000))
    await settle()
    assert.deepEqual(journal().map(e => [e.kind, e.by.discordName, e.reason]), [['discord_timeout', null, null]])
  } finally { guild.fetchAuditLogs = fetchAuditLogs }
})
