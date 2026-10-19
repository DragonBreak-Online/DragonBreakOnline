// Reads a .cpuprofile from lib/cpu-window.js and says what holds the event loop.
//   node tools/loadtest/cpu-profile-report.js <file.cpuprofile> [--bundle dist_back/skymp5-server.js] [--long 50] [--top 25]
// A "busy stretch" is a run of samples with no (idle) between them: the loop never got back to waiting, so a timer due
// inside it fires late by about that much. Stretches over --long ms are the loop-lag tail; for them the report gives
// the frames that held the most time (inclusive: anywhere on the stack; self: the leaf), and the longest stretches one
// by one. --bundle names the class around a bundle frame (esbuild keeps class names), since every system's method is
// just "updateAsync" in the profile. (program) is native code with no JS frame above it; tick (or the frame that called
// into C++) holds the native tick's own time.
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
if (!file) { console.error('usage: cpu-profile-report.js <file.cpuprofile> [--bundle <js>] [--long 50] [--top 25]'); process.exit(2); }
const LONG_MS = Number(opt('--long', 50));
const TOP = Number(opt('--top', 25));
const bundleFile = opt('--bundle', null);

const prof = JSON.parse(fs.readFileSync(file, 'utf8'));
const nodes = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);

// Class names around bundle lines, read once
let bundleLines = null;
if (bundleFile) { try { bundleLines = fs.readFileSync(bundleFile, 'utf8').split('\n'); } catch (e) { console.error(`bundle unreadable: ${e.message}`); } }
const classCache = new Map();
const classAt = (line) => {
  if (!bundleLines || line < 0) return '';
  if (classCache.has(line)) return classCache.get(line);
  let name = '';
  for (let i = Math.min(line, bundleLines.length - 1); i >= 0 && i > line - 4000; i--) {
    const m = /\bclass\s+([A-Za-z_$][\w$]*)/.exec(bundleLines[i]);
    if (m) { name = m[1]; break; }
  }
  classCache.set(line, name);
  return name;
};
const label = (id) => {
  const cf = nodes.get(id).callFrame;
  const base = cf.url ? path.basename(cf.url.replace(/^file:\/\/\/?/, '')) : '';
  const fn = cf.functionName || '(anonymous)';
  if (!base) return fn;
  const cls = bundleLines && /skymp5-server|dist_back/.test(cf.url) ? classAt(cf.lineNumber) : '';
  return `${cls ? cls + '.' : ''}${fn} ${base}:${cf.lineNumber + 1}`;
};
const isIdle = (id) => nodes.get(id).callFrame.functionName === '(idle)';
const stackOf = (id) => { const s = []; for (let n = id; n !== undefined; n = parent.get(n)) s.push(n); return s; };

// Per-sample durations: timeDeltas[i] is the gap before sample i, so sample i lasts until sample i+1
const samples = prof.samples;
const deltas = prof.timeDeltas;
const dur = new Float64Array(samples.length);
for (let i = 0; i < samples.length; i++) dur[i] = (i + 1 < samples.length ? deltas[i + 1] : 0) / 1000;
const totalMs = (prof.endTime - prof.startTime) / 1000;

const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
const selfAll = new Map(); const inclAll = new Map();
const selfLong = new Map(); const inclLong = new Map();
let busyMs = 0;
const stretches = [];
let cur = null;
for (let i = 0; i < samples.length; i++) {
  const id = samples[i];
  if (isIdle(id)) { if (cur) { stretches.push(cur); cur = null; } continue; }
  busyMs += dur[i];
  if (!cur) cur = { start: i, end: i, ms: 0 };
  cur.end = i; cur.ms += dur[i];
}
if (cur) stretches.push(cur);

const tally = (i, self, incl) => {
  const id = samples[i];
  add(self, label(id), dur[i]);
  const seen = new Set();
  for (const n of stackOf(id)) { const l = label(n); if (!seen.has(l)) { seen.add(l); add(incl, l, dur[i]); } }
};
for (let i = 0; i < samples.length; i++) if (!isIdle(samples[i])) tally(i, selfAll, inclAll);
const long = stretches.filter((s) => s.ms >= LONG_MS);
let longMs = 0;
for (const s of long) { longMs += s.ms; for (let i = s.start; i <= s.end; i++) tally(i, selfLong, inclLong); }

const top = (m, n, of) => [...m.entries()].filter(([k]) => k !== '(root)').sort((a, b) => b[1] - a[1]).slice(0, n)
  .map(([k, v]) => `  ${v.toFixed(1).padStart(9)} ms ${(100 * v / of).toFixed(1).padStart(5)}%  ${k}`).join('\n');
const pct = (a, b) => (100 * a / b).toFixed(1);

const lens = stretches.map((s) => s.ms).sort((a, b) => a - b);
const q = (p) => (lens.length ? lens[Math.min(lens.length - 1, Math.floor(p * lens.length))] : 0);
console.log(`profile ${path.basename(file)}: ${(totalMs / 1000).toFixed(1)} s, ${samples.length} samples, busy ${busyMs.toFixed(0)} ms (${pct(busyMs, totalMs)}%)`);
console.log(`busy stretches: ${stretches.length}; p50 ${q(0.5).toFixed(1)} ms, p99 ${q(0.99).toFixed(1)} ms, max ${q(1).toFixed(1)} ms; ` +
  `${long.length} over ${LONG_MS} ms holding ${longMs.toFixed(0)} ms (${pct(longMs, busyMs)}% of busy time)`);
console.log(`\nall busy time, inclusive (top ${TOP}):\n${top(inclAll, TOP, busyMs)}`);
console.log(`\nall busy time, self (top ${TOP}):\n${top(selfAll, TOP, busyMs)}`);
if (long.length) {
  console.log(`\nstretches over ${LONG_MS} ms, inclusive (top ${TOP}):\n${top(inclLong, TOP, longMs)}`);
  console.log(`\nstretches over ${LONG_MS} ms, self (top ${TOP}):\n${top(selfLong, TOP, longMs)}`);
  console.log('\nthe 10 longest stretches:');
  for (const s of [...long].sort((a, b) => b.ms - a.ms).slice(0, 10)) {
    const incl = new Map(); const self = new Map();
    for (let i = s.start; i <= s.end; i++) tally(i, self, incl);
    const at = (prof.timeDeltas.slice(0, s.start + 1).reduce((x, y) => x + y, 0) / 1e6).toFixed(2);
    console.log(` ${s.ms.toFixed(1)} ms at +${at} s:`);
    console.log(top(incl, 6, s.ms));
  }
}
