'use strict'
// website/dashboard.html's Console panel against a small fake DOM: shown only when on, text only, the fixed sign-in link, no storage

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { webcrypto } = require('crypto')

const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'website', 'dashboard.html'), 'utf8')
const SCRIPT = [...PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])[0]

class FakeEl {
  constructor(tag) { Object.assign(this, { tag, kids: [], own: '', className: '', hidden: false, value: '', disabled: false, href: '', listeners: {} }) }
  set textContent(v) { this.kids = []; this.own = String(v) }
  get textContent() { return this.own + this.kids.map(k => k.textContent).join('') }
  set innerHTML(_v) { throw new Error('innerHTML is not allowed') }
  append(...nodes) { for (const n of nodes) this.kids.push(typeof n === 'string' ? Object.assign(new FakeEl('#text'), { own: n }) : n) }
  addEventListener(type, fn) { this.listeners[type] = fn }
  setAttribute() {}
  showModal() {} close() {} focus() {}
}

function load(fetchImpl) {
  const byId = new Map()
  const $ = id => { if (!byId.has(id)) byId.set(id, new FakeEl('div')); return byId.get(id) }
  const document = { getElementById: $, createElement: tag => new FakeEl(tag), createElementNS: (_ns, tag) => new FakeEl(tag) }
  const ctx = vm.createContext({ document, fetch: fetchImpl || (() => new Promise(() => {})), crypto: webcrypto, setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, console, location: { hash: '' } })
  vm.runInContext(SCRIPT, ctx)
  return { $, run: code => vm.runInContext(code, ctx), ctx }
}
const STATE = { v: 1, setting: 'on', ready: true, fresh: true, signInUrl: 'https://evil.example/', commands: [{ name: 'wwremote', usage: '/wwremote [on|off|clear #TAG]' }], maxLength: 500 }

test('the page never writes HTML and keeps nothing in browser storage', () => {
  for (const banned of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'localStorage', 'sessionStorage', 'eval(', 'new Function']) assert.ok(!PAGE.includes(banned), banned)
})

test('the panel is hidden while the web front end is off, and shows a dry-run banner in dry-run', () => {
  const p = load()
  p.ctx.input = { ...STATE, setting: 'off' }
  p.run('con.state = input; renderConsole()')
  assert.equal(p.$('console').hidden, true)
  p.ctx.input = { ...STATE, setting: 'dry-run' }
  p.run('con.state = input; renderConsole()')
  assert.equal(p.$('console').hidden, false)
  assert.equal(p.$('conDry').hidden, false)
  assert.match(p.$('conHelp').textContent, /\/wwremote \[on\|off\|clear #TAG\]/)
})

test('a stale sign-in swaps the box for the fixed sign-in link, whatever URL the answer names', () => {
  const p = load()
  p.ctx.input = { ...STATE, fresh: false }
  p.run('con.state = input; renderConsole()')
  assert.equal(p.$('conForm').hidden, true)
  assert.equal(p.$('conStale').hidden, false)
  assert.equal(p.$('conSignIn').href, '/api/site/login/fresh')
})

test('a run posts {requestId, command} same-origin with the control header, and shows the answer as text', async () => {
  const sent = []
  const job = { summary: "/wwremote clear #8KWH: ran - Bob #8KWH's werewolf body may be shown again.", as: 'as Jake #ABCD (Senior, offline)', state: 'ran',
    lines: [{ to: 'audit', text: '<img src=x onerror=alert(1)>' }, { to: 'you', text: "Bob #8KWH's werewolf body may be shown again." }] }
  const p = load((url, opts) => { sent.push([url, opts]); return Promise.resolve({ ok: true, status: 200, json: async () => ({ v: 1, job }) }) })
  p.ctx.input = STATE
  p.run('con.state = input; renderConsole()')
  p.$('conInput').value = '/wwremote clear #8KWH'
  p.$('conForm').listeners.submit({ preventDefault() {} })
  await new Promise(done => setImmediate(done))
  await new Promise(done => setImmediate(done))
  const runs = sent.filter(([u]) => u.endsWith('/run'))
  assert.equal(runs.length, 1)
  const [url, opts] = runs[0]
  assert.equal(url, '/api/site/staff/console/run')
  assert.equal(opts.method, 'POST')
  assert.equal(opts.credentials, 'same-origin')
  assert.equal(opts.headers['X-DBO-Control'], '1')
  const body = JSON.parse(opts.body)
  assert.deepEqual(Object.keys(body).sort(), ['command', 'requestId'])
  assert.match(body.requestId, /^[0-9a-f-]{36}$/)
  const out = p.$('conOut').textContent
  assert.match(out, /ran - Bob #8KWH's werewolf body may be shown again\./)
  assert.match(out, /as Jake #ABCD \(Senior, offline\)/)
  assert.ok(out.includes('<img src=x onerror=alert(1)>'), 'player text is shown as text, never parsed')
  assert.equal(p.$('conInput').value, '')
})

test('a lost answer offers Send again with the same request id', async () => {
  const ids = []
  let fail = true
  const p = load((url, opts) => { if (!url.endsWith('/run')) return new Promise(() => {}); ids.push(JSON.parse(opts.body).requestId); if (fail) return Promise.reject(new Error('offline')); return Promise.resolve({ ok: true, status: 200, json: async () => ({ v: 1, job: { summary: '/whoami: ran - x', as: '', state: 'ran', lines: [] } }) }) })
  p.ctx.input = STATE
  p.run('con.state = input; renderConsole()')
  p.$('conInput').value = '/whoami'
  p.$('conForm').listeners.submit({ preventDefault() {} })
  await new Promise(done => setImmediate(done))
  await new Promise(done => setImmediate(done))
  assert.match(p.$('conOut').textContent, /not sent - Cannot reach the server/)
  fail = false
  const entry = p.$('conOut').kids[0]
  const again = entry.kids.find(k => k.tag === 'button')
  again.listeners.click()
  await new Promise(done => setImmediate(done))
  await new Promise(done => setImmediate(done))
  assert.equal(ids.length, 2)
  assert.equal(ids[0], ids[1])
})

test('a refusal is shown with the reason the backend gave', async () => {
  const p = load(url => !url.endsWith('/run') ? new Promise(() => {}) : Promise.resolve({ ok: false, status: 422, json: async () => ({ v: 1, error: 'notRemote', why: 'self', reason: '/tp acts on your own character. Run it in game.' }) }))
  p.ctx.input = STATE
  p.run('con.state = input; renderConsole()')
  p.$('conInput').value = '/tp #8KWH'
  p.$('conForm').listeners.submit({ preventDefault() {} })
  await new Promise(done => setImmediate(done))
  await new Promise(done => setImmediate(done))
  assert.match(p.$('conOut').textContent, /\/tp #8KWH: refused - \/tp acts on your own character/)
})
