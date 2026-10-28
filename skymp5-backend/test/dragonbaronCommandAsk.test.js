'use strict'
// /dragonbaron routing (sources/discord/dragonbaronCommand.js): ask goes to its own handler before the console and the generic defer

const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dbai-cmd-'))
after(() => fs.rmSync(TMP, { recursive: true, force: true }))
process.env.DRAGONBARON_PERMS_FILE = path.join(TMP, 'dragonbaron-permissions.json')

const consoleLoads = { n: 0 }
const consolePath = require.resolve('../sources/console')
require.cache[consolePath] = { id: consolePath, filename: consolePath, loaded: true, get exports() { consoleLoads.n++; throw new Error('the console was loaded') } }
const asked = []
const askPath = require.resolve('../sources/discord/dragonbaronAsk')
require.cache[askPath] = { id: askPath, filename: askPath, loaded: true, exports: { handleInteraction: async it => { asked.push(it); return true } } }

const { ChatInputCommandInteraction } = require('discord.js')
const perms = require('../sources/discord/dragonbaronPermissions')
const ui = require('../sources/discord/dragonbaronUI')
const command = require('../sources/discord/dragonbaronCommand')

const dashboards = []
const realDashboard = ui.buildDashboard
ui.buildDashboard = (...a) => { dashboards.push(a); return realDashboard(...a) }

const snow = n => (10n ** 18n + BigInt(n)).toString()
const api = { discordCaller: it => ({ discordId: it.user.id, displayName: 'Jake' }) }

function slash(sub, roles, name = 'dragonbaron') {
  const calls = []
  const it = Object.assign(Object.create(ChatInputCommandInteraction.prototype), {
    id: snow(9000 + Math.floor(Math.random() * 1e6)), type: 2, commandType: 1, commandName: name, guildId: snow(1), user: { id: snow(33), username: 'jake', bot: false },
    member: { roles }, options: { getSubcommand: () => sub, getString: () => 'is the server up' },
    deferReply: async x => { calls.push(['defer', x]) }, editReply: async x => { calls.push(['edit', x]) }, reply: async x => { calls.push(['reply', x]) },
  })
  return { it, calls }
}

test('ask goes to the ask module: no console, no dashboard, no generic defer', async () => {
  const { it, calls } = slash('ask', [perms.ROLES.OWNER])
  assert.equal(await command.handleInteraction(it), true)
  assert.deepEqual(asked, [it])
  assert.deepEqual(calls, [])
  assert.equal(dashboards.length, 0)
  assert.equal(consoleLoads.n, 0)
})

test('admin and config behave as before', async () => {
  const admin = slash('admin', [perms.ROLES.OWNER])
  assert.equal(await command.handleInteraction(admin.it, api), true)
  assert.deepEqual(admin.calls.map(c => c[0]), ['defer', 'edit'])
  assert.equal(dashboards.length, 1)
  assert.match(admin.calls[1][1].embeds[0].toJSON().title, /Staff Control Panel/)

  const config = slash('config', [perms.ROLES.OWNER])
  await command.handleInteraction(config.it, api)
  assert.deepEqual(config.calls.map(c => c[0]), ['defer', 'edit'])
  assert.match(config.calls[1][1].embeds[0].toJSON().title, /Permission & Role Configuration/)

  const refused = slash('config', [perms.ROLES.GM])
  await command.handleInteraction(refused.it, api)
  assert.match(refused.calls[1][1].content, /do not have permission/)

  const top = slash(null, [perms.ROLES.OWNER], 'admin')
  await command.handleInteraction(top.it, api)
  assert.equal(dashboards.length, 2)
  assert.equal(asked.length, 1, 'only the ask went to the ask module')
  assert.equal(consoleLoads.n, 0)
})

test('another command is not ours', async () => {
  const other = slash('ask', [], 'console')
  assert.equal(await command.handleInteraction(other.it, api), false)
  assert.equal(asked.length, 1)
})
