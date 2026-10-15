'use strict'

// One ban must never refuse everyone, whatever form the shared address arrives in (security audit L3-01, 15 Oct 2026)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

// A private copy of bans.js (and the storeFile helper it saves with) beside its own data folder, so the real data/bans.json and players.json are never touched
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bans-shared-test-'))
fs.mkdirSync(path.join(root, 'sources'))
fs.mkdirSync(path.join(root, 'data'))
for (const f of ['bans.js', 'storeFile.js']) fs.copyFileSync(path.join(__dirname, '..', 'sources', f), path.join(root, 'sources', f))
process.env.BAN_LOG_DIR = path.join(root, 'logs')
const bans = require(path.join(root, 'sources', 'bans.js'))
const BANS = path.join(root, 'data', 'bans.json')
const PLAYERS = path.join(root, 'data', 'players.json')

// Written by rename, as the backend's stores are, so every write is a new file
let writes = 0
function writePlayers(text) {
  const tmp = `${PLAYERS}.${++writes}.tmp`
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, PLAYERS)
}
const players = ips => writePlayers(JSON.stringify(Object.fromEntries(ips.map((ip, i) => [`9000${i}`, { discordId: `9000${i}`, lastIp: ip }]))))
const oldBan = (ip, discordId = '777') => fs.writeFileSync(BANS, JSON.stringify([{ discordId, hwid: null, ip }]))

// Documentation-range addresses (RFC 5737, RFC 3849) stand in for public ones
const RELAY_FORMS = [
  '10.10.10.1:54321', ' 10.10.10.1 ', '10.10.10.1.', '[::1]', '[::1]:7777', '::ffff:a0a:a01', '::FFFF:10.10.10.1',
  '0:0:0:0:0:ffff:10.10.10.1', '0:0:0:0:0:ffff:a0a:a01', '[::ffff:10.10.10.1]:7777', '::ffff:0:10.10.10.1', '::10.10.10.1',
  '64:ff9b::a0a:a01', '64:ff9b::10.10.10.1', 'fe80::1%eth0', 'FD7A:115C::1',
]
const SPECIAL = [
  '198.18.0.5', '198.19.255.1', '192.0.0.8', '0.1.2.3', '224.0.0.1', '239.1.2.3', '240.0.0.1', '255.255.255.255',
  '::', '2001:0:4136:e378::1', '2002:c000:204::1', 'ff02::1',
]
const UNPARSEABLE = ['not-an-ip', '1.2.3', '010.10.10.1', '1.2.3.4.5', '300.1.1.1', 'fe80::1::2', '<b>10.10.10.1</b>', 12345, {}]

test('the shared address in any written form, and every special-purpose range, counts as internal', () => {
  for (const ip of [...RELAY_FORMS, ...SPECIAL]) assert.equal(bans.isInternalIp(ip), true, ip)
  for (const ip of ['8.8.8.8', '203.0.113.9', '::ffff:203.0.113.9', '2001:db8::1', '[2001:db8::1]:7777']) assert.equal(bans.isInternalIp(ip), false, ip)
})

test('none of those forms, and nothing that is not an address, is stored in a ban or matched', () => {
  for (const ip of [...RELAY_FORMS, ...SPECIAL, ...UNPARSEABLE]) {
    fs.rmSync(BANS, { force: true })
    const e = bans.add({ discordId: '111', ip, reason: 'test' })
    assert.equal(e.ip, null, String(ip))
    assert.equal(bans.isBanned({ discordId: '222', ip }), null, String(ip))
    oldBan(ip)
    assert.equal(bans.isBanned({ discordId: '222', ip }), null, `old entry: ${ip}`)
    assert.equal(bans.isBanned({ discordId: '222', ip: '10.10.10.1' }), null, `old entry, plain lookup: ${ip}`)
  }
  for (const ip of UNPARSEABLE) assert.equal(bans.isInternalIp(ip), false, String(ip))
})

test('a public address one player has still bans by address, in any form it arrives in', () => {
  fs.rmSync(BANS, { force: true })
  fs.rmSync(PLAYERS, { force: true })
  const e = bans.add({ discordId: '333', ip: '[::ffff:cb00:7114]:5000' })
  assert.equal(e.ip, '203.0.113.20')
  for (const ip of ['203.0.113.20', '::ffff:203.0.113.20', '203.0.113.20:7777', '203.0.113.20.']) {
    assert.equal(bans.isBanned({ discordId: '444', ip })?.discordId, '333', ip)
  }
  assert.equal(bans.isBanned({ discordId: '444', ip: '203.0.113.21' }), null)
})

test('a public address that is the last address of 3 players is never stored or matched; the Discord id still is', () => {
  fs.rmSync(BANS, { force: true })
  players(['203.0.113.50', '::ffff:203.0.113.50', '203.0.113.50:6000', '198.51.100.7'])
  const e = bans.add({ discordId: '555', ip: '203.0.113.50' })
  assert.equal(e.ip, null)
  oldBan('203.0.113.50', '555')
  assert.equal(bans.isBanned({ discordId: '666', ip: '203.0.113.50' }), null)
  assert.equal(bans.isBanned({ discordId: '555', ip: '203.0.113.50' })?.discordId, '555')
  // Two players on one address is still one household's to answer for
  players(['203.0.113.50', '203.0.113.50', '198.51.100.7'])
  assert.equal(bans.isBanned({ discordId: '666', ip: '203.0.113.50' })?.discordId, '555')
})

test('a players.json that cannot be read turns address matching off; the Discord id still matches', () => {
  oldBan('203.0.113.60', '888')
  writePlayers('{ not json')
  assert.equal(bans.isBanned({ discordId: '999', ip: '203.0.113.60' }), null)
  assert.equal(bans.add({ discordId: '889', ip: '203.0.113.61' }).ip, null)
  assert.equal(bans.isBanned({ discordId: '888' })?.discordId, '888')
  writePlayers('[]')
  assert.equal(bans.isBanned({ discordId: '999', ip: '203.0.113.60' }), null, 'a file that is not a player store counts as unreadable')
  fs.rmSync(PLAYERS)
  assert.equal(bans.isBanned({ discordId: '999', ip: '203.0.113.60' })?.discordId, '888', 'no file: no address is shared')
})

test.after(() => fs.rmSync(root, { recursive: true, force: true }))
