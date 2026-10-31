// Scripted test for the npcDrift log sampling in gamemode.js (31 Oct): at Nat's Bruma event that one log() was
// 2,080 lines/min and 0.76 MB/min, so the chatty kinds are now logged 1 in DRIFT_LOG.sample. The two things that
// must NOT change are the side effects: driftNote fills HOST_OF for a heartbeat, and the heartbeat drives door
// sync, so both have to run for EVERY packet whether its line is logged or not.
// It cuts the real block out of gamemode.js and runs it with stand-ins. Run it from this folder's parent with
//
//   node tests/drift-log-sample-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const a = src.indexOf('// The drift diagnostic is the main instrument');
const b = src.indexOf('// The staff trace (client staffHit.ts)', a);
if (a < 0 || b < 0) { console.log('FAIL the npcDrift sampling markers are gone from gamemode.js'); process.exit(1); }
const blockSrc = src.slice(a, b);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

// --- the stand-ins -------------------------------------------------------------------------------------------
const load = (cfg, keepCounters) => {
  if (!keepCounters) delete globalThis.__dboDriftSeen;
  const st = { logged: [], timers: new Map(), noteCalls: 0, doorCalls: 0, handler: null };
  globalThis.__dboDoorSync = { heartbeat: () => { st.doorCalls++; } };
  const onUi = (name, fn) => { if (name === 'npcDrift') st.handler = fn; };
  const every = (name, ms, fn) => st.timers.set(name, fn);
  const log = (line) => st.logged.push(String(line));
  const display = (x) => `P${x}`;
  const driftNote = () => { st.noteCalls++; return ''; };
  new Function('cfg', 'onUi', 'every', 'log', 'display', 'driftNote', 'globalThis', blockSrc)(
    cfg, onUi, every, log, display, driftNote, globalThis);
  return st;
};
const send = (st, kind, n) => { for (let i = 0; i < n; i++) st.handler(1, [{ kind, remoteId: 'ff001234' }]); };
const linesFor = (st, kind) => st.logged.filter((l) => l.indexOf(`npcDrift P1 ${kind}:`) === 0 || l.indexOf(` ${kind}: `) > 0).length;

// --- 1. the chatty kinds are sampled, the useful ones are not ------------------------------------------------
{
  const st = load({ driftLog: { sample: 20 } });
  check('the handler was registered', typeof st.handler === 'function');

  send(st, 'factions', 100);
  const factions = st.logged.filter((l) => l.includes('factions:')).length;
  check('a chatty kind is logged 1 in 20', factions === 5, { of: 100, logged: factions });

  st.logged.length = 0;
  send(st, 'perf', 100);
  const perf = st.logged.filter((l) => l.includes('perf:')).length;
  check('perf is never sampled - it is the client fps/jsMs instrument', perf === 100, { of: 100, logged: perf });

  st.logged.length = 0;
  send(st, 'locomotion', 7);
  check('a rare kind is never sampled', st.logged.filter((l) => l.includes('locomotion:')).length === 7);
}

// --- 2. the side effects run for EVERY packet, logged or not -------------------------------------------------
{
  const st = load({ driftLog: { sample: 20 } });
  send(st, 'factions', 60);
  check('driftNote runs for every packet, not only the logged ones (it fills HOST_OF)', st.noteCalls === 60, { notes: st.noteCalls });

  const st2 = load({ driftLog: { sample: 20 } });
  send(st2, 'heartbeat', 50);
  const hbLines = st2.logged.filter((l) => l.includes('heartbeat:')).length;
  check('a heartbeat reaches door sync every time', st2.doorCalls === 50, { door: st2.doorCalls });
  check('...while only a sample of heartbeats is logged', hbLines === 3, { logged: hbLines });
}

// --- 3. the documented rollback ------------------------------------------------------------------------------
{
  const st = load({ driftLog: { sample: 1 } });
  send(st, 'factions', 40);
  check('sample 1 logs everything again (the ROLLBACK in the comment)', st.logged.filter((l) => l.includes('factions:')).length === 40);

  const st2 = load({ driftLog: { sample: 'off' } });
  send(st2, 'factions', 12);
  check('a nonsense sample value logs everything rather than nothing', st2.logged.filter((l) => l.includes('factions:')).length === 12);
}

// --- 4. nothing is dropped silently: the minute summary accounts for it --------------------------------------
{
  const st = load({ driftLog: { sample: 20 } });
  send(st, 'factions', 100);
  send(st, 'remote', 40);
  st.logged.length = 0;
  const summary = st.timers.get('driftLogSummary');
  check('the summary timer is registered', typeof summary === 'function');
  summary();
  const line = st.logged.join(' ');
  check('the summary names each sampled kind and how many went unlogged',
    line.includes('factions 5 logged, 95 not') && line.includes('remote 2 logged, 38 not'), line.slice(0, 160));

  st.logged.length = 0;
  summary();
  check('the summary clears, so a quiet minute prints nothing', st.logged.length === 0);

  st.logged.length = 0;
  send(st, 'perf', 30);
  summary();
  // the 30 perf lines are logged on purpose; what must not appear is a SUMMARY, since nothing was dropped
  const summaries = st.logged.filter((l) => l.startsWith('npcDrift sampled'));
  check('a minute that dropped nothing prints no summary (perf alone is not "dropped")',
    summaries.length === 0 && st.logged.length === 30, { summaries: summaries.length, perfLines: st.logged.length });
}

// --- 5. a hot reload keeps the running minute's counts -------------------------------------------------------
{
  const st = load({ driftLog: { sample: 20 } });
  send(st, 'factions', 10);
  const st2 = load({ driftLog: { sample: 20 } }, true);   // reload, counters kept
  send(st2, 'factions', 10);
  const summary = st2.timers.get('driftLogSummary');
  st2.logged.length = 0;
  summary();
  check('a hot reload keeps the minute count instead of restarting it',
    st2.logged.join(' ').includes('factions 1 logged, 19 not'), st2.logged.join(' ').slice(0, 120));
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
