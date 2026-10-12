// LOG-1012-03: the journal stats index (account:tag -> key of every file, for a character that lost its key) is built
// off the main thread. The synchronous build ran inside the 2 s sampler the first time a character without a key turned
// up, and read all 344 files in one tick: the server froze for 30.6 s on the cold disk after the host crash
// ('01:11:49.807 slow tick journalStatsSample: 30566.0 ms', 12 Oct) and 1.6 s warm (11 Oct 20:18Z).
// A fake slow disk: every synchronous call on the journal folder costs 89 ms (the per-file cost that night), and every
// asynchronous one is delayed. The slow synchronous calls burn CPU and sample() is timed in CPU, so a test scope frozen
// by io-governor (CT 115 freezes test scopes for minutes under disk pressure) cannot fail or pass a check. Checked:
//   - a key-less character never blocks sample() more than a few ms, and nothing on the folder is read synchronously
//   - no random key is made while the index builds; a brand-new character gets one once it is done
//   - a returning character keeps its old key (from journal/ and from removed/), counts and all; a held file stays held
//   - what the sampler stamps during the build wins over an older file; a file forget() moves mid-build is still found
//   - a hot reload mid-build carries on with the same run (state on globalThis); a stalled build and a failed listing
//     start again; the module at origin/server reproduces the freeze and works over this one's state (rollback)
//   node tests/journalstats-index-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const SERVER = path.resolve(__dirname, '..');
const MODULE = path.join(SERVER, 'journalstats.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journalstats-index-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 20000) => { const end = performance.now() + ms; while (!f() && performance.now() < end) await sleep(2); return f(); };
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;

// ---- the journal folder: 254 files and 90 moved aside, as on live, plus the characters under test ------------------
const JDIR = path.join(dir, 'journal'), REM = path.join(JDIR, 'removed');
fs.mkdirSync(REM, { recursive: true });
const hex = (i) => (`b${i.toString(16)}`).padStart(16, '0');
const put = (where, k, d) => fs.writeFileSync(path.join(where, `${k}.json`), JSON.stringify(Object.assign({ v: 1, since: 1, firstSeen: 1, playMs: 3600000, sessions: 4, trades: 0 }, d)));
const allKeys = new Set();
for (let i = 0; i < 344; i++) {
  const k = hex(i); allKeys.add(k);
  put(i < 254 ? JDIR : REM, k, { account: 1000 + i, tag: `T${(i % 1000).toString().padStart(3, '0')}`, actor: (0xff100000 + i).toString(16) });
}
const RET = 0xff000501, RET2 = 0xff000502, NEW = 0xff000503, CLAIM = 0xff000504, STAMP = 0xff000505, HOLDER = 0xff000600, FRGT = 0xff000507;
const KR = 'cafe000000000001', KA = 'cafe000000000002', KH = 'cafe000000000004', KO = 'cafe000000000005', KN = 'cafe000000000006', KF = 'cafe000000000007';
put(JDIR, KR, { account: 500, tag: 'RtRn', actor: 'ff000501', trades: 7 });     // a character that will have lost its key
put(REM, KA, { account: 501, tag: 'AsDe', actor: 'ff000502', trades: 3 });      // ...whose file forget() moved aside
put(JDIR, KH, { account: 503, tag: 'HeLd', actor: 'ff000600' });                // a file a living character holds
put(JDIR, KO, { account: 504, tag: 'StMp', actor: 'ff000505' });                // an older file of a character that has a newer key
put(JDIR, KF, { account: 505, tag: 'FrGt', actor: 'ff000507' });                // moved aside while the index reads the folder
for (const k of [KR, KA, KH, KO, KF]) allKeys.add(k);

// ---- the fake slow disk ---------------------------------------------------------------------------------------------
const inJournal = (p) => String(p).startsWith(JDIR);
const cpuMs = (c0) => { const c = process.cpuUsage(c0); return (c.user + c.system) / 1000; };
const block = (ms) => { const c0 = process.cpuUsage(); while (cpuMs(c0) < ms) { /* the disk */ } };
let syncDelay = 89, syncCalls = 0, quiet = false;
for (const name of ['readFileSync', 'readdirSync', 'renameSync', 'existsSync', 'statSync', 'mkdirSync', 'openSync', 'writeFileSync', 'unlinkSync']) {
  const real = fs[name];
  fs[name] = function (p, ...rest) { if (!quiet && inJournal(p)) { syncCalls++; block(syncDelay); } return real.call(this, p, ...rest); };
}
// The harness's own checks on the folder are not the module's reads
const exists = (p) => { quiet = true; try { return fs.existsSync(p); } finally { quiet = false; } };
const P = fs.promises;
let asyncDelay = 3, inFlight = 0, maxInFlight = 0, readdirCalls = 0;
let onRead = null, onReaddir = null;     // test hooks: (file) => a promise to use instead, or undefined
const realP = { readFile: P.readFile, readdir: P.readdir, rename: P.rename };
P.readFile = async function (p, ...rest) {
  if (!inJournal(p)) return realP.readFile.call(this, p, ...rest);
  inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
  try {
    await sleep(asyncDelay);
    const hooked = onRead && onRead(String(p));
    if (hooked) return await hooked;
    return await realP.readFile.call(this, p, ...rest);
  } finally { inFlight--; }
};
P.readdir = async function (p, ...rest) {
  if (inJournal(p)) { readdirCalls++; await sleep(asyncDelay); const hooked = onReaddir && onReaddir(String(p)); if (hooked) return hooked; }
  return realP.readdir.call(this, p, ...rest);
};
P.rename = async function (a, b) { if (inJournal(a)) await sleep(asyncDelay); return realP.rename(a, b); };

// ---- the fake world ---------------------------------------------------------------------------------------------------
const props = new Map(), profiles = new Map(), timers = {}, logs = [];
let online = [];
const mp = {
  get: (id, k) => props.get(`${id >>> 0}|${k}`),
  set: (id, k, v) => { props.set(`${id >>> 0}|${k}`, v); },
};
const KEY = 'private.dboJournalId';
const keyProp = (a) => props.get(`${a >>> 0}|${KEY}`);
const person = (a, profile, tag, key) => { profiles.set(a >>> 0, profile); if (tag) props.set(`${a >>> 0}|private.charTag`, tag); if (key) props.set(`${a >>> 0}|${KEY}`, key); props.set(`${a >>> 0}|pos`, [0, 0, 0]); props.set(`${a >>> 0}|worldOrCellDesc`, 'bruma'); };
person(RET, 500, 'RtRn'); person(RET2, 501, 'AsDe'); person(NEW, 502, 'NeW1'); person(CLAIM, 503, 'HeLd'); person(STAMP, 504, 'StMp', KN);
person(HOLDER, 600, 'HoLr', KH); person(FRGT, 505, 'FrGt');
const crowd = Array.from({ length: 20 }, (_, i) => (0xff002000 + i) >>> 0);
for (const [i, a] of crowd.entries()) person(a, 2000 + i, `C${i.toString().padStart(3, '0')}`, `d0d0d0d0d0d0${i.toString(16).padStart(4, '0')}`);
const api = {
  mp, log: (...x) => logs.push(x.join(' ')), personal: () => {}, registerChatCommand: () => {}, every: (k, ms, f) => { timers[k] = f; },
  onlineActors: () => online, profileOf: (a) => (profiles.has(a >>> 0) ? profiles.get(a >>> 0) : -1), display: (a) => (a >>> 0).toString(16),
  findAnyByName: () => 0, isAdmin: () => true, creationPending: () => false,
  cfg: { journalStats: { dir: JDIR, playersFile: path.join(dir, 'players.json') } },
};
const load = (file = MODULE) => { delete require.cache[file]; return require(file)(api); };
const S = () => globalThis.__dboJournalStats;
const fresh = () => { delete globalThis.__dboJournalStats; logs.length = 0; };
// One sample, in CPU ms (wall ms kept beside it, for the record)
let maxSample = 0, maxSampleWall = 0;
const sample = () => {
  const c0 = process.cpuUsage(), t0 = performance.now();
  timers.journalStatsSample();
  const wall = performance.now() - t0, ms = cpuMs(c0);
  if (ms > maxSample) maxSample = ms; if (wall > maxSampleWall) maxSampleWall = wall;
  return ms;
};
const keySoon = async (M, a) => { let k = null; await until(() => (k = M.keyOf(a))); return k; };
delete globalThis.__alduinakTradeLog; delete globalThis.__dboPrevTradeLog;

(async () => {
  // ---- the build starts at load and reads nothing on the main thread ----
  fresh();
  // forget() (the journal's orphan sweep) moves KF aside after the listing, just before the index reads it
  let raced = false;
  onRead = (f) => { if (!raced && f === path.join(JDIR, `${KF}.json`)) { raced = true; quiet = true; try { M0.forget(KF); } finally { quiet = false; } } };
  let M0 = null;
  syncCalls = 0;
  const l0 = performance.now();
  M0 = load();
  const loadMs = performance.now() - l0;
  const run1 = S().indexing;
  ok(!!run1 && !S().index && syncCalls === 0, `the index build starts at load, off the main thread (load ${loadMs.toFixed(1)} ms, ${syncCalls} synchronous journal calls)`, [!!run1, syncCalls]);

  // ---- while it builds: the sampler with 26 online, five of them without a key ----
  online = [RET, RET2, NEW, CLAIM, STAMP, FRGT, ...crowd];
  // The gaps between 1 ms timer ticks: how long the event loop was held while the index was read
  let lastTick = performance.now();
  const gapList = [];
  const gaps = setInterval(() => { const t = performance.now(); gapList.push(t - lastTick); lastTick = t; }, 1);
  let minted = false, samples = 0;
  maxSample = 0; maxSampleWall = 0;
  while (!S().index && samples < 5000) {
    sample(); samples++;
    if ([RET, RET2, NEW, CLAIM, FRGT].some((a) => keyProp(a) !== undefined)) minted = true;
    await sleep(5);
  }
  clearInterval(gaps);
  const buildSampleMax = maxSample;
  ok(!!S().index, `the index finished while the server ran (${samples} samples taken meanwhile)`);
  ok(buildSampleMax < 5, `sample() never blocked more than a few ms while the index was read (worst ${buildSampleMax.toFixed(2)} ms CPU, ${maxSampleWall.toFixed(2)} ms wall)`, buildSampleMax);
  ok(syncCalls === 0, 'nothing in the journal folder was read synchronously', syncCalls);
  ok(!minted, 'no character without a key was given one before the index was complete (no random key made early)');
  ok(maxInFlight === 1, 'the build reads one file at a time (one thread-pool read in flight)', maxInFlight);
  // p99, not the longest: a scope frozen by io-governor shows as one gap of minutes
  gapList.sort((x, y) => x - y);
  const p99 = gapList[Math.floor(gapList.length * 0.99)] || 0;
  ok(gapList.length > 100 && p99 < 20, `the event loop kept running while the index was built (${gapList.length} ticks of 1 ms, p99 gap ${p99.toFixed(1)} ms, longest ${gapList[gapList.length - 1].toFixed(0)} ms)`, p99);
  ok(S().index.size >= 344 && S().index.get('1000:T000') === hex(0) && S().index.get('1300:T300') === hex(300), 'every file is indexed by account and #TAG, the moved-aside ones too', S().index.size);
  ok(S().index.get('504:StMp') === KN, 'what the sampler stamped during the build (a newer key) wins over an older file', S().index.get('504:StMp'));
  ok(raced && S().index.get('505:FrGt') === KF && exists(path.join(REM, `${KF}.json`)), 'a file forget() moved aside after the listing is still indexed (read from removed/)');
  ok(logs.filter((l) => /index of \d+ file\(s\) built off the main thread/.test(l)).length === 1, 'the build is logged once', logs.filter((l) => /index of/.test(l)));
  onRead = null;

  // ---- once it is complete: the take-backs and the new keys, still without a synchronous read ----
  maxSample = 0; maxSampleWall = 0;
  for (let i = 0; i < 400 && [RET, RET2, NEW, CLAIM, FRGT].some((a) => keyProp(a) === undefined); i++) { sample(); await sleep(5); }
  for (let i = 0; i < 20; i++) { sample(); await sleep(5); }       // the first async read of each file lands
  const afterSampleMax = maxSample;
  ok(keyProp(RET) === KR && logs.some((l) => /ff000501 takes back its file cafe000000000001/.test(l)), 'a returning character keeps its old key once the index is complete', keyProp(RET));
  ok(S().cache.get(KR) && S().cache.get(KR).trades === 7 && S().cache.get(KR).playMs >= 3600000, '...counts and all', S().cache.get(KR));
  ok(keyProp(RET2) === KA && exists(path.join(JDIR, `${KA}.json`)) && !exists(path.join(REM, `${KA}.json`)) && S().cache.get(KA) && S().cache.get(KA).trades === 3,
    'a returning character whose file was moved aside gets it back into the folder, counts and all', keyProp(RET2));
  ok(keyProp(FRGT) === KF, '...the one moved aside during the build too', keyProp(FRGT));
  const kNew = keyProp(NEW);
  ok(/^[0-9a-f]{16}$/.test(kNew || '') && !allKeys.has(kNew) && kNew !== KN, 'a brand-new character gets a fresh random key once the index is complete', kNew);
  ok(/^[0-9a-f]{16}$/.test(keyProp(CLAIM) || '') && keyProp(CLAIM) !== KH && keyProp(HOLDER) === KH, 'a file another living character holds is not taken (a fresh key instead)', keyProp(CLAIM));
  ok(afterSampleMax < 5 && syncCalls === 0, `the take-backs read nothing on the main thread either (worst sample ${afterSampleMax.toFixed(2)} ms CPU, ${syncCalls} synchronous calls)`, [afterSampleMax, syncCalls]);
  ok(S().adopting.size === 0, 'no take-back read is left behind', [...S().adopting.keys()]);

  // ---- a hot reload in the middle of the build carries on with the same run ----
  fresh(); readdirCalls = 0; maxInFlight = 0;
  props.delete(`${RET}|${KEY}`);
  let M = load();
  const runA = S().indexing;
  await until(() => S().indexing && S().indexing.done >= 50);
  M = load();
  ok(!!runA && S().indexing === runA && readdirCalls === 2, 'a hot reload mid-build keeps the run under way (state on globalThis), it does not start a second', [S().indexing === runA, readdirCalls]);
  ok(M.keyOf(RET) === null && keyProp(RET) === undefined, '...and the reloaded module still makes no key before the index is complete');
  await until(() => S().index);
  ok(await keySoon(M, RET) === KR && readdirCalls === 2 && maxInFlight === 1, '...and when it ends the reloaded module answers from it: the returning character keeps its key', [keyProp(RET), readdirCalls]);
  ok(logs.filter((l) => /index of \d+ file/.test(l)).length === 1, '...built once', logs.filter((l) => /index of/.test(l)));
  ok(load() && !S().indexing && readdirCalls === 2, 'a reload once the index is built reads nothing again', readdirCalls);

  // ---- a build that stalls (a read that never comes back) is started again ----
  fresh();
  let hung = null;
  onRead = (f) => { if (!hung && f === path.join(JDIR, `${hex(10)}.json`)) return new Promise((r) => { hung = r; }); return undefined; };
  M = load();
  const runB = S().indexing;
  await until(() => hung);
  props.delete(`${NEW}|${KEY}`);
  ok(M.keyOf(NEW) === null && S().indexing === runB, 'a stalled build is waited for at first');
  skew += 130000;
  ok(M.keyOf(NEW) === null && keyProp(NEW) === undefined && S().indexing && S().indexing !== runB && logs.some((l) => /made no progress for 120 s/.test(l)), 'after two minutes without progress it starts again, still without making a key', logs.slice(-2));
  const runC = S().indexing;
  await until(() => S().index);
  hung(JSON.stringify({ v: 1, account: 9999, tag: 'LaTe' }));        // the hung read comes back after all
  await sleep(20);
  ok(S().index === runC.map && !S().index.has('9999:LaTe') && S().index.get('1010:T010') === hex(10), "the new run's index stands; the old run's late answer is dropped");
  ok(/^[0-9a-f]{16}$/.test(await keySoon(M, NEW) || ''), '...and a new character gets its key');
  onRead = null;

  // ---- a listing that fails is tried again later; meanwhile nobody gets a key ----
  fresh();
  let failOnce = true;
  onReaddir = () => { if (failOnce) { failOnce = false; return Promise.reject(Object.assign(new Error('EIO: i/o error, scandir'), { code: 'EIO' })); } return undefined; };
  M = load();
  await until(() => logs.some((l) => /index build failed/.test(l)));
  props.delete(`${NEW}|${KEY}`);
  ok(!S().index && !S().indexing && M.keyOf(NEW) === null && !S().indexing && keyProp(NEW) === undefined, 'a failed listing is logged, and no key is made from an empty index', logs.slice(-1));
  skew += 31000;
  ok(M.keyOf(NEW) === null && !!S().indexing, '30 s later the build starts again');
  await until(() => S().index);
  ok(S().index.size >= 344 && /^[0-9a-f]{16}$/.test(await keySoon(M, NEW) || ''), '...reads the folder, and the new character gets its key');
  onReaddir = null;

  // ---- the module at origin/server: the freeze it had, and a rollback over this one's state ----
  let OLD = '';
  try { OLD = require('child_process').execFileSync('git', ['-C', SERVER, 'show', '84485082:journalstats.js'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { OLD = ''; }
  if (OLD) {
    const oldFile = path.join(dir, 'journalstats-84485082.js');
    fs.writeFileSync(oldFile, OLD);
    // The freeze, reproduced with a 5 ms disk (89 ms would take 30 s, as on live)
    fresh(); syncDelay = 5; syncCalls = 0;
    load(oldFile);
    props.delete(`${NEW}|${KEY}`);
    online = [NEW];
    const frozen = sample();
    ok(frozen > 1000 && syncCalls >= 344, `the module at origin/server blocks one sample for ${frozen.toFixed(0)} ms reading ${syncCalls} files synchronously (this one: under 5 ms)`, [frozen, syncCalls]);
    // Its finished index is used as it is by this module: no second build
    syncCalls = 0; readdirCalls = 0;
    M = load();
    props.delete(`${RET}|${KEY}`);
    ok(!S().indexing && S().index instanceof Map && await keySoon(M, RET) === KR && readdirCalls === 0 && syncCalls === 0, "a reload over that module's state keeps its index and builds nothing", [readdirCalls, syncCalls]);
    // The rollback: that module loaded over this one mid-build still works (it builds its own index, synchronously, as before)
    fresh(); syncDelay = 0;
    load();
    await until(() => S().indexing && S().indexing.done >= 20);
    const OM = load(oldFile);
    props.delete(`${RET}|${KEY}`);
    let rk = null; try { rk = OM.keyOf(RET); } catch (e) { rk = e.message; }
    ok(rk === KR, 'a rollback to the module at origin/server mid-build works over this state (the returning character keeps its key)', rk);
    await until(() => !S().indexing);
    ok(S().index instanceof Map && S().index.get('500:RtRn') === KR, "...and this module's run, ending afterwards, leaves an index that agrees with it");
  } else console.log('ok    skipped the origin/server checks: git cannot show 84485082 here');

  Date.now = realNow;
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the harness threw:', e.stack); process.exit(1); });
