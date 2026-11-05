'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  FPS_LIMITS,
  FPS_MAX_TIME,
  normalizeFps,
  buildIniContent,
  sseDisplayTweaksCustomPath,
  readFpsLimitFromIni,
  writeSseDisplayTweaksCustom,
} = require('../src/fpsLimit')

test('fpsLimit: normalizeFps defaults to 60 for invalid or empty values', () => {
  assert.strictEqual(normalizeFps(''), '60')
  assert.strictEqual(normalizeFps(null), '60')
  assert.strictEqual(normalizeFps('random'), '60')
  assert.strictEqual(normalizeFps('30'), '60')
  assert.strictEqual(normalizeFps('60'), '60')
  assert.strictEqual(normalizeFps('60.0'), '60')
  assert.strictEqual(normalizeFps('90'), '90')
  assert.strictEqual(normalizeFps('120'), '120')
  assert.strictEqual(normalizeFps('144'), '144')
})

test('fpsLimit: buildIniContent sets correct FramerateLimit and fMaxTime', () => {
  const ini60 = buildIniContent('60')
  assert.match(ini60, /FramerateLimit=60\.0/)
  assert.match(ini60, /fMaxTime=0\.01666667/)
  assert.match(ini60, /LimitLoadingScreens=60\.0/)
  assert.match(ini60, /LimitMenu=60\.0/)

  const ini90 = buildIniContent('90')
  assert.match(ini90, /FramerateLimit=90\.0/)
  assert.match(ini90, /fMaxTime=0\.01111111/)

  const ini120 = buildIniContent('120')
  assert.match(ini120, /FramerateLimit=120\.0/)
  assert.match(ini120, /fMaxTime=0\.00833333/)
  assert.match(ini120, /LimitLoadingScreens=60\.0/)
  assert.match(ini120, /LimitMenu=60\.0/)

  const ini144 = buildIniContent('144')
  assert.match(ini144, /FramerateLimit=144\.0/)
  assert.match(ini144, /fMaxTime=0\.00694444/)
})

test('fpsLimit: writeSseDisplayTweaksCustom and readFpsLimitFromIni round-trip', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fps-test-'))
  try {
    for (const fps of FPS_LIMITS) {
      const ok = writeSseDisplayTweaksCustom(tmp, fps)
      assert.strictEqual(ok, true)
      const p = sseDisplayTweaksCustomPath(tmp)
      assert.strictEqual(fs.existsSync(p), true)
      const readBack = readFpsLimitFromIni(p)
      assert.strictEqual(readBack, fps)
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})