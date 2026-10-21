'use strict'
// The reason staff give for a punishment, the same rule as the console's /discipline reason (console.js REASON_RE): after
// NFC, unsafe characters to spaces and whitespace folded, letters, digits, space and . , ; : ! ? ' " ( ) - / & + % only,
// nothing outside the BMP, 5 to 300 by String.length. So no colour code, markup or mention reaches Discord or a record.

const { UNSAFE_RE } = require('../console/allowlist')
const { scrub } = require('./scrub')

const REASON_RE = /^[\p{L}\p{N} .,;:!?'"()\/&+%-]+$/u
const ASTRAL_RE = /[\ud800-\udfff]/
const REASON_MIN = 5
const REASON_MAX = 300

// { reason } when it passes, else { why }: reasonShort, reasonChars and reasonLong as the console's reasonWhy, and
// reasonPrivate for a Discord id, address, email or secret, which the panel would hide (punish/scrub.js)
function cleanReason(value) {
  if (typeof value !== 'string') return { why: 'reasonShort' }
  const reason = value.normalize('NFC').replace(UNSAFE_RE, ' ').replace(/\s+/g, ' ').trim()
  if (!reason) return { why: 'reasonShort' }
  if (ASTRAL_RE.test(reason) || !REASON_RE.test(reason)) return { why: 'reasonChars' }
  if (reason.length < REASON_MIN) return { why: 'reasonShort' }
  if (reason.length > REASON_MAX) return { why: 'reasonLong' }
  if (scrub(reason, REASON_MAX) !== reason) return { why: 'reasonPrivate' }
  return { reason }
}

module.exports = { cleanReason, REASON_RE, REASON_MIN, REASON_MAX }
