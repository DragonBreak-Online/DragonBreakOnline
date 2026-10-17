'use strict'
// installManifest: the R2 copy when the backend redirects to a listed hash, the backend's own copy on anything else.
const test = require('node:test')
const assert = require('node:assert')
const crypto = require('crypto')
const http = require('http')
const { createInstallManifest, R2_MANIFEST } = require('../src/installManifest')

const MANIFEST = { schema: 2, archives: [{ name: 'a.7z' }] }
const BODY = Buffer.from(JSON.stringify(MANIFEST))
const SHA = crypto.createHash('sha256').update(BODY).digest('hex')

function serve(handler) {
  return new Promise(resolve => {
    const srv = http.createServer(handler)
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }))
  })
}
const r2Url = base => new RegExp(`^${base.replace(/[.]/g, '\\.')}/install-manifest/([0-9a-f]{64})\\.json$`)

async function setup(backend, r2) {
  const R2 = await serve(r2)
  const API = await serve((req, res) => backend(req, res, R2.base))
  const calls = []
  const fetchJSON = async url => { calls.push(url); return { from: 'backend' } }
  const im = createInstallManifest({ apiUrl: API.base, fetchJSON, r2Url: r2Url(R2.base) })
  return { im, calls, close: () => { R2.srv.close(); API.srv.close() } }
}

test('the real pattern takes only https files.dragonbreakonline.com with a 64-hex name', () => {
  assert.ok(R2_MANIFEST.test(`https://files.dragonbreakonline.com/install-manifest/${SHA}.json`))
  assert.ok(!R2_MANIFEST.test(`http://files.dragonbreakonline.com/install-manifest/${SHA}.json`))
  assert.ok(!R2_MANIFEST.test(`https://evil.example/install-manifest/${SHA}.json`))
  assert.ok(!R2_MANIFEST.test(`https://files.dragonbreakonline.com/install-manifest/${SHA}.json?x`))
})

test('a 302 to a listed hash: the R2 body, sha256 checked, the header sent only to the backend', async () => {
  const seen = []
  const s = await setup((req, res, r2) => {
    seen.push(['api', req.headers['x-dbo-accept-redirect']])
    res.writeHead(302, { Location: `${r2}/install-manifest/${SHA}.json` }).end()
  }, (req, res) => { seen.push(['r2', req.headers['x-dbo-accept-redirect']]); res.end(BODY) })
  assert.deepStrictEqual(await s.im.get(), MANIFEST)
  assert.deepStrictEqual(seen, [['api', '1'], ['r2', undefined]])
  assert.deepStrictEqual(s.calls, [])
  s.close()
})

test('an R2 body that does not match its name, a 404 on R2 or a foreign redirect: the backend copy', async () => {
  for (const r2 of [(_q, res) => res.end(Buffer.from('{"tampered":1}')), (_q, res) => res.writeHead(404).end()]) {
    const s = await setup((_q, res, base) => res.writeHead(302, { Location: `${base}/install-manifest/${SHA}.json` }).end(), r2)
    assert.deepStrictEqual(await s.im.get(), { from: 'backend' })
    s.close()
  }
  const s = await setup((_q, res) => res.writeHead(302, { Location: `https://elsewhere.example/install-manifest/${SHA}.json` }).end(), (_q, res) => res.end(BODY))
  assert.deepStrictEqual(await s.im.get(), { from: 'backend' })
  s.close()
})

test('a backend without the redirect (200): its body, one request; an error status: fetchJSON gives the usual error', async () => {
  let n = 0
  const s = await setup((_q, res) => { n++; res.end(BODY) }, (_q, res) => res.end())
  assert.deepStrictEqual(await s.im.get(), MANIFEST)
  assert.equal(n, 1)
  assert.deepStrictEqual(s.calls, [])
  s.close()
  const e = await setup((_q, res) => res.writeHead(404).end('{"error":"not built"}'), (_q, res) => res.end())
  assert.deepStrictEqual(await e.im.get(), { from: 'backend' })
  assert.equal(e.calls.length, 1)
  e.close()
})

test('reuse: an nxm link within 10 minutes takes the last manifest; Play always fetches', async () => {
  let n = 0
  const s = await setup((_q, res) => { n++; res.end(BODY) }, (_q, res) => res.end())
  await s.im.get()
  await s.im.get({ reuse: true })
  assert.equal(n, 1)
  await s.im.get()
  assert.equal(n, 2)
  s.close()
})
