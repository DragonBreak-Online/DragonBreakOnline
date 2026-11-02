// Give all spells keeps the AI-forbidding mods' rows that live in the gitignored admin-powers.private.json (the server
// branch's privaterows.js; Nat, 2 Nov): adminSystem.ts merges the sidecar into admin-powers.json, each row back at its index
// in the whole list. Without the sidecar, or with a broken one, the public rows are given. It bundles adminSystem.ts with
// esbuild (settings, NPC spawns, mastery and the ban store stubbed) and reads its own catalogue methods. From skymp5-server
// with node_modules present:
//
//   node tests/admin-powers-private-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-powers-private-'));
const stubSources = {
  '../settings': 'module.exports = { Settings: { get: async () => ({ allSettings: {} }) } };',
  './npcSpawnSystem': 'module.exports = { NpcSpawnSystem: class {} };',
  './masterySystem': 'module.exports = { MasterySystem: class {}, MAX_GRANT: 0 };',
  './adminBans': 'module.exports = { AdminBans: class { list() { return []; } } };',
};
const stubFilter = new RegExp('^(' + Object.keys(stubSources).map((k) => k.replace(/[./-]/g, '\\$&')).join('|') + ')$');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!ok) failures++; };

const PUB = {
  spells: [['1:Skyrim.esm', 'Flames'], ['3:Skyrim.esm', 'Frostbite']],
  staffSpells: [['10:Skyrim.esm', 'Hazard', 'HazardSpell']],
  shoutsGate: [], shouts: [], werewolf: '92c48:Skyrim.esm',
};
const SIDE = { lists: {
  spells: [{ at: 0, row: ['a:Druadach.esm', 'Raise Wall'] }, { at: 2, row: ['b:summersetisles.esp', 'Sunbird'] }, { at: 4, row: ['c:Druadach.esm', 'Last'] }],
  staffSpells: [{ at: 1, row: ['d:King of the Murkmire.esp', 'Hist Sap', 'HistSap'] }],
} };

(async () => {
  await esbuild.build({
    entryPoints: [path.join(root, 'ts', 'systems', 'adminSystem.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'admin.js'), logLevel: 'error',
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: stubFilter }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubSources[a.path], loader: 'js' }));
    } }],
  });
  const cwd = process.cwd();
  process.chdir(out);
  try {
    const { AdminSystem } = require(path.join(out, 'admin.js'));
    const sys = new AdminSystem(() => {}, { listZones: () => [] }, { summaryOf: () => null });
    const descs = (l) => l.map((x) => x[0]);

    fs.writeFileSync('admin-powers.json', JSON.stringify(PUB));
    check('no sidecar: Give all gives the public rows', JSON.stringify(descs(sys.giveAllSpells())) === JSON.stringify(['1:Skyrim.esm', '3:Skyrim.esm']), descs(sys.giveAllSpells()));

    fs.writeFileSync('admin-powers.private.json', JSON.stringify(SIDE));
    const all = descs(sys.giveAllSpells());
    check('with the sidecar: every private row is back at its index in the whole list',
      JSON.stringify(all) === JSON.stringify(['a:Druadach.esm', '1:Skyrim.esm', 'b:summersetisles.esp', '3:Skyrim.esm', 'c:Druadach.esm']), all);
    const staff = (sys.powers() || {}).staffSpells || [];
    check('...and the staff-only list too', JSON.stringify(descs(staff)) === JSON.stringify(['10:Skyrim.esm', 'd:King of the Murkmire.esp']), descs(staff));
    check('...and the shout gate and beast powers are untouched', sys.powers().werewolf === '92c48:Skyrim.esm' && Array.isArray(sys.powers().shoutsGate));

    fs.writeFileSync('admin-powers.private.json', '{ broken');
    check('a broken sidecar: the public rows, no throw', JSON.stringify(descs(sys.giveAllSpells())) === JSON.stringify(['1:Skyrim.esm', '3:Skyrim.esm']), descs(sys.giveAllSpells()));
  } finally {
    process.chdir(cwd);
    try { fs.rmSync(out, { recursive: true, force: true }); } catch (e) { /* EBUSY on Windows */ }
  }
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
