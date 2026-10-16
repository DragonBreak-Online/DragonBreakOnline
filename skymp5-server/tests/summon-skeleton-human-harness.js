// Summon Skeleton (DragonBreak.esp ISS_ConjureSkeleton) conjures the human skeleton for every caster unless
// server-settings "summonRaceVariants" is true (#bugs 15 Oct "Summon Skeleton is not working": the Khajiit, Argonian, Elf
// and Orc skeletons use Issgard\actors\BeastSkeletons meshes no launcher archive ships, and 5 of 5 Elf skeletons never
// loaded). Bundles conjurationSystem.ts with the real espmMagic.ts (settings stubbed) on the real record
// (tests/fixtures/iss-conjure-skeleton.json). Run it from skymp5-server with node_modules present:
//
//   node tests/summon-skeleton-human-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-summon-human-'));
process.on('exit', () => { try { fs.rmSync(out, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
const bundle = path.join(out, 'conjuration.js');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const fx = require(path.resolve(__dirname, 'fixtures', 'iss-conjure-skeleton.json'));
const records = new Map(Object.entries(fx.records).map(([id, r]) => [Number(id) >>> 0, { record: { type: r.type, fields: r.fields.map((f) => { const b = Buffer.from(f.hex, 'hex'); return { type: f.type, data: new Uint8Array(b.buffer, b.byteOffset, b.byteLength) }; }) }, toGlobalRecordId: (x) => x }]));
const own = (local) => ((fx.selfIndex << 24) | local) >>> 0;
const SPELL = own(0x2922);
const KHAJIIT = 0x13745, NORD = 0x13746, IMPERIAL = 0x13744, ALTMER = 0x13743, BOSMER = 0x13749, ARGONIAN = 0x13740;
const HUMAN_SKELETON = own(0x292b);

(async () => {
  await esbuild.build({
    stdin: { contents: 'export { ConjurationSystem } from "./conjurationSystem";', resolveDir: path.join(root, 'ts', 'systems'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error',
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /^\.\.\/settings$|^\.\/companionSystem$|^\.\/npcPlacement$|^\.\.\/scampNative$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ loader: 'js', contents: a.path === '../settings'
        ? 'module.exports = { Settings: { get: async () => ({ allSettings: globalThis.__summonSettings || {} }) } };'
        : 'module.exports = { CompanionSystem: class {}, placeNpc: () => 0, placeAtMe: () => 0, HOSTILE_PROP: "ff_hostile" };' }));
    } }],
  });
  const { ConjurationSystem } = require(bundle);
  const CASTER = 0xff000101;
  const run = async (settings, race) => {
    globalThis.__summonSettings = settings;
    const spawned = [];
    const mp = {
      get: (id, k) => { if (k === 'profileId') return id === CASTER ? 7 : -1; if (k === 'appearance') return { raceId: race }; if (k === 'baseDesc') return '7:Skyrim.esm'; return undefined; },
      getIdFromDesc: () => 7,
      lookupEspmRecordById: (id) => records.get(id >>> 0) || null,
    };
    const sys = new ConjurationSystem(() => {}, { spawn: (owner, base, opts) => spawned.push({ owner, base, opts }), isCompanionActor: () => false });
    await sys.initAsync({ svr: mp });
    mp.onSpellCast(CASTER, SPELL);
    await new Promise((r) => setImmediate(r));
    return spawned;
  };
  for (const [name, race] of [['an Altmer', ALTMER], ['a Bosmer', BOSMER], ['a Khajiit', KHAJIIT], ['an Argonian', ARGONIAN], ['a Nord', NORD], ['an Imperial', IMPERIAL]]) {
    const s = await run({}, race);
    check(`by default ${name} conjures the human skeleton`, s.length === 1 && s[0].base === HUMAN_SKELETON && s[0].opts.kind === 'summon', s);
  }
  const d = await run({}, ALTMER);
  check('...for the spell\'s 60 s', d[0] && d[0].opts.durationSec === 60, d);
  const k = await run({ summonRaceVariants: true }, KHAJIIT);
  check('"summonRaceVariants": true gives a Khajiit the Khajiit skeleton again', k.length === 1 && k[0].base === own(0x1e4f), k);
  const e = await run({ summonRaceVariants: true }, ALTMER);
  check('...and an Altmer the Elf one', e.length === 1 && e[0].base === own(0x4aff), e);
  console.log(failures ? `${failures} failure(s)` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
