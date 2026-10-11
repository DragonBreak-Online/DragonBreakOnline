// Faction gear tempers without a family cap (Nate, 11 Oct): every item in faction-gear.json improves one level per craft
// tier of the smith's own (Fine at T1 .. Legendary at T6), whatever loot-materials.json classes it as. The player report:
// the Legion's Officer's Sword and Penitus Oculatus Sword (classed Steel, T2) stopped at Superior and the General's Sword
// (classed Ebony, T6) never improved. Other items keep min(T+2, 5, craft tier); T5+ never improve.
// Loads the real smithing.js with the real smithing.json, loot-materials.json and faction-gear.json in a scratch folder.
//   node tests/faction-temper-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-factemper-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
for (const f of ['smithing.json', 'loot-materials.json', 'faction-gear.json']) fs.copyFileSync(path.join(SERVER, f), path.join(dir, f));
process.chdir(dir);

// Ids as the server hands them: a load-order index in the top byte, the desc spelled as the plugin is named
const DESC = new Map([
  [0x250012fd, '12fd:DIS_Heavy_Legion.esp'],   // Officer's Sword (Steel)
  [0x250012fc, '12fc:DIS_Heavy_Legion.esp'],   // Penitus Oculatus Sword (Steel)
  [0x250012fb, '12fb:DIS_Heavy_Legion.esp'],   // General's Sword (Ebony)
  [0x00013989, '13989:Skyrim.esm'],            // Steel Sword, not faction gear
  [0x000139a5, '139a5:Skyrim.esm'],            // Glass Sword, not faction gear
]);
const OFFICER = 0x250012fd, OCULATUS = 0x250012fc, GENERAL = 0x250012fb, STEEL = 0x13989, GLASS = 0x139a5;
const lm = JSON.parse(fs.readFileSync('loot-materials.json', 'utf8')).items, fg = JSON.parse(fs.readFileSync('faction-gear.json', 'utf8')).items;
ok(lm['13989:skyrim.esm'] === 'steel' && lm['139a5:skyrim.esm'] === 'glass' && !fg['13989:Skyrim.esm'] && !fg['139a5:Skyrim.esm'], 'fixtures: the Steel and Glass swords are classed and are not faction gear');
ok(['12fd', '12fc', '12fb'].every((l) => fg[`${l}:DIS_Heavy_Legion.esp`]), "fixtures: the three Legion swords are in faction-gear.json");

const props = new Map();
const A = 0xff000201;
const smith = (points) => props.set(`${A}|private.mastery`, { order: ['blacksmith'], skills: { blacksmith: { level: points, rank: 0 } } });
const mp = {
  get: (a, k) => props.get(`${a >>> 0}|${k}`), set: (a, k, v) => props.set(`${a >>> 0}|${k}`, v),
  getDescFromId: (id) => DESC.get(id >>> 0) || `${(id >>> 0).toString(16)}:Skyrim.esm`,
  getIdFromDesc: () => 0, lookupEspmRecordById: () => null, getEspmRecordIdsByType: () => [],
};
for (const k of Object.keys(globalThis)) if (/^__dbo(Smith|TemperCap)/.test(k)) delete globalThis[k];
require(path.join(SERVER, 'smithing.js'))({ mp, log: () => {}, personal: () => {}, audit: () => {}, who: (a) => String(a), cfg: { smithing: { enabled: true } },
  registerChatCommand: () => {}, onlineActors: () => [A], findByName: () => 0, isAdmin: () => false, sendPacket: () => true, itemName: () => '' });
const cap = (id) => globalThis.__dboTemperCap(A, id);

// tierPoints 0/15/30/45/60/76/91 -> craft tiers 1..7
const byTier = [[0, 1], [15, 2], [30, 3], [45, 4], [60, 5], [76, 6], [91, 7]];
for (const [pts, t] of byTier) {
  smith(pts);
  const want = 10 + Math.min(6, t);
  ok(cap(OFFICER) === want && cap(OCULATUS) === want && cap(GENERAL) === want, `craft tier ${t}: the three Legion swords reach step ${want}`, [cap(OFFICER), cap(OCULATUS), cap(GENERAL)]);
  ok(cap(STEEL) === 10 + Math.max(0, Math.min(4, 5, t) - 2), `craft tier ${t}: a Steel sword keeps min(T+2, 5, tier)`, cap(STEEL));
  ok(cap(GLASS) === 10, `craft tier ${t}: a Glass sword (T5) never improves`, cap(GLASS));
}
smith(91);
ok(cap(OFFICER) === 16 && cap(GENERAL) === 16, "a tier 7 smith takes the Officer's and General's Swords to Legendary (16)");
ok(cap(STEEL) === 12, 'and a Steel sword still only to Superior (12)');
props.delete(`${A}|private.mastery`);
ok(cap(OFFICER) === 10, 'no Blacksmith skill: faction gear does not improve');
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
