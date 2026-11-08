'use strict'
// The dev server option (Lead GM and above): the launcher restarts itself with --dev-server into its own settings folder and
// its own install folder, so nothing it does reaches the live install. The backend signs a ticket per launch
// (skymp5-backend routes/dev-server.js); the relay's file server serves dev's manifest and files against that ticket.

const path = require('path')

const DEV_FLAG = '--dev-server'
const VANILLA = new Set(['skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm'])

// Copied from the live launcher's settings on a switch: who the player is, where vanilla Skyrim is, the Nexus login
const HANDOFF_KEYS = ['skyrimPath', 'discordUser', 'gameSession', 'gameProfileId', 'nexusApiKey', 'nexusOauth', 'nexusUser', 'archiveDir', 'mo2Enabled']

const isDevMode = argv => (argv || []).includes(DEV_FLAG)
const devUserDataDir = liveDir => `${String(liveDir).replace(/[\\/]+$/, '')} (Dev)`
const devBaseDir = liveBase => `${String(liveBase).replace(/[\\/]+$/, '')}-Dev`

function relaunchArgs(argv, toDev) {
  const args = (argv || []).filter(a => a !== DEV_FLAG)
  return toDev ? [...args, DEV_FLAG] : args
}

// Same, or one inside the other; case-insensitive as on Windows
function overlaps(a, b) {
  if (!a || !b) return false
  const norm = p => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase() + path.sep
  const na = norm(a), nb = norm(b)
  return na.startsWith(nb) || nb.startsWith(na)
}

function handoffFrom(get, liveBaseDir) {
  const out = { liveBaseDir: String(liveBaseDir || '') }
  for (const k of HANDOFF_KEYS) { const v = get(k); if (v !== undefined && v !== null && v !== '') out[k] = v }
  return out
}

// Applies a handoff to the dev settings; the dev install folder is derived from the live one, never the live one itself
function applyHandoff(set, get, handoff, defaultLiveBase) {
  for (const k of HANDOFF_KEYS) if (k in handoff) set(k, handoff[k])
  const liveBase = handoff.liveBaseDir || defaultLiveBase
  set('liveBaseDir', liveBase)
  if (!get('baseDirPath') || overlaps(get('baseDirPath'), liveBase)) set('baseDirPath', devBaseDir(liveBase))
  set('isolatedGame', true)
}

const safeRel = p => typeof p === 'string' && p.length > 0 && p.length < 400 && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) &&
  !p.split('/').some(s => s === '' || s === '.' || s === '..') && !/[\\\0]/.test(p)

function validateManifest(m) {
  if (!m || typeof m !== 'object') return 'the dev file list is empty'
  if (typeof m.version !== 'string' || !m.version) return 'the dev file list has no version'
  if (!Array.isArray(m.loadOrder) || m.loadOrder.length === 0 || !m.loadOrder.every(n => typeof n === 'string' && safeRel(n))) return 'the dev file list has no load order'
  if (!Array.isArray(m.files)) return 'the dev file list has no files'
  for (const f of m.files) {
    if (!f || !safeRel(f.path) || !/^[0-9a-f]{64}$/i.test(String(f.sha256)) || !Number.isSafeInteger(f.size) || f.size < 0) return `a dev file entry is malformed: ${f && f.path}`
    if (f.url !== undefined && !/^https:\/\//i.test(String(f.url))) return `a dev file is not on https: ${f.path}`
  }
  if (m.install !== undefined) {
    const i = m.install
    if (!i || !Array.isArray(i.mods) || !Array.isArray(i.archives)) return 'the dev mod list is malformed'
    if (i.order !== undefined && !Array.isArray(i.order)) return 'the dev mod order is malformed'
  }
  return null
}

// What the launcher's serverinfo consumers read (load order, online login), for the dev server behind the relay
function serverInfoFrom(manifest, server) {
  return {
    name: server.name, host: server.address, port: server.port, loadOrder: manifest.loadOrder.slice(),
    offlineMode: false, masterKey: null, masterUrl: '', locked: false, sessionValid: true, allowed: true, dev: true,
  }
}

const pluginLines = loadOrder => loadOrder.map(f => path.basename(f)).filter(f => !VANILLA.has(f.toLowerCase())).map(f => `*${f}`)

// Live's install manifest plus dev's own mods (dev wins a name or archive id); dev's order when it sends one, else its new
// mods at the end, which is lowest priority in MO2 (order[0] wins), right for mods that overlap nothing
function mergeInstallManifest(live, dev, loadOrder) {
  const out = { ...live }
  if (dev) {
    const devNames = new Set(dev.mods.map(m => m.name))
    const devIds = new Set(dev.archives.map(a => a.id))
    out.mods = [...live.mods.filter(m => !devNames.has(m.name)), ...dev.mods]
    out.archives = [...live.archives.filter(a => !devIds.has(a.id)), ...dev.archives]
    const liveOrder = Array.isArray(live.order) && live.order.length ? live.order : live.mods.map(m => m.name)
    out.order = Array.isArray(dev.order) && dev.order.length ? dev.order.slice() : [...liveOrder.filter(n => !devNames.has(n)), ...dev.mods.map(m => m.name)]
  }
  out.plugins = pluginLines(loadOrder)
  return out
}

const asExtraManifest = m => ({ version: `dev-${m.version}`, files: m.files.map(f => ({ path: f.path, size: f.size, sha256: f.sha256.toLowerCase(), ...(f.url ? { url: f.url } : {}) })) })

// The client settings for the dev server: the relay, no master, no serverinfo lookup, and no profileId, so the client sends
// the ticket from auth-data-no-load.js as its session
function devClientSettings(kept, server) {
  return { ...kept, 'server-ip': server.address, 'server-port': Number(server.port), master: '', 'server-master-key': null, 'server-info-ignore': true }
}

const devAuthData = (ticket, user, profileId) => '//' + JSON.stringify({
  session: ticket,
  masterApiId: profileId,
  discordUsername: (user && (user.username || user.tag)) || null,
  discordDiscriminator: null,
  discordAvatar: (user && user.avatar) || null,
})

// A ticket is reused until 30 minutes before it runs out
const ticketFresh = (t, now = Date.now()) => !!(t && typeof t.ticket === 'string' && Number(t.expiresAt) - now > 30 * 60 * 1000)

// The ticket goes only to the dev files host, never to a redirect target or anyone else
function authHeadersFor(url, filesUrl, ticket) {
  if (!filesUrl || !ticket) return {}
  try { return new URL(url).origin === new URL(filesUrl).origin ? { authorization: `DevTicket ${ticket}` } : {} } catch { return {} }
}

module.exports = {
  DEV_FLAG, HANDOFF_KEYS, isDevMode, devUserDataDir, devBaseDir, relaunchArgs, overlaps, handoffFrom, applyHandoff,
  validateManifest, serverInfoFrom, mergeInstallManifest, asExtraManifest, devClientSettings, devAuthData, ticketFresh,
  authHeadersFor, pluginLines,
}
