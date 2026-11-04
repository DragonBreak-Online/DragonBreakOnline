// salvage.js against a stub mp: an entry of salvage.json must still match the recipe it was read from (ticket fac-0553,
// 3 Nov). DragonBreak Nexus Patches re-graded the Imperial Ebony Sword's recipe to 2 malachite, 1 strips, 1 steel, and the
// salvage.json built before that kept paying 2 ebony for it: a smith could buy malachite's worth and smelt out ebony.
// Without the recipe check in yieldOf, the stale-entry checks below fail.
//   node tests/salvage-recipe-match-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'salvage.js');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-salvage-recipe-'));
process.chdir(scratch);

// Real vanilla material ids (ingots, strips); every item and recipe id is made up and only ever built through desc()
const EBONY = 0x5ad9d, MALACHITE = 0x5ada1, STEEL = 0x5ace5, STRIPS = 0x800e4, GOLD_INGOT = 0x5ad9e;
const IMP_SWORD = 0x1300, IMP_SWORD2 = 0x1301, OLD_SWORD = 0x1302, RING = 0x1303, LEGACY = 0x1304, GONE = 0x1305, UNKNOWN = 0x1306;
const R_IMP = 0x7001, R_OLD = 0x7002, R_RING = 0x7003, R_GONE = 0x7004, R_UNKNOWN = 0x7005;
const SMELTER = 0x9000, SMELTER_BASE = 0x9001;
const PLAYER = 0xff000001;
const desc = (id) => `${id.toString(16)}:Skyrim.esm`;
const fromDesc = (d) => parseInt(String(d).split(':')[0], 16) >>> 0;
// The local id inside a field is not the global one here, so a check that skips toGlobalRecordId reads the wrong item
const LOCAL = 0x01000000;
const cnto = (id, n) => { const d = new Uint8Array(8); const v = new DataView(d.buffer); v.setUint32(0, id + LOCAL, true); v.setInt32(4, n, true); return { type: 'CNTO', data: d }; };
const nam1 = (n) => { const d = new Uint8Array(2); new DataView(d.buffer).setUint16(0, n, true); return { type: 'NAM1', data: d }; };
const kwda = (...ids) => { const d = new Uint8Array(ids.length * 4); ids.forEach((id, i) => new DataView(d.buffer).setUint32(i * 4, id, true)); return { type: 'KWDA', data: d }; };

const writeTable = (items) => fs.writeFileSync('salvage.json', JSON.stringify({ items }));
writeTable({
  // stale: built when the recipe still took ebony
  [desc(IMP_SWORD)]: ['smelter', 3, [[desc(EBONY), 2], [desc(STRIPS), 1], [desc(STEEL), 1]], desc(R_IMP)],
  // the same item regenerated against the re-graded recipe
  [desc(IMP_SWORD2)]: ['smelter', 2, [[desc(MALACHITE), 2], [desc(STRIPS), 1], [desc(STEEL), 1]], desc(R_IMP)],
  // an untouched ebony recipe still pays ebony
  [desc(OLD_SWORD)]: ['smelter', 3, [[desc(EBONY), 2], [desc(STRIPS), 1]], desc(R_OLD)],
  // a recipe making 2 per ingot: half an ingot each is right, a whole one would double the metal
  [desc(RING)]: ['smelter', 0, [[desc(GOLD_INGOT), 1]], desc(R_RING)],
  // a salvage.json built before this change has no recipe: not checked
  [desc(LEGACY)]: ['smelter', 3, [[desc(EBONY), 2], [desc(STRIPS), 1]]],
  // its recipe is deleted by a later plugin (record flag 0x20)
  [desc(GONE)]: ['smelter', 3, [[desc(EBONY), 2]], desc(R_GONE)],
  // its recipe's plugin is not loaded: the server cannot read it at all
  [desc(UNKNOWN)]: ['smelter', 3, [[desc(EBONY), 2]], desc(R_UNKNOWN)],
});
const RECS = {
  [SMELTER_BASE]: { type: 'FURN', fields: [kwda(0x8001)] },
  0x8001: { type: 'KYWD', editorId: 'CraftingSmelter', fields: [] },
  [R_IMP]: { type: 'COBJ', fields: [cnto(MALACHITE, 2), cnto(STRIPS, 1), cnto(STEEL, 1)] },
  [R_OLD]: { type: 'COBJ', fields: [cnto(EBONY, 2), cnto(STRIPS, 1)] },
  [R_RING]: { type: 'COBJ', fields: [cnto(GOLD_INGOT, 1), nam1(2)] },
  [R_GONE]: { type: 'COBJ', flags: 0x20, fields: [cnto(EBONY, 2)] },
};
const NAMES = { [EBONY]: 'Ebony Ingot', [MALACHITE]: 'Refined Malachite', [STEEL]: 'Steel Ingot', [STRIPS]: 'Leather Strips', [GOLD_INGOT]: 'Gold Ingot',
  [IMP_SWORD]: 'Imperial Ebony Sword', [IMP_SWORD2]: 'Imperial Ebony Sword (new)', [OLD_SWORD]: 'Ebony Sword', [RING]: 'Gold Ring', [LEGACY]: 'Old Sword', [GONE]: 'Lost Sword', [UNKNOWN]: 'Unread Sword' };
let INV = [];
const logs = [], widgets = [], ui = {};
const mp = {
  get: (id, k) => (k === 'inventory' ? { entries: INV } : k === 'baseDesc' && id === SMELTER ? desc(SMELTER_BASE) : null),
  set: (id, k, v) => { if (k === 'inventory') INV = v.entries; },
  getDescFromId: desc, getIdFromDesc: fromDesc,
};
const api = {
  mp, log: (...x) => logs.push(x.join(' ')), personal: () => {}, who: String,
  cfg: {}, openWidget: (a, w) => widgets.push(w), closeWidget: () => {},
  onUi: (n, f) => { (ui[n] = ui[n] || []).push(f); },
  masteryOf: () => ({ order: ['blacksmith'], skills: { blacksmith: { rank: 4 } } }),
  recordOf: (id) => (RECS[id] ? { record: RECS[id], toGlobalRecordId: (l) => (l >= LOCAL ? l - LOCAL : l) } : null),
  fieldsOf: (lr, t) => ((lr && lr.record.fields) || []).filter((f) => f.type === t),
  giveItem: (a, id, n) => { const e = INV.find((x) => x.baseId === id); if (e) e.count += n; else INV.push({ baseId: id, count: n }); return true; },
  itemName: (d) => NAMES[fromDesc(d)] || '', distanceMeters: () => 1,
};
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : `   ${JSON.stringify(got)}`}`); if (!c) fails++; };
const count = (id) => INV.filter((e) => e.baseId === id).reduce((n, e) => n + e.count, 0);
const choose = (id) => (ui.salvageChoose || []).forEach((f) => f(PLAYER, [id]));
const breakOne = (baseId) => { globalThis.__dboSalvageActivate(SMELTER, PLAYER); choose(`b:${baseId}`); choose(`x1:${baseId}`); };
globalThis.__dboSalvage = undefined;
require(MODULE)(api);

// ---- the exploit: a stale entry ------------------------------------------------------------------------------------
INV = [{ baseId: IMP_SWORD, count: 1 }];
breakOne(IMP_SWORD);
ok(count(EBONY) === 0, 'a re-graded sword with a stale entry gives back no ebony', { ebony: count(EBONY) });
ok(count(IMP_SWORD) === 1, '...and is not taken: it is not offered at all', { sword: count(IMP_SWORD) });
ok(logs.some((l) => /1300:Skyrim\.esm is not offered: its salvage\.json entry is stale, the recipe no longer takes 2 Ebony Ingot/.test(l)),
  '...and the log says which entry is stale and why', logs.filter((l) => /stale/.test(l)));
const staleLines = logs.filter((l) => /1300:Skyrim\.esm is not offered/.test(l)).length;
breakOne(IMP_SWORD);
ok(logs.filter((l) => /1300:Skyrim\.esm is not offered/.test(l)).length === staleLines, '...logged once, not on every opening');

// ---- what still works --------------------------------------------------------------------------------------------
INV = [{ baseId: IMP_SWORD2, count: 1 }];
breakOne(IMP_SWORD2);
ok(count(MALACHITE) === 1 && count(EBONY) === 0 && count(IMP_SWORD2) === 0,
  'the regenerated entry pays malachite, the recipe\'s own metal (75% of 2, rounded down)', { malachite: count(MALACHITE), ebony: count(EBONY) });
INV = [{ baseId: OLD_SWORD, count: 1 }];
breakOne(OLD_SWORD);
ok(count(EBONY) === 1 && count(OLD_SWORD) === 0, 'a recipe that still takes ebony still gives ebony back', { ebony: count(EBONY) });
INV = [{ baseId: LEGACY, count: 1 }];
breakOne(LEGACY);
ok(count(LEGACY) === 0, 'an entry with no recipe (a salvage.json built before this) is still offered');

// ---- a recipe that makes several, and one that is gone -------------------------------------------------------------
INV = [{ baseId: GONE, count: 1 }];
breakOne(GONE);
ok(count(GONE) === 1 && count(EBONY) === 0, 'an entry whose recipe the load order deletes is not offered, even though its record still matches');
INV = [{ baseId: UNKNOWN, count: 1 }];
breakOne(UNKNOWN);
ok(count(UNKNOWN) === 0, 'an entry whose recipe the server cannot read at all is still offered (no load order, no check)');
// A gold ring made 2 per ingot: an entry of 1 ingot per ring pays twice what the craft took
writeTable(Object.assign(JSON.parse(fs.readFileSync('salvage.json', 'utf8')).items, { [desc(RING)]: ['smelter', 0, [[desc(GOLD_INGOT), 1]], desc(R_RING)] }));
const t = Date.now() + 5000; fs.utimesSync('salvage.json', t / 1000, t / 1000);
INV = [{ baseId: RING, count: 1 }];
breakOne(RING);
ok(count(RING) === 1 && count(GOLD_INGOT) === 0, 'a ring entry paying 1 ingot from a recipe that makes 2 per ingot is not offered (NAM1)');
// Regenerated in place: the stale sword's entry now pays malachite, and the check is redone for the new file
writeTable(Object.assign(JSON.parse(fs.readFileSync('salvage.json', 'utf8')).items, { [desc(IMP_SWORD)]: ['smelter', 2, [[desc(MALACHITE), 2], [desc(STRIPS), 1], [desc(STEEL), 1]], desc(R_IMP)] }));
const t2 = Date.now() + 10000; fs.utimesSync('salvage.json', t2 / 1000, t2 / 1000);
INV = [{ baseId: IMP_SWORD, count: 1 }];
breakOne(IMP_SWORD);
ok(count(IMP_SWORD) === 0 && count(MALACHITE) === 1, '...and once salvage.json is regenerated the same sword is offered again, for malachite', { sword: count(IMP_SWORD), malachite: count(MALACHITE) });

// ---- the private sidecar (Ben, 3 Nov: entries of the AI-forbidding mods stay off the public repo) --------------------
// salvage.private.json beside salvage.json holds them; salvage.js merges it when it is there, and runs without it.
const PRIV_SWORD = 0x1307;
NAMES[PRIV_SWORD] = 'Private Sword';
fs.writeFileSync('salvage.private.json', JSON.stringify({ items: { [desc(PRIV_SWORD)]: ['smelter', 3, [[desc(EBONY), 2], [desc(STRIPS), 1]], desc(R_OLD)] } }));
INV = [{ baseId: PRIV_SWORD, count: 1 }];
breakOne(PRIV_SWORD);
ok(count(PRIV_SWORD) === 0 && count(EBONY) === 1, 'an entry from salvage.private.json is offered when the sidecar is there', { sword: count(PRIV_SWORD), ebony: count(EBONY) });
fs.unlinkSync('salvage.private.json');
INV = [{ baseId: PRIV_SWORD, count: 1 }];
breakOne(PRIV_SWORD);
ok(count(PRIV_SWORD) === 1, '...and not once the sidecar is gone: salvage runs on the public entries alone');
ok(logs.some((l) => /salvage\.private\.json is not here/.test(l)), '...which the log says');

// ---- the tracked file names no AI-forbidding mod (the plugins privaterows.js lists, and their siblings) ----------------
const TRACKED = path.resolve(__dirname, '..', 'salvage.json');
const PRIVATE_MOD = /druadach|summerset|murkmire|baan ?malur|morrowind map fix|lordbound/ig;
const hits = (fs.readFileSync(TRACKED, 'utf8').match(PRIVATE_MOD) || []);
ok(hits.length === 0, 'the tracked salvage.json names no plugin of a mod whose authors forbid AI work', [...new Set(hits)].slice(0, 5));

console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.chdir(os.tmpdir());
try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* leave it */ }
process.exit(fails ? 1 : 0);
