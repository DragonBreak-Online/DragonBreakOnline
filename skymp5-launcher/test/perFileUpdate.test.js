'use strict'
// A 404 on one client file must not cost the player the whole package. Jake, 16 Oct: the per-file
// update found 3 changed files (6.2 MB), 404'd on Data/DragonBreak Hub.esp - a path the EXTRA files
// own, not the client channel - and fell back to the 169.9 MB zip. The UI is only 21 MB of the
// package, so this fallback, not the UI, is what makes an update expensive.
//
// main.js is the Electron entry point and cannot be required in a test, so these assert on its
// source the way selfUpdateInstaller.test.js does. They are regression guards, not behaviour tests:
// they catch the skip being removed, not a mistake in how it runs.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
const perFileFn = (() => {
  const start = MAIN.indexOf('async function perFileClientUpdate')
  assert.ok(start > 0, 'perFileClientUpdate still exists')
  const end = MAIN.indexOf('\nfunction ', start + 10)
  return MAIN.slice(start, end > 0 ? end : start + 6000)
})()

test('a 404 skips that file instead of falling back to the whole zip', () => {
  assert.match(perFileFn, /err\.statusCode === 404/,
    'the 404 case is told apart from a real failure')
  const skip = perFileFn.indexOf('err.statusCode === 404')
  const bail = perFileFn.indexOf('falling back to the zip', skip)
  const cont = perFileFn.indexOf('continue', skip)
  assert.ok(cont > 0 && cont < bail,
    'the 404 branch continues to the next file before any fallback')
})

test('a real failure still falls back to the zip', () => {
  assert.match(perFileFn, /falling back to the zip/,
    'network and checksum failures keep the old behaviour')
  assert.match(perFileFn, /return null/,
    'the fallback is still a null return, which the caller reads as "use the zip"')
})

test('an all-404 run still falls back, since the per-file route achieved nothing', () => {
  assert.match(perFileFn, /!done && skipped\.length/,
    'no file fetched and everything skipped means the list and the channel disagree')
})

test('a missing extra manifest is logged, not swallowed', () => {
  // With no extra list nothing is excluded, so every extra-owned path 404s. Silently continuing
  // made the resulting 170 MB download unexplainable in install.log. fetchExtraManifest is called
  // from more than one place, so this looks only inside perFileClientUpdate.
  const idx = perFileFn.indexOf('fetchExtraManifest()')
  assert.ok(idx > 0, 'perFileClientUpdate still fetches the extra manifest')
  const around = perFileFn.slice(idx, idx + 400)
  assert.match(around, /catch \(err\)/, 'the failure is captured rather than discarded')
  assert.match(around, /extra file list could not be fetched/, 'and it reaches the log')
})
