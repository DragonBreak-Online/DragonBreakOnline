// view/niNodeQueue.ts: the player's own NiNode (3D) update is not sent while the player's race is a beast race, the rule
// copies have had since a queued 3D reset crashed beast copies; queued work (skee's preset load) still runs and decides
// itself. Runs the real niNodeQueue.ts and niNodeQueuePlan.ts against a fake game. Run from skymp5-client:
//
//   node tests/player-ninode-beast-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP player-ninode-beast (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const NORD = 0x13746, WEREWOLF = 0xcdd84, VAMPIRE_LORD = 0x0200283a;
const COPY = 0xff000123;
const G = globalThis.__NQ = { race: NORD, raceThrows: false, sent: 0, copySent: 0, ons: [], traces: [] };
globalThis.__dboTrace = (t) => G.traces.push(t);
const STUB = `
  const G = globalThis.__NQ;
  const player = { getFormID: () => 0x14,
    getRace: () => { if (G.raceThrows) throw new Error('no race'); return { getFormID: () => G.race }; },
    queueNiNodeUpdate: () => { G.sent++; } };
  const copy = { getFormID: () => ${COPY}, getRace: () => ({ getFormID: () => 0x13746 }), is3DLoaded: () => true, queueNiNodeUpdate: () => { G.copySent++; } };
  module.exports = { Game: { getPlayer: () => player, getFormEx: (id) => ((id >>> 0) === ${COPY} ? copy : null) }, Actor: { from: (a) => a },
    on: (ev, fn) => G.ons.push(fn), printConsole() {} };`;

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-ninode-'));
  let Q;
  try {
    const out = path.join(tmp, 'niNodeQueue.js');
    await esbuild.build({ entryPoints: [path.resolve(__dirname, '../src/view/niNodeQueue.ts')], bundle: true, platform: 'node', format: 'cjs',
      outfile: out, logLevel: 'error', plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /^skyrimPlatform$/ }, () => ({ path: 'skyrimPlatform', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: STUB, loader: 'js' }));
      } }] });
    Q = require(out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const frame = () => G.ons.forEach((fn) => fn());
  const sentAfter = (fn) => { G.sent = 0; fn(); frame(); frame(); return G.sent; };

  G.race = NORD;
  check('a mortal player\'s NiNode update goes out', sentAfter(() => Q.queuePlayerNiNodeUpdate()) === 1, G.sent);
  G.race = WEREWOLF;
  check('a werewolf player\'s does not', sentAfter(() => Q.queuePlayerNiNodeUpdate()) === 0, G.sent);
  check('...and says so in the trace', G.traces.includes('ni self skip=beast'), G.traces);
  G.race = VAMPIRE_LORD;
  check('a Vampire Lord player\'s does not', sentAfter(() => Q.queuePlayerNiNodeUpdate()) === 0, G.sent);
  // Work and a plain update in one send: a copy went out this frame, so the player's waits for the next
  const workAndPlain = () => {
    let ran = 0;
    Q.queueCopyNiNodeUpdate(COPY);
    frame();
    G.sent = 0;
    Q.queuePlayerNiNodeWork(() => { ran++; return false; });
    Q.queuePlayerNiNodeUpdate();
    frame(); frame();
    return { sent: G.sent, ran };
  };
  let r = workAndPlain();
  check('a beast player\'s queued work still runs (it refuses a beast itself), and the plain update wanted with it is not sent', r.ran === 1 && r.sent === 0, r);
  G.race = NORD;
  r = workAndPlain();
  check('...for a mortal player the plain update still goes out after a refused work', r.ran === 1 && r.sent === 1, r);
  G.raceThrows = true;
  check('a race that cannot be read sends the update, as before', sentAfter(() => Q.queuePlayerNiNodeUpdate()) === 1, G.sent);
  G.raceThrows = false;
  G.race = WEREWOLF;
  sentAfter(() => Q.queuePlayerNiNodeUpdate());
  G.race = NORD;
  check('after the revert the next update goes out again', sentAfter(() => Q.queuePlayerNiNodeUpdate()) === 1, G.sent);

  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
