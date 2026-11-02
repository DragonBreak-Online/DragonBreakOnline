// The housing place plan at boot (housingSystem.ts): once a plan has found nothing to apply, the migration is settled and a
// marker (housing-places-settled.json) is written; a later boot with housingPlaceMigration "apply" then skips the plan,
// which on live read every claim natively and blocked the event loop ~120 s (2 Nov: 884 claims, 14 logins failed with 408;
// dev, 673 claims: 124 s). The plan still runs without the marker, with housingPlaceReplan true, with a restore set, and in
// dryrun. Bundles housingSystem.ts with esbuild, settings stubbed. Mutants of a copy must fail. Run from skymp5-server:
//
//   node tests/housing-plan-settled-harness.js [housingSystem.ts to test]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const SRC_FILE = path.resolve(process.argv[2] || path.join(root, 'ts', 'systems', 'housingSystem.ts'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-plansettled-'));
const cwd0 = process.cwd();
process.on('exit', () => { process.chdir(cwd0); try { fs.rmSync(out, { recursive: true, force: true }); } catch (e) { /* the OS */ } });

let n = 0;
const build = async (srcText) => {
  const entry = path.join(root, 'ts', 'systems', `.housing-settled-${process.pid}-${n++}.ts`);
  fs.writeFileSync(entry, srcText);
  const bundle = path.join(out, `housing-${n}.js`);
  try {
    await esbuild.build({
      entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error',
      plugins: [{ name: 'settings', setup(b) {
        b.onResolve({ filter: /^\.\.\/settings$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = { Settings: { get: async () => ({ allSettings: globalThis.__hsSettings }) } };', loader: 'js' }));
      } }],
    });
  } finally { fs.unlinkSync(entry); }
  return require(bundle).HousingSystem;
};

const MARKER = 'housing-places-settled.json';
const mp = { get: () => undefined, set: () => {}, getIdFromDesc: () => 0, lookupEspmRecordById: () => null, getActorsByProfileId: () => [], getUserByActor: () => -1, getUserActor: () => 0, isConnected: () => false, sendCustomPacket: () => {} };
const ctx = { svr: mp, gm: { on: () => {} } };

const checks = async (HousingSystem, check) => {
  const dir = fs.mkdtempSync(path.join(out, 'run-'));
  process.chdir(dir);
  const boot = async (settings, marker) => {
    try { fs.unlinkSync(MARKER); } catch (e) { /* none */ }
    if (marker) fs.writeFileSync(MARKER, JSON.stringify({ at: 'then' }));
    globalThis.__hsSettings = settings;
    const logs = [];
    const sys = new HousingSystem((m) => logs.push(String(m)));
    Object.assign(sys, { loadEspmCache: () => {}, loadRegistry: () => [], installActivationHook: () => {}, exposeTenancy: () => {} });
    await sys.initAsync(ctx);
    return { done: sys.placePlanDone === true, logs };
  };
  let r = await boot({ housingPlaceMigration: 'apply' }, true);
  check('apply, settled: the boot plan is skipped', r.done, r.logs);
  check('...and says so, with how to plan again', r.logs.some((l) => /place plan skipped: the migration is settled .*housingPlaceReplan true plans again/.test(l)), r.logs);
  r = await boot({ housingPlaceMigration: 'apply' }, false);
  check('apply, not settled yet: the plan runs', !r.done);
  r = await boot({ housingPlaceMigration: 'apply', housingPlaceReplan: true }, true);
  check('housingPlaceReplan true: the plan runs even when settled', !r.done);
  r = await boot({ housingPlaceMigration: 'apply', housingPlaceRestore: 'backup.json' }, true);
  check('a restore set: the plan tick runs it, settled or not', !r.done);
  r = await boot({ housingPlaceMigration: 'dryrun' }, true);
  check('dryrun: the plan is written as before', !r.done);

  // A plan with nothing left to apply settles the migration
  try { fs.unlinkSync(MARKER); } catch (e) { /* none */ }
  const logs = [];
  const sys = new HousingSystem((m) => logs.push(String(m)));
  sys.claimed = [1, 2, 3];
  sys.applyPlaces(ctx, [], new Map());
  let m = null; try { m = JSON.parse(fs.readFileSync(MARKER, 'utf8')); } catch (e) { m = null; }
  check('nothing to apply writes the settled marker, with the counts', !!m && m.claims === 3 && m.places === 0 && typeof m.at === 'string', m);
  check('...after the usual line', logs.some((l) => /place migration: nothing to apply/.test(l)), logs);
  process.chdir(out);
};

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!ok) failures++; };

(async () => {
  const SRC = fs.readFileSync(SRC_FILE, 'utf8').replace(/\r\n/g, '\n');
  await checks(await build(SRC), check);
  const MUTANTS = [
    ['the boot plan always runs', '&& fs.existsSync(PLACE_SETTLED_FILE)) {', '&& false) {'],
    ['nothing to apply writes no marker', '      try { fs.writeFileSync(PLACE_SETTLED_FILE,', '      try { (() => {})(PLACE_SETTLED_FILE,'],
    ['housingPlaceReplan is ignored', ' && all?.["housingPlaceReplan"] !== true', ''],
  ];
  for (const [name, from, to] of MUTANTS) {
    if (!SRC.includes(from)) { check(`mutant "${name}": its line is still in housingSystem.ts`, false, from); continue; }
    let bad = 0;
    try { await checks(await build(SRC.replace(from, to)), (_n, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
    check(`mutant caught: ${name}`, bad > 0);
  }
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exitCode = failures ? 1 : 0;
})();
