'use strict'
// The viewer's rank on the Punishments panel, from their Discord roles through the bot's 60 s role cache: owner, dev (the
// dashboard's staff roles), leadgm or gm, the highest held; null for anyone else, a Trial GM included. Fails closed: an
// error, or no answer within 8 s, is no rank.

const config = require('../../config')
const discordBot = require('../discordBot')

const DEADLINE_MS = 8000
const STAFF_TTL_MS = 5 * 60 * 1000
const STAFF_CACHE_MAX = 2000
const ORDER = [
  ['owner', () => config.siteOwnerRoleIds],
  ['dev', () => config.siteStaffRoleIds],
  ['leadgm', () => config.punishLeadGmRoleIds],
  ['gm', () => config.punishGmRoleIds],
]

function withDeadline(promise, fallback) {
  let timer
  const deadline = new Promise(resolve => { timer = setTimeout(resolve, DEADLINE_MS, fallback) })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

async function tierOf(discordId) {
  if (!config.punishPanel || !discordId) return null
  const lookup = (async () => {
    for (const [tier, roles] of ORDER) {
      for (const role of roles() || []) if (await discordBot.memberHasRole(discordId, role)) return tier
    }
    return null
  })().catch(err => { console.error('[site-punish] role lookup failed:', err.message); return null })
  return withDeadline(lookup, null)
}

// Every role that makes a member staff, for hiding staff members' records from a GM
function staffRoleIds() {
  const console_ = String(config.consoleRoleIds || '').split(',').map(s => s.trim()).filter(Boolean)
  return new Set([...ORDER.flatMap(([, roles]) => roles() || []), ...(config.discordStaffRoleIds || []), ...console_])
}

// 'staff', 'player' (no staff role, or not in the guild) or 'unknown' (no answer: the caller hides the record)
const staffCache = new Map()
async function staffStatusOf(discordId) {
  if (!discordId) return 'unknown'
  const hit = staffCache.get(discordId)
  if (hit && hit.until > Date.now()) return hit.status
  const lookup = (async () => {
    const roles = await discordBot.getMemberRoles(discordId)
    const member = typeof discordBot.isGuildMember === 'function' ? await discordBot.isGuildMember(discordId) : null
    if (member === null || !Array.isArray(roles)) return 'unknown'
    if (member === false) return 'player'
    const staff = staffRoleIds()
    return roles.some(r => staff.has(r)) ? 'staff' : 'player'
  })().catch(() => 'unknown')
  const status = await withDeadline(lookup, 'unknown')
  if (status !== 'unknown') {
    staffCache.set(discordId, { status, until: Date.now() + STAFF_TTL_MS })
    if (staffCache.size > STAFF_CACHE_MAX) staffCache.delete(staffCache.keys().next().value)
  }
  return status
}
staffStatusOf.clear = () => staffCache.clear()

module.exports = { tierOf, staffStatusOf }
