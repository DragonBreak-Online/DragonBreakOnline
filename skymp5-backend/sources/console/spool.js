'use strict'
// The console's transport to the game: signed JSON files in a root-only tmpfs spool, no listener on either side (DESIGN 6)

const nodeFs = require('fs')
const path = require('path')
const crypto = require('crypto')
const rules = require('./allowlist')

const TTL_MS = 10 * 1000
const POLL_MS = 250
const MAX_REPLY_BYTES = 64 * 1024
const OUT_KEEP_MS = 5 * 60 * 1000
const STATES = new Set(['ran', 'refused', 'failed', 'expired', 'dry-run', 'off', 'busy', 'bad'])

function createSpool({ dir, keyFile, fs = nodeFs, now = Date.now, uid = 0 }) {
  const IN = path.join(dir, 'in'), WORK = path.join(dir, 'work'), OUT = path.join(dir, 'out')
  let keyCache = { stamp: '', key: null }

  // Mode test in parentheses: mode & 0o077 === 0 parses as mode & false, which is always 0
  const privateDir = p => {
    try {
      const st = fs.lstatSync(p)
      return st.isDirectory() && !st.isSymbolicLink() && st.uid === uid && (st.mode & 0o077) === 0
    } catch { return false }
  }

  // Re-read when the file changes, so a new key needs no restart; null unless a root-only file of 64 hex characters
  function key() {
    try {
      const st = fs.lstatSync(keyFile)
      if (!st.isFile() || st.uid !== uid || (st.mode & 0o077) !== 0) return null
      const stamp = `${st.ino}:${st.size}:${st.mtimeMs}`
      if (stamp !== keyCache.stamp) {
        const hex = fs.readFileSync(keyFile, 'utf8').trim()
        keyCache = { stamp, key: /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, 'hex') : null }
      }
      return keyCache.key
    } catch { return null }
  }

  // '' when the spool and key are usable, else what is wrong
  function problem() {
    for (const d of [dir, IN, WORK, OUT]) if (!privateDir(d)) return `spool ${d} is not a root-only 0700 directory`
    if (!key()) return `key ${keyFile} is missing or not a root-only file of 64 hex characters`
    return ''
  }

  const hmac = (k, text) => crypto.createHmac('sha256', k).update(text, 'utf8').digest()

  // Writes the signed request under a temp name, then renames it in, so the game never reads half a file
  function send(fields) {
    const k = key()
    if (!k) throw new Error('console key unavailable')
    const issuedAt = now()
    const r = { v: 1, ...fields, issuedAt, expiresAt: issuedAt + TTL_MS }
    r.sig = hmac(k, rules.reqPayload(r)).toString('hex')
    const tmp = path.join(IN, `.${r.id}.tmp`)
    fs.writeFileSync(tmp, JSON.stringify(r), { mode: 0o600, flag: 'wx' })
    try { fs.renameSync(tmp, path.join(IN, `${r.id}.json`)) } catch (err) { fs.rmSync(tmp, { force: true }); throw err }
    return r
  }

  // A reply file checked field by field and by its signature; null when it is not one the game signed for this id
  function readReply(id) {
    const file = path.join(OUT, `${id}.json`)
    let text
    try {
      const st = fs.lstatSync(file)
      if (!st.isFile() || st.size > MAX_REPLY_BYTES) { fs.rmSync(file, { force: true }); return null }
      text = fs.readFileSync(file, 'utf8')
    } catch { return null }
    fs.rmSync(file, { force: true })
    let r
    try { r = JSON.parse(text) } catch { return { bad: 'not JSON' } }
    const k = key()
    const lines = Array.isArray(r?.lines) ? r.lines : null
    const shapeOk = r && r.v === 1 && r.id === id && STATES.has(r.state) && typeof r.gate === 'string' && typeof r.ranAs === 'string' &&
      typeof r.online === 'boolean' && typeof r.tier === 'string' && typeof r.target === 'string' && typeof r.why === 'string' &&
      Number.isSafeInteger(r.at) && typeof r.sig === 'string' && /^[0-9a-f]{64}$/.test(r.sig) && lines && lines.length <= 40 &&
      lines.every(l => l && typeof l.to === 'string' && typeof l.text === 'string' && l.text.length <= 600)
    if (!shapeOk || !k) return { bad: 'shape' }
    const want = hmac(k, rules.repPayload(r)), got = Buffer.from(r.sig, 'hex')
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return { bad: 'signature' }
    return {
      state: r.state, gate: r.gate.slice(0, 16), ranAs: rules.foldText(r.ranAs, 80), online: r.online, tier: r.tier.slice(0, 16),
      target: rules.foldText(r.target, 80), why: r.why.slice(0, 32), at: r.at,
      lines: lines.map(l => ({ to: rules.foldText(l.to, 8), text: rules.foldText(l.text, 600) })),
    }
  }

  // Waits for the reply by fs.watch with a poll beside it; resolves the reply, or null at the deadline
  function waitReply(id, ms) {
    return new Promise(resolve => {
      let done = false, watcher = null, timer = null, poll = null
      const finish = value => {
        if (done) return
        done = true
        clearTimeout(timer); clearInterval(poll)
        try { watcher?.close() } catch { /* already closed */ }
        resolve(value)
      }
      const look = () => { if (!done && fs.existsSync(path.join(OUT, `${id}.json`))) finish(readReply(id)) }
      try { watcher = fs.watch(OUT, (_e, name) => { if (String(name) === `${id}.json`) look() }); watcher.on('error', () => {}) } catch { watcher = null }
      poll = setInterval(look, POLL_MS)
      timer = setTimeout(() => finish(null), ms)
      look()
    })
  }

  // true when the request was still waiting and is now withdrawn, so the game can never run it; false when the game took it
  function cancel(id) {
    const from = path.join(IN, `${id}.json`), to = path.join(IN, `${id}.cancelled`)
    try { fs.renameSync(from, to) } catch { return false }
    fs.rmSync(to, { force: true })
    return true
  }

  const waiting = id => fs.existsSync(path.join(IN, `${id}.json`))
  const replied = id => fs.existsSync(path.join(OUT, `${id}.json`))

  // allow.json as the game published it, or null
  function allow() {
    try {
      const file = path.join(dir, 'allow.json')
      const st = fs.lstatSync(file)
      if (!st.isFile() || st.size > 32 * 1024) return null
      return rules.parseAllow(fs.readFileSync(file, 'utf8'))
    } catch { return null }
  }

  // Replies nobody collected (a backend restart mid-wait) go after 5 minutes
  function sweepOut() {
    let names = []
    try { names = fs.readdirSync(OUT) } catch { return }
    for (const n of names) {
      try { if (now() - fs.lstatSync(path.join(OUT, n)).mtimeMs > OUT_KEEP_MS) fs.rmSync(path.join(OUT, n), { force: true }) } catch { /* gone */ }
    }
  }

  return { problem, send, readReply, waitReply, cancel, waiting, replied, allow, sweepOut, dirs: { IN, WORK, OUT } }
}

module.exports = { createSpool, TTL_MS }
