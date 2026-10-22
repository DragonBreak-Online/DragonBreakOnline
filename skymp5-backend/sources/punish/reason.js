'use strict'
// A punishment reason: one line after NFC and folding, then the console's own /discipline rule (allowlist.js reasonWhy)

const { UNSAFE_RE, REASON_RE, reasonWhy } = require('../console/allowlist')
const { scrub } = require('./scrub')

const REASON_MIN = 5
const REASON_MAX = 300

// { reason }, else { why }: reasonWhy's codes, or reasonPrivate for an id, address, email or secret (punish/scrub.js)
function cleanReason(value) {
  if (typeof value !== 'string') return { why: 'reasonShort' }
  const reason = value.normalize('NFC').replace(UNSAFE_RE, ' ').replace(/\s+/g, ' ').trim()
  const why = reasonWhy(reason)
  if (why) return { why }
  if (scrub(reason, REASON_MAX) !== reason) return { why: 'reasonPrivate' }
  return { reason }
}

module.exports = { cleanReason, REASON_RE, REASON_MIN, REASON_MAX }
