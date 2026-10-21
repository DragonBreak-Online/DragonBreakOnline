'use strict'
// The launcher window (src/windowState.js): fits the screen, resizes down to a minimum, remembers the player's size
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { windowOptions, track, sanitize, STORE_KEY, MIN_SIZE } = require('../src/windowState')

const FHD = { x: 0, y: 0, width: 1920, height: 1040 }
const one = (saved, area = FHD) => windowOptions({ saved, workAreas: [area], primary: area })

test('a first start opens at 1280 x 720 in the middle of the main screen, resizable down to 800 x 540', () => {
  const o = one(undefined)
  assert.deepStrictEqual(o.bounds, { x: 320, y: 160, width: 1280, height: 720, minWidth: 800, minHeight: 540, resizable: true, maximizable: true })
  assert.strictEqual(o.maximized, false)
  assert.deepStrictEqual(MIN_SIZE, { width: 800, height: 540 })
})

test('a small screen gets a window that fits it, and the minimum is never larger than the screen', () => {
  // 1366 x 768 at 125%, less the taskbar
  const laptop = one(null, { x: 0, y: 0, width: 1093, height: 582 })
  assert.deepStrictEqual(laptop.bounds, { x: 0, y: 0, width: 1093, height: 582, minWidth: 800, minHeight: 540, resizable: true, maximizable: true })
  const tiny = one(null, { x: 0, y: 0, width: 760, height: 500 })
  assert.strictEqual(tiny.bounds.width, 760)
  assert.strictEqual(tiny.bounds.height, 500)
  assert.strictEqual(tiny.bounds.minWidth, 760)
  assert.strictEqual(tiny.bounds.minHeight, 500)
})

test('the saved size and position come back while the window can still be grabbed on a screen', () => {
  const o = one({ x: 100, y: 50, width: 1000, height: 650, maximized: false })
  assert.deepStrictEqual([o.bounds.x, o.bounds.y, o.bounds.width, o.bounds.height], [100, 50, 1000, 650])
  // A second screen to the left of the main one has negative x
  const left = { x: -1920, y: 0, width: 1920, height: 1040 }
  const two = windowOptions({ saved: { x: -1500, y: 40, width: 900, height: 600 }, workAreas: [left, FHD], primary: FHD })
  assert.deepStrictEqual([two.bounds.x, two.bounds.y, two.bounds.width, two.bounds.height], [-1500, 40, 900, 600])
})

test('a saved position on a screen that is gone, or with the top strip off every screen, opens centred at the saved size', () => {
  for (const saved of [{ x: 2600, y: 100, width: 1000, height: 650 }, { x: 100, y: -600, width: 1000, height: 650 }, { width: 1000, height: 650 }]) {
    const o = one(saved)
    assert.deepStrictEqual([o.bounds.x, o.bounds.y, o.bounds.width, o.bounds.height], [460, 195, 1000, 650], JSON.stringify(saved))
  }
})

test('saved sizes are kept between the minimum and the screen, and a window hanging off an edge is pulled back on', () => {
  const big = one({ x: 0, y: 0, width: 3000, height: 2000 })
  assert.deepStrictEqual([big.bounds.width, big.bounds.height], [1920, 1040])
  const small = one({ x: 10, y: 10, width: 300, height: 200 })
  assert.deepStrictEqual([small.bounds.width, small.bounds.height], [800, 540])
  // 220 px of the top strip still on screen: grabbable, so it stays on this screen, moved fully onto it
  const edge = one({ x: 1700, y: 900, width: 1000, height: 650 })
  assert.deepStrictEqual([edge.bounds.x, edge.bounds.y], [920, 390])
})

test('broken saved values are ignored', () => {
  for (const saved of ['garbage', 42, [], { width: '1000', height: 650 }, { width: NaN, height: 650 }, { width: 1e9, height: 650 }, { width: 1000 }]) {
    assert.strictEqual(sanitize(saved), null, JSON.stringify(saved))
    assert.deepStrictEqual(one(saved).bounds, one(undefined).bounds)
  }
  assert.deepStrictEqual(sanitize({ x: 'a', y: 5, width: 1000.4, height: 650 }), { width: 1000, height: 650, maximized: false })
})

test('a window closed maximized opens maximized, at its earlier normal size underneath', () => {
  const o = one({ x: 100, y: 50, width: 1000, height: 650, maximized: true })
  assert.strictEqual(o.maximized, true)
  assert.strictEqual(o.bounds.width, 1000)
  assert.strictEqual(one({ x: 100, y: 50, width: 1000, height: 650, maximized: 'yes' }).maximized, false)
})

function fakeWin(bounds) {
  const on = {}
  const w = {
    bounds, maximized: false, minimized: false, destroyed: false,
    on: (ev, fn) => { (on[ev] = on[ev] || []).push(fn) },
    fire: ev => { for (const fn of on[ev] || []) fn() },
    getNormalBounds: () => ({ ...w.bounds }),
    isMaximized: () => w.maximized,
    isMinimized: () => w.minimized,
    isFullScreen: () => false,
    isDestroyed: () => w.destroyed,
  }
  return w
}
const fakeStore = () => { const data = {}; return { data, writes: [], set(k, v) { data[k] = v; this.writes.push(k) } } }
const wait = ms => new Promise(r => setTimeout(r, ms))

test('the size is saved once, a moment after the resizing stops, and at once on close', async () => {
  const win = fakeWin({ x: 10, y: 20, width: 1100, height: 700 })
  const store = fakeStore()
  track(win, store, 15)
  for (let i = 0; i < 5; i++) { win.bounds.width += 10; win.fire('resize') }
  win.fire('move')
  assert.strictEqual(store.writes.length, 0, 'nothing is written while the edge is being dragged')
  await wait(40)
  assert.strictEqual(store.writes.length, 1)
  assert.deepStrictEqual(store.data[STORE_KEY], { x: 10, y: 20, width: 1150, height: 700, maximized: false })
  win.maximized = true
  win.fire('maximize')
  win.fire('close')
  assert.strictEqual(store.writes.length, 2, 'close saves at once and cancels the pending save')
  assert.strictEqual(store.data[STORE_KEY].maximized, true)
  await wait(40)
  assert.strictEqual(store.writes.length, 2)
})

test('a minimized or destroyed window saves nothing, so the last good size is kept', async () => {
  const win = fakeWin({ x: -32000, y: -32000, width: 160, height: 28 })
  const store = fakeStore()
  track(win, store, 5)
  win.minimized = true
  win.fire('resize')
  win.fire('close')
  win.minimized = false
  win.destroyed = true
  win.fire('close')
  await wait(20)
  assert.strictEqual(store.writes.length, 0)
})

test('what is saved reads back as the same window', () => {
  const win = fakeWin({ x: 200, y: 120, width: 1024, height: 700 })
  const store = fakeStore()
  track(win, store).save()
  assert.deepStrictEqual(one(store.data[STORE_KEY]).bounds, { x: 200, y: 120, width: 1024, height: 700, minWidth: 800, minHeight: 540, resizable: true, maximizable: true })
})

test('main.js opens the window from windowState, resizable and frameless, tracks it and restores maximized', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
  const create = main.slice(main.indexOf('function createWindow()'), main.indexOf('app.whenReady()'))
  assert.match(create, /windowState\.windowOptions\(\{\s*saved:\s*store\.get\(windowState\.STORE_KEY\),\s*workAreas:\s*screen\.getAllDisplays\(\)\.map\(d => d\.workArea\),\s*primary:\s*screen\.getPrimaryDisplay\(\)\.workArea,\s*\}\)/)
  assert.match(create, /new BrowserWindow\(\{\s*\.\.\.size\.bounds,\s*frame:\s*false,\s*resizable:\s*true,/)
  assert.doesNotMatch(create, /\bwidth:\s*\d|\bheight:\s*\d|minWidth:\s*\d|minHeight:\s*\d/, 'no fixed size left in createWindow')
  assert.match(create, /windowState\.track\(win, store\)/)
  assert.match(create, /win\.once\('ready-to-show', \(\) => \{\s*if \(size\.maximized\) win\.maximize\(\)\s*win\.show\(\)/)
  assert.match(main, /windowState:\s*null,/, 'the store has a default for it')
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'src')).filter(n => n.endsWith('.js'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), /resizable:\s*false|setResizable\(\s*false|setMaximumSize|maxWidth|maxHeight/, f)
  }
})

test('the page follows the window from the minimum up: bars keep their controls, panels fit, breakpoints sit above the minimum', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8')
  const rule = sel => {
    const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.-]/g, '\\$&')}\\s*\\{([^}]*)\\}`))
    assert.ok(m, `styles.css has a top-level rule for ${sel}`)
    return m[1]
  }
  assert.match(rule('.topbar-right'), /flex-shrink:\s*0/, 'the window buttons never squeeze out')
  assert.match(rule('.topbar-nav'), /min-width:\s*0/)
  assert.match(rule('.bottombar-right'), /flex-shrink:\s*0/, 'Play never squeezes out')
  assert.match(rule('.bottombar-info'), /flex:\s*1;[\s\S]*min-width:\s*0/)
  assert.match(rule('.modal-box'), /max-width:\s*calc\(100vw - \d+px\);\s*max-height:\s*calc\(100vh - \d+px\)/, 'every panel fits the window')
  const points = [...css.matchAll(/@media[^{]*\{/g)].flatMap(m => [...m[0].matchAll(/max-(width|height):\s*(\d+)px/g)].map(p => [p[1], Number(p[2])]))
  assert.ok(points.length >= 4)
  for (const [dim, px] of points) assert.ok(px > MIN_SIZE[dim], `@media max-${dim}: ${px}px is above the ${MIN_SIZE[dim]} px minimum`)
})
