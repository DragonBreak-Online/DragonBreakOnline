'use strict'
// Referral links (Nate, 16 Oct 2026: "Go for it"; spec in the server branch's docs/referrals.md). The backend's part is
// small: it remembers which referral code a browser arrived with and, when that browser's Discord login creates a
// brand-new account, writes one line to data/referrals.jsonl. The gameplay (server branch referrals.js) reads that file,
// owns the codes, counts play time, decides whether a referral qualifies and grants every reward. The backend never
// decides a reward.
//
//   GET /api/join/<code>       the shared link: sets the dbo_ref cookie (30 days, sent only to the login path) and
//                              remembers the visit by a salted hash of the visitor's address and browser, for a browser
//                              that drops the cookie; then redirects to the website
//   GET /api/users/login-discord?state=<s>   the launcher opens this in the player's default browser: the code that
//                              browser carries is noted against the login's state
//   the login's result (POST token / poll, GET status): when it hands out a session for a profile created during that
//                              very login, the binding is written. An account that existed before is never bound.
//
// data/referral-pending.json (0600): the states and visits waiting, each dropped after its TTL; nothing personal in clear.
// data/referrals.jsonl (0600, append only): { kind: 'bind', v: 1, at, code, profileId, accountCreatedAt, via }.

const crypto = require('crypto')
const fs     = require('fs')
const path   = require('path')
const { writeAtomic } = require('./atomicFile')

const PENDING_FILE = process.env.REFERRAL_PENDING_FILE || path.join(__dirname, '..', 'data', 'referral-pending.json')
const BINDINGS_FILE = process.env.REFERRALS_FILE || path.join(__dirname, '..', 'data', 'referrals.jsonl')

// The gameplay's code alphabet: no vowels (no words), no 0/O or 1/I
const CODE_RE = /^[BCDFGHJKLMNPQRSTVWXZ2-9]{8}$/
// Every login state the backend issues is 32 random bytes in hex (sources/launcherLogins.js)
const STATE_RE = /^[0-9a-f]{64}$/
const COOKIE = 'dbo_ref'
const COOKIE_PATH = '/api/users/login-discord'
const DAY = 24 * 3600 * 1000
const TTL = Object.freeze({ cookie: 30 * DAY, visit: 7 * DAY, state: 30 * 60 * 1000 })
const MAX_VISITS = 5000
const MAX_STATES = 2000
// A profile counts as made by this login when players.json dates it no earlier than this before the browser step
const CREATED_SLACK_MS = 1000
// Discord's epoch: a snowflake's top 42 bits are milliseconds since it
const DISCORD_EPOCH = 1420070400000n

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
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return ''
}

function createReferralStore({ pendingFile = PENDING_FILE, bindingsFile = BINDINGS_FILE, now = () => Date.now(), log = console.log } = {}) {
  let data = null
  const load = () => {
    if (data) return data
    let d = null
    try { d = JSON.parse(fs.readFileSync(pendingFile, 'utf8')) } catch { d = null }
    data = {
      salt: d && typeof d.salt === 'string' && d.salt.length >= 32 ? d.salt : crypto.randomBytes(24).toString('hex'),
      states: d && d.states && typeof d.states === 'object' ? d.states : {},
      visits: d && d.visits && typeof d.visits === 'object' ? d.visits : {},
    }
    return data
  }
  const save = () => {
    try { writeAtomic(pendingFile, JSON.stringify(data) + '\n') }
    catch (err) { log(`[referral] pending store write failed: ${err.message}`) }
  }
  const prune = () => {
    const d = load(), t = now()
    for (const [k, v] of Object.entries(d.states)) if (!v || !(t - v.at < TTL.state)) delete d.states[k]
    for (const [k, v] of Object.entries(d.visits)) if (!v || !(t - v.at < TTL.visit)) delete d.visits[k]
    const cap = (obj, max) => {
      const keys = Object.keys(obj)
      if (keys.length <= max) return
      keys.sort((a, b) => obj[a].at - obj[b].at).slice(0, keys.length - max).forEach(k => delete obj[k])
    }
    cap(d.states, MAX_STATES)
    cap(d.visits, MAX_VISITS)
  }
  // ip may be null (no visitor header): the visit is then remembered by the cookie alone
  const visitKey = (ip, ua) => (ip ? crypto.createHash('sha256').update(`${load().salt}|${ip}|${String(ua || '').slice(0, 256)}`).digest('hex') : '')

  // The shared link was opened
  function visit({ code, ip, ua }) {
    const c = normCode(code)
    if (!c) return ''
    const k = visitKey(ip, ua)
    if (k) {
      prune()
      load().visits[k] = { code: c, at: now() }
      save()
    }
    return c
  }

  // The launcher opened the login page in this browser
  function noteLogin({ state, cookieCode, ip, ua }) {
    if (typeof state !== 'string' || !STATE_RE.test(state)) return null
    let code = normCode(cookieCode), via = 'cookie'
    if (!code) {
      const k = visitKey(ip, ua)
      const v = k ? load().visits[k] : null
      if (v && now() - v.at < TTL.visit) { code = normCode(v.code); via = 'visit' }
    }
    if (!code) return null
    prune()
    // Browser Back re-opens the same state: the first code noted for it stays
    const d = load()
    if (!d.states[state]) { d.states[state] = { code, at: now(), via }; save() }
    return d.states[state]
  }

  const pendingFor = (state) => (typeof state === 'string' && STATE_RE.test(state) ? load().states[state] || null : null)

  // A login of this state delivered a session for profileId; player is players.getByProfileId(profileId)
  function deliver({ state, profileId, player }) {
    const d = load(), p = pendingFor(state)
    if (!p) return { result: 'none' }
    delete d.states[state]
    save()
    const created = player ? Date.parse(player.createdAt) : NaN
    if (!player || !Number.isFinite(created)) {
      log(`[referral] REFERRAL code ${p.code} not bound: profile ${profileId} has no player record`)
      return { result: 'noPlayer' }
    }
    if (created < p.at - CREATED_SLACK_MS) {
      log(`[referral] REFERRAL code ${p.code} not bound: profile ${profileId} existed before this login`)
      return { result: 'existing' }
    }
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

  return { visit, noteLogin, pendingFor, deliver, prune, _data: () => load() }
}

module.exports = { createReferralStore, normCode, accountCreatedAt, readCookie, COOKIE, COOKIE_PATH, TTL, CODE_RE }
