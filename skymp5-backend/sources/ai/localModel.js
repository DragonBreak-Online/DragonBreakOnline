'use strict'
// The local Ollama model (SPEC 0.3): a cached probe, one chat call with a hard deadline, and a single-flight queue
// It never sends load-time options (num_gpu, num_batch, num_thread, main_gpu, use_mmap) and never logs the URL

const PROBE_OK_MS = 30 * 1000
const MAX_REPLY_BYTES = 1024 * 1024
const ns = v => (Number.isFinite(v) ? Math.round(v / 1e6) : null)

// A timeout signal on a normal timer (AbortSignal.timeout's timer does not hold the process open); done() clears it
function deadline(ms, outer) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), Math.max(1, ms))
  const signal = outer ? AbortSignal.any([ctl.signal, outer]) : ctl.signal
  return { signal, done: () => clearTimeout(timer) }
}

class Outcome extends Error {
  constructor(outcome, detail) { super(outcome); this.outcome = outcome; this.detail = detail }
}

// Settles with the promise, or rejects as soon as the signal aborts, even when the promise ignores the signal
function untilAbort(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new Outcome('timeout'))
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Outcome('timeout'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(v => { signal.removeEventListener('abort', onAbort); resolve(v) },
      e => { signal.removeEventListener('abort', onAbort); reject(e) })
  })
}

async function readJson(res, signal) {
  const text = await untilAbort(res.text(), signal)
  if (text.length > MAX_REPLY_BYTES) throw new Outcome('http', 'reply too large')
  try { return JSON.parse(text) } catch { throw new Outcome('http', 'reply is not JSON') }
}

const failure = (err, signal) => {
  if (err instanceof Outcome) return err.outcome
  if (signal?.aborted || err?.name === 'AbortError' || err?.name === 'TimeoutError') return 'timeout'
  return 'unreachable'
}

function createLocalModel({ settings, fetch = globalThis.fetch, now = Date.now }) {
  const current = typeof settings === 'function' ? settings : () => settings
  let probeOk = null

  async function probe() {
    const s = current()
    if (!s.url) return { ok: false, outcome: 'unreachable', reason: 'no url' }
    const t = now()
    if (probeOk && probeOk.url === s.url && t - probeOk.at < PROBE_OK_MS && t >= probeOk.at) return { ok: true, outcome: 'ok', version: probeOk.version, cached: true }
    const { signal, done } = deadline(s.probeMs)
    try {
      const res = await untilAbort(fetch(`${s.url}/api/version`, { method: 'GET', signal }), signal)
      if (!res || res.status !== 200) return { ok: false, outcome: 'unreachable', reason: `http ${res && res.status}` }
      const body = await readJson(res, signal)
      const version = typeof body?.version === 'string' ? body.version.slice(0, 20) : null
      if (!version) return { ok: false, outcome: 'unreachable', reason: 'no version' }
      probeOk = { url: s.url, at: t, version }
      return { ok: true, outcome: 'ok', version }
    } catch (err) {
      probeOk = null
      return { ok: false, outcome: 'unreachable', reason: failure(err, signal) }
    } finally { done() }
  }

  // One /api/chat call; extra holds the repair turn's messages. Outcomes: ok, unreachable, timeout, http
  async function chat({ system, user, extra = [], schema, temperature = 0.2, numPredict = 500, timeoutMs, signal: outer }) {
    const s = current()
    const started = now()
    if (!s.url) return { outcome: 'unreachable', ms: 0 }
    const { signal, done } = deadline(timeoutMs || s.timeoutMs, outer)
    const body = {
      model: s.model, stream: false, think: false, keep_alive: s.keepAlive, format: schema,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }, ...extra],
      options: { num_ctx: s.numCtx, temperature, num_predict: numPredict, presence_penalty: 0 },
    }
    try {
      const res = await untilAbort(fetch(`${s.url}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
      }), signal)
      if (!res || res.status !== 200) return { outcome: 'http', status: res && res.status, ms: now() - started }
      const reply = await readJson(res, signal)
      const content = typeof reply?.message?.content === 'string' ? reply.message.content : ''
      return {
        outcome: 'ok', content, ms: now() - started, loadMs: ns(reply.load_duration), totalMs: ns(reply.total_duration),
        promptTokens: Number.isFinite(reply.prompt_eval_count) ? reply.prompt_eval_count : null,
        evalTokens: Number.isFinite(reply.eval_count) ? reply.eval_count : null,
      }
    } catch (err) {
      return { outcome: failure(err, signal), ms: now() - started }
    } finally { done() }
  }

  return { probe, chat }
}

// One model call at a time per backend; with maxWaiting already queued, run() answers {busy: true} at once
function createSingleFlight({ maxWaiting = 2 } = {}) {
  let running = false
  const queue = []

  function pump() {
    if (running) return
    const job = queue.shift()
    if (!job) return
    running = true
    job.start()
  }

  function run(fn, { signal } = {}) {
    if ((running ? 1 : 0) + queue.length > maxWaiting) return Promise.resolve({ busy: true })
    return new Promise(resolve => {
      const job = {
        start: () => {
          if (signal) signal.removeEventListener('abort', job.drop)
          Promise.resolve().then(() => (signal?.aborted ? { timeout: true } : fn()))
            .then(v => resolve({ value: v }), err => resolve({ error: err }))
            .finally(() => { running = false; pump() })
        },
        drop: () => {
          const i = queue.indexOf(job)
          if (i >= 0) { queue.splice(i, 1); resolve({ timeout: true }) }
        },
      }
      if (signal) {
        if (signal.aborted) return resolve({ timeout: true })
        signal.addEventListener('abort', job.drop, { once: true })
      }
      queue.push(job)
      pump()
    })
  }

  return { run, get waiting() { return queue.length }, get running() { return running } }
}

module.exports = { createLocalModel, createSingleFlight, deadline }
