// Scripted test for the player log's gold and bank record (13 Oct, gold review: the forum's account totals were wrong while
// the game read every value right). One case per fix, each failing on the code before it:
//   G1 a session the load picks up gets its gold and bank then, marked resync, and its account snapshot, one a fast tick
//   G2 the account snapshot carries each character's gold and bank, and how many characters the profile has
//   G3 carried gold and bank changed in a session (a trade, contract pay, a wage) reach the record as item.gold, debounced
//   G4 two takes of gold in one itemguards batch count what each moved (3 + 1 is 4, not 5)
//   G5 an item.move record keeps its own count after a later move of the same item
//   G6 a picked-up session's logout has its gold0 and says resync
//   G7 a server stop's logout carries the last gold and bank read, marked cached, with no native get at exit
//   G11 a profile with more than 12 characters lists them all (up to 24)
//   node tests/playerlog-gold-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('./lib/playerlog-fakes.js');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'playerlog.js');
let failures = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 500) : ''}`); if (!c) failures++; };
const rejections = [];
process.on('unhandledRejection', (e) => rejections.push(e));

const reset = () => { for (const k of ['__dboPlayerLog', '__dboPlogHook', '__dboPlogUninstall', '__dboFlushOnExit', '__alduinakTradeLog', '__dboSoulCaptured', '__dboPlogRoute', '__dboHitRefusal']) delete globalThis[k]; };
// Verrik (profile 1, online at the load, 986 gold, 2400 in the bank); Caius (profile 2, online at the load) with his alt Old
// Grimbo (offline, 12,012 in the bank); Fires (profile 3, logs in later) with her alt Selena (20 gold, 524 in the bank)
const VERRIK = 0xff000014, CAIUS = 0xff000015, GRIMBO = 0xff000016, FIRES = 0xff000017, SELENA = 0xff000018, CHEST = 0x806ca1f, CHESTBASE = 0x20000;
const world = (cfgOver) => {
  const M = F.makeMp(), FS = F.makeFs(), TM = F.makeTimers(), QU = F.makeQueue(), CL = F.makeClock();
  QU.install();
  M.player(VERRIK, { profile: 1, name: 'Verrik', tag: 'YQUZ', discord: '11', user: 3, inv: [{ baseId: 0xf, count: 986 }] });
  M.player(CAIUS, { profile: 2, name: 'Caius Ves', tag: 'K3SA', discord: '22', user: 4, inv: [{ baseId: 0xf, count: 203 }], pos: [500, 0, 0] });
  M.player(GRIMBO, { profile: 2, name: 'Old Grimbo', tag: 'SB5X', discord: '22', inv: [] });
  M.player(FIRES, { profile: 3, name: 'Fires Of Souls', tag: '46NY', discord: '33', user: 5, inv: [{ baseId: 0xf, count: 425 }], pos: [900, 0, 0] });
  M.player(SELENA, { profile: 3, name: 'Selena', tag: 'PXVM', discord: '33', inv: [{ baseId: 0xf, count: 20 }] });
  M.mp.set(VERRIK, 'private.bankGold', 2400); M.mp.set(CAIUS, 'private.bankGold', 0); M.mp.set(GRIMBO, 'private.bankGold', 12012);
  M.mp.set(FIRES, 'private.bankGold', 0); M.mp.set(SELENA, 'private.bankGold', 524);
  M.record(CHESTBASE, 'CONT', 'Barrel'); M.ref(CHEST, CHESTBASE); M.mp.set(CHEST, 'inventory', { entries: [] });
  const online = [VERRIK, CAIUS];
  const api = { mp: M.mp, log: () => {}, cfg: { playerLog: Object.assign({ dir: '/fake/events', stopFile: '/fake/STOP', flushMs: 1000 }, cfgOver || {}) },
    every: TM.every, stopTimer: TM.stopTimer, onlineActors: () => online.slice(), actorOf: (u) => M.mp.getUserActor(u), fs: FS.fs, clock: CL,
    discordOf: (a) => String(M.mp.get(a, 'private.skympDiscordId') || ''), recordOf: (id) => M.mp.lookupEspmRecordById(id), adminItemName: () => '',
    commandsHas: () => true, WORLD_GROUPS: [], lastPacketAt: new Map(), isWorldspace: () => true, zoneList: () => [] };
  const load = () => { delete require.cache[MODULE]; return require(MODULE)(api); };
  const K = load();
  const evs = (type) => K.S.q.filter((r) => r.ev === type);
  const last = (type) => { const l = evs(type); return l[l.length - 1]; };
  const h = (...a) => globalThis.__dboPlogHook(...a);
  const gold = (a, n) => { const e = M.mp.get(a, 'inventory').entries.filter((x) => x.baseId !== 0xf); if (n) e.push({ baseId: 0xf, count: n }); M.mp.set(a, 'inventory', { entries: e }); };
  return { M, FS, TM, QU, CL, K, api, online, load, evs, last, h, gold, tick: (n, k) => TM.run(n, k) };
};
const qsize = (W) => (W.K.S.snapQ instanceof Map ? W.K.S.snapQ.size : -1);
const byTag = (snap, tag) => (snap && snap.f && snap.f.chars ? snap.f.chars.find((c) => c.c === tag) : undefined);

(async () => {
  // ============================================================================================================== G1, G6
  reset();
  let W = world();
  W.QU.run(); await F.settle();
  const sv = W.K.S.sessions.get(VERRIK), sc = W.K.S.sessions.get(CAIUS);
  ok(sv && sv.gold0 === 986 && sv.bank0 === 2400 && sv.resync === true, 'G1: a session the load picks up has its gold and bank read then, marked resync', sv);
  ok(sc && sc.gold0 === 203 && sc.bank0 === 0, '...for every player online at the load', sc);
  ok(W.evs('account.snapshot').length === 0, '...no account snapshot in the load itself (capture is off while it runs)', W.evs('account.snapshot').length);
  W.tick('playerlogFast');
  const n1 = W.evs('account.snapshot').length;
  W.tick('playerlogFast');
  const n2 = W.evs('account.snapshot').length;
  W.tick('playerlogFast');
  ok(n1 === 1 && n2 === 2 && W.evs('account.snapshot').length === 2, 'G1: one account snapshot a fast tick, one per player picked up', [n1, n2, W.evs('account.snapshot').length]);
  const caiusSnap = W.evs('account.snapshot').find((r) => r.c === 'K3SA');
  ok(caiusSnap && caiusSnap.src === 'resync:load', '...labelled resync:load, not hook:login', caiusSnap && caiusSnap.src);
  ok(byTag(caiusSnap, 'SB5X') && byTag(caiusSnap, 'SB5X').bank === 12012 && byTag(caiusSnap, 'K3SA').gold === 203, 'G1+G2: a go-live player\'s alt reaches the record with its bank (Old Grimbo 12,012)', caiusSnap && caiusSnap.f);
  // G6: the picked-up session's logout
  W.h('logout', 3, VERRIK); W.QU.run();
  const lo = W.last('session.logout');
  ok(lo && lo.f.gold0 === 986 && lo.f.gold1 === 986 && lo.f.bank0 === 2400 && lo.f.resync === true, 'G6: a picked-up session\'s logout has gold0 and bank0 and says resync', lo && lo.f);

  // a hot reload over sessions an older generation picked up (gold0 unset, no account snapshot with gold): read and queued
  reset();
  W = world();
  W.QU.run(); await F.settle();
  for (const s of W.K.S.sessions.values()) { s.gold0 = undefined; s.bank0 = undefined; delete s.resync; delete s.acct; delete s.g; delete s.b; }
  if (W.K.S.snapQ) W.K.S.snapQ.clear();
  W.load(); W.QU.run(); await F.settle();
  ok(W.K.S.sessions.get(VERRIK).gold0 === 986 && qsize(W) === 2, 'G1: a reload over an older generation\'s pickups reads their gold and queues their snapshots', [W.K.S.sessions.get(VERRIK).gold0, qsize(W)]);
  W.tick('playerlogFast', 3);
  ok(W.evs('account.snapshot').length === 2 && qsize(W) === 0, '...and writes them, one a tick', W.evs('account.snapshot').length);
  // a second reload queues nothing more (each session now has its snapshot)
  W.load(); W.QU.run(); await F.settle();
  ok(qsize(W) === 0, '...a later reload queues nothing more', qsize(W));

  // ============================================================================================================== G2
  W.online.push(FIRES);
  W.h('login', 5, FIRES); W.QU.run();
  const fs1 = W.last('account.snapshot');
  ok(fs1 && fs1.src === 'hook:login' && byTag(fs1, 'PXVM') && byTag(fs1, 'PXVM').gold === 20 && byTag(fs1, 'PXVM').bank === 524 && byTag(fs1, '46NY').gold === 425 && fs1.f.total === 2,
    'G2: a login\'s account snapshot carries each character\'s gold and bank, and the profile\'s character count', fs1 && fs1.f);
  ok(W.last('session.login').f.gold === 425 && !W.last('session.login').f.resync, '...the login itself as before', W.last('session.login').f);

  // ============================================================================================================== G3
  const g0 = W.evs('item.gold').length;
  W.CL.t += 60000;
  W.tick('playerlogSlow', 12);
  ok(W.evs('item.gold').length === g0, 'G3: nothing changed, no item.gold', W.evs('item.gold').length - g0);
  // a trade gives Fires 375 gold (no hook of the player log sees the count in her pack)
  W.gold(FIRES, 800);
  W.tick('playerlogSlow', 12);
  const ig = W.evs('item.gold').filter((r) => r.c === '46NY');
  ok(ig.length === 1 && ig[0].f.gold === 800 && ig[0].f.bank === 0 && ig[0].src === 'poll:gold', 'G3: carried gold changed in a session: item.gold with the new count', ig.map((r) => r.f));
  // contract pay into the bank a moment later: debounced, then written once the minute has passed
  W.M.mp.set(FIRES, 'private.bankGold', 120);
  W.CL.t += 5000;
  W.tick('playerlogSlow', 12);
  ok(W.evs('item.gold').filter((r) => r.c === '46NY').length === 1, 'G3: at most one item.gold per character per goldPoll.minMs', W.evs('item.gold').filter((r) => r.c === '46NY').length);
  W.CL.t += 30000;
  W.tick('playerlogSlow', 12);
  const ig2 = W.evs('item.gold').filter((r) => r.c === '46NY');
  ok(ig2.length === 2 && ig2[1].f.gold === 800 && ig2[1].f.bank === 120, '...and the bank change after it', ig2.map((r) => r.f));
  W.tick('playerlogSlow', 24);
  ok(W.evs('item.gold').filter((r) => r.c === '46NY').length === 2, '...and nothing more while nothing changes');
  const gGets = W.M.S.gets; W.tick('playerlogSlow'); const perTick = W.M.S.gets - gGets;
  ok(perTick <= 12, 'G3: the poll\'s cost stays a few gets a slow tick (a twelfth of the players)', perTick);

  // ============================================================================================================== G4, G5
  // Verrik takes 3 gold, then 1 more, in one itemguards batch: the first move's after already holds the second take
  W.online.splice(0, W.online.length, VERRIK, CAIUS, FIRES);
  W.h('login', 3, VERRIK); W.QU.run();
  W.gold(VERRIK, 927);
  W.h('move', 'take', VERRIK, CHEST, 0xf, 3, [927, 4], [931, 0], null, null);
  W.h('move', 'take', VERRIK, CHEST, 0xf, 1, [930, 1], [931, 0], null, null);
  const mv = W.evs('item.move').filter((r) => r.c === 'YQUZ');
  W.K.G.taps.closeContainer(VERRIK, 'close');
  const ct = W.last('item.container');
  const took = ct && ct.f.took ? ct.f.took.find((x) => x.i === 'f' || x.b === 'f:Skyrim.esm') : null;
  ok(took && took.k === 4, 'G4: two takes in one batch: the container line says 4 gold (3 + 1), not 5', ct && ct.f.took);
  ok(mv.length === 2 && mv[0].f.item.k === 3 && mv[1].f.item.k === 1, 'G5: each item.move keeps its own count after a later move of the same item', mv.map((r) => r.f.item.k));
  ok(W.K.S.sessions.get(VERRIK).g === 931, '...and the session keeps the pack count the seam read (no get)', W.K.S.sessions.get(VERRIK).g);

  // ============================================================================================================== G7
  reset();
  const tmpRoot = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'plog-gold-'));
  W = world({ dir: path.join(tmpRoot, 'events') });
  globalThis.__dboFlushOnExit = () => {};
  W.load(); W.QU.run(); await F.settle();
  W.h('login', 3, VERRIK); W.h('login', 4, CAIUS); W.QU.run();
  W.tick('playerlogLocation');
  W.gold(VERRIK, 1000); W.CL.t += 60000; W.tick('playerlogSlow', 12);
  W.CL.t += 600000;
  const getsExit = W.M.S.gets;
  globalThis.__dboFlushOnExit();
  const exitFile = path.join(tmpRoot, 'events', `${new Date(W.CL.t).toISOString().slice(0, 10)}.jsonl`);
  const ex = fs.existsSync(exitFile) ? fs.readFileSync(exitFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const stop = ex.filter((r) => r.ev === 'session.logout' && r.f.reason === 'server_stop');
  const sv7 = stop.find((r) => r.c === 'YQUZ');
  ok(sv7 && sv7.f.gold1 === 1000 && sv7.f.bank1 === 2400 && sv7.f.cached === true && sv7.f.gold0 === 986, 'G7: a server stop\'s logout has the last gold and bank read, marked cached', sv7 && sv7.f);
  ok(stop.length === 2 && W.M.S.gets === getsExit, '...for each open session, with no native get at exit (review C-R6)', [stop.length, W.M.S.gets - getsExit]);
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  // ============================================================================================================== G11
  reset();
  W = world();
  W.QU.run(); await F.settle();
  for (let i = 0; i < 13; i++) W.M.player(0xff000100 + i, { profile: 1, name: `Alt ${i}`, tag: `A${String(i).padStart(3, '0')}`, discord: '11', inv: [{ baseId: 0xf, count: i }] });
  W.h('login', 3, VERRIK); W.QU.run();
  const big = W.last('account.snapshot');
  const v = (() => { const R = require(path.join(ROOT, 'playerlog-rules.js')); return R.validate(JSON.parse(JSON.stringify(big)), null, null); })();
  ok(big && big.f.total === 14 && v && v.f.chars.length === 14 && v.f.chars.every((c) => Number.isInteger(c.gold)), 'G11: a profile with 14 characters lists all 14 through the schema, with total', [big && big.f.total, v && v.f.chars.length]);

  ok(rejections.length === 0, 'no unhandled rejection', rejections.map((e) => String(e)));
  reset();
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL harness error', e && e.stack); process.exit(1); });
