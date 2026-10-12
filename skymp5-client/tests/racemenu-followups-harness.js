// Scripted test for the RaceMenu client follow-ups and their trace lines (client 0.3.91): the head the editor left is sent as it is (no same-race
// revert); the player's face is captured and sent only once the server's face is on the player or the server has none;
// a dboPresetRefused {hash, reason} resets the dedupe and puts the server's face back; every editor close may send once;
// `off` ends with the connection; the player's own face is asked of the server again after a game load and after a
// character change; a part-sent upload is dropped when the character changes; the extras service sends again after a
// menu open and after a new spawn. Run from skymp5-client:
//
//   node tests/racemenu-followups-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP racemenu-followups (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);
const SRC = path.resolve(__dirname, '../src');

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`);
  if (!ok) failures++;
};

const HEAD = 'Actors\\Character\\Character Assets\\FemaleHeadChargen.tri';
const RACE = 0x13746;
const ME = 0xff000001, ME2 = 0xff000002;
const W = {
  files: {}, calls: [], packets: [], works: [], diag: [], hooks: [], menuOpen: false, me: ME,
  actors: { 0x14: { race: RACE, loaded: true, combat: false } },
  parts: { 0x0001a2b3: { extra: false, type: 1 }, 0x0001a2b4: { extra: false, type: 1 }, 0x00024238: { extra: true, type: 0 } },
  playerParts: [0x0001a2b3, 0x00024238], loadResult: true, savedJslot: null, sex: 0, look: null, extras: null, applied: [],
};
globalThis.__rmW = W;
// The appearance trace (client 0.3.91): every line the services hand to ClientDiagService, and the read-backs they ask for
const TR = [];
const RECHECKS = [];
globalThis.__dboTrace = (t) => TR.push(String(t));
globalThis.__dboAppearanceRecheck = (event, delay) => RECHECKS.push(delay ? `${event}+${delay}` : event);

const SP_STUB = `
const W = globalThis.__rmW;
const actorOf = (id) => { const a = W.actors[id >>> 0]; if (!a) return null;
  return { getFormID: () => id >>> 0, getRace: () => ({ getFormID: () => a.race }), is3DLoaded: () => a.loaded, isInCombat: () => a.combat, getBaseObject: () => ({ base: id }) }; };
const partOf = (id) => { const p = W.parts[id >>> 0]; return p ? { getFormID: () => id >>> 0, isExtraPart: () => p.extra, getType: () => p.type } : null; };
export const Game = { getPlayer: () => actorOf(0x14), getFormEx: (id) => ({ id: id >>> 0 }), getFormFromFile: () => null, getModName: (i) => ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm'][i] || '', getLightModName: () => '' };
export const Actor = { from: (f) => (f ? actorOf(f.id) : null) };
export const ActorBase = { from: (b) => (b ? { getNumHeadParts: () => W.playerParts.length, getNthHeadPart: (i) => partOf(W.playerParts[i]), getWeight: () => 61, getSex: () => W.sex, getRace: () => ({ getFormID: () => W.actors[0x14].race }) } : null) };
export const HeadPart = { from: (f) => (f ? partOf(f.id) : null) };
export const Ui = { isMenuOpen: (m) => m === 'RaceSex Menu' && W.menuOpen };
export const writeLogs = (_f, line) => W.diag.push(line);
export const printConsole = () => {};
export const callNative = (cls, fn, self, ...args) => {
  W.calls.push({ cls, fn, actor: args[0] && args[0].getFormID(), name: args[1], file: W.files[String(args[1]).replace('DBO\\\\', '')] });
  if (fn === 'SaveCharacterPreset') { if (W.savedJslot) W.files[String(args[1]).replace('DBO\\\\', '')] = JSON.stringify(W.savedJslot); return null; }
  if (fn === 'LoadCharacterPresetEx') return W.loadResult;
  return null;
};
export const EquipEvent = {}; export const FormType = {};
`;
const STUBS = {
  skyrimPlatform: SP_STUB,
  clientListener: 'export class ClientListener {}',
  remoteServer: 'export class RemoteServer {}',
  customPacketUtil: `export const sendCustomPacket = (_c, p) => globalThis.__rmW.packets.push(p);
    export const parseCustomPacket = (e) => { try { return JSON.parse(e.message.contentJsonDump); } catch (x) { return null; } };`,
  worldViewMisc: 'export const getViewFromStorage = () => ({ getFormViews: () => ({ getFormViewsArrayLength: () => 0, getNthFormView: () => null }) }); export const remoteIdToLocalId = (x) => x;',
  niNodeQueue: `export const queueCopyNiNodeWork = (id, work) => globalThis.__rmW.works.push({ id: id >>> 0, work });
    export const queuePlayerNiNodeWork = (work) => globalThis.__rmW.works.push({ id: 0x14, work });`,
  appearance: 'export const getAppearance = () => JSON.parse(JSON.stringify(globalThis.__rmW.look));',
  logging: 'export const logError = () => {}; export const logTrace = () => {};',
  // sendInputsService's neighbours: only names it imports
  other: `export class SinglePlayerService {} export const MsgType = { UpdateAppearance: 'UpdateAppearance' }; export const getMovement = () => null;
    export const getActorValues = () => null; export const getEquipment = () => null; export const nextHostAttempt = () => null;
    export class SkympClient {} export class CloneSpellGuardService {} export class DeathService {} export class RestraintService {}
    export const AnimationSource = class {}; export const Animation = {};`,
  // appearanceExtrasPlan: the real module with the job runner faked (captures return W.extras; applies are recorded)
  extrasPlan: `export * from ${JSON.stringify(path.join(SRC, 'services/services/appearanceExtrasPlan.ts'))};
    import { readExtras } from ${JSON.stringify(path.join(SRC, 'services/services/appearanceExtrasPlan.ts'))};
    export class JobRunner { constructor() { this.jobs = new Map(); } get size() { return this.jobs.size; } has(id) { return this.jobs.has(id); }
      put(id, job) { this.jobs.set(id, job); } drop(id) { this.jobs.delete(id); }
      run() { for (const [id, job] of Array.from(this.jobs)) { this.jobs.delete(id); if (job.kind === 'capture') job.done(readExtras(JSON.parse(JSON.stringify(globalThis.__rmW.extras)))); else globalThis.__rmW.applied.push({ id, x: job.x }); } } }
    export const captureJob = (female, done) => ({ kind: 'capture', label: 'capture', done });
    export const applyJob = (female, x) => ({ kind: 'apply', label: 'apply', x });
    export const clearRef = () => {};`,
};
const stubFor = (p) => {
  if (p === 'skyrimPlatform') return 'skyrimPlatform';
  const base = p.replace(/.*\//, '');
  if (base === 'appearanceExtrasPlan') return 'extrasPlan';
  if (['clientListener', 'remoteServer', 'customPacketUtil', 'worldViewMisc', 'niNodeQueue', 'appearance', 'logging'].includes(base)) return base;
  return null;
};
// Every relative import of the entry file is stubbed except the plan modules under test
const KEEP = new Set(['racemenuPresetPlan', 'beastRaces', 'beastRaceIds', 'nonHumanoidRaceList', 'beastBody', 'clientDiag']);
const stubPlugin = (entry) => ({
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      if (a.kind === 'entry-point') return null;
      if (a.namespace === 'stub' && path.isAbsolute(a.path)) return { path: a.path };
      const base = a.path.replace(/.*\//, '');
      if (KEEP.has(base)) return null;
      const s = stubFor(a.path);
      if (s) return { path: s, namespace: 'stub' };
      if (a.importer === entry && (a.path.startsWith('.') || a.path === 'skyrimPlatform')) return { path: 'other', namespace: 'stub' };
      return null;
    });
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js', resolveDir: SRC }));
  },
});

const bundle = async (rel, dir) => {
  const entry = path.join(SRC, rel);
  const out = path.join(dir, rel.replace(/\W/g, '_') + '.js');
  await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: out, plugins: [stubPlugin(entry)], logLevel: 'error' });
  return require(out);
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-rmfollow-'));
  let M, P, X, I;
  try {
    M = await bundle('services/services/racemenuPresetService.ts', dir);
    X = await bundle('services/services/appearanceExtrasService.ts', dir);
    I = await bundle('services/services/sendInputsService.ts', dir);
    const planOut = path.join(dir, 'plan.js');
    await esbuild.build({ entryPoints: [path.join(SRC, 'sync/racemenuPresetPlan.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: planOut, logLevel: 'error' });
    P = require(planOut);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  let NOW = 1000000;
  Date.now = () => NOW;
  const natives = {
    readPresetFile: (n) => W.files[n],
    writePresetFile: (n, t) => { W.files[n] = t; },
    removePresetFile: (n) => { const had = n in W.files; delete W.files[n]; return had; },
    getTriVertexCount: () => 9001,
  };
  const makeController = () => {
    const ons = {}, emit = {};
    return {
      ons, emitMap: emit,
      on: (ev, fn) => { (ons[ev] = ons[ev] || []).push(fn); },
      once: (ev, fn) => { (ons[ev] = ons[ev] || []).push(fn); },
      emitter: { on: (ev, fn) => { (emit[ev] = emit[ev] || []).push(fn); }, emit: (ev, x) => (emit['__sent'] = emit['__sent'] || []).push([ev, x]) },
      lookupListener: () => ({ getMyRemoteRefrId: () => W.me, getWorldModel: () => ({ forms: [], playerCharacterFormIdx: -1 }) }),
    };
  };
  const make = (Cls, sp) => {
    const c = makeController();
    const svc = new Cls(sp, c);
    return { svc, c, update: () => (c.ons.update || []).forEach((f) => f()), emit: (ev, x) => (c.emitMap[ev] || []).forEach((f) => f(x)) };
  };
  const step = (S, ms, n = 1) => { for (let i = 0; i < n; i++) { NOW += ms; S.update(); } };
  const deliver = (S, p) => S.emit('customPacketMessage', { message: { contentJsonDump: JSON.stringify(p) } });
  const runWorks = () => W.works.splice(0, W.works.length).map((x) => { const a = W.actors[x.id];
    return x.work({ getFormID: () => x.id, getRace: () => ({ getFormID: () => a.race }), is3DLoaded: () => a.loaded, isInCombat: () => a.combat }); });
  const loads = () => W.calls.filter((c) => c.fn === 'LoadCharacterPresetEx');
  const saves = () => W.calls.filter((c) => c.fn === 'SaveCharacterPreset');
  const puts = () => W.packets.filter((p) => p.customPacketType === 'dboPresetPut');
  const selfGets = () => W.packets.filter((p) => p.customPacketType === 'dboPresetGet' && p.actor === 0);
  const clear = () => { W.packets = []; W.calls = []; W.works = []; W.diag = []; W.hooks = []; };
  const editor = (S) => { W.menuOpen = true; step(S, 100); W.menuOpen = false; globalThis.__dboRaceMenuClosedAt = NOW; step(S, 1000, 5); };

  const jslotWith = (value, sculpt) => ({
    version: { signature: 1163086675, formatVersion: 3, skseVersion: 1, runtimeVersion: 2 }, modNames: ['Skyrim.esm'], mods: [],
    headParts: [{ formIdentifier: 'Skyrim.esm|01A2B3', type: 1 }], actor: { weight: 61 },
    morphs: { custom: [{ name: 'NoseBridge', value }], default: { presets: [1], morphs: [0.5] }, sculptDivisor: 10000,
      sculpt: sculpt ? [{ host: HEAD, vertices: 9001, data: [[3, 10, 20, 30]] }] : [] },
  });
  const faceOf = (j) => { const f = P.facePresetFrom(j); const t = P.encodeFace(f); return { text: t, hash: P.hashText(t) }; };
  const SERVER = faceOf(jslotWith(0.4, true)), EDIT = faceOf(jslotWith(-0.6, true)), EDIT2 = faceOf(jslotWith(0.1, false));
  const serverFace = (S, actor = 0xff0000aa) => deliver(S, { customPacketType: 'dboPresetChunk', actor, self: true, hash: SERVER.hash, race: RACE, i: 0, n: 1, data: SERVER.text });
  // A spawn whose own face the server sends and the player loads; returns the service
  const spawned = (answer = 'face') => {
    clear();
    W.me = ME; W.actors[0x14] = { race: RACE, loaded: true, combat: false }; W.loadResult = true;
    const S = make(M.RacemenuPresetService, natives);
    step(S, 1100, 7);
    if (answer === 'face') { serverFace(S); step(S, 1100); runWorks(); }
    else if (answer === 'none') deliver(S, { customPacketType: 'dboPresetNone', actor: 0xff0000aa, self: true });
    return S;
  };

  // ---- C2: no capture before the server's face is on ----
  clear();
  W.me = ME;
  let S = make(M.RacemenuPresetService, natives);
  step(S, 1100, 2);
  W.savedJslot = jslotWith(-0.6, true);
  editor(S);
  check('C2: an editor closed before the server answered: nothing saved or sent', saves().length === 0 && puts().length === 0, W.diag);
  check('C2: ...and the log says the capture was held (server face not in)', W.diag.some((l) => /preset: capture held, the server's face for this character is not in yet/.test(l)), W.diag);

  clear();
  S = make(M.RacemenuPresetService, natives);
  step(S, 1100, 7);
  W.actors[0x14].combat = true;
  serverFace(S);
  step(S, 1100, 2);
  check('C2: the server face is in but the player is fighting: not loaded yet', W.works.length === 0 && loads().length === 0);
  editor(S);
  check('C2: an editor closed then: held, nothing sent, the gate named', saves().length === 0 && puts().length === 0
    && W.diag.some((l) => /capture held, the server's face is not back on yet \(combat\)/.test(l)), W.diag);
  W.actors[0x14].combat = false;
  step(S, 1100);
  runWorks();
  check('C2: once out of the fight the server face is loaded', loads().length === 1 && JSON.parse(loads()[0].file).morphs.custom[0].value === 0.4);
  W.calls = []; W.packets = [];
  editor(S);
  check('C2: an editor closed after it is on: the new face is saved and sent', saves().length === 1 && puts().length === 1 && puts()[0].hash === EDIT.hash, puts());

  S = spawned('none');
  W.loadResult = false;
  clear();
  serverFace(S);
  step(S, 1100);
  runWorks();
  editor(S);
  check('C2: a server face skee refused to load: the capture is held (did not load)', saves().length === 0 && puts().length === 0
    && W.diag.some((l) => /capture held, the server's face did not load/.test(l)), W.diag);
  W.loadResult = true;

  S = spawned('none');
  editor(S);
  check('C2: the server has no face for this character: the first face is sent', puts().length === 1 && puts()[0].hash === EDIT.hash, puts());

  // ---- dboPresetRefused ----
  S = spawned('face');
  W.calls = []; W.packets = [];
  W.savedJslot = jslotWith(-0.6, true);
  editor(S);
  check('refusal: an edited face goes up', puts().length === 1 && puts()[0].hash === EDIT.hash);
  deliver(S, { customPacketType: 'dboPresetRefused', hash: EDIT.hash, reason: 'gold' });
  check('refusal: logged with its reason', W.diag.some((l) => /the server refused [0-9a-f]{8} \(gold\); the server's face/.test(l)), W.diag);
  step(S, 1100);
  W.calls = [];
  runWorks();
  check('refusal: the server face goes back on the player (from the cache, no new ask)', loads().length === 1 && JSON.parse(loads()[0].file).morphs.custom[0].value === 0.4
    && selfGets().length === 0, [loads().length, selfGets().length]);
  W.packets = [];
  editor(S);
  check('refusal: the same edit after the refusal is sent again', puts().length === 1 && puts()[0].hash === EDIT.hash, puts());
  deliver(S, { customPacketType: 'dboPresetRefused', hash: 'deadbeef', reason: 'gold' });
  check('refusal: one for a hash this client did not send last is ignored', W.diag.some((l) => /refusal for deadbeef \(gold\) ignored/.test(l)), W.diag);
  deliver(S, { customPacketType: 'dboPresetRefused', hash: EDIT.hash, reason: 'a reason with spaces / and a path C:\\x' });
  check('refusal: a reason that is not a short code is logged as other', W.diag.some((l) => /\(other\)/.test(l)) && !W.diag.some((l) => /C:\\x/.test(l)), W.diag.slice(-2));

  // refused with no face of the server's this session: ask again
  S = spawned('none');
  editor(S);
  clear();
  deliver(S, { customPacketType: 'dboPresetRefused', hash: EDIT.hash, reason: 'notLoaded' });
  check('refusal: the server had none: nothing to load, the dedupe is reset', W.diag.some((l) => /no face \(the server has none\)/.test(l)));

  // ---- C3: an unchanged close sends nothing once the server holds the face; a refused one goes again ----
  S = spawned('face');
  W.packets = [];
  W.savedJslot = jslotWith(-0.6, true);
  editor(S);
  step(S, 1000, 16);
  W.packets = [];
  editor(S);
  check('C3: the same face again after the server kept it: not sent', puts().length === 0 && W.diag.some((l) => /own face unchanged, [0-9a-f]{8}, not sent/.test(l)), W.diag.slice(-3));
  W.savedJslot = jslotWith(0.1, false);
  editor(S);
  check('C3: another face: sent', puts().length === 1 && puts()[0].hash === EDIT2.hash);
  W.savedJslot = jslotWith(-0.6, true);

  // ---- the character changes on the same connection ----
  S = spawned('face');
  W.packets = [];
  editor(S);
  step(S, 1000, 16);
  W.me = ME2;
  step(S, 1100, 7);
  check('C8: another character asks for its own face', selfGets().length >= 1 && selfGets().every((g) => g.have === ''), selfGets());
  deliver(S, { customPacketType: 'dboPresetNone', actor: 0xff0000bb, self: true });
  W.packets = [];
  editor(S);
  check('C3: the second character with the very same face sends it (no dedupe across characters)', puts().length === 1 && puts()[0].hash === EDIT.hash, puts());
  W.me = ME;
  W.packets = []; W.works = []; W.calls = [];
  step(S, 1100, 3);
  check('C8: back on the first character: no face from the cache before the server answers', W.works.length === 0 && loads().length === 0);
  step(S, 1100, 5);
  check('C8: ...it asks the server again, with nothing claimed', selfGets().length === 1 && selfGets()[0].have === '', selfGets());

  // a part-sent upload when the character changes
  S = spawned('face');
  const big = jslotWith(-0.6, true); big.morphs.sculpt[0].data = new Array(9000).fill(0).map((_, i) => [i, 100, -200, 300]);
  W.savedJslot = big;
  W.packets = [];
  W.menuOpen = true; step(S, 100); W.menuOpen = false; globalThis.__dboRaceMenuClosedAt = NOW; step(S, 1000, 4); step(S, 300, 2);
  const sentBefore = puts().length, total = puts().length ? puts()[0].n : 0;
  W.me = ME2;
  step(S, 300, 4); step(S, 1100, 2);
  step(S, 300, 20);
  check('a part-sent upload stops when the character changes, and says so', total > 4 && puts().length < total && puts().length <= sentBefore + 4
    && W.diag.some((l) => /upload dropped, the character changed/.test(l)), [sentBefore, puts().length, total]);
  W.savedJslot = jslotWith(-0.6, true);

  // ---- C8: a game load asks again ----
  S = spawned('face');
  W.packets = []; W.works = []; W.calls = [];
  S.emit('gameLoad');
  step(S, 1100, 3);
  check('C8: after a game load nothing is loaded from the cache', W.works.length === 0);
  step(S, 1100, 4);
  check('C8: ...the player asks the server for its face again', selfGets().length === 1 && selfGets()[0].have === '', selfGets());
  serverFace(S);
  step(S, 1100);
  check('C8: ...and the answer goes on the player', W.works.length === 1 && W.works[0].id === 0x14);

  // ---- C4: off ends with the connection ----
  S = spawned('none');
  deliver(S, { customPacketType: 'dboPresetNone', actor: 0xff0000aa, self: true, off: true });
  W.packets = [];
  step(S, 1100, 20);
  check('C4: the server\'s off switch stops asks this connection', W.packets.length === 0);
  S.emit('connectionAccepted');
  step(S, 1100, 8);
  check('C4: a new connection asks again (off is not latched for the game process)', selfGets().length === 1, W.packets);

  // ---- 10 Oct review G6: a stored face of another race family never goes on, so it must not hold every capture ----
  // A spawn with the player on `race` and the server's face (made on RACE, a Nord) delivered
  const spawnedOn = (race) => {
    clear();
    W.me = ME; W.actors[0x14] = { race, loaded: true, combat: false }; W.loadResult = true;
    const S2 = make(M.RacemenuPresetService, natives);
    step(S2, 1100, 7);
    serverFace(S2);
    step(S2, 1100);
    runWorks();
    return S2;
  };
  W.savedJslot = jslotWith(-0.6, true);
  S = spawnedOn(0x13741);
  editor(S);
  check('G6: a Nord face, the character now a Breton (a GM\'s /chargen): the face is never loaded', loads().length === 0, loads().length);
  check('G6: ...an editor close is not held: the face goes up with the new race and the server decides', puts().length === 1
    && puts()[0].hash === EDIT.hash && puts()[0].race === 0x13741, [puts(), W.diag.slice(-2)]);
  check('G6: ...traced as passed for another race family', TR.includes('rmp cap pass=otherrace race=13741 stored=13746'), TR.filter((l) => /^rmp cap/.test(l)).slice(-3));
  S = spawnedOn(0x88794);
  editor(S);
  check('G6: the same family (a Nord face on a Nord vampire): still held until the face is on', puts().length === 0
    && W.diag.some((l) => /capture held, the server's face is not back on yet \(race\)/.test(l)), W.diag.slice(-2));
  S = spawnedOn(0x67cd8);
  editor(S);
  check('G6: a race the server does not list (ElderRace): held as before', puts().length === 0
    && W.diag.some((l) => /capture held, the server's face is not back on yet \(race\)/.test(l)), W.diag.slice(-2));
  const fam = P.otherRaceFamily;
  check('G6: the plan: a race and its vampire are one family, a child race or another race is not, an unlisted race is unknown',
    typeof fam === 'function' && fam(0x13746, 0x88794) === false && fam(0x88794, 0x13746) === false && fam(0x13741, 0x13746) === true
    && fam(0x13746, 0x2c65b) === true && fam(0x13746, 0x13746) === false && fam(0x67cd8, 0x13746) === null && fam(0, 0x13746) === null);
  W.actors[0x14] = { race: RACE, loaded: true, combat: false };

  // ---- 10 Oct review: a refusal after the 15 s confirm, and a refusal while a newer face goes up ----
  S = spawned('face');
  W.savedJslot = jslotWith(-0.6, true);
  editor(S);
  step(S, 1000, 16);
  clear();
  deliver(S, { customPacketType: 'dboPresetRefused', hash: EDIT.hash, reason: 'notloaded' });
  step(S, 1100, 2);
  runWorks();
  check('late refusal: the refused face is not put back as the server\'s', !loads().some((c) => JSON.parse(c.file).morphs.custom[0].value === -0.6), loads().length);
  check('late refusal: ...the server is asked for its face again', selfGets().length === 1 && selfGets()[0].have === '', selfGets());
  serverFace(S);
  step(S, 1100);
  runWorks();
  check('late refusal: ...its answer goes on the player', loads().length === 1 && JSON.parse(loads()[0].file).morphs.custom[0].value === 0.4, loads().length);
  W.packets = [];
  editor(S);
  check('late refusal: ...and the same edit at the next close goes up again (not "unchanged")', puts().length === 1 && puts()[0].hash === EDIT.hash, [puts(), W.diag.slice(-2)]);
  check('late refusal: traced as an ask, marked late', TR.includes(`rmp refused h=${EDIT.hash} why=notloaded restore=ask late=1`), TR.filter((l) => /refused/.test(l)).slice(-2));

  S = spawned('face');
  W.savedJslot = jslotWith(-0.6, true);
  editor(S);
  W.savedJslot = big;
  clear();
  W.menuOpen = true; step(S, 100); W.menuOpen = false; globalThis.__dboRaceMenuClosedAt = NOW; step(S, 1000, 4); step(S, 300, 2);
  const bigTotal = puts().length ? puts()[0].n : 0;
  deliver(S, { customPacketType: 'dboPresetRefused', hash: EDIT.hash, reason: 'gold' });
  deliver(S, { customPacketType: 'dboPresetRefused', hash: '', reason: 'clear' });
  step(S, 300, bigTotal + 4);
  step(S, 1100, 2);
  runWorks();
  check('in flight: a refusal of the older face does not put the server\'s face back over the newer one going up', loads().length === 0, loads().length);
  check('in flight: ...neither it nor an empty-face refusal stops the newer upload', bigTotal > 4 && puts().length === bigTotal, [puts().length, bigTotal]);
  check('in flight: traced as left in flight', TR.includes(`rmp refused h=${EDIT.hash} why=gold restore=inflight`)
    && TR.includes('rmp refused h=empty why=clear restore=inflight'), TR.filter((l) => /refused/.test(l)).slice(-2));
  W.savedJslot = jslotWith(-0.6, true);

  // ---- C1: the head the editor left is sent as it is ----
  {
    clear();
    const sp = { Game: { getPlayer: () => ({ getRace: () => ({ getFormID: () => W.actors[0x14].race }), getBaseObject: () => ({}) }) },
      Ui: { isMenuOpen: () => W.menuOpen }, printConsole: () => {}, writeLogs: (_n, line) => W.diag.push(line) };
    const T = make(I.SendInputsService, sp);
    W.playerParts = [0x0001a2b3, 0x00024238];
    W.look = { raceId: RACE, isFemale: false, headpartIds: [0x0001a2b4, 0x00024238], options: [], presets: [], tints: [], name: '', weight: 50 };
    W.menuOpen = true; T.svc.sendAppearance();
    W.playerParts = [0x0001a2b4, 0x00024238];
    W.menuOpen = false; T.svc.sendAppearance();
    const sent = (T.c.emitMap.__sent || []).filter(([ev]) => ev === 'sendMessageWithRefrId').map(([, x]) => x.message);
    check('C1: a same-race Face part change is sent as the editor left it (no revert)', sent.length === 1 && sent[0].data.headpartIds.join() === [0x0001a2b4, 0x00024238].join(), sent);
    check('C1: ...and the log names both parts and leaves the decision to the server', W.diag.some((l) => /Face part 1a2b3 -> 1a2b4 sent as the editor left it \(race same, sex same\)/.test(l)), W.diag);
    check('C1: no "kept the pre-menu face" revert line', !W.diag.some((l) => /kept the pre-menu face/.test(l)));
    W.playerParts = [0x0001a2b3, 0x00024238];
  }

  // ---- extras: a menu open and a new spawn reset the dedupe ----
  {
    clear();
    W.applied = [];
    globalThis.__dboRaceMenuClosedAt = 0;
    const sp = { callNative: () => 0 };
    const E = make(X.AppearanceExtrasService, sp);
    const E0 = { f: 0, ov: [], tr: [['NPC Head [Head]', 'dbo', 1.1, 0]], mo: [] };
    const E1 = { f: 0, ov: [], tr: [['NPC Head [Head]', 'dbo', 1.3, 0]], mo: [] };
    const sets = () => W.packets.filter((p) => p.customPacketType === 'dboAppearanceExtras');
    E.emit('createActorMessage', { message: { isMe: true } });
    step(E, 600, 10);
    check('extras: the spawn asks for its own extras', W.packets.some((p) => p.customPacketType === 'dboAppearanceExtrasGet' && p.self === true));
    deliver(E, Object.assign({ customPacketType: 'dboAppearanceExtras', actor: ME, rev: 1, self: true }, E0));
    step(E, 600, 2);
    W.extras = E1;
    const close = () => { W.menuOpen = true; step(E, 100); W.menuOpen = false; globalThis.__dboRaceMenuClosedAt = NOW; step(E, 600, 8); };
    close();
    check('extras: a changed close sends the new extras', sets().length === 1 && sets()[0].tr[0][2] === 1.3, sets());
    deliver(E, Object.assign({ customPacketType: 'dboAppearanceExtras', actor: ME, rev: 1, self: true }, E0));
    step(E, 600, 2);
    W.packets = [];
    close();
    check('extras: the same extras after the server kept the old ones (refused) are sent again', sets().length === 1, W.packets);
    deliver(E, Object.assign({ customPacketType: 'dboAppearanceExtras', actor: ME, rev: 2, self: true }, E1));
    step(E, 600, 2);
    E.emit('createActorMessage', { message: { isMe: true } });
    step(E, 600, 10);
    deliver(E, { customPacketType: 'dboAppearanceExtras', actor: ME2, rev: 0, self: true, f: 0, ov: [], tr: [], mo: [] });
    step(E, 600, 2);
    W.packets = [];
    globalThis.__dboRaceMenuClosedAt = NOW;
    step(E, 600, 8);
    check('extras: a new spawn (another character) with the extras last sent sends them, menu seen open or not', sets().length === 1, W.packets);
    deliver(E, Object.assign({ customPacketType: 'dboAppearanceExtras', actor: ME2, rev: 1, self: true }, E1));
    step(E, 600, 2);
    W.packets = [];
    close();
    check('extras: an unchanged close that matches what the server holds sends nothing', sets().length === 0, W.packets);
  }

  // a server that never answers (no racemenupresets.js): the ask is traced twice, not every 15 s
  {
    clear();
    W.me = ME;
    const before = TR.length;
    const Q = make(M.RacemenuPresetService, natives);
    step(Q, 1100, 80);
    const asks = TR.slice(before).filter((l) => /^rmp ask/.test(l));
    check('trace: a server that never answers: 6 asks in 88 s, traced on the first and the fifth', selfGets().length === 6
      && asks.join('|') === 'rmp ask have=-|rmp ask have=- n=5 noanswer', [selfGets().length, asks]);
  }

  // ---- the trace: each step as codes, numbers and hashes ----
  const has = (line) => TR.includes(line);
  const like = (rx) => TR.some((l) => rx.test(l));
  check('trace: the own ask, with nothing claimed', has('rmp ask have=-'), TR.slice(0, 5));
  check('trace: the server\'s answer: face hash, chunks, size, sliders, sculpt, race', has(`rmp ans face h=${SERVER.hash} n=1 chars=${SERVER.text.length} cu=1 sc=1 race=13746`), TR.filter((l) => /ans face/.test(l)));
  check('trace: an answer of none, and the off switch', has('rmp ans none off=0') && has('rmp ans none off=1') && has('rmp off'));
  check('trace: the load on the player: hash, head parts, sculpt hosts dropped', has(`rmp apply ok h=${SERVER.hash} hp=1 drop=0`), TR.filter((l) => /apply/.test(l)));
  check('trace: a gate holding the load names it, once while it holds', TR.filter((l) => l === `rmp apply wait=combat h=${SERVER.hash}`).length === 1,
    TR.filter((l) => /apply wait/.test(l)));
  check('trace: a load skee refused', has(`rmp apply fail h=${SERVER.hash}`));
  check('trace: the load asks the look trace for a read-back now and 3 s later', RECHECKS.includes('rmface') && RECHECKS.includes('rmface+3'), RECHECKS.slice(0, 4));
  check('trace: captures held, with a code each', has('rmp cap held=noanswer') && has('rmp cap held=notyet-combat') && has('rmp cap held=loadfail'), TR.filter((l) => /held/.test(l)));
  check('trace: a capture sent: size, hash, sliders, sculpt, race, chunks', has(`rmp cap chars=${EDIT.text.length} h=${EDIT.hash} cu=1 sc=1 race=13746 send=1`), TR.filter((l) => /cap chars/.test(l)).slice(0, 3));
  check('trace: an unchanged capture is not sent and says so', like(new RegExp(`^rmp cap chars=\\d+ h=${EDIT.hash} cu=1 sc=1 race=13746 send=unchanged$`)));
  check('trace: the upload\'s last chunk', has(`rmp up done h=${EDIT.hash} n=1`));
  check('trace: a refusal: hash, reason, what went back', has(`rmp refused h=${EDIT.hash} why=gold restore=face`) && has('rmp refused h=deadbeef why=gold restore=ignored')
    && has(`rmp refused h=${EDIT.hash} why=other restore=face`) && has(`rmp refused h=${EDIT.hash} why=notLoaded restore=none`), TR.filter((l) => /refused/.test(l)));
  check('trace: an upload dropped by a character change', like(/^rmp up drop=character h=[0-9a-f]{8}$/));
  check('trace: RaceMenu open and close: race, sex, Face part, what changed', has('rm open r=13746 s=0 face=1a2b3') && has('rm close r=13746 s=0 face=1a2b4 race=same sex=same facepart=changed hp=2'), TR.filter((l) => /^rm /.test(l)));
  check('trace: extras: ask, answer with counts and hash, apply, capture sent / unchanged, a refusal seen as other',
    has('rmx ask self') && like(/^rmx ans ov=0 tr=1 mo=0 h=[0-9a-f]{8} rev=1 vs=-$/) && like(/^rmx apply ov=0 tr=1 mo=0 h=[0-9a-f]{8}$/)
    && like(/^rmx cap ov=0 tr=1 mo=0 h=[0-9a-f]{8} send=1$/) && like(/^rmx cap ov=0 tr=1 mo=0 h=[0-9a-f]{8} send=unchanged$/) && like(/^rmx ans .* vs=other$/), TR.filter((l) => /^rmx/.test(l)));
  check('trace: no path, quote or name in any line', TR.length > 30 && !TR.some((l) => /[\\"']|Actors|Character|\.tri|NPC Head/.test(l)), TR.filter((l) => /[\\"']|Actors|\.tri|NPC/.test(l)));

  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL harness threw', e && e.stack); process.exit(1); });
