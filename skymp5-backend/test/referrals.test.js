'use strict'
// Referral links (routes/referrals.js, sources/referrals.js, the hooks in routes/skymp-compat.js): the shared link sets the
// cookie, and a launcher or old-launcher Discord login that creates a brand-new account writes one binding; an account that
// existed before never does. Discord is faked, no network.

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs     = require('fs')
const http   = require('http')
const os     = require('os')
const path   = require('path')
const { loadWithDataIn } = require('./helpers/dataDir')
const fakeDiscord = require('./helpers/fakeDiscord')

require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'referrals-'))
process.env.LOGIN_FLOWS_FILE = path.join(tmp, 'login-flows.json')
process.env.REFERRAL_PENDING_FILE = path.join(tmp, 'referral-pending.json')
process.env.REFERRALS_FILE = path.join(tmp, 'referrals.jsonl')
process.env.REFERRAL_LANDING_URL = 'https://site.test/'
process.env.REFERRAL_LINKS = 'on'
function stub(rel, exports) {
  const file = require.resolve(rel)
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
// A player store that dates each account the first time it is seen, as sources/players.js does
const rows = {}
let nextProfile = 40
const players = {
  upsertFromDiscordUser: u => {
    const now = new Date().toISOString()
    rows[u.id] = rows[u.id] || { profileId: nextProfile++, discordId: u.id, createdAt: now }
    return rows[u.id]
  },
  getByProfileId: id => Object.values(rows).find(r => r.profileId === Number(id)) || null,
  load: () => ({}), markGameJoin: () => {}, updateIdentity: () => ({}),
}
stub('../sources/players', players)
stub('../sources/serverAccess', { getDiscordAccess: async () => ({ allowed: true, roles: [] }) })
stub('../sources/bans', { isBanned: () => null, logBan: () => {} })
stub('../sources/profiles', { getDiscordIdByProfileId: id => (players.getByProfileId(id) || {}).discordId || null })
stub('../sources/factionWhitelist', { getPlayerFactionPermissions: () => [], getPlayerGameFactions: () => [], getPlayerAssignments: () => [] })
const config = require('../config')
Object.assign(config, {
  serverMasterKey: 'test-key', masterApiAuthToken: 'server-secret', launchCheckEnforce: false, legalRequired: false,
  discordClientId: '1400000000000000888', discordRedirectUri: 'https://api.test/api/users/login-discord/callback', gameLoginDevice: true,
  launcherLoginLegacy: 'allow', websiteUrl: 'https://site.test',
})

// A Discord id made 2024-01-01 00:00:00 UTC (snowflake top bits: ms since 2015-01-01)
const AT_2024 = Date.UTC(2024, 0, 1)
const snowflake = (ms, low) => String((BigInt(ms - 1420070400000) << 22n) + BigInt(low))
let discordUser = null
const discord = fakeDiscord.install({ user: () => discordUser })
const express = require('express')
const { masterApi, compat } = loadWithDataIn(tmp, ['sessions.json', 'auth-states.json'], () => ({
  masterApi: require('../routes/master-api'),
  compat: require('../routes/skymp-compat'),
}))
const referrals = require('../routes/referrals')
const { accountCreatedAt, normCode, createReferralStore, sha256 } = require('../sources/referrals')

let server, base
before(async () => {
  const app = express()
  app.set('trust proxy', 'loopback')
  app.use(express.json())
  // As server.js registers them
  app.use('/api/users/login-discord/join', referrals.join)
  app.use('/api/join', referrals.join)
  app.use('/api/users', compat)
  app.use('/api/servers', masterApi)
  server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  await new Promise(resolve => server.close(resolve))
  discord.restore()
  fs.rmSync(tmp, { recursive: true, force: true })
})

function request(method, url, { json, form, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const body = json !== undefined ? JSON.stringify(json) : form !== undefined ? new URLSearchParams(form).toString() : null
    const h = { ...headers }
    if (json !== undefined) h['content-type'] = 'application/json'
    if (form !== undefined) h['content-type'] = 'application/x-www-form-urlencoded'
    if (body !== null) h['content-length'] = Buffer.byteLength(body)
    const req = http.request(`${base}${url}`, { method, agent: false, headers: h }, res => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', c => { data += c })
      res.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(data) } catch { /* a page */ }
        resolve({ status: res.statusCode, headers: res.headers, text: data, json: parsed, location: res.headers.location || '' })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}
const get = (url, opts) => request('GET', url, opts)
const post = (url, json, opts = {}) => request('POST', url, { ...opts, json })
const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const pkce = () => { const verifier = b64url(crypto.randomBytes(32)); return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) } }
const hiddenValue = (html, name) => (new RegExp(`name="${name}" value="([^"]*)"`).exec(html) || [])[1]
const bindings = () => { try { return fs.readFileSync(process.env.REFERRALS_FILE, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) } catch { return [] } }
const pendingStates = () => JSON.parse(fs.readFileSync(process.env.REFERRAL_PENDING_FILE, 'utf8')).states
const withLinks = async (value, fn) => { const saved = process.env.REFERRAL_LINKS; process.env.REFERRAL_LINKS = value; try { return await fn() } finally { process.env.REFERRAL_LINKS = saved } }
const cookieOf = res => { const c = (res.headers['set-cookie'] || []).find(x => x.startsWith('dbo_ref=')); return c ? c.split(';')[0] : '' }

// A launcher (loopback) login whose browser carries `headers`; returns the launcher's answer
async function launcherLogin(headers = {}) {
  const { verifier, challenge } = pkce()
  const start = await post('/api/users/login-discord/start', { client: 'launcher', code_challenge: challenge, code_challenge_method: 'S256', redirect_port: 48123 })
  assert.equal(start.status, 200, start.text)
  const { state } = start.json
  const open = await get(`/api/users/login-discord?state=${state}`, { headers })
  assert.equal(open.status, 302)
  const cb = await get(`/api/users/login-discord/callback?code=discord-code&state=${state}`, { headers })
  const code = new URL(cb.location).searchParams.get('code')
  return post('/api/users/login-discord/token', { state, code, code_verifier: verifier })
}

// An old launcher's login: browser steps with `headers`, then the launcher's /status poll
async function legacyLogin(headers = {}) {
  const state = crypto.randomBytes(32).toString('hex')
  assert.equal((await get(`/api/users/login-discord?state=${state}`, { headers })).status, 302)
  const page = await get(`/api/users/login-discord/callback?code=discord-code&state=${state}`, { headers })
  const ok = await request('POST', '/api/users/login-discord/confirm', { form: { state, nonce: hiddenValue(page.text, 'nonce') }, headers })
  assert.equal(ok.status, 200)
  return get(`/api/users/login-discord/status?state=${state}`)
}

test('the shared link sets a cookie for the login path only and lands on the website with the code', async () => {
  const res = await get('/api/users/login-discord/join/bcdf2345')
  assert.equal(res.status, 302)
  assert.equal(res.location, 'https://site.test/?ref=BCDF2345')
  const raw = res.headers['set-cookie'].find(x => x.startsWith('dbo_ref='))
  assert.match(raw, /^dbo_ref=BCDF2345; Max-Age=2592000; Path=\/api\/users\/login-discord; Expires=[^;]+; HttpOnly; Secure; SameSite=Lax$/)
  assert.equal(res.headers['cache-control'], 'no-store, private')
  assert.equal(cookieOf(await get('/api/join/BCDF2345')), 'dbo_ref=BCDF2345', 'the short path answers too')
})

test('the cookie is set only on a top-level navigation, never for an image, frame or script on another site', async () => {
  for (const dest of ['image', 'iframe', 'script', 'empty']) {
    const res = await get('/api/users/login-discord/join/BCDF2345', { headers: { 'sec-fetch-dest': dest, 'sec-fetch-mode': 'no-cors', 'sec-fetch-site': 'cross-site' } })
    assert.equal(res.status, 302, dest)
    assert.equal(cookieOf(res), '', dest)
  }
  assert.equal(cookieOf(await get('/api/users/login-discord/join/BCDF2345', { headers: { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' } })), 'dbo_ref=BCDF2345')
})

test('REFERRAL_LINKS off: the link only redirects and the login notes and binds nothing', async () => {
  await withLinks('off', async () => {
    const res = await get('/api/users/login-discord/join/BCDF2345')
    assert.equal(res.status, 302)
    assert.equal(res.location, 'https://site.test/?ref=BCDF2345')
    assert.equal(cookieOf(res), '')
    discordUser = { id: snowflake(AT_2024, 20), username: 'dark', global_name: 'Dark', avatar: null }
    const before = bindings().length
    const pendingBefore = fs.existsSync(process.env.REFERRAL_PENDING_FILE) ? fs.readFileSync(process.env.REFERRAL_PENDING_FILE, 'utf8') : ''
    assert.equal((await launcherLogin({ cookie: 'dbo_ref=BCDF2345' })).status, 200)
    assert.equal(bindings().length, before)
    assert.equal(fs.existsSync(process.env.REFERRAL_PENDING_FILE) ? fs.readFileSync(process.env.REFERRAL_PENDING_FILE, 'utf8') : '', pendingBefore)
  })
})

test('a malformed code sets nothing and still lands on the website', async () => {
  for (const bad of ['AEIOU123', 'BCDF234', 'BCDF23456', '..%2F..%2Fx', 'BCDF234O']) {
    const res = await get(`/api/join/${bad}`)
    assert.equal(res.status, 302, bad)
    assert.equal(res.location, 'https://site.test/', bad)
    assert.equal(cookieOf(res), '', bad)
  }
  assert.equal(normCode(' bcdf2345 '), 'BCDF2345')
})

test('the account age comes from the Discord id', () => {
  assert.equal(accountCreatedAt(snowflake(AT_2024, 77)), AT_2024)
  assert.equal(accountCreatedAt('nope'), 0)
})

test('a brand-new account from a browser with the cookie is bound once, and the launcher gets its login unchanged', async () => {
  const link = await get('/api/users/login-discord/join/BCDF2345')
  discordUser = { id: snowflake(AT_2024, 1), username: 'newbie', global_name: 'Newbie', avatar: null }
  const before = bindings().length
  const res = await launcherLogin({ cookie: cookieOf(link) })
  assert.equal(res.status, 200, res.text)
  assert.match(res.json.token, /^[0-9a-f]{64}$/)
  assert.equal(res.json.discordUsername, 'Newbie')
  const rows = bindings().slice(before)
  assert.equal(rows.length, 1)
  assert.deepEqual({ ...rows[0], at: 0 }, { kind: 'bind', v: 1, at: 0, code: 'BCDF2345', profileId: res.json.masterApiId, accountCreatedAt: AT_2024, via: 'cookie' })
  assert.equal(Object.keys(pendingStates()).length, 0, 'the state is spent')
})

test('an account that existed before the login is never bound, cookie or not', async () => {
  discordUser = { id: snowflake(AT_2024, 2), username: 'veteran', global_name: 'Veteran', avatar: null }
  players.upsertFromDiscordUser(discordUser)
  rows[discordUser.id].createdAt = new Date(Date.now() - 60000).toISOString()
  const before = bindings().length
  const res = await launcherLogin({ cookie: 'dbo_ref=BCDF2345' })
  assert.equal(res.status, 200)
  assert.equal(bindings().length, before)
})

test('an old launcher\'s login binds from its cookie', async () => {
  discordUser = { id: snowflake(AT_2024, 3), username: 'legacy', global_name: 'Legacy', avatar: null }
  const before = bindings().length
  const res = await legacyLogin({ cookie: 'dbo_ref=GHJK6789' })
  assert.equal(res.status, 200, res.text)
  const rows = bindings().slice(before)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].code, 'GHJK6789')
  assert.equal(rows[0].via, 'cookie')
  assert.equal(rows[0].profileId, res.json.masterApiId)
})

test('no cookie binds nothing: no address-and-browser fallback', async () => {
  const browser = { 'cf-connecting-ip': '203.0.113.10', 'user-agent': 'BrowserA' }
  await get('/api/users/login-discord/join/LMNP2345', { headers: { ...browser, 'sec-fetch-dest': 'image' } })
  discordUser = { id: snowflake(AT_2024, 4), username: 'other', global_name: 'Other', avatar: null }
  const before = bindings().length
  assert.equal((await legacyLogin(browser)).status, 200)
  discordUser = { id: snowflake(AT_2024, 5), username: 'plain', global_name: 'Plain', avatar: null }
  assert.equal((await launcherLogin()).status, 200)
  assert.equal(bindings().length, before)
  assert.doesNotMatch(fs.readFileSync(process.env.REFERRAL_PENDING_FILE, 'utf8'), /203\.0\.113|BrowserA|salt|visits/)
})

test('a failed exchange binds nothing and leaves the state for the real one', async () => {
  const { challenge } = pkce()
  const start = await post('/api/users/login-discord/start', { client: 'launcher', code_challenge: challenge, code_challenge_method: 'S256', redirect_port: 48123 })
  const { state } = start.json
  await get(`/api/users/login-discord?state=${state}`, { headers: { cookie: 'dbo_ref=QRST2345' } })
  const bad = await post('/api/users/login-discord/token', { state, code: 'x', code_verifier: 'y' })
  assert.equal(bad.status, 400)
  assert.ok(pendingStates()[sha256(state)], 'still waiting')
})

test('referral-pending.json holds no state in the clear', async () => {
  const { challenge } = pkce()
  const { state } = (await post('/api/users/login-discord/start', { client: 'launcher', code_challenge: challenge, code_challenge_method: 'S256', redirect_port: 48123 })).json
  assert.equal((await get(`/api/users/login-discord?state=${state}`, { headers: { cookie: 'dbo_ref=VWXZ2345' } })).status, 302)
  const legacy = crypto.randomBytes(32).toString('hex')
  assert.equal((await get(`/api/users/login-discord?state=${legacy}`, { headers: { cookie: 'dbo_ref=VWXZ2345' } })).status, 302)
  const raw = fs.readFileSync(process.env.REFERRAL_PENDING_FILE, 'utf8')
  for (const secret of [state, legacy]) {
    assert.ok(!raw.includes(secret), 'no raw state')
    assert.equal(pendingStates()[sha256(secret)].code, 'VWXZ2345', 'kept under its sha256')
  }
  assert.equal(fs.statSync(process.env.REFERRAL_PENDING_FILE).mode & 0o777, 0o600)
})

test('a deleted account\'s binding rows are dropped, and rows older than 30 days go at the next binding', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'store-'))
  let t = Date.UTC(2026, 9, 1)
  const logs = []
  const store = createReferralStore({ pendingFile: path.join(dir, 'p.json'), bindingsFile: path.join(dir, 'b.jsonl'), now: () => t, log: m => logs.push(m) })
  const rows = () => fs.readFileSync(path.join(dir, 'b.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
  const bind = (state, profileId) => {
    store.noteLogin({ state, cookieCode: 'BCDF2345' })
    return store.deliver({ state, profileId, player: () => ({ createdAt: new Date(t).toISOString(), discordId: snowflake(AT_2024, profileId) }) }).result
  }
  assert.equal(bind('s1', 1), 'bound')
  assert.equal(bind('s2', 2), 'bound')
  assert.equal(store.forgetProfile(1), 1)
  assert.deepEqual(rows().map(r => r.profileId), [2])
  t += 31 * 24 * 3600 * 1000
  assert.equal(bind('s3', 3), 'bound')
  assert.deepEqual(rows().map(r => r.profileId), [3], 'the 31-day-old row is gone')
  assert.equal(fs.statSync(path.join(dir, 'b.jsonl')).mode & 0o777, 0o600)
})
