'use strict'
// Every line Dragonbaron ask shows is cleaned here: unsafe characters, mentions, the punishment scrub, then internal names

const { scrub } = require('../punish/scrub')

// The same set as sources/punish/scrub.js: controls, C1, zero-width, line and paragraph separators and bidi marks
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g
const ZWSP = '\u200b'

const BLOCK = Object.freeze([
  /\b(?:10\.10\.10\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|127\.0\.0\.1|localhost|ai\.lan)\b/gi,
  /\bclaude-[a-z0-9-]+\b/gi,
  /\bCT ?\d{3}\b/g,
  /\b[A-Z][A-Z0-9_]{2,}_(?:TOKEN|KEY|SECRET|PASSWORD|URL|IDS?)\b/g,
  /(?:^|\s)\/(?:opt|etc|root|var|home|run|tmp)\/\S*/g,
  /backend\.env|console\.env|\.env\b/gi,
  /\bhttps?:\/\/\S+/gi,
])

const PLACEHOLDER = /\[(?:id|email|address|hidden)\]|<(?:user|redacted|token-redacted)>/g
const count = (text, rx) => (String(text).match(rx) || []).length

function defuseMentions(text) {
  return String(text ?? '')
    .replace(/<@!?\d{1,22}>/g, '@user')
    .replace(/<@&\d{1,22}>/g, '@role')
    .replace(/@(everyone|here)/gi, `@${ZWSP}$1`)
}

function scrubLine(line, max) {
  let hits = 0
  let text = defuseMentions(String(line).replace(UNSAFE, ' '))
  const before = count(text, PLACEHOLDER)
  text = scrub(text, max) || ''
  hits += Math.max(0, count(text, PLACEHOLDER) - before)
  for (const rx of BLOCK) {
    text = text.replace(rx, m => { hits++; return /^\s/.test(m) ? `${m[0]}[hidden]` : '[hidden]' })
  }
  // The scrub turns the zero-width space into a space, so a mention is defused again at the end
  text = text.replace(/@(everyone|here)/gi, `@${ZWSP}$1`)
  return { text, hits }
}

// Per line, because the scrub collapses whitespace; blank lines are kept
function scrubAnswer(text, { max = 1900 } = {}) {
  let hits = 0
  const lines = String(text ?? '').split(/\r\n|\r|\n|\u2028|\u2029/).map(line => {
    if (!line.trim()) return ''
    const r = scrubLine(line, max)
    hits += r.hits
    return r.text
  })
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), hits }
}

module.exports = { scrubAnswer, defuseMentions, BLOCK, UNSAFE }
