'use strict'
// A failed launcher self-update must not lock the player out of Play (11-12 Oct, mod-0137: a player on 2.1.45 got
// "Update failed: EPERM: operation not permitted, rename ...\Temp\..." on every try; Play said UPDATE LAUNCHER and
// only ever retried the update, so the game started from Settings > Troubleshooting > Launch via MO2 alone).
// Runs the renderer's Play state, warning strip, launcher update and Play click on a stub window and document.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8')
function slice(fromMark, toMark) {
  const from = src.indexOf(fromMark)
  const to = src.indexOf(toMark, from + 1)
  assert.ok(from > 0 && to > from, `the renderer section "${fromMark.slice(0, 40)}" is where the test expects it`)
  return src.slice(from, to)
}
const PLAY_STATE = slice("const btnConnect     = document.getElementById('btn-connect')", '// Re-evaluate the install/update state')
const WARNING = slice('function showWarning(text) {', '// Run the installer (auto mode)')
const LAUNCHER_UPDATE = slice('// Launcher update check', '\n// News\n')
const PLAY_CLICK = slice("btnConnect.addEventListener('click', async () => {", '\n// Server status')

const EPERM = "EPERM: operation not permitted, rename 'C:\\Users\\x\\AppData\\Local\\Temp\\DragonBreakLauncher-update-2.1.48-1.exe.part'"

function load({ installResult = { ok: false, error: EPERM, manualUrl: 'https://files.example.com/launcher/2.1.48/DragonBreakLauncher.exe' } } = {}) {
  const els = {}
  const mk = (id) => ({
    id, dataset: {}, textContent: '', title: '', hidden: false, disabled: false, className: '', listeners: {},
    classList: { set: new Set(), add(c) { this.set.add(c) }, remove(c) { this.set.delete(c) } },
    removeAttribute(n) { this[n] = '' },
    append(...xs) { this.textContent += xs.map((x) => (typeof x === 'string' ? x : x.textContent)).join('') },
    addEventListener(type, fn) { this.listeners[type] = fn },
  })
  const el = (id) => els[id] || (els[id] = mk(id))
  const calls = { installUpdate: 0, loadSettings: 0, openModal: 0 }
  const electronAPI = {
    onUpdateProgress() {},
    openExternal() {},
    installUpdate: async () => { calls.installUpdate++; return installResult },
    checkUpdate: async () => ({ hasUpdate: true, latest: '2.1.48', current: '2.1.47' }),
    // An empty Skyrim path ends the Play sequence at its first step: enough to show the game flow was entered
    loadSettings: async () => { calls.loadSettings++; return { skyrimPath: '' } },
  }
  const ctx = { window: { electronAPI }, document: { getElementById: el, createElement: () => mk('button') }, setTimeout: () => 0, clearTimeout: () => {} }
  vm.createContext(ctx)
  const prelude = [
    'let installActive = false',
    'let repairRunning = false',
    "const IP = { BUSY_TITLE: 'busy' }",
    'function updateLockState() {}',
    'async function refreshPlayState() { updatePlayButton() }',
    `function openModal() { globalThis.__calls.openModal++ }`,
  ].join('\n')
  ctx.__calls = calls
  vm.runInContext(`${prelude}\n${PLAY_STATE}\n${WARNING}\n${LAUNCHER_UPDATE}\n${PLAY_CLICK}\n;globalThis.__t = { checkLauncherUpdate, updatePlayButton, PLAY_LABEL }`, ctx)
  const play = () => el('btn-connect').listeners.click()
  return { t: ctx.__t, el, play, calls }
}

test('before any failure, Play updates the launcher first', async () => {
  const { t, el, play, calls } = load({ installResult: { ok: true } })
  await t.checkLauncherUpdate()
  assert.strictEqual(el('btn-connect').textContent, '\u2913 UPDATE LAUNCHER')
  await play()
  assert.strictEqual(calls.installUpdate, 1)
  assert.strictEqual(calls.loadSettings, 0, 'the game flow does not start while the launcher updates itself')
})

test('after a failed launcher update, Play starts the game instead of retrying the update', async () => {
  const { t, el, play, calls } = load()
  await t.checkLauncherUpdate()
  await play()
  assert.strictEqual(calls.installUpdate, 1)
  assert.match(el('connect-warning').textContent, /^Update failed\. Download the update yourself EPERM/)
  assert.strictEqual(el('btn-connect').textContent, t.PLAY_LABEL, 'Play reads PLAY once the update has failed')
  assert.strictEqual(el('btn-connect').disabled, false)
  assert.strictEqual(el('update-pill').hidden, false, 'the update stays on offer')
  await play()
  assert.strictEqual(calls.installUpdate, 1, 'the second press does not retry the failed update')
  assert.strictEqual(calls.loadSettings, 1, 'the second press runs the game flow')
})

test('the regular launcher update check does not lock Play again after a failure', async () => {
  const { t, el, play, calls } = load()
  await t.checkLauncherUpdate()
  await play()
  await t.checkLauncherUpdate()
  t.updatePlayButton()
  assert.strictEqual(el('btn-connect').textContent, t.PLAY_LABEL)
  await play()
  assert.strictEqual(calls.installUpdate, 1)
  assert.strictEqual(calls.loadSettings, 1)
})
