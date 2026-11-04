'use strict'

const { Router }        = require('express')
const fs                = require('fs')
const path              = require('path')
const config            = require('../config')
const requirePermission = require('../middleware/requirePermission')
const whitelist         = require('../sources/factionWhitelist')
const profiles          = require('../sources/profiles')
const siteAuth          = require('./site-auth')

const router = Router()

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

let liveCache = { at: 0, payload: null }
const LIVE_CACHE_TTL_MS = 5000

function buildLiveFactions() {
  const now = Date.now()
  if (liveCache.payload && now - liveCache.at < LIVE_CACHE_TTL_MS) {
    return liveCache.payload
  }

  const base = whitelist.list()
  const srvDir = config.zonesDir || path.join(__dirname, '..', '..', 'build', 'dist', 'server')
  const guildDefs = safeReadJson(path.join(srvDir, 'guild-defs.json'), null)
  const guildOverrides = safeReadJson(path.join(srvDir, 'guild-overrides.json'), {})
  const guildsState = safeReadJson(path.join(srvDir, 'guilds.json'), {})
  const zones = safeReadJson(path.join(srvDir, 'zones.json'), {})
  const officials = safeReadJson(path.join(srvDir, 'officials.json'), {})

  if (!guildDefs || !Array.isArray(guildDefs.factions)) {
    liveCache = { at: now, payload: base }
    return base
  }

  // Map profileId -> discordId and actorId -> character info
  const profMap = (profiles.load && profiles.load().map) || {}
  const pidToDiscord = new Map()
  for (const [discordId, pid] of Object.entries(profMap)) {
    pidToDiscord.set(Number(pid), discordId)
  }

  const byActor = new Map()
  const byProfile = new Map()
  try {
    const forms = siteAuth.internals.readStore()
    for (const { cf, char } of forms) {
      if (!char || char.deleted) continue
      const low = parseInt(String(cf.formDesc || '').split(':')[0], 16)
      const df = siteAuth.internals.dynamicFields(cf)
      const tag = typeof df['private.charTag'] === 'string' ? df['private.charTag'] : ''
      const name = siteAuth.internals.characterName(cf, char.appearance)
      const label = tag ? `${name} #${tag}` : name
      const stampedDiscord = df['private.indexed.discordId'] || pidToDiscord.get(char.profileId) || ''
      if (Number.isFinite(low)) {
        const actorId = String((0xff000000 | low) >>> 0)
        byActor.set(actorId, {
          profileId: char.profileId,
          discordId: stampedDiscord,
          playerName: label,
          cf,
        })
      }
      if (!byProfile.has(char.profileId)) {
        byProfile.set(char.profileId, {
          profileId: char.profileId,
          discordId: stampedDiscord,
          playerName: label,
          cf,
        })
      }
    }
  } catch {
    // Character store unavailable in minimal test environments
  }

  const templates = guildDefs.templates || {}
  const roleCaps = guildDefs.roleCaps || {}
  const requirements = [...base.requirements]
  const assignments = [...base.assignments]
  const reqById = new Map(requirements.map(r => [r.id, r]))

  for (const fac of guildDefs.factions) {
    const fid = fac.id
    const fname = fac.name || fid
    const fkind = fac.kind || 'faction'
    const scope = ['hold', 'stronghold', 'county'].includes(fkind) ? 'hold' : 'faction'
    const ovr = guildOverrides[fid] || {}
    const ranks = ovr.ranks || fac.ranks || templates[fac.template || ''] || []
    const members = (guildsState[fid] && typeof guildsState[fid] === 'object') ? guildsState[fid] : {}

    const rankReqs = []
    for (let idx = 0; idx < ranks.length; idx++) {
      const r = ranks[idx] || {}
      const rtitle = r.title || `Rank ${idx + 1}`
      const rrole = r.role || 'member'
      const cap = Object.hasOwn(roleCaps, rrole) ? roleCaps[rrole] : null
      const slugTitle = slug(rtitle)
      const reqId = `${fid}:${slugTitle}`
      let reqObj = reqById.get(reqId)
      if (!reqObj) {
        reqObj = {
          id: reqId,
          scope,
          group: fname,
          rank: rtitle,
          permission: `${fid}.${slugTitle}`,
          capacity: cap,
          assigned: 0,
          remaining: cap,
        }
        reqById.set(reqId, reqObj)
        requirements.push(reqObj)
      }
      rankReqs.push(reqObj)
    }

    for (const [actorStr, m] of Object.entries(members)) {
      if (!m || typeof m !== 'object') continue
      const mTitle = String(m.title || '')
      const rIdx = Number(m.rank)
      let matchedReq = mTitle
        ? rankReqs.find(rq => rq.rank.toLowerCase() === mTitle.toLowerCase())
        : null
      if (!matchedReq && Number.isInteger(rIdx) && rIdx >= 0 && rIdx < rankReqs.length) {
        matchedReq = rankReqs[rIdx]
      }
      if (!matchedReq && rankReqs.length > 0) {
        matchedReq = rankReqs[rankReqs.length - 1]
      }
      if (!matchedReq) continue

      matchedReq.assigned += 1
      if (matchedReq.capacity !== null) {
        matchedReq.remaining = Math.max(0, matchedReq.capacity - matchedReq.assigned)
      }

      const actorInfo = byActor.get(actorStr)
      const charName = m.name || (actorInfo && actorInfo.playerName) || 'Unnamed'
      const tag = m.tag || ''
      const displayName = (tag && !charName.includes('#')) ? `${charName} #${tag}` : charName
      const discordId = (actorInfo && actorInfo.discordId) || ''
      const profileId = (actorInfo && actorInfo.profileId) || null

      assignments.push({
        id: `live:${fid}:${actorStr}`,
        requirementId: matchedReq.id,
        discordId: discordId || (profileId ? `profile:${profileId}` : `actor:${actorStr}`),
        profileId,
        slot: null,
        playerName: displayName,
        notes: 'In-game guild/hold roster',
        requirement: {
          id: matchedReq.id,
          scope: matchedReq.scope,
          group: matchedReq.group,
          rank: matchedReq.rank,
          permission: matchedReq.permission,
        },
        permission: matchedReq.permission,
        live: true,
      })
    }
  }

  // Also include appointed Hold/County officials from officials.json if not already listed for that profile+group+rank
  const rankTitles = (zones && zones.rankTitles) || {}
  const zoneNameById = new Map()
  for (const listKey of ['holds', 'strongholds', 'regions']) {
    for (const z of (Array.isArray(zones[listKey]) ? zones[listKey] : [])) {
      if (z && z.id) zoneNameById.set(z.id, z.name || z.id)
    }
  }
  for (const [zoneId, table] of Object.entries(officials || {})) {
    if (zoneId.startsWith('_') || !table || typeof table !== 'object') continue
    const groupName = zoneNameById.get(zoneId) || zoneId
    for (const [rankKey, pids] of Object.entries(table)) {
      if (!Array.isArray(pids) || !pids.length) continue
      const rankLabel = rankTitles[rankKey] || rankKey
      const reqId = `official:${zoneId}:${slug(rankKey)}`
      let reqObj = reqById.get(reqId)
      if (!reqObj) {
        reqObj = {
          id: reqId,
          scope: 'hold',
          group: `${groupName} (Office)`,
          rank: rankLabel,
          permission: `official.${zoneId}.${slug(rankKey)}`,
          capacity: ['jarl', 'count', 'chieftain'].includes(rankKey) ? 1 : null,
          assigned: 0,
          remaining: ['jarl', 'count', 'chieftain'].includes(rankKey) ? 1 : null,
        }
        reqById.set(reqId, reqObj)
        requirements.push(reqObj)
      }
      for (const rawPid of pids) {
        const pid = Number(rawPid)
        if (!Number.isFinite(pid)) continue
        reqObj.assigned += 1
        if (reqObj.capacity !== null) {
          reqObj.remaining = Math.max(0, reqObj.capacity - reqObj.assigned)
        }
        const pInfo = byProfile.get(pid)
        const discordId = pidToDiscord.get(pid) || (pInfo && pInfo.discordId) || ''
        assignments.push({
          id: `official:${zoneId}:${rankKey}:${pid}`,
          requirementId: reqObj.id,
          discordId: discordId || `profile:${pid}`,
          profileId: pid,
          slot: null,
          playerName: (pInfo && pInfo.playerName) || `Profile #${pid}`,
          notes: 'Hold/County Official (officials.json)',
          requirement: {
            id: reqObj.id,
            scope: reqObj.scope,
            group: reqObj.group,
            rank: reqObj.rank,
            permission: reqObj.permission,
          },
          permission: reqObj.permission,
          live: true,
        })
      }
    }
  }

  const payload = { requirements, assignments }
  liveCache = { at: now, payload }
  return payload
}

router.get('/', requirePermission('factions.view'), (_req, res) => {
  res.json(buildLiveFactions())
})

router.get('/players/:discordId', requirePermission('factions.view'), (req, res) => {
  const live = buildLiveFactions()
  const discordId = String(req.params.discordId || '').trim()
  const livePlayerAssignments = live.assignments.filter(a => a.discordId === discordId)
  res.json({
    discordId,
    permissions: whitelist.getPlayerFactionPermissions(discordId),
    gameFactions: whitelist.getPlayerGameFactions(discordId),
    assignments: livePlayerAssignments.length ? livePlayerAssignments : whitelist.getPlayerAssignments(discordId),
  })
})

router.post('/assignments', requirePermission('factions.manage'), (req, res) => {
  try {
    liveCache.at = 0
    const assignment = whitelist.createAssignment(req.body || {}, req.session.discordId)
    res.status(201).json(assignment)
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'failed to create assignment' })
  }
})

router.put('/assignments/:id', requirePermission('factions.manage'), (req, res) => {
  try {
    liveCache.at = 0
    res.json(whitelist.updateAssignment(req.params.id, req.body || {}, req.session.discordId))
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'failed to update assignment' })
  }
})

router.delete('/assignments/:id', requirePermission('factions.manage'), (req, res) => {
  try {
    if (String(req.params.id || '').startsWith('live:') || String(req.params.id || '').startsWith('official:')) {
      return res.status(400).json({ error: 'In-game guild/official memberships are managed in-game via /faction or /appoint' })
    }
    liveCache.at = 0
    whitelist.deleteAssignment(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'failed to delete assignment' })
  }
})

router.buildLiveFactions = buildLiveFactions
module.exports = router
