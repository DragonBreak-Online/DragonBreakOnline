'use strict'
// /referral (sources/discord/referralCommand.js) with fake interactions and an in-memory referrals.json, its register script and bot.js's chain

const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
const { ChatInputCommandInteraction, MessageFlags } = require('discord.js')
const ref = require('../sources/discord/referralCommand')
const script = require('../scripts/referral-command')
const consoleScript = require('../scripts/console-command')

const snow = n => (10n ** 18n + BigInt(n)).toString()
const GUILD = snow(1)
const USER = { ann: snow(31), bob: snow(32), cat: snow(33), stranger: snow(34) }
const PROFILES = { [USER.ann]: 7, [USER.bob]: 8, [USER.cat]: 9 }
const LINK = 'https://dragonbreakonline.com/api/users/login-discord/join/'
const client = {}

let files, clock, logs
const gmConfig = (o = {}) => JSON.stringify({ referrals: { enabled: true, linkBase: LINK, qualifyHours: 5, qualifyDays: 2, ...o } })
const storeOf = () => ({
  profiles: {
    7: { ms: 0, code: 'BCDFGHJK', queue: [{ id: 'x', kind: 'referral', mult: 1.15, leftMs: 8 * 3600000 }, { id: 'y', kind: 'referral', mult: 1.05, leftMs: 90 * 60000 }] },
    8: { ms: 0, code: 'MNPQRSTV', queue: [], ref: { by: 7, code: 'BCDFGHJK', status: 'qualified' } },
    9: { ms: 0, queue: [{ id: 'z', kind: 'welcome', mult: 1.05, leftMs: 3600000 }], ref: { by: 7, code: 'BCDFGHJK', status: 'pending' } },
    10: { ms: 0, code: 'WXZ23456', queue: [], ref: { by: 7, status: 'revoked' } },
    11: { ms: 0, code: '789BCDFG', queue: [], ref: { by: 8, status: 'qualified' } },
  },
  codes: { BCDFGHJK: 7, MNPQRSTV: 8, WXZ23456: 10, '789BCDFG': 11 },
})

beforeEach(() => {
  clock = { t: 1_800_000_000_000 }
  logs = []
  files = new Map([['/srv/gamemode-config.json', gmConfig()], ['/srv/referrals.json', JSON.stringify(storeOf())]])
})

function make() {
  return ref.createReferralCommand({
    config: { gameServerDir: '/srv', discordGuildId: GUILD }, now: () => clock.t, log: (...a) => logs.push(a.join(' ')),
    isOwnClient: c => c === client, profileIdOf: id => PROFILES[id],
    readFile: async p => { if (!files.has(p)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return files.get(p) },
  })
}

function interaction(o = {}) {
  const calls = []
  const it = Object.assign(Object.create(o.proto || ChatInputCommandInteraction.prototype), {
    client: o.client || client, guildId: o.guildId === undefined ? GUILD : o.guildId, commandName: o.name || 'referral',
    user: { id: o.user || USER.ann, bot: !!o.bot },
    isChatInputCommand: () => true,
    reply: async x => { calls.push(['reply', x]) },
    followUp: async x => { calls.push(['followUp', x]) },
  })
  return { it, calls }
}

const PRIVATE = MessageFlags.Ephemeral | MessageFlags.SuppressEmbeds
async function run(cmd, o) {
  const { it, calls } = interaction(o)
  assert.equal(await cmd.handleInteraction(it), true)
  for (const [, x] of calls) { assert.equal(x.flags, PRIVATE, 'every reply is private, embeds off'); assert.deepEqual(x.allowedMentions, { parse: [] }) }
  return calls
}

test('the caller gets their own link and code, friends counted and boosts, then the link alone to copy', async () => {
  const calls = await run(make())
  assert.deepEqual(calls.map(c => c[0]), ['reply', 'followUp'])
  const text = calls[0][1].content
  assert.match(text, new RegExp(`^${LINK}BCDFGHJK$`, 'm'))
  assert.match(text, /Code: `BCDFGHJK`/)
  assert.match(text, /5 hours on 2 different days/)
  assert.match(text, /Friends counted: \*\*1\*\* of 3 friends who joined \(1 still playing toward it\)/)
  assert.match(text, /\+15% skill progress, 8 h 0 m of play left; \+5% skill progress, 1 h 30 m of play left/)
  for (const other of ['MNPQRSTV', 'WXZ23456', '789BCDFG']) assert.ok(!text.includes(other), 'never another account\'s code')
  assert.equal(calls[1][1].content, `${LINK}BCDFGHJK`)
  assert.equal(logs.length, 0, 'nothing logged')
})

test('a friend with no referrals of their own, and a welcome boost', async () => {
  const text = (await run(make(), { user: USER.bob }))[0][1].content
  assert.match(text, /MNPQRSTV/)
  assert.match(text, /Friends counted: \*\*1\*\* of 1 friend who joined\./)
  files.set('/srv/referrals.json', JSON.stringify({ ...storeOf(), profiles: { ...storeOf().profiles, 9: { ...storeOf().profiles[9], code: 'HJKLMNPQ' } }, codes: { ...storeOf().codes, HJKLMNPQ: 9 } }))
  const cat = (await run(make(), { user: USER.cat }))[0][1].content
  assert.match(cat, /No friends have joined with your link yet\./)
  assert.match(cat, /\+5% skill progress \(welcome\), 1 h 0 m of play left/)
})

test('refusals: no account, no code yet, referrals off, store missing or unreadable', async () => {
  const one = async (o, key) => { const calls = await run(make(), o); assert.deepEqual(calls.map(c => [c[0], c[1].content]), [['reply', ref.TEXT[key]]]) }
  await one({ user: USER.stranger }, 'noAccount')
  await one({ user: USER.cat }, 'noCode')
  files.set('/srv/referrals.json', JSON.stringify({ ...storeOf(), codes: {} }))
  await one({}, 'noCode')
  files.set('/srv/referrals.json', '{broken')
  await one({}, 'paused')
  files.delete('/srv/referrals.json')
  await one({}, 'off')
  files.set('/srv/referrals.json', JSON.stringify(storeOf()))
  files.set('/srv/gamemode-config.json', gmConfig({ enabled: false }))
  await one({}, 'off')
  files.delete('/srv/gamemode-config.json')
  await one({}, 'off')
})

test('wrong guild, a DM, a bot, a forged interaction; other commands pass through', async () => {
  const cmd = make()
  assert.equal((await run(cmd, { guildId: snow(2) }))[0][1].content, ref.TEXT.wrongGuild)
  assert.equal((await run(cmd, { guildId: null }))[0][1].content, ref.TEXT.wrongGuild)
  assert.equal((await run(cmd, { bot: true }))[0][1].content, ref.TEXT.bot)
  assert.equal((await run(cmd, { client: {} }))[0][1].content, ref.TEXT.badInteraction)
  assert.equal((await run(cmd, { proto: Object.prototype }))[0][1].content, ref.TEXT.badInteraction)
  const { it, calls } = interaction({ name: 'say' })
  assert.equal(await cmd.handleInteraction(it), false)
  assert.equal(calls.length, 0)
  assert.equal(await cmd.handleInteraction({}), false)
})

test('five uses a minute per user', async () => {
  const cmd = make()
  for (let i = 0; i < ref.LIMIT.uses; i++) assert.equal((await run(cmd))[0][0], 'reply')
  assert.equal((await run(cmd))[0][1].content, ref.TEXT.tooMany)
  assert.match((await run(cmd, { user: USER.bob }))[0][1].content, /MNPQRSTV/, 'another user is not limited')
  clock.t += ref.LIMIT.windowMs
  assert.match((await run(cmd))[0][1].content, /BCDFGHJK/)
})

test('bot.js hands /referral what /say leaves', () => {
  const bot = fs.readFileSync(path.join(__dirname, '..', 'sources', 'discord', 'bot.js'), 'utf8')
  assert.match(bot, /require\('\.\/sayCommand'\)\.handleInteraction\(interaction\)\)\)\s*\.then\(handled => \(handled \? true : require\('\.\/referralCommand'\)\.handleInteraction\(interaction\)\)\)/)
})

test('the register script: one guild POST of /referral, open to every member, nothing sent without --yes', async () => {
  const c = script.COMMAND
  assert.equal(c.name, 'referral')
  assert.equal(c.default_member_permissions, undefined)
  assert.deepEqual(c.contexts, [0])
  assert.ok(c.description.length <= 100)
  const app = snow(3), id = snow(5)
  const sent = []
  const send = async s => { sent.push(s); return s.method === 'GET' ? [{ id: snow(4), name: 'say' }] : { id } }
  const cfg = { discordBotToken: 't', discordGuildId: GUILD, discordClientId: app }
  const out = []
  assert.equal(await consoleScript.main(['register'], { config: cfg, send, out: l => out.push(l), command: c }), 0)
  assert.deepEqual(sent.map(s => s.method), ['GET'])
  assert.match(out.join('\n'), /would send POST .*"name":"referral"/)
  sent.length = 0
  await consoleScript.main(['register', '--yes'], { config: cfg, send, out: () => {}, command: c })
  assert.deepEqual(sent.map(s => [s.method, s.path, s.body && s.body.name]), [['GET', `/applications/${app}/guilds/${GUILD}/commands`, undefined], ['POST', `/applications/${app}/guilds/${GUILD}/commands`, 'referral']])
})
