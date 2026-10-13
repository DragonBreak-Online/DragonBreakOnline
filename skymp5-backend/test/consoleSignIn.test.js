'use strict'
// The console's fresh sign-in (routes/site-auth.js, sources/oauthStates.js, sources/discord/oauth.js): server-held states, /login/fresh, prompt=consent, signedInAt, the old token revoked

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const http = require('http')
const path = require('path')

require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
const stub = (rel, exports) => {
  const file = require.resolve(path.join('..', rel))
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
const config = require('../config')
Object.assign(config, { discordClientId: '1400000000000000777', discordSiteRedirectUri: 'http://127.0.0.1/api/site/callback', websiteUrl: 'http://127.0.0.1' })

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-console-signin-'))
const { createStore } = require('../sources/sessionStore')
const store = createStore({ file: path.join(ROOT, 'site-sessions.json'), ttlMs: 24 * 3600 * 1000, label: 'test-sessions' })
stub('sources/siteSessions.js', store)
let discordUser = { id: '300000000000000001', username: 'jake', global_name: 'Jake' }
let exchanges = 0
const realOauth = require('../sources/discord/oauth')
stub('sources/discord/oauth.js', { ...realOauth, exchangeCode: async () => { exchanges++; return { access_token: 'x' } }, getUser: async () => discordUser })
const { createStateStore } = require('../sources/oauthStates')
for (const [rel, exp] of [['sources/players.js', { load: () => ({}) }], ['sources/profiles.js', { load: () => ({ map: {} }) }], ['sources/serverAccess.js', {}],
  ['sources/bans.js', { isBanned: () => false }], ['sources/nameTable.js', { load: () => ({}) }], ['sources/officials.js', {}], ['sources/factionWhitelist.js', {}]]) stub(rel, exp)

let server, base
before(async () => {
  const express = require('express')
  const app = express()
  app.set('trust proxy', 'loopback')
  app.use('/api/site', require('../routes/site-auth'))
  server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => { server.close(); fs.rmSync(ROOT, { recursive: true, force: true }) })

const get = (url, cookie, headers = {}) => new Promise((resolve, reject) => {
  http.get(`${base}${url}`, { agent: false, headers: { ...headers, ...(cookie ? { cookie } : {}) } }, res => {
    res.resume()
    res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || '', cookies: res.headers['set-cookie'] || [] }))
  }).on('error', reject)
})
const cookieOf = (cookies, name) => { const c = cookies.find(x => x.startsWith(`${name}=`)); return c ? c.split(';')[0].slice(name.length + 1) : null }
const stateOf = r => new URL(r.location).searchParams.get('state')
const sessionsFile = path.join(ROOT, 'site-sessions.json')
const sessionCount = () => (fs.existsSync(sessionsFile) ? JSON.parse(fs.readFileSync(sessionsFile, 'utf8')).length : 0)

test('authorizeUrl adds prompt only when asked, so the launcher and dashboard flows send what they always sent', () => {
  const plain = new URL(realOauth.authorizeUrl({ redirectUri: 'http://x/cb', state: 's' }))
  assert.equal(plain.searchParams.has('prompt'), false)
  assert.deepEqual([...plain.searchParams.keys()].sort(), ['client_id', 'redirect_uri', 'response_type', 'scope', 'state'])
  assert.equal(new URL(realOauth.authorizeUrl({ redirectUri: 'http://x/cb', state: 's', prompt: 'consent' })).searchParams.get('prompt'), 'consent')
})

test('/login sends the site sign-in to Discord with prompt=consent', async () => {
  const r = await get('/api/site/login')
  assert.equal(r.status, 302)
  assert.equal(new URL(r.location).searchParams.get('prompt'), 'consent')
})

test('/login/fresh goes to Discord even with a session, and the callback stamps, revokes and returns to the console', async () => {
  const old = store.create({ discordId: '300000000000000001', username: 'Jake' })
  const r = await get('/api/site/login/fresh', `db_site=${old}`)
  assert.equal(r.status, 302)
  const to = new URL(r.location)
  assert.equal(to.hostname, 'discord.com')
  assert.equal(to.searchParams.get('prompt'), 'consent')
  const state = cookieOf(r.cookies, 'db_site_state')
  assert.equal(stateOf(r), state, 'the cookie and the URL carry the same state')
  const set = r.cookies.find(c => c.startsWith('db_site_state='))
  assert.match(set, /Path=\/api\/site\/callback;/)
  assert.match(set, /HttpOnly; SameSite=Lax/)
  assert.match(set, /Max-Age=600/)
  assert.equal(cookieOf(r.cookies, 'db_site_next'), null, 'no return cookie: the server records the flow')
  const t0 = Date.now()
  const cb = await get(`/api/site/callback?code=abc&state=${state}`, `db_site_state=${state}; db_site=${old}`)
  assert.equal(cb.status, 302)
  assert.equal(cb.location, '/dashboard.html#console')
  const fresh = cookieOf(cb.cookies, 'db_site')
  assert.ok(fresh && fresh !== old)
  assert.equal(store.validate(old), null, 'the old token is revoked')
  const s = store.validate(fresh)
  assert.ok(s.signedInAt >= t0 && s.signedInAt <= Date.now(), 'the new session carries signedInAt')
})

test('the callback returns where the recorded flow says, never to a URL or a cookie from the request', async () => {
  const r = await get('/api/site/login')
  const state = cookieOf(r.cookies, 'db_site_state')
  const cb = await get(`/api/site/callback?code=abc&state=${state}&next=https://evil.example`, `db_site_state=${state}; db_site_next=console`)
  assert.equal(cb.location, '/profile.html', 'a /login state goes to the profile, whatever db_site_next says')
})

test('SEC-1: a callback whose state the server never issued is refused, makes no session and never calls Discord, even when the cookie matches', async () => {
  const before = exchanges, sessions = sessionCount()
  for (const state of [require('crypto').randomBytes(32).toString('hex'), 'a'.repeat(64), 'not-hex', '']) {
    const cb = await get(`/api/site/callback?code=abc&state=${state}`, `db_site_state=${state}`)
    assert.equal(cb.status, 302)
    assert.equal(cb.location, '/profile.html?error=state', state)
    assert.equal(cookieOf(cb.cookies, 'db_site'), null, 'no session cookie')
  }
  const two = await get(`/api/site/callback?code=abc&state=${'b'.repeat(64)}&state=${'b'.repeat(64)}`, `db_site_state=${'b'.repeat(64)}`)
  assert.equal(two.location, '/profile.html?error=state', 'a repeated state parameter (an array) is refused')
  assert.equal(exchanges - before, 0, 'exchangeCode was never called')
  assert.equal(sessionCount(), sessions, 'no session was made')
})

test('SEC-1: an issued state works once, only with its own cookie, and a cancel or a bad cookie uses it up', async () => {
  let r = await get('/api/site/login')
  let state = stateOf(r)
  const before = exchanges
  const first = await get(`/api/site/callback?code=abc&state=${state}`, `db_site_state=${state}`)
  assert.equal(first.location, '/profile.html')
  const again = await get(`/api/site/callback?code=abc&state=${state}`, `db_site_state=${state}`)
  assert.equal(again.location, '/profile.html?error=state', 'the same state a second time')
  assert.equal(exchanges - before, 1)
  r = await get('/api/site/login'); state = stateOf(r)
  const wrong = await get(`/api/site/callback?code=abc&state=${state}`, `db_site_state=${'c'.repeat(64)}`)
  assert.equal(wrong.location, '/profile.html?error=state', 'an issued state with another cookie')
  const late = await get(`/api/site/callback?code=abc&state=${state}`, `db_site_state=${state}`)
  assert.equal(late.location, '/profile.html?error=state', 'the refused try used it up')
  r = await get('/api/site/login/fresh'); state = stateOf(r)
  const cancelled = await get(`/api/site/callback?error=access_denied&state=${state}`, `db_site_state=${state}`)
  assert.equal(cancelled.location, '/profile.html?error=cancelled')
  const after = await get(`/api/site/callback?code=abc&state=${state}`, `db_site_state=${state}`)
  assert.equal(after.location, '/profile.html?error=state', 'a cancelled state cannot be used afterwards')
  assert.equal(exchanges - before, 1)
})

test('SEC-1: signedInAt only when the sign-in ends at the address it started from (a state fetched elsewhere and planted by cookie is not fresh)', async () => {
  const at = ip => ({ 'cf-connecting-ip': ip })
  let r = await get('/api/site/login', '', at('198.51.100.7'))
  let state = stateOf(r)
  let cb = await get(`/api/site/callback?code=abc&state=${state}`, `db_site_state=${state}`, at('198.51.100.7'))
  assert.equal(typeof store.validate(cookieOf(cb.cookies, 'db_site')).signedInAt, 'number', 'same address: fresh')
  r = await get('/api/site/login/fresh', '', at('198.51.100.7'))
  state = stateOf(r)
  cb = await get(`/api/site/callback?code=abc&state=${state}`, `db_site_state=${state}`, at('203.0.113.9'))
  assert.equal(cb.location, '/dashboard.html#console')
  const s = store.validate(cookieOf(cb.cookies, 'db_site'))
  assert.ok(s, 'still signed in')
  assert.equal(s.signedInAt, undefined, 'another address: no signedInAt, so the console asks for a sign-in again')
  r = await get('/api/site/login/fresh', '', at('198.51.100.7'))
  state = stateOf(r)
  cb = await get(`/api/site/callback?code=abc&state=${state}`, `db_site_state=${state}`)
  assert.equal(store.validate(cookieOf(cb.cookies, 'db_site')).signedInAt, undefined, 'an address at the start and none at the end: not fresh')
})

test('the state store: hashed keys, the flow recorded, 10 minutes, once, a cap', () => {
  let t = 1000
  const S = createStateStore({ ttlMs: 600000, max: 3, now: () => t })
  assert.throws(() => S.issue('silent'), /unknown sign-in flow/)
  const a = S.issue('fresh', '198.51.100.7')
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.equal(S.take(require('crypto').createHash('sha256').update(a).digest('hex')), null, 'the stored key is not a state')
  assert.deepEqual(S.take(a), { flow: 'fresh', ip: '198.51.100.7', at: 1000 })
  assert.equal(S.take(a), null, 'once')
  const b = S.issue('login')
  t += 600000
  assert.equal(S.take(b), null, 'expired at 10 minutes')
  const c = S.issue('login'); S.issue('login'); S.issue('login'); S.issue('login')
  assert.equal(S.size(), 3, 'capped')
  assert.equal(S.take(c), null, 'the oldest went first')
  for (const bad of [null, 5, ['x'], 'A'.repeat(64), `${'a'.repeat(63)}g`]) assert.equal(S.take(bad), null, String(bad))
  t += 600000
  S.issue('login')
  assert.equal(S.size(), 1, 'expired states are pruned on the next issue')
})

test('the plain /login with a session still goes straight to the profile (no second session)', async () => {
  const s = store.create({ discordId: '300000000000000002', username: 'Nate', signedInAt: Date.now() })
  const r = await get('/api/site/login', `db_site=${s}`)
  assert.equal(r.location, '/profile.html')
})

test('internals hand out the raw session token for the console', () => {
  const { internals } = require('../routes/site-auth')
  assert.equal(internals.sessionToken({ headers: { cookie: 'a=1; db_site=abc; db_site_next=x' } }), 'abc')
})
