'use strict'
// download.js log lines (claude-jake, 11 Oct): a resume names its byte offset, a 503 its Retry-After and the wait, a
// redirect only the host that finally answered. No line may carry a path, a query string or a signature.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { download, hostOf, errorText } = require('../src/download')

const BODY = Buffer.from('y'.repeat(40_000) + 'END')
function serve(handler) {
  return new Promise(resolve => {
    const srv = http.createServer(handler)
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}`, host: `127.0.0.1:${srv.address().port}` }))
  })
}
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-dllog-')), 'client.zip')
const SECRET = 'X-Amz-Signature=deadbeefcafe&token=s3cr3t'
const clean = (lines) => lines.forEach(l => {
  assert.ok(!/X-Amz|s3cr3t|deadbeef|token=|\?|\/r2\//.test(l), `leaks: ${l}`)
  assert.ok(!l.includes(os.tmpdir()), `names a local path: ${l}`)
})

test('a resume logs the byte offset it picks up from', async () => {
  const { srv, base } = await serve((req, res) => {
    const m = /bytes=(\d+)-/.exec(req.headers.range || '')
    if (!m) { res.writeHead(200, { 'Content-Length': BODY.length }); res.write(BODY.subarray(0, 15_000)); return setTimeout(() => res.destroy(), 20) }
    const from = Number(m[1])
    res.writeHead(206, { 'Content-Length': BODY.length - from }); res.end(BODY.subarray(from))
  })
  const lines = []
  const dest = tmp()
  await download(`${base}/zip?${SECRET}`, dest, { wait: async () => {}, onLog: l => lines.push(l) })
  srv.close()
  assert.ok(fs.readFileSync(dest).equals(BODY))
  const resume = lines.find(l => /resuming at byte \d+/.test(l))
  assert.ok(resume, lines.join('\n'))
  assert.ok(Number(/byte (\d+)/.exec(resume)[1]) > 0)
  assert.ok(resume.startsWith('client.zip: '), resume)
  assert.ok(lines.some(l => /retry 1 of 6/.test(l)), lines.join('\n'))
  clean(lines)
})

test('a resume the server ignores says so and starts from 0', async () => {
  let calls = 0
  const { srv, base } = await serve((req, res) => {
    res.writeHead(200, { 'Content-Length': BODY.length })
    if (++calls === 1) { res.write(BODY.subarray(0, 10_000)); return setTimeout(() => res.destroy(), 20) }
    res.end(BODY)
  })
  const lines = []
  const dest = tmp()
  await download(`${base}/zip`, dest, { wait: async () => {}, onLog: l => lines.push(l) })
  srv.close()
  assert.ok(fs.readFileSync(dest).equals(BODY))
  assert.ok(lines.some(l => /ignored the resume at byte \d+ \(HTTP 200\); starting again from 0/.test(l)), lines.join('\n'))
})

test('a 503 logs Retry-After, the wait and the total, naming only the host', async () => {
  let calls = 0
  const { srv, base, host } = await serve((req, res) => {
    if (++calls < 3) { res.writeHead(503, { 'Retry-After': calls === 1 ? '45' : '90' }); return res.end() }
    res.writeHead(200, { 'Content-Length': BODY.length }); res.end(BODY)
  })
  const lines = []
  await download(`${base}/api/files/zip?${SECRET}`, tmp(), { wait: async () => {}, onLog: l => lines.push(l) })
  srv.close()
  const q = lines.filter(l => /HTTP 503/.test(l))
  assert.deepStrictEqual(q, [
    `client.zip: queued by ${host} (HTTP 503, Retry-After 45); waiting 45 s, 45 s in all`,
    `client.zip: queued by ${host} (HTTP 503, Retry-After 90); waiting 60 s, 105 s in all`,
  ])
  clean(lines)
})

test('a 503 without Retry-After says it was absent', async () => {
  let calls = 0
  const { srv, base } = await serve((req, res) => {
    if (++calls < 2) { res.writeHead(503); return res.end() }
    res.writeHead(200, { 'Content-Length': BODY.length }); res.end(BODY)
  })
  const lines = []
  await download(`${base}/zip`, tmp(), { wait: async () => {}, onLog: l => lines.push(l) })
  srv.close()
  assert.ok(lines.some(l => /Retry-After absent\); waiting 30 s/.test(l)), lines.join('\n'))
})

test('a redirect chain logs one line with the final host, never the signed url', async () => {
  const cdn = await serve((req, res) => { res.writeHead(200, { 'Content-Length': BODY.length }); res.end(BODY) })
  const api = await serve((req, res) => {
    if (req.url.startsWith('/zip')) { res.writeHead(302, { Location: '/hop' }); return res.end() }
    res.writeHead(302, { Location: `${cdn.base}/r2/client.zip?${SECRET}` }); res.end()
  })
  const lines = []
  const dest = tmp()
  await download(`${api.base}/zip`, dest, { wait: async () => {}, onLog: l => lines.push(l) })
  api.srv.close(); cdn.srv.close()
  assert.ok(fs.readFileSync(dest).equals(BODY))
  assert.deepStrictEqual(lines, [`client.zip: redirected (2x), served by ${cdn.host}`])
  clean(lines)
})

test('a plain download logs nothing, and a throwing logger never fails a download', async () => {
  const { srv, base } = await serve((req, res) => { res.writeHead(200, { 'Content-Length': BODY.length }); res.end(BODY) })
  const lines = []
  await download(`${base}/zip`, tmp(), { onLog: l => lines.push(l) })
  assert.deepStrictEqual(lines, [])
  let calls = 0
  const { srv: s2, base: b2 } = await serve((req, res) => {
    if (++calls < 2) { res.writeHead(503, { 'Retry-After': '1' }); return res.end() }
    res.writeHead(200, { 'Content-Length': BODY.length }); res.end(BODY)
  })
  const dest = tmp()
  await download(`${b2}/zip`, dest, { wait: async () => {}, onLog: () => { throw new Error('disk full') } })
  srv.close(); s2.close()
  assert.ok(fs.readFileSync(dest).equals(BODY))
})

test('a refused url fails at once and its log line names only the host', async () => {
  const lines = []
  let refusals = 0
  const validate = (u) => { refusals++; throw new Error(`Refusing to download over an insecure (non-HTTPS) URL: ${u}`) }
  await assert.rejects(download(`http://files.example.net/r2/x.zip?${SECRET}`, tmp(), { validate, wait: async () => {}, onLog: l => lines.push(l) }), /Refusing/)
  assert.strictEqual(refusals, 1)
  assert.deepStrictEqual(lines, ['client.zip: refused a url on files.example.net'])
})

test('hostOf and errorText keep only hosts', () => {
  assert.strictEqual(hostOf(`https://user:pw@abc.r2.cloudflarestorage.com/bucket/f.zip?${SECRET}`), 'abc.r2.cloudflarestorage.com')
  assert.strictEqual(hostOf('not a url'), 'unknown host')
  assert.strictEqual(errorText(new Error(`Refusing: http://cdn.example.org/a/b?${SECRET} now`)), 'Refusing: <cdn.example.org> now')
  assert.strictEqual(errorText(Object.assign(new Error('x'), { code: 'ECONNRESET' })), 'ECONNRESET')
  assert.strictEqual(errorText({ statusCode: 502 }), 'HTTP 502')
})
