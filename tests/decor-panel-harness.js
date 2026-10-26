// decor.js panel (native swf dbo_decor): the payload the server builds and the actions it takes, against the stub mp of decor-harness.js.
// node tests/decor-panel-harness.js   (from server/; TMPDIR=/dev/shm/... on CT 115)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'decor.js');
const PLACEMENT = path.resolve(__dirname, '..', 'placement.js');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-decorpanel-'));
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
const fire = (n, a, args, wid) => (ui[n] || []).forEach((f) => f(a, args, wid));
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
  hasUiCap: (a, cap) => cap === 'decorPanel' && a !== FRIEND,
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
const widgets = (a) => packets.filter(([x, p]) => x === a && p.customPacketType === 'dboWidget');
const lastPanel = (a) => { const w = widgets(a).filter(([, p]) => p.widget && p.widget.type === 'decor'); return w.length ? w[w.length - 1][1].widget : null; };
const closedPanel = (a) => { const w = widgets(a); return w.length && w[w.length - 1][1].close === 171; };
const act = (a, n, ...args) => fire(n, a, [lastPanel(a).nonce, ...args]);
// DECOR_PAYLOADS=<file>: the payloads as sent, for the front harness (skymp5-front tests/decor-front-harness.js)
const captured = {};
const capture = (name) => { captured[name] = JSON.parse(JSON.stringify(lastPanel(OWNER))); };

// ---- opening ----
cmd(OWNER, '');
let w = lastPanel(OWNER);
ok(w && w.id === 171 && w.view === 'catalog', '/decor with no words opens the panel on the catalogue', w);
ok(w.home === "Olaf's home" && w.owner === true, 'it names the home and knows the owner', { home: w.home, owner: w.owner });
ok(w.budget.length === 4 && w.budget[0].used === 0 && w.budget[0].of === 3, 'four budget meters from the home budget', w.budget);
ok(w.groups.map((g) => g.id).join() === 'beds,storage,lights,workbenches', 'groups in catalogue order, the race-locked chamber hidden from a Nord', w.groups);
ok(w.rows.length === 1 && w.rows[0].name === 'Bed' && w.rows[0].cost.some((c) => c.n === 4 && c.have === 0), 'the bed row carries its cost and what is held', w.rows);
capture('catalog');
const n0 = w.nonce;
cmd(FRIEND, '');
ok(!lastPanel(FRIEND), 'a client without the native panel gets chat, not a widget', last(FRIEND));
cmd(STRANGER, '');
ok(!lastPanel(STRANGER), 'a stranger in the house gets no panel', last(STRANGER));
fire('decorOpen', FRIEND, []);
ok(/cannot show the decorating panel/.test(last(FRIEND)), 'the G key on an old client says so', last(FRIEND));

// ---- views and paging ----
act(OWNER, 'decorView', 'catalog', 'workbenches', 0);
w = lastPanel(OWNER);
ok(w.group === 'workbenches' && w.rows.length === 1 && /alchemists of rank 2/.test(w.rows[0].why), 'a group filter, and the reason a row cannot be placed', w.rows);
capture('blocked');
fire('decorView', OWNER, ['stale', 'catalog', 'beds', 0]);
ok(lastPanel(OWNER).group === 'workbenches', 'a stale nonce does nothing');

// ---- place from the panel: the edit mode takes over, the panel closes and comes back ----
giveItem(OWNER, WOOD, 10); giveItem(OWNER, IRON, 5);
act(OWNER, 'decorView', 'catalog', 'beds', 0);
act(OWNER, 'decorPlace', d(0x9001));
const e = lastEdit(OWNER);
ok(e && closedPanel(OWNER), 'Place starts the edit mode and closes the panel', e);
fire('close', OWNER, [], 171);
fire('placeMove', OWNER, [e.id, [1100, 1000, 50], [0, 0, 90]]);
w = lastPanel(OWNER);
ok(items().length === 1 && w && w.budget[0].used === 1, 'set down: placed, paid, and the panel is back with the budget moved', w && w.budget);
ok(w.undo > 0 && w.undo <= 60, 'the undo countdown is offered', w.undo);
act(OWNER, 'decorPlace', d(0x9002));
ok(lastEdit(OWNER).base === d(0x9002) && closedPanel(OWNER), 'Place on the wardrobe hands it to the edit mode', lastEdit(OWNER));

// ---- placed view: move, remove with a refund preview, undo ----
fire('placeMove', OWNER, [lastEdit(OWNER).id, [1200, 1000, 50], [0, 0, 0]]);
act(OWNER, 'decorView', 'placed', null, 0);
w = lastPanel(OWNER);
ok(w.view === 'placed' && w.rows.length === 2 && w.rows[0].name === 'Bed', 'placed pieces nearest first', w.rows.map((r) => r.name));
ok(/Firewood|6f993/.test(w.rows[0].refund), 'each placed row previews its refund', w.rows[0].refund);
capture('placed');
act(OWNER, 'decorUndo');
w = lastPanel(OWNER);
ok(items().length === 1 && w.rows.length === 1, 'Undo takes back the last place and the list follows', w.rows);
const ref = w.rows[0].key;
act(OWNER, 'decorMove', ref);
ok(lastEdit(OWNER).base === items()[0].base && closedPanel(OWNER), 'Move hands the piece to the edit mode', lastEdit(OWNER));
fire('placeMove', OWNER, [lastEdit(OWNER).id, [1150, 1000, 50], [0, 0, 0]]);
ok(items()[0].pos[0] === 1150 && lastPanel(OWNER).view === 'placed', 'set down: moved, and back on the placed view');
const wood = held(OWNER, WOOD);
act(OWNER, 'decorRemove', ref);
ok(items().length === 0 && held(OWNER, WOOD) > wood && lastPanel(OWNER).rows.length === 0, 'Remove deconstructs for the share and refreshes', held(OWNER, WOOD) - wood);
act(OWNER, 'decorRemove', 'ffffffff');
ok(items().length === 0, 'removing a ref that is not here does nothing');

// ---- people ----
act(OWNER, 'decorView', 'people', null, 0);
w = lastPanel(OWNER);
ok(w.view === 'people' && w.rows.length === 0 && w.nearby.some((x) => x.name === 'Stray'), 'People lists who is here to name', w.nearby);
act(OWNER, 'decorGrant', String(PROFILE[STRANGER]));
w = lastPanel(OWNER);
ok(w.rows.length === 1 && w.rows[0].name === 'Stray' && !w.nearby.some((x) => x.name === 'Stray'), 'Grant names them, by name', w.rows);
capture('people');
setp(STRANGER, 'worldOrCellDesc', d(OTHER));
act(OWNER, 'decorView', 'people', null, 0);
ok(lastPanel(OWNER).rows[0].name === 'Stray', 'a decorator who left is still listed by name');
setp(STRANGER, 'worldOrCellDesc', d(CELL));
cmd(STRANGER, '');
const sw = lastPanel(STRANGER);
ok(sw && sw.owner === false, 'the decorator now gets the panel, not as owner');
fire('decorGrant', STRANGER, [sw.nonce, String(PROFILE[GM])]);
ok(!(T.reg().places[DOOR.toString(16)].decorators || []).includes(PROFILE[GM]), 'a decorator cannot grant (owner only)', T.reg().places[DOOR.toString(16)].decorators);
ok(sw.nearby.length === 0, 'a decorator is offered nobody to name', sw.nearby);
act(OWNER, 'decorRevoke', String(PROFILE[STRANGER]));
ok(!(T.reg().places[DOOR.toString(16)].decorators || []).includes(PROFILE[STRANGER]), 'Revoke takes them off');

// ---- search (the browser panel has a text box) ----
act(OWNER, 'decorView', 'catalog', 'beds', 0, 'ward');
w = lastPanel(OWNER);
ok(w.search === 'ward' && w.rows.length === 1 && w.rows[0].name === 'Wardrobe', 'a search finds across groups', w.rows.map((r) => r.name));
capture('search');
act(OWNER, 'decorView', 'catalog', 'beds', 0, 'nothing like this');
ok(lastPanel(OWNER).rows.length === 0, 'a search with no match gives no rows');
act(OWNER, 'decorView', 'catalog', 'beds', 0, '');
w = lastPanel(OWNER);
ok(w.search === '' && w.group === 'beds' && w.rows[0].name === 'Bed', 'clearing it is the group again', w.rows.map((r) => r.name));
act(OWNER, 'decorView', 'catalog', 'beds', 0, 'x'.repeat(500));
ok(lastPanel(OWNER).search.length === 40, 'a search is cut to 40 characters');

// ---- closing ----
act(OWNER, 'decorView', 'catalog', 'beds', 0, '');
act(OWNER, 'decorClose');
ok(closedPanel(OWNER) && !T.S.panel.has(OWNER), 'Close closes the widget and forgets the panel');
cmd(OWNER, '');
fire('close', OWNER, [], 171);
fire('decorView', OWNER, [n0, 'catalog', 'beds', 0]);
ok(!T.S.panel.has(OWNER), 'closing forgets the panel; an old nonce does nothing');

if (process.env.DECOR_PAYLOADS) fs.writeFileSync(process.env.DECOR_PAYLOADS, JSON.stringify(captured, null, 1));
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
