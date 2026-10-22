'use strict'
// The bot's moderation calls for the Punishments panel's actions (sources/punish/actions.js): what the bot may do, read
// from the gateway cache only, a member's state asked of Discord now, and the timeout and ban calls. Writes need the
// gateway client ready; they never use the raw HTTP fallback the role reads have.

const { PermissionFlagsBits } = require('discord.js')

const NOT_READY = Object.freeze({ ready: false, banMembers: false, moderateMembers: false, viewAuditLog: false })

// Discord's role order for one member acting on another, as GuildMember.manageable has it for the bot; null when not cached
function outranksIn(g, byId, byRoles, targetId, targetRoles) {
  const everyone = g?.roles?.cache?.get(String(g.id))
  if (!everyone) return null
  if (String(targetId) === String(g.ownerId)) return false
  if (String(byId) === String(g.ownerId)) return true
  // A role the cache does not hold cannot be placed, so the answer is unknown (skipped, it would put a target lower)
  const by = (byRoles || []).map(id => g.roles.cache.get(String(id)))
  const target = (targetRoles || []).map(id => g.roles.cache.get(String(id)))
  if (by.includes(undefined) || target.includes(undefined)) return null
  // RoleManager.comparePositions: the higher position, and at the same position the older role (the lower id)
  const above = (a, b) => (a.position !== b.position ? a.position > b.position : BigInt(a.id) < BigInt(b.id))
  const top = list => list.reduce((t, r) => (above(r, t) ? r : t), everyone)
  return above(top(by), top(target))
}

function createModeration({ client, isReady, guildId }) {
  const guild = () => (isReady() ? client.guilds.cache.get(guildId()) || null : null)
  const has = (subject, flag) => { try { return !!subject.permissions.has(flag) } catch { return false } }

  // { ready, banMembers, moderateMembers, viewAuditLog }; has() counts Administrator
  function botModeration() {
    const me = guild()?.members?.me
    if (!me) return NOT_READY
    return {
      ready: true, banMembers: has(me, PermissionFlagsBits.BanMembers), moderateMembers: has(me, PermissionFlagsBits.ModerateMembers),
      viewAuditLog: has(me, PermissionFlagsBits.ViewAuditLog),
    }
  }

  // { state: 'member', roles, handle, bannable, moderatable, admin, timedOutUntil }, { state: 'absent' } or { state: 'unknown' }
  async function memberState(discordId) {
    const g = guild()
    if (!g) return { state: 'unknown' }
    try {
      const m = await g.members.fetch({ user: discordId, force: true })
      const flag = name => { try { return !!m[name] } catch { return false } }
      return {
        state: 'member', roles: [...m.roles.cache.keys()].map(String), handle: String(m.user?.username || ''),
        bannable: flag('bannable'), moderatable: flag('moderatable'), admin: has(m, PermissionFlagsBits.Administrator),
        timedOutUntil: Number(m.communicationDisabledUntilTimestamp) || 0,
      }
    } catch (err) {
      return err && err.code === 10007 ? { state: 'absent' } : { state: 'unknown' }
    }
  }

  function needGuild() {
    const g = guild()
    if (!g) throw Object.assign(new Error('the Discord bot is not ready'), { code: 'botNotReady' })
    return g
  }

  // untilMs null takes a timeout off
  const timeoutMember = async (discordId, untilMs, reason) => { await needGuild().members.edit(discordId, { communicationDisabledUntil: untilMs, reason }) }
  // Message history is kept as evidence for appeals
  const banUser = async (discordId, reason) => { await needGuild().bans.create(discordId, { reason, deleteMessageSeconds: 0 }) }
  const unbanUser = async (discordId, reason) => { await needGuild().bans.remove(discordId, reason) }

  // 'banned', 'notBanned' (10026) or 'unknown'
  async function banState(discordId) {
    const g = guild()
    if (!g) return 'unknown'
    try { await g.bans.fetch({ user: discordId, force: true }); return 'banned' } catch (err) { return err && err.code === 10026 ? 'notBanned' : 'unknown' }
  }

  // From the gateway's role cache, as botModeration; any error is null
  const outranks = (byId, byRoles, targetId, targetRoles) => { try { return outranksIn(guild(), byId, byRoles, targetId, targetRoles) } catch { return null } }

  // One line at gateway ready, so a restart shows whether the actions can work
  function readyLine() {
    const m = botModeration()
    const yn = v => (v ? 'yes' : 'no')
    return m.ready ? `moderation: Ban Members ${yn(m.banMembers)}, Moderate Members ${yn(m.moderateMembers)}, View Audit Log ${yn(m.viewAuditLog)}`
      : 'moderation: the guild is not in the cache'
  }

  return { botModeration, memberState, timeoutMember, banUser, unbanUser, banState, outranks, readyLine }
}

module.exports = { createModeration, outranksIn }
