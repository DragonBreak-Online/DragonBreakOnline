// Scripted test for a Priest's aimed heal raising a fallen player whose body the hit never reached (downed.js, 23 Oct:
// Drink-In-Lean stood over Marcus and cast Heal Other 11 times, and nobody rose). A body within reviveCloseRange counts
// whatever the aim; farther out the reviveConeDeg cone still decides; a heal that finds no body says why in the log.
// Run it from this folder's parent with
//
//   node tests/revive-aim-harness.js
'use strict';
const path = require('path');

const MODULE = path.resolve(__dirname, '..', 'downed.js');
let now = 1790000000000;
Date.now = () => now;
const timers = [];
global.setTimeout = (f) => { timers.push(f); return timers.length; };
global.clearTimeout = () => {};
const runTimers = () => { while (timers.length) timers.shift()(); };

const P = 0xff000001, H = 0xff000002, WOLF = 0xff0000aa;
const HEAL_OTHER = 0x12fd2;
const props = new Map();
const set = (id, k, v) => props.set(id + '|' + k, v);
const get = (id, k) => props.get(id + '|' + k);
for (const [a, prof] of [[P, 1], [H, 2]]) {
  set(a, 'profileId', prof); set(a, 'isDead', false); set(a, 'percentages', { health: 1, stamina: 1, magicka: 1 });
  set(a, 'pos', [0, 0, 0]); set(a, 'worldOrCellDesc', '37edf:Skyrim.esm'); set(a, 'angle', [0, 0, 0]);
  set(a, 'spawnPoint', { cellOrWorldDesc: 'temple', pos: [1, 2, 3], rot: [0, 0, 0] });
}
set(H, 'private.mastery', { order: ['priest'], skills: { priest: { rank: 3 } } });
set(WOLF, 'profileId', -1);
const mp = {
  get: (id, k) => { const v = get(id, k); if (v === undefined && k === 'private.permaDead') return false; return v; },
  set: (id, k, v) => set(id, k, v),
  getIdFromDesc: (d) => parseInt(d, 16),
  getDescFromId: (id) => (id >>> 0).toString(16),
  lookupEspmRecordById: () => null,
  callPapyrusFunction: () => true,
  onHitDamageAttempt: () => true, onHitDamage: () => undefined, onDeath: () => undefined,
  onSpellHit: () => undefined, onSpellCast: () => undefined,
};
const audits = [], logs = [];
require(MODULE)({
  mp, log: (t) => logs.push(String(t)), personal: () => {}, sendPacket: () => true,
  onUi: () => {}, openWidget: () => {}, closeWidget: () => {},
  audit: (t) => audits.push(t), who: (a) => 'P' + (a >>> 0).toString(16), display: (a) => 'P' + (a >>> 0).toString(16),
  profileOf: (a) => Number(get(a, 'profileId')), nameOf: (a) => 'P' + (a >>> 0).toString(16),
  onlineActors: () => [P, H], every: () => {}, registerChatCommand: () => {}, cfg: { downed: { recoverSeconds: 0 } },
});

let failures = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '   ' + detail : ''}`); if (!ok) failures++; };
const revived = () => audits.filter((t) => /^REVIVE /.test(t)).length;
// P falls to a wolf at pos; H stands at the origin facing heading (0 = +y) and casts Heal Other, which hits nothing
const trial = (pos, heading) => {
  globalThis.__dboDownedState.downed.clear(); timers.length = 0; audits.length = 0; logs.length = 0; now += 600000;
  set(P, 'isDead', false); set(P, 'pos', pos); set(H, 'angle', [0, 0, heading]);
  set(P, 'isDead', true); mp.onDeath(P, WOLF);
  now += 5000; mp.onSpellCast(H, HEAL_OTHER); runTimers();
  return revived();
};

check('a body 1.6 m away rises though the healer faces away', trial([100, 50, 0], 180) === 1, audits.join(' | '));
check('a body 3 m away rises with the healer looking past it by 90 degrees', trial([200, 0, 0], 0) === 1, audits.join(' | '));
check('a body 15 m ahead rises (the cone)', trial([0, 1000, 0], 0) === 1, audits.join(' | '));
check('a body 15 m off to the side does not', trial([1000, 0, 0], 0) === 0, audits.join(' | '));
check('...and the log says where it lay', logs.some((t) => /healing found no body .*cell same dead true dist 1000 off 90/.test(t)), logs.join(' | '));
check('a body beyond reviveRange does not rise', trial([0, 1600, 0], 0) === 0);
set(H, 'private.mastery', { order: ['priest'], skills: { priest: { rank: 2 } } });
check('an Adept Priest raises nobody, however close', trial([100, 0, 0], 0) === 0);
console.log(failures ? `${failures} FAILED` : 'all checks passed');
process.exitCode = failures ? 1 : 0;
