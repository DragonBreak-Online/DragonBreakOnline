'use strict'
// The site sign-in's OAuth states, held by the server: single use, 10 minutes, keyed by the state's SHA-256, with the flow that issued it

const crypto = require('crypto')

// Both flows send prompt=consent
const FLOWS = Object.freeze(['login', 'fresh'])
const STATE_RE = /^[0-9a-f]{64}$/
// Every request without a visitor address (a direct request to the backend, a test) counts as this one visitor
const NO_ADDRESS = '-'

// One visitor holds at most perVisitor states, so a flood from one address never pushes out another address's state; visitorOf maps an address to its visitor
function createStateStore({ ttlMs = 10 * 60 * 1000, max = 10000, perVisitor = 10, now = Date.now, visitorOf = ip => ip } = {}) {
  if (!Number.isInteger(perVisitor) || perVisitor < 1) throw new Error('perVisitor must be a positive integer')
  // Insertion order is issue order, so the oldest are at the front
  const states = new Map()
  // visitor -> the keys of its outstanding states, oldest first
  const byVisitor = new Map()
  // holding[n]: the visitors holding exactly n states, in the order they came to hold n
  const holding = Array.from({ length: perVisitor + 1 }, () => new Set())
  const hash = state => crypto.createHash('sha256').update(state, 'utf8').digest('hex')
  const first = iterable => iterable.values().next().value

  function add(key, rec) {
    let keys = byVisitor.get(rec.visitor)
    if (keys) holding[keys.size].delete(rec.visitor)
    else byVisitor.set(rec.visitor, keys = new Set())
    keys.add(key)
    holding[keys.size].add(rec.visitor)
    states.set(key, rec)
  }

  function remove(key) {
    const rec = states.get(key)
    if (!rec) return null
    states.delete(key)
    const keys = byVisitor.get(rec.visitor)
    holding[keys.size].delete(rec.visitor)
    keys.delete(key)
    if (keys.size) holding[keys.size].add(rec.visitor)
    else byVisitor.delete(rec.visitor)
    return rec
  }

  function prune() {
    const t = now()
    for (const [k, rec] of states) {
      if (t - rec.at < ttlMs) break
      remove(k)
    }
  }

  // Past the cap, the oldest state of the visitor holding the most goes, so a visitor with fewer is never pushed out by one with more
  function evictFromHeaviest() {
    for (let n = perVisitor; n > 0; n--) {
      const visitor = first(holding[n])
      if (visitor === undefined) continue
      remove(first(byVisitor.get(visitor)))
      return
    }
  }

  function visitorKey(ip) {
    if (typeof ip !== 'string' || !ip) return NO_ADDRESS
    try { const v = visitorOf(ip); return typeof v === 'string' && v ? v : ip } catch { return ip }
  }

  // A new random state, recorded with its flow and the visitor address it went to (null when the request had none)
  function issue(flow, ip) {
    if (!FLOWS.includes(flow)) throw new Error(`unknown sign-in flow: ${flow}`)
    prune()
    const visitor = visitorKey(ip)
    const own = byVisitor.get(visitor)
    // A visitor at its limit makes room from its own oldest, never from anyone else's
    if (own && own.size >= perVisitor) remove(first(own))
    else if (states.size >= max) evictFromHeaviest()
    const state = crypto.randomBytes(32).toString('hex')
    add(hash(state), { flow, ip: typeof ip === 'string' && ip ? ip : null, visitor, at: now() })
    return state
  }

  // The record of a state issued here less than ttlMs ago, removed so it never works twice; else null
  function take(state) {
    if (typeof state !== 'string' || !STATE_RE.test(state)) return null
    const rec = remove(hash(state))
    if (!rec) return null
    return now() - rec.at < ttlMs ? { flow: rec.flow, ip: rec.ip, at: rec.at } : null
  }

  const heldBy = ip => { const keys = byVisitor.get(visitorKey(ip)); return keys ? keys.size : 0 }

  return { issue, take, size: () => states.size, heldBy }
}

module.exports = { createStateStore, FLOWS, NO_ADDRESS }
