// Scripted test for anticheat.js from the false-positive review of 17 Oct: honest play the first harnesses did not cover.
//   1. a horse (or anything at 680-850 u/s) whose server position is held stale by a lag spike of 1-3 s and then
//      caught up: no alert (the window is timed from where the position was last true); a real 2000 u/s run with the
//      same lag spikes still alerts within 11 s
//   2. AdminSystem's God mode (ff_adminModes.god, tgm on the client): its free casts and sprints are not flagged; the
//      same casts without it still are
//   3. the fork's own kinds (speed_bucket, speed_shadow, snapback_ignored, ...) are shadow in the shipped config: one log
//      line, no staff line, no player-log signal
//   node tests/anticheat-fp-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const F = require('./lib/anticheat-fakes.js');
const { ok } = F;

const A = 0xff000014, HORSE = 0xff0a0001, GM = 0xff000020;
const CELL = 'a764b:BSHeartland.esm';
const SHIPPED = JSON.parse(fs.readFileSync(path.join(F.ROOT, 'gamemode-config.json'), 'utf8')).anticheat;
const LIVE_RX = /^ANTICHEAT [a-z0-9_]+ (?!shadow )\S.* \(profile -?\d+(, staff)?\): /;
const live = (H) => H.logs.filter((l) => LIVE_RX.test(l));
const setup = (anticheat) => {
  const W = F.makeWorld();
  W.record(0xa764b, 'WRLD', 'BSHeartland', []);
  W.race(0x131fd, 'HorseRace'); W.npcBase(0x68d6d, 'WhiterunStablesHorse', 0x131fd);
  W.set(HORSE, 'baseDesc', '68d6d:Skyrim.esm'); W.set(HORSE, 'pos', [0, 0, 0]);
  const H = F.makeApi(W, { anticheat });
  F.baseSlots(W.mp);
  H.addPlayer(A, { name: 'Rowan', tag: 'PGDB', profile: 1 });
  H.addPlayer(GM, { name: 'Gamemaster', tag: 'GM01', profile: 9, tier: 'gm', staffChar: true });
  W.set(A, 'worldOrCellDesc', CELL); W.set(GM, 'worldOrCellDesc', CELL);
  const G = F.load(H.api, true);
  H.tick(0);
  return { W, H, G };
};

// ---- 1. lag spikes: the server's position held for g s every 30 s, then caught up in one packet ----------------------------
for (const v of [700, 720, 740, 800]) {
  for (const g of [1, 2, 3]) {
    const { W, H } = setup(SHIPPED);
    W.mp.onActivate(HORSE, A);
    let x = 0, shown = 0;
    for (let s = 1; s <= 600; s++) {
      x += v;
      if ((s % 30) < 30 - g) shown = x;
      W.set(A, 'pos', [shown, 0, 0]); W.set(HORSE, 'pos', [shown + 40, 10, 0]);
      H.tick(1000);
    }
    ok(live(H).length === 0, `a horse at ${v} u/s with ${g} s of lag every 30 s, 10 minutes: no alert`, live(H).slice(0, 2));
  }
}
{
  // the same lag on foot, through the shipped config (no class needed)
  const { W, H } = setup(SHIPPED);
  let x = 0, shown = 0;
  for (let s = 1; s <= 300; s++) { x += 590; if ((s % 20) < 18) shown = x; W.set(A, 'pos', [shown, 0, 0]); H.tick(1000); }
  ok(live(H).length === 0, 'a foot sprint at 590 u/s with 2 s of lag every 20 s: no alert', live(H).slice(0, 2));
}
{
  // a speedhack at 2000 u/s with the same lag spikes still alerts, within 11 s of the run's start
  const { W, H } = setup(SHIPPED);
  let x = 0, shown = 0, at = 0;
  for (let s = 1; s <= 120; s++) {
    x += s <= 20 ? 300 : 2000;
    if ((s % 15) < 13) shown = x;
    W.set(A, 'pos', [shown, 0, 0]);
    H.tick(1000);
    if (!at && live(H).some((l) => /^ANTICHEAT speed_sustained Rowan #PGDB/.test(l))) at = s;
  }
  ok(at > 20 && at <= 31, `a 2000 u/s run with 2 s lag spikes alerts ${at - 20} s after it starts`, at);
}
{
  // a run that starts after standing still: one more second at most
  const { W, H } = setup(SHIPPED);
  let x = 0, at = 0;
  for (let s = 1; s <= 60; s++) {
    if (s > 30) x += 2000;
    W.set(A, 'pos', [x, 0, 0]);
    H.tick(1000);
    if (!at && live(H).some((l) => /^ANTICHEAT speed_sustained Rowan #PGDB/.test(l))) at = s;
  }
  ok(at > 30 && at <= 41, `a 2000 u/s run from standing still alerts ${at - 30} s after it starts`, at);
}

// ---- 2. God mode ---------------------------------------------------------------------------------------------------------
{
  const FAM = 0x640b6;
  const run = (god) => {
    const { W, H } = setup(SHIPPED);
    W.spell(FAM, 'ConjureFamiliar', { cost: 107, type: 0, castType: 1, school: 19 });
    if (god) W.set(GM, 'ff_adminModes', { god: true, invis: false });
    W.set(GM, 'percentages', { health: 1, magicka: 1, stamina: 1 });
    for (let i = 0; i < 40; i++) { W.mp.onSpellCast(GM, FAM); H.tick(1000); H.tick(1000); H.tick(1000); }
    for (let i = 0; i < 40; i++) H.tick(1000);
    return H.logs.filter((l) => /^ANTICHEAT magicka_free /.test(l));
  };
  const withGod = run(true), without = run(false);
  ok(withGod.length === 0, 'God mode (ff_adminModes.god): 40 free ConjureFamiliar casts are not flagged', withGod.slice(0, 1));
  ok(without.length > 0 && /\(profile 9, staff\)/.test(without[0]), '...the same casts without God mode are still flagged, marked staff', without.slice(0, 1));
}
{
  const sprint = (god) => {
    const { W, H } = setup(SHIPPED);
    if (god) W.set(A, 'ff_adminModes', { god: true });
    let x = 0;
    for (let s = 1; s <= 60; s++) { x += 560; W.set(A, 'pos', [x, 0, 0]); W.set(A, 'percentages', { health: 1, magicka: 1, stamina: 1 }); H.tick(1000); }
    return H.logs.filter((l) => /^ANTICHEAT stamina_free /.test(l));
  };
  ok(sprint(true).length === 0, 'God mode: a minute of sprinting at full stamina is not flagged');
  ok(sprint(false).length > 0, '...without it, stamina_free (shadow) as before');
}

// ---- 3. the fork's kinds are shadow in the shipped config ----------------------------------------------------------------
{
  const FORK_KINDS = ['speed_bucket', 'speed_shadow', 'snapback_ignored', 'movement_nonfinite', 'vitals_nonfinite', 'vitals_refused'];
  ok(FORK_KINDS.every((k) => SHIPPED.shadowKinds.includes(k)), 'gamemode-config.json shadowKinds lists every fork kind', SHIPPED.shadowKinds);
  const { W, H } = setup(SHIPPED);
  const signals = [];
  globalThis.__dboPlogHook = (...a) => signals.push(a);
  for (const k of FORK_KINDS) W.mp.onAnticheat(A, k, JSON.stringify({ verdict: 'accepted', moved: 2868, gapMs: 800 }));
  W.mp.onAnticheat(A, 'NotAKind!', '{}');
  const lines = H.logs.filter((l) => /^ANTICHEAT /.test(l));
  ok(lines.length === FORK_KINDS.length + 1 && lines.every((l) => / shadow Rowan #PGDB \(profile 1\): /.test(l)), '...each fork flag is one shadow line', lines);
  ok(H.staff.length === 0 && signals.filter((s) => s[0] === 'anticheat').length === 0, '...with no staff line and no player-log signal', { staff: H.staff, signals });
  delete globalThis.__dboPlogHook;
}

F.done();
