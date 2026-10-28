'use strict'
// Dragonbaron AI runtime switch (read every call) and settings file (cached 60 s), both read at call time and failing closed
// Switch: missing, unreadable, writable by others, unknown key or value, or malformed means every key is off
// Settings: a missing or invalid key keeps its code default; the model URL defaults to '' so the model is never contacted
// Who may ask is the ask node of dragonbaronPermissions (/dragonbaron config), never this file; question text is never kept

const fs = require('fs')

const SWITCH_FILE = '/etc/dragonbreak/dragonbaron-ai'
const ENV_FILE = '/etc/dragonbreak/dragonbaron-ai.env'
const CACHE_MS = 60 * 1000
const MAX_BYTES = 64 * 1024

const switchPath = () => process.env.DRAGONBARON_AI_SWITCH_FILE || SWITCH_FILE
const envPath = () => process.env.DRAGONBARON_AI_ENV_FILE || ENV_FILE

const DEFAULTS = Object.freeze({
  url: '',
  model: 'qwen3.5:9b',
  numCtx: 16384,
  keepAlive: -1,
  timeoutMs: 60000,
  probeMs: 3000,
  askPerMin: 3,
  askPerHour: 20,
  askSitePerHour: 60,
})

const OFF = Object.freeze({ ask: false, model: false, detect: 'off' })

// A file we will trust: a regular file, small, owned by root or by us, and writable by nobody else
function readTrusted(file) {
  const st = fs.statSync(file)
  if (!st.isFile()) throw new Error('not a regular file')
  if (st.size > MAX_BYTES) throw new Error('too large')
  const me = typeof process.getuid === 'function' ? process.getuid() : 0
  if (st.uid !== 0 && st.uid !== me) throw new Error('owned by another user')
  if (st.mode & 0o022) throw new Error('writable by group or others')
  return fs.readFileSync(file, 'utf8')
}

const SWITCH_VALUES = Object.freeze({ ask: ['on', 'off'], model: ['on', 'off'], detect: ['off', 'dry', 'on'] })

// The switch as {ask, model, detect, ok, problem}; anything wrong turns every key off
function parseSwitch(text) {
  const seen = {}
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    for (const token of line.split(/\s+/)) {
      const m = /^([a-z]+)=([a-z]+)$/.exec(token)
      if (!m) return { ...OFF, ok: false, problem: 'malformed token' }
      const [, key, value] = m
      if (!SWITCH_VALUES[key]) return { ...OFF, ok: false, problem: `unknown key ${key}` }
      if (!SWITCH_VALUES[key].includes(value)) return { ...OFF, ok: false, problem: `unknown value for ${key}` }
      if (key in seen && seen[key] !== value) return { ...OFF, ok: false, problem: `${key} given twice` }
      seen[key] = value
    }
  }
  return { ask: seen.ask === 'on', model: seen.model === 'on', detect: seen.detect || 'off', ok: true, problem: null }
}

function readSwitch(file = switchPath()) {
  let text
  try { text = readTrusted(file) } catch (err) {
    return { ...OFF, ok: false, problem: err.code === 'ENOENT' ? 'missing' : `unreadable (${err.code || err.message})` }
  }
  return parseSwitch(text)
}

const int = (v, min, max) => (/^-?\d{1,9}$/.test(v) && Number(v) >= min && Number(v) <= max ? Number(v) : undefined)

// Each key's check: the parsed value, or undefined to keep the code default (and name the key in problems)
const KEYS = Object.freeze({
  DRAGONBARON_AI_URL: ['url', v => {
    const m = /^(https?:\/\/[A-Za-z0-9.-]{1,253}(?::\d{1,5})?)\/?$/.exec(v)
    return m ? m[1] : undefined
  }],
  DRAGONBARON_AI_MODEL: ['model', v => (/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/.test(v) ? v : undefined)],
  DRAGONBARON_AI_NUM_CTX: ['numCtx', v => int(v, 2048, 262144)],
  // An integer is sent as a JSON number (-1 keeps the model loaded); a duration such as 24h stays a string
  DRAGONBARON_AI_KEEP_ALIVE: ['keepAlive', v => (/^-?\d{1,9}$/.test(v) ? Number(v) : /^\d{1,6}(?:ms|s|m|h)$/.test(v) ? v : undefined)],
  DRAGONBARON_AI_TIMEOUT_MS: ['timeoutMs', v => int(v, 1000, 300000)],
  DRAGONBARON_AI_PROBE_MS: ['probeMs', v => int(v, 200, 30000)],
  DRAGONBARON_ASK_PER_MIN: ['askPerMin', v => int(v, 0, 1000)],
  DRAGONBARON_ASK_PER_HOUR: ['askPerHour', v => int(v, 0, 10000)],
  DRAGONBARON_ASK_SITE_PER_HOUR: ['askSitePerHour', v => int(v, 0, 100000)],
})

// KEY=VALUE lines into settings; keys of the detector (and anything else) are left alone, so one file serves both parts
function parseSettings(text) {
  const out = { ...DEFAULTS }
  const problems = []
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (!m) { problems.push('a malformed line'); continue }
    const spec = KEYS[m[1]]
    if (!spec) continue
    // A trailing " # note" is a comment, as in the SPEC's own example
    const value = m[2].replace(/\s+#.*$/, '').trim()
    const [field, check] = spec
    const parsed = value === '' ? undefined : check(value)
    if (parsed === undefined) { if (value !== '') problems.push(m[1]); continue }
    out[field] = parsed
  }
  out.problems = problems
  return Object.freeze(out)
}

let cache = null

// The settings, re-read at most once a minute; a missing file gives the code defaults (model URL '' = model unavailable)
function readSettings(file = envPath(), { now = Date.now } = {}) {
  const t = now()
  if (cache && cache.file === file && t - cache.at < CACHE_MS && t >= cache.at) return cache.value
  let value
  try {
    value = parseSettings(readTrusted(file))
  } catch (err) {
    value = Object.freeze({ ...DEFAULTS, problems: [err.code === 'ENOENT' ? 'missing' : `unreadable (${err.code || err.message})`] })
  }
  cache = { file, at: t, value }
  return value
}

module.exports = {
  readSettings, readSwitch, parseSettings, parseSwitch, ENV_FILE, SWITCH_FILE, DEFAULTS,
  _resetCache: () => { cache = null },
}
