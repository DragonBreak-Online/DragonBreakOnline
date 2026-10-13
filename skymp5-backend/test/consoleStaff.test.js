'use strict'
// sources/console/staffConsole.js and spool.js: the one runStaffCommand, its callers, every refusal step, the spool and the job store

const { test, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
const { ChatInputCommandInteraction } = require('discord.js')
const { createConsoleFixture, uuid, GUILD, ROLE, ID } = require('./helpers/consoleFixture')
const { createSpool } = require('../sources/console/spool')

let F
const RLO = String.fromCharCode(0x202e)
const web = (id = ID.jake, ago) => F.api.webCaller(F.session(id, ago))
const run = (caller, text, id = uuid()) => F.api.runStaffCommand(caller, { uuid: id, text })
const refusals = () => F.audits.concat(F.logs).filter(l => /CONSOLE refused|refused /.test(l))

before(() => { F = createConsoleFixture('dbo-console-staff-') })
after(() => F.cleanup())
beforeEach(() => {
  F.audits.length = 0; F.logs.length = 0; F.requests.length = 0; F.answer = null; F.claimOnly = false; F.lookups = 0
  fs.writeFileSync(F.switchFile, 'on\n')
  F.make()
  F.startGame()
})

test('an allowed command goes out signed, runs once, and comes back as the job', async () => {
  const res = await run(web(), '/whoami')
  F.stopGame()
  assert.equal(res.status, 200)
  assert.equal(res.body.job.state, 'ran')
  assert.equal(res.body.job.summary, '/whoami: ran - Pong!')
  assert.equal(res.body.job.as, 'as Jake #ABCD (Senior, offline)')
  assert.equal(F.requests.length, 1)
  const r = F.requests[0]
  assert.equal(r.sigOk, true)
  assert.equal(r.fileMode, '600')
  assert.deepEqual({ src: r.src, discordId: r.discordId, user: r.user, profileId: r.profileId, text: r.text, mode: r.mode },
    { src: 'web', discordId: ID.jake, user: 'jake', profileId: 1, text: '/whoami', mode: 'on' })
  assert.deepEqual(r.roles, [GUILD, ROLE.owner], 'the roles fetched seconds ago go to the game, which takes the lower tier')
  assert.ok(r.expiresAt - r.issuedAt === 10000)
  assert.match(r.id, /^w-[0-9a-f-]{36}$/)
  assert.ok(F.audits.some(l => /^CONSOLE jake \(<@300000000000000001>\) via web req 7a1c2a3b: \/whoami$/.test(l)), F.audits.join('\n'))
  assert.ok(F.audits.some(l => /^CONSOLE req 7a1c2a3b -> ran as Jake #ABCD \(Senior\): Pong!$/.test(l)), F.audits.join('\n'))
})

test('the request sent to the game has no display name, only the cleaned Discord handle', async () => {
  F.members.set(ID.nate, { roles: [GUILD, ROLE.dev], handle: `nate${RLO}` })
  await run(web(ID.nate), '/whoami')
  F.members.set(ID.nate, { roles: [GUILD, ROLE.dev], handle: 'nate.pierce' })
  assert.equal(F.requests[0].user, 'unknown', 'an odd handle becomes unknown')
  assert.ok(!F.requests.some(r => JSON.stringify(r).includes('Display Name')))
  assert.ok(F.audits.every(l => !l.includes(RLO) && !l.includes('Display Name')))
})

test('the caller: only the two factories make one', async () => {
  const forged = Object.freeze({ source: 'web', discordId: ID.jake, signedInAt: Date.now() })
  assert.equal((await F.api.runStaffCommand(forged, { uuid: uuid(), text: '/whoami' })).status, 500)
  assert.equal((await F.api.runStaffCommand({ ...web() }, { uuid: uuid(), text: '/whoami' })).body.error, 'badCaller', 'a copy of a real caller is not one')
  assert.equal(F.requests.length, 0)
  assert.equal(F.api.webCaller('0'.repeat(64)), null, 'an unknown token')
  assert.equal(F.api.webCaller('not a token'), null)
  const c = web()
  assert.ok(Object.isFrozen(c))
  assert.throws(() => { 'use strict'; c.signedInAt = Date.now() })
})

test('the caller from Discord: a discord.js slash command of our own client, our guild, not a bot', () => {
  const make = (o = {}) => Object.assign(Object.create(ChatInputCommandInteraction.prototype), {
    id: '1400000000000000001', client: F.client, commandName: 'console', guildId: GUILD, channelId: '1553844758919774298', user: { id: ID.jake, bot: false }, ...o,
  })
  assert.equal(F.api.discordCaller(make()).source, 'discord')
  assert.equal(F.api.discordCaller({ ...make() }).refused, 'badInteraction', 'a plain object that looks like one')
  assert.equal(F.api.discordCaller(make({ client: { other: true } })).refused, 'badInteraction', 'another client')
  assert.equal(F.api.discordCaller(make({ guildId: '1400000000000000099' })).refused, 'wrongGuild')
  assert.equal(F.api.discordCaller(make({ user: { id: ID.jake, bot: true } })).refused, 'bot')
  assert.equal(F.api.discordCaller(make({ commandName: 'other' })).refused, 'badInteraction')
  F.make({ consoleDiscordChannelIds: '1553844758919774298' })
  assert.equal(F.api.discordCaller(make({ channelId: '1400000000000000098' })).refused, 'wrongChannel')
  assert.equal(F.api.discordCaller(make()).source, 'discord')
  assert.ok(refusals().length >= 5, 'every factory refusal is recorded')
})

test('the role check fails closed: an error, a hang, not in the guild, a wrong role', async () => {
  for (const [label, member] of [['an error', 'throw'], ['not in the guild', undefined], ['a GM role only', { roles: [GUILD, ROLE.gm], handle: 'jake' }], ['@everyone only', { roles: [GUILD], handle: 'jake' }]]) {
    if (member === undefined) F.members.delete(ID.jake); else F.members.set(ID.jake, member)
    const res = await run(web(), '/whoami')
    assert.equal(res.status, 403, label)
    assert.equal(res.body.error, 'notAllowed', label)
  }
  F.members.set(ID.jake, { roles: [GUILD, ROLE.owner], handle: 'jake' })
  assert.equal(F.requests.length, 0)
})

test('a hanging Discord answers no after the 8 s deadline', { timeout: 15000 }, async () => {
  F.members.set(ID.nate, 'hang')
  const t0 = Date.now()
  const res = await run(web(ID.nate), '/whoami')
  F.members.set(ID.nate, { roles: [GUILD, ROLE.dev], handle: 'nate.pierce' })
  assert.equal(res.body.error, 'notAllowed')
  assert.ok(Date.now() - t0 >= 7900 && Date.now() - t0 < 12000)
})

test('the pin: an id not on it is notAllowed, even with the Owners role; a bad or empty pin is off', async () => {
  const res = await run(web(ID.unpinnedOwner), '/whoami')
  assert.equal(res.body.error, 'notAllowed')
  assert.equal(F.lookups, 0, 'refused before any Discord lookup')
  for (const [label, cfg] of [['empty', { consoleDiscordIds: '' }], ['malformed', { consoleDiscordIds: 'jake' }], ['too many', { consoleDiscordIds: Array(11).fill(ID.jake).join(',') }],
    ['no roles', { consoleRoleIds: '' }], ['malformed roles', { consoleRoleIds: 'owners' }], ['the guild id as a role', { consoleRoleIds: `${ROLE.owner},${GUILD}` }], ['no guild', { discordGuildId: '' }]]) {
    F.make(cfg)
    const r = await run(web(), '/whoami')
    assert.equal(r.status, 503, label)
    assert.equal(r.body.error, 'unavailable', label)
  }
  assert.equal(F.requests.length, 0)
})

test('the switch file: off, missing, malformed and narrowed per front end', async () => {
  for (const text of ['off\n', 'maybe\n', null]) {
    if (text === null) fs.rmSync(F.switchFile); else fs.writeFileSync(F.switchFile, text)
    const r = await run(web(), '/whoami')
    assert.equal(r.body.error, 'consoleOff', String(text))
  }
  fs.writeFileSync(F.switchFile, 'on web=dry-run\n')
  F.answer = r => ({ state: r.mode === 'dry-run' ? 'dry-run' : 'ran', gate: r.mode === 'dry-run' ? 'dry' : 'ran' })
  const w = await run(web(), '/kick #8KWH')
  assert.equal(F.requests.at(-1).mode, 'dry-run', 'the web request is sent as a dry run')
  assert.equal(w.body.job.state, 'dry-run')
  fs.writeFileSync(F.switchFile, 'on web=off\n')
  assert.equal((await run(web(), '/whoami')).body.error, 'consoleOff')
  assert.equal(F.api.state('discord').setting, 'on')
  assert.equal(F.api.state('web').setting, 'off')
})

test('the spool check: 0700 is ready, 0750 is not; a missing or open key is not', async () => {
  assert.equal(F.spool.problem(), '')
  fs.chmodSync(path.join(F.dir, 'in'), 0o750)
  assert.match(F.spool.problem(), /not a root-only 0700/)
  assert.equal((await run(web(), '/whoami')).body.error, 'unavailable')
  fs.chmodSync(path.join(F.dir, 'in'), 0o700)
  fs.chmodSync(F.keyFile, 0o640)
  assert.match(F.spool.problem(), /key/)
  fs.chmodSync(F.keyFile, 0o600)
  const s = createSpool({ dir: F.dir, keyFile: F.keyFile, uid: 12345 })
  assert.match(s.problem(), /root-only/, 'a directory owned by someone else')
})

test('a dashboard sign-in older than 4 hours, or one with no sign-in time, is not fresh', async () => {
  const old = await run(web(ID.jake, 4 * 3600 * 1000 + 1000), '/whoami')
  assert.equal(old.status, 401)
  assert.equal(old.body.error, 'signInAgain')
  assert.equal(old.body.signInUrl, '/api/site/login/fresh')
  const none = await run(F.api.webCaller(F.session(ID.jake, null)), '/whoami')
  assert.equal(none.body.error, 'signInAgain', 'a session from before the change has signedInAt 0')
  assert.equal(F.api.isFresh(web(ID.jake, 1000)), true)
  assert.equal(F.requests.length, 0)
})

test('the text is cleaned: one line, no bidi, colour codes broken, a missing / added, 500 at most', async () => {
  F.answer = r => ({ lines: [{ to: 'you', text: r.text }] })
  const cases = [
    ['whoami', '/whoami'], [`/kick${RLO} #8KWH`, '/kick #8KWH'], ['/KICK   #8KWH', '/kick #8KWH'], ['/players #{ff0000}x', '/players # {ff0000}x'],
    ['/kick #8KWH\n/kick #LLX8', '/kick #8KWH /kick #LLX8'],
  ]
  for (const [input, want] of cases) {
    const r = await run(web(), input)
    if (want === '/kick #8KWH /kick #LLX8') { assert.equal(r.body.error, 'notRemote', 'a second command folded onto the line fails the argument rule'); continue }
    assert.equal(r.status, 200, input)
    assert.equal(F.requests.at(-1).text, want, input)
  }
  assert.equal((await run(web(), `/kick ${'x'.repeat(500)}`)).body.error, 'badCommand', 'over 500 characters')
  assert.equal((await run(web(), 'hello there friend')).body.error, 'notRemote', 'plain words become /hello, which is not a staff command')
  assert.equal((await run(web(), '12 34')).body.error, 'badCommand')
})

test('the allowlist pre-check answers without a round trip, with the reason class', async () => {
  const want = [['/kick', 'needTag'], ['/fixloc', 'self'], ['/kick Bob', 'needTag'], ['/tp #8KWH', 'self'], ['/npc', 'inWorld'], ['/bugs', 'later'], ['/system hi', 'notChat'],
    ['/wipechars 5', 'notYet'], ['/rename #8KWH B0b', 'badName'], ['/wwremote sideways', 'badArgs']]
  for (const [text, why] of want) {
    const r = await run(web(), text)
    assert.equal(r.status, 422, text)
    assert.equal(r.body.why, why, text)
    assert.ok(r.body.reason.length > 10)
  }
  assert.equal(F.requests.length, 0)
  fs.renameSync(path.join(F.dir, 'allow.json'), path.join(F.dir, 'allow.off'))
  F.answer = () => ({ state: 'refused', why: 'self', lines: [{ to: 'console', text: '/tp acts on your own character. Run it in game.' }] })
  const r = await run(web(), '/tp #8KWH')
  fs.renameSync(path.join(F.dir, 'allow.off'), path.join(F.dir, 'allow.json'))
  assert.equal(r.body.job.state, 'refused', 'without allow.json the game decides')
  assert.match(r.body.job.summary, /^\/tp #8KWH: refused - \/tp acts on your own character/)
})

test('a request id runs once; another account cannot reuse it', async () => {
  const id = uuid()
  const first = await run(web(), '/kick #8KWH', id)
  const again = await run(web(), '/kick #8KWH', id)
  assert.equal(first.body.job.id, again.body.job.id)
  assert.equal(F.requests.length, 1)
  assert.equal((await run(web(ID.nate), '/kick #8KWH', id)).body.error, 'conflict')
  assert.equal(F.requests.length, 1)
  assert.equal(F.api.job(`w-${id}`, web(ID.nate)), null, 'a job is shown to its own account only')
  assert.equal(F.api.job(`w-${id}`, web()).state, 'ran')
})

test('the limits: 6 a minute per account, 20 attempts in 10 minutes, a repeat does not count', async () => {
  const id = uuid()
  for (let i = 0; i < 6; i++) assert.equal((await run(web(ID.nate), '/whoami', i === 0 ? id : uuid())).status, 200)
  assert.equal((await run(web(ID.nate), '/whoami', id)).status, 200, 'a repeated id is the same job, not a new command')
  const seventh = await run(web(ID.nate), '/whoami')
  assert.equal(seventh.status, 429)
  assert.equal(F.requests.length, 6)
  F.make(); F.lookups = 0
  let last
  for (let i = 0; i < 21; i++) last = await run(web(ID.gm), '/whoami')
  assert.equal(last.body.error, 'tooMany', 'refused attempts count towards the 20')
  assert.equal(F.lookups, 20, 'the 21st attempt never reaches Discord')
})

test('every refusal is recorded once; the Discord copy at most once a minute; tooMany folded', async () => {
  for (let i = 0; i < 5; i++) await run(web(ID.unpinnedOwner), `/wipechars ${i}`)
  const lines = F.audits.concat(F.logs).filter(l => /CONSOLE refused web/.test(l))
  assert.equal(lines.length, 5, 'one line per refusal')
  assert.equal(F.audits.filter(l => /CONSOLE refused/.test(l)).length, 1, 'one Discord copy a minute')
  assert.ok(lines.every(l => /^CONSOLE refused web - \(<@300000000000000005>\) req 7a1c2a3b notAllowed: \/wipechars \d$/.test(l.replace(/req \w{8}/, 'req 7a1c2a3b'))), lines.join('\n'))
  F.audits.length = 0; F.logs.length = 0
  await run(web(), `/kick #8KWH\n${RLO}GM Nate kicked everyone`)
  assert.ok(F.audits.concat(F.logs).every(l => !/[\n\r]/.test(l) && !l.includes(RLO)), 'the refused text is folded to one clean line')
  F.make(); F.audits.length = 0; F.logs.length = 0
  for (let i = 0; i < 26; i++) await run(web(ID.gm), '/whoami')
  const many = F.audits.concat(F.logs).filter(l => /tooMany/.test(l))
  assert.ok(many.length <= 2, `tooMany is folded (${many.length} lines)`)
})

test('the game never takes it: notRun, and the request can never run afterwards', async () => {
  F.stopGame()
  const r = await run(web(), '/kick #8KWH')
  assert.equal(r.body.job.state, 'notRun')
  assert.match(r.body.job.summary, /was not run/)
  assert.deepEqual(F.inFiles(), [], 'the cancelled request is gone')
  F.gameTick()
  assert.equal(F.requests.length, 0)
})

test('the game takes it but does not answer: unknown, said plainly; a late answer fills the job', async () => {
  F.stopGame()
  F.claimOnly = true
  const timer = setInterval(F.gameTick, 50)
  const r = await run(web(), '/kick #8KWH')
  clearInterval(timer)
  assert.equal(r.body.job.state, 'unknown')
  assert.match(r.body.job.summary, /check #staff-commands before you send it again/)
  const rep = { v: 1, id: r.body.job.id, state: 'ran', gate: 'ran', ranAs: 'Jake #ABCD', online: true, tier: 'senior', target: 'Bob #8KWH', lines: [{ to: 'all', text: 'Bob was kicked by Jake.' }], why: '', at: Date.now() }
  rep.sig = crypto.createHmac('sha256', F.key).update(require('../sources/console/allowlist').repPayload(rep)).digest('hex')
  fs.writeFileSync(path.join(F.dir, 'out', `${rep.id}.json`), JSON.stringify(rep), { mode: 0o600 })
  await new Promise(done => setTimeout(done, 600))
  assert.equal(F.api.job(rep.id, web()).state, 'ran')
})

test('a forged or broken reply is not taken as the game\'s answer', async () => {
  F.stopGame()
  const timer = setInterval(() => {
    for (const name of F.inFiles().filter(n => n.endsWith('.json'))) {
      const r = JSON.parse(fs.readFileSync(path.join(F.dir, 'in', name), 'utf8'))
      fs.renameSync(path.join(F.dir, 'in', name), path.join(F.dir, 'work', name))
      fs.writeFileSync(path.join(F.dir, 'out', `${r.id}.json`), JSON.stringify({ v: 1, id: r.id, state: 'ran', gate: 'ran', ranAs: 'x', online: true, tier: 'senior', target: '', lines: [], why: '', at: 1, sig: 'f'.repeat(64) }))
    }
  }, 50)
  const r = await run(web(), '/whoami')
  clearInterval(timer)
  assert.equal(r.body.job.state, 'unknown')
})

test('recover() after a restart: a reply waiting fills the job, a request still waiting is withdrawn, the rest are unknown', () => {
  F.stopGame()
  const jobsFile = path.join(F.root, 'data', 'console-jobs.json')
  const ids = [`w-${uuid()}`, `w-${uuid()}`, `w-${uuid()}`]
  fs.mkdirSync(path.dirname(jobsFile), { recursive: true })
  fs.writeFileSync(jobsFile, JSON.stringify({ v: 1, jobs: ids.map(id => ({ id, at: Date.now(), source: 'web', discordId: ID.jake, handle: 'jake', profileId: 1, text: '/whoami', setting: 'on', state: 'sent' })) }))
  const rep = { v: 1, id: ids[0], state: 'ran', gate: 'ran', ranAs: 'Jake #ABCD', online: true, tier: 'senior', target: '', lines: [{ to: 'you', text: 'Pong!' }], why: '', at: Date.now() }
  rep.sig = crypto.createHmac('sha256', F.key).update(require('../sources/console/allowlist').repPayload(rep)).digest('hex')
  fs.writeFileSync(path.join(F.dir, 'out', `${ids[0]}.json`), JSON.stringify(rep))
  fs.writeFileSync(path.join(F.dir, 'in', `${ids[1]}.json`), '{}')
  F.make()
  assert.equal(F.api.recover(), 3)
  const c = web()
  assert.deepEqual(ids.map(id => F.api.job(id, c).state), ['ran', 'notRun', 'unknown'])
  assert.deepEqual(F.inFiles(), [])
  assert.equal((fs.statSync(jobsFile).mode & 0o777).toString(8), '600')
})
