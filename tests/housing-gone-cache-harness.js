// A reference a plugin update deleted throws on every read, and the C++ side logs the exception each time it is asked,
// not once per reference: one stale claim (d9643:BSHeartland, a door DragonBreak Online Edits deletes) made about
// 43,000 error lines on 20 Oct, four fifths of the day's. housingSystem now remembers a reference whose read says
// "doesn't exist" and never reads it again while the process lives. Only that message is remembered: a record not yet
// loaded after boot reads as null without throwing, and any other failure may pass, so neither is written off.
//
//   node tests/housing-gone-cache-harness.js <bundled housingSystem.js>
'use strict';
const path = require('path');

const bundle = process.argv[2];
if (!bundle) { console.error('usage: node tests/housing-gone-cache-harness.js <bundled housingSystem.js>'); process.exit(2); }
const { HousingSystem } = require(path.resolve(bundle));
const sysProbe = new HousingSystem(() => {});
if (typeof sysProbe.formGone !== 'function' || !/this\.gone/.test(String(sysProbe.primaryOf))) {
  require('./expect')('housing-gone-cache', 'this housingSystem does not remember unloadable references');
  console.log('ok   skipped: this housingSystem does not remember unloadable references'); process.exit(0);
}

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!cond) fails++; };

const DEAD = 0x80d9643, FLAKY = 0x80d9644, LIVE = 0x80d97a2;
const reads = new Map();
const logs = [];
const RECORD = { owner: 49, ownerName: 'Magister Elion Sunspeaker', name: null, locked: true, serial: 1, partner: 0, containers: [], issued: [] };
const mp = {
  get: (id, key) => {
    const r = id >>> 0;
    reads.set(r, (reads.get(r) || 0) + 1);
    if (r === DEAD) throw new Error(`Form with id 0x${DEAD.toString(16)} doesn't exist`);
    if (r === FLAKY) throw new Error('Refr pointer expired');
    if (r === LIVE && key === 'private.housing') return JSON.parse(JSON.stringify(RECORD));
    return undefined;
  },
  set: () => {},
  getUserByActor: () => -1,
  getUserActor: () => 0,
  isConnected: () => false,
  sendCustomPacket: () => {},
};
const ctx = { svr: mp };
const fresh = () => {
  const sys = new HousingSystem((t) => logs.push(String(t)));
  sys.holdOf = () => null; sys.isAdmin = () => false; sys.holdRanks = () => []; sys.partnerOf = () => 0;
  sys.saveRegistry = () => {}; sys.isClaimable = () => false;
  return sys;
};
const countOf = (r) => reads.get(r >>> 0) || 0;
const clear = () => { reads.clear(); logs.length = 0; };

// ---- a deleted reference is read once, then never again -------------------------------------------------------------
let sys = fresh(); clear();
ok('primaryOf on a deleted reference answers 0', sys.primaryOf(ctx, DEAD) === 0 && countOf(DEAD) === 1, [sys.primaryOf(ctx, DEAD), countOf(DEAD)]);
clear();
ok('...and a second call answers 0 without reading it again', sys.primaryOf(ctx, DEAD) === 0 && countOf(DEAD) === 0, countOf(DEAD));
ok('read() on it answers null without reading it', sys.read(ctx, DEAD) === null && countOf(DEAD) === 0, countOf(DEAD));
ok('loadable() answers false without reading it', sys.loadable(ctx, DEAD) === false && countOf(DEAD) === 0, countOf(DEAD));
ok('formGone() answers true without reading it', sys.formGone(ctx, DEAD) === true && countOf(DEAD) === 0, countOf(DEAD));
ok('a hundred more reads ask the server nothing', (() => { for (let i = 0; i < 100; i++) { sys.primaryOf(ctx, DEAD); sys.read(ctx, DEAD); sys.loadable(ctx, DEAD); } return countOf(DEAD) === 0; })(), countOf(DEAD));

// ---- the log still names it once ------------------------------------------------------------------------------------
sys = fresh(); clear();
for (let i = 0; i < 5; i++) sys.primaryOf(ctx, DEAD);
ok('the log names the reference once, not once per read', logs.filter((t) => /cannot hold a claim/.test(t)).length === 1, logs);

// ---- any other failure is not written off ---------------------------------------------------------------------------
sys = fresh(); clear();
ok('a failure that is not "doesn\'t exist" answers 0 too', sys.primaryOf(ctx, FLAKY) === 0, sys.primaryOf(ctx, FLAKY));
clear();
sys.primaryOf(ctx, FLAKY); sys.primaryOf(ctx, FLAKY);
ok('...but is read again every time, so a passing trouble is not permanent', countOf(FLAKY) === 2, countOf(FLAKY));
ok('loadable() keeps asking about it as well', (clear(), sys.loadable(ctx, FLAKY) === false && countOf(FLAKY) === 1), countOf(FLAKY));
ok('formGone() says it is not gone', (clear(), sys.formGone(ctx, FLAKY) === false), undefined);

// ---- a reference that loads is untouched ----------------------------------------------------------------------------
sys = fresh(); clear();
ok('a live reference still reads its record', sys.read(ctx, LIVE) !== null && sys.read(ctx, LIVE).owner === 49, sys.read(ctx, LIVE));
clear();
sys.read(ctx, LIVE); sys.read(ctx, LIVE); sys.loadable(ctx, LIVE);
ok('...and is asked every time, nothing cached in its way', countOf(LIVE) === 3, countOf(LIVE));
ok('the dead reference did not take the live one with it', (clear(), sys.primaryOf(ctx, DEAD), sys.read(ctx, LIVE) !== null), undefined);

// ---- the memory is bounded ------------------------------------------------------------------------------------------
sys = fresh();
const BASE = 0x81000000;
const deadMany = (n) => { for (let i = 0; i < n; i++) { const r = (BASE + i) >>> 0; try { sys.primaryOf({ svr: { get: () => { throw new Error(`Form with id 0x${r.toString(16)} doesn't exist`); } } }, r); } catch (e) { /* none */ } } };
deadMany(4100);
ok('after more dead references than the cache holds it starts over instead of growing without end',
  sys.gone.size > 0 && sys.gone.size <= 4096, sys.gone.size);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
