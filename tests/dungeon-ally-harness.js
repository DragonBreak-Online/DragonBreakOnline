// A dungeon's quest ally is no lease enemy (#bugs 1560726192754270389, High Gate Ruins, 16 Oct: "1 npc, bandit who was
// friendly but needed to be put down to count for 100%"; 18 Oct Anska fought a party; Valthume, 18 Oct: Valdar's ghost
// spawned as a hostile bandit boss). A placement whose own template is in DunPlayerAllyFaction (Anska, Valdar, the
// Harmugstahl adventurer) never joins a lease; every other placement still does. Loads the real dungeons.js with the
// real dungeons.json entries of High Gate Ruins and Valthume, and a mock record store for the two allies.
//   node tests/dungeon-ally-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 600)}`); if (!c) fails++; };
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

let rng = 1;
Math.random = () => { rng = (rng + 0x6d2b79f5) >>> 0; let t = Math.imul(rng ^ (rng >>> 15), rng | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const ALL = read('dungeons.json').dungeons;
const cfg = read('gamemode-config.json');
const D = ['HighGateRuinsLocation', 'ValthumeLocation'].map((id) => ALL.find((d) => d.id === id));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dungeon-ally-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
for (const f of ['loot.json', 'ayleid-loot.json', 'dungeon-pools.json', 'artifacts.json', 'dragon-materials.json']) { try { fs.copyFileSync(path.join(ROOT, f), f); } catch (e) { /* optional */ } }
fs.writeFileSync('dungeons.json', JSON.stringify({ dungeons: D }));
fs.writeFileSync('expeditions.json', JSON.stringify({ expeditions: [] }));
global.setTimeout = () => 0;

const ids = new Map(), descs = new Map(); let nextId = 0x100;
const idOf = (d) => { const k = String(d).toLowerCase(); if (!ids.has(k)) { ids.set(k, nextId); descs.set(nextId, k); nextId++; } return ids.get(k); };
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
const snam = (fact, rank) => { const b = new Uint8Array(8); new DataView(b.buffer).setUint32(0, fact >>> 0, true); b[4] = rank; return b; };
// Mock records: each ally placement (ACHR) names an NPC_ base whose own faction list holds DunPlayerAllyFaction
const REC = new Map();
const ALLY_FACTION = idOf('5a1a4:Skyrim.esm'), BANDIT_FACTION = idOf('1bcc0:Skyrim.esm');
REC.set(ALLY_FACTION, { type: 'FACT', editorId: 'DunPlayerAllyFaction', fields: [] });
REC.set(BANDIT_FACTION, { type: 'FACT', editorId: 'BanditFaction', fields: [] });
const npc = (base, factions) => REC.set(idOf(base), { type: 'NPC_', editorId: base, fields: [{ type: 'ACBS', data: new Uint8Array(24) }, ...factions.map((f) => ({ type: 'SNAM', data: snam(f, 0) }))] });
const achr = (ref, base) => REC.set(idOf(ref), { type: 'ACHR', fields: [{ type: 'NAME', data: u32(idOf(base)) }] });
npc('anska-base', [ALLY_FACTION]); achr('443f2:Skyrim.esm', 'anska-base');               // Anska, High Gate Ruins
npc('valdar-base', [ALLY_FACTION]); achr('8ce78:Skyrim.esm', 'valdar-base');             // Valdar's ghost, Valthume
npc('draugr-base', [BANDIT_FACTION]); achr('63ea3:Skyrim.esm', 'draugr-base');            // an enemy beside Anska keeps spawning
const lookup = (id) => (REC.has(id) ? { record: REC.get(id), toGlobalRecordId: (x) => x } : { record: null });

const A = 0x14;
globalThis.__dboCharLevel = () => 3;
globalThis.__dboDungeons = undefined;
const props = new Map();
const ui = new Map(), cmds = new Map(), logs = [];
require(path.join(ROOT, 'dungeons.js'))({
  mp: { get: (id, p) => (p === 'profileId' ? (id === A ? 1 : -1) : props.get(`${id}|${p}`)), set: (id, p, v) => props.set(`${id}|${p}`, v),
    getIdFromDesc: idOf, getDescFromId: (id) => descs.get(id), lookupEspmRecordById: lookup },
  log: (...a) => logs.push(a.join(' ')), personal: () => {}, system: () => {}, audit: () => {}, registerChatCommand: (n, fn) => cmds.set(n, fn), onUi: (n, fn) => { const l = ui.get(n) || []; l.push(fn); ui.set(n, l); },
  openWidget: () => true, closeWidget: () => true, sendPacket: () => true, findByName: () => 0, display: String, who: String, profileOf: (a) => (a === A ? 1 : -1), nameOf: () => 'P',
  onlineActors: () => [A], isAdmin: () => true, giveItem: () => true, cfg: { dungeons: Object.assign({}, cfg.dungeons || {}, { exclude: [] }) }, every: () => {},
});
const fire = (n, a, args) => (ui.get(n) || []).forEach((f) => f(a, args, 0));
const claim = (d, diff) => {
  const e = d.entrances[0];
  props.set(`${A}|worldOrCellDesc`, e.world || e.cell); props.set(`${A}|pos`, (e.doorPos || e.pos).slice());
  props.delete(`${A}|private.dungeonCooldowns`); if (globalThis.__dboDungeonAccountRest) globalThis.__dboDungeonAccountRest.clear();
  globalThis.__dboDungeonActivate(idOf(e.outsideDesc), A);
  const pend = globalThis.__dboDungeons.pending.get(A);
  if (pend) fire('dungeonClaim', A, [pend.nonce, diff]);
  return globalThis.__dboDungeons.leases.get(d.id);
};
const placed = (lease, ref) => (lease ? lease.zones : []).filter((z) => String(z.Placed || '').toLowerCase() === ref.toLowerCase());
for (const diff of ['story', 'normal', 'hard', 'nightmare']) {
  rng = 7;
  const hg = claim(D[0], diff);
  ok(!!hg && hg.zones.length > 5, `High Gate Ruins claimed on ${diff}: ${hg ? hg.zones.length : 0} enemy zones`);
  ok(!placed(hg, '443f2:Skyrim.esm').length, `${diff}: Anska (her template is the player's ally) is not among the enemies`, placed(hg, '443f2:Skyrim.esm').map((z) => z.Name));
  ok(hg && hg.zones.reduce((n, z) => n + z.NPC[0].count, 0) === hg.totalNpcs, `${diff}: the clear counts only the zones spawned`);
  if (hg) cmds.get('dungeon')(A, `end ${D[0].id.toLowerCase()}`);
  rng = 7;
  const vt = claim(D[1], diff);
  ok(!!vt && vt.zones.length > 5, `Valthume claimed on ${diff}: ${vt ? vt.zones.length : 0} enemy zones`);
  ok(!placed(vt, '8ce78:Skyrim.esm').length, `${diff}: Valdar's ghost (an ally) is not among the enemies`, placed(vt, '8ce78:Skyrim.esm').map((z) => z.Name));
  if (vt) cmds.get('dungeon')(A, `end ${D[1].id.toLowerCase()}`);
}
// An ordinary enemy whose template is not an ally still spawns: on Master every placement of High Gate Ruins is kept
rng = 7;
const master = claim(D[0], 'nightmare');
ok(placed(master, '63ea3:Skyrim.esm').length === 1, 'the draugr beside Anska (no ally faction) still spawns', master ? master.zones.map((z) => z.Placed).filter(Boolean).slice(0, 5) : null);
const wanted = D[0].zones.reduce((n, z) => n + z.npcs.filter((x) => String(x.ref).toLowerCase() !== '443f2:skyrim.esm').length, 0);
ok(master && master.zones.length === wanted, `Master keeps all ${wanted} other placements (got ${master ? master.zones.length : 0})`);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
