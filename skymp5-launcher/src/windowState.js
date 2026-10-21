'use strict'
// The launcher window: opens at a size that fits the screen, resizes down to a minimum, and remembers the player's size

const STORE_KEY = 'windowState'
const DEFAULT_SIZE = { width: 1280, height: 720 }
const MIN_SIZE = { width: 800, height: 540 }
const SAVE_DELAY_MS = 500
// How much of the top strip, where the window is dragged from, must be on a screen for a saved position to be used
const GRAB = { width: 160, height: 24, strip: 40 }

const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

// A saved state from the store, or null when it is missing or any number in it is not sane
function sanitize(saved) {
  if (!saved || typeof saved !== 'object') return null
  if (!num(saved.width, 100, 20000) || !num(saved.height, 100, 20000)) return null
  const out = { width: Math.round(saved.width), height: Math.round(saved.height), maximized: saved.maximized === true }
  if (num(saved.x, -100000, 100000) && num(saved.y, -100000, 100000)) { out.x = Math.round(saved.x); out.y = Math.round(saved.y) }
  return out
}

function overlap(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? { width, height } : { width: 0, height: 0 }
}

// The work area the window's top strip is most on, or null when too little of it is on any screen to grab
function grabbableArea(rect, areas) {
  const strip = { x: rect.x, y: rect.y, width: rect.width, height: GRAB.strip }
  let best = null
  let bestSize = 0
  for (const a of areas) {
    const o = overlap(strip, a)
    if (o.width >= Math.min(GRAB.width, rect.width) && o.height >= GRAB.height && o.width * o.height > bestSize) { best = a; bestSize = o.width * o.height }
  }
  return best
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// BrowserWindow size options from the saved state and the screens' work areas ({ x, y, width, height } each)
function windowOptions({ saved, workAreas = [], primary }) {
  const s = sanitize(saved)
  const areas = workAreas.filter(a => a && a.width > 0 && a.height > 0)
  const home = primary && primary.width > 0 && primary.height > 0 ? primary : areas[0] || { x: 0, y: 0, ...DEFAULT_SIZE }
  const placed = s && 'x' in s ? grabbableArea({ x: s.x, y: s.y, width: s.width, height: s.height }, areas) : null
  const area = placed || home
  const minWidth = Math.min(MIN_SIZE.width, area.width)
  const minHeight = Math.min(MIN_SIZE.height, area.height)
  const want = s || DEFAULT_SIZE
  const width = clamp(want.width, minWidth, area.width)
  const height = clamp(want.height, minHeight, area.height)
  const x = placed ? clamp(s.x, area.x, area.x + area.width - width) : area.x + Math.round((area.width - width) / 2)
  const y = placed ? clamp(s.y, area.y, area.y + area.height - height) : area.y + Math.round((area.height - height) / 2)
  return {
    bounds: { x, y, width, height, minWidth, minHeight, resizable: true, maximizable: true },
    maximized: !!(s && s.maximized),
  }
}

// Saves the window's normal size and position, and whether it is maximized, a moment after it changes and on close
function track(win, store, delay = SAVE_DELAY_MS) {
  let timer = null
  const save = () => {
    clearTimeout(timer)
    timer = null
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
    const b = win.getNormalBounds()
    store.set(STORE_KEY, { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() })
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(save, delay) }
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, later)
  win.on('close', save)
  return { save }
}

module.exports = { windowOptions, track, sanitize, STORE_KEY, DEFAULT_SIZE, MIN_SIZE }
