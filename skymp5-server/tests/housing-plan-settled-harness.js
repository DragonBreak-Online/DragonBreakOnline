// The housing place plan at boot (housingSystem.ts): once a plan has found nothing to apply, the migration is settled and a
// marker (housing-places-settled.json) records the plan's inputs (rules version, load order, grants, caps, staff); a later
// boot with housingPlaceMigration "apply" and the same inputs skips the plan, which on live read every claim natively and
// blocked the event loop ~120 s (2 Nov: 884 claims, 14 logins failed with 408; dev, 673 claims: 124 s). New claims alone do
// not re-plan; a changed input, an old marker, housingPlaceReplan true, a restore or dryrun do, and say why. Bundles
// housingSystem.ts with esbuild, settings stubbed. Mutants of a copy must fail. Run from skymp5-server:
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
  const LO = ['Skyrim.esm', 'DragonBreak.esp'];
  const GRANTS = [{ door: '1:Skyrim.esm', profile: 9 }];
  const config = (grants) => fs.writeFileSync('gamemode-config.json', JSON.stringify({ housingPlaces: { grants } }));
  // One boot: the settings, then initAsync with the heavy parts stubbed; claims is the registry it would load
  const boot = async (settings, claims) => {
    globalThis.__hsSettings = settings;
    const logs = [];
    const sys = new HousingSystem((m) => logs.push(String(m)));
    Object.assign(sys, { loadEspmCache: () => {}, loadRegistry: () => claims || [], installActivationHook: () => {}, exposeTenancy: () => {} });
    await sys.initAsync(ctx);
    return { sys, done: sys.placePlanDone === true, logs, said: logs.filter((l) => /place plan (runs|skipped)/.test(l)).join(' | ') };
  };
  // A plan that finds nothing to apply, after a boot with these settings: the marker it writes
  const settle = async (settings, claims) => {
    try { fs.unlinkSync(MARKER); } catch (e) { /* none */ }
    const b = await boot(settings, claims);
    b.sys.claimed = claims || [];
    b.sys.applyPlaces(ctx, [], new Map());
    return b;
  };
  const APPLY = { housingPlaceMigration: 'apply', loadOrder: LO };
  config(GRANTS);

  let r = await boot(APPLY, [1]);
  check('apply, not settled yet: the plan runs, saying why', !r.done && /place plan runs: not settled yet/.test(r.said), r.said);
  const s = await settle(APPLY, [1, 2, 3]);
  let m = null; try { m = JSON.parse(fs.readFileSync(MARKER, 'utf8')); } catch (e) { m = null; }
  check('nothing to apply writes the marker with the counts and the plan\'s inputs', !!m && m.claims === 3 && m.places === 0 && !!m.inputs && m.inputs.rules && m.inputs.loadOrder && m.inputs.grants, m);
  check('...after the usual line', s.logs.some((l) => /place migration: nothing to apply/.test(l)), s.logs);
  r = await boot(APPLY, [1, 2, 3]);
  check('the next boot with the same inputs skips the plan, and says so', r.done && /place plan skipped: settled with these inputs .*housingPlaceReplan true plans again/.test(r.said), r.said);
  r = await boot(APPLY, [1, 2, 3, 4, 5]);
  check('new claims alone do not re-plan (the live rules place them)', r.done, r.said);
  r = await boot(Object.assign({}, APPLY, { loadOrder: LO.concat('New.esp') }), [1]);
  check('a changed load order re-plans, naming it', !r.done && /changed since it settled: loadOrder/.test(r.said), r.said);
  config(GRANTS.concat({ door: '2:Skyrim.esm', profile: 10 }));
  r = await boot(APPLY, [1]);
  check('a changed grant list re-plans, naming it', !r.done && /changed since it settled: .*grants/.test(r.said), r.said);
  config(GRANTS);
  r = await boot(Object.assign({}, APPLY, { housingPlaceCap: 3 }), [1]);
  check('a changed cap re-plans', !r.done && /changed since it settled: .*caps/.test(r.said), r.said);
  fs.writeFileSync(MARKER, JSON.stringify(Object.assign({}, m, { inputs: Object.assign({}, m.inputs, { rules: '0' }) })));
  r = await boot(APPLY, [1]);
  check('a marker from older place rules re-plans, naming the rules', !r.done && /changed since it settled: rules/.test(r.said), r.said);
  fs.writeFileSync(MARKER, JSON.stringify({ at: 'then', claims: 1, places: 1 }));
  r = await boot(APPLY, [1]);
  check('a marker written before inputs were recorded re-plans once', !r.done && /settled before its inputs were recorded/.test(r.said), r.said);
  await settle(APPLY, [1]);
  r = await boot(Object.assign({}, APPLY, { housingPlaceReplan: true }), [1]);
  check('housingPlaceReplan true re-plans even when settled, saying so', !r.done && /place plan runs: housingPlaceReplan is true/.test(r.said), r.said);
  r = await boot(Object.assign({}, APPLY, { housingPlaceRestore: 'backup.json' }), [1]);
  check('a restore set: the plan tick runs it, settled or not', !r.done);
  r = await boot({ housingPlaceMigration: 'dryrun', loadOrder: LO }, [1]);
  check('dryrun: the plan is written as before', !r.done);
  process.chdir(out);
};

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!ok) failures++; };

(async () => {
  const SRC = fs.readFileSync(SRC_FILE, 'utf8').replace(/\r\n/g, '\n');
  await checks(await build(SRC), check);
  const MUTANTS = [
    ['a settled marker is never trusted', 'return changed.length ? `changed since it settled: ${changed.join(", ")}` : "";', 'return "always";'],
    ['changed inputs are ignored', 'return changed.length ? `changed since it settled: ${changed.join(", ")}` : "";', 'return "";'],
    ['the load order is not an input', '      loadOrder: hash(all?.["loadOrder"]),\n', ''],
    ['the marker keeps no inputs', ', inputs: this.placeInputs }', ' }'],
    ['housingPlaceReplan is ignored', 'all?.["housingPlaceReplan"] === true ? "housingPlaceReplan is true" : ', ''],
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
