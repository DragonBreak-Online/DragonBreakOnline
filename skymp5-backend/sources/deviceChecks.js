'use strict'
// Report-only ban check on PCs (security audit L3-01, docs/ban_device_check.md). The launcher sends launch-check a
// one-way code made from the Windows machine id; only a keyed HMAC of it is kept, in data/device-ids.json (0600). A PC
// linked to a banned account is a lead posted to the staff audit channel, never a refusal: the code comes from the
// player's own PC and a modified launcher can send anything, so it never allows, clears or blocks anything.
// Requiring this module does nothing; the first call reads the config and starts its timers.

const crypto = require('crypto')
const fs     = require('fs')
const path   = require('path')
const { readStore, replaceFile, isPlainObject } = require('./storeFile')

const DAY_MS = 24 * 60 * 60 * 1000
const DEVICE_RE = /^v1\.([0-9a-f]{64})$/
const BAN_REF_RE = /^B-[0-9A-HJKMNP-TV-Z]{6}$/
// New PCs one account may add in a day, and PCs it may hold; past either the new one is dropped, nothing is evicted
const NEW_PER_DAY = 3
const MAX_DEVICES = 5
// A flag is posted once per account and kind (and ban) in this many days; co-users count when seen in this many days
const FLAG_DAYS = 30
const RECENT_DAYS = 30
const MAX_LINKS = 5
// Session bindings (sha256 of the token -> code), in memory only; dropped after a day and a bit without use
const BINDING_IDLE_MS = 26 * 60 * 60 * 1000
const MAX_BINDINGS = 20000
const PRUNE_MS = 60 * 60 * 1000
const SWEEP_MS = 5 * 60 * 1000
const DISCORD_EPOCH = 1420070400000n
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const RECOVERY = 'The device check is off until the backend restarts with a readable file. It holds nothing that must ' +
  'be kept: with the backend stopped, delete it and its .tmp files (a privacy erase: never move it aside or archive ' +
  'it), and it rebuilds as players launch (docs/ban_device_check.md, Undo, Unreadable store)'

const paths = { store: path.join(__dirname, '..', 'data', 'device-ids.json') }
const hooks = { now: () => Date.now(), audit: null, log: null, config: null, bans: null, players: null, who: null }

let state = null

const zeroCounts = () => ({ withDevice: 0, unavailable: 0, none: 0, malformed: 0, sessionChanges: 0, capDrops: 0,
  flags: { alt: 0, new: 0, back: 0, churn: 0 }, notAlt: 0, legacyHwid: 0 })

const log = line => (hooks.log ? hooks.log(line) : console.log(line))

// What every call needs; reads no config and starts nothing, so the erase script can use it
function base() {
  if (!state) state = { started: false, key: null, mode: 'off', retentionDays: 30, newAccountDays: 30, broken: null,
    cache: null, bindings: new Map(), counts: zeroCounts(), bansSig: null, writeErrorAt: 0, timers: [] }
  return state
}

function init() {
  const s = base()
  if (s.started) return s
  s.started = true
  const c = hooks.config || require('../config')
  const keyHex = String(c.deviceIdHmacKey || '').trim()
  const keyOk = /^(?:[0-9a-f]{2}){32,}$/i.test(keyHex)
  s.key = keyOk ? Buffer.from(keyHex, 'hex') : null
  s.mode = c.deviceMatch === 'off' ? 'off' : 'report'
  s.retentionDays = Number.isInteger(c.deviceRetentionDays) ? c.deviceRetentionDays : 30
  s.newAccountDays = Number.isInteger(c.newAccountFlagDays) ? c.newAccountFlagDays : 30
  if (!keyHex) log('[device-check] DEVICE_ID_HMAC_KEY is not set: the device check is off and nothing is stored')
  else if (!keyOk) log('[device-check] DEVICE_ID_HMAC_KEY is not 64 or more hex characters: the device check is off and nothing is stored')
  else if (s.mode === 'off') log('[device-check] DEVICE_MATCH=off: no device codes are collected and nothing is flagged')
  else {
    if (c.deviceMatch === 'enforce') log('[device-check] DEVICE_MATCH=enforce is not available yet; reporting only')
    log(`[device-check] on, report only: PCs linked to a banned account are flagged to staff; codes are kept ${s.retentionDays} days after last use`)
  }
  s.timers = [setInterval(hourly, PRUNE_MS), setInterval(sweepIfBansChanged, SWEEP_MS)]
  for (const t of s.timers) t.unref()
  return s
}

const enabled = () => !!(state && state.key && state.mode !== 'off' && !state.broken)

const dayOf = ms => new Date(ms).toISOString().slice(0, 10)
const today = () => dayOf(hooks.now())
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS)
const flagDue = (acct, key, day) => !acct.flags[key] || daysBetween(acct.flags[key], day) >= FLAG_DAYS
const days = n => (n === 0 ? 'less than a day' : n === 1 ? '1 day' : `${n} days`)
const shortDate = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? 'on an unknown day' : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` }
const tokenKey = token => crypto.createHash('sha256').update(token).digest('hex')

// The stored key for a launcher code: the first 32 hex of an HMAC with the server's secret, meaningless anywhere else
const codeOf = hex => crypto.createHmac('sha256', state.key).update(`device:v1:${hex}`).digest('hex').slice(0, 32)

function problemOf(value) {
  if (!isPlainObject(value) || value.v !== 1 || !isPlainObject(value.accounts)) return 'is not a device check store'
  if (!Object.values(value.accounts).every(a => isPlainObject(a) && Array.isArray(a.d))) return 'has an account entry that is not one'
  return null
}

function buildIndex(data) {
  const index = new Map()
  for (const [id, acct] of Object.entries(data.accounts)) {
    for (const dev of acct.d) {
      if (!index.has(dev.h)) index.set(dev.h, new Set())
      index.get(dev.h).add(id)
    }
  }
  return index
}

const fileKey = st => `${st.ino}:${st.mtimeMs}:${st.size}`

// The store, read through on every operation (cached until the file changes); null once it could not be read
function readData() {
  const s = base()
  if (s.broken) return null
  let st = null
  try { st = fs.statSync(paths.store) } catch (err) {
    if (err.code !== 'ENOENT') {
      s.broken = err
      console.error(`[device-check] ${paths.store} cannot be read (${err.code || err.message}). ${RECOVERY}`)
      return null
    }
  }
  const key = st ? fileKey(st) : 'none'
  if (s.cache && s.cache.key === key) return s.cache.data
  let data
  try { data = readStore(paths.store, problemOf, RECOVERY) || { v: 1, accounts: {} } }
  catch (err) { s.broken = err; s.cache = null; return null }
  for (const acct of Object.values(data.accounts)) {
    if (!isPlainObject(acct.notAlt)) acct.notAlt = {}
    if (!isPlainObject(acct.flags)) acct.flags = {}
  }
  s.cache = { key, data, index: buildIndex(data) }
  return data
}

function writeData(data) {
  const s = base()
  try {
    replaceFile(paths.store, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
    s.cache = { key: fileKey(fs.statSync(paths.store)), data, index: buildIndex(data) }
    return true
  } catch (err) {
    s.cache = null
    if (hooks.now() - s.writeErrorAt > PRUNE_MS) console.error(`[device-check] could not save ${paths.store}: ${err.code || err.message}`)
    s.writeErrorAt = hooks.now()
    return false
  }
}

const indexOf = h => (state.cache && state.cache.index.get(h)) || new Set()

// Discord id -> its bans.json entry with a ref; null when bans.json exists but cannot be read
function bansNow() {
  let list
  if (hooks.bans) list = hooks.bans()
  else {
    const bans = require('./bans')
    try { if (!Array.isArray(JSON.parse(fs.readFileSync(bans.FILE, 'utf8')))) return null }
    catch (err) { if (err.code !== 'ENOENT') return null }
    list = bans.list()
  }
  const byId = new Map()
  for (const e of list) if (e && e.discordId && BAN_REF_RE.test(String(e.ref || ''))) byId.set(String(e.discordId), e)
  return byId
}

// The players.json record, null when there is none, undefined when the store cannot be read
function playerRecord(discordId) {
  try { return (hooks.players ? hooks.players() : require('./players').load())[discordId] || null }
  catch { return undefined }
}

// One line of at most 40 characters, with no run of digits or hex long enough to pass for an id or a code
const cleanName = text => String(text || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  .replace(/\d{5,}|[0-9a-f]{12,}/gi, '…').slice(0, 40)

// A player as staff know them: up to 3 of their characters by name and #TAG, never an id, profile number or code
function who(discordId) {
  if (hooks.who) return hooks.who(discordId)
  try {
    const profileId = require('./profiles').load().map[discordId]
    const { readStore: readCharacters, ownedBy, dynamicFields, characterName } = require('../routes/site-auth').internals
    const names = []
    if (Number.isInteger(profileId)) {
      for (const { cf, char } of readCharacters()) {
        if (char.profileId !== profileId || char.deleted || !ownedBy(cf, discordId)) continue
        const tag = dynamicFields(cf)['private.charTag']
        names.push(`${cleanName(characterName(cf, char.appearance)) || 'Unnamed'}${typeof tag === 'string' && /^[A-Z0-9]{4}$/.test(tag) ? ` #${tag}` : ''}`)
      }
    }
    if (!names.length) return 'a player with no character yet'
    return names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ')
  } catch {
    return 'a player whose characters could not be read'
  }
}

function post(kind, text) {
  state.counts.flags[kind]++
  try { (hooks.audit || require('./discord/audit').log)(text) }
  catch (err) { console.error('[device-check] audit line not posted:', err.message) }
}

// Whole days since the Discord account was made, read from the id itself; null for an id that is not a Discord id
function discordAgeDays(discordId) {
  const id = String(discordId || '')
  if (!/^\d{17,20}$/.test(id)) return null
  const created = Number((BigInt(id) >> 22n) + DISCORD_EPOCH)
  const now = hooks.now()
  if (created < Date.UTC(2015, 0, 1) || created > now) return null
  return Math.floor((now - created) / DAY_MS)
}

// Days from the ban to the account's first sign-in here: 0 or more after it, below 0 before it; null when unknown
function createdVsBanDays(record, ban) {
  const diff = Date.parse(record && record.createdAt) - Date.parse(ban.bannedAt)
  if (!Number.isFinite(diff)) return null
  return diff >= 0 ? Math.floor(diff / DAY_MS) : -Math.ceil(-diff / DAY_MS)
}

// Other accounts, not banned and not these, seen on the PC in the last RECENT_DAYS days
function sharedCount(data, h, notIds, bansById, day) {
  let n = 0
  for (const id of indexOf(h)) {
    if (notIds.includes(id) || bansById.has(id)) continue
    const dev = data.accounts[id].d.find(x => x.h === h)
    if (dev && daysBetween(dev.last, day) < RECENT_DAYS) n++
  }
  return n
}

// ALT CHECK for account c on a PC banned account b used, once per pair per FLAG_DAYS days, unless staff said not an alt
function altCheck(data, c, ban, b, h, bansById, day) {
  const acct = data.accounts[c]
  const flag = `alt:${ban.ref}`
  if (acct.notAlt[ban.ref] || !flagDue(acct, flag, day)) return false
  acct.flags[flag] = day
  const mine = acct.d.find(x => x.h === h)
  const theirs = data.accounts[b] && data.accounts[b].d.find(x => x.h === h)
  const vsBan = createdVsBanDays(playerRecord(c), ban)
  const age = discordAgeDays(c)
  const shared = sharedCount(data, h, [c, b], bansById, day)
  const parts = [`ALT CHECK (report only) ${who(c)}: plays on a PC linked to banned account ${who(b)} (ban ${ban.ref}, banned ${shortDate(ban.bannedAt)}).`]
  if (vsBan !== null) parts.push(vsBan >= 0 ? `First seen here ${vsBan === 0 ? 'on the day of' : `${days(vsBan)} after`} the ban.` : `Account existed ${days(-vsBan)} before the ban.`)
  if (age !== null) parts.push(`Discord account ${days(age)} old.`)
  if (shared >= 2) parts.push(`Shared PC: ${shared} other active accounts.`)
  else if (shared === 1) parts.push('1 other active account also plays on this PC.')
  parts.push(mine && mine.bound && theirs && theirs.bound ? 'PC-bound launcher login.' : 'Older launcher login, so this could be someone else\'s PC.')
  parts.push(`A lead, not proof. Not an alt? Dashboard, search ${ban.ref}, Not an alt.`)
  post('alt', parts.join(' '))
  return true
}

// The checks a recorded PC triggers: an account on a banned account's PC, or a banned account on new or shared PCs
function matchDevice(data, id, h, isNew, bansById, day) {
  let dirty = false
  const ban = bansById.get(id)
  for (const other of indexOf(h)) {
    if (other === id) continue
    const otherBan = bansById.get(other)
    if (!ban && otherBan) dirty = altCheck(data, id, otherBan, other, h, bansById, day) || dirty
    else if (ban && !otherBan) dirty = altCheck(data, other, ban, id, h, bansById, day) || dirty
  }
  const acct = data.accounts[id]
  if (ban && isNew && flagDue(acct, `back:${ban.ref}`, day)) {
    acct.flags[`back:${ban.ref}`] = day
    post('back', `BANNED ACCOUNT BACK ${who(id)} (ban ${ban.ref}): played again from a PC not seen before; that PC is now on the ban.`)
    dirty = true
  }
  return dirty
}

function recordDevice(data, id, h, bound, bansById, day) {
  const acct = data.accounts[id]
  const dev = acct.d.find(x => x.h === h)
  if (dev) {
    let dirty = false
    if (dev.last !== day) { dev.last = day; dirty = true }
    if (bound && !dev.bound) { dev.bound = true; dirty = true }
    return (bansById ? matchDevice(data, id, h, false, bansById, day) : false) || dirty
  }
  const addedToday = acct.d.filter(x => x.first === day).length
  if (addedToday >= NEW_PER_DAY || acct.d.length >= MAX_DEVICES) {
    state.counts.capDrops++
    if (!flagDue(acct, 'churn', day)) return false
    acct.flags.churn = day
    const what = addedToday >= NEW_PER_DAY ? `more than ${NEW_PER_DAY} new PCs in one day` : `more than ${MAX_DEVICES} PCs on record`
    post('churn', `DEVICE CHURN ${who(id)}: ${what}; the extra ones were not recorded (a modified launcher is one possible cause).`)
    return true
  }
  acct.d.push({ h, first: day, last: day, bound: !!bound })
  if (!state.cache.index.has(h)) state.cache.index.set(h, new Set())
  state.cache.index.get(h).add(id)
  if (bansById) matchDevice(data, id, h, true, bansById, day)
  return true
}

// NEW ACCOUNT, once, when the account is first seen and has never joined the game; needs no device code. The age comes
// first: it needs no file, and a launch without a code runs this every time until it is flagged
function newAccountCheck(id, acct, bansById, day) {
  if (!state.newAccountDays || !bansById || bansById.has(id)) return false
  const age = discordAgeDays(id)
  if (age === null || age >= state.newAccountDays) return false
  const record = playerRecord(id)
  if (record === undefined || (record && record.lastGameJoinAt)) return false
  acct.flags.new = day
  post('new', `NEW ACCOUNT ${who(id)}: Discord account ${days(age)} old at first launch.`)
  return true
}

// One code per session: a different one later on the same session is ignored
function bindSession(token, h) {
  const k = tokenKey(token)
  const had = state.bindings.get(k)
  if (had && had.h !== h) {
    state.counts.sessionChanges++
    had.at = hooks.now()
    return false
  }
  state.bindings.delete(k)
  state.bindings.set(k, { h, at: hooks.now() })
  while (state.bindings.size > MAX_BINDINGS) state.bindings.delete(state.bindings.keys().next().value)
  return true
}

// POST /api/launch-check, after the answer was sent: { device: 'v1.<64 hex>' } or { deviceStatus: 'unavailable' }, or neither (older launchers)
function onLaunchCheck(token, entry, body) {
  const s = init()
  const raw = body && typeof body === 'object' ? body.device : undefined
  let hex = null
  if (raw === undefined || raw === null) {
    if (body && body.deviceStatus === 'unavailable') s.counts.unavailable++
    else s.counts.none++
  } else {
    const m = typeof raw === 'string' ? raw.match(DEVICE_RE) : null
    if (m) { hex = m[1]; s.counts.withDevice++ } else s.counts.malformed++
  }
  if (!enabled() || typeof token !== 'string' || !token || !entry || !entry.discordId) return
  const data = readData()
  if (!data) return
  const id = String(entry.discordId)
  const bansById = bansNow()
  const day = today()
  let dirty = false
  let acct = data.accounts[id]
  // A launch without a code stores nothing, unless it is a new account's first and is flagged
  if (!acct) {
    const fresh = { first: day, last: day, d: [], notAlt: {}, flags: {} }
    if (newAccountCheck(id, fresh, bansById, day) || hex) { acct = data.accounts[id] = fresh; dirty = true }
  }
  if (hex) {
    if (acct.last !== day) { acct.last = day; dirty = true }
    const h = codeOf(hex)
    const bound = entry.flow === 'loopback' || entry.flow === 'device'
    if (bindSession(token, h)) dirty = recordDevice(data, id, h, bound, bansById, day) || dirty
  }
  if (dirty) writeData(data)
}

// After a ban: every account on a PC a banned account used is checked, as when it launches
function sweep() {
  if (!enabled()) return
  const data = readData()
  const bansById = data && bansNow()
  if (!bansById) return
  const day = today()
  let dirty = false
  for (const [b, ban] of bansById) {
    const acct = data.accounts[b]
    if (!acct) continue
    for (const { h } of acct.d) {
      for (const c of indexOf(h)) if (c !== b && !bansById.has(c)) dirty = altCheck(data, c, ban, b, h, bansById, day) || dirty
    }
  }
  if (dirty) writeData(data)
}

function sweepIfBansChanged() {
  if (!enabled()) return
  const bansById = bansNow()
  if (!bansById) return
  const sig = JSON.stringify([...bansById.values()].map(e => [e.discordId, e.ref, e.bannedAt]))
  if (sig === state.bansSig) return
  state.bansSig = sig
  sweep()
}

// Retention: a PC 30 days (DEVICE_RETENTION_DAYS) after its last day, kept while its account is banned; flags after
// FLAG_DAYS; a not-an-alt mark once its ban is gone; an account with no PCs 30 days after its last day unless banned
function prune() {
  const s = base()
  const cutoff = hooks.now() - BINDING_IDLE_MS
  for (const [k, b] of s.bindings) if (b.at < cutoff) s.bindings.delete(k)
  const data = readData()
  const bansById = data && bansNow()
  if (!bansById) return
  const refs = new Set([...bansById.values()].map(e => e.ref))
  const day = today()
  let dirty = false
  for (const [id, acct] of Object.entries(data.accounts)) {
    const banned = bansById.has(id)
    if (!banned) {
      const kept = acct.d.filter(dev => daysBetween(dev.last, day) < s.retentionDays)
      if (kept.length !== acct.d.length) { acct.d = kept; dirty = true }
    }
    for (const [flag, at] of Object.entries(acct.flags)) if (daysBetween(at, day) >= FLAG_DAYS) { delete acct.flags[flag]; dirty = true }
    for (const ref of Object.keys(acct.notAlt)) if (!refs.has(ref)) { delete acct.notAlt[ref]; dirty = true }
    if (!banned && !acct.d.length && daysBetween(acct.last, day) >= s.retentionDays) { delete data.accounts[id]; dirty = true }
  }
  if (dirty) writeData(data)
}

const anyCount = c => Object.values(c).some(v => (typeof v === 'object' ? anyCount(v) : v > 0))

// The last hour's counts, only when there are some, ending with the UTC minute; a restart loses at most that hour
function logCounts() {
  const c = state.counts
  if (!anyCount(c)) return
  log(`[device-check] last hour: launch-checks with a device code ${c.withDevice}, unavailable ${c.unavailable}, none (older launcher) ${c.none}; ` +
    `malformed ${c.malformed}; session changes ${c.sessionChanges}; cap drops ${c.capDrops}; flags: alt check ${c.flags.alt}, ` +
    `new account ${c.flags.new}, banned account back ${c.flags.back}, churn ${c.flags.churn}; not-alt marks ${c.notAlt}; legacy hwid discarded ${c.legacyHwid}; ` +
    `until ${new Date(hooks.now()).toISOString().slice(0, 16)}Z`)
  state.counts = zeroCounts()
}

function hourly() {
  logCounts()
  prune()
}

// Every banned account this account shares a PC with, without codes: { banRef, notAlt, sharedAccounts, bound, createdVsBanDays }
function linksOf(data, id, bansById, record, limit) {
  const acct = data.accounts[id]
  const links = []
  if (!acct) return links
  const day = today()
  const seen = new Set()
  for (const dev of acct.d) {
    for (const b of indexOf(dev.h)) {
      const ban = b !== id && bansById.get(b)
      if (!ban || seen.has(ban.ref)) continue
      seen.add(ban.ref)
      const theirs = data.accounts[b].d.find(x => x.h === dev.h)
      links.push({
        banRef: ban.ref,
        notAlt: !!acct.notAlt[ban.ref],
        sharedAccounts: sharedCount(data, dev.h, [id, b], bansById, day),
        bound: !!(dev.bound && theirs && theirs.bound),
        createdVsBanDays: createdVsBanDays(record, ban),
      })
      if (links.length >= limit) return links
    }
  }
  return links
}

// For the dashboard; record is the players.json row when the caller has it
function statusFor(discordId, record) {
  const s = init()
  if (!s.key) return { links: [] }
  const data = readData()
  const bansById = data && bansNow()
  if (!bansById) return { links: [] }
  const id = String(discordId)
  return { links: linksOf(data, id, bansById, record === undefined ? playerRecord(id) : record, MAX_LINKS) }
}

// Staff: this account is not an alt of that ban (notAlt true), or take the mark back; { ok, changed } or { ok: false, error }
function setNotAlt(discordId, banRef, notAlt, staffName) {
  const s = init()
  if (!BAN_REF_RE.test(String(banRef || ''))) return { ok: false, error: 'invalidBanRef' }
  const data = s.key ? readData() : null
  const bansById = data && bansNow()
  if (!bansById) return { ok: false, error: 'deviceCheckUnavailable' }
  const id = String(discordId)
  if (!linksOf(data, id, bansById, null, Infinity).some(l => l.banRef === banRef)) return { ok: false, error: 'noSuchLink' }
  const acct = data.accounts[id]
  if (!!acct.notAlt[banRef] === !!notAlt) return { ok: true, changed: false }
  const by = cleanName(staffName) || 'a staff member'
  if (notAlt) acct.notAlt[banRef] = { by, at: today() }
  else delete acct.notAlt[banRef]
  if (!writeData(data)) return { ok: false, error: 'notSaved' }
  s.counts.notAlt++
  const line = `NOT AN ALT ${who(id)} for ban ${banRef}, ${notAlt ? 'marked' : 'mark removed'} by ${by}.`
  try { (hooks.audit || require('./discord/audit').log)(line) }
  catch (err) { console.error('[device-check] audit line not posted:', err.message) }
  return { ok: true, changed: true }
}

// Erase: 'removed', 'nothing' or 'kept-banned' (privacy policy: ban enforcement is kept); throws when it cannot tell
function forgetAccount(discordId) {
  base()
  const data = readData()
  if (!data) throw new Error(`${paths.store} cannot be read`)
  const id = String(discordId || '')
  if (!data.accounts[id]) return 'nothing'
  const bansById = bansNow()
  if (!bansById) throw new Error('bans.json cannot be read, so a ban cannot be ruled out')
  if (bansById.has(id)) return 'kept-banned'
  delete data.accounts[id]
  if (!writeData(data)) throw new Error(`${paths.store} could not be saved`)
  return 'removed'
}

// The old raw-hwid routes discard what they get; counted for the hourly line
function legacyHwidDiscarded() {
  init().counts.legacyHwid++
}

// At backend start: retention and the sweep run once, then on their timers
function start() {
  init()
  prune()
  sweepIfBansChanged()
}

module.exports = {
  BAN_REF_RE,
  start,
  onLaunchCheck,
  legacyHwidDiscarded,
  statusFor,
  setNotAlt,
  forgetAccount,
  discordAgeDays,
  // Tests: a fake clock, audit sink, log, config, ban list, player store, names and store path; reset drops all state
  _test: {
    use(opts) {
      for (const k of Object.keys(hooks)) if (k in opts) hooks[k] = opts[k]
      if (opts.store) paths.store = opts.store
    },
    reset() {
      if (state) for (const t of state.timers) clearInterval(t)
      state = null
    },
    prune: () => prune(),
    sweep: () => sweepIfBansChanged(),
    logCounts: () => logCounts(),
    state: () => state,
  },
}
