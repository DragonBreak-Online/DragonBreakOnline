'use strict'
// download: moving the finished <dest>.part into place is tried again when Windows refuses it for a moment (EPERM,
// EACCES, EBUSY: an antivirus or indexer holding a file it is scanning). 11 Oct, mod-0137: a player's launcher
// update failed with "EPERM: operation not permitted, rename 'C:\Users\...\AppData\Local\Temp\...'" on every try.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { download } = require('../src/download')

const BODY = Buffer.from('y'.repeat(30_000) + 'END')
function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Length': BODY.length }); res.end(BODY) })
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }))
  })
}
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-dlrn-')), 'DragonBreakLauncher-update-2.1.48-1.exe')

// Makes fs.renameSync of a .part refuse with `code` for the first `times` calls (Infinity: always)
function refuseRename(code, times) {
  const real = fs.renameSync
  let calls = 0
  fs.renameSync = (from, to) => {
    if (String(from).endsWith('.part') && calls++ < times) {
      const e = new Error(`${code}: operation not permitted, rename '${from}' -> '${to}'`)
      e.code = code
      throw e
    }
    return real.call(fs, from, to)
  }
  return { restore: () => { fs.renameSync = real }, calls: () => calls }
}

test('a rename refused for a moment (EPERM twice) is tried again and the file lands', async () => {
  const { srv, base } = await serve()
  const dest = tmp()
  const waits = []
  const notes = []
  const r = refuseRename('EPERM', 2)
  try {
    await download(`${base}/DragonBreakLauncher.exe`, dest, { wait: async (ms) => { waits.push(ms) }, onLog: (l) => notes.push(l) })
  } finally { r.restore(); srv.close() }
  assert.ok(fs.readFileSync(dest).equals(BODY))
  assert.ok(!fs.existsSync(`${dest}.part`))
  assert.strictEqual(r.calls(), 3)
  assert.deepStrictEqual(waits, [250, 500])
  assert.strictEqual(notes.length, 2)
  assert.match(notes[0], /refused \(EPERM\); try 2 of \d+ in 0\.25 s$/)
  assert.ok(notes.every((l) => !/Users|Temp|\\|\//.test(l.split(': ').slice(1).join(': '))), 'log lines name no path')
})

test('a rename refused every time fails after a bounded number of tries, with the original error', async () => {
  const { srv, base } = await serve()
  const dest = tmp()
  const waits = []
  const r = refuseRename('EBUSY', Infinity)
  let err
  try {
    await download(`${base}/DragonBreakLauncher.exe`, dest, { wait: async (ms) => { waits.push(ms) } })
  } catch (e) { err = e } finally { r.restore(); srv.close() }
  assert.ok(err, 'the download fails')
  assert.strictEqual(err.code, 'EBUSY')
  assert.ok(r.calls() > 1 && r.calls() <= 10, `tries: ${r.calls()}`)
  assert.ok(waits.reduce((a, b) => a + b, 0) <= 15_000, `waited ${waits.join('+')} ms in all`)
  assert.ok(fs.existsSync(`${dest}.part`), 'the finished part stays for the next try')
})

test('a rename error that waiting cannot fix (ENOENT) is not tried again', async () => {
  const { srv, base } = await serve()
  const dest = tmp()
  const r = refuseRename('ENOENT', Infinity)
  let err
  try {
    await download(`${base}/DragonBreakLauncher.exe`, dest, { wait: async () => {} })
  } catch (e) { err = e } finally { r.restore(); srv.close() }
  assert.strictEqual(err && err.code, 'ENOENT')
  assert.strictEqual(r.calls(), 1)
})

test('the self-update prune also clears the partial installers that failed attempts leave in the temp folder', () => {
  const selfUpdate = require('../src/selfUpdate')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-prune-'))
  try {
    const names = ['DragonBreakLauncher-update.exe.part', 'DragonBreakLauncher-update-2.1.48-1.exe.part',
      'DragonBreakLauncher-update-2.1.48-2.exe', 'alduinak-client-0.3.94.zip.part', 'other.exe.part']
    for (const n of names) fs.writeFileSync(path.join(dir, n), 'x')
    assert.strictEqual(selfUpdate.pruneInstallers(dir, path.join(dir, 'DragonBreakLauncher-update-2.1.48-2.exe')), 2)
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['DragonBreakLauncher-update-2.1.48-2.exe', 'alduinak-client-0.3.94.zip.part', 'other.exe.part'])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
