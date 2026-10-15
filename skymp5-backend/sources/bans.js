'use strict'

// data/bans.json: one entry per banned discordId with its ban reference (B-XXXXXX) and a public ip when one is safe to match
// The raw hardware id is never stored or matched (security audit L3-01): sources/deviceChecks.js flags alts to staff instead

const crypto = require('crypto')
const fs     = require('fs')
const net    = require('net')
const path   = require('path')
const { replaceFile } = require('./storeFile')

const FILE    = path.join(__dirname, '..', 'data', 'bans.json')
// The player store beside this one; path.dirname so a test that moves bans.json moves this too
const PLAYERS_FILE = path.join(path.dirname(FILE), 'players.json')
const LOG_DIR = process.env.BAN_LOG_DIR || 'C:\\Users\\Administrator\\Desktop\\logs'

// Ban references staff search and quote: B- and 6 Crockford base32 characters (no I, L, O or U)
const REF_RE = /^B-[0-9A-HJKMNP-TV-Z]{6}$/
const REF_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
// Refs given to old entries in this process, so they stay the same even when the file cannot be saved
const givenRefs = new Map()
let refSaveFailed = false

function newRef(taken) {
  for (;;) {
    const ref = `B-${[...crypto.randomBytes(6)].map(b => REF_CHARS[b & 31]).join('')}`
    if (!taken.has(ref)) return ref
  }
}

// An entry from before refs (or one sharing another's) gets one the first time it is read, saved once
function giveRefs(data) {
  const taken = new Set()
  const missing = []
  for (const e of data) {
    if (!e || typeof e !== 'object') continue
    if (REF_RE.test(String(e.ref || '')) && !taken.has(e.ref)) taken.add(e.ref)
    else missing.push(e)
  }
  if (!missing.length) return data
  for (const e of missing) {
    const key = `${e.discordId}\n${e.bannedAt}`
    e.ref = givenRefs.has(key) && !taken.has(givenRefs.get(key)) ? givenRefs.get(key) : newRef(taken)
    givenRefs.set(key, e.ref)
    taken.add(e.ref)
  }
  // One try per process: every lookup reads the file, and givenRefs keeps the refs stable without the save
  if (!refSaveFailed) {
    try { save(data) } catch (err) {
      console.error('[bans] could not save the new ban references:', err.message)
      refSaveFailed = true
    }
  }
  return data
}

function load() {
  let data
  try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return [] }
  return Array.isArray(data) ? giveRefs(data) : []
}

// Atomic and on disk when it returns (storeFile.replaceFile): a full disk or a crash leaves the old list, never a cut one
function save(data) {
  replaceFile(FILE, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, durable: true })
}

// Every player reaches the game server through the host's port forward, so the address the server reports for all of
// them is one internal one (9 Oct 2026: 146 of 173 players share it). Storing or matching it would make one ban refuse
// everyone, so internal, loopback, link-local and carrier-grade NAT addresses never go into a ban or match one.
// Special-purpose ranges (RFC 6890 and IANA's registries): none of them is one player's own public address
const SPECIAL = new net.BlockList()
for (const [addr, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) {
  SPECIAL.addSubnet(addr, bits, 'ipv4')
}
for (const [addr, bits] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['2001::', 32], ['2002::', 16], ['fc00::', 7],
  ['fe80::', 10], ['ff00::', 8]]) {
  SPECIAL.addSubnet(addr, bits, 'ipv6')
}

// The eight 16-bit groups of an IPv6 address net.isIPv6 accepted (an IPv4 tail counts as the last two)
function ipv6Groups(a) {
  let s = a
  const tail = s.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (tail) {
    const [b0, b1, b2, b3] = tail[1].split('.').map(Number)
    s = s.slice(0, -tail[1].length) + `${((b0 << 8) | b1).toString(16)}:${((b2 << 8) | b3).toString(16)}`
  }
  const [head, rest] = s.split('::')
  const left = head ? head.split(':') : []
  const right = rest === undefined ? [] : (rest ? rest.split(':') : [])
  const fill = rest === undefined ? [] : new Array(8 - left.length - right.length).fill('0')
  return [...left, ...fill, ...right].map(g => parseInt(g, 16))
}

// One canonical form, or '' when it is not an address: brackets, a %zone, a trailing dot and an IPv4 :port go, and
// an IPv4-mapped or -compatible IPv6 address (::ffff:a.b.c.d or its hex and long forms) becomes the IPv4 address
function normalizeIp(ip) {
  let a = String(ip || '').trim().toLowerCase()
  const bracketed = a.match(/^\[([^\]]*)\](?::\d{1,5})?$/)
  if (bracketed) a = bracketed[1]
  a = a.replace(/%[^%]*$/, '').replace(/\.$/, '')
  const withPort = a.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/)
  if (withPort) a = withPort[1]
  if (net.isIPv6(a)) {
    const g = ipv6Groups(a)
    const mapped = g.slice(0, 5).every(x => x === 0) && (g[5] === 0xffff || (g[5] === 0 && (g[6] !== 0 || g[7] > 1)))
    const translated = g.slice(0, 4).every(x => x === 0) && g[4] === 0xffff && g[5] === 0
    if (mapped || translated) a = [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.')
  }
  return net.isIP(a) ? a : ''
}

function isInternalIp(ip) {
  const a = normalizeIp(ip)
  return !!a && SPECIAL.check(a, net.isIPv4(a) ? 'ipv4' : 'ipv6')
}

// An address on this many player records is a relay or a shared connection, not one player's
const SHARED_MIN = 3
const NO_SHARED = new Set()
let sharedCache = { key: null, shared: NO_SHARED }

// The public addresses that are the lastIp of SHARED_MIN or more players (players.json, re-read when it changes).
// No file: none. A file that cannot be read or is not a player store: null, and no address is used at all
function sharedAddresses() {
  let st
  try { st = fs.statSync(PLAYERS_FILE) } catch (err) { return err.code === 'ENOENT' ? NO_SHARED : null }
  const key = `${st.ino}:${st.mtimeMs}:${st.size}`
  if (sharedCache.key === key) return sharedCache.shared
  let shared = null
  try {
    const data = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'))
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const counts = new Map()
      for (const record of Object.values(data)) {
        const a = normalizeIp(record && record.lastIp)
        if (a) counts.set(a, (counts.get(a) || 0) + 1)
      }
      shared = new Set([...counts].filter(([, n]) => n >= SHARED_MIN).map(([a]) => a))
    }
  } catch { shared = null }
  sharedCache = { key, shared }
  return shared
}

// The address in canonical form when one player's ban may hold or match it, else ''
const publicIp = (ip) => {
  const a = normalizeIp(ip)
  if (!a || isInternalIp(a)) return ''
  const shared = sharedAddresses()
  return shared && !shared.has(a) ? a : ''
}

function list() {
  return load()
}

// Returns the first entry matching the Discord id or a usable public ip (empty/null ones are ignored), or null; an hwid is never matched
function isBanned({ discordId, ip } = {}) {
  const id   = String(discordId || '').trim()
  const addr = publicIp(ip)
  if (!id && !addr) return null
  return load().find(entry =>
    (id && entry.discordId && String(entry.discordId) === id) ||
    (addr && publicIp(entry.ip) === addr)
  ) || null
}

// Adds a ban entry; an existing entry for the same discordId is replaced and keeps its ref
function add(input) {
  const discordId = String((input && input.discordId) || '').trim()
  if (!discordId) throw new Error('discordId is required')
  const all = load()
  const old = all.find(e => String(e.discordId) === discordId)
  const data = all.filter(e => String(e.discordId) !== discordId)
  const entry = {
    discordId,
    ref: old && REF_RE.test(String(old.ref || '')) ? old.ref : newRef(new Set(data.map(e => e && e.ref))),
    hwid: null,
    ip: publicIp(input.ip) || null,
    reason: String(input.reason || ''),
    bannedAt: input.bannedAt || new Date().toISOString(),
    bannedBy: input.bannedBy || null,
  }
  data.push(entry)
  save(data)
  return entry
}

function removeByDiscordId(discordId) {
  const id = String(discordId || '').trim()
  const data = load()
  const next = data.filter(e => String(e.discordId) !== id)
  if (next.length === data.length) return false
  save(next)
  return true
}

// Appends a timestamped line to ban.log; logging failures must never break the ban flow
function logBan(line) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    fs.appendFileSync(path.join(LOG_DIR, 'ban.log'), `${new Date().toISOString()} ${line}\n`)
  } catch (e) {
    console.error('[bans] failed to write ban.log:', e.message)
  }
}

module.exports = {
  FILE,
  REF_RE,
  isInternalIp,
  list,
  isBanned,
  add,
  removeByDiscordId,
  logBan,
}
