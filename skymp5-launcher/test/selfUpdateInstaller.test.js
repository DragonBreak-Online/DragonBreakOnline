'use strict'
// The launcher's own update downloads each installer to a file of its own and clears the ones earlier attempts left
// (11 Oct: a player on 2.1.45 got "Update failed: EPERM: operation not permitted, rename ...\Temp\..." with one fixed
// name), and a failed update offers the installer by hand.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const selfUpdate = require('../src/selfUpdate')

const SRC = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')

test('each attempt gets its own installer file, named by version and time', () => {
  const a = selfUpdate.installerPath('/tmp/x', '2.1.47', 1000), b = selfUpdate.installerPath('/tmp/x', '2.1.47', 2000)
  assert.notStrictEqual(a, b)
  assert.strictEqual(path.basename(a), 'DragonBreakLauncher-update-2.1.47-1000.exe')
  assert.strictEqual(path.basename(selfUpdate.installerPath('/tmp/x', '../../evil', 1)), 'DragonBreakLauncher-update-.._.._evil-1.exe')
})

test('old installers are removed, the one in use and other files are kept, a held one is skipped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-selfupdate-'))
  try {
    for (const n of ['DragonBreakLauncher-update.exe', 'DragonBreakLauncher-update-2.1.46-1.exe', 'DragonBreakLauncher-update-2.1.47-2.exe', 'other.exe', 'alduinak-client.zip']) fs.writeFileSync(path.join(dir, n), 'x')
    const keep = path.join(dir, 'DragonBreakLauncher-update-2.1.47-2.exe')
    assert.strictEqual(selfUpdate.pruneInstallers(dir, keep), 2)
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['DragonBreakLauncher-update-2.1.47-2.exe', 'alduinak-client.zip', 'other.exe'])
    const held = { readdirSync: () => ['DragonBreakLauncher-update.exe'], unlinkSync: () => { const e = new Error('EPERM'); e.code = 'EPERM'; throw e } }
    assert.strictEqual(selfUpdate.pruneInstallers(dir, '', held), 0)
    assert.strictEqual(selfUpdate.pruneInstallers(path.join(dir, 'missing')), 0)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('main.js uses a fresh installer path, prunes, and returns the manual url on failure', () => {
  const main = SRC('main.js')
  assert.ok(!/DragonBreakLauncher-update\.exe'/.test(main), 'no fixed installer name left')
  assert.match(main, /const dest = selfUpdate\.installerPath\(os\.tmpdir\(\), latest\)\n\s+selfUpdate\.pruneInstallers\(os\.tmpdir\(\), dest\)/)
  assert.match(main, /return \{ ok: false, error: err\.message, manualUrl \}/)
  assert.match(main, /selfUpdate\.pruneInstallers\(os\.tmpdir\(\)\)/)
})

test('the renderer offers the download by hand, first on the one-line strip, https only', () => {
  const r = SRC(path.join('renderer', 'renderer.js'))
  assert.match(r, /if \(r\.manualUrl && \/\^https:\\\/\\\/\/i\.test\(r\.manualUrl\)\) \{/)
  assert.match(r, /btn\.addEventListener\('click', \(\) => window\.electronAPI\.openExternal\(r\.manualUrl\)\)/)
  assert.match(r, /connectWarning\.append\(' ', btn, /)
})
