// Scripted test for the melee reach trace (meleeReachDiag.ts, meleeReachDiagService.ts): the player's melee equips and hits
// become "mel eq" and "mel hits" lines through clientDiag's trace, with Precision's state read once per equip and never again
// after a game without Precision refused the call. Other actors, ranged, bash and stale events give nothing and never throw.
// The real service is bundled with esbuild and driven by fake events. Run it from skymp5-client:
//
//   node tests/melee-reach-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP melee-reach (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

const STUBS = {
  skyrimPlatform: 'module.exports = {};',
  './clientListener': 'module.exports = { ClientListener: class {} };',
};

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'melee-reach-'));
  const out = path.join(tmp, 'meleeReachDiagService.js');
  try {
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../src/services/services/meleeReachDiagService.ts')],
      bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
      plugins: [{
        name: 'stubs',
        setup(b) {
          const filter = new RegExp(`^(${Object.keys(STUBS).map((k) => k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
          b.onResolve({ filter }, (a) => ({ path: a.path, namespace: 'stub' }));
          b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
        },
      }],
    });
    run(require(out));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} FAILED` : 'all ok');
  process.exit(failures ? 1 : 0);
}

const W_CYR = 0x8300057, W_VAN = 0x13987, BOW = 0x139a5;
const TYPES = { [W_CYR]: 5, [W_VAN]: 5, [BOW]: 7, 0x1: 1, 0x2: 2, 0x3: 3, 0x4: 4, 0x5: 6, 0x6: 1, 0x7: 2 };

function run(mod) {
  const { MeleeReachDiagService } = mod;
  const lines = [];
  globalThis.__dboTrace = (t) => lines.push(t);
  let now = 1000000;
  Date.now = () => now;

  const ref = (id, pos) => ({ getFormID: () => id, getPositionX: () => pos[0], getPositionY: () => pos[1], getPositionZ: () => pos[2] });
  const form = (id) => ({ getFormID: () => id });
  let precision = 'active', nativeCalls = 0;
  const sp = {
    Weapon: { from: (f) => (f && TYPES[f.getFormID()] !== undefined ? { getFormID: () => f.getFormID(), getWeaponType: () => TYPES[f.getFormID()] } : null) },
    Actor: { from: (r) => (r && r.isActor ? r : null) },
    Game: { getPlayer: () => ref(0x14, [0, 0, 0]) },
    callNative: (cls, fn, self, actor) => {
      nativeCalls++;
      if (cls !== 'Precision_Utility' || fn !== 'IsActorActive' || self !== undefined || !actor) throw new Error('bad call');
      if (precision === 'missing') throw new Error("Native function not found 'Precision_Utility.IsActorActive'");
      return precision === 'active';
    },
  };
  const handlers = {};
  const controller = { on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); }, emitter: { on() {} } };
  new MeleeReachDiagService(sp, controller);
  const fire = (ev, e) => { for (const h of handlers[ev] || []) h(e); };
  const player = ref(0x14, [100, 200, 0]);
  const npc = (x) => Object.assign(ref(0xff000123, [100 + x, 200, 0]), { isActor: true });
  const equip = (actor, id) => fire('equip', { actor, baseObj: form(id) });
  const hit = (dist, extra = {}) => fire('hit', Object.assign({ aggressor: player, target: npc(dist), source: form(W_CYR), projectile: null,
    isPowerAttack: false, isBashAttack: false, isSneakAttack: false, isHitBlocked: false }, extra));

  check('handlers: equip, hit, tick', ['equip', 'hit', 'tick'].every((k) => (handlers[k] || []).length === 1), Object.keys(handlers));

  // Equips
  equip(player, W_CYR);
  check('player equips a greatsword: one line with Precision active', lines.length === 1 && lines[0] === 'mel eq w=8300057 t=5 pa=1', lines);
  equip(player, W_CYR);
  check('the same weapon again: no second line', lines.length === 1, lines);
  equip(ref(0xff000999, [0, 0, 0]), W_VAN);
  check('another actor equips: nothing', lines.length === 1, lines);
  equip(player, BOW);
  check('a bow: nothing', lines.length === 1, lines);
  equip(player, 0x12345678);
  check('not a weapon: nothing', lines.length === 1, lines);
  precision = 'inactive';
  equip(player, W_VAN);
  check('loaded but not active: pa=0', lines[lines.length - 1] === 'mel eq w=13987 t=5 pa=0', lines);

  // Hits
  lines.length = 0;
  equip(player, W_CYR);
  lines.length = 0;
  hit(60); hit(80, { isPowerAttack: true }); hit(100); hit(120);
  check('hits inside the window: no line yet', lines.length === 0, lines);
  hit(90, { aggressor: ref(0xff000555, [0, 0, 0]) });
  hit(70, { projectile: form(0x10) });
  hit(70, { isBashAttack: true });
  hit(70, { target: Object.assign(ref(0x5000, [170, 200, 0]), { isActor: false }) });
  hit(70, { source: form(BOW) });
  hit(5000);
  hit(70, { source: null });
  check('other aggressor, projectile, bash, non-actor, bow, too far, no source: still no line', lines.length === 0, lines);
  now += 300000;
  fire('tick');
  check('after five minutes the tick sums them up', lines.length === 1 && lines[0] === 'mel hits w=8300057 t=5 n=4 p=1 d50=80 d90=120 dmax=120', lines);
  fire('tick');
  check('summed once', lines.length === 1, lines);

  // An equip closes the weapon held before
  lines.length = 0;
  hit(150); hit(155);
  equip(player, W_VAN);
  check('equipping another weapon sends the old one first', lines.length === 1 && /^mel hits w=8300057 t=5 n=2 p=0 d50=150 d90=155 dmax=155$/.test(lines[0]), lines);

  // Stale native objects never throw out of a handler
  const stale = { getFormID: () => { throw new Error('expired'); } };
  let threw = false;
  try { fire('equip', { actor: stale, baseObj: stale }); fire('hit', { aggressor: stale, target: stale, source: stale }); } catch (e) { threw = true; }
  check('stale events: no throw', !threw);

  // Without Precision the native is tried once, then never again
  const fresh = mod.MeleeReachDiagService;
  lines.length = 0;
  nativeCalls = 0;
  precision = 'missing';
  const handlers2 = {};
  const c2 = { on: (ev, fn) => { (handlers2[ev] = handlers2[ev] || []).push(fn); }, emitter: { on() {} } };
  new fresh(sp, c2);
  const eq2 = (id) => { for (const h of handlers2.equip) h({ actor: player, baseObj: form(id) }); };
  eq2(0x1); eq2(0x2); eq2(0x3);
  check('no Precision: pa=-', lines.length === 3 && lines.every((l) => / pa=-$/.test(l)), lines);
  check('no Precision: the native was called once', nativeCalls === 1, nativeCalls);

  // Line caps: six equip lines and twelve summaries per game process
  eq2(0x4); eq2(0x5); eq2(0x6); eq2(0x7);
  check('equip lines stop at six', lines.length === 6, lines);
  lines.length = 0;
  for (let i = 0; i < 20; i++) {
    for (const h of handlers2.hit) h({ aggressor: player, target: npc(50 + i), source: form(0x1), projectile: null, isPowerAttack: false, isBashAttack: false });
    now += 300000;
    for (const h of handlers2.tick) h();
  }
  check('summaries stop at twelve', lines.length === 12 && lines.every((l) => l.startsWith('mel hits w=1 t=1 n=1 ')), lines.length);
  check('only codes, numbers and hex ids', lines.every((l) => /^[a-z0-9 =]+$/.test(l)), lines);
}

main().catch((e) => { console.log('FAIL harness', e && e.stack); process.exit(1); });
