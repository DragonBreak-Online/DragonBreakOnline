// The passive progress bar (features/progressBar; Payne, 3 Nov: "the searching bar gets stuck on screen"): drawn while
// the server's beat runs, closed by the server, and hidden by itself PROGRESS_GRACE_MS after it filled if that close never
// came. Compiled on its own and run against a small hooks stand-in with fake timers. The mutants at the end must each fail.
//   node tests/progress-bar-expire-harness.js        (from skymp5-front)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!ok) failures++; };

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-progress-'));
const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
if (!fs.existsSync(tsc)) { console.log('skipped: no typescript in the front\'s node_modules'); process.exit(0); }
try {
  execFileSync(process.execPath, [tsc, path.join(ROOT, 'src', 'features', 'progressBar', 'index.tsx'), '--outDir', OUT, '--module', 'commonjs', '--target', 'es2019', '--skipLibCheck', '--noResolve', '--jsx', 'react', '--esModuleInterop'], { stdio: 'pipe' });
} catch (e) { /* the emitted file is checked below */ }
const COMPILED = path.join(OUT, 'index.js');
if (!fs.existsSync(COMPILED)) { console.log('FAIL progressBar/index.tsx did not compile'); process.exit(1); }
const SRC = fs.readFileSync(COMPILED, 'utf8');

// One component instance: its state and effects kept by call order, as React keeps them
const hooks = { state: [], effects: [], i: 0, j: 0 };
const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => { const k = hooks.i++; if (!(k in hooks.state)) hooks.state[k] = init; return [hooks.state[k], (v) => { hooks.state[k] = v; }]; },
  useEffect: (fn, deps) => {
    const k = hooks.j++, was = hooks.effects[k];
    if (was && deps && was.deps && deps.length === was.deps.length && deps.every((d, n) => d === was.deps[n])) return;
    if (was && typeof was.cleanup === 'function') was.cleanup();
    hooks.effects[k] = { deps, cleanup: fn() };
  },
};
React.default = React;
const resolve0 = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'react' ? 'react' : /\.scss$/.test(req) ? 'scss-stub' : resolve0.call(this, req, ...rest); };
require.cache.react = { id: 'react', filename: 'react', loaded: true, exports: React };
require.cache['scss-stub'] = { id: 'scss-stub', filename: 'scss-stub', loaded: true, exports: {} };

// Fake timers: run(ms) moves the clock and fires what is due
let clock = 0, timers = [];
global.setTimeout = (fn, ms) => { const t = { at: clock + ms, fn }; timers.push(t); return t; };
global.clearTimeout = (t) => { timers = timers.filter((x) => x !== t); };
const run = (ms) => { clock += ms; const due = timers.filter((t) => t.at <= clock); timers = timers.filter((t) => t.at > clock); due.forEach((t) => t.fn()); };

const load = (src) => { const f = path.join(OUT, `pb-${Math.random().toString(36).slice(2)}.js`); fs.writeFileSync(f, src); return require(f); };
const behaviour = (M, c) => {
  hooks.state = []; hooks.effects = []; clock = 0; timers = [];
  const Bar = M.default;
  const draw = (data) => { hooks.i = 0; hooks.j = 0; return Bar({ data }); };
  const grace = M.PROGRESS_GRACE_MS;
  const search = { title: 'Searching', ms: 2000, startedAt: 1000, kind: 'search' };
  const first = draw(search);
  c('a search bar is drawn with its title', !!first && JSON.stringify(first).includes('Searching'));
  c('the grace is a few seconds', grace >= 1000 && grace <= 10000, grace);
  run(2000 + grace - 1);
  c('...and still drawn until just before it has been full for the grace', !!draw(search));
  run(1);
  c('...then hides itself when the server\'s close never came', draw(search) === null);
  const next = Object.assign({}, search, { startedAt: 9000 });
  c('a new beat in the same widget is drawn again', !!draw(next));
  run(2000 + grace);
  c('...and hides itself in turn', draw(next) === null);
  c('a bar with no time draws nothing', draw({ title: 'x', ms: 0 }) === null);
};
behaviour(load(SRC), check);

const MUTANTS = [
  ['never hides itself', 'setExpired(beat)', 'void 0'],
  ['hides at once', 'ms + exports.PROGRESS_GRACE_MS', '0'],
];
for (const [name, a, b] of MUTANTS) {
  if (!SRC.includes(a)) { check(`mutant "${name}": its text is in the compiled module`, false, a); continue; }
  let bad = 0;
  try { behaviour(load(SRC.split(a).join(b)), (w, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  check(`mutant caught: ${name}`, bad > 0);
}
fs.rmSync(OUT, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
