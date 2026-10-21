'use strict'
// When the window's background checks run: each on its own timer, held while paused, run at once on a nudge, slower after failures
;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.dboPollPlan = api
})(typeof self !== 'undefined' ? self : this, function () {
  // A failing check waits twice as long each time, up to 5 minutes; an interval longer than that is never shortened
  const BACKOFF_CAP_MS = 300_000
  // Each wait is the interval give or take 10%, so launchers started together drift apart
  const JITTER = 0.1

  function retryDelay(everyMs, failures) {
    return Math.min(everyMs * 2 ** failures, Math.max(everyMs, BACKOFF_CAP_MS))
  }

  // run() resolves false (or throws) on a failure; while paused() a due run waits; nudge() skips a check that succeeded under minGapMs ago
  function createCheck({ run, everyMs, paused = () => false, minGapMs = 0, now = () => Date.now(), random = Math.random }) {
    let timer = null
    let running = null
    let failures = 0
    let lastOkAt = -Infinity

    const jittered = ms => Math.round(ms * (1 - JITTER + 2 * JITTER * random()))
    function plan(ms) {
      clearTimeout(timer)
      timer = setTimeout(due, jittered(ms))
    }
    // A paused check looks again an interval later, so it also resumes without a nudge
    function due() {
      timer = null
      if (paused()) plan(everyMs)
      else runNow()
    }
    // Runs now, or shares the run in flight; the next run is planned from how this one went
    function runNow() {
      if (running) return running
      clearTimeout(timer)
      timer = null
      const startedAt = now()
      running = Promise.resolve().then(run).then(r => r !== false, () => false).then(ok => {
        running = null
        failures = ok ? 0 : failures + 1
        if (ok) lastOkAt = startedAt
        plan(retryDelay(everyMs, failures))
        return ok
      })
      return running
    }
    function nudge() {
      if (running || paused() || now() - lastOkAt < minGapMs) return
      runNow()
    }
    return { start: runNow, runNow, nudge, failures: () => failures }
  }

  return { createCheck, retryDelay, BACKOFF_CAP_MS, JITTER }
})
