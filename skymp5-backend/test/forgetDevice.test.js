'use strict'

// A privacy request or an account deletion erases the device check's entry, except a banned account's (security audit L3-01)
const { test, after, mock } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs     = require('fs')
const os     = require('os')
const path   = require('path')
const { loadWithDataIn } = require('./helpers/dataDir')

require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
const fw = require.resolve('../sources/factionWhitelist')
require.cache[fw] = { id: fw, filename: fw, loaded: true, exports: { getPlayerAssignments: () => [], getPlayerFactionPermissions: () => [], getPlayerGameFactions: () => [] } }

// Test-only Discord ids with their profiles: 2 and 3 play, 4 is banned
const A = '210000000000000021', B = '220000000000000022', BANNED = '230000000000000023'
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forget-device-'))
fs.writeFileSync(path.join(tmp, 'profiles.json'), JSON.stringify({ nextId: 5, map: { [A]: 2, [B]: 3, [BANNED]: 4 } }))
fs.writeFileSync(path.join(tmp, 'players.json'), JSON.stringify({ [A]: { profileId: 2, discordId: A }, [B]: { profileId: 3, discordId: B }, [BANNED]: { profileId: 4, discordId: BANNED } }))
const { players } = loadWithDataIn(tmp, ['profiles.json', 'players.json'], () => ({ players: require('../sources/players'), profiles: require('../sources/profiles') }))
const dc = require('../sources/deviceChecks')
const { main } = require('../scripts/forget-device')

const STORE = path.join(tmp, 'device-ids.json')
dc._test.reset()
dc._test.use({
  audit: () => {},
  log: () => {},
  config: { deviceIdHmacKey: 'd4'.repeat(32), deviceMatch: 'report', deviceRetentionDays: 30, newAccountFlagDays: 0 },
  bans: () => [{ discordId: BANNED, ref: 'B-7KQ2MX', bannedAt: '2026-10-14T12:00:00.000Z' }],
  players: () => ({}),
  who: () => 'a player with no character yet',
  store: STORE,
})
const code = pc => `v1.${crypto.createHash('sha256').update(`DragonBreak device v1\n${pc}`).digest('hex')}`
for (const id of [A, B, BANNED]) dc.onLaunchCheck(`session-${id}`, { discordId: id }, { device: code('pc-1') })
const accounts = () => Object.keys(JSON.parse(fs.readFileSync(STORE, 'utf8')).accounts).sort()
after(() => { dc._test.reset(); fs.rmSync(tmp, { recursive: true, force: true }) })

function run(...argv) {
  const out = []
  mock.method(console, 'log', (...args) => { out.push(args.join(' ')) })
  mock.method(console, 'error', (...args) => { out.push(args.join(' ')) })
  try { return { code: main(argv), out } } finally { mock.restoreAll() }
}

test('scripts/forget-device.js --profile N removes the entry, says only that, and says "nothing stored" the second time', () => {
  assert.deepEqual(accounts(), [A, B, BANNED].sort())
  assert.deepEqual(run('--profile', '2'), { code: 0, out: ['removed'] })
  assert.deepEqual(run('--profile', '2'), { code: 0, out: ['nothing stored'] })
  assert.deepEqual(run('--profile', '4'), { code: 0, out: ['kept: account is banned'] })
  assert.deepEqual(accounts(), [B, BANNED].sort())
  for (const argv of [[], ['--profile'], ['--profile', 'abc'], ['--discord', A], ['--profile', A + A]]) assert.equal(run(...argv).code, 2, argv.join(' '))
})

test('an unknown profile number says nothing was checked and exits 3, never "nothing stored"', () => {
  const r = run('--profile', '99')
  assert.deepEqual(r, { code: 3, out: ['no such profile: nothing was checked'] })
  assert.ok(!r.out.join('\n').includes('nothing stored'))
  assert.deepEqual(accounts(), [B, BANNED].sort(), 'nothing was erased')
})

test('a failed erase while deleting a player names the 30-day rule, not the script that can no longer find it', () => {
  const lines = []
  mock.method(dc, 'forgetAccount', () => { throw new Error('store cannot be read') })
  mock.method(console, 'error', (...args) => { lines.push(args.join(' ')) })
  try { players.deleteByProfileId(2) } finally { mock.restoreAll() }
  assert.equal(lines.length, 1)
  assert.match(lines[0], /30-day rule unless the account is banned/)
  assert.ok(!lines[0].includes('forget-device'))
})

test('deleting a player also erases its device check entry', () => {
  players.deleteByProfileId(3)
  assert.deepEqual(accounts(), [BANNED])
  players.deleteByProfileId(4)
  assert.deepEqual(accounts(), [BANNED], 'a banned account\'s entry stays with its ban')
})
