'use strict'
// The local usage record of /dragonbaron ask: one JSON line per ask, mode 0600 in a 0700 folder, pruned on the first write of each UTC day
// Metadata only (Jake, 28 Oct): who, when, ranks, sources and outcome; the question and the answer text are never written anywhere

const fs = require('fs')
const path = require('path')

const DEFAULT_FILE = '/var/lib/dragonbreak/dragonbaron-ai/ask-usage.jsonl'
const DAY_MS = 24 * 60 * 60 * 1000
const USAGE_DAYS = 90

function ensureDir(dir) {
  if (fs.existsSync(dir)) return
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.chmodSync(dir, 0o700)
}

function append(file, line) {
  ensureDir(path.dirname(file))
  const fd = fs.openSync(file, 'a', 0o600)
  try {
    fs.fchmodSync(fd, 0o600)
    fs.writeSync(fd, `${line}\n`)
  } finally { fs.closeSync(fd) }
}

// Keeps the lines whose "at" is newer than the cutoff; a line that cannot be read is dropped
function prune(file, cutoffMs) {
  if (!fs.existsSync(file)) return
  const kept = fs.readFileSync(file, 'utf8').split('\n').filter(line => {
    if (!line.trim()) return false
    try { return Date.parse(JSON.parse(line).at) >= cutoffMs } catch { return false }
  })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, kept.length ? `${kept.join('\n')}\n` : '', { mode: 0o600 })
  fs.chmodSync(tmp, 0o600)
  fs.renameSync(tmp, file)
}

function createUsageLog({ file = process.env.DRAGONBARON_ASK_LOG || DEFAULT_FILE, now = Date.now, log = (...a) => console.error('[dragonbaron-ask]', ...a) } = {}) {
  let prunedDay = null

  function daily() {
    const day = new Date(now()).toISOString().slice(0, 10)
    if (prunedDay === day) return
    prunedDay = day
    prune(file, now() - USAGE_DAYS * DAY_MS)
  }

  // record: the usage line, built by the caller from metadata fields only
  function write(record) {
    try {
      daily()
      append(file, JSON.stringify(record))
    } catch (err) {
      log('usage record failed:', err.code || err.message)
    }
  }

  return { write, file }
}

module.exports = { createUsageLog, DEFAULT_FILE }
