// Sabre cat population (Jake, 23 Oct: "it looks like sabertooths population needs to be curbed"). Against the real
// wildlife.js, wildlife.json, zones.json and gamemode-config.json:
//   1. gamemode-config wildlife.density.kinds.sabrecat names the three sabre cat bases, a spacing and a respawn;
//   2. Skyrim's sabre cat zones fall from the predator rolls' 94 to the config's cap (no two within its spacing);
//   3. the 15 sabre cat dens (spots whose every option is a sabre cat) keep their cats;
//   4. a thinned spot takes the next creature below the sabre cat in its own list (a wolf, an ice wolf), never nothing;
//   5. zone names, count and order unchanged; Cyrodiil and non-predator spots untouched; two loads identical;
//   6. kept sabre cats respawn after the kind's respawnSeconds; before/after numbers per hold.
//   node tests/sabrecat-curb-harness.js   (from server/); SPACINGS=10000,15000,20000 prints what other spacings give
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`); if (!c) fails++; };
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const CFG = readJson('gamemode-config.json');
const W = readJson('wildlife.json');
const HOLDS = readJson('zones.json').holds;
const SKY = '3c:Skyrim.esm';
const SABRE = new Set(['23ab5:skyrim.esm', '23ab6:skyrim.esm', '3d278:skyrim.esm']);
const isSabre = (z) => SABRE.has(String(z.NPC[0].id).toLowerCase());
const holdOf = (p) => HOLDS.reduce((b, h) => (Math.hypot(p[0] - h.capital[0], p[1] - h.capital[1]) < Math.hypot(p[0] - b.capital[0], p[1] - b.capital[1]) ? h : b)).id;

const base = fs.existsSync('/dev/shm') ? '/dev/shm' : require('os').tmpdir();
const dir = fs.mkdtempSync(path.join(base, 'claude-jake-b-sabre-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
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
      display: String, who: String, audit: () => {}, isAdmin: () => false, cfg: { wildlife, ownedSpawns: CFG.ownedSpawns, blackreach: CFG.blackreach }, onlineActors: () => [], sendPacket: () => {} });
    return JSON.parse(fs.readFileSync(path.join(dir, 'NPC-Spawns.json'), 'utf8')).zones.filter((z) => /^wild:[a-z]+:\d+$/.test(z.Name));
  } finally { process.chdir(cwd); global.setInterval = savedInterval; global.clearInterval = savedClear; }
};
const withKinds = (kinds) => Object.assign({}, CFG.wildlife, { density: Object.assign({}, CFG.wildlife.density, { kinds }) });
const withoutKinds = () => { const d = Object.assign({}, CFG.wildlife.density); delete d.kinds; return Object.assign({}, CFG.wildlife, { density: d }); };
const perHold = (zones) => { const c = {}; for (const z of zones) if (z.ID === SKY && isSabre(z)) c[holdOf(z.POS)] = (c[holdOf(z.POS)] || 0) + 1; return c; };

try {
  const K = ((CFG.wildlife.density || {}).kinds || {}).sabrecat;
  ok(K && ['23ab5:Skyrim.esm', '23ab6:Skyrim.esm', '3d278:Skyrim.esm'].every((d) => (K.bases || []).includes(d)) && K.spacing > CFG.wildlife.density.dangerSpacing && K.respawnSeconds > 0,
    'gamemode-config wildlife.density.kinds.sabrecat: the three sabre cat bases, a spacing wider than dangerSpacing, a respawn', K);
  const before = loadWild(withoutKinds());
  const after = loadWild(CFG.wildlife);
  const again = loadWild(CFG.wildlife);
  const placementOf = new Map(); { let n = 0; for (const pl of W.placements) { if (!pl.ref || !Array.isArray(pl.pos)) continue; if (pl.noNavmesh || pl.anchorGone) { n++; continue; } if (!(pl.options || []).length) continue; placementOf.set(`wild:${pl.kind}:${n++}`, pl); } }
  const opts = (z) => (placementOf.get(z.Name).options || []).slice().sort((x, y) => x[0] - y[0]);
  const den = (z) => opts(z).every((o) => SABRE.has(String(o[1]).toLowerCase()));

  const sb = before.filter((z) => z.ID === SKY && isSabre(z)), sa = after.filter((z) => z.ID === SKY && isSabre(z));
  console.log(`      Skyrim sabre cat zones: ${sb.length} before -> ${sa.length} after (dens ${sb.filter(den).length})`);
  console.log(`      per hold before ${JSON.stringify(perHold(before))}`);
  console.log(`      per hold after  ${JSON.stringify(perHold(after))}`);
  ok(sb.length >= 90, 'before: the predator rolls give Skyrim about 94 sabre cat zones (what NPC-Spawns.json holds live)', sb.length);
  ok(K && sa.length <= 40, 'after: at most 40 sabre cat zones in Skyrim', sa.length);
  let close = 0; for (let i = 0; i < sa.length; i++) for (let j = i + 1; j < sa.length; j++) if (!(den(sa[i]) && den(sa[j])) && Math.hypot(sa[i].POS[0] - sa[j].POS[0], sa[i].POS[1] - sa[j].POS[1]) < (K ? K.spacing : 0)) close++;
  ok(K && close === 0, `no two sabre cats within the kind's spacing (dens aside)`, close);
  ok(sb.filter(den).every((z) => isSabre(after.find((a) => a.Name === z.Name))), 'every sabre cat den keeps its cat', sb.filter(den).length);

  const byName = new Map(before.map((z) => [z.Name, z]));
  const thinned = after.filter((z) => isSabre(byName.get(z.Name)) && !isSabre(z));
  ok(thinned.length > 0 && thinned.every((z) => { const o = opts(z), i = o.findIndex((x) => x[1] === byName.get(z.Name).NPC[0].id); const below = o.slice(0, i).reverse().find((x) => !SABRE.has(String(x[1]).toLowerCase())); return below && below[1] === z.NPC[0].id; }),
    'a thinned spot takes the next creature below the sabre cat in its own list', thinned.slice(0, 3).map((z) => [z.Name, z.NPC[0].id]));
  const into = {}; for (const z of thinned) into[z.NPC[0].id] = (into[z.NPC[0].id] || 0) + 1;
  console.log(`      thinned sabre cats became: ${JSON.stringify(into)}`);

  ok(before.length === after.length && before.every((z, i) => z.Name === after[i].Name), 'same zone names in the same order', [before.length, after.length]);
  const changed = after.filter((z) => z.NPC[0].id !== byName.get(z.Name).NPC[0].id || z.Respawn !== byName.get(z.Name).Respawn);
  ok(changed.every((z) => z.ID === SKY && /Predator|SabreCat/.test(placementOf.get(z.Name).edid)), 'only Skyrim predator spots change (Cyrodiil, Solstheim and other creatures untouched)', changed.filter((z) => z.ID !== SKY).map((z) => z.Name).slice(0, 5));
  const knock = changed.filter((z) => !isSabre(byName.get(z.Name)) && !isSabre(z));
  const how = {}; for (const z of knock) { const k = `${byName.get(z.Name).NPC[0].id} -> ${z.NPC[0].id}${z.Respawn !== byName.get(z.Name).Respawn ? ` (respawn ${byName.get(z.Name).Respawn} -> ${z.Respawn})` : ''}`; how[k] = (how[k] || 0) + 1; }
  console.log(`      other dangerous spots that changed because a nearby sabre cat stepped down: ${knock.length} ${JSON.stringify(how)}`);
  ok(JSON.stringify(after) === JSON.stringify(again), 'two loads give identical zones');
  ok(K && sa.every((z) => z.Respawn === K.respawnSeconds), "kept sabre cats respawn after the kind's respawnSeconds", sa.map((z) => z.Respawn).slice(0, 5));

  for (const s of String(process.env.SPACINGS || '').split(',').map(Number).filter((x) => x > 0)) {
    const z = loadWild(withKinds({ sabrecat: Object.assign({}, K || { bases: [...SABRE] }, { spacing: s }) }));
    console.log(`      spacing ${s}: ${z.filter((x) => x.ID === SKY && isSabre(x)).length} sabre cats ${JSON.stringify(perHold(z))}`);
  }
} catch (e) { ok(false, 'harness ran', e.stack); }
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
