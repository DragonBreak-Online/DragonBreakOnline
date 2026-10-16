// A plugin reference the server disabled must stay disabled on every client that streams it in (remoteServer.ts
// onCreateActorMessage, the skipFormViewCreation branch). The server sends props.isDisabled (CreateActorMessage.h, upstream
// #2264); 0.3.101 read props.disabled, so the reference was enabled again on arrival. Bundles the real remoteServer.ts and
// view/modelApplyUtils.ts, every other import stubbed, against a fake game whose latent natives (enable, disable) take
// effect only when the Papyrus VM runs them after the update, as Skyrim Platform dispatches them (CallNative.cpp, VmCall::Run).
// Run from skymp5-client:
//
//   node tests/plugin-ref-disabled-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP plugin-ref-disabled (no esbuild)'); process.exit(0); }
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
// Anything: callable, constructible, every property itself, never a thenable
globalThis.__pdisU = (() => {
  const f = function () {};
  const U = new Proxy(f, { get: (t, k) => (k === 'then' || typeof k === 'symbol' ? undefined : k === 'prototype' ? t.prototype : U), apply: () => U, construct: () => U });
  return U;
})();
const KEEP = ['/view/modelApplyUtils'];
const stubs = { name: 'stubs', setup(b) {
  b.onResolve({ filter: /.*/ }, (a) => {
    if (a.kind === 'entry-point' || KEEP.some((k) => a.path.endsWith(k))) return undefined;
    return { path: `${a.path}|${a.importer}`, namespace: 'stub' };
  });
  b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => {
    const [spec, importer] = a.path.split('|');
    const names = new Set(importsOf(importer, spec));
    const S = `(globalThis.__pdisStubs[${JSON.stringify(spec)}] || {})`;
    if (spec === 'skyrimPlatform') Object.keys(globalThis.__pdisStubs.skyrimPlatform).forEach((n) => names.add(n));
    const lines = [...names].filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && n !== 'default')
      .map((n) => `export const ${n} = Object.prototype.hasOwnProperty.call(${S}, ${JSON.stringify(n)}) ? ${S}[${JSON.stringify(n)}] : globalThis.__pdisU;`);
    return { contents: `${lines.join('\n')}\nexport default globalThis.__pdisU;\n`, loader: 'js' };
  });
} };

// Skyrim Platform's FormType values (index.d.ts)
const FT = { Activator: 24, Container: 28, Door: 29, Ingredient: 30, Light: 31, Misc: 32, Static: 34, MovableStatic: 36, Tree: 38, Flora: 39, Furniture: 40, Weapon: 41 };
const W = globalThis.__pdisW = { forms: new Map(), onces: [], vm: [] };
globalThis.__pdisStubs = {
  skyrimPlatform: {
    FormType: FT,
    Game: { getFormEx: (id) => W.forms.get(id >>> 0) || null, getForm: () => null, getPlayer: () => null, findRandomActor: () => null },
    ObjectReference: { from: (f) => f || null },
    Actor: { from: () => null },
    Utility: { wait: () => Promise.resolve() },
    once: (ev, fn) => { if (ev === 'update') W.onces.push(fn); },
    on: () => ({}),
    storage: {},
  },
};

// A plugin reference; enable and disable are latent: called now, done when the VM runs them
const makeRef = (id, type, disabled) => {
  const r = { id, type, disabled, harvested: false, calls: [] };
  const latent = (name, fx) => () => { r.calls.push(name); return new Promise((res) => W.vm.push(() => { fx(); res(); })); };
  r.api = {
    getFormID: () => id, isDisabled: () => r.disabled, isHarvested: () => r.harvested,
    getBaseObject: () => ({ getType: () => type, getFormID: () => 0x10000 + type, getName: () => 'thing' }),
    enable: latent('enable', () => { r.disabled = false; }),
    disable: latent('disable', () => { r.disabled = true; }),
    delete: latent('delete', () => {}),
    setHarvested: (v) => { r.calls.push('setHarvested'); r.harvested = v; },
    setOpen: () => {}, getOpenState: () => 0, activate: () => true, setDisplayName: () => {}, playAnimation: () => true,
    getPositionX: () => 0, getPositionY: () => 0, getPositionZ: () => 0,
  };
  W.forms.set(id, r.api);
  return r;
};

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-jake-plugin-ref-disabled-'));
  const out = path.join(tmp, 'remoteServer.js');
  try {
    await esbuild.build({ entryPoints: [path.resolve(__dirname, '../src/services/services/remoteServer.ts')], bundle: true, platform: 'node',
      format: 'cjs', outfile: out, logLevel: 'error', plugins: [stubs] });
    await run(require(out));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
}

async function run({ RemoteServer }) {
  const proto = RemoteServer.prototype;
  const self = Object.create(proto);
  // A frame: the update callbacks, then the VM runs what they dispatched, then the promise callbacks
  const update = async () => {
    for (const f of W.onces.splice(0)) f();
    for (const fx of W.vm.splice(0)) fx();
    await new Promise((res) => setImmediate(res));
  };
  const frames = async (n = 4) => { for (let i = 0; i < n; i++) await update(); };
  const stream = async (ref, baseRecordType, props) => {
    ref.calls.length = 0;
    proto.onCreateActorMessage.call(self, { message: { idx: 7, refrId: ref.id, baseId: 0x10000 + ref.type, baseRecordType, isMe: false, transform: { pos: [0, 0, 0], rot: [0, 0, 0], worldOrCell: 0x3c }, props } });
    await frames();
  };

  check('a plugin activator streams through the skipFormViewCreation branch; a door does not', !!proto.skipFormViewCreation({ refrId: 0x0001a2b3, baseRecordType: 'ACTI' })
    && !proto.skipFormViewCreation({ refrId: 0x0001a2b4, baseRecordType: 'DOOR' }));

  // The server writes the flag as isDisabled (and leaves it out when false)
  const hdr = path.resolve(__dirname, '../../skymp5-server/cpp/messages/CreateActorMessage.h');
  if (fs.existsSync(hdr)) check('the server serializes the flag as "isDisabled"', /\.Serialize\("isDisabled", isDisabled\)/.test(fs.readFileSync(hdr, 'utf8')));
  else console.log('note the server header is not in this tree; CreateActorMessage.h serializes "isDisabled" since upstream #2264');

  // 1. Late stream: the server disabled it (a hidden world edit, a one-way ruin trigger), this game has it as the plugin does
  const trig = makeRef(0x0001a2b3, FT.Activator, false);
  await stream(trig, 'ACTI', { isDisabled: true });
  check('a reference the server disabled is disabled when it streams in (props.isDisabled)', trig.disabled === true, trig.calls);

  // 2. Streamed in again in the same session (the cell was left and entered again): this game still has it disabled
  await stream(trig, 'ACTI', { isDisabled: true });
  check('...and stays disabled when it streams in again while this game already has it disabled', trig.disabled === true, trig.calls);
  check('...with no enable on the way (no flash of the hidden object)', !trig.calls.includes('enable'), trig.calls);

  // 3. The same for furniture and containers the GM hid
  const chair = makeRef(0x0002c3d4, FT.Furniture, true);
  await stream(chair, 'FURN', { isDisabled: true });
  check('a hidden chair this game already has disabled stays disabled', chair.disabled === true && !chair.calls.includes('enable'), chair.calls);
  const chest = makeRef(0x0003e5f6, FT.Container, false);
  await stream(chest, 'CONT', { isDisabled: true, isOpen: false });
  check('a hidden chest streamed in for the first time is disabled', chest.disabled === true, chest.calls);

  // 4. The server enabled it again while this game had it disabled: shown again
  const shown = makeRef(0x0004a1b2, FT.Activator, true);
  await stream(shown, 'ACTI', {});
  check('a reference the server enabled again is enabled when it streams in', shown.disabled === false, shown.calls);

  // 5. Nothing disabled anywhere: nothing called
  const plain = makeRef(0x0005c3d4, FT.Furniture, false);
  await stream(plain, 'FURN', {});
  check('a reference nobody disabled is left alone (no enable, no disable)', plain.disabled === false && !plain.calls.includes('enable') && !plain.calls.includes('disable'), plain.calls);

  // 6. The name before the refactor still counts
  const old = makeRef(0x0006e5f6, FT.Activator, false);
  await stream(old, 'ACTI', { disabled: true });
  check('props.disabled (the name before #2264) still disables', old.disabled === true, old.calls);

  // 7. Harvest is unchanged for what the server did not disable
  const item = makeRef(0x0007a1b2, FT.Misc, false);
  await stream(item, 'MISC', { isHarvested: true });
  check('an item picked up (isHarvested, not disabled) is still taken away as before', item.disabled === true && item.calls.includes('disable'), item.calls);
  const back = makeRef(0x0008c3d4, FT.Misc, true);
  await stream(back, 'MISC', {});
  check('an item that came back (not harvested, not disabled) shows again', back.disabled === false, back.calls);
}

main().catch((e) => { console.error(e); process.exit(1); });
