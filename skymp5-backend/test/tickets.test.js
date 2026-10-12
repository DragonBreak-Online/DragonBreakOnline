'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

// Discord is a fake client and interaction; config and the audit log are stubbed
const stub = (rel, exports) => {
  const file = require.resolve(rel)
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
const config = {
  discordTicketPanelChannelId: '1554000000000000001', discordBugsForumChannelId: '1551936720713416755',
  discordSuggestionsChannelId: '', websiteUrl: 'https://example.test/', discordStaffRoleIds: [],
  siteOwnerRoleIds: ['1554000000000000900'],
}
stub('../config', config)
const audits = []
stub('../sources/discord/audit', { log: line => audits.push(line) })
const tickets = require('../sources/discord/tickets')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-tickets-'))
test.after(() => fs.rmSync(dir, { recursive: true, force: true }))

function fakeClient(existing) {
  const calls = { edits: [], sends: [] }
  const channel = {
    messages: { fetch: async id => (existing && id === existing ? { edit: async p => { calls.edits.push(p) } } : Promise.reject(new Error('Unknown Message'))) },
    send: async p => { calls.sends.push(p); return { id: '1554000000000000099' } },
  }
  return { calls, client: { channels: { fetch: async id => (id === config.discordTicketPanelChannelId ? channel : null) } } }
}
const panelText = p => JSON.stringify(p.embeds.map(e => e.toJSON()))
const buttonIds = p => p.components.flatMap(r => r.toJSON().components.map(c => c.custom_id))

test('the panel has no Bug Report or Map Changes kind (Map Creation is its own, Nate 8 Oct)', () => {
  assert.deepStrictEqual(tickets.TYPES.map(t => t.id), ['pk', 'mod', 'rep', 'gmr', 'fac', 'map', 'gm'])
})

test('on boot the panel edits its own message: no bug buttons, and a line to the front door', async () => {
  const stateFile = path.join(dir, 'tickets-edit.json')
  fs.writeFileSync(stateFile, JSON.stringify({ counter: 4, categories: {}, panelMessageId: '1554000000000000042' }))
  const { client, calls } = fakeClient('1554000000000000042')
  await tickets.ensurePanel(client, stateFile)
  assert.strictEqual(calls.sends.length, 0)
  assert.strictEqual(calls.edits.length, 1)
  assert.deepStrictEqual(buttonIds(calls.edits[0]), ['ticket:open:pk', 'ticket:open:mod', 'ticket:open:rep', 'ticket:open:gmr', 'ticket:open:fac', 'ticket:open:map', 'ticket:open:gm'])
  const text = panelText(calls.edits[0])
  assert.match(text, /Found a bug\?/)
  assert.match(text, /\/bug <what happened>/)
  assert.match(text, /<#1551936720713416755>/)
  assert.match(text, /Report a Problem in the launcher/)
  assert.match(text, /https:\/\/example\.test\/report\.html/)
  assert.match(text, /#suggestions/)
  assert.match(text, /Exploits and dupes: never in public/)
  assert.doesNotMatch(text, /Bug Report|Map Changes/)
})

test('a panel whose message is gone is posted again and its id saved', async () => {
  const stateFile = path.join(dir, 'tickets-new.json')
  fs.writeFileSync(stateFile, JSON.stringify({ counter: 4, categories: {}, panelMessageId: '1554000000000000043' }))
  const { client, calls } = fakeClient(null)
  await tickets.ensurePanel(client, stateFile)
  assert.strictEqual(calls.sends.length, 1)
  assert.strictEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')).panelMessageId, '1554000000000000099')
})

test('a Bug Report button left on an old panel answers privately with the front door', async () => {
  let reply = null
  let modal = null
  const interaction = {
    customId: 'ticket:open:bug', isButton: () => true, isModalSubmit: () => false,
    reply: async r => { reply = r }, showModal: async m => { modal = m },
  }
  assert.strictEqual(await tickets.handleInteraction(interaction), true)
  assert.strictEqual(modal, null)
  assert.strictEqual(reply.ephemeral, true)
  assert.match(reply.content, /\/bug <what happened>/)
})

test('without a https website address the panel names the form without a link', async () => {
  config.websiteUrl = 'http://localhost:4001'
  const stateFile = path.join(dir, 'tickets-local.json')
  fs.writeFileSync(stateFile, JSON.stringify({ panelMessageId: '1554000000000000044' }))
  const { client, calls } = fakeClient('1554000000000000044')
  await tickets.ensurePanel(client, stateFile)
  assert.doesNotMatch(panelText(calls.edits[0]), /localhost/)
  assert.match(panelText(calls.edits[0]), /the report form on the website/)
  config.websiteUrl = 'https://example.test/'
})

// Faction Inquiry and Trial GM Application (Nate, 4 Oct)
const gmApplication = require('../sources/discord/gmApplication')
// Opening a ticket writes the real state file; put it back as it was
const realState = path.join(__dirname, '..', 'data', 'tickets.json')
const hadState = fs.existsSync(realState) ? fs.readFileSync(realState) : null
test.after(() => { if (hadState) fs.writeFileSync(realState, hadState); else fs.rmSync(realState, { force: true }) })

test('the panel has Faction Inquiry and Trial GM Application buttons, labelled', async () => {
  const stateFile = path.join(dir, 'tickets-new-types.json')
  fs.writeFileSync(stateFile, JSON.stringify({ counter: 0, categories: {}, panelMessageId: '1554000000000000044' }))
  const { client, calls } = fakeClient('1554000000000000044')
  await tickets.ensurePanel(client, stateFile)
  const labels = calls.edits[0].components.flatMap(r => r.toJSON().components.map(c => c.label))
  assert.ok(labels.includes('Faction Inquiry') && labels.includes('Trial GM Application') && labels.includes('Map Creation'))
  assert.match(panelText(calls.edits[0]), /Faction Inquiry/)
})

test('the GM application: every question, the acknowledgment, each message under Discord\'s limit', () => {
  assert.ok(gmApplication.length >= 2)
  for (const m of gmApplication) assert.ok(m.length <= 2000, `message of ${m.length} characters`)
  const all = gmApplication.join('\n')
  for (let n = 1; n <= 30; n++) assert.match(all, new RegExp(`^${n}\\. `, 'm'), `question ${n}`)
  assert.match(all, /Game Master Application/)
  assert.match(all, /Do you agree to these expectations\?/)
  assert.match(all, /Discord username:\nDate:$/)
})

test('a Trial GM Application ticket posts the questions after its opening message, with no pings', async () => {
  const sent = []
  const channel = { id: '1554000000000000200', name: 'gm-0001-applicant', send: async p => { sent.push(p) } }
  const guild = {
    roles: { everyone: { id: '1' } },
    channels: {
      cache: { get: () => null, find: () => ({ id: '1554000000000000300' }) },
      fetch: async () => null,
      create: async () => channel,
    },
  }
  const interaction = {
    guild, user: { id: '1554000000000000400', username: 'applicant', tag: 'applicant' },
    customId: 'ticket:submit:gm', isButton: () => false, isModalSubmit: () => true,
    deferReply: async () => {}, editReply: async () => {}, fields: { getTextInputValue: () => '' },
  }
  await tickets.handleInteraction(interaction)
  assert.strictEqual(sent.length, 1 + gmApplication.length)
  assert.ok(sent[0].embeds && /Trial GM Application/.test(JSON.stringify(sent[0].embeds[0].toJSON())))
  assert.deepStrictEqual(sent.slice(1).map(p => p.content), gmApplication)
  for (const p of sent.slice(1)) assert.deepStrictEqual(p.allowedMentions, { parse: [] })
})

test('a Faction Inquiry ticket posts only its opening message', async () => {
  const sent = []
  const channel = { id: '1554000000000000201', name: 'fac-0002-asker', send: async p => { sent.push(p) } }
  const guild = {
    roles: { everyone: { id: '1' } },
    channels: { cache: { get: () => null, find: () => ({ id: '1554000000000000301' }) }, fetch: async () => null, create: async () => channel },
  }
  await tickets.handleInteraction({
    guild, user: { id: '1554000000000000401', username: 'asker', tag: 'asker' },
    customId: 'ticket:submit:fac', isButton: () => false, isModalSubmit: () => true,
    deferReply: async () => {}, editReply: async () => {}, fields: { getTextInputValue: () => 'Joining the Fighters Guild' },
  })
  assert.strictEqual(sent.length, 1)
  assert.match(JSON.stringify(sent[0].embeds[0].toJSON()), /Faction Inquiry/)
})

test('a Report a GM ticket is read and pinged by the Owners only, and logs no reporter (Nate, 12 Oct)', async () => {
  config.discordStaffRoleIds = ['1554000000000000901', '1554000000000000902']
  config.discordTicketPingRoleId = '1554000000000000902'
  const sent = []
  let made
  const channel = { id: '1554000000000000202', name: 'gmr-0003', send: async p => { sent.push(p) } }
  const guild = {
    roles: { everyone: { id: '1' } },
    channels: { cache: { get: () => null, find: () => ({ id: '1554000000000000302' }) }, fetch: async () => null,
      create: async opts => { made = opts; return channel } },
  }
  audits.length = 0
  try {
    await tickets.handleInteraction({
      guild, user: { id: '1554000000000000402', username: 'reporter', tag: 'reporter' },
      customId: 'ticket:submit:gmr', isButton: () => false, isModalSubmit: () => true,
      deferReply: async () => {}, editReply: async () => {}, fields: { getTextInputValue: () => 'A GM spawned gear for a friend' },
    })
  } finally {
    config.discordStaffRoleIds = []
    config.discordTicketPingRoleId = ''
  }
  assert.deepStrictEqual(made.permissionOverwrites.map(o => o.id), ['1', '1554000000000000402', '1554000000000000900'])
  assert.doesNotMatch(made.name, /reporter/)
  assert.match(sent[0].content, /<@&1554000000000000900>/)
  assert.doesNotMatch(sent[0].content, /1554000000000000902/)
  assert.ok(audits.length && audits.every(l => !/reporter|1554000000000000402/.test(l)), audits.join('\n'))
})

test('closing a Report a GM ticket logs no closer, since the reporter can press Close (review, 12 Oct)', async () => {
  const close = async (name, user) => {
    let opts
    const channel = { id: '1554000000000000203', name, delete: async () => {}, send: async () => {} }
    await tickets.closeTicket({ channel, user, reply: async () => {} },
      { wait: 0, transcripts: { save: async (_c, _u, o) => { opts = o; return `saved as ${name}.json` } } })
    return opts
  }
  audits.length = 0
  assert.strictEqual((await close('gmr-0004', { id: '1554000000000000403', tag: 'reporter' })).fileOnly, true)
  assert.ok(audits.length && audits.every(l => !/reporter|1554000000000000403/.test(l)), audits.join('\n'))
  audits.length = 0
  assert.strictEqual((await close('rep-0005-someone', { id: '1554000000000000404', tag: 'staffer' })).fileOnly, false)
  assert.ok(audits.some(l => /closed #rep-0005-someone by staffer \(1554000000000000404\)/.test(l)), audits.join('\n'))
})

test('a Report a GM channel an Owner renamed still closes as owners-only, found by its category (review, 12 Oct)', async () => {
  fs.writeFileSync(realState, JSON.stringify({ counter: 9, categories: { gmr: '1554000000000000310', rep: '1554000000000000311' }, panelMessageId: null }))
  const close = async (name, parentId) => {
    let opts
    const channel = { id: '1554000000000000204', name, parentId, delete: async () => {}, send: async () => {} }
    await tickets.closeTicket({ channel, user: { id: '1554000000000000405', tag: 'reporter' }, reply: async () => {} },
      { wait: 0, transcripts: { save: async (_c, _u, o) => { opts = o; return `saved as ${name}.json` } } })
    return opts
  }
  audits.length = 0
  assert.strictEqual((await close('harassment-case', '1554000000000000310')).fileOnly, true)
  assert.ok(audits.length && audits.every(l => !/reporter|1554000000000000405/.test(l)), audits.join('\n'))
  // A ticket in another category, or in none, is not owners-only
  assert.strictEqual((await close('rep-0006-someone', '1554000000000000311')).fileOnly, false)
  assert.strictEqual((await close('chat', undefined)).fileOnly, false)
})

// A guild whose channel cache answers find() by its predicate, as discord.js does, and keeps the channels it creates
const { ChannelType } = require('discord.js')
function ticketGuild() {
  const made = []
  const sent = []
  const channels = [
    { id: '1554000000000000320', type: ChannelType.GuildCategory, name: 'GM Reports' },
    { id: '1554000000000000321', type: ChannelType.GuildCategory, name: 'Player Reports' },
  ]
  const guild = {
    roles: { everyone: { id: '1' } },
    channels: {
      cache: { get: id => channels.find(c => c.id === id), find: fn => channels.find(fn) },
      fetch: async () => null,
      create: async opts => {
        made.push(opts)
        const c = { id: String(1554000000000000500n + BigInt(made.length)), name: opts.name, type: opts.type, parentId: opts.parent,
          permissionOverwrites: { cache: new Map(opts.permissionOverwrites.map(o => [o.id, o])) }, send: async p => { sent.push(p) } }
        channels.push(c)
        return c
      },
    },
  }
  const submit = async (typeId, id, name) => {
    let reply
    await tickets.handleInteraction({
      guild, user: { id, username: name, tag: name }, customId: `ticket:submit:${typeId}`, isButton: () => false, isModalSubmit: () => true,
      deferReply: async () => {}, editReply: async r => { reply = r }, fields: { getTextInputValue: () => 'A GM teleported me into a wall' },
    })
    return reply
  }
  return { made, sent, submit }
}

test('a Report a GM channel topic names no reporter, since Discord\'s Audit Log keeps the topic (review, 12 Oct)', async () => {
  const { made, submit } = ticketGuild()
  await submit('gmr', '1554000000000000406', 'reporter')
  assert.strictEqual(made.length, 1)
  assert.strictEqual(made[0].topic, 'Report a GM')
  await submit('rep', '1554000000000000407', 'player')
  assert.strictEqual(made[1].topic, 'Report Player | opened by player (1554000000000000407)')
})
