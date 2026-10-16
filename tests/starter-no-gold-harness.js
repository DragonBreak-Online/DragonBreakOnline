// A new character's loadout holds no gold (Nate, 16 Oct: "Gold shouldnt be apart of the load out"): the config's starterKit,
// and every item list a new character is handed from, never name gold (Gold001, 0xf:Skyrim.esm)
'use strict';
const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'gamemode-config.json'), 'utf8'));
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };
const isGold = (id) => /^0*f:skyrim\.esm$/i.test(String(id || '').trim()) || /gold/i.test(String(id || ''));
const kit = Array.isArray(cfg.starterKit) ? cfg.starterKit : [];
ok(kit.length > 0, 'the starter kit is read from gamemode-config.json', kit.length);
ok(!kit.some((it) => isGold(it.id) || /gold/i.test(String(it.name || ''))), 'the starter kit holds no gold', kit);
ok(Number(cfg.economy && cfg.economy.dominionStipend) === 0 && Number(cfg.economy && cfg.economy.imperialStipend) === 0, 'no treasury stipend makes gold from nothing', cfg.economy);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
