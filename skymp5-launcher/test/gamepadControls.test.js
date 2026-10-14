'use strict'
// Settings > Use a controller also switches DragonBreak's controller buttons and the panel pointer: every launch writes
// gamepadControls into skymp5-client-settings.txt from the same switch (client gamepadKeys.ts reads it, on when absent).
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8')
const writer = (main.match(/function writeClientSettings\(destPath, srv, serverInfo\) \{[\s\S]*?\n\}/) || [''])[0]

test('every launch writes gamepadControls from Use a controller', () => {
  assert.match(writer, /settings\['gamepadControls'\] = !!store\.get\('controllerEnabled'\)/)
})

test('the switch is the one the Settings page saves', () => {
  assert.match(main, /ipcMain\.handle\('controller:set', \(_e, on\) => \{ store\.set\('controllerEnabled', !!on\)/)
})

test('the Settings hint names the panel pointer and the new buttons', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8')
  assert.match(html, /id="set-controller"/)
  assert.match(html, /right stick moves a pointer, A clicks, B closes/)
  assert.match(html, /LB for skills/)
})
