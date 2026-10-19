// Weapon and armour wear, and repair at the wheel and the bench (durability.js, Nate 19 Oct). Loads the real module
// against a fake mp and checks the tiers, what wears what, the name written when a piece comes off, a Broken piece
// refused, and repair: the smith's craft tier, the fee (destroyed), a Broken piece's materials. Also checks gamemode.js
// wires it into the damage math, the hits, deaths, equipment and the activate chain.
//   node tests/durability-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-durability-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the OS */ } });

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const P = 0xff000010, NPC = 0xff000020, WHEEL = 0xff000030, BENCH = 0xff000031;
const SWORD = 0x12eb7, CUIRASS = 0x12e49, BOOTS = 0x12e4b, SHIELD = 0x12eb6, INGOT = 0x5ace4, STRIPS = 0x800e4, GOLD = 0xf;
const KW_WHEEL = 0x88105, KW_BENCH = 0xadb78, WHEEL_BASE = 0x8810a, BENCH_BASE = 0xadb7a;
const kwda = (...ids) => { const b = new Uint8Array(4 * ids.length); ids.forEach((id, i) => new DataView(b.buffer).setUint32(i * 4, id, true)); return { type: 'KWDA', data: b }; };
const bod2 = (slots) => { const b = new Uint8Array(8); new DataView(b.buffer).setUint32(0, slots, true); return { type: 'BOD2', data: b }; };
const RECORDS = {
  [SWORD]: { type: 'WEAP', editorId: 'IronSword', fields: [] }, [CUIRASS]: { type: 'ARMO', editorId: 'ArmorIronCuirass', fields: [bod2(0x4)] },
  [BOOTS]: { type: 'ARMO', editorId: 'ArmorIronBoots', fields: [bod2(0x80)] }, [SHIELD]: { type: 'ARMO', editorId: 'ArmorIronShield', fields: [bod2(0x200)] },
  [INGOT]: { type: 'MISC', editorId: 'IngotIron', fields: [] }, [STRIPS]: { type: 'MISC', editorId: 'LeatherStrips', fields: [] },
  [KW_WHEEL]: { type: 'KYWD', editorId: 'CraftingSmithingSharpeningWheel', fields: [] }, [KW_BENCH]: { type: 'KYWD', editorId: 'CraftingSmithingArmorTable', fields: [] },
  [WHEEL_BASE]: { type: 'FURN', editorId: 'CraftingSharpeningWheel', fields: [kwda(KW_WHEEL)] }, [BENCH_BASE]: { type: 'FURN', editorId: 'CraftingArmorTable', fields: [kwda(KW_BENCH)] },
};
const NAMES = { [SWORD]: 'Iron Sword', [CUIRASS]: 'Iron Armor', [BOOTS]: 'Iron Boots', [SHIELD]: 'Iron Shield', [INGOT]: 'Iron Ingot', [STRIPS]: 'Leather Strips' };
fs.writeFileSync('salvage.json', JSON.stringify({ items: { '12eb7:Skyrim.esm': ['smelter', 0, [['5ace4:Skyrim.esm', 1], ['800e4:Skyrim.esm', 1]]] } }));

const props = new Map();
const put = (a, k, v) => props.set(`${a}|${k}`, v === undefined ? v : JSON.parse(JSON.stringify(v)));
const papyrusCalls = [];
const mp = {
  get: (a, k) => props.get(`${a}|${k}`),
  set: (a, k, v) => put(a, k, v),
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`,
  getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
  callPapyrusFunction: (kind, cls, fn, self, args) => { papyrusCalls.push([fn, args && args[0] && args[0].desc]); },
};
const recordOf = (id) => (RECORDS[id >>> 0] ? { record: RECORDS[id >>> 0], toGlobalRecordId: (x) => x } : null);
const fieldsOf = (r, t) => ((r && r.record.fields) || []).filter((f) => f.type === t);
const said = [], widgets = [], handlers = new Map();
const inv = (a) => (mp.get(a, 'inventory') || { entries: [] }).entries;
const count = (a, id, name) => inv(a).filter((e) => e.baseId === id && String(e.name || '') === String(name || '')).reduce((n, e) => n + e.count, 0);
const api = {
  mp, cfg: JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8')), log: () => {}, who: (a) => `P${a}`,
  personal: (a, t) => said.push([a, t]), sendPacket: () => true,
  openWidget: (a, w) => { widgets.push({ a, w }); return true; }, closeWidget: () => true,
  onUi: (ev, fn) => handlers.set(ev, fn), recordOf, fieldsOf, itemName: (d) => NAMES[parseInt(String(d), 16)] || d,
  giveItem: () => true, distanceMeters: () => 1,
  goldOf: (a) => count(a, GOLD),
  takeGold: (a, n) => { const g = inv(a).find((e) => e.baseId === GOLD); if (!g || g.count < n) return false; g.count -= n; put(a, 'inventory', { entries: inv(a).filter((e) => e.count > 0) }); return true; },
};
globalThis.__dboBaseValue = (id) => ({ [SWORD]: 100, [CUIRASS]: 200 })[id] || 10;
let smithTier = 1;
globalThis.__dboSmithCraftTier = () => smithTier;
globalThis.__dboSmithItemTier = () => 2;
const D = require(path.join(SERVER, 'durability.js'))(api);
const lastSaid = () => (said[said.length - 1] || [])[1] || '';
const lastWidget = () => (widgets[widgets.length - 1] || {}).w || {};
const ui = (ev, a, args) => handlers.get(ev)(a, args || []);

// The player: a worn sword, cuirass, boots and shield; NPC hits
put(P, 'profileId', 1); put(NPC, 'profileId', -1);
const dress = (entries) => { put(P, 'inventory', { entries }); put(P, 'equipment', { inv: { entries } }); };
dress([{ baseId: SWORD, count: 1, worn: true }, { baseId: CUIRASS, count: 1, worn: true }, { baseId: BOOTS, count: 1, worn: true }, { baseId: SHIELD, count: 1, wornLeft: true }, { baseId: GOLD, count: 100 }]);
globalThis.__dboDurabilityEquip(P, mp.get(P, 'equipment'));

(async () => {
  ok(D.tierOfName('Iron Sword (Damaged)') === 2 && D.tierOfName('Iron Sword') === 0 && D.nameAt({ baseId: SWORD, name: 'Iron Sword (Worn)' }, 2) === 'Iron Sword (Damaged)', 'a tier is read from and written into the name');
  ok(globalThis.__dboDurabilityMult(P, SWORD, false, '') === 1, 'a new sword counts in full');
  for (let i = 0; i < 149; i++) globalThis.__dboDurabilityHit(P, NPC, SWORD, {});
  ok(globalThis.__dboDurabilityMult(P, SWORD, false, '') === 1 && !said.length, '149 blows: still Intact');
  globalThis.__dboDurabilityHit(P, NPC, SWORD, {});
  ok(globalThis.__dboDurabilityMult(P, SWORD, false, '') === 0.9 && /Iron Sword is now Worn/.test(lastSaid()), 'the 150th blow makes it Worn (0.9 of its damage), and the player is told', lastSaid());
  ok(inv(P).find((e) => e.baseId === SWORD && e.worn && !e.name), 'the worn entry is never rewritten while worn');
  // Hits taken wear the armour in turn, never the shield; a blocked one wears the shield
  for (let i = 0; i < 120; i++) globalThis.__dboDurabilityHit(NPC, P, 0x1f4, {});
  ok(globalThis.__dboDurabilityMult(P, CUIRASS, false, '') === 0.9 && globalThis.__dboDurabilityMult(P, BOOTS, false, '') === 0.9 && globalThis.__dboDurabilityMult(P, SHIELD, true, '') === 1,
    '120 hits taken wear the cuirass and the boots 60 each (Worn), not the shield');
  for (let i = 0; i < 30; i++) globalThis.__dboDurabilityHit(NPC, P, 0x1f4, { blocked: true });
  ok(globalThis.__dboDurabilityMult(P, SHIELD, true, '') === 0.9, '30 blocked hits wear the shield to Worn (2 points each)');
  ok(globalThis.__dboDurabilityMult(P, CUIRASS, false, '') === 0.9, '...and a blocked hit leaves the armour alone');
  // A death: every worn piece a whole tier; the sword, Worn already, is Damaged
  globalThis.__dboDurabilityDeath(P);
  ok(globalThis.__dboDurabilityMult(P, SWORD, false, '') === 0.75 && globalThis.__dboDurabilityMult(P, CUIRASS, false, '') === 0.75, 'a death drops every worn piece a tier (Damaged, 0.75)');
  // Taking the sword off writes its tier into its name
  dress([{ baseId: SWORD, count: 1 }, { baseId: CUIRASS, count: 1, worn: true }, { baseId: BOOTS, count: 1, worn: true }, { baseId: SHIELD, count: 1, wornLeft: true }, { baseId: GOLD, count: 100 }]);
  globalThis.__dboDurabilityEquip(P, mp.get(P, 'equipment'));
  await wait(500);
  ok(count(P, SWORD, 'Iron Sword (Damaged)') === 1 && count(P, SWORD, '') === 0, 'taken off, the sword shows as "Iron Sword (Damaged)" in the inventory', inv(P));
  ok(!Object.keys(mp.get(P, 'private.dboWear') || {}).some((k) => k.startsWith(`${SWORD}|`)), '...and its wear moves from the ledger into the name');
  // Worn again under its new name, it keeps its tier
  ok(globalThis.__dboDurabilityMult(P, SWORD, false, 'Iron Sword (Damaged)') === 0.75, 'worn again, the named sword still counts as Damaged');
  // A Broken piece put on comes off at once
  papyrusCalls.length = 0;
  dress([{ baseId: SWORD, count: 1, worn: true, name: 'Iron Sword (Broken)' }, { baseId: GOLD, count: 100 }]);
  globalThis.__dboDurabilityEquip(P, mp.get(P, 'equipment'));
  await wait(300);
  ok(papyrusCalls.some(([fn, d]) => fn === 'UnequipItem' && d === '12eb7:Skyrim.esm') && /broken and cannot be used/.test(lastSaid()), 'a Broken sword put on is taken off, and the player is told', papyrusCalls);

  // ---- repair -----------------------------------------------------------------------------------------------------
  put(WHEEL, 'baseDesc', `${WHEEL_BASE.toString(16)}:Skyrim.esm`); put(BENCH, 'baseDesc', `${BENCH_BASE.toString(16)}:Skyrim.esm`);
  dress([{ baseId: SWORD, count: 1, name: 'Iron Sword (Damaged)' }, { baseId: CUIRASS, count: 1, name: 'Iron Armor (Worn)' }, { baseId: GOLD, count: 100 }]);
  ok(globalThis.__dboRepairActivate(BENCH, P) === true && lastWidget().actions.map((x) => x.label).join() === "Work the armorer's bench (use it again),Iron Armor (Worn)", 'the bench lists the worn armour only', lastWidget().actions);
  ok(globalThis.__dboRepairActivate(WHEEL, P) === true && lastWidget().actions.some((x) => x.label === 'Iron Sword (Damaged)'), 'the wheel lists the damaged sword');
  const row = lastWidget().actions.find((x) => x.label === 'Iron Sword (Damaged)').id;
  ui('repairChoose', P, [row]);
  ok(/back to Intact for 10 gold/.test(lastWidget().targetName) && /craft tier 2/.test(lastWidget().targetName), 'its page: 2 tiers at 5% of 100 gold = 10 gold, Blacksmith craft tier 2', lastWidget().targetName);
  smithTier = 1;
  ui('repairChoose', P, ['fix']);
  ok(count(P, SWORD, 'Iron Sword (Damaged)') === 1 && count(P, GOLD) === 100 && /craft tier 2; yours is 1/.test(lastWidget().targetName), 'a smith below the piece\'s tier is refused and pays nothing', lastWidget().targetName);
  smithTier = 3;
  ui('repairChoose', P, [row]);
  ok(/1 Iron Ingot/.test(lastWidget().targetName) && !/Leather Strips/.test(lastWidget().targetName), 'Damaged: half the materials rounded down, at least one of the main one (1 Iron Ingot)', lastWidget().targetName);
  ui('repairChoose', P, ['fix']);
  ok(count(P, SWORD, 'Iron Sword (Damaged)') === 1 && count(P, GOLD) === 100 && /needs 1 Iron Ingot/.test(lastWidget().targetName), 'without the ingot a Damaged repair is refused, nothing charged', lastWidget().targetName);
  dress([{ baseId: SWORD, count: 1, name: 'Iron Sword (Damaged)' }, { baseId: INGOT, count: 1 }, { baseId: GOLD, count: 100 }]);
  globalThis.__dboRepairActivate(WHEEL, P);
  ui('repairChoose', P, [lastWidget().actions.find((x) => x.label === 'Iron Sword (Damaged)').id]); ui('repairChoose', P, ['fix']);
  ok(count(P, SWORD, '') === 1 && count(P, SWORD, 'Iron Sword (Damaged)') === 0 && count(P, GOLD) === 90 && count(P, INGOT) === 0, 'a tier 3 smith repairs it for 10 gold and 1 Iron Ingot: plain "Iron Sword" again', inv(P));
  ok(/repaired for 10 gold/.test(lastWidget().targetName), '...and is told', lastWidget().targetName);
  // A Broken piece needs its recipe's materials too
  dress([{ baseId: SWORD, count: 1, name: 'Iron Sword (Broken)' }, { baseId: GOLD, count: 100 }]);
  globalThis.__dboRepairActivate(WHEEL, P);
  ui('repairChoose', P, [lastWidget().actions.find((x) => x.label === 'Iron Sword (Broken)').id]);
  ok(/15 gold/.test(lastWidget().targetName) && /1 Iron Ingot, 1 Leather Strips/.test(lastWidget().targetName), 'Broken: 3 tiers (15 gold) and the materials it is made from', lastWidget().targetName);
  ui('repairChoose', P, ['fix']);
  ok(count(P, SWORD, 'Iron Sword (Broken)') === 1 && count(P, GOLD) === 100 && /needs 1 Iron Ingot/.test(lastWidget().targetName), 'without the materials it is refused, and nothing is charged', lastWidget().targetName);
  dress([{ baseId: SWORD, count: 1, name: 'Iron Sword (Broken)' }, { baseId: INGOT, count: 2 }, { baseId: STRIPS, count: 1 }, { baseId: GOLD, count: 100 }]);
  globalThis.__dboRepairActivate(WHEEL, P);
  ui('repairChoose', P, [lastWidget().actions.find((x) => x.label === 'Iron Sword (Broken)').id]); ui('repairChoose', P, ['fix']);
  ok(count(P, SWORD, '') === 1 && count(P, INGOT) === 1 && count(P, STRIPS) === 0 && count(P, GOLD) === 85, 'with them: the materials and 15 gold are taken, the sword is whole', inv(P));
  ok(globalThis.__dboRepairActivate(WHEEL, P) === false, 'with nothing to repair the wheel works as usual');
  dress([{ baseId: SWORD, count: 1, name: 'Iron Sword (Worn)' }, { baseId: GOLD, count: 100 }]);
  globalThis.__dboRepairActivate(WHEEL, P); ui('repairChoose', P, ['use']);
  ok(globalThis.__dboRepairActivate(WHEEL, P) === false, '"use it again" lets the next use reach the wheel (tempering)');

  // ---- the login's empty report (19 Oct log: "left the pack before its Worn could be marked", the wear then lost) -------
  put(P, 'private.dboWear', {});
  dress([{ baseId: SWORD, count: 1, worn: true }, { baseId: GOLD, count: 100 }]);
  globalThis.__dboDurabilityEquip(P, mp.get(P, 'equipment'));
  for (let i = 0; i < 150; i++) globalThis.__dboDurabilityHit(P, NPC, SWORD, {});
  // the client reports nothing worn while the pack still holds the sword as worn, then the server dresses it again
  put(P, 'equipment', { inv: { entries: [{ baseId: GOLD, count: 100 }] } });
  globalThis.__dboDurabilityEquip(P, mp.get(P, 'equipment'));
  await wait(500);
  ok(Object.keys(mp.get(P, 'private.dboWear') || {}).includes(`${SWORD}|`), 'login: the empty report cannot rename a sword still worn, and its wear stays kept', mp.get(P, 'private.dboWear'));
  dress([{ baseId: SWORD, count: 1, worn: true }, { baseId: GOLD, count: 100 }]);
  globalThis.__dboDurabilityEquip(P, mp.get(P, 'equipment'));
  ok(globalThis.__dboDurabilityMult(P, SWORD, false, '') === 0.9, '...so dressed again it is still Worn, not Intact');
  // worn at the wheel: listed, to be taken off first
  globalThis.__dboRepairActivate(WHEEL, P);
  ok(lastWidget().actions.some((x) => x.label === 'Iron Sword (Worn): take it off to repair it'), 'the wheel lists a worn sword that needs repair, to take off first', lastWidget().actions);
  ui('repairChoose', P, [lastWidget().actions.find((x) => /take it off/.test(x.label)).id]);
  ok(/Take the piece off first/.test(lastWidget().targetName), '...and choosing it says so', lastWidget().targetName);
  // taken off while its name cannot be written: the kept wear still lists it, and the repair clears the wear
  dress([{ baseId: SWORD, count: 1 }, { baseId: INGOT, count: 1 }, { baseId: GOLD, count: 100 }]);
  globalThis.__dboRepairActivate(WHEEL, P);
  const kept = lastWidget().actions.find((x) => x.label === 'Iron Sword (Worn)');
  ok(!!kept, 'a piece with kept wear and no tier in its name is still listed by its tier', lastWidget().actions);
  ui('repairChoose', P, [kept.id]); ui('repairChoose', P, ['fix']);
  ok(count(P, SWORD, '') === 1 && count(P, GOLD) < 100 && !Object.keys(mp.get(P, 'private.dboWear') || {}).includes(`${SWORD}|`), '...repaired, its kept wear is gone', [inv(P), mp.get(P, 'private.dboWear')]);
  // ---- gamemode.js wiring -----------------------------------------------------------------------------------------
  const gm = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
  ok(/__dboDurabilityMult\(a, Number\(e\.baseId\) >>> 0, !!e\.wornLeft, e\.name \|\| ''\)/.test(gm) && (gm.match(/\* \(w\.cond \|\| 1\);/g) || []).length === 2 && /\* \(\(w && w\.cond\) \|\| 1\)/.test(gm),
    'gamemode.js: wear counts in the armour math (Defense and Flesh) and in the weapon\'s damage');
  ok(/__dboDurabilityHit\(agg >>> 0, tgt >>> 0, src >>> 0, flags\)/.test(gm) && /__dboDurabilityDeath\(Number\(actorId\)/.test(gm) && /__dboDurabilityEquip\(a, equipment\)/.test(gm)
    && /__dboRepairActivate\(targetId >>> 0, casterId >>> 0\)/.test(gm) && /__dboDurabilityLeave\(a\)/.test(gm), 'gamemode.js: hits, deaths, equipment, the activate chain and logout reach it');
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL', e); process.exit(1); });
