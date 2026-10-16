'use strict'
// Referral links (Nate, 16 Oct 2026: "Go for it"; spec in the server branch's docs/referrals.md). The backend's part is
// small: it remembers which referral code a browser arrived with and, when that browser's Discord login creates a
// brand-new account, writes one line to data/referrals.jsonl. The gameplay (server branch referrals.js) reads that file,
// owns the codes, counts play time, decides whether a referral qualifies and grants every reward. The backend never
// decides a reward.
//
// Switched by REFERRAL_LINKS=on (off by default): off, the link only redirects to the website and the login hooks
// return at once, so the undo is one environment value.
//
//   GET /api/users/login-discord/join/<code> (and /api/join/<code>)   the shared link: sets the dbo_ref cookie (30 days,
//                              sent only to the login path) on a top-level navigation, then redirects to the website.
//                              Nothing about the visitor (address, browser) is recorded.
//   GET /api/users/login-discord?state=<s>   routes/skymp-compat.js calls noteLogin after its rate limit and only for an
//                              issued, live state (or a registered old-launcher state): the cookie's code is noted
//                              against sha256(state), never the state itself (as launcherLogins.js keeps it)
//   the login's result (POST token / poll, GET status): compat calls deliver once it has made the session; when the
//                              profile was created during that very login, the binding is written. An account that
//                              existed before is never bound.
//
// data/referral-pending.json (0600): sha256(state) -> { code, at, via }, each dropped after 30 minutes.
// data/referrals.jsonl (0600, append only): { kind: 'bind', v: 1, at, code, profileId, accountCreatedAt, via }. Rows of a
// deleted account are dropped (forgetProfile, from players.deleteByProfileId) and rows older than 30 days are dropped
// (the gameplay reads the file every minute, so it read them long before); a rewritten file is a new inode, which the
// gameplay reads again from the start, skipping bindings it already has.

const crypto = require('crypto')
const fs     = require('fs')
const path   = require('path')
const { writeAtomic } = require('./atomicFile')

const PENDING_FILE = process.env.REFERRAL_PENDING_FILE || path.join(__dirname, '..', 'data', 'referral-pending.json')
const BINDINGS_FILE = process.env.REFERRALS_FILE || path.join(__dirname, '..', 'data', 'referrals.jsonl')

// The gameplay's code alphabet: no vowels (no words), no 0/O or 1/I
const CODE_RE = /^[BCDFGHJKLMNPQRSTVWXZ2-9]{8}$/
const COOKIE = 'dbo_ref'
const COOKIE_PATH = '/api/users/login-discord'
const DAY = 24 * 3600 * 1000
const TTL = Object.freeze({ cookie: 30 * DAY, state: 30 * 60 * 1000, binding: 30 * DAY })
const MAX_STATES = 2000
// A profile counts as made by this login when players.json dates it no earlier than this before the browser step
const CREATED_SLACK_MS = 1000
// Discord's epoch: a snowflake's top 42 bits are milliseconds since it
const DISCORD_EPOCH = 1420070400000n

const sha256 = s => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex')
const linksOn = () => String(process.env.REFERRAL_LINKS || '').trim().toLowerCase() === 'on'

const normCode = (v) => {
  const c = String(v || '').trim().toUpperCase()
  return CODE_RE.test(c) ? c : ''
}

function accountCreatedAt(discordId) {
  try {
    const id = BigInt(String(discordId))
    if (id <= 0n) return 0
    return Number((id >> 22n) + DISCORD_EPOCH)
  } catch { return 0 }
}

function readCookie(req, name) {
  for (const part of String((req && req.headers && req.headers.cookie) || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return ''
}

const stateOk = s => typeof s === 'string' && s.length > 0 && s.length <= 512

function createReferralStore({ pendingFile = PENDING_FILE, bindingsFile = BINDINGS_FILE, now = () => Date.now(), log = console.log } = {}) {
  let data = null
  const load = () => {
    if (data) return data
    let d = null
    try { d = JSON.parse(fs.readFileSync(pendingFile, 'utf8')) } catch { d = null }
    const states = {}
    // Only sha256 keys are kept: a file from the first build (raw states, visits, a salt) loses them on the next write
    for (const [k, v] of Object.entries((d && d.states && typeof d.states === 'object' && d.states) || {})) {
      if (/^[0-9a-f]{64}$/.test(k) && v && d.hashed === true) states[k] = v
    }
    data = { hashed: true, states }
    return data
  }
  const save = () => {
    try { writeAtomic(pendingFile, JSON.stringify(data) + '\n') }
    catch (err) { log(`[referral] pending store write failed: ${err.message}`) }
  }
  const prune = () => {
    const d = load(), t = now()
    for (const [k, v] of Object.entries(d.states)) if (!v || !(t - v.at < TTL.state)) delete d.states[k]
    const keys = Object.keys(d.states)
    if (keys.length >= MAX_STATES) keys.sort((a, b) => d.states[a].at - d.states[b].at).slice(0, keys.length - MAX_STATES + 1).forEach(k => delete d.states[k])
  }

  // The launcher opened the login page in this browser, for a login compat has already accepted
  function noteLogin({ state, cookieCode }) {
    if (!stateOk(state)) return null
    const code = normCode(cookieCode)
    if (!code) return null
    const d = load(), key = sha256(state)
    // Browser Back re-opens the same state: the first code noted for it stays
    if (!d.states[key]) { prune(); d.states[key] = { code, at: now(), via: 'cookie' }; save() }
    return d.states[key]
  }

  const pendingFor = (state) => (stateOk(state) ? load().states[sha256(state)] || null : null)

  // Rewrites the bindings file keeping the rows `keep` accepts; a new file (a new inode) the gameplay reads again
  function rewrite(keep) {
    let text = ''
    try { text = fs.readFileSync(bindingsFile, 'utf8') } catch (err) { if (err.code === 'ENOENT') return 0; throw err }
    const lines = text.split('\n').filter(Boolean)
    const kept = lines.filter(line => { let r = null; try { r = JSON.parse(line) } catch { return false } return keep(r) })
    if (kept.length === lines.length) return 0
    writeAtomic(bindingsFile, kept.map(l => l + '\n').join(''))
    return lines.length - kept.length
  }
  let trimmedAt = 0
  const trim = () => {
    if (now() - trimmedAt < DAY) return 0
    trimmedAt = now()
    try {
      const n = rewrite(r => r && Number(r.at) > now() - TTL.binding)
      if (n) log(`[referral] ${n} binding row(s) older than 30 days dropped`)
      return n
    } catch (err) { log(`[referral] old binding rows not dropped: ${err.message}`); return 0 }
  }

  // An account deleted (players.deleteByProfileId): its binding rows go
  function forgetProfile(profileId) {
    const id = Number(profileId)
    const n = rewrite(r => r && Number(r.profileId) !== id)
    if (n) log(`[referral] ${n} binding row(s) of deleted profile ${id} dropped`)
    return n
  }

  // A login of this state delivered a session for profileId; player is players.getByProfileId(profileId), or a function
  // that returns it (called only when this login carried a code)
  function deliver({ state, profileId, player }) {
    const d = load(), p = pendingFor(state)
    if (!p) return { result: 'none' }
    delete d.states[sha256(state)]
    save()
    if (typeof player === 'function') {
      try { player = player() } catch (err) { log(`[referral] player lookup failed: ${err.message}`); player = null }
    }
    const created = player ? Date.parse(player.createdAt) : NaN
    if (!player || !Number.isFinite(created)) {
      log(`[referral] REFERRAL code ${p.code} not bound: profile ${profileId} has no player record`)
      return { result: 'noPlayer' }
    }
    if (created < p.at - CREATED_SLACK_MS) {
      log(`[referral] REFERRAL code ${p.code} not bound: profile ${profileId} existed before this login`)
      return { result: 'existing' }
    }
    trim()
    const row = { kind: 'bind', v: 1, at: now(), code: p.code, profileId: Number(profileId), accountCreatedAt: accountCreatedAt(player.discordId), via: p.via }
    try {
      fs.mkdirSync(path.dirname(bindingsFile), { recursive: true, mode: 0o700 })
      fs.appendFileSync(bindingsFile, JSON.stringify(row) + '\n', { mode: 0o600 })
    } catch (err) {
      log(`[referral] REFERRAL code ${p.code} for profile ${profileId} could not be written: ${err.message}`)
      return { result: 'writeFailed' }
    }
    log(`[referral] REFERRAL new profile ${profileId} arrived with code ${p.code} (${p.via})`)
    return { result: 'bound', row }
  }

  return { noteLogin, pendingFor, deliver, forgetProfile, trim, prune, _data: () => load() }
}

// The one store the routes use, made on first use
let shared = null
const store = () => (shared = shared || createReferralStore())

// The hooks routes/skymp-compat.js calls; they return at once while REFERRAL_LINKS is not 'on'
const noteLogin = (args) => (linksOn() ? store().noteLogin(args) : null)
const deliver = (args) => (linksOn() ? store().deliver(args) : { result: 'off' })
// Account deletion always drops the rows, whatever the switch
const forgetProfile = (profileId) => store().forgetProfile(profileId)

module.exports = {
  createReferralStore, store, noteLogin, deliver, forgetProfile, linksOn,
  normCode, accountCreatedAt, readCookie, sha256, COOKIE, COOKIE_PATH, TTL, CODE_RE,
}
