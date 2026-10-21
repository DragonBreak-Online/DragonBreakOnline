'use strict'
// selfUpdate.js: install.log lines for the launcher's own update (claude-jake, 11 Oct): the check (first answer and each
// change only, it repeats), and on the next start whether the version that was installing is the one running.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const selfUpdate = require('../src/selfUpdate')

// Same rule as main.js compareVersions
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d }
  return 0
}
function memStore() {
  const m = new Map()
  return { get: k => m.get(k), set: (k, v) => m.set(k, v), delete: k => m.delete(k), has: k => m.has(k) }
}

test('the check logs its first answer and then only changes', () => {
  const lines = []
  const check = selfUpdate.createCheckLogger(l => lines.push(l))
  check({ current: '2.1.46', latest: '2.1.46', hasUpdate: false })
  check({ current: '2.1.46', latest: '2.1.46', hasUpdate: false })
  check({ current: '2.1.46', latest: '2.1.47', hasUpdate: true })
  check({ current: '2.1.46', latest: '2.1.47', hasUpdate: true })
  check(null, Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }))
  check(null, Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }))
  check(null, Object.assign(new Error('HTTP 502'), { statusCode: 502 }))
  assert.deepStrictEqual(lines, [
    '[self-update] check: running 2.1.46, the server offers 2.1.46: up to date',
    '[self-update] check: running 2.1.46, the server offers 2.1.47: update available',
    '[self-update] check failed: ENOTFOUND',
    '[self-update] check failed: HTTP 502',
  ])
})

test('the start after an applied update says so once, and clears the marker', () => {
  const store = memStore()
  selfUpdate.markPending(store, '2.1.45', '2.1.46', 1_000_000)
  assert.strictEqual(selfUpdate.startupResult(store, '2.1.46', compareVersions, 1_009_000),
    '[self-update] result: applied, now running 2.1.46 (was 2.1.45) (9 s after the hand-off)')
  assert.strictEqual(store.has(selfUpdate.PENDING_KEY), false)
  assert.strictEqual(selfUpdate.startupResult(store, '2.1.46', compareVersions, 1_010_000), null)
})

test('an update that did not land is reported as not applied, and an old one says it is old', () => {
  const store = memStore()
  selfUpdate.markPending(store, '2.1.45', '2.1.46', 0)
  assert.match(selfUpdate.startupResult(store, '2.1.45', compareVersions, 30_000), /NOT applied, still running 2\.1\.45; the installer for 2\.1\.46 did not finish \(30 s/)
  selfUpdate.markPending(store, '2.1.45', '2.1.46', 0)
  assert.match(selfUpdate.startupResult(store, '2.1.45', compareVersions, selfUpdate.STALE_MS + 1000), /over a day old/)
  selfUpdate.markPending(store, '2.1.45', '2.1.46', 0)
  assert.match(selfUpdate.startupResult(store, '2.1.47', compareVersions, 5000), /running 2\.1\.47, newer than the 2\.1\.46/)
})

test('a broken store never throws', () => {
  const broken = { get() { throw new Error('locked') }, set() { throw new Error('locked') }, delete() { throw new Error('locked') } }
  assert.doesNotThrow(() => selfUpdate.markPending(broken, '1', '2'))
  assert.strictEqual(selfUpdate.startupResult(broken, '2', compareVersions), null)
  assert.strictEqual(selfUpdate.startupResult(memStore(), '2', compareVersions), null)
})

test('the source of the installer is named by host only', () => {
  assert.strictEqual(selfUpdate.describeSource('https://github.com/NatPiercii/DragonBreakOnline/releases/download/launcher-v2.1.46/DragonBreakLauncher.exe?token=abc'), 'github.com')
})

// main.js must log each step of the self-update and pass download.js's logger to every download
test('main.js logs the check, download, apply and result, and every download gets onLog', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
  for (const needle of ['logUpdateCheck({ current, latest, hasUpdate })', 'logUpdateCheck(null, err)',
    'downloading the installer from ${selfUpdate.describeSource(data.downloadUrl)}', 'installer downloaded, ${size} bytes, sha256',
    'selfUpdate.markPending(store, current, latest)', 'applying, the installer runs silently', 'selfUpdate.startupResult(store, app.getVersion(), compareVersions)']) {
    assert.ok(src.includes(needle), needle)
  }
  const calls = src.match(/downloadLib\.download\([^)]*\{[\s\S]*?\}\)/g) || []
  assert.ok(calls.length >= 3, `found ${calls.length} download calls`)
  for (const c of calls) assert.ok(c.includes('onLog: downloadLog'), c.slice(0, 120))
  // No self-update line may print the download url itself
  assert.ok(!/\[self-update\][^\n]*\$\{data\.downloadUrl\}/.test(src))
})
