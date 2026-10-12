'use strict'
// main.js watchGameExit with the real crashWatch on a fake clock: a game launched while the previous one's watcher is
// still finishing (crash log wait, note, crash prompt) must be watched too (LOG-1012-06).
const test = require('node:test')
const { mock } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const SRC = path.join(__dirname, '..', 'src')
const START = Date.UTC(2026, 9, 11, 20, 0, 0)

function watcherBlock() {
  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8')
  const from = main.indexOf('// After a launch, watch the game and tell the server how it closed')
  const to = main.indexOf('// After a crash, offer the report there and then.')
  assert.ok(from > 0 && to > from, 'watchGameExit block found in main.js')
  return main.slice(from, to)
}

// A PC with at most one SkyrimSE.exe; PowerShell's WaitForExit answers when that pid ends
function fakeMachine(crashDir) {
  let running = null
  const waiters = new Map()
  const execFile = (file, args, _opts, cb) => {
    if (file === 'tasklist') {
      const out = running ? `"SkyrimSE.exe","${running.pid}","Console","1","1 K"\r\n` : 'INFO: No tasks are running\r\n'
      return void Promise.resolve().then(() => cb(null, out))
    }
    const pid = Number(/-Id (\d+)/.exec(args.join(' '))[1])
    const list = waiters.get(pid) || []
    list.push(cb)
    waiters.set(pid, list)
  }
  const launch = ({ pid, runMs, exitCode, crashLog = false }) => {
    setTimeout(() => {
      running = { pid }
      setTimeout(() => {
        if (crashLog) {
          const file = path.join(crashDir, `crash-${pid}.log`)
          fs.writeFileSync(file, 'Unhandled exception')
          fs.utimesSync(file, Date.now() / 1000, Date.now() / 1000)
        }
        running = null
        const signed = exitCode >= 0x80000000 ? exitCode - 2 ** 32 : exitCode
        for (const cb of waiters.get(pid) || []) cb(null, `${signed}\r\n`)
        waiters.delete(pid)
      }, runMs)
    }, 2000)
  }
  return { childProcess: { execFile }, launch }
}

function setup({ promptMs = 0 } = {}) {
  const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'relaunch-'))
  const crashDir = path.join(docs, 'My Games', 'Skyrim Special Edition', 'SKSE')
  fs.mkdirSync(crashDir, { recursive: true })
  const machine = fakeMachine(crashDir)
  const notes = []; const prompts = []; const logs = []; const kv = { gameSession: 'session' }
  const stubs = {
    process: { platform: 'win32' },
    store: { get: k => kv[k], set: (k, v) => { kv[k] = v } },
    bugLogPoller: { poll() {} },
    bugLogs: { POLL_MS: 30_000 },
    documentsDirOrNull: () => docs,
    MYGAMES_VARIANTS: ['Skyrim Special Edition'],
    path,
    crashWatch: require(path.join(SRC, 'crashWatch')),
    log: l => logs.push(l),
    postJSON: async (_url, body) => { notes.push(body) },
    config: { apiUrl: 'https://test.invalid' },
    app: { getVersion: () => 'test' },
    afterSuccessfulLaunch() {},
    offerCrashReport: async (note) => {
      if (!note || note.outcome !== 'crash') return
      prompts.push(note)
      await new Promise(r => setTimeout(r, promptMs))
    },
    tidyDisk() {},
    require: m => (m === 'child_process' ? machine.childProcess : require(m)),
  }
  const names = Object.keys(stubs)
  // eslint-disable-next-line no-new-func
  const watchGameExit = new Function(...names, `${watcherBlock()}\nreturn watchGameExit`)(...names.map(n => stubs[n]))
  return { watchGameExit, machine, notes, prompts, logs, kv }
}

async function advance(ms) {
  for (let t = 0; t < ms; t += 250) {
    mock.timers.tick(250)
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r))
  }
}

test.beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: START }))
test.afterEach(() => mock.timers.reset())

test('a launch during the crash log wait after a normal close gets its own note', async () => {
  const s = setup()
  s.watchGameExit(); s.machine.launch({ pid: 101, runMs: 60_000, exitCode: 0 })
  await advance(62_000 + 5_000)
  s.watchGameExit(); s.machine.launch({ pid: 202, runMs: 30_000, exitCode: 0 })
  await advance(120_000)
  assert.strictEqual(s.notes.length, 2, `two games, two notes:\n${s.logs.join('\n')}`)
  assert.ok(s.notes.every(n => n.outcome === 'closed'))
})

test('a launch in the crash prompt race (Dumb Mutt, 11 Oct 20:39) is watched, and the prompt still comes', async () => {
  const s = setup({ promptMs: 30_000 })
  s.watchGameExit(); s.machine.launch({ pid: 101, runMs: 60_000, exitCode: 1, crashLog: true })
  await advance(62_000 + 3_000)
  s.watchGameExit(); s.machine.launch({ pid: 202, runMs: 40_000, exitCode: 0 })
  await advance(120_000)
  assert.strictEqual(s.prompts.length, 1)
  assert.deepStrictEqual(s.notes.map(n => n.outcome), ['crash', 'closed'], s.logs.join('\n'))
})

test('a crash log written by the next launch does not turn the previous close into a crash', async () => {
  const s = setup()
  s.watchGameExit(); s.machine.launch({ pid: 101, runMs: 60_000, exitCode: 0 })
  await advance(62_000 + 2_000)
  s.watchGameExit(); s.machine.launch({ pid: 202, runMs: 12_000, exitCode: 1, crashLog: true })
  await advance(120_000)
  const byStart = [...s.notes].sort((a, b) => a.startedAt - b.startedAt)
  assert.deepStrictEqual(byStart.map(n => [n.outcome, n.crashLog]), [['closed', false], ['crash', true]], s.logs.join('\n'))
})

test('lastGameEnd keeps the newest game even when the older note lands later', async () => {
  const s = setup()
  s.watchGameExit(); s.machine.launch({ pid: 101, runMs: 60_000, exitCode: 0 })
  await advance(62_000 + 2_000)
  const secondLaunch = Date.now()
  s.watchGameExit(); s.machine.launch({ pid: 202, runMs: 12_000, exitCode: 1, crashLog: true })
  await advance(120_000)
  assert.ok(s.kv.lastGameEnd, 'stored')
  assert.ok(s.kv.lastGameEnd.startedAt > secondLaunch, 'the second game is the last one')
  assert.strictEqual(s.kv.lastGameEnd.outcome, 'crash')
})
