// The people of open Skyrim (Nate, 16 Oct: "the npcs in skyrim needs to work like how bruma is"): town-spawns.json
// (tools/spawns/town_spawns.py) and townspawns.js, against the real data, gamemode-config.json, gamemode.js and wildlife.js.
//   1. the data: every spot whole (hold, kind, base, world, spot, heading), one of the nine holds, a known kind, the zone
//      names unique and <= 64; outdoors an anchor no DragonBreak plugin touches; on the navmesh (the generator measured
//      each spot's height over the nearest triangle under it); none within 512 units of a hold-gate landing, a respawn
//      temple or the arrival; no person or animal the dungeon leases, wildlife or Blackreach already spawn;
//   2. the gate: with pass 2 not loaded (every source actor enabled) no town zone is written and the others stay; with it
//      loaded the zones appear; a ref pass 2 missed stays the plugin's;
//   3. the limits: kinds (children and horses off), holds one by one, excluded towns, the caps per town, interior cell
//      and exterior cell; never hostile; enabled false removes every town zone and keeps the rest; a reload with nothing
//      changed does not rewrite NPC-Spawns.json; wildlife.js keeps the town zones when it writes its own;
//   4. lawless and empty: ff_factions with no crime faction for people only; a dead one's body is emptied, a wild one's not;
//   5. the numbers: spots per hold and kind, and the most that can stand at once per town (the budget).
//   node tests/townspawns-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`); if (!c) fails++; };
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const T = readJson('town-spawns.json');
const CFG = readJson('gamemode-config.json');
const TS = require(path.join(ROOT, 'townspawns.js'));
const HOLDS = TS.HOLDS;
const KINDS = new Set(['merchant', 'townsfolk', 'guard', 'friendly', 'child', 'animal', 'horse']);
const sp = T.spawns;

// ---- 1. the data ----------------------------------------------------------------------------------------------------
ok(sp.length > 1000, `${sp.length} spots from NPC pass 2's list (${T.list}, sha ${T.listSha})`);
const whole = (s) => s.src && KINDS.has(s.kind) && HOLDS.includes(s.hold) && s.town && /^[0-9a-f]+:.+\.es[mpl]$/i.test(s.npc) && /^[0-9a-f]+:.+\.es[mpl]$/i.test(s.base)
  && /^[0-9a-f]+:.+\.es[mpl]$/i.test(s.world) && Array.isArray(s.pos) && s.pos.length === 3 && s.pos.every(Number.isFinite) && Number.isFinite(s.heading) && s.heading >= 0 && s.heading < 360
  && typeof s.interior === 'boolean' && Array.isArray(s.factions);
ok(sp.every(whole), 'every spot whole: a known kind, one of the nine holds, its town, base and picked NPC, world or cell, spot and heading', sp.filter((s) => !whole(s)).slice(0, 3));
const names = sp.map(TS.zoneName);
ok(new Set(names.map((n) => n.toLowerCase())).size === sp.length && names.every((n) => n.length <= 64 && /^town:[a-z]+:[0-9a-f]+-[a-z0-9]+$/.test(n)), 'zone names unique, <= 64, town:<kind>:<local id>-<plugin>',
  names.filter((n, i) => names.indexOf(n) !== i).slice(0, 5));
ok(new Set(sp.map((s) => s.src.toLowerCase())).size === sp.length, 'each plugin actor stands once');
const OWNED = /:(DragonBreak[^:]*|LostArk_Kamen|\[Kirax\][^:]*)\.esp$/i;
ok(sp.filter((s) => !s.interior).every((s) => s.ref && !OWNED.test(s.ref) && s.anchorDist <= 8192), 'outdoors every spot has an anchor ref within 8192 units that no DragonBreak plugin places or overrides',
  sp.filter((s) => !s.interior && !(s.ref && !OWNED.test(s.ref) && s.anchorDist <= 8192)).slice(0, 3));
ok(sp.every((s) => s.nav !== null && Math.abs(s.nav) <= 128), 'every spot stands on its navmesh (within 128 units of the triangle under it; interiors and outdoors)', sp.filter((s) => !(Math.abs(s.nav) <= 128)).slice(0, 3));
ok((T.skipped.noNavmesh || []).length > 0 && (T.skipped.insideGeometry || []).length > 0, `left out: ${(T.skipped.noNavmesh || []).length} with no navmesh under them, ${(T.skipped.insideGeometry || []).length} inside an object's box`);
// The spot check: 20 spots spread over holds and kinds, with their height over the navmesh
const pick = []; const seen = new Set();
for (const s of [...sp].sort((a, b) => (a.src < b.src ? -1 : 1))) { const k = `${s.hold}|${s.kind}|${s.interior}`; if (!seen.has(k) && pick.length < 20) { seen.add(k); pick.push(s); } }
for (const s of pick) console.log(`      spot ${s.hold.padEnd(10)} ${s.kind.padEnd(9)} ${(s.cellEdid || s.world).slice(0, 30).padEnd(30)} ${s.edid.slice(0, 28).padEnd(28)} ${String(s.nav).padStart(6)} over navmesh`);
ok(pick.length === 20 && pick.every((s) => Math.abs(s.nav) <= 128), 'spot check: 20 spots spread over holds and kinds stand on the navmesh');
// Where players appear: gate landings (gamemode.js GATE_DEFAULTS + config hubGates), respawn temples, the arrival
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const landings = [];
for (const m of (gm.match(/const GATE_DEFAULTS = \{([\s\S]*?)\n\};/) || ['', ''])[1].matchAll(/\[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\]/g)) landings.push(['3c:skyrim.esm', +m[1], +m[2], 'gate']);
for (const m of (gm.match(/const TEMPLE_DEFAULTS = \{([\s\S]*?)\n\};/) || ['', ''])[1].matchAll(/world: '([^']+)', pos: \[(-?[\d.]+), (-?[\d.]+),/g)) landings.push([m[1].toLowerCase(), +m[2], +m[3], 'temple']);
for (const g of Object.values(CFG.hubGates || {})) if (g && Array.isArray(g.spots)) for (const q of g.spots) landings.push(['3c:skyrim.esm', q[0], q[1], 'gate']);
for (const t of Object.values(CFG.respawnTemples || {})) if (t && t.world) landings.push([t.world.toLowerCase(), t.pos[0], t.pos[1], 'temple']);
for (const t of [CFG.landing, (CFG.playtest || {}).arrival]) if (t && t.world) landings.push([t.world.toLowerCase(), t.pos[0], t.pos[1], 'arrival']);
ok(landings.filter((l) => l[3] === 'gate').length >= 40 && landings.filter((l) => l[3] === 'temple').length >= 9, `${landings.length} landing, temple and arrival spots read from gamemode.js and the config`);
const tooNear = sp.filter((s) => !s.interior && landings.some((l) => l[0] === s.world.toLowerCase() && Math.hypot(l[1] - s.pos[0], l[2] - s.pos[1]) < 512));
ok(tooNear.length === 0, 'no spot within 512 units of a hold-gate landing, a respawn temple or the arrival', tooNear.map((s) => s.src));
const LEASED = fs.readFileSync(path.join(ROOT, 'dungeons.json'), 'utf8').toLowerCase();
const WILD = new Set(readJson('wildlife.json').placements.map((p) => String(p.src).toLowerCase()));
ok(sp.every((s) => !LEASED.includes(`"${s.src.toLowerCase()}"`) && !WILD.has(s.src.toLowerCase())), 'none is a dungeon lease placement or a wildlife.json creature (they have their own spawners)');
ok(sp.every((s) => !/Manakin|Invisible|^DefaultRace$/i.test(s.race)) && sp.filter((s) => s.kind === 'animal').every((s) => /^(Chicken|Cow|Goat|Dog|DogCompanion|DLC1Husky\w*|Deer|DLC1DeerGlow|Hare|Fox|Elk)Race$/i.test(s.race)),
  'no display stand or marker; the animals are tame ones (chickens, cows, goats, dogs, deer, hares, foxes)');
ok(sp.every((s) => s.factions.every(([d]) => /^[0-9a-f]+:.+\.es[mpl]$/i.test(d))), 'factions are descs (crime and service factions were left out by the generator)');

// ---- 2-4. the module, in a scratch folder ----------------------------------------------------------------------------
const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-townspawns-'));
const cwd = process.cwd();
const savedInterval = global.setInterval, savedClear = global.clearInterval;
const PLUG = new Map(); let nextPlug = 1;
const idOf = (d) => { const [h, p] = String(d).split(':'); const k = String(p || '').toLowerCase(); if (!PLUG.has(k)) PLUG.set(k, nextPlug++); return ((PLUG.get(k) << 24) | (parseInt(h, 16) & 0xffffff)) >>> 0; };
const props = new Map();
let disabledSet = new Set();   // ids whose source ACHR is Initially Disabled in the "loaded plugins"
const mp = {
  get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v), getIdFromDesc: idOf,
  lookupEspmRecordById: (id) => ({ record: { type: 'ACHR', flags: disabledSet.has(id >>> 0) ? 0x800 : 0x400 } }),
};
const logs = [];
const load = (townCfg, opts = {}) => {
  if (!opts.keepCache) globalThis.__dboTownDisabled = undefined;
  delete require.cache[path.join(ROOT, 'townspawns.js')];
  require(path.join(ROOT, 'townspawns.js'))({ mp, log: (...a) => logs.push(a.join(' ')), cfg: Object.assign({}, CFG, { townSpawns: townCfg }) });
  return JSON.parse(fs.readFileSync(path.join(dir, 'NPC-Spawns.json'), 'utf8')).zones;
};
const town = (zs) => zs.filter((z) => String(z.Name).startsWith('town:'));
const base = CFG.townSpawns;
try {
  process.chdir(dir);
  global.setInterval = () => ({ unref() {} }); global.clearInterval = () => {};
  fs.copyFileSync(path.join(ROOT, 'town-spawns.json'), path.join(dir, 'town-spawns.json'));
  const OTHER = [{ Name: 'wild:wolf:0', ID: '3c:Skyrim.esm', POS: [1, 2, 3], Size: 3000, NPC: [{ id: '23ab3:Skyrim.esm', count: 1 }] }, { Name: 'dungeon:x:1', ID: '3c:Skyrim.esm', POS: [1, 2, 3], Size: 100, NPC: [{ id: '1:Skyrim.esm', count: 1 }] }];
  fs.writeFileSync(path.join(dir, 'NPC-Spawns.json'), JSON.stringify({ _comment: 'x', zones: OTHER }));

  // 2. the gate
  let zs = load(base);
  ok(town(zs).length === 0 && zs.length === 2, 'pass 2 not loaded (every plugin actor enabled): no town zone written, the wild and dungeon zones kept', zs.length);
  ok(logs.some((l) => /plugin actor still enabled/.test(l)), 'the boot line says they wait on the plugin actors');
  const srcIds = sp.map((s) => idOf(s.src));
  disabledSet = new Set(srcIds);
  zs = load(base);
  const tz = town(zs);
  console.log('      ' + logs[logs.length - 1]);
  ok(tz.length > 300 && zs.length === tz.length + 2, `pass 2 loaded: ${tz.length} town zones, the other two kept`);
  const missed = sp.find((s) => TS.zoneName(s) === tz[0].Name);
  disabledSet.delete(idOf(missed.src));
  zs = load(base);
  ok(!town(zs).some((z) => z.Name === tz[0].Name), 'a ref pass 2 missed (still enabled) stays the plugin\'s: no zone beside it');
  disabledSet = new Set(srcIds);

  // 3. the limits
  zs = load(base);
  const S = TS.settingsOf({ townSpawns: base });
  const byName = new Map(sp.map((s) => [TS.zoneName(s), s]));
  const live = town(zs).map((z) => byName.get(z.Name));
  ok(live.every(Boolean) && live.every((s) => s.kind !== 'child' && s.kind !== 'horse'), 'children and horses are held back (Bruma spawns neither)');
  ok(live.every((s) => !/^MilitaryCamp|^HelgenLocation$|^NorthwatchKeepLocation$/.test(s.town) && !/^CW|MQ101|Tullius|Ulfric|Galmar|Penitus|^MS09/.test(s.edid)),
    '4E 211 canon by default: no Legion or Stormcloak camp or garrison, no Helgen intro, no Northwatch Thalmor, no Penitus Oculatus',
    live.filter((s) => /^MilitaryCamp/.test(s.town) || /^CW|MQ101/.test(s.edid)).slice(0, 3).map((s) => s.src));
  ok(town(zs).every((z) => z.Hostile === false && z.NPC.length === 1 && z.NPC[0].count === 1 && z.Respawn === S.respawnSeconds && z.Despawn === S.despawnSeconds), 'every zone one NPC, never hostile, the configured despawn and respawn');
  ok(town(zs).every((z) => { const s = byName.get(z.Name); return z.ID === s.world && z.POS === undefined ? false : z.POS.join() === s.pos.join() && z.Heading === s.heading && z.NPC[0].id === s.npc && (s.interior ? z.Size === S.interiorRadius : z.Size === S.radius && z.Anchor === s.ref); }),
    'each zone on its own spot and heading, in its own world or cell, the picked NPC, anchored outdoors');
  const per = (f) => { const m = new Map(); for (const s of live) { const k = f(s); if (k) m.set(k, (m.get(k) || 0) + 1); } return Math.max(0, ...m.values()); };
  ok(per((s) => (s.interior || /-wilds$/.test(s.town) ? null : `${s.hold}|${s.town}`)) <= S.maxPerTown && per((s) => (s.interior ? s.world : null)) <= S.maxPerCell
    && per((s) => (s.interior ? null : `${s.world}|${Math.floor(s.pos[0] / 4096)}|${Math.floor(s.pos[1] / 4096)}`)) <= S.maxPerGrid,
    `caps hold: at most ${S.maxPerTown} outdoors a town, ${S.maxPerCell} an interior, ${S.maxPerGrid} an exterior cell`);
  const wr = live.filter((s) => s.hold === 'whiterun' && s.town === 'WhiterunLocation' && !s.interior);
  ok(new Set(wr.map((s) => s.kind)).size >= 3, `a capped town keeps a spread of kinds (Whiterun outdoors: ${[...new Set(wr.map((s) => s.kind))].join(', ')})`);
  const again = load(base).map((z) => z.Name).join();
  ok(again === zs.map((z) => z.Name).join(), 'the same spots every load');
  const mtime = fs.statSync(path.join(dir, 'NPC-Spawns.json')).mtimeMs;
  load(base);
  ok(fs.statSync(path.join(dir, 'NPC-Spawns.json')).mtimeMs === mtime, 'a reload with nothing changed leaves NPC-Spawns.json alone (no spawner reload)');
  zs = load(Object.assign({}, base, { holds: Object.assign({}, base.holds, { riften: false }) }));
  ok(!town(zs).some((z) => byName.get(z.Name).hold === 'riften') && town(zs).some((z) => byName.get(z.Name).hold === 'whiterun'), 'a hold switched off holds back its people only');
  zs = load(Object.assign({}, base, { excludeTowns: ['^WhiterunLocation$'] }));
  ok(!town(zs).some((z) => byName.get(z.Name).town === 'WhiterunLocation'), 'an excluded town has nobody');
  zs = load(Object.assign({}, base, { kinds: Object.assign({}, base.kinds, { child: true }) }));
  ok(town(zs).some((z) => byName.get(z.Name).kind === 'child'), 'children come when switched on');
  zs = load(Object.assign({}, base, { enabled: false }));
  ok(town(zs).length === 0 && zs.length === 2, 'enabled false removes every town zone and keeps the rest (the rollback)');
  zs = load(base);
  // wildlife.js writing its own zones keeps ours
  for (const f of ['wildlife.json', 'owned-spawns.json', 'loot.json', 'artifacts.json', 'blackreach.json', 'dragon-materials.json']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  globalThis.__dboWildFactionAudit = ' (skipped in the harness)'; globalThis.__dboWildSig = undefined;
  delete require.cache[path.join(ROOT, 'wildlife.js')];
  require(path.join(ROOT, 'wildlife.js'))({ mp, log: () => {}, personal: () => {}, system: () => {}, registerChatCommand: () => {}, giveItem: () => true, profileOf: () => 1,
    display: String, who: String, audit: () => {}, isAdmin: () => false, cfg: CFG, onlineActors: () => [], sendPacket: () => {} });
  const afterWild = JSON.parse(fs.readFileSync(path.join(dir, 'NPC-Spawns.json'), 'utf8')).zones;
  ok(town(afterWild).length === town(zs).length && afterWild.some((z) => /^wild:/.test(z.Name) && z.Name !== 'wild:wolf:0'), 'wildlife.js rewriting its own zones keeps every town zone');

  // 4. lawless, and empty bodies
  const person = town(zs).map((z) => byName.get(z.Name)).find((s) => s.kind === 'guard' && s.factions.length);
  const animal = town(zs).map((z) => byName.get(z.Name)).find((s) => s.kind === 'animal');
  const pid = 0xff000101, aid = 0xff000102, wid = 0xff000103;
  props.set(`${pid}|private.npcSpawner`, TS.zoneName(person)); props.set(`${aid}|private.npcSpawner`, TS.zoneName(animal)); props.set(`${wid}|private.npcSpawner`, 'wild:wolf:0');
  fs.writeFileSync(path.join(dir, 'zone-spawns.json'), JSON.stringify([pid, aid, wid]));
  globalThis.__dboTownFactionTick();
  const ff = props.get(`${pid}|ff_factions`);
  ok(ff && ff.c === 0 && ff.f.length === person.factions.length && ff.f.every(([id]) => id > 0), `a guard (${person.edid}) gets its own ${person.factions.length} factions and no crime faction`, ff);
  ok(props.get(`${aid}|ff_factions`) === undefined && props.get(`${wid}|ff_factions`) === undefined, 'animals and wild creatures are left as they are');
  props.set(`${pid}|inventory`, { entries: [{ baseId: 0xf, count: 30 }, { baseId: 0x13951, count: 1 }] });
  props.set(`${wid}|inventory`, { entries: [{ baseId: 0x3ad6f, count: 1 }] });
  globalThis.__dboTownDeath(pid); globalThis.__dboTownDeath(wid);
  ok(props.get(`${pid}|inventory`).entries.length === 0 && props.get(`${wid}|inventory`).entries.length === 1, 'a dead townsperson carries nothing; a wild creature keeps its body');
  ok(/globalThis\.__dboTownDeath\(Number\(actorId\) >>> 0\)/.test(gm) && /require\(TOWNSPAWNS_JS\)\(\{ mp, log, cfg \}\)/.test(gm), 'gamemode.js loads townspawns.js and calls the death hook');

  // 5. the numbers
  const kinds = [...KINDS];
  console.log('      spots per hold (all kinds)       ' + kinds.join(' / '));
  for (const h of HOLDS) { const hs = sp.filter((s) => s.hold === h); console.log(`      ${h.padEnd(11)} ${String(hs.length).padStart(4)}   ${kinds.map((k) => hs.filter((s) => s.kind === k).length).join(' / ')}`); }
  const towns = new Map();
  for (const s of live) { const k = `${s.hold}|${s.town}`; const t = towns.get(k) || { out: 0, cells: new Map() }; if (s.interior) t.cells.set(s.world, (t.cells.get(s.world) || 0) + 1); else t.out++; towns.set(k, t); }
  const top = [...towns.entries()].sort((a, b) => (b[1].out + Math.max(0, ...b[1].cells.values())) - (a[1].out + Math.max(0, ...a[1].cells.values()))).slice(0, 8);
  console.log(`      live with the defaults: ${live.length} zones in ${towns.size} places; a player in one place fills its outdoors (<= ${S.maxPerTown}) and the interior they stand in (<= ${S.maxPerCell})`);
  for (const [k, t] of top) console.log(`      ${k.padEnd(40)} outdoors ${String(t.out).padStart(3)}, ${t.cells.size} interiors, largest ${Math.max(0, ...t.cells.values())}`);
  ok(top.every(([k, t]) => /-wilds$/.test(k) || t.out <= S.maxPerTown), 'no town puts more than maxPerTown outdoors (a hold\'s wilds only have the exterior-cell cap)');
} finally {
  process.chdir(cwd);
  global.setInterval = savedInterval; global.clearInterval = savedClear;
  if (globalThis.__dboTownFactionTimer && globalThis.__dboTownFactionTimer.unref) { /* the stub's */ }
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
