'use strict'
// Free text from a punishment record (a reason, a "by"), made safe to show staff: one line, capped, with no Discord
// mention or id, address, email or secret left in it

const RULES = require('../scrub-rules.json')

const rule = id => {
  const r = RULES.find(x => x.id === id)
  if (!r) throw new Error(`scrub rule ${id} is missing`)
  return new RegExp(r.pattern, r.flags.includes('g') ? r.flags : `${r.flags}g`)
}
const replacementOf = id => RULES.find(x => x.id === id).replacement

const STEPS = [
  [/<(?:@[!&]?|#)\d{1,22}>/g, '[id]'],
  ...['S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10'].map(id => [rule(id), replacementOf(id)]),
  [rule('S12'), '[email]'],
  [rule('S16'), '[address]'], [rule('S17'), '[address]'], [rule('S18'), '[address]'],
  [/\d{15,}/g, '[id]'],
]
// Controls, C1, zero-width, line and paragraph separators and bidi marks
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g

function scrub(value, max = 300) {
  if (value === undefined || value === null || typeof value === 'object') return null
  let text = String(value).replace(UNSAFE, ' ')
  for (const [rx, to] of STEPS) text = text.replace(rx, to)
  text = text.replace(/\s+/g, ' ').trim()
  const chars = [...text]
  if (!chars.length) return null
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}\u2026` : text
}

module.exports = { scrub }
