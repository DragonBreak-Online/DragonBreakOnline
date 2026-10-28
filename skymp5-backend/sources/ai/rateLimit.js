'use strict'
// In-memory limits for /dragonbaron ask: per user a minute and an hour window, and site-wide model calls per hour
// The limits may be numbers or functions, so a settings change applies without a restart

const MIN_MS = 60 * 1000
const HOUR_MS = 60 * MIN_MS
const MAX_USERS = 5000

const value = v => (typeof v === 'function' ? v() : v)

function createLimiter({ perMin = 3, perHour = 20, sitePerHour = 60, now = Date.now } = {}) {
  const users = new Map()
  let model = []

  const recent = (list, t) => list.filter(at => t - at < HOUR_MS && at <= t)

  // {ok: true} or {ok: false, retryMin} when the user is at either limit
  function check(userId) {
    const t = now()
    const list = recent(users.get(userId) || [], t)
    const minute = list.filter(at => t - at < MIN_MS)
    const pm = value(perMin), ph = value(perHour)
    let until = 0
    if (minute.length >= pm) until = Math.max(until, (minute[minute.length - pm] ?? t) + MIN_MS)
    if (list.length >= ph) until = Math.max(until, (list[list.length - ph] ?? t) + HOUR_MS)
    if (!until) return { ok: true }
    return { ok: false, retryMin: Math.max(1, Math.ceil((until - t) / MIN_MS)) }
  }

  function note(userId) {
    const t = now()
    const list = recent(users.get(userId) || [], t)
    list.push(t)
    users.delete(userId)
    users.set(userId, list)
    if (users.size > MAX_USERS) users.delete(users.keys().next().value)
  }

  function modelAllowed() {
    const t = now()
    model = recent(model, t)
    return model.length < value(sitePerHour)
  }

  function noteModel() { model.push(now()) }

  return { check, note, modelAllowed, noteModel }
}

module.exports = { createLimiter }
