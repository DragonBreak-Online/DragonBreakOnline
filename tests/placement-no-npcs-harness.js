// Scripted test for server\placement.js without NPCs (Nat, 2 Nov: "the only way to bring NPCs is the warbands and those
// systems"; "remove all of the NPCs people placed with the Place tool"). Without config placement.npcs the Place tab
// refuses NPCs for every tier, sets included, and leaves the NPC categories out of the catalog, placeMeta and the search;
// objects place as before. The run file placement-purge.json removes placed NPCs: dryrun changes nothing and gives a
// code, apply needs that code, backs up both files first, audits each, and leaves placed objects and other zones alone.
// Mutants of a copy of placement.js must fail. Run from this folder's parent:
//
//   node tests\placement-no-npcs-harness.js [placement.js to test]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = fs.readFileSync(path.resolve(process.argv[2] || path.join(__dirname, '..', 'placement.js')), 'utf8').replace(/\r\n/g, '\n');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-placenpcs-'));
const home = process.cwd();
process.on('exit', () => { process.chdir(home); try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* the OS */ } });

const GM = 0xff000001, LIVE = 0xff000777;
const NPC = '1e80e:Dragonborn.esm'; // verify-formids: ignore (a Place catalog row)
const CHEST = 'bbcf1:Skyrim.esm'; // verify-formids: ignore (a Place catalog row)
let n = 0;

const run = (src, check) => {
  const dir = path.join(root, `run-${n++}`);
  fs.mkdirSync(dir);
  process.chdir(dir);
  fs.writeFileSync('admin-placeables.json', JSON.stringify({ categories: [
    { id: 'NPCs', label: 'NPCs', kind: 'npc', items: [[NPC, 'Bandit', 'Dragonborn.esm']] },
    { id: 'Crafting Stations', label: 'Crafting Stations', kind: 'object', items: [[CHEST, 'Blacksmith Forge', 'Skyrim.esm']] },
  ] }));
  const W = 'a764b:BSHeartland.esm';
  const npc = (id, hostile, by, zone) => Object.assign({ id, base: NPC, name: 'Bandit', kind: 'npc', where: W, pos: [1, 2, 3], rot: [0, 0, 0], hostile, by, at: 'then' }, zone ? { zone: true } : {});
  const REG = [
    npc('nmvvaaaa001', true, 47, true), npc('nmvvaaaa002', true, 47, true), npc('nmvstgstg0yc', true, 51, true),
    npc('nfriend0001', false, 9, true), npc(LIVE.toString(16), false, 9, false),
    { id: 'ff000900', base: CHEST, name: 'Blacksmith Forge', kind: 'object', where: W, pos: [5, 5, 5], rot: [0, 0, 0], by: 47, at: 'then' },
  ];
  fs.writeFileSync('placements.json', JSON.stringify(REG));
  const zoneOf = (e) => ({ Name: 'placed:' + e.id, ID: e.where, POS: e.pos, Size: 4000, NPC: [{ id: e.base, count: 1 }], Despawn: 0, Respawn: 0, Heading: 0, Hostile: !!e.hostile });
  fs.writeFileSync('NPC-Spawns.json', JSON.stringify({ _comment: 'hand', zones: [{ Name: 'wild:wolf:1', ID: '3c:Skyrim.esm', POS: [0, 0, 0], NPC: ['123 1'] }].concat(REG.filter((e) => e.zone).map(zoneOf)) }));
  const regBefore = fs.readFileSync('placements.json', 'utf8');
  const spawnsBefore = fs.readFileSync('NPC-Spawns.json', 'utf8');

  const props = new Map([[`${GM}|worldOrCellDesc`, W], [`${GM}|pos`, [1000, 2000, 300]], [`${GM}|profileId`, 2], [`${LIVE}|private.dboPlaced`, { base: NPC, kind: 'npc', by: 9 }]]);
  const calls = [];
  const mp = {
    get: (id, k) => props.get(id + '|' + k), set: (id, k, v) => props.set(id + '|' + k, v),
    getDescFromId: (id) => (id >>> 0).toString(16), getIdFromDesc: (d) => parseInt(d, 16),
    destroyActor: (id) => calls.push(['destroyActor', id >>> 0]),
    lookupEspmRecordById: () => ({ record: { type: 'FURN' } }),
    callPapyrusFunction: (kind, cls, fn) => { calls.push([fn]); return fn === 'PlaceAtMe' ? { type: 'form', desc: 'ff000a00' } : null; },
  };
  const out = { personal: [], audit: [], packets: [], log: [] };
  const ui = {};
  const timers = {};
  delete globalThis.__dboPlacement;
  const file = path.join(dir, 'placement-under-test.js');
  fs.writeFileSync(file, src);
  require(file)({
    mp, log: (...xs) => out.log.push(xs.join(' ')), personal: (a, t) => out.personal.push(t), audit: (t) => out.audit.push(t), who: (a) => 'P' + (a >>> 0).toString(16),
    onUi: (ev, fn) => { ui[ev] = fn; }, sendPacket: (a, p) => { out.packets.push(p); return true; },
    isAdmin: (a) => a === GM, tierOf: (a) => (a === GM ? 'senior' : null), registerChatCommand: () => {},
    every: (name, ms, fn) => { timers[name] = fn; },
  });
  const reset = () => { calls.length = 0; for (const k of Object.keys(out)) out[k].length = 0; };
  const reg = () => JSON.parse(fs.readFileSync('placements.json', 'utf8'));
  const zones = () => JSON.parse(fs.readFileSync('NPC-Spawns.json', 'utf8')).zones.map((z) => z.Name);
  const tick = (spec) => { if (spec !== undefined) fs.writeFileSync('placement-purge.json', JSON.stringify(spec)); return timers.placementPurge ? timers.placementPurge() : undefined; };
  const report = () => JSON.parse(fs.readFileSync('placement-purge-report.json', 'utf8'));
  const backups = () => fs.readdirSync('.').filter((f) => /\.bak-purge-/.test(f));

  // ---- the Place tab without NPCs ----
  reset(); ui.placeObject(GM, [NPC, 'npc', [1000, 2100, 300], 90, false]);
  check('a senior placing a friendly NPC is refused, pointing at the warband and event tools', reg().length === 6 && /warband and event tools/.test(out.personal[0]) && fs.readFileSync('NPC-Spawns.json', 'utf8') === spawnsBefore, out.personal[0]);
  reset(); ui.placeObject(GM, [NPC, 'npc', [1000, 2100, 300], 90, true]);
  check('...and a hostile one', reg().length === 6 && /warband/.test(out.personal[0]), out.personal[0]);
  reset(); ui.placeObject(GM, [CHEST, 'object', [1000, 2100, 300], 90, false]);
  check('an object still places', reg().length === 7 && /Placed Blacksmith Forge/.test(out.personal[0]), out.personal[0]);
  reset(); ui.placeCatalog(GM, []);
  check('the catalog leaves the NPC category out', out.packets[0] && out.packets[0].categories.map((c) => c.id).join() === 'Crafting Stations', JSON.stringify(out.packets[0] && out.packets[0].categories.map((c) => c.id)));
  reset(); ui.placeMeta(GM, []);
  check('placeMeta leaves it out and says NPCs are off', out.packets[0] && out.packets[0].categories.every((c) => c.kind !== 'npc') && out.packets[0].rights.npcs === false && out.packets[0].rights.hostile === false, JSON.stringify(out.packets[0]));
  reset(); ui.placeSearch(GM, ['bandit', '', '', 0]);
  check('the search finds no NPC', out.packets[0] && out.packets[0].total === 0, JSON.stringify(out.packets[0]));
  reset(); ui.placeSearch(GM, ['forge', '', '', 0]);
  check('...and still finds objects', out.packets[0] && out.packets[0].total === 1, JSON.stringify(out.packets[0]));
  fs.unlinkSync('placements.json'); fs.writeFileSync('placements.json', regBefore); globalThis.__dboPlacement.registry = null;

  // ---- the purge ----
  reset();
  check('no run file: nothing', tick() === null && out.log.length === 0);
  let r = tick({ mode: 'dryrun' });
  check('dryrun matches every placed NPC (friendly, hostile, the 29 Oct skeleton, a PlaceAtMe one) and no object', r && r.matched.length === 5 && !r.matched.some((l) => /Forge/.test(l)) && r.stay.length === 0, r && r.matched);
  check('...changes nothing and backs nothing up', fs.readFileSync('placements.json', 'utf8') === regBefore && fs.readFileSync('NPC-Spawns.json', 'utf8') === spawnsBefore && calls.length === 0 && backups().length === 0 && out.audit.length === 0);
  check('...logs each and gives the code', /5 NPC placement\(s\) would go, 0 stay; apply with "confirm": "[0-9a-f]{8}"/.test(out.log.join('\n')) && report().code === r.code, out.log.slice(-1)[0]);
  const code = r.code;
  check('the same file again: not run twice', tick() === null);
  reset(); r = tick({ mode: 'dryrun', hostile: true, keep: ['placed:nmvstgstg0yc'] });
  check('filters: hostile only, keeping one', r && r.matched.length === 2 && r.stay.length === 3 && r.code !== code, r && r.matched);
  reset(); r = tick({ mode: 'apply', confirm: 'deadbeef' });
  check('apply with a wrong code is refused and changes nothing', r && r.refused && fs.readFileSync('placements.json', 'utf8') === regBefore && calls.length === 0 && backups().length === 0 && /REFUSED/.test(out.log.join('\n')), r && r.refused);
  reset(); r = tick({ mode: 'apply', confirm: code, by: [47] });
  check('a filter changing the set changes the code: refused', r && r.refused && fs.readFileSync('placements.json', 'utf8') === regBefore);
  reset(); r = tick({ mode: 'apply', confirm: code });
  check('apply with the dryrun\'s code removes every placed NPC from the list', r && r.removed === 5 && reg().length === 1 && reg()[0].kind === 'object', reg().map((e) => e.id));
  check('...and their zones, keeping the other zones', zones().join() === 'wild:wolf:1', zones().join());
  check('...destroys the PlaceAtMe one\'s actor', calls.some((c) => c[0] === 'destroyActor' && c[1] === LIVE), JSON.stringify(calls));
  check('...one audit line each', out.audit.length === 5 && out.audit.every((l) => /^PLACE purge removed Bandit/.test(l)) && out.audit.some((l) => /zone placed:nmvstgstg0yc/.test(l)), out.audit);
  const b = backups();
  check('...after backing up both files as they were', b.length === 2 && b.some((f) => /^placements\.json\.bak-purge-/.test(f) && fs.readFileSync(f, 'utf8') === regBefore) && b.some((f) => /^NPC-Spawns\.json\.bak-purge-/.test(f) && fs.readFileSync(f, 'utf8') === spawnsBefore), b);
  delete globalThis.__dboPlacement.purgeRan;
  reset(); r = tick();
  check('the same apply after a restart finds a different set and is refused', r && r.refused && reg().length === 1);
  reset(); r = tick({ mode: 'off' });
  check('mode off: nothing', r === null && /nothing done/.test(out.log.join('\n')));
  process.chdir(root);
};

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!ok) failures++; };
run(SRC, check);

const MUTANTS = [
  ['NPCs are placed again', "    if (kind === 'npc' && !NPCS) return { ok: false, text: NO_NPCS };\n", ''],
  ['the switch is on by default', 'const NPCS = P.npcs === true;', 'const NPCS = P.npcs !== false;'],
  ['the search keeps NPC rows', 'searchCatalog(searchRows(), query', 'searchCatalog(S.rows, query'],
  ['the catalog keeps the NPC category', '!HIDDEN.has(c.id) && shown(c)', '!HIDDEN.has(c.id)'],
  ['apply needs no code', "} else if (String(spec.confirm || '') !== code) {", '} else if (false) {'],
  ['dryrun applies', "if (mode === 'dryrun') {", "if (mode === 'dryrunx') {"],
  ['no backup', 'fs.copyFileSync(f, b); ', ''],
  ['PlaceAtMe actors stay', 'if (mp.get(id, TAG)) mp.destroyActor(id);', ''],
  ['keep is ignored', '!keep.has(String(e.id)) && ', ''],
  ['objects purged too', "registry().filter((e) => e && e.kind === 'npc');\n    const rows", "registry().filter((e) => e);\n    const rows"],
];
for (const [name, from, to] of MUTANTS) {
  if (!SRC.includes(from)) { check(`mutant "${name}": its line is still in placement.js`, false, from); continue; }
  let bad = 0;
  try { run(SRC.replace(from, to), (_n, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  check(`mutant caught: ${name}`, bad > 0);
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exitCode = failures ? 1 : 0;
