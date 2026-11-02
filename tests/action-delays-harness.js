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

let fails = 0;
const ok = (cond, what, got) => {
  if (cond) { console.log(`ok    ${what}`); return; }
  fails++;
  console.log(`FAIL  ${what}${got === undefined ? '' : `   ${JSON.stringify(got)}`}`);
};

const props = new Map();
const setp = (id, k, v) => props.set(`${id >>> 0}|${k}`, v);
const said = [], widgets = [], closed = [], resyncs = [], logs = [];
const mp = {
  get: (id, k) => {
    if (k === 'baseDesc') return BASES[id >>> 0];
    if (k === 'profileId') return PROFILE[id >>> 0];
    return props.get(`${id >>> 0}|${k}`);
  },
  set: setp,
  getIdFromDesc: (d) => { const [h] = String(d).split(':'); return parseInt(h, 16) >>> 0; },
  lookupEspmRecordById: (id) => {
    const desc = Object.keys(TYPES).find((d) => mp.getIdFromDesc(d) === (id >>> 0));
    return desc ? { record: { type: TYPES[desc] } } : null;
  },
};
setp(HOMECHEST, 'private.housing', { owner: 7, ownerName: 'Olaf' });
setp(KEYCHEST, 'private.housing', { owner: 99, keys: [7] });

const api = {
  mp,
  log: (...a) => logs.push(a.join(' ')),
  personal: (a, t) => said.push({ a, t }),
  cfg: {},
  profileOf: (a) => (PROFILE[a >>> 0] === undefined ? -1 : PROFILE[a >>> 0]),
  openWidget: (a, payload) => widgets.push({ a, payload }),
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
ok(T.searchGate(HOMECHEST, OTHER) === false, '...but not for someone else', T.searchGate(HOMECHEST, OTHER));

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

// ---- a hot reload keeps a beat in flight -----------------------------------------------------------------------------
T = load({});
T.searchGate(CHEST, PLAYER);
const kept = globalThis.__dboActionDelayState;
delete require.cache[MODULE];
const T2 = require(MODULE)(Object.assign({}, api, { cfg: {} }))._test;
ok(T2.S === kept, 'a hot reload reuses the state, so a beat in flight is not restarted', T2.S === kept);
clock += 2 * SEC;
ok(T2.searchGate(CHEST, PLAYER) === undefined, '...and the beat finishes across the reload');

// ---- mutants ---------------------------------------------------------------------------------------------------------
// Each must break at least one check. A mutation that no longer applies means the code moved: that is reported, not passed.
const SRC = fs.readFileSync(MODULE, 'utf8');
const MUTANTS = [
  ['the first activation is allowed (no search beat at all)', (s) => s.replace('      show(a, ms, \'Searching\');\n      tell(a, \'You search it. Give it a moment, then open it again.\');\n      return false;', '      show(a, ms, \'Searching\');\n      return undefined;')],
  ['the beat is never waited out (any activation opens it)', (s) => s.replace('if (now - started < ms) return false;', 'if (false) return false;')],
  ['a body\'s first take is free', (s) => s.replace('if (now - started < ms) { resync(a); return false; }', 'if (false) { resync(a); return false; }')],
  ['the gap between takes is dropped', (s) => s.replace('if (now < next) {', 'if (false) {')],
  ['a refused take does not resync', (s) => s.replace(/      resync\(a\);\n      return false;/, '      return false;')],
  ['every container counts as your own home (the exemption swallows everything)', (s) => s.replace('const ownHome = (ref, a) => {', 'const ownHome = (ref, a) => { if (true) return true;')],
  ['nothing is your own home (the exemption is lost)', (s) => s.replace('const ownHome = (ref, a) => {', 'const ownHome = (ref, a) => { if (true) return false;')],
  ['doors are delayed too (the CONT check is dropped)', (s) => s.replace("if (recordType(t) !== 'CONT') return undefined;", '')],
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
  clock += 2 * SEC;
  out.push(M.searchGate(CHEST, PLAYER) === undefined);                   // the beat completes
  out.push(M.searchGate(CHEST, PLAYER) === undefined);                   // and the grace holds
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

try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* leave it */ }
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
