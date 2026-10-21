'use strict'

/**
 * The official Server Rules (sources/serverRules.js), public and read-only. Mounted at /api/files/rules, because the
 * public proxy forwards /api/files (the older /api/rules, the dashboard's rules.json, is not forwarded).
 *   GET /                 cacheable JSON: { version, effective, changes: [lines], rules } (the text is markdown)
 *   GET /server-rules.md  the same text as text/markdown, for people and for the website build
 * 429 when rate limited, 503 when the rules cannot be read. The staff handbook beside them is never served.
 */

const express = require('express')
const { rateLimit, ipKeyGenerator } = require('express-rate-limit')
const serverRules = require('../sources/serverRules')
const { visitorIp } = require('../sources/visitorIp')

const router = express.Router()

const textLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 120,
  keyGenerator: req => `ip:${ipKeyGenerator(visitorIp(req) || req.ip)}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Wait a few minutes and try again.' },
})

function rulesOr503(res) {
  try { return serverRules.currentRules() }
  catch (err) {
    console.error(`[rules] cannot read the Server Rules: ${err.message}`)
    res.set('Cache-Control', 'no-store').status(503).json({ error: 'rulesUnavailable' })
    return null
  }
}

router.get('/', textLimiter, (_req, res) => {
  const doc = rulesOr503(res)
  if (!doc) return
  res.set('Cache-Control', 'public, max-age=300')
  res.json({ version: doc.version, effective: doc.effective, changes: doc.changes, rules: doc.rules })
})

router.get('/server-rules.md', textLimiter, (_req, res) => {
  const doc = rulesOr503(res)
  if (!doc) return
  res.set('Cache-Control', 'public, max-age=300')
  res.type('text/markdown; charset=utf-8').send(doc.rules)
})

// Nothing else under /api/files/rules falls through to the client files route
router.use((_req, res) => res.status(404).json({ error: 'notFound' }))

module.exports = router
