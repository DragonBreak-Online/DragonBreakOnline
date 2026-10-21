'use strict'
// The player log's kicks and bans for the Punishments panel, read in one worker thread (playerLogWorker.js) so the request
// loop never waits on a 50 MB day file. Started by the first panel request, then at most once per 30 s. Held in memory only,
// capped, and never older than the days asked (the Privacy Policy's 90 days for server activity logs).

const path = require('path')
const { Worker } = require('worker_threads')

const DAY_MS = 86400000

function createPlayerLog({ dir, days = 90, now = Date.now, minIntervalMs = 30000, retryMs = 5 * 60 * 1000, cap = 20000,
  workerFile = path.join(__dirname, 'playerLogWorker.js') } = {}) {
  const events = new Map()
  let status = dir ? 'idle' : 'off', asOf = null, from = null, worker = null, busy = false
  let lastAt = -Infinity, failedAt = -Infinity, version = 0

  function fail(why) {
    busy = false
    status = 'unreadable'
    failedAt = now()
    console.warn('[site-punish] player log not read:', why)
  }

  function onMessage(m) {
    if (m.type !== 'events') return fail(m.message)
    busy = false
    for (const e of m.events) events.set(`${e.g}:${e.s}`, e)
    const cutoff = now() - days * DAY_MS
    for (const [k, e] of events) if (e.t < cutoff) events.delete(k)
    if (events.size > cap) {
      const keep = [...events.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, cap)
      events.clear()
      for (const [k, e] of keep) events.set(k, e)
    }
    status = 'ok'
    asOf = new Date(now()).toISOString()
    from = m.from
    version++
  }

  function start() {
    worker = new Worker(workerFile, { resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 } })
    worker.unref()
    worker.on('message', onMessage)
    worker.on('error', err => { worker = null; fail(err.message) })
    worker.on('exit', code => { worker = null; if (busy) fail(`worker exited ${code}`) })
  }

  return {
    refresh() {
      if (!dir || busy || now() - lastAt < minIntervalMs) return
      if (status === 'unreadable' && now() - failedAt < retryMs) return
      lastAt = now()
      busy = true
      if (status === 'idle') status = 'loading'
      try {
        if (!worker) start()
        worker.postMessage({ dir, days, now: now() })
      } catch (err) { fail(err.message) }
    },
    view: () => ({ status, asOf, from, days }),
    events: () => ({ version, list: [...events.values()] }),
    stop: () => (worker ? worker.terminate() : Promise.resolve()),
  }
}

module.exports = { createPlayerLog }
