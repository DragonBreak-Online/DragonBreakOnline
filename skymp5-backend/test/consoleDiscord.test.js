'use strict'
// The Discord front end (sources/discord/consoleCommand.js) with fake discord.js interactions, the register script, and bot.js's chain

const { test, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
const { ChatInputCommandInteraction, MessageFlags } = require('discord.js')
const { createConsoleFixture, GUILD, ID } = require('./helpers/consoleFixture')
const consoleCommand = require('../sources/discord/consoleCommand')
const script = require('../scripts/console-command')

let F, seq = 0
before(() => { F = createConsoleFixture('dbo-console-discord-') })
after(() => F.cleanup())
beforeEach(() => { F.requests.length = 0; F.answer = null; F.audits.length = 0; F.logs.length = 0; fs.writeFileSync(F.switchFile, 'on\n'); F.make(); F.startGame() })

// A chat-input interaction as discord.js hands one to interactionCreate
function interaction(o = {}) {
  const calls = []
  const it = Object.assign(Object.create(ChatInputCommandInteraction.prototype), {
    id: String(1400000000000000000n + BigInt(++seq)), type: 2, commandType: 1, client: F.client, commandName: 'console', guildId: GUILD, channelId: '1553844758919774298',
    user: { id: ID.jake, bot: false }, options: { getString: () => o.text || '/whoami' },
    reply: async x => { calls.push(['reply', x]) }, deferReply: async x => { calls.push(['defer', x]); if (o.deferThrows) throw new Error('Unknown interaction') },
    editReply: async x => { calls.push(['edit', x]) },
  }, o.fields || {})
  return { it, calls }
}

test('a /console command is deferred privately first, then run, and answered with the header and the lines', async () => {
  F.answer = () => ({ ranAs: 'Jake #ABCD', online: false, tier: 'senior', target: 'Bob #8KWH', lines: [{ to: 'audit', text: 'GM Jake cleared it' }, { to: 'you', text: "Bob #8KWH's werewolf body may be shown again." }] })
  const { it, calls } = interaction({ text: '/wwremote clear #8KWH' })
  assert.equal(await consoleCommand.handleInteraction(it, F.api), true)
  assert.deepEqual(calls.map(c => c[0]), ['defer', 'edit'])
  assert.equal(calls[0][1].flags, MessageFlags.Ephemeral)
  const content = calls[1][1].content
  assert.deepEqual(calls[1][1].allowedMentions, { parse: [] })
  assert.match(content, /^\/wwremote clear #8KWH: ran - Bob #8KWH's werewolf body may be shown again\.\nas Jake #ABCD \(Senior, offline\)\n```\n/)
  assert.equal(F.requests[0].id, `d-${it.id}`, 'the request id is the interaction id, made inside')
  assert.equal(F.requests[0].src, 'discord')
})

test('a defer that throws runs nothing and writes no spool file', async () => {
  F.stopGame()
  const { it, calls } = interaction({ deferThrows: true })
  assert.equal(await consoleCommand.handleInteraction(it, F.api), true)
  assert.deepEqual(calls.map(c => c[0]), ['defer'])
  assert.deepEqual(F.inFiles(), [])
})

test('refusals before anything runs: another guild, a bot, another client, a locked channel', async () => {
  for (const [label, fields] of [['another guild', { guildId: '1400000000000000099' }], ['a bot', { user: { id: ID.jake, bot: true } }], ['another client', { client: {} }]]) {
    const { it, calls } = interaction({ fields })
    assert.equal(await consoleCommand.handleInteraction(it, F.api), true, label)
    assert.deepEqual(calls.map(c => c[0]), ['reply'], label)
    assert.equal(calls[0][1].flags, MessageFlags.Ephemeral, label)
  }
  F.make({ consoleDiscordChannelIds: '1400000000000000098' })
  const { it, calls } = interaction()
  await consoleCommand.handleInteraction(it, F.api)
  assert.match(calls[0][1].content, /staff channel/)
  assert.equal(F.requests.length, 0)
})

test('anything that is not /console is left for the next handler', async () => {
  const { it } = interaction({ fields: { commandName: 'other' } })
  assert.equal(await consoleCommand.handleInteraction(it, F.api), false)
  assert.equal(await consoleCommand.handleInteraction({ isChatInputCommand: () => false }, F.api), false)
  assert.equal(await consoleCommand.handleInteraction(null, F.api), false)
})

test('a replayed interaction (gateway resume) is answered once', async () => {
  const { it, calls } = interaction()
  await consoleCommand.handleInteraction(it, F.api)
  await consoleCommand.handleInteraction(it, F.api)
  assert.equal(calls.filter(c => c[0] === 'defer').length, 1)
  assert.equal(F.requests.length, 1)
})

test('the reply: backticks cannot end the code block, mentions are off, and it is cut to fit with a note', () => {
  const tick = String.fromCharCode(0x02cb)
  const lines = Array.from({ length: 40 }, (_v, i) => ({ to: 'you', text: `line ${i} \`\`\` @everyone ${'x'.repeat(80)}` }))
  const text = consoleCommand.format({ status: 200, body: { job: { summary: '/players: ran - 3 online', as: 'as Jake #ABCD (Senior, online)', lines } } })
  assert.ok(text.length <= 2000)
  assert.match(text, /\(cut to fit Discord\)$/)
  assert.equal((text.match(/```/g) || []).length, 2, 'only the block\'s own fences')
  assert.ok(text.includes(tick))
  assert.match(consoleCommand.format({ status: 422, body: { error: 'notRemote', reason: '/tp acts on your own character. Run it in game.' } }), /Nothing was run\./)
  assert.equal(consoleCommand.format({ status: 403, body: { error: 'notAllowed' } }), consoleCommand.ERRORS.notAllowed)
})

test('bot.js hands /console what the ticket handler leaves, and the game process has no interaction handler', () => {
  const bot = fs.readFileSync(path.join(__dirname, '..', 'sources', 'discord', 'bot.js'), 'utf8')
  assert.match(bot, /tickets\.handleInteraction\(interaction\)\s*\.then\(handled => \(handled \? true : require\('\.\/consoleCommand'\)\.handleInteraction\(interaction\)\)\)/)
  assert.match(bot, /getMemberFresh,\n {2}isOwnClient,/)
})

test('the register script: one guild command by POST, removal by DELETE, never a bulk PUT; nothing is sent without --yes', async () => {
  const p = { app: '1400000000000000777', guild: GUILD, existing: '1400000000000000555' }
  assert.deepEqual(script.plan('register', p).map(s => [s.method, s.path]), [['POST', `/applications/${p.app}/guilds/${GUILD}/commands`]])
  assert.deepEqual(script.plan('remove', p).map(s => [s.method, s.path]), [['DELETE', `/applications/${p.app}/guilds/${GUILD}/commands/${p.existing}`]])
  assert.deepEqual(script.plan('remove', { ...p, existing: null }), [])
  assert.throws(() => script.request({ method: 'PUT', path: '/x', token: 't' }), /only GET, POST and DELETE/)
  const c = script.COMMAND
  assert.equal(c.name, 'console')
  assert.equal(c.default_member_permissions, '0')
  assert.deepEqual(c.contexts, [0])
  assert.equal(c.options[0].max_length, 500)
  const sent = []
  const send = async s => { sent.push(s.method); return s.method === 'GET' ? [] : { id: '1' } }
  const out = []
  const cfg = { discordBotToken: 't', discordGuildId: GUILD, discordClientId: p.app }
  assert.equal(await script.main(['register'], { config: cfg, send, out: l => out.push(l) }), 0)
  assert.deepEqual(sent, ['GET'], 'without --yes only the listing is read')
  assert.match(out.join('\n'), /would send POST/)
  sent.length = 0
  await script.main(['register', '--yes'], { config: cfg, send, out: () => {} })
  assert.deepEqual(sent, ['GET', 'POST'])
  assert.ok(!fs.readFileSync(path.join(__dirname, '..', 'scripts', 'console-command.js'), 'utf8').match(/method: 'PUT'|'PUT' \}/))
})
