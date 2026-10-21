'use strict'
// The remote console's text rules, kept the same as the game's console.js; the game checks again and has the last word

const { UNSAFE_CHARS } = require('../problemReport')

// The report cleaner's characters plus C1 controls and the Arabic letter mark, as serverControl.js cleans a reason
const UNSAFE_RE = new RegExp(`[${UNSAFE_CHARS}\\x80-\\x9f${String.fromCharCode(0x061c)}]`, 'g')
const MAX_TEXT = 500
const SETTINGS = Object.freeze(['off', 'dry-run', 'on'])
const SOURCES = Object.freeze(['web', 'discord'])
const SNOWFLAKE = /^\d{17,20}$/
const HANDLE_RE = /^[a-z0-9_.]{2,32}$/
const TAG_RE = /^#[A-Za-z0-9]{4}$/
const NAME_RE = /^[A-Za-z][A-Za-z' -]{1,30}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REQUEST_ID_RE = /^(w-[0-9a-f-]{36}|d-\d{17,20})$/
// A /discipline reason after cleanCommand: plain letters, digits and . , ; : ! ? ' " ( ) - / & + %, BMP only, 5 to 300 (console.js REASON_RE)
const REASON_RE = /^[\p{L}\p{N} .,;:!?'"()\/&+%-]+$/u
const ASTRAL_RE = /[\ud800-\udfff]/
// The four letters that draw nothing, the Hangul fillers (console.js BLANK_RE)
const BLANK_RE = /[\u115f\u1160\u3164\uffa0]/
const REASON_MIN = 5
const REASON_MAX = 300
// The record kinds and the word each takes before its reason (console.js KIND_ARGS); allow.json can only narrow them
const KIND_ARGS = Object.freeze({ warn: 'none', strike: 'none', suspend: 'length', lift: 'none', overturn: 'record' })
const LENGTH_RE = /^(?:([1-9][0-9]{0,2})h|([1-9][0-9]?)d)$/
const RECORD_RE = /^[1-9][0-9]{0,4}$/
// A line break typed into a reason line is refused, not folded into the reason
const LINE_BREAK_RE = /[\n\r\u000b\u000c\u0085\u2028\u2029]/

// The classes the game refuses with (console.js), for the commands that are not on the allowlist
const IN_WORLD = new Set(['npc', 'placed', 'jail', 'setweather', 'war', 'region', 'warband', 'raid', 'property', 'dungeon', 'whereami', 'teach'])
const SELF = new Set(['tp', 'gm', 'masktest', 'mv', 'placeundo', 'factiongear', 'tailoring', 'smithing', 'beastform', 'makesuper', 'unstuck', 'appearance'])
const LATER = new Set(['bugs', 'update', 'schedule'])
const BUILTIN = new Set(['say', 'low', 'whisper', 'wide', 'shout', 'me', 'melow', 'melong', 'my', 'mylow', 'mylong', 'do', 'dolow', 'dolong',
  'looc', 'ooc', 'ooclow', 'ooclong', 'pm', 'dm', 'to', 'too', 'system', 'admin'])
// No 'any' rule (review SEC-2); the only free text is /rename's name (NAME_RE) and /discipline's reason (REASON_RE)
const RULES = new Set(['switch', 'tag', 'tagName', 'load', 'none', 'tagKindReason'])
// The empty form of a #TAG command: /kick needs a target, /fixloc and /chargen alone act on the caller
const NO_ARG = Object.freeze({ kick: 'needTag', fixloc: 'self', chargen: 'self' })

// One clean '/word rest' line of at most 500 characters with '#{' broken, or null when it is not a command
function cleanCommand(value) {
  if (typeof value !== 'string') return null
  let t = value.normalize('NFC').replace(UNSAFE_RE, ' ').replace(/\s+/g, ' ').trim()
  if (/^[A-Za-z]/.test(t)) t = `/${t}`
  if (t.length > MAX_TEXT) return null
  const m = /^\/([A-Za-z]{2,24})(?: (.*))?$/.exec(t)
  if (!m) return null
  return `/${m[1].toLowerCase()}${m[2] !== undefined ? ` ${m[2]}` : ''}`.split('#{').join('# {')
}

// Text for a log line even when it is not a command: the same folding, one line, cut
function foldText(value, max = 120) {
  const t = String(value ?? '').normalize('NFC').replace(UNSAFE_RE, ' ').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}...` : t
}

// A Discord username by the current username rule, else 'unknown'; never a display name, which could fake an audit line
function cleanHandle(value) {
  const h = typeof value === 'string' ? value.normalize('NFC') : ''
  return HANDLE_RE.test(h) ? h : 'unknown'
}

// 'off | dry-run | on' then web= and discord= that only narrow it, in at most 64 bytes; anything else is off for both
function parseSwitch(text) {
  const OFF = { web: 'off', discord: 'off' }
  if (typeof text !== 'string' || Buffer.byteLength(text) > 64) return OFF
  const body = text.replace(/\r?\n$/, '')
  if (/[\r\n]/.test(body)) return OFF
  const words = body.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length || !SETTINGS.includes(words[0])) return OFF
  const out = { web: words[0], discord: words[0] }
  const keys = new Set()
  for (const w of words.slice(1)) {
    const m = /^(web|discord)=(off|dry-run|on)$/.exec(w)
    if (!m || keys.has(m[1])) return OFF
    keys.add(m[1])
    if (SETTINGS.indexOf(m[2]) < SETTINGS.indexOf(out[m[1]])) out[m[1]] = m[2]
  }
  return out
}

const reqPayload = r => `dbo-console-req-v1\n${JSON.stringify([r.v, r.id, r.src, r.discordId, r.user, r.profileId, r.roles, r.text, r.mode, r.issuedAt, r.expiresAt])}`
const canonLines = lines => lines.map(l => ({ to: String(l.to), text: String(l.text) }))
const repPayload = r => `dbo-console-rep-v1\n${JSON.stringify([r.v, r.id, r.state, r.gate, r.ranAs, r.online, r.tier, r.target, canonLines(r.lines), r.why, r.at])}`
// The 8 characters every audit line carries, so the backend and game records join up: a UUID's first 8, an interaction's last 8
const id8 = id => (String(id).startsWith('w-') ? String(id).slice(2, 10) : String(id).slice(-8))

// A tagKindReason entry's known kinds, each once, plus maxSuspendDays when a kind takes a length; null when malformed
function kindsEntry(x) {
  const kinds = x.kinds
  if (!Array.isArray(kinds) || !kinds.length || kinds.length > Object.keys(KIND_ARGS).length) return null
  if (!kinds.every(k => typeof k === 'string' && Object.prototype.hasOwnProperty.call(KIND_ARGS, k)) || new Set(kinds).size !== kinds.length) return null
  if (!kinds.some(k => KIND_ARGS[k] === 'length')) return { kinds: [...kinds] }
  const max = x.maxSuspendDays
  return typeof max === 'number' && Number.isFinite(max) && max * 24 >= 1 && max <= 365 ? { kinds: [...kinds], maxSuspendDays: max } : null
}

// allow.json as the game wrote it, checked field by field; null when missing or malformed (the game then decides alone)
function parseAllow(text) {
  let list
  try { list = JSON.parse(text) } catch { return null }
  if (!Array.isArray(list) || list.length > 50) return null
  const out = []
  for (const x of list) {
    if (!x || typeof x !== 'object' || typeof x.name !== 'string' || !/^[a-z]{2,24}$/.test(x.name) || !RULES.has(x.rule)) return null
    const entry = { name: x.name, rule: x.rule, usage: foldText(x.usage, 160), help: foldText(x.help, 200) }
    if (x.rule === 'tagKindReason') {
      const k = kindsEntry(x)
      if (!k) return null
      Object.assign(entry, k)
    }
    out.push(entry)
  }
  return out
}

// A suspension's length word -> whole hours, else 0 (console.js lengthHours)
function lengthHours(word, maxDays) {
  const m = LENGTH_RE.exec(String(word || '').toLowerCase())
  if (!m) return 0
  const h = m[1] ? Number(m[1]) : Number(m[2]) * 24
  return h * 3600000 <= maxDays * 86400000 ? h : 0
}
// What is wrong with a reason, or '' (console.js reasonWhy)
function reasonWhy(reason) {
  if (!reason) return 'reasonShort'
  if (ASTRAL_RE.test(reason) || BLANK_RE.test(reason) || !REASON_RE.test(reason)) return 'reasonChars'
  if (reason.length < REASON_MIN) return 'reasonShort'
  return reason.length > REASON_MAX ? 'reasonLong' : ''
}
const lengthWords = maxDays => {
  const h = Math.floor(maxDays * 24)
  const d = Math.floor(maxDays)
  return d >= 1 ? `1h to ${h}h or 1d to ${d}d` : `1h to ${h}h`
}

// The pre-check: null when the line passes, else { why, cmd, subject? }; raw is the text as typed. Mirrors console.js checkLine
function precheck(text, allow, raw) {
  const m = /^\/([a-z]{2,24})(?: (.*))?$/.exec(text || '')
  if (!m) return { why: 'notChat', cmd: '' }
  const cmd = m[1]
  const words = m[2] === undefined ? [] : m[2].split(' ')
  const entry = allow.find(a => a.name === cmd)
  if (!entry) {
    if (BUILTIN.has(cmd)) return { why: 'notChat', cmd }
    return { why: IN_WORLD.has(cmd) ? 'inWorld' : SELF.has(cmd) ? 'self' : LATER.has(cmd) ? 'later' : 'notYet', cmd }
  }
  const refuse = (why, subject) => (subject === undefined ? { why, cmd } : { why, cmd, subject })
  switch (entry.rule) {
    case 'switch': {
      const v = (words[0] || '').toLowerCase()
      if (!words.length || ((v === 'on' || v === 'off') && words.length === 1)) return null
      if (v === 'clear') return words.length === 2 && TAG_RE.test(words[1]) ? null : refuse('needTag')
      return refuse('badArgs')
    }
    case 'tag':
      if (!words.length) return refuse(NO_ARG[cmd] || 'needTag')
      return words.length === 1 && TAG_RE.test(words[0]) ? null : refuse('needTag')
    case 'tagName':
      if (!words.length || !TAG_RE.test(words[0])) return refuse(words.length ? 'needTag' : 'badArgs')
      if (words.length < 2) return refuse('badArgs')
      return NAME_RE.test(words.slice(1).join(' ')) ? null : refuse('badName')
    case 'load': return !words.length || (words.length === 1 && words[0].toLowerCase() === 'reset') ? null : refuse('badArgs')
    case 'none': return words.length ? refuse('badArgs') : null
    case 'tagKindReason': {
      if (typeof raw === 'string' && LINE_BREAK_RE.test(raw.trim())) return refuse('oneLine')
      const kinds = Array.isArray(entry.kinds) ? entry.kinds : []
      const maxDays = typeof entry.maxSuspendDays === 'number' ? entry.maxSuspendDays : 0
      if (!words.length || !TAG_RE.test(words[0])) return words.length && words[0].toLowerCase() !== 'list' ? refuse('needTag') : refuse('badKind')
      const kind = (words[1] || '').toLowerCase()
      if (!Object.prototype.hasOwnProperty.call(KIND_ARGS, kind)) return refuse('badKind')
      // A kind the game left out of allow.json is denied by its config
      if (!kinds.includes(kind)) return refuse('denied', `${cmd} ${kind}`)
      const arg = KIND_ARGS[kind]
      if (arg === 'length' && !lengthHours(words[2], maxDays)) return refuse('badLength', maxDays)
      if (arg === 'record' && !RECORD_RE.test(words[2] || '')) return refuse('badRecord')
      const why = reasonWhy(words.slice(arg === 'none' ? 2 : 3).join(' '))
      return why ? refuse(why) : null
    }
    default: return refuse('notYet')
  }
}

// What the admin reads for a refusal class (the game's own wording, console.js TEXT); subject from precheck
function whyText(why, cmd, usage, subject) {
  switch (why) {
    case 'needTag': return 'Name the player by #TAG from the console.'
    case 'inWorld': return `/${cmd} needs you standing in the world. Run it in game.`
    case 'self': return `/${cmd} acts on your own character. Run it in game.`
    case 'later': return `/${cmd} answers later. That is not in the console yet.`
    case 'notChat': return cmd === 'system' ? 'Only staff commands can be run from the console. Use /announce when it comes to the console.'
      : 'Only staff commands can be run from the console.'
    case 'notYet': return `/${cmd} is not available from the console in v1.`
    case 'badArgs': return `From the console: ${usage || `/${cmd}`}`
    case 'badName': return 'Names: 2-31 letters, spaces, apostrophes or hyphens, starting with a letter.'
    case 'badKind': return `From the console: ${usage || `/${cmd}`}. A player's record and /discipline list stay in game.`
    case 'badLength': return `Give a length in whole hours or days, ${lengthWords(Number(subject) || 30)}, like 12h or 3d.`
    case 'badRecord': return 'Give the record number in digits, like overturn 3 <reason>. /discipline #TAG in game shows the record.'
    case 'oneLine': return 'From the console: one line of at most 500 characters.'
    case 'reasonShort': return `Give a reason of at least ${REASON_MIN} characters. The player is shown it.`
    case 'reasonLong': return `The reason can be at most ${REASON_MAX} characters.`
    case 'reasonChars': return 'A reason from the console takes letters, numbers, spaces and . , ; : ! ? \' " ( ) - / & + % only: no colour codes, markup, mentions, symbols or line breaks.'
    case 'denied': return `/${subject || cmd} is switched off for the console in the game's config.`
    default: return 'That cannot be run from the console.'
  }
}

module.exports = {
  cleanCommand, foldText, cleanHandle, parseSwitch, reqPayload, repPayload, canonLines, id8, parseAllow, precheck, whyText,
  lengthHours, reasonWhy,
  UNSAFE_RE, MAX_TEXT, SETTINGS, SOURCES, SNOWFLAKE, HANDLE_RE, UUID_RE, REQUEST_ID_RE, KIND_ARGS, REASON_RE,
}
