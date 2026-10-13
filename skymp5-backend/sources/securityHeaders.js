'use strict'
// Response headers that keep any backend answer from running as script on the website origin (remote console review, T3)

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

module.exports = { nosniff, sandboxed }
