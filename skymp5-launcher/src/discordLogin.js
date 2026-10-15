'use strict'
// Discord login (backend docs/launcher_login.md): the backend issues the state, Discord's answer comes back to 127.0.0.1 on this PC, and PKCE proves it is this launcher

const http   = require('http')
const crypto = require('crypto')

const CALLBACK_PATH = '/discord/callback'
const STATE_RE = /^[0-9a-f]{64}$/
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// What the player is approving, in the launcher's tooltip and on the page the browser shows at the end
const APPROVAL_NOTE = 'DragonBreak asks Discord only for your Discord name and avatar. The sign-in comes back only to this launcher, on this PC. Never authorize DragonBreak from a link someone sent you.'

// The PKCE pair (RFC 7636, S256): the verifier stays in this process, only the challenge is sent
function pkcePair() {
  const verifier = b64url(crypto.randomBytes(32))
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) }
}

// The page the browser shows at the end of the login, mirroring the backend's sign-in pages
function callbackPage(ok, title, message) {
  const accent = ok ? '#c8a25f' : '#c0564f'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>DragonBreak - ${escapeHtml(title)}</title>
<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,#16120d 0%,#0b0906 70%);color:#d8cdb8;font-family:Georgia,serif;text-align:center}div{max-width:34rem;padding:1rem}h1{color:${accent};font-weight:normal;letter-spacing:.12em;text-transform:uppercase;font-size:1.4rem}p{color:#a59a86}small{color:#857a66}</style>
</head><body><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><small>${escapeHtml(APPROVAL_NOTE)}</small></p></div></body></html>`
}

// Readable reasons for the backend's answers to /start and /token
function httpReason(err) {
  if (err.statusCode === 429) return 'Too many login attempts right now. Wait a minute and try again.'
  if (err.statusCode === 503) return 'Discord login is not available on the server right now. Try again later.'
  return err.statusCode ? `the server answered HTTP ${err.statusCode}` : err.message
}

// Resolves the backend's login result { token, masterApiId, discordUsername, discordAvatar }; err.legacy is set when the backend predates this login (404)
async function loopbackLogin({ apiUrl, postJSON, openUrl, timeoutMs = LOGIN_TIMEOUT_MS, log = () => {} }) {
  const { verifier, challenge } = pkcePair()
  const server = http.createServer()
  // Port 0: Windows picks a free port; 127.0.0.1 only, so nothing outside this PC can reach it
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  try {
    let start
    try {
      start = await postJSON(`${apiUrl}/api/users/login-discord/start`,
        { client: 'launcher', code_challenge: challenge, code_challenge_method: 'S256', redirect_port: port })
    } catch (err) {
      if (err.statusCode === 404) throw Object.assign(new Error('The server does not offer the new login yet.'), { legacy: true })
      throw new Error(`Could not start the login: ${httpReason(err)}`)
    }
    const state = start && start.state
    if (typeof state !== 'string' || !STATE_RE.test(state)) throw new Error('The server sent an unusable login answer.')
    const result = waitForCallback(server, { port, state, verifier, apiUrl, postJSON, timeoutMs, log })
    log(`[discord] login started, waiting on 127.0.0.1:${port}`)
    openUrl(`${apiUrl}/api/users/login-discord?state=${state}`)
    return await result
  } finally {
    server.close()
  }
}

// Resolves once the browser brings back this login's state and the code is traded; anything else is answered and ignored
function waitForCallback(server, { port, state, verifier, apiUrl, postJSON, timeoutMs, log }) {
  return new Promise((resolve, reject) => {
    let settled = false
    let busy = false
    const finish = (err, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      err ? reject(err) : resolve(value)
    }
    const timer = setTimeout(() => finish(new Error('Login timed out - please try again.')), timeoutMs)

    server.on('request', async (req, res) => {
      const reply = (status, ok, title, message) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
        res.end(callbackPage(ok, title, message))
      }
      let url = null
      try { url = new URL(req.url, `http://127.0.0.1:${port}`) } catch { /* answered below */ }
      // Only the browser's redirect to this exact address and path; a favicon request or a stray page gets a plain 404
      if (!url || req.method !== 'GET' || url.pathname !== CALLBACK_PATH || req.headers.host !== `127.0.0.1:${port}`) {
        res.writeHead(404)
        return res.end()
      }
      if (url.searchParams.get('state') !== state) {
        return reply(400, false, 'Not this login', 'This page does not belong to the login the launcher started. Return to the launcher.')
      }
      if (settled || busy) return reply(409, false, 'Already finished', 'This login has already finished. Return to the launcher.')
      if (url.searchParams.get('error') === 'access_denied') {
        reply(200, false, 'Login cancelled', 'The login was cancelled on Discord. Return to the launcher and press Discord Login to try again.')
        return finish(new Error('Login cancelled on Discord - press Discord Login to try again.'))
      }
      if (url.searchParams.get('error')) {
        reply(200, false, 'Login failed', 'The server could not finish the login with Discord. Return to the launcher and try again.')
        return finish(new Error('The server could not finish the login with Discord - please try again.'))
      }
      const code = url.searchParams.get('code')
      if (!code) {
        reply(400, false, 'Login failed', 'Discord sent no login code. Return to the launcher and try again.')
        return finish(new Error('Discord sent no login code - please try again.'))
      }
      busy = true
      try {
        const result = await postJSON(`${apiUrl}/api/users/login-discord/token`, { state, code, code_verifier: verifier })
        if (!result || typeof result.token !== 'string' || !result.token) throw new Error('the server sent no session')
        const name = result.discordUsername || `player ${result.masterApiId}`
        reply(200, true, 'Logged in', `Signed in as ${name}. You can close this tab and return to the DragonBreak launcher.`)
        finish(null, result)
      } catch (err) {
        log(`[discord] the login code could not be traded (${err.statusCode ? 'HTTP ' + err.statusCode : err.message})`)
        reply(400, false, 'Login failed', 'The launcher could not finish the login. Return to the launcher and try again.')
        finish(new Error(`Could not finish the login: ${httpReason(err)}`))
      }
    })
  })
}

module.exports = { loopbackLogin, pkcePair, callbackPage, APPROVAL_NOTE, CALLBACK_PATH }
