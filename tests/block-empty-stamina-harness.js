// combat.js: a blocker already at 0 stamina has no guard, so every blocked blow lands in full (ghostmantle, luckystefan,
// #bugs 12-16 Oct "Blocking with no stamina has no consequence", "Bandits can block even with 0 stamina").
// node tests/block-empty-stamina-harness.js
const path = require('path');
const cfg = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'gamemode-config.json'), 'utf8'));
const SWORD = 0x600;
let P, calls, clock = 1e12;
const realNow = Date.now; Date.now = () => clock;
const reset = () => { P = { 1: { health: 1, magicka: 1, stamina: 1 }, 2: { health: 1, magicka: 1, stamina: 1 }, 9: { health: 1, magicka: 1, stamina: 1 } }; calls = []; globalThis.__dboCombat = undefined; };
const mp = {
  get: (a, k) => (k === 'percentages' ? P[a] : k === 'equipment' ? { inv: { entries: [] } } : null),
  set: (a, k, v) => { if (k === 'percentages') P[a] = v; },
  getDescFromId: (a) => `${a.toString(16)}:x`, callPapyrusFunction: (...args) => calls.push(args), getHoster: () => 0,
};
const API = { mp, log: () => {}, profileOf: (a) => (a === 1 || a === 2 ? a : -1), masteryOf: () => null,
  wornOf: (e) => e.inv.entries, recordOf: (id) => (id === SWORD ? { record: { type: 'WEAP', fields: [] } } : null),
  fieldsOf: () => [], weaponSkillOf: (s) => (s === SWORD ? 'blade' : ''), display: String, cfg, sendPacket: () => {} };
const combat = () => require(path.join(__dirname, '..', 'combat.js'))(API);
let pass = 0, fail = 0;
const ok = (c, what, extra) => { if (c) pass++; else { fail++; console.log('FAIL', what, extra === undefined ? '' : JSON.stringify(extra)); } };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const blow = (agg, tgt) => combat().onAttempt(agg, tgt, SWORD, 0, { blocked: true, unblockedDamage: 40, targetMaxHealth: 200, targetMaxStamina: 100 }, 1);
const staggers = () => calls.filter((c) => c[2] === 'SendAnimationEvent').length;

// An NPC at 0 stamina: the first blocked blow already lands in full, and so does one after the guard-break window
reset(); P[9].stamina = 0; blow(1, 9);
ok(near(P[9].health, 1 - 40 / 200), 'NPC at 0 stamina: the first blocked blow lands in full', P[9]);
ok(staggers() === 0, 'and the NPC is not staggered');
clock += 5000; P[9].health = 1; blow(1, 9);
ok(near(P[9].health, 1 - 40 / 200), 'still at 0 after the 2 s window: the next blow lands in full too (was a 30% chip)', P[9]);
// A player at 0 stamina blocking an NPC, and a player blocking a player
reset(); P[2].stamina = 0; blow(9, 2);
ok(near(P[2].health, 1 - 40 / 200), 'player at 0 stamina blocking an NPC: the blow lands in full', P[2]);
ok(staggers() === 0, 'an NPC never staggers a player here (playersOnly)');
reset(); P[2].stamina = 0; blow(1, 2);
ok(near(P[2].health, 1 - 40 / 200), 'player at 0 stamina blocking a player: the blow lands in full', P[2]);
// Unchanged: with stamina left, a block still chips 30% and costs the rest
reset(); P[9].stamina = 0.5; blow(1, 9);
ok(near(P[9].health, 1 - 12 / 200) && near(P[9].stamina, 0.5 - 28 / 100), 'with stamina left the block chips and costs stamina as before', P[9]);
// Unchanged: the blow that empties stamina chips, breaks the guard, and the next one lands in full
reset(); P[9].stamina = 0.1; blow(1, 9);
ok(near(P[9].health, 1 - 12 / 200) && P[9].stamina === 0, 'the emptying blow still chips', P[9]);
P[9].health = 1; blow(1, 9);
ok(near(P[9].health, 1 - 40 / 200), 'the next blow lands in full', P[9]);
// Without the maxima the C++ sends, nothing changes (no stamina known)
reset(); P[9].stamina = 0; combat().onAttempt(1, 9, SWORD, 0, { blocked: true, unblockedDamage: 40 }, 1);
ok(near(P[9].health, 1), 'without maxima the empty-guard rule is skipped', P[9]);
Date.now = realNow;
console.log(`block-empty-stamina: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
