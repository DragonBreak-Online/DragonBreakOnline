'use strict'
// /say (sources/discord/sayCommand.js) with fake discord.js interactions and channels, its register script, and bot.js's chain

const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
const { ChatInputCommandInteraction, ModalSubmitInteraction, MessageFlags, PermissionsBitField, PermissionFlagsBits: P } = require('discord.js')
const say = require('../sources/discord/sayCommand')
const consoleCommand = require('../sources/discord/consoleCommand')
const sayScript = require('../scripts/say-command')
const consoleScript = require('../scripts/console-command')

// Made-up snowflakes, built here so no real id is written down
const snow = n => (10n ** 18n + BigInt(n)).toString()
const GUILD = snow(1)
const ROLE = { owner: snow(11), dev: snow(12), lead: snow(13), gm: snow(14) }
const CH = { general: snow(21), todoThread: snow(22), todoForum: snow(23), otherForum: snow(24), otherThread: snow(25), elsewhere: snow(26), audit: snow(27), transcripts: snow(28), auditThread: snow(29) }
const USER = { lead: snow(31), gm: snow(32), owner: snow(33) }
const OLD_MESSAGE = snow(41)
const SEND = [P.ViewChannel, P.SendMessages, P.SendMessagesInThreads, P.ReadMessageHistory]
const BOT = [...SEND, P.ManageThreads]

let clock, audits, logs, channels, seq, msgSeq, created
function make(configOverride = {}) {
  const config = { consoleRoleIds: `${ROLE.owner},${ROLE.dev},${ROLE.lead}`, consoleDiscordIds: '', discordGuildId: GUILD, discordTodoForumChannelId: CH.todoForum, ...configOverride }
  return say.createSayCommand({
    config, audit: { log: line => audits.push(line) }, now: () => clock.t, log: (...a) => logs.push(a.join(' ')),
    isOwnClient: c => c === client, nonce: () => `form${++created}`,
  })
}

// A text channel or thread as discord.js hands one over: what was sent and edited is recorded
function fakeChannel(id, { thread = false, parentId = null, locked = false, messages = [] } = {}) {
  const ch = {
    id, parentId, locked, sends: [], edits: [], isThread: () => thread,
    messages: { fetch: async mid => (messages.includes(mid) ? { id: mid, channelId: id, url: `https://discord.com/channels/${GUILD}/${id}/${mid}` } : Promise.reject(new Error('Unknown Message'))) },
    send: async p => { ch.sends.push(p); const mid = snow(1000 + ++msgSeq); return { id: mid, channelId: id, url: `https://discord.com/channels/${GUILD}/${id}/${mid}` } },
    edit: async p => { ch.edits.push(p); return ch },
  }
  return ch
}
const client = { channels: { cache: { get: id => channels.get(id) }, fetch: async id => channels.get(id) || Promise.reject(new Error('Unknown Channel')) } }

beforeEach(() => {
  clock = { t: 1_800_000_000_000 }
  audits = []
  logs = []
  seq = 0
  msgSeq = 0
  created = 0
  channels = new Map([
    [CH.general, fakeChannel(CH.general, { messages: [OLD_MESSAGE] })],
    [CH.todoThread, fakeChannel(CH.todoThread, { thread: true, parentId: CH.todoForum })],
    [CH.otherThread, fakeChannel(CH.otherThread, { thread: true, parentId: CH.otherForum })],
  ])
})

const MEMBERS = {
  lead: { id: USER.lead, username: 'icedsky', member: { displayName: 'Iced Sky', roles: { cache: new Map([[GUILD, {}], [ROLE.lead, {}]]) } } },
  owner: { id: USER.owner, username: 'jake', member: { nick: 'Jake', roles: [GUILD, ROLE.owner] } },
  gm: { id: USER.gm, username: 'gemma', member: { displayName: 'Gemma', roles: { cache: new Map([[GUILD, {}], [ROLE.gm, {}]]) } } },
}

function base(o, proto, type) {
  const who = MEMBERS[o.as || 'lead']
  const calls = []
  const it = Object.assign(Object.create(proto), {
    id: snow(5000 + ++seq), type, client, guildId: GUILD, channelId: o.channelId || CH.general,
    user: { id: who.id, username: who.username, bot: false }, member: who.member,
    memberPermissions: new PermissionsBitField(o.perms || SEND), appPermissions: new PermissionsBitField(o.app || BOT),
    reply: async x => { calls.push(['reply', x]) },
    deferReply: async x => { calls.push(['defer', x]); if (o.deferThrows) throw new Error('Interaction has already been acknowledged') },
    editReply: async x => { calls.push(['edit', x]) },
    showModal: async x => { calls.push(['modal', x]) },
  }, o.fields || {})
  return { it, calls }
}
function command(o = {}) {
  const opts = { text: 'text' in o ? o.text : 'Done: the quest bug is fixed.', reply_to: o.replyTo ?? null }
  const r = base(o, ChatInputCommandInteraction.prototype, 2)
  Object.assign(r.it, { commandType: 1, commandName: o.commandName || 'say', options: { getString: n => opts[n] ?? null, getBoolean: n => (n === 'close' ? (o.close ?? null) : null) } })
  return r
}
function submit(formId, text, o = {}) {
  const r = base(o, ModalSubmitInteraction.prototype, 5)
  Object.assign(r.it, { customId: `say:${formId}`, fields: { getTextInputValue: n => (n === 'text' ? text : '') } })
  return r
}
const names = calls => calls.map(c => c[0])
const allSends = () => [...channels.values()].flatMap(c => c.sends)

test('a Lead GM\'s /say is deferred privately, posted as the bot with no pings, logged with the name and the link, and confirmed with the link', async () => {
  const S = make()
  const { it, calls } = command({ text: '@everyone the hotfix is live <@&123>' })
  assert.equal(await S.handleInteraction(it), true)
  assert.deepEqual(names(calls), ['defer', 'edit'])
  assert.equal(calls[0][1].flags, MessageFlags.Ephemeral)
  const sent = channels.get(CH.general).sends
  assert.equal(sent.length, 1)
  assert.equal(sent[0].content, '@everyone the hotfix is live <@&123>')
  assert.deepEqual(sent[0].allowedMentions, { parse: [], repliedUser: false })
  assert.deepEqual(Object.keys(sent[0]).sort(), ['allowedMentions', 'content'], 'no files, embeds or reply')
  const link = `https://discord.com/channels/${GUILD}/${CH.general}/${snow(1001)}`
  assert.equal(audits.length, 1)
  assert.match(audits[0], /^SAY `Iced Sky` \(@icedsky\) posted as Dragonbaron in <#\d+>: /)
  assert.ok(audits[0].includes(`<#${CH.general}>`) && audits[0].includes(link))
  assert.ok(!audits[0].includes(USER.lead), 'who is the display name and username, not the account id')
  assert.equal(calls[1][1].content, `Posted as Dragonbaron: ${link}`)
  assert.deepEqual(calls[1][1].allowedMentions, { parse: [] })
})

test('the rank rule is the console\'s role list: Owners and Lead GMs pass, a GM does not, and the console pin is not needed', async () => {
  const S = make({ consoleDiscordIds: '' })
  const owner = command({ as: 'owner' })
  await S.handleInteraction(owner.it)
  assert.deepEqual(names(owner.calls), ['defer', 'edit'])
  assert.match(audits[0], /^SAY `Jake` \(@jake\)/)
  const gm = command({ as: 'gm' })
  await S.handleInteraction(gm.it)
  assert.deepEqual(names(gm.calls), ['reply'])
  assert.equal(gm.calls[0][1].content, say.ERRORS.notAllowed)
  assert.equal(gm.calls[0][1].flags, MessageFlags.Ephemeral)
  assert.equal(allSends().length, 1)
  const off = make({ consoleRoleIds: '' })
  const r = command()
  await off.handleInteraction(r.it)
  assert.equal(r.calls[0][1].content, say.ERRORS.unavailable)
})

test('refusals are private, carry the reason, and post nothing', async () => {
  const S = make()
  const cases = [
    ['a DM', { fields: { guildId: null } }, 'dm'],
    ['another guild', { fields: { guildId: snow(2) } }, 'wrongGuild'],
    ['a bot', { fields: { user: { id: USER.lead, username: 'icedsky', bot: true } } }, 'bot'],
    ['no Send Messages here', { perms: [P.ViewChannel, P.SendMessagesInThreads] }, 'cannotPost'],
    ['no Send Messages in Threads in a thread', { channelId: CH.otherThread, perms: [P.ViewChannel, P.SendMessages] }, 'cannotPost'],
    ['a locked thread without Manage Threads', { channelId: CH.otherThread, locked: true }, 'locked'],
    ['the bot cannot post here', { app: [P.ViewChannel] }, 'botCannot'],
    ['a channel the bot cannot see', { channelId: CH.elsewhere }, 'noChannel'],
    ['blank text', { text: '   ' }, 'empty'],
    ['text over 2000', { text: 'x'.repeat(2001) }, 'tooLong'],
    ['a reply link into another channel', { replyTo: `https://discord.com/channels/${GUILD}/${CH.otherThread}/${OLD_MESSAGE}` }, 'otherChannel'],
    ['a reply link into another guild', { replyTo: `https://discord.com/channels/${snow(2)}/${CH.general}/${OLD_MESSAGE}` }, 'otherChannel'],
    ['a reply_to that is not a link', { replyTo: 'the one above' }, 'badTarget'],
    ['a reply without Read Message History', { replyTo: OLD_MESSAGE, perms: [P.ViewChannel, P.SendMessages] }, 'noHistory'],
    ['close outside a thread', { close: true }, 'closeWhere'],
    ['close in another forum\'s thread', { close: true, channelId: CH.otherThread }, 'closeWhere'],
    ['close when the bot cannot manage threads', { close: true, channelId: CH.todoThread, app: SEND }, 'botCannotClose'],
  ]
  for (const [label, o, code] of cases) {
    if (o.locked) channels.get(CH.otherThread).locked = true
    const { it, calls } = command(o)
    assert.equal(await S.handleInteraction(it), true, label)
    assert.deepEqual(names(calls), ['reply'], label)
    assert.equal(calls[0][1].content, say.ERRORS[code], label)
    assert.equal(calls[0][1].flags, MessageFlags.Ephemeral, label)
    channels.get(CH.otherThread).locked = false
  }
  assert.equal(allSends().length, 0)
  assert.equal(audits.length, 0)
  const closeOff = command({ close: true, channelId: CH.todoThread })
  await make({ discordTodoForumChannelId: '' }).handleInteraction(closeOff.it)
  assert.equal(closeOff.calls[0][1].content, say.ERRORS.closeOff)
  assert.equal(allSends().length, 0)
})

test('the audit and transcript channels and their threads are refused, even for an Administrator, so no record can be faked', async () => {
  channels.set(CH.audit, fakeChannel(CH.audit))
  channels.set(CH.transcripts, fakeChannel(CH.transcripts))
  channels.set(CH.auditThread, fakeChannel(CH.auditThread, { thread: true, parentId: CH.audit }))
  const S = make({ discordLogChannelId: CH.audit, discordTicketTranscriptChannelId: CH.transcripts })
  for (const channelId of [CH.audit, CH.transcripts, CH.auditThread]) {
    for (const text of ['[2026-10-15 19:00:00] PERM someone gained role(s): Owners', null]) {
      const { it, calls } = command({ channelId, text, perms: [...SEND, P.Administrator] })
      await S.handleInteraction(it)
      assert.deepEqual(names(calls), ['reply'], channelId)
      assert.equal(calls[0][1].content, say.ERRORS.record)
    }
  }
  assert.equal(allSends().length, 0)
  assert.equal(audits.length, 0)
  const elsewhere = command()
  await S.handleInteraction(elsewhere.it)
  assert.deepEqual(names(elsewhere.calls), ['defer', 'edit'], 'other channels still work')
})

test('a locked thread takes a post from someone who can manage threads', async () => {
  const S = make()
  channels.get(CH.otherThread).locked = true
  const { calls, it } = command({ channelId: CH.otherThread, perms: [...SEND, P.ManageThreads] })
  await S.handleInteraction(it)
  assert.deepEqual(names(calls), ['defer', 'edit'])
  assert.equal(channels.get(CH.otherThread).sends.length, 1)
})

test('ten posts in ten minutes per person, then a private refusal until the window moves on', async () => {
  const S = make()
  for (let i = 0; i < say.LIMIT.posts; i++) {
    const { it, calls } = command()
    await S.handleInteraction(it)
    assert.deepEqual(names(calls), ['defer', 'edit'], `post ${i + 1}`)
    clock.t += 1000
  }
  const over = command()
  await S.handleInteraction(over.it)
  assert.deepEqual(names(over.calls), ['reply'])
  assert.equal(over.calls[0][1].content, say.ERRORS.tooMany)
  const other = command({ as: 'owner' })
  await S.handleInteraction(other.it)
  assert.deepEqual(names(other.calls), ['defer', 'edit'], 'the limit is per person')
  clock.t += say.LIMIT.windowMs
  const later = command()
  await S.handleInteraction(later.it)
  assert.deepEqual(names(later.calls), ['defer', 'edit'])
  assert.equal(allSends().length, say.LIMIT.posts + 2)
})

test('with no text it opens a one-field form; the submit posts the lines once, and only for the same person in the same channel', async () => {
  const S = make()
  const open = command({ text: null })
  await S.handleInteraction(open.it)
  assert.deepEqual(names(open.calls), ['modal'])
  const form = open.calls[0][1].toJSON()
  assert.equal(form.custom_id, 'say:form1')
  assert.equal(form.components.length, 1)
  const field = form.components[0].components[0]
  assert.deepEqual([field.custom_id, field.style, field.max_length, field.required], ['text', 2, 2000, true])
  assert.equal(allSends().length, 0, 'opening the form posts nothing')

  const stranger = submit('form1', 'not mine', { as: 'owner' })
  await S.handleInteraction(stranger.it)
  assert.equal(stranger.calls[0][1].content, say.ERRORS.expired, 'someone else cannot use the form')

  const again = command({ text: null })
  await S.handleInteraction(again.it)
  const text = 'Line one\nLine two\n\nSigned, staff'
  const done = submit('form2', text)
  assert.equal(await S.handleInteraction(done.it), true)
  assert.deepEqual(names(done.calls), ['defer', 'edit'])
  assert.equal(channels.get(CH.general).sends[0].content, text)
  assert.equal(audits.length, 1)
  assert.ok(!audits[0].includes('\n'), 'one audit line for a multi-line post')
  const replay = submit('form2', text)
  await S.handleInteraction(replay.it)
  assert.equal(replay.calls[0][1].content, say.ERRORS.expired, 'a form posts once')

  const moved = command({ text: null })
  await S.handleInteraction(moved.it)
  const elsewhere = submit('form3', 'x', { channelId: CH.otherThread })
  await S.handleInteraction(elsewhere.it)
  assert.equal(elsewhere.calls[0][1].content, say.ERRORS.expired)

  const slow = command({ text: null })
  await S.handleInteraction(slow.it)
  clock.t += 16 * 60 * 1000
  const late = submit('form4', 'x')
  await S.handleInteraction(late.it)
  assert.equal(late.calls[0][1].content, say.ERRORS.expired)
  assert.equal(allSends().length, 1)
})

test('the form submit checks the rank and the channel again', async () => {
  const S = make()
  const open = command({ text: null })
  await S.handleInteraction(open.it)
  const demoted = submit('form1', 'hello', { fields: { member: MEMBERS.gm.member } })
  await S.handleInteraction(demoted.it)
  assert.equal(demoted.calls[0][1].content, say.ERRORS.notAllowed)
  const reopen = command({ text: null })
  await S.handleInteraction(reopen.it)
  const muted = submit('form2', 'hello', { perms: [P.ViewChannel] })
  await S.handleInteraction(muted.it)
  assert.equal(muted.calls[0][1].content, say.ERRORS.cannotPost)
  assert.equal(allSends().length, 0)
})

test('reply_to takes a link or an id in this channel and posts as a reply without pinging its author', async () => {
  const S = make()
  const byLink = command({ replyTo: `<https://discord.com/channels/${GUILD}/${CH.general}/${OLD_MESSAGE}>` })
  await S.handleInteraction(byLink.it)
  const byId = command({ replyTo: OLD_MESSAGE })
  await S.handleInteraction(byId.it)
  const sent = channels.get(CH.general).sends
  assert.equal(sent.length, 2)
  for (const s of sent) {
    assert.deepEqual(s.reply, { messageReference: OLD_MESSAGE, failIfNotExists: true })
    assert.deepEqual(s.allowedMentions, { parse: [], repliedUser: false })
  }
  assert.match(audits[0], /replying to https:\/\/discord\.com\/channels\//)
  const gone = command({ replyTo: snow(42) })
  await S.handleInteraction(gone.it)
  assert.deepEqual(names(gone.calls), ['defer', 'edit'])
  assert.equal(gone.calls[1][1].content, say.ERRORS.noTarget)
  assert.equal(sent.length, 2)
})

test('close in a to-do thread posts, answers privately, then locks and archives it with one edit as dbdiscord todo done does', async () => {
  const S = make()
  const { it, calls } = command({ close: true, channelId: CH.todoThread, text: 'Completed. The new map is live.' })
  const th = channels.get(CH.todoThread)
  const answeredBefore = []
  th.edit = async p => { answeredBefore.push(names(calls).join(',')); th.edits.push(p); return th }
  await S.handleInteraction(it)
  assert.equal(th.sends.length, 1)
  assert.equal(th.edits.length, 1)
  assert.equal(th.edits[0].locked, true)
  assert.equal(th.edits[0].archived, true)
  assert.deepEqual(answeredBefore, ['defer,edit'], 'the private reply is edited while the thread is still open')
  assert.deepEqual(names(calls), ['defer', 'edit'])
  assert.match(calls[1][1].content, /^Posted as Dragonbaron: https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+\nLocking and archiving the thread now\.$/)
  assert.match(audits[0], /, then locked and archived the thread: /)

  const stuck = command({ close: true, channelId: CH.todoThread })
  th.edit = async () => { throw new Error('Missing Permissions') }
  await S.handleInteraction(stuck.it)
  assert.deepEqual(names(stuck.calls), ['defer', 'edit', 'edit'])
  assert.match(stuck.calls[2][1].content, /\nThe thread could not be locked; close it by hand\.$/)
  assert.match(audits[1], /, but the thread could not be locked: /)
})

test('the audit line holds the name and the first words as inline code, so markdown or mentions in them cannot hide or fake part of the audit channel', async () => {
  const S = make()
  const tricky = { displayName: '||Ja`ke', roles: { cache: new Map([[ROLE.lead, {}]]) } }
  const { it } = command({ text: '||hide `this` <@&123> [x](https://e.example) ```', fields: { member: tricky } })
  await S.handleInteraction(it)
  assert.equal(audits.length, 1)
  const T = String.fromCharCode(0x02cb)
  assert.ok(audits[0].startsWith(`SAY \`||Ja${T}ke\` (@icedsky) posted as Dragonbaron in <#${CH.general}>: https://`), audits[0])
  assert.ok(audits[0].endsWith(` \`||hide ${T}this${T} <@&123> [x](https://e.example) ${T}${T}${T}\``), audits[0])
  assert.equal(audits[0].split('`').length, 5, 'only the four backticks that open and close the two code spans')
})

test('a defer that fails posts nothing, and a post Discord refuses is reported privately and not logged as posted', async () => {
  const S = make()
  const late = command({ deferThrows: true })
  await S.handleInteraction(late.it)
  assert.deepEqual(names(late.calls), ['defer'])
  assert.equal(allSends().length, 0)
  channels.get(CH.general).send = async () => { throw new Error('Missing Permissions') }
  const refused = command()
  await S.handleInteraction(refused.it)
  assert.equal(refused.calls[1][1].content, say.ERRORS.postFailed)
  assert.equal(audits.length, 0)
})

test('anything that is not /say or its form is left for the next handler; a fake or foreign interaction posts nothing', async () => {
  const S = make()
  assert.equal(await S.handleInteraction(null), false)
  assert.equal(await S.handleInteraction(command({ commandName: 'console' }).it), false)
  const ticketForm = submit('x', 'y')
  ticketForm.it.customId = 'ticket:submit:pk'
  assert.equal(await S.handleInteraction(ticketForm.it), false)
  assert.equal(await consoleCommand.handleInteraction(command().it, {}), false, '/console leaves /say alone')
  const plain = { isChatInputCommand: () => true, commandName: 'say', isModalSubmit: () => false, guildId: GUILD, user: { id: USER.lead }, reply: async () => {} }
  assert.equal(await S.handleInteraction(plain), true)
  const foreign = command({ fields: { client: { channels: client.channels } } })
  await S.handleInteraction(foreign.it)
  assert.equal(foreign.calls[0][1].content, say.ERRORS.badInteraction)
  assert.equal(allSends().length, 0)
})

test('parseTarget: ids, discord.com, ptb and canary links in this channel; anything else is refused', () => {
  assert.deepEqual(say.parseTarget('', GUILD, CH.general), { id: null })
  assert.deepEqual(say.parseTarget(null, GUILD, CH.general), { id: null })
  assert.deepEqual(say.parseTarget(OLD_MESSAGE, GUILD, CH.general), { id: OLD_MESSAGE })
  for (const host of ['discord.com', 'ptb.discord.com', 'canary.discord.com', 'discordapp.com']) {
    assert.deepEqual(say.parseTarget(`https://${host}/channels/${GUILD}/${CH.general}/${OLD_MESSAGE}`, GUILD, CH.general), { id: OLD_MESSAGE }, host)
  }
  assert.deepEqual(say.parseTarget(`https://evil.example/channels/${GUILD}/${CH.general}/${OLD_MESSAGE}`, GUILD, CH.general), { bad: 'badTarget' })
  assert.deepEqual(say.parseTarget(`https://discord.com/channels/${GUILD}/${CH.general}/${OLD_MESSAGE}?x=1`, GUILD, CH.general), { bad: 'badTarget' })
})

test('bot.js hands /say what the tickets and /console leave', () => {
  const bot = fs.readFileSync(path.join(__dirname, '..', 'sources', 'discord', 'bot.js'), 'utf8')
  assert.match(bot, /require\('\.\/consoleCommand'\)\.handleInteraction\(interaction\)\)\)\s*\.then\(handled => \(handled \? true : require\('\.\/sayCommand'\)\.handleInteraction\(interaction\)\)\)/)
})

test('the /say register script: one guild POST of /say alone, so /console stays; removal deletes /say only; nothing is sent without --yes', async () => {
  const c = sayScript.COMMAND
  assert.equal(c.name, 'say')
  assert.equal(c.default_member_permissions, '0')
  assert.deepEqual(c.contexts, [0])
  assert.ok(c.description.length <= 100)
  assert.deepEqual(c.options.map(o => [o.name, o.type, o.required]), [['text', 3, false], ['reply_to', 3, false], ['close', 5, false]])
  assert.equal(c.options[0].max_length, 2000)
  const app = snow(3), consoleId = snow(4), sayId = snow(5)
  const listed = [{ id: consoleId, name: 'console' }]
  const sent = []
  const send = async s => { sent.push(s); return s.method === 'GET' ? listed : { id: sayId } }
  const out = []
  const cfg = { discordBotToken: 't', discordGuildId: GUILD, discordClientId: app }
  assert.equal(await consoleScript.main(['register'], { config: cfg, send, out: l => out.push(l), command: c }), 0)
  assert.deepEqual(sent.map(s => s.method), ['GET'])
  assert.match(out.join('\n'), /would send POST .*"name":"say"/)
  sent.length = 0
  await consoleScript.main(['register', '--yes'], { config: cfg, send, out: () => {}, command: c })
  assert.deepEqual(sent.map(s => [s.method, s.path]), [['GET', `/applications/${app}/guilds/${GUILD}/commands`], ['POST', `/applications/${app}/guilds/${GUILD}/commands`]])
  assert.equal(sent[1].body.name, 'say', 'the POST carries /say alone, never the whole list')
  listed.push({ id: sayId, name: 'say' })
  sent.length = 0
  await consoleScript.main(['remove', '--yes'], { config: cfg, send, out: () => {}, command: c })
  assert.deepEqual(sent.map(s => [s.method, s.path]), [['GET', `/applications/${app}/guilds/${GUILD}/commands`], ['DELETE', `/applications/${app}/guilds/${GUILD}/commands/${sayId}`]])
  assert.equal(consoleScript.plan('register', { app, guild: GUILD }).at(0).body.name, 'console', '/console\'s own register is unchanged')
  const usage = []
  await consoleScript.main(['nope'], { config: cfg, send, out: l => usage.push(l), command: c })
  assert.match(usage[0], /scripts\/say-command\.js/)
})

test('the console keeps its config checks and their order; the rank rule it shares with /say does not need the pin', () => {
  const { readConfig, readRankRule } = require('../sources/console/staffConsole')
  const good = { consoleDiscordIds: USER.lead, consoleRoleIds: `${ROLE.owner},${ROLE.lead}`, discordGuildId: GUILD, consoleDiscordChannelIds: '' }
  const c = readConfig(good)
  assert.equal(c.problem, '')
  assert.deepEqual([[...c.roles], c.guild], [[ROLE.owner, ROLE.lead], GUILD])
  assert.equal(readConfig({ ...good, consoleDiscordIds: '', consoleRoleIds: '' }).problem, 'CONSOLE_DISCORD_IDS must be 1 to 10 Discord ids (empty is off)')
  assert.equal(readConfig({ ...good, consoleRoleIds: '' }).problem, 'CONSOLE_ROLE_IDS must be 1 to 10 role ids')
  assert.equal(readConfig({ ...good, discordGuildId: '' }).problem, 'DISCORD_GUILD_ID is not set')
  assert.equal(readConfig({ ...good, consoleRoleIds: GUILD }).problem, 'CONSOLE_ROLE_IDS holds the guild id (@everyone)')
  assert.equal(readConfig({ ...good, consoleDiscordChannelIds: 'x' }).problem, 'CONSOLE_DISCORD_CHANNEL_IDS must be channel ids')
  assert.deepEqual(readRankRule({ ...good, consoleDiscordIds: '' }), { roles: c.roles, guild: GUILD, problem: '' })
  assert.equal(readRankRule({ ...good, consoleRoleIds: GUILD }).problem, 'CONSOLE_ROLE_IDS holds the guild id (@everyone)')
})
