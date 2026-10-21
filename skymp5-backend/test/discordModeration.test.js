'use strict'
// sources/discord/moderation.js on a fake guild: what the bot may do from the gateway cache, a member's state asked of
// Discord now, the timeout and ban calls as discord.js takes them, and Discord's error codes. No network.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { PermissionsBitField, PermissionFlagsBits } = require('discord.js')
const { createModeration } = require('../sources/discord/moderation')

const GUILD = '500000000000000005', ZED = '209000000000000209'
const err = code => Object.assign(new Error(`Discord ${code}`), { code })

function fake({ perms = [PermissionFlagsBits.BanMembers, PermissionFlagsBits.ModerateMembers], ready = true } = {}) {
  const calls = []
  const D = { member: null, memberError: null, banError: null, calls }
  const guild = {
    members: {
      me: { permissions: new PermissionsBitField(perms) },
      fetch: async opts => { calls.push(['fetch', opts]); if (D.memberError) throw D.memberError; return D.member },
      edit: async (id, opts) => { calls.push(['edit', id, opts]) },
    },
    bans: {
      create: async (id, opts) => { calls.push(['create', id, opts]) },
      remove: async (id, reason) => { calls.push(['remove', id, reason]) },
      fetch: async opts => { calls.push(['banFetch', opts]); if (D.banError) throw D.banError; return { user: { id: opts.user } } },
    },
  }
  D.ready = ready
  D.m = createModeration({ client: { guilds: { cache: new Map([[GUILD, guild]]) } }, isReady: () => D.ready, guildId: () => GUILD })
  return D
}
const member = (extra = {}) => ({
  roles: { cache: new Map([[GUILD, {}], ['1494126618065506425', {}]]) }, user: { username: 'zed_user' }, bannable: true, moderatable: true,
  permissions: new PermissionsBitField([]), communicationDisabledUntilTimestamp: null, ...extra,
})

test('what the bot may do comes from the cache only; Administrator counts; not ready is nothing', () => {
  assert.deepEqual(fake().m.botModeration(), { ready: true, banMembers: true, moderateMembers: true, viewAuditLog: false })
  assert.deepEqual(fake({ perms: [PermissionFlagsBits.BanMembers] }).m.botModeration(), { ready: true, banMembers: true, moderateMembers: false, viewAuditLog: false })
  assert.deepEqual(fake({ perms: [PermissionFlagsBits.Administrator] }).m.botModeration(), { ready: true, banMembers: true, moderateMembers: true, viewAuditLog: true })
  const off = fake({ ready: false })
  assert.deepEqual(off.m.botModeration(), { ready: false, banMembers: false, moderateMembers: false, viewAuditLog: false })
  assert.deepEqual(off.calls, [])
  assert.equal(fake({ perms: [PermissionFlagsBits.BanMembers] }).m.readyLine(), 'moderation: Ban Members yes, Moderate Members no, View Audit Log no')
  assert.equal(off.m.readyLine(), 'moderation: the guild is not in the cache')
})

test('a member\'s state is asked of Discord now: member, absent (10007) or unknown, and a getter that throws is false', async () => {
  const D = fake()
  D.member = member({ communicationDisabledUntilTimestamp: 1893456000000 })
  const s = await D.m.memberState(ZED)
  assert.deepEqual(s, { state: 'member', roles: [GUILD, '1494126618065506425'], handle: 'zed_user', bannable: true, moderatable: true, admin: false, timedOutUntil: 1893456000000 })
  assert.deepEqual(D.calls[0], ['fetch', { user: ZED, force: true }])
  D.member = member({ permissions: new PermissionsBitField([PermissionFlagsBits.Administrator]), moderatable: false })
  assert.equal((await D.m.memberState(ZED)).admin, true)
  D.member = member()
  Object.defineProperty(D.member, 'bannable', { get() { throw new Error('GuildUncachedMe') } })
  assert.equal((await D.m.memberState(ZED)).bannable, false)
  D.memberError = err(10007)
  assert.deepEqual(await D.m.memberState(ZED), { state: 'absent' })
  D.memberError = err(500)
  assert.deepEqual(await D.m.memberState(ZED), { state: 'unknown' })
  D.ready = false
  assert.deepEqual(await D.m.memberState(ZED), { state: 'unknown' })
})

test('the writes: a timeout by its end (null takes it off), a ban by id keeping messages, an unban; none while not ready', async () => {
  const D = fake()
  await D.m.timeoutMember(ZED, 1893456000000, 'Spam (jake via the dashboard, req 7a1c2a3b)')
  await D.m.timeoutMember(ZED, null, 'Apologised')
  await D.m.banUser(ZED, 'Threats')
  await D.m.unbanUser(ZED, 'Appeal')
  assert.deepEqual(D.calls, [
    ['edit', ZED, { communicationDisabledUntil: 1893456000000, reason: 'Spam (jake via the dashboard, req 7a1c2a3b)' }],
    ['edit', ZED, { communicationDisabledUntil: null, reason: 'Apologised' }],
    ['create', ZED, { reason: 'Threats', deleteMessageSeconds: 0 }],
    ['remove', ZED, 'Appeal'],
  ])
  D.ready = false
  for (const call of [() => D.m.timeoutMember(ZED, null, 'x'), () => D.m.banUser(ZED, 'x'), () => D.m.unbanUser(ZED, 'x')]) {
    await assert.rejects(call(), e => e.code === 'botNotReady')
  }
  assert.equal(D.calls.length, 4)
})

test('a Discord ban is asked of Discord now: banned, notBanned (10026) or unknown', async () => {
  const D = fake()
  assert.equal(await D.m.banState(ZED), 'banned')
  assert.deepEqual(D.calls[0], ['banFetch', { user: ZED, force: true }])
  D.banError = err(10026)
  assert.equal(await D.m.banState(ZED), 'notBanned')
  D.banError = err(50013)
  assert.equal(await D.m.banState(ZED), 'unknown')
  D.ready = false
  assert.equal(await D.m.banState(ZED), 'unknown')
})
