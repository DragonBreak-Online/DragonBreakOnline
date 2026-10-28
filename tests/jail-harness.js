// Scripted test for server\jail.js: loads the real module with a mock gamemode api and walks the whole loop -
// which doors are cell doors, a guard imprisoning a player, the lock, lockpicking, /unstuck, time served only
// online and only inside, the served message, a guard's release / extend / relock, and /jail add | remove.
// No server and no game: run it from this folder's parent with
//
//   node tests\jail-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const JAIL = path.resolve(__dirname, '..', 'jail.js');

// The ids are real records (the pre-commit hook checks them): Bruma's castle dungeon and one of its cell doors, a
// load door out of it, and Riverwood's inn as an ordinary interior.
const JAIL_CELL = '6c410:BSHeartland.esm', PLAIN_CELL = '133c6:Skyrim.esm', TAMRIEL = '3c:Skyrim.esm';
const DOOR_BASE = '6c43c:BSHeartland.esm', LOAD_DOOR_DESC = '6c51f:BSHeartland.esm';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jail-harness-'));
process.chdir(dir);
fs.writeFileSync('doors.json', JSON.stringify({ doors: { [LOAD_DOOR_DESC]: 'Bruma Castle' } }));
// one yard every prisoner shares (as Cidhna Mine), for staff /unstuck's 'nobody can release them early there'
fs.writeFileSync('hold-jails.json', JSON.stringify({ holds: { reach: [{ kind: 'mine', cell: JAIL_CELL, door: '6c4ff:BSHeartland.esm', spot: [0, 900, 0], shared: true }] } }));

let wallClock = 1780000000000;
Date.now = () => wallClock;
const MIN = 60000;

const GUARD = 0x14, PRISONER = 0x15, OTHER = 0x16, MINER = 0x17, LEAD = 0x18, GATED = 0x19, ELSE = 0x1a;
const CELL_DOOR = 0x6c438, LOAD_DOOR = 0x6c51f, INN_DOOR = 0x7001;
const props = new Map();
const put = (id, p, v) => props.set(id + '|' + p, v);
const at = (id, cell, pos) => { put(id, 'worldOrCellDesc', cell); put(id, 'pos', pos); };
at(CELL_DOOR, JAIL_CELL, [0, 0, 0]); put(CELL_DOOR, 'baseDesc', DOOR_BASE);
at(LOAD_DOOR, JAIL_CELL, [500, 0, 0]); put(LOAD_DOOR, 'baseDesc', DOOR_BASE);
at(INN_DOOR, PLAIN_CELL, [0, 0, 0]); put(INN_DOOR, 'baseDesc', DOOR_BASE);
at(GUARD, JAIL_CELL, [100, 0, 0]); put(GUARD, 'private.dboLawful', true);
at(PRISONER, JAIL_CELL, [-100, 0, 0]);
at(OTHER, JAIL_CELL, [2000, 0, 0]);
const inv = (a, n) => put(a, 'inventory', { entries: n ? [{ baseId: 0xa, count: n }] : [] });
inv(PRISONER, 0); inv(OTHER, 2);

// Exact plugin-name matching, like the server's FormDesc::ToFormId
const PLUGINS = { 'Skyrim.esm': 0x00, 'BSHeartland.esm': 0x08 };
const idOf = (d) => { const [hex, plugin] = String(d).split(':'); if (!(plugin in PLUGINS)) throw new Error(`no plugin ${plugin}`); return ((PLUGINS[plugin] << 24) | parseInt(hex, 16)) >>> 0; };
const TYPES = { [idOf(DOOR_BASE)]: 'DOOR', [idOf(JAIL_CELL)]: 'CELL', [idOf(PLAIN_CELL)]: 'CELL', [idOf(TAMRIEL)]: 'WRLD' };
const EDIDS = { [idOf(JAIL_CELL)]: 'CYRBrumaCastleDungeon' };

let online = [GUARD, PRISONER, OTHER];
const out = { widgets: [], said: [], audits: [], logs: [] };
const handlers = new Map(), commands = new Map(), timers = new Map();
const api = {
  mp: {
    getIdFromDesc: idOf,
    getDescFromId: (id) => (id >>> 0).toString(16),
    get: (id, p) => props.get(id + '|' + p),
    set: (id, p, v) => props.set(id + '|' + p, v),
    lookupEspmRecordById: (id) => (TYPES[id] ? { record: { type: TYPES[id], editorId: EDIDS[id] || '' } } : null),
  },
  log: (...a) => out.logs.push(a.join(' ')),
  personal: (a, t) => out.said.push([a, t]),
  system: (a, t) => out.said.push([a, t]),
  audit: (t) => out.audits.push(t),
  display: (a) => ({ [GUARD]: 'Guard', [PRISONER]: 'Thief', [OTHER]: 'Friend' }[a] || 'P'),
  who: (a) => `P${a.toString(16)}`,
  cfg: { jail: { cells: [JAIL_CELL] } },
  openWidget: (a, w, focus) => { out.widgets.push({ a, w, focus }); return true; },
  closeWidget: () => true,
  onUi: (ev, fn) => { const l = handlers.get(ev) || []; l.push(fn); handlers.set(ev, l); },
  registerChatCommand: (name, fn, opts) => commands.set(name, { fn, opts }),
  onlineActors: () => online.slice(),
  every: (name, ms, fn) => timers.set(name, fn),
  isAdmin: (a) => a === GUARD && props.get(GUARD + '|isAdminFlag') === true,
  isLeadStaff: (a) => a === LEAD,
  distanceMeters: (a, b) => {
    const p = props.get(a + '|pos'), q = props.get(b + '|pos');
    if (props.get(a + '|worldOrCellDesc') !== props.get(b + '|worldOrCellDesc')) return Infinity;
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 70;
  },
};
require(JAIL)(api);

let failures = 0, checks = 0;
const check = (name, ok, detail) => { checks++; if (!ok) { failures++; console.log(`FAIL ${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); } else console.log(`ok   ${name}`); };
const ui = (ev, a, args) => (handlers.get(ev) || []).forEach((fn) => fn(a, args || [], 42));
const act = (door, a) => globalThis.__dboJailActivate(door, a);
const lastWidget = () => out.widgets[out.widgets.length - 1];
const ids = () => lastWidget().w.actions.map((x) => x.id);
const said = (a) => { const l = out.said.filter((p) => p[0] === a); return l.length ? l[l.length - 1][1] : ''; };
const tick = (n) => { for (let i = 0; i < n; i++) { wallClock += 5000; timers.get('jail')(); } };
const sentence = () => props.get(PRISONER + '|private.dboSentence');

// ---- which doors are cell doors ----
check('boot line counts one jail zone and one load door', out.logs.some((l) => /1 jail zone\(s\), 1 load doors/.test(l)), out.logs);
check('a load door in the jail is an ordinary door', act(LOAD_DOOR, GUARD) === false);
check('a door outside any jail is an ordinary door', act(INN_DOOR, GUARD) === false);
at(PRISONER, JAIL_CELL, [5000, 0, 0]);
check('a guard at an empty cell door with nobody near just opens it', act(CELL_DOOR, GUARD) === false);
at(PRISONER, JAIL_CELL, [-100, 0, 0]);
check('a non-guard at an empty cell door just opens it', act(CELL_DOOR, PRISONER) === false);

// ---- imprisoning ----
check('with a player in reach the guard gets the menu', act(CELL_DOOR, GUARD) === true && ids().join() === 'who:15,open', ids());
ui('jailChoose', GUARD, ['who:15']);
check('then the lengths', ids().join() === 'time:15:5,time:15:10,time:15:15,time:15:30,time:15:60,time:15:120', ids());
check('...labelled in hours past an hour', lastWidget().w.actions.map((x) => x.label).slice(-2).join() === '1 hour,2 hours');
put(CELL_DOOR, 'isOpen', true);
put(PRISONER, 'private.restrained', { boundHands: true, captorActorId: OTHER, carrierActorId: 0 });
const outlawCalls = [];
globalThis.__dboOutlawJailed = (g, p, by) => { outlawCalls.push([g, p, by]); return 0; };
const uncuffed = [];
globalThis.__dboUncuff = (id) => { uncuffed.push(id); put(id, 'private.restrained', null); return true; };
ui('jailChoose', GUARD, ['time:15:5']);
check('the sentence is registered on the prisoner', sentence() && sentence().totalMs === 5 * MIN && (sentence().door >>> 0) === CELL_DOOR && sentence().servedMs === 0);
check('...and the prisoner on the door', props.get(CELL_DOOR + '|private.dboCell').prisoner === PRISONER);
check('the door closes', props.get(CELL_DOOR + '|isOpen') === false);
check('the prisoner is told where and for how long', /sentences you to 5 minutes in Bruma Castle Dungeon/.test(said(PRISONER)), said(PRISONER));
check('a bound prisoner is uncuffed as the door locks', uncuffed.join() === String(PRISONER) && /bonds are taken off/.test(said(PRISONER)), uncuffed);
delete globalThis.__dboUncuff;
check('who bound them is the one who brought them in: kept on the sentence and passed to the bounty', sentence().arrester === OTHER && outlawCalls.length === 1 && outlawCalls[0][2] === OTHER, [sentence().arrester, outlawCalls]);
delete globalThis.__dboOutlawJailed;
check('a made-up length is refused', (() => { ui('jailChoose', GUARD, ['time:16:9999']); return !props.get(OTHER + '|private.dboSentence'); })());

// ---- the lock ----
check('the prisoner cannot open it', act(CELL_DOOR, PRISONER) === true && /would need a lockpick/.test(said(PRISONER)), said(PRISONER));
at(OTHER, JAIL_CELL, [0, 100, 0]);
const realRandom = Math.random;
Math.random = () => 0.99;
check('a failed pick refuses the door', act(CELL_DOOR, OTHER) === true && /snaps/.test(said(OTHER)));
check('...and breaks a pick', props.get(OTHER + '|inventory').entries[0].count === 1);
check('picks are rate limited', act(CELL_DOOR, OTHER) === true && props.get(OTHER + '|inventory').entries[0].count === 1);
wallClock += 4000;
Math.random = () => 0.01;
check('a good pick lets the door open', act(CELL_DOOR, OTHER) === false && props.get(CELL_DOOR + '|private.dboCell').picked === true);
check('...and keeps the pick', props.get(OTHER + '|inventory').entries[0].count === 1);
Math.random = realRandom;
check('a picked door stays open to anyone', act(CELL_DOOR, PRISONER) === false);

// ---- the guard's menu on an occupied door ----
check('a guard sees the prisoner and the time left', act(CELL_DOOR, GUARD) === true && /Thief: 5 minutes left/.test(lastWidget().w.targetName) && ids().join() === 'release,extend,relock,open', ids());
ui('jailChoose', GUARD, ['relock']);
check('relock closes and locks it again', props.get(CELL_DOOR + '|private.dboCell').picked === false && props.get(CELL_DOOR + '|isOpen') === false);
act(CELL_DOOR, GUARD); ui('jailChoose', GUARD, ['extend']);
check('extend adds 10 minutes', sentence().totalMs === 15 * MIN);
check('the prisoner is not a guard at their own door even if lawful', (() => { put(PRISONER, 'private.dboLawful', true); const n = out.widgets.length; const r = act(CELL_DOOR, PRISONER); put(PRISONER, 'private.dboLawful', false); return r === true && out.widgets.length === n; })());

// ---- /unstuck ----
check('no /unstuck while serving', /serving a sentence/.test(globalThis.__dboJailUnstuck(PRISONER) || ''));
check('no /unstuck in a jail', /in a jail/.test(globalThis.__dboJailUnstuck(OTHER) || ''));
at(OTHER, PLAIN_CELL, [0, 0, 0]);
check('/unstuck is fine elsewhere', globalThis.__dboJailUnstuck(OTHER) === null);
// staff /unstuck refuses a prisoner (gamemode.js; Jake, 28 Oct: "Yes, refuse prisoners"): the jail names the cell
check('a prisoner serving: __dboJailSentence names the jail', (globalThis.__dboJailSentence(PRISONER) || {}).cell === 'Bruma Castle Dungeon', globalThis.__dboJailSentence(PRISONER));
check('...and says the guard gets Release at the door, someone else not (the menu\'s own rule)', globalThis.__dboJailSentence(PRISONER, GUARD).release === true
  && globalThis.__dboJailSentence(PRISONER, OTHER).release === false && globalThis.__dboJailSentence(PRISONER).release === false, [globalThis.__dboJailSentence(PRISONER, GUARD), globalThis.__dboJailSentence(PRISONER, OTHER)]);
// release as the menu decides it now (claude-jake-pc, 28 Oct): the door holds this prisoner, the caller is a Lead GM or stands in
// that jail, lawful there, and never for oneself
check('...the guard standing outside the jail: no Release (they must be there)', (() => { at(GUARD, PLAIN_CELL, [0, 0, 0]); const r = globalThis.__dboJailSentence(PRISONER, GUARD).release; at(GUARD, JAIL_CELL, [100, 0, 0]); return r === false; })());
check('...a Lead GM anywhere: Release', (() => { at(LEAD, PLAIN_CELL, [0, 0, 0]); return globalThis.__dboJailSentence(PRISONER, LEAD).release === true; })());
check('...the prisoner themselves, lawful or not: never', (() => { put(PRISONER, 'private.dboLawful', true); const r = globalThis.__dboJailSentence(PRISONER, PRISONER).release; put(PRISONER, 'private.dboLawful', false); return r === false; })());
check('...and not shared: a cell door', globalThis.__dboJailSentence(PRISONER, GUARD).shared === false);
at(MINER, TAMRIEL, [0, 0, 0]);
const mined = globalThis.__dboJailByWatch(MINER, 'reach', 10, 'the watch');
check('the watch puts someone in the shared yard', !!mined && (props.get(MINER + '|private.dboSentence') || {}).totalMs === 10 * MIN, mined);
check('...whose sentence is shared, so nobody gets Release, a Lead GM neither', globalThis.__dboJailSentence(MINER, GUARD).shared === true && globalThis.__dboJailSentence(MINER, LEAD).release === false
  && globalThis.__dboJailSentence(MINER, GUARD).release === false, globalThis.__dboJailSentence(MINER, LEAD));
put(MINER, 'private.dboSentence', null);
// C's set-6 review (28 Oct): a guard locking someone at the yard's own gate (as Cidhna Mine's bf4d4) puts them behind it, so the
// gate holds them: not the shared yard, and a Lead GM gets Release there. The end state of the door menu's imprison:
const YARD_GATE = idOf('6c4ff:BSHeartland.esm');
at(YARD_GATE, JAIL_CELL, [0, 900, 0]); put(YARD_GATE, 'baseDesc', DOOR_BASE);
put(GATED, 'private.dboSentence', { door: YARD_GATE, cell: JAIL_CELL.toLowerCase(), totalMs: 10 * MIN, servedMs: 0, by: 'Guard', at: wallClock, arrester: 0 });
check('...(the same sentence, its gate holding nobody, is the shared yard)', YARD_GATE === idOf('6c4ff:BSHeartland.esm') && globalThis.__dboJailSentence(GATED, LEAD).shared === true, globalThis.__dboJailSentence(GATED, LEAD));
put(YARD_GATE, 'private.dboCell', { prisoner: GATED, name: 'Gated', picked: false });
check('locked at the yard gate itself: not shared, and a Lead GM gets Release', globalThis.__dboJailSentence(GATED, LEAD).shared === false && globalThis.__dboJailSentence(GATED, LEAD).release === true, globalThis.__dboJailSentence(GATED, LEAD));
put(GATED, 'private.dboSentence', null); put(YARD_GATE, 'private.dboCell', null);
// a sentence whose door holds someone else: nobody gets Release there for them, and it is no shared yard
put(ELSE, 'private.dboSentence', { door: CELL_DOOR, cell: JAIL_CELL.toLowerCase(), totalMs: 10 * MIN, servedMs: 0, by: 'Guard', at: wallClock, arrester: 0 });
check('a door that holds someone else: no Release for a Lead GM or the guard, and not shared', globalThis.__dboJailSentence(ELSE, LEAD).release === false
  && globalThis.__dboJailSentence(ELSE, GUARD).release === false && globalThis.__dboJailSentence(ELSE, LEAD).shared === false, [globalThis.__dboJailSentence(ELSE, LEAD), props.get(CELL_DOOR + '|private.dboCell')]);
put(ELSE, 'private.dboSentence', null);
check('...anyone else: null', globalThis.__dboJailSentence(OTHER) === null && globalThis.__dboJailSentence(GUARD) === null);

// ---- serving time ----
tick(1);
check('the first tick after arriving counts nothing', sentence().servedMs === 0);
tick(12);
check('a minute in the cell counts a minute', sentence().servedMs === 60000, sentence().servedMs);
online = [GUARD, OTHER]; tick(24);
check('...logged out, the saved sentence still names the jail (an offline prisoner)', (globalThis.__dboJailSentence(PRISONER, GUARD) || {}).cell === 'Bruma Castle Dungeon');
online = [GUARD, PRISONER, OTHER];
check('two minutes logged out count nothing', sentence().servedMs === 60000, sentence().servedMs);
tick(1);
check('the first tick back counts nothing', sentence().servedMs === 60000, sentence().servedMs);
wallClock += 10 * MIN; timers.get('jail')();
check('a stall between ticks counts at most one tick', sentence().servedMs === 75000, sentence().servedMs);
at(PRISONER, TAMRIEL, [0, 0, 0]); tick(24); at(PRISONER, JAIL_CELL, [-100, 0, 0]);
check('time outside the jail counts nothing', sentence().servedMs === 75000, sentence().servedMs);
commands.get('sentence').fn(PRISONER, '');
check('/sentence says what is left', /14 minutes left of 15 minutes in Bruma Castle Dungeon, set by Guard/.test(said(PRISONER)), said(PRISONER));
tick(1 + 14 * 12 + 1);
check('served: the prisoner is told', /Your time is served/.test(said(PRISONER)), said(PRISONER));
check('...the sentence is gone', sentence() === null);
check('...and __dboJailSentence is null: a served sentence never blocks a staff /unstuck', globalThis.__dboJailSentence(PRISONER) === null);
check('...and the door is free', props.get(CELL_DOOR + '|private.dboCell') === null && act(CELL_DOOR, PRISONER) === false);
check('/unstuck is back outside the jail', (() => { at(PRISONER, PLAIN_CELL, [0, 0, 0]); const r = globalThis.__dboJailUnstuck(PRISONER); at(PRISONER, JAIL_CELL, [-100, 0, 0]); return r === null; })());

// ---- release early ----
act(CELL_DOOR, GUARD); ui('jailChoose', GUARD, ['who:15']); ui('jailChoose', GUARD, ['time:15:30']);
act(CELL_DOOR, GUARD); ui('jailChoose', GUARD, ['release']);
check('a guard can release early', sentence() === null && /releases you/.test(said(PRISONER)));
check('...and a released prisoner is no longer held (__dboJailSentence null)', globalThis.__dboJailSentence(PRISONER) === null);

// ---- the tumbler lock (lockpick.js) finishing after the cell changed hands ----
const begun = [];
globalThis.__dboLockpick = { busy: () => false, begin: (a, o) => { begun.push(o); return true; } };
const jailFor = (m) => { act(CELL_DOOR, GUARD); ui('jailChoose', GUARD, ['who:15']); ui('jailChoose', GUARD, [`time:15:${m}`]); };
jailFor(30);
at(OTHER, JAIL_CELL, [0, 100, 0]); wallClock += 4000;
check('a picker at an occupied door starts the tumbler lock', act(CELL_DOOR, OTHER) === true && begun.length === 1);
act(CELL_DOOR, GUARD); ui('jailChoose', GUARD, ['release']);
wallClock += 1000; jailFor(60);
if (begun[0]) begun[0].onSuccess(OTHER);
check('a lock begun on the last sentence does not open the next one', props.get(CELL_DOOR + '|private.dboCell').picked === false && /locked afresh/.test(said(OTHER)), [props.get(CELL_DOOR + '|private.dboCell'), said(OTHER)]);
wallClock += 4000; act(CELL_DOOR, OTHER);
act(CELL_DOOR, GUARD); ui('jailChoose', GUARD, ['extend']);
if (begun[1]) begun[1].onSuccess(OTHER);
check('...but one begun on this sentence does, an extension or not', props.get(CELL_DOOR + '|private.dboCell').picked === true && act(CELL_DOOR, PRISONER) === false);
act(CELL_DOOR, GUARD); ui('jailChoose', GUARD, ['release']);
wallClock += 4000; jailFor(5); act(CELL_DOOR, OTHER);
act(CELL_DOOR, GUARD); ui('jailChoose', GUARD, ['release']);
if (begun[2]) begun[2].onSuccess(OTHER);
check('a lock finished on a door released meanwhile leaves no record on it', props.get(CELL_DOOR + '|private.dboCell') === null, props.get(CELL_DOOR + '|private.dboCell'));
delete globalThis.__dboLockpick;
at(OTHER, PLAIN_CELL, [0, 0, 0]);

// ---- a login mid-sentence ----
act(CELL_DOOR, GUARD); ui('jailChoose', GUARD, ['who:15']); ui('jailChoose', GUARD, ['time:15:10']);
check('with nobody holding them, the guard at the door brought them in', sentence().arrester === GUARD, sentence().arrester);
globalThis.__dboJailLogin(PRISONER);
check('a login mid-sentence says what is left', /still have 10 minutes to serve/.test(said(PRISONER)), said(PRISONER));

// ---- /jail add and remove ----
const jail = commands.get('jail');
check('/jail is admin only', jail.opts && jail.opts.admin === true);
at(GUARD, TAMRIEL, [0, 0, 0]); jail.fn(GUARD, 'add');
check('an exterior cannot be a jail', /Only an interior/.test(said(GUARD)));
at(GUARD, PLAIN_CELL, [0, 0, 0]); jail.fn(GUARD, 'add');
check('/jail add designates an interior', /is now a jail zone/.test(said(GUARD)));
check('...kept in jails.json as the server wrote it', JSON.parse(fs.readFileSync('jails.json', 'utf8')).cells[0] === PLAIN_CELL);
check('...and it counts at once', /in a jail/.test(globalThis.__dboJailUnstuck(GUARD) || ''));
jail.fn(GUARD, 'remove');
check('/jail remove undoes it', globalThis.__dboJailUnstuck(GUARD) === null && JSON.parse(fs.readFileSync('jails.json', 'utf8')).cells.length === 0);
at(GUARD, JAIL_CELL, [100, 0, 0]); jail.fn(GUARD, 'remove');
check('a jail from the config cannot be removed in game', /comes from the load order or gamemode-config/.test(said(GUARD)));

process.chdir(os.tmpdir());
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
