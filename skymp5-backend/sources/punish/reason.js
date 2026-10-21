'use strict'
// The reason staff give for a punishment, the same rule as the console's /discipline reason (allowlist.js reasonWhy, which
// is console.js's): after NFC, unsafe characters to spaces and whitespace folded, letters, digits, space and
// . , ; : ! ? ' " ( ) - / & + % only, no Hangul filler (a letter that draws nothing), nothing outside the BMP, 5 to 300 by
// String.length. So no colour code, markup, mention or blank-looking reason reaches Discord or a record.

const { UNSAFE_RE, REASON_RE, reasonWhy } = require('../console/allowlist')
const { scrub } = require('./scrub')

const REASON_MIN = 5
const REASON_MAX = 300

// { reason } when it passes, else { why }: reasonShort, reasonChars and reasonLong from the console's own reasonWhy, and
// reasonPrivate for a Discord id, address, email or secret, which the panel would hide (punish/scrub.js)
function cleanReason(value) {
  if (typeof value !== 'string') return { why: 'reasonShort' }
  const reason = value.normalize('NFC').replace(UNSAFE_RE, ' ').replace(/\s+/g, ' ').trim()
  const why = reasonWhy(reason)
  if (why) return { why }
  if (scrub(reason, REASON_MAX) !== reason) return { why: 'reasonPrivate' }
  return { reason }
}

module.exports = { cleanReason, REASON_RE, REASON_MIN, REASON_MAX }
