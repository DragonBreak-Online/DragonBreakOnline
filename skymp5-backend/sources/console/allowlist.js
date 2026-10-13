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

// The classes the game refuses with (console.js), for the commands that are not on the allowlist
const IN_WORLD = new Set(['npc', 'placed', 'jail', 'setweather', 'war', 'region', 'warband', 'raid', 'property', 'dungeon', 'whereami', 'teach'])
const SELF = new Set(['tp', 'gm', 'masktest', 'mv', 'placeundo', 'factiongear', 'tailoring', 'smithing', 'beastform', 'makesuper', 'unstuck', 'appearance'])
const LATER = new Set(['bugs', 'update', 'schedule'])
const BUILTIN = new Set(['say', 'low', 'whisper', 'wide', 'shout', 'me', 'melow', 'melong', 'my', 'mylow', 'mylong', 'do', 'dolow', 'dolong',
  'looc', 'ooc', 'ooclow', 'ooclong', 'pm', 'dm', 'to', 'too', 'system', 'admin'])
// No free-text rule: the only free text an allowed form carries is /rename's name, held to NAME_RE
const RULES = new Set(['switch', 'tag', 'tagName', 'load', 'none'])
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

// allow.json as the game wrote it: [{ name, usage, rule, help }], checked field by field; null when missing or malformed
function parseAllow(text) {
  let list
  try { list = JSON.parse(text) } catch { return null }
  if (!Array.isArray(list) || list.length > 50) return null
  const out = []
  for (const x of list) {
    if (!x || typeof x !== 'object' || typeof x.name !== 'string' || !/^[a-z]{2,24}$/.test(x.name) || !RULES.has(x.rule)) return null
    out.push({ name: x.name, rule: x.rule, usage: foldText(x.usage, 80), help: foldText(x.help, 200) })
  }
  return out
}

// The pre-check: null when the line passes the published rules, else { why, cmd }. Mirrors console.js checkLine
function precheck(text, allow) {
  const m = /^\/([a-z]{2,24})(?: (.*))?$/.exec(text || '')
  if (!m) return { why: 'notChat', cmd: '' }
  const cmd = m[1]
  const words = m[2] === undefined ? [] : m[2].split(' ')
  const entry = allow.find(a => a.name === cmd)
  if (!entry) {
    if (BUILTIN.has(cmd)) return { why: 'notChat', cmd }
    return { why: IN_WORLD.has(cmd) ? 'inWorld' : SELF.has(cmd) ? 'self' : LATER.has(cmd) ? 'later' : 'notYet', cmd }
  }
  const refuse = why => ({ why, cmd })
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
    default: return refuse('notYet')
  }
}

// What the admin reads for a refusal class (the game's own wording, console.js TEXT)
function whyText(why, cmd, usage) {
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
    default: return 'That cannot be run from the console.'
  }
}

module.exports = {
  cleanCommand, foldText, cleanHandle, parseSwitch, reqPayload, repPayload, canonLines, id8, parseAllow, precheck, whyText,
  UNSAFE_RE, MAX_TEXT, SETTINGS, SOURCES, SNOWFLAKE, HANDLE_RE, UUID_RE, REQUEST_ID_RE,
}
