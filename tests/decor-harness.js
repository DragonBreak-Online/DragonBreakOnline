// decor.js: home decorating against a stub mp in a scratch directory (decor.js reads housing.json, decor-catalog.json and
// doors-pos.json and writes decor.json in the working directory, so never run it from the live server folder). placement.js
// is loaded beside it to show the GM Place tool leaves decor ids and pieces alone.
// node tests/decor-harness.js   (from server/; TMPDIR=/dev/shm/... on CT 115)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'decor.js');
const PLACEMENT = path.resolve(__dirname, '..', 'placement.js');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-decor-'));
process.chdir(scratch);

const CELL = 0x100, CELL2 = 0x101, OTHER = 0x102, WORLD = 0x3c, DOOR = 0x200, OUTDOOR = 0x201;
const OWNER = 0xff000001, FRIEND = 0xff000002, STRANGER = 0xff000003, GM = 0xff000004;
const PROFILE = { [OWNER]: 7, [FRIEND]: 8, [STRANGER]: 9, [GM]: 10 };
const NAME = { [OWNER]: 'Olaf', [FRIEND]: 'Frida', [STRANGER]: 'Stray', [GM]: 'Gemma' };
const WOOD = 0x6f993, IRON = 0x5ace4, SALT = 0x34cdf;
const d = (id) => `${id.toString(16)}:Skyrim.esm`;
fs.writeFileSync('housing.json', JSON.stringify([DOOR]));
fs.writeFileSync('admin-placeables.json', JSON.stringify({ categories: [] }));
fs.writeFileSync('doors-pos.json', JSON.stringify({ doors: { [d(0x500)]: [3000, 3000, 50, d(CELL).toLowerCase()] } }));
fs.writeFileSync('decor-catalog.json', JSON.stringify({ groups: [
  { id: 'beds', label: 'Beds', pieces: [{ desc: d(0x9001), edid: 'CommonBed01', name: 'Bed', group: 'beds', type: 'FURN', radius: 100, costB: { [d(WOOD)]: 4, [d(IRON)]: 1 } }] },
  { id: 'storage', label: 'Storage', pieces: [{ desc: d(0x9002), edid: 'CommonWardrobe01', name: 'Wardrobe', group: 'storage', type: 'CONT', radius: 60, container: true, costB: { [d(WOOD)]: 4 } }] },
  { id: 'lights', label: 'Lights', pieces: [{ desc: d(0x9003), edid: 'Candle01', name: 'Candle', group: 'lights', type: 'STAT', radius: 20, light: { base: d(0x88238), radius: 256 }, costB: { [d(IRON)]: 1 } }] },
  { id: 'workbenches', label: 'Workbenches', pieces: [{ desc: d(0x9004), edid: 'CraftingAlchemyWorkbench', name: 'Alchemy Lab', group: 'workbenches', type: 'FURN', radius: 100, station: { keyword: 'isAlchemy', skill: 'alchemist', tier: 1, minCells: 1 }, costB: { [d(SALT)]: 2 } }] },
] }));
const props = new Map();
const setp = (id, k, v) => props.set(`${id}|${k}`, v);
const getp = (id, k) => props.get(`${id}|${k}`);
setp(DOOR, 'private.housing', { owner: 7, ownerChar: OWNER, ownerName: 'Olaf', partner: OUTDOOR, place: { cells: [d(CELL), d(CELL2)], builtAt: 1 } });
setp(DOOR, 'worldOrCellDesc', d(CELL)); setp(OUTDOOR, 'worldOrCellDesc', d(WORLD));
for (const a of [OWNER, FRIEND, STRANGER, GM]) { setp(a, 'worldOrCellDesc', d(CELL)); setp(a, 'pos', [1000, 1000, 50]); setp(a, 'angle', [0, 0, 0]); setp(a, 'profileId', PROFILE[a]); setp(a, 'inventory', { entries: [] }); }
const TYPES = { [CELL]: 'CELL', [CELL2]: 'CELL', [OTHER]: 'CELL', [WORLD]: 'WRLD', 0x9002: 'CONT' };
const said = [], ui = {}, packets = [], placed = [], deleted = [], logs = [], audits = [];
let failNextPlace = false;
const mp = {
  get: getp, set: setp,
  getIdFromDesc: (x) => parseInt(String(x).split(':')[0], 16) >>> 0,
  getDescFromId: (id) => (id >>> 0).toString(16),
  lookupEspmRecordById: (id) => (TYPES[id] ? { record: { type: TYPES[id], editorId: 'E' + id.toString(16) } } : null),
  callPapyrusFunction: (kind, cls, fn, self, args) => {
    const id = parseInt(self.desc, 16) >>> 0;
    if (fn === 'PlaceAtMe') { if (failNextPlace) { failNextPlace = false; return null; } const n = 0xff0000a0 + placed.length; placed.push(n); setp(n, 'worldOrCellDesc', getp(id, 'worldOrCellDesc')); setp(n, 'baseDesc', args[0].desc); return { desc: n.toString(16) }; }
    if (fn === 'SetPosition') setp(id, 'pos', args.slice(0, 3));
    if (fn === 'SetAngle') setp(id, 'angle', args.slice(0, 3));
    if (fn === 'Delete') deleted.push(id);
    return null;
  },
};
const onUi = (n, f) => { (ui[n] = ui[n] || []).push(f); };
const fire = (n, a, args) => (ui[n] || []).forEach((f) => f(a, args));
const cmds = {};
const giveItem = (a, baseId, count) => { const inv = getp(a, 'inventory') || { entries: [] }; const e = inv.entries.map((x) => Object.assign({}, x)); const h = e.find((x) => x.baseId === baseId); if (h) h.count += count; else e.push({ baseId, count }); setp(a, 'inventory', { entries: e }); return true; };
const held = (a, id) => (getp(a, 'inventory').entries.find((e) => e.baseId === id) || { count: 0 }).count;
const timers = {};
const cfg = { decor: { enabled: true, budgets: [{ pieces: 3, lights: 1, stations: 1, containers: 1 }, { pieces: 3, lights: 1, stations: 1, containers: 1 }, { pieces: 3, lights: 1, stations: 1, containers: 1 }], perSecond: 0, perHour: 1000 } };
const api = {
  mp, log: (...x) => logs.push(x.join(' ')), audit: (t) => audits.push(t), who: (a) => NAME[a], personal: (a, t) => said.push([a, t]),
  onUi, sendPacket: (a, p) => { packets.push([a, p]); return true; }, registerChatCommand: (n, f) => { cmds[n] = f; },
  onlineActors: () => [OWNER, FRIEND, STRANGER, GM], isAdmin: (a) => a === GM, tierOf: (a) => (a === GM ? 'developer' : null), giveItem,
  findByName: (q) => Number(Object.keys(NAME).find((a) => NAME[a].toLowerCase() === String(q).toLowerCase())) || 0,
  every: (name, ms, fn) => { timers[name] = fn; }, cfg,
};
let fails = 0;
const ok = (c, what, detail) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!c) fails++; };
const last = (a) => { for (let i = said.length - 1; i >= 0; i--) if (said[i][0] === a) return said[i][1]; return ''; };
const lastEdit = (a) => { for (let i = packets.length - 1; i >= 0; i--) if (packets[i][0] === a && packets[i][1].customPacketType === 'placeEdit') return packets[i][1]; return null; };
globalThis.__dboDecor = undefined; globalThis.__dboPlacement = undefined;
const T = require(MODULE)(api)._test;
const placementSaid = [];
require(PLACEMENT)({ mp, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => placementSaid.push([a, t]), audit: () => {}, who: (a) => NAME[a],
  onUi, sendPacket: api.sendPacket, isAdmin: api.isAdmin, tierOf: api.tierOf, registerChatCommand: () => {}, cfg: {}, every: () => {}, onlineActors: api.onlineActors });
const items = () => (T.reg().places[DOOR.toString(16)] || { items: [] }).items;
const cmd = (a, s) => cmds.decor(a, s);
const placeAt = (a, n, pos, rot) => { cmd(a, 'find ' + n); cmd(a, 'place 1'); const e = lastEdit(a); if (e) fire('placeMove', a, [e.id, pos || [1100, 1000, 50], rot || [0, 0, 90]]); return e; };

// ---- the catalogue and the cost ----------------------------------------------------------------------------------------
cmd(OWNER, 'find bed');
ok(/1\. Bed \[beds\]/.test(last(OWNER)), '/decor find lists the bed with its group', last(OWNER));
cmd(OWNER, 'place 1');
ok(/Short: 4 /.test(last(OWNER)) && !lastEdit(OWNER), 'without the materials: told what is short, no preview', last(OWNER));
giveItem(OWNER, WOOD, 10); giveItem(OWNER, IRON, 5); giveItem(OWNER, SALT, 4);

// ---- place: paid in one write, then created ----------------------------------------------------------------------------
const e1 = placeAt(OWNER, 'bed');
ok(e1 && e1.id.startsWith('decor:'), 'place sends the edit mode a decor: id', e1);
ok(items().length === 1 && held(OWNER, WOOD) === 6 && held(OWNER, IRON) === 4, 'placed and paid exactly 4 firewood + 1 iron', { n: items().length, wood: held(OWNER, WOOD), iron: held(OWNER, IRON) });
const bed = items()[0];
ok(getp(parseInt(bed.ref, 16), 'private.dboDecor') && getp(parseInt(bed.ref, 16), 'pos')[0] === 1100, 'the reference is tagged and posed where aimed');
fire('placeMove', OWNER, [e1.id, [1100, 1000, 50], [0, 0, 90]]);
ok(items().length === 1 && /out of date/.test(last(OWNER)), 'a replayed confirm places nothing', last(OWNER));
ok(!placementSaid.length, 'placement.js said nothing about the decor id', placementSaid);

// ---- refusals cost nothing --------------------------------------------------------------------------------------------
let wood = held(OWNER, WOOD);
placeAt(OWNER, 'wardrobe', [3000, 1000, 50]);
ok(/too far/.test(last(OWNER)) && held(OWNER, WOOD) === wood && items().length === 1, 'too far: refused, nothing taken', last(OWNER));
setp(OWNER, 'pos', [2950, 2950, 50]);
placeAt(OWNER, 'wardrobe', [3050, 2950, 50]);
ok(/block a door/.test(last(OWNER)) && held(OWNER, WOOD) === wood, 'next to a load door: refused, nothing taken', last(OWNER));
setp(OWNER, 'pos', [1000, 1000, 50]);
placeAt(OWNER, 'bed', [1100, 1000, 50], [30, 0, 0]);
ok(/upright|Tilt it no more/.test(last(OWNER)) && held(OWNER, WOOD) === wood, 'a tilted bed: refused, nothing taken', last(OWNER));

// ---- who may ------------------------------------------------------------------------------------------------------------
giveItem(STRANGER, WOOD, 10);
cmd(STRANGER, 'find wardrobe'); cmd(STRANGER, 'place 1');
ok(!lastEdit(STRANGER) && /Only the owner/.test(last(STRANGER)), 'a stranger in the house cannot start', last(STRANGER));
fire('placeMove', STRANGER, [e1.id, [1100, 1000, 50], [0, 0, 0]]);
ok(items().length === 1, "a stranger replaying the owner's id places nothing");
cmd(OWNER, 'grant Stray');
placeAt(STRANGER, 'wardrobe');
ok(items().length === 2 && held(STRANGER, WOOD) === 6, 'granted: the decorator places, paying from their own pack', { n: items().length, wood: held(STRANGER, WOOD) });
cmd(OWNER, 'revoke Stray');
cmd(STRANGER, 'find wardrobe'); cmd(STRANGER, 'place 1');
ok(/Only the owner/.test(last(STRANGER)), 'revoked: refused again', last(STRANGER));

// ---- stations and budget ----------------------------------------------------------------------------------------------
cmd(OWNER, 'find alchemy'); cmd(OWNER, 'place 1');
ok(/alchemists of rank 2/.test(last(OWNER)), 'an alchemy lab needs an Apprentice alchemist', last(OWNER));
setp(OWNER, 'private.mastery', { order: ['alchemist'], skills: { alchemist: { rank: 1 } } });
placeAt(OWNER, 'alchemy');
ok(items().length === 3 && items()[2].station === 'isAlchemy', 'with the rank: placed, recorded as a station', items().map((i) => i.name));
cmd(OWNER, 'find candle'); cmd(OWNER, 'place 1');
ok(/holds its 3 pieces/.test(last(OWNER)), 'the budget of pieces stops the fourth', last(OWNER));

// ---- remove, undo -------------------------------------------------------------------------------------------------------
wood = held(OWNER, WOOD); const iron = held(OWNER, IRON);
cmd(OWNER, 'list');
fire('placeDelete', OWNER, [items()[0].ref]);
ok(items().length === 2 && held(OWNER, WOOD) === wood + 2 && held(OWNER, IRON) === iron, 'remove gives back half, rounded down (2 wood, 0 iron)', { wood: held(OWNER, WOOD), iron: held(OWNER, IRON) });
ok(deleted.length === 1 && !placementSaid.length, 'the reference is deleted and placement.js stays quiet');
const wr = items().find((i) => i.container); setp(parseInt(wr.ref, 16), 'inventory', { entries: [{ baseId: WOOD, count: 1 }] });
fire('placeDelete', OWNER, [wr.ref]);
ok(items().includes(wr) && /Empty the/.test(last(OWNER)), 'a container with something in it stays', last(OWNER));
setp(parseInt(wr.ref, 16), 'inventory', { entries: [] });
wood = held(OWNER, WOOD);
placeAt(OWNER, 'bed');
const paidWood = wood - held(OWNER, WOOD);
cmd(OWNER, 'undo');
ok(paidWood === 4 && held(OWNER, WOOD) === wood && items().length === 2, 'undo right after placing gives everything back', { paidWood, wood: held(OWNER, WOOD) });
const n0 = items().length, w0 = held(OWNER, WOOD);
cmd(OWNER, 'undo');
ok(items().length === n0 - 1 && held(OWNER, WOOD) === w0, 'a second undo takes back the action before (the lab), never the bed again', { n: items().length, wood: held(OWNER, WOOD) });
for (const l of T.S.undo.values()) for (const st of l) st.at -= 61000;
cmd(OWNER, 'undo');
ok(/Nothing to undo/.test(last(OWNER)), 'after undoSeconds nothing is undone', last(OWNER));

// ---- a creation that fails gives the materials back ---------------------------------------------------------------------
wood = held(OWNER, WOOD); failNextPlace = true; const n1 = items().length;
placeAt(OWNER, 'bed');
ok(/materials are back/.test(last(OWNER)) && held(OWNER, WOOD) === wood && items().length === n1, 'create failed: refunded whole', last(OWNER));

// ---- GM tools leave decor alone; a GM select does not start a Place-tab edit ------------------------------------------
fire('placeSelect', GM, [items()[0].ref]);
ok(!placementSaid.length, 'placement.js ignores a GM aiming at a decor piece', placementSaid);

// ---- the owner leaves: cleared, half owed, paid at the next scan ------------------------------------------------------
placeAt(OWNER, 'alchemy');
const before = held(OWNER, SALT), kept = items().length;
setp(DOOR, 'private.housing', { owner: 0, partner: OUTDOOR });
timers['decor-owners']();
ok(kept >= 2 && !T.reg().places[DOOR.toString(16)] && held(OWNER, SALT) === before + 1, 'abandon: pieces taken down, half of the paid salt back to the owner online', { kept, salt: held(OWNER, SALT) });
ok(audits.some((t) => /^DECOR abandon/.test(t)) && audits.some((t) => /^DECOR place/.test(t)), 'audit lines for place and abandon');
ok(fs.existsSync('decor.json'), 'the registry is written beside the world state (here: the folder)');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
