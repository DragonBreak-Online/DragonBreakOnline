// Scripted test for anticheat.js's speed watch (ac-speed-watch, ANTI-CHEAT DESIGN 17 Oct) on synthetic tracks of
// server-accepted positions sampled by the module's own 1 s timer: honest sprints, a werewolf, a horse, a staff-tester-like
// 2000 u/s run (alert within 10 s; the optional rubber-band, never across a cell change), 1.5x sprint (the foot tier, shadow
// only), a 20 s server freeze and its backlog, a door-like step, a Whirlwind Sprint dash, a slowed player, and the cost of
// 60 players for an hour of ticks.
//   node tests/anticheat-speed-harness.js   (from server/)
'use strict';
const F = require('./lib/anticheat-fakes.js');
const { ok } = F;

const A = 0xff000014, SK = 0xff000015, HORSE = 0xff0a0001;
const CELL = 'a764b:BSHeartland.esm', CELL_B = '3c:Skyrim.esm';
const WS = 0x2f7bb, FIREBOLT = 0x12fcd;
const setup = (anticheat) => {
  const W = F.makeWorld();
  W.record(0xa764b, 'WRLD', 'BSHeartland', []); W.record(0x3c, 'WRLD', 'Tamriel', []);
  W.spell(WS, 'VoiceWhirlwindSprint3', { cost: 0, type: 11, castType: 1 });
  W.spell(FIREBOLT, 'Firebolt', { cost: 41, type: 0 });
  W.race(0x131fd, 'HorseRace'); W.npcBase(0x68d6d, 'WhiterunStablesHorse', 0x131fd);
  W.set(HORSE, 'baseDesc', '68d6d:Skyrim.esm'); W.set(HORSE, 'pos', [0, 0, 0]);
  const H = F.makeApi(W, { anticheat });
  F.baseSlots(W.mp);
  H.addPlayer(A, { name: 'Rowan', tag: 'PGDB', profile: 1 });
  H.addPlayer(SK, { name: 'Tester', tag: 'T3ST', profile: 5, tier: 'trialgm', staffChar: true });
  W.set(A, 'worldOrCellDesc', CELL); W.set(SK, 'worldOrCellDesc', CELL);
  const G = F.load(H.api, true);
  H.tick(0);
  return { W, H, G };
};
const acLines = (H) => H.logs.filter((l) => l.startsWith('ANTICHEAT '));
const kindsOf = (H) => acLines(H).map((l) => l.split(' ').slice(1, 3).join(' ').replace(/ (?!shadow).*/, ''));
// drive actor a along x(t) (u, t in s since the start) for secs seconds, one tick a second
const drive = (H, W, a, secs, xAt, opts) => {
  const o = opts || {};
  const t0 = o.t0 || 0;
  for (let s = 1; s <= secs; s++) {
    const x = xAt(t0 + s);
    W.set(a, 'pos', [x, o.y || 0, 0]);
    if (o.horse) W.set(HORSE, 'pos', [x + 50, (o.y || 0) + 20, 0]);
    if (o.each) o.each(t0 + s);
    H.tick(1000);
  }
};
const run = (v) => (s) => v * s;
// an honest client's stored stamina: it drains while sprinting (500 u/s or faster) and comes back otherwise
const stamina = (W, a) => { let last = null, sta = 1; return (s) => {
  const p = W.props.get(a).get('pos'); const x = Array.isArray(p) ? p[0] : 0;
  if (last !== null) sta = Math.max(0, Math.min(1, sta + (x - last >= 500 ? -0.03 : 0.05)));
  last = x; W.set(a, 'percentages', { health: 1, magicka: 1, stamina: sta }); void s; }; };

// ---- honest: a sprint at 600 u/s held for 5 minutes, and a real one -----------------------------------------------------------
{
  const { W, H } = setup({});
  drive(H, W, A, 300, run(600), { each: stamina(W, A) });
  const L = acLines(H);
  ok(!L.some((l) => /^ANTICHEAT speed_sustained /.test(l) || /^ANTICHEAT speed_sustained shadow /.test(l)), 'a 600 u/s sprint held 5 minutes: no 10 s flag of either tier (600 < foot 650)', L);
  ok(L.every((l) => / shadow /.test(l)), '...and nothing that alerts', L.filter((l) => !/ shadow /.test(l)));
  ok(L.some((l) => /^ANTICHEAT speed_sustained60 shadow Rowan #PGDB \(profile 1\): foot 600 u\/s over 60 s, limit 540/.test(l)),
    '...the 60 s foot tier (540, shadow) does see it: a sprint no stamina pool holds for a minute (the measurement week judges it)', L);
}
{
  const { W, H } = setup({});
  // sprint 28 s at 560, run 32 s at 440 while the stamina comes back, for 5 minutes
  const xAt = (s) => { const c = Math.floor(s / 60), r = s % 60; return c * (28 * 560 + 32 * 440) + (r <= 28 ? r * 560 : 28 * 560 + (r - 28) * 440); };
  drive(H, W, A, 300, xAt, { each: stamina(W, A) });
  ok(acLines(H).length === 0, 'an honest sprint and run (28 s at 560, 32 s at 440, 5 minutes, stamina draining): no flag at all', acLines(H));
  const { W: W2, H: H2 } = setup({});
  drive(H2, W2, A, 300, xAt);
  ok(acLines(H2).length > 0 && acLines(H2).every((l) => /^ANTICHEAT stamina_free shadow Rowan #PGDB \(profile 1\): \d+ s of foot sprint/.test(l)),
    '...the same run with the stored stamina frozen at full: stamina_free (shadow) and nothing else', acLines(H2).slice(0, 2));
}
// ---- a werewolf at 603, a horse at 720 ---------------------------------------------------------------------------------------
{
  const { W, H } = setup({});
  W.set(A, 'private.beast', { form: 'werewolf', original: 0x13746 });
  drive(H, W, A, 300, run(603));
  ok(acLines(H).length === 0, 'a werewolf at 603 u/s for 5 minutes: no flag (beast 850 at 10 s, 750 at 60 s)', acLines(H));
}
{
  const { W, H } = setup({});
  W.mp.onActivate(HORSE, A);
  drive(H, W, A, 300, run(720), { horse: true });
  ok(acLines(H).length === 0, 'a horse at 720 u/s after its activation, for 5 minutes: no flag', acLines(H));
  H.cmd(A, '/acstate #PGDB');
  ok(H.told.some(([, l]) => /^Rowan #PGDB \(profile 1\): class mount \(horse near\)/.test(l)), '...class mount', H.told.slice(-3));
  const { W: W2, H: H2 } = setup({});
  drive(H2, W2, A, 120, run(720));
  ok(acLines(H2).some((l) => /^ANTICHEAT speed_sustained shadow Rowan #PGDB \(profile 1\): foot 720/.test(l)) && acLines(H2).every((l) => / shadow /.test(l)),
    '...the same 720 u/s on foot (no horse activated) is the foot tier, in shadow only', acLines(H2));
}
// ---- a staff-tester-like run at 2000 u/s, with and without the rubber-band ---------------------------------------------------------
{
  const { W, H } = setup({});
  drive(H, W, SK, 30, run(150));
  const start = H.clock.t, x0 = 150 * 30;
  let firstAlertAt = 0;
  drive(H, W, SK, 180, (s) => x0 + 2000 * (s - 30), { t0: 30, each: () => { if (!firstAlertAt && acLines(H).some((l) => /^ANTICHEAT speed_sustained Tester/.test(l))) firstAlertAt = H.clock.t; } });
  const alert = acLines(H).find((l) => /^ANTICHEAT speed_sustained Tester/.test(l));
  ok(!!alert && firstAlertAt > 0 && firstAlertAt - start <= 10000, `a 2000 u/s run alerts within 10 s (at ${(firstAlertAt - start) / 1000} s)`, alert);
  ok(/^ANTICHEAT speed_sustained Tester #T3ST \(profile 5, staff\): foot \d{4} u\/s over 10 s, limit 850 \(x\d\.\d\d\); 1 s 2000, 10 s \d{4}, 60 s [-\d]+; continuity \d+%; cell BSHeartland; server: flag only$/.test(alert || ''),
    '...a trialgm is flagged and marked staff; the line carries class, the 1/10/60 s speeds, limit and ratio, continuity, cell and what the server did', alert);
  ok(H.staff.length === 0 || H.staff.every(([x]) => x !== SK), '...never told to the player himself');
  const n = acLines(H).filter((l) => /^ANTICHEAT speed_sustained Tester/.test(l)).length;
  ok(n >= 3 && n <= 4, `...one line a minute over the 3 minutes (${n}), the rest folded`, n);
  ok(!W.S.sets.some(([, k]) => k === 'locationalData'), '...rubberBand false: nobody is moved');
}
{
  const { W, H } = setup({ speed: { rubberBand: true } });
  drive(H, W, SK, 30, run(150));
  const x0 = 150 * 30;
  drive(H, W, SK, 120, (s) => x0 + 2000 * (s - 30), { t0: 30 });
  const tps = W.S.sets.filter(([a, k]) => a === SK && k === 'locationalData');
  ok(tps.length >= 2 && tps.length <= 6, `rubberBand true: the runner is put back (${tps.length} times in 2 minutes)`, tps.length);
  ok(tps.length && tps[0][2].cellOrWorldDesc === CELL && tps[0][2].pos[0] <= x0 + 2000, '...the first time to the last sample before the run, same cell', tps[0] && tps[0][2]);
  ok(acLines(H).some((l) => /server: rubber-band 1 \(\d+ u back, same cell\)$/.test(l)), '...and the flag says so', acLines(H).slice(0, 3));
  // at most rubberBandMaxPerMin in any minute
  const times = []; let i = 0;
  for (const s of W.S.sets) { if (s[0] === SK && s[1] === 'locationalData') times.push(i); i++; }
  ok(tps.length <= 3 * 2 + 1, '...at most 3 a minute');
}
{
  const { W, H } = setup({ speed: { rubberBand: true } });
  drive(H, W, SK, 30, run(150));
  drive(H, W, SK, 5, (s) => 4500 + 2000 * (s - 30), { t0: 30 });
  // a door: the next cell, and the run goes on there
  W.set(SK, 'worldOrCellDesc', CELL_B);
  drive(H, W, SK, 40, (s) => 900000 + 2000 * (s - 35), { t0: 35, y: 50000 });
  const tps = W.S.sets.filter(([a, k]) => a === SK && k === 'locationalData');
  ok(tps.length >= 1 && tps.every(([, , v]) => v.cellOrWorldDesc === CELL_B && v.pos[0] >= 900000 && v.pos[1] === 50000), 'the rubber-band never reaches back across a cell change', tps.map(([, , v]) => v));
}
// ---- staff movement modes: NoClip only, granted by the server ------------------------------------------------------------------
{
  const said = [];
  globalThis.__alduinakAdminLog = (text) => { said.push(text); };
  const { W, H } = setup({});
  globalThis.__alduinakAdminLog('profile 5 (gm) turned mode noclip on');
  drive(H, W, SK, 60, run(2000));
  ok(acLines(H).length === 0 && said.length === 1, 'NoClip turned on through the admin panel (its log line): not judged, and the line still reaches the gamemode', acLines(H));
  globalThis.__alduinakAdminLog('profile 5 (gm) turned mode noclip off');
  globalThis.__alduinakAdminLog('profile 5 (gm) turned mode ghost on');
  drive(H, W, SK, 30, (s) => 120000 + 2000 * (s - 60), { t0: 60 });
  ok(acLines(H).some((l) => /^ANTICHEAT speed_sustained Tester #T3ST \(profile 5, staff\)/.test(l)), '...NoClip off (Ghost on moves no one faster): judged again, marked staff', acLines(H));
  delete globalThis.__alduinakAdminLog;
}
// ---- 1.5x sprint on foot -------------------------------------------------------------------------------------------------------
{
  const { W, H } = setup({});
  drive(H, W, A, 120, run(750));
  const L = acLines(H);
  ok(L.some((l) => /^ANTICHEAT speed_sustained shadow Rowan #PGDB \(profile 1\): foot 750 u\/s over 10 s, limit 650 \(x1\.15\)/.test(l)), '750 u/s on foot: the foot tier (650) flags', L);
  ok(L.length > 0 && L.every((l) => / shadow /.test(l)), '...in shadow only: no alert, no staff line', L.filter((l) => !/ shadow /.test(l)));
  ok(H.staff.length === 0, '...no staff line');
}
// ---- a 20 s server freeze, then the backlog --------------------------------------------------------------------------------------
{
  const { W, H, G } = setup({});
  const sta = stamina(W, A);
  drive(H, W, A, 60, run(500), { each: sta });
  // the main thread stops for 20 s: no tick, and no movement packet is processed; then the timer fires late, then the backlog lands
  H.tick(21000);
  ok(G.ST.holdAllUntil > H.clock.t, 'a 20 s freeze: the late timer starts the stall hold');
  drive(H, W, A, 60, run(500), { t0: 81, each: sta });
  ok(acLines(H).length === 0, '...and neither the freeze nor the backlog step (10500 u in one tick) flags anything', acLines(H));
}
// ---- a door-like step, a Whirlwind Sprint dash, a slowed run ---------------------------------------------------------------------
{
  const { W, H } = setup({});
  drive(H, W, A, 40, run(200));
  drive(H, W, A, 40, (s) => 3500 + 200 * s, { t0: 40 });
  ok(acLines(H).length === 0, 'one 3500 u door-like step while walking: no flag', acLines(H));
  H.cmd(A, '/acstate #PGDB');
  ok(H.told.some(([, l]) => /blinks 1 in 10 min/.test(l)), '...and one blink counted', H.told.slice(-3));
}
{
  const { W, H } = setup({});
  drive(H, W, A, 30, run(300));
  W.mp.onSpellCast(A, WS);
  drive(H, W, A, 40, (s) => (s < 32 ? 9000 + 2600 * (s - 30) : 9000 + 2600 * 2 + 300 * (s - 32)), { t0: 30 });
  ok(acLines(H).length === 0, 'a Whirlwind Sprint dash (2600 u steps for 2 s after the shout): exempt, no flag', acLines(H));
  H.cmd(A, '/acstate #PGDB');
  ok(H.told.some(([, l]) => /blinks 0 in 10 min/.test(l)), '...and no blink counted', H.told.slice(-3));
  const { W: W2, H: H2 } = setup({});
  drive(H2, W2, A, 30, run(300));
  W2.mp.onSpellHit(SK, A, WS);
  drive(H2, W2, A, 12, (s) => 9000 + 1800 * (s - 30), { t0: 30 });
  ok(acLines(H2).length === 0, 'thrown by a Voice spell (Unrelenting Force and the like): exempt for 10 s', acLines(H2));
}
{
  const { W, H } = setup({});
  drive(H, W, A, 15, run(300));
  globalThis.__dboAcStatus(A, { customPacketType: 'dboStatus', kind: 'armour', seconds: 30, speedMult: -50 });
  drive(H, W, A, 20, (s) => 4500 + 400 * (s - 15), { t0: 15 });
  const L = acLines(H);
  ok(L.some((l) => /^ANTICHEAT speed_slow shadow Rowan #PGDB \(profile 1\): foot 400 u\/s over \d+ s, limit 325 \(x1\.23\).*slowed x0\.50/.test(l)), 'slowed x0.5 and running at 400: speed_slow (325 on foot), shadow', L);
  const { W: W2, H: H2 } = setup({});
  drive(H2, W2, A, 15, run(300));
  globalThis.__dboAcStatus(A, { customPacketType: 'dboStatus', kind: 'armour', seconds: 30, speedMult: -50 });
  drive(H2, W2, A, 20, (s) => 4500 + 280 * (s - 15), { t0: 15 });
  ok(acLines(H2).length === 0, '...slowed and at 280 (an honest 0.5 x sprint): no flag', acLines(H2));
}
// ---- the cost: 60 players, an hour of ticks -----------------------------------------------------------------------------------
{
  const W = F.makeWorld();
  W.record(0xa764b, 'WRLD', 'BSHeartland', []);
  const H = F.makeApi(W, {});
  // the lines are counted, not kept: the harness's own capture would read as the module's heap
  let lines = 0; H.api.log = () => { lines++; }; H.api.staffSay = () => {};
  F.baseSlots(W.mp);
  const ids = [];
  for (let i = 0; i < 60; i++) {
    const a = 0xff100000 + i;
    H.addPlayer(a, { name: `P${i}`, tag: `T${String(i).padStart(3, '0')}`.slice(0, 4), profile: 100 + i });
    W.set(a, 'worldOrCellDesc', CELL);
    ids.push(a);
  }
  // positions as getters, so the fake's get returns a fresh array each time as the engine does
  const speed = ids.map((_, i) => [150, 300, 450, 560, 600, 720][i % 6]);
  const start = H.clock.t;
  ids.forEach((a, i) => W.set(a, 'pos', () => [speed[i] * (H.clock.t - start) / 1000, i * 1000, 0]));
  F.load(H.api, true);
  H.tick(0);
  for (let i = 0; i < 300; i++) H.tick(1000);
  const v8 = require('v8'); v8.setFlagsFromString('--expose_gc'); const gc = require('vm').runInNewContext('gc');
  gc(); const heap0 = process.memoryUsage().heapUsed;
  // a tick over 1 s is this process being paused (a busy host stopped it for 12 s once while this was written), not the
  // module: such ticks are counted and left out of the mean, and more than three of them fail the run
  let total = 0, max = 0, n = 0, paused = 0;
  for (let i = 0; i < 3600; i++) {
    const t0 = process.hrtime.bigint(); H.tick(1000); const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms > 1000) { paused++; continue; }
    total += ms; n++; if (ms > max) max = ms;
  }
  gc(); const heap1 = process.memoryUsage().heapUsed;
  const mean = total / Math.max(1, n);
  ok(mean < 0.5 && paused <= 3, `60 players x 3600 ticks: mean ${mean.toFixed(3)} ms a tick (max ${max.toFixed(2)} ms${paused ? `, ${paused} paused ticks left out` : ''}), under 0.5 ms`, { mean, max, paused });
  const grow = (heap1 - heap0) / 3600;
  ok(grow < 64, `...no heap growth per tick (${Math.round(grow)} bytes a tick after a collection, ${Math.round((heap1 - heap0) / 1024)} KB in all)`, { heap0, heap1 });
  const G = globalThis.__dboAnticheat;
  ok(G.players.size === 60 && [...G.players.values()].every((st) => st.ring.length === 256), '...one fixed ring per player');
}

F.done();
