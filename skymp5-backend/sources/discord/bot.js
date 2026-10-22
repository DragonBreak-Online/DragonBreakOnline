'use strict'

const { Client, GatewayIntentBits } = require('discord.js')
const https = require('https')
const config = require('../../config')
const bans = require('../bans')
const players = require('../players')
const tickets = require('./tickets')
const banAudit = require('./banAudit')
const moderationJournal = require('./moderationJournal')
const serverStatus = require('./serverStatus')
const { createModeration } = require('./moderation')

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration],
})

let ready = false
const moderation = createModeration({ client, isReady: () => ready, guildId: () => config.discordGuildId })

client.once('ready', () => {
  ready = true
  console.log(`[discord-bot] ready as ${client.user.tag}`)
  console.log(`[discord-bot] ${moderation.readyLine()}`)
  tickets.ensurePanel(client).catch(err => console.error('[discord-bot] ticket panel failed:', err.message))
  serverStatus.start(client)
})

// Ticket buttons and their modals. handleInteraction returns false for anything not
// ours, so another interaction handler can be added here without untangling this one.
// The remote staff console's /console slash command takes what the tickets leave, then /say and its form, then /referral
client.on('interactionCreate', interaction => {
  tickets.handleInteraction(interaction)
    .then(handled => (handled ? true : require('./consoleCommand').handleInteraction(interaction)))
    .then(handled => (handled ? true : require('./sayCommand').handleInteraction(interaction)))
    .then(handled => (handled ? true : require('./referralCommand').handleInteraction(interaction)))
    .catch(err => {
      console.error('[discord-bot] interaction failed:', err.message)
    })
})

client.on('error', err => {
  console.error('[discord-bot] error:', err.message)
})

// The game ban list's guard is on only while the panel's own game bans are (PUNISH_ACTIONS bans=on); off, the bot does as before
function guardsGameBans() {
  try { return require('../punish/actions').actionsSettings(config).bans === 'on' } catch (err) {
    console.error('[discord-bot] the actions switch could not be read, so the ban list has no guard:', err.message)
    return false
  }
}

// A real Discord guild ban snapshots the player into bans.json under a ban ref (guarded: a game ban already there is kept)
client.on('guildBanAdd', ban => {
  let listNote = 'added to the game ban list'
  try {
    if (config.discordGuildId && ban.guild.id !== config.discordGuildId) return
    const discordId = ban.user.id
    const record = players.load()[discordId] || {}
    const entry = bans.add({
      discordId,
      ip: record.lastIp || null,
      reason: 'discord ban',
      bannedBy: 'discord',
    }, { keepOther: guardsGameBans() })
    if (entry.kept) listNote = `already on the game ban list${entry.ref ? ` as ${entry.ref}` : ''}; kept`
    else {
      if (entry.ref) listNote = `added to the game ban list as ${entry.ref}`
      bans.logBan(`discord ban: discordId=${discordId} username=${ban.user.username || 'unknown'} hwid=${entry.hwid || 'none'} ip=${entry.ip || 'none'}`)
      console.log(`[discord-bot] recorded guild ban for ${discordId}`)
    }
  } catch (err) {
    listNote = 'the game ban list could not be written'
    console.error('[discord-bot] failed to record guild ban:', err.message)
  }
  banAudit.record('ban', ban, listNote).then(mod => (moderationJournal.claimedBan(ban.user.id, 'discord_ban') ? null : moderationJournal.append('discord_ban', ban.user, mod)))
    .catch(err => console.error('[discord-bot] ban audit failed:', err.message))
})

// A Discord unban lifts the snapshot too, or the player would stay banned forever (guarded: only the snapshot)
client.on('guildBanRemove', ban => {
  let listNote = 'it was not on the game ban list'
  try {
    if (config.discordGuildId && ban.guild.id !== config.discordGuildId) return
    const discordId = ban.user.id
    const lifted = bans.removeByDiscordId(discordId, { onlyDiscordCopy: guardsGameBans() })
    if (lifted === true) {
      listNote = 'lifted from the game ban list'
      bans.logBan(`discord unban: discordId=${discordId} username=${ban.user.username || 'unknown'}`)
      console.log(`[discord-bot] lifted guild ban for ${discordId}`)
    } else if (lifted && lifted.kept) {
      listNote = `the game ban${lifted.kept.ref ? ` ${lifted.kept.ref}` : ''} stays; lift it on the dashboard`
    }
  } catch (err) {
    listNote = 'the game ban list could not be updated'
    console.error('[discord-bot] failed to lift guild ban:', err.message)
  }
  banAudit.record('unban', ban, listNote).then(mod => (moderationJournal.claimedBan(ban.user.id, 'discord_unban') ? null : moderationJournal.append('discord_unban', ban.user, mod)))
    .catch(err => console.error('[discord-bot] unban audit failed:', err.message))
})

// A timeout given or taken off in Discord, from the guild audit log, for the moderation journal; it also comes for members the bot has not cached
client.on('guildAuditLogEntryCreate', (entry, guild) => {
  if (config.discordGuildId && (!guild || guild.id !== config.discordGuildId)) return
  moderationJournal.auditEntry(entry, guild).catch(err => console.error('[discord-bot] timeout journal failed:', err.message))
})

// Role and nickname changes go to the audit channel the moment they happen
client.on('guildMemberUpdate', (before, after) => {
  try {
    if (config.discordGuildId && after.guild.id !== config.discordGuildId) return
    const audit = require('./audit')
    const was = new Set(before.roles.cache.keys())
    const now = new Set(after.roles.cache.keys())
    const added = [...now].filter(r => !was.has(r)).map(r => after.guild.roles.cache.get(r)?.name || r)
    const removed = [...was].filter(r => !now.has(r)).map(r => after.guild.roles.cache.get(r)?.name || r)
    const tag = `${after.user.username} (<@${after.id}>)`
    if (added.length) audit.log(`PERM ${tag} gained role(s): ${added.join(', ')}`)
    if (removed.length) audit.log(`PERM ${tag} lost role(s): ${removed.join(', ')}`)
    if (before.nickname !== after.nickname) audit.log(`NAME ${tag} nickname "${before.nickname || ''}" -> "${after.nickname || ''}"`)
    if (added.length || removed.length) roleCache.delete(after.id)
    // A timeout given or taken off on a cached member; journalled only if its audit log entry does not come
    const wasUntil = before.communicationDisabledUntilTimestamp || 0
    const until = after.communicationDisabledUntilTimestamp || 0
    if (wasUntil !== until) {
      moderationJournal.timeoutChanged(after, wasUntil, until).catch(err => console.error('[discord-bot] timeout journal failed:', err.message))
    }
  } catch (err) {
    console.error('[discord-bot] member update audit failed:', err.message)
  }
})

function ensureRoleLookupConfigured() {
  if (!config.discordBotToken || !config.discordGuildId) {
    throw new Error('discord bot role lookup is not configured')
  }
}

// Short-lived cache so launcher polling doesn't turn into a request spam
const ROLE_CACHE_TTL_MS = 60 * 1000
const roleCache = new Map() // discordId -> { roles, member, expiresAt }; member false = not in the guild

async function getMemberRoles(discordId) {
  if (!discordId) return []
  if (!config.discordBotToken || !config.discordGuildId) return []

  const cached = roleCache.get(discordId)
  if (cached && cached.expiresAt > Date.now()) return cached.roles

  if (ready) {
    try {
      const guild = await client.guilds.fetch(config.discordGuildId)
      const member = await guild.members.fetch({ user: discordId, force: true })
      const roles = [...member.roles.cache.keys()]
      roleCache.set(discordId, { roles, member: true, expiresAt: Date.now() + ROLE_CACHE_TTL_MS })
      return roles
    } catch (err) {
      if (err && err.code === 10007) {
        roleCache.set(discordId, { roles: [], member: false, expiresAt: Date.now() + ROLE_CACHE_TTL_MS })
        return []  // genuinely not in server
      }
      console.warn('[discord-bot] guild fetch failed, falling back to HTTP:', err.message)
    }
  }

  try {
    const roles = await fetchMemberRoles(discordId)
    roleCache.set(discordId, { roles: roles || [], member: roles !== null, expiresAt: Date.now() + ROLE_CACHE_TTL_MS })
    return roles || []
  } catch (err) {
    console.error('[discord-bot] HTTP fallback also failed:', err.message)
    return []  // not cached: allows quick recovery once Discord is reachable
  }
}

// true in the guild, false not in it, null unknown (no guild configured, or Discord did not answer: the caller lets
// the player in rather than lock everyone out during a Discord outage)
async function isGuildMember(discordId) {
  if (!discordId || !config.discordBotToken || !config.discordGuildId) return null
  await getMemberRoles(discordId)
  const cached = roleCache.get(discordId)
  return cached && cached.expiresAt > Date.now() && typeof cached.member === 'boolean' ? cached.member : null
}

function isReady() {
  return ready && !!config.discordGuildId
}

async function memberHasRole(discordId, roleId) {
  if (!roleId) return false
  return (await getMemberRoles(discordId)).includes(roleId)
}

// The remote console's permission check: a new answer from Discord every time (it refreshes the 60 s cache, never reads it)
// with the member's username; null on any failure or when not in the guild
async function getMemberFresh(discordId) {
  if (!discordId || !config.discordBotToken || !config.discordGuildId) return null
  if (ready) {
    try {
      const guild = await client.guilds.fetch(config.discordGuildId)
      const member = await guild.members.fetch({ user: discordId, force: true })
      const roles = [...member.roles.cache.keys()]
      roleCache.set(discordId, { roles, member: true, expiresAt: Date.now() + ROLE_CACHE_TTL_MS })
      return { roles, handle: String(member.user?.username || '') }
    } catch (err) {
      if (err && err.code === 10007) return null
      console.warn('[discord-bot] console member fetch failed, falling back to HTTP:', err.message)
    }
  }
  try {
    const member = await fetchMember(discordId)
    return member ? { roles: Array.isArray(member.roles) ? member.roles : [], handle: String(member.user?.username || '') } : null
  } catch (err) {
    console.error('[discord-bot] console member HTTP lookup failed:', err.message)
    return null
  }
}

// Whether an interaction came through this process's own gateway client
const isOwnClient = c => c === client

function fetchMemberRoles(discordId) {
  return fetchMember(discordId).then(member => (member ? (Array.isArray(member.roles) ? member.roles : []) : null))
}

// The guild member as Discord's REST API answers; null when not in the guild
function fetchMember(discordId) {
  return new Promise((resolve, reject) => {
    try {
      ensureRoleLookupConfigured()
    } catch (err) {
      return reject(err)
    }

    const req = https.get({
      hostname: 'discord.com',
      path: `/api/guilds/${config.discordGuildId}/members/${discordId}`,
      headers: { Authorization: `Bot ${config.discordBotToken}` },
    }, res => {
      let data = ''
      res.on('data', c => { data += c })
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null)   // not in the guild
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`discord member lookup failed (${res.statusCode})`))
        }
        try {
          const json = JSON.parse(data)
          if (!json || typeof json !== 'object') throw new TypeError('discord member lookup returned no member')
          resolve(json)
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('error', reject)
  })
}

async function getMembersWithRole(roleId) {
  if (!roleId) return []
  if (!isReady()) throw new Error('discord bot is not ready')

  const guild = await client.guilds.fetch(config.discordGuildId)
  const role = await guild.roles.fetch(roleId)
  if (!role) return []

  await guild.members.fetch()

  return guild.members.cache
    .filter(member => member.roles.cache.has(roleId))
    .map(member => ({
      discordId: member.user.id,
      username: member.user.username,
      displayName: member.displayName || member.user.globalName || member.user.username,
      avatar: member.user.displayAvatarURL({ size: 64 }),
      joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
      roles: [...member.roles.cache.keys()],
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

async function addMemberRole(discordId, roleId) {
  if (!roleId) throw new Error('roleId is required')
  return mutateMemberRole(discordId, roleId, 'PUT')
}

async function removeMemberRole(discordId, roleId) {
  if (!roleId) throw new Error('roleId is required')
  return mutateMemberRole(discordId, roleId, 'DELETE')
}

function mutateMemberRole(discordId, roleId, method) {
  return new Promise((resolve, reject) => {
    try {
      ensureRoleLookupConfigured()
    } catch (err) {
      return reject(err)
    }

    const req = https.request({
      hostname: 'discord.com',
      path: `/api/guilds/${config.discordGuildId}/members/${discordId}/roles/${roleId}`,
      method,
      headers: { Authorization: `Bot ${config.discordBotToken}` },
    }, res => {
      let data = ''
      res.on('data', c => { data += c })
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          roleCache.delete(discordId)  // role changed; don't serve stale roles
          return resolve(true)
        }
        reject(new Error(`discord role update failed (${res.statusCode}): ${data}`))
      })
    })
    req.on('error', reject)
    req.end()
  })
}

function start() {
  if (!config.discordBotToken) {
    console.warn('[discord-bot] DISCORD_BOT_TOKEN not set - role-based access checks will be unavailable')
    return
  }
  client.login(config.discordBotToken).catch(err => {
    console.error('[discord-bot] login failed:', err.message)
  })
}

module.exports = {
  start,
  audit: require('./audit'),
  botModeration: moderation.botModeration,
  memberState: moderation.memberState,
  timeoutMember: moderation.timeoutMember,
  banUser: moderation.banUser,
  unbanUser: moderation.unbanUser,
  banState: moderation.banState,
  outranks: moderation.outranks,
  getMemberRoles,
  getMemberFresh,
  isOwnClient,
  isGuildMember,
  isReady,
  memberHasRole,
  getMembersWithRole,
  addMemberRole,
  removeMemberRole,
}
