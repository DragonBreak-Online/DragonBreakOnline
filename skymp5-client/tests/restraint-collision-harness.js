// Scripted test for the restrained player's own collision (restraintService.ts, review of 5044e41eb, 23 Oct): the leash
// and the carry move the local player with translateTo, which holds collision off, and stopTranslation alone does not
// reliably hand the body back to havok (movementApply.ts giveBackCollision). When a leash walk or a carry ends the body is
// stopped and its collision switched back on. Natives throw outside an update as in SkyrimPlatform, and the restraint
// packets arrive in the networking tick. Run from skymp5-client:
//
//   node tests/restraint-collision-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP restraint-collision (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

const G = { ctx: 'none', now: 1000, timers: [], collision: [], translations: [], stops: [], events: [], errors: [] };
globalThis.__rcG = G;
const needVm = (what) => { if (G.ctx !== 'update') throw new Error(`'${what}' can't be called in this context`); };
globalThis.__rcNeedVm = needVm;

const STUBS = {
  skyrimPlatform: 'module.exports = {};',
  clientListener: 'class ClientListener {} module.exports = { ClientListener };',
  logging: 'module.exports = { logTrace() {}, logError() {} };',
  empty: 'module.exports = {};',
  objectReferenceEx: `module.exports = { ObjectReferenceEx: {
    getWorldOrCell: () => 0x3c, getPos: (r) => [r.getPositionX(), r.getPositionY(), r.getPositionZ()],
    getDistance: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) } };`,
  worldViewMisc: 'module.exports = { remoteIdToLocalId: (id) => id };',
  animation: `module.exports = { isInSitPose: () => false,
    setRefrCollision: (id, on) => { globalThis.__rcNeedVm('setCollision'); globalThis.__rcG.collision.push([id, on]); } };`,
  paralysisService: 'class ParalysisService {} module.exports = { ParalysisService };',
};
const STUB_OF = { skyrimPlatform: 'skyrimPlatform', './clientListener': 'clientListener', '../../logging': 'logging',
  '../events/connectionMessage': 'empty', '../messages/customPacketMessage': 'empty', '../../sync/movement': 'empty',
  '../../extensions/objectReferenceEx': 'objectReferenceEx', '../../view/worldViewMisc': 'worldViewMisc',
  '../../sync/animation': 'animation', './paralysisService': 'paralysisService' };

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
const ref = (id, x) => ({
  id, x, y: 0, z: 0, furniture: null,
  getFormID() { needVm('Form.GetFormID'); return this.id; },
  getPositionX() { needVm('ObjectReference.GetPositionX'); return this.x; },
  getPositionY() { needVm('ObjectReference.GetPositionY'); return this.y; },
  getPositionZ() { needVm('ObjectReference.GetPositionZ'); return this.z; },
  getAngleX() { needVm('ObjectReference.GetAngleX'); return 0; },
  getAngleY() { needVm('ObjectReference.GetAngleY'); return 0; },
  getAngleZ() { needVm('ObjectReference.GetAngleZ'); return 0; },
  is3DLoaded() { needVm('ObjectReference.Is3DLoaded'); return true; },
  getFurnitureReference() { needVm('Actor.GetFurnitureReference'); return this.furniture; },
  getAnimationVariableBool() { needVm('ObjectReference.GetAnimationVariableBool'); return false; },
  setDontMove() { needVm('Actor.SetDontMove'); },
  modActorValue() { needVm('Actor.ModActorValue'); },
  translateTo() { needVm('ObjectReference.TranslateTo'); G.translations.push(this.id); G.events.push(['translate', this.id]); },
  stopTranslation() { needVm('ObjectReference.StopTranslation'); G.stops.push(this.id); G.events.push(['stop', this.id]); },
});
const PLAYER = 0x14, CAPTOR = 0xff000101, CARRIER = 0xff000202;
let player, captor, carrier;
const sp = {
  hooks: { sendAnimationEvent: { add: () => {} } },
  Game: {
    getPlayer: () => { needVm('Game.GetPlayer'); return player; },
    getFormEx: (id) => { needVm('Game.GetFormEx'); return id === CAPTOR ? captor : id === CARRIER ? carrier : null; },
    forceThirdPerson: () => needVm('Game.ForceThirdPerson'),
    disablePlayerControls: () => needVm('Game.DisablePlayerControls'),
    enablePlayerControls: () => needVm('Game.EnablePlayerControls'),
  },
  ObjectReference: { from: (f) => f },
  Debug: { sendAnimationEvent: () => needVm('Debug.SendAnimationEvent') },
  Utility: { wait: (sec) => { needVm('Utility.Wait'); const t = { due: G.now + sec, cbs: [] }; G.timers.push(t); return { then: (cb) => t.cbs.push(cb) }; } },
};
Date.now = () => Math.round(G.now * 1000);

const ORDERS = ['registration', 'reverse', 'once-first', 'on-first'];
const makeController = (order) => {
  let uid = 0;
  const subs = {};
  const emit = {};
  const add = (once) => (ev, fn) => { (subs[ev] = subs[ev] || new Map()).set(++uid, { fn, once }); };
  const sorted = (list) => {
    if (order === 'reverse') return list.slice().reverse();
    if (order === 'once-first') return list.filter(([, s]) => s.once).concat(list.filter(([, s]) => !s.once));
    if (order === 'on-first') return list.filter(([, s]) => !s.once).concat(list.filter(([, s]) => s.once));
    return list;
  };
  return {
    on: add(false), once: add(true),
    emitter: { on: (ev, fn) => { (emit[ev] = emit[ev] || []).push(fn); }, emit: (ev, x) => { for (const f of (emit[ev] || []).slice()) f(x); } },
    lookupListener: (ctor) => {
      if (String(ctor && ctor.name).replace(/\d+$/, '') === 'ParalysisService') return { reassert() {} };
      throw new Error(`no ${ctor && ctor.name}`);
    },
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
    packet(content) {
      const prev = G.ctx; G.ctx = 'tick';
      try { this.emitter.emit('customPacketMessage', { message: { contentJsonDump: JSON.stringify(content) } }); }
      catch (e) { G.errors.push(`networking tick (customPacketMessage): ${e.message}`); }
      G.ctx = prev;
    },
  };
};

let R, c;
const fresh = (order) => {
  Object.assign(G, { ctx: 'none', now: 1000, timers: [], collision: [], translations: [], stops: [], events: [], errors: [] });
  player = ref(PLAYER, 0); captor = ref(CAPTOR, 400); carrier = ref(CARRIER, 500);
  c = makeController(order);
  new R.RestraintService(sp, c);
};
const frame = () => {
  G.now = Math.round((G.now + 0.05) * 1000) / 1000;
  const due = G.timers.filter((t) => t.due <= G.now + 1e-9);
  G.timers = G.timers.filter((t) => t.due > G.now + 1e-9);
  const prev = G.ctx; G.ctx = 'update';
  for (const t of due) for (const cb of t.cbs) { try { cb(); } catch (e) { G.errors.push(`wait.then: ${e.message}`); } }
  G.ctx = prev;
  c.fire('update', 'update');
};
const run = (sec) => { for (let i = 0; i < Math.round(sec / 0.05); i++) frame(); };
const playerCollisionOn = () => G.collision.some(([id, on]) => id === PLAYER && on === true);
const playerStopped = () => G.stops.includes(PLAYER);
const clear = () => { G.collision.length = 0; G.stops.length = 0; G.translations.length = 0; G.events.length = 0; };

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
const leashed = () => {
  c.packet({ customPacketType: 'restraintState', boundHands: true, leash: CAPTOR }); run(0.5);
  return G.translations.includes(PLAYER);
};
const state = () => ({ stops: G.stops, collision: G.collision, errors: G.errors });

(async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'restraint-collision-'));
  try { R = await bundle('services/services/restraintService.ts', dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  scenario('a leash the server takes off (packet, tick context) stops the walk and switches the body\'s collision back on', () => {
    if (!leashed()) return [false, 'no leash walk'];
    clear();
    c.packet({ customPacketType: 'restraintState', boundHands: true }); run(0.5);
    return [playerStopped() && playerCollisionOn(), state()];
  });
  scenario('a leash going slack (update) stops the walk and switches the body\'s collision back on', () => {
    if (!leashed()) return [false, 'no leash walk'];
    clear();
    captor.x = 150; run(0.5);
    return [playerStopped() && playerCollisionOn(), state()];
  });
  scenario('a leash taken off and put back in the same tick keeps walking', () => {
    if (!leashed()) return [false, 'no leash walk'];
    clear();
    c.packet({ customPacketType: 'restraintState', boundHands: true });
    c.packet({ customPacketType: 'restraintState', boundHands: true, leash: CAPTOR }); run(0.5);
    const last = G.events.filter(([, id]) => id === PLAYER).pop();
    return [!!last && last[0] === 'translate' && G.errors.length === 0, G.events];
  });
  scenario('a carry that ends stops the body and switches its collision back on', () => {
    c.packet({ customPacketType: 'restraintState', carried: true, carrier: CARRIER, boundHands: true }); run(0.5);
    if (!G.translations.includes(PLAYER)) return [false, 'no carry follow'];
    clear();
    c.packet({ customPacketType: 'restraintState', carried: false, carrier: 0, boundHands: false }); run(0.5);
    return [playerStopped() && playerCollisionOn(), state()];
  });
  scenario('in furniture at the end: the walk is stopped, collision left to the furniture', () => {
    if (!leashed()) return [false, 'no leash walk'];
    clear();
    player.furniture = {};
    c.packet({ customPacketType: 'restraintState', boundHands: true }); run(0.5);
    return [playerStopped() && !playerCollisionOn(), state()];
  });
  scenario('bound and freed without a leash walk or a carry: nothing to hand back', () => {
    c.packet({ customPacketType: 'restraintState', boundHands: true }); run(0.5);
    c.packet({ customPacketType: 'restraintState', boundHands: false }); run(0.5);
    return [!playerStopped() && !playerCollisionOn() && G.errors.length === 0, state()];
  });

  console.log(failures ? `${failures} FAIL` : 'all ok');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
