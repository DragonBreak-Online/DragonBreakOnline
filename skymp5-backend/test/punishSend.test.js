'use strict'
// POST /api/site/staff/punishments/actions/send over HTTP: /discipline and /kick only, through the console's one function,
// for Owners, Dev and Lead GMs; the #TAG must be the named account's; the general console stays Owners and Dev only.
// The account goes to the game as targetProfileId, with its fresh roles, exactly as the Console panel's /run sends it

const { test, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const { createActionsFixture, ORIGIN, uuid, ALLOW, HARDENED_ALLOW, GUILD, ROLE } = require('./helpers/punishActionsFixture')

const H = createActionsFixture()
const { PEOPLE, F } = H
const route = require('../routes/site-punish-actions')
let server, base

before(async () => {
  const express = require('express')
  const { parserExcept } = require('../sources/problemReport')
  const app = express()
  app.use(parserExcept([...route.OWN_PARSER_PATHS, '/api/site/staff/console/run'], express.json()))
  app.use('/api/site/staff/punishments/actions', route)
  app.use('/api/site/staff/console', require('../routes/site-console'))
  server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
  F.startGame()
})
after(() => { server.close(); H.cleanup() })
beforeEach(() => {
  H.reset()
  F.audits.length = 0
  fs.writeFileSync(F.switchFile, 'on\n')
  H.allow(HARDENED_ALLOW)
  // A fresh console each test, so its per-account limits start empty
  F.make()
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
const send = (who, body, { url = '/api/site/staff/punishments/actions/send', token } = {}) => request('POST', url, {
  'content-type': 'application/json', origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-dbo-control': '1', 'x-test-session': token || session(who),
}, JSON.stringify(body))
const kick = (command = '/kick #BOB1', extra = {}) => ({ requestId: uuid(), profileId: PEOPLE.bob.profileId, command, confirm: 'SEND', ...extra })
const want = (r, status, error) => { assert.equal(r.status, status, r.text); if (error) assert.equal(r.json.error, error, r.text); H.clean(r.json); return r.json }

test('a Lead GM sends /kick #TAG for the account it names; it runs in game as their web caller, with the console\'s audit', async () => {
  const body = kick()
  const token = session('lead')
  const r = want(await send('lead', body, { token }), 200)
  assert.equal(r.job.state, 'ran')
  assert.equal(r.job.command, '/kick #BOB1')
  const sent = F.requests.at(-1)
  assert.deepEqual([sent.src, sent.discordId, sent.text, sent.mode, sent.sigOk], ['web', PEOPLE.lead.discordId, '/kick #BOB1', 'on', true])
  // The page's account and its fresh roles, signed, for the game's account and rank checks
  assert.deepEqual([sent.targetProfileId, sent.targetRoles], [PEOPLE.bob.profileId, [GUILD]])
  assert.ok(F.audits.some(l => l === `CONSOLE lena_lead (<@${PEOPLE.lead.discordId}>) via web punish req ${body.requestId.slice(0, 8)} (page profile ${PEOPLE.bob.profileId}): /kick #BOB1`), F.audits.join('\n'))
  // The job is read back here, own only (a Lead GM cannot read /console/jobs)
  const job = await request('GET', `/api/site/staff/punishments/actions/jobs/${body.requestId}`, { 'x-test-session': token })
  assert.equal(want(job, 200).job.id, `w-${body.requestId}`)
  want(await request('GET', `/api/site/staff/punishments/actions/jobs/${body.requestId}`, { 'x-test-session': session('owner') }), 404, 'notFound')
  want(await request('GET', `/api/site/staff/console/jobs/${body.requestId}`, { 'x-test-session': token }), 403, 'notStaff')
})

test('only /discipline and /kick: /fixloc is notPunish and never reaches the game, though the game checks its account', async () => {
  const n = F.requests.length
  want(await send('owner', kick('/fixloc #BOB1')), 422, 'notPunish')
  want(await send('owner', kick('/rename #BOB1 Robert')), 422, 'notPunish')
  want(await send('owner', kick('/say hello')), 422, 'notPunish')
  want(await send('owner', kick('/kick #BOB1 now')), 422, 'notRemote')
  const t = want(await send('owner', kick('/kick')), 422, 'notRemote')
  assert.equal(t.why, 'needTag')
  want(await send('owner', kick('not a command at all!')), 422, 'notPunish')
  assert.equal(F.requests.length, n)
  // /discipline with the game's rule: every kind goes with the account
  for (const line of ['/discipline #BOB1 warn Spamming the trade chat', '/discipline #BOB1 strike Spamming the trade chat', '/discipline #BOB1 suspend 3d Spamming the trade chat']) {
    const r = want(await send('lead', kick(line)), 200)
    assert.equal(r.job.state, 'ran', line)
    assert.deepEqual([F.requests.at(-1).text, F.requests.at(-1).targetProfileId, F.requests.at(-1).targetRoles], [line, PEOPLE.bob.profileId, [GUILD]])
  }
  const bad = want(await send('lead', kick('/discipline #BOB1 warn <@1>')), 422, 'notRemote')
  assert.equal(bad.why, 'reasonChars')
  assert.equal(F.requests.length, n + 3)
})

test('today\'s game (no account check in allow.json): /kick and /discipline are refused before anything is sent, as /console/run refuses them', async () => {
  H.allow(ALLOW)
  const n = F.requests.length
  const k = want(await send('owner', kick()), 422, 'notRemote')
  assert.equal(k.why, 'noProfileCheck')
  assert.match(k.reason, /does not check \/kick against the account you opened yet/)
  const run = want(await send('owner', { requestId: uuid(), command: '/kick #BOB1', targetProfileId: PEOPLE.bob.profileId }, { url: '/api/site/staff/console/run' }), 422, 'notRemote')
  assert.deepEqual([run.why, run.reason], [k.why, k.reason], 'the same answer as the Console panel')
  const d = want(await send('owner', kick('/discipline #BOB1 warn Spamming the trade chat')), 422, 'notRemote')
  assert.equal(d.why, 'notYet', 'allow.json has no /discipline rule until the game publishes it')
  assert.equal(F.requests.length, n)
  // The page offers Copy only
  const info = H.actions.info(session('owner'), 'owner')
  assert.deepEqual([info.send.commands, info.can.send], [[], false])
  H.allow(HARDENED_ALLOW)
  const after = H.actions.info(session('owner'), 'owner')
  assert.deepEqual([after.send.commands, after.can.send], [['discipline', 'kick'], true])
})

test('the request the game gets from /actions/send is the one /console/run sends for the same line and account', async () => {
  const pick = r => Object.fromEntries(['v', 'src', 'discordId', 'user', 'profileId', 'roles', 'text', 'mode', 'targetProfileId', 'targetRoles', 'sigOk'].map(k => [k, r[k]]))
  for (const [line, pid] of [['/kick #BOB1', PEOPLE.bob.profileId], ['/discipline #BOB1 strike Spamming the trade chat', PEOPLE.bob.profileId], ['/kick #GIN1', PEOPLE.gina.profileId]]) {
    want(await send('owner', { requestId: uuid(), command: line, targetProfileId: pid }, { url: '/api/site/staff/console/run' }), 200)
    const viaRun = pick(F.requests.at(-1))
    want(await send('owner', kick(line, { profileId: pid })), 200)
    const viaSend = pick(F.requests.at(-1))
    assert.deepEqual(viaSend, viaRun, line)
    assert.equal(viaSend.targetProfileId, pid)
    assert.ok(Array.isArray(viaSend.targetRoles) && viaSend.sigOk, line)
  }
  // A GM target's fresh roles go along, so the game's rank check sees them
  assert.deepEqual(F.requests.at(-1).targetRoles, [GUILD, ROLE.gm])
})

test('the #TAG must be the named account\'s; never your own account; never staff of your rank or higher', async () => {
  want(await send('lead', kick('/kick #GIN1')), 409, 'wrongTarget')
  want(await send('lead', kick('/kick #BOB2')), 409, 'wrongTarget')
  want(await send('lead', kick('/kick #LED1', { profileId: PEOPLE.lead.profileId })), 403, 'ownAccount')
  want(await send('lead', kick('/kick #NATE', { profileId: PEOPLE.dev.profileId })), 403, 'staffTarget')
  want(await send('lead', kick('/kick #ADM1', { profileId: PEOPLE.actor.profileId })), 403, 'staffTarget')
  want(await send('owner', kick('/kick #JAKE', { profileId: PEOPLE.owner.profileId })), 403, 'ownAccount')
  want(await send('lead', kick('/kick #GIN1', { profileId: PEOPLE.gina.profileId })), 200)
  want(await send('lead', kick('/kick #BOB1', { profileId: 999 })), 404, 'notFound')
})

test('a GM is refused; the general console stays Owners and Dev, so a Lead GM is refused /console/run', async () => {
  want(await send('gm', kick()), 403, 'notAllowed')
  // A Trial GM has no panel rank, so the route refuses them before the actions module
  want(await send('trial', kick()), 403, 'notStaff')
  want(await send('actor', kick()), 403, 'notAllowed')
  const n = F.requests.length
  want(await send('lead', { requestId: uuid(), command: '/kick #BOB1' }, { url: '/api/site/staff/console/run' }), 403, 'notStaff')
  want(await request('GET', '/api/site/staff/console', { 'x-test-session': session('lead') }), 403, 'notStaff')
  assert.equal(F.requests.length, n)
  want(await send('owner', { requestId: uuid(), command: '/whoami' }, { url: '/api/site/staff/console/run' }), 200)
})

test('one run per request id: the same line answers the first job, another line is a conflict', async () => {
  const body = kick()
  const first = want(await send('owner', body), 200)
  const n = F.requests.length
  assert.deepEqual(want(await send('owner', body), 200).job, first.job)
  want(await send('owner', { ...body, command: '/kick #BOB1 ' }), 200, null)
  want(await send('owner', { ...body, command: '/kick #GIN1' }), 409, 'conflict')
  want(await send('dev', body), 409, 'conflict')
  // A known id answers its first job and sends nothing, whatever account the body names
  assert.deepEqual(want(await send('owner', { ...body, profileId: PEOPLE.gina.profileId }), 200).job, first.job)
  assert.equal(F.requests.length, n)
})

test('the switch: PUNISH_ACTIONS send=dry-run caps the console to a dry run; send=off is off; the console\'s own web=off still refuses', async () => {
  route.internals.setService(H.make({ config: { punishActions: 'on send=dry-run' } }))
  want(await send('lead', kick()), 200)
  assert.equal(F.requests.at(-1).mode, 'dry-run')
  route.internals.setService(H.make({ config: { punishActions: 'on send=off' } }))
  want(await send('lead', kick()), 503, 'actionsOff')
  route.internals.setService(H.make({ config: { punishActions: 'off' } }))
  want(await send('owner', kick()), 503, 'actionsOff')
  route.internals.setService(H.make())
  fs.writeFileSync(F.switchFile, 'on web=off\n')
  want(await send('owner', kick()), 503, 'consoleOff')
  fs.writeFileSync(F.switchFile, 'dry-run\n')
  want(await send('owner', kick()), 200)
  assert.equal(F.requests.at(-1).mode, 'dry-run')
})

test('a sign-in older than 4 hours is signInAgain, before Discord is asked', async () => {
  const lookups = F.lookups
  const r = want(await send('lead', kick(), { token: session('lead', 5 * 3600 * 1000) }), 401, 'signInAgain')
  assert.equal(r.signInUrl, '/api/site/login/fresh')
  assert.equal(F.lookups, lookups)
})
