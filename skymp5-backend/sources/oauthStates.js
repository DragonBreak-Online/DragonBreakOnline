'use strict'
// The site sign-in's OAuth states, held by the server: single use, 10 minutes, keyed by the state's SHA-256, with the flow that issued it

const crypto = require('crypto')

// Both flows send prompt=consent
const FLOWS = Object.freeze(['login', 'fresh'])
const STATE_RE = /^[0-9a-f]{64}$/

function createStateStore({ ttlMs = 10 * 60 * 1000, max = 10000, now = Date.now } = {}) {
  // Insertion order is issue order, so the oldest are at the front
  const states = new Map()
  const hash = state => crypto.createHash('sha256').update(state, 'utf8').digest('hex')

  function prune() {
    const t = now()
    for (const [k, rec] of states) {
      if (t - rec.at < ttlMs) break
      states.delete(k)
    }
  }

  // A new random state, recorded with its flow and the visitor address it went to (null when the request had none)
  function issue(flow, ip) {
    if (!FLOWS.includes(flow)) throw new Error(`unknown sign-in flow: ${flow}`)
    prune()
    // Past the cap the oldest go first, so a flood of /login cannot grow memory
    while (states.size >= max) states.delete(states.keys().next().value)
    const state = crypto.randomBytes(32).toString('hex')
    states.set(hash(state), { flow, ip: typeof ip === 'string' && ip ? ip : null, at: now() })
    return state
  }

  // The record of a state issued here less than ttlMs ago, removed so it never works twice; else null
  function take(state) {
    if (typeof state !== 'string' || !STATE_RE.test(state)) return null
    const key = hash(state)
    const rec = states.get(key)
    if (!rec) return null
    states.delete(key)
    return now() - rec.at < ttlMs ? { flow: rec.flow, ip: rec.ip, at: rec.at } : null
  }

  return { issue, take, size: () => states.size }
}

module.exports = { createStateStore, FLOWS }
