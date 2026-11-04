// Scripted test for MealService (mealService.ts; Nate 2026-09-27, bugfix 2026-11-04).
// A meal slows the owner by -50 SpeedMult and finishes on time; in combat or the world, an attack, a sprint or drawing
// a weapon ends it and sends mealCancel. While a blocking menu is open (InventoryMenu, FavoritesMenu, etc.), mouse clicks
// and weapon state changes from managing equipment must NOT cancel the meal or waste the food.
// Run from skymp5-client with:
//
//   node tests/meal-service-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP meal-service (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

const STUBS = {
  skyrimPlatform: `module.exports = {
    InputDeviceType: { Keyboard: 0, Mouse: 1, Gamepad: 2 },
  };`,
  clientListener: 'class ClientListener {} module.exports = { ClientListener };',
  customPacketUtil: `module.exports = {
    parseCustomPacket: (e) => (e && e.message ? JSON.parse(e.message.contentJsonDump) : null),
    sendCustomPacket: (c, pkt) => { globalThis.__mealState.sent.push(pkt); },
  };`,
  widgetMenuUtil: `module.exports = {
    isGameInputBlocked: () => !!globalThis.__mealState.inputBlocked,
  };`,
  logging: 'module.exports = { logTrace() {}, logError() {} };',
};
const STUB_OF = {
  skyrimPlatform: 'skyrimPlatform',
  './clientListener': 'clientListener',
  './customPacketUtil': 'customPacketUtil',
  './widgetMenuUtil': 'widgetMenuUtil',
  '../../logging': 'logging',
};

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-meal-service-'));
  try {
    const outSvc = path.join(tmp, 'mealService.js');
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../src/services/services/mealService.ts')],
      bundle: true, platform: 'node', format: 'cjs', outfile: outSvc, logLevel: 'error',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (STUB_OF[a.path] ? { path: STUB_OF[a.path], namespace: 'stub' } : undefined));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
      } }],
    });
    driven(require(outSvc));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exitCode = failures ? 1 : 0;
}

function driven({ MealService }) {
  let now = 1000000;
  Date.now = () => now;

  let playerSpeedMult = 100;
  let playerWeaponDrawn = false;
  let playerSprinting = false;

  const mockPlayer = {
    modActorValue: (av, delta) => { if (av === 'SpeedMult') playerSpeedMult += delta; },
    isWeaponDrawn: () => playerWeaponDrawn,
    isSprinting: () => playerSprinting,
  };

  const sp = {
    Game: { getPlayer: () => mockPlayer },
  };

  const listeners = { customPacketMessage: [], buttonEvent: [], update: [], onceUpdate: [] };
  const controller = {
    emitter: {
      on: (event, fn) => { if (listeners[event]) listeners[event].push(fn); },
    },
    on: (event, fn) => { if (listeners[event]) listeners[event].push(fn); },
    once: (event, fn) => { if (event === 'update') listeners.onceUpdate.push(fn); },
  };

  const state = { sent: [], inputBlocked: false };
  globalThis.__mealState = state;

  new MealService(sp, controller);

  const firePacket = (pkt) => {
    const msg = { message: { contentJsonDump: JSON.stringify(pkt) } };
    for (const fn of listeners.customPacketMessage) fn(msg);
  };
  const fireButton = (btn) => {
    for (const fn of listeners.buttonEvent) fn(btn);
  };
  const stepUpdate = () => {
    const once = listeners.onceUpdate.slice();
    listeners.onceUpdate.length = 0;
    for (const fn of once) fn();
    for (const fn of listeners.update) fn();
  };

  const reset = () => {
    state.sent.length = 0;
    state.inputBlocked = false;
    playerSpeedMult = 100;
    playerWeaponDrawn = false;
    playerSprinting = false;
  };

  // 1. Starting a meal
  reset();
  firePacket({ customPacketType: 'dboMeal', state: 'start', seconds: 5.5 });
  stepUpdate();
  check('meal starts, speed is halved (-50)', playerSpeedMult === 50, playerSpeedMult);
  check('no cancel packet sent on start', state.sent.length === 0, state.sent);

  // 2. Menu open: clicks in inventory do not cancel meal
  state.inputBlocked = true;
  fireButton({ isDown: true, device: 1, userEventName: 'Right Attack/Block' });
  check('inventory click does not cancel meal', state.sent.length === 0, state.sent);
  fireButton({ isDown: true, device: 0, userEventName: 'Left Attack/Block' });
  check('keyboard attack key while menu open does not cancel meal', state.sent.length === 0, state.sent);

  // 3. Menu open: equipping weapon in inventory does not cancel meal
  playerWeaponDrawn = true;
  stepUpdate();
  check('weapon drawn in menu does not cancel meal', state.sent.length === 0, state.sent);

  // 4. Closing menu keeps the meal active
  state.inputBlocked = false;
  stepUpdate();
  check('closing menu with weapon already drawn does not cancel meal', state.sent.length === 0, state.sent);

  // 5. Finishing the meal restores speed
  now += 9000; // 5.5s + 3s grace
  stepUpdate();
  check('finishing meal restores speed (+50 -> 100)', playerSpeedMult === 100, playerSpeedMult);

  // 6. Gameplay cancellation: attack outside menu cancels meal
  reset();
  now += 1000;
  firePacket({ customPacketType: 'dboMeal', state: 'start', seconds: 5.5 });
  stepUpdate();
  check('new meal started at speed 50', playerSpeedMult === 50, playerSpeedMult);
  state.inputBlocked = false;
  fireButton({ isDown: true, device: 1, userEventName: 'Right Attack/Block' });
  check('attack outside menu cancels meal', state.sent.some((p) => p.customPacketType === 'dbo' && p.event === 'mealCancel' && p.args[0] === 'attack'), state.sent);
  check('cancelling meal restores speed', playerSpeedMult === 100, playerSpeedMult);

  // 7. Gameplay cancellation: drawing weapon outside menu cancels meal
  reset();
  now += 1000;
  firePacket({ customPacketType: 'dboMeal', state: 'start', seconds: 5.5 });
  stepUpdate();
  playerWeaponDrawn = true;
  stepUpdate();
  check('drawing weapon outside menu cancels meal', state.sent.some((p) => p.customPacketType === 'dbo' && p.event === 'mealCancel' && p.args[0] === 'weapon'), state.sent);
  check('weapon cancel restores speed', playerSpeedMult === 100, playerSpeedMult);

  // 8. Gameplay cancellation: sprinting outside menu cancels meal
  reset();
  now += 1000;
  firePacket({ customPacketType: 'dboMeal', state: 'start', seconds: 5.5 });
  stepUpdate();
  playerSprinting = true;
  stepUpdate();
  check('sprinting outside menu cancels meal', state.sent.some((p) => p.customPacketType === 'dbo' && p.event === 'mealCancel' && p.args[0] === 'sprint'), state.sent);
  check('sprint cancel restores speed', playerSpeedMult === 100, playerSpeedMult);
}

main();
