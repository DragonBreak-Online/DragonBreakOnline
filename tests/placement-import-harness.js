// placement.js's one-shot import (run file placement-import.json; 2 Nov: Nat's Expedition Board tiles placed on dev, brought
// to live without placing them again). dryrun changes nothing and gives a code; apply needs it, places each missing item by
// PlaceAtMe on its anchor (a reference in that cell) and moves it to its pose, lists, tags and audits it; an item placed
// already, an anchor in another cell, something not in the catalog or not an object is refused. Mutants of a copy must fail.
//   node tests\placement-import-harness.js [placement.js to test]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = fs.readFileSync(path.resolve(process.argv[2] || path.join(__dirname, '..', 'placement.js')), 'utf8').replace(/\r\n/g, '\n');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-placeimport-'));
const home = process.cwd();
process.on('exit', () => { process.chdir(home); try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* the OS */ } });

const BOARD = '6:DragonBreak.esp'; // verify-formids: ignore (a Place catalog row)
const NPC = '1e80e:Dragonborn.esm'; // verify-formids: ignore (a Place catalog row)
const WR = '165b7:Skyrim.esm', MK = '16dfe:Skyrim.esm'; // verify-formids: ignore (cell descs)
const ANCHOR_WR = 0x4e009cc8, ANCHOR_MK = 0x4e009cc0;
const ITEMS = [
  { base: BOARD, where: WR, pos: [-53, -1460.5, 182], rot: [0, 0, 274.08], anchor: '9cc8:DragonBreak Strongholds Fix.esp' },
  { base: BOARD, where: WR, pos: [-53, -1460.5, 194], rot: [0, 0, 274.08], anchor: '9cc8:DragonBreak Strongholds Fix.esp' },
  { base: BOARD, where: MK, pos: [-5777.5, -2167.9, 100.3], rot: [0, 0, 258.8], anchor: '9cc0:DragonBreak Strongholds Fix.esp' },
];
let n = 0;

const run = (src, check) => {
  const dir = path.join(root, `run-${n++}`);
  fs.mkdirSync(dir);
  process.chdir(dir);
  fs.writeFileSync('admin-placeables.json', JSON.stringify({ categories: [
    { id: 'Activators', label: 'Activators', kind: 'object', items: [[BOARD, 'Expedition Board', 'DragonBreak.esp']] },
    { id: 'NPCs', label: 'NPCs', kind: 'npc', items: [[NPC, 'Bandit', 'Dragonborn.esm']] },
  ] }));
  fs.writeFileSync('placements.json', '[]');
  const props = new Map([[`${ANCHOR_WR}|worldOrCellDesc`, WR], [`${ANCHOR_MK}|worldOrCellDesc`, MK]]);
  const calls = [];
  let next = 0xff000100;
  const mp = {
    get: (id, k) => props.get(`${id >>> 0}|${k}`), set: (id, k, v) => props.set(`${id >>> 0}|${k}`, v),
    getDescFromId: (id) => (id >>> 0).toString(16),
    getIdFromDesc: (d) => ({ '9cc8:DragonBreak Strongholds Fix.esp': ANCHOR_WR, '9cc0:DragonBreak Strongholds Fix.esp': ANCHOR_MK }[d] || (/:/.test(d) ? 0 : parseInt(d, 16) || 0)),
    lookupEspmRecordById: () => ({ record: { type: 'ACTI' } }),
    callPapyrusFunction: (kind, cls, fn, self, args) => {
      calls.push([fn, parseInt(self.desc, 16) >>> 0, args]);
      if (fn === 'PlaceAtMe') { const id = next++; props.set(`${id}|worldOrCellDesc`, props.get(`${parseInt(self.desc, 16) >>> 0}|worldOrCellDesc`)); return { type: 'form', desc: id.toString(16) }; }
      return null;
    },
  };
  const out = { audit: [], log: [] };
  const timers = {};
  delete globalThis.__dboPlacement;
  const file = path.join(dir, 'placement-under-test.js');
  fs.writeFileSync(file, src);
  require(file)({
    mp, log: (...xs) => out.log.push(xs.join(' ')), personal: () => {}, audit: (t) => out.audit.push(t), who: (a) => 'P' + a,
    onUi: () => {}, sendPacket: () => true, isAdmin: () => false, tierOf: () => null, registerChatCommand: () => {},
    every: (name, ms, fn) => { timers[name] = fn; },
  });
  const tick = (spec) => { if (spec !== undefined) fs.writeFileSync('placement-import.json', JSON.stringify(spec)); return timers.placementImport ? timers.placementImport() : undefined; };
  const reg = () => JSON.parse(fs.readFileSync('placements.json', 'utf8'));

  check('the import timer is there', typeof timers.placementImport === 'function');
  check('no run file: nothing', tick() === null);
  let r = tick({ mode: 'dryrun', by: 2, items: ITEMS });
  check('dryrun: all three would be placed, nothing placed', r && r.items.every((l) => /would place/.test(l)) && reg().length === 0 && !calls.some((c) => c[0] === 'PlaceAtMe'), r && r.items);
  check('...and gives the code', /3 of 3 would be placed; apply with "confirm": "[0-9a-f]{8}"/.test(out.log.join('\n')), out.log.slice(-1));
  const code = r.code;
  r = tick({ mode: 'apply', by: 2, items: ITEMS, confirm: 'deadbeef' });
  check('apply with a wrong code is refused', r && r.refused && reg().length === 0 && !calls.some((c) => c[0] === 'PlaceAtMe'));
  r = tick({ mode: 'apply', by: 2, items: ITEMS, confirm: code });
  const placed = reg();
  check('apply places all three, by PlaceAtMe on each one\'s anchor', placed.length === 3 && calls.filter((c) => c[0] === 'PlaceAtMe').map((c) => c[1]).join() === [ANCHOR_WR, ANCHOR_WR, ANCHOR_MK].join(), calls.filter((c) => c[0] === 'PlaceAtMe').map((c) => c[1].toString(16)));
  check('...each moved to its pose', calls.filter((c) => c[0] === 'SetPosition').map((c) => c[2].map(Math.round).join(',')).join(' ') === '-53,-1460,182 -53,-1460,194 -5777,-2168,100', calls.filter((c) => c[0] === 'SetPosition').map((c) => c[2]));
  check('...listed as Place tab objects in their cells, credited to the profile', placed.every((e) => e.kind === 'object' && e.base === BOARD && e.by === 2 && e.imported === true) && placed.filter((e) => e.where === WR).length === 2 && placed.filter((e) => e.where === MK).length === 1, placed);
  check('...tagged as placed things (removable from the Place tab)', placed.every((e) => mp.get(parseInt(e.id, 16), 'private.dboPlaced') && mp.get(parseInt(e.id, 16), 'private.dboPlaced').base === BOARD));
  check('...one audit line each', out.audit.filter((t) => /^PLACE import placed Expedition Board/.test(t)).length === 3, out.audit);
  // Again after a restart (the same file): the three are there, nothing is placed twice
  delete globalThis.__dboPlacement.importRan;
  calls.length = 0;
  r = tick();
  check('the same apply again places nothing: each is placed already', r && !r.refused && reg().length === 3 && !calls.some((c) => c[0] === 'PlaceAtMe') && r.items.every((l) => /placed already/.test(l)) || (r && r.refused && reg().length === 3), r && r.items);
  // Refusals
  r = tick({ mode: 'dryrun', items: [
    { base: BOARD, where: MK, pos: [1, 2, 3], rot: [0, 0, 0], anchor: '9cc8:DragonBreak Strongholds Fix.esp' },
    { base: NPC, where: WR, pos: [1, 2, 3], rot: [0, 0, 0], anchor: '9cc8:DragonBreak Strongholds Fix.esp' },
    { base: 'dead:Nope.esp', where: WR, pos: [1, 2, 3], rot: [0, 0, 0], anchor: '9cc8:DragonBreak Strongholds Fix.esp' }, // verify-formids: ignore (unknown on purpose)
    { base: BOARD, where: WR, pos: [1, 2, 3], rot: [0, 0, 0], anchor: '1:None.esp' }, // verify-formids: ignore (unknown on purpose)
  ] });
  check('an anchor in another cell, an NPC, something not in the catalog and an anchor that is not there are each refused', r && /anchor .* is in 165b7/.test(r.items[0]) && /not an object/.test(r.items[1]) && /not in the placement catalog/.test(r.items[2]) && /anchor 1:None.esp not found/.test(r.items[3]), r && r.items);
  process.chdir(root);
};

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!ok) failures++; };
run(SRC, check);
const MUTANTS = [
  ['apply needs no code', "} else if (String(spec.confirm || '') !== code) {\n      report.refused = `confirm \"${String(spec.confirm || '')}\" is not this list's code`;", "} else if (false) {\n      report.refused = '';"],
  ['dryrun places', "if (mode === 'dryrun') {\n      for (const line of report.items) log(`placement import dryrun", "if (mode === 'dryrunx') {\n      for (const line of report.items) log(`placement import dryrun"],
  ['no duplicate check', '    if (dup) return { why: `placed already (${dup.id})`, skip: true };\n', ''],
  ['any anchor cell will do', "    if (!sameWhere(anchorWhere, where)) return { why: `anchor ${it.anchor} is in ${anchorWhere || '?'}, not ${where}` };\n", ''],
  ['not moved to its pose', "        applyPose(id, 'object', c.where, c.pos, c.rot.map(norm));\n", ''],
  ['NPCs imported too', "    if (known.kind !== 'object') return { why: 'not an object' };\n", ''],
];
for (const [name, from, to] of MUTANTS) {
  if (!SRC.includes(from)) { check(`mutant "${name}": its line is still in placement.js`, false, from); continue; }
  let bad = 0;
  try { run(SRC.replace(from, to), (_n, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  check(`mutant caught: ${name}`, bad > 0);
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exitCode = failures ? 1 : 0;
