'use strict'

/**
 * SkyMP Master API compatibility routes: the endpoints the SkyMP game client
 * (authService.ts) and the launcher expect on the master server, bridged to the session
 * infrastructure in master-api.js. Mounted as app.use('/api/users', ...) in server.js.
 * The Discord logins are described in docs/launcher_login.md.
 *
 * Endpoints:
 *   POST /api/users/login-discord/start
 *     Body: { client: 'launcher', code_challenge, code_challenge_method: 'S256', redirect_port } -> { state, expiresIn }
 *       or: { client: 'game' } -> { state, deviceCode, userCode, interval, expiresIn }
 *     The backend issues every state; the launcher or game then opens /login-discord?state=<state> in the browser.
 *   GET /api/users/login-discord?state=<hex>
 *     Redirects to Discord (prompt=consent). Only an issued state, or while LAUNCHER_LOGIN_LEGACY=allow an old launcher's own.
 *   GET /api/users/login-discord/callback?code=...&state=...
 *     Discord's registered redirect URI. Launcher: 302 to http://127.0.0.1:<port>/discord/callback with a one-time code.
 *     Game and old launcher: a confirmation page on this site (the game's code, or a Continue button).
 *   POST /api/users/login-discord/confirm  (form: state, nonce, user_code)
 *     The confirmation page's answer.
 *   POST /api/users/login-discord/token  Body: { state, code, code_verifier }
 *     Launcher: the one-time code and the PKCE verifier for the login result, once.
 *   POST /api/users/login-discord/poll  Body: { state, device_code }
 *     Game: 401 pending, 403 expired, 200 the login result, once.
 *   GET /api/users/login-discord/status?state=<hex>
 *     Old launchers (up to 2.1.49): 401 pending, 403 unknown, 200 the login result once; 426 once LAUNCHER_LOGIN_LEGACY is off.
 *   A login result is { token, masterApiId, discordUsername, discordDiscriminator, discordAvatar } (token = play-session token).
 *   POST /api/users/me/play/:serverKey
 *     Headers: { authorization: <token> }  Body: { hwid? }
 *     Validates the token is a live session and returns { session: token }.
 *   POST /api/users/me/hwid
 *     Headers: { authorization: <token> } (or Body: { token })  Body: { hwid }
 *     Stores the launcher-reported hardware id on the session and player record. Returns { ok }.
 */

const express   = require('express')
const router    = express.Router()
const path      = require('path')
const rateLimit = require('express-rate-limit')
const config    = require('../config')
const players   = require('../sources/players')
const oauth     = require('../sources/discord/oauth')
const { visitorIp } = require('../sources/visitorIp')
const { createLoginStore, TTL } = require('../sources/launcherLogins')
const loginFlowCounts = require('../sources/loginFlowCounts')

// Launcher-supplied hardware id: printable chars only, capped length; returns '' when unusable
function sanitizeHwid(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 128)
}

// Stores a hwid on both the session record and the player record; never throws
function storeHwid(token, session, hwid) {
  const { recordSessionHwid } = require('./master-api')
  try {
    recordSessionHwid(token, hwid)
    players.updateIdentity(session.discordId, { hwid })
  } catch (e) {
    console.error('[skymp-compat] failed to store hwid:', e.message)
  }
}

// The launcher sends "Bearer <token>"; the game client convention is the raw token
function authToken(req) {
  const raw = req.headers['authorization'] || (req.body && req.body.token) || ''
  if (typeof raw !== 'string') return ''
  return raw.startsWith('Bearer ') ? raw.slice(7) : raw
}

// In-flight logins, persisted so a backend restart does not drop a player who is in the browser; same file name, so it stays on the secret lists
const logins = createLoginStore({ file: process.env.AUTH_STATES_FILE || path.join(__dirname, '..', 'data', 'auth-states.json') })

// How often the game polls, in seconds
const POLL_INTERVAL_S = 3

const limitOptions = { windowMs: 60 * 1000, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts right now. Try again in a minute.' } }
// Per visitor, so one client cannot crowd out another; requests without the visitor header meet the store's cap only
const perVisitor = max => rateLimit({ ...limitOptions, max, skip: req => !visitorIp(req), keyGenerator: req => rateLimit.ipKeyGenerator(visitorIp(req)) })
const startLimiter    = perVisitor(10)
const browserLimiter  = perVisitor(20)
const exchangeLimiter = perVisitor(20)
// The game polls about every 3 s
const pollLimiter     = perVisitor(60)

const OUTDATED = 'This DragonBreak launcher is out of date, so it cannot log in any more. Close it and open it again: it updates itself. Then press Discord Login in the new launcher.'

// Every login page and answer: never cached, never framed, no referrer, and forms post only to this site
function loginHeaders(_req, res, next) {
  res.set({
    'Cache-Control': 'no-store, private',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
  })
  next()
}
router.use('/login-discord', loginHeaders)

const legacyAllowed = () => config.launcherLoginLegacy === 'allow'

// POST /api/users/login-discord/start

router.post('/login-discord/start', startLimiter, (req, res) => {
  if (!config.discordClientId) return res.status(503).json({ error: 'discordNotConfigured' })
  const body = req.body || {}
  try {
    if (body.client === 'launcher') {
      if (body.code_challenge_method !== 'S256') return res.status(400).json({ error: 'code_challenge_method must be S256' })
      const { state } = logins.issue('loopback', { challenge: body.code_challenge, port: Number(body.redirect_port) })
      return res.json({ state, expiresIn: TTL.pending / 1000 })
    }
    if (body.client === 'game') {
      const { state, deviceCode, userCode } = logins.issue('device')
      return res.json({ state, deviceCode, userCode, interval: POLL_INTERVAL_S, expiresIn: TTL.pending / 1000 })
    }
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
  res.status(400).json({ error: 'client must be launcher or game' })
})

// GET /api/users/login-discord

router.get('/login-discord', browserLimiter, (req, res) => {
  const { state } = req.query
  if (typeof state !== 'string' || !state) return res.status(400).send(authPage({ ok: false, title: 'Login failed', message: 'This login link is incomplete. Return to the launcher and try again.' }))

  if (!config.discordClientId) {
    return res.status(503).send(authPage({
      ok: false, title: 'Login unavailable',
      message: 'Discord login is not configured on this server yet. Tell the server admin to set DISCORD_CLIENT_ID.',
    }))
  }

  const known = logins.peek(state)
  if (!known || known.flow === 'legacy') {
    if (!legacyAllowed()) {
      loginFlowCounts.bump('legacyRefused')
      return res.status(410).send(authPage({ ok: false, title: 'Update your launcher', message: escapeHtml(OUTDATED) }))
    }
    // An old launcher's own state is registered once and never extended; browser Back re-opens the same pending login
    if (!known && logins.registerLegacy(state) !== 'created') {
      return res.status(400).send(authPage({ ok: false, title: 'Login failed', message: 'This login link is not valid. Return to the launcher and try again.' }))
    }
    if (!known) console.log('[launcher-login] old-launcher login started')
  }
  if (known && known.status !== 'pending') {
    return res.status(400).send(authPage({ ok: false, title: 'Login link used', message: 'This login link was already used. Return to the launcher and press Discord Login again.' }))
  }

  res.redirect(oauth.authorizeUrl({ redirectUri: config.discordRedirectUri, state, prompt: 'consent' }))
})

// GET /api/users/login-discord/callback
// Discord's registered redirect URI: <MASTER_URL>/api/users/login-discord/callback, set in both DISCORD_REDIRECT_URI (.env) and the Discord app settings

router.get('/login-discord/callback', async (req, res) => {
  const { code, state, error } = req.query
  // Taken before anything else, so a state reaches Discord's token endpoint once whatever happens next
  const started = typeof state === 'string' ? logins.beginCallback(state) : null

  if (error) {
    if (started) logins.drop(state)
    return res.status(400).send(authPage({
      ok: false, title: 'Login cancelled',
      message: `Discord reported: ${escapeHtml(String(error))}. Return to the launcher and try again.`,
    }))
  }

  if (!started) {
    return res.status(400).send(authPage({
      ok: false, title: 'Login expired',
      message: 'This login link is no longer valid (it may have expired or already been used). Return to the launcher and try again.',
    }))
  }

  if (started.flow === 'legacy' && !legacyAllowed()) {
    logins.drop(state)
    loginFlowCounts.bump('legacyRefused')
    return res.status(410).send(authPage({ ok: false, title: 'Update your launcher', message: escapeHtml(OUTDATED) }))
  }

  if (typeof code !== 'string' || !code) {
    logins.drop(state)
    return res.status(400).send(authPage({
      ok: false, title: 'Login failed',
      message: 'The Discord response was missing its code. Return to the launcher and try again.',
    }))
  }

  let user
  try {
    const tokenData = await oauth.exchangeCode({ code, redirectUri: config.discordRedirectUri })
    const u = await oauth.getUser(tokenData.access_token)
    if (typeof u.id !== 'string' || !u.id) throw new Error('Discord returned a user without an id')
    user = { id: u.id, username: String(u.global_name || u.username || ''), avatar: oauth.avatarUrl(u) }
  } catch (err) {
    console.error('[launcher-login] Discord callback error:', err.message)
    logins.drop(state)
    return res.status(500).send(authPage({
      ok: false, title: 'Login failed',
      message: 'Something went wrong while talking to Discord. Return to the launcher and try again.',
    }))
  }

  const next = logins.discordDone(state, user)
  if (!next) {
    return res.status(400).send(authPage({ ok: false, title: 'Login expired', message: 'This login took too long. Return to the launcher and try again.' }))
  }

  // The launcher's answer goes to the PC that started the login, never to whoever holds the state
  if (next.flow === 'loopback') {
    const to = new URL(`http://127.0.0.1:${next.port}/discord/callback`)
    to.searchParams.set('code', next.code)
    to.searchParams.set('state', state)
    return res.redirect(to.href)
  }

  res.send(confirmPage({ flow: next.flow, state, nonce: next.nonce, username: user.username }))
})

// POST /api/users/login-discord/confirm

router.post('/login-discord/confirm', express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
  const { state, nonce, user_code: userCode } = req.body || {}
  const r = logins.confirm(state, nonce, userCode)
  if (r.result === 'ok') {
    console.log(`[launcher-login] ${r.flow} login confirmed on the page`)
    const where = r.flow === 'device' ? 'game' : 'launcher'
    return res.send(authPage({
      ok: true, title: 'Logged in', tag: r.flow === 'device' ? 'Game sign-in' : undefined,
      message: `Welcome, <strong>${escapeHtml(r.username)}</strong>. Return to the DragonBreak ${where}: it finishes signing in by itself in a few seconds.`,
      autoClose: true,
    }))
  }
  if (r.result === 'badCode') {
    return res.status(400).send(confirmPage({ flow: 'device', state, nonce, username: r.username,
      error: `That code does not match the one in your game. ${r.left} ${r.left === 1 ? 'try' : 'tries'} left.` }))
  }
  if (r.result === 'tooMany') {
    return res.status(400).send(authPage({ ok: false, title: 'Login stopped', tag: 'Game sign-in', message: 'Too many wrong codes. Start the sign-in again from the game.' }))
  }
  res.status(400).send(authPage({ ok: false, title: 'Login expired', message: 'This page has expired or was already used. Start the login again from the launcher or the game.' }))
})

// One login's session, made only now that the device that started it has proved itself; a login ends the account's older sessions
function deliverLogin(res, user, flow) {
  const { createSession } = require('./master-api')
  let made
  try {
    made = createSession({ id: user.id, username: user.username }, { flow })
  } catch (err) {
    console.error('[launcher-login] could not create a session:', err.message)
    return res.status(503).json({ error: 'sessionsUnavailable' })
  }
  loginFlowCounts.bump(flow)
  console.log(`[launcher-login] ${flow} login delivered for profile ${made.profileId}${made.ended ? `, ${made.ended} older session(s) ended` : ''}`)
  res.json({
    token:                made.session,
    masterApiId:          made.profileId,
    discordUsername:      user.username || null,
    discordDiscriminator: null,            // not stored; nullable in SkyMP
    discordAvatar:        user.avatar || null,
  })
}

// POST /api/users/login-discord/token

router.post('/login-discord/token', exchangeLimiter, (req, res) => {
  const { state, code, code_verifier: verifier } = req.body || {}
  const user = logins.exchange(state, code, verifier)
  if (!user) return res.status(400).json({ error: 'invalid_grant' })
  deliverLogin(res, user, 'loopback')
})

// POST /api/users/login-discord/poll

router.post('/login-discord/poll', pollLimiter, (req, res) => {
  const { state, device_code: deviceCode } = req.body || {}
  const r = logins.poll(state, deviceCode)
  if (r.gone) return res.status(403).json({ error: 'expired_token' })
  if (r.pending) return res.status(401).json({ error: 'authorization_pending' })
  deliverLogin(res, r.user, 'device')
})

// GET /api/users/login-discord/status

router.get('/login-discord/status', (req, res) => {
  const { state } = req.query
  if (!state) return res.status(400).json({ error: 'Missing state.' })
  // The old launcher gives up after 10 answers it does not know, and shows this status
  if (!legacyAllowed()) return res.status(426).json({ error: 'launcherOutdated', message: OUTDATED })

  const r = logins.legacyStatus(state)
  if (r.gone)    return res.status(403).json({ error: 'Unknown or expired state.' })
  if (r.pending) return res.status(401).json({ error: 'Auth not completed yet.' })
  deliverLogin(res, r.user, 'legacy')
})

// POST /api/users/me/play/:serverKey

router.post('/me/play/:serverKey', (req, res) => {
  const token = req.headers['authorization']
  if (!token) return res.status(401).json({ error: 'Missing authorization header.' })

  if (req.params.serverKey !== config.serverMasterKey) {
    return res.status(403).json({ error: 'Invalid server key.' })
  }

  const { lookupSession } = require('./master-api')
  const session = lookupSession(token)
  if (!session) return res.status(401).json({ error: 'Invalid or expired session token.' })

  // Optional hardware id from the client; used by the ban system
  const hwid = sanitizeHwid(req.body && req.body.hwid)
  if (hwid) storeHwid(token, session, hwid)

  res.json({ session: token })
})

// POST /api/users/me/hwid
// Called by the launcher right after login; missing/invalid hwid is a soft no-op.

router.post('/me/hwid', (req, res) => {
  const token = authToken(req)
  if (!token) return res.status(401).json({ error: 'Missing authorization header.' })

  const { lookupSession } = require('./master-api')
  const session = lookupSession(token)
  if (!session) return res.status(401).json({ error: 'Invalid or expired session token.' })

  const hwid = sanitizeHwid(req.body && req.body.hwid)
  if (!hwid) return res.json({ ok: false })

  storeHwid(token, session, hwid)
  res.json({ ok: true })
})

// Browser-facing pages

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// End-of-OAuth page; autoClose tries window.close(), which browsers only honour for some external-app-opened tabs, so the message stays as a fallback
// Styled by the website's own stylesheet (same origin through the public proxy), so it always matches the site
function authPage({ ok, title, message, autoClose = false, tag = 'Launcher sign-in', form = '', mark: markHtml = null }) {
  const tone = ok ? 'ok' : 'bad'
  const mark = markHtml || (ok ? '&#10003;' : '&#10007;')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dragon Break - ${escapeHtml(title)}</title>
<link rel="icon" href="/dbo-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=Roboto+Condensed:wght@300;400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/dbo.css">
<style>
  body { background: #08191c; color: #d7e3e3; font-family: 'Roboto Condensed', sans-serif; }
  .wrap { max-width: 560px; }
  .hero { text-align: center; padding: 2.5rem 0 1.2rem; }
  .hero h1 { font-size: clamp(1.8rem, 6vw, 2.6rem); }
  .panel { text-align: center; padding: 2rem 1.6rem; }
  .mark { width: 3.6rem; height: 3.6rem; margin: 0 auto 1rem; border-radius: 50%; border: 2px solid currentColor;
          display: flex; align-items: center; justify-content: center; font-size: 1.6rem; }
  .panel h2 { margin: 0 0 .7rem; border: 0; padding: 0; }
  .panel p { margin: 0; }
  .panel .meta { margin-top: 1.2rem; }
  .panel form { margin-top: 1.4rem; display: flex; flex-direction: column; align-items: center; gap: .8rem; }
  .panel input[type=text] { font: 600 1.5rem 'Roboto Condensed', sans-serif; letter-spacing: .25em; text-align: center; text-transform: uppercase;
          width: 12ch; padding: .5rem .7rem; background: #0e2a2e; color: #d7e3e3; border: 1px solid #3c6a6e; border-radius: 4px; }
  .panel button { font: 700 1rem 'Roboto Condensed', sans-serif; letter-spacing: .08em; text-transform: uppercase; cursor: pointer;
          padding: .6rem 1.6rem; background: #c8a25f; color: #08191c; border: 0; border-radius: 4px; }
  .panel .warn { margin-top: 1rem; }
  .panel .err { margin-top: .8rem; color: #e08a80; }
</style>
</head>
<body>
<img class="wm" src="/dbo-watermark.png" alt="">
<div class="wrap">
  <div class="hero">
    <h1>Dragon Break</h1>
    <div class="tag">${escapeHtml(tag)}</div>
  </div>
  <div class="panel">
    <div class="mark ${tone}">${mark}</div>
    <h2 class="${tone}">${escapeHtml(title)}</h2>
    <p>${message}</p>
    ${form}
    <p class="meta" id="note">${autoClose ? 'This tab will close itself&hellip;' : ''}</p>
  </div>
  <footer>Dragon Break &middot; time runs differently here</footer>
</div>
${autoClose ? `<script>
  window.close()
  setTimeout(function () {
    var n = document.getElementById('note')
    if (n) n.textContent = 'You can close this tab now and return to the launcher.'
  }, 600)
</script>` : ''}
</body>
</html>`
}

// The page between Discord and the result: the old launcher's Continue button, or the game's code; only this page's nonce can answer it
function confirmPage({ flow, state, nonce, username, error = '' }) {
  const hidden = `<input type="hidden" name="state" value="${escapeHtml(state)}"><input type="hidden" name="nonce" value="${escapeHtml(nonce)}">`
  const who = `You are signed in to Discord as <strong>${escapeHtml(username)}</strong>.`
  const err = error ? `<p class="err">${escapeHtml(error)}</p>` : ''
  if (flow === 'device') {
    return authPage({
      ok: true, mark: '?', title: 'Enter the code from your game', tag: 'Game sign-in',
      message: `${who} To sign in to DragonBreak, type the code your game is showing on this PC right now.`,
      form: `<form method="post" action="/api/users/login-discord/confirm">${hidden}
      <input type="text" name="user_code" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX" required autofocus>
      ${err}<button type="submit">Sign in the game</button></form>
      <p class="warn"><strong>Never type a code that someone sent you.</strong> Staff will never ask for it. A code from anyone else would let them play as you.</p>`,
    })
  }
  return authPage({
    ok: true, mark: '?', title: 'Finish signing in',
    message: `${who} Press Continue only if you pressed <strong>Discord Login</strong> in the DragonBreak launcher on this PC in the last few minutes. That signs in your launcher, which can then play as you.`,
    form: `<form method="post" action="/api/users/login-discord/confirm">${hidden}${err}<button type="submit">Continue</button></form>
    <p class="warn"><strong>If someone sent you this link, close this tab now.</strong> Continuing would let them play as you.</p>`,
  })
}

module.exports = router
