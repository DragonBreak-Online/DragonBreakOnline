'use strict'
// The /dragonbaron register script (scripts/dragonbaron-command.js): the ask shape, and nothing is sent without --yes

const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const script = require('../scripts/dragonbaron-command')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dbai-reg-'))
after(() => fs.rmSync(TMP, { recursive: true, force: true }))
const snow = n => (10n ** 18n + BigInt(n)).toString()
const APP = snow(2), GUILD = snow(1)
const CONFIG = { discordBotToken: 'test-token', discordGuildId: GUILD, discordClientId: APP }
const BASE = `/applications/${APP}/guilds/${GUILD}/commands`

// What Discord holds before ask: /dragonbaron with admin and config, and /admin, with Discord's own fields added
const registered = () => [
  { id: snow(501), application_id: APP, version: snow(601), guild_id: GUILD, nsfw: false, ...JSON.parse(JSON.stringify(script.COMMANDS[0])), options: script.COMMANDS[0].options.filter(o => o.name !== 'ask') },
  { id: snow(502), application_id: APP, version: snow(602), guild_id: GUILD, nsfw: false, ...JSON.parse(JSON.stringify(script.COMMANDS[1])) },
  { id: snow(503), name: 'console', type: 1, description: 'Run an in-game staff command (admins)' },
]

function fakeSend({ list = registered(), changeId = false } = {}) {
  const calls = []
  let state = list
  const send = async req => {
    calls.push({ method: req.method, path: req.path, body: req.body })
    if (req.method === 'GET') return state
    if (req.method === 'POST') {
      const old = state.find(c => c.name === req.body.name)
      const id = old && !changeId ? old.id : snow(999)
      state = [...state.filter(c => c.name !== req.body.name), { ...req.body, id }]
      return { ...req.body, id }
    }
    throw new Error(`unexpected ${req.method}`)
  }
  return { send, calls }
}

test('the ask subcommand has the SPEC shape and every description fits in 100 characters', () => {
  const db = script.COMMANDS.find(c => c.name === 'dragonbaron')
  const ask = db.options.find(o => o.name === 'ask')
  assert.deepEqual(ask, {
    type: 1, name: 'ask', description: 'Ask Dragonbaron about the server (staff only, private answer, runs nothing)',
    options: [{ type: 3, name: 'question', description: 'Your question about the server, rules, reports or staff work', required: true, min_length: 3, max_length: 500 }],
  })
  const all = []
  const walk = o => { all.push(o.description); (o.options || []).forEach(walk) }
  script.COMMANDS.forEach(walk)
  assert.ok(all.every(d => typeof d === 'string' && d.length >= 1 && d.length <= 100), all.join(' | '))
  assert.deepEqual(db.options.map(o => o.name), ['admin', 'config', 'ask'])
  assert.equal(db.default_member_permissions, '0')
  assert.deepEqual(db.contexts, [0])
  assert.deepEqual(db.integration_types, [0])
})

test('show and register without --yes only GET', async () => {
  for (const argv of [['show'], ['register'], ['show', '--save', path.join(TMP, 'saved.json')]]) {
    const f = fakeSend()
    const out = []
    assert.equal(await script.main(argv, { config: CONFIG, send: f.send, out: l => out.push(l) }), 0)
    assert.ok(f.calls.every(c => c.method === 'GET'), argv.join(' '))
    assert.match(out[0], new RegExp(`/dragonbaron command id now: ${snow(501)}`))
  }
  const saved = JSON.parse(fs.readFileSync(path.join(TMP, 'saved.json'), 'utf8'))
  assert.deepEqual(saved.map(c => c.name), ['dragonbaron', 'admin'])
  assert.equal(fs.statSync(path.join(TMP, 'saved.json')).mode & 0o777, 0o600)
  const f = fakeSend()
  const out = []
  await script.main(['register'], { config: CONFIG, send: f.send, out: l => out.push(l) })
  assert.ok(out.some(l => /^would send POST .*"name":"dragonbaron"/.test(l)))
  assert.equal(out.filter(l => /^would send /.test(l)).length, 1, '/admin has not changed, so it is not in the plan')
})

test('register --yes POSTs only the changed command and checks its id before and after', async () => {
  const f = fakeSend()
  const out = []
  assert.equal(await script.main(['register', '--yes'], { config: CONFIG, send: f.send, out: l => out.push(l) }), 0)
  const posts = f.calls.filter(c => c.method === 'POST')
  assert.equal(posts.length, 1)
  assert.equal(posts[0].path, BASE)
  assert.equal(posts[0].body.name, 'dragonbaron')
  assert.ok(f.calls.every(c => ['GET', 'POST'].includes(c.method)))
  assert.ok(out.some(l => l === `/dragonbaron command id after: ${snow(501)}`))
  const again = fakeSend({ list: [{ ...script.COMMANDS[0], id: snow(501) }, { ...script.COMMANDS[1], id: snow(502) }] })
  const out2 = []
  await script.main(['register', '--yes'], { config: CONFIG, send: again.send, out: l => out2.push(l) })
  assert.equal(again.calls.filter(c => c.method === 'POST').length, 0)
  assert.ok(out2.includes('every command matches the registered copy; nothing to send'))
})

test('a changed command id is a loud warning and exit 3', async () => {
  const f = fakeSend({ changeId: true })
  const out = []
  assert.equal(await script.main(['register', '--yes'], { config: CONFIG, send: f.send, out: l => out.push(l) }), 3)
  assert.ok(out.some(l => /^WARNING: the \/dragonbaron command id CHANGED/.test(l)))
})

test('register --from <saved> --yes re-POSTs the saved copy for a rollback; without --yes it only shows the plan', async () => {
  const file = path.join(TMP, 'before.json')
  fs.writeFileSync(file, JSON.stringify(registered()))
  const now = fakeSend({ list: [{ ...script.COMMANDS[0], id: snow(501) }, { ...script.COMMANDS[1], id: snow(502) }] })
  const dry = []
  await script.main(['register', '--from', file], { config: CONFIG, send: now.send, out: l => dry.push(l) })
  assert.equal(now.calls.filter(c => c.method === 'POST').length, 0)
  await script.main(['register', '--from', file, '--yes'], { config: CONFIG, send: now.send, out: () => {} })
  const posts = now.calls.filter(c => c.method === 'POST')
  assert.equal(posts.length, 1)
  assert.deepEqual(posts[0].body.options.map(o => o.name), ['admin', 'config'])
  for (const k of ['id', 'application_id', 'version', 'guild_id', 'nsfw']) assert.ok(!(k in posts[0].body), k)
  assert.equal(posts[0].body.default_member_permissions, '0')
})

test('bad arguments and a missing token send nothing', async () => {
  const f = fakeSend()
  assert.equal(await script.main(['remove', '--yes'], { config: CONFIG, send: f.send, out: () => {} }), 2)
  assert.equal(await script.main(['register', '--from'], { config: CONFIG, send: f.send, out: () => {} }), 2)
  assert.equal(await script.main(['show'], { config: { ...CONFIG, discordBotToken: '' }, send: f.send, out: () => {} }), 2)
  assert.equal(f.calls.length, 0)
  assert.deepEqual(script.plan('show', { app: APP, guild: GUILD }), [{ method: 'GET', path: BASE }])
})
