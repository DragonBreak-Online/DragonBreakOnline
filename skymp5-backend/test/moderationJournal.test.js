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
const GUILD = '500000000000000005', ZED = '209000000000000209', MOD = '100000000000000001'
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
const R = require('../sources/punish/records')
const { jsonlTail } = require('../sources/punish/files')

let entries = []
const guild = { id: GUILD, roles: { cache: new Map() }, fetchAuditLogs: async ({ type }) => ({ entries: new Map(entries.filter(e => e.action === type).map((e, i) => [String(i), e])) }) }
const entry = (action, extra) => ({ action, targetId: ZED, executorId: MOD, executor: { username: 'rowan_staff', bot: false }, reason: 'spam in <#123456789012345678>', createdTimestamp: Date.now() - 1000, ...extra })
const member = (until, extra = {}) => ({ id: ZED, guild, user: { id: ZED, username: 'zed_user', globalName: 'Zed' }, roles: { cache: new Map() }, nickname: null, communicationDisabledUntilTimestamp: until, ...extra })
const settle = () => new Promise(r => setTimeout(r, 80))
const journal = () => (fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [])

beforeEach(() => { fs.rmSync(FILE, { force: true }); entries = []; lines.length = 0; config.punishJournalFile = FILE })
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
