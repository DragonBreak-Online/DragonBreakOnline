'use strict'
// Settings, game hotkeys: a key goes in the controlmap's keyboard column, a mouse button in its mouse column.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { GAME_HOTKEY_EVENTS, gameHotkeyCode, setGameHotkey } = require('../src/gameHotkeys')

const seed = fs.readFileSync(path.join(__dirname, '..', 'assets', 'controlmap.txt'), 'utf8')
const fields = (text, ev) => text.split('\r\n').find((l) => l.startsWith(ev + '\t')).split(/\t+/)

test('the seed reads as the vanilla keys', () => {
  assert.deepStrictEqual(GAME_HOTKEY_EVENTS.map((ev) => gameHotkeyCode(seed, ev)), [0x12, 0x39, 0x38, 0x1d, 0x2c, 0x21])
})

test('a mouse button goes in the mouse column and unbinds the keyboard one', () => {
  for (const [code, col] of [[258, '0x2'], [259, '0x3'], [260, '0x4'], [263, '0x7']]) {
    const text = setGameHotkey(seed, 'Shout', code)
    const f = fields(text, 'Shout')
    assert.strictEqual(f[1], '0xff')
    assert.strictEqual(f[2], col)
    assert.strictEqual(f[3], '0x0200', 'the gamepad column is kept')
    assert.strictEqual(gameHotkeyCode(text, 'Shout'), code)
  }
})

test('a key goes back in the keyboard column and unbinds the mouse one', () => {
  const text = setGameHotkey(setGameHotkey(seed, 'Sneak', 260), 'Sneak', 0x2e)
  const f = fields(text, 'Sneak')
  assert.deepStrictEqual(f.slice(1, 4), ['0x2e', '0xff', '0x0040'])
  assert.strictEqual(gameHotkeyCode(text, 'Sneak'), 0x2e)
})

test('only the one event changes, and the file keeps its CRLF line endings and its length in lines', () => {
  const text = setGameHotkey(seed, 'Activate', 259)
  const a = seed.split('\r\n'), b = text.split('\r\n')
  assert.strictEqual(a.length, b.length)
  assert.deepStrictEqual(a.map((l, i) => l === b[i] ? 0 : i).filter(Boolean), [a.findIndex((l) => l.startsWith('Activate\t'))])
  assert.ok(!/[^\r]\n/.test(text))
})

test('left and right click, the wheel and out-of-range codes are refused', () => {
  for (const code of [0, 0xff, 256, 257, 264, 265, -1, 1.5, 300]) assert.strictEqual(setGameHotkey(seed, 'Jump', code), seed, String(code))
})

test('a mouse column holding an attack button or the wheel reads as no hotkey', () => {
  const text = seed.replace(/^(Jump\t+)0x39(\t+)0xff/m, '$10xff$20x1')
  assert.strictEqual(gameHotkeyCode(text, 'Jump'), null)
})
