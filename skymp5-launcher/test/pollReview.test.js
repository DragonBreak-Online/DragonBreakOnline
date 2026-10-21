'use strict'
// Review of launcher 2.1.52's background checks (behaviour lens, 21 Oct): a launcher left open for hours, the network
// dropping and coming back (a sleep, Wi-Fi), a storm of focus/blur/minimize/game events, and a Play press on a stale
// label. Same harness as pollPlan.test.js: the renderer's real sections on a fake clock with a fake window.
const test = require('node:test')
const { mock } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PLAN = path.join(__dirname, '..', 'src', 'renderer', 'pollPlan.js')
const START = Date.UTC(2026, 9, 21, 20, 0, 0)
const MIN = 60_000

async function flush() { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)) }
async function advance(ms, step = 1000) {
  for (let t = 0; t < ms; t += step) {
    mock.timers.tick(Math.min(step, ms - t))
    await flush()
  }
}

test.beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: START }))
test.afterEach(() => mock.timers.reset())

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8')
function slice(fromMark, toMark) {
  const from = src.indexOf(fromMark)
  const to = src.indexOf(toMark, from + 1)
  assert.ok(from > 0 && to > from, `the renderer section "${fromMark.slice(0, 40)}" is where the test expects it`)
  return src.slice(from, to)
}

function load() {
  const sections = [
    slice("const btnConnect     = document.getElementById('btn-connect')", '// Re-evaluate the install/update state'),
    slice('// Re-evaluate the install/update state', 'function showWarning(text) {'),
    slice('function showWarning(text) {', '// Run the installer (auto mode)'),
    slice('function setInstallLock(on) {', 'window.electronAPI.onInstallState('),
    slice("btnConnect.addEventListener('click', async () => {", '\n// Server status'),
    slice('\n// Server status', '// Server info strip'),
    slice('// Launcher update check', '\n// News\n'),
    slice('// Background checks (pollPlan.js', '// Skyrim Version panel'),
  ]
  const els = {}
  const mk = (id) => ({
    id, dataset: {}, textContent: '', title: '', hidden: false, disabled: false, className: '', listeners: {},
    classList: { set: new Set(), add(c) { this.set.add(c) }, remove(c) { this.set.delete(c) }, contains(c) { return this.set.has(c) } },
    removeAttribute(n) { this[n] = '' },
    append(...xs) { this.textContent += xs.map((x) => (typeof x === 'string' ? x : x.textContent)).join('') },
    addEventListener(type, fn) { this.listeners[type] = fn },
  })
  const el = (id) => els[id] || (els[id] = mk(id))
  const answers = {
    files: { ok: true, updateAvailable: false, serverVersion: '0.3.106' },
    version: { current: '2.1.52', latest: '2.1.52', hasUpdate: false },
    status: { ok: true, status: 'online', players: 3 },
    game: false,
  }
  const calls = { status: 0, files: 0, version: 0, game: 0, installUpdate: 0, news: 0, modlist: 0, serverinfo: 0 }
  const order = []
  const electronAPI = {
    fetchStatus: async () => { calls.status++; return answers.status },
    isolatedStatus: async () => ({ enabled: false, ready: true }),
    filesUpdateCheck: async () => { calls.files++; return answers.files },
    checkUpdate: async () => { calls.version++; return answers.version },
    gameIsRunning: async () => { calls.game++; return answers.game },
    installUpdate: async () => { calls.installUpdate++; return { ok: true } },
    loadSettings: async () => ({ skyrimPath: 'C:\\Games\\Skyrim Special Edition' }),
    launchSkse: async () => { order.push('launch'); return { success: true } },
    onUpdateProgress() {},
    openExternal() {},
  }
  const docListeners = {}; const winListeners = {}
  const document = {
    hidden: false,
    getElementById: el,
    createElement: () => mk('button'),
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn) },
  }
  const window = {
    electronAPI,
    dboPollPlan: require(PLAN),
    dboLegal: { check: async () => {}, blocking: () => false, message: () => '', open() {}, reset() {} },
    addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn) },
  }
  // Every timer the page holds, so a leak or a doubled chain shows up as a growing count
  const live = new Set()
  const ctx = {
    window, document,
    setTimeout: (fn, ms, ...a) => { const h = setTimeout(() => { live.delete(h); fn(...a) }, ms); live.add(h); return h },
    clearTimeout: (h) => { live.delete(h); clearTimeout(h) },
    setInterval: (...a) => { const h = setInterval(...a); live.add(h); return h },
    clearInterval: (h) => { live.delete(h); clearInterval(h) },
    Date: { now: () => Date.now() },
    Math, Promise,
  }
  vm.createContext(ctx)
  const prelude = [
    'let installActive = false',
    'let repairRunning = false',
    'let mo2InstallRunning = false',
    "const IP = { BUSY_TITLE: 'busy' }",
    'const INSTALL_LOCKED = () => []',
    'const REPAIR_BUTTONS = []',
    'const btnRepairModlist = {}',
    'const fieldIsolated = {}',
    'let discordUser = null, serverAllowed = true, serverLocked = false, serverNeedsDiscord = false',
    'function updateLockState() {}',
    'function refreshIsolatedStatus() {}',
    'function openModal() {}',
    'function renderTopbarDiscord() {}',
    'function installLive() {}',
    "async function runInstallForPlay() { globalThis.__order.push('install'); return { success: true } }",
    'function loadNews() { globalThis.__calls.news++ }',
    'function loadModlist() { globalThis.__calls.modlist++ }',
    'function loadServerInfo() { globalThis.__calls.serverinfo++ }',
  ].join('\n')
  ctx.__calls = calls
  ctx.__order = order
  vm.runInContext(`${prelude}\n${sections.join('\n')}\n;globalThis.__t = { setInstallLock, refreshPlayState }`, ctx)
  const fire = (list, type) => { for (const fn of list[type] || []) fn() }
  return {
    t: ctx.__t, el, calls, answers, document, live, order,
    hide() { document.hidden = true; fire(docListeners, 'visibilitychange') },
    show() { document.hidden = false; fire(docListeners, 'visibilitychange') },
    focus() { fire(winListeners, 'focus') },
    online() { fire(winListeners, 'online') },
    play: () => el('btn-connect').listeners.click(),
    badge: () => el('badge-label').textContent,
    label: () => el('btn-connect').textContent,
  }
}

// Advance in steps until cond() holds; resolves to the time it took, or Infinity after maxMs
async function timeUntil(cond, maxMs, step = 1000) {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > maxMs) return Infinity
    await advance(step, step)
  }
  return Date.now() - t0
}

test('a launcher left open for hours sees a new client release within 5.5 min and a new launcher within 16.5 min', async () => {
  const w = load()
  await flush()
  await advance(97 * MIN)
  assert.strictEqual(w.label(), '► PLAY')
  w.answers.files = { ok: true, updateAvailable: true, serverVersion: '0.3.107' }
  const files = await timeUntil(() => w.label() === '⤓ UPDATE', 6 * MIN)
  assert.ok(files <= 330_000, `UPDATE after ${files / 1000} s`)
  w.answers.files = { ok: true, updateAvailable: false, serverVersion: '0.3.107' }
  await w.t.refreshPlayState()
  await advance(23 * MIN)
  w.answers.version = { current: '2.1.52', latest: '2.1.53', hasUpdate: true }
  const launcher = await timeUntil(() => w.label() === '⤓ UPDATE LAUNCHER', 17 * MIN)
  assert.ok(launcher <= 990_000, `UPDATE LAUNCHER after ${launcher / 1000} s`)
})

test('a game server coming back is shown within about a minute; a backend back after 30 min within 5.5 min, with one resync', async () => {
  const w = load()
  await flush()
  w.answers.status = { ok: true, status: 'offline' }
  await advance(20 * MIN)
  assert.strictEqual(w.badge(), 'OFFLINE')
  w.answers.status = { ok: true, status: 'online', players: 5 }
  const back = await timeUntil(() => w.badge() === 'ONLINE', 3 * MIN)
  assert.ok(back <= 67_000, `ONLINE after ${back / 1000} s`)

  w.answers.status = { ok: false }
  await advance(30 * MIN)
  assert.strictEqual(w.badge(), 'OFFLINE')
  const news = w.calls.news
  w.answers.status = { ok: true, status: 'online', players: 5 }
  const up = await timeUntil(() => w.badge() === 'ONLINE', 6 * MIN)
  assert.ok(up <= 330_000, `ONLINE after ${up / 1000} s`)
  await advance(5 * MIN)
  assert.strictEqual(w.calls.news, news + 1, 'news, modlist and server info reload once when the backend is back')
})

test('a storm of minimize/restore, focus and game starts and ends never doubles a check or leaks timers', async () => {
  const w = load()
  await flush()
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  let maxLive = 0
  for (let i = 0; i < 3000; i++) {
    const r = rnd()
    if (r < 0.2) w.hide()
    else if (r < 0.45) w.show()
    else if (r < 0.7) w.focus()
    else if (r < 0.8) w.answers.game = !w.answers.game
    else if (r < 0.85) w.answers.status = rnd() < 0.5 ? { ok: false } : { ok: true, status: 'online', players: 2 }
    await advance(Math.floor(rnd() * 20_000) + 50, 2000)
    maxLive = Math.max(maxLive, w.live.size)
  }
  // 4 check chains, plus at most a couple of 0-5 s catch-up timers after a game end
  assert.ok(maxLive <= 7, `at most 7 timers alive at once, saw ${maxLive}`)
  // Back to a plain shown, idle window: the rates are the normal ones, nothing doubled
  w.answers.game = false; w.answers.status = { ok: true, status: 'online', players: 2 }
  w.show(); await advance(10 * MIN)
  const before = { ...w.calls }
  await advance(60 * MIN)
  const d = k => w.calls[k] - before[k]
  assert.ok(d('status') >= 50 && d('status') <= 70, `status ${d('status')}/h`)
  assert.ok(d('files') >= 11 && d('files') <= 14, `files ${d('files')}/h`)
  assert.ok(d('version') >= 3 && d('version') <= 6, `launcher ${d('version')}/h`)
  assert.ok(d('game') >= 100 && d('game') <= 140, `game ${d('game')}/h`)
  assert.ok(w.live.size <= 5, `timers alive when idle: ${w.live.size}`)
})

test('a Play press on a PLAY label left over from before a release still runs the install before it launches', async () => {
  const w = load()
  await flush()
  assert.strictEqual(w.label(), '► PLAY')
  // A release lands; the window's 5 min check has not seen it yet
  w.answers.files = { ok: true, updateAvailable: true, serverVersion: '0.3.107' }
  await w.play()
  assert.deepStrictEqual(w.order, ['install', 'launch'], 'the install (which re-reads /api/files/version) runs first')
})

test('minimized during a launch: the 2 s launch watch still finds the game, and nothing else polls', async () => {
  const w = load()
  await flush()
  await w.play()
  assert.strictEqual(w.label(), '► LAUNCHING…')
  w.hide()
  const g = w.calls.game, net = w.calls.status + w.calls.files + w.calls.version
  await advance(20_000)
  assert.ok(w.calls.game - g >= 9 && w.calls.game - g <= 11, `launch watch every 2 s: ${w.calls.game - g} in 20 s`)
  w.answers.game = true
  await advance(2_000)
  assert.strictEqual(w.label(), '⏳ GAME RUNNING')
  const g2 = w.calls.game
  await advance(30 * MIN)
  assert.strictEqual(w.calls.game, g2, 'minimized in game: no tasklist')
  assert.strictEqual(w.calls.status + w.calls.files + w.calls.version, net, 'and no network check')
})
