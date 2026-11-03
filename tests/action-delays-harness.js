// server\actiondelays.js against a stub mp: the search beat on a container's activation, the body beat on a first take,
// the gap between takes, the exemptions, and that a refused take resyncs while a refused activation does not (nothing
// moved). Mutants at the end must each break a check, so the checks are known to be load-bearing.
//   node tests/action-delays-harness.js   (from server/; TMPDIR=/dev/shm/... on CT115)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'actiondelays.js');

let clock = Date.parse('2026-11-02T12:00:00Z');
Date.now = () => clock;
const SEC = 1000;

const CHEST = 0x300, CHEST2 = 0x301, DOOR = 0x400, BODY = 0xff000050, HOMECHEST = 0x302, KEYCHEST = 0x303;
const PLAYER = 0xff000001, OTHER = 0xff000002, NPC = 0xff000003;
const PROFILE = { [PLAYER]: 7, [OTHER]: 9 };          // NPC has none
const BASES = { [CHEST]: 'c0:Skyrim.esm', [CHEST2]: 'c1:Skyrim.esm', [DOOR]: 'd0:Skyrim.esm', [HOMECHEST]: 'c2:Skyrim.esm', [KEYCHEST]: 'c3:Skyrim.esm' };  // verify-formids: ignore (made-up base descs: this harness never touches the load order)
const TYPES = { 'c0:Skyrim.esm': 'CONT', 'c1:Skyrim.esm': 'CONT', 'c2:Skyrim.esm': 'CONT', 'c3:Skyrim.esm': 'CONT', 'd0:Skyrim.esm': 'DOOR' };  // verify-formids: ignore (made-up base descs: this harness never touches the load order)

let throwOnActivate = false;
let fails = 0;
const ok = (cond, what, got) => {
  if (cond) { console.log(`ok    ${what}`); return; }
  fails++;
  console.log(`FAIL  ${what}${got === undefined ? '' : `   ${JSON.stringify(got)}`}`);
};

// setTimeout is taken over so the bar's completion can be fired on demand: with the real one the timer
// lands long after this process has exited, which is why the first version of these checks proved nothing.
const pending = [];
global.setTimeout = (fn, ms) => { const h = { fn, ms, dead: false }; pending.push(h); return h; };
global.clearTimeout = (h) => { if (h) h.dead = true; };
const fireTimers = () => { const due = pending.splice(0); let n = 0; for (const h of due) if (!h.dead) { n++; h.fn(); } return n; };
const papyrus = [];
const props = new Map();
const setp = (id, k, v) => props.set(`${id >>> 0}|${k}`, v);
const said = [], widgets = [], closed = [], resyncs = [], logs = [];
// Every focus argument openWidget was ever given. Kept apart from widgets, which scenarios clear.
const focusAsked = [];
const mp = {
  get: (id, k) => {
    if (k === 'baseDesc') return BASES[id >>> 0];
    if (k === 'profileId') return PROFILE[id >>> 0];
    return props.get(`${id >>> 0}|${k}`);
  },
  set: setp,
  getIdFromDesc: (d) => { const [h] = String(d).split(':'); return parseInt(h, 16) >>> 0; },
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:x`,
  callPapyrusFunction: (...x) => { papyrus.push(x); if (throwOnActivate && x[2] === 'Activate') throw new Error('out of range'); return null; },
  lookupEspmRecordById: (id) => {
    const desc = Object.keys(TYPES).find((d) => mp.getIdFromDesc(d) === (id >>> 0));
    return desc ? { record: { type: TYPES[desc] } } : null;
  },
};
setp(HOMECHEST, 'private.housing', { owner: 7, ownerName: 'Olaf' });
setp(KEYCHEST, 'private.housing', { owner: 99, keys: [7] });
// Nat, 3 Nov: the beat is for dungeon containers and for theft only. CHEST and CHEST2 stand in a
// dungeon cell so every beat assertion below still exercises the beat. The cell is written padded
// while the Set holds the normalised form, so the key normalisation is under test too.
// A real dungeon cell (Abandoned Prison, from dungeons.json) rather than an invented id: the pre-commit
// hook checks every form id in a committed file against the load order, and it was right to.
const DUNGEON_CELL = '21594:Skyrim.esm';
globalThis.__dboDungeonCells = new Set([DUNGEON_CELL.toLowerCase()]);   // as dungeons.js's normDesc keys it
// Padded and mixed-case on purpose, built by concatenation: the normalisation is under test, and getting
// it wrong would make the beat vanish in dungeons with nothing to show it had.
setp(CHEST, 'worldOrCellDesc', '000' + DUNGEON_CELL);
setp(CHEST2, 'worldOrCellDesc', DUNGEON_CELL);

const api = {
  mp,
  log: (...a) => logs.push(a.join(' ')),
  personal: (a, t) => said.push({ a, t }),
  cfg: {},
  profileOf: (a) => (PROFILE[a >>> 0] === undefined ? -1 : PROFILE[a >>> 0]),
  openWidget: (a, payload, focus) => { focusAsked.push(focus); return widgets.push({ a, payload, focus }); },
  closeWidget: (a, id) => closed.push({ a, id }),
};
globalThis.__dboItemResync = (a) => resyncs.push(a >>> 0);

const load = (cfg, src) => {
  delete globalThis.__dboActionDelayState;
  let file = MODULE;
  if (src) { file = path.join(scratch, `m-${Math.random().toString(16).slice(2)}.js`); fs.writeFileSync(file, src); }
  delete require.cache[file];
  return require(file)(Object.assign({}, api, { cfg: cfg || {} }))._test;
};
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-actiondelays-'));
let T = load({});
const last = () => (said.length ? said[said.length - 1].t : '');

// ---- defaults --------------------------------------------------------------------------------------------------------
ok(T.C.enabled === true && T.C.searchSeconds === 2 && T.C.bodySeconds === 3 && T.C.takeSeconds === 0.4 && T.C.graceSeconds === 30,
  'defaults: on, search 2 s, body 3 s, take 0.4 s, grace 30 s', T.C);

// ---- the search beat on a container ----------------------------------------------------------------------------------
ok(T.searchGate(CHEST, PLAYER) === false, 'a stranger\'s chest: the first activation is refused');
ok(/search it/i.test(last()), '...and the player is told to give it a moment', last());
ok(widgets.length === 1 && widgets[0].payload.type === 'progress' && widgets[0].payload.id === 170 && widgets[0].payload.ms === 2000,
  '...with a progress widget, id 170, 2000 ms', widgets[0] && widgets[0].payload);
ok(resyncs.length === 0, 'a refused activation does NOT resync: nothing moved');
clock += 1.9 * SEC;
ok(T.searchGate(CHEST, PLAYER) === false, 'still refused just short of the beat');
clock += 0.2 * SEC;
ok(T.searchGate(CHEST, PLAYER) === undefined, 'the beat done: the activation stands');
ok(closed.some((c) => c.id === 170), '...and the widget is closed', closed);
ok(T.searchGate(CHEST, PLAYER) === undefined, 'inside the grace: it opens again at once, no second beat');
clock += 31 * SEC;
ok(T.searchGate(CHEST, PLAYER) === false, 'past the grace: a fresh beat');
clock += 2 * SEC;
ok(T.searchGate(CHEST, PLAYER) === undefined, '...which completes as before');

// each container is its own beat
ok(T.searchGate(CHEST2, PLAYER) === false, 'a second chest has its own beat');

// ---- who and what is exempt ------------------------------------------------------------------------------------------
ok(T.searchGate(DOOR, PLAYER) === undefined, 'a door is not a container: no opinion');
ok(T.searchGate(CHEST, NPC) === undefined, 'an NPC with no profile: no opinion');
ok(T.searchGate(HOMECHEST, PLAYER) === undefined, 'your own home chest is exempt (private.housing owner)');
ok(T.searchGate(KEYCHEST, PLAYER) === undefined, 'a chest in a property you hold a key to is exempt');
// Nat, 3 Nov: dungeons only, so a stranger's home is instant for them too until theft is turned on
ok(T.searchGate(HOMECHEST, OTHER) === undefined, '...and with theft off it is instant for a stranger as well');
ok(load({ actionDelays: { theft: true } }).searchGate(HOMECHEST, OTHER) === false,
  '...but with theft true a stranger pays the beat on it');

// ---- the take beat ---------------------------------------------------------------------------------------------------
T = load({});
widgets.length = 0; closed.length = 0; resyncs.length = 0; said.length = 0;
ok(T.takeGate(BODY, PLAYER) === false, 'a body, first take: refused while it is searched');
ok(resyncs.length === 1 && resyncs[0] === PLAYER, '...and refusing a take resyncs the player', resyncs);
ok(widgets.length === 1 && widgets[0].payload.ms === 3000, '...with a 3000 ms bar (bodySeconds)', widgets[0] && widgets[0].payload);
clock += 2.9 * SEC;
ok(T.takeGate(BODY, PLAYER) === false, 'still refused just short of the body beat');
clock += 0.2 * SEC;
ok(T.takeGate(BODY, PLAYER) === undefined, 'the body beat done: the take stands');
const beforeGap = resyncs.length;
ok(T.takeGate(BODY, PLAYER) === false, 'the very next take is refused: takeSeconds apart');
ok(resyncs.length > beforeGap, '...and that refusal resyncs too, not only the first one', resyncs.length - beforeGap);
clock += 0.5 * SEC;
ok(T.takeGate(BODY, PLAYER) === undefined, '...and allowed once the gap has passed');

// a container that paid on its activation does not pay the body beat again
T = load({});
resyncs.length = 0;
ok(T.searchGate(CHEST, PLAYER) === false && (clock += 2 * SEC) && T.searchGate(CHEST, PLAYER) === undefined, 'search a chest through to the end');
ok(T.takeGate(CHEST, PLAYER) === false, 'the first take right after opening still waits the take gap');
clock += 0.5 * SEC;
ok(T.takeGate(CHEST, PLAYER) === undefined, '...then it is allowed, with no second 3 s body beat');
ok(T.takeGate(HOMECHEST, PLAYER) === undefined && T.takeGate(HOMECHEST, PLAYER) === undefined,
  'your own home chest: takes are never delayed');

// ---- the off switch and the message rate limit -----------------------------------------------------------------------
T = load({ actionDelays: { enabled: false } });
ok(T.searchGate(CHEST, PLAYER) === undefined && T.takeGate(BODY, PLAYER) === undefined, 'enabled false: nothing is delayed');
T = load({ actionDelays: { searchSeconds: 0 } });
ok(T.searchGate(CHEST, PLAYER) === undefined, 'searchSeconds 0: containers open at once');
T = load({ actionDelays: { bodySeconds: 0, takeSeconds: 0 } });
ok(T.takeGate(BODY, PLAYER) === undefined && T.takeGate(BODY, PLAYER) === undefined, 'bodySeconds and takeSeconds 0: takes are free');

T = load({ actionDelays: { tellSeconds: 10 } });
said.length = 0;
T.takeGate(BODY, PLAYER); T.takeGate(BODY, PLAYER); T.takeGate(BODY, PLAYER);
ok(said.length === 1, 'the player is told once per tellSeconds, not once per refusal', said.length);

// Each kind keeps its own rate limit. With one shared bucket a body line swallowed the next container line, and
// until the bar ships that line is the only sign a chest was refused rather than silently broken.
said.length = 0;
T = load({ actionDelays: { tellSeconds: 10 } });
T.takeGate(BODY, PLAYER);
T.searchGate(CHEST, PLAYER);
ok(said.length === 2 && /still searching/.test(said[0].t) && /search it/.test(said[1].t),
  'a body refusal does not swallow the container line inside the same window', said.map((x) => x.t));

// ---- a hot reload keeps a beat in flight -----------------------------------------------------------------------------
T = load({});
T.searchGate(CHEST, PLAYER);
const kept = globalThis.__dboActionDelayState;
delete require.cache[MODULE];
const T2 = require(MODULE)(Object.assign({}, api, { cfg: {} }))._test;
ok(T2.S === kept, 'a hot reload reuses the state, so a beat in flight is not restarted', T2.S === kept);
clock += 2 * SEC;
ok(T2.searchGate(CHEST, PLAYER) === undefined, '...and the beat finishes across the reload');

// ---- the bar opens it when it fills (Nat on dev: "the bar loads fully but doesn't open the container") -------------
T = load({});
papyrus.length = 0; pending.length = 0; closed.length = 0;
ok(T.searchGate(CHEST, PLAYER) === false, 'the first activation still starts the beat');
ok(pending.length === 1 && pending[0].ms >= 2000, '...and arms a timer for the beat', pending.map((p) => p.ms));
ok(/opens in a moment/.test(last()), '...and the wording promises it will open', last());
clock += 2.1 * SEC;
ok(fireTimers() === 1, 'the timer fires when the bar fills');
const act = papyrus.find((c) => c[2] === 'Activate');
ok(!!act && act[1] === 'ObjectReference', '...calling ObjectReference.Activate', act);
ok(!!act && act[3].desc === `${CHEST.toString(16)}:x`, '...on the container', act && act[3]);
ok(!!act && act[4][0].desc === `${PLAYER.toString(16)}:x` && act[4][1] === false,
  '...with the player as the activator and default processing off', act && act[4]);
ok(closed.some((x) => x.id === 170), '...and the bar is taken down', closed);
ok(T.searchGate(CHEST, PLAYER) === false, 'their own click just after is swallowed, so it does not close the window');
clock += 1 * SEC;
ok(T.searchGate(CHEST, PLAYER) === undefined, '...and past the guard it opens as usual (the grace)');

// a click that beats the timer cancels it, so it cannot fire into an already open container
T = load({}); papyrus.length = 0; pending.length = 0;
T.searchGate(CHEST2, PLAYER);
clock += 2.1 * SEC;
ok(T.searchGate(CHEST2, PLAYER) === undefined, 'a click after the beat opens it by hand');
ok(fireTimers() === 0, '...and the armed timer is cancelled, not left to fire', pending.length);

// autoOpen false: the old two-click behaviour, said plainly
T = load({ actionDelays: { autoOpen: false } }); papyrus.length = 0; pending.length = 0; said.length = 0;
T.searchGate(CHEST, PLAYER);
ok(/open it again/.test(last()), 'autoOpen false says to open it again', last());
clock += 2.1 * SEC; fireTimers();
ok(!papyrus.some((c) => c[2] === 'Activate'), '...and nothing is opened for them', papyrus);
ok(/open it again/i.test(last()), '...they are told it is searched', last());

// if the activation throws (out of range, logged out) they are told, not left staring at a full bar
T = load({}); papyrus.length = 0; pending.length = 0; said.length = 0; throwOnActivate = true;
T.searchGate(CHEST, PLAYER);
clock += 2.1 * SEC; fireTimers();
ok(/open it again/i.test(last()), 'an activation that throws falls back to telling them to open it', last());
throwOnActivate = false;

// ---- mutants ---------------------------------------------------------------------------------------------------------
// Each must break at least one check. A mutation that no longer applies means the code moved: that is reported, not passed.
const SRC = fs.readFileSync(MODULE, 'utf8');
const MUTANTS = [
  ['the first activation is allowed (no search beat at all)', (s) => s.replace('      S.beat.set(key, now);', '      return undefined;')],
  ['the beat is never waited out (any activation opens it)', (s) => s.replace('if (now - started < ms) return false;', 'if (false) return false;')],
  ['a body\'s first take is free', (s) => s.replace('if (now - started < ms) { resync(a); return false; }', 'if (false) { resync(a); return false; }')],
  ['the gap between takes is dropped', (s) => s.replace('if (now < next) {', 'if (false) {')],
  ['a refused take does not resync', (s) => s.replace(/      resync\(a\);\n      return false;/, '      return false;')],
  ['every container counts as your own home (the exemption swallows everything)', (s) => s.replace('const ownHome = (ref, a) => {', 'const ownHome = (ref, a) => { if (true) return true;')],
  ['nothing is your own home (the exemption is lost)', (s) => s.replace('const ownHome = (ref, a) => {', 'const ownHome = (ref, a) => { if (true) return false;')],
  ['doors are delayed too (the CONT check is dropped)', (s) => s.replace("if (recordType(t) !== 'CONT') return undefined;", '')],
  ['the bar never opens it (no timer armed)', (s) => s.replace('      S.timers.set(key, setTimeout(', '      ((x) => x)(setTimeout(')],
  ['the reopen guard is gone, so their own click shuts the window again', (s) => s.replace('if (now - (S.opened.get(key) || 0) < Math.max(0, Number(C.reopenGuardMs) || 0)) return false;', '')],
  ['done is set AFTER the open, so the gate refuses its own activation', (s) => {
    const at = s.indexOf('const searched = ()');
    const tgt = 'S.done.set(key, now);';
    const j = at < 0 ? -1 : s.lastIndexOf(tgt, at);
    return j < 0 ? s : s.slice(0, j) + s.slice(j + tgt.length);
  }],
  ['the grace is ignored, so a chest re-beats every time', (s) => s.replace('if (now - (S.done.get(key) || 0) < MS(C.graceSeconds)) return undefined;', '')],
];
// The first version of this battery let three mutants through, all for one reason: it only drove the "fresh beat" and
// "beat finished" paths and never the "still waiting" one, which is where the refusals and their resyncs actually live.
// Every beat is now driven a second time with the clock standing still.
const battery = (M) => {
  const out = [];
  clock += 120 * SEC;
  const w0 = widgets.length;
  out.push(M.searchGate(CHEST, PLAYER) === false);                       // a fresh beat refuses
  out.push(M.searchGate(CHEST, PLAYER) === false);                       // and so does one mid-beat, clock unmoved
  out.push(widgets.length > w0);                                          // a bar was shown
  out.push(M.searchGate(DOOR, PLAYER) === undefined);                    // a door is never delayed
  out.push(M.searchGate(HOMECHEST, PLAYER) === undefined);               // own home exempt
  out.push(M.searchGate(HOMECHEST, OTHER) === false);                    // but not for others
  // the bar must open it, and the open must not be refused by our own re-entrant gate
  const p0 = papyrus.length;
  clock += 2.1 * SEC;
  fireTimers();
  const opened = papyrus.slice(p0).filter((c) => c[2] === 'Activate');
  out.push(opened.length === 1);                                         // exactly one activation
  out.push(!!opened[0] && opened[0][3].desc === `${CHEST.toString(16)}:x`
    && opened[0][4][0].desc === `${PLAYER.toString(16)}:x`);             // the container, by the player
  out.push(M.searchGate(CHEST, PLAYER) === false);                       // their own click is swallowed
  clock += 1 * SEC;
  out.push(M.searchGate(CHEST, PLAYER) === undefined);                   // and the grace holds after
  let r = resyncs.length;
  out.push(M.takeGate(BODY, PLAYER) === false);                          // a body's first take waits
  out.push(resyncs.length > r);                                           // and resyncs
  r = resyncs.length;
  out.push(M.takeGate(BODY, PLAYER) === false);                          // mid-beat it waits too
  out.push(resyncs.length > r);                                           // and that refusal resyncs as well
  clock += 3.1 * SEC;
  out.push(M.takeGate(BODY, PLAYER) === undefined);                      // then stands
  r = resyncs.length;
  out.push(M.takeGate(BODY, PLAYER) === false);                          // the next waits the gap
  out.push(resyncs.length > r);                                           // and the gap refusal resyncs
  out.push(M.takeGate(HOMECHEST, PLAYER) === undefined);                 // home takes are free
  return out;
};
console.log('');
for (const [what, mutate] of MUTANTS) {
  const src = mutate(SRC);
  if (src === SRC) { fails++; console.log(`FAIL  mutant no longer applies (the code moved): ${what}`); continue; }
  let caught = false;
  try { caught = battery(load({}, src)).some((r) => !r); } catch (e) { caught = true; }
  ok(caught, `mutant caught: ${what}`);
}
load({});

// A progress bar is a picture, so it must never take the keyboard: a focused panel with no front build
// behind it holds the keys and the player cannot move. That froze Nat on dev, 2 Nov. The stub used to
// drop openWidget's third argument, which is why no harness could catch it.
ok(focusAsked.length > 0 && focusAsked.every((f) => f !== true),
  'the search bar never asks for keyboard focus', JSON.stringify(focusAsked));

try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* leave it */ }

// ---- which containers the beat applies to at all (Nat, 3 Nov) --------------------------------------------------------
// Without the predicate every one of these returns a beat, so this block fails on the old module.
ok(T.inDungeon(CHEST) === true, 'the dungeon cell key normalises: padded hex and case both match the Set');
ok(T.delayApplies(CHEST, PLAYER) === 'dungeon', 'a container in a dungeon: the beat applies');
ok(T.delayApplies(HOMECHEST, PLAYER) === '', 'the player\'s own claimed home: no beat, it opens at once');
ok(T.delayApplies(KEYCHEST, PLAYER) === '', '...and one they hold a key to: no beat');

const saveHome = { owner: 7, ownerName: 'Olaf' };
mp.set(HOMECHEST, 'private.housing', { owner: 99, ownerName: 'Someone else' });
// Nat, 3 Nov: dungeons only for now, so theft is off by default and even a stranger's home is instant
ok(T.delayApplies(HOMECHEST, PLAYER) === '', 'a home they have no right to: instant, because theft is off by default');
const Tth = load({ actionDelays: { theft: true } });
ok(Tth.delayApplies(HOMECHEST, PLAYER) === 'theft', '...but with theft true it is a beat again');
mp.set(HOMECHEST, 'private.housing', saveHome);
ok(Tth.delayApplies(HOMECHEST, PLAYER) === '', '...and still instant once it is theirs');

mp.set(CHEST, 'worldOrCellDesc', '');
ok(T.delayApplies(CHEST, PLAYER) === '', 'an unowned chest outside a dungeon: no beat at all');
ok(T.searchGate(CHEST, PLAYER) === undefined, '...and searchGate lets its activation stand, first click');
mp.set(CHEST, 'worldOrCellDesc', '000' + DUNGEON_CELL);

// load() takes the WHOLE cfg, and the module reads cfg.actionDelays - a bare key is ignored
const Tall = load({ actionDelays: { onlyDungeonsAndTheft: false } });
Tall.S.beat.clear(); Tall.S.done.clear(); Tall.S.opened.clear();
mp.set(CHEST, 'worldOrCellDesc', '');
ok(Tall.delayApplies(CHEST, PLAYER) === 'all', 'onlyDungeonsAndTheft false: every container is delayed again');
mp.set(CHEST, 'worldOrCellDesc', '000' + DUNGEON_CELL);


// ---- Aldemar's barrel: take-all from a container he may use (live bug, 3 Nov) -----------------------------------------
// takeSeconds refused every take after the first, so take-all answered "your hands are full" and put the
// whole lot back. Without the CONT scope in takeGate, this block fails.
const ownKey = `${PLAYER}:${CHEST}`;
mp.set(CHEST, 'worldOrCellDesc', '');                  // his own barrel: no dungeon, no claim
T.S.done.set(ownKey, clock);                           // already searched, so this is the gap branch
T.S.nextTake.set(PLAYER, clock + 5 * SEC);             // and a gap is pending
ok(T.takeGate(CHEST, PLAYER) === undefined, 'take-all from a container he may use: never throttled');
ok(T.takeGate(CHEST, PLAYER) === undefined, '...every item of it, not just the first');
mp.set(CHEST, 'worldOrCellDesc', '000' + DUNGEON_CELL);
T.S.done.set(ownKey, clock);
T.S.nextTake.set(PLAYER, clock + 5 * SEC);
ok(T.takeGate(CHEST, PLAYER) === false, '...but a dungeon container still waits takeSeconds');

// ---- the first take from an ordinary chest, with nothing searched (live bug, 3 Nov) -----------------------------------
// The block above sets S.done itself, which is the one precondition live never has: the search does not run
// for these containers, so S.done is empty and the take lands in the body-beat branch. That branch refused
// it, and the refusal resyncs the pack, which closes the container. Without the exemption above the body
// beat, both assertions here fail.
T.S.beat.clear(); T.S.done.clear(); T.S.nextTake.clear();
mp.set(CHEST, 'worldOrCellDesc', '');                  // an ordinary chest: no dungeon, no claim
ok(T.takeGate(CHEST, PLAYER) === undefined, 'an ordinary chest, never searched: the first take stands');
ok(T.takeGate(CHEST, PLAYER) === undefined, '...and so does the next, with no beat left behind');
ok(T.S.beat.size === 0, '...and no beat was started for it at all');
mp.set(CHEST, 'worldOrCellDesc', '000' + DUNGEON_CELL);
T.S.beat.clear(); T.S.done.clear(); T.S.nextTake.clear();
ok(T.takeGate(CHEST, PLAYER) === false, 'a dungeon chest opened without a search still pays the body beat');
T.S.beat.clear(); T.S.done.clear(); T.S.nextTake.clear();
ok(T.takeGate(BODY, PLAYER) === false, '...and a corpse pays it wherever it lies');
T.S.beat.clear(); T.S.done.clear(); T.S.nextTake.clear();

// ---- NPC-owned chests: the owner comes from the load order (START-HERE open item 7, 3 Nov) -----------------------------
// Before this a chest nobody had claimed was always "unowned", so with theft on an NPC's chest opened at once and its
// first take stood. The server reads XOWN off the winning REFR, else off its interior CELL (lookupEspmRecordById), so
// the stub gives refs and cells raw fields the way the native addon does: { type, data: Uint8Array } plus
// toGlobalRecordId. Every id here is made up and plugin-free (':x'), so the load order never sees them.
const NPCCHEST = 0x310, CELLCHEST = 0x311, PLAYERCHEST = 0x312, PFCHEST = 0x313, PLAINCHEST = 0x314, EXTCHEST = 0x315,
  PLACECHEST = 0x316, HALLCHEST = 0x317;
const NPC_OWNER = 0x5a0, FACT_OWNER = 0x5a1;
const HOUSE_CELL = 0x520, PF_CELL = 0x521, PLAIN_CELL = 0x522, WORLD = 0x523, HALL_CELL = 0x524;
for (const id of [NPCCHEST, CELLCHEST, PLAYERCHEST, PFCHEST, PLAINCHEST, EXTCHEST, PLACECHEST, HALLCHEST]) {
  BASES[id] = 'c0:Skyrim.esm';   // verify-formids: ignore (the stub's made-up CONT base above)
}
const xown = (owner) => {
  const d = new Uint8Array(4); new DataView(d.buffer).setUint32(0, owner, true);
  return { type: 'XOWN', data: d };
};
// The local id in a field is not the global one: toGlobalRecordId adds 0x01000000 here, so a read that skips it is wrong
const LOCAL = 0x01000000;
const RECS = new Map([
  [NPCCHEST, { type: 'REFR', fields: [{ type: 'NAME', data: new Uint8Array(4) }, xown(NPC_OWNER + LOCAL)] }],
  [CELLCHEST, { type: 'REFR', fields: [] }],
  [PLAYERCHEST, { type: 'REFR', fields: [xown(0x7 + LOCAL)] }],
  [PFCHEST, { type: 'REFR', fields: [] }],
  [PLAINCHEST, { type: 'REFR', fields: [] }],
  [EXTCHEST, { type: 'REFR', fields: [] }],
  [PLACECHEST, { type: 'REFR', fields: [xown(NPC_OWNER + LOCAL)] }],
  [HALLCHEST, { type: 'REFR', fields: [] }],
  [HOUSE_CELL, { type: 'CELL', fields: [xown(FACT_OWNER + LOCAL)] }],
  [PF_CELL, { type: 'CELL', fields: [xown(0xdb1 + LOCAL)] }],
  [PLAIN_CELL, { type: 'CELL', fields: [] }],
  [WORLD, { type: 'WRLD', fields: [xown(FACT_OWNER + LOCAL)] }],   // never read as an owner: outdoors is not a cell
  [HALL_CELL, { type: 'CELL', fields: [xown(FACT_OWNER + LOCAL)] }],
]);
const baseLookup = mp.lookupEspmRecordById;
mp.lookupEspmRecordById = (id) => {
  const r = RECS.get(id >>> 0);
  if (r) return { record: r, toGlobalRecordId: (local) => (local - LOCAL) >>> 0 };
  return baseLookup(id);
};
const cellOf = { [NPCCHEST]: PLAIN_CELL, [CELLCHEST]: HOUSE_CELL, [PLAYERCHEST]: PLAIN_CELL, [PFCHEST]: PF_CELL,
  [PLAINCHEST]: PLAIN_CELL, [EXTCHEST]: WORLD, [PLACECHEST]: PLAIN_CELL, [HALLCHEST]: HALL_CELL };
for (const [ref, cell] of Object.entries(cellOf)) mp.set(Number(ref), 'worldOrCellDesc', `${cell.toString(16)}:x`);

// A claimed place: PLACECHEST stands in a house profile 7 (PLAYER) holds by its door. HALLCHEST is in a hall of guild-ash.
const PLACE_REC = { owner: 7, ownerName: 'Olaf' };
globalThis.__dboHousing = {
  recordOf: (ref) => ((ref >>> 0) === PLACECHEST ? PLACE_REC : null),
  ownsRecord: (rec, a) => Number(rec && rec.owner) === PROFILE[a >>> 0],
  keyOpens: () => false,
};
globalThis.__dboGuildsOf = (a) => ((a >>> 0) === PLAYER ? [{ id: 'guild-ash' }] : []);
globalThis.__dboGuildStorageAt = () => null;
globalThis.__dboHallFactionAt = (desc) => (String(desc).toLowerCase() === `${HALL_CELL.toString(16)}:x` ? { id: 'guild-ash' } : null);

const fresh = (cfg) => { delete globalThis.__dboChestOwnerCache; const M = load(cfg); M.S.beat.clear(); M.S.done.clear(); M.S.nextTake.clear(); return M; };
let N = fresh({ actionDelays: { theft: true } });
// Called through a guard, so the module before this change reports each check failed rather than crashing the run
const ownerOf = (id) => (typeof N.ownerInPlugins === 'function' ? N.ownerInPlugins(id) : undefined);
ok(ownerOf(NPCCHEST) === NPC_OWNER, 'an NPC chest: its owner is read off the REFR\'s XOWN, mapped to a global id', ownerOf(NPCCHEST));
ok(ownerOf(CELLCHEST) === FACT_OWNER, 'a chest with no XOWN takes its interior cell\'s owner');
ok(ownerOf(EXTCHEST) === 0, 'outdoors the worldspace is not a cell: no owner from it');
ok(ownerOf(PLAINCHEST) === 0, 'no XOWN on the ref or its cell: unowned');
ok(ownerOf(0xff000099) === 0, 'a dynamic ref has no plugin record: unowned');
ok(N.delayApplies(NPCCHEST, PLAYER) === 'theft', 'with theft on, an NPC\'s chest outside a dungeon is theft', N.delayApplies(NPCCHEST, PLAYER));
ok(N.delayApplies(CELLCHEST, PLAYER) === 'theft', '...and so is one in an NPC household\'s cell');
ok(N.searchGate(NPCCHEST, OTHER) === false, '...its first activation pays the search');
N.S.beat.clear(); N.S.done.clear(); N.S.nextTake.clear();
ok(N.takeGate(NPCCHEST, OTHER) === false, '...and a take with no search behind it is refused: no fast path');
ok(N.delayApplies(PLAYERCHEST, PLAYER) === '', 'a chest the load order gives the Player: instant');
ok(N.delayApplies(PFCHEST, PLAYER) === '', '...and one in a PlayerFaction cell (a player house): instant');
ok(N.delayApplies(PLACECHEST, PLAYER) === '', 'an NPC\'s chest in a house the player holds: their claim beats the plugin owner');
ok(N.delayApplies(PLACECHEST, OTHER) === 'theft', '...but for someone else it is theft');
ok(N.delayApplies(HALLCHEST, PLAYER) === '', 'a faction-owned chest in their own guild\'s hall: instant');
ok(N.delayApplies(HALLCHEST, OTHER) === 'theft', '...and theft for a non-member');
// The non-owned case must stay instant, both beats: this is the live regression of 3 Nov all over again if it does not
N.S.beat.clear(); N.S.done.clear(); N.S.nextTake.clear();
const resyncsBefore = resyncs.length;
ok(N.searchGate(PLAINCHEST, PLAYER) === undefined, 'an unowned chest, theft on: the first activation stands');
ok(N.takeGate(PLAINCHEST, PLAYER) === undefined && N.takeGate(PLAINCHEST, PLAYER) === undefined,
  '...and take-all from it is never refused');
ok(N.searchGate(EXTCHEST, PLAYER) === undefined && N.takeGate(EXTCHEST, PLAYER) === undefined, '...nor an outdoor one');
ok(N.S.beat.size === 0 && resyncs.length === resyncsBefore, '...and no beat was started for them, nor a pack resync');
ok(logs.some((l) => /actiondelays: 310 is owned by 5a0 \(from its ref\)/.test(l)), 'the owner read is logged once, for checking on dev');
N = fresh({});
ok(N.delayApplies(NPCCHEST, PLAYER) === '', 'theft off (the default, Nat 3 Nov "dungeons only"): an NPC chest stays instant');

// Mutants for this block: each must break one of the checks above
const ownerBattery = (M) => [
  M.delayApplies(NPCCHEST, PLAYER) === 'theft',
  M.delayApplies(CELLCHEST, PLAYER) === 'theft',
  M.delayApplies(PLAYERCHEST, PLAYER) === '',
  M.delayApplies(PFCHEST, PLAYER) === '',
  M.delayApplies(PLACECHEST, PLAYER) === '',
  M.delayApplies(HALLCHEST, PLAYER) === '',
  M.delayApplies(EXTCHEST, PLAYER) === '',
  M.delayApplies(PLAINCHEST, PLAYER) === '',
];
const OWNER_MUTANTS = [
  ['the plugin owner is never read', (s) => s.replace('const owner = ownerInPlugins(t);', 'const owner = 0;')],
  ['the cell is never asked', (s) => s.replace("if (r && r.record && String(r.record.type) === 'CELL') owner = xownOf(cell);", '')],
  ['outdoors the worldspace counts as a cell', (s) => s.replace("String(r.record.type) === 'CELL') owner", 'true) owner')],
  ['the Player and PlayerFaction are not exempt', (s) => s.replace('if (!owner || PLAYER_OWNERS.has(owner)) return', 'if (!owner) return')],
  ['the place claim is skipped', (s) => s.replace('if (place) return mayUsePlace', 'if (false) return mayUsePlace')],
  ['the guild hall is skipped', (s) => s.replace("return guildMayUse(t, a) ? '' : 'theft';", "return 'theft';")],
  ['the local id is used without toGlobalRecordId', (s) => s.replace('? (r.toGlobalRecordId(local) >>> 0) : 0', '? local : 0')],
];
const OSRC = fs.readFileSync(MODULE, 'utf8');
const oscratch = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-actiondelays-'));
for (const [what, mutate] of OWNER_MUTANTS) {
  const src = mutate(OSRC);
  if (src === OSRC) { fails++; console.log(`FAIL  mutant no longer applies (the code moved): ${what}`); continue; }
  const file = path.join(oscratch, `o-${Math.random().toString(16).slice(2)}.js`);
  fs.writeFileSync(file, src);
  delete globalThis.__dboActionDelayState; delete globalThis.__dboChestOwnerCache;
  let caught = false;
  try { caught = ownerBattery(require(file)(Object.assign({}, api, { cfg: { actionDelays: { theft: true } } }))._test).some((r) => !r); } catch (e) { caught = true; }
  ok(caught, `mutant caught: ${what}`);
}
try { fs.rmSync(oscratch, { recursive: true, force: true }); } catch (e) { /* leave it */ }

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
