// serverhostpin.js: the zero-C++ host-pinning experiment for Option B phase 1
// (_work\server-npc-movement-1102.md). Driven with a fake mp, so the refusal and the tag are proven rather
// than hoped for, and each mutant must make a check fail.
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
const makeMp = (opts) => {
  const o = opts || {};
  const props = new Map();
  const hosters = new Map();
  return {
    props,
    hosters,
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

const NPC = 0xff001234;
const OTHER = 0xff005678;

// One place that knows the module's calling convention, so a change to it is one edit here rather than
// twenty. Returns the module and the stand-ins, because several checks read the recorded passes and lines.
const start = (M, mode, mp, st, opts) => {
  const o = opts || {};
  const every = o.noEvery ? undefined : makeEvery();
  const lines = [];
  const p = M({
    mp,
    every,
    log: (s) => lines.push(String(s)),
    cfg: { serverHostPin: Object.assign({ mode, npc: NPC }, o.cfg || {}) },
    state: st || {},
  });
  return { p, every, lines };
};

// ---- off is genuinely inert, so the module can be deployed before anyone decides to use it ----
{
  const mp = makeMp();
  const { p, every } = start(mod, 'off', mp, {});
  p.apply();
  check('off: nothing is tagged', p.tagged(NPC) === false && mp.props.size === 0);
  check('off: nothing is refused', p.refuses(1, NPC) === false);
  check('off: the director is not told to skip', p.directorSkips(NPC) === false);
  check('off: polling says nothing', p.poll(1000) === null);
  check('off: no timed pass is registered, so it costs the server nothing',
    every.calls.length === 0, every.calls.map((c) => c.name));
  check('off: the global refuser still answers, and answers false',
    typeof globalThis.__dboServerHostRefuses === 'function' && globalThis.__dboServerHostRefuses(1, NPC) === false);
}

// ---- observe tags and watches, but refuses nothing ----
{
  const mp = makeMp();
  const { p, every } = start(mod, 'observe', mp, {});
  p.apply();
  check('observe: the NPC carries the tag', p.tagged(NPC) === true && mp.props.get(NPC)['private.dboServerHost'] === true);
  check('observe: refuses nothing — this mode only measures', p.refuses(1, NPC) === false);
  check('observe: but the director still skips it, or its 1 s pass beats the measurement',
    p.directorSkips(NPC) === true);
  check('observe: an untagged NPC is not skipped', p.directorSkips(OTHER) === false);
  check('observe: a 1 s watch pass and a summary pass are registered',
    every.calls.length === 2 && every.calls[0].ms === 1000 && every.calls[1].ms === 10000,
    every.calls.map((c) => [c.name, c.ms]));
}

// ---- pin refuses every attempt on the tagged NPC, and only that one ----
{
  const mp = makeMp();
  const { p } = start(mod, 'pin', mp, {});
  p.apply();
  check('pin: every requester is refused for the tagged NPC',
    p.refuses(0x14, NPC) === true && p.refuses(0x999, NPC) === true);
  check('pin: another NPC is untouched', p.refuses(0x14, OTHER) === false);
  check('pin: a zero id is refused nothing (the chain must not throw on it)', p.refuses(0x14, 0) === false);
  check('pin: the global refuser gamemode.js calls refuses too, and counts it',
    globalThis.__dboServerHostRefuses(0x14, NPC) === true && p.stats().refused === 1, p.stats());
  check('pin: the global skip npcdirector.js calls agrees with directorSkips',
    globalThis.__dboServerHostSkips(NPC) === true && globalThis.__dboServerHostSkips(OTHER) === false);
}

// ---- the registered pass must survive being run; it is the only code that runs unattended on dev ----
{
  const mp = makeMp();
  const { p, every, lines } = start(mod, 'observe', mp, {});
  mp.hosters.set(NPC, 0x14);
  every.calls[0].cb();                       // first tick: tags, records the starting hoster
  mp.hosters.set(NPC, 0x15);
  every.calls[0].cb();                       // second tick: a change, which must be logged
  check('the watch pass tags the NPC without being told to', p.tagged(NPC) === true);
  check('the watch pass logs the host change with both ids',
    lines.some((l) => l.includes('ff001234') && l.includes('14 -> 15')), lines);
  every.calls[1].cb();
  check('the summary pass logs the counts', lines.some((l) => l.includes('"changes":1')), lines);
}

// ---- the host-change log: the sequence and its timing are the whole point ----
{
  const mp = makeMp();
  const st = {};
  const { p } = start(mod, 'observe', mp, st);
  p.apply();
  mp.hosters.set(NPC, 0x14);
  const first = p.poll(1000);
  check('the first poll records the starting hoster without calling it a change', !!first && first.first === true && first.hoster === 0x14);
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

// ---- the guards: a form that has gone must not throw into the host chain ----
{
  const { p } = start(mod, 'pin', makeMp({ getThrows: true }), {});
  check('a throwing mp.get leaves the NPC untagged rather than throwing', p.tagged(NPC) === false);
  check('...and refuses nothing, so a gone form cannot block every host attempt', p.refuses(1, NPC) === false);
  const { p: q } = start(mod, 'pin', makeMp({ hosterThrows: true }), {});
  q.apply();
  check('a throwing getHoster polls to a hoster of 0 rather than throwing', (q.poll(1) || {}).hoster === 0);
  const { p: r } = start(mod, 'pin', makeMp({ setThrows: true }), {});
  check('a read-only form does not throw out of apply', (() => { try { r.apply(); return true; } catch (e) { return false; } })());
  check('a gamemode with no `every` loads without throwing, and still answers the chain',
    (() => { try { return start(mod, 'pin', makeMp(), {}, { noEvery: true }).p.refuses(1, NPC) === false; } catch (e) { return false; } })());
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
  check('gamemode.js: ...inside hostAttemptHook, beside the director\'s own refusal',
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
}

// ---- mutants: each altered copy must fail at least one check above ----
const scenarios = (M) => {
  let bad = 0;
  const c = (ok) => { if (!ok) bad++; };
  const mp = makeMp();
  const { p, every } = start(M, 'pin', mp, {});
  p.apply();
  c(p.tagged(NPC) === true);
  c(p.refuses(0x14, NPC) === true);
  c(p.refuses(0x14, OTHER) === false);
  c(p.directorSkips(NPC) === true);
  c(globalThis.__dboServerHostRefuses(0x14, NPC) === true);
  c(every.calls.length === 2);
  const mp2 = makeMp();
  const { p: off, every: every2 } = start(M, 'off', mp2, {});
  off.apply();
  c(off.tagged(NPC) === false);
  c(off.refuses(0x14, NPC) === false);
  c(globalThis.__dboServerHostRefuses(0x14, NPC) === false);
  c(every2.calls.length === 0);
  const mp3 = makeMp();
  const { p: ob, lines } = start(M, 'observe', mp3, {});
  ob.apply();
  c(ob.refuses(0x14, NPC) === false);
  mp3.hosters.set(NPC, 0x14);
  ob.poll(1000);
  mp3.hosters.set(NPC, 0x15);
  const ch = ob.poll(3000);
  c(!!ch && ch.from === 0x14 && ch.to === 0x15 && ch.afterMs === 2000);
  c(Array.isArray(lines));
  return bad;
};
check('the scenarios pass on serverhostpin.js as it is', scenarios(mod) === 0);

const MUTANTS = [
  ['pin refuses everything, tagged or not', "pinning && !!id && tagged(id >>> 0)", "pinning && !!id"],
  ['observe refuses too', "const pinning = C.mode === 'pin';", "const pinning = on;"],
  ['off is not inert', "const on = C.mode === 'observe' || C.mode === 'pin';", "const on = true;"],
  ['the director is not told to skip', "on && !!id && tagged(id >>> 0)", "false"],
  ['apply does not tag at all', "if (!tagged(npc)) tag(npc, true);", "/* not tagged */"],
  ['the change gap is not measured', "const gap = S.lastChangeAt ? now - S.lastChangeAt : 0;", "const gap = 0;"],
  ['the global refuser never refuses', "const no = refuses(requester, id);", "const no = false;"],
  ['the timed passes are registered even when off', "if (on && npc && typeof every === 'function') {", "if (npc && typeof every === 'function') {"],
];
// Deliberately NOT a mutant: dropping the `!!id` guard from refuses(). It is EQUIVALENT rather than
// surviving — form 0 carries no properties, so `tagged(0)` is false with or without the guard and no
// behaviour changes. A mutant that cannot alter behaviour proves nothing about the checks, and leaving it in
// the list would be a standing FAIL that the next person has to re-derive. The guard stays in the module
// because reading a property off id 0 is not something to rely on, not because a test caught it.
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
