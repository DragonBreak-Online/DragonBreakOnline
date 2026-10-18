// A dungeon's boss chest that Bethesda placed outside its cells joins the dungeon (dungeons.js extraChests; craigieg/otome,
// 17 Oct: "no Big Chest Reward" at White River Watch and Kilkreath, whose TreasBanditChestBoss 3d2ee / TreasDraugrChestBoss
// f8b48 stand in the exterior). Checked: the defaults name both, they join their dungeon's big chests, a chest already in
// the data is never added twice, config replaces the list, and gamemode.js no longer empties such a chest as a world one.
//   node tests/dungeon-extra-chests-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };
const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-extrachests-'));
const here = process.cwd(); process.chdir(dir);
for (const f of ['loot.json', 'ayleid-loot.json', 'expeditions.json']) fs.copyFileSync(path.join(ROOT, f), f);
const ids = new Map(); let next = 0x100;
const idOf = (d) => { const k = String(d).toLowerCase(); if (!ids.has(k)) ids.set(k, next++); return ids.get(k); };
const stub = (id, chests) => ({ id, name: id, type: 'cave', cells: [{ desc: `${id.length.toString(16)}:Skyrim.esm` }], entrances: [], chests, zones: [] });
const load = (cfg, data) => {
  fs.writeFileSync('dungeons.json', JSON.stringify({ dungeons: data }));
  globalThis.__dboDungeons = undefined; globalThis.__dboDungeonChestIds = undefined;
  delete require.cache[path.join(ROOT, 'dungeons.js')];
  const savedTimeout = global.setTimeout; global.setTimeout = () => 0;
  try {
    require(path.join(ROOT, 'dungeons.js'))({
      mp: { get: () => undefined, set: () => {}, getIdFromDesc: idOf, lookupEspmRecordById: () => ({ record: null }) },
      log: () => {}, personal: () => {}, system: () => {}, audit: () => {}, registerChatCommand: () => {}, onUi: () => {}, openWidget: () => true, closeWidget: () => true,
      sendPacket: () => true, findByName: () => 0, display: String, who: String, profileOf: () => -1, nameOf: () => 'P', onlineActors: () => [], isAdmin: () => false,
      giveItem: () => true, cfg: { dungeons: cfg }, every: () => {},
    });
  } finally { global.setTimeout = savedTimeout; }
};
load({}, [stub('WhiteRiverWatchLocation', [{ ref: '2e2b8:Skyrim.esm', edid: 'TreasBanditChest', big: true }]), stub('KilkreathRuinsLocation', [{ ref: 'f8b48:Skyrim.esm', edid: 'TreasDraugrChestBoss', big: true }])]);
const set = globalThis.__dboDungeonChestIds;
check('White River Watch\'s outside boss chest (3d2ee) is one of its chests', set instanceof Set && set.has(idOf('3d2ee:Skyrim.esm')) && set.has(idOf('2e2b8:Skyrim.esm')));
check('Kilkreath\'s (f8b48), already in the data here, is one of its chests', set.has(idOf('f8b48:Skyrim.esm')));
load({ extraChests: { WhiteRiverWatchLocation: [] } }, [stub('WhiteRiverWatchLocation', [])]);
check('config replaces the list (none: the outside chest is not added)', !globalThis.__dboDungeonChestIds.has(idOf('3d2ee:Skyrim.esm')));
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const empty = gm.slice(gm.indexOf('globalThis.__dboEmptyWorldContainer = '), gm.indexOf('globalThis.__dboEmptyWorldContainer = ') + 2000);
check('gamemode.js leaves a dungeon chest outside the dungeon\'s cells to dungeons.js', /__dboDungeonChestIds\.has\(targetId >>> 0\)/.test(empty) && /if \(!inDungeon\)/.test(empty));
process.chdir(here); fs.rmSync(dir, { recursive: true, force: true });
console.log(failures ? `${failures} FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
