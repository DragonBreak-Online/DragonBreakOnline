// Scripted test for the emote wheel's FNIS sequence (Smoke Pipe, Pipe Smoking SE): emoteService.ts sends the sequence's
// events at the times its own PipeSmokingLongPipePlayerFXScript does, each on a frame of its own, leaves through the exit
// clip however it is ended (movement included), then sends IdleStop as the mod does, and says what is missing when the
// player's graph has no FNIS registration for it. Drives the real emoteService.ts against a stubbed game with a clock.
// Run from skymp5-client:
//
//   node tests/emote-sequence-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP emote-sequence (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);
const DTS = path.resolve(__dirname, '../node_modules/@skyrim-platform/skyrim-platform/index.d.ts');
if (!fs.existsSync(DTS)) { console.log('SKIP emote-sequence (no SkyrimPlatform typings)'); process.exit(0); }

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`);
  if (!ok) failures++;
};

const enumsOf = (src) => {
  const out = {};
  for (const m of src.matchAll(/export const enum (\w+) \{([^}]*)\}/g)) {
    const e = {}; let next = 0;
    for (const raw of m[2].split(',')) {
      const item = raw.replace(/\/\/.*$/gm, '').trim();
      if (!item) continue;
      const [k, v] = item.split('=').map((s) => s.trim());
      if (v === undefined) { e[k] = next++; continue; }
      const str = v.match(/^'(.*)'$/) || v.match(/^"(.*)"$/);
      if (str) { e[k] = str[1]; continue; }
      e[k] = Number(v); next = e[k] + 1;
    }
    out[m[1]] = e;
  }
  return out;
};
const ENUMS = enumsOf(fs.readFileSync(DTS, 'utf8'));
const { DxScanCode, InputDeviceType } = ENUMS;

const H = { notified: [], events: [] };
globalThis.__esH = H;
const STUBS = {
  skyrimPlatform: `module.exports = Object.assign(${JSON.stringify(ENUMS)}, { once: () => {} });`,
  clientListener: 'class ClientListener {} module.exports = { ClientListener };',
  customPacketUtil: `module.exports = {
    parseCustomPacket: (e) => { try { return JSON.parse(e.message.contentJsonDump); } catch { return null; } },
    sendCustomPacket: () => {},
    notifyNextUpdate: (_c, _sp, text) => globalThis.__esH.notified.push(text) };`,
  logging: 'module.exports = { logTrace() {}, logError() {} };',
  browserService: 'class BrowserService {} module.exports = { BrowserService };',
  restraintService: 'class RestraintService {} module.exports = { RestraintService };',
  networkingService: 'class NetworkingService {} module.exports = { NetworkingService };',
};
const STUB_OF = { skyrimPlatform: 'skyrimPlatform', './clientListener': 'clientListener', './customPacketUtil': 'customPacketUtil',
  '../../logging': 'logging', './browserService': 'browserService', './restraintService': 'restraintService',
  './networkingService': 'networkingService' };

// The clock: Utility.wait resolves when the test advances past it; each "update" runs the once-handlers queued for it
let now = 0;
let timers = [];
const ctl = (() => {
  const on = {}; const onceQ = {}; const emit = {};
  return {
    on: (ev, fn) => { (on[ev] = on[ev] || []).push(fn); },
    once: (ev, fn) => { (onceQ[ev] = onceQ[ev] || []).push(fn); },
    emitter: { on: (ev, fn) => { (emit[ev] = emit[ev] || []).push(fn); }, emit: (ev, x) => (emit[ev] || []).forEach((f) => f(x)) },
    lookupListener: (ctor) => {
      const n = String(ctor && ctor.name).replace(/\d+$/, '');
      if (n === 'BrowserService') return { liveBlockingMenus: () => [], isBlockingMenuOpen: () => false, recordedBlockingMenus: () => [], isUiHidden: () => false };
      if (n === 'RestraintService') return { isPoseLocked: false };
      throw new Error(`no ${ctor.name}`);
    },
    fire: (ev, x) => { (on[ev] || []).slice().forEach((f) => f(x)); const q = onceQ[ev] || []; onceQ[ev] = []; q.forEach((f) => f(x)); },
  };
})();
const frame = () => ctl.fire('update');
// Moves the clock to ms, firing due waits in order, with a frame after each so their once('update') work runs
const advance = (to) => {
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const t = timers[0];
    if (!t || t.at > to) break;
    timers.shift(); now = t.at; t.fn(); frame(); frame();
  }
  now = to; frame(); frame();
};

// The player's graph: which events it accepts (an FNIS-registered one accepts the pipe's, a stock one refuses them)
const graph = { accepts: () => true };
let hook = null;
const player = {
  isWeaponDrawn: () => false, getFurnitureReference: () => null, isSwimming: () => false, isOnMount: () => false,
  getAnimationVariableBool: () => false, getSitState: () => 0,
};
const sp = {
  settings: { 'skymp5-client': {} },
  getPluginSourceCode: () => '', writePlugin: () => {}, writeLogs: () => {},
  hooks: { sendAnimationEvent: { add: (h) => { hook = h; } } },
  browser: { isFocused: () => false, setFocused: () => {}, setVisible: () => {}, isVisible: () => true, executeJavaScript: () => {} },
  Ui: { isMenuOpen: () => false },
  Debug: {
    notification: () => {},
    sendAnimationEvent: (_a, ev) => {
      const ok = graph.accepts(ev);
      H.events.push([now, ev]);
      if (hook) hook.leave({ animEventName: ev, animationSucceeded: ok });
    },
  },
  Utility: { wait: (s) => ({ then: (fn) => { timers.push({ at: now + Math.round(s * 1000), fn }); } }), isInMenuMode: () => false },
  Game: { getPlayer: () => player },
};

const PIPE = 'pipesmokingcrossleggedenter';
const reset = () => { H.events.length = 0; H.notified.length = 0; timers = []; now = 0; graph.accepts = () => true; };
const evs = () => H.events.map((e) => e[1]);
const at = (ev) => (H.events.find((e) => e[1] === ev) || [null])[0];
const choose = (anim) => { ctl.fire('browserMessage', { arguments: ['emote:play', anim] }); frame(); frame(); frame(); };
const move = () => { ctl.fire('buttonEvent', { code: DxScanCode.W, device: InputDeviceType.Keyboard, isDown: true, isUp: false, userEventName: '' }); frame(); };

(async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'emote-seq-'));
  let E;
  try {
    const out = path.join(dir, 'emoteService.js');
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../src/services/services/emoteService.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (STUB_OF[a.path] ? { path: STUB_OF[a.path], namespace: 'stub' } : undefined));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
      } }],
    });
    E = require(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  globalThis.__dboDiagNote = () => {};
  new E.EmoteService(sp, ctl);

  // ---- the mod's own timing ----
  reset();
  choose(PIPE);
  check('choosing Smoke Pipe sends the sequence\'s first event at once', evs()[0] === PIPE && at(PIPE) === 0, H.events);
  advance(10000);
  check('startblaze at 3.0 s, as the mod', at('pipesmokingcrossleggedstartblaze') === 3000, H.events);
  check('blazed at 3.1 s: a frame of its own, so the animation sync relays both', at('pipesmokingcrossleggedblazed') === 3100, H.events);
  check('the smoking loop at 7 s', at('pipesmokingcrosslegged') === 7000, H.events);
  check('in that order and nothing else', JSON.stringify(evs()) === JSON.stringify([PIPE, 'pipesmokingcrossleggedstartblaze', 'pipesmokingcrossleggedblazed', 'pipesmokingcrosslegged']), evs());
  advance(60000);
  check('the loop holds until the player ends it (no exit on its own)', !evs().includes('pipesmokingcrossleggedexit'));

  // ---- ended by movement: the exit clip anyway, then IdleStop ----
  H.events.length = 0;
  move();
  advance(now + 500);
  check('a movement key ends it through its own exit clip (the pipe is put away, not dropped)', evs()[0] === 'pipesmokingcrossleggedexit', evs());
  check('...and nothing forced over it', !evs().includes('IdleForceDefaultState'), evs());
  const stopAt = now;
  advance(now + 4000);
  check('IdleStop 3 s after, as the mod ends it', evs().includes('IdleStop') && at('IdleStop') >= stopAt + 2400, H.events);

  // ---- interrupted early: the pending steps are dropped ----
  reset();
  choose(PIPE);
  advance(1000);
  move();
  advance(9000);
  check('stopped at 1 s, none of the later steps fire', !evs().some((e) => /startblaze|blazed|^pipesmokingcrosslegged$/.test(e)), evs());
  check('...and it still leaves through the exit clip', evs().includes('pipesmokingcrossleggedexit'), evs());

  // ---- another emote over it: exit clip first, then the new one ----
  reset();
  choose(PIPE);
  advance(8000);
  H.events.length = 0;
  choose('IdleWave');
  advance(now + 3000);
  const ix = evs().indexOf('pipesmokingcrossleggedexit'); const iw = evs().indexOf('IdleWave');
  check('choosing Wave mid-smoke plays the pipe\'s exit clip, then Wave', ix >= 0 && iw > ix, evs());
  advance(now + 5000);
  check('...and the pipe\'s IdleStop does not cut the wave short', !evs().includes('IdleStop'), evs());

  // ---- a graph without the FNIS registration ----
  reset();
  graph.accepts = (ev) => !/^pipesmoking/.test(ev);
  choose(PIPE);
  check('a stock graph refuses the first event: the player is told to check their files', H.notified.some((t) => /needs the latest game files/.test(t)), H.notified);
  advance(10000);
  check('...no step is sent after the refusal', JSON.stringify(evs()) === JSON.stringify([PIPE]), evs());
  move();
  advance(now + 4000);
  check('...and movement then has nothing to exit', JSON.stringify(evs()) === JSON.stringify([PIPE]), evs());

  // ---- the ordinary emotes are untouched ----
  reset();
  choose('IdleWave');
  advance(5000);
  move();
  advance(now + 4000);
  check('Wave sends no steps and, moved out of, no IdleStop of the pipe\'s', evs()[0] === 'IdleWave' && !evs().includes('IdleStop') && !evs().some((e) => /^pipesmoking/.test(e)), evs());

  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL the harness threw: ' + (e && e.stack || e)); process.exit(1); });
