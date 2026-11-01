// Keeping the previous sessions' diagnostic log (diagLogRotate.ts). SkyrimPlatform truncates
// dbo-diag-logs.txt for each session, and on 31 Oct that destroyed the evidence twice in one evening - the
// session where Nat could not move, and the 171-form crowd at 34 ms/frame - because diagnosing either meant
// relaunching first. Driven with a fake fs, so the shift order is proven rather than hoped for.
//
//   node tests/diag-rotate-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const client = path.resolve(__dirname, '..');
const ts = require(path.join(client, 'node_modules', 'typescript'));
const LF = (s) => s.split(String.fromCharCode(13) + String.fromCharCode(10)).join(String.fromCharCode(10));
let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};
const load = (src) => {
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const mod = {};
  new Function('exports', js)(mod);
  return mod;
};
const srcPath = path.join(client, 'src', 'services', 'services', 'diagLogRotate.ts');
const planSrc = LF(fs.readFileSync(srcPath, 'utf8'));
const plan = load(planSrc);

// A fake fs: `files` maps name -> size, and every call is recorded so the ORDER can be asserted.
const makeFs = (files, opts) => {
  const o = opts || {};
  const calls = [];
  return {
    calls,
    files,
    existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
    statSync: (p) => {
      if (o.statThrows) throw new Error('stat');
      return { size: files[p] };
    },
    renameSync: (a, b) => {
      calls.push(['rename', a, b]);
      if (o.renameThrows === a) throw new Error('locked');
      // Windows: a rename onto an existing file fails. Modelling this is what makes the unlink-first and
      // the oldest-first order observable at all.
      if (Object.prototype.hasOwnProperty.call(files, b)) throw new Error('EEXIST ' + b);
      files[b] = files[a];
      delete files[a];
    },
    unlinkSync: (p) => {
      calls.push(['unlink', p]);
      if (o.unlinkThrows) throw new Error('locked');
      delete files[p];
    },
  };
};
const BASE = plan.DIAG_LOG;
const P = (n) => plan.prevName(BASE, n);

check('the live log is the one the launcher collects', BASE === './Data/Platform/Logs/dbo-diag-logs.txt', BASE);
check('older copies sit beside it with a .prevN name',
  P(1).endsWith('dbo-diag-logs.prev1.txt') && P(2).endsWith('dbo-diag-logs.prev2.txt'), [P(1), P(2)]);
check('it keeps the current session plus two older', plan.DIAG_KEEP === 3);

let f = makeFs({});
check('no log yet: nothing to do, and no rename attempted',
  plan.rotateDiagLogs(f) === 'absent' && f.calls.length === 0, f.calls);

f = makeFs({ [BASE]: 1200 });
check('a session with content is moved to prev1, freeing the live name',
  plan.rotateDiagLogs(f) === 'rotated' && f.files[P(1)] === 1200 && !f.files[BASE], Object.keys(f.files));

f = makeFs({ [BASE]: 0, [P(1)]: 900 });
check('an EMPTY live log is left alone, so a real previous session is not pushed out',
  plan.rotateDiagLogs(f) === 'empty' && f.files[P(1)] === 900 && f.calls.length === 0, f.calls);

f = makeFs({ [BASE]: 300, [P(1)]: 200, [P(2)]: 100 });
const r = plan.rotateDiagLogs(f);
check('a full window shifts along and drops only the oldest',
  r === 'rotated' && f.files[P(1)] === 300 && f.files[P(2)] === 200 && !f.files[P(3)], f.files);
check('...and the oldest is removed BEFORE anything moves onto it',
  f.calls[0][0] === 'unlink' && f.calls[0][1] === P(2), f.calls);
check('...and the shift runs oldest-first, so no copy is overwritten before it has moved',
  JSON.stringify(f.calls.map((c) => c[0])) === JSON.stringify(['unlink', 'rename', 'rename']),
  f.calls.map((c) => c[0]));

f = makeFs({ [BASE]: 500 }, { statThrows: true });
check('an unreadable stat keeps the log rather than discarding it',
  plan.rotateDiagLogs(f) === 'rotated' && f.files[P(1)] === 500);
f = makeFs({ [BASE]: 500, [P(1)]: 400 }, { renameThrows: P(1) });
check('a locked older copy does not stop this session being kept',
  plan.rotateDiagLogs(f) === 'rotated' && f.files[P(1)] === 500, f.files);
f = makeFs({ [BASE]: 500, [P(2)]: 1 }, { unlinkThrows: true });
check('an undeletable oldest copy does not stop the rotation', plan.rotateDiagLogs(f) === 'rotated');
check('a broken fs returns failed instead of throwing into startup',
  plan.rotateDiagLogs({
    existsSync: () => {
      throw new Error('boom');
    },
  }) === 'failed');
check('keep=1 still frees the live name', (() => {
  const g = makeFs({ [BASE]: 10 });
  return plan.rotateDiagLogs(g, BASE, 1) === 'rotated' && g.files[P(1)] === 10;
})());

// The wiring matters as much as the logic: the first writeLogs call is what truncates, so this must run first.
const idx = LF(fs.readFileSync(path.join(client, 'src', 'index.ts'), 'utf8'));
check('index.ts calls it', /rotateDiagLogs\(fsModule\)/.test(idx));
check('...inside a try, so diagnostics cannot stop the client starting', /try \{ rotateDiagLogs\(fsModule\)/.test(idx));
check('...before ClientDiagService, which is itself first',
  idx.indexOf('rotateDiagLogs(fsModule)') < idx.indexOf('new ClientDiagService'),
  { rotate: idx.indexOf('rotateDiagLogs(fsModule)'), diag: idx.indexOf('new ClientDiagService') });

// keep=4 so the shift is two iterations: with one, direction cannot be told apart.
f = makeFs({ [BASE]: 4, [P(1)]: 3, [P(2)]: 2, [P(3)]: 1 });
check('a deeper window shifts every copy along and drops only the oldest',
  plan.rotateDiagLogs(f, BASE, 4) === 'rotated' && f.files[P(1)] === 4 && f.files[P(2)] === 3 &&
  f.files[P(3)] === 2 && !f.files[P(4)], f.files);

const mutants = [
  ['the empty-log guard removed', (s) => s.replace('if (size <= 0) {', 'if (false) {')],
  ['the oldest is not removed first', (s) => s.replace('if (fsLike.existsSync(prevName(base, oldest))) {', 'if (false) {')],
  ['the shift runs newest-first, overwriting', (s) => s.replace('for (let n = oldest - 1; n >= 1; n--) {', 'for (let n = 1; n <= oldest - 1; n++) {')],
  ['the live log is never moved', (s) => s.replace('fsLike.renameSync(base, prevName(base, 1));', '')],
];
let killed = 0;
for (const [name, mutate] of mutants) {
  const mutated = mutate(planSrc);
  if (mutated === planSrc) {
    console.log(`FAIL mutant "${name}" did not apply`);
    failures++;
    continue;
  }
  let survived = true;
  try {
    const m = load(mutated);
    const a = makeFs({ [BASE]: 0, [P(1)]: 900 });
    const b = makeFs({ [BASE]: 300, [P(1)]: 200, [P(2)]: 100 });
    const rb = m.rotateDiagLogs(b);
    const c = makeFs({ [BASE]: 4, [P(1)]: 3, [P(2)]: 2, [P(3)]: 1 });
    const rc = m.rotateDiagLogs(c, BASE, 4);
    const broke =
      m.rotateDiagLogs(a) !== 'empty' || a.files[P(1)] !== 900 ||
      rb !== 'rotated' || b.files[P(1)] !== 300 || b.files[P(2)] !== 200 || !!b.files[P(3)] ||
      rc !== 'rotated' || c.files[P(1)] !== 4 || c.files[P(2)] !== 3 || c.files[P(3)] !== 2 || !!c.files[P(4)];
    survived = !broke;
  } catch {
    survived = false;
  }
  if (survived) {
    console.log(`FAIL mutant survived: ${name}`);
    failures++;
  } else {
    killed++;
  }
}
console.log(`ok   ${killed}/${mutants.length} mutants killed`);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
