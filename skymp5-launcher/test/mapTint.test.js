'use strict'
// The world map's territory colours can be switched off in Settings (Nat, 2 Nov). With MO2 the colour mod stays installed
// and its modlist.txt line is '-', kept through every reinstall; in direct mode its extra files are left out.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const mo2 = require('../src/mo2')
const mapTint = require('../src/mapTint')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-launcher-maptint-'))
mo2.setRootProvider(() => root)
mo2.setLogger(() => {})
test.after(() => fs.rmSync(root, { recursive: true, force: true }))

const mod = (name, rel) => {
  const dir = path.join(mo2.getModsDir(), name)
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
  fs.writeFileSync(path.join(dir, rel), 'x')
}
mod(mapTint.MOD_NAME, 'textures/terrain/tamriel/tamriel.32.0.0.dds')
mod(mapTint.MOD_NAME, 'textures/terrain/bsheartland/bsheartland.32.0.32.dds')
mod('A Quality World Map', 'textures/interface/map/worldmap.dds')
const modlist = () => fs.readFileSync(path.join(mo2.getProfileDir(), 'modlist.txt'), 'utf8')

test('a level-32 terrain diffuse of any world is a colour tile; normals, other levels and other paths are not', () => {
  assert.ok(mapTint.isTintFile('Data/textures/terrain/tamriel/tamriel.32.-32.64.dds'))
  assert.ok(mapTint.isTintFile('Data\\textures\\terrain\\bsheartland\\bsheartland.32.0.32.dds'))
  assert.ok(mapTint.isTintFile('data/Textures/Terrain/Tamriel/tamriel.32.0.0.DDS'))
  assert.ok(!mapTint.isTintFile('Data/textures/terrain/tamriel/tamriel.32.0.0_n.dds'))
  assert.ok(!mapTint.isTintFile('Data/textures/terrain/tamriel/tamriel.16.0.32.dds'))
  assert.ok(!mapTint.isTintFile('Data/textures/terrain/tamriel/bsheartland.32.0.0.dds'))
  assert.ok(!mapTint.isTintFile('Data/meshes/terrain/tamriel/tamriel.32.0.0.btr'))
  assert.ok(!mapTint.isTintFile('Data/textures/terrain/tamriel/tamriel.32.0.0.dds.bak'))
  assert.ok(!mapTint.isTintFile(undefined))
})

test('extra files: all when the colours are on, all but the colour tiles when off', () => {
  const entries = [
    { path: 'Data/textures/terrain/tamriel/tamriel.32.0.0.dds' },
    { path: 'Data/DragonBreak.esp' },
    { path: 'Data/textures/terrain/tamriel/tamriel.16.0.0.dds' },
  ]
  assert.deepEqual(mapTint.keepExtras(entries, false), entries)
  assert.deepEqual(mapTint.keepExtras(entries, true).map(e => e.path),
    ['Data/DragonBreak.esp', 'Data/textures/terrain/tamriel/tamriel.16.0.0.dds'])
})

test('the manifest mod written - is the colour mod, only when the colours are off', () => {
  const manifest = { mods: [{ name: 'A Quality World Map' }, { name: mapTint.MOD_NAME }, null] }
  assert.deepEqual(mapTint.disabledMods(manifest, true), [mapTint.MOD_NAME])
  assert.deepEqual(mapTint.disabledMods(manifest, false), [])
  assert.deepEqual(mapTint.disabledMods({}, true), [])
  assert.deepEqual(mapTint.disabledMods(null, true), [])
})

test("the mod name is the install manifest's own (manifest-fragment.json, 2 Nov)", () => {
  assert.equal(mapTint.MOD_NAME, 'DragonBreak Real Borders Map')
})

test('the colour mod is found by the file only it ships', () => {
  assert.equal(mo2.findModWithFile(mapTint.PROBE_FILE), mapTint.MOD_NAME)
})

test('an install with the colours off writes the colour mod -, the rest +, and keeps it so on reinstall', () => {
  const order = ['A Quality World Map', mapTint.MOD_NAME]
  mo2.setModlistOrder(order, new Set(mapTint.disabledMods({ mods: order.map(name => ({ name })) }, true)))
  assert.match(modlist(), /^\+A Quality World Map\r$/m)
  assert.match(modlist(), new RegExp(`^-${mapTint.MOD_NAME}\\r$`, 'm'))
  assert.equal(mo2.isModEnabled(mapTint.MOD_NAME), false)
  mo2.setModlistOrder(order, new Set(mapTint.disabledMods({ mods: order.map(name => ({ name })) }, true)))
  assert.equal(mo2.isModEnabled(mapTint.MOD_NAME), false)
})

test('switching it back on in Settings flips the line in place; an install with the colours on writes +', () => {
  assert.equal(mo2.setModEnabled(mapTint.MOD_NAME, true), true)
  assert.equal(mo2.isModEnabled(mapTint.MOD_NAME), true)
  const lines = modlist().split(/\r?\n/).filter(l => /^[+-]/.test(l))
  assert.deepEqual(lines, ['+A Quality World Map', `+${mapTint.MOD_NAME}`])
  mo2.setModlistOrder(['A Quality World Map', mapTint.MOD_NAME], new Set(mapTint.disabledMods({ mods: [{ name: mapTint.MOD_NAME }] }, false)))
  assert.equal(mo2.isModEnabled(mapTint.MOD_NAME), true)
})
