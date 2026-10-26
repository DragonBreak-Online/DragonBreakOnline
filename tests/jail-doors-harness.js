// Jail doors a hold assigns (Nat, 25 Oct: "the ability to assign jail doors"): /jaildoors arms "the next door I use" for
// GM+ staff and the hold's ruler, Steward, Commander or Captain of the Guard; the door is then a cell door of that hold
// wherever it stands, opened only by that hold's lawful and Lead GM+, locked on its prisoner, opened on release, filled by
// the watch before hold-jails.json (nearest free first), saved in jail-doors.json and audited. Loads the real jail.js with a
// mock gamemode api in a scratch folder. Run it from this folder's parent with
//
//   node tests/jail-doors-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const JAIL = path.resolve(__dirname, '..', 'jail.js');

// Real records, as jail-harness uses them: Bruma's castle dungeon, a cell door base, a load door, Riverwood's inn
const JAIL_CELL = '6c410:BSHeartland.esm', PLAIN_CELL = '133c6:Skyrim.esm';
const DOOR_BASE = '6c43c:BSHeartland.esm', LOAD_DOOR_DESC = '6c51f:BSHeartland.esm';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jail-doors-harness-'));
process.chdir(dir);
fs.writeFileSync('doors.json', JSON.stringify({ doors: { [LOAD_DOOR_DESC]: 'Bruma Castle' } }));
fs.writeFileSync('hold-jails.json', JSON.stringify({ holds: { whiterun: [{ kind: 'jail', cell: JAIL_CELL, door: '6c438:BSHeartland.esm', spot: [10, 10, 0] }] } }));

let wallClock = 1780000000000;
Date.now = () => wallClock;

const JARL = 0x21, JARL_F = 0x22, GUARD = 0x23, GUARD_F = 0x24, PRISONER = 0x25, PRISONER2 = 0x26, LEAD = 0x27, GM = 0x28, STRANGER = 0x29;
const CELL_DOOR = 0x0806c438, LOAD_DOOR = 0x0806c51f, INN_DOOR = 0x7001, INN_DOOR2 = 0x7002, PLACED = 0xff000123;
const props = new Map();
const put = (id, p, v) => props.set(id + '|' + p, v);
const at = (id, cell, pos) => { put(id, 'worldOrCellDesc', cell); put(id, 'pos', pos); };
for (const [d, cell, pos] of [[CELL_DOOR, JAIL_CELL, [0, 0, 0]], [LOAD_DOOR, PLAIN_CELL, [50, 0, 0]], [INN_DOOR, PLAIN_CELL, [0, 0, 0]], [INN_DOOR2, PLAIN_CELL, [3000, 0, 0]], [PLACED, PLAIN_CELL, [0, 50, 0]]]) {
  at(d, cell, pos); put(d, 'baseDesc', DOOR_BASE);
}
for (const a of [JARL, JARL_F, GUARD, GUARD_F, LEAD, GM, STRANGER]) at(a, PLAIN_CELL, [80, 0, 0]);
at(PRISONER, PLAIN_CELL, [-80, 0, 0]); at(PRISONER2, PLAIN_CELL, [-60, 0, 0]);
put(GUARD, 'private.dboLawful', true); put(GUARD_F, 'private.dboLawful', true);
for (const a of [PRISONER, PRISONER2, STRANGER]) put(a, 'inventory', { entries: [] });

const PLUGINS = { 'Skyrim.esm': 0x00, 'BSHeartland.esm': 0x08 };
const idOf = (d) => { const [hex, plugin] = String(d).split(':'); if (!(plugin in PLUGINS)) throw new Error(`no plugin ${plugin}`); return ((PLUGINS[plugin] << 24) | parseInt(hex, 16)) >>> 0; };
const descOf = (id) => { const p = Object.keys(PLUGINS).find((k) => PLUGINS[k] === (id >>> 24)); return `${(id & 0xffffff).toString(16)}:${p || 'Skyrim.esm'}`; };
const TYPES = { [idOf(DOOR_BASE)]: 'DOOR', [idOf(JAIL_CELL)]: 'CELL', [idOf(PLAIN_CELL)]: 'CELL' };
const EDIDS = { [idOf(JAIL_CELL)]: 'CYRBrumaCastleDungeon', [idOf(PLAIN_CELL)]: 'RiverwoodSleepingGiantInn' };

// Where each one stands, as guards.js __dboHoldHere reads it, and who holds which seat
const HOLD = { [JARL]: 'whiterun', [JARL_F]: 'falkreath', [GUARD]: 'whiterun', [GUARD_F]: 'falkreath', [LEAD]: 'whiterun', [GM]: 'whiterun', [STRANGER]: 'whiterun', [PRISONER]: 'whiterun', [PRISONER2]: 'whiterun' };
globalThis.__dboHoldHere = (a) => HOLD[a] || '';
const SEATS = { [JARL]: [{ zone: { id: 'whiterun' }, rank: 'jarl' }], [JARL_F]: [{ zone: { id: 'falkreath' }, rank: 'jarl' }] };

const online = [JARL, JARL_F, GUARD, GUARD_F, PRISONER, PRISONER2, LEAD, GM, STRANGER];
const out = { widgets: [], said: [], audits: [], logs: [] };
const handlers = new Map(), commands = new Map(), timers = new Map();
const api = {
  mp: {
    getIdFromDesc: idOf, getDescFromId: descOf,
    get: (id, p) => props.get(id + '|' + p),
    set: (id, p, v) => props.set(id + '|' + p, v),
    lookupEspmRecordById: (id) => (TYPES[id] ? { record: { type: TYPES[id], editorId: EDIDS[id] || '' } } : null),
  },
  log: (...a) => out.logs.push(a.join(' ')),
  personal: (a, t) => out.said.push([a, t]), system: (a, t) => out.said.push([a, t]),
  audit: (t) => out.audits.push(t),
  display: (a) => `P${a.toString(16)}`, who: (a) => `W${a.toString(16)}`,
  cfg: { jail: { cells: [JAIL_CELL] } },
  openWidget: (a, w) => { out.widgets.push({ a, w }); return true; }, closeWidget: () => true,
  onUi: (ev, fn) => { const l = handlers.get(ev) || []; l.push(fn); handlers.set(ev, l); },
  registerChatCommand: (name, fn, opts) => commands.set(name, { fn, opts }),
  onlineActors: () => online.slice(), every: (name, ms, fn) => timers.set(name, fn),
  isAdmin: (a) => a === GM || a === LEAD, isLeadStaff: (a) => a === LEAD,
  distanceMeters: (a, b) => {
    const p = props.get(a + '|pos'), q = props.get(b + '|pos');
    if (props.get(a + '|worldOrCellDesc') !== props.get(b + '|worldOrCellDesc')) return Infinity;
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 70;
  },
  ranksOf: (profile, a) => SEATS[a] || [], profileOf: (a) => a,
  zoneById: (id) => ({ whiterun: { name: 'Whiterun' }, falkreath: { name: 'Falkreath' } }[id] || null),
};
const load = () => { delete require.cache[JAIL]; handlers.clear(); require(JAIL)(api); };
load();

let failures = 0;
const check = (name, ok, detail) => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${!ok && detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); };
const ui = (ev, a, args) => (handlers.get(ev) || []).forEach((fn) => fn(a, args || [], 42));
const act = (door, a) => globalThis.__dboJailActivate(door, a);
const cmd = (a) => commands.get('jaildoors').fn(a, []);
const last = () => out.widgets[out.widgets.length - 1];
const ids = () => last().w.actions.map((x) => x.id);
const said = (a) => { const l = out.said.filter((p) => p[0] === a); return l.length ? l[l.length - 1][1] : ''; };
const file = () => { try { return JSON.parse(fs.readFileSync('jail-doors.json', 'utf8')).doors; } catch (e) { return null; } };
const assign = (a, door) => { cmd(a); ui('jailDoorChoose', a, ['arm']); act(door, a); ui('jailDoorChoose', a, ['assign']); };

// ---- who may assign ----
cmd(STRANGER);
check('a player with no seat is refused, told who may', /Only staff or Whiterun's ruler, Steward, Commander or Captain of the Guard/.test(said(STRANGER)), said(STRANGER));
cmd(GUARD);
check('a plain guard is refused too', /Only staff/.test(said(GUARD)));
cmd(JARL);
check('the Jarl of the hold gets the menu: arm, and no doors yet', last().a === JARL && ids().join() === 'arm' && /Whiterun: 0 jail doors/.test(last().w.targetName), last().w);
ui('jailDoorChoose', JARL, ['arm']);
check('armed: told to stand inside and use the door', /use its door within 60 seconds/.test(said(JARL)));
check('the armed Jarl\'s next door opens the assignment menu instead of the door', act(INN_DOOR, JARL) === true && ids().join() === 'assign,cancel', last().w);
ui('jailDoorChoose', JARL, ['assign']);
const f1 = file();
check('assigned: saved in jail-doors.json with its hold, cell and the spot the Jarl stood on',
  f1 && f1.length === 1 && f1[0].door === '7001:Skyrim.esm' && f1[0].hold === 'whiterun' && f1[0].cell === PLAIN_CELL && f1[0].spot.join() === '80,0,0', f1);
check('...and audited', out.audits.some((t) => /^JAIL DOOR W21 assigned 7001:Skyrim\.esm \(Riverwood Sleeping Giant Inn\) as a jail door of whiterun, prisoners at 80,0,0$/.test(t)), out.audits);
check('the arming is spent: the same door used again is the jail door it now is (the cell menu, not the assignment)', (() => { out.widgets.length = 0; act(INN_DOOR, JARL); const r = !!last() && !ids().includes('assign') && ids().includes('open'); ui('jailClose', JARL); return r; })(), last() && last().w);

check('a load door cannot be one', (() => { cmd(JARL); ui('jailDoorChoose', JARL, ['arm']); return act(LOAD_DOOR, JARL) === true && /A load door cannot be a jail door/.test(said(JARL)); })());
check('nor a placed door', (() => { cmd(JARL); ui('jailDoorChoose', JARL, ['arm']); return act(PLACED, JARL) === true && /placed door/.test(said(JARL)); })());
check('the arming runs out after 60 s', (() => { cmd(JARL); ui('jailDoorChoose', JARL, ['arm']); wallClock += 61000; out.widgets.length = 0; const r = act(INN_DOOR2, JARL); return r === false && out.widgets.length === 0; })());
check('another hold\'s Jarl cannot take it over or unassign it', (() => { cmd(JARL_F); return /Only staff or Falkreath's ruler/.test(said(JARL_F)) || (ui('jailDoorChoose', JARL_F, ['arm']), act(INN_DOOR, JARL_F) === true && /Only staff or Whiterun's ruler/.test(said(JARL_F))); })(), said(JARL_F));
check('a GM may assign in any hold', (() => { at(GM, PLAIN_CELL, [3050, 0, 0]); assign(GM, INN_DOOR2); at(GM, PLAIN_CELL, [80, 0, 0]); const f = file(); return f.length === 2 && f[1].door === '7002:Skyrim.esm' && f[1].by === 'W28'; })(), file());

// ---- someone's property is never a jail door (the fork's housing recordOf, which resolves a door to its building) ----
const OWNED_DOOR = 0x7003;
at(OWNED_DOOR, PLAIN_CELL, [0, 40, 0]); put(OWNED_DOOR, 'baseDesc', DOOR_BASE);
const claims = new Map([[OWNED_DOOR, { owner: 77, ownerName: 'Aela' }]]);
globalThis.__dboHousing = { recordOf: (ref) => claims.get(ref >>> 0) || null };
check('a door of someone\'s property is refused, saying whose and what to do', (() => {
  cmd(JARL); ui('jailDoorChoose', JARL, ['arm']); out.widgets.length = 0;
  const r = act(OWNED_DOOR, JARL);
  return r === true && out.widgets.length === 0 && /part of Aela's property, so it cannot be a jail door/.test(said(JARL)) && file().length === 2;
})(), said(JARL));
check('a jail door claimed after it was assigned is passed over by the watch', (() => {
  claims.set(INN_DOOR, { owner: 78, ownerName: 'Ysolda' });
  const w = globalThis.__dboJailByWatch(PRISONER, 'whiterun', 10, 'x');
  const ok = w && w.kind === 'jail door' && (props.get(PRISONER + '|private.dboSentence').door >>> 0) === INN_DOOR2;
  claims.delete(INN_DOOR); props.set(PRISONER + '|private.dboSentence', null); props.set(INN_DOOR2 + '|private.dboCell', null);
  return ok;
})());

// ---- a jail door in use ----
out.widgets.length = 0;
check('the hold\'s guard at the jail door with a player near gets the cell menu', act(INN_DOOR, GUARD) === true && ids().includes('who:25'), last() && last().w);
ui('jailChoose', GUARD, ['who:25']);
ui('jailChoose', GUARD, ['time:25:5']);
const s = props.get(PRISONER + '|private.dboSentence');
check('the prisoner is locked behind it: sentence on the door, door shut', s && (s.door >>> 0) === INN_DOOR && s.cell === '133c6:skyrim.esm' && props.get(INN_DOOR + '|isOpen') === false, s);
check('the prisoner cannot open it', act(INN_DOOR, PRISONER) === true && /locked/.test(said(PRISONER)));
out.widgets.length = 0;
check('another hold\'s guard is no guard here: no menu, the lock holds', act(INN_DOOR, GUARD_F) === true && out.widgets.length === 0);
check('a GM below Lead GM does not open it either (staff observe)', (() => { out.widgets.length = 0; return act(INN_DOOR, GM) === true && out.widgets.length === 0; })());
check('a Lead GM may', (() => { out.widgets.length = 0; return act(INN_DOOR, LEAD) === true && ids().includes('release'); })(), last() && last().w);
ui('jailChoose', LEAD, ['open']);
check('the Jarl, an assigner of the hold, may too', (() => { out.widgets.length = 0; return act(INN_DOOR, JARL) === true && ids().includes('release'); })(), last() && last().w);
ui('jailDoorClose', JARL);
check('it cannot be unassigned while it holds someone', (() => { cmd(JARL); ui('jailDoorChoose', JARL, ['rm:7001:Skyrim.esm']); return /locked behind that door/.test(said(JARL)) && file().length === 2; })());
put(INN_DOOR, 'isOpen', false);
act(INN_DOOR, GUARD); ui('jailChoose', GUARD, ['release']);
check('on release the jail door opens and forgets its prisoner', props.get(INN_DOOR + '|isOpen') === true && !props.get(INN_DOOR + '|private.dboCell') && !props.get(PRISONER + '|private.dboSentence'));
check('a jail\'s own cell door still only unlocks on release (unchanged)', (() => {
  at(GUARD, JAIL_CELL, [50, 0, 0]); at(PRISONER2, JAIL_CELL, [-50, 0, 0]); put(CELL_DOOR, 'isOpen', false);
  act(CELL_DOOR, GUARD); ui('jailChoose', GUARD, ['who:26']); ui('jailChoose', GUARD, ['time:26:5']);
  act(CELL_DOOR, GUARD); ui('jailChoose', GUARD, ['release']);
  const r = props.get(CELL_DOOR + '|isOpen') === false && !props.get(PRISONER2 + '|private.dboSentence');
  at(GUARD, PLAIN_CELL, [80, 0, 0]); at(PRISONER2, PLAIN_CELL, [-60, 0, 0]); return r;
})());

// ---- the watch ----
const w1 = globalThis.__dboJailByWatch(PRISONER, 'whiterun', 10, 'the watch of Whiterun');
check('the watch fills the hold\'s jail door nearest the prisoner first (the inn door, not the far one or the castle cell)',
  w1 && w1.kind === 'jail door' && w1.cellDesc === PLAIN_CELL && w1.pos.join() === '80,0,0' && (props.get(PRISONER + '|private.dboSentence').door >>> 0) === INN_DOOR, w1);
check('...audited as a jail door', out.audits.some((t) => /jailed by the watch of whiterun for 10 min behind the jail door 7001:Skyrim\.esm/.test(t)));
const w2 = globalThis.__dboJailByWatch(PRISONER2, 'whiterun', 10, 'the watch of Whiterun');
check('the next prisoner gets the next free jail door', w2 && w2.kind === 'jail door' && (props.get(PRISONER2 + '|private.dboSentence').door >>> 0) === INN_DOOR2, w2);
props.set(STRANGER + '|private.dboSentence', null);
const w3 = globalThis.__dboJailByWatch(STRANGER, 'whiterun', 10, 'the watch of Whiterun');
check('with every jail door full, hold-jails.json takes the rest as before', w3 && w3.kind === 'jail' && w3.cellDesc === JAIL_CELL, w3);
check('a hold with no jail doors uses hold-jails.json alone', globalThis.__dboJailByWatch(GUARD_F, 'falkreath', 10, 'x') === null);

// ---- unassigning and persistence ----
for (const a of [PRISONER, PRISONER2, STRANGER]) { props.set(a + '|private.dboSentence', null); }
props.set(INN_DOOR2 + '|private.dboCell', null);
cmd(JARL);
check('the menu lists the hold\'s jail doors to unassign', ids().join() === 'arm,rm:7001:Skyrim.esm,rm:7002:Skyrim.esm', ids());
ui('jailDoorChoose', JARL, ['rm:7002:Skyrim.esm']);
check('unassigned from the list: saved and audited', file().length === 1 && out.audits.some((t) => /^JAIL DOOR W21 unassigned 7002:Skyrim\.esm/.test(t)), file());
check('...and that door is an ordinary door again', act(INN_DOOR2, GUARD) === false);
load();
check('a reload keeps the jail doors (boot line, and the door still answers as a jail door)', out.logs.some((l) => /1 assigned jail door\(s\)/.test(l)) && (out.widgets.length = 0, act(INN_DOOR, GUARD) === true));

console.log(failures ? `${failures} FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
