// Every boss has a teleport, all in one place (Nat 26 Oct: "Where is the TP for all of the bosses? I don't see the werewolf
// one either"; his standing rule of 25 Oct: always update the teleports). tools/bosses/bosses_build.py writes them into
// admin-locations.json from bosses.json; this checks the shipped pair agree: one 'Boss: ' row per spot of every boss, dev-only
// bosses included and marked, all in the Bosses group, 64 units above the spot in the boss's own worldspace.
//   node tests/boss-teleports-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };
const bosses = JSON.parse(fs.readFileSync(path.join(ROOT, 'bosses.json'), 'utf8')).bosses;
const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'admin-locations.json'), 'utf8')).locations.filter((r) => String(r.name).startsWith('Boss: '));
const spots = bosses.flatMap((b) => b.spots.map((sp) => ({ b, sp })));
ok(rows.length === spots.length, `one teleport per boss spot (${spots.length})`, [rows.length, spots.length]);
ok(rows.every((r) => r.region === 'Bosses'), 'every boss teleport is in the Bosses group', [...new Set(rows.map((r) => r.region))]);
const missing = spots.filter(({ b, sp }) => !rows.some((r) => r.name.startsWith(`Boss: ${b.name}`) && r.world === b.world
  && Math.abs(r.pos[0] - sp.pos[0]) < 0.01 && Math.abs(r.pos[1] - sp.pos[1]) < 0.01 && Math.abs(r.pos[2] - (sp.pos[2] + 64)) < 0.01));
ok(!missing.length, 'each spot has its teleport, 64 units above it, in the boss\'s worldspace', missing.map(({ b, sp }) => `${b.id} ${sp.id}`));
ok(rows.some((r) => /Behemoth of Hircine/.test(r.name) && /\(dev test\)$/.test(r.name)), 'the werewolf Behemoth (dev only) has its teleports, marked (dev test)');
ok(rows.filter((r) => /\(dev test\)$/.test(r.name)).every((r) => bosses.some((b) => b.devOnly && r.name.startsWith(`Boss: ${b.name}`))), '...and only dev-only bosses are marked so');
ok(rows.some((r) => r.name === 'Boss: the Wraith of the Ice Cap, Skytemple Ruins (Winterhold)'), 'the Wraith\'s teleport is at Skytemple Ruins');
ok(!rows.some((r) => /Ice Cap, S[1-4]/.test(r.name)), '...and the retired S1-S4 teleports are gone');
console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
