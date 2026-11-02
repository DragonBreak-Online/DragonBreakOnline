// serverhostpin.js: the zero-C++ host-pinning experiment for Option B phase 1
// (_work\server-npc-movement-1102.md). Driven with a fake mp, so the refusal, the zone match and the tag are
// proven rather than hoped for, and each mutant must make a check fail.
//
//   node tests/server-host-pin-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'serverhostpin.js');
const src = fs.readFileSync(SRC, 'utf8');
let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

// A fake mp: properties per form id, a hoster table, and a throw switch so the guards are exercised.
// spawn() seeds private.npcSpawner the way npcSpawnSystem does, which is how the module finds its NPC.
const makeMp = (opts) => {
  const o = opts || {};
  const props = new Map();
  const hosters = new Map();
  return {
    props,
    hosters,
    spawn: (id, zone) => { const p = props.get(id) || {}; p['private.npcSpawner'] = zone; props.set(id, p); },
    get: (id, key) => {
      if (o.getThrows) throw new Error('no such form');
      return (props.get(id) || {})[key];
    },
    set: (id, key, v) => {
      if (o.setThrows) throw new Error('read-only');
      const p = props.get(id) || {};
      if (v === undefined) delete p[key]; else p[key] = v;
      props.set(id, p);
    },
    getHoster: (id) => {
      if (o.hosterThrows) throw new Error('gone');
      return hosters.get(id) || 0;
    },
  };
};

// gamemode.js hands its modules a bag - { mp, log, every, cfg } - so the harness does the same, with an
// `every` that records the passes instead of running them and a `log` that collects the lines.
const makeEvery = () => {
  const calls = [];
  const fn = (name, ms, cb) => { calls.push({ name, ms, cb }); };
  fn.calls = calls;
  return fn;
};

const load = (text) => {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', text)(m, m.exports, require);
  return m.exports;
};
const mod = load(src);

const ZONE = 'guard:bruma:8';
const NPC = 0xff001234;        // the guard spawned for ZONE
const MATE = 0xff001235;       // a second guard in the same zone, for the per-npc gap
const OTHER = 0xff005678;      // an NPC spawned for a different zone
const LOOSE = 0xff009999;      // an actor with no spawner tag at all

// One place that knows the module's calling convention, so a change to it is one edit here rather than
// twenty. Returns the module and the stand-ins, because several checks read the recorded passes and lines.
const start = (M, mode, mp, st, opts) => {
  const o = opts || {};
  const every = o.noEvery ? undefined : makeEvery();
  const lines = [];
  const cfg = Object.assign({ mode }, 'zone' in o ? { zone: o.zone } : { zone: ZONE }, o.npc ? { npc: o.npc } : {});
  const p = M({ mp, every, log: (s) => lines.push(String(s)), cfg: { serverHostPin: cfg }, state: st || {} });
  return { p, every, lines };
};

// A populated world: two guards in the watched zone, one in another, one untagged.
const world = (opts) => {
  const mp = makeMp(opts);
  mp.spawn(NPC, ZONE);
  mp.spawn(MATE, ZONE);
  mp.spawn(OTHER, 'guard:bruma:3');
  return mp;
};

// ---- off is genuinely inert, so the module can be deployed before anyone decides to use it ----
{
  const mp = world();
  const before = JSON.stringify([...mp.props]);
  const { p, every } = start(mod, 'off', mp, {});
  p.apply();
  check('off: nothing is tagged', p.tagged(NPC) === false && JSON.stringify([...mp.props]) === before);
  check('off: nothing is refused', p.refuses(1, NPC) === false);
  check('off: the director is not told to skip', p.directorSkips(NPC) === false);
  check('off: polling says nothing', p.poll(1000) === null);
  // This assertion used to require ZERO passes, and that was the third hole in the 2 Nov stranding (W5 found
  // it live). gamemode.js's every() calls stopTimer(name) first, so registering replaces the previous
  // generation's timer - but not registering leaves it running, with its old closure and its old mode, still
  // re-tagging through apply(). After the reload to off, heartbeats still said "observe".
  // So: both passes are registered in every mode, and their bodies return early. A pass that costs nothing is
  // worse than a pass that does nothing, when its absence leaves an orphan behind.
  check('off: both passes ARE registered, so a reload replaces the old timers rather than orphaning them',
    every.calls.length === 2 && every.calls[0].name === 'serverHostPin'
    && every.calls[1].name === 'serverHostPinSummary', every.calls.map((c) => c.name));
  check('off: and running them does nothing at all - no tag, no log',
    (() => {
      const before = JSON.stringify([...mp.props]);
      const lines = [];
      const { every: e2, lines: l2 } = start(mod, 'off', mp, {});
      e2.calls.forEach((c) => c.cb());
      return JSON.stringify([...mp.props]) === before && l2.length === 0 && lines.length === 0;
    })());
  check('off: the global refuser still answers, and answers false',
    typeof globalThis.__dboServerHostRefuses === 'function' && globalThis.__dboServerHostRefuses(1, NPC) === false);
}

// ---- a mode with no zone and no id is inert too, so a half-filled config cannot pin the whole world ----
{
  const mp = world();
  const { p, every } = start(mod, 'pin', mp, {}, { zone: '' });
  p.apply();
  check('pin with neither zone nor npc: refuses nothing', p.refuses(1, NPC) === false && p.refuses(1, OTHER) === false);
  check('...but the passes are still registered, so a reload cannot orphan an older timer', every.calls.length === 2);
}

// ---- the zone is the identity: npcSpawner decides, not an id ----
{
  const mp = world();
  const { p } = start(mod, 'observe', mp, {});
  check('the guard spawned for the zone is a target', p.isTarget(NPC) === true);
  check('...and so is its mate in the same zone', p.isTarget(MATE) === true);
  check('a guard from another zone is not', p.isTarget(OTHER) === false);
  check('an actor with no npcSpawner tag is not', p.isTarget(LOOSE) === false);
  check('a zero id is not, and does not throw', p.isTarget(0) === false);
  check('the ids are learnt, not configured', JSON.stringify(p.watching()) === JSON.stringify([NPC, MATE]), p.watching());
  // NOT tagged in observe. This assertion used to say the opposite, and the opposite cost Nat an evening on
  // 2 Nov: see the stranding block below.
  check('observe does NOT tag, so no NPC is taken away from clients while we only measure',
    p.tagged(NPC) === false && mp.props.get(NPC)['private.dboServerHost'] === undefined);
  check("the other zone's guard is not tagged either", mp.props.get(OTHER)['private.dboServerHost'] === undefined);
}

// ---- THE STRANDING: tagged, with nothing driving it ----
// The failure of 2 Nov, as a test. The tag means "measure this one" here and "the server drives this, refuse
// everybody" to the C++ sentinel (PartOne::IsServerDriven): it refuses every host attempt, skips the stale
// sweep, and tells clients isHostedByOther. Observe used to tag, so on a server carrying the sentinel it
// stranded the guard - refused to every client, asked for by none, driven by nothing because the mover does
// not exist. Nat found it spinning on the spot with no owner.
//
// So: a mode that does not drive the NPC must not tag it. Only pin tags, and only because a mover is meant to
// follow. `stranded(id)` is the state itself, so a future mode has to answer the question rather than inherit
// the bug.
{
  const mp = world();
  const { p: ob } = start(mod, 'observe', mp, {});
  ob.isTarget(NPC); ob.directorSkips(NPC); ob.refuses(0x14, NPC);
  ob.apply();
  check('observe never strands: watched, and left hostable by clients',
    ob.tagged(NPC) === false && ob.stranded(NPC) === false);
  check('...not even after apply(), which used to tag everything it knew about',
    mp.props.get(NPC)['private.dboServerHost'] === undefined);

  const mpOff = world();
  const { p: off } = start(mod, 'off', mpOff, {});
  off.isTarget(NPC); off.apply();
  check('off never strands either', off.tagged(NPC) === false && off.stranded(NPC) === false);

  const mpPin = world();
  const { p: pin } = start(mod, 'pin', mpPin, {});
  pin.isTarget(NPC);
  check('pin tags, because pin is what a mover follows', pin.tagged(NPC) === true);
  check('...and pin is not stranded by definition: it refuses hosts on purpose',
    pin.stranded(NPC) === false && pin.refuses(0x14, NPC) === true);
  check('a tag left behind by pin IS the stranding once the mode is no longer pin',
    (() => {
      const { p: after } = start(mod, 'observe', mpPin, {});
      return after.tagged(NPC) === true && after.stranded(NPC) === true;
    })());
  check('and it can be undone without a restart, which is what the live fix needed',
    (() => {
      const { p: fix } = start(mod, 'observe', mpPin, {});
      fix.clearTag(NPC);
      return fix.tagged(NPC) === false && fix.stranded(NPC) === false;
    })());
}

// ---- observe tags and watches, but refuses nothing ----
{
  const mp = world();
  const { p, every } = start(mod, 'observe', mp, {});
  p.apply();
  check('observe: refuses nothing - this mode only measures', p.refuses(1, NPC) === false);
  // This assertion also used to say the opposite. The old reasoning was that the director's 1 s pass would
  // beat the measurement, which is true of PIN and wrong of observe: the baseline we want from observe is the
  // ordinary behaviour, the director included. A mode that alters the thing it is measuring is not a baseline,
  // and the stranding came from exactly this habit of letting "watching" change something.
  check('observe: the director is NOT told to skip, so the baseline includes it',
    p.directorSkips(NPC) === false);
  check('pin: the director IS told to skip, or its pass hands the NPC away despite the refusal',
    start(mod, 'pin', world(), {}).p.directorSkips(NPC) === true);
  check("observe: another zone's guard is not skipped", p.directorSkips(OTHER) === false);
  check('observe: a 1 s watch pass and a summary pass are registered',
    every.calls.length === 2 && every.calls[0].ms === 1000 && every.calls[1].ms === 10000,
    every.calls.map((c) => [c.name, c.ms]));
}

// ---- pin refuses every attempt on the zone's guards, and only those ----
{
  const mp = world();
  const { p } = start(mod, 'pin', mp, {});
  check("pin: every requester is refused for the zone's guard",
    p.refuses(0x14, NPC) === true && p.refuses(0x999, NPC) === true);
  check("pin: another zone's guard is untouched", p.refuses(0x14, OTHER) === false);
  check('pin: a zero id is refused nothing (the chain must not throw on it)', p.refuses(0x14, 0) === false);
  check('pin: the global refuser gamemode.js calls refuses too, and counts it',
    globalThis.__dboServerHostRefuses(0x14, NPC) === true && p.stats().refused === 1, p.stats());
  check('pin: the global skip npcdirector.js calls agrees with directorSkips',
    globalThis.__dboServerHostSkips(NPC) === true && globalThis.__dboServerHostSkips(OTHER) === false);
}

// ---- an id in config still works, for an actor npcSpawnSystem never placed ----
{
  const mp = makeMp();
  const { p } = start(mod, 'pin', mp, {}, { zone: '', npc: LOOSE });
  p.apply();
  check('npc by id: an untagged actor named by id is pinned', p.refuses(0x14, LOOSE) === true && p.tagged(LOOSE) === true);
  check('npc by id: nothing else is', p.refuses(0x14, NPC) === false);
}

// ---- the registered pass must survive being run; it is the only code that runs unattended on dev ----
{
  const mp = world();
  const { p, every, lines } = start(mod, 'observe', mp, {});
  p.directorSkips(NPC);                      // the director teaches us the id, as it does on dev
  mp.hosters.set(NPC, 0x14);
  every.calls[0].cb();                       // first tick: records the starting hoster
  mp.hosters.set(NPC, 0x15);
  every.calls[0].cb();                       // second tick: a change, which must be logged
  check('the watch pass logs the host change with both ids',
    lines.some((l) => l.includes('ff001234') && l.includes('14 -> 15')), lines);
  every.calls[1].cb();
  check('the summary pass logs the zone and the counts',
    lines.some((l) => l.includes('"changes":1') && l.includes(ZONE)), lines);
}

// ---- the host-change log: the sequence and its timing are the whole point ----
{
  const mp = world();
  const { p } = start(mod, 'observe', mp, {});
  p.isTarget(NPC);
  mp.hosters.set(NPC, 0x14);
  const first = p.poll(1000);
  check('the first poll records the starting hoster without calling it a change',
    !!first && first.first === true && first.hoster === 0x14 && first.npc === NPC);
  check('...and an unchanged hoster reports nothing', p.poll(2000) === null);
  mp.hosters.set(NPC, 0x15);
  const ch = p.poll(5000);
  check('a host change is reported with from, to and the gap since the last change',
    !!ch && ch.changed === true && ch.from === 0x14 && ch.to === 0x15 && ch.afterMs === 4000, ch);
  mp.hosters.set(NPC, 0);
  const rel = p.poll(6000);
  check('a release to nobody is a change too (0 is a hoster value, not an absence)',
    !!rel && rel.to === 0 && rel.afterMs === 1000, rel);
  check('changes are counted', p.stats().changes === 2, p.stats());
}

// ---- the gap is per NPC: a zone with two guards must not report one's gap as the other's ----
{
  const mp = world();
  const { p } = start(mod, 'observe', mp, {});
  p.isTarget(NPC); p.isTarget(MATE);
  mp.hosters.set(NPC, 0x14); mp.hosters.set(MATE, 0x14);
  p.pollOne(NPC, 1000); p.pollOne(MATE, 1000);
  mp.hosters.set(NPC, 0x15);
  const a = p.pollOne(NPC, 9000);
  check("the first guard's gap is its own 8000 ms", !!a && a.afterMs === 8000, a);
  mp.hosters.set(MATE, 0x15);
  const b = p.pollOne(MATE, 10000);
  check("the second guard's gap is its own 9000 ms, not 1000 since the first one moved",
    !!b && b.afterMs === 9000, b);
}

// ---- the guards: a form that has gone must not throw into the host chain ----
{
  const { p } = start(mod, 'pin', world({ getThrows: true }), {});
  check('a throwing mp.get leaves the NPC untargeted rather than throwing', p.isTarget(NPC) === false);
  check('...and refuses nothing, so a gone form cannot block every host attempt', p.refuses(1, NPC) === false);
  const mpH = world({ hosterThrows: true });
  const { p: q } = start(mod, 'pin', mpH, {});
  q.isTarget(NPC);
  check('a throwing getHoster polls to a hoster of 0 rather than throwing', (q.poll(1) || {}).hoster === 0);
  const { p: r } = start(mod, 'pin', world({ setThrows: true }), {});
  check('a read-only form does not throw out of isTarget or apply',
    (() => { try { r.isTarget(NPC); r.apply(); return true; } catch (e) { return false; } })());
  check('a gamemode with no `every` loads without throwing, and still answers the chain',
    (() => { try { return start(mod, 'pin', world(), {}, { noEvery: true }).p.refuses(1, OTHER) === false; } catch (e) { return false; } })());
}

// ---- the two call sites: a module nobody calls refuses nothing, however well it tests ----
// The whole experiment is three lines of other people's files, and a fold that drops one leaves this harness
// green while the NPC is handed away on the director's next pass. So the call sites are checked too.
{
  const read = (f) => { try { return fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8'); } catch (e) { return null; } };
  const gm = read('gamemode.js');
  const nd = read('npcdirector.js');
  check('gamemode.js: the host chain consults __dboServerHostRefuses',
    !!gm && /__dboServerHostRefuses === 'function' && globalThis\.__dboServerHostRefuses\(req, act\)\) return false/.test(gm));
  check("gamemode.js: ...inside hostAttemptHook, beside the director's own refusal",
    !!gm && (() => {
      const i = gm.indexOf('const hostAttemptHook');
      const j = gm.indexOf('__dboServerHostRefuses(req, act)');
      return i >= 0 && j > i && j - i < 2000;
    })());
  check('gamemode.js: serverhostpin.js is loaded with the bag it expects',
    !!gm && /require\(SERVERHOSTPIN_JS\)\(\{ mp, log, every, cfg, state:/.test(gm));
  check('npcdirector.js: managed() steps aside for a server-hosted NPC',
    !!nd && /__dboServerHostSkips\(npc\)\) return false/.test(nd));
  check('npcdirector.js: ...inside managed(), not somewhere the 1 s pass never reads',
    !!nd && (() => {
      const i = nd.indexOf('const managed = (npc)');
      const j = nd.indexOf('__dboServerHostSkips(npc)');
      return i >= 0 && j > i && j - i < 1200;
    })());
  check('the spawner tag this module matches on is the one npcSpawnSystem writes',
    (() => {
      const f = path.resolve(__dirname, '..', '..', '..', '..', 'fork/skymp5-server/ts/systems/npcSpawnSystem.ts');
      if (!fs.existsSync(f)) { console.log('     (skipped: npcSpawnSystem.ts is not beside this checkout)'); return true; }
      const t = fs.readFileSync(f, 'utf8');
      return /TAG_PROP = "private\.npcSpawner"/.test(t) && /mp\.set\(id, TAG_PROP, zone\.name\)/.test(t);
    })());
}

// ---- mutants: each altered copy must fail at least one check above ----
const scenarios = (M) => {
  let bad = 0;
  const c = (ok) => { if (!ok) bad++; };
  const mp = world();
  const { p, every } = start(M, 'pin', mp, {});
  c(p.isTarget(NPC) === true);
  c(p.isTarget(OTHER) === false);
  c(p.isTarget(LOOSE) === false);
  c(p.tagged(NPC) === true);
  c(JSON.stringify(p.watching()) === JSON.stringify([NPC]));
  c(p.refuses(0x14, NPC) === true);
  c(p.refuses(0x14, OTHER) === false);
  c(p.directorSkips(NPC) === true);
  c(globalThis.__dboServerHostRefuses(0x14, NPC) === true);
  c(every.calls.length === 2);
  const mpOff = world();
  const beforeOff = JSON.stringify([...mpOff.props]);
  const { p: off, every: every2, lines: linesOff } = start(M, 'off', mpOff, {});
  off.apply();
  c(off.tagged(NPC) === false);
  c(off.refuses(0x14, NPC) === false);
  c(globalThis.__dboServerHostRefuses(0x14, NPC) === false);
  c(every2.calls.length === 2);
  // off must be inert THROUGH the passes, not merely at the API: running both bodies must change no property
  // both survive - they did, on the first attempt at this fix.
  c(off.poll(1000) === null);
  every2.calls.forEach((x) => x.cb());
  c(JSON.stringify([...mpOff.props]) === beforeOff);
  c(linesOff.length === 0);
  const mp3 = world();
  const { p: ob } = start(M, 'observe', mp3, {});
  ob.isTarget(NPC); ob.isTarget(MATE);
  // The stranding, inside scenarios so a mutant that reintroduces it is killed rather than merely noticed.
  // Three mutants survived the first time this fix was written, because the new checks were in the body and
  // the mutants are run against this function alone.
  c(ob.tagged(NPC) === false);
  c(ob.stranded(NPC) === false);
  c(ob.directorSkips(NPC) === false);
  ob.apply();
  c(ob.tagged(NPC) === false);
  c(mp3.props.get(NPC)['private.dboServerHost'] === undefined);
  c(ob.refuses(0x14, NPC) === false);
  mp3.hosters.set(NPC, 0x14);
  ob.pollOne(NPC, 1000);
  mp3.hosters.set(NPC, 0x15);
  const ch = ob.pollOne(NPC, 3000);
  c(!!ch && ch.from === 0x14 && ch.to === 0x15 && ch.afterMs === 2000);
  mp3.hosters.set(MATE, 0x14);
  ob.pollOne(MATE, 1000);
  mp3.hosters.set(MATE, 0x15);
  const chMate = ob.pollOne(MATE, 11000);
  c(!!chMate && chMate.afterMs === 10000);
  const { p: byId } = start(M, 'pin', makeMp(), {}, { zone: '', npc: LOOSE });
  c(byId.refuses(0x14, LOOSE) === true);
  // A config with neither a zone nor an id refuses nothing AND registers no pass. Both halves are needed:
  // isTarget already refuses everything without one, so dropping the `(!!zone || !!npc)` from `on` changes
  // only whether two timed passes run every second with nothing to watch. That is a real difference on a
  // live server and it is the only thing that makes that mutant non-equivalent.
  const { p: neither, every: every3, lines: linesNeither } = start(M, 'pin', world(), {}, { zone: '' });
  c(neither.refuses(0x14, NPC) === false);
  c(every3.calls.length === 2);
  // A half-filled config must also be SILENT. Dropping the zone-or-id term from `on` leaves it logging a
  // watching:0 summary every logEveryMs on a live server - noise, and misleading. Now that the passes register
  // in every mode, that log line is the only thing that makes the mutant non-equivalent, which I checked by
  // diffing every output of both versions rather than reasoning about it.
  every3.calls.forEach((x) => x.cb());
  c(linesNeither.length === 0);
  return bad;
};
check('the scenarios pass on serverhostpin.js as it is', scenarios(mod) === 0);

const MUTANTS = [
  ['the zone is ignored, so every NPC is pinned', "const mine = (zone && spawnerOf(f) === zone) || (npc && f === npc);", "const mine = true;"],
  ['the spawner tag is the wrong property', "const SPAWNER = 'private.npcSpawner';", "const SPAWNER = 'private.dboSpawner';"],
  ['ids are matched but never remembered', "if (!S.ids.has(f)) { S.ids.add(f);", "if (false) { S.ids.add(f);"],
  ['pin stops tagging, so a mover would drive an NPC clients still own', "if (pinning && !tagged(f)) tag(f, true);", "/* not tagged */"],
  ['observe tags again, which is the 2 Nov stranding', "if (pinning && !tagged(f)) tag(f, true);", "if (!tagged(f)) tag(f, true);"],
  ['apply tags in every mode, the second half of the stranding', "if (pinning) for (const id of S.ids)", "for (const id of S.ids)"],
  ['observe refuses too', "const pinning = C.mode === 'pin';", "const pinning = on;"],
  ['off is not inert', "const on = (C.mode === 'observe' || C.mode === 'pin') && (!!zone || !!npc);", "const on = true;"],
  ['a half-filled config pins the world', "&& (!!zone || !!npc);", ";"],
  ['the director is never told to skip, so its pass beats pin', "return pinning && t;", "return false;"],
  ['the director is told to skip in observe too', "return pinning && t;", "return t;"],
  ['the change gap is not measured', "const gap = S.at[f] ? now - S.at[f] : 0;", "const gap = 0;"],
  ['the gap is global, not per NPC', "const gap = S.at[f] ? now - S.at[f] : 0;", "const gap = S.lastAny ? now - S.lastAny : 0;"],
  ['the global refuser never refuses', "const no = refuses(requester, id);", "const no = false;"],
  ['off registers no pass, orphaning the previous generation timer', "if (typeof every === 'function') {", "if (on && typeof every === 'function') {"],
];
// Also deliberately NOT a mutant: dropping `if (!on) return;` from the 1 s pass. EQUIVALENT, checked by
// running both versions in off mode and diffing every output (scratchpad\probe-equiv2.js): apply() and poll()
// each guard on `on` themselves, so the pass body changes nothing without it. The guard stays as defence in
// depth - it is one line and it makes the intent local - but it is not load-bearing and a mutant of it would
// be a standing FAIL for the next person to re-derive.
// Deliberately NOT a mutant: dropping the `!f` guard from isTarget(). It is EQUIVALENT rather than surviving
// - form 0 carries no properties, so spawnerOf(0) is '' with or without the guard and no behaviour changes. A
// mutant that cannot alter behaviour proves nothing about the checks, and leaving it in the list would be a
// standing FAIL that the next person has to re-derive. The guard stays in the module because reading a
// property off id 0 is not something to rely on, not because a test caught it.
let killed = 0;
for (const [name, a, b] of MUTANTS) {
  if (!src.includes(a)) { check(`mutant "${name}": its line is in serverhostpin.js`, false, a); continue; }
  let survived = true;
  try { survived = scenarios(load(src.replace(a, b))) === 0; } catch (e) { survived = false; }
  if (survived) { console.log(`FAIL mutant survived: ${name}`); failures++; } else { killed++; }
}
console.log(`ok   ${killed}/${MUTANTS.length} mutants killed`);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
