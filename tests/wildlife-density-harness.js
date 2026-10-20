// Skyrim predator density (wildlife-density-1017; players 17 Oct: "2-3 bears every ten or so feet along the main road"
// near Riften, "7 bears in 5 minutes"). Against the real wildlife.js, wildlife.json and gamemode-config.json:
//   1. without wildlife.density the zones are exactly what they were (the 'mid' pick everywhere);
//   2. with it: zone names and count unchanged, Cyrodiil and safe zones untouched, non-predator spots untouched;
//   3. predator spots roll among their options up to rollLevel, fixed per spot (two loads give the same zones);
//   4. no two dangerous predators (level >= dangerLevel) within dangerSpacing, except placed ones that cannot step down;
//   5. dangerous spots respawn after dangerRespawnSeconds; the Rift keeps some bears (lore: the Rift has bears);
//   6. before/after numbers for Skyrim and within 50,000 units of Riften.
//   node tests/wildlife-density-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`); if (!c) fails++; };
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const CFG = readJson('gamemode-config.json');
const W = readJson('wildlife.json');
const NAMES = {}; for (const m of JSON.stringify(readJson('admin-placeables.json')).matchAll(/\["([0-9a-f]+:[^"]+)","([^"]+)"/g)) NAMES[m[1].toLowerCase()] = m[2];
const nameOf = (d) => NAMES[String(d).toLowerCase()] || String(d);
const SKY = '3c:Skyrim.esm', RIFTEN = [174000, -95000];
const BEAR = /^(Bear|Cave Bear|Enc Bear Snow)$/;

const base = fs.existsSync('/dev/shm') ? '/dev/shm' : require('os').tmpdir();
const dir = fs.mkdtempSync(path.join(base, 'claude-nate-wd-density-'));
const savedInterval = global.setInterval, savedClear = global.clearInterval;
const cwd = process.cwd();
const loadWild = (wildlife) => {
  for (const f of ['wildlife.json', 'owned-spawns.json', 'loot.json', 'artifacts.json', 'blackreach.json', 'dragon-materials.json']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  try { fs.unlinkSync(path.join(dir, 'NPC-Spawns.json')); } catch (e) { /* first load */ }
  process.chdir(dir);
  global.setInterval = () => ({ unref() {} }); global.clearInterval = () => {};
  globalThis.__dboWildFactionAudit = ' (skipped in the harness)';
  delete require.cache[path.join(ROOT, 'wildlife.js')];
  globalThis.__dboWildSig = undefined;
  const props = new Map();
  try {
    require(path.join(ROOT, 'wildlife.js'))({ mp: { get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v), getIdFromDesc: () => 0x1234 },
      log: () => {}, personal: () => {}, system: () => {}, registerChatCommand: () => {}, giveItem: () => true, profileOf: () => 1,
      display: String, who: String, audit: () => {}, isAdmin: () => false, cfg: { wildlife: wildlife, ownedSpawns: CFG.ownedSpawns, blackreach: CFG.blackreach }, onlineActors: () => [], sendPacket: () => {} });
    return JSON.parse(fs.readFileSync(path.join(dir, 'NPC-Spawns.json'), 'utf8')).zones.filter((z) => /^wild:[a-z]+:\d+$/.test(z.Name));
  } finally { process.chdir(cwd); global.setInterval = savedInterval; global.clearInterval = savedClear; }
};

try {
  const D = CFG.wildlife.density;
  ok(D && D.worlds.includes(SKY) && D.dangerSpacing > 0 && D.dangerRespawnSeconds > CFG.wildlife.respawnSeconds, 'gamemode-config wildlife.density is set for Skyrim, with a spacing and a longer predator respawn', D);
  const off = Object.assign({}, CFG.wildlife); delete off.density;
  const before = loadWild(off);
  const after = loadWild(CFG.wildlife);
  const again = loadWild(CFG.wildlife);

  // 1-2. names, counts, untouched spots
  ok(before.length === after.length && before.every((z, i) => z.Name === after[i].Name), 'same zone names in the same order with and without density', [before.length, after.length]);
  const byName = new Map(before.map((z) => [z.Name, z]));
  const placementOf = new Map(); { let n = 0; for (const pl of W.placements) { if (!pl.ref || !Array.isArray(pl.pos)) continue; if (pl.noNavmesh || pl.anchorGone) { n++; continue; } if (!(pl.options || []).length) continue; placementOf.set(`wild:${pl.kind}:${n++}`, pl); } }
  ok(after.every((z) => placementOf.has(z.Name)), 'every zone maps back to its placement');
  const changed = after.filter((z) => z.NPC[0].id !== byName.get(z.Name).NPC[0].id || z.Respawn !== byName.get(z.Name).Respawn);
  ok(changed.every((z) => z.ID === SKY), 'only Skyrim zones change (Cyrodiil and Blackreach untouched)', changed.filter((z) => z.ID !== SKY).map((z) => z.Name).slice(0, 5));
  ok(changed.filter((z) => z.NPC[0].id !== byName.get(z.Name).NPC[0].id).every((z) => /Predator/.test(placementOf.get(z.Name).edid) || Number((placementOf.get(z.Name).options.find((o) => o[1] === byName.get(z.Name).NPC[0].id) || [0])[0]) >= D.dangerLevel),
    'only predator lists (or a thinned dangerous spot) change creature; foxes, deer, chickens, mudcrabs keep theirs');
  ok(JSON.stringify(after) === JSON.stringify(again), 'two loads give identical zones (the roll is fixed per spot)');

  // 3. rolls stay within rollLevel
  const roll = after.filter((z) => z.ID === SKY && /Predator/.test(placementOf.get(z.Name).edid));
  ok(roll.every((z) => { const pl = placementOf.get(z.Name); const o = pl.options.find((x) => x[1] === z.NPC[0].id); const low = Math.min(...pl.options.map((x) => x[0])); return o && (o[0] <= D.rollLevel || o[0] === low); }), `every Skyrim predator spot's creature is at or below level ${D.rollLevel}`);

  // 4. spacing
  const levelOf = (z) => { const o = placementOf.get(z.Name).options.find((x) => x[1] === z.NPC[0].id); return o ? o[0] : 0; };
  const fixed = (z) => Math.min(...placementOf.get(z.Name).options.map((x) => x[0])) >= D.dangerLevel;
  const danger = after.filter((z) => z.ID === SKY && levelOf(z) >= D.dangerLevel);
  let close = 0; for (let i = 0; i < danger.length; i++) for (let j = i + 1; j < danger.length; j++) if (!(fixed(danger[i]) && fixed(danger[j])) && Math.hypot(danger[i].POS[0] - danger[j].POS[0], danger[i].POS[1] - danger[j].POS[1]) < D.dangerSpacing) close++;
  ok(close === 0, `no two dangerous predators within ${D.dangerSpacing} units in Skyrim (placed ones that cannot step down aside)`, close);

  // 5. respawn and lore
  ok(danger.every((z) => z.Respawn === D.dangerRespawnSeconds) && after.filter((z) => z.ID === SKY && levelOf(z) < D.dangerLevel).every((z) => z.Respawn === CFG.wildlife.respawnSeconds), 'dangerous predators respawn after dangerRespawnSeconds, everything else as before');
  const inRift = (z) => z.ID === SKY && Math.hypot(z.POS[0] - RIFTEN[0], z.POS[1] - RIFTEN[1]) < 50000;
  const riftBears = after.filter((z) => inRift(z) && BEAR.test(nameOf(z.NPC[0].id))).length;
  ok(riftBears >= 5, 'the Rift still has bears (lore)', riftBears);

  // 7. Pelagia Farm (Moss-Pocket #8G8Z, 20 Oct): the one plains predator spot west of the farm that rolled a sabre cat takes
  // its weakest creature; no other zone changes
  const noFarm = Object.assign({}, CFG.wildlife, { safeZones: (CFG.wildlife.safeZones || []).filter((z) => !/Pelagia/.test(z._comment || '')) });
  const withoutFarm = loadWild(noFarm);
  const farmDiff = after.filter((z, i) => z.NPC[0].id !== withoutFarm[i].NPC[0].id);
  ok(withoutFarm.find((z) => z.Name === 'wild:skeever:697')?.NPC[0].id === '23ab5:Skyrim.esm', 'without the farm safe zone the spot by Pelagia Farm is a sabre cat (the report)');
  ok(farmDiff.length === 1 && farmDiff[0].Name === 'wild:skeever:697' && farmDiff[0].NPC[0].id === '23ab7:Skyrim.esm', 'with it that one spot is a skeever and no other zone changes', farmDiff.map((z) => [z.Name, z.NPC[0].id]));

  // 6. numbers
  const stats = (zs, f) => {
    const s = zs.filter(f), c = {}; for (const z of s) { const n = nameOf(z.NPC[0].id); c[n] = (c[n] || 0) + 1; }
    const d = s.filter((z) => levelOf(z) >= D.dangerLevel), b = s.filter((z) => BEAR.test(nameOf(z.NPC[0].id)));
    let pairs = 0; for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (Math.hypot(b[i].POS[0] - b[j].POS[0], b[i].POS[1] - b[j].POS[1]) < 3000) pairs++;
    return { spots: s.length, dangerous: d.length, bears: b.length, bearPairsWithin3000: pairs, top: Object.entries(c).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(', ') };
  };
  for (const [label, f] of [['Skyrim', (z) => z.ID === SKY], ['Rift (50,000 of Riften)', inRift]]) {
    console.log(`\n${label} before: ${JSON.stringify(stats(before, f))}`);
    console.log(`${label} after:  ${JSON.stringify(stats(after, f))}`);
  }
  const b = stats(before, inRift), a = stats(after, inRift);
  ok(a.bears < b.bears / 3 && a.bearPairsWithin3000 === 0, 'the Rift: bears down to under a third, no two within 3000 units', [b.bears, a.bears, a.bearPairsWithin3000]);
} finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* scratch */ } }
console.log(`\n${fails ? fails + ' FAILED' : 'all passed'}`);
process.exit(fails ? 1 : 0);
