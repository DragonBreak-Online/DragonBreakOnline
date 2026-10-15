'use strict'
// F1 (security audit 15 Oct): a launcher or in-game Discord login's result reaches only the device that started it, the old flow
// stays behind LAUNCHER_LOGIN_LEGACY, a new login ends older sessions, and a player can end their own; Discord is faked, no network

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs     = require('fs')
const http   = require('http')
const os     = require('os')
const path   = require('path')
const { loadWithDataIn } = require('./helpers/dataDir')
const fakeDiscord = require('./helpers/fakeDiscord')

// Never read a real .env, and keep the player, profile, access and ban stores out of this test
require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-login-'))
process.env.LOGIN_FLOWS_FILE = path.join(tmp, 'login-flows.json')
function stub(rel, exports) {
  const file = require.resolve(rel)
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
const PROFILES = { 31: '310000000000000001', 32: '310000000000000002' }
stub('../sources/players', {
  upsertFromDiscordUser: u => ({ profileId: Number(Object.keys(PROFILES).find(k => PROFILES[k] === u.id)) }),
  load: () => ({}),
  markGameJoin: () => {},
  updateIdentity: () => ({}),
})
stub('../sources/serverAccess', { getDiscordAccess: async () => ({ allowed: true, roles: [] }) })
stub('../sources/bans', { isBanned: () => null, logBan: () => {} })
stub('../sources/profiles', { getDiscordIdByProfileId: id => PROFILES[id] || null })
stub('../sources/factionWhitelist', { getPlayerFactionPermissions: () => [], getPlayerGameFactions: () => [], getPlayerAssignments: () => [] })
const config = require('../config')
Object.assign(config, {
  serverMasterKey: 'test-key', masterApiAuthToken: 'server-secret', launchCheckEnforce: false, legalRequired: false,
  discordClientId: '1400000000000000888', discordRedirectUri: 'https://api.test/api/users/login-discord/callback', gameLoginDevice: true,
})

let discordUser = { id: PROFILES[31], username: 'alpha', global_name: 'Alpha', avatar: null }
const discord = fakeDiscord.install({ user: () => discordUser })
const express = require('express')
// Both modules keep their stores next to the code; those paths are sent to the temp dir while they load
const { masterApi, compat } = loadWithDataIn(tmp, ['sessions.json', 'auth-states.json'], () => ({
  masterApi: require('../routes/master-api'),
  compat: require('../routes/skymp-compat'),
}))

let server, base
before(async () => {
  const app = express()
  app.use(express.json())
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
const get  = (url, opts) => request('GET', url, opts)
const post = (url, json, opts = {}) => request('POST', url, { ...opts, json })
const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const pkce = () => { const verifier = b64url(crypto.randomBytes(32)); return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) } }
const hiddenValue = (html, name) => (new RegExp(`name="${name}" value="([^"]*)"`).exec(html) || [])[1]
const sessionCheck = (token, headers = { 'x-auth-token': 'server-secret' }) => get(`/api/servers/test-key/sessions/${token}`, { headers })
const withConfig = async (patch, fn) => {
  const saved = Object.fromEntries(Object.keys(patch).map(k => [k, config[k]]))
  Object.assign(config, patch)
  try { return await fn() } finally { Object.assign(config, saved) }
}

// A launcher login up to the loopback redirect: returns what the launcher's listener receives
async function loopbackToRedirect(port = 48123) {
  const { verifier, challenge } = pkce()
  const start = await post('/api/users/login-discord/start', { client: 'launcher', code_challenge: challenge, code_challenge_method: 'S256', redirect_port: port })
  assert.equal(start.status, 200, start.text)
  const { state } = start.json
  const open = await get(`/api/users/login-discord?state=${state}`)
  assert.equal(open.status, 302)
  const cb = await get(`/api/users/login-discord/callback?code=discord-code&state=${state}`)
  return { state, verifier, cb }
}

// An old launcher's login: its own state, Discord, then the confirmation page
async function legacyToConfirmPage() {
  const state = crypto.randomBytes(32).toString('hex')
  const open = await get(`/api/users/login-discord?state=${state}`)
  assert.equal(open.status, 302, open.text)
  const page = await get(`/api/users/login-discord/callback?code=discord-code&state=${state}`)
  return { state, open, page }
}

test('F1: the login always asks Discord for consent, and only for a well-formed state', async () => {
  const short = await get('/api/users/login-discord?state=a')
  assert.equal(short.status, 400, 'a one-character state is refused')
  assert.equal(short.location, '')
  const { open } = await legacyToConfirmPage()
  const to = new URL(open.location)
  assert.equal(to.hostname, 'discord.com')
  assert.equal(to.searchParams.get('prompt'), 'consent')
})

test('F1: an old launcher\'s login is held until the player presses Continue on our own page, and delivered once', async () => {
  const { state, page } = await legacyToConfirmPage()
  assert.equal(page.status, 200)
  assert.match(page.text, /If someone sent you this link, close this tab now/)
  assert.equal((await get(`/api/users/login-discord/status?state=${state}`)).status, 401, 'nothing is released before Continue')
  const nonce = hiddenValue(page.text, 'nonce')
  assert.ok(nonce, 'the page carries its nonce')
  const forged = await request('POST', '/api/users/login-discord/confirm', { form: { state, nonce: 'f'.repeat(64) } })
  assert.equal(forged.status, 400, 'a confirmation without the page nonce is refused')
  assert.equal((await get(`/api/users/login-discord/status?state=${state}`)).status, 401)
  const ok = await request('POST', '/api/users/login-discord/confirm', { form: { state, nonce } })
  assert.equal(ok.status, 200)
  const first = await get(`/api/users/login-discord/status?state=${state}`)
  assert.equal(first.status, 200)
  assert.match(first.json.token, /^[0-9a-f]{64}$/)
  assert.equal(first.json.discordUsername, 'Alpha')
  assert.equal((await get(`/api/users/login-discord/status?state=${state}`)).status, 403, 'the result is delivered once')
})

test('F1: the old flow\'s Continue button starts asleep and wakes only on a focused, visible page, so a double-click on a swapped window cannot press it', async () => {
  const { page } = await legacyToConfirmPage()
  const form = /<form[^>]*>[\s\S]*?<\/form>/.exec(page.text)[0]
  assert.match(form, /<button type="submit" id="continue">Continue<\/button>/, 'live in the markup, so it works when the script cannot run')
  assert.doesNotMatch(form, /<noscript>/)
  assert.match(form, /<script>\(function \(\) \{\n  var b = document\.getElementById\('continue'\)[^\n]*\n  b\.disabled = true\n/, 'the script puts it to sleep first')
  assert.match(form, /<p class="meta" id="continue-hint" hidden>/, 'the hint shows only when the script runs')
  assert.match(page.text, /\.panel button:disabled \{ opacity: \.55; cursor: default; \}/, 'a sleeping button looks asleep')
  assert.doesNotMatch(page.headers['content-security-policy'], /script-src|default-src|sandbox/, 'the page lets its inline script run')
  assert.match(form, /document\.hasFocus\(\)/)
  assert.match(form, /visibilitychange/)
  assert.match(form, /addEventListener\('blur', sleep\)/)
})

test('F1: the Continue guard: a click right after the tab comes to the front is ignored, a click after a second and a pointer move goes through', async () => {
  const { page } = await legacyToConfirmPage()
  const script = /<script>(\(function \(\) \{[\s\S]*?\}\)\(\))<\/script>/.exec(page.text)[1]
  const listeners = {}
  const on = (target, type, fn) => { (listeners[`${target}:${type}`] = listeners[`${target}:${type}`] || []).push(fn) }
  const fire = (target, type) => (listeners[`${target}:${type}`] || []).forEach(fn => fn())
  const button = { hidden: false, disabled: false }
  const hint = { hidden: true }
  let focused = false, now = 0
  const timers = []
  const doc = { visibilityState: 'visible', hasFocus: () => focused, getElementById: id => (id === 'continue' ? button : hint), addEventListener: (t, fn) => on('doc', t, fn) }
  const win = { addEventListener: (t, fn) => on('win', t, fn) }
  const sandbox = { document: doc, window: win, setTimeout: (fn, ms) => { const t = { at: now + ms, fn }; timers.push(t); return t }, clearTimeout: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) } }
  const advance = ms => { now += ms; for (const t of [...timers]) if (t.at <= now) { timers.splice(timers.indexOf(t), 1); t.fn() } }
  require('vm').runInNewContext(script, sandbox)
  assert.equal(hint.hidden, false, 'the script shows the hint')
  assert.equal(button.disabled, true, 'asleep while the tab has no focus (a window above it)')
  fire('doc', 'mousemove')
  assert.equal(button.disabled, true)
  focused = true; fire('win', 'focus')
  advance(150); fire('doc', 'mousemove')
  assert.equal(button.disabled, true, 'the second click of a double-click lands on a sleeping button')
  advance(1000); fire('doc', 'mousemove')
  assert.equal(button.disabled, false, 'a player who looks at the page and moves the pointer can press it')
  focused = false; fire('win', 'blur')
  assert.equal(button.disabled, true, 'asleep again when another window comes in front')
})

test('F1: reopening an old launcher\'s login link does not keep it alive, and a second Discord callback is refused', async () => {
  const { state } = await legacyToConfirmPage()
  const again = await get(`/api/users/login-discord?state=${state}`)
  assert.equal(again.status, 400, 'a link that already reached Discord is used up')
  const cb2 = await get(`/api/users/login-discord/callback?code=discord-code&state=${state}`)
  assert.equal(cb2.status, 400)
})

test('F1: the launcher\'s login goes to 127.0.0.1 on the PC that started it, and only the PKCE verifier holder can collect it, once', async () => {
  const { state, verifier, cb } = await loopbackToRedirect(48123)
  assert.equal(cb.status, 302)
  const to = new URL(cb.location)
  assert.equal(to.origin, 'http://127.0.0.1:48123')
  assert.equal(to.pathname, '/discord/callback')
  assert.equal(to.searchParams.get('state'), state)
  const code = to.searchParams.get('code')
  assert.match(code, /^[0-9a-f]{64}$/)
  assert.equal((await get(`/api/users/login-discord/status?state=${state}`)).status, 403, 'the state alone gets nothing from the old status route')
  assert.equal((await post('/api/users/login-discord/token', { state, code: 'e'.repeat(64), code_verifier: verifier })).status, 400, 'the verifier without the code is refused')
  assert.equal((await post('/api/users/login-discord/token', { state, code, code_verifier: pkce().verifier })).status, 400, 'the code without the verifier is refused')
  const ok = await post('/api/users/login-discord/token', { state, code, code_verifier: verifier })
  assert.equal(ok.status, 200, ok.text)
  assert.match(ok.json.token, /^[0-9a-f]{64}$/)
  assert.equal(ok.json.masterApiId, 31)
  assert.equal((await sessionCheck(ok.json.token)).status, 200, 'the game server accepts the session')
  assert.equal((await post('/api/users/login-discord/token', { state, code, code_verifier: verifier })).status, 400, 'the code works once')
})

test('F1: a cancel on Discord goes straight back to the launcher, and ends that login', async () => {
  const { verifier, challenge } = pkce()
  const { state } = (await post('/api/users/login-discord/start', { client: 'launcher', code_challenge: challenge, code_challenge_method: 'S256', redirect_port: 48124 })).json
  await get(`/api/users/login-discord?state=${state}`)
  const cb = await get(`/api/users/login-discord/callback?error=access_denied&state=${state}`)
  assert.equal(cb.status, 302)
  const to = new URL(cb.location)
  assert.equal(to.origin, 'http://127.0.0.1:48124')
  assert.equal(to.searchParams.get('error'), 'access_denied')
  assert.equal(to.searchParams.get('code'), null)
  assert.equal((await post('/api/users/login-discord/token', { state, code: 'c'.repeat(64), code_verifier: verifier })).status, 400)
})

test('F1: /start refuses a plain challenge, a missing method and a privileged port', async () => {
  const { challenge } = pkce()
  const cases = [
    { client: 'launcher', code_challenge: challenge, redirect_port: 48123 },
    { client: 'launcher', code_challenge: 'abc', code_challenge_method: 'S256', redirect_port: 48123 },
    { client: 'launcher', code_challenge: challenge, code_challenge_method: 'S256', redirect_port: 80 },
    { client: 'launcher', code_challenge: challenge, code_challenge_method: 'S256' },
    { client: 'someone' },
  ]
  for (const body of cases) assert.equal((await post('/api/users/login-discord/start', body)).status, 400, JSON.stringify(body))
})

test('F1: the game\'s login needs the code the game shows, typed on our page, and only the game\'s device code collects it, once', async () => {
  const start = await post('/api/users/login-discord/start', { client: 'game' })
  assert.equal(start.status, 200)
  const { state, deviceCode, userCode, interval } = start.json
  assert.match(userCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  assert.ok(interval >= 2)
  assert.equal((await post('/api/users/login-discord/poll', { state, device_code: deviceCode })).status, 401, 'pending')
  assert.equal((await get(`/api/users/login-discord?state=${state}`)).status, 302)
  const page = await get(`/api/users/login-discord/callback?code=discord-code&state=${state}`)
  assert.equal(page.status, 200)
  assert.match(page.text, /Never type a code that someone sent you/)
  const nonce = hiddenValue(page.text, 'nonce')
  const wrong = await request('POST', '/api/users/login-discord/confirm', { form: { state, nonce, user_code: 'ZZZZ-ZZZZ' } })
  assert.equal(wrong.status, 400)
  assert.match(wrong.text, /4 tries left/)
  assert.equal((await post('/api/users/login-discord/poll', { state, device_code: deviceCode })).status, 401, 'still pending after a wrong code')
  const typed = userCode.toLowerCase().replace('-', ' ')
  assert.equal((await request('POST', '/api/users/login-discord/confirm', { form: { state, nonce, user_code: typed } })).status, 200, 'case and separators do not matter')
  assert.equal((await post('/api/users/login-discord/poll', { state, device_code: 'd'.repeat(64) })).status, 403, 'another device code gets nothing')
  assert.equal((await get(`/api/users/login-discord/status?state=${state}`)).status, 403, 'the state alone gets nothing')
  const ok = await post('/api/users/login-discord/poll', { state, device_code: deviceCode })
  assert.equal(ok.status, 200)
  assert.match(ok.json.token, /^[0-9a-f]{64}$/)
  assert.equal((await post('/api/users/login-discord/poll', { state, device_code: deviceCode })).status, 403, 'delivered once')
})

test('F1: with GAME_LOGIN_DEVICE off (the default) the game\'s login is not offered', async () => {
  await withConfig({ gameLoginDevice: false }, async () => {
    const r = await post('/api/users/login-discord/start', { client: 'game' })
    assert.equal(r.status, 403)
    assert.equal(r.json.error, 'gameLoginOff')
    assert.equal(r.json.state, undefined)
  })
})

test('F1: five wrong game codes end that login', async () => {
  const { state, deviceCode } = (await post('/api/users/login-discord/start', { client: 'game' })).json
  await get(`/api/users/login-discord?state=${state}`)
  const nonce = hiddenValue((await get(`/api/users/login-discord/callback?code=c&state=${state}`)).text, 'nonce')
  let last
  for (let i = 0; i < 5; i++) last = await request('POST', '/api/users/login-discord/confirm', { form: { state, nonce, user_code: 'BBBB-BBBB' } })
  assert.match(last.text, /Too many wrong codes/)
  assert.equal((await post('/api/users/login-discord/poll', { state, device_code: deviceCode })).status, 403)
})

test('F1: a new login ends the account\'s older sessions, and LAUNCHER_LOGIN_SINGLE_SESSION=false keeps them', async () => {
  const login = async () => {
    const { state, verifier, cb } = await loopbackToRedirect()
    const code = new URL(cb.location).searchParams.get('code')
    return (await post('/api/users/login-discord/token', { state, code, code_verifier: verifier })).json.token
  }
  const older = await login()
  const newer = await login()
  assert.equal((await sessionCheck(older)).status, 404, 'the older token no longer works')
  assert.equal((await sessionCheck(newer)).status, 200)
  await withConfig({ launcherLoginSingleSession: false }, async () => {
    const third = await login()
    assert.equal((await sessionCheck(newer)).status, 200, 'kept with the switch off')
    assert.equal((await sessionCheck(third)).status, 200)
  })
})

test('F1: a player can log out this launcher, or end every session of the account and no one else\'s', async () => {
  const mine = masterApi.createSession({ id: PROFILES[31], username: 'alpha' }, { flow: 'loopback' }).session
  await withConfig({ launcherLoginSingleSession: false }, async () => {
    const mineToo = masterApi.createSession({ id: PROFILES[31], username: 'alpha' }, { flow: 'loopback' }).session
    const other = masterApi.createSession({ id: PROFILES[32], username: 'beta' }, { flow: 'loopback' }).session
    const one = await post('/api/users/login-discord/logout', {}, { headers: { authorization: `Bearer ${mineToo}` } })
    assert.deepEqual(one.json, { ok: true, ended: 1 })
    assert.equal((await sessionCheck(mineToo)).status, 404)
    assert.equal((await sessionCheck(mine)).status, 200, 'logging out one launcher leaves the others')
    const third = masterApi.createSession({ id: PROFILES[31], username: 'alpha' }, { flow: 'loopback' }).session
    const all = await post('/api/users/login-discord/logout', { everywhere: true }, { headers: { authorization: third } })
    assert.equal(all.json.ended, 2)
    assert.equal((await sessionCheck(mine)).status, 404)
    assert.equal((await sessionCheck(third)).status, 404)
    assert.equal((await sessionCheck(other)).status, 200, 'another account is untouched')
    assert.deepEqual((await post('/api/users/login-discord/logout', {}, { headers: { authorization: third } })).json, { ok: true, ended: 0 }, 'an ended session logs out quietly')
  })
})

test('F1: with LAUNCHER_LOGIN_LEGACY=off the old flow is refused with an update message, and its sessions keep working', async () => {
  const { state, page } = await legacyToConfirmPage()
  const nonce = hiddenValue(page.text, 'nonce')
  await request('POST', '/api/users/login-discord/confirm', { form: { state, nonce } })
  const old = (await get(`/api/users/login-discord/status?state=${state}`)).json.token
  await withConfig({ launcherLoginLegacy: 'off' }, async () => {
    const fresh = await get(`/api/users/login-discord?state=${crypto.randomBytes(32).toString('hex')}`)
    assert.equal(fresh.status, 410)
    assert.match(fresh.text, /Update your launcher/)
    const status = await get(`/api/users/login-discord/status?state=${crypto.randomBytes(32).toString('hex')}`)
    assert.equal(status.status, 426)
    assert.equal(status.json.error, 'launcherOutdated')
    assert.equal((await sessionCheck(old)).status, 200, 'off does not log anyone out')
    const { cb } = await loopbackToRedirect()
    assert.equal(cb.status, 302, 'the new launcher logs in as before')
  })
})

test('F1: LAUNCHER_LOGIN_LEGACY=revoke refuses the sessions the old flow made, and allow brings them back', async () => {
  const legacy = masterApi.createSession({ id: PROFILES[32], username: 'beta' }, { flow: 'legacy' }).session
  const modern = masterApi.createSession({ id: PROFILES[31], username: 'alpha' }, { flow: 'device' }).session
  await withConfig({ launcherLoginLegacy: 'revoke' }, async () => {
    assert.equal((await sessionCheck(legacy)).status, 404)
    assert.equal(masterApi.lookupSession(legacy), null)
    assert.equal((await sessionCheck(modern)).status, 200)
  })
  assert.equal((await sessionCheck(legacy)).status, 200)
})

test('F1: MASTER_SESSION_CHECK_TOKEN: optional takes a check without X-Auth-Token, required refuses it, a wrong token is always refused', async () => {
  const token = masterApi.createSession({ id: PROFILES[31], username: 'alpha' }, { flow: 'loopback' }).session
  assert.equal((await sessionCheck(token, {})).status, 200)
  assert.equal((await sessionCheck(token, { 'x-auth-token': 'wrong' })).status, 403)
  assert.equal((await get(`/api/servers/test-key/sessions/${token}/balance`, { headers: { 'x-auth-token': 'wrong' } })).status, 403)
  await withConfig({ masterSessionCheckToken: 'required' }, async () => {
    assert.equal((await sessionCheck(token, {})).status, 403)
    assert.equal((await get(`/api/servers/test-key/sessions/${token}/balance`)).status, 403)
    assert.equal((await sessionCheck(token)).status, 200)
  })
})

test('F1: login pages are never cached, framed or sent as a referrer', async () => {
  const { page } = await legacyToConfirmPage()
  assert.equal(page.headers['x-frame-options'], 'DENY')
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/)
  assert.match(page.headers['cache-control'], /no-store/)
  assert.equal(page.headers['referrer-policy'], 'no-referrer')
})

test('F1: logins are counted by flow per day, with no names in the file', async () => {
  const counts = JSON.parse(fs.readFileSync(process.env.LOGIN_FLOWS_FILE, 'utf8'))
  const today = counts[new Date().toISOString().slice(0, 10)]
  assert.ok(today.legacy >= 1 && today.loopback >= 1 && today.device >= 1, JSON.stringify(today))
  assert.ok(today.legacyRefused >= 1)
  assert.doesNotMatch(JSON.stringify(counts), /alpha|beta|31000000/i)
})

test('F1: the in-flight login file holds no state, code or token in the clear', async () => {
  const { state, cb } = await loopbackToRedirect()
  const code = new URL(cb.location).searchParams.get('code')
  const game = (await post('/api/users/login-discord/start', { client: 'game' })).json
  const raw = fs.readFileSync(path.join(tmp, 'auth-states.json'), 'utf8')
  for (const secret of [state, code, game.state, game.deviceCode, game.userCode]) assert.ok(!raw.includes(secret))
  assert.equal(fs.statSync(path.join(tmp, 'auth-states.json')).mode & 0o777, 0o600)
  assert.equal(discord.calls.other.length, 0, 'nothing but the fake discord.com was called')
})

test('F1: the login rate limits run on Cloudflare\'s visitor header, per visitor', async () => {
  // Every real request carries CF-Connecting-IP, so this is the path production takes; documentation-range addresses only
  const visitor = n => ({ 'cf-connecting-ip': `2001:db8:${n}::1` })
  const start = headers => post('/api/users/login-discord/start', { client: 'launcher', code_challenge: pkce().challenge, code_challenge_method: 'S256', redirect_port: 48125 }, { headers })
  for (let i = 0; i < 10; i++) assert.equal((await start(visitor(1))).status, 200, `start ${i + 1} of 10`)
  const over = await start(visitor(1))
  assert.equal(over.status, 429)
  assert.match(over.json.error, /Too many login attempts/)
  assert.equal((await start(visitor(2))).status, 200, 'another visitor is not held back')
})
