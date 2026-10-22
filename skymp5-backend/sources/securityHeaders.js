'use strict'
// Response headers that keep any backend answer from running as script on the website origin (remote console review, T3)

const crypto = require('crypto')

// Every response: a JSON or text answer is never sniffed into HTML or script
function nosniff(_req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff')
  next()
}

// Files served from a folder on the website origin: even an HTML or SVG file there runs no script and reaches no cookie
function sandboxed(_req, res, next) {
  res.set('Content-Security-Policy', 'sandbox')
  next()
}

// The CSP source that lets exactly this inline script or style run, and nothing else
function inlineHash(text) {
  return `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`
}

module.exports = { nosniff, sandboxed, inlineHash }
