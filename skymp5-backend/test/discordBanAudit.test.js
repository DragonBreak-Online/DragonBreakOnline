'use strict'

// A ban or unban issued on Discord goes to the staff audit channel with who, why and the game profile (security audit L4-2)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const stub = (file, exports) => { const p = require.resolve(file, { paths: [ROOT] }); require.cache[p] = { id: p, filename: p, loaded: true, exports } }
// Test-only ids
const GUILD = '500000000000000005', ZED = '209000000000000209', MOD = '100000000000000001', NOPROFILE = '700000000000000007'

const handlers = {}
class FakeClient { on(ev, fn) { handlers[ev] = fn; return this } once() { return this } }
stub('discord.js', { Client: FakeClient, GatewayIntentBits: { Guilds: 1, GuildMembers: 2, GuildModeration: 4 }, AuditLogEvent: { MemberBanAdd: 22, MemberBanRemove: 23 } })
stub(path.join(ROOT, 'config.js'), { discordGuildId: GUILD, discordBotToken: '', discordLogChannelId: '' })
const onList = new Set()
const banList = []
let listBroken = false
stub(path.join(ROOT, 'sources/bans.js'), {
  add: entry => { if (listBroken) throw new Error('EACCES'); onList.add(entry.discordId); banList.push(entry); return { ...entry } },
  logBan: () => {},
  removeByDiscordId: id => onList.delete(id),
})
stub(path.join(ROOT, 'sources/players.js'), { load: () => ({}) })
let profileMap = { [ZED]: 209 }
stub(path.join(ROOT, 'sources/profiles.js'), { load: () => { if (!profileMap) throw new Error('profiles.json FAIL CLOSED'); return { nextId: 300, map: profileMap } } })
stub(path.join(ROOT, 'sources/discord/tickets.js'), { ensurePanel: async () => {}, handleInteraction: async () => false })
stub(path.join(ROOT, 'sources/discord/serverStatus.js'), { start: () => {} })
const lines = []
stub(path.join(ROOT, 'sources/discord/audit.js'), { log: text => lines.push(text) })
// The site's character store: Zed's two characters, a deleted one, and one stamped with another Discord id
const form = (profileId, tag, extra = {}) => ({ cf: { dynamicFields: { 'private.charTag': tag, 'private.indexed.discordId': extra.stamp || ZED } }, char: { profileId, deleted: !!extra.deleted } })
let store = () => [form(209, 'RC9H'), form(209, 'K7QM'), form(209, 'DEAD', { deleted: true }), form(209, 'XXXX', { stamp: MOD }), form(1, 'PGDB', { stamp: MOD })]
stub(path.join(ROOT, 'routes/site-auth.js'), { internals: {
  readStore: () => store(),
  dynamicFields: cf => cf.dynamicFields,
  ownedBy: (cf, id) => cf.dynamicFields['private.indexed.discordId'] === id,
} })

require('../sources/discord/bot')
// The audit-log retry waits made short for the test (the module exists once the fix is in)
try { const w = require('../sources/discord/banAudit').WAITS_MS; w.splice(0, w.length, 0, 5, 10) } catch { /* not there before the fix */ }

let entries = [], denied = false, fetches = 0
const guild = {
  id: GUILD,
  fetchAuditLogs: async ({ type }) => {
    fetches++
    if (denied) throw Object.assign(new Error('Missing Permissions'), { code: 50013 })
    return { entries: new Map(entries.filter(e => e.action === type).map((e, i) => [String(i), e])) }
  },
}
const entry = (action, extra) => ({ action, targetId: ZED, executorId: MOD, executor: { username: 'rowan_staff', bot: false }, reason: 'threats in chat', createdTimestamp: Date.now() - 1000, ...extra })
const ban = (id = ZED, username = 'zed_user', g = guild) => ({ guild: g, user: { id, username } })
const settle = async (ms = 60) => { await new Promise(r => setTimeout(r, ms)) }
const reset = () => { lines.length = 0; entries = []; denied = false; fetches = 0 }
const noIds = l => ![ZED, MOD, NOPROFILE].some(id => l.includes(id))

test('a guild ban goes to the audit channel: the account by username, profile and #TAGs, the moderator and the reason', async () => {
  reset()
  entries = [entry(22)]
  handlers.guildBanAdd(ban())
  await settle()
  assert.equal(banList.at(-1).discordId, ZED, 'the ban list snapshot is taken as before')
  assert.deepEqual(lines, ['BAN zed_user (profile 209: #RC9H, #K7QM) banned on Discord by rowan_staff; added to the game ban list; reason: threats in chat'])
  assert.ok(lines.every(noIds), 'no Discord id value in the line')
})

test('a guild unban goes there too, saying the game ban list was lifted', async () => {
  reset()
  onList.add(ZED)
  entries = [entry(23, { reason: 'appeal accepted' })]
  handlers.guildBanRemove(ban())
  await settle()
  assert.deepEqual(lines, ['UNBAN zed_user (profile 209: #RC9H, #K7QM) unbanned on Discord by rowan_staff; lifted from the game ban list; reason: appeal accepted'])
})

test('an unban of someone not on the game ban list is still recorded', async () => {
  reset()
  onList.delete(ZED)
  entries = [entry(23, { reason: '', executor: { username: 'MEE6', bot: true } })]
  handlers.guildBanRemove(ban())
  await settle()
  assert.deepEqual(lines, ['UNBAN zed_user (profile 209: #RC9H, #K7QM) unbanned on Discord by MEE6 (bot); it was not on the game ban list; no reason given'])
})

test('no View Audit Log: an unknown moderator, after one read', async () => {
  reset()
  denied = true
  handlers.guildBanAdd(ban(NOPROFILE, 'alt_account'))
  await settle()
  assert.deepEqual(lines, ['BAN alt_account (no game profile) banned on Discord by an unknown moderator (the bot cannot read the Discord audit log); added to the game ban list; no reason given'])
  assert.equal(fetches, 1)
  assert.ok(lines.every(noIds))
})

test('an entry Discord writes a moment late is found on the next read; an old one is not this ban', async () => {
  reset()
  entries = [entry(22, { createdTimestamp: Date.now() - 10 * 60 * 1000 })]
  handlers.guildBanAdd(ban())
  await settle()
  assert.match(lines[0] || '', / by an unknown moderator; /)
  reset()
  const real = guild.fetchAuditLogs
  guild.fetchAuditLogs = async o => { if (fetches === 1) entries = [entry(22, { reason: 'late entry' })]; return real(o) }
  handlers.guildBanAdd(ban())
  await settle()
  guild.fetchAuditLogs = real
  assert.match(lines[0] || '', / by rowan_staff; .*reason: late entry$/)
})

test('a reason with a line break stays one line, and a broken profile store still records the ban', async () => {
  reset()
  profileMap = null
  entries = [entry(22, { reason: 'threats\n[2026-10-15 00:00:00] PERM fake line' })]
  handlers.guildBanAdd(ban())
  await settle()
  profileMap = { [ZED]: 209 }
  assert.equal(lines.length, 1)
  assert.equal(lines[0], 'BAN zed_user (profile unknown) banned on Discord by rowan_staff; added to the game ban list; reason: threats [2026-10-15 00:00:00] PERM fake line')
})

test('a Discord id or mention typed into the reason is masked', async () => {
  reset()
  entries = [entry(22, { reason: `alt of <@${MOD}> and <@!${NOPROFILE}>, also ${NOPROFILE}` })]
  handlers.guildBanAdd(ban())
  await settle()
  assert.match(lines[0] || '', /; reason: alt of \[id\] and \[id\], also \[id\]$/)
  assert.ok(lines.every(noIds))
})

test('a ban the game ban list could not take is still in the audit channel', async () => {
  reset()
  listBroken = true
  entries = [entry(22)]
  handlers.guildBanAdd(ban())
  await settle()
  listBroken = false
  assert.deepEqual(lines, ['BAN zed_user (profile 209: #RC9H, #K7QM) banned on Discord by rowan_staff; the game ban list could not be written; reason: threats in chat'])
})

test('a profile with no character, and a character store that cannot be read', async () => {
  reset()
  store = () => [form(1, 'PGDB', { stamp: MOD })]
  entries = [entry(22)]
  handlers.guildBanAdd(ban())
  await settle()
  store = () => { throw new Error('EACCES') }
  handlers.guildBanAdd(ban())
  await settle()
  store = () => [form(209, 'RC9H'), form(209, 'K7QM')]
  assert.match(lines[0] || '', /^BAN zed_user \(profile 209, no character\) banned on Discord /)
  assert.match(lines[1] || '', /^BAN zed_user \(profile 209\) banned on Discord /)
})

test('a ban on another guild is not ours', async () => {
  reset()
  handlers.guildBanAdd(ban(ZED, 'zed_user', { ...guild, id: '1' }))
  handlers.guildBanRemove(ban(ZED, 'zed_user', { ...guild, id: '1' }))
  await settle()
  assert.deepEqual(lines, [])
})
