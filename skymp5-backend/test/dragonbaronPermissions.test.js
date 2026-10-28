'use strict'
// The ask permission node (sources/discord/dragonbaronPermissions.js) on a copy of an old 9-key permissions file

const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dbai-perms-'))
after(() => fs.rmSync(TMP, { recursive: true, force: true }))
const FILE = path.join(TMP, 'dragonbaron-permissions.json')
process.env.DRAGONBARON_PERMS_FILE = FILE

const perms = require('../sources/discord/dragonbaronPermissions')
const ui = require('../sources/discord/dragonbaronUI')
const R = perms.ROLES
const CUSTOM = (10n ** 18n + 77n).toString()

// The live file's shape before ask: 9 keys, without citizenship and items_spells, one node edited by an Owner
function oldFile() {
  const old = JSON.parse(JSON.stringify(perms.DEFAULT_PERMISSIONS))
  delete old.citizenship
  delete old.items_spells
  delete old.ask
  old.tickets.allowedRoles = [R.LEAD_GM, R.GM]
  assert.equal(Object.keys(old).length, 9)
  fs.writeFileSync(FILE, JSON.stringify(old, null, 2))
  perms._resetCache()
}

test('the old file loads with ask added at its default roles, and saved edits are kept', () => {
  oldFile()
  const p = perms.loadPermissions()
  assert.deepEqual(p.ask.allowedRoles, [R.OWNER, R.DEV, R.LEAD_GM, R.GM])
  assert.equal(p.ask.label, 'Ask Dragonbaron (AI)')
  assert.deepEqual(p.tickets.allowedRoles, [R.LEAD_GM, R.GM])
  assert.equal(Object.keys(p).length, 12)
  assert.equal(perms.hasPermission([R.GM], 'ask'), true)
  assert.equal(perms.hasPermission([R.TRIAL_GM], 'ask'), false)
  assert.equal(JSON.parse(fs.readFileSync(FILE, 'utf8')).ask, undefined, 'loading changes nothing on disk')
})

test('a role that holds only ask cannot open the control panel', () => {
  oldFile()
  assert.equal(perms.setPermissionRoles('ask', [CUSTOM]), true)
  assert.equal(perms.hasPermission([CUSTOM], 'ask'), true)
  assert.equal(perms.canAccessPanel([CUSTOM]), false)
  assert.equal(perms.canAccessPanel([R.GM]), true)
  assert.deepEqual(JSON.parse(fs.readFileSync(FILE, 'utf8')).ask.allowedRoles, [CUSTOM])
  assert.equal(perms.resetPermissionRoles('ask'), true)
  assert.deepEqual(perms.loadPermissions().ask.allowedRoles, [R.OWNER, R.DEV, R.LEAD_GM, R.GM])
})

test('askTier: the highest staff rank held', () => {
  assert.equal(perms.askTier([R.GM, R.OWNER]), 'owner')
  assert.equal(perms.askTier([R.DEV]), 'dev')
  assert.equal(perms.askTier([R.LEAD_GM, R.GM]), 'leadgm')
  assert.equal(perms.askTier([R.GM]), 'gm')
  assert.equal(perms.askTier([R.TRIAL_GM]), 'trialgm')
  assert.equal(perms.askTier([CUSTOM]), null)
  assert.equal(perms.askTier(undefined), null)
})

test('the config overview has 12 fields, an ask option, and fits Discord', () => {
  oldFile()
  const view = ui.buildConfigOverview()
  const embed = view.embeds[0].toJSON()
  assert.equal(embed.fields.length, 12)
  assert.ok(embed.fields.some(f => f.name === 'Ask Dragonbaron (AI) (`ask`)'))
  const chars = (embed.title || '').length + (embed.description || '').length + embed.fields.reduce((a, f) => a + f.name.length + f.value.length, 0)
  assert.ok(chars < 6000, String(chars))
  assert.ok(embed.fields.every(f => f.value.length <= 1024))
  const options = view.components[0].components[0].toJSON().options
  assert.equal(options.length, 12)
  const ask = options.find(o => o.value === 'ask')
  assert.equal(ask.label, 'Ask Dragonbaron (AI)')
  assert.ok(ask.description.length <= 100)
})

test('the permissions file path comes from DRAGONBARON_PERMS_FILE, so tests never write into the checkout', () => {
  fs.rmSync(FILE, { force: true })
  perms._resetCache()
  perms.loadPermissions()
  assert.ok(fs.existsSync(FILE))
})
