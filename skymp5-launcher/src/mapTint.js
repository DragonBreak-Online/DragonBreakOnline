'use strict'
// The world map's territory colours (Nat, 2 Nov: each player may switch them off). They are level-32 terrain textures:
// with MO2 they ship as one managed mod, in direct mode as DragonBreak extra files. Off: the mod's modlist.txt line is
// '-' and the extra files are left out and removed, so the game shows its own map tiles again.

const MOD_NAME = 'DragonBreak Real Borders Map'
// A file only the territory-colour mod ships (no other mod in the list has Tamriel's level-32 tiles), to find its folder
const PROBE_FILE = 'textures/terrain/tamriel/tamriel.32.0.0.dds'
// <world>.32.<x>.<y>.dds under textures/terrain/<world>/: a level-32 terrain diffuse, never a normal map
const TILE = /^data\/textures\/terrain\/([^/]+)\/\1\.32\.-?\d+\.-?\d+\.dds$/i

const isTintFile = (p) => TILE.test(String(p || '').replace(/\\/g, '/'))

// The extra files to install: all of them, or all but the territory colours when they are off
const keepExtras = (entries, off) => (off ? entries.filter(f => !isTintFile(f && f.path)) : entries)

// The manifest mods to write '-' in modlist.txt when the territory colours are off
const disabledMods = (manifest, off) =>
  off ? (manifest && Array.isArray(manifest.mods) ? manifest.mods : []).filter(m => m && m.name === MOD_NAME).map(m => m.name) : []

module.exports = { MOD_NAME, PROBE_FILE, isTintFile, keepExtras, disabledMods }
