// A dboGlow "off" or "clear" never put a glow out: the packet is handled in tick context (NetworkingService.onTick), where
// every Papyrus native throws "can't be called in this context". stop() forgot the glow first, then its shader lookup
// caught that throw and found no shader, and refOf's getFormEx threw (a cerr ff5b66f6 candidate, 13 Oct), so the shader
// played on (a loot lease's chest, a Racial Power's look on a player) until the ref unloaded, and the packet's other refs
// were not even tried. Drives the real service against a fake game whose natives work only inside an update callback.
// Run from skymp5-client:
//
//   node tests/glow-stop-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP glow-stop (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

const CHEST = 0x000abcde, BARREL = 0x000abcdf;          // plugin refs keep their own id
const CASTER = 0xff000777, CASTER_LOCAL = 0xff100777;   // a player: the server's id, and the local copy's
const LOOT = 0x146, LOCKED = 0xaaeb3, CHAMPION = 0xdc209, RIM = 0x10272e;

const STUBS = {
  skyrimPlatform: `module.exports = {
    EffectShader: { from: (f) => (f && f.isShader ? f : null) }, ObjectReference: { from: (f) => (f && f.isRef ? f : null) } };`,
  clientListener: 'class ClientListener {} module.exports = { ClientListener };',
  customPacketUtil: `module.exports = {
    parseCustomPacket: (e) => { try { return JSON.parse(e.message.contentJsonDump); } catch { return null; } } };`,
  worldViewMisc: `module.exports = { remoteIdToLocalId: (r) => globalThis.__gstop.local[r] || 0 };`,
  empty: 'module.exports = {};',
};
const STUB_OF = {
  skyrimPlatform: 'skyrimPlatform', './clientListener': 'clientListener', './customPacketUtil': 'customPacketUtil',
  '../../view/worldViewMisc': 'worldViewMisc', '../events/connectionMessage': 'empty', '../messages/customPacketMessage': 'empty',
};

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-jake-glow-stop-'));
  const out = path.join(tmp, 'dboGlowService.js');
  try {
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../src/services/services/dboGlowService.ts')], bundle: true, platform: 'node',
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

function run({ DboGlowService }) {
  let now = 9_000_000;
  const realNow = Date.now;
  Date.now = () => now;
  const fresh = () => {
    const W = globalThis.__gstop = { inUpdate: false, forms: new Map(), local: { [CASTER]: CASTER_LOCAL }, tickErrors: [], updateErrors: [] };
    // A native works only inside an update callback, as in Skyrim Platform (CallNativeApi.cpp: no VM outside OnUpdate)
    const native = (name, fn) => (...args) => {
      if (!W.inUpdate) throw new Error(`'${name}' can't be called in this context`);
      return fn(...args);
    };
    const ref = (id) => {
      const r = { isRef: true, playing: new Set(), getFormID: native('Form.getFormID', () => id), isDisabled: native('ObjectReference.isDisabled', () => false),
        isDeleted: native('ObjectReference.isDeleted', () => false), is3DLoaded: native('ObjectReference.is3DLoaded', () => true) };
      W.forms.set(id, r);
      return r;
    };
    const shader = (id) => W.forms.set(id, { isShader: true, id,
      play: native('EffectShader.play', (r) => r.playing.add(id)), stop: native('EffectShader.stop', (r) => r.playing.delete(id)) });
    [LOOT, LOCKED, CHAMPION, RIM].forEach(shader);
    const refs = { chest: ref(CHEST), barrel: ref(BARREL), caster: ref(CASTER_LOCAL) };
    const sp = { Game: { getFormEx: native('Game.getFormEx', (id) => W.forms.get(id >>> 0) || null) } };
    const ons = {}, onces = {}, emits = {};
    const controller = {
      emitter: { on: (n, fn) => { (emits[n] = emits[n] || []).push(fn); } },
      on: (n, fn) => { (ons[n] = ons[n] || []).push(fn); },
      once: (n, fn) => { (onces[n] = onces[n] || []).push(fn); },
    };
    const svc = new DboGlowService(sp, controller);
    // NetworkingService.onTick: emitted in tick context, the throw ends the emit
    const glow = (p) => {
      W.inUpdate = false; W.tickErrors = [];
      try { (emits.customPacketMessage || []).forEach((f) => f({ message: { contentJsonDump: JSON.stringify({ customPacketType: 'dboGlow', ...p }) } })); }
      catch (e) { W.tickErrors.push(e.message); }
    };
    // SkyrimPlatform's "update": every callback in its own try; ms past the service's 1 s poll by default
    const update = (ms = 1100) => {
      now += ms;
      W.inUpdate = true;
      const fns = [...(ons.update || []), ...(onces.update || []).splice(0)];
      for (const f of fns) { try { f(); } catch (e) { W.updateErrors.push(e.message); } }
      W.inUpdate = false;
    };
    const on = (r) => [...r.playing].map((s) => s.toString(16));
    return { W, svc, refs, glow, update, on };
  };

  let t = fresh();
  t.glow({ refs: [CHEST], on: true, kind: 'loot' });
  t.update();
  check('a chest the server points at glows after the next poll', JSON.stringify(t.on(t.refs.chest)) === '["146"]' && t.svc.getGlowingCount() === 1, t.on(t.refs.chest));
  t.glow({ refs: [CHEST], on: false, kind: 'loot' });
  check('"off" is taken in tick context without a throw', t.W.tickErrors.length === 0, t.W.tickErrors);
  t.update(16);
  check('...and the next update puts the glow out', t.on(t.refs.chest).length === 0 && t.svc.getGlowingCount() === 0 && t.W.updateErrors.length === 0,
    { playing: t.on(t.refs.chest), glowing: t.svc.getGlowingCount(), errors: t.W.updateErrors });
  t.update();
  check('...and it stays out', t.on(t.refs.chest).length === 0, t.on(t.refs.chest));

  t = fresh();
  t.glow({ refs: [CHEST, BARREL], on: true, kind: 'loot' });
  t.update();
  t.glow({ refs: [CHEST, BARREL], on: false, kind: 'loot' });
  t.update(16);
  check('two refs turned off in one packet both go out', t.on(t.refs.chest).length === 0 && t.on(t.refs.barrel).length === 0 && t.W.tickErrors.length === 0,
    { chest: t.on(t.refs.chest), barrel: t.on(t.refs.barrel), errors: t.W.tickErrors });

  t = fresh();
  t.glow({ refs: [CASTER], on: true, kind: 'champion' });
  t.glow({ refs: [CHEST], on: true, kind: 'locked' });
  t.update();
  check('a player\'s look is played on the local copy of that player', JSON.stringify(t.on(t.refs.caster)) === '["dc209"]', t.on(t.refs.caster));
  t.glow({ clear: true });
  check('"clear" is taken in tick context without a throw', t.W.tickErrors.length === 0, t.W.tickErrors);
  t.update(16);
  check('...and puts out every glow, the player\'s and the chest\'s', t.on(t.refs.caster).length === 0 && t.on(t.refs.chest).length === 0
    && t.svc.getGlowingCount() === 0, { caster: t.on(t.refs.caster), chest: t.on(t.refs.chest) });

  t = fresh();
  t.glow({ refs: [CHEST], on: true, kind: 'loot' });
  t.update();
  t.glow({ refs: [CHEST], on: true, kind: 'loot', shader: RIM });
  check('a new shader for a glowing chest is taken in tick context without a throw', t.W.tickErrors.length === 0, t.W.tickErrors);
  t.update(); t.update();
  check('...the old shader goes out and the new one is played', JSON.stringify(t.on(t.refs.chest)) === '["10272e"]', t.on(t.refs.chest));

  t = fresh();
  t.glow({ refs: [CHEST], on: true, kind: 'loot' });
  t.update();
  t.glow({ refs: [CHEST], on: false, kind: 'loot' });
  t.glow({ refs: [CHEST], on: true, kind: 'loot' });
  t.update(); t.update();
  check('off and on again before the update: the chest glows after the next poll', JSON.stringify(t.on(t.refs.chest)) === '["146"]'
    && t.svc.getGlowingCount() === 1, { playing: t.on(t.refs.chest), errors: t.W.tickErrors });

  t = fresh();
  t.glow({ refs: [CHEST], on: true, kind: 'loot' });
  t.update();
  t.glow({ refs: [CHEST], on: false, kind: 'locked' });
  t.update(); t.update();
  check('"off" for another kind leaves the glow on (one system never switches off another\'s)', JSON.stringify(t.on(t.refs.chest)) === '["146"]'
    && t.W.tickErrors.length === 0, t.on(t.refs.chest));

  Date.now = realNow;
}

main().catch((e) => { console.error(e); process.exit(1); });
