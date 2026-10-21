'use strict'
// The Punishments panel service (sources/punish/index.js) on the fixture record files, without the routes: how a GM's
// request waits on Discord, and how the lists page

const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { createPunishFixture, PEOPLE } = require('./helpers/punishFixture')
const { createPunishments } = require('../sources/punish')

const F = createPunishFixture()
after(() => F.cleanup())
let clock = F.now

const plog = { events: () => ({ version: 0, list: [] }), refresh() {}, view: () => ({ status: 'ok', asOf: null, from: null, days: 90 }), stop: async () => {} }
const service = opts => createPunishments({
  config: { gameServerDir: F.game, punishBansFile: F.bansFile, punishJournalFile: F.journalFile },
  readStore: () => F.forms, dynamicFields: cf => cf.dynamicFields || {}, characterName: cf => cf.displayName,
  loadProfiles: () => F.profiles, loadPlayers: () => F.players, playerLog: plog, tailIntervalMs: 0, now: () => clock, ...opts,
})
const GM = { tier: 'gm', discordId: PEOPLE.gm.discordId, profileId: PEOPLE.gm.profileId }
const flush = () => new Promise(resolve => setImmediate(resolve))

test('a GM request that gives up on Discord after 10 s starts no more lookups', async t => {
  const everyone = []
  await service({ staffStatusOf: async d => { everyone.push(d); return 'player' } }).recent(GM, { from: '2000-01-01', limit: '100' })
  assert.ok(new Set(everyone).size > 5, 'the GM\'s rows cover more accounts than are looked up at once')

  t.mock.timers.enable({ apis: ['setTimeout'] })
  const asked = []
  const pending = service({ staffStatusOf: d => { asked.push(d); return new Promise(() => {}) } }).recent(GM, { from: '2000-01-01', limit: '100' })
  await flush()
  assert.equal(asked.length, 5, 'five lookups at once')
  t.mock.timers.tick(10000)
  const r = await pending
  assert.deepEqual(r.rows, [], 'what Discord did not answer is hidden')
  assert.equal(asked.length, 5, 'no lookup is started once the request has given up')
})
