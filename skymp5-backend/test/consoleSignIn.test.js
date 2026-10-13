'use strict'
// The console's fresh sign-in (routes/site-auth.js, sources/discord/oauth.js): /login/fresh, prompt=consent, signedInAt, the old token revoked

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
const realOauth = require('../sources/discord/oauth')
stub('sources/discord/oauth.js', { ...realOauth, exchangeCode: async () => ({ access_token: 'x' }), getUser: async () => discordUser })
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

const get = (url, cookie) => new Promise((resolve, reject) => {
  http.get(`${base}${url}`, { agent: false, headers: cookie ? { cookie } : {} }, res => {
    res.resume()
    res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || '', cookies: res.headers['set-cookie'] || [] }))
  }).on('error', reject)
})
const cookieOf = (cookies, name) => { const c = cookies.find(x => x.startsWith(`${name}=`)); return c ? c.split(';')[0].slice(name.length + 1) : null }

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

test('/login/fresh goes to Discord even with a session, marks the return to the console, and the callback stamps, revokes and returns', async () => {
  const old = store.create({ discordId: '300000000000000001', username: 'Jake' })
  const r = await get('/api/site/login/fresh', `db_site=${old}`)
  assert.equal(r.status, 302)
  const to = new URL(r.location)
  assert.equal(to.hostname, 'discord.com')
  assert.equal(to.searchParams.get('prompt'), 'consent')
  const state = cookieOf(r.cookies, 'db_site_state')
  assert.equal(cookieOf(r.cookies, 'db_site_next'), 'console')
  const next = r.cookies.find(c => c.startsWith('db_site_next='))
  assert.match(next, /Path=\/api\/site\/callback;/)
  assert.match(next, /HttpOnly; SameSite=Lax/)
  assert.match(next, /Max-Age=600/)
  const t0 = Date.now()
  const cb = await get(`/api/site/callback?code=abc&state=${state}`, `db_site_state=${state}; db_site_next=console; db_site=${old}`)
  assert.equal(cb.status, 302)
  assert.equal(cb.location, '/dashboard.html#console')
  const fresh = cookieOf(cb.cookies, 'db_site')
  assert.ok(fresh && fresh !== old)
  assert.equal(store.validate(old), null, 'the old token is revoked')
  const s = store.validate(fresh)
  assert.ok(s.signedInAt >= t0 && s.signedInAt <= Date.now(), 'the new session carries signedInAt')
  assert.equal(cookieOf(cb.cookies, 'db_site_next'), '', 'the return mark is cleared')
})

test('the callback returns to the profile unless the mark says console, and never to a URL from the request', async () => {
  const r = await get('/api/site/login')
  const state = cookieOf(r.cookies, 'db_site_state')
  const cb = await get(`/api/site/callback?code=abc&state=${state}&next=https://evil.example`, `db_site_state=${state}; db_site_next=https://evil.example`)
  assert.equal(cb.location, '/profile.html')
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
