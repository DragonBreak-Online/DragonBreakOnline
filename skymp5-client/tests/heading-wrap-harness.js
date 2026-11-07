// Heading differences on other players' copies wrap at 360 (sync/headingDelta.ts; Nat, 7 Nov: "other players wiggle back and
// forth while standing idle"). Headings run 0 to 360 (the server's change forms hold 0..360, none negative), so a copy facing
// north read 359 against 1 as 358 off: movementApply turned it the long way and re-translated it on every update.
// The mutants at the end must each fail.
//   node tests/heading-wrap-harness.js        (from skymp5-client)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SYNC = path.join(ROOT, 'src', 'sync');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!ok) failures++; };

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-heading-'));
try {
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), path.join(SYNC, 'headingDelta.ts'),
    '--outDir', OUT, '--module', 'commonjs', '--target', 'es2019', '--skipLibCheck'], { stdio: 'pipe' });
} catch (e) { /* the emitted file is checked below */ }
const COMPILED = path.join(OUT, 'headingDelta.js');
const SRC = fs.existsSync(COMPILED) ? fs.readFileSync(COMPILED, 'utf8') : '';
check('headingDelta.ts compiles', !!SRC);
const load = (src) => { const f = path.join(OUT, `hd-${Math.random().toString(36).slice(2)}.js`); fs.writeFileSync(f, src); return require(f); };

const behaviour = (M, c) => {
  const d = M.headingDelta;
  c('359 against 1 is 2 degrees back, not 358', Math.abs(d(359, 1) - -2) < 1e-9, d(359, 1));
  c('1 against 359 is 2 degrees on', Math.abs(d(1, 359) - 2) < 1e-9, d(1, 359));
  c('a plain difference is unchanged (90 against 60 is 30, 60 against 90 is -30)', d(90, 60) === 30 && d(60, 90) === -30);
  let worst = 0;
  for (let a = 0; a < 360; a += 7.5) for (let b = 0; b < 360; b += 7.5) { const x = d(a, b); if (x < -180 || x >= 180) worst++; if (Math.abs((((b + x) % 360) + 360) % 360 - a) > 1e-9) worst++; }
  c('every pair lands in -180..180 and turns b onto a', worst === 0, worst);
  // the standing deadzone (12) and the re-translate gate (80) now see a copy facing north as still
  c('a standing copy facing north is inside the 12 degree deadzone', Math.abs(d(358.5, 3)) < 12);
  c('...and under the 80 degree re-translate gate', Math.abs(d(0.5, 359.5)) <= 80);
};
if (SRC) behaviour(load(SRC), check);

const mas = fs.readFileSync(path.join(SYNC, 'movementApply.ts'), 'utf8');
check('keep-offset turns by the wrapped difference', /let offsetAngle = headingDelta\(m\.rot\[2\], ac\.getAngleZ\(\)\);/.test(mas));
check('...and the re-translate gate compares the wrapped difference', /const angleDiff = Math\.abs\(headingDelta\(m\.rot\[2\], refr\.getAngleZ\(\)\)\);/.test(mas));
check('no raw heading subtraction is left in movementApply', !/m\.rot\[2\] - (ac|refr)\.getAngleZ\(\)/.test(mas));

const MUTANTS = [
  ['no wrap', 'const d = (((a - b) % 360) + 360) % 360;', 'const d = a - b + 360;'],
  ['the wrong half', 'return d >= 180 ? d - 360 : d;', 'return d;'],
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
