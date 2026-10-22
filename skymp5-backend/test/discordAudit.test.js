'use strict'
// The Discord audit poster against a fake Discord on mock timers: refused batches, long lines, well-formed text, waits

const { test } = require('node:test')
const assert = require('node:assert/strict')
const https = require('https')
const { EventEmitter } = require('events')
const rules = require('../sources/console/allowlist')

const stub = (rel, exports) => {
  const file = require.resolve(rel)
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
stub('../config', { discordBotToken: 'not-a-token', discordLogChannelId: '1554000000000000777' })
const AUDIT = require.resolve('../sources/discord/audit')

// A fresh poster with its own queue and timer; console output is kept, not printed
function load(t) {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const errors = []
  t.mock.method(console, 'error', (...a) => errors.push(a.join(' ')))
  t.mock.method(console, 'log', () => {})
  delete require.cache[AUDIT]
  return { audit: require(AUDIT), errors, dropped: () => errors.filter(e => e.startsWith('[discord-audit] dropped')) }
}

// Refuses an empty post, one over 2000 characters or one holding REFUSED; `answer` overrides every reply while set
function fakeDiscord(t) {
  const d = { sent: [], delivered: [], answer: null }
  t.mock.method(https, 'request', (opts, onRes) => {
    const req = new EventEmitter()
    req.end = data => {
      const { content } = JSON.parse(data)
      d.sent.push(content)
      const refused = !content || content.length > 2000 || content.includes('REFUSED')
      const [status, body] = d.answer || (refused ? [400, { message: 'Invalid Form Body', code: 50035 }] : [200, { id: '1' }])
      if (status < 300) d.delivered.push(...content.split('\n'))
      const res = new EventEmitter()
      res.statusCode = status
      onRes(res)
      process.nextTick(() => { if (body) res.emit('data', JSON.stringify(body)); res.emit('end') })
    }
    return req
  })
  return d
}

// n ticks of the 1.5 s timer, each run until its flush ends
async function run(t, n) {
  for (let i = 0; i < n; i++) {
    t.mock.timers.tick(1500)
    for (let j = 0; j < 5; j++) await new Promise(resolve => setImmediate(resolve))
  }
}
const STAMP = '[1970-01-01 00:00:00] '
const texts = lines => lines.map(l => l.replace(/^\[[\d-]+ [\d:]+\] /, ''))

test('a batch Discord refuses for good goes one line per post, and only the line it refuses alone is dropped', async t => {
  const { audit, dropped } = load(t)
  const discord = fakeDiscord(t)
  audit.log('TICKET opened #pk-0001')
  audit.log('REPORT problem REFUSED')
  audit.log('PERM staffer gained role(s): Lead GM')
  await run(t, 1)
  assert.deepEqual(discord.sent.map(c => c.split('\n').length), [3], 'the three lines go as one batch first')
  await run(t, 6)
  audit.log('NAME staffer nickname "a" -> "b"')
  await run(t, 2)
  assert.deepEqual(texts(discord.delivered), ['TICKET opened #pk-0001', 'PERM staffer gained role(s): Lead GM', 'NAME staffer nickname "a" -> "b"'])
  assert.equal(dropped().length, 1, dropped().join('\n'))
  assert.match(dropped()[0], /REPORT problem REFUSED.*\(400\)/)
  const posts = discord.sent.length
  await run(t, 10)
  assert.equal(discord.sent.length, posts, 'nothing is left to send again')
})

test('a rate limit while the lines go one at a time keeps them and their order', async t => {
  const { audit, dropped } = load(t)
  const discord = fakeDiscord(t)
  audit.log('L1')
  audit.log('L2 REFUSED')
  audit.log('L3')
  await run(t, 1)
  discord.answer = [429, { retry_after: 3 }]
  await run(t, 1)
  discord.answer = null
  await run(t, 8)
  assert.deepEqual(texts(discord.delivered), ['L1', 'L3'])
  assert.ok(discord.sent.slice(1).every(c => !c.includes('\n')), 'one line per post after the refusal')
  assert.equal(dropped().length, 1)
})

test('a line too long for one post is cut to fit and marked, and the lines after it still go', async t => {
  const { audit } = load(t)
  const discord = fakeDiscord(t)
  audit.log('A'.repeat(1898 - STAMP.length)) // the longest line that fits a post, unchanged
  audit.log('B'.repeat(1899 - STAMP.length)) // the shortest line that never fit a batch before
  audit.log('C'.repeat(50000))
  audit.log('😀'.repeat(5000)) // one of these two is cut through the middle of an emoji
  audit.log(`x${'😀'.repeat(5000)}`)
  audit.log('TICKET after the long lines')
  await run(t, 8)
  assert.ok(discord.sent.every(c => c.length > 0 && c.length <= 2000 && c.isWellFormed()), 'no empty, oversized or broken post')
  const got = discord.delivered
  assert.equal(got.length, 6, texts(got).map(l => l.slice(0, 40)).join('\n'))
  assert.equal(got[0], `${STAMP}${'A'.repeat(1898 - STAMP.length)}`)
  for (const l of got.slice(1, 5)) {
    assert.ok(l.length <= 1898, `${l.length} characters`)
    assert.match(l, / \.\.\. \(cut, the whole line is in the backend log\)$/)
  }
  assert.equal(texts(got)[5], 'TICKET after the long lines')
})

test('a /console line cut through an emoji is posted as well-formed text', async t => {
  const { audit } = load(t)
  const discord = fakeDiscord(t)
  const said = rules.foldText(`${'a'.repeat(159)}😀 and more`, 160)
  assert.equal(said.isWellFormed(), false, 'the fold leaves half an emoji (the input this test is about)')
  audit.log(`CONSOLE req 7a1c2a3b -> ran as Jake #ABCD (Senior): ${said}`)
  audit.log('PERM half a pair at the end 😀'.slice(0, -1))
  await run(t, 1)
  assert.equal(discord.sent.length, 1)
  assert.ok(discord.sent[0].isWellFormed(), JSON.stringify(discord.sent[0]))
  assert.deepEqual(texts(discord.delivered), [`CONSOLE req 7a1c2a3b -> ran as Jake #ABCD (Senior): ${'a'.repeat(159)}�...`, 'PERM half a pair at the end �'])
})

test('ordinary lines still go in batches under 1900 characters', async t => {
  const { audit } = load(t)
  const discord = fakeDiscord(t)
  for (let i = 0; i < 100; i++) audit.log(`TICKET ${String(i).padStart(3, '0')} ${'x'.repeat(40)}`)
  await run(t, 5)
  assert.equal(discord.delivered.length, 100)
  assert.deepEqual(discord.sent.map(c => c.split('\n').length), [25, 25, 25, 25], 'as many 73-character lines as fit under 1900')
  assert.ok(discord.sent.every(c => c.length < 1900), discord.sent.map(c => c.length).join(' '))
})

// Config errors (token, bot permission, channel id), rate limits and server errors wait as before
for (const [status, body, wait] of [
  [401, { message: '401: Unauthorized', code: 0 }, 5000],
  [403, { message: 'Missing Permissions', code: 50013 }, 5000],
  [404, { message: 'Unknown Channel', code: 10003 }, 5000],
  [429, { message: 'You are being rate limited.', retry_after: 12.5, global: false }, 12500],
  [500, null, 5000],
  [502, null, 5000],
  [400, '<html>400 Bad Request</html>', 5000],
  [400, null, 5000],
  [408, null, 5000],
]) {
  test(`a ${status}${status === 400 ? (body ? ' with a page, not Discord JSON,' : ' with no body') : ''} keeps the batch whole and waits ${wait / 1000} s before sending it again`, async t => {
    const { audit, dropped } = load(t)
    const discord = fakeDiscord(t)
    discord.answer = [status, body]
    audit.log('TICKET one')
    audit.log('TICKET two')
    await run(t, 1)
    await run(t, Math.ceil(wait / 1500) - 1)
    assert.equal(discord.sent.length, 1, 'no post while it waits')
    await run(t, 1)
    assert.equal(discord.sent.length, 2, 'sent again once the wait is over')
    discord.answer = null
    await run(t, Math.ceil(wait / 1500) + 1)
    assert.deepEqual(texts(discord.delivered), ['TICKET one', 'TICKET two'])
    assert.ok(discord.sent.every(c => c.split('\n').length === 2), 'every try is the whole batch')
    assert.equal(dropped().length, 0)
  })
}

test('#staff-commands lines go to their own channel in their own batches; without the channel they stay in the backend log', async t => {
  const { audit } = load(t)
  const config = require('../config')
  const paths = []
  t.mock.method(https, 'request', (opts, onRes) => {
    const req = new EventEmitter()
    req.end = data => {
      paths.push([opts.path, JSON.parse(data).content, JSON.parse(data).allowed_mentions])
      const res = new EventEmitter()
      res.statusCode = 200
      onRes(res)
      process.nextTick(() => { res.emit('data', '{"id":"1"}'); res.emit('end') })
    }
    return req
  })
  const warn = t.mock.method(console, 'warn', () => {})
  audit.staff('[12:00:00] jake <@1554000000000000001> (Owner): game ban (permanent) on Bob #BOB1 (profile 10): Griefing [dashboard 7a1c2a3b]')
  assert.equal(warn.mock.callCount(), 1, 'one warning, no channel set')
  audit.staff('[12:00:01] second line')
  assert.equal(warn.mock.callCount(), 1, 'only once')
  await run(t, 2)
  assert.deepEqual(paths, [])
  config.staffCommandsChannelId = '1554000000000000888'
  try {
    audit.staff('[12:00:02] jake <@1554000000000000001> (Owner): Discord ban on Bob #BOB1 (profile 10): Threats [dashboard 7a1c2a3b]')
    audit.log('PUNISH req 7a1c2a3b -> done')
    await run(t, 2)
    assert.deepEqual(paths.map(p => p[0]).sort(), ['/api/v10/channels/1554000000000000777/messages', '/api/v10/channels/1554000000000000888/messages'])
    const staff = paths.find(p => p[0].includes('888'))
    assert.equal(staff[1], '[12:00:02] jake <@1554000000000000001> (Owner): Discord ban on Bob #BOB1 (profile 10): Threats [dashboard 7a1c2a3b]', 'the line as given, no second stamp')
    assert.deepEqual(staff[2], { parse: [] }, 'no one is pinged')
  } finally { delete config.staffCommandsChannelId }
})
