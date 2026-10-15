'use strict'
// Bans and unbans issued on Discord, for the staff audit channel: who and why from the guild's audit log, the account by username, profile and #TAGs

const { AuditLogEvent } = require('discord.js')
const audit = require('./audit')
const profiles = require('../profiles')

// When the guild's audit log is read after the event (ms): Discord can write the entry a moment late
const WAITS_MS = [0, 2000, 5000]
// An entry older than this belongs to an earlier ban of the same member
const ENTRY_MAX_AGE_MS = 2 * 60 * 1000

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const oneLine = (text, max) => String(text || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
// A Discord id or mention a moderator typed into the reason
const ID_RX = /<[@#][!&]?\d{5,22}>|\b\d{17,20}\b/g

// { found, denied, name, bot, reason } from the newest entry of this type on this member; denied: no View Audit Log
async function moderatorOf(guild, type, targetId) {
  for (const wait of WAITS_MS) {
    if (wait > 0) await sleep(wait)
    let entries
    try {
      entries = [...(await guild.fetchAuditLogs({ type, limit: 10 })).entries.values()]
    } catch (err) {
      return { found: false, denied: !!err && (err.code === 50013 || err.status === 403) }
    }
    const hit = entries.find(e => e && e.targetId === targetId && Date.now() - Number(e.createdTimestamp) < ENTRY_MAX_AGE_MS)
    if (hit) return { found: true, name: oneLine(hit.executor && hit.executor.username, 40) || 'unknown', bot: !!(hit.executor && hit.executor.bot), reason: oneLine(String(hit.reason || '').replace(ID_RX, '[id]'), 300) }
  }
  return { found: false, denied: false }
}

// The account's character #TAGs from the site's cached character store; null when it cannot be read
function tagsOf(discordId, profileId) {
  try {
    const { readStore, dynamicFields, ownedBy } = require('../../routes/site-auth').internals
    const tags = []
    for (const { cf, char } of readStore()) {
      if (char.profileId !== profileId || char.deleted || !ownedBy(cf, discordId)) continue
      const tag = dynamicFields(cf)['private.charTag']
      if (typeof tag === 'string' && /^[A-Z0-9]{4}$/.test(tag)) tags.push(`#${tag}`)
    }
    return tags
  } catch {
    return null
  }
}

function accountText(discordId) {
  let id
  try { id = profiles.load().map[discordId] } catch { return 'profile unknown' }
  if (!Number.isInteger(id)) return 'no game profile'
  const tags = tagsOf(discordId, id)
  if (!tags) return `profile ${id}`
  return tags.length ? `profile ${id}: ${tags.slice(0, 10).join(', ')}${tags.length > 10 ? ` and ${tags.length - 10} more` : ''}` : `profile ${id}, no character`
}

// op 'ban' or 'unban'; listNote: what happened to the game's ban list
async function record(op, ban, listNote) {
  const discordId = String(ban.user.id)
  const type = op === 'ban' ? AuditLogEvent.MemberBanAdd : AuditLogEvent.MemberBanRemove
  const mod = await moderatorOf(ban.guild, type, discordId)
  const who = mod.found ? `${mod.name}${mod.bot ? ' (bot)' : ''}` : `an unknown moderator${mod.denied ? ' (the bot cannot read the Discord audit log)' : ''}`
  const user = oneLine(ban.user.username, 40) || 'unknown user'
  const [verb, done] = op === 'ban' ? ['BAN', 'banned'] : ['UNBAN', 'unbanned']
  audit.log(`${verb} ${user} (${accountText(discordId)}) ${done} on Discord by ${who}; ${listNote}; ${mod.reason ? `reason: ${mod.reason}` : 'no reason given'}`)
}

module.exports = { record, moderatorOf, WAITS_MS }
