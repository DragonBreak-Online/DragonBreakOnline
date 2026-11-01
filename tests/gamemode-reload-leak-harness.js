// Scripted test for the gamemode hot-reload fixes (31 Oct, _work\gemini-1031\NOTE.md):
// 1. Named one-shot reload timers (once('seedTreasuries'), once('starterKitReload'), once('updatesVersionLog'))
//    replace their pending timeout on reload instead of pinning every generation's ~30 MB closure during rapid reloads.
// 2. tickSummary includes process.memoryUsage() (rss and heapUsed/heapTotal in MB) so V8 heap vs native RSS is visible
//    every minute in skymp-server.log.
// 3. mp.onEatItem and mp.onUpdateAppearanceAttempt store their pre-gamemode hook with typeof === 'undefined' (matching
//    every other hook in gamemode.js), and downed.js tags its eat wrapper with .__dbo = true, so a reload when no base
//    eat hook was installed before Reload 1 does not capture Reload 1's downed.js wrapper as __dboPrevEat and run
//    the Draught of Revival handler twice on Reload 2+.
//
// Run from server\ with:
//   node tests/gamemode-reload-leak-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const gmSrc = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const downedSrc = fs.readFileSync(path.resolve(__dirname, '..', 'downed.js'), 'utf8');
const updatesSrc = fs.readFileSync(path.resolve(__dirname, '..', 'updates.js'), 'utf8');

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

// --- 1. once() replaces pending one-shot startup timers on reload, and tickSummary logs rss + heap ------------
{
  const a = gmSrc.indexOf('// ---- timers: named, timed, replaced by name on every reload');
  const b = gmSrc.indexOf('// ---- debounced saves:', a);
  check('timer + tickSummary slice found in gamemode.js', a >= 0 && b > a);

  const slice = gmSrc.slice(a, b);
  delete globalThis.__dboTimers;
  delete globalThis.__dboLoopDelay;
  delete globalThis.__dboGcStats;

  const logged = [];
  const fn = new Function('cfg', 'log', 'display', 'onlineActors', 'require', 'performance', 'process', 'globalThis',
    `${slice}\nreturn { TIMERS, stopTimer, once: typeof once === 'function' ? once : null, every };`);
  const env1 = fn({}, (...x) => logged.push(x.join(' ')), (x) => `P${x}`, () => [1, 2], require, performance, process, globalThis);

  check('once() helper is defined in the timer block', typeof env1.once === 'function');

  let runs = 0;
  if (env1.once) env1.once('seedTreasuries', 5000, () => { runs++; });
  const firstTimeout = env1.TIMERS.get('seedTreasuries') && env1.TIMERS.get('seedTreasuries').start;
  check('once() registers the pending timeout in TIMERS', !!firstTimeout);

  // Simulate a hot reload 100 ms later: re-running the block and calling once('seedTreasuries') replaces the first timeout
  const env2 = fn({}, (...x) => logged.push(x.join(' ')), (x) => `P${x}`, () => [1, 2, 3], require, performance, process, globalThis);
  if (env2.once) env2.once('seedTreasuries', 5000, () => { runs += 10; });
  const secondTimeout = env2.TIMERS.get('seedTreasuries') && env2.TIMERS.get('seedTreasuries').start;
  check('reloading replaces the pending once() timeout in TIMERS', !!secondTimeout && secondTimeout !== firstTimeout);
  check('the previous reload timeout was cleared (destroyed)', !!firstTimeout && firstTimeout._destroyed === true);
  env2.stopTimer('seedTreasuries');
  check('stopTimer clears the once() entry', !env2.TIMERS.has('seedTreasuries') && runs === 0);

  // Verify gamemode.js and updates.js route their startup timeouts through once()
  check('gamemode.js routes seedTreasuries through once()', gmSrc.includes("once('seedTreasuries', 3000, seedTreasuries)"));
  check('gamemode.js routes starterKitReload through once()', gmSrc.includes("once('starterKitReload', 1000,"));
  check('gamemode.js passes once to updates.js', /require\(UPDATES_JS\)\(\{[^}]*\bonce\b/.test(gmSrc));
  check('updates.js routes updatesVersionLog through once()', updatesSrc.includes("once('updatesVersionLog', 5000,"));

  // Verify tickSummary emits mem rss and heap
  const tickEntry = env2.TIMERS.get('tickSummary');
  check('tickSummary is registered in TIMERS', !!tickEntry);
  // Stop the real timers created during the test
  env1.stopTimer('tickSummary');
  env2.stopTimer('tickSummary');

  // Run tickSummary body directly by capturing it via every()
  let summaryFn = null;
  const captureLines = [];
  const everyStub = (name, ms, cb) => { if (name === 'tickSummary') summaryFn = cb; };
  new Function('cfg', 'log', 'display', 'onlineActors', 'every', 'tickStats', 'require', 'performance', 'process', 'globalThis',
    slice.slice(slice.indexOf('// Event loop delay')))(
    {}, (...x) => captureLines.push(x.join(' ')), (x) => `P${x}`, () => [1, 2], everyStub, new Map(), require, performance, process, globalThis);
  check('captured tickSummary callback', typeof summaryFn === 'function');
  if (summaryFn) summaryFn();
  const line = captureLines[0] || '';
  check('tickSummary includes mem rss and heap MB', /mem rss \d+MB heap \d+\/\d+MB/.test(line), line);
}

// --- 2. mp.onEatItem + downed.js across hot reloads when mp.onEatItem starts unset ---------------------------
{
  const eatA = gmSrc.indexOf("// Chain onto the server's eat event");
  const eatB = gmSrc.indexOf('// ---- /status:', eatA);
  check('eatHook slice found in gamemode.js', eatA >= 0 && eatB > eatA);
  const eatSlice = gmSrc.slice(eatA, eatB);

  const downedMod = require(path.resolve(__dirname, '..', 'downed.js'));
  delete globalThis.__dboPrevEat;
  delete globalThis.__dboDownedState;

  const POTION_ID = 0x4812ae16;
  let reviveCount = 0;
  let onEatCount = 0;
  const mp = {
    getIdFromDesc: (d) => (String(d).toLowerCase() === '12ae16:dragonbreak online edits.esp' ? POTION_ID : 0x100),
    getDescFromId: () => '12ae16:DragonBreak Online Edits.esp',
    lookupEspmRecordById: () => ({ record: { type: 'ALCH', fields: [] } }),
    get: (id, prop) => {
      if (prop === 'worldOrCellDesc') return '3c:Skyrim.esm';
      if (prop === 'pos') return [0, 0, 0];
      if (prop === 'angle') return [0, 0, 0];
      if (prop === 'isDead') return false;
      if (prop === 'inventory') return { entries: [{ baseId: POTION_ID, count: 1 }] };
      if (prop === 'percentages') return { health: 1, magicka: 1, stamina: 1 };
      return null;
    },
    set: (id, prop, val) => {
      if (prop === 'inventory') reviveCount++;
    },
  };

  const runReload = () => {
    new Function('mp', 'onEat', 'log', 'globalThis', eatSlice)(
      mp, () => { onEatCount++; }, () => {}, globalThis);
    downedMod({
      mp,
      log: () => {},
      personal: () => {},
      sendPacket: () => {},
      audit: () => {},
      who: (x) => `P${x}`,
      display: (x) => `P${x}`,
      profileOf: (x) => x,
      nameOf: (x) => `P${x}`,
      onlineActors: () => [1],
      every: () => {},
      registerChatCommand: () => {},
      cfg: {},
      openWidget: () => {},
      closeWidget: () => {},
      onUi: () => {},
      redress: () => {},
    });
  };

  // Reload 1 (when mp.onEatItem was initially undefined)
  runReload();
  check('after Reload 1, __dboPrevEat is null (not undefined)', globalThis.__dboPrevEat === null);
  check('downed.js eat wrapper is tagged .__dbo === true', mp.onEatItem && mp.onEatItem.__dbo === true);

  // Reload 2 & Reload 3
  runReload();
  runReload();
  check('after Reload 3, __dboPrevEat is still null (did not capture Reload 1 wrapper)', globalThis.__dboPrevEat === null);

  reviveCount = 0;
  onEatCount = 0;
  mp.onEatItem(1, POTION_ID);
  check('eating the Draught after 3 reloads runs downed.js handler once (not 3x)', reviveCount === 1 && onEatCount === 1, { reviveCount, onEatCount });

  // Also check appearanceHook guard in gamemode.js
  check('appearanceHook uses typeof __dboAppearanceHookPrev === undefined',
    gmSrc.includes("if (typeof globalThis.__dboAppearanceHookPrev === 'undefined')"));
}

if (failures) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nall gamemode-reload-leak-harness checks passed');
