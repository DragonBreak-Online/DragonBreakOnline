// Scripted test for anticheat.js's interim vitals checks (ac-vitals-interim, ANTI-CHEAT DESIGN 17 Oct). magicka_free: a
// replay of 20 minutes of live stored percentages with the casts made in them (tests/fixtures/anticheat-vitals-sample1.json,
// anonymised) pins none; a client frozen at full magicka is flagged; Fortify gear of the school, a potion, a well, a refill,
// a held charge, a concentration channel and a server freeze are not; concentration taps and casts under a magicka regen
// potion (MagickaRateMult +50% or more) pin only on a bar frozen to the bit, and concentration pins alone never flag, so
// Wall of Flames tapped under regen on a client that reports as sendInputsService does is not flagged (6 Nov). The regen
// window covers a cast whose drop shows in a report; at +200% an honest fire-and-forget cast refilled before the first
// report still pins on the frozen-bar path and is refused, a known residual pinned here. Each spell's record is read once.
// stamina_free: frozen stamina through a 25 s sprint is flagged (shadow), a draining one is not. refuseHits: off by
// default, and on, a flagged caster's spell hits are refused while weapon hits are not.
//   node tests/anticheat-vitals-harness.js   (from server/)
'use strict';
const path = require('path');
const fs = require('fs');
const F = require('./lib/anticheat-fakes.js');
const { ok } = F;

const SPELLS = {
  ConjureFamiliar: [0x640b6, { cost: 107, school: 19 }], ConjureFlameAtronach: [0x204c3, { cost: 150, school: 19 }],
  Firebolt: [0x12fcd, { cost: 41, school: 20 }], Fireball: [0x1c789, { cost: 133, school: 20 }],
  WardLesser: [0x2f3b8, { cost: 34, castType: 2, school: 22 }], Healing: [0x12fcc, { cost: 12, castType: 2, school: 22 }],
  Oakflesh: [0x5ad5c, { cost: 103, school: 18 }], Candlelight: [0x43324, { cost: 21, school: 18 }],
  Sparks: [0x2dd2a, { cost: 19, castType: 2, school: 20 }], VampireDrain01: [0xe5f51, { cost: 6, castType: 2, school: 20 }],
  HowlWerewolfFear1: [0x3b4a8, { cost: 0, type: 11, school: -1 }],
};
const A = 0xff000014, B = 0xff000015, NPC = 0x0001b0e2;
const POTION = 0x39be5, FORT_CONJ = 0xa9550, ENCH_FC = 0xa9551, CIRCLET = 0x166ff, FORT_CONJ_PLAYER = 0xa9552, SWORD = 0x12eb7;
const setup = (anticheat) => {
  const W = F.makeWorld();
  for (const [edid, [id, o]] of Object.entries(SPELLS)) W.spell(id, edid, o);
  W.mgef(FORT_CONJ, 'EnchFortifyConjurationConstantSelf', { archetype: 0, av: 109 });
  W.mgef(FORT_CONJ_PLAYER, 'DBOFortifyConjuration', {});
  W.ench(ENCH_FC, 'EnchCircletFortifyConjuration03', [FORT_CONJ]);
  W.armo(CIRCLET, 'EnchCircletFortifyConjuration03', ENCH_FC);
  W.record(SWORD, 'WEAP', 'IronSword', []);
  const H = F.makeApi(W, { anticheat });
  const calls = F.baseSlots(W.mp);
  H.addPlayer(A, { name: 'Casterly', tag: 'C4ST', profile: 1 });
  H.addPlayer(B, { name: 'Selene', tag: 'K2QX', profile: 2 });
  const G = F.load(H.api, true);
  H.tick(0);
  return { W, H, G, calls };
};
const acLines = (H) => H.logs.filter((l) => l.startsWith('ANTICHEAT '));
const id = (edid) => SPELLS[edid][0];
// run the clock to t (ms), a tick a second, casting the events (sorted [t, actor, spell]) at their times
const playTo = (H, W, t, events) => {
  const ev = events || [];
  let i = 0;
  while (H.clock.t < t) {
    const nextTick = H.t0 + (Math.floor((H.clock.t - H.t0) / 1000) + 1) * 1000;
    while (i < ev.length && ev[i][0] <= nextTick && ev[i][0] <= t) { H.clock.t = Math.max(H.clock.t, ev[i][0]); if (ev[i][3]) ev[i][3](); else W.mp.onSpellCast(ev[i][1], ev[i][2]); i++; }
    if (nextTick > t) { H.clock.t = t; break; }
    H.clock.t = nextTick; H.run('acSpeedWatch');
  }
  return i;
};
const pend = (G, a) => (G.ST.players.get(a) || { casts: [] }).casts.length;
const pinned = (G, a) => (G.ST.players.get(a) || { pinned: [] }).pinned.length;

// ---- the live replay: 20 minutes, the casts in them, none pinned ---------------------------------------------------------------
for (const minCost of [30, 10]) {
  const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'anticheat-vitals-sample1.json'), 'utf8'));
  const { W, H, G } = setup({ magicka: { minCost } });
  H.t0 = H.clock.t;
  const T0 = H.clock.t;
  const actors = new Map();
  let k = 0;
  for (const [name, p] of Object.entries(FX.players)) {
    const a = 0xff200000 + (++k);
    actors.set(name, a);
    H.addPlayer(a, { name: `Player ${name}`, tag: `R${String(k).padStart(3, '0')}`, profile: 200 + k });
    const series = p.series;
    // the stored percentages at the clock: the last sample at or before it
    W.set(a, 'percentages', () => {
      const rel = H.clock.t - T0;
      let lo = 0, hi = series.length - 1, at = 0;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (series[mid][0] <= rel) { at = mid; lo = mid + 1; } else hi = mid - 1; }
      return { health: 1, magicka: series[at][1], stamina: series[at][2] };
    });
    W.set(a, 'pos', [k * 10000, 0, 0]);
  }
  const events = [];
  for (const [name, p] of Object.entries(FX.players)) for (const [t, edid] of p.casts) if (SPELLS[edid]) events.push([T0 + t, actors.get(name), id(edid)]);
  events.sort((x, y) => x[0] - y[0]);
  // count the casts the check took up (at full, costly, type 0)
  let judged = 0;
  const realPush = Array.prototype.push;
  for (const a of actors.values()) { H.run('acSpeedWatch'); const st = G.ST.players.get(a); if (st) st.casts.push = function (...x) { judged += x.length; return realPush.apply(this, x); }; }
  playTo(H, W, T0 + FX.windowMs + 60000, events);
  const pins = [...actors.values()].reduce((s, a) => s + pinned(G, a), 0);
  const costly = events.filter(([, , sp]) => { const e = Object.entries(SPELLS).find(([, v]) => v[0] === sp); return e && (e[1][1].type || 0) === 0 && e[1][1].cost >= minCost; }).length;
  ok(events.length === 65 && pins === 0 && !acLines(H).some((l) => /magicka_free/.test(l)),
    `the live 20 minutes (minCost ${minCost}): ${events.length} casts, ${costly} at that cost, ${judged} of them made at full magicka and judged, 0 pinned, no flag`, { pins, judged, lines: acLines(H) });
}

// ---- a client frozen at full magicka -----------------------------------------------------------------------------------------
{
  const { W, H, G } = setup({});
  H.t0 = H.clock.t;
  const t0 = H.clock.t;
  const ev = []; for (let i = 0; i < 40; i++) ev.push([t0 + 500 + i * 3000, A, id('ConjureFamiliar')]);
  let flagAt = 0;
  for (let s = 1; s <= 200 && !flagAt; s++) { playTo(H, W, t0 + s * 1000, ev.filter((e) => e[0] > t0 + (s - 1) * 1000 && e[0] <= t0 + s * 1000)); if (acLines(H).some((l) => /magicka_free/.test(l))) flagAt = H.clock.t; }
  const line = acLines(H).find((l) => /magicka_free/.test(l));
  const nth = 12; // 12 x 107 = 1284, the first count at or over flagMinCost 1200 (8 x 107 = 856 is not)
  const castN = t0 + 500 + (nth - 1) * 3000;
  ok(!!line && /^ANTICHEAT magicka_free Casterly #C4ST \(profile 1\): 12 costly casts in 10 min at full magicka with no drop after \(ConjureFamiliar; 1284 spell cost in all\), stored magicka 1\.000-1\.000 through each/.test(line),
    'frozen at 1.0, ConjureFamiliar every 3 s: flagged at the 12th pinned cast (8 or more AND 1284 >= 1200 spell cost)', line);
  ok(flagAt > castN && flagAt <= castN + 30000 + 1000, `...${((flagAt - castN) / 1000).toFixed(0)} s after that cast (the stored value never moved: the 30 s report-hold wait)`, { flagAt: flagAt - t0, castN: castN - t0 });
  ok(H.staff.length === 0 || H.staff.every(([x]) => x !== A), '...nothing said to the caster');
}
{
  // a trainer that lets the bar wobble a little (it reports, but never below 0.99): judged after 6 s
  const { W, H } = setup({});
  H.t0 = H.clock.t;
  const t0 = H.clock.t;
  W.set(A, 'percentages', () => ({ health: 1, magicka: Math.floor((H.clock.t - t0) / 1000) % 2 ? 0.996 : 1, stamina: 1 }));
  const ev = []; for (let i = 0; i < 12; i++) ev.push([t0 + 500 + i * 3000, A, id('Fireball')]);
  playTo(H, W, t0 + 50000, ev);
  const line = acLines(H).find((l) => /magicka_free/.test(l));
  ok(!!line && /: 10 costly casts .*\(Fireball; 1330 spell cost in all\)/.test(line), 'a bar that moves but never drops below 0.99: the 10th Fireball (1330) flags, 6 s after it', line);
}

// ---- what is never pinned -----------------------------------------------------------------------------------------------------
{
  // a caster with Fortify gear: ConjureFlameAtronach with a Fortify Conjuration circlet, frozen at full
  const { W, H, G } = setup({});
  W.set(A, 'equipment', { inv: { entries: [{ baseId: CIRCLET, count: 1, worn: true }] } });
  const t0 = H.clock.t; H.t0 = t0;
  const ev = []; for (let i = 0; i < 12; i++) ev.push([t0 + 500 + i * 4000, A, id('ConjureFlameAtronach')]);
  playTo(H, W, t0 + 100000, ev);
  const st = G.ST.players.get(A);
  ok(pinned(G, A) === 0 && st.gearSkipped === 12 && !acLines(H).length, 'Fortify Conjuration gear worn (the item\'s own enchantment): 12 Flame Atronachs skipped, none pinned', { pinned: pinned(G, A), skipped: st.gearSkipped });
  W.set(A, 'equipment', { inv: { entries: [{ baseId: 0x1be1b, count: 1, worn: true, enchantmentEffects: [{ effectId: FORT_CONJ_PLAYER, magnitude: 20, cost: 0, area: 0, duration: 0 }] }] } });
  W.mp.onSpellCast(A, id('ConjureFlameAtronach'));
  ok(pend(G, A) === 0 && st.gearSkipped === 13, '...a player-made Fortify Conjuration enchantment is read as well');
  W.set(A, 'equipment', { inv: { entries: [{ baseId: CIRCLET, count: 1, worn: true }] } });
  W.mp.onSpellCast(A, id('Fireball'));
  ok(pend(G, A) === 1, '...and it covers its own school only (a Fireball is judged)');
}
{
  const { W, H, G } = setup({});
  const t0 = H.clock.t; H.t0 = t0;
  W.mp.onEatItem(A, POTION);
  H.clock.t = t0 + 4000; W.mp.onSpellCast(A, id('Fireball'));
  ok(pend(G, A) === 0, 'a cast 4 s after drinking a potion: skipped');
  H.clock.t = t0 + 7000; W.mp.onSpellCast(A, id('Fireball'));
  ok(pend(G, A) === 1, '...7 s after: judged');
  globalThis.__dboWellRegen = new Map([[A, H.clock.t + 300000]]);
  W.mp.onSpellCast(A, id('Fireball'));
  ok(pend(G, A) === 1, 'during an Ayleid well\'s regeneration: skipped');
  delete globalThis.__dboWellRegen;
  W.set(A, 'percentages', { health: 1, magicka: 0.6, stamina: 1 });
  W.mp.onSpellCast(A, id('Fireball'));
  ok(pend(G, A) === 1, 'a cast with the bar not full: not this check\'s');
  W.mp.onSpellCast(NPC, id('Fireball'));
  ok(!G.ST.players.has(NPC), 'an NPC\'s cast: nothing kept');
  W.set(A, 'percentages', { health: 1, magicka: 1, stamina: 1 });
  W.mp.onSpellCast(A, id('Candlelight'));
  W.mp.onSpellCast(A, id('HowlWerewolfFear1'));
  ok(pend(G, A) === 1, 'a spell under minCost (Candlelight 21) and a Voice power: not judged');
}
{
  // a concentration channel: the client sends no bars while it channels, then the drop at 10 s
  const { W, H, G } = setup({});
  const t0 = H.clock.t; H.t0 = t0;
  W.set(A, 'percentages', () => ({ health: 1, magicka: H.clock.t - t0 < 10000 ? 1 : 0.85, stamina: 1 }));
  playTo(H, W, t0 + 40000, [[t0 + 200, A, id('WardLesser')]]);
  ok(pinned(G, A) === 0 && pend(G, A) === 0, 'a concentration channel whose drop shows at 10 s: not pinned');
  // a charged Fireball held 12 s before the release: the value stays the same to the bit, then drops
  W.set(A, 'percentages', () => ({ health: 1, magicka: H.clock.t - t0 < 52000 ? 1 : 0.7, stamina: 1 }));
  playTo(H, W, t0 + 80000, [[t0 + 40200, A, id('Fireball')]]);
  ok(pinned(G, A) === 0, 'a charged spell held 12 s before its release (the client holds its bars): not pinned');
  // a server freeze right after a cast: the frozen time does not count, and a drop inside the hold still clears the cast
  W.set(A, 'percentages', () => ({ health: 1, magicka: H.clock.t - t0 < 81000 ? 1 : H.clock.t - t0 < 103000 ? 0.996 : H.clock.t - t0 < 106000 ? 0.95 : 1, stamina: 1 }));
  playTo(H, W, t0 + 81000, [[t0 + 80500, A, id('Fireball')]]);
  H.clock.t = t0 + 102000; H.run('acSpeedWatch');
  ok(pend(G, A) === 1 && pinned(G, A) === 0, 'a 21 s server freeze after a cast (the bar moved a little meanwhile): the late tick pins nothing');
  playTo(H, W, t0 + 140000, []);
  ok(pinned(G, A) === 0 && pend(G, A) === 0, '...and the drop that lands inside the stall hold, refilled before it ends, still clears the cast');
}
// ---- concentration taps and magicka regen potions (6 Nov) -----------------------------------------------------------------------
// a quarter-second tap of Detect Life (SPIT 200 a second) is regenerated before the client's next report of the bar
const DETECT = 0x211ee, BOLT = 0x7a001, WALL = 0x7a002, REGEN_FX = 0x3eb07, RESTORE_FX = 0x3eb17, DAMAGE_REGEN_FX = 0x7a201;
const REGEN_POT = 0x7a101, LONG_POT = 0x7a102, RESTORE_POT = 0x7a103, REGEN_ROOT = 0x7a104, SAP = 0x7a105, FORTIFY_POT = 0x7a106, FORTIFY_FX = 0x3eb08;
const T1_POT = 0x7a107, WEAK_POT = 0x7a108, WEAK_ROOT = 0x7a109, RATE_POT = 0x7a10a, RATE_FX = 0x7a202, T5_POT = 0x7a10b;
const setupRegen = (anticheat) => {
  const S = setup(anticheat);
  const { W } = S;
  W.spell(DETECT, 'DetectLife', { cost: 200, castType: 2, school: 18 });
  W.spell(BOLT, 'CostlyBolt', { cost: 200, school: 20 });
  W.spell(WALL, 'WallOfFlames', { cost: 118, castType: 2, school: 20 });
  W.mgef(REGEN_FX, 'AlchFortifyMagickaRate', { archetype: 0, av: 156 });
  W.mgef(RESTORE_FX, 'AlchRestoreMagicka', { archetype: 0, av: 25 });
  W.mgef(FORTIFY_FX, 'AlchFortifyMagicka', { archetype: 34, av: 25 });
  // flags 0x4 (detrimental), archetype 0, MagickaRateMult
  W.record(DAMAGE_REGEN_FX, 'MGEF', 'AlchDamageMagickaRate', [{ type: 'DATA', data: F.bytes(0x98, [[0, 'u', 4], [4, 'f', 1], [0x0c, 'u', -1], [0x44, 'u', 156]]) }]);
  const eff = (fx, mag, dur) => [{ type: 'EFID', data: F.u32(fx) }, { type: 'EFIT', data: F.bytes(12, [[0, 'f', mag], [8, 'u', dur]]) }];
  W.record(REGEN_POT, 'ALCH', 'TestRegenMagicka150', eff(REGEN_FX, 150, 300));
  W.record(LONG_POT, 'ALCH', 'TestRegenMagickaLong', eff(REGEN_FX, 150, 900));
  W.record(RESTORE_POT, 'ALCH', 'TestRestoreMagicka', eff(RESTORE_FX, 50, 0));
  W.record(FORTIFY_POT, 'ALCH', 'TestFortifyMagicka60s', eff(FORTIFY_FX, 50, 60));
  W.record(REGEN_ROOT, 'INGR', 'TestRootRestoreThenRegen', [...eff(RESTORE_FX, 1, 0), ...eff(REGEN_FX, 50, 300)]);
  W.record(SAP, 'INGR', 'TestSapDamageRegen', eff(DAMAGE_REGEN_FX, 100, 300));
  W.mgef(RATE_FX, 'TestFortifyMagickaRateAV28', { archetype: 0, av: 28 });
  W.record(T1_POT, 'ALCH', 'TestRegenMagicka50', eff(REGEN_FX, 50, 300));
  W.record(WEAK_POT, 'ALCH', 'TestRegenMagicka1', eff(REGEN_FX, 1, 300));
  W.record(WEAK_ROOT, 'INGR', 'TestRootRegenMagicka1', eff(REGEN_FX, 1, 300));
  W.record(RATE_POT, 'ALCH', 'TestMagickaRate50', eff(RATE_FX, 50, 300));
  W.record(T5_POT, 'ALCH', 'TestRegenMagicka200', eff(REGEN_FX, 200, 300));
  S.H.t0 = S.H.clock.t;
  return S;
};
// `spell` every 3-3.4 s; moving: the one read 0.77-1.77 s after each cast is 0.993-0.998, every other read 1.000
const taps = (S, spell, from, to, moving) => {
  const { W, H, G } = S, t0 = H.t0, bar = { last: -1e9, n: 0, judged: 0 };
  W.set(A, 'percentages', () => { const d = H.clock.t - bar.last; return { health: 1, magicka: moving && d >= 770 && d < 1770 ? 0.993 + (bar.n % 6) * 0.001 : 1, stamina: 1 }; });
  const ev = [];
  for (let i = 0; ; i++) {
    const at = t0 + from + i * 3000 + ((i * 7) % 5) * 100;
    if (at >= t0 + to) break;
    ev.push([at, A, 0, () => { const n = pend(G, A); W.mp.onSpellCast(A, spell); if (pend(G, A) > n) bar.judged++; bar.last = H.clock.t; bar.n++; }]);
  }
  return { ev, bar };
};
const mfLines = (H) => acLines(H).filter((l) => /magicka_free/.test(l));
{
  // Detect Life tapped every 3 s for 10 min at full magicka, the bar moving 0.993-1.000: the false positive of 6 Nov
  const S = setupRegen({ magicka: { refuseHits: true } });
  const { ev, bar } = taps(S, DETECT, 500, 600500, true);
  playTo(S.H, S.W, S.H.t0 + 640000, ev);
  ok(ev.length === 200 && bar.judged === 200 && pinned(S.G, A) === 0 && !mfLines(S.H).length, `Detect Life tapped every 3 s for 10 min, the bar moving 0.993-1.000: ${bar.judged} taps judged, none pinned, no flag`, { judged: bar.judged, pinned: pinned(S.G, A), lines: mfLines(S.H) });
  ok(S.W.mp.onHitDamageAttempt(A, B, DETECT, 30, { spell: true }) === true, '...and their spell hits on players land');
}
{
  // the same taps and the same moving bar with a fire-and-forget spell of the same cost: judged as before, flagged
  const S = setupRegen({});
  const { ev } = taps(S, BOLT, 500, 120500, true);
  playTo(S.H, S.W, S.H.t0 + 160000, ev);
  const L = mfLines(S.H);
  ok(!!L[0] && /: 8 costly casts in 10 min at full magicka with no drop after \(CostlyBolt; 1600 spell cost in all\), stored magicka 0\.99\d-1\.000 through each/.test(L[0]),
    'a fire-and-forget spell of cost 200 every 3 s, the same moving bar, no potion: flagged at the 8th cast as before', L[0]);
}
{
  // a frozen bar spamming Detect Life: pinned on the frozen-bar path, but concentration pins alone are not flagged
  const S = setupRegen({ magicka: { refuseHits: true } });
  const { ev } = taps(S, DETECT, 500, 60500, false);
  playTo(S.H, S.W, S.H.t0 + 100000, ev);
  ok(pinned(S.G, A) === 20 && !mfLines(S.H).length && S.W.mp.onHitDamageAttempt(A, B, DETECT, 30, { spell: true }) === true,
    `Detect Life spammed every 3 s on a bar frozen at exactly 1.000: ${pinned(S.G, A)} pinned, no flag (an honest tap refilled before the first report looks the same)`, { pinned: pinned(S.G, A), lines: mfLines(S.H) });
  // the same frozen bar with a fire-and-forget cast among them: the concentration pins count toward its flag
  const S2 = setupRegen({});
  const { ev: ev2 } = taps(S2, DETECT, 500, 120500, false);
  ev2.push([S2.H.t0 + 2000, A, BOLT]);
  ev2.sort((x, y) => x[0] - y[0]);
  playTo(S2.H, S2.W, S2.H.t0 + 160000, ev2);
  const L = mfLines(S2.H);
  ok(!!L[0] && /: 8 costly casts in 10 min at full magicka with no drop after \((DetectLife, CostlyBolt|CostlyBolt, DetectLife); 1600 spell cost in all\), stored magicka 1\.000-1\.000 through each/.test(L[0]),
    '...the same frozen bar with one fire-and-forget cast of cost 200 among the taps: flagged at the 8th pinned cast', L[0]);
}
{
  // a +150% regen potion of 300 s, then a cost 200 spell every 3 s on a moving bar: no flag in the window, old rules after
  const S = setupRegen({ magicka: { refuseHits: true } });
  const { W, H, G } = S, t0 = H.t0;
  W.mp.onEatItem(A, REGEN_POT);
  const st = G.ST.players.get(A);
  ok(st.regenUntil === t0 + 300000, 'a regen potion of 300 s (MagickaRateMult +150%): a 300 s regen window from the drink', st.regenUntil - t0);
  const { ev, bar } = taps(S, BOLT, 7000, 420000, true);
  playTo(H, W, t0 + 300000, ev);
  const inside = bar.judged;
  ok(inside >= 90 && pinned(G, A) === 0 && !mfLines(H).length, `...${inside} casts at full magicka inside it, the bar moving 0.993-1.000: none pinned, no flag`, { inside, pinned: pinned(G, A), lines: mfLines(H) });
  playTo(H, W, t0 + 460000, ev.filter((e) => e[0] > H.clock.t));
  const L = mfLines(H);
  ok(L.length >= 1 && /\(CostlyBolt; 1600 spell cost in all\)/.test(L[0]) && st.pinned.length >= 8 && st.pinned.every((e) => e.t >= t0 + 300000),
    '...the window ends with the effect: the casts after it are judged by the old rules and flagged, none from inside it', { lines: L.slice(0, 1), first: st.pinned.length ? st.pinned[0].t - t0 : null });
}
{
  // a frozen bar inside a regen potion's window: still caught there
  const S = setupRegen({});
  const { W, H, G } = S, t0 = H.t0;
  W.mp.onEatItem(A, REGEN_POT);
  const { ev } = taps(S, BOLT, 7000, 290000, false);
  playTo(H, W, t0 + 299000, ev);
  const L = mfLines(H);
  ok(G.ST.players.get(A).regenUntil > H.clock.t && !!L[0] && /: 8 costly casts .*\(CostlyBolt; 1600 spell cost in all\), stored magicka 1\.000-1\.000/.test(L[0]),
    'a bar frozen at exactly 1.000 inside a regen potion\'s window: flagged within it', L[0]);
}
{
  // the window is the effect's own duration, capped by regenSkipMaxMs, and only a regen effect opens one
  const S = setupRegen({});
  const st = S.G.ST.players.get(A), t0 = S.H.clock.t;
  S.W.mp.onEatItem(A, LONG_POT);
  ok(st.regenUntil === t0 + 300000, 'a regen potion of 900 s: its window is capped at regenSkipMaxMs (300 s)', st.regenUntil - t0);
  const S2 = setupRegen({ magicka: { regenSkipMaxMs: 60000 } });
  S2.W.mp.onEatItem(A, REGEN_POT);
  ok(S2.G.ST.players.get(A).regenUntil === S2.H.clock.t + 60000, '...regenSkipMaxMs is read from the config (60 s)', S2.G.ST.players.get(A).regenUntil - S2.H.clock.t);
  const S3 = setupRegen({});
  const st3 = S3.G.ST.players.get(A);
  S3.W.mp.onEatItem(A, RESTORE_POT);
  S3.W.mp.onEatItem(A, FORTIFY_POT);
  S3.W.mp.onEatItem(A, REGEN_ROOT);
  S3.W.mp.onEatItem(A, SAP);
  S3.H.clock.t += 7000; S3.W.mp.onSpellCast(A, BOLT);
  ok(!(st3.regenUntil > 0) && st3.lastRefill === S3.H.clock.t - 7000 && pend(S3.G, A) === 1 && st3.casts[0].frozenOnly === false,
    'a Restore Magicka potion, a Fortify Magicka one of 60 s, an ingredient whose regen effect is not its first, a detrimental regen effect: the 6 s skip only, no regen window', { regenUntil: st3.regenUntil, casts: st3.casts });
  // the effect must be at least regenMinMagnitude (50) strong, on MagickaRateMult (AV 156)
  const S4 = setupRegen({});
  const st4 = S4.G.ST.players.get(A), t4 = S4.H.clock.t;
  S4.W.mp.onEatItem(A, T1_POT);
  ok(st4.regenUntil === t4 + 300000, 'a +50% regen potion of 300 s (the weakest DBO tier): a 300 s window', st4.regenUntil - t4);
  for (const [what, item] of [['a 1-point regen potion of 300 s', WEAK_POT], ['a 1-point regen ingredient eaten raw', WEAK_ROOT], ['a MagickaRate (AV 28) potion of 50 for 300 s', RATE_POT]]) {
    const S5 = setupRegen({});
    const st5 = S5.G.ST.players.get(A);
    S5.W.mp.onEatItem(A, item);
    S5.H.clock.t += 7000; S5.W.mp.onSpellCast(A, BOLT);
    ok(!(st5.regenUntil > 0) && st5.lastRefill === S5.H.clock.t - 7000 && pend(S5.G, A) === 1 && st5.casts[0].frozenOnly === false,
      `${what}: a refill (the 6 s skip), no regen window`, { regenUntil: st5.regenUntil, casts: st5.casts });
  }
  const S6 = setupRegen({ magicka: { regenMinMagnitude: 151 } });
  S6.W.mp.onEatItem(A, REGEN_POT);
  ok(!(S6.G.ST.players.get(A).regenUntil > 0), '...regenMinMagnitude is read from the config (151: the +150% potion opens none)', S6.G.ST.players.get(A).regenUntil);
}
// a client reporting its bar as sendInputsService does: a changed value only, once a second at most, none while casting or 500 ms after
const clientBar = (S, o) => {
  // regen runs throughout, 3% of the pool a second x (1 + bonus); a cast costs mult x SPIT, a second while held if concentration
  const { W, H } = S, step = 20, regen = (0.03 * (1 + o.bonus) * step) / 1000;
  const c = { t: H.t0, m: 1, sent: 1, sentAt: -1e9, castAt: -1e9, k: 0, cur: null, reads: [] };
  W.set(A, 'percentages', () => {
    while (c.t + step <= H.clock.t) {
      c.t += step;
      while (c.k < o.casts.length && H.t0 + o.casts[c.k][0] <= c.t) { c.cur = o.casts[c.k++]; if (!c.cur[3]) c.m -= (c.cur[1] * o.mult) / o.pool; }
      // IsCasting* is already set in the frame the first magicka is spent
      if (c.cur && c.t < H.t0 + c.cur[0] + c.cur[2]) { c.castAt = c.t; if (c.cur[3]) c.m -= (c.cur[1] * o.mult * step) / 1000 / o.pool; }
      c.m = Math.max(0, Math.min(1, c.m + regen));
      if (c.m !== c.sent && c.t - c.sentAt >= 1000 && c.t - c.castAt >= 500) { c.sent = c.m; c.sentAt = c.t; if (c.m < 1) c.reads.push(c.m); }
    }
    return { health: 1, magicka: c.sent, stamina: 1 };
  });
  return c;
};
// tap held times, 210-530 ms with a median of 270 (the 6 Nov trace)
const HELD = [270, 240, 310, 210, 280, 530, 260, 330, 250, 270, 420, 230, 290, 260, 480, 270];
// `spell` every `every` ms (plus up to 400 ms) up to `to`, on clientBar, a potion drunk at 0 and every 300 s if `potion`
const clientPlay = (S, o) => {
  const { W, H, G } = S, casts = [], ev = [], n = { judged: 0, pins: 0 }, st = G.ST.players.get(A), push = st.pinned.push;
  st.pinned.push = function (...x) { n.pins += x.length; return push.apply(this, x); };
  for (let i = 0; ; i++) {
    const at = 7000 + i * o.every + ((i * 7) % 5) * 100;
    if (at >= o.to) break;
    // [ms after t0, SPIT cost, ms held, concentration]
    casts.push([at, o.cost, o.held ? o.held[i % o.held.length] : 300, o.conc]);
    ev.push([H.t0 + at, A, 0, () => { const k = pend(G, A); W.mp.onSpellCast(A, o.spell); if (pend(G, A) > k) n.judged++; }]);
  }
  if (o.potion) for (let t = 300000; t < o.to; t += 300000) ev.push([H.t0 + t, A, 0, () => W.mp.onEatItem(A, o.potion)]);
  ev.sort((x, y) => x[0] - y[0]);
  // 0.35 x SPIT a second: the 6 Nov Detect Life taps' 15-20 magicka for a quarter second
  const c = clientBar(S, Object.assign({ casts, mult: 0.35 }, o));
  if (o.potion) W.mp.onEatItem(A, o.potion);
  playTo(H, W, H.t0 + o.to + 40000, ev);
  return Object.assign(n, { casts: casts.length, reads: c.reads, lines: mfLines(H) });
};
for (const [what, o] of [
  ['under a +150% regen potion, pool 280', { pool: 280, bonus: 1.5, potion: REGEN_POT }],
  ['under a +150% regen potion, pool 400', { pool: 400, bonus: 1.5, potion: REGEN_POT }],
  ['with +150% regen from gear (no potion, no window), pool 280', { pool: 280, bonus: 1.5 }],
]) {
  // Wall of Flames tapped: most taps are regenerated before the first report, so the stored value never moves
  const S = setupRegen({ magicka: { refuseHits: true } });
  const r = clientPlay(S, Object.assign({ spell: WALL, cost: 118, conc: true, every: 3000, to: 600000, held: HELD }, o));
  ok(r.judged >= 150 && r.pins >= 30 && !r.lines.length && S.W.mp.onHitDamageAttempt(A, B, WALL, 30, { spell: true }) === true,
    `Wall of Flames tapped 0.21-0.53 s every 3 s for 10 min ${what}, the client reporting as sendInputsService does: ${r.judged} taps judged, ${r.pins} pinned with the value unchanged, no flag, spell hits on players land`,
    { judged: r.judged, pins: r.pins, reads: r.reads.length, lines: r.lines.slice(0, 2) });
}
// KNOWN RESIDUAL (6 Nov review): at +200% regen an honest fire-and-forget cast is refilled before the first report, so it
// pins on the frozen-bar path, which the regen window keeps; these checks hold that until a fix flips them
for (const [what, o] of [
  ['Firebolt every 2.5 s, pool 500', { spell: id('Firebolt'), cost: 41, every: 2500, pool: 500 }],
  ['Fireball every 4 s, pool 600', { spell: id('Fireball'), cost: 133, every: 4000, pool: 600 }],
]) {
  const S = setupRegen({ magicka: { refuseHits: true } });
  const r = clientPlay(S, Object.assign({ conc: false, to: 600000, mult: 0.26, bonus: 2, potion: T5_POT }, o));
  ok(r.reads.length === 0 && r.lines.some((l) => /server: refusing their spell hits on players/.test(l)) && S.W.mp.onHitDamageAttempt(A, B, o.spell, 30, { spell: true }) === false,
    `residual: ${what} under a +200% regen potion, 0.26 x SPIT a cast, the client never reporting a drop: ${r.pins} pinned on the frozen-bar path, flagged and refused`,
    { judged: r.judged, pins: r.pins, reads: r.reads.length, lines: r.lines.slice(0, 1) });
}

// ---- each spell record is read once ---------------------------------------------------------------------------------------------
{
  const { W, H } = setup({});
  const before = W.S.lookups.get(id('Fireball')) || 0;
  for (let i = 0; i < 20; i++) W.mp.onSpellCast(A, id('Fireball'));
  ok(before === 0 && W.S.lookups.get(id('Fireball')) === 1, 'the spell\'s record is read once for 20 casts (SPIT and its school cached by id)', W.S.lookups.get(id('Fireball')));
  const n0 = W.S.lookupsTotal;
  for (let i = 0; i < 100; i++) H.tick(1000);
  ok(W.S.lookupsTotal === n0, '...and a tick reads no record', W.S.lookupsTotal - n0);
}

// ---- stamina_free -------------------------------------------------------------------------------------------------------------
{
  const { W, H } = setup({});
  for (let s = 1; s <= 10; s++) { W.set(A, 'pos', [100 * s, 0, 0]); H.tick(1000); }
  for (let s = 1; s <= 25; s++) { W.set(A, 'pos', [1000 + 550 * s, 0, 0]); H.tick(1000); }
  const L = acLines(H);
  ok(L.length >= 1 && /^ANTICHEAT stamina_free shadow Casterly #C4ST \(profile 1\): 2\d s of foot sprint at 500 u\/s or faster in 30 s, stored stamina 1\.000-1\.000/.test(L[0]), 'frozen stamina through a 25 s sprint at 550: stamina_free, shadow', L);
  const { W: W2, H: H2 } = setup({});
  let sta = 1;
  for (let s = 1; s <= 10; s++) { W2.set(A, 'pos', [100 * s, 0, 0]); H2.tick(1000); }
  for (let s = 1; s <= 25; s++) { sta = Math.max(0, sta - 0.025); W2.set(A, 'percentages', { health: 1, magicka: 1, stamina: sta }); W2.set(A, 'pos', [1000 + 550 * s, 0, 0]); H2.tick(1000); }
  ok(acLines(H2).length === 0, '...the same sprint with the stamina draining: no flag', acLines(H2));
  const { W: W3, H: H3 } = setup({});
  for (let s = 1; s <= 25; s++) { W3.set(A, 'pos', [550 * s, 0, 0]); if (s === 12) W3.set(A, 'percentages', { health: 1, magicka: 1, stamina: 0.97 }); H3.tick(1000); }
  ok(acLines(H3).length === 0, '...a drop of 0.03 inside the window: no flag', acLines(H3));
}

// ---- refuseHits ---------------------------------------------------------------------------------------------------------------
{
  const { W } = setup({});
  ok(W.mp.onHitDamageAttempt.toString().includes('c.attempt++'), 'refuseHits false (the default): the hit slot is not even wrapped');
}
// A Fireball every 3 s from A, frozen at full magicka, for `seconds`
const barrage = (H, W, seconds) => {
  const t0 = H.clock.t; H.t0 = t0;
  const ev = []; for (let s = 0; s * 3 < seconds; s++) ev.push([t0 + 500 + s * 3000, A, id('Fireball')]);
  // a frozen value is pinned heldMaxMs (30 s) after its cast
  playTo(H, W, t0 + seconds * 1000 + 40000, ev);
};
{
  // A burst is never refused: 12 Fireballs in 36 s flag once, and the refusal waits for 3 flag minutes in 10
  const { W, H } = setup({ magicka: { refuseHits: true } });
  barrage(H, W, 36);
  const L = acLines(H).filter((l) => /magicka_free/.test(l));
  ok(L.length >= 1 && L.every((l) => /server: flag only \(\d of 3 in 10 min before refusal\)( \(\d+ more folded\))?$/.test(l)), 'a burst of 12 casts in 36 s: flagged, not refused (1 of 3 flag minutes)', L);
  H.clock.t += 5 * 60000; H.run('acSpeedWatch');
  ok(W.mp.onHitDamageAttempt(A, B, id('Fireball'), 30, { spell: true }) === true, '...and their spell hits on players still land');
}
{
  // Flag minutes older than the window are forgotten: two now, eleven quiet minutes, one more burst is not three
  const { W, H, G } = setup({ magicka: { refuseHits: true } });
  barrage(H, W, 120);
  const before = ((G.ST.players.get(A) || {}).flagMinutes || []).slice();
  H.clock.t += 11 * 60000; H.run('acSpeedWatch');
  barrage(H, W, 36);
  const L = acLines(H).filter((l) => /magicka_free/.test(l));
  ok(before.length === 2 && !L.some((l) => /refusing/.test(l)) && W.mp.onHitDamageAttempt(A, B, id('Fireball'), 30, { spell: true }) === true,
    'two flag minutes, 11 quiet minutes, then a burst: the old ones have left the window, no refusal', [before.length, L.map((l) => l.slice(-70))]);
}
{
  // Sustained: four minutes of it is refused, on players only
  const { W, H, calls } = setup({ magicka: { refuseHits: true } });
  barrage(H, W, 240);
  const L = acLines(H).filter((l) => /magicka_free/.test(l));
  ok(L.some((l) => /server: flag only \(1 of 3 in 10 min before refusal\)( \(\d+ more folded\))?$/.test(l)) && /server: refusing their spell hits on players for 10 min( \(\d+ more folded\))?$/.test(L[L.length - 1]), 'four minutes of casting at pinned magicka: flagged, then refused at the third flag minute', L);
  const n = calls.attempt;
  ok(W.mp.onHitDamageAttempt(A, B, id('Fireball'), 30, { spell: true }) === false && globalThis.__dboHitRefusal === 'anticheat' && calls.attempt === n, '...a spell hit from them on a player is refused, named anticheat for the player log');
  ok(W.mp.onHitDamageAttempt(A, NPC, id('Fireball'), 30, { spell: true }) === true && calls.attempt === n + 1, '...a spell hit on an NPC still lands');
  ok(W.mp.onHitDamageAttempt(A, B, SWORD, 12, { spell: false }) === true && calls.attempt === n + 2, '...a weapon hit goes through');
  ok(W.mp.onHitDamageAttempt(B, A, id('Fireball'), 30, { spell: true }) === true, '...and anyone else\'s spell hits too');
  // The refusals are audited once a minute per caster, naming both, the spell and the time left
  H.clock.t += 5000;
  ok(W.mp.onHitDamageAttempt(A, B, id('Fireball'), 30, { spell: true }) === false, '...a second spell hit on a player in the same minute is refused too');
  const refused = H.audits.filter((l) => l.startsWith('ANTICHEAT-REFUSED '));
  ok(refused.length === 1 && /^ANTICHEAT-REFUSED Casterly #C4ST \(profile 1\): spell hit on Selene #K2QX with Fireball refused \(magicka_free, 10 min left\)$/.test(refused[0]), '...the refusal is audited once for the two hits in the same minute', refused);
  H.clock.t += 61000;
  W.mp.onHitDamageAttempt(A, B, id('Fireball'), 30, { spell: true });
  ok(H.audits.filter((l) => l.startsWith('ANTICHEAT-REFUSED ')).length === 2, '...and again a minute later');
  H.clock.t += 11 * 60000; H.run('acSpeedWatch');
  ok(W.mp.onHitDamageAttempt(A, B, id('Fireball'), 30, { spell: true }) === true, '...for 10 minutes only');
  const { W: W2, H: H2 } = setup({ magicka: { refuseHits: true, refusePlayersOnly: false } });
  barrage(H2, W2, 240);
  ok(W2.mp.onHitDamageAttempt(A, NPC, id('Fireball'), 30, { spell: true }) === false, 'refusePlayersOnly false: their spell hits on NPCs are refused too');
}
{
  // An honest caster with 2.5x the regen (Worker 2's slack): full again before each Fireball 8 s apart, but the cast takes
  // 45 % and the next second shows it. Ten minutes of it: never pinned, never flagged
  const { W, H, G } = setup({ magicka: { refuseHits: true } });
  const t0 = H.clock.t; H.t0 = t0;
  let m = 1;
  const ev = [];
  for (let s = 0; s < 600; s++) {
    const at = t0 + s * 1000 + 200;
    if (s % 8 === 0) ev.push([at, A, 0, () => { W.mp.onSpellCast(A, id('Fireball')); m = Math.max(0, m - 0.45); W.set(A, 'percentages', { health: 1, magicka: m, stamina: 1 }); }]);
    else ev.push([at, A, 0, () => { m = Math.min(1, m + 0.03 * 2.5); W.set(A, 'percentages', { health: 1, magicka: m, stamina: 1 }); }]);
  }
  playTo(H, W, t0 + 610000, ev);
  ok(acLines(H).filter((l) => /magicka_free/.test(l)).length === 0 && pinned(G, A) === 0, '2.5x regen, a Fireball every 8 s for 10 min: never pinned, never flagged', acLines(H));
}
{
  // Staff are flagged, never refused: an event GM's spells must land (refuseStaff false, the default)
  const { W, H } = setup({ magicka: { refuseHits: true } });
  H.players.get(A).tier = 'gm';
  barrage(H, W, 240);
  ok(acLines(H).some((l) => /magicka_free Casterly #C4ST \(profile 1, staff\).*server: flag only \(staff\)( \(\d+ more folded\))?$/.test(l)), 'a staff caster frozen at full magicka for 4 min is flagged, flag only (staff)', acLines(H).filter((l) => /magicka_free/.test(l)));
  ok(W.mp.onHitDamageAttempt(A, B, id('Fireball'), 30, { spell: true }) === true && !H.audits.some((l) => l.startsWith('ANTICHEAT-REFUSED ')), '...and their spell hits still land');
  const { W: W2, H: H2 } = setup({ magicka: { refuseHits: true, refuseStaff: true } });
  H2.players.get(A).tier = 'gm';
  barrage(H2, W2, 240);
  ok(W2.mp.onHitDamageAttempt(A, B, id('Fireball'), 30, { spell: true }) === false, 'refuseStaff true: a staff caster is refused too');
}
{
  // The live config ships it on: sustained (3 flag minutes in 10), players only, staff spared
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'gamemode-config.json'), 'utf8')).anticheat.magicka;
  ok(cfg.refuseHits === true && cfg.refuseStaff === false && cfg.refuseMinutes === 10 && cfg.refuseAfterFlags === 3 && cfg.refuseFlagWindowMs === 600000 && cfg.refusePlayersOnly === true,
    'gamemode-config.json: refuseHits on, 3 flag minutes in 10, players only, staff spared, 10 min', cfg);
}

F.done();
