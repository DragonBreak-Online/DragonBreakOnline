// A goblin's head is the skin's slot 30 piece (Goblin Head.nif, shader type 5 with FaceGen RGB Tint), not a FaceGen head. The live
// look change (sync/ownLook.ts -> applyAppearanceToPlayer: setNpcSkinColor, regenerateHead, NiNode update) recoloured the body and
// left that head as it was until a relog (Nat, 15 Oct: a goblin vampire's unfed pallor). This runs the real sync/appearance.ts and
// sync/ownLook.ts against a fake game (natives throw outside an update callback) and checks that a goblin whose skin colour changes
// in session gets one skee paint of the skin colour on the slot 30 skin (NiOverride.AddSkinOverrideInt, persist false), that a
// login or an unchanged colour paints nothing, that other races are left alone, and that the races are found by plugin and local
// id wherever the DLE loads (0x3C today, 0x48 in the Skyrim window), with a missing or older DLE doing nothing. Run from
// skymp5-client:
//
//   node tests/goblin-head-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP goblin-head (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);
const SRC = path.resolve(__dirname, '../src');
const read = (rel) => { try { return fs.readFileSync(path.join(SRC, rel), 'utf8'); } catch (e) { return ''; } };

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const DLE = 'DragonBreak Online Edits.esp';
// The DLE's records (read from the 15 Oct Skyrim-window plugin): local id -> editor id
const GOBLINS = { 0x1aca01: 'DBOGoblinRace', 0x1aca09: 'DBOGoblinSwampRace', 0x1aca11: 'DBOGoblinAshRace', 0x1aca19: 'DBOGoblinOchreRace', 0x1d1fa2: 'DBOGoblinRaceVampire' };
const NORD = 0x13746, WEREWOLF = 0xcdd84;
const G = globalThis.__GH = { inUpdate: false, menuOpen: false, loaded3D: true, sex: 1, slot: 0x48, dle: 'new', skee: true, liveRace: 0,
  events: [], traces: [], dleLookups: 0, errors: [], outside: [] };
const goblinId = (local) => ((G.slot << 24) | local) >>> 0;
G.liveRace = goblinId(0x1aca01);
let NOW = 7000000;
Date.now = () => NOW;
globalThis.__dboTrace = (t) => G.traces.push(String(t));
globalThis.__GHpending = [];
globalThis.__GHtimers = [];

const STUBS = {
  skyrimPlatform: `
    const G = globalThis.__GH;
    const native = (name, fn) => (...a) => { if (!G.inUpdate) { G.outside.push(name); throw new Error("'" + name + "' can't be called in this context"); } return fn(...a); };
    const race = (id) => ({ kind: 'RACE', getFormID: () => id >>> 0 });
    const base = { getFormID: () => 7, getName: () => '', getFaceMorph: () => 0, getSex: native('ActorBase.getSex', () => G.sex),
      setName() {}, setWeight() {}, setNthHeadPart() {}, setFaceTextureSet() {}, setVoiceType() {}, setFacePreset() {}, setFaceMorph() {} };
    const player = { getFormID: () => 0x14, startDeferredKill() {}, regenerateHead() {}, changeHeadPart() {},
      getBaseObject: native('Actor.getBaseObject', () => base),
      getRace: native('Actor.getRace', () => (G.liveRace ? race(G.liveRace) : null)),
      is3DLoaded: native('ObjectReference.is3DLoaded', () => G.loaded3D) };
    const getFormFromFile = native('Game.getFormFromFile', (local, file) => {
      if (file !== ${JSON.stringify(DLE)}) return null;
      G.dleLookups++;
      if (G.dle === 'missing') return null;
      if (G.dle === 'throws') throw new Error('no such plugin');
      // An older DLE: the local id is some other record
      if (G.dle === 'old') return { kind: 'MISC', getFormID: () => ((G.slot << 24) | local) >>> 0 };
      return ${JSON.stringify(Object.keys(GOBLINS).map(Number))}.includes(local >>> 0) ? race((G.slot << 24) | local) : null;
    });
    module.exports = {
      Game: { getPlayer: () => player, getFormEx: () => null, getFormFromFile },
      Ui: { isMenuOpen: native('Ui.isMenuOpen', (m) => m === 'RaceSex Menu' && G.menuOpen) },
      ActorBase: { from: (b) => b }, Actor: { from: (a) => a }, ObjectReference: {},
      Race: { from: (f) => (f && f.kind === 'RACE' ? f : null) }, HeadPart: { from: () => null }, TextureSet: { from: () => null }, VoiceType: { from: () => null },
      TESModPlatform: { setNpcSex() {}, setNpcRace() {}, setNpcSkinColor: native('TESModPlatform.setNpcSkinColor', (n, c) => { G.events.push({ what: 'skin', c }); }),
        setNpcHairColor() {}, resizeHeadpartsArray() {}, clearTintMasks() {}, pushTintMask() {}, setFormIdUnsafe() {}, createNpc: () => null },
      callNative: native('callNative', (cls, fn, self, ...args) => {
        if (!G.skee) throw new Error('Unknown class ' + cls);
        G.events.push({ what: 'native', cls, fn, self, args: args.map((a) => (a && a.getFormID ? 'ref:' + a.getFormID().toString(16) : a)), t: Date.now() });
        return null;
      }),
      printConsole() {}, writeLogs() {},
      once: (ev, fn) => { if (ev !== 'update') throw new Error('unexpected once ' + ev); pending.push(fn); },
      on() {},
      Utility: { wait: (s) => ({ then: (fn) => { timers.push({ at: Date.now() + s * 1000, fn }); } }) },
    };
    const pending = globalThis.__GHpending = [];
    const timers = globalThis.__GHtimers = [];`,
  niNodeQueue: `export const queuePlayerNiNodeUpdate = () => { globalThis.__GH.events.push({ what: 'niNode', t: Date.now() }); };
    export const queuePlayerNiNodeWork = () => {}; export const queueCopyNiNodeUpdate = () => {}; export const queueCopyNiNodeWork = () => {};`,
};

// One frame: due timers resolve (promise context), then the update callbacks queued before it run; 16 ms a frame
const frame = () => {
  const timers = globalThis.__GHtimers, pending = globalThis.__GHpending;
  for (let i = timers.length - 1; i >= 0; i--) if (timers[i].at <= NOW) { const t = timers.splice(i, 1)[0]; try { t.fn(); } catch (e) { G.errors.push('timer ' + e.message); } }
  G.inUpdate = true;
  for (const fn of pending.splice(0)) { try { fn(); } catch (e) { G.errors.push('update ' + e.message); } }
  G.inUpdate = false;
  NOW += 16;
};
const runFor = (ms) => { const end = NOW + ms; while (NOW < end) frame(); };
const inUpdate = (fn) => { G.inUpdate = true; try { return fn(); } finally { G.inUpdate = false; } };

const look = (o = {}) => Object.assign({ isFemale: true, raceId: goblinId(0x1aca01), weight: 50, skinColor: 0x4a7a32, hairColor: 0x222222,
  headpartIds: [], headTextureSetId: 0, options: [], presets: [0, 0, 0, 0], tints: [], name: 'Grukka' }, o);
const PALE = 0x9cb08a;
const paints = () => G.events.filter((e) => e.what === 'native' && e.fn === 'AddSkinOverrideInt');
const headTraces = () => G.traces.filter((t) => /^goblin head/.test(t));
const clear = () => { G.events = []; G.traces = []; G.errors = []; G.outside = []; };

async function main() {
  // ---- the source: the races by plugin and local id, no load-order slot, and the call after the NiNode update ----------------------
  const races = read('sync/goblinRaces.ts'), head = read('sync/goblinHead.ts'), app = read('sync/appearance.ts');
  for (const [local, edid] of Object.entries(GOBLINS)) {
    check(`goblinRaces.ts lists ${edid} as the DLE's local id ${Number(local).toString(16)}`,
      new RegExp(`\\[DLE, 0x0*${Number(local).toString(16)}, "${edid}"\\]`).test(races));
  }
  check('...and names the DLE by its file name', /export const DLE = "DragonBreak Online Edits\.esp";/.test(races));
  const slotted = /0x(3c|48)[0-9a-f]{6}\b/i;
  check('no goblin race id is written with a load-order slot (0x3C.. or 0x48..)', !!races && !slotted.test(races) && !!head && !slotted.test(head));
  check('goblinHead.ts finds them with Game.getFormFromFile and keeps only races', /Race\.from\(Game\.getFormFromFile\(localId, file\)\)/.test(head));
  const apply = (app.match(/export const applyAppearanceToPlayer = [\s\S]*?\n};/) || [''])[0];
  check('applyAppearanceToPlayer calls goblinHeadAfterLook after the NiNode update', /queuePlayerNiNodeUpdate\(\);[\s\S]*goblinHeadAfterLook\(appearance, event\);/.test(apply), apply.slice(-400));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-goblinhead-'));
  try {
    const entry = path.join(tmp, 'entry.ts');
    fs.writeFileSync(entry, [`export * as APP from ${JSON.stringify(path.join(SRC, 'sync/appearance.ts'))};`,
      `export * as OWN from ${JSON.stringify(path.join(SRC, 'sync/ownLook.ts'))};`].join('\n'));
    const allOut = path.join(tmp, 'all.js');
    await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: allOut, logLevel: 'error',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /^skyrimPlatform$/ }, () => ({ path: 'skyrimPlatform', namespace: 'stub' }));
        b.onResolve({ filter: /niNodeQueue$/ }, () => ({ path: 'niNodeQueue', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: a.path === 'skyrimPlatform' ? 'js' : 'ts' }));
      } }] });
    // A fresh client (module state, race cache) for each load order
    let n = 0;
    const fresh = () => { const f = path.join(tmp, `c${n++}.js`); fs.copyFileSync(allOut, f); return require(f); };
    run(fresh);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function run(fresh) {
  const setWorld = (o) => { Object.assign(G, { menuOpen: false, loaded3D: true, sex: 1, slot: 0x48, dle: 'new', skee: true, dleLookups: 0 }, o);
    G.liveRace = o && 'liveRace' in o ? o.liveRace : goblinId(0x1aca01); globalThis.__GHpending.length = 0; globalThis.__GHtimers.length = 0; clear(); };
  const login = (A, l) => { inUpdate(() => A.applyAppearanceToPlayer(l, false, 'load')); runFor(6000); clear(); };
  const loadOrder = (slot) => { setWorld({ slot }); return fresh().APP; };

  // ---- a goblin vampire's unfed pallor, through the real live path (ownLook offers it, an update puts it on) -----------------------
  setWorld({});
  let M = fresh();
  const A = M.APP;
  const own = new M.OWN.OwnLookQueue((fn) => globalThis.__GHpending.push(fn), () => {});
  login(A, look());
  check('a login paints nothing: its save carries the skin colour, so the head comes in that colour', paints().length === 0, G.events);
  own.putOn(); runFor(6000); clear();
  own.offer(look({ skinColor: PALE }));
  runFor(7000);
  let p = paints();
  const ni = G.events.findIndex((e) => e.what === 'niNode');
  check('the pallor that reaches the player (ownLook update) paints the head piece', p.length >= 1, G.events.map((e) => e.what + (e.fn ? ':' + e.fn : '')));
  check('...through skee\'s static NiOverride.AddSkinOverrideInt', p.length >= 1 && p.every((e) => e.cls === 'NiOverride' && e.self === undefined), p);
  check('...with (the player, isFemale, third person, slot 30 mask 0x1, key 7 tint colour, index -1, the new skin colour, persist false)',
    p.length >= 1 && JSON.stringify(p[0].args) === JSON.stringify(['ref:14', true, false, 1, 7, -1, PALE, false]), p[0] && p[0].args);
  check('...after the NiNode update went out', ni >= 0 && G.events.indexOf(p[0]) > ni, G.events.map((e) => e.what));
  check('...painted at about 1 s and again at about 4 s, no more', p.length === 2 && p[1].t - p[0].t >= 2500, p.map((e) => e.t));
  check('...and traced as "goblin head tint=9cb08a update+1s"', headTraces().includes('goblin head tint=9cb08a update+1s'), headTraces());
  check('...with no native called outside an update and no error', G.outside.length === 0 && G.errors.length === 0, [G.outside, G.errors]);

  clear();
  own.offer(look({ skinColor: PALE, headpartIds: [0x1a2b3] }));
  runFor(7000);
  check('a look with the same skin colour (the tell eyes only) paints nothing', paints().length === 0, G.events);

  clear();
  own.offer(look({ skinColor: 0x4a7a32 }));
  runFor(7000);
  check('the cure (the mortal colour back) paints the head again', paints().length === 2 && paints()[0].args[6] === 0x4a7a32, paints());

  // ---- other mortal skin-tone changes mid-game: an admin's appearance edit, the creator's preview, an in-session respawn ------------
  clear();
  inUpdate(() => A.applyAppearanceToPlayer(look({ skinColor: 0x6b8e23 }), true, 'update'));
  runFor(5000);
  check('an admin\'s appearance edit on a goblin (a new mortal skin colour) paints it', paints().length === 2 && paints()[0].args[6] === 0x6b8e23, paints());
  clear();
  inUpdate(() => A.applyAppearanceToPlayer(look({ skinColor: 0x557733 }), false, 'preview'));
  runFor(5000);
  check('the creator\'s preview with a new skin colour paints it', paints().length === 2 && paints()[0].args[6] === 0x557733, paints());
  clear();
  inUpdate(() => A.applyAppearanceToPlayer(look({ skinColor: 0x335577 }), false, 'spawn'));
  runFor(5000);
  check('an in-session respawn (moveRefrToPosition, no load) with another colour paints it', paints().length === 2 && paints()[0].args[6] === 0x335577, paints());

  // ---- each goblin race, the look's race alone, and the male sex -------------------------------------------------------------------
  let all = true;
  for (const local of Object.keys(GOBLINS).map(Number)) {
    setWorld({ liveRace: goblinId(local) });
    const B = fresh().APP;
    login(B, look({ raceId: goblinId(local) }));
    inUpdate(() => B.applyAppearanceToPlayer(look({ raceId: goblinId(local), skinColor: PALE }), true, 'update'));
    runFor(5000);
    if (paints().length !== 2) { all = false; console.log('   no paint for', GOBLINS[local]); }
  }
  check('every goblin race (the four DBOGoblin* and DBOGoblinRaceVampire) is painted', all);
  setWorld({ sex: 0 });
  let B = fresh().APP;
  login(B, look({ isFemale: false }));
  inUpdate(() => B.applyAppearanceToPlayer(look({ isFemale: false, raceId: goblinId(0x1d1fa2), skinColor: PALE }), true, 'update'));
  runFor(5000);
  check('a male goblin whose look names DBOGoblinRaceVampire (live race DBOGoblinRace) is painted as male', paints().length === 2 && paints()[0].args[1] === false, paints());

  // ---- other races and beasts are left alone ----------------------------------------------------------------------------------------
  setWorld({ liveRace: NORD });
  B = fresh().APP;
  login(B, look({ raceId: NORD }));
  inUpdate(() => B.applyAppearanceToPlayer(look({ raceId: NORD, skinColor: PALE }), true, 'update'));
  runFor(5000);
  check('a Nord\'s new skin colour calls no NiOverride native', !G.events.some((e) => e.what === 'native'), G.events);
  setWorld({});
  B = fresh().APP;
  login(B, look());
  inUpdate(() => B.applyAppearanceToPlayer(look({ skinColor: PALE }), true, 'update'));
  G.liveRace = WEREWOLF;
  runFor(5000);
  check('a goblin who turned werewolf before the paint is not painted (beast guard)', paints().length === 0 && headTraces().some((t) => /skip=guarded/.test(t)), headTraces());

  // ---- the races are found by plugin and local id wherever the DLE loads --------------------------------------------------------------
  for (const slot of [0x3c, 0x48]) {
    B = loadOrder(slot);
    login(B, look({ raceId: goblinId(0x1aca01) }));
    inUpdate(() => B.applyAppearanceToPlayer(look({ raceId: goblinId(0x1aca01), skinColor: PALE }), true, 'update'));
    runFor(5000);
    check(`with the DLE at load index ${slot.toString(16).toUpperCase()} the goblin (${goblinId(0x1aca01).toString(16)}) is painted`, paints().length === 2, G.events);
  }
  B = loadOrder(0x48);
  login(B, look());
  for (let i = 0; i < 4; i++) { inUpdate(() => B.applyAppearanceToPlayer(look({ skinColor: 0x100000 + i }), true, 'update')); runFor(5000); }
  check('...looked up once and kept: five DLE lookups over four looks', G.dleLookups === 5, G.dleLookups);
  for (const dle of ['missing', 'old', 'throws']) {
    setWorld({ dle });
    B = fresh().APP;
    login(B, look());
    let threw = null;
    try { inUpdate(() => B.applyAppearanceToPlayer(look({ skinColor: PALE }), true, 'update')); } catch (e) { threw = e.message; }
    runFor(5000);
    check(`a DLE ${dle === 'old' ? 'whose ids are other records (no goblin races yet)' : dle === 'missing' ? 'that is not loaded' : 'lookup that throws'}: no paint, no error, the NiNode update still goes out`,
      !threw && paints().length === 0 && G.errors.length === 0 && G.events.some((e) => e.what === 'niNode'), { threw, e: G.events, err: G.errors });
  }

  // ---- when the paint waits or gives up -------------------------------------------------------------------------------------------
  setWorld({});
  B = fresh().APP;
  login(B, look());
  inUpdate(() => B.applyAppearanceToPlayer(look({ skinColor: PALE }), true, 'update'));
  G.menuOpen = true;
  runFor(5000);
  check('RaceMenu open: no paint, traced skip=menu', paints().length === 0 && headTraces().some((t) => /skip=menu/.test(t)), headTraces());
  G.menuOpen = false; clear();
  inUpdate(() => B.applyAppearanceToPlayer(look({ skinColor: PALE }), true, 'update'));
  runFor(5000);
  check('...the next look with that colour still paints (the head never showed it)', paints().length === 2, paints());

  setWorld({});
  B = fresh().APP;
  login(B, look());
  inUpdate(() => B.applyAppearanceToPlayer(look({ skinColor: PALE }), true, 'update'));
  G.loaded3D = false;
  runFor(2000);
  G.loaded3D = true;
  runFor(3000);
  check('3D not loaded at 1 s: painted once, at 4 s', paints().length === 1 && headTraces().includes('goblin head tint=9cb08a update+4s'), headTraces());

  setWorld({});
  B = fresh().APP;
  login(B, look());
  inUpdate(() => B.applyAppearanceToPlayer(look({ skinColor: PALE }), true, 'update'));
  runFor(300);
  inUpdate(() => B.applyAppearanceToPlayer(look({ skinColor: 0x4a7a32, name: 'Grukka the Cured' }), true, 'update'));
  runFor(5000);
  check('a newer look before the paint cancels it: the head keeps the colour it shows, nothing painted', paints().length === 0, paints());

  setWorld({ skee: false });
  B = fresh().APP;
  login(B, look());
  let threw = null;
  try { inUpdate(() => B.applyAppearanceToPlayer(look({ skinColor: PALE }), true, 'update')); } catch (e) { threw = e.message; }
  runFor(5000);
  check('no skee64: no error out of the apply, traced as goblin head err', !threw && G.errors.length === 0 && headTraces().some((t) => /^goblin head err update\+1s/.test(t)), { threw, t: headTraces(), e: G.errors });

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
