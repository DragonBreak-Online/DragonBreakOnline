// Client half of the chopping block (executionService.ts; server execution.js), run for real: the service is bundled
// with esbuild against stubs of skyrimPlatform and its neighbours, and every Papyrus native throws outside an update,
// as SkyrimPlatform does ("can't be called in this context": 0.3.96 called them from the packet handler, which runs in
// tick context, and nothing played). Run from skymp5-client:
//   node tests/execution-client-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP execution-client (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

const STUBS = {
  skyrimPlatform: 'module.exports = globalThis.__sp;',
  './clientListener': 'class ClientListener {} module.exports = { ClientListener };',
  './customPacketUtil': 'module.exports = { parseCustomPacket: (e) => e.message.content };',
  './remoteServer': 'class RemoteServer {} module.exports = { RemoteServer };',
  '../../view/worldViewMisc': 'module.exports = { remoteIdToLocalId: (id) => globalThis.__w.copies[id] || 0 };',
  '../../sync/animation': 'module.exports = { allowIdleEvent: (id, ev) => { if (id >= 0xff000000) globalThis.__w.allowed.push([id, ev]); } };',
  '../../logging': 'module.exports = { logError: (...a) => globalThis.__w.errors.push(a.map(String).join(" ")), logTrace: () => {} };',
};

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-exec-client-'));
  const out = path.join(tmp, 'executionService.js');
  try {
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../src/services/services/executionService.ts')], bundle: true, platform: 'node',
      format: 'cjs', outfile: out, logLevel: 'error',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (STUBS[a.path] !== undefined ? { path: a.path, namespace: 'stub' } : undefined));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
      } }],
    });
    await run(out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// A tiny game: actors by form id, the update/tick context, and Utility.wait timers driven by hand
function world() {
  const w = { inUpdate: false, actors: {}, copies: {}, allowed: [], errors: [], events: [], idles: [], notes: [], moves: [],
    waits: [], updateQueue: [], packetHandlers: [] };
  const guard = (name) => { if (!w.inUpdate) throw new Error(`'${name}' can't be called in this context`); };
  const actor = (id, o) => {
    const a = Object.assign({ id, sit: 0, furniture: null, playIdleResult: true, dismountFrees: false, linked: [] }, o || {});
    a.getFormID = () => id;
    a.getSitState = () => { guard('Actor.getSitState'); return a.sit; };
    a.getFurnitureReference = () => { guard('Actor.getFurnitureReference'); return a.furniture; };
    a.playIdle = (idle) => { guard('Actor.playIdle'); w.idles.push([id, idle.edid]); return typeof a.playIdleResult === 'function' ? a.playIdleResult(idle) : a.playIdleResult; };
    a.addDependentAnimatedObjectReference = (d) => { guard('ObjectReference.addDependentAnimatedObjectReference'); a.linked.push(d.id); return true; };
    a.removeDependentAnimatedObjectReference = (d) => { guard('ObjectReference.removeDependentAnimatedObjectReference'); a.linked = a.linked.filter((x) => x !== d.id); return true; };
    a.dismount = () => { guard('Actor.dismount'); if (a.dismountFrees) { a.furniture = null; a.sit = 0; } return a.dismountFrees; };
    a.getAngleZ = () => 90; a.getParentCell = () => null; a.getWorldSpace = () => ({ ws: 1 });
    w.actors[id] = a;
    return a;
  };
  const IDLES = { '74ec5:Skyrim.esm': 'IdleHeadChop', '70c09:Skyrim.esm': 'IdleExecutioneeChop', 'f95be:Skyrim.esm': 'IdleExecutionerChop_Player' };
  w.idleForms = IDLES;
  globalThis.__w = w;
  // One object for every world: the bundle binds its skyrimPlatform import once
  globalThis.__sp = Object.assign(globalThis.__sp || {}, {
    Actor: { from: (x) => x || null }, ObjectReference: { from: (x) => x || null }, Idle: { from: (x) => x || null },
    Game: {
      getFormEx: (id) => { guard('Game.getFormEx'); return w.actors[id] || null; },
      getPlayer: () => { guard('Game.getPlayer'); return w.actors[0x14] || null; },
      getFormFromFile: (id, file) => { guard('Game.getFormFromFile'); const k = `${id.toString(16)}:${file}`; return w.idleForms[k] ? { edid: w.idleForms[k] } : null; },
    },
    Debug: { sendAnimationEvent: (ref, ev) => { guard('Debug.sendAnimationEvent'); w.events.push([ref.id, ev]); if (w.onEvent) w.onEvent(ref, ev); } },
    TESModPlatform: { moveRefrToPosition: (ref, cell, ws, x, y, z, rx, ry, rz) => { guard('TESModPlatform.moveRefrToPosition'); w.moves.push([ref.id, x, y, z, rz]); } },
    Utility: { wait: (s) => new Promise((resolve) => w.waits.push({ s, resolve })) },
  });
  globalThis.__dboDiagNote = (kind, text) => w.notes.push(`${kind} ${text}`);
  w.controller = {
    emitter: { on: (ev, fn) => { if (ev === 'customPacketMessage') w.packetHandlers.push(fn); } },
    once: (ev, fn) => { if (ev === 'update') w.updateQueue.push(fn); },
    lookupListener: () => ({ getMyRemoteRefrId: () => w.myServerId }),
  };
  // A packet arrives in tick context, as NetworkingService emits it
  w.packet = (content) => { w.inUpdate = false; for (const h of w.packetHandlers) h({ message: { content } }); };
  w.update = async () => {
    const q = w.updateQueue.splice(0);
    w.inUpdate = true;
    try { for (const fn of q) fn(); } finally { w.inUpdate = false; }
    await new Promise((r) => setImmediate(r));
  };
  // Every pending wait elapses, then the updates it queued run
  w.elapse = async () => {
    const ws = w.waits.splice(0); for (const x of ws) x.resolve(); await new Promise((r) => setImmediate(r));
    await w.update();
  };
  w.actor = actor;
  return w;
}

async function run(out) {
  world();
  delete require.cache[out];
  const { ExecutionService, nextStandStep } = require(out);
  const PACKET = { customPacketType: 'dboExecute', victim: 0xff000daf, executioner: 0xff00000d, idle: '74ec5:Skyrim.esm', victimIdle: '70c09:Skyrim.esm' };

  const HELGEN = 'IdleExecutionerChop_Player';
  // 1. The headsman's own client (Nate, 21:31:41): the victim is a copy, the headsman the player. Helgen's player-victim
  // path: IdleExecutionerChop_Player on the headsman, then on the victim, the headsman linked first
  {
    const w = world();
    w.myServerId = 0xff00000d;
    w.actor(0x14, { sit: 3, furniture: { getFormID: () => 0x3c1ac981 } });
    w.copies[0xff000daf] = 0xff000aaa; w.actor(0xff000aaa);
    new ExecutionService(null, w.controller);
    w.packet(PACKET);
    check('dboExecute: nothing is called in the packet handler (tick context)', w.idles.length === 0 && w.events.length === 0 && w.errors.length === 0, w.errors);
    await w.update();
    check('...the next update plays IdleExecutionerChop_Player on the headsman (the player), then on the victim\'s copy', JSON.stringify(w.idles) === JSON.stringify([[0x14, HELGEN], [0xff000aaa, HELGEN]]), w.idles);
    check('...the headsman is linked to the victim first (Helgen\'s AddDependentAnimatedObjectReference)', JSON.stringify(w.actors[0xff000aaa].linked) === JSON.stringify([0x14]));
    check('...the copy\'s idle event is allowed past animation.ts\'s filter, the player\'s needs nothing', JSON.stringify(w.allowed) === JSON.stringify([[0xff000aaa, HELGEN]]), w.allowed);
    check('...no error, and one exec line for the server log', w.errors.length === 0 && w.notes.length === 1 && /^exec play helgen linked=true victim=ff000aaa\/sit0\/nofurn idle headsman=14\/sit3\/3c1ac981 idle$/.test(w.notes[0]), [w.errors, w.notes]);
    await w.elapse();
    check('...10 s later the link is removed, on update', w.actors[0xff000aaa].linked.length === 0 && w.errors.length === 0);
  }
  // 2. The victim's own client, PlayIdle refused: the bare IdleExecutionerChop_Player event on both, headsman first
  {
    const w = world();
    w.myServerId = 0xff000daf;
    w.actor(0x14, { sit: 3, playIdleResult: false });
    w.copies[0xff00000d] = 0xff000bbb; w.actor(0xff000bbb, { playIdleResult: false });
    new ExecutionService(null, w.controller);
    w.packet(PACKET); await w.update();
    check('victim\'s client: Helgen idle on the headsman\'s copy then the player', JSON.stringify(w.idles) === JSON.stringify([[0xff000bbb, HELGEN], [0x14, HELGEN]]), w.idles);
    check('...refused PlayIdles fall back to the bare event on both, in the same order', JSON.stringify(w.events) === JSON.stringify([[0xff000bbb, HELGEN], [0x14, HELGEN]]), w.events);
    check('...the headsman\'s copy event is allowed (before PlayIdle and before the event)', w.allowed.filter((x) => x[0] === 0xff000bbb && x[1] === HELGEN).length === 2 && !w.allowed.some((x) => x[0] === 0x14), w.allowed);
    check('...the line says how each played', /^exec play helgen linked=true victim=14\/sit3\/nofurn event headsman=ff000bbb\/sit0\/nofurn event$/.test(w.notes[0] || ''), w.notes);
  }
  // 3. A watcher: both are copies, both allowed and played
  {
    const w = world();
    w.myServerId = 0xff000001;
    w.copies[0xff000daf] = 0xff000aaa; w.actor(0xff000aaa); w.copies[0xff00000d] = 0xff000bbb; w.actor(0xff000bbb);
    new ExecutionService(null, w.controller);
    w.packet(PACKET); await w.update();
    check('a watcher plays the Helgen idle on both copies, headsman first, each allowed', JSON.stringify(w.idles) === JSON.stringify([[0xff000bbb, HELGEN], [0xff000aaa, HELGEN]]) && JSON.stringify(w.allowed) === JSON.stringify([[0xff000bbb, HELGEN], [0xff000aaa, HELGEN]]), [w.idles, w.allowed]);
  }
  // 3b. playerIdle "" from the server, or f95be missing from the game: the NPC pair (IdleExecutioneeChop / IdleHeadChop)
  for (const [label, prep, packet] of [
    ['playerIdle "" from the server', () => {}, Object.assign({}, PACKET, { playerIdle: '' })],
    ['IdleExecutionerChop_Player missing from this game', (w) => { delete w.idleForms['f95be:Skyrim.esm']; }, PACKET],
  ]) {
    const w = world();
    prep(w);
    w.myServerId = 0xff00000d;
    w.actor(0x14, { sit: 3 });
    w.copies[0xff000daf] = 0xff000aaa; w.actor(0xff000aaa, { playIdleResult: false });
    new ExecutionService(null, w.controller);
    w.packet(packet); await w.update();
    w.idleForms['f95be:Skyrim.esm'] = HELGEN;
    check(`${label}: IdleExecutioneeChop on the victim (refused: its bare event), IdleHeadChop on the headsman`,
      JSON.stringify(w.idles) === JSON.stringify([[0xff000aaa, 'IdleExecutioneeChop'], [0x14, 'IdleHeadChop']]) && JSON.stringify(w.events) === JSON.stringify([[0xff000aaa, 'IdleExecutioneeChop']]) && /^exec play npc /.test(w.notes[0] || ''), [w.idles, w.events, w.notes]);
  }
  // 3c. The NPC path without victimIdle: vanilla's single call on the victim, the headsman untouched
  {
    const w = world();
    w.myServerId = 0xff000001;
    w.copies[0xff000daf] = 0xff000aaa; w.actor(0xff000aaa); w.copies[0xff00000d] = 0xff000bbb; w.actor(0xff000bbb);
    new ExecutionService(null, w.controller);
    w.packet(Object.assign({}, PACKET, { victimIdle: undefined, playerIdle: '' })); await w.update();
    check('NPC path, no victimIdle: IdleHeadChop on the victim only, its event allowed on the copy', JSON.stringify(w.idles) === JSON.stringify([[0xff000aaa, 'IdleHeadChop']]) && JSON.stringify(w.allowed) === JSON.stringify([[0xff000aaa, 'IdleExecutionerChop']]), [w.idles, w.allowed]);
  }
  // 3d. A server that names another player idle is followed
  {
    const w = world();
    w.myServerId = 0xff00000d;
    w.actor(0x14, { sit: 3 }); w.copies[0xff000daf] = 0xff000aaa; w.actor(0xff000aaa);
    new ExecutionService(null, w.controller);
    w.packet(Object.assign({}, PACKET, { playerIdle: '74ec5:Skyrim.esm', playerEvent: 'IdleExecutionerChop' })); await w.update();
    check('playerIdle/playerEvent from the server replace the defaults', JSON.stringify(w.idles) === JSON.stringify([[0x14, 'IdleHeadChop'], [0xff000aaa, 'IdleHeadChop']]) && JSON.stringify(w.allowed) === JSON.stringify([[0xff000aaa, 'IdleExecutionerChop']]), [w.idles, w.allowed]);
  }
  // 4. A watcher without a copy of the victim (out of range): nothing played, the reason logged
  {
    const w = world();
    w.myServerId = 0xff000001;
    new ExecutionService(null, w.controller);
    w.packet(PACKET); await w.update();
    check('a missing actor plays nothing and says so', w.idles.length === 0 && /^exec play skipped victim=false headsman=false idle=true$/.test(w.notes[0] || ''), w.notes);
  }
  // 5. Standing up: Dismount works
  const STAND = { customPacketType: 'dboExecuteStand', pos: [53875, 202664, 8549], rot: [0, 0, 2.26] };
  {
    const w = world();
    w.actor(0x14, { sit: 3, furniture: { getFormID: () => 0x3c1ac981 }, dismountFrees: true });
    new ExecutionService(null, w.controller);
    w.packet(STAND);
    check('dboExecuteStand: nothing in the packet handler', w.notes.length === 0 && w.errors.length === 0);
    await w.update();
    check('...Dismount first, on update', /^exec stand dismount=true sit=0 furn=3c1ac981$/.test(w.notes[0] || ''), w.notes);
    await w.elapse();
    check('...out of the furniture: it stops there (no exit event, no move)', w.events.length === 0 && w.moves.length === 0 && /stand dismount worked/.test(w.notes[1] || ''), [w.events, w.notes]);
  }
  // 6. Dismount does nothing, the furniture exit event works
  {
    const w = world();
    const p = w.actor(0x14, { sit: 3, furniture: { getFormID: () => 0x3c1ac981 } });
    w.onEvent = (ref, ev) => { if (ref === p && ev === 'IdleChairExitStart') { p.furniture = null; p.sit = 0; } };
    new ExecutionService(null, w.controller);
    w.packet(STAND); await w.update(); await w.elapse();
    check('Dismount refused: IdleChairExitStart 1.5 s later', JSON.stringify(w.events) === JSON.stringify([[0x14, 'IdleChairExitStart']]) && w.waits[0] && w.waits[0].s === 1.5, w.events);
    await w.elapse();
    check('...it worked: no IdleForceDefaultState, no move', w.events.length === 1 && w.moves.length === 0 && /stand exitEvent worked/.test(w.notes[w.notes.length - 1]), w.notes);
  }
  // 7. Nothing takes: IdleForceDefaultState, then the move to the server's spot
  {
    const w = world();
    w.actor(0x14, { sit: 3, furniture: { getFormID: () => 0x3c1ac981 } });
    new ExecutionService(null, w.controller);
    w.packet(STAND); await w.update(); await w.elapse(); await w.elapse();
    check('all refused: IdleForceDefaultState after the exit event', JSON.stringify(w.events.map((e) => e[1])) === JSON.stringify(['IdleChairExitStart', 'IdleForceDefaultState']), w.events);
    await w.elapse();
    check('...then the player is moved to the server\'s spot with its rotation', JSON.stringify(w.moves) === JSON.stringify([[0x14, 53875, 202664, 8549, 2.26]]), w.moves);
    check('...each step logged, no error', w.errors.length === 0 && w.notes.some((n) => /stand forceDefault moved furn=still sit=3/.test(n)), w.notes);
  }
  // 8. Not seated at all: nothing is done
  {
    const w = world();
    w.actor(0x14, { sit: 0, furniture: null });
    new ExecutionService(null, w.controller);
    w.packet(STAND); await w.update();
    check('a player not in furniture is left alone', w.events.length === 0 && w.moves.length === 0 && w.waits.length === 0 && /not in furniture/.test(w.notes[0] || ''), w.notes);
  }
  // 9. A second stand packet takes over the first chain
  {
    const w = world();
    w.actor(0x14, { sit: 3, furniture: { getFormID: () => 0x3c1ac981 } });
    new ExecutionService(null, w.controller);
    w.packet(STAND); await w.update();
    w.packet(STAND); await w.update();
    await w.elapse();
    check('a newer dboExecuteStand supersedes the older chain (one exit event, not two)', w.events.filter((e) => e[1] === 'IdleChairExitStart').length === 1, w.events);
  }
  check('nextStandStep: dismount -> exitEvent -> forceDefault -> done, done once out', nextStandStep('dismount', true) === 'exitEvent' && nextStandStep('exitEvent', true) === 'forceDefault' && nextStandStep('forceDefault', true) === 'done' && nextStandStep('dismount', false) === 'done');

  const svc = fs.readFileSync(path.resolve(__dirname, '../src/services/services/executionService.ts'), 'utf8');
  check('defaults: f95be:Skyrim.esm (IdleExecutionerChop_Player, Skyrim.esm IDLE f95be, no parent or conditions) and its ENAM',
    /const PLAYER_VICTIM_IDLE = "f95be:Skyrim\.esm";/.test(svc) && /const PLAYER_VICTIM_EVENT = "IdleExecutionerChop_Player";/.test(svc));
  const idx = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8');
  check('index.ts registers ExecutionService', /new ExecutionService\(sp, controller\)/.test(idx) && /import \{ ExecutionService \}/.test(idx));
  const anim = fs.readFileSync(path.join(__dirname, '..', 'src', 'sync', 'animation.ts'), 'utf8');
  check('animation.ts allowIdleEvent feeds the same allowedIdles the copy filter reads, for 0xff copies and idle events only',
    /export const allowIdleEvent = \(refrId: number, animEventName: string\): void => \{\s*if \(refrId >= 0xff000000 && isIdle\(animEventName\)\) allowedIdles\.push\(\[refrId, animEventName\]\);/.test(anim));
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.log('FAIL', e.stack); process.exit(1); });
