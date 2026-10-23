// FULL MOON GUARANTEE (Nate, 23 Oct): every cursed werewolf online changes once each full moon, indoors or out, with the
// warning first; Alphas and Hircine's blessed are spared, the login grace holds, fullMoonGuaranteed false turns it off.
// Built on feral-warning-harness's stubs. Original header: a forced werewolf change is felt coming (Nate, 5 Oct; #bugs 1556456325079244860): feralWarn.seconds before the
// change the player is told and the screen shakes (dboShake packets, harder each time), and the change happens only if
// they still can change then. Loads the real supernatural.js against a stub api and drives its timers by hand.
// An appearance editor neither holds nor skips a forced change (8 Oct): the change comes as it always did, and only
// /appearance waits while one is coming (real appearance.js at the end). A hold tried on 8 Oct let an /appearance opened
// just before the roll and closed unchanged, free and with no cooldown, skip every change.
// node tests/feral-warning-harness.js   (from server/)
'use strict';
const path = require('path');
const store = new Map();
const said = [], packets = [], logs = [], changes = [];
const cmds = {}, timers = {};
let online = [];
const noop = () => {};
let now = Date.UTC(2026, 9, 5, 3, 0);
Date.now = () => now;
// Timers queued by due time and run by hand
let queue = [];
const realSetTimeout = setTimeout;
globalThis.setTimeout = (fn, ms) => { queue.push({ at: now + (Number(ms) || 0), fn }); return queue.length; };
const advance = (ms) => { const end = now + ms; for (;;) { queue.sort((x, y) => x.at - y.at); const n = queue[0]; if (!n || n.at > end) break; queue.shift(); now = n.at; n.fn(); } now = end; };
let days = 0.95; // night (22:48) of day 0, a full moon (phase 0)
globalThis.__dboClock = { gameDays: () => days, isNight: () => { const h = (days % 1) * 24; return h >= 20 || h < 6; }, isFullMoon: () => (Math.floor(days / 3) % 8) === 0, weatherFor: () => 0 };
const mp = {
  get: (id, p) => store.get(`${id}|${p}`),
  set: (id, p, v) => { store.set(`${id}|${p}`, v); },
  getDescFromId: (id) => `${id.toString(16)}:x`, getIdFromDesc: () => 0x1234,
  callPapyrusFunction: () => null, lookupEspmRecordById: () => null, setRaceMenuOpen: () => {},
};
const api = {
  mp, log: (...x) => logs.push(x.join(' ')), audit: noop, personal: (a, t) => said.push([a, t]), system: (a, t) => said.push([a, t]), registerChatCommand: (n, f) => { cmds[n] = f; },
  onUi: noop, openWidget: noop, closeWidget: noop, sendPacket: (a, p) => packets.push([a, p]), display: String, who: String,
  isAdmin: () => true, findByName: () => null, onlineActors: () => online, every: (n, ms, fn) => { timers[n] = fn; }, profileOf: (a) => a,
  nameOf: String, isWorldspace: () => false, needsFeed: noop, hungerOf: () => 100, cfg: {},
};
globalThis.__dboBeastTransform = (a, key, forced) => { changes.push([a, key, forced]); store.set(`${a}|private.beast`, { form: key }); return true; };
const MODULE = path.resolve(__dirname, '..', 'supernatural.js');
const load = (cfg) => { api.cfg = cfg || {}; delete require.cache[MODULE]; require(MODULE)(api); };
// The 12 s schedule these checks were written for (the default is 45 s since 6 Oct, Jake): passed in, so they test the mechanics
const W = { seconds: 12, shakes: [{ at: 12, strength: 0.25, seconds: 2 }] };
load({ supernatural: { feralWarn: W } });

let fail = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fail++; };
const A = 7;
const reset = () => { said.length = 0; packets.length = 0; changes.length = 0; queue = []; store.delete(`${A}|private.beast`); globalThis.__dboFeralDue && globalThis.__dboFeralDue.clear(); };
store.set(`${A}|private.supernatural`, { kind: 'werewolf', disease: null, stage: 0, blessed: false });
store.set(`${A}|isDead`, false);
online = [A];
Math.random = () => 0.99;   // the hourly chance never fires: only the guarantee can
const hour = () => { days += 1 / 24; timers.superMoon(); };

reset(); timers.superMoon();
ok(changes.length === 0 && said.some(([a, t]) => a === A && /tonight it will not be denied/.test(t)), 'full moon night, indoors: the warning comes first', said);
advance(13000);
ok(changes.length === 1 && changes[0][1] === 'werewolf' && changes[0][2] === true, 'then the change, forced', changes);
store.delete(`${A}|private.beast`); reset(); hour(); advance(13000);
ok(changes.length === 0, 'once each full moon: the next hour of the same moon does not take them again');
days = 24.95; reset(); timers.superMoon(); advance(13000);
ok(changes.length === 1, 'the next full moon takes them again');
store.delete(`${A}|private.beast`);
days = 6.95; reset(); timers.superMoon(); advance(13000);
ok(changes.length === 0, 'no full moon: no guaranteed change');
days = 48.95;
store.set(`${A}|private.supernatural`, { kind: 'werewolf', disease: null, stage: 0, blessed: true });
reset(); timers.superMoon(); advance(13000);
ok(changes.length === 0, "Hircine's blessed are spared");
store.set(`${A}|private.supernatural`, { kind: 'werewolf', disease: null, stage: 0, blessed: false });
globalThis.__dboSuperLoginAt.set(A, now);
reset(); hour(); advance(13000);
ok(changes.length === 0, 'the login grace holds');
globalThis.__dboSuperLoginAt.delete(A);
reset(); hour(); advance(13000);
ok(changes.length === 1, '...and once it is over, the moon takes them');
store.delete(`${A}|private.beast`);
load({ supernatural: { feralWarn: W, fullMoonGuaranteed: false } });
days = 72.95; reset(); timers.superMoon(); advance(13000);
ok(changes.length === 0, 'fullMoonGuaranteed false: only the hourly chance (outdoors) remains');
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
