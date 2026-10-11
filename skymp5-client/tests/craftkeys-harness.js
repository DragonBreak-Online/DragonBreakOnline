// Scripted test for craftService.ts: a property key leaving and coming back while the player sits on furniture is not a
// craft. The 5 s inventory apply rebuilds every property key at once (inventory.ts withKeysRebuilt), and a seated player
// then sent a CraftItem every 5 s with three keys in and a key out: 10,500 "Recipe not found" lines on the server from
// 8 to 11 Oct, each one a scan of every recipe. No recipe takes or makes a property key (keys are cut by the housing
// system). Run from skymp5-client:
//
//   node tests/craftkeys-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP craftkeys (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

const KEY = 0x000db0e2;
const STUBS = {
  skyrimPlatform: 'module.exports = {};',
  clientListener: 'class ClientListener {} module.exports = { ClientListener };',
  worldViewMisc: 'module.exports = { localIdToRemoteId: (id) => (id | 0xff000000) >>> 0 };',
  logging: 'module.exports = { logTrace() {}, logError() {} };',
  messages: 'module.exports = { MsgType: { CraftItem: "CraftItem" } };',
};
const STUB_OF = { skyrimPlatform: 'skyrimPlatform', './clientListener': 'clientListener', '../../view/worldViewMisc': 'worldViewMisc',
  '../../logging': 'logging', '../../messages': 'messages' };

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-craftkeys-'));
  const out = path.join(tmp, 'craftService.js');
  try {
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../src/services/services/craftService.ts')], bundle: true, platform: 'node', format: 'cjs',
      outfile: out, logLevel: 'error',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (STUB_OF[a.path] ? { path: STUB_OF[a.path], namespace: 'stub' } : undefined));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
      } }],
    });
    run(require(out));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function run({ CraftService }) {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const make = () => {
      const handlers = {};
      const sent = [];
      const world = { seat: 0 };
      const player = { getFurnitureReference: () => (world.seat ? { getFormID: () => world.seat } : null) };
      const sp = { Game: { getPlayer: () => player } };
      const controller = { on: (name, fn) => { handlers[name] = fn; }, emitter: { emit: (name, m) => { if (name === 'sendMessage') sent.push(m.message); } } };
      new CraftService(sp, controller);
      const form = (id) => (id ? { getFormID: () => id } : undefined);
      const leave = (baseId, n = 1) => handlers.containerChanged({ oldContainer: form(0x14), newContainer: undefined, baseObj: form(baseId), numItems: n });
      const arrive = (baseId, n = 1) => handlers.containerChanged({ oldContainer: undefined, newContainer: form(0x14), baseObj: form(baseId), numItems: n });
      const tick = (ms) => { now += ms; handlers.update(); };
      const close = (name = 'Crafting Menu') => handlers.menuClose({ name });
      return { sent, world, leave, arrive, tick, close };
    };

    // ---- the live case: seated on a chair, the apply takes three keys off and adds them back ----------------------
    {
      const t = make(); t.world.seat = 0x65311;
      t.leave(KEY, 3); t.arrive(KEY); t.arrive(KEY); t.arrive(KEY);
      check('a key rebuild while seated sends no craft', t.sent.length === 0, t.sent);
      t.tick(1000); t.world.seat = 0; t.tick(300);
      check('...nor a leftover report when the player stands up', t.sent.length === 0, t.sent);
    }
    // ---- every 5 s for a minute ----------------------------------------------------------------------------------
    {
      const t = make(); t.world.seat = 0x75821;
      for (let i = 0; i < 12; i++) { t.leave(KEY, 2); t.arrive(KEY); t.arrive(KEY); t.tick(5000); }
      check('twelve key rebuilds in a minute send nothing', t.sent.length === 0, t.sent.length);
    }
    // ---- a key leaving in the middle of a real craft is not counted as an input -----------------------------------
    {
      const t = make(); t.world.seat = 0x10a01;
      t.leave(0x5ace4, 2); t.leave(KEY, 1); t.arrive(0x1397e);
      check('a real craft is still sent when its result arrives', t.sent.length === 1 && t.sent[0].data.resultObjectId === 0x1397e, t.sent);
      const inputs = t.sent[0] ? t.sent[0].data.craftInputObjects.entries : [];
      check('...with its ingredient', inputs.some((e) => e.baseId === 0x5ace4 && e.count === 2), inputs);
      check('...and without the key', !inputs.some((e) => e.baseId === KEY), inputs);
    }
    // ---- a key arriving does not close a real craft as if it were the result -------------------------------------
    {
      const t = make(); t.world.seat = 0x10a02;
      t.leave(0x5ace4, 2); t.arrive(KEY);
      check('a key arriving mid-craft is not taken as the result', t.sent.length === 0, t.sent);
      t.arrive(0x1397e);
      check('...the real result still closes the report', t.sent.length === 1 && t.sent[0].data.resultObjectId === 0x1397e, t.sent);
    }
    // ---- nothing else changed: a disenchant still flushes on the menu close ---------------------------------------
    {
      const t = make(); t.world.seat = 0x10b02;
      t.leave(0x13989); t.close(); t.tick(300); t.tick(300);
      check('a disenchant is still sent once the menu has closed', t.sent.length === 1 && t.sent[0].data.resultObjectId === 0, t.sent);
    }
  } finally {
    Date.now = realNow;
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
