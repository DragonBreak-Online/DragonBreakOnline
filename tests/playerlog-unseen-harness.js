// The player log drops a character the world no longer counts online (playerlog-taps.js reconcileOnline, bugsweep 17 Oct).
// A character deleted at the character select while it stood in the world sends no logout, and the 2 s poll then read its
// health and restraint on every tick: 16,000 engine exceptions in 16 h (ff0012c5 16 Oct 21:08, ff000a80 and ff001992
// after midnight). Missing from onlineActors for 30 s, the id is forgotten; a shorter gap keeps it.
//   node tests/playerlog-unseen-harness.js   (from server/)
'use strict';
const path = require('path');
const F = require('./lib/playerlog-fakes.js');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'playerlog.js');
let failures = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 500) : ''}`); if (!c) failures++; };
const reset = () => { for (const k of ['__dboPlayerLog', '__dboPlogHook', '__dboPlogUninstall', '__dboFlushOnExit', '__alduinakTradeLog', '__dboSoulCaptured', '__dboPlogRoute', '__dboHitRefusal']) delete globalThis[k]; };

const A = 0xff000014, B = 0xff000015;
(async () => {
  reset();
  const M = F.makeMp(), FS = F.makeFs(), TM = F.makeTimers(), QU = F.makeQueue(), CL = F.makeClock();
  QU.install();
  M.player(A, { user: 3 });
  M.player(B, { profile: 2, name: 'Selene', tag: 'K2QX', discord: '22', user: 4, pos: [500, 0, 0] });
  let inWorld = [A, B];
  const logs = [];
  const api = { mp: M.mp, log: (...a) => logs.push(a.join(' ')), cfg: { playerLog: { dir: '/fake/events', stopFile: '/fake/STOP', flushMs: 1000 } },
    every: TM.every, stopTimer: TM.stopTimer, onlineActors: () => inWorld, actorOf: (u) => M.mp.getUserActor(u), fs: FS.fs, clock: CL,
    discordOf: () => '', recordOf: (id) => M.mp.lookupEspmRecordById(id), adminItemName: () => '', commandsHas: () => false, WORLD_GROUPS: [], lastPacketAt: new Map(),
    isWorldspace: () => true, zoneAtPlace: () => 'bruma', zoneOfCell: () => null, normPlace: (w) => String(w).toLowerCase(), REGION_PLUGINS: {}, isAdmin: () => false, staffTierOf: () => null, zoneList: () => [] };
  const K = (() => { delete require.cache[MODULE]; return require(MODULE)(api); })();
  QU.run();
  ok(K.S.online.has(A) && K.S.online.has(B), 'both characters are online after the load');
  // B's character is deleted at the character select: no logout hook, gone from the world
  inWorld = [A];
  TM.run('playerlogSlow'); CL.t += 10000; TM.run('playerlogSlow');
  ok(K.S.online.has(B), 'a gap under 30 s keeps it (a login still settling)');
  inWorld = [A, B]; CL.t += 5000; TM.run('playerlogSlow');
  inWorld = [A]; CL.t += 5000; TM.run('playerlogSlow'); CL.t += 25000; TM.run('playerlogSlow');
  ok(K.S.online.has(B), 'seen again in between: the 30 s start over');
  const logouts = K.S.q.filter((r) => r.ev === 'session.logout').length;
  CL.t += 6000; TM.run('playerlogSlow');
  ok(!K.S.online.has(B) && K.S.online.has(A), 'missing for 30 s: dropped, the other player kept');
  ok(K.S.q.filter((r) => r.ev === 'session.logout').length === logouts, 'no logout line is written for it (none was seen)');
  ok(logs.some((l) => /playerlog: dropped ff000015/.test(l)), 'a log line names it', logs.filter((l) => /dropped/.test(l)));
  // The fast poll no longer reads it
  const reads = [];
  const get0 = M.mp.get; M.mp.get = (id, k) => { reads.push([id >>> 0, k]); return get0(id, k); };
  TM.run('playerlogFast');
  M.mp.get = get0;
  ok(!reads.some(([id]) => id === B) && reads.some(([id]) => id === A), 'the 2 s poll reads only the character still in the world', reads.filter(([id]) => id === B));
  // Nobody online: nothing to do, nothing thrown
  inWorld = []; K.S.online.clear(); CL.t += 60000;
  let threw = null; try { TM.run('playerlogSlow'); } catch (e) { threw = e; }
  ok(!threw, 'an empty world is a no-op', threw && threw.message);
  reset();
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL harness error', e && e.stack); process.exit(1); });
