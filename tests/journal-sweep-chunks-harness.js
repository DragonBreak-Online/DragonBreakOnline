// Scripted test for the journal's orphan sweep (journal.js sweep, journalstats.js orphans): the 6-hourly sweep must not
// check every journal file in one tick. On live it read 249 files and asked after each one's character in one go, and
// the main loop froze for 5.1 s (10 Oct 11:57Z) and 6.3 s (11 Oct 14:21Z) with about 20 players online. Now the 6 h
// timer only lists the files and a step timer checks a few each second. Run it from this folder's parent:
//
//   node tests/journal-sweep-chunks-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = process.env.SWEEP_ROOT ? path.resolve(process.env.SWEEP_ROOT) : path.resolve(__dirname, '..');
process.chdir(root);
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-jsweepchunk-'));
const dir = path.join(tmp, 'journal');
fs.mkdirSync(dir);
const FILES = 30;
const P2 = new Map(), deleted = new Set(), logs = [];
let reads = 0;
const smp = {
  get: (a, k) => { if (k === 'private.dboJournalId') reads++; if (deleted.has(a >>> 0)) throw new Error('no such form'); return P2.get(`${a >>> 0}|${k}`); },
  set: (a, k, v) => { if (deleted.has(a >>> 0)) throw new Error('no such form'); P2.set(`${a >>> 0}|${k}`, v); },
};
const ids = Array.from({ length: FILES }, (_, i) => (0xff000100 + i) >>> 0);
const keyFor = new Map(ids.map((id, i) => [id, `b1b2c3d4e5f6${i.toString(16).padStart(4, '0')}`]));
for (const id of ids) {
  P2.set(`${id}|private.dboJournalId`, keyFor.get(id));
  fs.writeFileSync(path.join(dir, `${keyFor.get(id)}.json`), JSON.stringify({ v: 1, since: 1, playMs: 5, actor: id.toString(16) }));
}
const at = (id) => path.join(dir, `${keyFor.get(id)}.json`);
const aside = (id) => path.join(dir, 'removed', `${keyFor.get(id)}.json`);
const skillsDef = JSON.parse(fs.readFileSync('skills.json', 'utf8')).skills;

const timers = {};
try {
  require(path.resolve('journalstats.js'))({
    mp: smp, log: (...x) => logs.push(x.join(' ')), personal: () => {}, registerChatCommand: () => {}, every: () => {}, onlineActors: () => [],
    profileOf: (a) => (keyFor.has(a >>> 0) && !deleted.has(a >>> 0) ? 1 : -1), display: String, findAnyByName: () => 0, isAdmin: () => false,
    creationPending: () => false, cfg: { journalStats: { dir, playersFile: path.join(tmp, 'players.json') } },
  });
  const load = () => {
    delete require.cache[path.resolve('journal.js')];
    return require(path.resolve('journal.js'))({
      mp: Object.assign({ lookupEspmRecordById: () => null }, smp), log: (...x) => logs.push(x.join(' ')), display: String, nameOf: () => '', personal: () => {},
      openWidget: () => {}, closeWidget: () => {}, onUi: () => {}, sendPacket: () => {}, every: (n, ms, fn) => { timers[n] = { ms, fn }; }, onlineActors: () => [],
      cfg: {}, skills: skillsDef, hasCap: () => false,
    });
  };
  const J2 = load();
  const realUptime = process.uptime;
  process.uptime = () => 7200;
  deleted.add(ids[7]);

  // ---- the 6 h timer itself does no per-file work --------------------------------------------------------------
  const sweepTimer = timers.journalSweep;
  check('the 6 h sweep timer is still registered', !!sweepTimer && sweepTimer.ms === 6 * 3600000, sweepTimer && sweepTimer.ms);
  reads = 0; sweepTimer.fn();
  check('the 6 h tick checks no file itself (it only lists them)', reads === 0, reads);

  // ---- a step timer checks a few files a tick ---------------------------------------------------------------------
  const step = timers.journalSweepStep;
  check('a step timer is registered, about once a second', !!step && step.ms > 0 && step.ms <= 2000, step && step.ms);
  let ticks = 0, worst = 0;
  if (step) {
    while (globalThis.__dboJournal.sweepRun && ticks < 100) { reads = 0; step.fn(); ticks++; worst = Math.max(worst, reads); }
  }
  check('each step checks at most a handful of files', worst > 0 && worst <= 5, worst);
  check('the whole sweep takes several steps', ticks >= Math.ceil(FILES / 5), ticks);
  check('...and then ends', !globalThis.__dboJournal.sweepRun && ticks < 100, ticks);
  check('a first listing moves nothing (two sweeps running, as before)', fs.existsSync(at(ids[7])));
  const idle = (() => { reads = 0; if (step) step.fn(); return reads; })();
  check('with no sweep under way a step does nothing', idle === 0, idle);

  // ---- the second sweep moves the orphan aside, as the one-tick sweep did ---------------------------------------
  sweepTimer.fn();
  ticks = 0;
  if (step) while (globalThis.__dboJournal.sweepRun && ticks < 100) { step.fn(); ticks++; }
  check('the second chunked sweep moves the gone character\'s file to removed/', !fs.existsSync(at(ids[7])) && fs.existsSync(aside(ids[7])));
  check('...and only that one', ids.filter((id) => id !== ids[7]).every((id) => fs.existsSync(at(id))));

  // ---- a 6 h tick during a sweep does not restart it; a hot reload carries on ------------------------------------
  deleted.add(ids[3]);
  sweepTimer.fn();
  if (step) { step.fn(); step.fn(); }
  const pos = globalThis.__dboJournal.sweepRun ? globalThis.__dboJournal.sweepRun.i : -1;
  sweepTimer.fn();
  check('a sweep tick while one is under way does not start it again', !!globalThis.__dboJournal.sweepRun && globalThis.__dboJournal.sweepRun.i === pos, pos);
  load();
  check('a hot reload keeps the sweep under way', !!globalThis.__dboJournal.sweepRun && globalThis.__dboJournal.sweepRun.i === pos, globalThis.__dboJournal.sweepRun);
  ticks = 0;
  if (timers.journalSweepStep) while (globalThis.__dboJournal.sweepRun && ticks < 100) { timers.journalSweepStep.fn(); ticks++; }
  check('...and finishes it', !globalThis.__dboJournal.sweepRun && fs.existsSync(at(ids[3])));

  // ---- the whole sweep at once (staff, the old harness) still works ----------------------------------------------
  check('sweep() still runs a whole sweep at once and moves the second orphan on its second listing', J2.sweep() === 1 && fs.existsSync(aside(ids[3])), fs.existsSync(at(ids[3])));
  process.uptime = () => 60;
  sweepTimer.fn();
  check('no sweep starts in the first minutes after a boot', !globalThis.__dboJournal.sweepRun);
  process.uptime = realUptime;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
