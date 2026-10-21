'use strict'
// Worker thread for sources/punish/playerLog.js: the player log's kicks and bans from its day files. Archives (.jsonl.gz,
// never changed) are read once; today's file is read on from where it stopped, up to its last newline. The forwarder's
// copies (*.fwd.jsonl) and its forwarder/ and holds/ folders are never opened. Only the fields the panel shows leave this
// thread: the Discord id ('d') and the actor id are dropped here.

const { parentPort } = require('worker_threads')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const DAY_MS = 86400000
const LIVE_FILE = /^(\d{4}-\d{2}-\d{2})(?:\.\d{1,3})?\.jsonl$/
const ARCHIVE_FILE = /^(\d{4}-\d{2}-\d{2})(?:\.\d{1,3})?\.jsonl\.gz$/
const WANTED = ['"session.kick"', '"session.ban"']
const KICKS = new Set(['command', 'panel', 'suspension', 'discord_ban', 'ban_enforce'])
const BANS = new Set(['ban', 'tempban', 'unban'])
// A line longer than this is no event of ours: it is dropped rather than held
const MAX_LINE = 1024 * 1024

const read = new Set()
const tails = new Map()

const str = (v, max) => (typeof v === 'string' && v ? v.slice(0, max) : null)
const int = v => (Number.isSafeInteger(v) ? v : null)
const tag = v => (typeof v === 'string' && /^[A-Z0-9?]{4}$/.test(v) ? v : null)

function pick(line) {
  if (!WANTED.some(w => line.includes(w))) return null
  let e
  try { e = JSON.parse(line) } catch { return null }
  if (!e || typeof e !== 'object') return null
  const f = e.f && typeof e.f === 'object' ? e.f : {}
  if (e.ev === 'session.kick' ? !KICKS.has(f.kind) : e.ev === 'session.ban' ? !BANS.has(f.kind) : true) return null
  if (typeof e.g !== 'string' || !/^[a-z0-9]{1,12}$/.test(e.g) || !Number.isSafeInteger(e.s) || !Number.isSafeInteger(e.t)) return null
  const staff = Array.isArray(e.o) ? e.o.find(x => x && (x.r === 'staff' || x.r === 'by')) : null
  return {
    g: e.g, s: e.s, t: e.t, ev: e.ev, kind: f.kind, src: str(e.src, 40), p: int(e.p), c: tag(e.c), n: str(e.n, 48),
    hours: int(f.hours), until: int(f.until), by: staff ? { p: int(staff.p), c: tag(staff.c), n: str(staff.n, 48) } : null,
  }
}

function list(dir) {
  try { return fs.readdirSync(dir) } catch (err) { if (err.code === 'ENOENT') return []; throw err }
}

async function readArchive(file, out) {
  const stream = fs.createReadStream(file).pipe(zlib.createGunzip())
  stream.setEncoding('utf8')
  let rest = ''
  for await (const chunk of stream) {
    const parts = (rest + chunk).split('\n')
    rest = parts.pop()
    if (rest.length > MAX_LINE) rest = ''
    for (const line of parts) { const e = pick(line); if (e) out.push(e) }
  }
}

// Byte offsets, so a line cut by a write in progress is read whole next time (a newline byte is never inside a UTF-8 character)
async function readOn(file, out) {
  const st = fs.statSync(file)
  let t = tails.get(file)
  if (!t || t.ino !== st.ino || st.size < t.offset) t = { ino: st.ino, offset: 0 }
  tails.set(file, t)
  if (st.size <= t.offset) return
  let rest = Buffer.alloc(0)
  let used = 0
  for await (const chunk of fs.createReadStream(file, { start: t.offset, end: st.size - 1 })) {
    const buf = rest.length ? Buffer.concat([rest, chunk]) : chunk
    const end = buf.lastIndexOf(10)
    if (end < 0) {
      // Held for the next chunk unless it is too long to be an event; then skipped, and the read goes on after it
      if (buf.length > MAX_LINE) { used += buf.length; rest = Buffer.alloc(0) } else rest = buf
      continue
    }
    for (const line of buf.subarray(0, end).toString('utf8').split('\n')) { const e = pick(line); if (e) out.push(e) }
    used += end + 1
    rest = buf.subarray(end + 1)
  }
  t.offset += used
}

async function scan({ dir, days, now }) {
  const cutoff = now - days * DAY_MS
  const inWindow = day => Date.parse(`${day}T00:00:00Z`) + DAY_MS > cutoff
  const events = []
  let from = null
  const archive = path.join(dir, 'archive')
  for (const name of list(archive).filter(n => ARCHIVE_FILE.test(n)).sort()) {
    const day = ARCHIVE_FILE.exec(name)[1]
    if (!inWindow(day)) continue
    if (!from || day < from) from = day
    if (read.has(name)) continue
    await readArchive(path.join(archive, name), events)
    read.add(name)
  }
  const live = path.join(dir, 'events')
  const seen = new Set()
  for (const name of list(live).filter(n => LIVE_FILE.test(n)).sort()) {
    const day = LIVE_FILE.exec(name)[1]
    if (!inWindow(day)) continue
    if (!from || day < from) from = day
    const file = path.join(live, name)
    seen.add(file)
    await readOn(file, events)
  }
  for (const file of tails.keys()) if (!seen.has(file)) tails.delete(file)
  return { events: events.filter(e => e.t >= cutoff), from }
}

parentPort.on('message', msg => {
  scan(msg).then(
    r => parentPort.postMessage({ type: 'events', ...r }),
    err => parentPort.postMessage({ type: 'error', message: String(err.code || err.message) }),
  )
})
