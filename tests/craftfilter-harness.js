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

console.log(`craftfilter tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
