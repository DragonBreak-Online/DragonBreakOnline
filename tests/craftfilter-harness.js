// DragonBreak Online: craftfilter unit test harness (tests/craftfilter-harness.js)
'use strict';
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
const ok = (c, what, got) => {
  if (c) {
    pass++;
  } else {
    fail++;
    console.log('FAIL:', what, got !== undefined ? JSON.stringify(got) : '');
  }
};

const P_NOVICE = 0xff000101;
const P_MASTER = 0xff000102;

const props = new Map();
// Novice blacksmith: Tier 1, no manuals
props.set(`${P_NOVICE}|private.mastery`, { order: ['blacksmith'], skills: { blacksmith: { level: 10 } } });
props.set(`${P_NOVICE}|private.dboManuals`, {});

// Master blacksmith: Tier 5+, knows adamantium and ancient_nord
props.set(`${P_MASTER}|private.mastery`, { order: ['blacksmith'], skills: { blacksmith: { level: 80 } } });
props.set(`${P_MASTER}|private.dboManuals`, { adamantium: { at: Date.now() }, ancient_nord: { at: Date.now() } });

let lastPackets = new Map();

const api = {
  mp: {
    get: (a, k) => props.get(`${a >>> 0}|${k}`)
  },
  log: () => {},
  cfg: { craftFilter: { enabled: true } },
  sendPacket: (a, p) => { lastPackets.set(a >>> 0, p); },
  onlineActors: () => [P_NOVICE, P_MASTER],
  every: () => {},
  isAdmin: () => false
};

const ROOT = path.resolve(__dirname, '..');
const craftfilter = require(path.join(ROOT, 'craftfilter.js'))(api);

// Trigger manual sync
globalThis.__dboCraftFilterLogin(P_NOVICE);
globalThis.__dboCraftFilterLogin(P_MASTER);

const noviceLocked = new Set(lastPackets.get(P_NOVICE).locked);
const masterLocked = new Set(lastPackets.get(P_MASTER).locked);

// 1. Adamantium Ingot at Smelter
ok(noviceLocked.has('b6a:DragonBreak Nexus Patches.esp'), 'Adamantium Ingot is locked for novice crafter');
ok(!masterLocked.has('b6a:DragonBreak Nexus Patches.esp'), 'Adamantium Ingot is unlocked for master crafter');

// 2. Adamantium Creation Recipes at Forge
const adamCreation = ['835:DragonBreak Armory.esp', '836:DragonBreak Armory.esp', 'cf7:DragonBreak Nexus Patches.esp'];
for (const r of adamCreation) {
  ok(noviceLocked.has(r), `${r} is locked for novice`);
  ok(!masterLocked.has(r), `${r} is unlocked for master`);
}

// 3. Adamantium Tempering Recipes at Armor Table / Sharpening Wheel
const adamTemper = ['cf8:DragonBreak Nexus Patches.esp', 'd17:DragonBreak Nexus Patches.esp', '83a:DragonBreak Armory.esp'];
for (const r of adamTemper) {
  ok(noviceLocked.has(r), `Temper ${r} is locked for novice`);
  ok(!masterLocked.has(r), `Temper ${r} is unlocked for master`);
}

// 4. Ancient Nord Creation Recipes at Skyforge
const ancientNordCreation = ['f46cc:Skyrim.esm', 'f46cd:Skyrim.esm', 'f46cf:Skyrim.esm', 'f46d0:Skyrim.esm'];
for (const r of ancientNordCreation) {
  ok(noviceLocked.has(r), `Ancient Nord ${r} is locked for novice`);
  ok(!masterLocked.has(r), `Ancient Nord ${r} is unlocked for master`);
}

// 5. Ancient Nord Tempering Recipes
const ancientNordTemper = ['1731c:Skyrim.esm', 'e49:Skyrim.esm', '1082c5:Skyrim.esm'];
for (const r of ancientNordTemper) {
  ok(noviceLocked.has(r), `Ancient Nord Temper ${r} is locked for novice`);
  ok(!masterLocked.has(r), `Ancient Nord Temper ${r} is unlocked for master`);
}

// 6. The load order's own recipes, and smithing.js's own rule (#bugs 1568049991400816704, 7 Nov)
{
  const P_JOURNEY = 0xff000103;   // craft tier 2 (20 points), no manuals
  props.set(`${P_JOURNEY}|private.mastery`, { order: ['blacksmith'], skills: { blacksmith: { level: 20 } } });
  props.set(`${P_JOURNEY}|private.dboManuals`, {});
  // A load order with a benchless Ebony recipe and an Ebony tempering recipe that regions.json never listed
  const T = 0x0a000000;
  const DESCS = { [T + 1]: 'fff1:Test.esp', [T + 2]: '106a1:Immersive Weapons.esp', [T + 3]: 'fff3:Test.esp', [T + 4]: 'fff4:Test.esp' };
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
  const RECS = {
    [T + 1]: { type: 'COBJ', fields: [{ type: 'CNAM', data: u32(T + 2) }] },
    [T + 3]: { type: 'KYWD', editorId: 'CraftingSmithingArmorTable', fields: [] },
    [T + 4]: { type: 'COBJ', fields: [{ type: 'CNAM', data: u32(T + 2) }, { type: 'BNAM', data: u32(T + 3) }] },
  };
  const mp2 = Object.assign({}, api.mp, {
    getEspmRecordIdsByType: (t) => (t === 'COBJ' ? [T + 1, T + 4] : []),
    lookupEspmRecordById: (id) => (RECS[id >>> 0] ? { record: RECS[id >>> 0], toGlobalRecordId: (v) => v } : null),
    getDescFromId: (id) => DESCS[id >>> 0] || (id >>> 0).toString(16),
  });
  // The real smithing.js, so the filter asks the forge's own rule
  require(path.join(ROOT, 'smithing.js'))({ mp: mp2, log: () => {}, personal: () => {}, audit: () => {}, who: (a) => String(a), cfg: { smithing: { enabled: true } },
    registerChatCommand: () => {}, onlineActors: () => [], findByName: () => 0, isAdmin: () => false, sendPacket: () => {}, itemName: () => '' });
  lastPackets = new Map();
  require(path.join(ROOT, 'craftfilter.js'))(Object.assign({}, api, { mp: mp2 }));
  for (const p of [P_NOVICE, P_MASTER, P_JOURNEY]) globalThis.__dboCraftFilterLogin(p);
  const lockedOf = (p) => new Set(lastPackets.get(p).locked);
  ok(lockedOf(P_NOVICE).has('fff1:Test.esp') && lockedOf(P_MASTER).has('fff1:Test.esp'), 'a benchless Ebony recipe regions.json never listed is hidden below tier 6 or without the schematic');
  ok(![P_NOVICE, P_MASTER].some((p) => lockedOf(p).has('fff4:Test.esp')), 'a tempering recipe from the load order is not added (tempering stays the explicit list)');
  ok(!lockedOf(P_JOURNEY).has('2abe:Immersive Weapons.esp'), 'a tier 2 smith with no manuals sees the Springsteel Bow: Imperial is worked with the free Steel technique, as the forge allows');
  ok(lockedOf(P_NOVICE).has('2abe:Immersive Weapons.esp'), '...while a tier 1 smith does not');
  ok(!masterLocked.has('b6a:DragonBreak Nexus Patches.esp') && lockedOf(P_MASTER).has('fff1:Test.esp'), '...and the earlier checks still stand alongside');
  // The technique rule reads the actor's race and manuals: asked once per family, never per recipe (live 7 Nov: 12 s stalls)
  const realKnows = globalThis.__dboSmithKnows; let asked = 0;
  globalThis.__dboSmithKnows = (p, f) => { asked++; return realKnows(p, f); };
  const families = new Set(Object.values(JSON.parse(fs.readFileSync(path.join(ROOT, 'loot-materials.json'), 'utf8')).items)).size;
  globalThis.__dboCraftFilterLogin(P_MASTER);
  ok(asked > 0 && asked <= families, `a sync asks the technique rule at most once per family (${families}), not per recipe`, asked);
  ok(lockedOf(P_MASTER).has('fff1:Test.esp') && !lockedOf(P_MASTER).has('b6a:DragonBreak Nexus Patches.esp'), '...with the same answer as before');
  globalThis.__dboSmithKnows = realKnows;
  try { clearInterval(globalThis.__dboSmithCarryTimer); } catch (e) { /* none */ }
}

console.log(`craftfilter tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
