// Scripted test for the frame-time part of the npcDrift heartbeat (services/services/hostedDriftService.ts, d596c3bc in
// client 0.3.91): every 30 s heartbeat carries fr {n frames, ms mean frame, max, s50/s100 frames of 50/100 ms or more,
// stalls of 2 s or more left out of the mean, at w<worldspace>/c<cell>, forms = server forms the client updates}; the
// counters start again after each heartbeat; the report stays within what gamemode.js logs (900 chars). Run from
// skymp5-client:
//
//   node tests/frame-heartbeat-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP frame-heartbeat (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);
const SRC = path.resolve(__dirname, '../src');

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`);
  if (!ok) failures++;
};

const F = { packets: [], world: 0x3c, cell: 0x1a27f, forms: [{}, null, {}, {}] };
globalThis.__fhF = F;
const STUBS = {
  skyrimPlatform: `const F = globalThis.__fhF;
    export const Game = { getPlayer: () => ({ getPositionX: () => 0, getPositionY: () => 0, getPositionZ: () => 0,
      getWorldSpace: () => (F.world ? { getFormID: () => F.world } : null), getParentCell: () => ({ getFormID: () => F.cell }) }), getFormEx: () => null };
    export const Actor = { from: () => null }; export const Keyword = {}; export const NetImmerse = {}; export const storage = { hosted: [] };`,
  clientListener: 'export class ClientListener {}',
  customPacketUtil: `export const sendCustomPacket = (_c, p) => globalThis.__fhF.packets.push(p);
    export const parseCustomPacket = () => null;`,
  remoteServer: 'export class RemoteServer {}',
  worldViewMisc: 'export const remoteIdToLocalId = () => 0;',
  animation: 'export const setRefrCollision = () => {};',
  driftConfig: 'export const driftConfig = { remote: false, remoteMax: 0, sinkReport: 64 }; export const applyDriftConfig = () => {}; export const driftConfigEcho = () => ({});',
  movementApply: 'export const getApplyState = () => null;',
  movementGet: 'export const getMovement = () => null;',
  spawnProcess: 'export class SpawnProcess { static placeMode = "moveTo"; }',
  locomotionDiag: 'export const locomotionSource = () => null; export const readGraph = () => ({});',
};
const stubPlugin = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /^(skyrimPlatform|\.\/clientListener|\.\/customPacketUtil|\.\/remoteServer|\.\.\/\.\.\/view\/worldViewMisc|\.\.\/\.\.\/sync\/animation|\.\.\/\.\.\/sync\/driftConfig|\.\.\/\.\.\/sync\/movementApply|\.\.\/\.\.\/sync\/movementGet|\.\.\/\.\.\/view\/spawnProcess|\.\/locomotionDiag)$/ },
      (a) => ({ path: a.path.replace(/.*\//, ''), namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
  },
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-frames-'));
  let M;
  try {
    const out = path.join(dir, 'drift.js');
    await esbuild.build({ entryPoints: [path.join(SRC, 'services/services/hostedDriftService.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, plugins: [stubPlugin], logLevel: 'error' });
    M = require(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  let NOW = 5000000;
  Date.now = () => NOW;
  const ons = [];
  const controller = { on: (ev, fn) => { if (ev === 'update') ons.push(fn); }, emitter: { on() {} },
    lookupListener: () => ({ getWorldModel: () => ({ forms: F.forms }) }) };
  const sp = { hooks: { sendAnimationEvent: { add() {} } } };
  new M.HostedDriftService(sp, controller);
  const frame = (ms) => { NOW += ms; ons.forEach((f) => f()); };
  const beats = () => F.packets.filter((p) => p.customPacketType === 'dbo' && p.event === 'npcDrift' && p.args[0].kind === 'heartbeat').map((p) => p.args[0]);

  frame(16);
  const first = beats();
  check('the first update sends a heartbeat (as before) with fr', first.length === 1 && first[0].fr && typeof first[0].fr === 'object', first);
  F.packets = [];
  // 30 s of play: 16 ms frames, five 60 ms frames, two 120 ms frames, one 3 s stall (a loading screen)
  let spent = 0, plan = [];
  for (let i = 0; i < 5; i++) plan.push(60);
  for (let i = 0; i < 2; i++) plan.push(120);
  plan.push(3000);
  const extra = plan.reduce((a, b) => a + b, 0);
  const n16 = Math.floor((30000 - extra) / 16);
  for (let i = 0; i < n16; i++) { frame(16); spent += 16; if (i === 100) plan.forEach((ms) => { frame(ms); spent += ms; }); }
  while (!beats().length) { frame(16); spent += 16; }
  const fr = beats()[0].fr;
  const frames = n16 + 7 + (spent - n16 * 16 - extra) / 16;
  check('n counts every frame but the stall (n/30 is the FPS)', fr.n === frames, [fr.n, frames]);
  const mean = Math.round(((frames - 7) * 16 + 5 * 60 + 2 * 120) / frames * 10) / 10;
  check('ms is the mean frame time without the stall', fr.ms === mean, [fr.ms, mean]);
  check('max is the longest frame that was not a stall', fr.max === 120, fr.max);
  check('s50 counts frames of 50 ms or more, s100 of 100 ms or more', fr.s50 === 7 && fr.s100 === 2, [fr.s50, fr.s100]);
  check('the 3 s loading screen is one stall', fr.stalls === 1, fr.stalls);
  check('at is the worldspace (w + hex) when there is one', fr.at === 'w3c', fr.at);
  check('forms counts the server forms the client holds', fr.forms === 3, fr.forms);
  check('the whole report stays within what gamemode.js logs', JSON.stringify(beats()[0]).length <= 900, JSON.stringify(beats()[0]).length);
  F.packets = [];
  F.world = 0;
  for (let i = 0; i < 1875; i++) frame(16);
  while (!beats().length) frame(16);
  const fr2 = beats()[0].fr;
  check('the next heartbeat starts from zero: no stall, max 16', fr2.stalls === 0 && fr2.max === 16 && fr2.s50 === 0, fr2);
  check('an interior is named by its cell (c + hex)', fr2.at === 'c1a27f', fr2.at);
  F.packets = [];
  controller.lookupListener = () => { throw new Error('not up yet'); };
  for (let i = 0; i < 1900; i++) frame(16);
  check('an unreadable world model reads forms -1 and the heartbeat still goes', beats().length === 1 && beats()[0].fr.forms === -1, beats());

  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL harness threw', e && e.stack); process.exit(1); });
