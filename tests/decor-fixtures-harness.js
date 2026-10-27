// decor.js: a home's own pieces (decor-fixtures.json), moved and stored through worldedit.js, against a stub mp in a scratch
// directory. placement.js loads worldedit.js and hands it to decor.js, as on the server.
// node tests/decor-fixtures-harness.js [decor.js to test]   (from server/; TMPDIR=/dev/shm/... on CT 115)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const MODULE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'decor.js'));
const PLACEMENT = path.resolve(__dirname, '..', 'placement.js');
const WORLDEDIT = path.resolve(__dirname, '..', 'worldedit.js');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-decorfix-'));
process.chdir(scratch);
fs.copyFileSync(WORLDEDIT, path.join(scratch, 'worldedit.js'));

const CELL = 0x100, CELL2 = 0x101, OTHER = 0x102, DOOR = 0x200, OUTDOOR = 0x201;
const OWNER = 0xff000001, FRIEND = 0xff000002, STRANGER = 0xff000003, GM = 0xff000004;
const PROFILE = { [OWNER]: 7, [FRIEND]: 8, [STRANGER]: 9, [GM]: 10 };
const NAME = { [OWNER]: 'Olaf', [FRIEND]: 'Frida', [STRANGER]: 'Stray', [GM]: 'Gemma' };
const TABLE = 0x7001, CHEST = 0x7002, FAR = 0x7003, WALL = 0x7004;
const d = (id) => `${id.toString(16)}:Skyrim.esm`;
fs.writeFileSync('housing.json', JSON.stringify([DOOR]));
fs.writeFileSync('admin-placeables.json', JSON.stringify({ categories: [] }));
fs.writeFileSync('decor-catalog.json', JSON.stringify({ groups: [
  { id: 'tables', label: 'Tables', pieces: [{ desc: d(0x9006), edid: 'CommonTable01', name: 'Table', group: 'tables', type: 'STAT', radius: 80, costB: { [d(0x6f993)]: 4 } }] },
  { id: 'storage', label: 'Storage', pieces: [{ desc: d(0x9002), edid: 'CommonChest01', name: 'Chest', group: 'storage', type: 'CONT', radius: 60, container: true, costB: { [d(0x6f993)]: 4 } }] },
] }));
fs.writeFileSync('decor-fixtures.json', JSON.stringify({ cells: { [d(CELL)]: [[d(TABLE), d(0x9006)], [d(CHEST), d(0x9002)]], [d(OTHER)]: [[d(FAR), d(0x9006)]] } }));

const props = new Map();
const setp = (id, k, v) => props.set(`${id}|${k}`, v);
const getp = (id, k) => props.get(`${id}|${k}`);
setp(DOOR, 'private.housing', { owner: 7, ownerChar: OWNER, ownerName: 'Olaf', partner: OUTDOOR, place: { cells: [d(CELL), d(CELL2)], builtAt: 1 } });
setp(DOOR, 'worldOrCellDesc', d(CELL));
for (const a of [OWNER, FRIEND, STRANGER, GM]) { setp(a, 'worldOrCellDesc', d(CELL)); setp(a, 'pos', [1000, 1000, 50]); setp(a, 'angle', [0, 0, 0]); setp(a, 'profileId', PROFILE[a]); setp(a, 'inventory', { entries: [{ baseId: 0x6f993, count: 9 }] }); }
// The chest is a server form (a container); the table, the far table and the wall are statics, with no form
setp(CHEST, 'type', 'MpObjectReference'); setp(CHEST, 'worldOrCellDesc', d(CELL)); setp(CHEST, 'pos', [1050, 1100, 50]); setp(CHEST, 'inventory', { entries: [{ baseId: 0xf, count: 3 }] });
const f32 = (xs) => { const b = Buffer.alloc(24); xs.forEach((x, i) => b.writeFloatLE(x, i * 4)); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const REFS = { [TABLE]: [0x9006, [1100, 1000, 50]], [CHEST]: [0x9002, [1050, 1100, 50]], [FAR]: [0x9006, [1000, 1050, 50]], [WALL]: [0x9007, [1000, 900, 50]] };
const BASES = { 0x9006: 'STAT', 0x9002: 'CONT', 0x9007: 'STAT', [CELL]: 'CELL', [CELL2]: 'CELL', [OTHER]: 'CELL' };
let shift = 0;   // a load-order shift: every plugin id moves by this much
const live = (id) => id + shift;
const said = [], ui = {}, packets = [], papyrus = [], logs = [];
const mp = {
  get: (id, k) => { if (k === 'type' && id < 0xff000000 && getp(id, 'type') === undefined) throw new Error("Form doesn't exist"); return getp(id, k); },
  set: setp,
  getIdFromDesc: (x) => { const n = parseInt(String(x).split(':')[0], 16) >>> 0; return n < 0xff000000 && REFS[n] ? live(n) : n; },
  getDescFromId: (id) => { const n = id >>> 0; return n < 0xff000000 && REFS[n - shift] ? d(n - shift) : (n < 0xff000000 ? d(n) : n.toString(16)); },
  lookupEspmRecordById: (id) => {
    const n = (id >>> 0) - (REFS[(id >>> 0) - shift] ? shift : 0);
    if (REFS[n]) return { record: { type: 'REFR', fields: [{ type: 'NAME', data: u32(REFS[n][0]) }, { type: 'DATA', data: f32(REFS[n][1].concat([0, 0, 0])) }] }, toGlobalRecordId: (x) => x };
    if (BASES[n]) return { record: { type: BASES[n], editorId: 'E' + n.toString(16) } };
    return null;
  },
  callPapyrusFunction: (kind, cls, fn, self, args) => { papyrus.push([fn, parseInt(self.desc, 16) >>> 0, args]); return null; },
};
const onUi = (n, f) => { (ui[n] = ui[n] || []).push(f); };
const fire = (n, a, args) => (ui[n] || []).forEach((f) => f(a, args));
const cmds = {}, timers = {};
const cfg = { decor: { enabled: true, perSecond: 0, perHour: 1000 }, placement: { worldEdit: { client: true, resendMs: 0 } } };
const api = {
  mp, log: (...x) => logs.push(x.join(' ')), audit: () => {}, who: (a) => NAME[a] || String(a), personal: (a, t) => said.push([a, t]),
  onUi, sendPacket: (a, p) => { packets.push([a, p]); return true; }, registerChatCommand: (n, f) => { cmds[n] = f; },
  onlineActors: () => [OWNER, FRIEND, STRANGER, GM], isAdmin: (a) => a === GM, tierOf: (a) => (a === GM ? 'developer' : null), giveItem: () => true,
  findByName: (q) => Number(Object.keys(NAME).find((a) => NAME[a].toLowerCase() === String(q).toLowerCase())) || 0,
  every: (name, ms, fn) => { timers[name] = fn; }, cfg,
};
let fails = 0;
const ok = (c, what, detail) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!c) fails++; };
const last = (a) => { for (let i = said.length - 1; i >= 0; i--) if (said[i][0] === a) return said[i][1]; return ''; };
const edits = () => JSON.parse(fs.readFileSync('world-edits.json', 'utf8')).edits;
const editFor = (a, from) => (packets.slice(from).filter((p) => p[0] === a && p[1].customPacketType === 'placeEdit').pop() || [])[1];
const load = () => {
  globalThis.__dboDecor = undefined; globalThis.__dboPlacement = undefined; globalThis.__dboWorldEdit = undefined; globalThis.__dboWorldEditApi = undefined;
  delete require.cache[MODULE]; delete require.cache[PLACEMENT];
  require(PLACEMENT)({ mp, log: api.log, personal: api.personal, audit: () => {}, who: api.who, onUi, sendPacket: api.sendPacket, isAdmin: api.isAdmin, tierOf: api.tierOf, registerChatCommand: () => {}, cfg, every: () => {}, onlineActors: api.onlineActors });
  return require(MODULE)(api)._test;
};
for (const k of Object.keys(ui)) delete ui[k];
let T = load();
const cmd = (a, s) => cmds.decor(a, s);
const wood = (a) => (getp(a, 'inventory').entries.find((e) => e.baseId === 0x6f993) || { count: 0 }).count;
const t = TABLE.toString(16);

// Move: the select tool's Enter on the home's own table, then Enter where it should stand
let n = packets.length;
fire('placeSelect', OWNER, [t]);
let e = editFor(OWNER, n);
ok(e && String(e.id).startsWith('decor:') && e.base === d(0x9006), 'the owner\'s select on the home\'s table starts a decor move of it', e);
fire('placeMove', OWNER, [e.id, [1150, 1000, 50], [0, 0, 45]]);
ok(edits()[t] && edits()[t].moved && edits()[t].moved.pos[0] === 1150 && edits()[t].decor === DOOR.toString(16) && !edits()[t].hidden, 'it is set down as a world edit, marked for this home', edits()[t]);
ok(packets.some((p) => p[1].customPacketType === 'worldEdits' && p[1].edits.some((x) => x.ref === TABLE && x.pos && x.pos[0] === 1150)), 'every client is sent the new place');
ok(wood(OWNER) === 9 && ((T.reg().places[DOOR.toString(16)] || { items: [] }).items.length === 0), 'moving the home\'s own piece costs nothing and uses no budget');

// Store: Delete on it; no materials back
fire('placeDelete', OWNER, [t]);
ok(edits()[t].hidden === true && wood(OWNER) === 9, 'Delete stores it, hidden for everyone, with no materials back', [edits()[t], wood(OWNER)]);
cmd(OWNER, 'stored');
ok(/1\. /.test(last(OWNER)) && /putback/.test(last(OWNER)), '/decor stored lists it', last(OWNER));
cmd(OWNER, 'undo');
ok(edits()[t] && !edits()[t].hidden && edits()[t].moved, '/decor undo puts the stored piece back where it stood', edits()[t]);
fire('placeDelete', OWNER, [t]);

// Put back: free, through the edit mode
n = packets.length;
cmd(OWNER, 'putback 1');
e = editFor(OWNER, n);
ok(e && String(e.id).startsWith('decor:'), '/decor putback 1 starts the edit mode', e);
fire('placeMove', OWNER, [e.id, [1120, 1010, 50], [0, 0, 0]]);
ok(edits()[t].hidden === false && edits()[t].moved.pos[0] === 1120 && wood(OWNER) === 9, 'it is put back where aimed, free', edits()[t]);
n = packets.length;
fire('placeSelect', OWNER, [t]); e = editFor(OWNER, n);
fire('placeMove', OWNER, [e.id, [1100 + 900, 1000, 50], [0, 0, 0]]);
ok(edits()[t].moved.pos[0] === 1120 && /too far/.test(last(OWNER)), 'the decor spot checks apply: too far is refused', last(OWNER));

// Who may: a stranger cannot; a named decorator can
n = packets.length;
fire('placeSelect', STRANGER, ['7002']); fire('placeDelete', STRANGER, ['7002']);
ok(!editFor(STRANGER, n) && !(edits()['7002']), 'a stranger can neither move nor store the home\'s pieces');
cmd(OWNER, 'grant Frida');
fire('placeDelete', FRIEND, ['7002']);
ok(/Empty the Chest/.test(last(FRIEND)) && !edits()['7002'], 'a container with something in it is refused', last(FRIEND));
setp(CHEST, 'inventory', { entries: [] });
fire('placeDelete', FRIEND, ['7002']);
ok(edits()['7002'] && edits()['7002'].hidden && papyrus.some((p) => p[0] === 'Disable' && p[1] === CHEST), 'emptied, a named decorator stores it; the server form is disabled too', edits()['7002']);

// What may not: another cell's piece, an unlisted reference
n = packets.length;
fire('placeSelect', OWNER, ['7003']); fire('placeDelete', OWNER, ['7003']);
ok(!editFor(OWNER, n) && !edits()['7003'], 'a listed piece in another cell is refused, whatever its coordinates');
fire('placeSelect', OWNER, ['7004']); fire('placeDelete', OWNER, ['7004']);
ok(!editFor(OWNER, n) && !edits()['7004'], 'a reference not in decor-fixtures.json (a wall) is never the owner\'s to touch');
const decorRef = globalThis.__dboDecorRef;
ok(decorRef(t, OWNER) === true && decorRef(t, GM) === false && decorRef(t) === false, 'placement.js leaves the piece to decor only for someone who may decorate here');

// A restart: the edits are read back; a load-order shift re-keys them by desc
const before = JSON.stringify(edits()[t]);
shift = 0x10;
T = load();
const moved = (TABLE + shift).toString(16);
const W = globalThis.__dboWorldEditApi.data().edits;
ok(W[moved] && !W[t] && W[moved].moved.pos[0] === 1120, 'after a restart with a shifted load order the table\'s edit follows its desc', Object.keys(W));
shift = 0;
T = load();
ok(JSON.stringify(globalThis.__dboWorldEditApi.data().edits[t]) === JSON.stringify(Object.assign(JSON.parse(before))), 'and back again', globalThis.__dboWorldEditApi.data().edits[t]);

// A new owner gets the home as built
setp(DOOR, 'private.housing', { owner: 11, ownerChar: 0xff000009, ownerName: 'Nils', partner: OUTDOOR, place: { cells: [d(CELL), d(CELL2)], builtAt: 1 } });
timers['decor-owners']();
const left = globalThis.__dboWorldEditApi.data().edits;
ok(!left[t] && !left['7002'], 'a new owner: every moved or stored piece is back as its plugin has it', Object.keys(left));
ok(papyrus.some((p) => p[0] === 'Enable' && p[1] === CHEST), '...the stored chest is enabled again');

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
