'use strict'
// F1: the launcher's Discord login (src/discordLogin.js) against a fake backend and a fake browser: the answer comes back to 127.0.0.1 with PKCE
const test = require('node:test')
const assert = require('node:assert')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const path = require('path')
const { loopbackLogin, CALLBACK_PATH } = require('../src/discordLogin')

const API = 'https://api.test'
const STATE = 'a1'.repeat(32)
const RESULT = { token: 'b2'.repeat(32), masterApiId: 7, discordUsername: 'Alpha', discordAvatar: null }
const httpError = (statusCode) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode })
const s256 = v => crypto.createHash('sha256').update(v).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// GET on the loopback listener, as the browser does after the backend's redirect
function browserGet(port, pathAndQuery, host = `127.0.0.1:${port}`) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathAndQuery, headers: { host }, agent: false }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    }).on('error', reject)
  })
}

function fakeBackend({ start = { state: STATE }, token = RESULT } = {}) {
  const calls = []
  const postJSON = async (url, body) => {
    calls.push({ url, body })
    const route = url.slice(API.length)
    const answer = route === '/api/users/login-discord/start' ? start : route === '/api/users/login-discord/token' ? token : httpError(404)
    if (answer instanceof Error) throw answer
    return typeof answer === 'function' ? answer(body) : answer
  }
  return { calls, postJSON }
}

test('the login opens the backend page with the issued state and trades the code with the PKCE verifier', async () => {
  const backend = fakeBackend()
  let opened = null
  let browser = null
  const result = await loopbackLogin({
    apiUrl: API, postJSON: backend.postJSON,
    openUrl: url => {
      opened = url
      browser = browserGet(backend.calls[0].body.redirect_port, `${CALLBACK_PATH}?code=${'c3'.repeat(32)}&state=${STATE}`)
    },
  })
  const page = await browser
  assert.deepStrictEqual(result, RESULT)
  assert.strictEqual(opened, `${API}/api/users/login-discord?state=${STATE}`)
  const [start, trade] = backend.calls
  assert.strictEqual(start.body.client, 'launcher')
  assert.strictEqual(start.body.code_challenge_method, 'S256')
  assert.ok(Number.isInteger(start.body.redirect_port) && start.body.redirect_port > 0)
  assert.deepStrictEqual(Object.keys(trade.body).sort(), ['code', 'code_verifier', 'state'])
  assert.strictEqual(trade.body.state, STATE)
  assert.strictEqual(s256(trade.body.code_verifier), start.body.code_challenge, 'the verifier matches the challenge sent at start')
  assert.ok(!JSON.stringify(start.body).includes(trade.body.code_verifier), 'the verifier never left before the trade')
  assert.strictEqual(page.status, 200)
  assert.match(page.body, /Signed in as Alpha/)
  assert.match(page.body, /Never authorize DragonBreak from a link someone sent you/)
  assert.match(page.body, /only for your Discord account id, name and avatar/, 'the page names everything Discord hands over')
})

test('a request without this login\'s state, on another path or for another host is answered and ignored', async () => {
  const backend = fakeBackend()
  const seen = {}
  let browser = null
  const result = await loopbackLogin({
    apiUrl: API, postJSON: backend.postJSON,
    openUrl: () => {
      const port = backend.calls[0].body.redirect_port
      browser = (async () => {
        seen.wrongState = await browserGet(port, `${CALLBACK_PATH}?code=x&state=${'d4'.repeat(32)}`)
        seen.otherPath = await browserGet(port, '/favicon.ico')
        seen.otherHost = await browserGet(port, `${CALLBACK_PATH}?code=x&state=${STATE}`, `evil.test:${port}`)
        seen.right = await browserGet(port, `${CALLBACK_PATH}?code=${'c3'.repeat(32)}&state=${STATE}`)
      })()
    },
  })
  await browser
  assert.deepStrictEqual(result, RESULT)
  assert.strictEqual(seen.wrongState.status, 400)
  assert.strictEqual(seen.otherPath.status, 404)
  assert.strictEqual(seen.otherHost.status, 404)
  assert.strictEqual(seen.right.status, 200)
  assert.strictEqual(backend.calls.filter(c => c.url.endsWith('/token')).length, 1, 'only the right request was traded')
})

test('the listener is closed once the login is done', async () => {
  const backend = fakeBackend()
  let port, browser
  await loopbackLogin({
    apiUrl: API, postJSON: backend.postJSON,
    openUrl: () => { port = backend.calls[0].body.redirect_port; browser = browserGet(port, `${CALLBACK_PATH}?code=c&state=${STATE}`) },
  })
  await browser
  await assert.rejects(browserGet(port, `${CALLBACK_PATH}?code=c&state=${STATE}`), /ECONNREFUSED|ECONNRESET|socket hang up/)
})

test('a backend without /start rejects with err.legacy, so the caller can use the old login', async () => {
  const backend = fakeBackend({ start: httpError(404) })
  await assert.rejects(loopbackLogin({ apiUrl: API, postJSON: backend.postJSON, openUrl: () => assert.fail('no browser') }), err => err.legacy === true)
  const busy = fakeBackend({ start: httpError(429) })
  await assert.rejects(loopbackLogin({ apiUrl: API, postJSON: busy.postJSON, openUrl: () => {} }), err => !err.legacy && /Too many login attempts/.test(err.message))
})

test('an unusable state from the backend never opens the browser', async () => {
  const backend = fakeBackend({ start: { state: 'x' } })
  await assert.rejects(loopbackLogin({ apiUrl: API, postJSON: backend.postJSON, openUrl: () => assert.fail('no browser') }), /unusable/)
})

test('a refused trade fails the login and tells the browser', async () => {
  const backend = fakeBackend({ token: httpError(400) })
  let browser
  await assert.rejects(loopbackLogin({
    apiUrl: API, postJSON: backend.postJSON,
    openUrl: () => { browser = browserGet(backend.calls[0].body.redirect_port, `${CALLBACK_PATH}?code=c&state=${STATE}`) },
  }), /Could not finish the login/)
  const page = await browser
  assert.strictEqual(page.status, 400)
  assert.match(page.body, /Login failed/)
})

test('a cancel on Discord ends the login at once, without a trade', async () => {
  const backend = fakeBackend()
  let browser
  await assert.rejects(loopbackLogin({
    apiUrl: API, postJSON: backend.postJSON,
    openUrl: () => { browser = browserGet(backend.calls[0].body.redirect_port, `${CALLBACK_PATH}?error=access_denied&state=${STATE}`) },
  }), /cancelled on Discord/)
  assert.match((await browser).body, /Login cancelled/)
  assert.strictEqual(backend.calls.filter(c => c.url.endsWith('/token')).length, 0)
})

test('the login gives up after its timeout', async () => {
  const backend = fakeBackend()
  await assert.rejects(loopbackLogin({ apiUrl: API, postJSON: backend.postJSON, openUrl: () => {}, timeoutMs: 50 }), /timed out/)
})

test('main.js: Log out ends the session on the server, Sign Out Everywhere ends them all, and the old login is only a fallback', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
  assert.match(main, /api\/users\/login-discord\/logout/)
  assert.match(main, /ipcMain\.handle\('discord:logoutEverywhere'/)
  assert.match(main, /discordLogin\.loopbackLogin\(/)
  assert.match(main, /if \(!err\.legacy\)/, 'only a backend without the new login gets the old one')
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8')
  assert.match(preload, /discordLogoutEverywhere/)
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8')
  assert.match(html, /id="btn-signout-everywhere"/)
})
