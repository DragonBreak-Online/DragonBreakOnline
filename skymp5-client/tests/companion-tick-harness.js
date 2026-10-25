// A "companionState" packet is handled in tick context (NetworkingService.onTick), where every Papyrus native throws
// "can't be called in this context". setCompanions refreshed the party panel there, and publishHud's getFormEx threw for
// any companion whose copy was loaded (LIKELY cerr ff5b66f6, 13 Oct): the panel kept its old rows and the clean-up after
// it never ran, so a companion that left the list kept its local state and its follower alias. Drives the real service
// against a fake game whose natives work only inside an update callback (Game.getPlayer works anywhere, as in Skyrim
// Platform's fast path). Run from skymp5-client:
//
//   node tests/companion-tick-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP companion-tick (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

// Remote ids (the server's) and the local ids of their copies here
const A = 0xff000500, B = 0xff000501;
const LOCAL = { [A]: 0xff100500, [B]: 0xff100501 };
const REMOTE = Object.fromEntries(Object.entries(LOCAL).map(([r, l]) => [l, Number(r)]));

const STUBS = {
  skyrimPlatform: `
    const W = () => globalThis.__ctick;
    module.exports = {
      Actor: { from: (f) => (f && f.isActor ? f : null) }, ObjectReference: { from: (f) => f || null },
      Quest: { from: () => null }, ReferenceAlias: { from: () => null },
      DxScanCode: { Num1: 79, Num2: 80, Num3: 81, Num4: 75 },
      get storage() { return W().storage; },
    };`,
  clientListener: 'class ClientListener {} module.exports = { ClientListener };',
  customPacketUtil: `module.exports = {
    parseCustomPacket: (e) => { try { return JSON.parse(e.message.contentJsonDump); } catch { return null; } },
    sendCustomPacket: (_c, p) => globalThis.__ctick.sent.push(p) };`,
  worldCleaner: 'class WorldCleanerService {} module.exports = { WorldCleanerService };',
  worldViewMisc: `
    const W = () => globalThis.__ctick;
    module.exports = {
      getViewFromStorage: () => null,
      isRemoteHostedByMe: () => true,
      isRemotePlayerCharacter: () => false,
      localIdToRemoteId: (l) => (l >= 0xff000000 ? (W().remote[l] || 0) : l),
      remoteIdToLocalId: (r) => (r >= 0xff000000 ? (W().local[r] || 0) : r),
    };`,
  ownCompanions: `
    const W = () => globalThis.__ctick;
    module.exports = { COMPANION_IDS_KEY: 'ownCompanionIds', isOwnCompanion: (id) => (W().storage.ownCompanionIds || []).includes(id),
      isAnyCompanion: (id) => (W().storage.ownCompanionIds || []).includes(id) };`,
  movementApply: 'module.exports = { applyMovement() {}, settleTranslation() {} };',
  objectReferenceEx: 'module.exports = { ObjectReferenceEx: { getWorldOrCell: () => 0x3c } };',
  hostAttempts: 'module.exports = { lastTryHost: {}, tryHost() {} };',
  empty: 'module.exports = {};',
  // The warband's quick-order keys (step 3): the fallback key, never blocked
  mouseKeys: 'module.exports = { buttonKeyCode: (e) => (typeof e.code === "number" ? e.code : null) };',
  widgetMenuUtil: 'module.exports = { readMenuKeyCode: (_sp, _n, f) => f, isMenuKeyPressBlocked: () => false };',
};
const STUB_OF = {
  skyrimPlatform: 'skyrimPlatform', './clientListener': 'clientListener', './customPacketUtil': 'customPacketUtil',
  './worldCleanerService': 'worldCleaner', '../../view/worldViewMisc': 'worldViewMisc', '../../sync/ownCompanions': 'ownCompanions',
  '../../sync/movementApply': 'movementApply', '../../extensions/objectReferenceEx': 'objectReferenceEx',
  '../../view/hostAttempts': 'hostAttempts', '../events/connectionMessage': 'empty', '../messages/customPacketMessage': 'empty',
  './mouseKeys': 'mouseKeys', './widgetMenuUtil': 'widgetMenuUtil',
};

// A native: works only inside an update callback, as in Skyrim Platform (CallNativeApi.cpp: no VM outside OnUpdate)
const native = (W, name, fn) => (...args) => {
  if (!W.inUpdate) throw new Error(`'${name}' can't be called in this context`);
  return fn(...args);
};
// A fake actor whose every method is a native; plain fields stay readable anywhere
const makeActor = (W, localId, pos, name) => {
  const a = {
    isActor: true, localId, pos, combatTarget: null,
    getFormID: () => localId, isDead: () => false, is3DLoaded: () => true, isDeleted: () => false, isDisabled: () => false,
    getPositionX: () => a.pos[0], getPositionY: () => a.pos[1], getPositionZ: () => a.pos[2], getAngleZ: () => 0,
    getDistance: (o) => Math.hypot(a.pos[0] - o.pos[0], a.pos[1] - o.pos[1], a.pos[2] - o.pos[2]),
    getCombatTarget: () => a.combatTarget, isInCombat: () => !!a.combatTarget,
    getActorValue: () => 100, getActorValuePercentage: () => 1, isAIEnabled: () => true, isWeaponDrawn: () => false,
    getBaseObject: () => ({ getName: () => name, getFormID: () => 0x617c9 }), getDisplayName: () => name,
    getParentCell: () => null, getWorldSpace: () => null, getCurrentPackage: () => null,
    getEquippedWeapon: () => null, getEquippedItemType: () => 0, hasPerk: () => false, placeAtMe: () => null,
  };
  for (const m of ['evaluatePackage', 'removeFromAllFactions', 'setFactionRank', 'setPlayerTeammate', 'ignoreFriendlyHits',
    'setActorValue', 'setDontMove', 'stopCombatAlarm', 'moveTo', 'setPosition', 'startCombat', 'stopCombat',
    'keepOffsetFromActor', 'clearKeepOffsetFromActor']) a[m] = () => {};
  const actor = new Proxy(a, { get: (t, k) => (typeof t[k] === 'function' ? native(W, `Actor.${String(k)}`, t[k]) : t[k]) });
  W.forms.set(localId, actor);
  return actor;
};

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-jake-companion-tick-'));
  const out = path.join(tmp, 'companionService.js');
  try {
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../src/services/services/companionService.ts')], bundle: true, platform: 'node',
      format: 'cjs', outfile: out, logLevel: 'error',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (STUB_OF[a.path] ? { path: STUB_OF[a.path], namespace: 'stub' } : undefined));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
      } }],
    });
    run(require(out));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
}

function run({ CompanionService }) {
  let now = 7_000_000;
  const realNow = Date.now;
  Date.now = () => now;
  const fresh = () => {
    const W = globalThis.__ctick = { storage: {}, sent: [], forms: new Map(), local: LOCAL, remote: REMOTE, inUpdate: false,
      tickErrors: [], updateErrors: [] };
    const player = makeActor(W, 0x14, [0, 0, 0], 'Owner');
    makeActor(W, LOCAL[A], [100, 0, 0], 'Familiar');
    makeActor(W, LOCAL[B], [0, 100, 0], 'Raised Bandit');
    const none = { from: () => null };
    const sp = {
      Game: { getPlayer: () => player, getFormEx: native(W, 'Game.getFormEx', (id) => W.forms.get(id >>> 0) || null),
        getFormFromFile: native(W, 'Game.getFormFromFile', () => null) },
      Actor: { from: (f) => (f && f.isActor ? f : null) }, Weapon: none, Spell: none, Scroll: none, Faction: none, Perk: none,
    };
    const ons = {}, onces = {}, emits = {};
    const controller = {
      emitter: { on: (n, fn) => { (emits[n] = emits[n] || []).push(fn); } },
      on: (n, fn) => { (ons[n] = ons[n] || []).push(fn); },
      once: (n, fn) => { (onces[n] = onces[n] || []).push(fn); },
      lookupListener: () => ({ sweepBurst() {} }),
    };
    const svc = new CompanionService(sp, controller);
    // NetworkingService.onTick: emitted in tick context, the throw ends the emit
    const tick = (ev, arg) => {
      W.inUpdate = false; W.tickErrors = [];
      try { (emits[ev] || []).forEach((f) => f(arg)); } catch (e) { W.tickErrors.push(e.message); }
    };
    const state = (companions) => tick('customPacketMessage', { message: { contentJsonDump: JSON.stringify({ customPacketType: 'companionState', companions }) } });
    // SkyrimPlatform's "update": every callback in its own try, the service's own handler first (subscribed first)
    const update = (ms = 300) => {
      now += ms;
      W.inUpdate = true;
      const fns = [...(ons.update || []), ...(onces.update || []).splice(0)];
      for (const f of fns) { try { f(); } catch (e) { W.updateErrors.push(e.message); } }
      W.inUpdate = false;
    };
    return { W, svc, tick, state, update, hud: () => (W.storage.dboCompanionHud || []).map((r) => r.name) };
  };

  let t = fresh();
  t.state([{ id: A }, { id: B }]);
  check('a companionState naming two loaded companions is taken in tick context without a throw', t.W.tickErrors.length === 0, t.W.tickErrors);
  t.update(50);
  check('...the next update fills the party panel with both, by name', JSON.stringify(t.hud()) === '["Familiar","Raised Bandit"]', t.hud());
  t.update(); t.update();
  check('...the update loop sets both up with no error', t.svc.local.has(A) && t.svc.local.has(B) && t.W.updateErrors.length === 0, t.W.updateErrors);

  t.svc.local.get(B).aliasSlot = 'Animal'; // B was forced into the DialogueFollower's Animal alias
  t.state([{ id: A }]);
  check('B leaving while A stays: no throw in tick context', t.W.tickErrors.length === 0, t.W.tickErrors);
  check('...B\'s local state is dropped', !t.svc.local.has(B) && t.svc.local.has(A), [...t.svc.local.keys()].map((k) => k.toString(16)));
  check('...and its follower alias is queued to be cleared', t.svc.pendingAliasClear.includes('Animal'), t.svc.pendingAliasClear);
  t.update(50); // shorter than the loop's applyIntervalMs: only the refresh from setCompanions runs
  check('...the panel shows A alone on the next update', JSON.stringify(t.hud()) === '["Familiar"]', t.hud());

  t.state([{ id: A, staying: true, leftMs: 60000 }]);
  t.update(50);
  const row = (t.W.storage.dboCompanionHud || [])[0];
  check('an order to stay with time left shows on the panel on the next update', t.W.tickErrors.length === 0 && row && row.staying === true
    && row.leftMs > 59900 && row.leftMs <= 60000 && row.id === LOCAL[A], { errors: t.W.tickErrors, row });

  t.state([]);
  t.update(50);
  check('the list emptied: no throw, and the panel is cleared', t.W.tickErrors.length === 0 && t.hud().length === 0 && t.svc.local.size === 0, t.hud());

  t = fresh();
  t.state([{ id: A }]);
  t.update(); t.update();
  t.tick('connectionAccepted');
  t.update(50);
  check('a new connection (in tick context) clears the list and the panel without a throw', t.W.tickErrors.length === 0 && t.hud().length === 0
    && (t.W.storage.ownCompanionIds || []).length === 0, { errors: t.W.tickErrors, hud: t.hud() });

  t = fresh();
  t.W.local = { [A]: LOCAL[A] };
  t.state([{ id: B }]);
  t.update(50);
  check('a companion with no copy here yet is listed as "Companion"', JSON.stringify(t.hud()) === '["Companion"]' && t.W.tickErrors.length === 0, t.hud());

  Date.now = realNow;
}

main().catch((e) => { console.error(e); process.exit(1); });
