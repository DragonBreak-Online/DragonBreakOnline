'use strict'
// sources/punish/actions.js on fakes (a fake bot, the console fixture, a private copy of bans.js on a temp ban list, the
// real moderation journal on a temp file): each action's happy path, every refusal, the audit lines, and that the
// Punishments panel shows the result. No answer carries a Discord id, an address or a hwid.

const { test, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { createActionsFixture, uuid, BAN_ROLE, MOD_ROLE, ROLE, GUILD, ALLOW, HARDENED_ALLOW } = require('./helpers/punishActionsFixture')
const { parseActionsSwitch, parseBody, ACTIONS } = require('../sources/punish/actions')

const H = createActionsFixture()
const { PEOPLE } = H
after(() => H.cleanup())
beforeEach(() => {
  H.reset()
  H.bot.moderation = { ready: true, banMembers: true, moderateMembers: true, viewAuditLog: true }
  H.bot.member.clear()
  H.bot.banned.clear()
  H.bot.fail = null
  H.bot.hang = false
  H.bot.banStateAnswer = null
  fs.rmSync(H.switchFile, { force: true })
  for (const k of ['bob', 'gina', 'dev', 'rep']) H.roles.set(PEOPLE[k].discordId, k === 'gina' ? [GUILD, ROLE.gm] : k === 'dev' ? [GUILD, ROLE.dev] : [GUILD])
  H.roles.set(PEOPLE.lead.discordId, [GUILD, ROLE.lead])
  H.lastIp.clear()
  H.setRoles()
  H.guild.ownerId = '900000000000000001'
  try { H.bans.removeEntry(PEOPLE.bob.discordId) } catch { /* a test broke the list and restores it */ }
  H.make()
})
const bobId = PEOPLE.bob.discordId
const entryOf = d => H.banList().find(e => e.discordId === d)
const journalOf = (kind, d) => H.journal().filter(e => e.kind === kind && e.discordId === d)
const want = (r, status, error) => { assert.equal(r.status, status, JSON.stringify(r.body)); if (error) assert.equal(r.body.error, error, JSON.stringify(r.body)); H.clean(r.body); return r.body }

test('the switch: off | dry-run | on, then bans=, discord= and send= that only narrow; anything else is off', () => {
  assert.deepEqual(parseActionsSwitch('on'), { bans: 'on', discord: 'on', send: 'on' })
  assert.deepEqual(parseActionsSwitch('on bans=dry-run discord=off\n'), { bans: 'dry-run', discord: 'off', send: 'on' })
  assert.deepEqual(parseActionsSwitch('dry-run send=on'), { bans: 'dry-run', discord: 'dry-run', send: 'dry-run' }, 'a key cannot widen')
  for (const bad of [undefined, '', 'yes', 'on web=on', 'on bans=on bans=off', 'on\noff', 'on ' + 'x'.repeat(70)]) {
    assert.deepEqual(parseActionsSwitch(bad), { bans: 'off', discord: 'off', send: 'off' }, String(bad))
  }
})

test('the body: exactly its keys, a v4 request id, a profile, the action\'s own fields, and its confirm word', () => {
  const ok = { requestId: uuid(), profileId: 10, reason: 'Griefing at the bank', confirm: 'BAN' }
  assert.equal(parseBody('ban', ok).reason, 'Griefing at the bank')
  assert.equal(parseBody('ban', { ...ok, extra: 1 }).error, 'badRequest')
  assert.equal(parseBody('ban', { ...ok, requestId: 'x' }).error, 'badRequest')
  assert.equal(parseBody('ban', { ...ok, profileId: '10' }).error, 'badProfile')
  assert.equal(parseBody('ban', { ...ok, profileId: -1 }).error, 'badProfile')
  assert.equal(parseBody('ban', { ...ok, confirm: 'ban' }).error, 'badConfirm')
  assert.equal(parseBody('ban', [ok]).error, 'badRequest')
  const t = { requestId: uuid(), profileId: 10, minutes: 60, reason: 'Spam in the trade chat', confirm: 'TIMEOUT' }
  assert.equal(parseBody('discord-timeout', t).minutes, 60)
  for (const m of [0, 40321, 1.5, '60', null]) assert.equal(parseBody('discord-timeout', { ...t, minutes: m }).error, 'badMinutes', String(m))
  assert.equal(parseBody('discord-timeout', { ...t, minutes: 40320 }).minutes, 40320)
  assert.deepEqual(Object.keys(ACTIONS).sort(), ['ban', 'discord-ban', 'discord-timeout', 'discord-timeout-end', 'discord-unban', 'send', 'unban'])
})

test('reasons: folded to one line; markup, mentions, colour codes, emoji, ids and addresses refused; 5 to 300', () => {
  const r = reason => parseBody('ban', { requestId: uuid(), profileId: 10, reason, confirm: 'BAN' })
  assert.equal(r('  Griefing\n\tat   the bank\u200b ').reason, 'Griefing at the bank')
  assert.equal(r('Évasion de bannissement (ticket #0141)').why, 'reasonChars', '# is not in the class')
  assert.equal(r('Ban evasion, ticket 0141: see rep-0305 & notes.').reason, 'Ban evasion, ticket 0141: see rep-0305 & notes.')
  for (const bad of ['<@123456789012345678> spam', '#{ff0000}red text', 'use [[link]] here', 'bold **text**', 'cheats 😀', 'a|b pipes', 'back`tick`']) {
    assert.equal(r(bad).why, 'reasonChars', bad)
  }
  assert.equal(r('abc').why, 'reasonShort')
  assert.equal(r('').why, 'reasonShort')
  assert.equal(r(42).why, 'reasonShort')
  assert.equal(r('x'.repeat(300)).reason.length, 300)
  assert.equal(r('x'.repeat(301)).why, 'reasonLong')
  assert.equal(r('alt of 123456789012345678 found').why, 'reasonPrivate')
  assert.equal(r('connected from 81.2.69.160 again').why, 'reasonPrivate')
  // The console's own rule (allowlist.js reasonWhy): a Hangul filler draws nothing, so it is refused; an astral letter too
  for (const filler of ['\u115f', '\u1160', '\u3164', '\uffa0']) {
    assert.equal(r(filler.repeat(6)).why, 'reasonChars', escape(filler))
    assert.equal(r(`Griefing${filler}at the bank`).why, 'reasonChars', escape(filler))
  }
  assert.equal(r('Griefing \u{1D400} bank').why, 'reasonChars')
  const rules = require('../sources/console/allowlist')
  for (const t of ['Griefing at the bank', 'abc', 'x'.repeat(301), 'cheats \u{1F600}', '\u3164\u3164\u3164\u3164\u3164', 'a<b>c d e']) {
    assert.equal(r(t).why || '', rules.reasonWhy(t), t)
  }
})

test('ban: an Owner bans a player on the game ban list; the journal, the audit lines, #staff-commands and the panel show it', async () => {
  const body = H.body('ban')
  const r = want(await H.call('ban', 'owner', body), 200)
  assert.equal(r.job.state, 'done')
  assert.equal(r.job.action, 'ban')
  assert.equal(r.job.id, body.requestId)
  assert.match(r.job.ref, /^B-[0-9A-HJKMNP-TV-Z]{6}$/)
  assert.deepEqual(r.job.target, { profileId: 10, name: 'Bob', tag: 'BOB1', discordName: 'Bobby' })
  assert.equal(r.job.by, 'jake')
  // The ban list: the Discord id resolved on the server, no address and no hwid, the staff member's handle
  const e = entryOf(bobId)
  assert.deepEqual({ ...e, bannedAt: typeof e.bannedAt }, { discordId: bobId, ref: r.job.ref, hwid: null, ip: null, reason: 'Griefing at the bank', bannedAt: 'string', bannedBy: 'jake (dashboard)' })
  assert.ok(H.bans.isBanned({ discordId: bobId }), 'the login check refuses them from now on')
  // The journal keeps the ban by its ref, named by the staff member
  const j = journalOf('ban', bobId)
  assert.equal(j.length, 1)
  assert.deepEqual([j[0].ref, j[0].via, j[0].by.discordName, j[0].reason, j[0].req], [r.job.ref, 'dashboard', 'jake', 'Griefing at the bank', body.requestId.slice(0, 8)])
  // Audit before and after, and the game's #staff-commands form; never the target's Discord id
  const id8 = body.requestId.slice(0, 8)
  assert.equal(H.audits[0], `PUNISH jake (<@${PEOPLE.owner.discordId}>) via web req ${id8}: game ban (permanent) on Bob #BOB1 (profile 10): Griefing at the bank`)
  assert.equal(H.audits[1], `PUNISH req ${id8} -> done: ref ${r.job.ref}`)
  assert.equal(H.staff.length, 1)
  assert.match(H.staff[0], new RegExp(`^\\[\\d\\d:\\d\\d:\\d\\d\\] jake <@${PEOPLE.owner.discordId}> \\(Owner\\): game ban \\(permanent\\) on Bob #BOB1 \\(profile 10\\): Griefing at the bank \\[dashboard ${id8}\\]$`))
  assert.ok([...H.audits, ...H.staff].every(l => !l.includes(bobId)))
  // The audit file: one line accepted, one done
  const lines = fs.readFileSync(path.join(H.PF.root, 'punish-actions.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(l => l.req === body.requestId)
  assert.deepEqual(lines.map(l => l.state), ['running', 'done'])
  assert.equal((fs.statSync(path.join(H.PF.root, 'punish-actions.jsonl')).mode & 0o777).toString(8), '600')
  // The panel: one ban row, running, with the staff member and the reason
  const p = await H.rows(10)
  const bans = p.history.filter(x => x.kind === 'ban')
  assert.equal(bans.length, 1, JSON.stringify(bans))
  assert.deepEqual([bans[0].ref, bans[0].by, bans[0].reason, bans[0].active, bans[0].source], [r.job.ref, 'jake', 'Griefing at the bank', true, 'bans'])
  assert.ok(p.active.some(x => x.kind === 'ban' && x.ref === r.job.ref))
  H.clean(p)
})

test('ban: the same request id again returns the first job and writes nothing twice; another account or body is a conflict', async () => {
  const body = H.body('ban')
  const first = want(await H.call('ban', 'owner', body), 200)
  const list = fs.readFileSync(H.PF.bansFile, 'utf8')
  const rows = journalOf('ban', bobId).length
  const again = want(await H.call('ban', 'owner', body), 200)
  assert.deepEqual(again.job, first.job)
  assert.equal(fs.readFileSync(H.PF.bansFile, 'utf8'), list)
  assert.equal(journalOf('ban', bobId).length, rows)
  want(await H.call('ban', 'dev', body), 409, 'conflict')
  want(await H.call('ban', 'owner', { ...body, reason: 'Another reason given' }), 409, 'conflict')
  want(await H.call('unban', 'owner', { ...body, confirm: 'UNBAN' }), 409, 'conflict')
  // Two copies at once: one unban, one journal row, the same job twice
  const twice = H.body('unban', { reason: 'Appeal accepted by staff' })
  const unbans = journalOf('unban', bobId).length
  const [a, b] = await Promise.all([H.call('unban', 'owner', twice), H.call('unban', 'owner', twice)])
  assert.equal(a.status, 200)
  assert.deepEqual(b.body.job, a.body.job)
  assert.equal(journalOf('unban', bobId).length, unbans + 1)
})

test('unban: the entry goes, the journal keeps the ban as lifted with who and why, and a held ban role is named', async () => {
  const banned = want(await H.call('ban', 'owner', H.body('ban', { reason: 'Duping gold at the bank' })), 200)
  H.roles.set(bobId, [GUILD, BAN_ROLE])
  const r = want(await H.call('unban', 'dev', H.body('unban', { reason: 'Appeal accepted by staff' })), 200)
  assert.deepEqual([r.job.state, r.job.ref, r.job.banRoleHeld, r.job.by], ['done', banned.job.ref, true, 'nate.pierce'])
  assert.match(r.job.summary, /remove it in Discord/)
  assert.equal(entryOf(bobId), undefined)
  assert.equal(H.bans.isBanned({ discordId: bobId }), null)
  assert.match(H.staff.at(-1), /\(Dragon Break Dev\): game unban of Bob #BOB1 \(profile 10\): Appeal accepted by staff/)
  const p = await H.rows(10)
  const row = p.history.find(x => x.kind === 'ban' && x.ref === banned.job.ref)
  assert.ok(row, 'the lifted ban stays in History')
  assert.deepEqual([row.state, row.active, row.by, row.reason, row.lifted.by, row.lifted.reason], ['lifted', false, 'jake', 'Duping gold at the bank', 'nate.pierce', 'Appeal accepted by staff'])
  assert.ok(p.history.some(x => x.kind === 'unban' && x.ref === banned.job.ref && x.by === 'nate.pierce'))
  assert.ok(!p.active.some(x => x.kind === 'ban'))
  // A GM sees neither the lifted ban nor the unban
  const g = await H.panel.player(H.viewer('gm'), 10, {})
  assert.ok(!g.body.history.some(x => x.ref === banned.job.ref))
  H.clean(p)
  want(await H.call('unban', 'owner', H.body('unban')), 409, 'notBanned')
})

test('unban: a Discord ban\'s copy is lifted here only once Discord no longer bans them', async () => {
  H.bans.add({ discordId: bobId, reason: 'discord ban', bannedBy: 'discord' })
  H.bot.banned.add(bobId)
  want(await H.call('unban', 'owner', H.body('unban')), 409, 'discordBan')
  H.bot.banStateAnswer = 'unknown'
  want(await H.call('unban', 'owner', H.body('unban')), 503, 'discordUnavailable')
  H.bot.banStateAnswer = null
  H.bot.banned.delete(bobId)
  const r = want(await H.call('unban', 'owner', H.body('unban')), 200)
  assert.equal(r.job.state, 'done')
  assert.equal(entryOf(bobId), undefined)
  assert.deepEqual(H.calls, [], 'Discord is only asked, never written')
})

test('ban: an account already on the list is refused with its ref and kind, never overwritten; an unreadable list writes nothing', async () => {
  const ivan = entryOf(PEOPLE.ivan.discordId)
  const r = want(await H.call('ban', 'owner', H.body('ban', { profileId: PEOPLE.ivan.profileId })), 409, 'alreadyBanned')
  assert.deepEqual([r.ref, r.kind], [ivan.ref, 'ban'])
  H.bans.add({ discordId: bobId, reason: 'discord ban', bannedBy: 'discord' })
  const c = want(await H.call('ban', 'owner', H.body('ban')), 409, 'alreadyBanned')
  assert.equal(c.kind, 'discord_ban')
  assert.equal(entryOf(bobId).reason, 'discord ban', 'the Discord copy keeps its reason')
  H.bans.removeEntry(bobId)
  const good = fs.readFileSync(H.PF.bansFile, 'utf8')
  try {
    fs.writeFileSync(H.PF.bansFile, '[{"discordId": "1", "ref"')
    want(await H.call('ban', 'owner', H.body('ban')), 503, 'storeUnreadable')
    want(await H.call('unban', 'owner', H.body('unban')), 503, 'storeUnreadable')
    assert.equal(fs.readFileSync(H.PF.bansFile, 'utf8'), '[{"discordId": "1", "ref"', 'a list that cannot be read is never replaced')
    fs.writeFileSync(H.PF.bansFile, '{"not": "a list"}')
    want(await H.call('ban', 'owner', H.body('ban')), 503, 'storeUnreadable')
  } finally { fs.writeFileSync(H.PF.bansFile, good) }
})

test('who may: bans for Owners and Dev, timeouts for Lead GMs too, never a GM; the pin, a fresh sign-in, the switch, Discord asked now', async () => {
  want(await H.call('ban', 'lead', H.body('ban')), 403, 'notAllowed')
  want(await H.call('discord-ban', 'lead', H.body('discord-ban')), 403, 'notAllowed')
  for (const a of Object.keys(ACTIONS)) want(await H.call(a, 'gm', H.body(a)), 403, 'notAllowed')
  want(await H.call('discord-timeout', 'trial', H.body('discord-timeout')), 403, 'notAllowed')
  want(await H.call('discord-timeout', 'none', H.body('discord-timeout')), 403, 'notAllowed')
  want(await H.call('discord-timeout', 'actor', H.body('discord-timeout')), 403, 'notAllowed')
  const stale = want(await H.call('ban', 'owner', H.body('ban'), { ago: 5 * 3600 * 1000 }), 401, 'signInAgain')
  assert.equal(stale.signInUrl, '/api/site/login/fresh')
  want(await H.call('ban', 'not-a-session', H.body('ban')), 401, 'signedOut')
  // The roles asked of Discord now, failing closed
  const real = H.F.discordBot.getMemberFresh
  H.F.discordBot.getMemberFresh = () => new Promise(() => {})
  try { want(await H.call('ban', 'owner', H.body('ban')), 403, 'notAllowed') } finally { H.F.discordBot.getMemberFresh = real }
  H.roles.set(PEOPLE.dev.discordId, [GUILD])
  want(await H.call('ban', 'dev', H.body('ban')), 403, 'notAllowed')
  assert.equal(entryOf(bobId), undefined)
  assert.deepEqual(H.calls, [])
  const timeout = want(await H.call('discord-timeout', 'lead', H.body('discord-timeout')), 200)
  assert.equal(timeout.job.state, 'done')
  // The switch: PUNISH_ACTIONS, narrowed per area and by the switch file
  H.make({ config: { punishActions: 'off' } })
  want(await H.call('ban', 'owner', H.body('ban')), 503, 'actionsOff')
  H.make({ config: { punishActions: undefined } })
  want(await H.call('ban', 'owner', H.body('ban')), 503, 'actionsOff')
  H.make({ config: { punishActions: 'on bans=off' } })
  want(await H.call('ban', 'owner', H.body('ban')), 503, 'actionsOff')
  want(await H.call('discord-timeout-end', 'owner', H.body('discord-timeout-end')), 409, 'notTimedOut')
  H.make()
  fs.writeFileSync(H.switchFile, 'off\n')
  want(await H.call('discord-timeout', 'owner', H.body('discord-timeout')), 503, 'actionsOff')
  fs.writeFileSync(H.switchFile, 'on please\n')
  want(await H.call('discord-timeout', 'owner', H.body('discord-timeout')), 503, 'actionsOff')
  fs.writeFileSync(H.switchFile, 'on discord=off\n')
  want(await H.call('discord-timeout', 'owner', H.body('discord-timeout')), 503, 'actionsOff')
  fs.rmSync(H.switchFile)
  // The console's config holds the pins: unusable is off
  H.F.make({ consoleDiscordIds: '' })
  try { want(await H.call('ban', 'owner', H.body('ban')), 503, 'unavailable') } finally { H.F.make() }
  assert.equal(entryOf(bobId), undefined)
})

test('refusals: the audit channel at most once a minute per account; before the sign-in is known fresh, the backend log only', async () => {
  for (let i = 0; i < 3; i++) await H.call('ban', 'lead', H.body('ban'))
  const loud = H.audits.filter(l => l.startsWith('PUNISH refused lena_lead'))
  assert.equal(loud.length, 1, H.audits.join('\n'))
  assert.match(loud[0], /^PUNISH refused lena_lead \(<@\d+>\) req - ban notAllowed$/)
  assert.equal(H.logs.filter(l => l.includes('PUNISH refused lena_lead')).length, 2)
  H.reset()
  await H.call('ban', 'owner', H.body('ban'), { ago: 5 * 3600 * 1000 })
  assert.deepEqual(H.audits, [])
  assert.equal(H.logs.filter(l => l.includes('signInAgain')).length, 1)
})

test('own account and staff targets: never your own; a Lead GM can act on a GM but not a peer or above; Discord asked now, failing closed', async () => {
  want(await H.call('ban', 'owner', H.body('ban', { profileId: PEOPLE.owner.profileId })), 403, 'ownAccount')
  want(await H.call('discord-timeout', 'lead', H.body('discord-timeout', { profileId: PEOPLE.lead.profileId })), 403, 'ownAccount')
  want(await H.call('discord-timeout', 'lead', H.body('discord-timeout', { profileId: PEOPLE.dev.profileId })), 403, 'staffTarget')
  want(await H.call('discord-timeout', 'lead', H.body('discord-timeout', { profileId: PEOPLE.actor.profileId })), 403, 'staffTarget')
  want(await H.call('discord-timeout', 'lead', H.body('discord-timeout', { profileId: PEOPLE.gina.profileId })), 200)
  H.roles.set(bobId, [GUILD, ROLE.trial])
  want(await H.call('discord-timeout', 'lead', H.body('discord-timeout')), 200)
  H.roles.set(PEOPLE.rep.discordId, [GUILD, ROLE.owner])
  want(await H.call('ban', 'owner', H.body('ban', { profileId: PEOPLE.rep.profileId })), 403, 'staffTarget')
  want(await H.call('ban', 'dev', H.body('ban', { profileId: PEOPLE.owner.profileId })), 403, 'staffTarget')
  const dev = want(await H.call('ban', 'owner', H.body('ban', { profileId: PEOPLE.dev.profileId })), 200)
  assert.equal(dev.job.state, 'done', 'an Owner can act on a Dev')
  H.bans.removeEntry(PEOPLE.dev.discordId)
  want(await H.call('ban', 'owner', H.body('ban', { profileId: 999 })), 404, 'notFound')
  H.bot.member.set(bobId, { state: 'unknown' })
  want(await H.call('ban', 'owner', H.body('ban')), 503, 'discordUnavailable')
  H.bot.member.set(bobId, new Promise(() => {}))
  want(await H.call('ban', 'owner', H.body('ban')), 503, 'discordUnavailable')
  assert.equal(entryOf(bobId), undefined)
  // A character whose account has no Discord id
  H.PF.forms.push({ cf: { profileId: 77, formDesc: 'ff000077', displayName: 'Nobody', dynamicFields: { 'private.charTag': 'NOB1' } }, char: { profileId: 77, formDesc: 'ff000077', deleted: false, dead: false, appearance: {} } })
  H.F.clock.offset += 6000
  want(await H.call('ban', 'owner', H.body('ban', { profileId: 77 })), 404, 'noDiscordAccount')
  H.PF.forms.pop()
})

test('discord-timeout: Discord is asked with a whole-second end and a reason naming the staff member; the journal, the claim and the panel', async () => {
  const body = H.body('discord-timeout', { minutes: 90, reason: 'Spam in the trade chat' })
  const t0 = H.F.now()
  const r = want(await H.call('discord-timeout', 'lead', body), 200)
  const until = Date.parse(r.job.until)
  assert.deepEqual([r.job.state, r.job.minutes, until % 1000], ['done', 90, 0])
  assert.ok(until >= t0 + 90 * 60000 && until <= t0 + 90 * 60000 + 2000)
  const id8 = body.requestId.slice(0, 8)
  assert.deepEqual(H.calls, [['timeoutMember', bobId, until, `Spam in the trade chat (lena_lead via the dashboard, req ${id8})`]])
  const j = journalOf('discord_timeout', bobId).at(-1)
  assert.deepEqual([j.until, j.by.discordName, j.via, j.reason, j.profileId], [r.job.until, 'lena_lead', 'dashboard', 'Spam in the trade chat', 10])
  // The bot's own copy of the row, from the guild audit log, is skipped
  const journal = require('../sources/discord/moderationJournal')
  const entry = { action: 24, targetId: bobId, executorId: '1', executor: { username: 'dbo_bot', bot: true }, reason: 'x', changes: [{ key: 'communication_disabled_until', new: new Date(until).toISOString() }] }
  assert.equal(await journal.auditEntry(entry, { client: { users: { fetch: async () => null } } }), null)
  assert.match(H.audits[0], new RegExp(`^PUNISH lena_lead \\(<@\\d+>\\) via web req ${id8}: Discord timeout on Bob #BOB1 \\(profile 10\\), 90 min until \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d UTC: Spam in the trade chat$`))
  assert.match(H.staff[0], /\(Lead GM\): Discord timeout on Bob #BOB1 \(profile 10\), 90 min until .* UTC: Spam in the trade chat \[dashboard/)
  const p = await H.rows(10)
  const row = p.active.find(x => x.kind === 'discord_timeout' && x.until === r.job.until)
  assert.ok(row, JSON.stringify(p.active.map(x => [x.kind, x.until])))
  assert.deepEqual([row.state, row.by, row.reason], ['running', 'lena_lead', 'Spam in the trade chat'])
  want(await H.call('discord-timeout', 'lead', H.body('discord-timeout', { minutes: 0 })), 400, 'badMinutes')
  want(await H.call('discord-timeout', 'lead', H.body('discord-timeout', { minutes: 40321 })), 400, 'badMinutes')
})

test('discord timeouts: the bot\'s permission and place, and the member, are checked before Discord is written to', async () => {
  H.bot.moderation.ready = false
  want(await H.call('discord-timeout', 'owner', H.body('discord-timeout')), 503, 'botNotReady')
  H.bot.moderation.ready = true
  H.bot.moderation.moderateMembers = false
  const r = want(await H.call('discord-timeout', 'owner', H.body('discord-timeout')), 503, 'botLacksPermission')
  assert.equal(r.permission, 'ModerateMembers')
  want(await H.call('discord-timeout-end', 'owner', H.body('discord-timeout-end')), 503, 'botLacksPermission')
  H.bot.moderation.moderateMembers = true
  const m = { state: 'member', roles: [GUILD], handle: 'bobby', bannable: true, moderatable: true, admin: false, timedOutUntil: 0 }
  H.bot.member.set(bobId, { state: 'absent' })
  want(await H.call('discord-timeout', 'owner', H.body('discord-timeout')), 409, 'notInGuild')
  H.bot.member.set(bobId, { ...m, admin: true, moderatable: false })
  want(await H.call('discord-timeout', 'owner', H.body('discord-timeout')), 409, 'targetIsAdmin')
  H.bot.member.set(bobId, { ...m, moderatable: false })
  want(await H.call('discord-timeout', 'owner', H.body('discord-timeout')), 409, 'botBelowTarget')
  H.bot.member.set(bobId, m)
  want(await H.call('discord-timeout-end', 'owner', H.body('discord-timeout-end')), 409, 'notTimedOut')
  assert.deepEqual(H.calls, [])
})

test('discord-timeout-end: takes the timeout off, and the panel\'s running timeout ends', async () => {
  const given = want(await H.call('discord-timeout', 'owner', H.body('discord-timeout', { minutes: 120 })), 200)
  const until = Date.parse(given.job.until)
  H.bot.member.set(bobId, { state: 'member', roles: [GUILD], handle: 'bobby', bannable: true, moderatable: true, admin: false, timedOutUntil: until })
  H.reset()
  const r = want(await H.call('discord-timeout-end', 'lead', H.body('discord-timeout-end', { reason: 'Apologised in the ticket' })), 200)
  assert.equal(r.job.state, 'done')
  assert.equal(H.calls[0][2], null)
  assert.equal(journalOf('discord_timeout_end', bobId).at(-1).by.discordName, 'lena_lead')
  const p = await H.rows(10)
  assert.ok(!p.active.some(x => x.kind === 'discord_timeout' && x.until === given.job.until), 'no longer running')
  assert.equal(p.history.find(x => x.kind === 'discord_timeout' && x.until === given.job.until).state, 'ended')
})

test('Discord errors: each code its answer, the claim given back; no answer in time is unknown, and a late answer fills the job', async () => {
  const journal = require('../sources/discord/moderationJournal')
  H.make({ extra: { limits: { triesPer10Min: 99, perMinute: 99, perHour: 99, sitePerHour: { bans: 99, discordBans: 99, timeouts: 99 } } } })
  const cases = [[50013, 502, 'discordRefused', 'missingPermission'], [10007, 409, 'notInGuild'], [50035, 400, 'badMinutes'], [40007, 502, 'discordRefused', '40007']]
  for (const [code, status, error, detail] of cases) {
    H.bot.fail = Object.assign(new Error(`Discord ${code}`), { code })
    const body = H.body('discord-timeout', { minutes: 30 })
    const r = want(await H.call('discord-timeout', 'owner', body), status, error)
    assert.equal(r.code, detail, String(code))
    assert.deepEqual([r.job.state, r.job.error], ['failed', error])
    const key = journal.claimTimeout(bobId, 'discord_timeout', 0, H.calls.at(-1)[2])
    assert.ok(key, 'the claim was given back')
    journal.release(key)
  }
  assert.ok(H.audits.some(l => /-> failed \(discordRefused\)$/.test(l)))
  assert.equal(H.staff.length, 0, 'nothing done, nothing in #staff-commands')
  H.bot.banned.add(bobId)
  H.bot.fail = Object.assign(new Error('Unknown Ban'), { code: 10026 })
  want(await H.call('discord-unban', 'owner', H.body('discord-unban')), 409, 'notBanned')
  H.bot.fail = null
  H.bot.banned.delete(bobId)
  // No answer within the deadline: unknown, on record, posted; then Discord answers
  let answer
  H.bot.hang = new Promise(resolve => { answer = resolve })
  const body = H.body('discord-timeout', { minutes: 10 })
  const token = H.F.session(PEOPLE.owner.discordId)
  const a = await H.actions.authorize(token, 'discord-timeout')
  const r = want(await H.actions.perform(a.ctx, 'discord-timeout', body), 200)
  assert.equal(r.job.state, 'unknown')
  assert.match(r.job.summary, /check Discord and #staff-commands/)
  assert.match(H.staff.at(-1), /\(Discord did not answer\)/)
  assert.equal(H.actions.job(token, body.requestId).state, 'unknown')
  answer()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(H.actions.job(token, body.requestId).state, 'done')
  assert.equal(H.actions.job(H.F.session(PEOPLE.dev.discordId), body.requestId), null, 'own jobs only')
})

test('discord-ban: by id, member or not; the journal names the staff member and the panel\'s merged row reads them', async () => {
  const journal = require('../sources/discord/moderationJournal')
  H.bot.moderation.banMembers = false
  const lacks = want(await H.call('discord-ban', 'owner', H.body('discord-ban')), 503, 'botLacksPermission')
  assert.equal(lacks.permission, 'BanMembers')
  H.bot.moderation.banMembers = true
  H.bot.member.set(bobId, { state: 'member', roles: [GUILD], handle: 'bobby', bannable: false, moderatable: false, admin: false, timedOutUntil: 0 })
  want(await H.call('discord-ban', 'owner', H.body('discord-ban')), 409, 'botBelowTarget')
  H.bot.member.delete(bobId)
  H.bot.banStateAnswer = 'unknown'
  want(await H.call('discord-ban', 'owner', H.body('discord-ban')), 503, 'discordUnavailable')
  H.bot.banStateAnswer = null
  assert.deepEqual(H.calls, [])
  const body = H.body('discord-ban', { reason: 'Threats against players' })
  const r = want(await H.call('discord-ban', 'dev', body), 200)
  assert.equal(r.job.state, 'done')
  assert.deepEqual(H.calls, [['banUser', bobId, `Threats against players (nate.pierce via the dashboard, req ${body.requestId.slice(0, 8)})`]])
  assert.equal(journal.claimedBan(bobId, 'discord_ban'), true, 'the bot\'s guildBanAdd skips its own journal row')
  assert.equal(journal.claimedBan(bobId, 'discord_ban'), false, 'once')
  want(await H.call('discord-ban', 'dev', H.body('discord-ban')), 409, 'alreadyBanned')
  // The bot's snapshot on the game ban list, as guildBanAdd writes it, merges with the journal row
  H.bans.add({ discordId: bobId, reason: 'discord ban', bannedBy: 'discord' }, { keepOther: true })
  const p = await H.rows(10)
  const rows = p.history.filter(x => x.kind === 'discord_ban')
  assert.equal(rows.length, 1, JSON.stringify(rows))
  assert.deepEqual([rows[0].source, rows[0].by, rows[0].reason, rows[0].active], ['bans', 'nate.pierce', 'Threats against players', true])
  // An account not in the guild is banned by id
  H.bot.member.set(PEOPLE.ivan.discordId, { state: 'absent' })
  const away = want(await H.call('discord-ban', 'owner', H.body('discord-ban', { profileId: PEOPLE.ivan.profileId })), 200)
  assert.equal(away.job.state, 'done')
})

test('discord-unban: only a Discord ban; it goes, and the journal names the staff member', async () => {
  want(await H.call('discord-unban', 'owner', H.body('discord-unban')), 409, 'notBanned')
  want(await H.call('discord-unban', 'lead', H.body('discord-unban')), 403, 'notAllowed')
  H.bot.banned.add(bobId)
  const r = want(await H.call('discord-unban', 'owner', H.body('discord-unban', { reason: 'Appeal accepted by staff' })), 200)
  assert.equal(r.job.state, 'done')
  assert.deepEqual(H.calls.map(c => c[0]), ['unbanUser'])
  assert.equal(journalOf('discord_unban', bobId).at(-1).by.discordName, 'jake')
  assert.equal(require('../sources/discord/moderationJournal').claimedBan(bobId, 'discord_unban'), true)
})

test('dry run: every check runs and nothing is written; it narrows per area and from the switch file', async () => {
  H.make({ config: { punishActions: 'dry-run' } })
  const r = want(await H.call('ban', 'owner', H.body('ban')), 200)
  assert.equal(r.job.state, 'dry-run')
  assert.match(r.job.summary, /^Dry run/)
  assert.equal(entryOf(bobId), undefined)
  assert.match(H.audits[0], /\(dry run\): Griefing at the bank$/)
  assert.match(H.audits[1], /-> dry-run$/)
  assert.deepEqual(H.staff, [])
  want(await H.call('ban', 'owner', H.body('ban', { profileId: PEOPLE.owner.profileId })), 403, 'ownAccount')
  H.bot.moderation.moderateMembers = false
  want(await H.call('discord-timeout', 'owner', H.body('discord-timeout')), 503, 'botLacksPermission')
  H.bot.moderation.moderateMembers = true
  want(await H.call('discord-timeout', 'owner', H.body('discord-timeout')), 200)
  assert.deepEqual(H.calls, [], 'Discord is never written to in a dry run')
  H.make({ config: { punishActions: 'on bans=dry-run' } })
  assert.equal(want(await H.call('ban', 'owner', H.body('ban')), 200).job.state, 'dry-run')
  assert.equal(want(await H.call('discord-timeout', 'owner', H.body('discord-timeout')), 200).job.state, 'done')
  H.make()
  fs.writeFileSync(H.switchFile, 'dry-run')
  assert.equal(want(await H.call('ban', 'owner', H.body('ban')), 200).job.state, 'dry-run')
  assert.equal(entryOf(bobId), undefined)
})

test('the switch file written off or dry-run after authorize holds for that request: nothing is recorded or done', async () => {
  const past = async (action, file) => {
    const a = await H.actions.authorize(H.F.session(PEOPLE.owner.discordId, 60 * 1000), action)
    assert.ok(a.ctx, JSON.stringify(a.refused))
    fs.writeFileSync(H.switchFile, file)
    try { return await H.actions.perform(a.ctx, action, H.body(action)) } finally { fs.rmSync(H.switchFile, { force: true }) }
  }
  want(await past('ban', 'off\n'), 503, 'actionsOff')
  want(await past('discord-timeout', 'on discord=off'), 503, 'actionsOff')
  assert.equal(entryOf(bobId), undefined)
  assert.deepEqual(H.calls, [], 'Discord is never written to')
  assert.ok(!H.audits.some(l => / via web req /.test(l)), 'no accepted line')
  assert.equal(want(await past('ban', 'dry-run'), 200).job.state, 'dry-run')
  assert.equal(entryOf(bobId), undefined)
  assert.equal(want(await past('ban', 'on'), 200).job.state, 'done')
})

test('limits: tries count refusals; accepted actions per account a minute; site-wide an hour; a repeated request id is not counted', async () => {
  const L = (o) => ({ extra: { limits: { triesPer10Min: 99, perMinute: 99, perHour: 99, sitePerHour: { bans: 99, discordBans: 99, timeouts: 99 }, ...o } } })
  H.make(L({ triesPer10Min: 3 }))
  for (let i = 0; i < 3; i++) want(await H.call('ban', 'gm', H.body('ban')), 403, 'notAllowed')
  want(await H.call('ban', 'gm', H.body('ban')), 429, 'tooMany')
  H.make(L({ perMinute: 2 }))
  const first = H.body('ban')
  want(await H.call('ban', 'owner', first), 200)
  want(await H.call('ban', 'owner', first), 200)
  want(await H.call('unban', 'owner', H.body('unban')), 200)
  want(await H.call('ban', 'owner', H.body('ban')), 429, 'tooMany')
  want(await H.call('ban', 'dev', H.body('ban')), 200, null)
  H.bans.removeEntry(bobId)
  H.F.clock.offset += 61 * 1000
  want(await H.call('ban', 'owner', H.body('ban')), 200)
  H.bans.removeEntry(bobId)
  H.make(L({ sitePerHour: { bans: 2, discordBans: 99, timeouts: 99 } }))
  want(await H.call('ban', 'owner', H.body('ban')), 200)
  want(await H.call('unban', 'dev', H.body('unban')), 200)
  want(await H.call('ban', 'dev', H.body('ban')), 429, 'tooMany')
  want(await H.call('discord-timeout', 'dev', H.body('discord-timeout')), 200)
  assert.equal(entryOf(bobId), undefined)
})

test('recover: a job a restart cut short is read back from the ban list, or unknown for Discord; each gets an audit line', async () => {
  const jobsFile = path.join(H.PF.root, 'recover', 'punish-actions.json')
  fs.mkdirSync(path.dirname(jobsFile), { recursive: true })
  const job = (action, uuidValue, targetDiscordId, extra = {}) => ({
    uuid: uuidValue, action, state: 'running', discordId: PEOPLE.owner.discordId, handle: 'jake', tier: 'owner', targetDiscordId, profileId: 10,
    target: { profileId: 10, name: 'Bob', tag: 'BOB1', discordName: 'Bobby' }, reason: 'Griefing at the bank', minutes: null, untilMs: null, at: Date.now(), mode: 'on', ...extra,
  })
  const [u1, u2, u3] = [uuid(), uuid(), uuid()]
  const e = H.bans.addNew({ discordId: bobId, reason: 'Griefing at the bank', bannedBy: 'jake (dashboard)' }).entry
  fs.writeFileSync(jobsFile, JSON.stringify({ v: 1, jobs: [job('ban', u1, bobId), job('ban', u2, PEOPLE.rep.discordId), job('discord-timeout', u3, bobId, { minutes: 10, untilMs: Date.now() + 600000 })] }))
  H.make({ jobsFile })
  assert.equal(H.actions.recover(), 3)
  const token = H.F.session(PEOPLE.owner.discordId)
  assert.deepEqual([H.actions.job(token, u1).state, H.actions.job(token, u1).ref], ['done', e.ref])
  assert.equal(H.actions.job(token, u2).state, 'notRun')
  assert.deepEqual([H.actions.job(token, u3).state, H.actions.job(token, u3).error], ['unknown', 'restart'])
  assert.deepEqual(H.audits.map(l => l.replace(/req \w+/, 'req x')), [`PUNISH req x -> done: ref ${e.ref}`, 'PUNISH req x -> notRun', 'PUNISH req x -> unknown (restart)'])
  assert.equal(H.make({ jobsFile }).recover(), 0, 'once')
  assert.equal((fs.statSync(jobsFile).mode & 0o777).toString(8), '600')
})

test('what the viewer may do: each tier, the pin, the switch and the bot; a GM may do nothing', async () => {
  const info = (who, tier) => H.actions.info(H.F.session(PEOPLE[who].discordId), tier)
  const o = info('owner', 'owner')
  assert.deepEqual(Object.keys(o).sort(), ['bot', 'can', 'fresh', 'pinned', 'reason', 'send', 'signInUrl', 'switch', 'tier', 'timeout', 'v'])
  assert.deepEqual(o.can, { send: true, ban: true, unban: true, discordTimeout: true, discordBan: true })
  assert.deepEqual([o.fresh, o.pinned, o.send.setting, o.send.commands], [true, true, 'on', ['discipline', 'kick']])
  assert.deepEqual(o.reason, { min: 5, max: 300 })
  assert.deepEqual(o.timeout, { maxMinutes: 40320, presets: [10, 60, 360, 1440, 4320, 10080, 40320] })
  assert.deepEqual(info('lead', 'leadgm').can, { send: true, ban: false, unban: false, discordTimeout: true, discordBan: false })
  assert.deepEqual(Object.values(info('gm', 'gm').can), [false, false, false, false, false])
  assert.equal(info('actor', 'leadgm').pinned, false)
  assert.deepEqual(Object.values(info('actor', 'leadgm').can), [false, false, false, false, false])
  H.bot.moderation.moderateMembers = false
  assert.equal(info('owner', 'owner').can.discordTimeout, false)
  // Send only for a command the game checks against the page's account: today's game (no targetProfile) is Copy only
  H.allow(ALLOW)
  assert.deepEqual([info('owner', 'owner').send.commands, info('owner', 'owner').can.send], [[], false])
  H.allow(ALLOW.map(a => (a.name === 'kick' ? { ...a, targetProfile: true } : a)))
  assert.deepEqual([info('owner', 'owner').send.commands, info('owner', 'owner').can.send], [['kick'], true])
  H.allow(HARDENED_ALLOW)
  H.make({ config: { punishActions: 'off' } })
  assert.deepEqual(Object.values(info('owner', 'owner').can), [false, false, false, false, false])
  H.clean(o)
})

test('the same request id after a failure gets the same status and error, after a restart too; a new id may try again', async () => {
  const jobsFile = path.join(H.PF.root, 'replay', 'punish-actions.json')
  H.make({ jobsFile })
  H.bot.fail = Object.assign(new Error('Missing Permissions'), { code: 50013 })
  const body = H.body('discord-timeout', { minutes: 30 })
  const first = want(await H.call('discord-timeout', 'owner', body), 502, 'discordRefused')
  H.bot.fail = null
  const calls = H.calls.length
  for (const make of [() => {}, () => H.make({ jobsFile })]) {
    make()
    const again = want(await H.call('discord-timeout', 'owner', body), 502, 'discordRefused')
    assert.deepEqual([again.code, again.job], [first.code, first.job])
  }
  assert.equal(H.calls.length, calls, 'Discord was not asked again')
  want(await H.call('discord-timeout', 'owner', { ...body, requestId: uuid() }), 200)
})

test('the longest timeout ends short of Discord\'s 28 days, in whole seconds; shorter ones get at least their minutes', async () => {
  H.F.clock.offset += 456
  const t0 = H.F.now()
  const r = want(await H.call('discord-timeout', 'owner', H.body('discord-timeout', { minutes: 40320 })), 200)
  const t1 = H.F.now()
  const until = Date.parse(r.job.until)
  assert.equal(until % 1000, 0)
  assert.ok(until <= t1 + 40320 * 60000 - 60000 && until > t0 + 40320 * 60000 - 62000, String(until - t0))
  assert.equal(H.calls.at(-1)[2], until)
  const s = want(await H.call('discord-timeout', 'owner', H.body('discord-timeout', { minutes: 10 })), 200)
  assert.ok(Date.parse(s.job.until) >= t0 + 10 * 60000)
})

test('unban: once the entry is gone the job is done, even when the ban role cannot be read', async () => {
  want(await H.call('ban', 'owner', H.body('ban')), 200)
  H.make({ extra: { bannedRoleId: () => { throw new Error('server-access.json unreadable') } } })
  const rows = journalOf('unban', bobId).length
  const r = want(await H.call('unban', 'owner', H.body('unban', { reason: 'Appeal accepted by staff' })), 200)
  assert.deepEqual([r.job.state, r.job.banRoleHeld], ['done', null])
  assert.equal(entryOf(bobId), undefined)
  assert.equal(journalOf('unban', bobId).length, rows + 1)
})

// Jake, 22 Oct: "Yes, like in-game /ban". Documentation addresses only (RFC 5737)
const ROOMY = { extra: { limits: { triesPer10Min: 999, perMinute: 999, perHour: 999, sitePerHour: { bans: 999, discordBans: 999, timeouts: 999 } } } }
test('ban: the account\'s last address goes on the ban list as the in-game /ban keeps it (publicIp), and is shown nowhere', async () => {
  H.make(ROOMY)
  H.lastIp.set(10, '203.0.113.50')
  const body = H.body('ban')
  const r = want(await H.call('ban', 'owner', body), 200)
  assert.equal(r.job.state, 'done')
  const e = entryOf(bobId)
  assert.deepEqual([e.ip, e.hwid, e.ref, e.bannedBy], ['203.0.113.50', null, r.job.ref, 'jake (dashboard)'])
  assert.equal(H.bans.isBanned({ discordId: '800000000000000999', ip: '203.0.113.50' }).ref, r.job.ref, 'another account on that address is refused at login, as after an in-game /ban')
  // Nowhere else: the answer, the job replay and GET, the audit and staff lines, the backend log, the audit file, the jobs file, the journal, ban.log, the panel
  const replay = want(await H.call('ban', 'owner', body), 200)
  const read = f => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }
  const panel = await H.rows(10)
  const files = [path.join(H.PF.root, 'punish-actions.jsonl'), H.PF.journalFile, path.join(H.PF.root, 'logs', 'ban.log'), ...fs.readdirSync(H.PF.root).filter(d => d.startsWith('jobs-')).map(d => path.join(H.PF.root, d, 'punish-actions.json'))]
  const seen = [JSON.stringify([r, replay, H.actions.job(H.F.session(PEOPLE.owner.discordId), body.requestId), H.audits, H.staff, H.logs, panel]), ...files.map(read)]
  assert.ok(files.some(f => read(f).includes(body.requestId.slice(0, 8))), 'the files were written')
  assert.ok(seen.every(t => !t.includes('203.0.113')), 'the address is in bans.json only')
  H.clean(panel)
  // unban takes the entry, address and all
  want(await H.call('unban', 'owner', H.body('unban')), 200)
  assert.equal(entryOf(bobId), undefined)
  assert.equal(H.bans.isBanned({ discordId: '800000000000000999', ip: '203.0.113.50' }), null)
})

test('ban: an internal, shared or unknown address is never kept; a player store that cannot be read still bans, by Discord id only', async () => {
  H.make(ROOMY)
  for (const ip of ['10.0.0.7', '172.20.1.1', '100.64.3.4', '127.0.0.1', 'fe80::1', '', 'nonsense']) {
    H.lastIp.set(10, ip)
    want(await H.call('ban', 'owner', H.body('ban')), 200)
    assert.equal(entryOf(bobId).ip, null, ip)
    H.bans.removeEntry(bobId)
  }
  H.lastIp.set(10, '::ffff:203.0.113.51')
  want(await H.call('ban', 'owner', H.body('ban')), 200)
  assert.equal(entryOf(bobId).ip, '203.0.113.51', 'an IPv4-mapped address in its plain form, as bans.js matches it')
  H.bans.removeEntry(bobId)
  H.make({ ...ROOMY, extra: { ...ROOMY.extra, lastIpOf: () => { throw Object.assign(new Error('players.json unreadable'), { code: 'ESTOREUNREADABLE' }) } } })
  const r = want(await H.call('ban', 'owner', H.body('ban')), 200)
  assert.equal(r.job.state, 'done')
  assert.equal(entryOf(bobId).ip, null)
  assert.ok(H.logs.some(l => /player store unreadable, the ban holds no address/.test(l)), H.logs.join('\n'))
  // A dry run writes no ban and asks for no address
  H.bans.removeEntry(bobId)
  let asked = 0
  H.make({ config: { punishActions: 'dry-run' }, extra: { ...ROOMY.extra, lastIpOf: () => { asked++; return '203.0.113.52' } } })
  assert.equal(want(await H.call('ban', 'owner', H.body('ban')), 200).job.state, 'dry-run')
  assert.deepEqual([entryOf(bobId), asked], [undefined, 0])
})

// Jake, 22 Oct: "Yes, follow role order". Positions: Owners 50, Dev 40, Lead GM 30, a Discord moderator role 25, GM 20
test('Discord role order: a timeout, ban or unban is refused when the target\'s highest role is at or above the caller\'s, for every tier', async () => {
  H.make(ROOMY)
  const leadId = PEOPLE.lead.discordId
  H.roles.set(bobId, [GUILD, MOD_ROLE])
  want(await H.call('discord-timeout', 'lead', H.body('discord-timeout')), 200)
  H.calls.length = 0
  // The moderator role above Lead GM: a Lead GM may not, a Dev may
  H.setRoles(new Map([...H.positions(), [MOD_ROLE, 35]]))
  for (const action of ['discord-timeout', 'discord-timeout-end']) want(await H.call(action, 'lead', H.body(action)), 403, 'roleOrder')
  assert.match(H.audits.join('\n'), /PUNISH refused lena_lead .* discord-timeout roleOrder/)
  want(await H.call('discord-timeout', 'dev', H.body('discord-timeout')), 200)
  // At the caller's own place: the same role, or the same position with the older role
  H.setRoles()
  H.roles.set(leadId, [GUILD, ROLE.lead, MOD_ROLE])
  H.setRoles(new Map([...H.positions(), [MOD_ROLE, 33]]))
  want(await H.call('discord-timeout', 'lead', H.body('discord-timeout')), 403, 'roleOrder')
  H.roles.set(leadId, [GUILD, ROLE.lead])
  const OLDER = '1400000000000000555'
  H.setRoles(new Map([...H.positions(), [OLDER, 30]]))
  H.roles.set(bobId, [GUILD, OLDER])
  want(await H.call('discord-timeout', 'lead', H.body('discord-timeout')), 403, 'roleOrder')
  H.setRoles(new Map([...H.positions(), [MOD_ROLE, 30]]))
  H.roles.set(bobId, [GUILD, MOD_ROLE])
  want(await H.call('discord-timeout', 'lead', H.body('discord-timeout')), 200, null, 'the same position with a newer role is below')
  // Owners and Dev too: a role at 45 is above Dev, below Owners
  H.setRoles(new Map([...H.positions(), [MOD_ROLE, 45]]))
  H.calls.length = 0
  for (const action of ['discord-timeout', 'discord-ban']) want(await H.call(action, 'dev', H.body(action)), 403, 'roleOrder')
  assert.deepEqual(H.calls, [], 'Discord is never written to')
  want(await H.call('discord-ban', 'owner', H.body('discord-ban')), 200)
  // An unban of a member who is still in the server with a higher role (Discord keeps no roles for a banned account)
  H.bot.member.set(bobId, { state: 'member', roles: [GUILD, MOD_ROLE], handle: 'bobby', bannable: true, moderatable: true, admin: false, timedOutUntil: 0 })
  want(await H.call('discord-unban', 'dev', H.body('discord-unban')), 403, 'roleOrder')
  H.bot.member.set(bobId, { state: 'absent' })
  want(await H.call('discord-unban', 'dev', H.body('discord-unban')), 200)
  // A dry run checks it too
  H.bot.member.clear()
  H.make({ ...ROOMY, config: { punishActions: 'dry-run' } })
  want(await H.call('discord-timeout', 'dev', H.body('discord-timeout')), 403, 'roleOrder')
  // The game ban list and the send are not Discord actions: no role order there
  H.make(ROOMY)
  assert.equal(want(await H.call('ban', 'owner', H.body('ban')), 200).job.state, 'done')
})

test('Discord role order: the server\'s owner is above everyone and nobody acts on them; roles not cached fail closed; never an Administrator', async () => {
  H.make(ROOMY)
  H.guild.ownerId = bobId
  for (const [who, action] of [['owner', 'discord-ban'], ['owner', 'discord-timeout'], ['lead', 'discord-timeout']]) want(await H.call(action, who, H.body(action)), 403, 'roleOrder')
  H.guild.ownerId = PEOPLE.owner.discordId
  H.roles.set(bobId, [GUILD, MOD_ROLE])
  H.setRoles(new Map([...H.positions(), [MOD_ROLE, 60]]))
  want(await H.call('discord-timeout', 'owner', H.body('discord-timeout')), 200, null, 'the server owner, as in Discord itself')
  want(await H.call('discord-timeout', 'dev', H.body('discord-timeout')), 403, 'roleOrder')
  H.guild.ownerId = '900000000000000001'
  H.setRoles(new Map([...H.positions()].filter(([id]) => id !== GUILD)))
  H.calls.length = 0
  want(await H.call('discord-timeout', 'owner', H.body('discord-timeout')), 503, 'discordUnavailable')
  want(await H.call('discord-ban', 'owner', H.body('discord-ban')), 503, 'discordUnavailable')
  H.setRoles()
  // A target role the bot's cache does not hold is unknown, never skipped (skipped, the caller would be above them)
  H.roles.set(bobId, [GUILD, MOD_ROLE, '1555000000000000888'])
  for (const [who, action] of [['lead', 'discord-timeout'], ['dev', 'discord-ban']]) want(await H.call(action, who, H.body(action)), 503, 'discordUnavailable')
  H.roles.set(bobId, [GUILD, MOD_ROLE])
  H.make({ ...ROOMY, extra: { ...ROOMY.extra, bot: { ...H.fakeBot, outranks: undefined } } })
  want(await H.call('discord-timeout', 'owner', H.body('discord-timeout')), 503, 'discordUnavailable')
  H.make(ROOMY)
  // An Administrator: no Discord ban, as no timeout, from any tier; checked before the role order
  H.bot.member.set(bobId, { state: 'member', roles: [GUILD], handle: 'bobby', bannable: true, moderatable: false, admin: true, timedOutUntil: 0 })
  for (const who of ['owner', 'dev']) want(await H.call('discord-ban', who, H.body('discord-ban')), 409, 'targetIsAdmin')
  want(await H.call('discord-timeout', 'owner', H.body('discord-timeout')), 409, 'targetIsAdmin')
  assert.deepEqual(H.calls, [], 'Discord is never written to')
  // Not in the server: banned by id, as before
  H.bot.member.set(bobId, { state: 'absent' })
  assert.equal(want(await H.call('discord-ban', 'owner', H.body('discord-ban')), 200).job.state, 'done')
})
