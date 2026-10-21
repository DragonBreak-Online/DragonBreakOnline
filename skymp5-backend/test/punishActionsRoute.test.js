'use strict'
// routes/site-punish-actions.js over HTTP: every check before the body is read, in order; the mount before the read-only
// panel and server.js's own-parser paths; the GET and the jobs route; 404 with the panel off; never cached

const { test, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const path = require('path')
const { createActionsFixture, ORIGIN, uuid } = require('./helpers/punishActionsFixture')

const H = createActionsFixture()
const { PEOPLE, F } = H
const route = require('../routes/site-punish-actions')
const P = '/api/site/staff/punishments'
let server, base

before(async () => {
  const express = require('express')
  const { parserExcept } = require('../sources/problemReport')
  const panel = require('../routes/site-punish')
  panel.internals.setService(H.panel)
  const app = express()
  // As server.js: the global parser stays off the action paths; a second parser on one path stands for a body read early
  app.use('/early', express.json())
  app.use(parserExcept(route.OWN_PARSER_PATHS, express.json()))
  app.use(`${P}/actions`, route)
  app.use(P, panel)
  app.use('/early', route)
  server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => { server.close(); H.cleanup() })
beforeEach(() => {
  H.reset()
  H.config.punishPanel = true
  try { H.bans.removeEntry(PEOPLE.bob.discordId) } catch { /* not there */ }
  route.internals.setService(H.make())
})

function request(method, url, headers, payload = '') {
  return new Promise((resolve, reject) => {
    const clean = Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined))
    const req = http.request(`${base}${url}`, { method, agent: false, headers: { ...clean, ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}) } }, res => {
      let text = ''
      res.on('data', c => { text += c })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: /json/.test(res.headers['content-type'] || '') && text ? JSON.parse(text) : null }))
    })
    req.on('error', reject)
    req.end(payload)
  })
}
const session = (who, ago) => F.session(PEOPLE[who].discordId, ago)
const post = (token, { action = 'ban', body, raw, headers = {}, url } = {}) => request('POST', url || `${P}/actions/${action}`, {
  'content-type': 'application/json', origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-dbo-control': '1', 'x-test-session': token, ...headers,
}, raw ?? JSON.stringify(body ?? H.body(action)))
const want = async (res, status, error, label) => {
  const r = await res
  assert.equal(r.status, status, `${label}: ${r.text}`)
  if (error) assert.equal(r.json && r.json.error, error, label)
  assert.equal(r.headers['cache-control'], 'no-store, private', label)
  if (r.json) H.clean(r.json)
  return r.json
}

test('POST: each check refuses in order, and the body is read only after the caller\'s checks', async () => {
  const s = session('owner')
  await want(post(s, { headers: { origin: undefined } }), 403, 'badOrigin', 'no Origin')
  await want(post(s, { headers: { origin: 'https://evil.example' } }), 403, 'badOrigin', 'another Origin')
  await want(post(s, { headers: { 'sec-fetch-site': 'cross-site' } }), 403, 'badOrigin', 'cross-site fetch metadata')
  await want(post(s, { headers: { 'content-type': 'text/plain' } }), 415, 'badContentType', 'not JSON')
  await want(post(s, { headers: { 'x-dbo-control': undefined } }), 403, 'badHeader', 'no control header')
  await want(post(undefined), 401, 'signedOut', 'no session')
  await want(post(session('gm'), { raw: '{not json' }), 403, 'notAllowed', 'a GM never gets a body parsed')
  await want(post(session('actor'), { raw: '{not json' }), 403, 'notAllowed', 'nor does an unpinned Lead GM')
  await want(post(session('owner', 5 * 3600 * 1000), { raw: '{not json' }), 401, 'signInAgain', 'nor a stale sign-in')
  await want(post(s, { raw: '{not json' }), 400, null, 'bad JSON from a pinned Owner')
  await want(post(s, { body: { ...H.body('ban'), extra: 1 } }), 400, 'badRequest', 'an extra key')
  await want(post(s, { body: H.body('ban', { confirm: 'yes' }) }), 400, 'badConfirm', 'the wrong confirm word')
  const reason = await want(post(s, { body: H.body('ban', { reason: 'see <@123456789012345678>' }) }), 400, 'badReason', 'a mention in the reason')
  assert.equal(reason.why, 'reasonChars')
  await want(post(s, { raw: JSON.stringify({ ...H.body('ban'), reason: 'x'.repeat(2100) }) }), 413, null, 'over the 2 kb body limit')
  await want(post(s, { url: '/early/ban' }), 400, 'badRequest', 'a body some earlier parser already read')
  await want(post(s, { action: 'nuke' }), 404, 'notFound', 'an unknown action')
  await want(request('GET', `${P}/actions/ban`, { 'x-test-session': s }), 404, 'notFound', 'a GET on an action')
  assert.equal(H.banList().find(e => e.discordId === PEOPLE.bob.discordId), undefined, 'nothing was banned')
  const ok = await want(post(s), 200, null, 'then the ban')
  assert.equal(ok.job.state, 'done')
})

test('POST: a signed-in player with no panel rank is refused before the actions module, and the audit channel never hears of it', async () => {
  const lookups = H.F.lookups
  for (let i = 0; i < 3; i++) await want(post(session('bob'), { raw: '{not json' }), 403, 'notStaff', 'a player')
  await want(post(session('none'), { raw: '{not json' }), 403, 'notStaff', 'a pinned account with no rank')
  assert.deepEqual(H.audits, [])
  assert.equal(H.F.lookups, lookups, 'Discord was never asked for fresh roles')
})

test('the mount: actions answer before the read-only panel, which refuses any other write; the panel off is 404 everywhere', async () => {
  await want(post(session('owner'), { url: `${P}/player/10` }), 405, 'readOnly', 'the read-only panel')
  await want(post(session('owner'), { url: `${P}/actions/jobs/${uuid()}` }), 404, 'notFound', 'not a write the panel route ever sees')
  H.config.punishPanel = false
  await want(request('GET', `${P}/actions`, { 'x-test-session': session('owner') }), 404, 'notFound', 'GET with the panel off')
  await want(post(session('owner')), 404, 'notFound', 'POST with the panel off')
  await want(request('GET', `${P}/actions/jobs/${uuid()}`, { 'x-test-session': session('owner') }), 404, 'notFound', 'jobs with the panel off')
})

test('server.js mounts the actions before the read-only panel and keeps the global JSON parser off every action path', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')
  const actions = src.indexOf("app.use('/api/site/staff/punishments/actions', punishActionsRoute)")
  const panel = src.indexOf("app.use('/api/site/staff/punishments', require('./routes/site-punish'))")
  assert.ok(actions > 0 && panel > actions, 'mounted first')
  assert.match(src, /\.\.\.punishActionsRoute\.OWN_PARSER_PATHS\]/)
  assert.match(src, /punishActionsRoute\.recover\(\)/)
  assert.deepEqual(route.OWN_PARSER_PATHS, ['send', 'ban', 'unban', 'discord-timeout', 'discord-timeout-end', 'discord-ban', 'discord-unban'].map(a => `${P}/actions/${a}`))
  const { parserExcept } = require('../sources/problemReport')
  let parsed = 0
  const mw = parserExcept(route.OWN_PARSER_PATHS, (_q, _s, next) => { parsed++; next() })
  for (const p of [`${P}/actions/ban`, `${P}/actions/BAN/`, `${P}/actions//discord-ban`]) mw({ path: p }, null, () => {})
  assert.equal(parsed, 0)
})

test('GET: signed out 401, no panel rank 403, else what the viewer may do; jobs are the viewer\'s own', async () => {
  await want(request('GET', `${P}/actions`, {}), 401, 'signedOut', 'signed out')
  await want(request('GET', `${P}/actions`, { 'x-test-session': session('trial') }), 403, 'notStaff', 'a Trial GM')
  const o = await want(request('GET', `${P}/actions`, { 'x-test-session': session('owner') }), 200, null, 'an Owner')
  assert.deepEqual(o.can, { send: true, ban: true, unban: true, discordTimeout: true, discordBan: true })
  const g = await want(request('GET', `${P}/actions`, { 'x-test-session': session('gm') }), 200, null, 'a GM')
  assert.equal(g.tier, 'gm')
  assert.deepEqual(Object.values(g.can), [false, false, false, false, false])
  const body = H.body('ban')
  const owner = session('owner')
  await want(post(owner, { body }), 200, null, 'a ban')
  const job = await want(request('GET', `${P}/actions/jobs/${body.requestId}`, { 'x-test-session': owner }), 200, null, 'own job')
  assert.deepEqual([job.job.id, job.job.state, job.job.action], [body.requestId, 'done', 'ban'])
  await want(request('GET', `${P}/actions/jobs/${body.requestId.toUpperCase()}`, { 'x-test-session': owner }), 200, null, 'case does not matter')
  await want(request('GET', `${P}/actions/jobs/${body.requestId}`, { 'x-test-session': session('dev') }), 404, 'notFound', 'another\'s job')
  await want(request('GET', `${P}/actions/jobs/not-a-uuid`, { 'x-test-session': owner }), 404, 'notFound', 'not an id')
})

test('a failure inside answers 503 in JSON, never a stack trace', async () => {
  route.internals.setService({ ...H.actions, authorize: async () => { throw new Error('boom') }, info: () => { throw new Error('boom') } })
  await want(post(session('owner')), 503, 'unavailable', 'POST')
  await want(request('GET', `${P}/actions`, { 'x-test-session': session('owner') }), 503, 'unavailable', 'GET')
})
