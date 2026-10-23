// Beast Form is a Greater Power (Skyrim.esm 92c48, SPIT type 2), so the player's own game lets it be cast once a game day.
// A werewolf the server allows more changes (Great Hunt ranks up to 3 a day, a carried rest, Hircine's blessing) could
// change again only after a relog (Purr #7DJT, 17 Oct, "beast forms not usable until relogging"; 21 Oct 16:44, 16:59 and
// 17:10 each came seconds after a fresh join). After a werewolf's revert by choice or by time, the player is told how many
// changes the daily limit still allows and that /beast works; /beast is judged by the same limit (supernatural.js).
//   node tests/beast-change-again-harness.js   (from server/)
// BEAST_ROOT=<dir> loads beastform.js and supernatural.js from another folder (the check against the old code).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = process.env.BEAST_ROOT ? path.resolve(process.env.BEAST_ROOT) : path.resolve(__dirname, '..');
const CFG_ROOT = path.resolve(__dirname, '..');
const RUN = process.env.BEAST_RUN_DIR || path.join(CFG_ROOT, 'tests', '.run-beast-change-again');
fs.mkdirSync(RUN, { recursive: true });
process.chdir(RUN);
process.on('exit', () => { try { fs.rmSync(RUN, { recursive: true, force: true }); } catch (e) { /* left behind */ } });

let now = 1790000000000;
Date.now = () => now;
global.setTimeout = () => 0;
const WOLF = 0xff000001, LORD = 0xff000002, BLESSED = 0xff000003;
const props = new Map();
const said = [];
const mp = {
  get: (id, k) => (k === 'type' ? 'MpActor' : props.get(`${id}|${k}`)),
  set: (id, k, v) => props.set(`${id}|${k}`, v),
  getIdFromDesc: (d) => 0x100 + String(d).length,
  getDescFromId: (id) => id.toString(16),
  callPapyrusFunction: () => true,
  lookupEspmRecordById: () => null,
};
const noop = () => {};
let day = 20.1;
globalThis.__dboClock = { gameDays: () => day, summary: () => ({ timeScale: 6 }) };
// The Great Hunt: an Elder changes three times a game day
globalThis.__dboHuntChangesPerDay = () => 3;
globalThis.__dboBeastPowers = undefined;
// Changes by choice, as under the voluntaryWerewolf rollback (werewolf-form-rules-harness.js covers it off)
const cfg = JSON.parse(fs.readFileSync(path.join(CFG_ROOT, 'gamemode-config.json'), 'utf8'));
delete globalThis.__dboSuperState;
require(path.join(ROOT, 'supernatural.js'))({
  mp, log: noop, audit: noop, personal: noop, registerChatCommand: noop, onUi: noop, openWidget: noop, closeWidget: noop,
  sendPacket: noop, display: String, who: String, isAdmin: () => false, findByName: () => null, onlineActors: () => [], every: noop,
  profileOf: (a) => a, nameOf: String, isWorldspace: () => true, needsFeed: noop, hungerOf: () => 0, cfg: { supernatural: Object.assign({}, cfg.supernatural || {}, { voluntaryWerewolf: true }) },
});
require(path.join(ROOT, 'beastform.js'))({
  mp, log: noop, personal: (a, t) => said.push({ a, t }), registerChatCommand: noop, sendPacket: noop,
  display: String, who: String, audit: noop, findByName: () => null, every: noop, redress: noop, cfg: {}, isAdmin: () => false,
  onlineActors: () => [WOLF, LORD, BLESSED],
});

let pass = 0, fail = 0;
const ok = (c, what, detail) => { if (c) { pass++; console.log('ok  ', what); } else { fail++; console.log('FAIL', what, detail !== undefined ? JSON.stringify(detail) : ''); } };
for (const a of [WOLF, LORD, BLESSED]) props.set(`${a}|appearance`, { raceId: 0x13745, name: 'Purr' });
props.set(`${WOLF}|private.supernatural`, { kind: 'werewolf', stage: 0, blessed: false, beastDay: -1 });
props.set(`${BLESSED}|private.supernatural`, { kind: 'werewolf', stage: 0, blessed: true, beastDay: -1 });
props.set(`${LORD}|private.vampireLordGrant`, true);
const toldNow = (a, from) => said.slice(from).filter((x) => x.a === a).map((x) => x.t);
const uses = () => (props.get(`${WOLF}|private.supernatural`) || {}).beastDayUses;
const change = (a) => globalThis.__dboBeastTransform(a, 'werewolf');

// First change of the day, back by choice: two left, and the player hears about /beast
ok(change(WOLF) === true, 'an Elder takes the first change of the day');
let mark = said.length;
globalThis.__dboBeastRevert(WOLF, 'asked to revert');
let t = toldNow(WOLF, mark);
ok(t.some((x) => /2 more times today/.test(x) && /\/beast/.test(x)), 'back by choice with two changes left: told "2 more times today" and /beast', t);
ok(uses() === 1, 'telling spends no change (one used)', uses());

// Second change ends by time: one left
ok(change(WOLF) === true, 'the second change is allowed');
mark = said.length;
globalThis.__dboBeastRevert(WOLF, 'time up');
t = toldNow(WOLF, mark);
ok(t.some((x) => /1 more time today/.test(x) && /\/beast/.test(x)), 'the time runs out with one change left: told "1 more time today"', t);

// Third change: none left, nothing to tell
ok(change(WOLF) === true, 'the third change is allowed');
mark = said.length;
globalThis.__dboBeastRevert(WOLF, 'asked to revert');
t = toldNow(WOLF, mark);
ok(!t.some((x) => /\/beast/.test(x)), 'no change left: no /beast line', t);
ok(change(WOLF) === false, 'and a fourth change is refused by the daily limit');

// A death, a login or a logout says nothing
day = 21.1;
change(WOLF);
mark = said.length;
globalThis.__dboBeastRevert(WOLF, 'death');
ok(!toldNow(WOLF, mark).some((x) => /\/beast/.test(x)), 'a death in the form says nothing about /beast', toldNow(WOLF, mark));
change(WOLF);
mark = said.length;
globalThis.__dboBeastRevert(WOLF, 'logout');
ok(!toldNow(WOLF, mark).some((x) => /\/beast/.test(x)), 'a logout says nothing');

// Hircine's blessing: no daily limit
change(BLESSED);
mark = said.length;
globalThis.__dboBeastRevert(BLESSED, 'asked to revert');
t = toldNow(BLESSED, mark);
ok(t.some((x) => /whenever you call it/.test(x) && /\/beast/.test(x)), 'a blessed werewolf is told it comes whenever called', t);

// The Vampire Lord's power is a Lesser Power: nothing to tell
globalThis.__dboBeastTransform(LORD, 'vampirelord');
mark = said.length;
globalThis.__dboBeastRevert(LORD, 'revert power');
ok(!toldNow(LORD, mark).some((x) => /\/beast/.test(x)), 'a Vampire Lord revert says nothing');

// The read-only count
ok(typeof globalThis.__dboBeastChangesLeft === 'function', 'supernatural.js offers __dboBeastChangesLeft');
if (typeof globalThis.__dboBeastChangesLeft === 'function') {
  day = 22.5;
  ok(globalThis.__dboBeastChangesLeft(WOLF) === 3 && uses() !== undefined, 'a new day: three left again');
  ok(globalThis.__dboBeastChangesLeft(LORD) === null, 'no werewolf: null');
}

ok(!/—/.test(fs.readFileSync(path.join(ROOT, 'beastform.js'), 'utf8')), 'no em dash in beastform.js');
console.log(fail ? `\n${fail} FAILED` : `\nall ${pass} checks passed`);
process.exit(fail ? 1 : 0);
