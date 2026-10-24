// A carrier is told, on screen, that they caught the fever and that it was cured (#bugs, 23 Oct 2026: a player drank a
// Cure Disease potion, turned a day later, and reported the potion as broken; the log showed the cure took and a second
// bite 8 minutes after it, which the chat line alone never made clear). A catch within recentCureMinutes of a cure says
// so in as many words. Loads the real supernatural.js against a stub api.
// node tests/fever-told-harness.js   (from server/)
'use strict';
const path = require('path');
const store = new Map();
const said = [], packets = [];
const cmds = {}, timers = {};
let online = [];
const noop = () => {};
let now = Date.UTC(2026, 9, 23, 12, 0);
Date.now = () => now;
const GAME_DAY_MS = 4 * 3600000;
const clockStart = now;
globalThis.__dboClock = { gameDays: () => (now - clockStart) / GAME_DAY_MS, isNight: () => false, isFullMoon: () => false, weatherFor: () => 0 };
const mp = {
  get: (id, p) => store.get(`${id}|${p}`),
  set: (id, p, v) => { store.set(`${id}|${p}`, v); },
  getDescFromId: (id) => `${id.toString(16)}:x`, getIdFromDesc: () => 0x1234,
  callPapyrusFunction: () => null, lookupEspmRecordById: () => null, setRaceMenuOpen: noop,
};
const api = {
  mp, log: noop, audit: noop, personal: (a, t) => said.push([a, t]), system: (a, t) => said.push([a, t]),
  registerChatCommand: (n, f) => { cmds[n] = f; },
  onUi: noop, openWidget: noop, closeWidget: noop, sendPacket: (a, p) => packets.push([a, p]), display: String, who: String,
  isAdmin: () => true, findByName: (n) => (n === 'me' ? A : null), onlineActors: () => online, every: (n, ms, fn) => { timers[n] = fn; },
  profileOf: (a) => a, nameOf: String, isWorldspace: () => true, needsFeed: noop, hungerOf: () => 0, cfg: {},
};
const MODULE = path.resolve(__dirname, '..', 'supernatural.js');
require(MODULE)(api);

let fail = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fail++; };
const A = 7;
online = [A];
store.set(`${A}|isDead`, false);
const state = () => store.get(`${A}|private.supernatural`) || {};
const reset = () => { said.length = 0; packets.length = 0; };
const banners = () => packets.filter(([a, p]) => a === A && p.customPacketType === 'dboBanner').map(([, p]) => p.text);
const lines = () => said.filter(([a]) => a === A).map(([, t]) => t);

// ---- catching it is on screen, not only in chat ----
reset();
cmds.curse(A, 'me infectvampire');
ok(state().disease && state().disease.kind === 'vampire', 'the admin infect gives the vampire fever', state().disease);
ok(banners().some((t) => /feverish/.test(t)), 'catching the fever puts a banner on screen', banners());
ok(lines().some((t) => /feverish/.test(t)), '...and still says it in chat', lines());
ok(!banners().some((t) => /new infection/.test(t)), 'with no cure behind them, nothing is said about a cure', banners());

// ---- the cure is on screen too, and recorded ----
reset();
cmds.curse(A, 'me cure');
ok(!state().disease, 'the cure clears the fever');
ok(banners().some((t) => /fever breaks/i.test(t)), 'the cure puts a banner on screen', banners());
ok(Number(state().lastCure) === now, 'the cure is stamped on the character, to tell a second bite from a failed cure', state().lastCure);

// ---- caught again within the hour: said plainly ----
reset();
now += 8 * 60000;                       // the 8 minutes of the real report
cmds.curse(A, 'me infectvampire');
ok(banners().some((t) => /cure held/i.test(t) && /new infection/i.test(t)), 'caught 8 minutes after a cure: the player is told the cure held and this is a new one', banners());

// ---- and an hour later it is just a catch ----
cmds.curse(A, 'me cure');
reset();
now += 61 * 60000;
cmds.curse(A, 'me infectwerewolf');
ok(state().disease && state().disease.kind === 'werewolf', 'the hunt fever takes hold an hour later');
ok(banners().some((t) => /hunt/.test(t)), '...and is announced', banners());
ok(!banners().some((t) => /new infection/i.test(t)), '...with no mention of a cure, an hour being long enough to have forgotten', banners());

// ---- the cure still says what broke it ----
reset();
cmds.curse(A, 'me cure');
ok(banners().length === 1 && /fever breaks/i.test(banners()[0]), 'one banner per cure, naming the break', banners());

console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
