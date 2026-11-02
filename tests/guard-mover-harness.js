// guardmover.js: the server walking a guard its own route (_work\server-npc-movement-1102.md step 4).
// Driven with a fake mp, a fake route timeline and a fake navmesh, so the safety rails are proven rather than
// described - and every rail here exists because something it guards against has already gone wrong once.
//
//   node tests/guard-mover-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'guardmover.js');
const src = fs.readFileSync(SRC, 'utf8');
let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

const ZONE = 'guard:bruma:8';
const NPC = 0xff00008e;
const OTHER = 0xff005678;

// Cell 13,49: x 53248-57344, y 200704-204800. The five real waypoints are all interior to it.
const P1 = [53911, 204101, 8452];
const P2 = [54247, 203094, 8421];
const OUT = [57400, 204101, 8452]; // one cell east, which the mover must refuse

const makeMp = (opts) => {
  const o = opts || {};
  const props = new Map();
  const sent = [];
  const mp = {
    props,
    sent,
    get: (id, k) => { if (o.getThrows) throw new Error('gone'); return (props.get(id) || {})[k]; },
    set: (id, k, v) => { const p = props.get(id) || {}; if (v === undefined) delete p[k]; else p[k] = v; props.set(id, p); },
    getWorldOrCellDesc: () => 'bsheartland.esm:0a764b',
  };
  if (!o.noSender) {
    mp.sendServerMovement = (id, data) => {
      if (o.senderThrows) throw new Error('not server-driven');
      sent.push({ id, data: JSON.parse(JSON.stringify(data)) });
    };
  }
  if (!o.noNav) {
    mp.navFloor = (world, from) => (o.navNull ? null : [from[2] - 7]); // 7 units below the marker's own z
  }
  mp.spawn = (id, zone) => mp.set(id, 'private.npcSpawner', zone);
  mp.tag = (id) => mp.set(id, 'private.dboServerHost', true);
  return mp;
};

const makeEvery = () => {
  const calls = [];
  const fn = (n, ms, cb) => calls.push({ n, ms, cb });
  fn.calls = calls;
  return fn;
};

const load = (text) => {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', text)(m, m.exports, require);
  return m.exports;
};
const mod = load(src);

// A route timeline shaped like W2's __dboGuardRouteAt
const route = (over) => Object.assign({ pos: P1, heading: 90, speed: 80, moving: true, nextAt: 4000, point: 0, zone: ZONE }, over || {});
const withRoute = (fn, at) => {
  const prev = globalThis.__dboGuardRouteAt;
  globalThis.__dboGuardRouteAt = typeof at === 'function' ? at : () => at;
  try { return fn(); } finally { globalThis.__dboGuardRouteAt = prev; }
};

const start = (M, mode, mp, st, over) => {
  const every = makeEvery();
  const lines = [];
  const cfg = Object.assign({ mode, zone: ZONE, hz: 4, floorStep: 64, logEveryMs: 10000 }, over || {});
  const p = M({ mp, every, log: (s) => lines.push(String(s)), cfg: { guardMover: cfg }, state: st || {} });
  return { p, every, lines };
};

// A world where everything the mover needs is true: spawned for the zone, and tagged by serverhostpin pin
const ready = (opts) => { const mp = makeMp(opts); mp.spawn(NPC, ZONE); mp.spawn(OTHER, 'guard:bruma:3'); mp.tag(NPC); return mp; };

// ---- off is inert, and the passes still register so a reload cannot orphan them ----
{
  const mp = ready();
  const { p, every, lines } = start(mod, 'off', mp, {});
  p.sees(NPC);
  withRoute(() => every.calls.forEach((c) => c.cb()), route());
  check('off: nothing is sent', mp.sent.length === 0 && p.stats().sent === 0);
  check('off: nothing is said', lines.length === 0, lines);
  check('off: both passes are registered anyway, as serverhostpin learnt to do on 2 Nov',
    every.calls.length === 2, every.calls.map((c) => c.n));
}

// ---- the hard refusals: each one names itself, because "the guard is not moving" with no reason cost an evening ----
{
  const noSender = ready({ noSender: true });
  const { p: a } = start(mod, 'on', noSender, {});
  a.sees(NPC);
  check('refuses without the C++ sender, and says so', /no mp.sendServerMovement/.test(a.why()), a.why());

  const mp = ready();
  const { p: b } = start(mod, 'on', mp, {});
  b.sees(NPC);
  check('refuses without the behaviour layer', /__dboGuardRouteAt/.test(withRoute(() => 'x', undefined) === 'x' ? b.why() : '', ), b.why());

  const untagged = makeMp(); untagged.spawn(NPC, ZONE);
  const { p: c } = start(mod, 'on', untagged, {});
  c.sees(NPC);
  withRoute(() => {
    check('REFUSES AN UNTAGGED NPC: a mover driving one clients also own is the fight the tag prevents',
      /is not tagged/.test(c.why()), c.why());
  }, route());

  const empty = ready();
  const { p: d } = start(mod, 'on', empty, {});
  withRoute(() => {
    check('refuses before the actor has been seen', /no actor found/.test(d.why()), d.why());
  }, route());

  withRoute(() => {
    const mp2 = ready();
    const { p: e } = start(mod, 'on', mp2, {});
    e.sees(NPC);
    check('and with everything in place it refuses nothing', e.why() === '', e.why());
  }, route());
}

// ---- it never tags: tagging is serverhostpin's job, and two taggers is how 2 Nov happened ----
{
  const mp = makeMp(); mp.spawn(NPC, ZONE);
  const { p } = start(mod, 'on', mp, {});
  p.sees(NPC);
  withRoute(() => { p.step(NPC, 1000); }, route());
  check('the mover never sets the tag itself', mp.props.get(NPC)['private.dboServerHost'] === undefined);
  check('...and sends nothing while untagged (checked through the pass, not just why())',
    mp.sent.length === 0);
}

// ---- the zone is the identity, never a form id ----
{
  const mp = ready();
  const { p } = start(mod, 'on', mp, {});
  p.sees(OTHER); p.sees(NPC); p.sees(0);
  check('only the actor spawned for this zone is taken', JSON.stringify(p.watching()) === JSON.stringify([NPC]), p.watching());
}

// ---- a tick: the packet carries the route's position, heading and speed ----
{
  const mp = ready();
  const { p } = start(mod, 'on', mp, {});
  p.sees(NPC);
  withRoute(() => { p.step(NPC, 1000); }, route());
  const s = mp.sent[0];
  check('one packet, for the right actor', mp.sent.length === 1 && s.id === NPC);
  check('the heading goes in rot[2] in degrees, as TranslateTo wants', s.data.rot[2] === 90);
  check('the speed is the route speed while moving, and runMode Walking',
    s.data.speed === 80 && s.data.runMode === 'Walking');
  check('x and y are the route position', s.data.pos[0] === P1[0] && s.data.pos[1] === P1[1]);
}

// ---- standing is speed 0 and Standing, not a walk with nowhere to go ----
{
  const mp = ready();
  const { p } = start(mod, 'on', mp, {});
  p.sees(NPC);
  withRoute(() => { p.step(NPC, 1000); }, route({ moving: false, speed: 80 }));
  check('standing sends speed 0 and runMode Standing',
    mp.sent[0].data.speed === 0 && mp.sent[0].data.runMode === 'Standing');
}

// ---- the floor comes from the navmesh, never from the marker's own z ----
{
  const mp = ready();
  const { p } = start(mod, 'on', mp, {});
  p.sees(NPC);
  withRoute(() => { p.step(NPC, 1000); }, route());
  check('z is the navmesh floor, not the marker z (W6: the markers are up to 36.5 units out)',
    mp.sent[0].data.pos[2] === P1[2] - 7);

  const nullNav = ready({ navNull: true });
  const { p: q } = start(mod, 'on', nullNav, {});
  q.sees(NPC);
  withRoute(() => { q.step(NPC, 1000); }, route());
  check('a null floor is counted and the marker z is held rather than guessed',
    q.stats().floorNull === 1 && nullNav.sent[0].data.pos[2] === P1[2]);

  const noNav = ready({ noNav: true });
  const { p: r } = start(mod, 'on', noNav, {});
  r.sees(NPC);
  withRoute(() => { r.step(NPC, 1000); }, route());
  check('with no navmesh at all it still walks, counting every sample as null - diagnosis, not a silent stop',
    noNav.sent.length === 1 && r.stats().floorNull === 1);
}

// ---- THE CELL RAIL: a leg leaving the cell stops the mover ----
// An NPC's cell is not updated by movement and an update that disagrees is dropped, after which every hit on
// it is refused. Cell 13,49's waypoints are all interior and a cell is convex, so this can only fire if the
// mover is wrong - which is exactly when it must.
{
  const mp = ready();
  const { p } = start(mod, 'on', mp, {});
  p.sees(NPC);
  let pos = P1;
  withRoute(() => { p.step(NPC, 1000); pos = OUT; p.step(NPC, 1250); }, () => route({ pos }));
  check('a leg leaving the cell is refused, and the mover halts rather than sending it',
    p.stats().cellChanges === 1 && p.halted() === true && mp.sent.length === 1, p.stats());
  check('...and it stays halted, so one bad leg cannot be walked off',
    (() => { withRoute(() => p.step(NPC, 1500), route()); return mp.sent.length === 1; })());
}

// ---- a refusing sender halts rather than retrying forever ----
{
  const mp = ready({ senderThrows: true });
  const { p, lines } = start(mod, 'on', mp, {});
  p.sees(NPC);
  withRoute(() => { p.step(NPC, 1000); }, route());
  check('a sender that refuses halts the mover and logs why',
    p.halted() === true && p.stats().refusals === 1 && lines.some((l) => /refused/.test(l)), lines);
}

// ---- the heartbeat the pin module watches ----
{
  const mp = ready();
  const { p } = start(mod, 'on', mp, {});
  p.sees(NPC);
  globalThis.__dboGuardMoverBeat = 0;
  withRoute(() => { p.step(NPC, 4242); }, route());
  check('every packet stamps the heartbeat serverhostpin warns on when it goes stale',
    globalThis.__dboGuardMoverBeat === 4242);
}

// ---- the cadence is config, because W1's playback measurement decides it, not this module ----
{
  const mp = ready();
  check('hz 4 is a 250 ms pass', start(mod, 'on', mp, {}, { hz: 4 }).p.stepMs === 250);
  check('hz 10 is a 100 ms pass', start(mod, 'on', mp, {}, { hz: 10 }).p.stepMs === 100);
  check('hz is clamped above, so a typo cannot flood every watcher',
    start(mod, 'on', mp, {}, { hz: 9999 }).p.hz === 30);
  // 0 falls back to the DEFAULT rather than clamping to 1, because `Number(0) || 4` is 4. That is the right
  // behaviour - a cadence of zero is meaningless, so the default is a better answer than one packet a second -
  // and this assertion originally demanded 1, which was my expectation being wrong rather than the code.
  check('...and hz 0 falls back to the default 4, not to 1',
    start(mod, 'on', mp, {}, { hz: 0 }).p.hz === 4);
  check('the floor step defaults to W6\'s measured 64 and has a floor of its own',
    start(mod, 'on', mp, {}).p.floorStep === 64 && start(mod, 'on', mp, {}, { floorStep: 1 }).p.floorStep === 8);
}

// ---- cellOf, the arithmetic the rail depends on ----
{
  const { p } = start(mod, 'on', ready(), {});
  check('cellOf puts all five real waypoints in 13,49',
    [P1, P2, [54844, 202345, 8426], [55096, 203096, 8424], [54605, 203881, 8420]].every((q) => p.cellOf(q) === '13,49'));
  check('cellOf puts a position one cell east in 14,49', p.cellOf(OUT) === '14,49');
}

// ---- mutants: each must break something above ----
const scenarios = (M) => {
  let bad = 0;
  const c = (ok) => { if (!ok) bad++; };
  return withRoute(() => {
    const mp = ready();
    const { p, every } = start(M, 'on', mp, {});
    p.sees(OTHER); p.sees(NPC);
    c(JSON.stringify(p.watching()) === JSON.stringify([NPC]));
    c(p.why() === '');
    p.step(NPC, 1000);
    c(mp.sent.length === 1);
    c(mp.sent[0].data.rot[2] === 90);
    c(mp.sent[0].data.pos[2] === P1[2] - 7);
    c(mp.sent[0].data.speed === 80 && mp.sent[0].data.runMode === 'Walking');
    c(mp.props.get(NPC)['private.dboServerHost'] === true); // set by the fake pin, not by the mover
    c(every.calls.length === 2);
    c(p.stepMs === 250);
    // The clamps, inside scenarios so a mutant of them is killed rather than merely noticed. Their checks
    // sat in the harness body first and both mutants survived - the third time tonight that a new check in
    // the body left the mutant alive, which is the argument for putting them here by default.
    c(start(M, "on", ready(), {}, { hz: 9999 }).p.hz === 30);
    c(start(M, "on", ready(), {}, { floorStep: 1 }).p.floorStep === 8);
    c(start(M, "on", ready(), {}, { floorStep: 999 }).p.floorStep === 999);

    // untagged: refuses and sends nothing
    const untagged = makeMp(); untagged.spawn(NPC, ZONE);
    const { p: u } = start(M, 'on', untagged, {});
    u.sees(NPC); u.step(NPC, 1000);
    c(untagged.sent.length === 0);
    c(/is not tagged/.test(u.why()));
    c(untagged.props.get(NPC)['private.dboServerHost'] === undefined);

    // off: inert through the passes
    const mpOff = ready();
    const { p: off, every: e2, lines: l2 } = start(M, 'off', mpOff, {});
    off.sees(NPC);
    e2.calls.forEach((x) => x.cb());
    c(mpOff.sent.length === 0 && l2.length === 0 && e2.calls.length === 2);

    // the cell rail
    const mpCell = ready();
    const { p: cm } = start(M, 'on', mpCell, {});
    cm.sees(NPC);
    let pos = P1;
    globalThis.__dboGuardRouteAt = () => route({ pos });
    cm.step(NPC, 1000); pos = OUT; cm.step(NPC, 1250);
    c(cm.stats().cellChanges === 1 && cm.halted() === true && mpCell.sent.length === 1);

    // standing
    const mpStand = ready();
    const { p: st } = start(M, 'on', mpStand, {});
    st.sees(NPC);
    globalThis.__dboGuardRouteAt = () => route({ moving: false });
    st.step(NPC, 1000);
    c(mpStand.sent[0].data.speed === 0 && mpStand.sent[0].data.runMode === 'Standing');

    // the heartbeat
    globalThis.__dboGuardMoverBeat = 0;
    const mpBeat = ready();
    const { p: bt } = start(M, 'on', mpBeat, {});
    bt.sees(NPC);
    globalThis.__dboGuardRouteAt = () => route();
    bt.step(NPC, 7777);
    c(globalThis.__dboGuardMoverBeat === 7777);
    return bad;
  }, route());
};
check('the scenarios pass on guardmover.js as it is', scenarios(mod) === 0);

const MUTANTS = [
  ['the mover tags the NPC itself, so two things tag', "if (!f) return false;", "if (!f) return false;\n    mp.set(f, TAG, true);"],
  ['it drives an untagged NPC, fighting the client that owns it', "      if (!tagged(id)) {", "      if (false) {"],
  ['the cell rail never fires', "if (S.cell && S.cell !== cell) {", "if (false) {"],
  ['a bad leg does not halt it', "      S.halted = true;\n      return null;\n    }\n    S.cell = cell;", "      return null;\n    }\n    S.cell = cell;"],
  ['the marker z is sent instead of the navmesh floor', "if (z === null) S.stats.floorNull++; else pos[2] = z;", "if (z === null) S.stats.floorNull++;"],
  ['standing is sent as a walk', "speed: at.moving ? Number(at.speed) || 0 : 0,", "speed: Number(at.speed) || 0,"],
  ['standing keeps runMode Walking', "runMode: at.moving ? 'Walking' : 'Standing',", "runMode: 'Walking',"],
  ['the heading is dropped', "rot: [0, 0, Number(at.heading) || 0],", "rot: [0, 0, 0],"],
  ['no heartbeat, so the pin watchdog can never fire', "globalThis.__dboGuardMoverBeat = now;", ""],
  ['hz is not clamped, so a typo floods every watcher', "Math.max(1, Math.min(30, Number(C.hz) || 4))", "Number(C.hz) || 4"],
  ['the floor step is not clamped', "Math.max(8, Number(C.floorStep) || 64)", "Number(C.floorStep) || 64"],
  ['off is not inert', "const on = C.mode === 'on' && !!zone;", "const on = true;"],
  ['the passes are not registered when off, orphaning the old ones', "if (typeof every === 'function') {", "if (on && typeof every === 'function') {"],
  ['any actor is taken, not only the zone\'s', "return get(f, SPAWNER) === zone;", "return true;"],
];
let killed = 0;
for (const [name, a, b] of MUTANTS) {
  if (!src.includes(a)) { check(`mutant "${name}": its line is in guardmover.js`, false, a); continue; }
  let survived = true;
  try { survived = scenarios(load(src.replace(a, b))) === 0; } catch (e) { survived = false; }
  if (survived) { console.log(`FAIL mutant survived: ${name}`); failures++; } else { killed++; }
}
console.log(`ok   ${killed}/${MUTANTS.length} mutants killed`);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
