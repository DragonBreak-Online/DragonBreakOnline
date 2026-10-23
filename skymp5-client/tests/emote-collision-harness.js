// Scripted test for the emote collision re-assert and the drift stop (emoteService.ts, review of 5044e41eb, 23 Oct).
// Drives the real emoteService.ts against a stubbed game run the way SkyrimPlatform runs it:
//   - Papyrus natives (Utility.wait, Game.getPlayer, positions, sendAnimationEvent) throw outside an update, as
//     CallNativeApi.cpp does ("can't be called in this context"); buttonEvent is an update task, browserMessage a tick task,
//     custom packets come from the networking tick
//   - on and once callbacks share one map per event keyed by uid (EventsApi::SendEvent): the once ones are taken out before
//     any is called, one added during a dispatch runs on the next, and the order is the map's hash order, so every scenario
//     runs under several orders (registration, reverse, once-first, on-first and seeded hash orders)
// Run from skymp5-client:
//
//   node tests/emote-collision-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP emote-collision (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);
const DTS = path.resolve(__dirname, '../node_modules/@skyrim-platform/skyrim-platform/index.d.ts');
if (!fs.existsSync(DTS)) { console.log('SKIP emote-collision (no SkyrimPlatform typings)'); process.exit(0); }

// The const enums the bundle reads at run time (tsc inlines them in the real build), with their values from the typings
const enumsOf = (src) => {
  const out = {};
  for (const m of src.matchAll(/export const enum (\w+) \{([^}]*)\}/g)) {
    const e = {}; let next = 0;
    for (const raw of m[2].split(',')) {
      const item = raw.replace(/\/\/.*$/gm, '').trim();
      if (!item) continue;
      const [k, v] = item.split('=').map((s) => s.trim());
      if (v === undefined) { e[k] = next++; continue; }
      const str = v.match(/^'(.*)'$/) || v.match(/^"(.*)"$/);
      if (str) { e[k] = str[1]; continue; }
      e[k] = Number(v); next = e[k] + 1;
    }
    out[m[1]] = e;
  }
  return out;
};
const ENUMS = enumsOf(fs.readFileSync(DTS, 'utf8'));
const { DxScanCode, InputDeviceType } = ENUMS;

const STUBS = {
  skyrimPlatform: `module.exports = Object.assign(${JSON.stringify(ENUMS)}, { once: () => {} });`,
  clientListener: 'class ClientListener {} module.exports = { ClientListener };',
  customPacketUtil: `module.exports = {
    parseCustomPacket: (e) => { try { return JSON.parse(e.message.contentJsonDump); } catch { return null; } },
    sendCustomPacket: () => {}, notifyNextUpdate: () => {} };`,
  logging: 'module.exports = { logTrace() {}, logError() {} };',
  browserService: 'class BrowserService {} module.exports = { BrowserService };',
  restraintService: 'class RestraintService {} module.exports = { RestraintService };',
  networkingService: 'class NetworkingService {} module.exports = { NetworkingService };',
};
const STUB_OF = { skyrimPlatform: 'skyrimPlatform', './clientListener': 'clientListener', './customPacketUtil': 'customPacketUtil',
  '../../logging': 'logging', './browserService': 'browserService', './restraintService': 'restraintService',
  './networkingService': 'networkingService' };

const bundle = async (rel, dir) => {
  const out = path.join(dir, rel.replace(/\W/g, '_') + '.js');
  await esbuild.build({
    entryPoints: [path.resolve(__dirname, '../src', rel)], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => (STUB_OF[a.path] ? { path: STUB_OF[a.path], namespace: 'stub' } : undefined));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
    } }],
  });
  return require(out);
};

// ---- the stubbed game ---------------------------------------------------------------------------------------------------------
const FRAME_S = 0.05;
const G = { ctx: 'none', now: 0, timers: [], anims: [], collision: [], notes: [], errors: [], refuse: new Set(), hook: null };
const needVm = (what) => { if (G.ctx !== 'update') throw new Error(`'${what}' can't be called in this context`); };
const player = {
  x: 0, y: 0, z: 0, speed: 0, sitState: 0, furniture: null, mounted: false,
  getPositionX() { needVm('ObjectReference.GetPositionX'); return this.x; },
  getPositionY() { needVm('ObjectReference.GetPositionY'); return this.y; },
  getPositionZ() { needVm('ObjectReference.GetPositionZ'); return this.z; },
  getFormID() { needVm('Form.GetFormID'); return 0x14; },
  getFurnitureReference() { needVm('Actor.GetFurnitureReference'); return this.furniture; },
  isOnMount() { needVm('Actor.IsOnMount'); return this.mounted; },
  isWeaponDrawn() { needVm('Actor.IsWeaponDrawn'); return false; },
  isSwimming() { needVm('Actor.IsSwimming'); return false; },
  getSitState() { needVm('Actor.GetSitState'); return this.sitState; },
  getAnimationVariableBool() { needVm('ObjectReference.GetAnimationVariableBool'); return false; },
};
const sp = {
  settings: { 'skymp5-client': {} },
  getPluginSourceCode: () => '', writePlugin: () => {}, writeLogs: () => {},
  hooks: { sendAnimationEvent: { add: (h) => { G.hook = h; } } },
  browser: { isFocused: () => false, setFocused: () => {}, setVisible: () => {}, isVisible: () => true, executeJavaScript: () => {} },
  Ui: { isMenuOpen: () => false },
  Debug: {
    notification: () => {},
    sendAnimationEvent: (_ref, anim) => {
      needVm('Debug.SendAnimationEvent');
      G.anims.push(anim);
      if (G.hook) G.hook.leave({ animEventName: anim, animationSucceeded: !G.refuse.has(anim) });
    },
  },
  Utility: {
    wait: (sec) => {
      needVm('Utility.Wait');
      const t = { due: G.now + sec, cbs: [] };
      G.timers.push(t);
      return { then: (cb) => { t.cbs.push(cb); } };
    },
    isInMenuMode: () => false,
  },
  Game: { getPlayer: () => { needVm('Game.GetPlayer'); return player; } },
  setCollision: (id, on) => { needVm('setCollision'); G.collision.push([id, on]); },
};

// 32-bit avalanche of (uid, seed): a stand-in for robin_hood's hash order
const mix = (x, seed) => {
  let h = (x ^ Math.imul(seed, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};
const ORDERS = ['registration', 'reverse', 'once-first', 'on-first', 'hash 1', 'hash 2', 'hash 3', 'hash 4', 'hash 5', 'hash 6'];
const makeController = (order) => {
  let uid = 0;
  const subs = {};
  const emit = {};
  const add = (once) => (ev, fn) => { (subs[ev] = subs[ev] || new Map()).set(++uid, { fn, once }); };
  const sorted = (list) => {
    if (order === 'registration') return list;
    if (order === 'reverse') return list.slice().reverse();
    if (order === 'once-first') return list.filter(([, s]) => s.once).concat(list.filter(([, s]) => !s.once));
    if (order === 'on-first') return list.filter(([, s]) => !s.once).concat(list.filter(([, s]) => s.once));
    const seed = Number(order.split(' ')[1]);
    return list.slice().sort((a, b) => mix(a[0], seed) - mix(b[0], seed));
  };
  return {
    on: add(false), once: add(true),
    emitter: { on: (ev, fn) => { (emit[ev] = emit[ev] || []).push(fn); }, emit: (ev, x) => { for (const f of (emit[ev] || []).slice()) f(x); } },
    lookupListener: (ctor) => {
      const n = String(ctor && ctor.name).replace(/\d+$/, '');
      if (n === 'BrowserService') return { isBlockingMenuOpen: () => false, liveBlockingMenus: () => [], isUiHidden: () => false };
      if (n === 'RestraintService') return { isPoseLocked: false };
      throw new Error(`no ${ctor && ctor.name}`);
    },
    // EventsApi::SendEvent: each callback's throw is caught and logged
    fire(ev, ctx, x) {
      const m = subs[ev];
      if (!m) return;
      const list = sorted([...m.entries()]);
      for (const [id, s] of list) if (s.once) m.delete(id);
      const prev = G.ctx; G.ctx = ctx;
      for (const [, s] of list) {
        try { s.fn(x); } catch (e) { G.errors.push(`${s.once ? 'once' : 'on'}('${ev}'): ${e.message}`); }
      }
      G.ctx = prev;
    },
    // NetworkingService.onTick: EventEmitter3 lets a listener's throw out of emit
    packet(content) {
      const prev = G.ctx; G.ctx = 'tick';
      try { this.emitter.emit('customPacketMessage', { message: { contentJsonDump: JSON.stringify(content) } }); }
      catch (e) { G.errors.push(`networking tick (customPacketMessage): ${e.message}`); }
      G.ctx = prev;
    },
  };
};

let E, c, svc;
const fresh = (order) => {
  Object.assign(G, { ctx: 'none', now: 0, timers: [], anims: [], collision: [], notes: [], errors: [], refuse: new Set() });
  Object.assign(player, { x: 0, y: 0, z: 0, speed: 0, sitState: 0, furniture: null, mounted: false });
  c = makeController(order);
  svc = new E.EmoteService(sp, c);
};
// One frame: the body moves, due waits resolve (in update context, as SkyrimPlatform's promise queue does), then the update
const frame = () => {
  G.now = Math.round((G.now + FRAME_S) * 1000) / 1000;
  player.x += player.speed * FRAME_S;
  const due = G.timers.filter((t) => t.due <= G.now + 1e-9);
  G.timers = G.timers.filter((t) => t.due > G.now + 1e-9);
  const prev = G.ctx; G.ctx = 'update';
  for (const t of due) for (const cb of t.cbs) { try { cb(); } catch (e) { G.errors.push(`wait.then: ${e.message}`); } }
  G.ctx = prev;
  c.fire('update', 'update');
};
const run = (sec) => { for (let i = 0; i < Math.round(sec / FRAME_S); i++) frame(); };
const wheelPlay = (anim) => c.fire('browserMessage', 'tick', { arguments: ['emote:play', anim] });
const wheelStop = () => c.fire('browserMessage', 'tick', { arguments: ['emote:stop'] });
const key = (code) => c.fire('buttonEvent', 'update', { code, device: InputDeviceType.Keyboard, isDown: true, userEventName: '' });
const inUpdate = (fn) => { const prev = G.ctx; G.ctx = 'update'; try { fn(); } finally { G.ctx = prev; } };
const restoredOn = () => G.collision.length === 3 && G.collision.every(([id, on]) => id === 0x14 && on === true);
const restoredNote = () => G.notes.find((n) => n.startsWith('collision restored')) || '';

// Each scenario runs under every order and returns [passed, what it saw]
let failures = 0;
const scenario = (name, fn) => {
  const bad = [];
  for (const order of ORDERS) {
    fresh(order);
    let r;
    try { r = fn(); } catch (e) { r = [false, `threw ${e && e.message}`]; }
    if (!r[0]) bad.push(`${order}: ${JSON.stringify(r[1]).slice(0, 300)}`);
  }
  console.log(`${bad.length ? 'FAIL' : 'ok  '} ${name}${bad.length ? `   (${bad.length}/${ORDERS.length} orders) ${bad[0]}` : ''}`);
  if (bad.length) failures++;
};

(async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'emote-collision-'));
  try { E = await bundle('services/services/emoteService.ts', dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  globalThis.__dboDiagNote = (kind, text) => { if (kind === 'emote') G.notes.push(text); };

  // ---- the stop's context ---------------------------------------------------------------------------------------------------
  scenario("the wheel's Stop (tick context) throws nothing and switches collision back on three times", () => {
    wheelPlay('IdleSitCrossLeggedEnter'); run(0.5);
    if (!G.anims.includes('IdleSitCrossLeggedEnter')) return [false, G.anims];
    wheelStop(); run(3);
    return [G.errors.length === 0 && restoredOn(), { errors: G.errors, collision: G.collision }];
  });
  scenario('a dboIdleStop (networking tick) throws nothing out of the packet handler and switches collision back on', () => {
    c.packet({ customPacketType: 'dboIdle', anim: 'IdleBook_PageTurn', hold: true }); run(0.5);
    if (!G.anims.includes('IdleBook_PageTurn')) return [false, G.anims];
    c.packet({ customPacketType: 'dboIdleStop' }); run(3);
    return [G.errors.length === 0 && restoredOn(), { errors: G.errors, collision: G.collision }];
  });
  scenario('a movement key (update context) switches collision back on three times and writes one line', () => {
    wheelPlay('IdleKneelingEnter'); run(0.5);
    key(DxScanCode.W); run(3);
    return [G.errors.length === 0 && restoredOn() && G.notes.filter((n) => n.startsWith('collision restored')).length === 1,
      { errors: G.errors, collision: G.collision, notes: G.notes }];
  });
  scenario('a newer emote running at the re-assert is left alone, and no wait is left over', () => {
    wheelPlay('IdleKneelingEnter'); run(0.5);
    key(DxScanCode.W); run(0.1);
    wheelPlay('IdleWave'); run(3);
    return [G.collision.length === 0 && G.timers.length === 0, { collision: G.collision, timers: G.timers.length }];
  });
  scenario('sitting down before the re-assert: collision is left alone', () => {
    wheelPlay('IdleWave'); run(0.5);
    key(DxScanCode.W); player.furniture = {}; run(3);
    return [G.collision.length === 0, G.collision];
  });

  // ---- the start spot an emote ended without stopActiveEmote leaves behind ---------------------------------------------------
  const sentBeforeDrift = (anim) => G.anims.includes(anim) && !G.notes.some((n) => /before sent by the body moved/.test(n));
  scenario('after a drink (a self-ending idle), the next wheel emote 600 u away plays', () => {
    inUpdate(() => svc.playIdle('IdleDrink', 7, true)); run(7.5);
    if (!G.anims.includes('IdleDrink')) return [false, G.anims];
    player.x = 600; G.anims.length = 0; G.notes.length = 0;
    wheelPlay('IdleWave'); run(1);
    return [sentBeforeDrift('IdleWave'), { anims: G.anims, notes: G.notes }];
  });
  scenario('a second drink 400 u from the first plays its animation', () => {
    inUpdate(() => svc.playIdle('IdleDrink', 7, true)); run(7.5);
    player.y = 400; G.anims.length = 0; G.notes.length = 0;
    inUpdate(() => svc.playIdle('IdleDrink', 7, true)); run(1);
    return [sentBeforeDrift('IdleDrink'), { anims: G.anims, notes: G.notes }];
  });
  scenario("after a self-ending dboIdle (a trade's IdleTake), the next wheel emote 300 u away plays", () => {
    c.packet({ customPacketType: 'dboIdle', anim: 'IdleTake', seconds: 2, endsItself: true }); run(3);
    if (!G.anims.includes('IdleTake')) return [false, G.anims];
    player.x = 300; G.anims.length = 0; G.notes.length = 0;
    wheelPlay('IdleSalute'); run(1);
    return [sentBeforeDrift('IdleSalute'), { anims: G.anims, notes: G.notes }];
  });
  scenario('after a load during an emote, the first emote away from the old spot plays', () => {
    wheelPlay('IdleKneelingEnter'); run(0.5);
    c.emitter.emit('gameLoad', {});
    player.x = 4000; G.anims.length = 0; G.notes.length = 0;
    wheelPlay('IdleWave'); run(1);
    return [sentBeforeDrift('IdleWave'), { anims: G.anims, notes: G.notes }];
  });
  scenario('a ground pose settling 90 u keeps the emote, 110 u ends it', () => {
    wheelPlay('IdleSitCrossLeggedEnter'); run(0.5);
    G.anims.length = 0;
    player.x += 90; run(0.2);
    const kept = !G.anims.includes('IdleForceDefaultState');
    player.x += 20; run(0.2);
    return [kept && G.anims.includes('IdleForceDefaultState') && G.notes.some((n) => /by the body moved/.test(n)), { kept, anims: G.anims }];
  });

  // ---- the note's distance: what the body did while the emote ran, not after the stop ----------------------------------------
  const movedInNote = () => { const m = restoredNote().match(/body moved (\d+) u/); return m ? Number(m[1]) : null; };
  scenario('W then running on (370 u/s): the note says 0 u for an emote that never moved', () => {
    wheelPlay('IdleWave'); run(1);
    key(DxScanCode.W); player.speed = 370; run(3);
    return [movedInNote() === 0, restoredNote()];
  });
  scenario('40 u of drift during the emote, then W and running on: the note says 40 u', () => {
    wheelPlay('IdleWave'); run(1);
    player.x += 40; run(0.1);
    key(DxScanCode.W); player.speed = 370; run(3);
    return [movedInNote() === 40, restoredNote()];
  });
  scenario("40 u of drift, then the wheel's Stop (tick context): the note says 40 u", () => {
    wheelPlay('IdleWave'); run(1);
    player.x += 40; run(0.1);
    wheelStop(); player.speed = 85; run(3);
    return [movedInNote() === 40 && G.errors.length === 0, { note: restoredNote(), errors: G.errors }];
  });
  scenario('a walk-off stop names the distance at the stop (just over 96 u), not the run after it', () => {
    wheelPlay('IdleWave'); run(1);
    player.speed = 370; run(3);
    const moved = movedInNote();
    return [moved !== null && moved > 96 && moved <= 96 + 370 * FRAME_S + 1, restoredNote()];
  });

  // ---- the note names the exit the graph took and the sit state, for the walls report -------------------------------------
  scenario('W on Sit Crossed: the note names the forced exit the graph took (IdleForceDefaultState)', () => {
    wheelPlay('IdleSitCrossLeggedEnter'); run(1);
    key(DxScanCode.W); run(3);
    return [/forced exit IdleForceDefaultState/.test(restoredNote()), restoredNote()];
  });
  scenario("the wheel's Stop on Sit Crossed: the note names the pose's own exit (IdleChairExitStart)", () => {
    wheelPlay('IdleSitCrossLeggedEnter'); run(1);
    wheelStop(); run(3);
    return [/graceful exit IdleChairExitStart/.test(restoredNote()), restoredNote()];
  });
  scenario('an exit the graph refuses is never named as the one taken', () => {
    G.refuse.add('IdleForceDefaultState');
    wheelPlay('IdleSitCrossLeggedEnter'); run(1);
    key(DxScanCode.W); run(3);
    const note = restoredNote();
    return [/forced exit (IdleSitCrossLeggedExitStart|pending)/.test(note) && !/exit IdleForceDefaultState/.test(note), note];
  });
  scenario('the note carries the sit state while the emote ran and at the check', () => {
    wheelPlay('IdleSitCrossLeggedEnter'); run(0.3);
    player.sitState = 3; run(0.7);
    key(DxScanCode.W); player.sitState = 0; run(3);
    return [/sit state 3 at the stop and 0 at the check/.test(restoredNote()), restoredNote()];
  });
  fresh('registration'); G.refuse.add('IdleForceDefaultState');
  wheelPlay('IdleSitCrossLeggedEnter'); run(1); key(DxScanCode.W); run(3);
  console.log(`info the note, IdleForceDefaultState refused: ${restoredNote()}`);

  console.log(failures ? `${failures} FAIL` : 'all ok');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
