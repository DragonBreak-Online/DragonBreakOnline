'use strict'
// The local model client (sources/ai/localModel.js) against a fake fetch: the request body, the probe cache, deadlines, single flight

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createLocalModel, createSingleFlight } = require('../sources/ai/localModel')
const { parseSettings, DEFAULTS } = require('../sources/ai/aiSettings')

const URL_ = 'http://model.test:11434'
const SETTINGS = { ...DEFAULTS, url: URL_ }

function fakeFetch(handler) {
  const calls = []
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null })
    return handler(url, init, calls.length)
  }
  return { fn, calls }
}
const reply = (status, body) => ({ status, text: async () => JSON.stringify(body) })
const ok = content => reply(200, { message: { role: 'assistant', content }, load_duration: 2_000_000, total_duration: 900_000_000, prompt_eval_count: 1200, eval_count: 80 })

test('chat sends the SPEC 0.3 body: model, no stream, think off, keep_alive as a number, the schema, num_ctx 16384 and no load options', async () => {
  const f = fakeFetch(url => (url.endsWith('/api/chat') ? ok('{"answerable":true}') : reply(200, { version: '0.30.10' })))
  const m = createLocalModel({ settings: SETTINGS, fetch: f.fn })
  const schema = { type: 'object' }
  const r = await m.chat({ system: 'S', user: 'U', schema, temperature: 0.2, numPredict: 500 })
  assert.equal(r.outcome, 'ok')
  assert.equal(r.content, '{"answerable":true}')
  assert.equal(r.loadMs, 2)
  assert.equal(r.totalMs, 900)
  assert.equal(r.promptTokens, 1200)
  const { url, init, body } = f.calls[0]
  assert.equal(url, `${URL_}/api/chat`)
  assert.equal(init.method, 'POST')
  assert.deepEqual(Object.keys(body).sort(), ['format', 'keep_alive', 'messages', 'model', 'options', 'stream', 'think'])
  assert.equal(body.model, 'qwen3.5:9b')
  assert.equal(body.stream, false)
  assert.equal(body.think, false)
  assert.equal(body.keep_alive, -1)
  assert.deepEqual(body.format, schema)
  assert.deepEqual(body.messages, [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }])
  assert.deepEqual(body.options, { num_ctx: 16384, temperature: 0.2, num_predict: 500, presence_penalty: 0 })
  for (const k of ['num_gpu', 'num_batch', 'num_thread', 'main_gpu', 'use_mmap']) assert.ok(!(k in body.options) && !(k in body), k)
})

test('keep_alive from the settings file: -1 becomes a number, 24h stays a string, nonsense keeps the default', async () => {
  assert.equal(parseSettings('DRAGONBARON_AI_KEEP_ALIVE=-1').keepAlive, -1)
  assert.equal(parseSettings('DRAGONBARON_AI_KEEP_ALIVE=24h').keepAlive, '24h')
  assert.equal(parseSettings('DRAGONBARON_AI_KEEP_ALIVE=forever').keepAlive, -1)
  const f = fakeFetch(() => ok('{}'))
  await createLocalModel({ settings: { ...SETTINGS, keepAlive: '24h' }, fetch: f.fn }).chat({ system: 's', user: 'u', schema: {} })
  assert.equal(f.calls[0].body.keep_alive, '24h')
})

test('a fetch that never answers is cut at the timeout, even when it ignores the abort signal', async () => {
  const f = fakeFetch(() => new Promise(() => {}))
  const m = createLocalModel({ settings: SETTINGS, fetch: f.fn })
  const t0 = Date.now()
  const r = await m.chat({ system: 's', user: 'u', schema: {}, timeoutMs: 40 })
  assert.equal(r.outcome, 'timeout')
  assert.ok(Date.now() - t0 < 2000)
})

test('outcomes: a refused connection is unreachable, a 500 is http', async () => {
  const refused = fakeFetch(() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) })
  assert.equal((await createLocalModel({ settings: SETTINGS, fetch: refused.fn }).chat({ system: 's', user: 'u', schema: {} })).outcome, 'unreachable')
  const http = fakeFetch(() => reply(500, { error: 'boom' }))
  const r = await createLocalModel({ settings: SETTINGS, fetch: http.fn }).chat({ system: 's', user: 'u', schema: {} })
  assert.equal(r.outcome, 'http')
  assert.equal(r.status, 500)
})

test('the probe: GET /api/version, an OK cached 30 s, a failure never cached', async () => {
  let t = 1_000_000
  let up = true
  const f = fakeFetch((url, init) => {
    assert.equal(init.method, 'GET')
    if (!up) throw new TypeError('fetch failed')
    return reply(200, { version: '0.30.10' })
  })
  const m = createLocalModel({ settings: SETTINGS, fetch: f.fn, now: () => t })
  assert.deepEqual(await m.probe(), { ok: true, outcome: 'ok', version: '0.30.10' })
  assert.equal(f.calls[0].url, `${URL_}/api/version`)
  t += 29_000
  assert.equal((await m.probe()).cached, true)
  assert.equal(f.calls.length, 1)
  t += 2_000
  up = false
  assert.equal((await m.probe()).ok, false)
  assert.equal((await m.probe()).ok, false)
  assert.equal(f.calls.length, 3)
})

test('an empty URL never calls fetch', async () => {
  const f = fakeFetch(() => { throw new Error('must not be called') })
  const m = createLocalModel({ settings: { ...DEFAULTS }, fetch: f.fn })
  assert.equal((await m.probe()).outcome, 'unreachable')
  assert.equal((await m.chat({ system: 's', user: 'u', schema: {} })).outcome, 'unreachable')
  assert.equal(f.calls.length, 0)
})

test('single flight: one job at a time, two may wait, the next is busy at once; an aborted waiter leaves the queue', async () => {
  const flight = createSingleFlight({ maxWaiting: 2 })
  const order = []
  let release
  const gate = new Promise(r => { release = r })
  const job = name => async () => { order.push(`start ${name}`); if (name === 'a') await gate; order.push(`end ${name}`); return name }
  const a = flight.run(job('a'))
  const b = flight.run(job('b'))
  const c = flight.run(job('c'))
  assert.deepEqual(await flight.run(job('d')), { busy: true })
  release()
  assert.deepEqual(await Promise.all([a, b, c]), [{ value: 'a' }, { value: 'b' }, { value: 'c' }])
  assert.deepEqual(order, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])

  let hold
  const held = flight.run(() => new Promise(r => { hold = r }))
  const ctl = new AbortController()
  const waiting = flight.run(() => 'never', { signal: ctl.signal })
  ctl.abort()
  assert.deepEqual(await waiting, { timeout: true })
  hold('x')
  assert.deepEqual(await held, { value: 'x' })
})
