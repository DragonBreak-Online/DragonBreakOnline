'use strict'
// The console's punishment hardening on the backend: the page account (targetProfileId) and its fresh roles, the allow.json flags, the signed payload, the reason table

const { test, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const path = require('path')

require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
const rules = require('../sources/console/allowlist')
const { createConsoleFixture, uuid, ALLOW, ID, GUILD, ROLE } = require('./helpers/consoleFixture')

const ch = n => String.fromCodePoint(n)
// allow.json as console.js (gameplay branch punish-hardening-1021) writes it with the repo config
const DISCIPLINE = {
  name: 'discipline', usage: '/discipline #TAG warn|strike|lift <reason>; suspend <1-720h|1-30d> <reason>; overturn <n> <reason>', rule: 'tagKindReason',
  help: 'x', kinds: ['warn', 'strike', 'suspend', 'lift', 'overturn'], maxSuspendDays: 30, targetProfile: true, rank: true,
}
const TAGGED = new Set(['kick', 'fixloc', 'rename', 'chargen', 'chars'])
const FLAGGED = [...ALLOW.map(a => (TAGGED.has(a.name) ? { ...a, targetProfile: true, ...(a.name === 'kick' ? { rank: true } : {}) } : a)), DISCIPLINE]

let F
const writeAllow = list => fs.writeFileSync(path.join(F.dir, 'allow.json'), JSON.stringify(list), { mode: 0o600 })
const run = (text, extra = {}, id = uuid()) => F.api.runStaffCommand(F.api.webCaller(F.session(ID.jake)), { uuid: id, text, ...extra })
before(() => { F = createConsoleFixture('dbo-console-hardening-') })
after(() => F.cleanup())
beforeEach(() => {
  F.audits.length = 0; F.logs.length = 0; F.requests.length = 0; F.answer = null; F.lookups = 0
  F.members.set(ID.gm, { roles: [GUILD, ROLE.gm], handle: 'gemma' })
  fs.writeFileSync(F.switchFile, 'on\n')
  writeAllow(FLAGGED)
  F.make()
  F.startGame()
})

test('parseAllow keeps the targetProfile and rank flags the game writes, and only a true one', () => {
  const allow = rules.parseAllow(JSON.stringify(FLAGGED))
  assert.deepEqual(allow.filter(a => a.targetProfile).map(a => a.name).sort(), ['chargen', 'discipline', 'fixloc', 'kick', 'rename'])
  assert.deepEqual(allow.filter(a => a.rank).map(a => a.name).sort(), ['discipline', 'kick'])
  const odd = rules.parseAllow(JSON.stringify([{ ...ALLOW[2], targetProfile: 'yes', rank: 1 }]))
  assert.deepEqual(odd, [{ name: 'kick', rule: 'tag', usage: '/kick #TAG', help: 'x' }], 'a flag that is not true is no flag, and the list is kept')
  assert.equal(rules.parseAllow(JSON.stringify(ALLOW)).some(a => 'targetProfile' in a || 'rank' in a), false, 'an older game writes neither')
})

test('the page reads which commands take its account and which carry the rank check', () => {
  const s = F.api.state('web')
  assert.deepEqual(s.commands.find(c => c.name === 'discipline'), { name: 'discipline', usage: DISCIPLINE.usage, help: 'x', kinds: DISCIPLINE.kinds, maxSuspendDays: 30, targetProfile: true, rank: true })
  assert.deepEqual(s.commands.find(c => c.name === 'kick'), { name: 'kick', usage: '/kick #TAG', help: 'x', targetProfile: true, rank: true })
  assert.deepEqual(s.commands.find(c => c.name === 'players'), { name: 'players', usage: '/players', help: 'x' })
})

test('the signed payload is the game\'s: the 11 fields as before, then targetProfileId and targetRoles (or null) when present', () => {
  const pinned = { v: 1, id: 'w-7a2b3c4d-5e6f-4a01-9b2c-000000000001', src: 'web', discordId: '200000000000000001', user: 'jake', profileId: 1, roles: ['1494126527489507369'],
    text: '/discipline #8KWH warn Spamming the chat', mode: 'on', issuedAt: 1000, expiresAt: 2000 }
  const base = 'dbo-console-req-v1\n[1,"w-7a2b3c4d-5e6f-4a01-9b2c-000000000001","web","200000000000000001","jake",1,["1494126527489507369"],"/discipline #8KWH warn Spamming the chat","on",1000,2000'
  assert.equal(rules.reqPayload(pinned), `${base}]`)
  assert.equal(rules.reqPayload({ ...pinned, targetProfileId: 5 }), `${base},5,null]`)
  assert.equal(rules.reqPayload({ ...pinned, targetProfileId: 5, targetRoles: ['1494126618065506425'] }), `${base},5,["1494126618065506425"]]`)
})

test('a page account is sent signed with the command, with the account\'s fresh Discord roles for a rank-checked one', async () => {
  F.answer = () => ({ target: 'Gemma #GMGM', lines: [{ to: 'you', text: 'Recorded: warn #1 on Gemma #GMGM.' }] })
  const r = await run('/discipline #GMGM warn Spamming the market chat', { targetProfileId: 3 })
  assert.equal(r.status, 200)
  assert.equal(r.body.job.state, 'ran')
  assert.equal(F.requests.length, 1)
  const q = F.requests[0]
  assert.equal(q.sigOk, true)
  assert.equal(q.targetProfileId, 3)
  assert.deepEqual(q.targetRoles, [GUILD, ROLE.gm], "profile 3's Discord account, asked of Discord now")
  assert.equal(F.lookups, 2, 'the caller, then the target account')
  assert.ok(F.audits.some(l => /via web req [0-9a-f]{8} \(page profile 3\): \/discipline #GMGM warn Spamming the market chat$/.test(l)), F.audits.join('\n'))
  await run('/kick #GMGM', { targetProfileId: 3 })
  assert.deepEqual(F.requests[1].targetRoles, [GUILD, ROLE.gm], '/kick carries the rank check too')
})

test('a command without the rank check gets the account and no roles; no account, no fields at all', async () => {
  await run('/rename #GMGM Gemmalyn', { targetProfileId: 3 })
  assert.equal(F.requests[0].targetProfileId, 3)
  assert.equal('targetRoles' in F.requests[0], false)
  assert.equal(F.lookups, 1, 'no lookup of the target for /rename')
  await run('/discipline #GMGM warn Without an account this time')
  assert.deepEqual(Object.keys(F.requests[1]).filter(k => k.startsWith('target')), [], 'twelve keys as before')
  assert.equal(F.requests[1].sigOk, true)
})

test('the account\'s roles are left out when Discord does not answer or the store knows no Discord account for it; the account still goes', async () => {
  F.members.set(ID.gm, 'throw')
  await run('/discipline #GMGM warn Discord did not answer here', { targetProfileId: 3 })
  assert.equal(F.requests[0].targetProfileId, 3)
  assert.equal('targetRoles' in F.requests[0], false)
  await run('/discipline #ZZZZ warn A profile nobody holds in Discord', { targetProfileId: 99 })
  assert.equal(F.requests[1].targetProfileId, 99)
  assert.equal('targetRoles' in F.requests[1], false)
})

test('a page account for a command the game does not check it for is refused before anything is sent (noProfileCheck)', async () => {
  for (const [list, text] of [[ALLOW.concat({ ...DISCIPLINE, targetProfile: undefined, rank: undefined }), '/discipline #GMGM warn An older game here'], [ALLOW, '/kick #GMGM'],
    [FLAGGED, '/players'], [FLAGGED, '/wwremote clear #GMGM']]) {
    writeAllow(list)
    const r = await run(text, { targetProfileId: 3 })
    assert.equal(r.status, 422, text)
    assert.equal(r.body.error, 'notRemote', text)
    assert.equal(r.body.why, 'noProfileCheck', text)
    const cmd = text.slice(1).split(' ')[0]
    assert.equal(r.body.reason, `The game does not check /${cmd} against the account you opened yet, so it was not sent. Copy the command and run it in game.`)
  }
  fs.rmSync(path.join(F.dir, 'allow.json'))
  const none = await run('/kick #GMGM', { targetProfileId: 3 })
  assert.equal(none.body.why, 'noProfileCheck', 'without allow.json nobody can say the game checks it')
  F.stopGame()
  assert.equal(F.requests.length, 0)
})

test('a targetProfileId that is not a whole number of at least 0 is a bad request', async () => {
  for (const v of [-1, '3', 1.5, null, 2 ** 53]) {
    const r = await run('/kick #GMGM', { targetProfileId: v })
    assert.equal(r.status, 400, String(v))
    assert.equal(r.body.error, 'badRequest', String(v))
  }
  F.stopGame()
  assert.equal(F.requests.length, 0)
})

// One reason table for the game, this pre-check and the page (console-hardening-harness H4 holds the same rows)
test('the reason table: the class, the Hangul fillers, astral characters, 5..300 UTF-16 units after NFC and the folding', () => {
  const allow = rules.parseAllow(JSON.stringify(FLAGGED))
  const TABLE = [
    ['abcde', ''], ['abcd', 'reasonShort'], ['', 'reasonShort'], ['a'.repeat(300), ''], ['a'.repeat(301), 'reasonLong'],
    [`${ch(0xe9)}`.repeat(300), ''], [`e${ch(0x301)}`.repeat(150), ''], [`e${ch(0x301)}`.repeat(301), 'reasonLong'], [`${ch(0x1100)}${ch(0x1161)}`.repeat(5), ''],
    ['Plain . , ; : ! ? \' " ( ) - / & + %', ''], ['Женя Åsa über', ''], ['한글 Hangul letters', ''], ['١٢٣ Arabic-Indic digits', ''],
    [ch(0x3164).repeat(5), 'reasonChars'], [`ok ${ch(0x115f)} reason`, 'reasonChars'], [`ok ${ch(0x1160)} reason`, 'reasonChars'], [`ok ${ch(0xffa0)} reason`, 'reasonChars'],
    [`${ch(0x1d400)}bcdef`, 'reasonChars'], [`${ch(0x20000)} CJK B`, 'reasonChars'], [`smile ${ch(0x1f600)} x`, 'reasonChars'], [`x${ch(0x301)}${ch(0x301)} marks`, 'reasonChars'],
    ['#{ff0000}red', 'reasonChars'], ['a_b c d e', 'reasonChars'], ['<@1> ping', 'reasonChars'], ['pipe | here', 'reasonChars'], ['back \\ slash', 'reasonChars'],
    [`curly ${ch(0x2019)} quote`, 'reasonChars'], [`en ${ch(0x2013)} dash`, 'reasonChars'], [`nbsp${ch(0xa0)}folded here`, ''], [`zero${ch(0x200b)}width folded`, ''],
    [`${ch(0x2800)}${ch(0x2800)}${ch(0x2800)}${ch(0x2800)}${ch(0x2800)}`, 'reasonChars'], [`fullwidth ${ch(0xff21)}${ch(0xff22)}`, ''], ['ab\ncd ef', ''],
  ]
  const wrong = TABLE.map(([t, want]) => {
    const line = rules.cleanCommand(`/discipline #8KWH warn ${t}`) || ''
    return [JSON.stringify(t).slice(0, 40), want, (rules.precheck(line, allow, line) || {}).why || '']
  }).filter(([, w, g]) => w !== g)
  assert.deepEqual(wrong, [])
})

// The route: the optional third key reaches runStaffCommand; anything else is still a bad request
test('POST /run takes {requestId, command, targetProfileId} and passes the account on', async () => {
  const ORIGIN = 'https://site.example'
  const stub = (rel, exports) => { const file = require.resolve(path.join('..', rel)); require.cache[file] = { id: file, filename: file, loaded: true, exports } }
  let last = null
  const spy = { ...F.api, runStaffCommand: (caller, req) => { last = req; return F.api.runStaffCommand(caller, req) } }
  stub('sources/console/index.js', { consoleApi: () => spy })
  stub('routes/site-auth.js', { internals: {
    currentSession: req => F.siteSessions.validate(String(req.headers['x-test-session'] || '')), sessionToken: req => String(req.headers['x-test-session'] || ''),
    sameOrigin: req => req.get('origin') === ORIGIN } })
  stub('routes/site-staff.js', { internals: { requireStaff: (req, res, next) => { const s = F.siteSessions.validate(String(req.headers['x-test-session'] || '')); if (!s) return res.status(401).json({}); req.staff = s; next() } } })
  const express = require('express')
  const app = express()
  app.use('/api/site/staff/console', require('../routes/site-console'))
  const server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const post = body => new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request(`http://127.0.0.1:${server.address().port}/api/site/staff/console/run`, { method: 'POST', agent: false, headers: {
      'content-type': 'application/json', origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-dbo-control': '1', 'x-test-session': F.session(ID.jake), 'content-length': Buffer.byteLength(payload) } }, res => {
      let text = ''
      res.on('data', c => { text += c })
      res.on('end', () => resolve({ status: res.statusCode, json: text ? JSON.parse(text) : null }))
    })
    req.on('error', reject)
    req.end(payload)
  })
  try {
    const ok = await post({ requestId: uuid(), command: '/discipline #GMGM warn From the Punishments page', targetProfileId: 3 })
    assert.equal(ok.status, 200)
    assert.equal(last.targetProfileId, 3)
    assert.equal(F.requests.at(-1).targetProfileId, 3)
    const two = await post({ requestId: uuid(), command: '/whoami' })
    assert.equal(two.status, 200, 'the two-key body works as before')
    assert.equal('targetProfileId' in last, false)
    for (const body of [{ requestId: uuid(), command: '/kick #GMGM', targetProfileId: '3' }, { requestId: uuid(), command: '/kick #GMGM', targetProfileId: -1 },
      { requestId: uuid(), command: '/kick #GMGM', targetProfileId: 3, extra: 1 }, { requestId: uuid(), command: '/kick #GMGM', profileId: 3 }]) {
      const r = await post(body)
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.equal(r.json.error, 'badRequest', JSON.stringify(body))
    }
  } finally { server.close() }
})

test('one request id sent twice while the target account\'s roles are fetched reaches the game once', async () => {
  const real = F.discordBot.getMemberFresh
  F.discordBot.getMemberFresh = async id => { if (id === ID.gm) await new Promise(r => setTimeout(r, 300)); return real(id) }
  try {
    const caller = F.api.webCaller(F.session(ID.jake))
    const body = { uuid: uuid(), text: '/discipline #GMGM strike The page sent this one twice', targetProfileId: 3 }
    const first = F.api.runStaffCommand(caller, body)
    await new Promise(r => setTimeout(r, 50))
    const [a, b] = await Promise.all([first, F.api.runStaffCommand(caller, body)])
    assert.equal(F.requests.filter(q => q.id === `w-${body.uuid}`).length, 1, 'sent once')
    assert.equal(F.audits.filter(l => l.includes(`req ${body.uuid.slice(0, 8)} (page profile 3)`)).length, 1, 'one audit line')
    assert.equal(a.status, 200)
    assert.equal(a.body.job.state, 'ran')
    assert.ok([200, 202].includes(b.status), String(b.status))
    assert.equal(b.body.job.id, a.body.job.id)
  } finally { F.discordBot.getMemberFresh = real }
})
