// decor.js placeOfCell over housing claims that have no partner door: the cell index is built without ever asking the
// server for form 0 (mp.get(0, 'worldOrCellDesc') throws in ScampServer.cpp Get and logs a [error] "resolved context"
// block; live, 2 Nov: about 570 claims a rebuild, 104k lines a day), and still finds a home by its door's own cell and by
// a partner's. The stub mp throws for an unknown form, as the server does. A mutant restoring the old read must fail.
//   node tests/decor-partnerless-harness.js [decor.js to test]   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const MODULE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'decor.js'));
const scratch = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-decor-partnerless-'));
process.chdir(scratch);
process.on('exit', () => { process.chdir(os.tmpdir()); try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* the OS */ } });

const WORLD = 0x3c, CELL_A = 0x100, CELL_B = 0x101;
const d = (id) => `${id.toString(16)}:Skyrim.esm`;
// Many claims with no partner and no place (the live shape), one whose own door stands in CELL_A, one whose partner is in CELL_B
const LONE = Array.from({ length: 50 }, (_, i) => 0x1000 + i);
const DOOR_A = 0x200, DOOR_B = 0x300, PARTNER_B = 0x301;
fs.writeFileSync('housing.json', JSON.stringify(LONE.concat([DOOR_A, DOOR_B])));
for (const f of ['admin-placeables.json']) fs.writeFileSync(f, JSON.stringify({ categories: [] }));
fs.writeFileSync('decor-catalog.json', JSON.stringify({ groups: [] }));
fs.writeFileSync('doors-pos.json', JSON.stringify({ doors: {} }));
fs.writeFileSync('skills.json', JSON.stringify({ skills: [] }));
const props = new Map();
const setp = (id, k, v) => props.set(`${id}|${k}`, v);
for (const r of LONE) { setp(r, 'private.housing', { owner: 7 }); setp(r, 'worldOrCellDesc', d(WORLD)); }
setp(DOOR_A, 'private.housing', { owner: 7 }); setp(DOOR_A, 'worldOrCellDesc', d(CELL_A));
setp(DOOR_B, 'private.housing', { owner: 8, partner: PARTNER_B }); setp(DOOR_B, 'worldOrCellDesc', d(WORLD)); setp(PARTNER_B, 'worldOrCellDesc', d(CELL_B));
const TYPES = { [CELL_A]: 'CELL', [CELL_B]: 'CELL', [WORLD]: 'WRLD' };
let zeroReads = 0;
const mp = {
  // the server: a form that does not exist throws (and form 0 never exists)
  get: (id, k) => { if ((id >>> 0) === 0) { zeroReads++; throw new Error('Form with id 0 does not exist'); } if (![...props.keys()].some((x) => x.startsWith(`${id}|`))) throw new Error(`Form with id ${id} does not exist`); return props.get(`${id}|${k}`); },
  set: setp, getIdFromDesc: (x) => parseInt(String(x).split(':')[0], 16) >>> 0, getDescFromId: (id) => (id >>> 0).toString(16),
  lookupEspmRecordById: (id) => (TYPES[id] ? { record: { type: TYPES[id], editorId: 'E' + id.toString(16) } } : null),
};
const api = {
  mp, log: () => {}, audit: () => {}, who: () => 'x', personal: () => {}, onUi: () => {}, sendPacket: () => true, registerChatCommand: () => {},
  onlineActors: () => [], isAdmin: () => false, tierOf: () => null, giveItem: () => {}, findByName: () => 0, every: () => {}, cfg: { decor: { enabled: true } },
};
let fails = 0;
const ok = (c, what, detail) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!c) fails++; };

globalThis.__dboDecor = undefined;
delete require.cache[MODULE];
const T = require(MODULE)(api)._test;
const a = T.placeOfCell(CELL_A);
ok(zeroReads === 0, 'building the cell index never reads form 0 (claims with no partner are not asked for one)', zeroReads);
ok(a && a.root === DOOR_A, 'a home is still found by its door\'s own cell', a);
const b = T.placeOfCell(CELL_B);
ok(b && b.root === DOOR_B, '...and by its partner\'s cell', b);
ok(T.placeOfCell(WORLD) === null, 'a worldspace is never a home');

if (!process.env.DBO_MUTANT_RUN) {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'decor.js'), 'utf8').replace(/\r\n/g, '\n');
  const from = "partner ? idOf(get(partner, 'worldOrCellDesc', '')) : 0";
  if (!SRC.includes(from)) ok(false, 'mutant: its line is still in decor.js', from);
  else {
    const f = path.join(scratch, 'decor-mutant.js');
    fs.writeFileSync(f, SRC.replace(from, "idOf(get(partner, 'worldOrCellDesc', ''))"));
    let out = '';
    try { out = execFileSync(process.execPath, [__filename, f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { DBO_MUTANT_RUN: '1' }) }); } catch (x) { out = String(x.stdout || '') + 'FAIL crashed'; }
    ok(/^FAIL/m.test(out), 'mutant caught: claims with no partner are asked for form 0 again');
  }
}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exitCode = fails ? 1 : 0;
