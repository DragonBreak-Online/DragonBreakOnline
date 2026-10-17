// NPC damage by the attacker's own base (gamemode-config npcDamage.byBase; wildlife-density-1017, players 17 Oct: bears
// two-shot steel plate). The Rift's bears stood in wild:skeever zones, so byKind could not name them. Lifts the NPC damage
// block out of gamemode.js and runs npcKindDamageMult on a stub mp and record lookup; then checks the shipped config.
//   node tests/npc-damage-bybase-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const START = '// ---- NPC power hits: how hard a creature', END = 'const hitDamageAttemptHook =';
const src = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
const a = src.indexOf(START), b = src.indexOf(END, a);
if (a < 0 || b < 0) { console.log('FAIL the NPC damage block is gone from gamemode.js'); process.exit(1); }
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };

const PLAYER = 0xff000014, PLAYER2 = 0xff000015, BEAR = 0xff000100, SKEEVER = 0xff000101, BOAR = 0xff000102, CYRBEAR = 0xff000103;
const props = new Map(); const put = (id, k, v) => props.set(id + '|' + k, v);
put(BEAR, 'private.npcSpawner', 'wild:skeever:2430'); put(BEAR, 'baseDesc', '23a8a:Skyrim.esm');
put(SKEEVER, 'private.npcSpawner', 'wild:skeever:7'); put(SKEEVER, 'baseDesc', '23ab7:Skyrim.esm');
put(BOAR, 'private.npcSpawner', 'wild:boar:p1-x'); put(BOAR, 'baseDesc', 'b0a:BSHeartland.esm');
put(CYRBEAR, 'private.npcSpawner', 'wild:bear:2853'); put(CYRBEAR, 'baseDesc', 'b0b:BSHeartland.esm');
const EDID = { 0x23a8a: 'EncBear', 0x23ab7: 'EncSkeever', 0x08000b0a: 'BSKEncBoar01', 0x08000b0b: 'CYREncBearBrown' };
let lookups = 0;
const mp = { get: (id, k) => props.get(id + '|' + k), set: (id, k, v) => props.set(id + '|' + k, v),
  getIdFromDesc: (d) => { const [h, p] = d.split(':'); return ((p === 'BSHeartland.esm' ? 0x08000000 : 0) | parseInt(h, 16)) >>> 0; } };
const recordOf = (id) => { lookups++; return EDID[id] ? { record: { editorId: EDID[id] } } : null; };
const profileOf = (x) => (x === PLAYER || x === PLAYER2 ? 7 : -1);
const load = (cfg) => new Function('mp', 'cfg', 'profileOf', 'recordOf', src.slice(a, b) + '\nreturn { npcKindDamageMult };')(mp, cfg, profileOf, recordOf);

const cfg = { npcDamage: { byKind: { boar: 0.4 }, byBase: { EncBear: 0.75, CYREncBearBrown: 0.75 } } };
const F = load(cfg);
ok(F.npcKindDamageMult(BEAR, PLAYER, 50) === 0.75, "a bear in a wild:skeever zone takes byBase.EncBear");
ok(F.npcKindDamageMult(CYRBEAR, PLAYER, 50) === 0.75, 'a Cyrodiil brown bear takes byBase.CYREncBearBrown');
ok(F.npcKindDamageMult(SKEEVER, PLAYER, 50) === 1, 'a real skeever of the same kind of zone is untouched');
ok(F.npcKindDamageMult(BOAR, PLAYER, 50) === 0.4, 'byKind still applies (boar 0.4)');
cfg.npcDamage.byBase.BSKEncBoar01 = 0.5;
ok(Math.abs(F.npcKindDamageMult(BOAR, PLAYER, 50) - 0.2) < 1e-12, 'byKind and byBase multiply when both match');
delete cfg.npcDamage.byBase.BSKEncBoar01;
ok(F.npcKindDamageMult(PLAYER, BEAR, 50) === 1 && F.npcKindDamageMult(PLAYER2, PLAYER, 50) === 1 && F.npcKindDamageMult(BEAR, SKEEVER, 50) === 1, "players' hits, PvP and bear-on-creature hits are untouched");
const before = lookups; for (let i = 0; i < 100; i++) F.npcKindDamageMult(BEAR, PLAYER, 50);
ok(lookups === before, 'the editor id is looked up once per base, not per hit');
ok(load({ npcDamage: { byKind: { boar: 0.4 } } }).npcKindDamageMult(BEAR, PLAYER, 50) === 1 && load({}).npcKindDamageMult(BEAR, PLAYER, 50) === 1, 'no byBase: bears unchanged');

const C = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));
const bb = C.npcDamage.byBase;
ok(Object.keys(bb).length === 0, 'shipped: byBase empty, bears hit at full strength (Nate 17 Oct: players like the danger)', bb);
ok(Object.keys(bb).every((k) => /Bear/.test(k)), 'shipped byBase names bears only (no draugr, no undead)');
// measured 16-17 Oct: bear hits 13.9-31.6% of a player's health (median 21.3%, 603 hits)
console.log(`  a bear's worst measured hit 31.6% -> ${(31.6 * 0.75).toFixed(1)}%, median 21.3% -> ${(21.3 * 0.75).toFixed(1)}%`);
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
