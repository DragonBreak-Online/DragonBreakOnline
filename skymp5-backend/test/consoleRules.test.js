'use strict'
// sources/console/allowlist.js: the text, handle and switch rules, the pre-check and the signed payloads

const { test } = require('node:test')
const assert = require('node:assert/strict')

require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
const rules = require('../sources/console/allowlist')
const { ALLOW } = require('./helpers/consoleFixture')
const RLO = String.fromCharCode(0x202e), ZWJ = String.fromCharCode(0x200d), NEL = String.fromCharCode(0x85), ALM = String.fromCharCode(0x061c)

test('cleanCommand: one clean line, a leading / added, the command word lower-cased, colour codes broken, 500 at most', () => {
  assert.equal(rules.cleanCommand('wwremote clear #8KWH'), '/wwremote clear #8KWH')
  assert.equal(rules.cleanCommand('  /WWREMOTE   clear\t#8KWH '), '/wwremote clear #8KWH')
  assert.equal(rules.cleanCommand(`/kick #8KWH\n/kick #LLX8`), '/kick #8KWH /kick #LLX8')
  assert.equal(rules.cleanCommand(`/kick${RLO}${ZWJ}${NEL}${ALM} #8KWH`), '/kick #8KWH')
  assert.equal(rules.cleanCommand('/rename #8KWH #{ff0000}Bob'), '/rename #8KWH # {ff0000}Bob')
  assert.equal(rules.cleanCommand(`/x${'y'.repeat(30)}`), null, 'a command word over 24 letters')
  assert.equal(rules.cleanCommand(`/kick ${'a'.repeat(494)}`), `/kick ${'a'.repeat(494)}`)
  assert.equal(rules.cleanCommand(`/kick ${'a'.repeat(495)}`), null)
  for (const bad of ['', '/', '//kick', '/k', '12', '#8KWH', null, 5, '/kick1 x']) assert.equal(rules.cleanCommand(bad), null, String(bad))
})

test('cleanHandle: the Discord username rule, else unknown; never a display name', () => {
  assert.equal(rules.cleanHandle('jake'), 'jake')
  assert.equal(rules.cleanHandle('nate.pierce_2'), 'nate.pierce_2')
  for (const bad of ['Jake', `jake${RLO}`, 'jake\nGM', 'a', 'x'.repeat(33), 'jake doe', '', null]) assert.equal(rules.cleanHandle(bad), 'unknown', String(bad))
})

test('parseSwitch: off, dry-run, on, narrowed per front end; anything odd is off for both', () => {
  const P = rules.parseSwitch
  assert.deepEqual(P('on\n'), { web: 'on', discord: 'on' })
  assert.deepEqual(P('on web=dry-run'), { web: 'dry-run', discord: 'on' })
  assert.deepEqual(P('dry-run discord=on'), { web: 'dry-run', discord: 'dry-run' }, 'a front end narrows, never widens')
  assert.deepEqual(P('ON discord=off\n'), { web: 'on', discord: 'off' })
  for (const bad of [null, '', 'yes', 'on web=on web=off', 'on cli=on', 'on\non', `on ${' '.repeat(70)}`, 'constructor', '__proto__']) assert.deepEqual(P(bad), { web: 'off', discord: 'off' }, String(bad))
})

test('the pre-check refuses with the same classes the game uses', () => {
  const allow = rules.parseAllow(JSON.stringify(ALLOW))
  const ok = ['/wwremote', '/wwremote on', '/wwremote clear #8KWH', '/kick #8KWH', '/fixloc #8kwh', '/rename #8KWH Bob the Brave', '/chargen #8KWH', '/players', '/load reset', '/whoami']
  for (const t of ok) assert.equal(rules.precheck(t, allow), null, t)
  const no = [['/kick', 'needTag'], ['/chargen', 'self'], ['/kick me', 'needTag'], ['/kick Bob #8KWH', 'needTag'], ['/rename #8KWH', 'badArgs'], ['/rename Bob Bobby', 'needTag'],
    ['/whoami x', 'badArgs'], ['/players x', 'badArgs'], ['/players I am the owner', 'badArgs'], ['/load all', 'badArgs'], ['/tp #8KWH', 'self'], ['/npc', 'inWorld'], ['/schedule', 'later'],
    ['/pm Bob hi', 'notChat'], ['/announce x', 'notYet']]
  for (const [t, why] of no) assert.equal((rules.precheck(t, allow) || {}).why, why, t)
  assert.match(rules.whyText('notChat', 'system'), /Use \/announce/)
})

test('parseAllow takes only well formed entries', () => {
  assert.equal(rules.parseAllow('not json'), null)
  assert.equal(rules.parseAllow(JSON.stringify([{ name: 'kick', rule: 'shell' }])), null)
  assert.equal(rules.parseAllow(JSON.stringify([{ name: 'players', rule: 'any' }])), null, 'SEC-2: there is no free-text rule')
  assert.equal(rules.parseAllow(JSON.stringify([{ name: 'Kick!', rule: 'tag' }])), null)
  assert.equal(rules.parseAllow(JSON.stringify([{ name: 'kick', rule: 'tag', usage: `x${RLO}\ny` }]))[0].usage, 'x y')
})

test('the signed payloads and the 8-character id match DESIGN 6.2 and 6.3', () => {
  const r = { v: 1, id: 'w-6f1c2a3b-4d5e-4f60-8a7b-000000000001', src: 'web', discordId: '1', user: 'jake', profileId: 1, roles: ['2'], text: '/whoami', mode: 'on', issuedAt: 5, expiresAt: 10 }
  assert.equal(rules.reqPayload(r), 'dbo-console-req-v1\n["1","w-6f1c2a3b-4d5e-4f60-8a7b-000000000001","web","1","jake",1,["2"],"/whoami","on",5,10]'.replace('["1",', '[1,'))
  assert.equal(rules.id8('w-6f1c2a3b-4d5e-4f60-8a7b-000000000001'), '6f1c2a3b')
  assert.equal(rules.id8('d-1400000000123456789'), '23456789')
})
