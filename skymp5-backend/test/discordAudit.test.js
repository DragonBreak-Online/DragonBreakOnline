'use strict'
// The Discord audit poster against a fake Discord on mock timers: long lines, well-formed text, batches, waits

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
]) {
  test(`a ${status} keeps the batch whole and waits ${wait / 1000} s before sending it again`, async t => {
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
