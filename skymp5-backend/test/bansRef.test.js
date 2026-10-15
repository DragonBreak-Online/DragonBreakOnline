'use strict'

// Every ban has a reference staff can search and quote, and no raw hardware id is kept or matched (security audit L3-01)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

// A private copy of bans.js beside its own data folder, so the real data/bans.json is never touched
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bans-ref-test-'))
fs.mkdirSync(path.join(root, 'sources'))
fs.mkdirSync(path.join(root, 'data'))
fs.copyFileSync(path.join(__dirname, '..', 'sources', 'bans.js'), path.join(root, 'sources', 'bans.js'))
process.env.BAN_LOG_DIR = path.join(root, 'logs')
const bans = require(path.join(root, 'sources', 'bans.js'))
const BANS = path.join(root, 'data', 'bans.json')
const REF = /^B-[0-9A-HJKMNP-TV-Z]{6}$/
const onDisk = () => JSON.parse(fs.readFileSync(BANS, 'utf8'))

test('a new ban gets a reference: B- and 6 Crockford base32 characters, different for every ban', () => {
  fs.rmSync(BANS, { force: true })
  const refs = new Set()
  for (let i = 0; i < 60; i++) {
    const e = bans.add({ discordId: String(1000 + i), reason: 'test' })
    assert.match(e.ref, REF)
    refs.add(e.ref)
  }
  assert.equal(refs.size, 60)
  assert.equal(onDisk().find(e => e.discordId === '1000').ref, [...refs][0])
})

test('banning the same account again replaces its entry and keeps its reference', () => {
  fs.rmSync(BANS, { force: true })
  const first = bans.add({ discordId: '111', reason: 'first' })
  const second = bans.add({ discordId: '111', reason: 'second' })
  assert.match(second.ref, REF)
  assert.equal(second.ref, first.ref)
  assert.deepEqual(onDisk().map(e => [e.discordId, e.ref, e.reason]), [['111', first.ref, 'second']])
})

test('an entry from before references gets one the first time it is read, saved once', () => {
  fs.writeFileSync(BANS, JSON.stringify([
    { discordId: '222', hwid: null, ip: null, reason: 'old', bannedAt: '2026-10-14T23:50:53.000Z' },
    { discordId: '223', ref: 'B-AAAAAA', reason: 'hand copied' },
    { discordId: '224', ref: 'B-AAAAAA', reason: 'hand copied twice' },
  ]))
  const listed = bans.list()
  for (const e of listed) assert.match(e.ref, REF)
  assert.equal(new Set(listed.map(e => e.ref)).size, 3, 'a duplicated reference is replaced on the second entry')
  assert.equal(listed[1].ref, 'B-AAAAAA', 'a good reference is kept')
  const saved = fs.readFileSync(BANS, 'utf8')
  assert.deepEqual(JSON.parse(saved).map(e => e.ref), listed.map(e => e.ref))
  const mtime = fs.statSync(BANS).mtimeMs
  assert.deepEqual(bans.list().map(e => e.ref), listed.map(e => e.ref))
  assert.equal(bans.isBanned({ discordId: '222' }).ref, listed[0].ref)
  assert.equal(fs.readFileSync(BANS, 'utf8'), saved)
  assert.equal(fs.statSync(BANS).mtimeMs, mtime, 'nothing is written once every entry has a reference')
})

test('a ban never stores a hardware id, even when one is handed in', () => {
  fs.rmSync(BANS, { force: true })
  const e = bans.add({ discordId: '333', hwid: 'FAKE-MACHINE-GUID', reason: 'test' })
  assert.equal(e.hwid, null)
  assert.ok(!fs.readFileSync(BANS, 'utf8').includes('FAKE-MACHINE-GUID'))
})

test('a hardware id never matches a ban, not even one an old entry holds', () => {
  fs.writeFileSync(BANS, JSON.stringify([{ discordId: '444', hwid: 'FAKE-MACHINE-GUID', ip: null }]))
  assert.equal(bans.isBanned({ discordId: '555', hwid: 'FAKE-MACHINE-GUID' }), null)
  assert.equal(bans.isBanned({ hwid: 'FAKE-MACHINE-GUID' }), null)
  assert.equal(bans.isBanned({ discordId: '444', hwid: 'other' }).discordId, '444', 'the Discord id still matches')
})

test.after(() => fs.rmSync(root, { recursive: true, force: true }))
