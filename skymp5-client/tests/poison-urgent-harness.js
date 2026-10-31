// Scripted test for the spendsPoison predicate in craftedExtrasService.ts (Worker 2, 31 Oct): a spent poison
// charge has to make the crafted-extras report URGENT, because the report also holds the 5 s pc-inventory
// re-apply. Without it a coat spent on an unjudged blow (a blocked one) came back on an unequipped weapon.
//
// It cuts the predicate out of the real source rather than restating it, and compiles that slice with esbuild.
// Only the predicate: getCraftReport itself pulls in nine modules, and the one-token "|| spendsPoison(...)" in
// it is covered by tsc. Run from skymp5-client:
//
//   node tests/poison-urgent-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild'),
  'E:/DragonBreak Online Dev files/fork/skymp5-server/node_modules/esbuild'].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP poison-urgent (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

const SRC = path.resolve(__dirname, '../src/services/services/craftedExtrasService.ts');
const src = fs.readFileSync(SRC, 'utf8');
const a = src.indexOf('// A poison charge spent');
const b = src.indexOf('// Local copies with extras the server lacks', a);
if (a < 0 || b < 0) { console.log('FAIL the spendsPoison markers are gone from craftedExtrasService.ts'); process.exit(1); }
const slice = src.slice(a, b) + '\nmodule.exports = { spendsPoison };\n';

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

const js = esbuild.transformSync(slice, { loader: 'ts', format: 'cjs' }).code;
const m = {};
new Function('module', 'exports', js)(m, m);
const spendsPoison = (m.exports || m).spendsPoison;
check('the predicate compiled out of the real source', typeof spendsPoison === 'function');

// g is the local copy the player now holds; sources are the server copies it came from
const P = 0x1234, Q = 0x9999;

check('a coat part-spent on the same weapon is urgent (count fell)',
  spendsPoison({ poisonId: P, poisonCount: 2 }, [{ poisonId: P, poisonCount: 3 }]) === true);

check('a coat fully spent is urgent (the poison is gone)',
  spendsPoison({ poisonId: 0, poisonCount: 0 }, [{ poisonId: P, poisonCount: 1 }]) === true);

check('a different poison on it is urgent',
  spendsPoison({ poisonId: Q, poisonCount: 1 }, [{ poisonId: P, poisonCount: 1 }]) === true);

check('an unchanged coat is NOT urgent, so an ordinary tick still waits',
  spendsPoison({ poisonId: P, poisonCount: 3 }, [{ poisonId: P, poisonCount: 3 }]) === false);

check('a coat GAINED is not this predicate\'s business (isCraft already covers it)',
  spendsPoison({ poisonId: P, poisonCount: 1 }, [{ poisonId: 0, poisonCount: 0 }]) === false);

check('a weapon that never had poison is not urgent',
  spendsPoison({ poisonId: 0 }, [{ poisonId: 0 }]) === false);

check('a count that ROSE on the same poison is not urgent',
  spendsPoison({ poisonId: P, poisonCount: 5 }, [{ poisonId: P, poisonCount: 2 }]) === false);

check('any one spent source among several is enough',
  spendsPoison({ poisonId: P, poisonCount: 1 }, [{ poisonId: P, poisonCount: 1 }, { poisonId: P, poisonCount: 4 }]) === true);

check('no sources at all is not urgent',
  spendsPoison({ poisonId: P, poisonCount: 1 }, []) === false);

// undefined counts are the common shape: the field is absent until a poison is applied
check('absent counts do not throw and read as zero',
  spendsPoison({ poisonId: P }, [{ poisonId: P }]) === false);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
