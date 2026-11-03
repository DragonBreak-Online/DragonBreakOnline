// admin-powers.json keeps no row of the mods whose authors forbid AI work (Nat, 2 Nov): those rows live in the gitignored
// sidecar admin-powers.private.json (privaterows.js), which the server merges at load, so Give all spells and /givespell still
// have them. Checks:
//   - the tracked file holds no private row, and names no private plugin anywhere;
//   - splitting and merging put every row back in its exact place (synthetic lists, edges included);
//   - without the sidecar, or with a broken one, the readers run on the public rows and say so once;
//   - staffitemspells.js finds a private staff-only spell from a sidecar;
//   - where the real sidecar is (the servers, after deploy-private), the merged lists are exactly the 2 Nov whole lists;
//   - the merge tool splits on --write, and *.private.json is gitignored.
// node tests/admin-powers-private-harness.js   (from server/)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!c) fails++; };
const pr = require(path.join(ROOT, 'privaterows.js'));
const FILE = path.join(ROOT, 'admin-powers.json');

// ---- the tracked file ------------------------------------------------------------------------------------------------
const text = fs.readFileSync(FILE, 'utf8');
const pub = JSON.parse(text);
const privIn = (list) => (list || []).filter(pr.isPrivateRow).map((r) => r[0]);
ok(privIn(pub.spells).length === 0, 'the tracked spells hold no private row', privIn(pub.spells));
ok(privIn(pub.staffSpells).length === 0, 'the tracked staffSpells hold no private row', privIn(pub.staffSpells));
const named = pr.PRIVATE_PLUGINS.filter((p) => text.toLowerCase().includes(p.replace(/\.es[mpl]$/, '').toLowerCase()));
ok(named.length === 0, 'the tracked file names no private plugin anywhere (spellSources, the comment)', named);
ok(pub.spells.length > 200 && pub.staffSpells.length > 700, 'the public lists are still the bulk of the catalogue', [pub.spells.length, pub.staffSpells.length]);

// ---- split and merge ---------------------------------------------------------------------------------------------------
const row = (id, plugin) => [`${id}:${plugin}`, `Name ${id}`, `Edid${id}`];
const lists = [
  [row('1', 'Skyrim.esm'), row('2', 'Druadach.esm'), row('3', 'Skyrim.esm')],
  [row('1', 'Druadach.esm'), row('2', 'summersetisles.esp'), row('3', 'Skyrim.esm')],
  [row('1', 'Skyrim.esm'), row('2', 'Dawnguard.esm'), row('3', 'King of the Murkmire.esp')],
  [row('1', 'Journey to Baan Malur.esp')],
  [],
];
for (const [i, l] of lists.entries()) {
  const s = pr.splitList(l);
  ok(privIn(s.pub).length === 0 && JSON.stringify(pr.mergeList(s.pub, s.rows)) === JSON.stringify(l), `split and merge give list ${i} back exactly`);
}
ok(!pr.isPrivateRow(['1:Skyrim.esm', 'Druadach Bow', 'X']), 'the name never makes a row private, only the desc');
ok(pr.isPrivateRow(['1:DRUADACH.ESM', 'x']), '...and the plugin is matched in any case'); // verify-formids: ignore (synthetic)

// ---- missing and broken sidecars, and staffitemspells -----------------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-powers-private-'));
const cwd = process.cwd();
process.chdir(dir);
try {
  const PUB = { spells: [['12fcd:Skyrim.esm', 'Flames']], staffSpells: [['8f3f5:Skyrim.esm', 'Wall of Frost Hazard', 'HazardWallofFrostSpell']] };
  fs.writeFileSync('admin-powers.json', JSON.stringify(PUB));
  const said = [];
  let r = pr.readMerged(path.resolve('admin-powers.json'), ['spells', 'staffSpells'], (t) => said.push(t));
  ok(!r.sidecar && r.data.staffSpells.length === 1 && said.length === 1 && /is not here/.test(said[0]), 'no sidecar: the public rows and one log line', said);
  fs.writeFileSync('admin-powers.private.json', '{ broken');
  said.length = 0; r = pr.readMerged(path.resolve('admin-powers.json'), ['spells', 'staffSpells'], (t) => said.push(t));
  ok(!r.sidecar && r.data.staffSpells.length === 1 && said.length === 1 && /unreadable/.test(said[0]), 'a broken sidecar: the public rows and one log line', said);
  const SIDE = { lists: { staffSpells: [{ at: 0, row: ['a1000:Druadach.esm', 'Spectre Fire', 'DrV_SPECTREsummonfirespell'] }], spells: [{ at: 1, row: ['91000:Druadach.esm', 'Raise Wall'] }] } };
  fs.writeFileSync('admin-powers.private.json', JSON.stringify(SIDE));
  r = pr.readMerged(path.resolve('admin-powers.json'), ['spells', 'staffSpells']);
  ok(r.sidecar && r.merged === 2 && r.data.staffSpells[0][0] === 'a1000:Druadach.esm' && r.data.spells[1][0] === '91000:Druadach.esm', 'with the sidecar each private row is back at its index', r.data);
  fs.writeFileSync('spell-tomes.json', JSON.stringify({ tomes: [] }));
  fs.writeFileSync('admin-items.json', JSON.stringify({ categories: [] }));
  const DESC = new Map(), ID = new Map(); let next = 0x1000;
  const idOf = (d) => { d = String(d).toLowerCase(); if (!ID.has(d)) { ID.set(d, next); DESC.set(next, d); next++; } return ID.get(d); };
  const told = [], cmds = new Map();
  const GM = 0xff000011, PLAYER = 0xff000010;
  require(path.join(ROOT, 'staffitemspells.js'))({
    mp: { get: () => undefined, set: () => {}, getIdFromDesc: idOf, getDescFromId: (id) => DESC.get(id >>> 0) || `${(id >>> 0).toString(16)}:Skyrim.esm`, lookupEspmRecordById: () => null, callPapyrusFunction: () => {} },
    log: () => {}, personal: (a, t) => told.push([a, t]), audit: () => {}, who: (a) => `#${(a >>> 0).toString(16)}`, display: String,
    nameOf: () => 'Jorik', tagOf: () => 'TW2F', profileOf: () => 126, onlineActors: () => [PLAYER, GM], isLeadStaff: (a) => a === GM, isAdmin: (a) => a === GM,
    giveItem: () => true, registerChatCommand: (n, f, o) => cmds.set(n, { f, o }), officialTarget: () => null, findByName: () => PLAYER, cfg: { spells: {} },
  });
  cmds.get('givespell').f(GM, '#TW2F Spectre Fire');
  const last = told.filter(([a]) => a === GM).pop();
  ok(last && /^Granted spell 'Spectre Fire' \(staff only, not learnable\)/.test(last[1]), 'staffitemspells finds a private staff-only spell from the sidecar', last);
} finally {
  process.chdir(cwd);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* EBUSY on Windows */ }
}

// ---- the real sidecar, where it is: the whole lists of 2 Nov --------------------------------------------------------
const whole = pr.readMerged(FILE, ['spells', 'staffSpells']);
const sha = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
if (whole.sidecar) {
  // the window-1103 lists before the split (origin/server 6bc3b020a): 308 spells, 1021 staff-only spells
  ok(whole.data.spells.length === 308 && sha(whole.data.spells) === 'a311d8116ddf1bef9ef823963e06785ece5beb46c19b7c2c23d900f1074ca2d8',
    'with the sidecar, Give all spells has exactly the 308 it had, in order', whole.data.spells.length);
  ok(whole.data.staffSpells.length === 1021 && sha(whole.data.staffSpells) === '03ca42e952267e5bdea5844cb327f8b3ca8aff5cfff52aceb26853fb31b816d1',
    '...and the staff-only list exactly its 1021', whole.data.staffSpells.length);
} else {
  console.log('note: admin-powers.private.json is not here (a public checkout): the whole-list check runs where it is deployed');
}

// ---- the tooling --------------------------------------------------------------------------------------------------------
const merge = fs.readFileSync(path.join(ROOT, 'tooling', 'admin_catalog_merge.js'), 'utf8');
ok(/privaterows/.test(merge) && /splitPowers|splitList/.test(merge), 'the catalogue merge splits admin-powers.json on --write');
const ign = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
ok(/^\*\.private\.json\s*$/m.test(ign), '*.private.json is gitignored');

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
