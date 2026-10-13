// Scripted test for the player log's core (playerlog.js, DESIGN.md 3 and 8.1): the writer (one write in flight, short
// writes finished, a cut line never glued to the next, a full disk counted), the fs queue (two calls at most in flight, the
// periodic checks skipped while one hangs), the time-boxed flush, errors that never escape and the breaker, every map
// capped, the queue caps, day files and the roll, validation, the switches (enabled false, the STOP file), the SIGTERM
// chain, and hot reload hygiene (three loads on one globalThis, modules that failed to reload, a playerlog.js that throws
// through gamemode.js's own load block). Everything runs on fakes: no disk, no real timer, no Discord.
//   node tests/playerlog-core-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('./lib/playerlog-fakes.js');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'playerlog.js');
const RULES = path.join(ROOT, 'playerlog-rules.js');
let failures = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) failures++; };
const rejections = [];
process.on('unhandledRejection', (e) => rejections.push(e));
process.on('uncaughtException', (e) => { rejections.push(e); console.log('FAIL uncaught', e && e.stack); failures++; });

const reset = () => { for (const k of ['__dboPlayerLog', '__dboPlogHook', '__dboPlogUninstall', '__dboFlushOnExit', '__alduinakTradeLog', '__dboSoulCaptured', '__dboPlogRoute', '__dboHitRefusal']) delete globalThis[k]; };
// One world: two players online, a sword record, the fakes
const world = (cfgOver) => {
  const M = F.makeMp(), FS = F.makeFs(), TM = F.makeTimers(), QU = F.makeQueue(), CL = F.makeClock();
  QU.install();
  const P1 = M.player(0xff000014, { user: 3, inv: [{ baseId: 0xf, count: 100 }] });
  const P2 = M.player(0xff000015, { profile: 2, name: 'Selene', tag: 'K2QX', discord: '', user: 4, pos: [500, 0, 0] });
  M.record(0x12eb7, 'WEAP', 'IronSword');
  const logs = [];
  const api = { mp: M.mp, log: (...a) => logs.push(a.join(' ')), cfg: { playerLog: Object.assign({ dir: '/fake/events', stopFile: '/fake/STOP', flushMs: 1000 }, cfgOver || {}) },
    every: TM.every, stopTimer: TM.stopTimer, onlineActors: () => [P1, P2], actorOf: (u) => M.mp.getUserActor(u), fs: FS.fs, clock: CL,
    discordOf: (a) => String(M.mp.get(a, 'private.skympDiscordId') || ''), recordOf: (id) => M.mp.lookupEspmRecordById(id), adminItemName: () => '',
    commandsHas: () => true, WORLD_GROUPS: [], lastPacketAt: new Map(), isWorldspace: () => true };
  const load = () => { delete require.cache[MODULE]; return require(MODULE)(api); };
  return { M, FS, TM, QU, CL, P1, P2, logs, api, load };
};
const flushN = async (W, n) => { for (let i = 0; i < (n || 1); i++) { W.TM.run('playerlogFlush'); await F.settle(4); W.QU.run(); } };
const allLines = (W) => { const out = []; for (const f of [...W.FS.files.keys()].sort()) if (f.endsWith('.jsonl')) out.push(...W.FS.lines(f)); return out; };
const parsed = (W) => allLines(W).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } });

(async () => {
  // ---- the writer: nothing until a flush, one append per flush ------------------------------------------------------------
  reset();
  let W = world();
  let K = W.load();
  W.QU.run(); await F.settle();
  const h = () => globalThis.__dboPlogHook;
  ok(typeof h() === 'function', 'the dispatcher is installed');
  for (let i = 0; i < 10; i++) K.emit('item.trade', W.P1, { gave: [{ i: 'Iron Sword', k: 1 }] }, { o: [K.partyOf(W.P2, 'other')] });
  ok(W.FS.ctl.writes === 0, 'emit writes nothing by itself', W.FS.ctl.writes);
  await flushN(W, 4);
  const lines0 = parsed(W);
  ok(lines0.length === 11 && lines0.every(Boolean), 'one flush writes the queue: sys.start and 10 trades, each line JSON', lines0.length);
  ok(W.FS.ctl.writes === 1, 'one append for the whole batch', W.FS.ctl.writes);
  const gs = new Set(lines0.map((r) => `${r.g}|${r.s}`));
  ok(gs.size === lines0.length, 'every line has its own (g, s)');
  ok(lines0[1].f.gave[0].i === 'Iron Sword' && lines0[1].o[0].n === 'Selene', 'a trade names the other party', lines0[1]);
  // the process's first load says so (the forwarder ends the sessions a crash left open), a reload does not (review C-R6)
  ok(lines0[0].ev === 'sys.start' && lines0[0].f.fresh === true, 'the first load\'s sys.start is fresh', lines0[0]);
  W.load(); W.QU.run(); await F.settle();
  ok(K.S.q.some((r) => r.ev === 'sys.start' && r.f.why === 'load' && r.f.fresh === undefined), '...a hot reload\'s is not', K.S.q.filter((r) => r.ev === 'sys.start').map((r) => r.f));
  ok(/^\/fake\/events\/2026-10-13\.jsonl$/.test([...W.FS.files.keys()].find((f) => f.endsWith('.jsonl'))), 'the day file is <dir>/YYYY-MM-DD.jsonl', [...W.FS.files.keys()]);

  // ---- a stalled write: one in flight, the buffer grows, one log line a minute, nothing else starts -----------------------
  W.FS.ctl.stall.add('write');
  K.emit('item.trade', W.P1, {});
  await flushN(W, 2);
  const writesAtStall = W.FS.ctl.writes;
  let callsAt6 = 0;
  for (let s = 0; s < 120; s++) { W.CL.t += 1000; K.emit('item.trade', W.P1, {}); await flushN(W, 1); if (s === 6) callsAt6 = W.FS.ctl.calls.length; if (s % 10 === 0) { W.TM.run('playerlogStop'); W.TM.run('playerlogDisk'); await F.settle(); } }
  ok(W.FS.ctl.writes === writesAtStall, 'a stalled write is the only write: no second one starts in 120 s', [writesAtStall, W.FS.ctl.writes]);
  ok(K.S.q.length >= 100, 'the buffer grows meanwhile', K.S.q.length);
  const stallLogs = W.logs.filter((l) => /a write has been pending/.test(l));
  ok(stallLogs.length >= 1 && stallLogs.length <= 2, 'one log line a minute about it', stallLogs.length);
  ok(W.FS.ctl.maxPending <= 2, 'never more than 2 fs calls in flight', W.FS.ctl.maxPending);
  ok(!W.FS.ctl.calls.slice(callsAt6).some((k) => k === 'access' || k === 'statfs'), 'the STOP and disk checks are skipped once a call has hung 5 s', W.FS.ctl.calls.slice(callsAt6));

  // ---- the thread-pool bound: every fs call hangs for 10 simulated minutes --------------------------------------------------
  reset();
  W = world();
  for (const k of ['mkdir', 'open', 'write', 'access', 'statfs', 'close', 'stat']) W.FS.ctl.stall.add(k);
  K = W.load(); W.QU.run(); await F.settle();
  for (let s = 0; s < 600; s++) { W.CL.t += 1000; K.emit('item.trade', W.P1, {}); W.TM.run('playerlogFlush'); if (s % 30 === 0) W.TM.run('playerlogStop'); if (s % 60 === 0) { W.TM.run('playerlogDisk'); W.TM.run('playerlogMinute'); } await F.settle(1); }
  ok(W.FS.ctl.pending <= 2, 'after 10 minutes of a hung disk: at most 2 player log fs calls pending', W.FS.ctl.pending);
  ok(W.FS.ctl.calls.filter((k) => k === 'access').length <= 1 && W.FS.ctl.calls.filter((k) => k === 'statfs').length <= 1, 'the STOP and statfs checks were skipped, not stacked', W.FS.ctl.calls);

  // ---- short writes and a cut line ---------------------------------------------------------------------------------------------
  reset();
  W = world();
  K = W.load(); W.QU.run(); await F.settle();
  W.FS.ctl.shortBytes = 97;
  for (let i = 0; i < 20; i++) K.emit('item.trade', W.P1, { gave: [{ i: `Thing ${i}`, k: i + 1 }] });
  await flushN(W, 4);
  let recs = parsed(W);
  ok(recs.length === 21 && recs.every(Boolean), 'short writes: the loop finishes the buffer, every line whole', recs.length);
  W.FS.ctl.shortBytes = 0;
  const file = [...W.FS.files.keys()].find((f) => f.endsWith('.jsonl'));
  W.FS.ctl.failAt = W.FS.files.get(file).length + 700;
  for (let i = 0; i < 20; i++) K.emit('item.trade', W.P1, { gave: [{ i: `Cut ${i}`, k: i + 1 }] });
  await flushN(W, 1);
  ok(K.S.needNewline === true && K.S.q.length > 0, 'an error part-way through a line: the rest is queued again and the next write starts on a new line', [K.S.needNewline, K.S.q.length]);
  await flushN(W, 4);
  recs = parsed(W);
  const bad = recs.filter((r) => r === null).length;
  const cuts = recs.filter(Boolean).filter((r) => r.f && r.f.gave && /^Cut /.test(r.f.gave[0].i)).map((r) => r.f.gave[0].i);
  ok(bad === 1, 'exactly one invalid fragment line', bad);
  ok(cuts.length === 20 && new Set(cuts).size === 20, 'no event lost or written twice whole', cuts.length);
  ok(allLines(W).every((l) => l.split('{"v":').length <= 2), 'no JSON line glued to the next');

  // ---- ENOSPC: counting mode, then back -------------------------------------------------------------------------------------
  W.FS.ctl.failAt = W.FS.files.get(file).length + 10; W.FS.ctl.failCode = 'ENOSPC';
  for (let i = 0; i < 5; i++) K.emit('item.trade', W.P1, {});
  await flushN(W, 3);
  ok(K.S.enospc === true, 'ENOSPC: counting mode');
  const writesFull = W.FS.ctl.writes;
  for (let i = 0; i < 5; i++) K.emit('item.trade', W.P1, {});
  await flushN(W, 3);
  ok(W.FS.ctl.writes === writesFull, '...no more writes', [writesFull, W.FS.ctl.writes]);
  ok(K.S.dropCounts.get('enospc|item.trade') >= 5, '...each event counted as dropped (enospc)', [...K.S.dropCounts]);
  W.TM.run('playerlogDisk'); await F.settle();
  ok(K.S.enospc === false, '...and writing again once statfs shows space');
  K.emit('item.trade', W.P1, {}); await flushN(W, 3);
  ok(parsed(W).some((r) => r && r.ev === 'sys.dropped' && r.f.reason === 'enospc' && r.f.counts['item.trade'] >= 5), 'a sys.dropped record names what was lost', parsed(W).filter((r) => r && r.ev === 'sys.dropped'));

  // ---- the time box: a 20,000-event backlog at the measured 15.6 µs per event -------------------------------------------------
  reset();
  W = world();
  K = W.load(); W.QU.run(); await F.settle();
  for (let i = 0; i < 19990; i++) K.emit('item.trade', W.P1, { gave: [{ i: 'Iron Sword', k: 1 }] });
  W.CL.perUs = 15.6;
  let maxMs = 0, ticks = 0;
  while (K.S.q.length && ticks < 400) { const p0 = W.CL.p; W.TM.run('playerlogFlush'); const ms = W.CL.p - p0; if (ms > maxMs) maxMs = ms; ticks++; await F.settle(3); W.QU.run(); }
  W.CL.perUs = 0;
  ok(K.S.q.length === 0, 'the backlog drains', [K.S.q.length, ticks]);
  ok(maxMs <= 5, 'no flush tick over 5 ms (budget 4 ms)', maxMs.toFixed(2));
  ok(ticks >= 70, 'it takes many ticks, not one 300 ms one', ticks);

  // ---- caps: 30k P2 events, P0 kept, counted --------------------------------------------------------------------------------
  reset();
  W = world();
  K = W.load(); W.QU.run(); await F.settle();
  for (let i = 0; i < 30000; i++) K.emit('item.equip', W.P1, { on: [{ i: 'Iron Helmet', k: 1 }] });
  ok(K.S.q.length <= 10000, 'P2 stops at the soft cap', K.S.q.length);
  ok(K.emit('item.trade', W.P1, {}) === true, 'a P0 event still gets in');
  ok(K.S.dropCounts.get('cap|item.equip') === 30000 - (K.S.q.length - 2), 'each dropped P2 event is counted', K.S.dropCounts.get('cap|item.equip'));
  for (let i = 0; i < 10; i++) await flushN(W, 60);
  ok(parsed(W).some((r) => r && r.ev === 'sys.dropped' && r.f.reason === 'cap' && r.f.counts['item.equip'] > 19000), 'sys.dropped after the next successful flush');

  // ---- day files and the roll -------------------------------------------------------------------------------------------------
  reset();
  W = world({ rollBytes: 3000 });
  W.CL.t = Date.UTC(2026, 9, 13, 23, 59, 58);
  K = W.load(); W.QU.run(); await F.settle();
  for (let i = 0; i < 3; i++) K.emit('item.trade', W.P1, {});
  await flushN(W, 4);
  W.CL.t = Date.UTC(2026, 9, 14, 0, 0, 1);
  for (let i = 0; i < 3; i++) K.emit('item.trade', W.P1, {});
  await flushN(W, 8);
  const names = [...W.FS.files.keys()].map((f) => path.basename(f)).sort();
  ok(names.includes('2026-10-13.jsonl') && names.includes('2026-10-14.jsonl'), 'a day change splits by the event time', names);
  ok(W.FS.lines('/fake/events/2026-10-14.jsonl').map((l) => JSON.parse(l)).every((r) => r.t >= Date.UTC(2026, 9, 14)), '...the new day file holds the new day only');
  for (let i = 0; i < 40; i++) K.emit('item.trade', W.P1, { gave: [{ i: 'Iron Sword', k: i }] });
  await flushN(W, 20);
  for (let i = 0; i < 10; i++) K.emit('item.trade', W.P1, { gave: [{ i: 'Iron Sword', k: i }] });
  await flushN(W, 20);
  ok([...W.FS.files.keys()].some((f) => /2026-10-14\.1\.jsonl$/.test(f)), 'a day file over rollBytes rolls to .1.jsonl', [...W.FS.files.keys()]);
  ok(W.FS.files.get('/fake/events/2026-10-14.jsonl').length < 3000 + 2000, '...and the full one stops growing');

  // ---- validation and clean() ---------------------------------------------------------------------------------------------------
  reset();
  W = world();
  K = W.load(); W.QU.run(); await F.settle();
  K.emit('item.trade', W.P1, { gave: [{ i: 'Sword', k: 1, name: 'PLOGCANARY' }], text: 'PLOGCANARY', message: 'PLOGCANARY' });
  K.S.q.push({ v: 1, t: W.CL.t, ev: 'chat.say', p: 1, f: { text: 'PLOGCANARY' } });
  await flushN(W, 4);
  W.TM.run('playerlogMinute'); await flushN(W, 4);
  const all = allLines(W).join('\n');
  ok(!all.includes('PLOGCANARY'), 'unknown keys (text, message, an item name) and an unknown type never reach the disk');
  const schema = parsed(W).find((r) => r && r.ev === 'sys.schema');
  ok(schema && schema.f.keys['item.trade.f.text'] === 1 && schema.f.keys['item.trade.f.message'] === 1 && schema.f.types['chat.say'] === 1, 'they are counted by key name (from code)', schema);
  const R = require(RULES);
  ok(R.clean('a\nb\rc') === 'a b c', 'clean(): line breaks', R.clean('a\nb\rc'));
  ok(R.clean('at 10.20.30.40 now') === 'at [ip] now', 'clean(): IPv4');
  ok(R.clean('v6 2001:db8::1 and fe80::1') === 'v6 [ip] and [ip]', 'clean(): IPv6', R.clean('v6 2001:db8::1 and fe80::1'));
  ok(R.clean('see https://x.example/a and discord.gg/abc') === 'see [link] and [link]', 'clean(): URLs', R.clean('see https://x.example/a and discord.gg/abc'));
  ok(R.clean('<@337> <@&12> <#99>') === '[mention] [mention] [mention]', 'clean(): mentions');
  ok(R.clean('@everyone @here') === '@ everyone @ here', 'clean(): @everyone and @here');
  ok(R.clean('a@b.co') === '[email]', 'clean(): e-mail');
  ok(R.clean('14:30:05 a764b:BSHeartland.esm 0.3.95') === '14:30:05 a764b:BSHeartland.esm 0.3.95', 'clean(): a time, a desc and a version are left alone');
  ok(R.clean('x'.repeat(100), 48).length === 48, 'clean(): cut to the kind');
  // privacy review P-R7: the invisible characters that split a shape so it slips past the patterns
  const invis = ['\u00ad', '\u034f', '\u115f', '\u1160', '\u180e', '\u2060', '\u2061', '\u2062', '\u2063', '\u2064', '\u3164', '\ufe0f', '\ufeff', '\udb40\udc20'];
  ok(invis.every((c) => R.clean(`203${c}.0.113.7`) === '[ip]' && R.clean(`@${c}everyone`) === '@ everyone'), 'clean(): an invisible character inside an IP or @everyone is taken out first', invis.map((c) => R.clean(`203${c}.0.113.7`)));
  // the bot-token shape is joined at run time: GitHub push protection refuses a token-shaped literal in the repo
  ok(R.clean('t ' + ['MTIzNDU2Nzg5MDEyMzQ1Njc4', 'GaBcDe', 'abcdefghijklmnopqrstuvwxyz0123'].join('.')) === 't [token]' && R.clean('id 0123456789abcdef0123456789abcdef!') === 'id [token]!', 'clean(): a bot token and a long hex run (the forwarder\'s TOKEN and LONGHEX shapes)', [R.clean('t ' + ['MTIzNDU2Nzg5MDEyMzQ1Njc4', 'GaBcDe', 'abcdefghijklmnopqrstuvwxyz0123'].join('.')), R.clean('id 0123456789abcdef0123456789abcdef!')]);

  // ---- the first deploy: statfs before the first flush made the folder is no error (safety review, LOW) -------------------------
  reset();
  W = world();
  W.FS.fs.promises.statfs = () => Promise.reject(Object.assign(new Error('ENOENT fake'), { code: 'ENOENT' }));
  K = W.load(); W.QU.run(); await F.settle();
  ok(!K.S.errs.has('fs.statfs') && !W.logs.some((l) => /fs\.statfs/.test(l)), 'statfs on a folder not made yet: no error counted or logged', [...K.S.errs.keys()]);
  W = world(); reset(); K = W.load(); W.QU.run(); await F.settle();

  // ---- every map is registered and capped -----------------------------------------------------------------------------------
  const CAPS = require(MODULE).CAPS;
  const unregistered = Object.keys(K.S).filter((k) => (K.S[k] instanceof Map || K.S[k] instanceof Set) && !CAPS[k]);
  ok(unregistered.length === 0, 'every Map and Set on the state is in CAPS', unregistered);
  const over = [];
  for (const [name, def] of Object.entries(CAPS)) {
    const m = K.S[name];
    for (let i = 0; i < def.cap + 50; i++) { if (m instanceof Set) K.add(name, `k${i}`); else K.put(name, `k${i}`, { t: W.CL.t }); }
    if (m.size > def.cap) over.push([name, m.size]);
  }
  ok(over.length === 0, 'each holds its cap when filled past it', over);
  ok(K.S.q.length <= 20100 && Array.isArray(K.S.errTimes), 'the queue and the error times are bounded arrays');

  // ---- errors never escape, and the breaker -------------------------------------------------------------------------------------
  reset();
  W = world();
  const inner = { onHitDamageAttempt: () => false, onHitDamage: () => undefined, onActivate: () => true, onTakeItem: () => false, onDeath: () => undefined };
  for (const [k, f] of Object.entries(inner)) W.M.mp[k] = f;
  K = W.load(); W.QU.run(); await F.settle();
  W.M.S.throwOn = () => true;   // every mp.get throws
  let escaped = 0;
  const verdicts = [];
  try { verdicts.push(W.M.mp.onHitDamageAttempt(W.P1, W.P2, 0x12eb7, 5, {})); verdicts.push(W.M.mp.onHitDamage(W.P1, W.P2, 0x12eb7, 5)); verdicts.push(W.M.mp.onActivate(0x806ca1f, W.P1)); verdicts.push(W.M.mp.onTakeItem(0x806ca1f, W.P1, 0x12eb7, 1)); verdicts.push(W.M.mp.onDeath(W.P2, W.P1)); } catch (e) { escaped++; }
  for (const name of [...W.TM.T.keys()]) { try { W.TM.run(name); } catch (e) { escaped++; } }
  ok(escaped === 0, 'mp.get throwing everywhere: nothing escapes a wrapper or a timer');
  ok(verdicts[0] === false && verdicts[1] === undefined && verdicts[2] === true && verdicts[3] === false && verdicts[4] === undefined, 'every wrapper still returns the inner verdict', verdicts);
  // state that breaks every timer body and every wrapper's own code
  W.M.S.throwOn = null;
  const saved = K.S.online;
  K.S.online = null;
  W.logs.length = 0;
  for (let i = 0; i < 3; i++) {
    for (const name of [...W.TM.T.keys()]) { try { W.TM.run(name); } catch (e) { escaped++; } }
    try { verdicts.push(W.M.mp.onHitDamageAttempt(W.P1, W.P2, 0x12eb7, 5, {})); verdicts.push(W.M.mp.onActivate(0x806ca1f, W.P1)); } catch (e) { escaped++; }
    try { h() && h()('login', 3, W.P1); } catch (e) { escaped++; }
  }
  ok(escaped === 0, 'a broken state: the guard catches every throw', escaped);
  ok(verdicts.slice(5).every((v, i) => v === (i % 2 ? true : false)), '...the verdicts unchanged', verdicts.slice(5));
  const perSite = {};
  for (const l of W.logs) { const m = l.match(/player log error at (\S+)/); if (m) perSite[m[1]] = (perSite[m[1]] || 0) + 1; }
  ok(Object.values(perSite).every((n) => n === 1), 'at most one log line per site per minute', perSite);
  ok(K.S.on === false && W.logs.some((l) => /player log: off after \d+ errors in 60 s, mostly/.test(l)), 'the breaker trips at 20 errors in 60 s', W.logs.filter((l) => /off after/.test(l)));
  K.S.online = saved;
  ok(K.S.q.some((r) => r.ev === 'sys.stop' && r.f.reason === 'errors'), '...and queues sys.stop{errors}');
  ok(K.emit('item.trade', W.P1, {}) === false, '...capture stays off');
  W.TM.run('playerlogStop'); await F.settle();
  ok(K.S.on === false, '...the STOP poll does not turn it back on');

  // ---- the STOP file and the breaker stop the work, not only the records (safety review R1) -------------------------------------
  reset();
  W = world();
  const P3 = W.M.player(0xff000016, { profile: 3, name: 'Mike', tag: '5D8L', discord: '', user: 5, pos: [900, 0, 0] });
  W.M.record(0x20000, 'CONT', 'Barrel'); W.M.ref(0x806ca1f, 0x20000); W.M.mp.set(0x806ca1f, 'inventory', { entries: [{ baseId: 0x12eb7, count: 3 }] });
  for (const k of ['onActivate', 'onTakeItem', 'onPutItem', 'onDropItem', 'onEatItem', 'onHitDamageAttempt', 'onHitDamage', 'onDeath', 'onSpellCast', 'onUpdateEquipmentAttempt']) W.M.mp[k] = () => true;
  K = W.load(); W.QU.run(); await F.settle();
  h()('login', 3, W.P1); h()('login', 4, W.P2); W.QU.run();
  for (const n of ['playerlogLocation', 'playerlogFast', 'playerlogAfk']) W.TM.run(n);
  W.FS.files.set('/fake/STOP', Buffer.alloc(0));
  W.TM.run('playerlogStop'); await F.settle();
  ok(K.S.on === false, 'setup: the STOP file turned capture off');
  // while off: Mike comes on and Selene goes (their hooks are dropped), Rowan is moved far, loses health and is tied up
  W.api.onlineActors = () => [W.P1, P3];
  h()('login', 5, P3); h()('logout', 4, W.P2);
  W.M.mp.set(W.P1, 'pos', [90000, 0, 0]); W.M.mp.set(W.P1, 'percentages', { health: 0.3 }); W.M.mp.set(W.P1, 'private.restrained', { boundHands: true, captorActorId: P3 });
  const g0 = W.M.S.gets;
  for (const n of [...W.TM.T.keys()].filter((x) => /^playerlog(Fast|Location|Slow|Afk|Minute|InvDiff)$/.test(x))) W.TM.run(n);
  for (let i = 0; i < 4; i++) {
    W.M.mp.onActivate(0x806ca1f, W.P1); W.M.mp.onTakeItem(0x806ca1f, W.P1, 0x12eb7, 1); W.M.mp.onPutItem(0x806ca1f, W.P1, 0x12eb7, 1); W.M.mp.onDropItem(W.P1, 0x12eb7, 1);
    W.M.mp.onEatItem(W.P1, 0x12eb7); W.M.mp.onHitDamageAttempt(W.P1, W.P2, 0x12eb7, 5, {}); W.M.mp.onHitDamage(W.P1, W.P2, 0x12eb7, 5); W.M.mp.onDeath(W.P2, W.P1);
    W.M.mp.onSpellCast(W.P1, 0x12eb7); W.M.mp.onUpdateEquipmentAttempt(W.P1, { inv: { entries: [] } }, true);
  }
  W.QU.run();
  ok(W.M.S.gets === g0, 'STOP present: a round of every poll and 40 wrapper calls make no mp.get', W.M.S.gets - g0);
  W.FS.files.delete('/fake/STOP');
  const n0 = K.S.q.length;
  W.TM.run('playerlogStop'); await F.settle();
  ok(K.S.on === true && K.S.online.has(P3) && !K.S.online.has(W.P2) && K.S.sessions.has(P3) && !K.S.sessions.has(W.P2), 'STOP removed: who came on meanwhile is online with a session, who left is not', [[...K.S.online].map((x) => x.toString(16)), [...K.S.sessions.keys()].map((x) => x.toString(16))]);
  for (const n of ['playerlogLocation', 'playerlogFast']) W.TM.run(n);
  W.CL.t += 31000; W.TM.run('playerlogFast');
  const after = K.S.q.slice(n0).map((r) => r.ev);
  ok(!after.some((e) => e === 'move.teleport' || e === 'combat.health_loss' || e === 'combat.capture'), '...the first polls after it read no teleport, health loss or capture out of what changed while off', after);
  W.M.mp.set(W.P1, 'pos', [190000, 0, 0]); W.TM.run('playerlogLocation');
  ok(K.S.q.slice(n0).some((r) => r.ev === 'move.teleport'), '...and the polls work again after that');
  // the breaker: the same, the polls stop working
  for (let i = 0; i < 25; i++) K.err('test.site', new Error('x'));
  const g1 = W.M.S.gets;
  for (const n of ['playerlogFast', 'playerlogLocation', 'playerlogSlow', 'playerlogAfk', 'playerlogMinute']) W.TM.run(n);
  W.M.mp.onActivate(0x806ca1f, W.P1); W.M.mp.onDropItem(W.P1, 0x12eb7, 1); W.QU.run();
  ok(K.S.on === false && W.M.S.gets === g1, 'the breaker tripped: the polls and the pre-reads stop too', W.M.S.gets - g1);

  // ---- switches: the STOP file, then enabled false ------------------------------------------------------------------------------
  reset();
  W = world();
  const orig = { onRespawn: () => 'r', onDeath: () => 'd' };
  W.M.mp.onRespawn = orig.onRespawn; W.M.mp['onPapyrusEvent:OnItemAdded'] = undefined; W.M.mp['onPapyrusEvent:SkympOnActivateClose'] = undefined;
  W.M.mp.onDeath = orig.onDeath;
  K = W.load(); W.QU.run(); await F.settle();
  ok(W.M.mp.onRespawn !== orig.onRespawn && W.M.mp.onRespawn.__dboPlog, 'the wrappers are in');
  W.FS.files.set('/fake/STOP', Buffer.alloc(0));
  W.TM.run('playerlogStop'); await F.settle();
  ok(K.S.on === false && K.emit('item.trade', W.P1, {}) === false, 'the STOP file: capture off within one check');
  W.FS.files.delete('/fake/STOP');
  W.TM.run('playerlogStop'); await F.settle();
  ok(K.S.on === true && K.emit('item.trade', W.P1, {}) === true, '...removed: capture on again');
  await flushN(W, 4);
  W.api.cfg.playerLog.enabled = false;
  W.M.mp.onDeath = orig.onDeath;   // gamemode reassigns its own slots on every load
  const K2 = W.load(); W.QU.run(); await F.settle(); W.QU.run(); await F.settle(); W.QU.run();
  ok(K2.disabled === true && globalThis.__dboPlogHook === null, 'enabled false: the dispatcher is null');
  ok(W.M.mp.onRespawn === orig.onRespawn && W.M.mp['onPapyrusEvent:OnItemAdded'] === undefined && W.M.mp['onPapyrusEvent:SkympOnActivateClose'] === undefined, '...the slots nobody resets are back to their originals');
  ok(![...W.TM.T.keys()].some((k) => k.startsWith('playerlog')), '...no player log timer runs', [...W.TM.T.keys()]);
  ok(parsed(W).some((r) => r && r.ev === 'sys.stop' && r.f.reason === 'disabled'), '...sys.stop{disabled} written by the one last flush');

  // ---- enabled false with a write in flight: the queue and the stop marker are still written, each step time-boxed (R2) ----------
  reset();
  W = world();
  K = W.load(); W.QU.run(); await F.settle();
  await flushN(W, 4);
  for (let i = 0; i < 3000; i++) K.emit('item.trade', W.P1, { gave: [{ i: 'Iron Sword', k: 1 }] }, { o: [K.partyOf(W.P2, 'other')] });
  W.FS.ctl.hold.add('write');
  await flushN(W, 2);
  ok(!!K.S.writing, 'setup: a write is in flight when the disabling reload lands');
  W.api.cfg.playerLog.enabled = false;
  W.QU.restore();
  const realST = global.setTimeout;
  const steps = [];
  const timeouts = [];
  global.setTimeout = (fn) => { timeouts.push(fn); return timeouts.length; };
  W.load();
  W.CL.perUs = 15.6;
  let released = false;
  for (let i = 0; i < 4000 && timeouts.length; i++) {
    const fn = timeouts.shift();
    const p0 = W.CL.p; fn(); steps.push(W.CL.p - p0);
    if (i === 20 && !released) { released = true; W.FS.ctl.hold.delete('write'); W.FS.ctl.release(); }
    await F.settle(3);
  }
  W.CL.perUs = 0;
  global.setTimeout = realST;
  W.QU.install();
  await F.settle(10);
  const dl = parsed(W).filter(Boolean);
  ok(K.S.q.length === 0 && dl.filter((r) => r.ev === 'item.trade').length >= 3000 - 10 && dl.some((r) => r.ev === 'sys.stop' && r.f.reason === 'disabled'), 'enabled false with a write in flight: the queue and sys.stop{disabled} are written all the same', [K.S.q.length, dl.filter((r) => r.ev === 'item.trade').length, dl.filter((r) => r.ev === 'sys.stop').map((r) => r.f)]);
  ok(Math.max(...steps) <= 5, '...no drain step over 5 ms (the flush tick\'s time box, at 15.6 µs an event)', Math.max(...steps).toFixed(2));
  W.api.cfg.playerLog.enabled = true;

  // ---- SIGTERM: the earlier flush first, its markers kept, the rest appended once -------------------------------------------------
  reset();
  const tmpRoot = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'plog-core-'));
  W = world({ dir: path.join(tmpRoot, 'events') });
  const order = [];
  const base = () => order.push('base');
  base.__dboExtrasFlush = true; base.__dboPresetFlush = true;
  globalThis.__dboFlushOnExit = base;
  K = W.load(); W.QU.run(); await F.settle();
  const chained = globalThis.__dboFlushOnExit;
  ok(chained !== base && chained.__dboPlogFlush && chained.__dboExtrasFlush && chained.__dboPresetFlush, 'the chain is on top and keeps the markers it found');
  K.emit('item.trade', W.P1, { gave: [{ i: 'Exit Sword', k: 1 }] });
  const realAppend = fs.appendFileSync;
  fs.appendFileSync = (...a) => { order.push('plog'); return realAppend(...a); };
  chained();
  fs.appendFileSync = realAppend;
  ok(order.join(',') === 'base,plog', 'SIGTERM: the game\'s saves first, then the player log', order);
  const exitFile = path.join(tmpRoot, 'events', `${new Date(W.CL.t).toISOString().slice(0, 10)}.jsonl`);
  const exitLines = fs.existsSync(exitFile) ? fs.readFileSync(exitFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  ok(exitLines.some((r) => r.f && r.f.gave && r.f.gave[0].i === 'Exit Sword') && exitLines.some((r) => r.ev === 'sys.stop' && r.f.reason === 'sigterm'), '...the queue and sys.stop{sigterm} appended', exitLines.length);
  W.load(); W.QU.run(); await F.settle();
  ok(globalThis.__dboFlushOnExit === chained, 'a second load does not chain twice');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  // the sessions still open end at the stop (review C-R6), and a queue over exitFlushBytes keeps the tail (safety review)
  reset();
  const tmpRoot2 = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'plog-core-'));
  W = world({ dir: path.join(tmpRoot2, 'events'), exitFlushBytes: 200000 });
  globalThis.__dboFlushOnExit = () => {};
  K = W.load(); W.QU.run(); await F.settle();
  h()('login', 3, W.P1); h()('login', 4, W.P2); W.QU.run();
  W.TM.run('playerlogLocation');
  W.CL.t += 600000;
  for (let i = 0; i < 3000; i++) K.emit('item.trade', W.P1, { gave: [{ i: 'Iron Sword', k: 1 }] });
  const getsExit = W.M.S.gets;
  globalThis.__dboFlushOnExit();
  const exitFile2 = path.join(tmpRoot2, 'events', `${new Date(W.CL.t).toISOString().slice(0, 10)}.jsonl`);
  const ex2 = fs.existsSync(exitFile2) ? fs.readFileSync(exitFile2, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const lo = ex2.filter((r) => r.ev === 'session.logout');
  ok(lo.length === 2 && lo.every((r) => r.f.reason === 'server_stop' && r.f.sec >= 600 && r.c && r.at && Number.isFinite(r.at.x)) && W.M.S.gets === getsExit, 'SIGTERM: each session still open ends with session.logout{server_stop}, its time played, from the cache (no get)', lo.map((r) => [r.c, r.f, r.at]));
  ok(ex2.length && ex2[ex2.length - 1].ev === 'sys.stop' && ex2.some((r) => r.ev === 'sys.dropped' && r.f.counts['item.trade'] > 0), '...a queue over exitFlushBytes: the lines cut are counted, and sys.stop{sigterm} is still the last line', ex2.slice(-3).map((r) => [r.ev, r.f]));
  fs.rmSync(tmpRoot2, { recursive: true, force: true });

  // ---- hot reload hygiene: 3 loads, modules that fail to reload, a playerlog.js that throws -------------------------------------
  reset();
  W = world();
  let tradeInner = 0, soulInner = 0;
  const journalTrade = (s) => { tradeInner++; }; journalTrade.__dboStats = true;
  const soul = () => { soulInner++; };
  globalThis.__alduinakTradeLog = journalTrade; globalThis.__dboSoulCaptured = soul;
  const respawnOrig = () => undefined;
  W.M.mp.onRespawn = respawnOrig;
  const SUMMARY = `[trade] "Rowan" (profile 1, actor ${W.P1.toString(16)}) gave [1x 0x12eb7] to "Selene" (profile 2, actor ${W.P2.toString(16)}) for [nothing]`;
  const trades = () => K.S.q.filter((r) => r.ev === 'item.trade').length;
  K = W.load(); W.QU.run(); await F.settle();
  const rulesMod1 = require.cache[RULES] && require.cache[RULES].exports;
  const timers1 = W.TM.T.size;
  globalThis.__alduinakTradeLog(SUMMARY); globalThis.__dboSoulCaptured(W.P1, 0xff000099, 3);
  ok(trades() === 1 && tradeInner === 1 && soulInner === 1, 'load 1: one trade event, the inner called once');
  // load 2: journalstats.js and alchemy.js threw at their load, so the slots still hold load 1's wrappers
  K = W.load(); W.QU.run(); await F.settle();
  globalThis.__alduinakTradeLog(SUMMARY); globalThis.__dboSoulCaptured(W.P1, 0xff000099, 3);
  ok(trades() === 2 && tradeInner === 2 && soulInner === 2, 'load 2 over failed module reloads: still one event per trade (the marker rule)', [trades(), tradeInner, soulInner]);
  ok(globalThis.__alduinakTradeLog.__dboPlogInner === journalTrade, '...the wrapper wraps the original, not the old wrapper');
  ok(require.cache[RULES].exports !== rulesMod1, 'require.cache has no stale playerlog-rules.js');
  // load 3: normal
  globalThis.__alduinakTradeLog = journalTrade;
  K = W.load(); W.QU.run(); await F.settle();
  globalThis.__alduinakTradeLog(SUMMARY);
  ok(trades() === 3 && tradeInner === 3, 'load 3: one event per trade');
  ok(W.TM.T.size === timers1, 'the timer count is constant over reloads', [timers1, W.TM.T.size]);
  const queueBefore = K.S.q.length, fileBefore = K.S.file;
  // a playerlog.js that throws, through gamemode.js's own load block (G12)
  const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
  const a0 = src.indexOf('// ---- per-player activity log, never chat');
  const block = src.slice(a0, src.indexOf('\n}\n', src.indexOf('globalThis.__dboPlogHook = null;', a0)) + 3);
  ok(a0 > 0 && /__dboPlogUninstall\('load_failed'\)/.test(block), 'the G12 block is at the end of gamemode.js and calls the uninstall', block.length);
  const badDir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'plog-bad-'));
  fs.writeFileSync(path.join(badDir, 'playerlog.js'), "'use strict';\nthrow new Error('broken on purpose');\n");
  const cwd = process.cwd();
  process.chdir(badDir);
  const g12logs = [];
  try { new Function('path', 'require', 'log', 'globalThis', block)(path, require, (...a) => g12logs.push(a.join(' ')), globalThis); } catch (e) { ok(false, 'the G12 block lets nothing escape', e.message); }
  process.chdir(cwd);
  fs.rmSync(badDir, { recursive: true, force: true });
  ok(g12logs.some((l) => /playerlog\.js failed to load:/.test(l)), 'a failed load is logged as "playerlog.js failed to load:"');
  ok(globalThis.__dboPlogHook === null, '...the dispatcher is null');
  ok(![...W.TM.T.keys()].some((k) => k.startsWith('playerlog')), '...no player log timer runs after it', [...W.TM.T.keys()]);
  ok(W.M.mp.onRespawn === respawnOrig, '...the slots nobody resets hold their originals');
  ok(globalThis.__alduinakTradeLog === journalTrade, '...and the trade slot its own handler');
  ok(K.S.q.length >= queueBefore && K.S.file === fileBefore, '...the queue and the file handle survive for the next load');
  ok(K.S.q.some((r) => r.ev === 'sys.stop' && r.f.reason === 'load_failed'), '...sys.stop{load_failed} queued');

  // ---- no sync IO after load -------------------------------------------------------------------------------------------------------
  reset();
  W = world();
  K = W.load(); W.QU.run(); await F.settle();
  const syncs = Object.keys(fs).filter((k) => k.endsWith('Sync') && typeof fs[k] === 'function');
  const realSync = {};
  for (const k of syncs) { realSync[k] = fs[k]; fs[k] = () => { throw new Error(`sync IO ${k}`); }; }
  let syncHit = 0;
  try {
    for (let i = 0; i < 5; i++) {
      K.emit('item.trade', W.P1, {});
      globalThis.__dboPlogHook('audit', 'CONTRACT Rowan #PGDB (profile 1) completed 7 wolves for Bruma (84 gold)');
      for (const name of [...W.TM.T.keys()]) W.TM.run(name);
      await F.settle(4); W.QU.run();
    }
  } catch (e) { syncHit++; }
  for (const k of syncs) fs[k] = realSync[k];
  ok(syncHit === 0 && !W.logs.some((l) => /sync IO/.test(l)), 'no fs.*Sync call after load (timers, hooks, the writer)', W.logs.filter((l) => /sync IO/.test(l)));

  await F.settle(10);
  ok(rejections.length === 0, 'no unhandled rejection anywhere', rejections.map((e) => String(e && e.message)));
  reset();
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL harness error', e && e.stack); process.exit(1); });
