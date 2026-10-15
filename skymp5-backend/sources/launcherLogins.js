'use strict'
// Launcher and in-game Discord logins (routes/skymp-compat.js): the server issues every state, and a result reaches only the device that started it
// loopback (launcher): RFC 8252 redirect to 127.0.0.1 plus PKCE; device (in-game): a code shown in game and typed on our page; legacy: launchers up to 2.1.49
// Records hold hashes of their secrets only, and the session is made when the result is collected, so no token is ever stored here

const crypto = require('crypto')
const fs     = require('fs')

const FLOWS = Object.freeze(['loopback', 'device', 'legacy'])
// States, device codes and one-time codes are 32 random bytes in hex, the shape the old launcher and game already use
const SECRET_RE = /^[0-9a-f]{64}$/
// A PKCE S256 challenge: base64url of a SHA-256, no padding (RFC 7636 4.2)
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/
// A PKCE verifier: 43-128 unreserved characters (RFC 7636 4.1)
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/
// No vowels (no words), no 0/O or 1/I: the code is read off a game screen and typed by hand
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789'
const USER_CODE_LENGTH = 8

const TTL = Object.freeze({
  pending:       10 * 60 * 1000, // issued, waiting for the browser and Discord
  legacyPending:  5 * 60 * 1000, // the old launcher stops polling after 5 minutes, and an old state is never extended
  discord:        2 * 60 * 1000, // the callback is talking to Discord
  confirming:     5 * 60 * 1000, // Discord is done, the confirmation page waits for the player
  code:               60 * 1000, // loopback: the one-time code waits for the launcher's exchange
  ready:          2 * 60 * 1000, // device and legacy: confirmed, waiting for the next poll
})
// Wrong device codes typed on one confirmation page, or failed exchanges of one code, before the login is dropped
const MAX_ATTEMPTS = 5
// The file format; anything else (the old array of raw states, which could hold session tokens) is discarded at load
const FILE_VERSION = 2

const sha256 = s => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex')
const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const s256 = verifier => b64url(crypto.createHash('sha256').update(verifier, 'ascii').digest())
const randomHex = () => crypto.randomBytes(32).toString('hex')

function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

// What a player types: case, spaces and dashes do not matter
const normalizeUserCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

function newUserCode() {
  let code = ''
  for (let i = 0; i < USER_CODE_LENGTH; i++) code += USER_CODE_ALPHABET[crypto.randomInt(USER_CODE_ALPHABET.length)]
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

function createLoginStore({ file = null, now = Date.now, max = 5000, log = console } = {}) {
  // sha256(state) -> record; insertion order is issue order
  const records = new Map()

  function save() {
    if (!file) return
    const t = now()
    const entries = [...records.entries()].filter(([, r]) => r.expiresAt > t)
    const tmp = `${file}.tmp`
    try {
      fs.writeFileSync(tmp, JSON.stringify({ v: FILE_VERSION, entries }) + '\n', { mode: 0o600 })
      fs.renameSync(tmp, file)
    } catch (e) { log.error(`[launcher-login] could not save in-flight logins: ${e.message}`) }
  }

  function load() {
    if (!file) return
    let data
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return }   // first run or unreadable: start empty
    if (!data || data.v !== FILE_VERSION || !Array.isArray(data.entries)) {
      // The pre-F1 file: overwritten now, so the session tokens it may hold do not stay on disk
      log.log('[launcher-login] discarded an old-format in-flight login file')
      save()
      return
    }
    const t = now()
    for (const e of data.entries) {
      if (Array.isArray(e) && typeof e[0] === 'string' && e[1] && typeof e[1] === 'object' && FLOWS.includes(e[1].flow) && e[1].expiresAt > t) records.set(e[0], e[1])
    }
    if (records.size) log.log(`[launcher-login] restored ${records.size} in-flight login(s)`)
  }

  function prune() {
    const t = now()
    let removed = false
    for (const [k, r] of records) if (r.expiresAt <= t) { records.delete(k); removed = true }
    return removed
  }

  // The live record of a well-formed state, or null
  function find(state) {
    if (typeof state !== 'string' || !SECRET_RE.test(state)) return null
    const key = sha256(state)
    const rec = records.get(key)
    if (!rec) return null
    if (rec.expiresAt <= now()) { records.delete(key); save(); return null }
    return { key, rec }
  }

  // Full store: the oldest login still waiting for its browser goes first, then the oldest of any kind
  function makeRoom() {
    if (records.size < max) return
    let victim = null
    for (const [k, r] of records) { if (r.status === 'pending') { victim = k; break } }
    records.delete(victim || records.keys().next().value)
  }

  function add(state, rec) {
    if (prune()) save()
    makeRoom()
    records.set(sha256(state), rec)
    save()
  }

  // loopback: { challenge, port } -> { state }; device: {} -> { state, deviceCode, userCode }
  function issue(flow, { challenge, port } = {}) {
    const state = randomHex()
    const base = { flow, status: 'pending', expiresAt: now() + TTL.pending, attempts: 0 }
    if (flow === 'loopback') {
      if (typeof challenge !== 'string' || !CHALLENGE_RE.test(challenge)) throw new Error('bad code_challenge')
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('bad redirect_port')
      add(state, { ...base, challenge, port })
      return { state }
    }
    if (flow === 'device') {
      const deviceCode = randomHex()
      const userCode = newUserCode()
      add(state, { ...base, deviceHash: sha256(deviceCode), userCodeHash: sha256(normalizeUserCode(userCode)) })
      return { state, deviceCode, userCode }
    }
    throw new Error(`unknown login flow: ${flow}`)
  }

  // The old launcher's own state: registered once, never extended, so a lure cannot be kept alive by reopening it
  function registerLegacy(state) {
    if (typeof state !== 'string' || !SECRET_RE.test(state)) return 'invalid'
    if (find(state)) return 'exists'
    add(state, { flow: 'legacy', status: 'pending', expiresAt: now() + TTL.legacyPending, attempts: 0 })
    return 'created'
  }

  // { flow, status } of a live state, or null
  function peek(state) {
    const f = find(state)
    return f ? { flow: f.rec.flow, status: f.rec.status } : null
  }

  // Discord's redirect: works once per state, so a second callback with the same state is refused
  function beginCallback(state) {
    const f = find(state)
    if (!f || f.rec.status !== 'pending') return null
    f.rec.status = 'discord'
    f.rec.expiresAt = now() + TTL.discord
    save()
    return { flow: f.rec.flow }
  }

  // After Discord named the user: loopback gets its one-time code, device and legacy a confirmation page nonce
  function discordDone(state, user) {
    const f = find(state)
    if (!f || f.rec.status !== 'discord') return null
    f.rec.user = { id: String(user.id), username: String(user.username || ''), avatar: user.avatar || null }
    if (f.rec.flow === 'loopback') {
      const code = randomHex()
      f.rec.codeHash = sha256(code)
      f.rec.status = 'code'
      f.rec.expiresAt = now() + TTL.code
      save()
      return { flow: 'loopback', code, port: f.rec.port }
    }
    const nonce = randomHex()
    f.rec.nonceHash = sha256(nonce)
    f.rec.status = 'confirming'
    f.rec.expiresAt = now() + TTL.confirming
    save()
    return { flow: f.rec.flow, nonce }
  }

  function drop(state) {
    const f = find(state)
    if (f) { records.delete(f.key); save() }
  }

  // The confirmation page's answer: 'ok', 'gone' (unknown, expired or already used), 'badCode' or 'tooMany'
  function confirm(state, nonce, userCode) {
    const f = find(state)
    if (!f || f.rec.status !== 'confirming' || !sameHash(sha256(nonce), f.rec.nonceHash)) return { result: 'gone' }
    if (f.rec.flow === 'device' && !sameHash(sha256(normalizeUserCode(userCode)), f.rec.userCodeHash)) {
      f.rec.attempts++
      if (f.rec.attempts >= MAX_ATTEMPTS) { records.delete(f.key); save(); return { result: 'tooMany' } }
      save()
      return { result: 'badCode', left: MAX_ATTEMPTS - f.rec.attempts, username: f.rec.user.username }
    }
    f.rec.status = 'ready'
    f.rec.expiresAt = now() + TTL.ready
    save()
    return { result: 'ok', flow: f.rec.flow, username: f.rec.user.username }
  }

  // The one-time delivery shared by every flow
  function deliver(f) {
    records.delete(f.key)
    save()
    return f.rec.user
  }

  // loopback: the launcher trades the one-time code and its PKCE verifier for the result, once
  function exchange(state, code, verifier) {
    const f = find(state)
    if (!f || f.rec.flow !== 'loopback' || f.rec.status !== 'code') return null
    const ok = typeof code === 'string' && SECRET_RE.test(code) && sameHash(sha256(code), f.rec.codeHash) &&
      typeof verifier === 'string' && VERIFIER_RE.test(verifier) && sameHash(s256(verifier), f.rec.challenge)
    if (ok) return deliver(f)
    f.rec.attempts++
    if (f.rec.attempts >= MAX_ATTEMPTS) records.delete(f.key)
    save()
    return null
  }

  // device: { pending } until confirmed, then { user } once; { gone } for anything else, including a wrong device code
  function poll(state, deviceCode) {
    const f = find(state)
    if (!f || f.rec.flow !== 'device' || typeof deviceCode !== 'string' || !SECRET_RE.test(deviceCode) ||
      !sameHash(sha256(deviceCode), f.rec.deviceHash)) return { gone: true }
    if (f.rec.status !== 'ready') return { pending: true }
    return { user: deliver(f) }
  }

  // legacy /status: only a legacy state is ever answered here, so a new flow's result can never be collected by its state alone
  function legacyStatus(state) {
    const f = find(state)
    if (!f || f.rec.flow !== 'legacy') return { gone: true }
    if (f.rec.status !== 'ready') return { pending: true }
    return { user: deliver(f) }
  }

  load()
  return { issue, registerLegacy, peek, beginCallback, discordDone, drop, confirm, exchange, poll, legacyStatus, size: () => records.size }
}

module.exports = { createLoginStore, FLOWS, TTL, MAX_ATTEMPTS, SECRET_RE, CHALLENGE_RE, VERIFIER_RE, s256, b64url, normalizeUserCode }
