'use strict'
// The moderation journal, data/moderation.jsonl (0600, one JSON per line, v1): Discord timeouts, bans and unbans as they
// happen, read by the staff dashboard's Punishments panel (sources/punish), so their history outlives bans.json, which
// drops an unbanned account. The Discord id is kept to match the account and is never served. It never throws into the bot.

const crypto = require('crypto')
const fs = require('fs')
const { AuditLogEvent } = require('discord.js')
const config = require('../../config')
const profiles = require('../profiles')
const { moderatorOf, fromEntry, tagsOf } = require('./banAudit')
const { scrub } = require('../punish/scrub')
const { ticketOf } = require('../punish/records')

const ID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const newId = () => `M-${[...crypto.randomBytes(6)].map(b => ID_CHARS[b & 31]).join('')}`

function profileOf(discordId) {
  try { const p = profiles.load().map[discordId]; return Number.isInteger(p) ? p : null } catch { return null }
}

// kind: discord_timeout, discord_timeout_end, discord_ban or discord_unban; mod: banAudit.moderatorOf's answer
function append(kind, user, mod, until = null) {
  const file = config.punishJournalFile
  if (!file || !user || !user.id) return null
  try {
    const discordId = String(user.id)
    const profileId = profileOf(discordId)
    const found = !!(mod && mod.found)
    const reason = found ? scrub(mod.reason) : null
    const entry = {
      v: 1, id: newId(), at: new Date().toISOString(), kind, discordId, profileId,
      tags: profileId === null ? [] : (tagsOf(discordId, profileId) || []).map(t => t.replace(/^#/, '')).slice(0, 10),
      name: null, discordName: scrub(user.globalName || user.username, 40), until: until ? new Date(until).toISOString() : null, reason,
      by: { name: null, profileId: null, discordName: found ? scrub(mod.name, 40) : null },
      ticket: ticketOf(reason), via: found && mod.bot ? 'bot' : 'discord',
    }
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
    return entry
  } catch (err) {
    console.error('[moderation-journal] not written:', err.code || err.message)
    return null
  }
}

const TIMEOUT_KEY = 'communication_disabled_until'
const isTimeoutEntry = e => (e.changes || []).some(c => c && c.key === TIMEOUT_KEY)

// auditGraceMs: how long a member update waits for the audit log entry of the same timeout; claimMs: how long one is remembered
const TIMING = { auditGraceMs: 10000, claimMs: 15 * 60000 }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// A timeout given (or changed) or taken off early; one that runs out by itself is neither
function timeoutKind(wasUntil, until) {
  if (until > Date.now()) return 'discord_timeout'
  return wasUntil > Date.now() ? 'discord_timeout_end' : null
}

// One row per timeout change, whichever Discord event comes first: the audit log entry or the member update
const claimed = new Map()
const claimKey = (discordId, kind, wasUntil, until) => `${discordId}:${kind}:${Math.round((kind === 'discord_timeout' ? until : wasUntil) / 1000)}`
function claim(discordId, kind, wasUntil, until) {
  const now = Date.now()
  for (const [k, t] of claimed) if (t <= now) claimed.delete(k)
  const key = claimKey(discordId, kind, wasUntil, until)
  if (claimed.has(key)) return false
  claimed.set(key, now + TIMING.claimMs)
  return true
}

// The dashboard's claim on a timeout it gives or takes off, taken before it asks Discord, so the bot's copy is skipped; its key, or null
const claimTimeout = (discordId, kind, wasUntil, until) => (claim(String(discordId), kind, wasUntil, until) ? claimKey(String(discordId), kind, wasUntil, until) : null)
// The same for a Discord ban or unban, which the bot's guildBanAdd and guildBanRemove see within a moment
const BAN_CLAIM_MS = 2 * 60000
function claimBan(discordId, kind) {
  const key = `${discordId}:${kind}:dashboard`
  claimed.set(key, Date.now() + BAN_CLAIM_MS)
  return key
}
// true once, when the dashboard claimed this ban or unban in the last 2 minutes
function claimedBan(discordId, kind) {
  const key = `${discordId}:${kind}:dashboard`
  const until = claimed.get(key)
  if (!until || until <= Date.now()) return false
  claimed.delete(key)
  return true
}
const release = key => { if (key) claimed.delete(key) }

// A row for an action the dashboard took (sources/punish/actions.js), named by the staff member's Discord username
const DASHBOARD_KINDS = new Set(['discord_timeout', 'discord_timeout_end', 'discord_ban', 'discord_unban', 'ban', 'unban'])
function dashboard(kind, d) {
  const file = config.punishJournalFile
  if (!file || !DASHBOARD_KINDS.has(kind) || !d || !d.discordId) return null
  try {
    const reason = scrub(d.reason)
    const entry = {
      v: 1, id: newId(), at: new Date().toISOString(), kind, discordId: String(d.discordId), profileId: Number.isSafeInteger(d.profileId) ? d.profileId : null,
      tags: (Array.isArray(d.tags) ? d.tags : []).slice(0, 10), name: null, discordName: scrub(d.discordName, 40),
      until: d.untilMs ? new Date(d.untilMs).toISOString() : null, reason,
      by: { name: null, profileId: null, discordName: scrub(d.by && d.by.handle, 40) }, ticket: ticketOf(reason), via: 'dashboard',
      req: typeof d.req === 'string' ? d.req.slice(0, 8) : null, ...(d.ref ? { ref: String(d.ref) } : {}),
    }
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
    return entry
  } catch (err) {
    console.error('[moderation-journal] not written:', err.code || err.message)
    return null
  }
}

// The guild audit log entry of a timeout: it names who and why, and comes for every member, cached by the bot or not
async function auditEntry(entry, guild) {
  if (!config.punishJournalFile || !entry || entry.action !== AuditLogEvent.MemberUpdate || !entry.targetId) return null
  const change = (entry.changes || []).find(c => c && c.key === TIMEOUT_KEY)
  if (!change) return null
  const wasUntil = Date.parse(change.old) || 0
  const until = Date.parse(change.new) || 0
  const discordId = String(entry.targetId)
  const kind = timeoutKind(wasUntil, until)
  if (!kind || !claim(discordId, kind, wasUntil, until)) return null
  const users = guild && guild.client && guild.client.users
  const fetchUser = async id => { try { return users ? await users.fetch(String(id)) : null } catch { return null } }
  const executor = entry.executor || (entry.executorId ? await fetchUser(entry.executorId) : null)
  const user = (entry.target && entry.target.id ? entry.target : await fetchUser(discordId)) || { id: discordId }
  return append(kind, user, fromEntry(executor, entry.reason), kind === 'discord_timeout' ? until : null)
}

// A member update on a member the bot has cached: journalled only when no audit log entry came for it (no View Audit Log)
async function timeoutChanged(member, wasUntil, until) {
  const kind = timeoutKind(wasUntil, until)
  if (!config.punishJournalFile || !kind) return null
  await sleep(TIMING.auditGraceMs)
  if (!claim(String(member.id), kind, wasUntil, until)) return null
  const mod = await moderatorOf(member.guild, AuditLogEvent.MemberUpdate, String(member.id), isTimeoutEntry)
  return append(kind, member.user, mod, kind === 'discord_timeout' ? until : null)
}

module.exports = { append, auditEntry, timeoutChanged, dashboard, claimTimeout, claimBan, claimedBan, release, TIMING }
