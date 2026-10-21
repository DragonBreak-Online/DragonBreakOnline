'use strict'
// Launcher 2.1.52 polls far less (Jake 21 Oct: "make the launcher poll less often too"). Through 2.1.51 every open
// launcher asked the backend 1,800 times an hour, minimized and in game too. These run the scheduler (pollPlan.js)
// and the renderer's real checks on a fake clock with a fake document whose visibility the test sets.
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

// ---- the scheduler on its own ---------------------------------------------------------------------------------------

test('a failing check waits 2, 4, then 5 minutes at most, and a longer interval is never shortened', () => {
  const P = require(PLAN)
  assert.deepStrictEqual([0, 1, 2, 3, 4, 9].map(n => P.retryDelay(MIN, n)), [MIN, 2 * MIN, 4 * MIN, 5 * MIN, 5 * MIN, 5 * MIN])
  assert.strictEqual(P.retryDelay(5 * MIN, 3), 5 * MIN)
  assert.strictEqual(P.retryDelay(15 * MIN, 3), 15 * MIN)
})

test('a check runs every interval, give or take 10%', async () => {
  const P = require(PLAN)
  for (const [r, wait] of [[0, 54_000], [0.5, 60_000], [1, 66_000]]) {
    const at = []
    const c = P.createCheck({ run: () => { at.push(Date.now()) }, everyMs: MIN, random: () => r })
    c.start()
    await flush()
    await advance(wait - 1000)
    assert.strictEqual(at.length, 1, `not before ${wait} ms`)
    await advance(1000)
    assert.strictEqual(at.length, 2, `at ${wait} ms`)
    mock.timers.reset(); mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: START })
  }
})

test('a paused check does not run; it resumes by itself an interval after the pause ends, or at once on a nudge', async () => {
  const P = require(PLAN)
  let paused = false; let runs = 0
  const c = P.createCheck({ run: () => { runs++ }, everyMs: MIN, paused: () => paused, random: () => 0.5 })
  c.start(); await flush()
  paused = true
  await advance(60 * MIN)
  assert.strictEqual(runs, 1, 'nothing ran while paused')
  c.nudge(); await flush()
  assert.strictEqual(runs, 1, 'a nudge while paused does nothing')
  paused = false
  await advance(MIN)
  assert.strictEqual(runs, 2, 'it resumed on its own within an interval')
  paused = true; await advance(10 * MIN); paused = false
  c.nudge(); await flush()
  assert.strictEqual(runs, 3, 'a nudge after the pause runs it at once')
})

test('a nudge skips a check that succeeded moments ago, and retries a failed one at once', async () => {
  const P = require(PLAN)
  let ok = true; let runs = 0
  const c = P.createCheck({ run: () => { runs++; return ok }, everyMs: 5 * MIN, minGapMs: MIN, random: () => 0.5 })
  c.start(); await flush()
  await advance(30_000)
  c.nudge(); await flush()
  assert.strictEqual(runs, 1, 'it ran 30 s ago')
  await advance(31_000)
  c.nudge(); await flush()
  assert.strictEqual(runs, 2, 'a minute on, the nudge runs it')
  ok = false
  await advance(5 * MIN); assert.strictEqual(runs, 3)
  await advance(5_000)
  c.nudge(); await flush()
  assert.strictEqual(runs, 4, 'after a failure a nudge does not wait for the gap')
})

test('a run in flight is shared, and a run that throws counts as a failure without stopping the check', async () => {
  const P = require(PLAN)
  let release; let runs = 0
  const c = P.createCheck({ run: () => { runs++; return new Promise(r => { release = r }) }, everyMs: MIN, random: () => 0.5 })
  const a = c.runNow(); const b = c.runNow(); c.nudge()
  await flush()
  assert.strictEqual(runs, 1)
  assert.strictEqual(a, b)
  release(true); assert.strictEqual(await a, true)
  let n = 0
  const t = P.createCheck({ run: () => { n++; throw new Error('boom') }, everyMs: MIN, random: () => 0.5 })
  assert.strictEqual(await t.start(), false)
  assert.strictEqual(t.failures(), 1)
  await advance(2 * MIN)
  assert.strictEqual(n, 2, 'retried after the backoff')
})

// ---- the renderer's checks on a fake window -------------------------------------------------------------------------

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8')
function slice(fromMark, toMark) {
  const from = src.indexOf(fromMark)
  const to = src.indexOf(toMark, from + 1)
  assert.ok(from > 0 && to > from, `the renderer section "${fromMark.slice(0, 40)}" is where the test expects it`)
  return src.slice(from, to)
}

function load({ files = { ok: true, updateAvailable: false, serverVersion: '0.3.106' },
  version = { current: '2.1.52', latest: '2.1.52', hasUpdate: false },
  status = { ok: true, status: 'online', players: 3 } } = {}) {
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
  const answers = { files, version, status, game: false }
  const calls = { status: 0, files: 0, version: 0, game: 0, installUpdate: 0, loadSettings: 0, news: 0, modlist: 0, serverinfo: 0 }
  const times = { status: [] }
  const electronAPI = {
    fetchStatus: async () => { calls.status++; times.status.push(Date.now()); return answers.status },
    isolatedStatus: async () => ({ enabled: false, ready: true }),
    filesUpdateCheck: async () => { calls.files++; return answers.files },
    checkUpdate: () => { calls.version++; return typeof answers.version === 'function' ? answers.version() : Promise.resolve(answers.version) },
    gameIsRunning: async () => { calls.game++; return answers.game },
    installUpdate: async () => { calls.installUpdate++; return { ok: true } },
    loadSettings: async () => { calls.loadSettings++; return { skyrimPath: '' } },
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
    addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn) },
  }
  const ctx = {
    window, document,
    setTimeout: (...a) => setTimeout(...a), clearTimeout: (t) => clearTimeout(t),
    setInterval: (...a) => setInterval(...a), clearInterval: (t) => clearInterval(t),
    Date: { now: () => Date.now() },
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
    'let discordUser = null, serverAllowed = true, serverLocked = false, serverNeedsDiscord = false',
    'function updateLockState() {}',
    'function refreshIsolatedStatus() {}',
    'function openModal() {}',
    'function renderTopbarDiscord() {}',
    'function installLive() {}',
    'async function runInstallForPlay() { return { success: true } }',
    'function loadNews() { globalThis.__calls.news++ }',
    'function loadModlist() { globalThis.__calls.modlist++ }',
    'function loadServerInfo() { globalThis.__calls.serverinfo++ }',
  ].join('\n')
  ctx.__calls = calls
  vm.runInContext(`${prelude}\n${sections.join('\n')}\n;globalThis.__t = { setInstallLock, refreshPlayState }`, ctx)
  const fire = (list, type) => { for (const fn of list[type] || []) fn() }
  return {
    t: ctx.__t, el, calls, times, answers, document,
    hide() { document.hidden = true; fire(docListeners, 'visibilitychange') },
    show() { document.hidden = false; fire(docListeners, 'visibilitychange') },
    focus() { fire(winListeners, 'focus') },
    play: () => el('btn-connect').listeners.click(),
    net: () => calls.status + calls.files + calls.version,
  }
}

const within = (n, lo, hi, what) => assert.ok(n >= lo && n <= hi, `${what}: ${n}, expected ${lo}-${hi}`)

test('a shown, idle launcher: the status every minute, the files every 5 min, the launcher every 15 min, the game every 30 s', async () => {
  const w = load()
  await flush()
  assert.deepStrictEqual([w.calls.status, w.calls.files, w.calls.version, w.calls.game], [1, 1, 1, 1], 'each once at start')
  await advance(60 * MIN)
  within(w.calls.status, 50, 70, 'status in an hour (2.1.51: 360)')
  within(w.calls.files, 11, 14, 'client file checks in an hour (2.1.51: 360)')
  within(w.calls.version, 4, 6, 'launcher checks in an hour (2.1.51: 360)')
  within(w.calls.game, 100, 140, 'game checks in an hour (2.1.51: 360)')
})

test('hidden or minimized: no network check runs, nor the game check', async () => {
  const w = load()
  await flush()
  w.hide()
  const net = w.net(), game = w.calls.game
  await advance(120 * MIN)
  assert.strictEqual(w.net(), net, 'no status, files or launcher request in two hours')
  assert.strictEqual(w.calls.game, game, 'no tasklist either')
})

test('showing the window checks everything at once, and a focus moments later does not ask again', async () => {
  const w = load()
  await flush()
  w.hide()
  await advance(30 * MIN)
  const before = { ...w.calls }
  w.show(); w.focus(); await flush()
  assert.strictEqual(w.calls.status, before.status + 1)
  assert.strictEqual(w.calls.files, before.files + 1)
  assert.strictEqual(w.calls.version, before.version + 1)
  assert.strictEqual(w.calls.game, before.game + 1)
  await advance(5_000)
  w.focus(); await flush()
  assert.deepStrictEqual([w.calls.status, w.calls.files, w.calls.version], [before.status + 1, before.files + 1, before.version + 1], 'nothing asked twice')
  await advance(15_000)
  w.focus(); await flush()
  assert.strictEqual(w.calls.status, before.status + 2, 'the status may be asked again after 15 s')
  assert.strictEqual(w.calls.files, before.files + 1, 'the files only after a minute')
})

test('while the game runs nothing goes to the network; when it closes the launcher is back to PLAY and catches up', async () => {
  const w = load()
  await flush()
  w.answers.game = true
  w.focus(); await flush()
  assert.strictEqual(w.el('btn-connect').textContent, '⏳ GAME RUNNING')
  const net = w.net(), game = w.calls.game
  await advance(60 * MIN)
  assert.strictEqual(w.net(), net, 'no network check during an hour in game with the window shown')
  within(w.calls.game - game, 100, 140, 'the local game check carries on every 30 s')
  w.hide()
  const hiddenGame = w.calls.game
  await advance(30 * MIN)
  assert.strictEqual(w.calls.game, hiddenGame, 'minimized in game: not even tasklist')
  w.answers.game = false
  const before = { ...w.calls }
  w.show(); await flush()
  assert.strictEqual(w.el('btn-connect').textContent, '► PLAY', 'the game closed: Play is back at once')
  await advance(6_000)
  assert.strictEqual(w.calls.status, before.status + 1)
  assert.strictEqual(w.calls.files, before.files + 1, 'a release that landed during play is seen')
  assert.strictEqual(w.calls.version, before.version + 1)
})

test('the game closing while the window shows is noticed within 30 s, and the checks catch up within 5 s more', async () => {
  const w = load()
  await flush()
  w.answers.game = true
  w.focus(); await flush()
  await advance(10 * MIN)
  w.answers.game = false
  const before = w.net()
  await advance(34_000)
  assert.strictEqual(w.el('btn-connect').textContent, '► PLAY')
  await advance(6_000)
  assert.strictEqual(w.net(), before + 3)
})

test('an unreachable backend is asked again after 2, 4, then every 5 minutes, and an answer brings back the minute', async () => {
  const w = load({ status: { ok: false } })
  await flush()
  await advance(25 * MIN)
  const gaps = w.times.status.slice(1).map((t, i) => (t - w.times.status[i]) / 1000)
  const want = [120, 240, 300, 300, 300]
  want.forEach((s, i) => within(gaps[i], s * 0.9, s * 1.1 + 1, `retry ${i + 1}`))
  w.answers.status = { ok: true, status: 'offline' }
  const n = w.times.status.length
  await advance(10 * MIN)
  const after = w.times.status.slice(n).map((t, i) => (t - w.times.status[n - 1 + i]) / 1000)
  for (const g of after.slice(1)) within(g, 54, 67, 'a server that answers OFFLINE is asked every minute')
})

test('a failed check keeps UPDATE and UPDATE LAUNCHER instead of turning them back into PLAY', async () => {
  const w = load({ files: { ok: true, updateAvailable: true, serverVersion: '0.3.107' } })
  await flush()
  assert.strictEqual(w.el('btn-connect').textContent, '⤓ UPDATE')
  w.answers.files = { ok: false, updateAvailable: false }
  await w.t.refreshPlayState()
  assert.strictEqual(w.el('btn-connect').textContent, '⤓ UPDATE', 'a blip in the files check')
  assert.strictEqual(w.el('client-version').textContent, '⬆ UPDATE AVAILABLE')

  const l = load({ version: { current: '2.1.52', latest: '2.1.53', hasUpdate: true } })
  await flush()
  assert.strictEqual(l.el('btn-connect').textContent, '⤓ UPDATE LAUNCHER')
  l.answers.version = { current: '2.1.52', latest: null, hasUpdate: false }
  await advance(17 * MIN)
  assert.ok(l.calls.version >= 2)
  assert.strictEqual(l.el('btn-connect').textContent, '⤓ UPDATE LAUNCHER', 'a blip in the launcher check')
})

test('Play asks for the launcher version first: a launcher published since the last check is installed', async () => {
  const w = load()
  await flush()
  assert.strictEqual(w.el('btn-connect').textContent, '► PLAY')
  w.answers.version = { current: '2.1.52', latest: '2.1.53', hasUpdate: true }
  const asked = w.calls.version
  await w.play()
  assert.strictEqual(w.calls.version, asked + 1, 'asked at the press')
  assert.strictEqual(w.calls.installUpdate, 1, 'the launcher updates')
  assert.strictEqual(w.calls.loadSettings, 0, 'the game flow does not start on the old launcher')
})

test('Play asks for the launcher version first: an update taken back since is not installed, and Play plays', async () => {
  const w = load({ version: { current: '2.1.52', latest: '2.1.53', hasUpdate: true } })
  await flush()
  assert.strictEqual(w.el('btn-connect').textContent, '⤓ UPDATE LAUNCHER')
  w.answers.version = { current: '2.1.52', latest: '2.1.52', hasUpdate: false }
  await w.play()
  assert.strictEqual(w.calls.installUpdate, 0)
  assert.strictEqual(w.calls.loadSettings, 1, 'the game flow ran')
})

test('a launcher check that does not answer holds Play up for 3 s at most', async () => {
  const w = load()
  await flush()
  w.answers.version = () => new Promise(() => {})
  const p = w.play()
  await advance(2_000, 250)
  assert.strictEqual(w.calls.loadSettings, 0)
  assert.strictEqual(w.el('btn-connect').disabled, true, 'locked while it waits')
  await advance(1_500, 250)
  await p
  assert.strictEqual(w.calls.loadSettings, 1, 'then it plays on')
})

test('an install that ends (a Settings repair) refreshes the Play button at once', async () => {
  const w = load()
  await flush()
  const files = w.calls.files
  w.t.setInstallLock(true)
  w.t.setInstallLock(false)
  await flush()
  assert.strictEqual(w.calls.files, files + 1)
})

test('after 15 minutes hidden the news, modlist and server info load again, once; a short absence does not', async () => {
  const w = load()
  await flush()
  const news = w.calls.news
  w.hide(); await advance(5 * MIN); w.show(); await flush()
  assert.strictEqual(w.calls.news, news, 'five minutes away')
  w.hide(); await advance(20 * MIN)
  const files = w.calls.files
  w.show(); w.focus(); await flush()
  assert.deepStrictEqual([w.calls.news, w.calls.modlist, w.calls.serverinfo], [news + 1, news + 1, news + 1])
  assert.strictEqual(w.calls.files, files + 1, 'the files are asked once, not twice')
})
