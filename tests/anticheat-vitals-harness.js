// Scripted test for anticheat.js's interim vitals checks (ac-vitals-interim, ANTI-CHEAT DESIGN 17 Oct). magicka_free: a
// replay of 20 minutes of live stored percentages with the casts made in them (tests/fixtures/anticheat-vitals-sample1.json,
// anonymised) pins none; a client frozen at full magicka is flagged; Fortify gear of the school, a potion, a well, a refill,
// a held charge, a concentration channel and a server freeze are not; each spell's record is read once. stamina_free:
// frozen stamina through a 25 s sprint is flagged (shadow), a draining one is not. refuseHits: off by default, and on, a
// flagged caster's spell hits are refused while weapon hits are not.
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
{
  const { W, H, calls } = setup({ magicka: { refuseHits: true } });
  const t0 = H.clock.t; H.t0 = t0;
  const ev = []; for (let i = 0; i < 12; i++) ev.push([t0 + 500 + i * 3000, A, id('Fireball')]);
  playTo(H, W, t0 + 80000, ev);
  ok(acLines(H).some((l) => /magicka_free .*server: refusing their spell hits for 10 min$/.test(l)), 'refuseHits true: the flag says the server refuses their spell hits', acLines(H).filter((l) => /magicka_free/.test(l)));
  const n = calls.attempt;
  ok(W.mp.onHitDamageAttempt(A, B, id('Fireball'), 30, { spell: true }) === false && globalThis.__dboHitRefusal === 'anticheat' && calls.attempt === n, '...a spell hit from them is refused, named anticheat for the player log');
  ok(W.mp.onHitDamageAttempt(A, B, SWORD, 12, { spell: false }) === true && calls.attempt === n + 1, '...a weapon hit goes through');
  ok(W.mp.onHitDamageAttempt(B, A, id('Fireball'), 30, { spell: true }) === true, '...and anyone else\'s spell hits too');
  H.clock.t += 11 * 60000; H.run('acSpeedWatch');
  ok(W.mp.onHitDamageAttempt(A, B, id('Fireball'), 30, { spell: true }) === true, '...for 10 minutes only');
}

F.done();
