'use strict'
// config.js's PUNISH_TRACKER family, read in a child node from an empty folder (no .env), and start() with the switch off

const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { start, settings } = require('../sources/punish/tracker')

const CONFIG = path.join(__dirname, '..', 'config.js')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'punish-tracker-config-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

// The tracker's settings as config.js gives them for this env (every other PUNISH_TRACKER* variable unset)
function configFor(env = {}) {
  const base = {}
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('PUNISH_TRACKER')) base[k] = v
  const code = `const c = require(${JSON.stringify(CONFIG)}); process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith('punishTracker')))))`
  const r = spawnSync(process.execPath, ['-e', code], { cwd: tmp, env: { ...base, ...env }, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

test('PUNISH_TRACKER is off unless set, dry and dry-run are the same, anything unknown is off', () => {
  assert.equal(configFor().punishTracker, 'off')
  assert.equal(configFor({ PUNISH_TRACKER: '' }).punishTracker, 'off')
  assert.equal(configFor({ PUNISH_TRACKER: 'off' }).punishTracker, 'off')
  assert.equal(configFor({ PUNISH_TRACKER: 'dry' }).punishTracker, 'dry')
  assert.equal(configFor({ PUNISH_TRACKER: ' Dry-Run ' }).punishTracker, 'dry')
  assert.equal(configFor({ PUNISH_TRACKER: 'on' }).punishTracker, 'on')
  for (const v of ['yes', 'true', '1', 'dryrun', 'onn']) assert.equal(configFor({ PUNISH_TRACKER: v }).punishTracker, 'off', v)
})

test('the defaults: the staff forum, data/ files, profile 126 skipped, 90 warning days, 975 threads, staff targets shown', () => {
  const c = configFor()
  assert.equal(c.punishTrackerForumId, '1564694518194774067')
  assert.equal(c.punishTrackerFile, path.join(__dirname, '..', 'data', 'punish-threads.json'))
  assert.equal(c.punishTrackerDryFile, path.join(__dirname, '..', 'data', 'punish-tracker-dry.jsonl'))
  assert.deepEqual(c.punishTrackerSkipProfiles, [126])
  assert.equal(c.punishTrackerWarnDays, 90)
  assert.equal(c.punishTrackerHeadroom, 975)
  assert.equal(c.punishTrackerHideStaffTargets, false)
  const s = settings(c)
  assert.deepEqual([s.mode, s.skip, s.warnDays, s.headroom, s.hideStaff], ['off', [126], 90, 975, false])
})

test('the env overrides: a skip list (empty skips none), whole numbers only, staff hiding on', () => {
  const c = configFor({
    PUNISH_TRACKER_SKIP_PROFILES: '126, 7', PUNISH_TRACKER_WARN_DAYS: '30', PUNISH_TRACKER_HEADROOM: '950', PUNISH_TRACKER_HIDE_STAFF: 'on',
  })
  assert.deepEqual(c.punishTrackerSkipProfiles, [126, 7])
  assert.equal(c.punishTrackerWarnDays, 30)
  assert.equal(c.punishTrackerHeadroom, 950)
  assert.equal(c.punishTrackerHideStaffTargets, true)
  assert.deepEqual(configFor({ PUNISH_TRACKER_SKIP_PROFILES: '' }).punishTrackerSkipProfiles, [])
  const bad = configFor({ PUNISH_TRACKER_WARN_DAYS: 'ninety', PUNISH_TRACKER_HEADROOM: '-1', PUNISH_TRACKER_HIDE_STAFF: 'yes' })
  assert.deepEqual([bad.punishTrackerWarnDays, bad.punishTrackerHeadroom, bad.punishTrackerHideStaffTargets], [90, 975, false])
})

test('start() with the switch off does nothing: no service read, no timer, no file', () => {
  const file = path.join(tmp, 'punish-threads.json')
  const dryFile = path.join(tmp, 'punish-tracker-dry.jsonl')
  const lines = []
  let asked = 0
  const timersBefore = process.getActiveResourcesInfo().filter(r => r === 'Timeout').length
  for (const mode of [undefined, 'off', 'nonsense']) {
    const t = start({
      config: { punishTracker: mode, punishTrackerFile: file, punishTrackerDryFile: dryFile },
      punishments: () => { asked++; throw new Error('read') },
      log: line => lines.push(line),
    })
    assert.equal(t, null)
  }
  assert.equal(process.getActiveResourcesInfo().filter(r => r === 'Timeout').length, timersBefore)
  assert.equal(asked, 0)
  assert.deepEqual(lines, [])
  assert.deepEqual(fs.readdirSync(tmp), [])
})
