'use strict'
// routes/site-console.js over HTTP: every layer of the POST in order, the GET, the jobs route, and that the route passes no identity

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const path = require('path')

require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
const { createConsoleFixture, uuid, ID } = require('./helpers/consoleFixture')

const ORIGIN = 'https://site.example'
const stub = (rel, exports) => {
  const file = require.resolve(path.join('..', rel))
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}

let F, server, base
const staff = new Set([ID.jake, ID.nate])
let lastRunArgs = null

before(async () => {
  F = createConsoleFixture('dbo-console-route-')
  F.make()
  const api = F.api
  const spy = { ...api, runStaffCommand: (caller, req) => { lastRunArgs = { caller, req }; return api.runStaffCommand(caller, req) } }
  stub('sources/console/index.js', { consoleApi: () => spy })
  stub('routes/site-auth.js', {
    internals: {
      currentSession: req => F.siteSessions.validate(String(req.headers['x-test-session'] || '')),
      sessionToken: req => String(req.headers['x-test-session'] || ''),
      sameOrigin: req => req.get('origin') === ORIGIN,
    },
  })
  stub('routes/site-staff.js', {
    internals: {
      requireStaff: (req, res, next) => {
        const s = F.siteSessions.validate(String(req.headers['x-test-session'] || ''))
        if (!s) return res.status(401).json({ error: 'signedOut' })
        if (!staff.has(s.discordId)) return res.status(403).json({ error: 'notStaff' })
        req.staff = s
        next()
      },
    },
  })
  const express = require('express')
  const { parserExcept } = require('../sources/problemReport')
  const app = express()
  // As server.js: the global parser stays off this route's path; a second parser on one path stands for a body read early
  app.use('/early', express.json())
  app.use(parserExcept(['/api/site/staff/console/run'], express.json()))
  app.use('/api/site/staff/console', require('../routes/site-console'))
  app.use('/early', require('../routes/site-console'))
  server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
  F.startGame()
})
after(() => { server.close(); F.cleanup() })

function request(method, url, headers, payload = '') {
  return new Promise((resolve, reject) => {
    const clean = Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined))
    const req = http.request(`${base}${url}`, { method, agent: false, headers: { ...clean, ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}) } }, res => {
      let text = ''
      res.on('data', c => { text += c })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: /json/.test(res.headers['content-type'] || '') && text ? JSON.parse(text) : null }))
    })
    req.on('error', reject)
    req.end(payload)
  })
}
const post = (session, { body, headers = {}, raw, url = '/api/site/staff/console/run' } = {}) => request('POST', url, {
  'content-type': 'application/json', origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-dbo-control': '1', 'x-test-session': session, ...headers,
}, raw ?? JSON.stringify(body ?? { requestId: uuid(), command: '/whoami' }))

test('GET: staff only, the web setting, freshness, the sign-in link and the published commands; never cached', async () => {
  const s = F.session(ID.jake)
  const r = await request('GET', '/api/site/staff/console', { 'x-test-session': s })
  assert.equal(r.status, 200)
  assert.equal(r.headers['cache-control'], 'no-store, private')
  assert.deepEqual(Object.keys(r.json).sort(), ['commands', 'fresh', 'maxLength', 'ready', 'setting', 'signInUrl', 'v'])
  assert.equal(r.json.setting, 'on')
  assert.equal(r.json.fresh, true)
  assert.equal(r.json.signInUrl, '/api/site/login/fresh')
  assert.equal(r.json.commands.length, 9)
  const stale = await request('GET', '/api/site/staff/console', { 'x-test-session': F.session(ID.jake, 5 * 3600 * 1000) })
  assert.equal(stale.json.fresh, false)
  assert.equal((await request('GET', '/api/site/staff/console', { 'x-test-session': F.session(ID.stranger) })).status, 403)
  assert.equal((await request('GET', '/api/site/staff/console', {})).status, 401)
})

test('POST: each layer refuses in order, before the body is read', async () => {
  const s = F.session(ID.jake)
  const want = async (res, status, error, label) => { const r = await res; assert.equal(r.status, status, label); if (error) assert.equal(r.json.error, error, label) }
  await want(post(s, { headers: { origin: undefined } }), 403, 'badOrigin', 'no Origin')
  await want(post(s, { headers: { origin: 'https://evil.example' } }), 403, 'badOrigin', 'another Origin')
  await want(post(s, { headers: { 'sec-fetch-site': 'cross-site' } }), 403, 'badOrigin', 'cross-site fetch metadata')
  await want(post(s, { headers: { 'content-type': 'text/plain' } }), 415, 'badContentType', 'not JSON')
  await want(post(s, { headers: { 'x-dbo-control': undefined } }), 403, 'badHeader', 'no control header')
  await want(post(undefined), 401, 'signedOut', 'no session')
  await want(post(F.session(ID.stranger), { raw: '{not json' }), 403, 'notStaff', 'a non-staff session never gets its body parsed')
  await want(post(s, { raw: '{not json' }), 400, null, 'bad JSON from staff')
  await want(post(s, { body: { requestId: uuid(), command: '/whoami', extra: 1 } }), 400, 'badRequest', 'an extra key')
  await want(post(s, { body: { requestId: 'not-a-uuid', command: '/whoami' } }), 400, 'badRequest', 'a requestId that is not a v4 UUID')
  await want(post(s, { body: { requestId: uuid(), command: 'x'.repeat(601) } }), 400, 'badCommand', 'over 600 characters')
  await want(post(s, { raw: JSON.stringify({ requestId: uuid(), command: 'x'.repeat(2100) }) }), 413, null, 'over the 2 kb body limit')
  await want(post(s, { url: '/early/run' }), 400, 'badRequest', 'a body some earlier parser already read')
  await want(post(F.session(ID.jake, 5 * 3600 * 1000)), 401, 'signInAgain', 'a sign-in older than 4 hours')
})

test('POST: the route hands runStaffCommand a caller it made from the token, never an id or a name from the request', async () => {
  const s = F.session(ID.nate)
  const r = await post(s, { body: { requestId: uuid(), command: '/whoami' }, headers: { 'x-discord-id': ID.jake } })
  assert.equal(r.status, 200)
  assert.equal(r.json.job.state, 'ran')
  assert.equal(lastRunArgs.caller.discordId, ID.nate)
  assert.deepEqual(Object.keys(lastRunArgs.req).sort(), ['text', 'uuid'])
})

test('jobs: the caller\'s own only', async () => {
  const id = uuid()
  await post(F.session(ID.jake), { body: { requestId: id, command: '/whoami' } })
  assert.equal((await request('GET', `/api/site/staff/console/jobs/${id}`, { 'x-test-session': F.session(ID.jake) })).json.job.state, 'ran')
  assert.equal((await request('GET', `/api/site/staff/console/jobs/${id}`, { 'x-test-session': F.session(ID.nate) })).status, 404)
  assert.equal((await request('GET', '/api/site/staff/console/jobs/../../x', { 'x-test-session': F.session(ID.jake) })).status, 404)
})

test('server.js keeps the global parser off the route, mounts it before /api/site/staff, and recovers jobs at start', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')
  assert.match(src, /OWN_PARSER_PATHS = \[[^\]]*'\/api\/site\/staff\/console\/run'/)
  assert.ok(src.indexOf("app.use('/api/site/staff/console'") < src.indexOf("app.use('/api/site/staff', "))
  assert.match(src, /require\('\.\/sources\/console'\)\.consoleApi\(\)\.recover\(\)/)
})
