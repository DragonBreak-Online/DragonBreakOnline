// Scripted test for workbenchDiag.ts and its wiring in craftService.ts: one "wb seat" trace line per sit at a crafting station
// that sent no craft (did the Crafting Menu open, items out and in), none for a chair without the menu. Run from skymp5-client:
//
//   node tests/workbenchdiag-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP workbenchdiag (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

const STUBS = {
  skyrimPlatform: 'module.exports = {};',
  clientListener: 'class ClientListener {} module.exports = { ClientListener };',
  worldViewMisc: 'module.exports = { localIdToRemoteId: (id) => (id === 0xbad ? 0 : id >>> 0) };',
  logging: 'module.exports = { logTrace() {}, logError() {} };',
  messages: 'module.exports = { MsgType: { CraftItem: "CraftItem" } };',
};
const STUB_OF = { skyrimPlatform: 'skyrimPlatform', './clientListener': 'clientListener', '../../view/worldViewMisc': 'worldViewMisc',
  '../../logging': 'logging', '../../messages': 'messages' };

const build = async (entry, out) => esbuild.build({
  entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => (STUB_OF[a.path] ? { path: STUB_OF[a.path], namespace: 'stub' } : undefined));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
  } }],
});

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-jake-workbenchdiag-'));
  const src = path.resolve(__dirname, '../src');
  try {
    await build(path.join(src, 'services/services/craftService.ts'), path.join(tmp, 'craftService.js'));
    await build(path.join(src, 'services/services/workbenchDiag.ts'), path.join(tmp, 'workbenchDiag.js'));
    await build(path.join(src, 'lib/clientDiag.ts'), path.join(tmp, 'clientDiag.js'));
    run(require(path.join(tmp, 'craftService.js')), require(path.join(tmp, 'workbenchDiag.js')), require(path.join(tmp, 'clientDiag.js')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const GRAIN_MILL = { ref: 0x5cabc, base: 0x9c6df, keywords: ['isGrainMill', 'FurnitureForce3rdPerson', 'FurnitureSpecial', 'RaceToScale'] };
const OVEN = { ref: 0x4812ae06, base: 0x300283f, keywords: ['FurnitureForce3rdPerson', 'FurnitureSpecial', 'RaceToScale', 'isCraftingOven', 'BYOHCraftingOven'] };
const COOKPOT = { ref: 0x80717dd, base: 0x1010b3, keywords: ['FurnitureForce3rdPerson', 'FurnitureSpecial', 'isSmallCookingPot', 'CraftingCookpot', 'RaceToScale'] };
const CHAIR = { ref: 0x80b5d59, base: 0x1379e, keywords: ['FurnitureForce3rdPerson'] };
const ENCHANTER = { ref: 0xbad0d, base: 0xbad0c, keywords: ['FurnitureForce3rdPerson', 'FurnitureSpecial', 'isEnchanting', 'CraftingEnchanting'] };

function run({ CraftService }, { WorkbenchDiag }, { TraceGate }) {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const make = () => {
      const handlers = {};
      const sent = [];
      const lines = [];
      globalThis.__dboTrace = (t) => lines.push(String(t));
      const world = { seat: null, noBase: false };
      const keyword = (s) => ({ getString: () => s });
      const furniture = (f) => ({
        getFormID: () => f.ref,
        getBaseObject: () => (world.noBase ? undefined.x : { getFormID: () => f.base, getNumKeywords: () => f.keywords.length, getNthKeyword: (i) => keyword(f.keywords[i]) }),
      });
      const player = { getFurnitureReference: () => (world.seat ? furniture(world.seat) : null) };
      const sp = { Game: { getPlayer: () => player } };
      const controller = { on: (name, fn) => { handlers[name] = fn; }, emitter: { emit: (name, m) => { if (name === 'sendMessage') sent.push(m.message); } } };
      new CraftService(sp, controller);
      const form = (id) => (id ? { getFormID: () => id } : undefined);
      const leave = (baseId, n = 1) => handlers.containerChanged({ oldContainer: form(0x14), newContainer: undefined, baseObj: form(baseId), numItems: n });
      const arrive = (baseId, n = 1) => handlers.containerChanged({ oldContainer: undefined, newContainer: form(0x14), baseObj: form(baseId), numItems: n });
      const tick = (ms) => { now += ms; handlers.update(); };
      const open = (name = 'Crafting Menu') => handlers.menuOpen({ name });
      const close = (name = 'Crafting Menu') => handlers.menuClose({ name });
      return { sent, lines, world, leave, arrive, tick, open, close };
    };

    // ---- the grain mill as Purr met it: seated, the menu opens, nothing made -----------------------------------------
    {
      const t = make(); t.tick(300);
      t.world.seat = GRAIN_MILL; t.tick(300);
      t.tick(1200); t.open(); t.tick(2000); t.close(); t.tick(300);
      t.world.seat = null; t.tick(300);
      check('standing up from the grain mill writes one line', t.lines.length === 1, t.lines);
      check('...naming the mill, its base and keyword', /^wb seat 5cabc base=9c6df kw=isGrainMill /.test(t.lines[0] || ''), t.lines[0]);
      check('...with the menu open 1.2 s after the seat and nothing moved or sent', / menu=1\.2 out=0 in=0 sent=0$/.test(t.lines[0] || ''), t.lines[0]);
      check('...and no craft report', t.sent.length === 0, t.sent);
    }
    // ---- seated at an oven, the menu never opens ---------------------------------------------------------------------
    {
      const t = make(); t.tick(300);
      t.world.seat = OVEN; t.tick(300); t.tick(4000);
      t.world.seat = null; t.tick(300);
      check('an oven seat with no menu says menu=no', t.lines.length === 1 && /^wb seat 4812ae06 base=300283f kw=isCraftingOven sat=4\.\d menu=no out=0 in=0 sent=0$/.test(t.lines[0]), t.lines);
    }
    // ---- a real craft at a cookpot -------------------------------------------------------------------------------------
    {
      const t = make(); t.tick(300);
      t.world.seat = COOKPOT; t.tick(300); t.open(); t.tick(300);
      t.leave(0x64b42); t.leave(0x34cdf); t.arrive(0xf431c);
      t.close(); t.tick(300); t.world.seat = null; t.tick(300);
      check('the craft report still goes to the server', t.sent.length === 1 && t.sent[0].data.resultObjectId === 0xf431c && t.sent[0].data.workbench === 0x80717dd, t.sent);
      check('...and a seat whose craft went out writes no line (the server log has it)', t.lines.length === 0, t.lines);
    }
    // ---- a report sent on standing up (a disenchant: nothing comes back) counts for the bench left -------------------
    {
      const t = make(); t.tick(300);
      t.world.seat = ENCHANTER; t.tick(300); t.open(); t.tick(300);
      t.leave(0x13989); t.tick(300);
      t.world.seat = null; t.tick(300);
      check('the report goes out on standing up', t.sent.length === 1 && t.sent[0].data.workbench === 0xbad0d && t.sent[0].data.resultObjectId === 0, t.sent);
      check('...and counts for that seat, so no line', t.lines.length === 0, t.lines);
    }
    // ---- a report still waiting when the player moves straight to the mill counts for the first bench --------------
    {
      const t = make(); t.tick(300);
      t.world.seat = ENCHANTER; t.tick(300); t.open(); t.tick(300); t.leave(0x13989); t.close();
      t.world.seat = GRAIN_MILL; t.tick(300); t.tick(2000);
      t.world.seat = null; t.tick(300);
      check('the waiting report goes out with the first bench', t.sent.length === 1 && t.sent[0].data.workbench === 0xbad0d, t.sent);
      check('...and the mill still writes its own line, sent=0', t.lines.length === 1 && /^wb seat 5cabc base=9c6df kw=isGrainMill .* menu=no out=0 in=0 sent=0$/.test(t.lines[0]), t.lines);
    }
    // ---- food eaten on a chair: the report goes as before, no line ---------------------------------------------------
    {
      const t = make(); t.tick(300);
      t.world.seat = CHAIR; t.tick(300); t.leave(0x64b42); t.tick(300);
      t.world.seat = null; t.tick(300);
      check('food eaten on a chair writes no line', t.lines.length === 0, t.lines);
      check('...and the chair report is unchanged', t.sent.length === 1 && t.sent[0].data.workbench === 0x80b5d59, t.sent);
    }
    // ---- a chair where nothing happened says nothing; a key rebuild on it is not counted ------------------------------
    {
      const t = make(); t.tick(300);
      t.world.seat = CHAIR; t.tick(300); t.tick(5000);
      t.leave(0x000db0e2, 3); t.arrive(0x000db0e2); t.arrive(0x000db0e2); t.arrive(0x000db0e2); t.tick(300);
      t.world.seat = null; t.tick(300);
      check('a chair writes no line, key rebuilds included', t.lines.length === 0 && t.sent.length === 0, { lines: t.lines, sent: t.sent });
    }
    // ---- moving straight from one bench to another, and a menu seen just before the seat ------------------------------
    {
      const t = make(); t.tick(300);
      t.open(); t.tick(100); t.world.seat = GRAIN_MILL; t.tick(300);
      t.world.seat = COOKPOT; t.tick(300);
      t.world.seat = null; t.tick(300);
      check('switching benches ends the first seat with its own line', t.lines.length === 2 && t.lines[0].startsWith('wb seat 5cabc ') && t.lines[1].startsWith('wb seat 80717dd '), t.lines);
      check('...a menu opened just before the seat was seen belongs to it', / menu=0\.0 /.test(t.lines[0] || ''), t.lines[0]);
      check('...and not to the next bench', / menu=no /.test(t.lines[1] || ''), t.lines[1]);
    }
    // ---- a base that cannot be read: a chair stays quiet, a bench with a menu still reports --------------------------
    {
      const t = make(); t.tick(300);
      t.world.noBase = true; t.world.seat = CHAIR; t.tick(300); t.world.seat = null; t.tick(300);
      check('an unreadable seat with nothing happening writes nothing', t.lines.length === 0, t.lines);
      t.world.seat = GRAIN_MILL; t.tick(300); t.open(); t.tick(300); t.world.seat = null; t.tick(300);
      check('...with a menu it reports by local id', t.lines.length === 1 && /^wb seat local:5cabc base=\? kw=- /.test(t.lines[0]), t.lines);
    }
    // ---- the line passes the trace gate unchanged ---------------------------------------------------------------------
    {
      const d = new WorkbenchDiag();
      d.seat(0x5cabc, 0, () => ({ remoteId: 0x5cabc, baseId: 0x9c6df, keyword: 'isGrainMill' }));
      d.menuOpened(1200);
      const line = d.seat(0, 3500, () => null);
      const admitted = new TraceGate().admit(line, 5000);
      check('the trace gate keeps every character of the line', admitted === `apr ${line}`, { line, admitted });
      const nosit = `wb nosit ${(0x5cabc).toString(16)} base=${(0x9c6df).toString(16)}`;
      check('...and of the no-sit line', new TraceGate().admit(nosit, 0) === `apr ${nosit}`, nosit);
    }
  } finally {
    Date.now = realNow;
    delete globalThis.__dboTrace;
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
