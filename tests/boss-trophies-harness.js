'use strict';
// dungeons.js boss trophies (Nate, 19 Oct: "better loot pool for boss creatures ... some stuff rare drops. Like dragon priest
// items"): a dragon priest is no animal, an ordinary dungeon's boss is a master, and the trophy tables give what they say.
// Loads the real trophy block with stubs. Run from the server folder: node tests/boss-trophies-harness.js
const fs = require('fs'); const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dungeons.js'), 'utf8');
const GM = fs.readFileSync(path.join(__dirname, '..', 'gamemode.js'), 'utf8');
let fail = 0; const ok = (c, n, g) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${!c && g !== undefined ? '   ' + JSON.stringify(g) : ''}`); if (!c) fail++; };

const animalLine = SRC.slice(SRC.indexOf('  const ANIMAL = /'), SRC.indexOf('\n', SRC.indexOf('  const ANIMAL = /')));
const ANIMAL = new Function(`${animalLine}; return ANIMAL;`)();
ok(!ANIMAL.test('DunForelhostDragonPriestRahgot') && !ANIMAL.test('dragon priest'), 'a dragon priest is not an animal (Rahgot was skinned for Bone Meal)');
ok(ANIMAL.test('EncDragon01Fire') && ANIMAL.test('dragon'), '...a dragon still is');
ok(/const SKIN_NOT_ANIMAL = \/DragonPriest\|/.test(GM), 'gamemode.js skinning refuses a dragon priest too');

const block = SRC.slice(SRC.indexOf('  const SOUL = {'), SRC.indexOf('  globalThis.__dboBossTrophies = bossTrophies;'));
const names = { '1c1fe:skyrim.esm': 'DragonPriestDagger', '7e5bb:skyrim.esm': 'dunForelhostDragonPriestStaff', '4de5b:skyrim.esm': 'MQ303DragonPriestStaff' };
let store = { dropped: {} };
const readJson = () => JSON.parse(JSON.stringify(store));
const memfs = { writeFileSync: (f, t) => { store = JSON.parse(t); }, renameSync: () => {} };
const make = (cfg) => new Function('C', 'idOf', 'recordOf', 'ARTIFACT', 'DRAGON_LOOT', 'readJson', 'fs', 'log', `${block}; return { bossTrophies, TROPHY, markDropped, droppedTrophies };`)(
  cfg, (d) => (d ? String(d).toLowerCase() : 0), (id) => ({ editorId: names[id] || (/^61c/.test(id) ? 'ArmorDragonPriestMaskX' : 'Gem') }), /^ArmorDragonPriestMask/i, /$^/, readJson, memfs, () => {});
const { bossTrophies, markDropped } = make({});
const MASK = (id) => /^61c/.test(String(id));
const run = (kind, diff, n) => { const c = new Map(); for (let i = 0; i < n; i++) for (const t of bossTrophies(kind, diff)) c.set(t.baseId, (c.get(t.baseId) || 0) + 1); return c; };
const priestM = run('DunForelhostDragonPriestRahgot', 'nightmare', 4000);
ok(priestM.get('2e4ff:skyrim.esm') === 4000, 'a Master dragon priest always holds a filled Grand soul gem');
const rare = ['1c1fe:skyrim.esm', '7e5bb:skyrim.esm', '4de5b:skyrim.esm'].reduce((n, k) => n + (priestM.get(k) || 0), 0);
ok(rare > 4000 * 0.09 && rare < 4000 * 0.15, 'a dragon priest item about 12% of the time at Master (rare)', rare);
ok((priestM.get('1c1fe:skyrim.esm') || 0) > (priestM.get('7e5bb:skyrim.esm') || 0), '...the dagger the likeliest of the three');
const priestS = run('DunForelhostDragonPriestRahgot', 'story', 4000);
ok(priestS.get('2e4f3:skyrim.esm') === 4000 && !priestS.get('2e4ff:skyrim.esm'), 'a Novice dragon priest: a Common soul gem, never Grand');
const rareS = ['1c1fe:skyrim.esm', '7e5bb:skyrim.esm', '4de5b:skyrim.esm'].reduce((n, k) => n + (priestS.get(k) || 0), 0);
ok(rareS < 4000 * 0.04, '...and a dragon priest item about 2% of the time', rareS);
const boss = run('dunBossDraugrDeathlord', 'hard', 4000);
const gems = [...boss.values()].reduce((a, b) => a + b, 0);
ok(gems > 4000 * 0.25 && gems < 4000 * 0.35 && !boss.has('1c1fe:skyrim.esm'), 'any other boss: a flawless gem about 30% at Expert, no dragon priest items', gems);
const masked = make({ bossTrophies: { tables: [{ id: 't', match: '.', always: { normal: [['61cd6:Skyrim.esm', 1]] } }] } });
names['61cd6:skyrim.esm'] = 'ArmorDragonPriestMaskUltraHelmet';
ok(masked.bossTrophies('x', 'normal').length === 0, 'an artifact (a dragon priest mask) is never handed out, whatever the config says');
ok(/TROPHY\.ordinaryBosses !== false && \(\/boss\/i\.test/.test(SRC) && /dragon \?priest\/i\.test/.test(SRC), "isMasterTag: an ordinary dungeon's boss or a dragon priest gets the master's roll");
// The masks (Nate, 19 Oct: "1% Master, 0.5% Expert, one each")
const maskRun = (diff, n) => { let c = 0; for (let i = 0; i < n; i++) c += bossTrophies('DunForelhostDragonPriestRahgot', diff).filter((t) => MASK(t.baseId)).length; return c; };
ok(maskRun('story', 20000) === 0 && maskRun('normal', 20000) === 0, 'no mask below Expert');
const mH = maskRun('hard', 40000), mM = maskRun('nightmare', 40000);
ok(mH > 40000 * 0.003 && mH < 40000 * 0.007 && mM > 40000 * 0.0075 && mM < 40000 * 0.0125, 'a mask about 0.5% at Expert and 1% at Master', { mH, mM });
const all = ['61cc9', '61cc2', '61cc1', '61cc0', '61cb9', '61cab', '61ca5', '61c8b'];
for (const m of all.slice(0, 7)) markDropped(`${m}:Skyrim.esm`, 'p', 'x');
let left = new Set(); for (let i = 0; i < 40000; i++) for (const t of bossTrophies('dragonpriest', 'nightmare')) if (MASK(t.baseId)) left.add(t.baseId);
ok(left.size === 1 && left.has('61c8b:skyrim.esm'), 'a mask already in the world never drops again: with seven out, only the eighth can', [...left]);
markDropped('61c8b:Skyrim.esm', 'p', 'x');
ok(maskRun('nightmare', 20000) === 0, '...and with all eight out, none');
ok(!bossTrophies('dragonpriest', 'nightmare').some((t) => /61cd6|61cca/.test(String(t.baseId))), 'never Konahrik or the Wooden Mask');
console.log(fail ? `${fail} failed` : 'all checks passed'); process.exit(fail ? 1 : 0);
