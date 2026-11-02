// How an NPC copy is played back between its movement packets (src/sync/movementApply.ts translateTo, nextPlayback): the
// real applyMovement, bundled with its imports stubbed, drives a copy whose translateTo moves it toward the target at the
// speed given, sixty frames a second, while a synthetic NPC walks a square loop and its packets arrive at 2, 4 and 10 a
// second (the cadences the server-driven NPC slice will try; _work/server-npc-movement-1102.md). Measured per run: the
// share of frames the copy stands while the NPC walks (a walk that stops and starts), the largest single-frame jump (a
// teleport) and the mean distance behind. Synthetic positions only, no game data. The mutants at the end are bundled from
// altered copies of movementApply.ts and must each fail.
//   node tests/npc-playback-harness.js      (env ESBUILD_DIR, else the fork's skymp5-server esbuild)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const HERE = path.resolve(__dirname, '..');
const ESB = [process.env.ESBUILD_DIR, path.join(HERE, '../skymp5-server/node_modules/esbuild'), path.join(HERE, '../../../fork/skymp5-server/node_modules/esbuild')].find((d) => d && fs.existsSync(path.join(d, 'package.json')));
if (!ESB) { console.log('SKIP needs ESBUILD_DIR'); process.exit(0); }
const esbuild = require(ESB);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-npc-playback-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* the OS */ } });
let fails = 0;
const check = (what, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!ok) fails++; };

// Every import of movementApply.ts, stubbed; the copy is globalThis.__pb.refr
fs.writeFileSync(path.join(TMP, 'stub.js'), `
const P = () => globalThis.__pb;
const Actor = { from: (r) => (r && r.isActor ? r : null) };
const Game = { findClosestActor: () => null, getPlayer: () => P().player };
const Debug = { sendAnimationEvent: () => {} };
const TESModPlatform = { setWeaponDrawnMode: () => {} };
const ObjectReference = {};
class RespawnNeededError extends Error {}
const pos = (r) => [r.pos[0], r.pos[1], r.pos[2]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ObjectReferenceEx = { getPos: pos, getDistance: dist, getDistanceNoZ: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]), getWorldOrCell: (r) => r.cell };
const SpApiInteractor = { getControllerInstance: () => ({ emitter: { emit: () => {} } }) };
module.exports = { Actor, Game, Debug, TESModPlatform, ObjectReference, RespawnNeededError, ObjectReferenceEx, SpApiInteractor,
  forgetAnimationState: () => {}, isInSitPose: () => false, setRefrCollision: () => {}, forgetBody: () => {}, isHostedByMe: () => false };
`);
const STUBBED = /^skyrimPlatform$|\/errors$|\/objectReferenceEx$|\/spApiInteractor$|\/animation$|\/bodyPos$|\/worldViewMisc$/;
const SRC = path.join(HERE, 'src/sync/movementApply.ts');
const build = async (source, name) => {
  const out = path.join(TMP, name + '.js');
  await esbuild.build({
    entryPoints: [SRC], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
    plugins: [{ name: 'stub', setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => (STUBBED.test(a.path) ? { path: path.join(TMP, 'stub.js') } : undefined));
      if (source) b.onLoad({ filter: /movementApply\.ts$/ }, () => ({ contents: source, loader: 'ts' }));
    } }],
  });
  delete require.cache[out];
  return require(out);
};

// A copy whose translateTo moves it toward the target at the speed given, a frame at a time
const makeCopy = (id) => ({
  isActor: true, id, cell: 0x3c, pos: [0, 0, 0], ang: 0, target: null, speed: 0,
  getFormID() { return this.id; }, getPositionX() { return this.pos[0]; }, getPositionY() { return this.pos[1]; }, getPositionZ() { return this.pos[2]; },
  getAngleZ() { return this.ang; }, is3DLoaded: () => true, getSitState: () => 0, isDead: () => false, getActorValue: () => 0,
  translateTo(x, y, z, ax, ay, az, speed) { this.target = [x, y, z]; this.speed = speed; this.ang = az; },
  stopTranslation() { this.target = null; },
  setHeadTracking() {}, setLookAt() {}, blockActivation() {}, keepOffsetFromActor() {}, clearKeepOffsetFromActor() {},
  isSprinting: () => false, getAnimationVariableBool: () => false, isSneaking: () => false, isWeaponDrawn: () => false,
  getActorValuePercentage: () => 1, getBaseActorValue: () => 100, restoreActorValue() {}, damageActorValue() {},
  frame(dt) {
    if (!this.target) return;
    const d = [this.target[0] - this.pos[0], this.target[1] - this.pos[1], this.target[2] - this.pos[2]];
    const len = Math.hypot(...d), step = this.speed * dt;
    if (len <= step || len < 1e-6) { this.pos = this.target.slice(); return; }
    for (let i = 0; i < 3; i++) this.pos[i] += (d[i] / len) * step;
  },
});

// The NPC walks a 1,200-unit square at 120 units a second, a corner every 10 s
const WALK = 120, SIDE = 1200;
const truePos = (t) => {
  const s = (t * WALK) % (4 * SIDE), side = Math.floor(s / SIDE), f = s - side * SIDE;
  return [[f, 0], [SIDE, f], [SIDE - f, SIDE], [0, SIDE - f]][side].concat([0]);
};
const heading = (t) => [90, 0, 270, 180][Math.floor(((t * WALK) % (4 * SIDE)) / SIDE)];

let runs = 0;
const run = (M, hz, opts) => {
  const o = Object.assign({ seconds: 20, isNpc: true, pauseAt: -1, pauseFor: 0 }, opts || {});
  const FPS = 60, dt = 1 / FPS;
  let clock = 1000000;
  const realNow = Date.now; Date.now = () => clock;
  globalThis.__pb = { player: makeCopy(7) };
  // every run its own copy: the module keeps a playback state per id
  const copy = makeCopy(0xff000a00 + (++runs));
  copy.pos = truePos(0);
  let nextPacket = 0, standFrames = 0, walkFrames = 0, maxJump = 0, lagSum = 0, frames = 0;
  try {
    for (let i = 0; i < o.seconds * FPS; i++) {
      const t = i * dt;
      const paused = o.pauseAt >= 0 && t >= o.pauseAt && t < o.pauseAt + o.pauseFor;
      if (t >= nextPacket - 1e-9 && !paused) {
        const tt = o.pauseAt >= 0 && t >= o.pauseAt + o.pauseFor ? t - o.pauseFor : t;
        M.applyMovement(copy, { worldOrCell: 0x3c, pos: truePos(tt), rot: [0, 0, heading(tt)], runMode: 'Walking', direction: 0, speed: WALK,
          isInJumpState: false, isSneaking: false, isBlocking: false, isWeapDrawn: false, isDead: false, healthPercentage: 1 }, false, o.isNpc);
        nextPacket += 1 / hz;
      }
      if (paused && t >= nextPacket) nextPacket = o.pauseAt + o.pauseFor;
      const before = copy.pos.slice();
      copy.frame(dt);
      clock += 1000 / FPS;
      const moved = Math.hypot(copy.pos[0] - before[0], copy.pos[1] - before[1]);
      if (t > 1 && !paused) {
        walkFrames++; frames++;
        if (moved < 0.05) standFrames++;
        if (moved > maxJump) maxJump = moved;
        const tt = o.pauseAt >= 0 && t >= o.pauseAt + o.pauseFor ? t - o.pauseFor : t;
        lagSum += Math.hypot(copy.pos[0] - truePos(tt)[0], copy.pos[1] - truePos(tt)[1]);
      }
    }
  } finally { Date.now = realNow; }
  const st = M.getApplyState(copy.getFormID());
  return { hz, stand: Math.round((standFrames / Math.max(1, walkFrames)) * 1000) / 1000, maxJump: Math.round(maxJump * 100) / 100,
    lag: Math.round(lagSum / Math.max(1, frames)), playbackS: Math.round(st.playbackS * 1000) / 1000 };
};

const PER_FRAME = WALK / 60; // 2 units a frame at walking pace
const checksOf = (M, c, report) => {
  const r2 = run(M, 2), r4 = run(M, 4), r10 = run(M, 10), r30 = run(M, 30);
  if (report) for (const r of [r2, r4, r10, r30]) console.log(`     ${r.hz} Hz: stands ${(r.stand * 100).toFixed(1)}% of frames while walking, largest jump ${r.maxJump} (walking is ${PER_FRAME}), ${r.lag} behind, playback ${r.playbackS} s`);
  c('at 2, 4 and 10 packets a second the copy keeps walking: it stands under 5% of the frames', r2.stand < 0.05 && r4.stand < 0.05 && r10.stand < 0.05, [r2.stand, r4.stand, r10.stand]);
  c('...and never jumps: no frame moves it more than 1.6 times a walking step (a teleport would be hundreds)', Math.max(r2.maxJump, r4.maxJump, r10.maxJump) <= PER_FRAME * 1.6, [r2.maxJump, r4.maxJump, r10.maxJump]);
  c('...the playback time follows the packet gap (0.5, 0.25 and 0.13 s)', Math.abs(r2.playbackS - 0.5) < 0.02 && Math.abs(r4.playbackS - 0.25) < 0.02 && r10.playbackS === 0.13, [r2.playbackS, r4.playbackS, r10.playbackS]);
  c('a stream of 7.7 a second or more plays back as before: 0.13 s', r30.playbackS === 0.13 && r30.stand < 0.05, r30);
  const paused = run(M, 2, { pauseAt: 8, pauseFor: 3 });
  c('after a 3 s pause the first move is not a crawl: the playback never passes 0.6 s', paused.playbackS <= 0.6 && paused.maxJump <= PER_FRAME * 1.6 * 1.25, paused);
  const player = run(M, 2, { isNpc: false });
  c('a player copy is untouched: no playback time is kept for it', player.playbackS === 0, player);
  const s = M.nextPlayback;
  c('nextPlayback: smoothed toward the gap, clamped to 0.13..0.6, no gap keeps the last', s(0, 500) === 0.5 && Math.abs(s(0.5, 250) - 0.425) < 1e-9 && s(0, 40) === 0.13 && s(0, 5000) === 0.6 && s(0.3, 0) === 0.3 && s(0, 0) === 0.13);
};

(async () => {
  const M = await build(null, 'live');
  checksOf(M, check, true);
  const source = fs.readFileSync(SRC, 'utf8');
  const MUTANTS = [
    ['the fixed 0.13 s of before', '    time = s.playbackS;\n', '    time = NPC_PLAYBACK_S;\n'],
    ['no upper clamp', 'const clamp = (v: number): number => Math.min(NPC_PLAYBACK_MAX_S, Math.max(NPC_PLAYBACK_S, v));', 'const clamp = (v: number): number => Math.max(NPC_PLAYBACK_S, v);'],
    ['no lower clamp (a fast stream changes)', 'const clamp = (v: number): number => Math.min(NPC_PLAYBACK_MAX_S, Math.max(NPC_PLAYBACK_S, v));', 'const clamp = (v: number): number => Math.min(NPC_PLAYBACK_MAX_S, v);'],
    ['players played back too', '  if (isNpc) {\n    const s = stateOf(refr.getFormID());', '  if (true) {\n    const s = stateOf(refr.getFormID());'],
  ];
  for (let i = 0; i < MUTANTS.length; i++) {
    const [name, a, b] = MUTANTS[i];
    if (i === 0) console.log(`     as before (${name}):`);
    if (!source.includes(a)) { check(`mutant "${name}": its line is in movementApply.ts`, false, a); continue; }
    let bad = 0;
    try { checksOf(await build(source.replace(a, b), `m${i}`), (w, ok) => { if (!ok) bad++; }, i === 0); } catch (e) { bad++; }
    check(`mutant caught: ${name}`, bad > 0);
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e.stack || e.message)); process.exit(1); });
