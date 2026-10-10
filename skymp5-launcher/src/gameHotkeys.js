'use strict'
// Settings, game hotkeys: the keyboard and mouse columns of a controlmap.txt event (the file's 2nd and 3rd fields).
// A code is a DirectInput scan code, or a mouse button as 256 + its DirectInput index (Middle Mouse 258 .. 263), the
// numbering the renderer and the client share. The mouse column takes the bare index: 0 left, 1 right, 2 middle,
// 3-7 the side buttons (the vanilla map binds Right Attack/Block 0x0 and Left Attack/Block 0x1 there).

const GAME_HOTKEY_EVENTS = ['Activate', 'Jump', 'Sprint', 'Sneak', 'Shout', 'Toggle POV']
const MOUSE_KEY_FIRST = 258
const MOUSE_KEY_LAST = 263
const UNBOUND = 0xff

const isMouseKey = (code) => Number.isInteger(code) && code >= MOUSE_KEY_FIRST && code <= MOUSE_KEY_LAST
const isKeyboardKey = (code) => Number.isInteger(code) && code > 0 && code < UNBOUND

// The event's first line: 1 head, 2 keyboard, 3 gap, 4 mouse
function columnsRe(ev) {
  const escaped = ev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('^(' + escaped + '[ \\t]+)(0x[0-9a-fA-F]+)([ \\t]+)(0x[0-9a-fA-F]+)', 'm')
}

// The keyboard key, else a bindable mouse button, else null
function gameHotkeyCode(text, ev) {
  const m = text.match(columnsRe(ev))
  if (!m) return null
  const kb = parseInt(m[2], 16)
  if (isKeyboardKey(kb)) return kb
  const mouse = parseInt(m[4], 16) + 256
  return isMouseKey(mouse) ? mouse : null
}

// A key unbinds the mouse column and a mouse button the keyboard column, as the game's own remap does
function setGameHotkey(text, ev, code) {
  const mouse = isMouseKey(code)
  if (!mouse && !isKeyboardKey(code)) return text
  const hex = (n) => '0x' + n.toString(16)
  const kbCol = mouse ? hex(UNBOUND) : hex(code)
  const mouseCol = mouse ? hex(code - 256) : hex(UNBOUND)
  return text.replace(columnsRe(ev), (_m, head, _kb, gap) => head + kbCol + gap + mouseCol)
}

module.exports = { GAME_HOTKEY_EVENTS, gameHotkeyCode, setGameHotkey, isMouseKey }
