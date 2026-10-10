// Scripted test for server\hostcooldown.js and its use by gamemode.js (hostAttemptHook, the hit handler) and
// npcdirector.js: a live host keeps an NPC for a few seconds after it changes hands or fights, and an NPC without a
// host, or whose host left or is out of reach, is never held. Run from this folder's parent:
//   node tests/hostcooldown-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };
const make = require(path.join(SERVER, 'hostcooldown.js'));

// ---- 1. the rule ----
let t = 1000;
const now = () => t;
const state = {};
let H = make({}, now, state);
const NPC = 0xff000100, A = 0xff000001, B = 0xff000002;
check('an NPC that never changed hands or fought is free to move', H.holds(NPC, B, A, true) === null);
H.noteHandover(NPC);
t += 4999;
check('just after a hand-over a live host keeps it', H.holds(NPC, B, A, true) === 'changed hands');
t += 1;
check('...for 5 s, not more', H.holds(NPC, B, A, true) === null);
H.noteFight(NPC);
t += 3000;
check('an NPC in a fight stays with its live host', H.holds(NPC, B, A, true) === 'in a fight');
check('an NPC without a host is never held', H.holds(NPC, B, 0, true) === null);
check('...nor one whose host can no longer drive it (left, out of reach, another world)', H.holds(NPC, B, A, false) === null);
check('the current host asking again is never held', H.holds(NPC, A, A, true) === null);
t += 2000;
check('the fight hold ends 5 s after the last blow', H.holds(NPC, B, A, true) === null);
H.noteFight(NPC);
H = make({}, now, state);
check('a hot reload keeps the timers (the caller keeps the state)', H.holds(NPC, B, A, true) === 'in a fight');
check('enabled: false holds nothing', make({ enabled: false }, now, state).holds(NPC, B, A, true) === null);
check('the windows come from config', make({ fightMs: 100000 }, now, state).config.fightMs === 100000);
// The live config (10 Oct): handoverMs 10 s, fightMs 30 s, no fightMaxMs. The ceiling ships off: a fight hit every second
// stays with its host however long it lasts and however near another player stands (Nate's minotaur, 9 Oct)
{
  const LIVE = { handoverMs: 10000, fightMs: 30000 };
  check('fightMaxMs is off by default', make(LIVE, now, {}).config.fightMaxMs === Infinity);
  const st = {}, F = 0xff000250, start = t;
  const h = make(LIVE, now, st);
  let kept = true;
  for (; t <= start + 60000; t += 1000) { h.noteFight(F); if (h.holds(F, B, A, true) !== 'in a fight') kept = false; }
  check('under the live config, a fight hit every second for 60 s stays with its host', kept);
  t += 28000;   // the last blow was at start + 60 s, t is one second past it
  check('...and 29 s after the last blow it is still held', h.holds(F, B, A, true) === 'in a fight');
  t += 1000;
  check('...and at 30 s (fightMs) it is free to move', h.holds(F, B, A, true) === null);
}
// With a ceiling set (not live), a fight renewed by every blow is held at most fightMaxMs from its first blow
const CAP = { fightMaxMs: 30000 };
{
  const st = {}, F = 0xff000200, start = t;
  const h = make(CAP, now, st);
  for (; t < start + 29000; t += 1000) h.noteFight(F);   // a blow every second, the last at start + 28 s
  h.noteFight(F);                                         // and one at start + 29 s
  check('a fight hit every second is held through its first 30 s', h.holds(F, B, A, true) === 'in a fight');
  t = start + 30000; h.noteFight(F);
  check('...and released at 30 s from the first blow, though blows keep landing', h.holds(F, B, A, true) === null);
  t += 6000;
  h.noteFight(F);
  check('a new fight after a quiet spell (fightMs without a blow) is held again', h.holds(F, B, A, true) === 'in a fight');
  check('the ceiling comes from config', make({ fightMaxMs: 60000 }, now, {}).config.fightMaxMs === 60000);
}
{
  // A hand-over during a fight starts the new host's 30 s: one host change per fightMaxMs, not one every handoverMs
  const st = {}, F = 0xff000300, start = t;
  const h = make(CAP, now, st);
  for (; t <= start + 30000; t += 1000) h.noteFight(F);
  t -= 1000;
  check('a 30 s fight is free to change hands', h.holds(F, B, A, true) === null);
  h.noteHandover(F);
  const handed = t;
  for (const end = t + 7000; t < end; t += 1000) h.noteFight(F);
  check('...and after the hand-over the new host keeps it past handoverMs while blows land', h.holds(F, A, B, true) === 'in a fight');
  for (const end = handed + 29000; t <= end; t += 1000) h.noteFight(F);
  t -= 1000;
  check('...through its own 30 s', h.holds(F, A, B, true) === 'in a fight');
  t = handed + 30000; h.noteFight(F);
  check('...and is released 30 s after the hand-over', h.holds(F, A, B, true) === null);
  h.noteHandover(0xff000301);
  check('a hand-over out of a fight starts no fight', !st.fightSince.has(0xff000301));
}
{
  // State from before fightSince (a hot reload onto a running fight) starts its 30 s at the next blow
  const F = 0xff000400, start = t;
  const st = { handedAt: new Map(), foughtAt: new Map([[F, t - 1000]]) };
  const h = make(CAP, now, st);
  h.noteFight(F);
  check('a fight already running at a hot reload gets a start at its next blow', st.fightSince.get(F) === start);
  for (; t < start + 29000; t += 1000) h.noteFight(F);
  check('...and is held its 30 s from there', h.holds(F, B, A, true) === 'in a fight');
  t = start + 30000; h.noteFight(F);
  check('...and released at 30 s', h.holds(F, B, A, true) === null);
}
{
  // fightSince is pruned with its fight: an entry goes once its NPC has had no blow for fightMs
  const st = {}, h = make(CAP, now, st);
  for (let i = 0; i < 4097; i++) h.noteFight(0xff100000 + i);
  t += 6000;
  h.noteFight(0xff200000);
  check('past 4096 fights, the starts of finished fights are dropped', st.fightSince.size === 1 && st.fightSince.has(0xff200000), st.fightSince.size);
}

// ---- 2. the director (npcdirector.js) asks it before it moves an NPC ----
const sets = [];
const hosts = new Map([[NPC, A]]);
const mp = { getHoster: (n) => hosts.get(n) || 0, setHoster: (n, p) => { sets.push([n, p]); hosts.set(n, p); }, get: (n, k) => (k === 'isDead' ? false : k === 'profileId' ? -1 : undefined) };
const handlers = {};
globalThis.__dboFormExists = () => true;
globalThis.__dboHostPolicy = (p) => ({ ok: true, dist: p === B ? 100 : 5000 });
const D = require(path.join(SERVER, 'npcdirector.js'))({ mp, log: () => {}, every: () => {}, onUi: (n, f) => { handlers[n] = f; }, onlineActors: () => [A, B], display: (x) => x.toString(16), profileOf: (x) => (x === A || x === B ? 1 : -1), cfg: {} });
handlers.npcSight(A, [[[NPC.toString(16), 5000]]]);
handlers.npcSight(B, [[[NPC.toString(16), 100]]]);
let held = true, noted = 0;
globalThis.__dboHostCooldown = { holds: () => (held ? 'in a fight' : null), noteHandover: () => { noted++; }, noteFight: () => {} };
D.decide(Date.now());
check('the director leaves a fighting NPC with its live host, though another player is much nearer', sets.length === 0, sets);
held = false;
D.decide(Date.now());
check('...and moves it once the hold is over, noting the hand-over', sets.length === 1 && sets[0][1] === B && noted === 1, { sets, noted });
delete globalThis.__dboHostCooldown; delete globalThis.__dboFormExists; delete globalThis.__dboHostPolicy;

// ---- 3. the gamemode wiring ----
const gm = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
const hook = gm.slice(gm.indexOf('const hostAttemptHook = '), gm.indexOf('hostAttemptHook.__dbo = true;'));
check('hostAttemptHook refuses a held hand-over after the policy',
  /const held = hostHold\(req, act\);\s*if \(held\) return false;/.test(hook) && hook.indexOf('hostPolicy(req, act)') < hook.indexOf('hostHold(req, act)'));
// 8 Oct (dungeon-perf-1008): the hand-over was stamped before C++ decided, so an ask C++ refused (the host moved it in
// the last 2 s) held the NPC with its old host 5 s more. The hook runs here, then C++ grants or not; the stamp must follow
// the grant (a microtask runs only once that native call is over). The hook is cut out of gamemode.js and run against a stub mp.
{
  const start = hook.indexOf('const hostAttemptHook = ');
  const body = hook.slice(start).replace('const hostAttemptHook = ', 'return ');
  const notes = [], timers = [];
  let hosterNow = A;
  const HC = { noteHandover: (n) => notes.push(n) };
  const fn = new Function('mp', 'HOST_COOLDOWN', 'hostPolicy', 'hostHold', 'globalThis', 'console', 'queueMicrotask', body)(
    { getHoster: () => hosterNow }, HC, () => ({ ok: true }), () => null, { __dboPrevHostAttempt: null }, { log: () => {} }, (f) => timers.push(f));
  check('a passed ask is answered true', fn(B, NPC) === true);
  timers.splice(0).forEach((f) => f());
  check('...and when C++ then keeps the NPC with its moving host, no hand-over is stamped', notes.length === 0, notes);
  fn(B, NPC); hosterNow = B;
  timers.splice(0).forEach((f) => f());
  check('...when C++ grants it, the hand-over is stamped for the new host', notes.length === 1 && notes[0] === NPC, notes);
}
check('the hold asks whether the current host can still drive the NPC by the same host policy',
  /const canDrive = !!current && hostPolicy\(current, act\)\.ok;/.test(gm) && /HOST_COOLDOWN\.holds\(act, req, current, canDrive\)/.test(gm));
check('every landed blow on or by an NPC starts its fight hold', /if \(profileOf\(agg\) < 0\) globalThis\.__dboHostCooldown\.noteFight\(agg\); if \(profileOf\(tgt\) < 0\) globalThis\.__dboHostCooldown\.noteFight\(tgt\);/.test(gm));
check('the state survives a hot reload and the switch is config hostCooldown', /globalThis\.__dboHostCooldownState \|\| \(globalThis\.__dboHostCooldownState = \{\}\)/.test(gm) && /cfg\.hostCooldown/.test(gm));
console.log(failures ? `${failures} FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
