'use strict'
// Staff dashboard data, behind the website sign-in and a Discord role check on EVERY request, so a
// member who loses the role loses the page at their next click rather than when their session expires.
// Roles: config.siteStaffRoleIds (Owners and Dragon Break Dev) and config.siteOwnerRoleIds (Owners). The bot's
// role lookup fails closed: if Discord cannot be asked, the answer is no.
//
//   GET /api/site/staff/me        whether the signed-in visitor is staff, for staff whether an Owner, and their Punishments panel rank (routes/site-punish.js)
//   GET /api/site/staff/overview  server state and account totals
//   GET /api/site/staff/players   every account: Discord name, characters, last launcher sign-in, last game join, factions
//   GET /api/site/staff/world     how many characters are vampires, werewolves, fever carriers and more: counts only

const router  = require('express').Router()
const fs      = require('fs')
const path    = require('path')
const config  = require('../config')
const players = require('../sources/players')
const discordBot = require('../sources/discordBot')
const nameTable = require('../sources/nameTable')
const { getHeartbeat } = require('./servers')
const { internals } = require('./site-auth')
const { currentSession, readStore, toSiteCharacter, profileIdOf, dynamicFields } = internals
const { tierOf } = require('../sources/punish/tier')

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, private')
  next()
})

// The bot's HTTP fallback has no timeout of its own, so a slow Discord would hang the page: give up and refuse
const ROLE_CHECK_MS = 8000
function withDeadline(promise) {
  let timer
  const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(false), ROLE_CHECK_MS) })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

async function hasAnyRole(discordId, roleIds) {
  for (const roleId of roleIds) {
    try { if (await withDeadline(discordBot.memberHasRole(discordId, roleId))) return true }
    catch (err) { console.error('[site-staff] role lookup failed:', err.message) }
  }
  return false
}

const isStaff = discordId => hasAnyRole(discordId, config.siteStaffRoleIds)
const isOwner = discordId => hasAnyRole(discordId, config.siteOwnerRoleIds)

async function requireStaff(req, res, next) {
  const session = currentSession(req)
  if (!session) return res.status(401).json({ error: 'signedOut' })
  if (!(await isStaff(session.discordId))) return res.status(403).json({ error: 'notStaff' })
  req.staff = session
  next()
}

router.get('/me', async (req, res) => {
  const session = currentSession(req)
  if (!session) return res.json({ signedIn: false, staff: false, owner: false })
  const staff = await isStaff(session.discordId)
  const owner = staff && await isOwner(session.discordId)
  res.json({ signedIn: true, staff, owner, punish: await tierOf(session.discordId), name: String(session.username || '') })
})

// Characters grouped by the account that owns them; a character stamped with another Discord id is skipped
function charactersByProfile() {
  const byProfile = new Map()
  for (const form of readStore()) {
    const pid = form.char.profileId
    if (!byProfile.has(pid)) byProfile.set(pid, [])
    byProfile.get(pid).push(form)
  }
  return byProfile
}

function within(iso, ms) {
  const t = Date.parse(iso || '')
  return Number.isFinite(t) && Date.now() - t < ms
}

router.get('/overview', requireStaff, (_req, res) => {
  const rows = Object.values(players.load())
  let characters = 0
  try { for (const forms of charactersByProfile().values()) characters += forms.filter(f => !f.char.deleted).length }
  catch { characters = null }
  const beat = getHeartbeat()
  const DAY = 24 * 3600 * 1000
  res.json({
    server: beat ? { name: beat.name, online: beat.online, maxPlayers: beat.maxPlayers, lastSeen: beat.lastSeen } : null,
    accounts: rows.length,
    characters,
    joinedGame24h: rows.filter(r => within(r.lastGameJoinAt, DAY)).length,
    joinedGame7d:  rows.filter(r => within(r.lastGameJoinAt, 7 * DAY)).length,
    launcher24h:   rows.filter(r => within(r.lastSeenAt, DAY)).length,
  })
})

// Deliberately NOT included: lastIp, hwid and admin notes. The page is for recognising people, not tracking them.
router.get('/players', requireStaff, (_req, res) => {
  let byProfile
  try { byProfile = charactersByProfile() }
  catch (err) {
    console.error('[site-staff] changeForms store unreadable:', err.message)
    return res.status(503).json({ error: 'storeUnavailable' })
  }

  const names = nameTable.load()
  const accounts = Object.entries(players.load()).map(([discordId, row]) => {
    const profileId = Number.isInteger(row.profileId) ? row.profileId : profileIdOf(discordId)
    const forms = (byProfile.get(profileId) || []).filter(f => {
      const stamped = dynamicFields(f.cf)['private.indexed.discordId']
      return !f.char.deleted && (stamped === undefined || stamped === null || stamped === discordId)
    })
    const characters = forms
      .sort((a, b) => parseInt(a.char.formDesc, 16) - parseInt(b.char.formDesc, 16))
      .map(form => {
        const c = toSiteCharacter(form, names, null)
        return {
          name: c.name, status: c.status, race: c.race, gold: c.gold,
          skillPoints: c.progress.skillPoints,
          topSkill: c.progress.skills[0] ? `${c.progress.skills[0].label} ${c.progress.skills[0].points}` : null,
          deity: c.progress.deity ? c.progress.deity.name : null,
          factions: c.progress.factions.map(f => ({ name: f.name, kind: f.kind, rank: f.rank })),
          lastSaved: c.lastSaved,
        }
      })
    const factionNames = [...new Set(characters.flatMap(c => c.factions.map(f => f.name)))]
    return {
      discordName: String(row.displayName || row.username || ''),
      username: String(row.username || ''),
      avatarUrl: typeof row.avatar === 'string' && row.avatar.startsWith('https://cdn.discordapp.com/') ? row.avatar : null,
      profileId,
      createdAt: row.createdAt || null,
      lastLauncherSignIn: row.lastSeenAt || null,
      lastGameJoin: row.lastGameJoinAt || null,
      characters,
      factions: factionNames,
    }
  })

  const newest = r => Math.max(Date.parse(r.lastGameJoin || 0) || 0, Date.parse(r.lastLauncherSignIn || 0) || 0)
  accounts.sort((a, b) => newest(b) - newest(a))
  res.json({ accounts })
})

// Supernatural counts the game writes each minute (worldstats.js); kept out of the public /api/metrics and passed on field by field
const STAFF_STATS_FILE = 'staff-stats.json'
const WORLD_STALE_MS = 5 * 60000
const count = v => (Number.isInteger(v) && v >= 0 ? v : 0)
const label = v => String(v == null ? '' : v).slice(0, 80)
const totals = o => ({ total: count(o && o.total), online: count(o && o.online), accounts: count(o && o.accounts) })
const ranks = list => (Array.isArray(list) ? list.slice(0, 12) : []).map(r => ({ name: label(r && r.name), count: count(r && r.count) }))

function cleanWorld(w) {
  const v = w.vampire || {}, ww = w.werewolf || {}, fever = w.fever || {}, grant = w.grant || {}
  const at = Date.parse(w.updatedAt || '')
  return {
    updatedAt: Number.isFinite(at) ? new Date(at).toISOString() : null,
    stale: !(Date.now() - at < WORLD_STALE_MS),
    characters: count(w.characters), accounts: count(w.accounts), online: count(w.online),
    vampire: {
      ...totals(v), pure: count(v.pure), unfed: count(v.unfed),
      thirst: [0, 1, 2, 3].map(i => count(Array.isArray(v.thirst) ? v.thirst[i] : 0)),
      ranks: ranks(v.ranks), crown: v.crown === 'held' || v.crown === 'unclaimed' ? v.crown : null, lordForm: count(v.lordForm),
    },
    werewolf: { ...totals(ww), blessed: count(ww.blessed), inPack: count(ww.inPack), lone: count(ww.lone), ranks: ranks(ww.ranks), beastForm: count(ww.beastForm) },
    fever: { vampire: totals(fever.vampire), werewolf: totals(fever.werewolf) },
    grant: { werewolf: totals(grant.werewolf), vampireLord: totals(grant.vampireLord) },
    houses: (Array.isArray(w.houses) ? w.houses.slice(0, 40) : []).filter(h => h && (h.circle === 'vampire' || h.circle === 'werewolf'))
      .map(h => ({ name: label(h.name), circle: h.circle, pack: h.pack === true, members: count(h.members), cursed: count(h.cursed), online: count(h.online) })),
  }
}

router.get('/world', requireStaff, async (_req, res) => {
  let w
  try { w = JSON.parse(await fs.promises.readFile(path.join(config.gameServerDir, STAFF_STATS_FILE), 'utf8')) }
  catch { w = null }
  if (!w || typeof w !== 'object' || Array.isArray(w)) return res.status(503).json({ error: 'noCounts' })
  res.json(cleanWorld(w))
})

module.exports = router
module.exports.internals = { requireStaff, isOwner }
