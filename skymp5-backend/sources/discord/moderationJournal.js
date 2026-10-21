'use strict'
// The moderation journal, data/moderation.jsonl (0600, one JSON per line, v1): Discord timeouts, bans and unbans as they
// happen, read by the staff dashboard's Punishments panel (sources/punish), so their history outlives bans.json, which
// drops an unbanned account. The Discord id is kept to match the account and is never served. It never throws into the bot.

const crypto = require('crypto')
const fs = require('fs')
const { AuditLogEvent } = require('discord.js')
const config = require('../../config')
const profiles = require('../profiles')
const { moderatorOf, tagsOf } = require('./banAudit')
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

const isTimeoutEntry = e => (e.changes || []).some(c => c && c.key === 'communication_disabled_until')

// A timeout given (or changed) or taken off early; one that runs out by itself fires no member update
async function timeoutChanged(member, wasUntil, until) {
  const on = until > Date.now()
  if (!config.punishJournalFile || (!on && !(wasUntil > Date.now()))) return null
  const mod = await moderatorOf(member.guild, AuditLogEvent.MemberUpdate, String(member.id), isTimeoutEntry)
  return append(on ? 'discord_timeout' : 'discord_timeout_end', member.user, mod, on ? until : null)
}

module.exports = { append, timeoutChanged }
