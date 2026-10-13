// Scripted test for deadCritterPolicy (view/deadCritterPolicy.ts): dead hawks' bodies pile up because the cell never
// resets while the player stays logged in (Nate, 14 Oct). A body goes after 5 minutes, or the oldest once more than 4 are
// seen, never while the player stands at it; plugin-placed refs are never touched. Run from skymp5-client:
//   node tests/dead-critter-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP dead-critter (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-deadcritter-'));
  const out = path.join(dir, 'b.js');
  await esbuild.build({ entryPoints: [path.resolve(__dirname, '../src/view/deadCritterPolicy.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'silent' });
  const { deadBodiesToRemove, isSpawnedBody, DEAD_CRITTER_RULES } = require(out);
  const MIN = 60000, far = () => false;
  const body = (id, ageMin, now) => ({ id, firstSeenMs: now - ageMin * MIN });
  const now = 100 * MIN;

  check('the rules: 5 minutes, at most 4 bodies', DEAD_CRITTER_RULES.maxAgeMs === 5 * MIN && DEAD_CRITTER_RULES.maxBodies === 4);
  check('a fresh body stays (time to walk up and loot it)', deadBodiesToRemove([body(1, 1, now)], now, far).length === 0);
  check('a body 5 minutes old goes', JSON.stringify(deadBodiesToRemove([body(1, 5, now), body(2, 1, now)], now, far)) === '[1]');
  check('...not while the player stands at it (looting)', deadBodiesToRemove([body(1, 9, now)], now, (id) => id === 1).length === 0);
  const pile = [body(1, 4, now), body(2, 3, now), body(3, 2, now), body(4, 1, now), body(5, 0.5, now), body(6, 0.2, now)];
  check('a pile of 6 fresh bodies loses its 2 oldest', JSON.stringify(deadBodiesToRemove(pile, now, far)) === '[1,2]', deadBodiesToRemove(pile, now, far));
  const old = [1, 2, 3, 4, 5, 6, 7].map((i) => body(i, 10 + i, now));
  check('at most 4 go in one pass, oldest first', JSON.stringify(deadBodiesToRemove(old, now, far)) === '[7,6,5,4]', deadBodiesToRemove(old, now, far));
  check('a hawk this session placed is a spawned body; a plugin-placed ref is not', isSpawnedBody(0xff0012ab) && !isSpawnedBody(0x0010abcd));

  const svc = fs.readFileSync(path.resolve(__dirname, '../src/services/services/deadCritterService.ts'), 'utf8');
  check('the service watches fcHawkGO and DLC1BoneHawkGO', /0x105821, "Skyrim\.esm"/.test(svc) && /0x002992, "Dawnguard\.esm"/.test(svc));
  check('...only spawned bodies, and it is registered', /isSpawnedBody\(ref\.getFormID\(\)\)/.test(svc) && /new DeadCritterService\(sp, controller\)/.test(fs.readFileSync(path.resolve(__dirname, '../src/index.ts'), 'utf8')));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `${failures} failed` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL', e); process.exit(1); });
