'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

// The launcher seeds this file into the game's Data/Interface/Controls/PC/controlmap.txt. The game's parser needs
// CRLF: with LF-only endings it stops at the first context break, so every context after Gameplay is lost and
// keybinds, the menu cursor and the voice keys stop working. A Linux launcher build has shipped an LF-only seed
// twice (2.1.31 and again on main after the launcher line diverged), which is why this is a test and not a comment.
const SEED = path.join(__dirname, '..', 'assets', 'controlmap.txt')

test('the controlmap seed is CRLF throughout', () => {
  const buf = fs.readFileSync(SEED)
  const lf = buf.filter(b => b === 0x0a).length
  const crlf = buf.filter((b, i) => b === 0x0a && buf[i - 1] === 0x0d).length
  assert.ok(lf > 0, 'the seed has no lines at all')
  assert.strictEqual(crlf, lf, `${lf - crlf} of ${lf} lines are LF-only; the game would lose every context after Gameplay`)
})

test('the seed still declares every input context the game expects', () => {
  const text = fs.readFileSync(SEED, 'utf8')
  // A truncated or re-saved seed is the other way this file has broken, so check the contexts are all present.
  for (const ctx of ['Gameplay', 'Menu Mode', 'Console', 'Cursor', 'Favorites']) {
    assert.ok(text.includes(ctx), `the "${ctx}" context is missing from the seed`)
  }
})

// Vanilla ChargeItem (the Inventory's "Charge") borrows Wait's keys with "!0,Wait", and the seed unbinds Wait, so no
// enchanted weapon could be recharged (Thievyn Morethi, 21 Oct: "Cant recharge items, cos key is unbound").
test('the seed binds ChargeItem to T itself and keeps Wait unbound', () => {
  const text = fs.readFileSync(SEED, 'utf8')
  const charge = text.match(/^ChargeItem[ \t]+(\S+)[ \t]+(\S+)[ \t]+(\S+)/m)
  assert.ok(charge, 'ChargeItem is missing from the seed')
  assert.strictEqual(charge[1], '0x14', 'ChargeItem must have its own keyboard key (T)')
  assert.ok(!/Wait/.test(charge[0]), 'ChargeItem must not borrow Wait\'s unbound keys')
  const wait = text.match(/^Wait[ \t]+(\S+)[ \t]+\S+[ \t]+(\S+)/m)
  assert.deepStrictEqual([wait[1], wait[2]], ['0xff', '0xff'], 'Wait stays unbound on keyboard and gamepad')
})

test('main.js counts a launcher copy whose ChargeItem still borrows Wait as stale, so it is rebuilt', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
  const fn = src.match(/function isStaleLauncherControlmap\(text\) \{[\s\S]*?\n\}/)[0]
  const isStale = new Function(`${fn}; return isStaleLauncherControlmap`)()
  const seed = fs.readFileSync(SEED, 'utf8')
  assert.strictEqual(isStale(seed), false, 'the current seed is not stale')
  const old = seed.replace(/^ChargeItem\t0x14\t0xff\t/m, 'ChargeItem\t!0,Wait\t!0,Wait\t')
  assert.notStrictEqual(old, seed)
  assert.strictEqual(isStale(old), true, 'a copy with ChargeItem on Wait is rebuilt')
  assert.strictEqual(isStale(old.replace('launcher controlmap override', 'my own map')), false, 'a player\'s own map is never touched')
})
