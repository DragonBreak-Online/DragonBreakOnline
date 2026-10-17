// npctoughness.js (config npcToughness; Nate, 17 Oct: draugr "too strong"): a family of creatures by race, judged after
// the template chain, takes a player's side's hits as if its health were bent above a knee, and its own hits on players
// are scaled by dealt. Runs the module on stub records; checks the shipped config and gamemode.js's wiring; prints the
// hits a player needs before and after, against the draugr's real health (the 140-plugin order, 17 Oct).
//   node tests/npc-toughness-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };

// ---- stub records: a race, NPC_ with ACBS template flags and TPLT, a LVLN ------------------------------------------------
const DRAUGR_RACE = 0x00000d53, NORD_RACE = 0x00013746;
const ids = { 'd53:Skyrim.esm': DRAUGR_RACE, '13746:Skyrim.esm': NORD_RACE, 'f71dc:Skyrim.esm': 0xf71dc, '2a6fd:Dragonborn.esm': 0x0402a6fd };
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
const acbs = (tflags) => { const b = new Uint8Array(24); new DataView(b.buffer).setUint16(18, tflags, true); return b; };
const lvlo = (id) => { const b = new Uint8Array(12); new DataView(b.buffer).setUint32(4, id >>> 0, true); return b; };
const npc = (edid, race, tplt, tflags) => ({ record: { type: 'NPC_', editorId: edid, fields: [{ type: 'ACBS', data: acbs(tflags || 0) }].concat(race ? [{ type: 'RNAM', data: u32(race) }] : []).concat(tplt ? [{ type: 'TPLT', data: u32(tplt) }] : []) }, toGlobalRecordId: (x) => x });
const RECORDS = {
  0x100: npc('DraugrTemplate', DRAUGR_RACE),
  0x101: npc('EncDraugr05Melee1HHeadM02', NORD_RACE, 0x100, 0x01),   // takes its race from the template (Use Traits)
  0x102: npc('EncDraugrWrongFlag', NORD_RACE, 0x100, 0x02),          // a template for stats only: its own race counts
  0x103: npc('EncBandit06Melee1HNordM', NORD_RACE),
  0x104: { record: { type: 'LVLN', editorId: 'LCharDraugr', fields: [{ type: 'LVLO', data: lvlo(0x103) }, { type: 'LVLO', data: lvlo(0x101) }] }, toGlobalRecordId: (x) => x },
};
const PLAYER = 0xff000014, PLAYER2 = 0xff000015, DRAUGR = 0xff000100, BANDIT = 0xff000101, SUMMON = 0xff000102, STRAY = 0xff000103, FAKE = 0xff000104;
const props = new Map(); const put = (id, k, v) => props.set(id + '|' + k, v);
put(DRAUGR, 'baseDesc', '101:Test.esp'); put(BANDIT, 'baseDesc', '103:Test.esp'); put(FAKE, 'baseDesc', '102:Test.esp');
put(SUMMON, 'baseDesc', '103:Test.esp'); put(SUMMON, 'ff_companionOf', PLAYER); put(STRAY, 'baseDesc', '101:Test.esp'); put(STRAY, 'ff_companionOf', DRAUGR);
const mp = {
  get: (id, k) => props.get(id + '|' + k),
  getIdFromDesc: (d) => { if (d in ids) return ids[d]; const [h, p] = String(d).split(':'); if (p === 'Test.esp') return parseInt(h, 16); throw new Error('no desc ' + d); },
};
const profileOf = (a) => (a === PLAYER || a === PLAYER2 ? 7 : -1);
const recordOf = (id) => RECORDS[id] || null;
const KIND = { races: ['d53:Skyrim.esm', 'f71dc:Skyrim.esm', '2a6fd:Dragonborn.esm'], knee: 200, slope: 0.4, dealt: 0.75 };
const load = (c) => { delete require.cache[path.join(SERVER, 'npctoughness.js')]; delete globalThis.__dboToughnessCache; return require(path.join(SERVER, 'npctoughness.js'))({ mp, cfg: c, log: () => {}, profileOf, recordOf }); };
const T = load({ npcToughness: { enabled: true, kinds: { draugr: KIND } } });

ok(T.kindOf(DRAUGR) === 'draugr', 'an NPC whose template gives it DraugrRace (Use Traits) is a draugr');
ok(T.kindOf(BANDIT) === '' && T.kindOf(FAKE) === '', 'a Nord bandit is not, nor an NPC whose template gives stats only (its own race counts)');
ok(T.kindOf(PLAYER) === '', "a player's character never is");
ok(T.kindOfBase('104:Test.esp') === 'draugr', 'a leveled list counts as a draugr when an entry it can pick is one');
const H = (max) => ({ targetMaxHealth: max });
const near = (a, b) => Math.abs(a - b) < 1e-9;
ok(T.takenMult(PLAYER, DRAUGR, 10, H(150)) === 1 && T.takenMult(PLAYER, DRAUGR, 10, H(200)) === 1, 'at or below the knee (200) a draugr takes hits as dealt');
ok(near(T.takenMult(PLAYER, DRAUGR, 10, H(960)), 960 / 504), 'a 960-health Deathlord takes hits as if it had 504 (x1.90)', T.takenMult(PLAYER, DRAUGR, 10, H(960)));
ok(near(T.takenMult(PLAYER, DRAUGR, 10, H(700)), 700 / 400), 'a 700-health Scourge as if 400 (x1.75)');
ok(near(T.takenMult(SUMMON, DRAUGR, 10, H(700)), 700 / 400), "a player's summon or companion (ff_companionOf names a player) counts as the player's side");
ok(T.takenMult(STRAY, DRAUGR, 10, H(700)) === 1 && T.takenMult(BANDIT, DRAUGR, 10, H(700)) === 1, 'an NPC on a draugr is untouched (dungeon fights, an NPC fighting for an NPC)');
ok(T.takenMult(PLAYER, BANDIT, 10, H(700)) === 1, 'a bandit is untouched');
ok(T.takenMult(PLAYER, DRAUGR, 10, {}) === 1 && T.takenMult(PLAYER, DRAUGR, 0, H(700)) === 1, 'no max health from the server, or a hit for nothing: untouched');
ok(T.dealtMult(DRAUGR, PLAYER, 20) === 0.75, "a draugr's hit on a player takes dealt (0.75)");
ok(T.dealtMult(DRAUGR, SUMMON, 20) === 1 && T.dealtMult(DRAUGR, BANDIT, 20) === 1, '...not its hit on a summon or an NPC');
ok(T.dealtMult(BANDIT, PLAYER, 20) === 1 && T.dealtMult(PLAYER2, PLAYER, 20) === 1, "a bandit's hit and PvP are untouched");
const OFF = load({ npcToughness: { enabled: false, kinds: { draugr: KIND } } });
ok(OFF.kindOf(DRAUGR) === '' && OFF.takenMult(PLAYER, DRAUGR, 10, H(960)) === 1 && OFF.dealtMult(DRAUGR, PLAYER, 20) === 1, 'enabled false: nothing changes');
ok(load({}).takenMult(PLAYER, DRAUGR, 10, H(960)) === 1, 'no npcToughness block: nothing changes');

// ---- the shipped config and the wiring ----------------------------------------------------------------------------------
const cfg = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));
const nt = cfg.npcToughness || {};
const d = (nt.kinds || {}).draugr || {};
ok(nt.enabled === true && d.knee === 200 && d.slope === 0.4 && d.dealt === 0.75, 'shipped: on, draugr knee 200, slope 0.4, dealt 0.75', d);
ok(['d53:Skyrim.esm', 'f71dc:Skyrim.esm', '2a6fd:Dragonborn.esm'].every((r) => (d.races || []).includes(r)), 'shipped: DraugrRace, DraugrMagicRace and the Hulking Draugr race are listed');
const gm = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
const hook = gm.slice(gm.indexOf('const hitDamageAttemptHook ='), gm.indexOf('// ---- companion hits, measured'));
ok(/require\(TOUGHNESS_JS\)\(\{ mp, cfg, log, profileOf, recordOf \}\)/.test(gm), 'gamemode.js loads npctoughness.js with mp, cfg, log, profileOf, recordOf');
ok(/mult \*= toughness\.dealtMult\(agg, tgt, dmg\)/.test(hook), "the hit hook scales a draugr's hit on a player by dealt");
ok(/toughTaken = toughness\.takenMult\(agg, tgt, dmg, flags\)/.test(hook) && /summonDealtMult\(agg, tgt, dmg\) \* toughTaken/.test(hook), "...and a player's side's hit on one joins takenByKind (lowered first on a weapon hit)");

// ---- before and after: health (records of the 140-plugin order) and blows ----------------------------------------------
const S = load({ npcToughness: cfg.npcToughness });
const rows = [['Restless Draugr (01, L1)', 50], ['Draugr (02, L6-7)', 150], ['Draugr Wight (03, L13-15)', 370], ['Draugr Scourge (04, L21-24)', 500], ['Draugr Scourge (04)', 700],
  ['Draugr Deathlord (05, L30-34)', 710], ['Ebony Deathlord (05, L40)', 910], ['Draugr boss (05TemplateBoss, L34)', 960]];
console.log('      health (as players feel it)  before -> after   peers of the level: bandit / Falmer / vampire');
for (const [n, h] of rows) console.log(`      ${n.padEnd(36)} ${String(h).padStart(4)} -> ${String(Math.round(h / S.takenMult(PLAYER, DRAUGR, 1, H(h)))).padStart(4)}`);
ok(Math.round(370 / S.takenMult(PLAYER, DRAUGR, 1, H(370))) === 268 && Math.round(960 / S.takenMult(PLAYER, DRAUGR, 1, H(960))) === 504, 'a Wight feels like 268 (peers 140-200), the boss Deathlord like 504 (peers 225-330): still the toughest of their level');
console.log('      median blow on a player (npc hit log 16-17 Oct, normal/hard)  before -> after   bandit of the tier');
for (const [n, b, p] of [['one-handed, tiers 02-04', 10.2, '7.1-7.8'], ['two-handed, tiers 02-04', 20.2, '15.7-17.1'], ['Deathlord one-handed', 24.1, '8.1'], ['Deathlord two-handed', 26.9, '15.7'], ['Unrelenting Force (word 2)', 16.8, '-']]) {
  console.log(`      ${n.padEnd(36)} ${b.toFixed(1).padStart(5)} -> ${(b * S.dealtMult(DRAUGR, PLAYER, b)).toFixed(1).padStart(5)}   ${p}`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
