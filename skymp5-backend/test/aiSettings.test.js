'use strict'
// The Dragonbaron AI switch and settings file (sources/ai/aiSettings.js): both fail closed

const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ai = require('../sources/ai/aiSettings')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbai-settings-'))
after(() => fs.rmSync(dir, { recursive: true, force: true }))
let n = 0
function file(text, mode = 0o644) {
  const f = path.join(dir, `f${++n}`)
  fs.writeFileSync(f, text, { mode })
  fs.chmodSync(f, mode)
  return f
}
const OFF = { ask: false, model: false, detect: 'off' }
const pick = s => ({ ask: s.ask, model: s.model, detect: s.detect })

test('the switch as shipped is all off, and each key reads as written', () => {
  assert.deepEqual(pick(ai.readSwitch(file('ask=off model=off detect=off\n'))), OFF)
  assert.deepEqual(pick(ai.readSwitch(file('# runtime switch\nask=on model=off\ndetect=dry\n'))), { ask: true, model: false, detect: 'dry' })
  assert.deepEqual(pick(ai.readSwitch(file('ask=on'))), { ask: true, model: false, detect: 'off' })
})

test('missing, unreadable, writable by others, malformed, an unknown key or value, or a key given twice: every key is off', () => {
  const bad = [
    ['missing', path.join(dir, 'nope')],
    ['group writable', file('ask=on model=on detect=on', 0o664)],
    ['world writable', file('ask=on model=on detect=on', 0o646)],
    ['malformed', file('ask=on model=on detect')],
    ['quoted', file('ask="on"')],
    ['unknown value', file('ask=yes model=on')],
    ['unknown key', file('ask=on model=on chat=on')],
    ['twice', file('ask=on ask=off model=on')],
    ['upper case', file('ASK=ON')],
    ['a directory', dir],
  ]
  for (const [why, f] of bad) {
    const s = ai.readSwitch(f)
    assert.deepEqual(pick(s), OFF, why)
    assert.equal(s.ok, false, why)
  }
  assert.equal(ai.readSwitch(path.join(dir, 'nope')).problem, 'missing')
})

test('the switch file can be moved with DRAGONBARON_AI_SWITCH_FILE and is read on every call', () => {
  const f = file('ask=on model=on detect=on')
  process.env.DRAGONBARON_AI_SWITCH_FILE = f
  try {
    assert.equal(ai.readSwitch().ask, true)
    fs.writeFileSync(f, 'ask=off')
    assert.equal(ai.readSwitch().ask, false)
  } finally { delete process.env.DRAGONBARON_AI_SWITCH_FILE }
})

test('settings: code defaults without a file, so the model URL is empty and the model is never contacted', () => {
  ai._resetCache()
  const s = ai.readSettings(path.join(dir, 'missing.env'))
  assert.equal(s.url, '')
  assert.equal(s.model, 'qwen3.5:9b')
  assert.equal(s.numCtx, 16384)
  assert.equal(s.keepAlive, -1)
  assert.equal(s.timeoutMs, 60000)
  assert.equal(s.probeMs, 3000)
  assert.deepEqual([s.askPerMin, s.askPerHour, s.askSitePerHour], [3, 20, 60])
  assert.deepEqual(s.problems, ['missing'])
})

test('settings: the deploy file parses, a trailing comment is ignored, bad values keep the default and are named (names only)', () => {
  const s = ai.parseSettings([
    '# Dragonbaron AI settings (no secrets)',
    'DRAGONBARON_AI_URL=http://ai.test:11434/   # the AI box',
    'DRAGONBARON_AI_MODEL=qwen3.5:9b',
    'DRAGONBARON_AI_NUM_CTX=abc',
    'DRAGONBARON_AI_TIMEOUT_MS=45000',
    'DRAGONBARON_ASK_PER_MIN=5',
    'INFRACTION_CHANNELS=1,2,3',
    'export DRAGONBARON_AI_PROBE_MS=1',
  ].join('\n'))
  assert.equal(s.url, 'http://ai.test:11434')
  assert.equal(s.numCtx, 16384)
  assert.equal(s.timeoutMs, 45000)
  assert.equal(s.askPerMin, 5)
  assert.equal(s.probeMs, 3000)
  assert.deepEqual(s.problems, ['DRAGONBARON_AI_NUM_CTX', 'a malformed line'])
  for (const url of ['ftp://x', 'http://x/path', 'http://user@x', '"http://x"', 'http://x:11434 extra']) assert.equal(ai.parseSettings(`DRAGONBARON_AI_URL=${url}`).url, '', url)
})

test('who may ask and question text are not settings: such keys are ignored like any other unknown key', () => {
  const s = ai.parseSettings('DRAGONBARON_ASK_ROLES=trialgm\nDRAGONBARON_ASK_LOG_QUESTIONS=on\nDRAGONBARON_ASK_QUESTION_DAYS=7')
  assert.deepEqual(Object.keys(s).sort(), [...Object.keys(ai.DEFAULTS), 'problems'].sort())
  assert.deepEqual(s.problems, [])
  for (const k of Object.keys(s)) assert.ok(!/role|question/i.test(k), k)
})

test('settings are cached for at most 60 s, and a file writable by others is not trusted', () => {
  ai._resetCache()
  let t = 5_000_000
  const f = file('DRAGONBARON_AI_URL=http://one.test:11434\n')
  assert.equal(ai.readSettings(f, { now: () => t }).url, 'http://one.test:11434')
  fs.writeFileSync(f, 'DRAGONBARON_AI_URL=http://two.test:11434\n')
  t += 59_000
  assert.equal(ai.readSettings(f, { now: () => t }).url, 'http://one.test:11434')
  t += 2_000
  assert.equal(ai.readSettings(f, { now: () => t }).url, 'http://two.test:11434')
  ai._resetCache()
  const loose = file('DRAGONBARON_AI_URL=http://evil.test:11434\n', 0o666)
  assert.equal(ai.readSettings(loose).url, '')
})
