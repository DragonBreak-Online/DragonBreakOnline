// Scripted test for the live race in the RaceMenu face trace (15 Oct: every Maormer face logged 'rmp apply wait=race' with
// no race in the line, so the live race behind it was only inferred). The wait line names the actor's live race (now=,
// what the gate compares), its base's (base=) and the face's (want=), and is traced again when one of them changes; the
// own look's trace lines add ar=<actor race> when the actor's live race is not its base's, and are unchanged otherwise.
// Run from skymp5-client:
//
//   node tests/racemenu-race-diag-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP racemenu-race-diag (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);
const SRC = path.resolve(__dirname, '../src');

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`);
  if (!ok) failures++;
};

const NORD = 0x13746, HIGH_ELF = 0x13743, MAORMER = 0x3c192ede, MAORMER_VAMPIRE = 0x3c192edf;
const ME = 0xff0e57a1; // a made-up actor id
// The player: the actor's live race and its base's apart, as SkyrimPlatform's login save leaves a Maormer
const W = { files: {}, calls: [], packets: [], works: [], diag: [], me: ME, actor: { race: NORD, base: MAORMER, loaded: true, combat: false }, forms: {} };
globalThis.__rdW = W;
const TR = [];
globalThis.__dboTrace = (t) => TR.push(String(t));

const SP_STUB = `
const W = globalThis.__rdW;
const race = (id) => (id ? { getFormID: () => id >>> 0 } : null);
const player = () => ({ getFormID: () => 0x14, getRace: () => race(W.actor.race), is3DLoaded: () => W.actor.loaded, isInCombat: () => W.actor.combat, getBaseObject: () => ({ base: 0x14 }) });
export const Game = { getPlayer: player, getFormEx: (id) => ({ id: id >>> 0 }), getFormFromFile: (id, file) => (W.forms[file + '|' + (id >>> 0).toString(16)] || null),
  getModName: (i) => ['Skyrim.esm'][i] || '', getLightModName: () => '' };
export const Actor = { from: (f) => (f && f.id === 0x14 ? player() : null) };
export const ActorBase = { from: (b) => (b ? { getNumHeadParts: () => 1, getNthHeadPart: () => ({ getFormID: () => 0x1a2b3, isExtraPart: () => false }), getWeight: () => 50, getRace: () => race(W.actor.base) } : null) };
export const HeadPart = { from: (f) => (f && f.id === 0x1a2b3 ? { getFormID: () => 0x1a2b3, isExtraPart: () => false } : null) };
export const Race = { from: (f) => (f && f.race ? race(f.race) : null) };
export const Ui = { isMenuOpen: () => false };
export const writeLogs = (_f, line) => W.diag.push(line);
export const printConsole = () => {};
export const callNative = (cls, fn) => { W.calls.push(fn); return fn === 'LoadCharacterPresetEx' ? true : null; };
`;
const STUBS = {
  skyrimPlatform: SP_STUB,
  clientListener: 'export class ClientListener {}',
  remoteServer: 'export class RemoteServer {}',
  customPacketUtil: `export const sendCustomPacket = (_c, p) => globalThis.__rdW.packets.push(p);
    export const parseCustomPacket = (e) => { try { return JSON.parse(e.message.contentJsonDump); } catch (x) { return null; } };`,
  worldViewMisc: 'export const getViewFromStorage = () => ({ getFormViews: () => ({ getFormViewsArrayLength: () => 0, getNthFormView: () => null }) });',
  niNodeQueue: `export const queueCopyNiNodeWork = (id, work) => globalThis.__rdW.works.push({ id: id >>> 0, work });
    export const queuePlayerNiNodeWork = (work) => globalThis.__rdW.works.push({ id: 0x14, work });`,
  appearance: 'export {};',
  logging: 'export const logError = () => {}; export const logTrace = () => {};',
};
const KEEP = new Set(['racemenuPresetPlan', 'beastRaces', 'beastRaceIds', 'nonHumanoidRaceList', 'beastBody', 'clientDiag']);
const stubPlugin = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      if (a.kind === 'entry-point') return null;
      const base = a.path.replace(/.*\//, '');
      if (KEEP.has(base)) return null;
      if (a.path === 'skyrimPlatform') return { path: 'skyrimPlatform', namespace: 'stub' };
      if (STUBS[base]) return { path: base, namespace: 'stub' };
      return null;
    });
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js', resolveDir: SRC }));
  },
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-racediag-'));
  let M, P, T;
  try {
    await esbuild.build({ entryPoints: [path.join(SRC, 'services/services/racemenuPresetService.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(dir, 'svc.js'), plugins: [stubPlugin], logLevel: 'error' });
    await esbuild.build({ entryPoints: [path.join(SRC, 'sync/racemenuPresetPlan.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(dir, 'plan.js'), logLevel: 'error' });
    await esbuild.build({ entryPoints: [path.join(SRC, 'sync/appearanceTrace.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(dir, 'trace.js'), logLevel: 'error' });
    M = require(path.join(dir, 'svc.js')); P = require(path.join(dir, 'plan.js')); T = require(path.join(dir, 'trace.js'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  let NOW = 1000000;
  Date.now = () => NOW;
  const natives = { readPresetFile: (n) => W.files[n], writePresetFile: (n, t) => { W.files[n] = t; }, removePresetFile: (n) => { delete W.files[n]; return true; }, getTriVertexCount: () => 9001 };
  const ons = {}, emit = {};
  const controller = { on: (ev, fn) => { (ons[ev] = ons[ev] || []).push(fn); }, once: (ev, fn) => { (ons[ev] = ons[ev] || []).push(fn); },
    emitter: { on: (ev, fn) => { (emit[ev] = emit[ev] || []).push(fn); } }, lookupListener: () => ({ getMyRemoteRefrId: () => W.me }) };
  new M.RacemenuPresetService(natives, controller);
  const step = (ms, n = 1) => { for (let i = 0; i < n; i++) { NOW += ms; (ons.update || []).forEach((f) => f()); } };
  const deliver = (p) => (emit.customPacketMessage || []).forEach((f) => f({ message: { contentJsonDump: JSON.stringify(p) } }));
  const runWorks = () => W.works.splice(0).forEach((x) => x.work({ getFormID: () => 0x14, getRace: () => ({ getFormID: () => W.actor.race }), is3DLoaded: () => W.actor.loaded, isInCombat: () => W.actor.combat, getBaseObject: () => ({ base: 0x14 }) }));
  const text = P.encodeFace({ version: { signature: 1163086675, formatVersion: 3, skseVersion: 1, runtimeVersion: 2 }, modNames: ['Skyrim.esm'], custom: [{ name: 'RANs_ForeheadBackForward', value: 1 }], sculptDivisor: 10000, sculpt: [] });
  const hash = P.hashText(text);
  const waits = () => TR.filter((t) => /^rmp apply wait=/.test(t));

  // ---- the wait line names the races ----
  step(1100, 7);
  deliver({ customPacketType: 'dboPresetChunk', actor: ME, self: true, hash, race: MAORMER, i: 0, n: 1, data: text });
  step(1100, 3);
  check('a Maormer after a login: the wait line names the actor\'s live race, its base\'s and the face\'s',
    waits().length === 1 && waits()[0] === `rmp apply wait=race h=${hash} now=13746 base=3c192ede want=3c192ede`, waits());
  W.actor.combat = true; step(1100, 2); W.actor.combat = false; step(1100, 2);
  check('...a fight in between is traced with the races too, and the race wait again after it (each change once)',
    waits().length === 3 && waits()[1] === `rmp apply wait=combat h=${hash} now=13746 base=3c192ede want=3c192ede` && waits()[2] === waits()[0], waits());
  // A beast form's race: the gate says beast, the races in the line show which
  W.actor.race = 0x0200283a; step(1100, 2);
  check('a live race change is traced at once (a Vampire Lord: wait=beast now=200283a)', waits().length === 4 && waits()[3] === `rmp apply wait=beast h=${hash} now=200283a base=3c192ede want=3c192ede`, waits());
  W.actor.race = MAORMER; step(1100, 1); runWorks();
  check('the live race put right: the face goes on, no wait line more', W.calls.includes('LoadCharacterPresetEx') && TR.some((t) => t === `rmp apply ok h=${hash} hp=1 drop=0`) && waits().length === 4, [W.calls, TR.slice(-3)]);

  // ---- the own look's trace ----
  const sent = { raceId: MAORMER, isFemale: false, presets: [1, 2], options: [0.5], headpartIds: [1, 2] };
  const got = { raceId: MAORMER, sex: 0, presets: [1, 2, 0, 0], options: [0.5], parts: 2 };
  const plain = 'own load r=3c192ede s=0 hp=2/2 p=1,2 o=.5 mm=-';
  check('own load: the same line as before when no actor race is given', T.lookTraceLine('load', sent, got) === plain, T.lookTraceLine('load', sent, got));
  check('own load: the same line as before when the actor\'s race is its base\'s (every vanilla login)', T.lookTraceLine('load', sent, got, MAORMER) === plain, T.lookTraceLine('load', sent, got, MAORMER));
  check('own load: ar=13746 after r= when the actor kept the template\'s race', T.lookTraceLine('load', sent, got, NORD) === 'own load r=3c192ede ar=13746 s=0 hp=2/2 p=1,2 o=.5 mm=-', T.lookTraceLine('load', sent, got, NORD));
  check('own load: ar=0 when the actor has no race', T.lookTraceLine('load', sent, got, 0) === 'own load r=3c192ede ar=0 s=0 hp=2/2 p=1,2 o=.5 mm=-', T.lookTraceLine('load', sent, got, 0));
  check('own load+8s: the read-back line flags it too, and is unchanged without it',
    T.lookRecheckLine('load+8s', sent, got, NORD) === 'own load+8s ar=13746 hp=2 mm=-' && T.lookRecheckLine('load+8s', sent, got, MAORMER) === 'own load+8s hp=2 mm=-' && T.lookRecheckLine('load+8s', sent, got) === 'own load+8s hp=2 mm=-',
    [T.lookRecheckLine('load+8s', sent, got, NORD), T.lookRecheckLine('load+8s', sent, got)]);
  check('the line stays within the server\'s 500 characters', T.lookTraceLine('load', { ...sent, options: new Array(19).fill(-0.42) }, { ...got, options: new Array(19).fill(0.42) }, NORD).length < 480);
  const src = fs.readFileSync(path.join(SRC, 'sync/appearance.ts'), 'utf8');
  check('sync/appearance.ts hands the player\'s live race to both trace lines', /lookTraceLine\(event, appearance, readLook\(base\), playerLiveRace\(\)\)/.test(src) && /lookRecheckLine\(event, lastOwnLook, readLook\(base\), playerLiveRace\(\)\)/.test(src));

  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL harness threw', e.stack); process.exit(1); });
