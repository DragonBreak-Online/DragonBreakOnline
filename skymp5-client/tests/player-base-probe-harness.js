// The player-base probe (sync/playerBaseProbe.ts; tickets mod-0558/0601): when the player's own base reads null, one line
// goes through the client diag channel saying what Game.getFormEx(7) is, how many other players are spawned, how long
// since one despawned, and how many base ids took the player's id and how long ago; the first null and then one a minute,
// only for the player's reference. The hooks in inventory.ts, appearance.ts and remoteServer.ts are checked in their
// source. The mutants at the end run the behaviour checks on altered copies of the compiled module and must each fail.
//   node tests/player-base-probe-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const check = (what, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 300)}`); if (!ok) fails++; };

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-pbase-'));
// compiled on its own: tsc cannot see skyrimPlatform's types here and says so, but still writes the JS, which is all this needs
try {
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), path.join(ROOT, 'src', 'sync', 'playerBaseProbe.ts'),
    '--outDir', OUT, '--module', 'commonjs', '--target', 'es2019', '--skipLibCheck', '--noResolve'], { stdio: 'pipe' });
} catch (e) { /* type errors only; the emitted file is checked below */ }
if (!fs.existsSync(path.join(OUT, 'playerBaseProbe.js'))) { console.log('FAIL playerBaseProbe.ts did not compile'); process.exit(1); }
const COMPILED = path.join(OUT, 'playerBaseProbe.js');
const SRC = fs.readFileSync(COMPILED, 'utf8');

// skyrimPlatform, as the game would answer: Game.getFormEx(7) is whatever the test says it is
let form7 = null;
const resolve0 = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'skyrimPlatform' ? 'skyrimPlatform' : resolve0.call(this, req, ...rest); };
require.cache.skyrimPlatform = { id: 'skyrimPlatform', filename: 'skyrimPlatform', loaded: true, exports: { Game: { getFormEx: (id) => (id === 7 ? form7 : null) } } };

const load = (src) => {
  const file = path.join(OUT, `probe-${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(file, src);
  delete globalThis.__dboPlayerBaseProbe;
  return require(file);
};

const scenarios = (P, c) => {
  const lines = [];
  globalThis.__dboTrace = (t) => lines.push(String(t));
  form7 = null;
  P.noteRemotePlayerCreated(); P.noteRemotePlayerCreated(); P.noteRemotePlayerCreated();
  const t0 = Date.now();
  P.noteFormIdSwap(t0 - 5000); P.noteFormIdSwap(t0 - 4000);
  P.noteRemotePlayerDestroyed(t0 - 1500);
  P.notePlayerBaseNull('inventory', 0x14);
  c('the first null on the player\'s reference sends one line', lines.length === 1, lines);
  const l = lines[0] || '';
  c('...naming where, the reference and what getFormEx(7) gave', /^pbase null at=inventory refr=14 n=1 getFormEx\(7\)=null /.test(l), l);
  c('...the other players spawned (3 made, 1 gone) and how long since one despawned', / remotes=2 despawn=1[45]\d\dms /.test(l), l);
  c('...and the base ids swapped to the player\'s, and how long since', / swaps=2 swap=4\d\d\dms$/.test(l), l);
  P.notePlayerBaseNull('inventory', 0x14);
  P.notePlayerBaseNull('inventory', 0x14);
  c('the same null a frame later sends nothing more (one a minute)', lines.length === 1, lines.length);
  P.notePlayerBaseNull('inventory', 0xff000123);
  c('another reference\'s null is not the player\'s and sends nothing', lines.length === 1, lines.length);
  const s = globalThis.__dboPlayerBaseProbe;
  c('...nor is counted', s && s.nulls === 3, s && s.nulls);
  s.lastReportAt -= P.REPORT_EVERY_MS;
  form7 = { getType: () => 43, getName: () => 'Prisoner', getFormID: () => 7 };
  P.notePlayerBaseNull('inventory', 0x14);
  c('a minute on, still null: one more line, with the count and getFormEx(7) described', lines.length === 2 && /n=4 getFormEx\(7\)=type 43 name "Prisoner" id 7 /.test(lines[1] || ''), lines[1]);
  P.noteRemotePlayerDestroyed(Date.now()); P.noteRemotePlayerDestroyed(Date.now()); P.noteRemotePlayerDestroyed(Date.now());
  c('the spawned count never goes below none', globalThis.__dboPlayerBaseProbe.remotes === 0);
  const fresh = P.probeLine('x', 0x14, 'null', { remotes: 0, lastDespawnAt: 0, swaps: 0, lastSwapAt: 0, lastReportAt: 0, nulls: 1 }, 1000);
  c('nothing yet seen reads as "never"', / despawn=never swaps=0 swap=never$/.test(fresh), fresh);
  delete globalThis.__dboTrace;
  let threw = false;
  try { P.notePlayerBaseNull('inventory', 0x14); } catch (e) { threw = true; }
  c('with no diag channel it says nothing and never throws', !threw);
};

scenarios(load(SRC), check);

// ---- the hooks ----
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const inv = src('src/sync/inventory.ts'), app = src('src/sync/appearance.ts'), rs = src('src/services/services/remoteServer.ts');
check('inventory.ts reports the null base before reading it as empty, as it already did', /if \(baseObject === null\) \{\n[^}]*notePlayerBaseNull\('inventory', refr\.getFormID\(\)\);\n    return \{ entries: \[\] \};/.test(inv));
check('appearance.ts counts each base given the player\'s id, right after the swap', /TESModPlatform\.setFormIdUnsafe\(tintsActorBase, playerBaseId\);\n[^\n]*\n      noteFormIdSwap\(Date\.now\(\)\);/.test(app));
check('remoteServer counts another player\'s character made and gone', /if \(msg\.appearance && !msg\.isMe\) noteRemotePlayerCreated\(\);/.test(rs)
  && /if \(destroyed && destroyed\.appearance && !destroyed\.isMyClone\) noteRemotePlayerDestroyed\(Date\.now\(\)\);/.test(rs));

const MUTANTS = [
  ['every null reported', 's.nulls === 1 || now - s.lastReportAt >= exports.REPORT_EVERY_MS', 'true'],
  ['any reference reported', 'if ((refrId >>> 0) !== PLAYER_REF)', 'if (false)'],
  ['a despawn not timed', 's.lastDespawnAt = now;', ''],
  ['the swap count not kept', 's.swaps++;', ''],
  ['the count allowed below none', 's.remotes = Math.max(0, s.remotes - 1);', 's.remotes = s.remotes - 1;'],
];
for (const [name, a, b] of MUTANTS) {
  if (!SRC.includes(a)) { check(`mutant "${name}": its text is in the compiled module`, false, a); continue; }
  let bad = 0;
  try { scenarios(load(SRC.split(a).join(b)), (w, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  check(`mutant caught: ${name}`, bad > 0);
}
fs.rmSync(OUT, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
