// decor.js under costField costA (Nat 26 Oct): costA names materials by editor id, resolved through decor-catalog.json materials
// to descs, so a place pays the right items and the cost reads with real names. Stub mp as decor-harness.js.
// node tests/decor-costa-harness.js   (from server/; TMPDIR=/dev/shm/... on CT 115)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'decor.js');
const PLACEMENT = path.resolve(__dirname, '..', 'placement.js');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-decorcosta-'));
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
const LOG = 0x300e, NAILS = 0x300f;
const h = (id) => `${id.toString(16)}:HearthFires.esm`;
// The F7 copies Nat spawned on dev (26 Oct): Beyond Skyrim's proxies and the Fishing CC log, in the live catalogue's groups
const BSLOG = 0x602b1e, BSNAILS = 0x602b1f, FISHLOG = 0x90081c;
const bs = (id) => `${id.toString(16)}:BSAssets.esm`;
const materialGroups = [{ name: 'Sawn Logs', members: [h(LOG), bs(BSLOG), `${FISHLOG.toString(16)}:ccBGSSSE001-Fish.esm`] }, { name: 'Nails', members: [h(NAILS), bs(BSNAILS)] }];
fs.writeFileSync('decor-catalog.json', JSON.stringify({ materialGroups, materials: { BYOHMaterialLog: h(LOG), BYOHMaterialNails: h(NAILS), Firewood01: d(WOOD), IngotIron: d(IRON) }, groups: [
  { id: 'beds', label: 'Beds', pieces: [{ desc: d(0x9001), edid: 'CommonBed01', name: 'Bed', group: 'beds', type: 'FURN', radius: 100, costA: { BYOHMaterialLog: 2, BYOHMaterialNails: 6 }, costB: { [d(WOOD)]: 4, [d(IRON)]: 1 } }] },
  { id: 'storage', label: 'Storage', pieces: [{ desc: d(0x9002), edid: 'CommonWardrobe01', name: 'Wardrobe', group: 'storage', type: 'CONT', radius: 60, container: true, costB: { [d(WOOD)]: 4 } }] },
  { id: 'lights', label: 'Lights', pieces: [{ desc: d(0x9003), edid: 'Candle01', name: 'Candle', group: 'lights', type: 'STAT', radius: 20, light: { base: d(0x88238), radius: 256 }, costB: { [d(IRON)]: 1 } }] },
  { id: 'workbenches', label: 'Workbenches', pieces: [{ desc: d(0x9004), edid: 'CraftingAlchemyWorkbench', name: 'Alchemy Lab', group: 'workbenches', type: 'FURN', radius: 100, station: { keyword: 'isAlchemy', skill: 'alchemist', tier: 1, minCells: 1 }, costB: { [d(SALT)]: 2 } },
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
const cfg = { decor: { enabled: true, costField: 'costA', budgets: [{ pieces: 3, lights: 1, stations: 1, containers: 1 }, { pieces: 3, lights: 1, stations: 1, containers: 1 }, { pieces: 3, lights: 1, stations: 1, containers: 1 }], perSecond: 0, perHour: 1000 } };
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

const logId = parseInt(h(LOG), 16) >>> 0, nailId = parseInt(h(NAILS), 16) >>> 0;
mp.getIdFromDesc = (x) => parseInt(String(x).split(':')[0], 16) >>> 0;
cmd(OWNER, 'find bed');
ok(/Bed \[beds\]: 2 Sawn Logs, 6 Nails/.test(last(OWNER)), 'the cost reads by material name, from costA', last(OWNER));
cmd(OWNER, 'place 1');
ok(/Short: 2 Sawn Logs, 6 Nails/.test(last(OWNER)) && !lastEdit(OWNER), 'without them: told what is short, by name', last(OWNER));
giveItem(OWNER, logId, 3); giveItem(OWNER, nailId, 10); giveItem(OWNER, WOOD, 10); giveItem(OWNER, IRON, 5);
placeAt(OWNER, 'bed');
ok(items().length === 1 && held(OWNER, logId) === 1 && held(OWNER, nailId) === 4, 'placing pays 2 sawn logs and 6 nails, the costA items', { n: items().length, log: held(OWNER, logId), nails: held(OWNER, nailId) });
ok(held(OWNER, WOOD) === 10 && held(OWNER, IRON) === 5, 'and nothing from the costB list', { wood: held(OWNER, WOOD), iron: held(OWNER, IRON) });
ok(JSON.stringify(items()[0].paid) === JSON.stringify({ [h(LOG)]: 2, [h(NAILS)]: 6 }), 'what was paid is recorded by desc, so a refund gives the same items', items()[0].paid);
cmd(OWNER, 'remove 1');
ok(items().length === 0 && held(OWNER, logId) >= 1 + 1 && held(OWNER, nailId) > 4, 'taking it down refunds sawn logs and nails', { log: held(OWNER, logId), nails: held(OWNER, nailId) });

// ---- every variant counts: the F7 copies (Beyond Skyrim's 602B1E log and 602B1F nails, the Fishing CC log 90081C) ----
const take = (a, id) => { const inv = getp(a, 'inventory'); setp(a, 'inventory', { entries: inv.entries.filter((e) => e.baseId !== id) }); };
take(OWNER, logId); take(OWNER, nailId);
const bsLog = BSLOG >>> 0, bsNails = BSNAILS >>> 0, fishLog = FISHLOG >>> 0;
giveItem(OWNER, bsLog, 2); giveItem(OWNER, bsNails, 6);
cmd(OWNER, 'find bed');
ok(/2 Sawn Logs, 6 Nails/.test(last(OWNER)), 'the F7 Beyond Skyrim copies are shown under the group names', last(OWNER));
placeAt(OWNER, 'bed');
ok(items().length === 1 && held(OWNER, bsLog) === 0 && held(OWNER, bsNails) === 0, 'holding only the Beyond Skyrim log and nails places the bed', { n: items().length, log: held(OWNER, bsLog), nails: held(OWNER, bsNails) });
ok(JSON.stringify(items()[0].paid) === JSON.stringify({ [bs(BSLOG)]: 2, [bs(BSNAILS)]: 6 }), 'it records the variants actually spent', items()[0].paid);
cmd(OWNER, 'undo');
ok(items().length === 0 && held(OWNER, bsLog) === 2 && held(OWNER, bsNails) === 6, 'undo gives back the same variants, no other', { log: held(OWNER, bsLog), nails: held(OWNER, bsNails), hf: held(OWNER, logId) });
// a mixed pack: one Hearthfire log and one Fishing log, nails from both; Hearthfire is spent first
take(OWNER, bsLog); giveItem(OWNER, logId, 1); giveItem(OWNER, fishLog, 1); giveItem(OWNER, nailId, 4);
placeAt(OWNER, 'bed');
const paidMix = items()[0] && items()[0].paid;
ok(items().length === 1 && paidMix[h(LOG)] === 1 && paidMix[`${FISHLOG.toString(16)}:ccBGSSSE001-Fish.esm`] === 1 && paidMix[h(NAILS)] === 4 && paidMix[bs(BSNAILS)] === 2,
  'a mixed pack pays across variants, Hearthfire first, in the listed order', paidMix);
ok(held(OWNER, bsNails) === 4, 'and leaves the rest of the second variant', held(OWNER, bsNails));
take(OWNER, nailId); take(OWNER, bsNails); take(OWNER, logId); take(OWNER, fishLog); take(OWNER, bsLog);
giveItem(OWNER, bsLog, 1); giveItem(OWNER, nailId, 3); giveItem(OWNER, bsNails, 2);
const before = JSON.stringify(getp(OWNER, 'inventory').entries.map((e) => [e.baseId, e.count]).sort());
const edits = packets.filter(([x, p]) => x === OWNER && p.customPacketType === 'placeEdit').length;
cmd(OWNER, 'find bed'); cmd(OWNER, 'place 1');
ok(/Short: 1 Sawn Logs, 1 Nails/.test(last(OWNER)) && packets.filter(([x, p]) => x === OWNER && p.customPacketType === 'placeEdit').length === edits,
  'short is counted across variants (1 log of 2, 5 nails of 6), and no edit mode starts', last(OWNER));
ok(JSON.stringify(getp(OWNER, 'inventory').entries.map((e) => [e.baseId, e.count]).sort()) === before, 'a refused place takes nothing from any variant');

// ---- the live catalogue: every material any piece charges, in either list, is in a named group ----
{
  const live = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'decor-catalog.json'), 'utf8'));
  const named = new Map();
  for (const g of live.materialGroups || []) for (const m of g.members) named.set(m.toLowerCase(), g.name);
  const unnamed = new Set();
  for (const gr of live.groups) for (const p of gr.pieces) {
    for (const k of Object.keys(p.costA || {})) { const ds = live.materials[k]; if (!ds || !named.has(String(ds).toLowerCase())) unnamed.add(k); }
    for (const k of Object.keys(p.costB || {})) if (!named.has(k.toLowerCase())) unnamed.add(k);
  }
  ok(unnamed.size === 0, 'the live catalogue: every material has a group and a player-facing name', [...unnamed]);
  ok(['Sawn Logs', 'Nails', 'Glass', 'Straw', 'Clay', 'Quarried Stone', 'Iron Fittings', 'Hinges', 'Locks'].every((n) => (live.materialGroups || []).some((g) => g.name === n && g.members.some((m) => /BSAssets/.test(m)))),
    'each Hearthfire material group also takes the Beyond Skyrim copy F7 lists');
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
