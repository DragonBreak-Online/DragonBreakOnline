'use strict'
// Launcher 2.1.52, the main process side of polling less: the polled GETs ask with the last ETag and an unchanged answer
// comes back as a 304 with no body (2.1.51 downloaded about 314 KB every 10 s), the player count is asked only while the
// server is online, a check that fails leaves the Play button as it was, and the in-game /bug poll runs every minute.
const test = require('node:test')
const assert = require('node:assert')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const path = require('path')

const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
function slice(fromMark, toMark) {
  const from = main.indexOf(fromMark)
  const to = main.indexOf(toMark, from + 1)
  assert.ok(from > 0 && to > from, `the main.js section "${fromMark.slice(0, 40)}" is where the test expects it`)
  return main.slice(from, to)
}
// eslint-disable-next-line no-new-func
const fetchJSON = new Function('http', 'https', `${slice('function fetchJSON(url', '// POST JSON and parse the JSON reply')}\nreturn fetchJSON`)(http, require('https'))

// A backend that answers like Express: a weak ETag of the body, and 304 when If-None-Match matches it
async function backend(docs, { etags = true } = {}) {
  const seen = []; let bodyBytes = 0
  const server = http.createServer((req, res) => {
    const body = JSON.stringify(docs[req.url])
    const etag = `W/"${crypto.createHash('sha1').update(body).digest('base64')}"`
    seen.push({ url: req.url, ifNoneMatch: req.headers['if-none-match'] || '' })
    if (etags && req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end() }
    res.writeHead(200, { 'Content-Type': 'application/json', ...(etags ? { ETag: etag } : {}) })
    bodyBytes += Buffer.byteLength(body)
    res.end(body)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${server.address().port}`, seen, bytes: () => bodyBytes, close: () => new Promise(r => server.close(r)) }
}

test('an unchanged answer comes back as a 304 with no body and the last one is reused; a change comes through', async () => {
  const { createPollCache } = require('../src/pollCache')
  const docs = { '/api/files/extra': { version: 'x1', files: Array.from({ length: 50 }, (_, i) => ({ path: `Data/f${i}.esp`, size: i })) } }
  const b = await backend(docs)
  try {
    const polled = createPollCache(fetchJSON)
    const first = await polled(`${b.url}/api/files/extra`)
    const sent = b.bytes()
    assert.strictEqual(first.version, 'x1')
    const second = await polled(`${b.url}/api/files/extra`)
    assert.deepStrictEqual(second, first)
    assert.strictEqual(b.bytes(), sent, 'no body the second time')
    assert.match(b.seen[1].ifNoneMatch, /^W\/"/, 'asked with the ETag')
    docs['/api/files/extra'] = { version: 'x2', files: [] }
    assert.strictEqual((await polled(`${b.url}/api/files/extra`)).version, 'x2')
    assert.strictEqual((await polled(`${b.url}/api/files/extra`)).version, 'x2')
    assert.strictEqual(b.seen.length, 4)
    assert.strictEqual(await fetchJSON(`${b.url}/api/files/extra`).then(d => d.version), 'x2', 'a plain fetchJSON is unchanged')
  } finally { await b.close() }
})

test('without ETags every check is a plain request, so nothing breaks if a proxy drops them', async () => {
  const { createPollCache } = require('../src/pollCache')
  const b = await backend({ '/api/version': { version: '2.1.52' } }, { etags: false })
  try {
    const polled = createPollCache(fetchJSON)
    assert.strictEqual((await polled(`${b.url}/api/version`)).version, '2.1.52')
    assert.strictEqual((await polled(`${b.url}/api/version`)).version, '2.1.52')
    assert.deepStrictEqual(b.seen.map(s => s.ifNoneMatch), ['', ''])
  } finally { await b.close() }
})

function handlers(code, stubs) {
  const h = {}
  const ipcMain = { handle: (ch, fn) => { h[ch] = fn } }
  const names = Object.keys(stubs)
  // eslint-disable-next-line no-new-func
  new Function('ipcMain', ...names, code)(ipcMain, ...names.map(n => stubs[n]))
  return h
}

test('the player count is asked for only while the game server is online', async () => {
  const asked = []
  let status = { status: 'offline', service: 'inactive', port_bound: false }
  const h = handlers(slice("ipcMain.handle('api:status'", '\n// Server info'), {
    fetchJSON: async (url) => { asked.push(url.replace('https://api.test', '')); return url.endsWith('/api/status') ? status : [{ online: 7 }] },
    config: { apiUrl: 'https://api.test' },
    store: { get: () => 0 },
  })
  assert.deepStrictEqual(await h['api:status'](), { ok: true, ...status })
  assert.deepStrictEqual(asked, ['/api/status'], 'offline: no /api/servers')
  status = { status: 'online', service: 'active', port_bound: true }
  assert.strictEqual((await h['api:status']()).players, 7)
  assert.deepStrictEqual(asked, ['/api/status', '/api/status', '/api/servers'])
})

test('the Play state check asks with ETags, and an unreadable file list leaves the button as it was', async () => {
  const asked = []
  let extra = async () => ({ version: 'e1', current: true })
  const polledJSON = async (url) => {
    asked.push(url.replace('https://api.test', ''))
    return url.endsWith('/api/files/extra') ? extra() : { version: '0.3.106' }
  }
  const code = slice("ipcMain.handle('files:updateCheck'", '\n// MO2 can take a while to boot Skyrim') +
    slice('async function fetchExtraManifest(', '\n// Entries with a sha256')
  const h = handlers(code, {
    polledJSON,
    fetchJSON: async () => { throw new Error('the polled check must not use a plain fetch') },
    config: { apiUrl: 'https://api.test' },
    store: { get: k => ({ filesVersion: '0.3.106', mo2Enabled: true, modpackState: 'done' })[k] },
    effectiveGamePath: () => 'C:\\DragonBreak\\skyrim',
    clientFilesPresent: () => true,
    extrasUpToDate: vd => (vd ? vd.current : true),
  })
  assert.deepStrictEqual(await h['files:updateCheck'](), { ok: true, updateAvailable: false, serverVersion: '0.3.106' })
  assert.deepStrictEqual(asked, ['/api/files/version', '/api/files/extra'])
  extra = async () => { throw Object.assign(new Error('HTTP 502'), { statusCode: 502 }) }
  assert.strictEqual((await h['files:updateCheck']()).ok, false, 'a 502 on the file list is not an answer')
  extra = async () => { throw Object.assign(new Error('HTTP 404'), { statusCode: 404 }) }
  assert.strictEqual((await h['files:updateCheck']()).ok, true, 'a backend without the file list still answers')
})

test('the launcher version check asks with the ETag, and a failure says latest: null', async () => {
  const asked = []
  let answer = async () => ({ version: '2.1.53', downloadUrl: 'https://files.test/launcher/2.1.53/DragonBreakLauncher.exe' })
  const code = slice('const logUpdateCheck = selfUpdate.createCheckLogger(log)', '\n// Reject remote plain-HTTP downloads')
  const h = handlers(code, {
    selfUpdate: { createCheckLogger: () => () => {} },
    log: () => {},
    app: { getVersion: () => '2.1.52' },
    polledJSON: async (url) => { asked.push(url); return answer() },
    fetchJSON: async () => { throw new Error('the polled check must not use a plain fetch') },
    compareVersions: (a, b) => (a === b ? 0 : a > b ? 1 : -1),
    config: { apiUrl: 'https://api.test' },
  })
  assert.strictEqual((await h['app:checkUpdate']()).hasUpdate, true)
  assert.deepStrictEqual(asked, ['https://api.test/api/version'])
  answer = async () => { throw new Error('ECONNRESET') }
  assert.deepStrictEqual(await h['app:checkUpdate'](), { current: '2.1.52', latest: null, hasUpdate: false, downloadUrl: '' })
})

test('the in-game /bug poll asks every minute while the game runs, and once more at exit', () => {
  assert.strictEqual(require('../src/bugLogs').POLL_MS, 60_000)
  const watch = slice('function watchGameExit() {', '// After a crash, offer the report there and then.')
  assert.match(watch, /setInterval\(\(\) => \{ bugLogPoller\.poll\(\) \}, bugLogs\.POLL_MS\)/)
  assert.match(watch, /clearInterval\(bugTimer\)\n\s*bugLogPoller\.poll\(\)/)
})
