'use strict'
// /api/files/rules: the official Server Rules from data/rules, read-only; the staff handbook beside them is never served.
// Also checks the shipped data/rules: a valid manifest, the version line in both texts, and no draft marks left in.

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const http   = require('http')
const os     = require('os')
const path   = require('path')

// Never read a real .env or data folder
require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'server-rules-'))
const DIR = path.join(tmp, 'rules')
process.env.RULES_DIR = DIR

const express = require('express')
const serverRules = require('../sources/serverRules')

const SHIPPED = path.join(__dirname, '..', 'data', 'rules')
const manifest = (version, extra = {}) => JSON.stringify({ version, effective: '2026-10-22', changes: [`Rules ${version}.`],
  files: { rules: 'server-rules.md', staff: 'staff-handbook.md' }, ...extra })
const RULES = '# DragonBreak Online Server Rules\r\n\r\n**Version v1.**\r\n\r\n1.1. Be kind.\r\n'
const STAFF = '# DragonBreak Online Staff Handbook\n\nStaff only.\n'
let server, base

before(async () => {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(path.join(DIR, 'manifest.json'), manifest('v1'))
  fs.writeFileSync(path.join(DIR, 'server-rules.md'), RULES)
  fs.writeFileSync(path.join(DIR, 'staff-handbook.md'), STAFF)
  const app = express()
  app.set('trust proxy', 'loopback')
  app.use('/api/files/rules', require('../routes/server-rules'))
  // What server.js mounts after it: a request the rules route does not answer must never reach this
  app.use('/api/files', (_req, res) => res.status(418).send('fell through'))
  server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise(resolve => server.close(resolve))
  fs.rmSync(tmp, { recursive: true, force: true })
})

const get = p => fetch(base + p)
const reset = () => serverRules.resetCache()

test('GET /api/files/rules answers the version, what changed and the rules text, cacheable', async () => {
  const res = await get('/api/files/rules')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300')
  assert.deepEqual(await res.json(), { version: 'v1', effective: '2026-10-22', changes: ['Rules v1.'], rules: RULES.replace(/\r\n/g, '\n') })
})

test('GET /api/files/rules/server-rules.md answers the same text as markdown', async () => {
  const res = await get('/api/files/rules/server-rules.md')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /^text\/markdown; charset=utf-8/)
  assert.equal(await res.text(), RULES.replace(/\r\n/g, '\n'))
})

test('the staff handbook, the manifest file and anything else under the route are never served', async () => {
  for (const p of ['/api/files/rules/staff-handbook.md', '/api/files/rules/manifest.json', '/api/files/rules/guides/x.md',
    '/api/files/rules/server-rules.md/x', '/api/files/rules/', '/api/files/rules/SERVER-RULES.MD']) {
    const res = await get(p)
    const body = await res.text()
    if (p === '/api/files/rules/') { assert.equal(res.status, 200, p); continue }   // the same as /api/files/rules
    assert.notEqual(res.status, 418, `${p} fell through to the files route`)
    assert.ok(!body.includes('Staff only.'), p)
  }
  const res = await get('/api/files/rules/staff-handbook.md')
  assert.equal(res.status, 404)
  assert.deepEqual(await res.json(), { error: 'notFound' })
})

test('a new text or version on disk is served at once, without a restart', async () => {
  fs.writeFileSync(path.join(DIR, 'server-rules.md'), RULES + '\n1.2. Be fair.\n')
  fs.writeFileSync(path.join(DIR, 'manifest.json'), manifest('v2'))
  const body = await (await get('/api/files/rules')).json()
  assert.equal(body.version, 'v2')
  assert.match(body.rules, /1\.2\. Be fair\./)
})

test('a missing or malformed manifest or text answers 503, never a stack trace or the staff text', async () => {
  const cases = [
    () => fs.writeFileSync(path.join(DIR, 'manifest.json'), '{ not json'),
    () => fs.writeFileSync(path.join(DIR, 'manifest.json'), manifest('bad version!')),
    () => fs.writeFileSync(path.join(DIR, 'manifest.json'), manifest('v3', { effective: '22 Oct' })),
    () => fs.writeFileSync(path.join(DIR, 'manifest.json'), manifest('v3', { changes: [] })),
    () => fs.writeFileSync(path.join(DIR, 'manifest.json'), manifest('v3', { files: { rules: '../legal/terms.md' } })),
    () => fs.writeFileSync(path.join(DIR, 'manifest.json'), manifest('v3', { files: { rules: 'missing.md' } })),
    () => { fs.writeFileSync(path.join(DIR, 'manifest.json'), manifest('v3')); fs.writeFileSync(path.join(DIR, 'server-rules.md'), '  \n') },
  ]
  const silenced = console.error
  console.error = () => {}
  try {
    for (const make of cases) {
      make()
      reset()
      for (const p of ['/api/files/rules', '/api/files/rules/server-rules.md']) {
        const res = await get(p)
        assert.equal(res.status, 503, p)
        assert.equal(res.headers.get('cache-control'), 'no-store')
        assert.deepEqual(await res.json(), { error: 'rulesUnavailable' })
      }
    }
  } finally { console.error = silenced }
  fs.writeFileSync(path.join(DIR, 'manifest.json'), manifest('v1'))
  fs.writeFileSync(path.join(DIR, 'server-rules.md'), RULES)
  reset()
  assert.equal((await get('/api/files/rules')).status, 200)
})

test('an unchanged manifest is not read again on each request', () => {
  reset()
  serverRules.currentRules(DIR)
  const real = fs.readFileSync
  let reads = 0
  fs.readFileSync = function (file, ...rest) { if (String(file).endsWith('manifest.json')) reads++; return real.call(this, file, ...rest) }
  try { for (let k = 0; k < 3; k++) assert.equal(serverRules.currentRules(DIR).version, 'v1') } finally { fs.readFileSync = real }
  assert.equal(reads, 0)
})

test('a manifest caught mid-write answers the last good rules for a moment, then fails as before', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  reset()
  assert.equal(serverRules.currentRules(DIR).version, 'v1')
  try {
    fs.writeFileSync(path.join(DIR, 'manifest.json'), '{ "version": "v2", "effe')
    assert.equal(serverRules.currentRules(DIR).version, 'v1', 'the last good copy while the deploy writes')
    fs.rmSync(path.join(DIR, 'manifest.json'))
    assert.equal(serverRules.currentRules(DIR).version, 'v1', 'and while the file is replaced')
    t.mock.timers.tick(10001)
    assert.throws(() => serverRules.currentRules(DIR), 'a manifest still broken after that is an error, never old rules for good')
  } finally {
    fs.writeFileSync(path.join(DIR, 'manifest.json'), manifest('v1'))
    reset()
  }
  assert.equal(serverRules.currentRules(DIR).version, 'v1')
})

test('a visitor is limited to 120 requests in 10 minutes', async () => {
  let last
  for (let k = 0; k < 125; k++) last = await get('/api/files/rules/server-rules.md')
  assert.equal(last.status, 429)
})

test('the shipped data/rules: a valid manifest whose files exist, read by the backend itself', () => {
  const m = serverRules.validateManifest(JSON.parse(fs.readFileSync(path.join(SHIPPED, 'manifest.json'), 'utf8')))
  const raw = JSON.parse(fs.readFileSync(path.join(SHIPPED, 'manifest.json'), 'utf8'))
  assert.equal(m.effective, m.version.slice(0, 10))
  assert.deepEqual(Object.keys(raw.files).sort(), ['rules', 'staff'])
  for (const f of Object.values(raw.files)) assert.ok(fs.existsSync(path.join(SHIPPED, f)), f)
  const doc = serverRules.currentRules(SHIPPED)
  assert.equal(doc.version, m.version)
  assert.match(doc.rules, /^# DragonBreak Online Server Rules\n/)
})

test('the shipped texts carry the manifest version and no draft marks', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(SHIPPED, 'manifest.json'), 'utf8'))
  for (const f of Object.values(raw.files)) {
    const text = fs.readFileSync(path.join(SHIPPED, f), 'utf8')
    assert.ok(text.includes(`**Version ${raw.version}. In force from `), `${f} names version ${raw.version}`)
    assert.doesNotMatch(text, /\[G[0-9]|Draft notes|DRAFT|\{\{|\}\}/, `${f} has a draft mark or a template field left in`)
    assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, `${f} holds an address`)
    assert.doesNotMatch(text, /(?<!\d)\d{17,20}(?!\d)/, `${f} holds a Discord id`)
  }
  assert.deepEqual(fs.readdirSync(SHIPPED).sort(), ['manifest.json', 'server-rules.md', 'staff-handbook.md'],
    'only the Server Rules, the Staff Handbook and the manifest ship (the guides wait)')
})
