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
const P_SYNOD_TAILOR = 0xff000103;

const props = new Map();
// Novice blacksmith: Tier 1, no manuals, Tailor Tier 1
props.set(`${P_NOVICE}|private.mastery`, { order: ['blacksmith'], skills: { blacksmith: { level: 10, rank: 0 }, tailor: { rank: 0 } } });
props.set(`${P_NOVICE}|private.dboManuals`, {});

// Master blacksmith & tailor: Tier 7 (level 100), knows all manuals, Master tailor (rank 4)
props.set(`${P_MASTER}|private.mastery`, { order: ['blacksmith', 'tailor'], skills: { blacksmith: { level: 100, rank: 4 }, tailor: { rank: 4 } } });
props.set(`${P_MASTER}|private.dboManuals`, {
  adamantium: { at: Date.now() },
  ancient_nord: { at: Date.now() },
  mithril: { at: Date.now() },
  dwarven: { at: Date.now() },
  ebony: { at: Date.now() },
  daedric: { at: Date.now() },
  dragon: { at: Date.now() }
});

// Synod tailor: Tailor Tier 3, member of synod
props.set(`${P_SYNOD_TAILOR}|private.mastery`, { order: ['tailor'], skills: { tailor: { rank: 2 } } });
props.set(`${P_SYNOD_TAILOR}|private.dboManuals`, {});

const guilds = new Map();
guilds.set(P_SYNOD_TAILOR, [{ id: 'synod', role: 'tailor' }]);

globalThis.__dboGuildsOf = (a) => guilds.get(a >>> 0) || [];

let lastPackets = new Map();

const api = {
  mp: {
    get: (a, k) => props.get(`${a >>> 0}|${k}`)
  },
  log: () => {},
  cfg: { craftFilter: { enabled: true } },
  sendPacket: (a, p) => { lastPackets.set(a >>> 0, p); },
  onlineActors: () => [P_NOVICE, P_MASTER, P_SYNOD_TAILOR],
  every: () => {},
  isAdmin: () => false
};

const ROOT = path.resolve(__dirname, '..');
const craftfilter = require(path.join(ROOT, 'craftfilter.js'))(api);

// Trigger manual sync
globalThis.__dboCraftFilterLogin(P_NOVICE);
globalThis.__dboCraftFilterLogin(P_MASTER);
globalThis.__dboCraftFilterLogin(P_SYNOD_TAILOR);

const noviceLocked = new Set(lastPackets.get(P_NOVICE).locked);
const masterLocked = new Set(lastPackets.get(P_MASTER).locked);
const synodLocked = new Set(lastPackets.get(P_SYNOD_TAILOR).locked);

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

// 6. High-Tier Ammunition (Arrows and Bolts)
const ammoLocked = [
  '3987:Dawnguard.esm',   // Daedric Arrow (Tier 7)
  '6928:Dawnguard.esm',   // Dragonbone Arrow (Tier 7)
  'b651:Dawnguard.esm',   // Ebony Arrow (Tier 6)
  'b652:Dawnguard.esm',   // Dwarven Arrow (Tier 3)
  'f814:Dawnguard.esm',   // Dwarven Bolt (Tier 3)
  '273b1:DragonBreak.esp' // Nord Hero Arrow (Tier 2 manual)
];
for (const r of ammoLocked) {
  ok(noviceLocked.has(r), `Ammo ${r} is locked for novice smith`);
  ok(!masterLocked.has(r), `Ammo ${r} is unlocked for master smith`);
}

// 7. Smelter High-Tier Ingots
const smelterLocked = [
  'a30d3:Skyrim.esm',                   // Ebony Ingot (Tier 6)
  '1ac98d:DragonBreak Online Edits.esp' // Mithril Ingot (Tier 4 manual)
];
for (const r of smelterLocked) {
  ok(noviceLocked.has(r), `Smelter ${r} is locked for novice smith`);
  ok(!masterLocked.has(r), `Smelter ${r} is unlocked for master smith`);
}

// 8. Faction Gear
ok(noviceLocked.has('85c:DragonBreak Nexus Patches.esp'), 'Synod Hood is locked for novice non-Synod');
ok(!synodLocked.has('85c:DragonBreak Nexus Patches.esp'), 'Synod Hood is unlocked for Synod tailor');
ok(noviceLocked.has('865:DragonBreak Nexus Patches.esp'), 'College of Whispers Robes is locked for non-Whispers');
ok(noviceLocked.has('962:MoreCraftableEquipment.esp'), 'Telvanni Robes is locked for non-Telvanni');
ok(noviceLocked.has('21f92:Hothtrooper44_ArmorCompilation.esp'), 'Boethiah Ritual Boots locked for non-Boethiah');
ok(noviceLocked.has('b15:DragonBreak Nexus Patches.esp'), 'Redoran Watchman Helmet locked for non-Redoran');
ok(noviceLocked.has('f807:Dawnguard.esm'), 'Exploding Bolt of Fire locked for non-Dawnguard');

// 9. High-Tier Tailoring on Loom
const loomLocked = [
  '8ba:DragonBreak Nexus Patches.esp',       // Ebony Mage Unarmored Boots (Tier 5)
  '8b6:DragonBreak Nexus Patches.esp',       // Dwarven Mage Unarmored Boots (Tier 3)
  '1c8965:DragonBreak Online Edits.esp',     // Masterwork Backpack (Tier 4)
  '861:DragonBreak Nexus Patches.esp'        // Ayleid Mage Boots (Tier 4)
];
for (const r of loomLocked) {
  ok(noviceLocked.has(r), `Loom ${r} is locked for Tier 1 Novice Tailor`);
  ok(!masterLocked.has(r), `Loom ${r} is unlocked for Master Tailor`);
}

console.log(`craftfilter tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
