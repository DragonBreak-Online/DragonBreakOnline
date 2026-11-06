// FormView's still-object gate (view/stillGate.ts), the real formView.ts driven against a fake engine that counts native calls.
//
// Why: 0.3.118 perf reports put WorldView at 42% of client JS. Within each client it costs ~0.07 ms a frame for every streamed
// world object without movement (doors, containers; perfDiag's "still", p90 40, p99 81), wherever the object is, although
// applyAll acts on them only every 133 ms or under the crosshair. The old formView.ts (default: the RC tip 7b4de14e7) is
// run beside the new one and every state-changing call is compared.
//
//   node tests/still-gate-harness.js [old-formView.ts]
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const client = path.resolve(__dirname, '..');
const SRC = path.join(client, 'src');
const ts = require(path.join(client, 'node_modules', 'typescript'));
const LF = (s) => s.split('\r\n').join('\n');
let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`);
  if (!ok) failures++;
};
const read = (rel) => LF(fs.readFileSync(path.join(SRC, rel + '.ts'), 'utf8'));
const NEW_FV = read('view/formView');
const OLD_FV = LF(process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8')
  : execSync('git show 7b4de14e7:skymp5-client/src/view/formView.ts', { cwd: client, encoding: 'utf8' }));
const GATE = read('view/stillGate');

// ---- the gate alone ----
const loadPlain = (src) => {
  const mod = {};
  new Function('exports', 'require', ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText)(mod, () => ({}));
  return mod;
};
const G = loadPlain(GATE);
{
  const s = G.newStillGate();
  const T = G.STILL_TICK_MS;
  check('the first update of a new ref runs', G.stillStep(s, 1000, false, false, () => 0.5) === G.STILL_RUN);
  check('...and its first tick lands somewhere in the tick after', s.nextAt === 1000 + T + Math.floor(0.5 * T), s.nextAt);
  check('updates before the tick are skipped', G.stillStep(s, 1100, false, false) === G.STILL_SKIP && G.stillStep(s, s.nextAt - 1, false, false) === G.STILL_SKIP);
  const due = s.nextAt;
  check('a frame late to its tick still ticks, and keeps the phase', G.stillStep(s, due + 9, false, false) === G.STILL_TICK && s.nextAt === due + T);
  check('a long pause (a menu, a load) skips the missed ticks, not the phase', G.stillStep(s, due + 10 * T + 3, false, false) === G.STILL_TICK && s.nextAt === due + 11 * T);
  check('a ref under the crosshair runs every update', G.stillStep(s, s.nextAt - 2, true, false) === G.STILL_RUN && G.stillStep(s, s.nextAt - 1, true, false) === G.STILL_RUN);
  check('a changed animation runs without moving the tick', (() => { const at = s.nextAt; return G.stillStep(s, at - 5, false, true) === G.STILL_RUN && s.nextAt === at; })());
  s.actor = true;
  check('an actor is never skipped', G.stillStep(s, s.nextAt - 5, false, false) === G.STILL_RUN);
  check('the tick is the open-state clock\'s 133 ms and a millisecond', T === 134 && /now - this\.lastOpenApply > 133/.test(NEW_FV));
}

// ---- the source ----
{
  const upd = NEW_FV.slice(NEW_FV.indexOf('  update(model: FormModel): void {'), NEW_FV.indexOf('  destroy(): void {'));
  const gateAt = upd.indexOf('if (refId && this.skipsStillUpdate(model))');
  check('the gate sits after the ref id is taken and before any native call on the ref', gateAt > upd.indexOf('if (this.refrId !== refId)') &&
    gateAt < upd.indexOf('const refr = ObjectReference.from(Game.getFormEx(this.refrId));\n    if (refr) {'), gateAt);
  check('a ref learns whether it is an actor as soon as it resolves', /const actor = Actor\.from\(refr\);\n\s*this\.stillGate\.actor = !!actor;/.test(upd));
  check('destroy (a new ref id, a removed form) starts the gate again', /this\.stillGate = newStillGate\(\);/.test(NEW_FV.slice(NEW_FV.indexOf('  destroy(): void {'))));
  check('only forms without movement or appearance, and only while driftConfig.stillGate is on',
    /if \(!driftConfig\.stillGate \|\| model\.movement \|\| model\.appearance\) return false;/.test(NEW_FV));
  check('a tick runs the open-state check', /if \(step === STILL_TICK\) this\.lastOpenApply = 0;/.test(NEW_FV));
  check('driftConfig takes stillGate as a boolean, on by default', /stillGate: true,/.test(read('sync/driftConfig')) && /stillGate: isBool,/.test(read('sync/driftConfig')));
}

// ---- the fake engine ----
const MUTATING = new Set(['blockActivation', 'setOpen', 'lock', 'setMotionType', 'disable', 'enable', 'setHarvested', 'activate', 'delete',
  'stopTranslation', 'setScale', 'setAlpha', 'startDeferredKill', 'setActorValue', 'restoreActorValue', 'setDisplayName', 'setPosition', 'setAngle',
  'clearKeepOffsetFromActor', 'evaluatePackage', 'enableAI', 'addItem', 'equipItem', 'removeFromAllFactions', 'setFactionRank', 'setCrimeFaction']);
const enumProxy = () => { const seen = {}; let n = 1; return new Proxy({}, { get: (_, k) => (typeof k === 'symbol' ? undefined : (seen[k] = seen[k] || n++)) }); };

const makeWorld = () => {
  const w = { now: 0, frame: 0, natives: 0, calls: [], refs: new Map(), crosshair: 0, woc: 0x3c, onceQ: [] };
  const FormType = enumProxy();
  const MotionType = enumProxy();
  const bases = new Map();
  const baseOf = (kind) => {
    if (!bases.has(kind)) {
      const id = 0x10000 + bases.size;
      bases.set(kind, new Proxy({ __base: true }, { get: (t, k) => {
        if (k in t || typeof k === 'symbol' || k === 'then') return t[k];
        return () => { w.natives++; return k === 'getType' ? FormType[kind] : k === 'getFormID' ? id : k === 'getName' ? kind : undefined; };
      } }));
    }
    return bases.get(kind);
  };
  w.addRef = (id, kind, opts = {}) => {
    const st = { resolved: opts.resolved !== false, loaded: !!opts.loaded, blocked: false, open: false, disabled: false, harvested: false };
    const known = {
      getFormID: () => id, is3DLoaded: () => st.loaded, getBaseObject: () => baseOf(kind), isActivationBlocked: () => st.blocked,
      blockActivation: (v) => { st.blocked = !!v; }, setOpen: (v) => { st.open = !!v; }, getOpenState: () => (st.open ? 1 : 3),
      setHarvested: (v) => { st.harvested = !!v; }, isHarvested: () => st.harvested,
      isDisabled: () => st.disabled, isLocked: () => false, getDisplayName: () => kind, isDead: () => false,
      isInCombat: () => false, getActorValue: () => 0, getBaseActorValue: () => 50, hasKeyword: () => false, getRace: () => null,
      getPositionX: () => 0, getPositionY: () => 0, getPositionZ: () => 0, getScale: () => 1, getFactionReaction: () => 0,
    };
    const ref = new Proxy({ __ref: true, __actor: kind === 'NPC' }, { get: (t, k) => {
      if (k in t || typeof k === 'symbol' || k === 'then') return t[k];
      return (...args) => {
        w.natives++;
        if (MUTATING.has(k) || !(k in known)) w.calls.push({ frame: w.frame, now: w.now, id, k, a: JSON.stringify(args.map((x) => (x && x.__base ? 'base' : x && x.__ref ? 'ref' : x))) });
        const r = known[k] ? known[k](...args) : undefined;
        return k === 'disable' || k === 'enable' ? Promise.resolve() : r;
      };
    } });
    w.refs.set(id, { ref, st });
    return st;
  };
  const resolve = (id) => { const r = w.refs.get(id); return r && r.st.resolved ? r.ref : null; };
  const counted = (f) => (...a) => { w.natives++; return f(...a); };
  const nullFrom = { from: counted(() => null), getKeyword: counted(() => null) };
  const sp = {
    FormType, MotionType,
    Game: { getFormEx: counted(resolve), getForm: counted(resolve), getPlayer: counted(() => null), getCurrentCrosshairRef: counted(() => null), findRandomActor: counted(() => null) },
    ObjectReference: { from: counted((x) => (x && x.__ref ? x : null)) },
    Actor: { from: counted((x) => (x && x.__ref && x.__actor ? x : null)) },
    ActorBase: nullFrom, EffectShader: nullFrom, Faction: nullFrom, Keyword: nullFrom, Spell: nullFrom, TextureSet: nullFrom, Form: nullFrom, Flora: nullFrom,
    NetImmerse: new Proxy({}, { get: () => counted(() => 0) }),
    TESModPlatform: new Proxy({}, { get: () => counted(() => undefined) }),
    Utility: { wait: () => Promise.resolve(), getINIInt: () => 0 },
    storage: {}, once: (ev, f) => { w.onceQ.push(f); }, printConsole: () => {},
    createText: () => 1, destroyText: () => {}, setTextColor: () => {}, setTextPos: () => {}, setTextSize: () => {}, setTextString: () => {},
    worldPointToScreenPoint: () => [[0, 0, 0]],
  };
  const noop = new Proxy({}, { get: (_, k) => (k === '__esModule' ? true : () => undefined) });
  const listener = new Proxy({}, { get: () => () => undefined });
  w.stubs = {
    'services/spApiInteractor': { SpApiInteractor: { getControllerInstance: () => ({ lookupListener: () => listener, emitter: { emit: () => {} } }) } },
    'services/services/worldCleanerService': { WorldCleanerService: class {} },
    'services/services/gamemodeUpdateService': { GamemodeUpdateService: class {} },
    'services/services/companionService': { isOwnCompanion: () => false, isAnyCompanion: () => false },
    'services/services/customPacketUtil': { sendCustomPacket: () => {} },
    'services/services/voiceSpeaking': { isSpeaking: () => false },
    'view/viewPerf': new Proxy({}, { get: (_, k) => (k === 'now' ? () => Date.now() : () => undefined) }),
    'view/playerCharacterDataHolder': { PlayerCharacterDataHolder: { getWorldOrCell: () => w.woc, getCrosshairRefId: () => w.crosshair, isInJumpState: () => false } },
    'view/faceSyncDiag': noop, 'view/faceSyncReport': noop, 'view/niNodeQueue': noop, 'view/flyerRuntime': { ...noop, isDragonCopy: () => false },
    'view/npcLifetimeRuntime': { hostBackoff: { due: () => false, sent: () => 0 }, maySpawnCopy: () => true, noteActorCall() {}, noteCopyBorn() {}, noteCopyPlaced() {}, safeDelete() {}, ragdolledAtOf: () => 0 },
    'view/nativeCreate': { nativeCreateCopy: () => null }, 'view/spawnProcess': { SpawnProcess: class {} },
    'view/takeoverDiag': { TAKEOVER_RECHECK_SECONDS: 5, isHostileTakeover: () => false, takeoverLine: () => '' },
    'view/hostAttempts': { lastTryHost: {}, tryHost() {} },
    'sync/animation': { setDefaultAnimsDisabled() {}, restoreSitCollisionIfMoving() {}, isInSitPose: () => false, clearSitPose() {},
      applyAnimation: (refr, anim, st) => { w.calls.push({ frame: w.frame, now: w.now, id: refr.getFormID(), k: 'applyAnimation', a: String(anim.numChanges) }); st.lastNumChanges = anim.numChanges; },
      setRefrCollision: (id, v) => { w.natives++; w.calls.push({ frame: w.frame, now: w.now, id, k: 'setRefrCollision', a: String(v) }); } },
    'sync/movementApply': { applyMovement() {}, forgetLocalCopy() {}, getApplyState: () => ({ translating: false, offset: 'none' }),
      settleTranslation: (refr) => { refr.getFormID(); refr.stopTranslation(); sp.Actor.from(refr); } },
    'sync/vampireLordAnimDiag': { isVampireLordRace: () => false, noteVampireLordAnim() {} },
    'sync/vampireHead': { newVampireHeadState: () => ({}), putVampireHead() {}, vampireHeadDue: () => false },
    'sync/appearance': { applyAppearance: () => null, eyesOf: () => null },
    'sync/equipment': { isBadMenuShown: () => false, applyEquipment: () => true, npcSidearmFor: () => 0 },
    'sync/beastBody': { beastBodyOf: () => 0, beastBodyAppearance: (a) => a },
    'sync/inventory': { applyInventory: (refr, inv) => { w.calls.push({ frame: w.frame, now: w.now, id: refr.getFormID(), k: 'applyInventory', a: JSON.stringify(inv) }); } },
    'logging': { logTrace() {}, logError() {} },
  };
  w.sp = sp;
  return w;
};

// Real modules under src, transpiled once per world; the stubs above and the fake engine stand in for the rest
const makeLoader = (w, overrides = {}) => {
  const cache = {};
  const load = (rel) => {
    if (w.stubs[rel]) return w.stubs[rel];
    if (cache[rel]) return cache[rel].exports;
    const src = overrides[rel] !== undefined ? overrides[rel] : read(rel);
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
    const m = { exports: {} };
    cache[rel] = m;
    const dir = path.posix.dirname(rel);
    new Function('exports', 'require', 'module', js)(m.exports, (spec) => {
      if (spec === 'skyrimPlatform' || spec === '@skyrim-platform/skyrim-platform') return w.sp;
      if (spec.startsWith('src/')) return load(spec.slice(4));
      if (!spec.startsWith('.')) throw new Error('unexpected import ' + spec + ' in ' + rel);
      return load(path.posix.normalize(path.posix.join(dir, spec)));
    }, m);
    return m.exports;
  };
  return load;
};

// Deterministic Math.random for the gate's stagger
const seeded = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// One run: forms is [{ id, kind, resolved, loaded, model }], events(frame, w, views) changes the world before the frame
const sim = (fvSrc, forms, frames, events = () => {}, opts = {}) => {
  const w = makeWorld();
  const load = makeLoader(w, { 'view/formView': fvSrc, ...(opts.overrides || {}) });
  const { FormView } = load('view/formView');
  load('sync/driftConfig').driftConfig.stillGate = opts.gate !== false;
  const realNow = Date.now, realRandom = Math.random;
  const dtRand = seeded(7);
  Math.random = seeded(11);
  Date.now = () => w.now;
  const views = forms.map((f) => {
    w.addRef(f.id, f.kind, f);
    return { f, view: new FormView(f.id), model: f.model || { refrId: f.id, isOpen: false } };
  });
  const perFrame = [];
  const dts = [];
  try {
    w.now = 100000;
    for (let fr = 0; fr < frames; fr++) {
      w.frame = fr;
      const dt = opts.dt || 12 + Math.floor(dtRand() * 11);
      dts.push(dt);
      w.now += dt;
      events(fr, w, views);
      const q = w.onceQ; w.onceQ = [];
      q.forEach((f) => f());
      const n0 = w.natives;
      for (const v of views) v.view.update(v.model);
      perFrame.push(w.natives - n0);
    }
  } finally { Date.now = realNow; Math.random = realRandom; }
  return { w, perFrame, maxDt: Math.max(...dts), views };
};

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const ID = (i) => 0x0001a000 + i;
const doors = () => {
  const forms = [];
  for (let i = 0; i < 20; i++) forms.push({ id: ID(i), kind: 'Door', loaded: true });
  for (let i = 20; i < 30; i++) forms.push({ id: ID(i), kind: 'Door', loaded: false });
  for (let i = 30; i < 40; i++) forms.push({ id: ID(i), kind: 'Container', resolved: false });
  for (let i = 40; i < 42; i++) forms.push({ id: ID(i), kind: 'Flora', loaded: true });
  return forms;
};
const FRAMES = 700;
// Server flips of isOpen for a few loaded doors after the warm-up, and another player's harvest of the two plants
const flips = (fr, w, views) => {
  if (fr >= 60 && fr % 47 === 0) { const v = views[(fr / 47) % 20 | 0]; v.model.isOpen = !v.model.isOpen; v.flips = (v.flips || []).concat([{ frame: fr, now: w.now, to: v.model.isOpen }]); }
  if (fr === 150 || fr === 401) { const v = views[fr === 150 ? 40 : 41]; v.model.isHarvested = true; v.harvestAt = w.now; v.harvestFrame = fr; }
};
const harvestLatency = (run) => run.views.filter((v) => v.harvestAt).map((v) => {
  const hit = run.w.calls.find((c) => c.id === v.f.id && c.k === 'setHarvested' && c.a === '[true]' && c.frame >= v.harvestFrame);
  return hit ? hit.now - v.harvestAt : Infinity;
});

// Each ref's state-changing calls with consecutive repeats folded: what the engine ends up told, in order
const story = (w, id) => {
  const out = [];
  for (const c of w.calls) if (c.id === id && c.k !== 'applyAnimation') { const s = c.k + c.a; if (out[out.length - 1] !== s) out.push(s); }
  return out.join(' ');
};
// ms from each flip to the first setOpen with its value
const flipLatency = (run) => {
  const lat = [];
  for (const v of run.views) for (const fl of v.flips || []) {
    const hit = run.w.calls.find((c) => c.id === v.f.id && c.k === 'setOpen' && c.a === `[${fl.to}]` && c.frame >= fl.frame);
    lat.push(hit ? hit.now - fl.now : Infinity);
  }
  return lat;
};
// Longest gap between two setOpen calls on a loaded door after the warm-up
const openGap = (run) => {
  let worst = 0;
  for (let i = 0; i < 20; i++) {
    const at = run.w.calls.filter((c) => c.id === ID(i) && c.k === 'setOpen' && c.frame >= 40).map((c) => c.now);
    for (let j = 1; j < at.length; j++) worst = Math.max(worst, at[j] - at[j - 1]);
  }
  return worst;
};

const suite = (newSrc, label, overrides) => {
  const f0 = failures;
  const O = (fn) => sim(OLD_FV, doors(), FRAMES, fn);
  const N = (fn, opts = {}) => sim(newSrc, doors(), FRAMES, fn, { overrides, ...opts });
  const old = O(flips), neu = N(flips);
  const warm = (r) => r.perFrame.slice(20);
  const oMean = mean(warm(old)), nMean = mean(warm(neu)), oMax = Math.max(...warm(old)), nMax = Math.max(...warm(neu));
  if (!label) console.log(`   42 still refs (20 loaded doors, 10 far doors, 10 unresolved, 2 plants): natives a frame old mean ${oMean.toFixed(1)} max ${oMax}, new mean ${nMean.toFixed(1)} max ${nMax}`);
  check(`${label}still refs cost under a quarter of the native calls`, nMean < oMean / 4, { oMean, nMean });
  check(`${label}no frame does more than half the old worst frame (the ticks are spread)`, nMax <= oMax / 2, { oMax, nMax });
  const same = doors().every((f) => story(old.w, f.id) === story(neu.w, f.id));
  check(`${label}every ref is told the same things in the same order`, same, doors().map((f) => f.id).filter((id) => story(old.w, id) !== story(neu.w, id)).map((id) => [story(old.w, id), story(neu.w, id)]).slice(0, 1));
  const oLat = flipLatency(old), nLat = flipLatency(neu);
  check(`${label}a server open or close reaches the door within one tick and a frame, as before`, Math.max(...nLat) <= 134 + neu.maxDt && Math.max(...oLat) <= 133 + old.maxDt, { old: Math.max(...oLat), new: Math.max(...nLat), maxDt: neu.maxDt });
  check(`${label}the open state is put back on loaded doors as often as before`, openGap(neu) <= 134 + neu.maxDt, { old: openGap(old), new: openGap(neu) });
  const oH = harvestLatency(old), nH = harvestLatency(neu);
  check(`${label}another player's harvest reaches the plant within its 666 ms clock and one tick`, nH.length === 2 && Math.max(...nH) <= 666 + 134 + neu.maxDt && Math.max(...oH) <= 666 + old.maxDt, { old: oH, new: nH });

  // The crosshair on a container with an inventory from the server: applied on that frame
  const look = (fr, w, views) => { if (fr === 300) { views[25].model.inventory = { entries: [{ baseId: 0xf, count: 3 }] }; w.crosshair = ID(25); } if (fr === 330) w.crosshair = 0; };
  const firstInv = (r) => (r.w.calls.find((c) => c.k === 'applyInventory') || {}).frame;
  const oL = O(look), nL = N(look);
  check(`${label}a container under the crosshair takes the server's inventory on the same frame`, firstInv(oL) === 300 && firstInv(nL) === 300, [firstInv(oL), firstInv(nL)]);

  // An unresolved ref whose cell attaches, and a far door whose 3D loads
  const attach = (fr, w) => { if (fr === 200) w.refs.get(ID(35)).st.resolved = true; if (fr === 250) w.refs.get(ID(22)).st.loaded = true; };
  const first = (r, id, k, from) => { const c = r.w.calls.find((x) => x.id === id && x.k === k && x.frame >= from); return c ? c.now : Infinity; };
  const oA = O(attach), nA = N(attach);
  const attachLat = first(nA, ID(35), 'blockActivation', 200) - first(oA, ID(35), 'blockActivation', 200);
  const loadLat = first(nA, ID(22), 'setRefrCollision', 250) - first(oA, ID(22), 'setRefrCollision', 250);
  check(`${label}a ref whose cell attaches is set up within one tick`, attachLat >= 0 && attachLat <= 134 + nA.maxDt, attachLat);
  check(`${label}a door whose 3D loads is seated within one tick`, loadLat >= 0 && loadLat <= 134 + nA.maxDt, loadLat);

  // A world actor without movement: never gated
  const actors = () => [0, 1, 2].map((i) => ({ id: ID(100 + i), kind: 'NPC', loaded: true }));
  const oN = sim(OLD_FV, actors(), 200), nN = sim(newSrc, actors(), 200, () => {}, { overrides });
  check(`${label}a world actor without movement does exactly what it did`, JSON.stringify(oN.perFrame) === JSON.stringify(nN.perFrame) &&
    JSON.stringify(oN.w.calls) === JSON.stringify(nN.w.calls), { old: mean(oN.perFrame), new: mean(nN.perFrame) });

  // driftConfig.stillGate false: the old behaviour, call for call
  const off = N(flips, { gate: false });
  check(`${label}with stillGate off every frame is the old one, call for call`, JSON.stringify(off.perFrame) === JSON.stringify(old.perFrame) &&
    JSON.stringify(off.w.calls) === JSON.stringify(old.w.calls), { old: mean(old.perFrame), off: mean(off.perFrame) });

  // A server animation on a still object: replayed on the frame it changed
  const anim = (fr, w, views) => { if (fr >= 120 && fr < 130) views[fr - 120].model.animation = { animEventName: 'Open', numChanges: 1 }; };
  const animFrames = (r) => [...Array(10).keys()].map((i) => (r.w.calls.find((c) => c.k === 'applyAnimation' && c.id === ID(i)) || {}).frame);
  const want = JSON.stringify([...Array(10).keys()].map((i) => 120 + i));
  check(`${label}an animation on a still object plays on the frame it arrives`, JSON.stringify(animFrames(O(anim))) === want && JSON.stringify(animFrames(N(anim))) === want, [animFrames(O(anim)), animFrames(N(anim))]);
  return failures - f0;
};

console.log('-- the new formView.ts against the old --');
suite(NEW_FV, '');

// Mutants: each must break at least one check above
const mutants = [
  ['the crosshair does not open the gate', { 'view/stillGate': GATE.replace('return targeted || animChanged ?', 'return animChanged ?') }],
  ['actors are gated too', { 'view/stillGate': GATE.replace('if (s.actor) return STILL_RUN;', '') }],
  ['the ref never learns it is an actor', { 'view/formView': NEW_FV.replace('this.stillGate.actor = !!actor;', '') }],
  ['the kill switch is ignored', { 'view/formView': NEW_FV.replace('!driftConfig.stillGate || ', '') }],
  ['a tick does not run the open-state check', { 'view/formView': NEW_FV.replace('if (step === STILL_TICK) this.lastOpenApply = 0;', '') }],
  ['ticks restart from the frame that ran them (refs drift together)', { 'view/stillGate': GATE.replace('s.nextAt += STILL_TICK_MS * (Math.floor((now - s.nextAt) / STILL_TICK_MS) + 1);', 's.nextAt = now + STILL_TICK_MS;') }],
  ['no stagger', { 'view/stillGate': GATE.replace(' + Math.floor(random() * STILL_TICK_MS)', '') }],
  ['animations wait for the tick', { 'view/stillGate': GATE.replace('return targeted || animChanged ?', 'return targeted ?') }],
];
let killed = 0;
const realLog = console.log;
for (const [name, ov] of mutants) {
  const f0 = failures;
  console.log = () => {};
  try { suite(ov['view/formView'] || NEW_FV, 'mutant: ', ov); } catch (e) { failures++; } finally { console.log = realLog; }
  const broke = failures > f0;
  failures = f0;
  if (broke) killed++;
  check(`mutant "${name}" is caught`, broke);
}
console.log(`${killed}/${mutants.length} mutants caught`);
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
