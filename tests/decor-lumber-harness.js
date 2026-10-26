// decor.js Lumber Pile (Nat, 26 Oct: "a workbench for sawing logs"): vanilla WoodPile placed as a home saw, where a Woodcutter of
// Apprentice and up saws carried firewood into Sawn Logs by tier. Stub mp as decor-harness.js.
// node tests/decor-lumber-harness.js   (from server/; TMPDIR=/dev/shm/... on CT 115)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'decor.js');
const PLACEMENT = path.resolve(__dirname, '..', 'placement.js');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-decorlumber-'));
process.chdir(scratch);

const CELL = 0x100, CELL2 = 0x101, OTHER = 0x102, WORLD = 0x3c, DOOR = 0x200, OUTDOOR = 0x201;
const OWNER = 0xff000001, FRIEND = 0xff000002, STRANGER = 0xff000003, GM = 0xff000004;
const PROFILE = { [OWNER]: 7, [FRIEND]: 8, [STRANGER]: 9, [GM]: 10 };
const NAME = { [OWNER]: 'Olaf', [FRIEND]: 'Frida', [STRANGER]: 'Stray', [GM]: 'Gemma' };
const WOOD = 0x6f993, IRON = 0x5ace4, SALT = 0x34cdf;
const d = (id) => `${id.toString(16)}:Skyrim.esm`;
fs.writeFileSync('housing.json', JSON.stringify([DOOR]));
fs.writeFileSync('admin-placeables.json', JSON.stringify({ categories: [] }));
// The Novice share is set low here so the "at least 1 of a material that cost 2 or more" rule shows (live: 0.5 .. 0.75)
fs.writeFileSync('skills.json', JSON.stringify({ skills: [{ id: 'woodcutter', deconstructShareByTier: [0.2, 0.5, 0.6, 0.7, 0.75] }] }));
fs.writeFileSync('doors-pos.json', JSON.stringify({ doors: { [d(0x500)]: [3000, 3000, 50, d(CELL).toLowerCase()] } }));
fs.writeFileSync('decor-catalog.json', JSON.stringify({ groups: [
  { id: 'beds', label: 'Beds', pieces: [{ desc: d(0x9001), edid: 'CommonBed01', name: 'Bed', group: 'beds', type: 'FURN', radius: 100, costB: { [d(WOOD)]: 4, [d(IRON)]: 1 } }] },
  { id: 'storage', label: 'Storage', pieces: [{ desc: d(0x9002), edid: 'CommonWardrobe01', name: 'Wardrobe', group: 'storage', type: 'CONT', radius: 60, container: true, costB: { [d(WOOD)]: 4 } }] },
  { id: 'lights', label: 'Lights', pieces: [{ desc: d(0x9003), edid: 'Candle01', name: 'Candle', group: 'lights', type: 'STAT', radius: 20, light: { base: d(0x88238), radius: 256 }, costB: { [d(IRON)]: 1 } }] },
  { id: 'workbenches', label: 'Workbenches', pieces: [
    { desc: d(0xbb959), edid: 'WoodPile', name: 'Lumber Pile', group: 'workbenches', type: 'FURN', kind: 'lumber', radius: 99, station: { skill: 'woodcutter', tier: 1, minCells: 1, keyword: 'WoodPile' }, costB: { [d(WOOD)]: 12, [d(IRON)]: 1 } },{ desc: d(0x9004), edid: 'CraftingAlchemyWorkbench', name: 'Alchemy Lab', group: 'workbenches', type: 'FURN', radius: 100, station: { keyword: 'isAlchemy', skill: 'alchemist', tier: 1, minCells: 1 }, costB: { [d(SALT)]: 2 } },
    { desc: d(0x9005), edid: 'DLC2ExpSpiderCraftingLever', name: 'Spider Imbuing Chamber', group: 'workbenches', type: 'ACTI', radius: 100, station: { keyword: 'DLC2ExpSpiderCraftingLever', skill: null, tier: 0, minCells: 1, races: [d(0x13742), d(0x8883d)] }, costB: { [d(IRON)]: 1 } }] },
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

const LOG = 0x300e, logDesc = '300e:HearthFires.esm';
let now = Date.now(); const realNow = Date.now; Date.now = () => now;
const setWood = (a, rank) => setp(a, 'private.mastery', { order: ['woodcutter', 'alchemist'], skills: { woodcutter: { rank }, alchemist: { rank: 1 } } });
const use = (ref, a) => globalThis.__dboDecorActivate(parseInt(ref, 16) >>> 0, a);
const lumber = () => items().find((i) => i.kind === 'lumber');
giveItem(OWNER, WOOD, 100); giveItem(OWNER, IRON, 10);

// ---- placing: an Apprentice Woodcutter's piece, one per home ----
setp(OWNER, 'private.mastery', { order: ['woodcutter'], skills: { woodcutter: { rank: 0 } } });
cmd(OWNER, 'find lumber'); cmd(OWNER, 'place 1');
ok(/woodcutters of rank 2 and above/.test(last(OWNER)), 'a Novice Woodcutter cannot set up a Lumber Pile', last(OWNER));
setWood(OWNER, 1);
placeAt(OWNER, 'lumber');
ok(lumber() && lumber().kind === 'lumber' && lumber().station === 'WoodPile', 'an Apprentice places it, recorded as the lumber kind', items());
cmd(OWNER, 'find lumber'); cmd(OWNER, 'place 1');
ok(/This home has a Lumber Pile already\./.test(last(OWNER)), 'one per home', last(OWNER));
const pile = lumber().ref;

// ---- sawing ----
const w0 = held(OWNER, WOOD);   // 88 after the pile's 12
ok(use(pile, OWNER) === true, 'the use is decor\'s (the vanilla furniture never seats anyone)');
ok(held(OWNER, LOG) === 10 && held(OWNER, WOOD) === w0 - 40 && /You saw 40 Firewood into 10 Sawn Logs/.test(last(OWNER)), 'an Apprentice: 4 firewood a log, 10 logs a use at most', { logs: held(OWNER, LOG), wood: w0 - held(OWNER, WOOD), said: last(OWNER) });
ok(audits.some((t) => /^DECOR lumber Olaf sawed 40 firewood into 10 sawn logs \(tier 2\)/.test(t)), 'audited', audits.filter((t) => /lumber/.test(t)));
ok(use(pile, OWNER) === true && held(OWNER, LOG) === 10 && /Come back in 10 minutes/.test(last(OWNER)), 'at once again: the saw rests for this player, nothing taken', last(OWNER));
ok(JSON.stringify(Object.keys(getp(OWNER, 'private.decorLumber') || {})) === JSON.stringify([pile]), 'the rest is kept on the character, by pile, so a restart does not reset it', getp(OWNER, 'private.decorLumber'));
now += 10 * 60000 + 1;
const inv = getp(OWNER, 'inventory'); setp(OWNER, 'inventory', { entries: inv.entries.map((e) => (e.baseId === WOOD ? Object.assign({}, e, { count: 5 }) : e)) });
use(pile, OWNER);
ok(held(OWNER, LOG) === 11 && held(OWNER, WOOD) === 1, 'ten minutes on: 5 firewood saw 1 log, the odd one stays', { logs: held(OWNER, LOG), wood: held(OWNER, WOOD) });
now += 10 * 60000 + 1;
use(pile, OWNER);
ok(held(OWNER, LOG) === 11 && /A Sawn Log takes 4 Firewood at your skill; you carry 1/.test(last(OWNER)), 'too little firewood: told, nothing taken, and no rest', last(OWNER));
setWood(OWNER, 4); giveItem(OWNER, WOOD, 29);
use(pile, OWNER);
ok(held(OWNER, LOG) === 21 && held(OWNER, WOOD) === 10, 'a Master: 2 firewood a log, still 10 a use', { logs: held(OWNER, LOG), wood: held(OWNER, WOOD) });

// ---- who ----
now += 10 * 60000 + 1;
setWood(STRANGER, 3); giveItem(STRANGER, WOOD, 40);
use(pile, STRANGER);
ok(held(STRANGER, LOG) === 0 && /Only the owner, or someone the owner hired/.test(last(STRANGER)), 'a stranger in the home cannot saw here', last(STRANGER));
cmd(OWNER, 'grant Stray');
use(pile, STRANGER);
ok(held(STRANGER, LOG) === 10 && held(STRANGER, WOOD) === 10, 'a hired carpenter (Expert, 3 a log) saws from their own pack', { logs: held(STRANGER, LOG), wood: held(STRANGER, WOOD) });
setWood(FRIEND, 0); cmd(OWNER, 'grant Frida'); giveItem(FRIEND, WOOD, 20);
use(pile, FRIEND);
ok(held(FRIEND, LOG) === 0 && /takes an Apprentice Woodcutter/.test(last(FRIEND)), 'a Novice Woodcutter, even hired, cannot saw', last(FRIEND));
ok(globalThis.__dboDecorActivate(0x000bb959, OWNER) === false, 'a WoodPile in the world, not a decor piece, is left alone');

Date.now = realNow;
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
