// WorldEditService (0.3.102): the server's worldEdits list (worldedit.js) hides and moves what the plugins placed, on every
// client. Drives the real service against a fake game: natives throw in the packet (tick) context, latent ones (disable,
// enable, setPosition, setAngle) take effect only when the Papyrus VM runs them after the update, a cell can unload and
// load again (keeping or losing what changed), and the server's own SpSnippets (SetPosition to clients in view, sent
// before the list) can run first. Also the Place tab's select tool fallback (placementService pluginRefAhead). Run from
// skymp5-client:
//
//   node tests/worldedit-client-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP worldedit-client (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

// Named imports of spec in importer, so a stub can export exactly those
const importsOf = (importer, spec) => {
  let src = '';
  try { src = fs.readFileSync(importer, 'utf8'); } catch (e) { return []; }
  const names = new Set();
  for (const m of src.matchAll(/import\s+(?:type\s+)?([^;]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    if (m[2] !== spec) continue;
    const br = m[1].replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').match(/\{([\s\S]*)\}/);
    if (br) for (const p of br[1].split(',')) { const n = p.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim(); if (n) names.add(n); }
  }
  return [...names];
};
globalThis.__weU = (() => {
  const f = function () {};
  const U = new Proxy(f, { get: (t, k) => (k === 'then' || typeof k === 'symbol' ? undefined : k === 'prototype' ? t.prototype : U), apply: () => U, construct: () => U });
  return U;
})();
const stubPlugin = (keep) => ({ name: 'stubs', setup(b) {
  b.onResolve({ filter: /.*/ }, (a) => {
    if (a.kind === 'entry-point' || keep.some((k) => a.path.endsWith(k))) return undefined;
    return { path: `${a.path}|${a.importer}`, namespace: 'stub' };
  });
  b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => {
    const [spec, importer] = a.path.split('|');
    const names = new Set(importsOf(importer, spec));
    const own = globalThis.__weStubs[spec] || {};
    Object.keys(own).forEach((n) => names.add(n));
    const S = `(globalThis.__weStubs[${JSON.stringify(spec)}] || {})`;
    const lines = [...names].filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && n !== 'default')
      .map((n) => `export const ${n} = Object.prototype.hasOwnProperty.call(${S}, ${JSON.stringify(n)}) ? ${S}[${JSON.stringify(n)}] : globalThis.__weU;`);
    return { contents: `${lines.join('\n')}\nexport default globalThis.__weU;\n`, loader: 'js' };
  });
} });

const FT = { Activator: 24, Container: 28, Door: 29, Light: 31, Static: 34, MovableStatic: 36, Tree: 38, Flora: 39, Furniture: 40 };
let W = null;
const native = (name, fn) => (...a) => {
  if (W.ctx === 'tick') throw new Error(`'${name}' can't be called in this context`);
  W.natives++;
  return fn(...a);
};
class ClientListener {}
globalThis.__weStubs = {
  skyrimPlatform: {
    FormType: FT,
    Game: {
      getFormEx: (id) => native('Game.getFormEx', (i) => { W.getFormEx++; const r = W.refs.get(i >>> 0); return r && r.inMemory ? r.api : null; })(id),
      getPlayer: () => W.player, getCurrentCrosshairRef: () => W.crosshair,
    },
    ObjectReference: { from: (f) => f || null },
    Debug: { notification: (t) => W.notes.push(t) },
  },
  './clientListener': { ClientListener },
  '../../logging': { logError: (...a) => W.errors.push(a.slice(1).join(' ')), logTrace: () => {} },
};

// A plugin reference at its plugin pose; what changed stays while its cell unloads, unless the cell comes back fresh
const makeRef = (id, pos, rot, o = {}) => {
  const r = { id, pos: pos.slice(), rot: rot.slice(), disabled: !!o.disabled, loaded: o.loaded !== false, inMemory: o.inMemory !== false, plugin: { pos: pos.slice(), rot: rot.slice() }, type: o.type || FT.Static };
  const latent = (name, fx) => (...a) => { W.calls.push([id, name, ...a]); W.vm.push(() => fx(...a)); return Promise.resolve(); };
  const m = {
    getFormID: () => id, isDisabled: () => r.disabled, is3DLoaded: () => r.loaded && !r.disabled,
    getPositionX: () => r.pos[0], getPositionY: () => r.pos[1], getPositionZ: () => r.pos[2],
    getAngleX: () => r.rot[0], getAngleY: () => r.rot[1], getAngleZ: () => r.rot[2],
    disable: latent('disable', () => { r.disabled = true; }),
    enable: latent('enable', () => { r.disabled = false; }),
    setPosition: latent('setPosition', (x, y, z) => { r.pos = [x, y, z]; }),
    setAngle: latent('setAngle', (x, y, z) => { r.rot = [x, y, z]; }),
  };
  r.api = new Proxy(m, { get: (t, k) => (typeof t[k] === 'function' ? native(`ObjectReference.${String(k)}`, t[k]) : t[k]) });
  W.refs.set(id, r);
  return r;
};

async function bundle(entry, keep, tmp) {
  const out = path.join(tmp, path.basename(entry).replace(/\.ts$/, '.js'));
  await esbuild.build({ entryPoints: [path.resolve(__dirname, '..', entry)], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error', plugins: [stubPlugin(keep)] });
  return require(out);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-jake-worldedit-client-'));
  try {
    const { WorldEditService } = await bundle('src/services/services/worldEditService.ts', ['/customPacketUtil'], tmp);
    runService(WorldEditService);
    const { PlacementService } = await bundle('src/services/services/placementService.ts', [], tmp);
    runPick(PlacementService);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
}

const P0 = [1000, 2000, 300], R0 = [0, 0, 90];
const P1 = [1100, 2050, 310], R1 = [0, 0, 180];
const S1 = 0x0001a2b3, M1 = 0x0002c3d4, C1 = 0x0003e5f6, F1 = 0x0004a1b2;
const near = (a, b, eps = 0.01) => a.every((v, i) => Math.abs(v - b[i]) <= eps);

function fresh(Service) {
  W = { ctx: 'tick', refs: new Map(), vm: [], calls: [], sent: [], errors: [], tickErrors: [], updateErrors: [], natives: 0, getFormEx: 0, notes: [], now: 7_000_000, onces: [] };
  const ons = {}, emits = {};
  const controller = {
    emitter: { on: (n, fn) => { (emits[n] = emits[n] || []).push(fn); }, emit: (n, e) => { if (n === 'sendMessage') W.sent.push(JSON.parse(e.message.contentJsonDump)); } },
    on: (n, fn) => { (ons[n] = ons[n] || []).push(fn); },
    once: (n, fn) => { if (n === 'update') W.onces.push(fn); },
    lookupListener: () => ({ modWcProtection() {} }),
  };
  const svc = new Service({}, controller);
  const vm = () => { for (const fx of W.vm.splice(0)) fx(); };
  const tick = (ev, arg) => { W.ctx = 'tick'; try { (emits[ev] || []).forEach((f) => f(arg)); } catch (e) { W.tickErrors.push(e.message); } };
  const t = {
    svc, W,
    packet: (edits) => tick('customPacketMessage', { message: { contentJsonDump: JSON.stringify({ customPacketType: 'worldEdits', edits }) } }),
    raw: (json) => tick('customPacketMessage', { message: { contentJsonDump: json } }),
    me: (isMe) => tick('createActorMessage', { message: { isMe, refrId: 0xff000d0d, idx: 1 } }),
    // One frame: SpSnippets queued with once('update') and every update handler, then the VM
    update: (ms = 16) => {
      W.now += ms; W.ctx = 'update';
      for (const f of [...W.onces.splice(0), ...(ons.update || [])]) { try { f(); } catch (e) { W.updateErrors.push(e.message); } }
      W.ctx = 'tick'; vm();
    },
    run: (ms, step = 100) => { for (let i = 0; i < ms; i += step) t.update(step); },
    loaded: (id) => { const r = W.refs.get(id); W.ctx = 'event'; (ons.objectLoaded || []).forEach((f) => f({ object: r.api, isLoaded: true })); W.ctx = 'tick'; vm(); },
    unloadCell: (id) => { const r = W.refs.get(id); r.inMemory = false; r.loaded = false; },
    // The cell attaches again; fresh: the reference comes back as its plugin has it (a relaunch, or the engine let it go)
    loadCell: (id, freshRef = false) => {
      const r = W.refs.get(id);
      if (freshRef) { r.pos = r.plugin.pos.slice(); r.rot = r.plugin.rot.slice(); r.disabled = false; }
      r.inMemory = true; r.loaded = true;
      if (!r.disabled) t.loaded(id);
    },
    // The server's Papyrus SetPosition reaches clients in view as an SpSnippet, run on the next update (spSnippetService)
    snippet: (id, fn, args) => { W.onces.push(() => { const r = W.refs.get(id); r.api[fn](...args); }); },
    calls: (id, name) => W.calls.filter((c) => c[0] === id && (!name || c[1] === name)),
  };
  Date.now = () => W.now;
  return t;
}

function runService(Service) {
  const realNow = Date.now;
  const idx = fs.readFileSync(path.resolve(__dirname, '../src/index.ts'), 'utf8');
  check('WorldEditService is registered in index.ts', /import \{ WorldEditService \} from "\.\/services\/services\/worldEditService";/.test(idx) && /new WorldEditService\(sp, controller\)/.test(idx));

  // Login: the list is asked for once, for this player's own character only, in the packet context
  let t = fresh(Service);
  t.me(false);
  check('another actor streaming in asks for nothing', t.W.sent.length === 0, t.W.sent);
  t.me(true);
  check('this player\'s character arriving sends dbo worldEditsRequest [] once, with no throw in the packet context', t.W.sent.length === 1 && t.W.sent[0].customPacketType === 'dbo'
    && t.W.sent[0].event === 'worldEditsRequest' && JSON.stringify(t.W.sent[0].args) === '[]' && t.W.tickErrors.length === 0, { sent: t.W.sent, errors: t.W.tickErrors });

  // The server as live today (placement.worldEdit.client false) answers nothing: nothing in the game may change
  t = fresh(Service);
  makeRef(S1, P0, R0); makeRef(M1, P0, R0);
  t.me(true);
  t.run(60000, 250);
  t.loaded(S1); t.loaded(M1);
  t.unloadCell(M1); t.loadCell(M1); t.run(5000, 250);
  check('no worldEdits from the server: a minute of play and cell loads change nothing (no disable, enable or move)', t.W.calls.length === 0, t.W.calls);
  check('...and the sweep looks nothing up (no getFormEx)', t.W.getFormEx === 0, t.W.getFormEx);
  t.packet([]);
  t.run(5000, 250);
  check('an empty list changes nothing either', t.W.calls.length === 0 && t.W.getFormEx === 0, t.W.calls);

  // Hide a loaded static
  t = fresh(Service);
  const s1 = makeRef(S1, P0, R0);
  t.packet([{ ref: S1, hide: true }]);
  check('the list is taken in the packet context without a throw', t.W.tickErrors.length === 0, t.W.tickErrors);
  t.update();
  check('a hidden static is disabled on the next update', s1.disabled === true && t.calls(S1, 'disable').length === 1, t.calls(S1));
  t.run(10000, 100);
  t.packet([{ ref: S1, hide: true }]);
  t.run(5000, 100);
  check('...once: ten seconds of sweeps and the same list again call nothing more', t.calls(S1).length === 1, t.calls(S1));
  check('...nothing logged as an error', t.W.errors.length === 0 && t.W.updateErrors.length === 0, [t.W.errors, t.W.updateErrors]);

  // Cell reload, hidden
  t.unloadCell(S1); t.run(3000); t.loadCell(S1); t.run(3000);
  check('a hidden static stays hidden when its cell loads again (the game kept it disabled), with no new call', s1.disabled === true && t.calls(S1).length === 1, t.calls(S1));
  t.unloadCell(S1); t.run(3000); t.loadCell(S1, true);
  check('...and when it comes back as the plugin has it, it is hidden again at once as its 3D loads', s1.disabled === true && t.calls(S1, 'disable').length === 2, t.calls(S1));
  t.run(3000);
  check('...once', t.calls(S1, 'disable').length === 2, t.calls(S1));

  // Hide a reference whose cell is not loaded yet
  t = fresh(Service);
  const far = makeRef(F1, P0, R0, { inMemory: false, loaded: false });
  t.packet([{ ref: F1, hide: true }]);
  t.run(5000);
  check('a hidden reference in a cell not loaded: nothing called, no error', t.W.calls.length === 0 && t.W.errors.length === 0 && t.W.updateErrors.length === 0, [t.W.calls, t.W.errors, t.W.updateErrors]);
  t.loadCell(F1);
  check('...disabled the moment its 3D loads (objectLoaded, before any update)', far.disabled === true && t.calls(F1, 'disable').length === 1, t.calls(F1));

  // Move a loaded reference
  t = fresh(Service);
  const m1 = makeRef(M1, P0, R0);
  t.packet([{ ref: M1, hide: false, pos: P1, rot: R1 }]);
  t.update();
  check('a moved reference is put at its new place and angle on the next update', near(m1.pos, P1) && near(m1.rot, R1), { pos: m1.pos, rot: m1.rot });
  t.run(10000, 100);
  t.packet([{ ref: M1, hide: false, pos: P1, rot: R1 }]);
  t.run(5000, 100);
  check('...once: one setPosition and one setAngle through sweeps and the same list again', t.calls(M1, 'setPosition').length === 1 && t.calls(M1, 'setAngle').length === 1, t.calls(M1));
  // Cell reload, moved
  t.unloadCell(M1); t.run(2000); t.loadCell(M1); t.run(3000);
  check('its cell loads again with the game keeping the move: nothing more called', t.calls(M1).length === 2 && near(m1.pos, P1), t.calls(M1));
  t.unloadCell(M1); t.run(2000); t.loadCell(M1, true);
  check('...back as the plugin has it: moved again as its 3D loads', near(m1.pos, P1) && near(m1.rot, R1) && t.calls(M1, 'setPosition').length === 2, { pos: m1.pos, calls: t.calls(M1) });
  t.run(3000);
  check('...once', t.calls(M1, 'setPosition').length === 2 && t.calls(M1, 'setAngle').length === 2, t.calls(M1));

  // A move for a reference with no 3D yet waits for it
  t = fresh(Service);
  const late = makeRef(M1, P0, R0, { loaded: false });
  t.packet([{ ref: M1, hide: false, pos: P1, rot: R1 }]);
  t.run(3000);
  check('a move waits while the reference has no 3D', t.calls(M1).length === 0 && near(late.pos, P0), t.calls(M1));
  late.loaded = true; t.loaded(M1);
  check('...and is done when its 3D loads', near(late.pos, P1) && near(late.rot, R1), { pos: late.pos, rot: late.rot });

  // Taken off the list: shown, put back, then forgotten
  t = fresh(Service);
  const hs = makeRef(S1, P0, R0), mv = makeRef(M1, P0, R0);
  t.packet([{ ref: S1, hide: true }, { ref: M1, hide: false, pos: P1, rot: R1 }]);
  t.run(3000);
  t.packet([]);
  t.run(1100, 100);
  check('off the list: the hidden static is shown again', hs.disabled === false && t.calls(S1, 'enable').length === 1, t.calls(S1));
  check('...and the moved one is back at its plugin place and angle', near(mv.pos, P0) && near(mv.rot, R0), { pos: mv.pos, rot: mv.rot });
  const n = t.W.calls.length;
  t.run(10000, 100);
  check('...then both are forgotten (no more calls)', t.W.calls.length === n, t.W.calls.slice(n));

  // Taken off the list while its cell is unloaded: put back when it loads
  t = fresh(Service);
  const away = makeRef(M1, P0, R0);
  t.packet([{ ref: M1, hide: false, pos: P1, rot: R1 }]);
  t.run(2000);
  t.unloadCell(M1);
  t.packet([]);
  t.run(5000);
  check('a move undone while the reference is unloaded: no error', t.W.errors.length === 0 && t.W.updateErrors.length === 0, [t.W.errors, t.W.updateErrors]);
  t.loadCell(M1);
  check('...put back at its plugin place when its cell loads again (the game had kept the move)', near(away.pos, P0) && near(away.rot, R0), { pos: away.pos, rot: away.rot });

  // Hidden and moved, then shown but kept moved
  t = fresh(Service);
  const hm = makeRef(M1, P0, R0);
  t.packet([{ ref: M1, hide: true, pos: P1, rot: R1 }]);
  t.run(2000);
  check('hidden and moved: disabled', hm.disabled === true, t.calls(M1));
  t.packet([{ ref: M1, hide: false, pos: P1, rot: R1 }]);
  t.run(2000);
  check('...shown again while the move stays: enabled once, at the new place', hm.disabled === false && t.calls(M1, 'enable').length === 1 && near(hm.pos, P1), { pos: hm.pos, calls: t.calls(M1) });

  // Never shows what it did not hide
  t = fresh(Service);
  const other = makeRef(C1, P0, R0, { disabled: true });
  t.packet([{ ref: C1, hide: false, pos: P1, rot: R1 }]);
  t.run(3000);
  t.packet([]);
  t.run(3000);
  check('a reference something else disabled is never enabled by the list (moved only, then off the list)', other.disabled === true && t.calls(C1, 'enable').length === 0, t.calls(C1));

  // Bad entries and packets
  t = fresh(Service);
  makeRef(S1, P0, R0);
  t.packet([{ ref: 0, hide: true }, { ref: 0xff001234, hide: true }, null, { ref: S1, hide: false, pos: [1, 'abc', 2] }, { ref: S1, hide: false, pos: [1, 2] }, { ref: 'x', hide: true }]);
  t.run(3000);
  check('bad entries (0, a 0xff id, null, a bad position, not a number) do nothing and throw nothing', t.W.calls.length === 0 && t.W.tickErrors.length === 0 && t.W.updateErrors.length === 0, [t.W.calls, t.W.tickErrors, t.W.updateErrors]);
  t.packet([{ ref: S1, hide: true }]);
  t.run(2000);
  t.raw('{not json'); t.raw(JSON.stringify({ customPacketType: 'worldEdits', edits: 'all' })); t.raw(JSON.stringify({ customPacketType: 'other', edits: [] }));
  t.run(3000);
  check('a malformed or foreign packet leaves the list as it was', W.refs.get(S1).disabled === true && t.calls(S1, 'enable').length === 0 && t.W.tickErrors.length === 0, t.calls(S1));

  // A long list is worked through 200 a second
  t = fresh(Service);
  const many = [];
  for (let i = 1; i <= 500; i++) { makeRef(0x00100000 + i, P0, R0); many.push({ ref: 0x00100000 + i, hide: true }); }
  t.packet(many);
  t.update(1000);
  const first = t.W.getFormEx;
  t.run(3000, 1000);
  check('500 edits: at most 200 looked up per sweep, all hidden within three sweeps', first <= 200 && [...W.refs.values()].every((r) => r.disabled), first);

  // A server-kept reference (a chair) moved and then undone while this client watches it. worldedit.js apply() calls
  // Papyrus SetPosition first, which reaches clients in view as an SpSnippet (PapyrusObjectReference::SetPosition), then
  // broadcasts the list. Another edit is on the list, so the sweep runs every second and the move lands between two sweeps.
  // sameTick: the snippet and the list arrive in the same network tick (sent back to back); otherwise the snippet's
  // update runs a frame before the list arrives. withOrig: the list carries the plugin pose (not sent by worldedit.js yet)
  const inView = (sameTick, withOrig) => {
    t = fresh(Service);
    makeRef(S1, P0, R0);
    const chair = makeRef(C1, P0, R0, { type: FT.Furniture });
    t.packet([{ ref: S1, hide: true }]);
    t.run(3500, 100);
    const moved = { ref: C1, hide: false, pos: P1, rot: R1 };
    if (withOrig) moved.orig = { pos: P0, rot: R0 };
    t.snippet(C1, 'setPosition', P1);
    if (!sameTick) t.update();
    t.packet([{ ref: S1, hide: true }, moved]);
    t.run(3000, 100);
    const movedOk = near(chair.pos, P1) && near(chair.rot, R1);
    t.snippet(C1, 'setPosition', P0);
    if (!sameTick) t.update();
    t.packet([{ ref: S1, hide: true }]);
    t.run(3000, 100);
    return { movedOk, back: near(chair.pos, P0) && near(chair.rot, R0), pos: chair.pos, rot: chair.rot };
  };
  const live = inView(true, false);
  check('a chair moved while in view is at its new place', live.movedOk, live);
  check('...and back at its plugin place and angle when the move is undone (snippet and list in one tick, the list as worldedit.js sends it)', live.back, live);
  const split = inView(false, true);
  check('...also when the snippet ran a frame before the list, once the list carries orig', split.movedOk && split.back, split);
  const splitLive = inView(false, false);
  console.log(`note snippet a frame before the list and no orig in the list: the undo leaves the watched chair at ${JSON.stringify(splitLive.pos)} angle ${JSON.stringify(splitLive.rot)} (plugin place ${JSON.stringify(P0)} angle ${JSON.stringify(R0)}); worldedit.js needs to send orig`);

  Date.now = realNow;
}

function runPick(Service) {
  // The GM at the origin facing north (+Y, heading 0); the select tool with nothing under the crosshair
  W = { ctx: 'update', refs: new Map(), vm: [], calls: [], natives: 0, getFormEx: 0, notes: [], errors: [] };
  const byType = new Map();
  const cell = { getNumRefs: (type) => (byType.get(type) || []).length, getNthRef: (i, type) => { const r = (byType.get(type) || [])[i]; return r ? r.api : null; } };
  const add = (id, type, x, y, o = {}) => { const r = makeRef(id, [x, y, 0], [0, 0, 0], Object.assign({ type }, o)); byType.set(type, (byType.get(type) || []).concat(r)); return r; };
  W.player = { getParentCell: () => cell, getPositionX: () => 0, getPositionY: () => 0, getPositionZ: () => 0, getAngleZ: () => 0 };
  const pick = (ghostId = 0) => { const self = Object.create(Service.prototype); self.ghostId = ghostId; const r = self.pluginRefAhead(); return r ? r.getFormID() : 0; };

  add(0x00000a01, FT.Static, 0, -500);                       // behind
  add(0x00000a02, FT.Static, 900, 300);                      // far off to the side
  add(0x00000a03, FT.Static, 0, 2000);                       // ahead, out of range
  check('nothing ahead within range: no pick', pick() === 0);
  add(0x00000a04, FT.Furniture, 40, 800);                    // ahead, nearly on the line
  add(0x00000a05, FT.Static, 0, 1200);                       // on the line, further
  check('the plugin object ahead nearest the line the GM faces is picked', pick() === 0x00000a04, pick().toString(16));
  add(0x00000a06, FT.Static, 0, 300, { disabled: true });    // hidden already
  add(0xff000a07, FT.Static, 0, 200);                        // made in this session
  add(0x00000a08, FT.Static, 0, 250, { loaded: false });     // no 3D
  check('a hidden one, a 0xff one and one with no 3D are passed over', pick() === 0x00000a04, pick().toString(16));
  check('the placement preview is passed over', pick(0x00000a04) === 0x00000a05, pick(0x00000a04).toString(16));
  add(0x00000a09, FT.Door, 0, 100);
  check('doors are not in the pick (the server refuses them anyway)', pick() === 0x00000a04, pick().toString(16));
}

main().catch((e) => { console.error(e); process.exit(1); });
