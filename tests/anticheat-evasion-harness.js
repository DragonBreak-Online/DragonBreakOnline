// Adversarial test for anticheat.js (review of 17 Oct, lens: evasion by a purpose-built hack). The attacker controls the
// whole client: every position the server accepts (logging-only fork), every vital report, every cast and eat event its
// own client may send. Each case says what the module does with it today: ALERT (staff told), SHADOW (log line only) or
// MISS (nothing). Cases the review closed assert the closed behaviour; the rest pin the residual so a change shows up.
//   node tests/anticheat-evasion-harness.js   (from server/)
'use strict';
const F = require('./lib/anticheat-fakes.js');
const { ok } = F;

const A = 0xff000014, FRIEND = 0xff000016, HORSE = 0xff0a0001;
const CELL = 'a764b:BSHeartland.esm';
const UF = 0x13e07, FIREBALL = 0x1c789, SPARKS = 0x2dd2a;
const CABBAGE = 0x64b3f, POTION_MAG = 0x39be7, SALT = 0x34cdf, RING_FD = 0x1cb39, ENCH_FD = 0x1cb3a, FORT_DEST = 0x1cb3b;
const REST_HEALTH = 0x3eb15, REST_MAGICKA = 0x3eb17, WEAK_MAGIC = 0x73f51, FORT_MAG_RATE = 0x3eb06;
const setup = (anticheat) => {
  const W = F.makeWorld();
  W.record(0xa764b, 'WRLD', 'BSHeartland', []);
  W.spell(UF, 'VoiceUnrelentingForce3', { cost: 0, type: 11, castType: 1 });
  W.spell(FIREBALL, 'Fireball', { cost: 133, school: 20 });
  W.spell(SPARKS, 'Sparks', { cost: 19, castType: 2, school: 20 });
  W.race(0x131fd, 'HorseRace'); W.npcBase(0x68d6d, 'WhiterunStablesHorse', 0x131fd);
  W.set(HORSE, 'baseDesc', '68d6d:Skyrim.esm'); W.set(HORSE, 'pos', [0, 0, 0]);
  // food and ingredients: their effects (MGEF DATA archetype at 0x40, actor value at 0x44)
  W.mgef(REST_HEALTH, 'FoodRestoreHealth', { archetype: 0, av: 24 });
  W.mgef(REST_MAGICKA, 'AlchRestoreMagicka', { archetype: 0, av: 25 });
  W.mgef(WEAK_MAGIC, 'AlchWeaknessMagic', { archetype: 0, av: 56 });
  W.mgef(FORT_MAG_RATE, 'AlchFortifyMagickaRate', { archetype: 34, av: 28 });
  const eff = (id, mag, dur) => [{ type: 'EFID', data: F.u32(id) }, { type: 'EFIT', data: F.bytes(12, [[0, 'f', mag], [8, 'u', dur]]) }];
  W.record(CABBAGE, 'ALCH', 'FoodCabbage', eff(REST_HEALTH, 5, 0));
  W.record(POTION_MAG, 'ALCH', 'RestoreMagicka01', eff(REST_MAGICKA, 25, 0));
  // Salt Pile: eaten raw, only its first effect (Weakness to Magic) applies; its fourth is Fortify Magicka Rate
  W.record(SALT, 'INGR', 'SaltPile', [...eff(WEAK_MAGIC, 2, 30), ...eff(FORT_MAG_RATE, 5, 300)]);
  // one Fortify Destruction ring, of the smallest kind
  W.mgef(FORT_DEST, 'EnchFortifyDestructionConstantSelf', { archetype: 0, av: 110 });
  W.ench(ENCH_FD, 'EnchRingFortifyDestruction01', [FORT_DEST]);
  W.armo(RING_FD, 'EnchRingFortifyDestruction01', ENCH_FD);
  const H = F.makeApi(W, { anticheat });
  F.baseSlots(W.mp);
  H.addPlayer(A, { name: 'Rowan', tag: 'PGDB', profile: 1 });
  H.addPlayer(FRIEND, { name: 'Helper', tag: 'HLP2', profile: 2 });
  W.set(A, 'worldOrCellDesc', CELL); W.set(FRIEND, 'worldOrCellDesc', CELL);
  const G = F.load(H.api, true);
  H.tick(0);
  return { W, H, G };
};
const acLines = (H) => H.logs.filter((l) => l.startsWith('ANTICHEAT '));
const alerts = (H, kind) => acLines(H).filter((l) => new RegExp(`^ANTICHEAT ${kind} (?!shadow )`).test(l));
const shadows = (H, kind) => acLines(H).filter((l) => new RegExp(`^ANTICHEAT ${kind} shadow `).test(l));
// ALERT, SHADOW or MISS over the kinds starting with prefix (speed_, magicka_, stamina_)
const verdict = (H, prefix) => (alerts(H, `${prefix}\\w*`).length ? 'ALERT' : shadows(H, `${prefix}\\w*`).length ? 'SHADOW' : 'MISS');
const report = [];
const note = (name, v, avg) => { report.push(`${v.padEnd(6)} ${name}${avg ? ` (${avg})` : ''}`); };
// one tick a second; xAt(s) gives the x of second s, each(s) runs before the tick
const drive = (H, W, a, secs, xAt, o) => {
  const opt = o || {};
  for (let s = 1; s <= secs; s++) {
    W.set(a, 'pos', [xAt(s), 0, 0]);
    if (opt.horse) W.set(HORSE, 'pos', [xAt(s) + 40, 0, 0]);
    if (opt.each) opt.each(s);
    H.tick(1000);
  }
};

// ---- speed -------------------------------------------------------------------------------------------------------------------
// off-the-shelf: a speed multiplier, constant
for (const [mult, expect] of [[2, 'ALERT'], [3, 'ALERT'], [1.5, 'SHADOW'], [1.25, 'SHADOW']]) {
  const { W, H } = setup({});
  const v = 520 * mult;
  drive(H, W, A, 120, (s) => v * s);
  const got = verdict(H, 'speed_');
  note(`constant ${mult}x an honest sprint (${Math.round(v)} u/s), 2 min`, got);
  ok(got === expect, `off-the-shelf ${mult}x sprint, constant: ${expect}`, acLines(H).slice(0, 2));
}
// purpose-built: a 4096 u hop every 8 s between 1300 u/s steps. Each hop reads as a teleport and restarted the windows, so
// no 10 s window ever spanned 9 s (1650 u/s on average, 3x sprint). Now only 3 such restarts in 10 minutes; past them the
// hop is taken out of the window and the running between hops is judged
{
  const { W, H } = setup({});
  let x = 0;
  const xs = [];
  for (let s = 1; s <= 180; s++) { x += s % 8 === 0 ? 4096 : 1300; xs[s] = x; }
  drive(H, W, A, 180, (s) => xs[s]);
  const got = verdict(H, 'speed_');
  note('hop: a 4096 u step every 8 s between 1300 u/s steps, 3 min', got, '1650 u/s average');
  ok(got === 'ALERT', 'a 4096 u hop every 8 s (1650 u/s average): alerts once the 3 teleport restarts in 10 min are spent', acLines(H).slice(0, 3));
}
// purpose-built: alternating hops (1365, 4096): every hop a "teleport" (2730 u/s average). Past the restart budget the hops
// are taken out and what is left (1365 every other second, 683 u/s) is under every line: only speed_blink (shadow) sees it
{
  const { W, H } = setup({});
  let x = 0; const xs = [];
  for (let s = 1; s <= 180; s++) { x += s % 2 ? 1365 : 4096; xs[s] = x; }
  drive(H, W, A, 180, (s) => xs[s]);
  const got = verdict(H, 'speed_');
  note('hop: alternating 1365 u and 4096 u steps, 3 min', got, '2730 u/s average; speed_blink shadow only');
  ok(got === 'SHADOW' && shadows(H, 'speed_blink').length > 0, 'alternating hops (2730 u/s average): residual, speed_blink (shadow) only; the fork bucket holds it', acLines(H).slice(0, 3));
}
// purpose-built: stutter, 3 s at 1900 u/s then 2 s still. Continuity (80% of the window in fast steps) is never met
// (1140 u/s average): the alert tier misses it; the new 60 s pulse tier (speed_sustained:pulse) logs it in shadow for the
// measurement week, and alerts once it leaves shadowKinds
{
  const { W, H } = setup({});
  drive(H, W, A, 300, (s) => 1900 * (Math.floor(s / 5) * 3 + Math.min(3, s % 5)));
  const got = verdict(H, 'speed_');
  note('stutter: 3 s at 1900 u/s, 2 s still, 5 min', got, '1140 u/s average; the 60 s pulse tier, shadow');
  ok(got !== 'ALERT', 'stutter (1140 u/s average): no alert (residual until the fork bucket enforces)', alerts(H, 'speed_sustained'));
  ok(shadows(H, 'speed_sustained').some((l) => /over 60 s, limit 850/.test(l)), '...the 60 s pulse tier (850 u/s over 60 s, continuity 30% at 425) logs it in shadow', acLines(H).slice(0, 3));
  const { W: W2, H: H2 } = setup({ shadowKinds: ['speed_sustained:foot', 'speed_sustained60', 'speed_blink'] });
  drive(H2, W2, A, 300, (s) => 2999 * (Math.floor(s / 8) * 5 + Math.min(5, s % 8)));
  ok(alerts(H2, 'speed_sustained').some((l) => /over 60 s, limit 850/.test(l)), '...5 s at 2999 u/s and 3 s still (1874 u/s): with speed_sustained:pulse out of shadowKinds the pulse tier alerts', acLines(H2).slice(0, 3));
}
// collusion or a hosted NPC: a Voice hit (Unrelenting Force) on the runner every 9 s, while running 2000 u/s. Each hit
// exempted 10 s and restarted the ring; now at most one Voice or dash exemption a minute
{
  const { W, H } = setup({});
  drive(H, W, A, 120, (s) => 1900 * s, { each: (s) => { if (s % 9 === 0) W.mp.onSpellHit(FRIEND, A, UF); } });
  const got = verdict(H, 'speed_');
  note('a Voice hit every 9 s from a friend or a hosted NPC, running 1900 u/s', got);
  ok(got === 'ALERT', 'a Voice hit every 9 s does not keep a 1900 u/s runner exempt: one exemption a minute', acLines(H).slice(0, 2));
}
// a character named 'shadow Wolf' (naming.js allows it): its live flag must not read as a shadow one to dbo-monitor
{
  const { W, H } = setup({});
  H.players.get(A).name = 'shadow Wolf';
  drive(H, W, A, 30, (s) => 2000 * s);
  const line = acLines(H).find((l) => /^ANTICHEAT speed_sustained /.test(l)) || '';
  const AC = require(F.MODULE);
  const m = new RegExp(AC.LOGGER_RX_SRC + AC.LINE_RX.source).exec(F.LOGGER + '[gamemode] ' + line);
  ok(!!m && m[2] === undefined && /^Shadow Wolf #PGDB$/.test(m[3]), "a live flag of a character named 'shadow Wolf' is written 'Shadow Wolf', so no reader takes it for a shadow line", line);
}
// a spoofed mount: the cheater activates a horse it hosts and drags it along (class mount, limit 850 = the alert speed)
{
  const { W, H } = setup({});
  W.mp.onActivate(HORSE, A);
  drive(H, W, A, 120, (s) => 840 * s, { horse: true });
  const got = verdict(H, 'speed_');
  note('spoofed mount (a hosted horse dragged along) at 840 u/s', got, 'speed_sustained60 mount tier, shadow');
  ok(got === 'SHADOW', 'a dragged horse at 840 u/s: residual, no alert (mount 850 = the alert speed; the foot tier is skipped), only the 60 s mount tier in shadow', acLines(H));
}
// honest guards for the restart budget: server teleports past it are taken out of the windows, never counted as a run
{
  const { W, H } = setup({});
  W.mp.onActivate(HORSE, A);
  let x = 0; const xs = [];
  for (let s = 1; s <= 420; s++) { x += s % 60 === 30 ? 30000 : 720; xs[s] = x; }
  drive(H, W, A, 420, (s) => xs[s], { horse: true });
  ok(alerts(H, 'speed_\\w*').length === 0, 'honest: a horse at 720 u/s teleported 30000 u by the server 7 times in 7 minutes: no alert (past 3 restarts the jump is taken out)', acLines(H).slice(0, 3));
}
{
  const { W, H } = setup({});
  let x = 0; const xs = [];
  for (let s = 1; s <= 420; s++) { x += s % 50 === 25 ? 12000 : 600; xs[s] = x; }
  drive(H, W, A, 420, (s) => xs[s]);
  ok(alerts(H, 'speed_\\w*').length === 0 && !acLines(H).some((l) => /over 60 s, limit 850/.test(l)), 'honest: a 600 u/s sprint with a 12000 u server teleport every 50 s: no alert and no pulse line', acLines(H).slice(0, 3));
}
// a player watched since before a reload of the older anticheat.js (no jmp ring): judged, no tick error
{
  const { W, H, G } = setup({});
  const st = G.ST.players.get(A); delete st.jmp; delete st.jumpTimes; delete st.exemptAt;
  drive(H, W, A, 30, (s) => 2000 * s);
  ok(!H.logs.some((l) => /anticheat: tick failed/.test(l)) && alerts(H, 'speed_\\w*').length > 0, 'a player state from before the reload is upgraded in place and judged', H.logs.filter((l) => /failed/.test(l)));
}
// a server stall the attacker causes (if it can): every flag is held 10 s and the rings restart; nothing to test here
// beyond what anticheat-speed-harness does (the hold); listed in the review

// ---- infinite magicka (interim, stored percentages only) --------------------------------------------------------------------
const castEvery = (H, W, a, secs, every, spell, each) => { for (let s = 1; s <= secs; s++) { if (each) each(s); if (s % every === 0) W.mp.onSpellCast(a, spell); H.tick(1000); } };
{
  const { W, H } = setup({});
  castEvery(H, W, A, 120, 2, FIREBALL);
  const got = verdict(H, 'magicka_');
  note('magicka frozen at full, Fireball every 2 s', got);
  ok(got === 'ALERT', 'off-the-shelf frozen-at-full magicka with Fireball every 2 s: magicka_free alerts', acLines(H).slice(0, 2));
}
{
  const { W, H } = setup({});
  W.set(A, 'percentages', { health: 1, magicka: 0.99, stamina: 1 });
  castEvery(H, W, A, 120, 2, FIREBALL);
  const got = verdict(H, 'magicka_');
  note('magicka frozen at 0.99 (never "full"), Fireball every 2 s', got);
  ok(got === 'MISS', 'magicka frozen at 0.99: residual (only casts at 0.995 or more are judged); the fork budget catches it', acLines(H));
}
{
  const { W, H } = setup({});
  castEvery(H, W, A, 120, 2, FIREBALL, (s) => W.set(A, 'percentages', { health: 1, magicka: s % 2 ? 0.985 : 1, stamina: 1 }));
  const got = verdict(H, 'magicka_');
  note('a fake 1.5% drop reported after each cast', got);
  ok(got === 'MISS', 'a fake small drop after each cast: residual (listed by the builder); the fork budget catches it', acLines(H));
}
// eating anything cleared the pending casts and skipped casts for 6 s: a cabbage after each cast hid them all. Now only
// food, potions and ingredients that can raise magicka count as a refill
{
  const { W, H } = setup({});
  castEvery(H, W, A, 120, 2, FIREBALL, (s) => { if (s % 2 === 1) W.mp.onEatItem(A, CABBAGE); });
  const got = verdict(H, 'magicka_');
  note('a cabbage eaten after each Fireball', got);
  ok(got === 'ALERT', 'a cabbage (no magicka effect) after each cast no longer hides the casts', acLines(H).slice(0, 2));
}
{
  const { W, H } = setup({});
  castEvery(H, W, A, 120, 2, FIREBALL, (s) => { if (s % 2 === 1) W.mp.onEatItem(A, SALT); });
  ok(verdict(H, 'magicka_') === 'ALERT', '...nor does a Salt Pile (only its first effect, Weakness to Magic, applies when eaten)', acLines(H).slice(0, 2));
}
{
  const { W, H, G } = setup({});
  W.mp.onEatItem(A, POTION_MAG);
  W.mp.onSpellCast(A, FIREBALL);
  ok(((G.ST.players.get(A) || {}).casts || []).length === 0, '...a Restore Magicka potion still skips the casts right after it (honest refill)');
}
{
  const { W, H } = setup({});
  W.set(A, 'equipment', { inv: { entries: [{ baseId: RING_FD, count: 1, worn: true }] } });
  castEvery(H, W, A, 120, 2, FIREBALL);
  const got = verdict(H, 'magicka_');
  note('one Fortify Destruction ring of any strength worn', got);
  ok(got === 'MISS', 'one Fortify Destruction ring (any magnitude): every Destruction cast is skipped, residual; the fork budget reads magnitudes', acLines(H));
}
{
  const { W, H } = setup({});
  for (let s = 1; s <= 600; s++) { if (s % 8 === 1) W.mp.onSpellCast(A, SPARKS); H.tick(1000); }
  const got = verdict(H, 'magicka_');
  note('cheap spells only (Sparks, SPIT 19 < minCost 30), 10 min', got);
  ok(got === 'MISS', 'cheap spells under minCost (Sparks 19/s): residual', acLines(H));
}
{
  // a relog every 10 casts: the pinned list went with the session
  const { W, H } = setup({});
  for (let r = 0; r < 4; r++) {
    castEvery(H, W, A, 20, 2, FIREBALL);
    H.players.get(A).online = false; H.tick(1000); H.tick(1000);
    H.players.get(A).online = true; H.tick(1000);
  }
  const got = verdict(H, 'magicka_');
  note('a relog after every 10 Fireballs', got);
  ok(got === 'MISS', 'a relog after every 10 casts resets the count: residual (a relog takes a minute; the fork keeps the actor state)', acLines(H));
}

// ---- infinite stamina (interim, shadow) -------------------------------------------------------------------------------------
{
  const { W, H } = setup({});
  drive(H, W, A, 40, (s) => 600 * s);
  note('stamina frozen, sprint 600 u/s for 40 s', verdict(H, 'stamina_'));
  ok(shadows(H, 'stamina_free').length > 0 && !alerts(H, 'stamina_free').length, 'off-the-shelf frozen stamina sprinting at 600: stamina_free, shadow (day 0, by design)', acLines(H));
}
{
  const { W, H } = setup({});
  drive(H, W, A, 120, (s) => 490 * s);
  const got = verdict(H, 'stamina_');
  note('stamina frozen, sprint at 490 u/s (under sprintSpeed 500)', got);
  ok(got === 'MISS', 'frozen stamina at 490 u/s: residual (sprintSpeed 500; the fork has the same 500 line)', acLines(H));
}
{
  const { W, H } = setup({});
  W.mp.onActivate(HORSE, A);
  drive(H, W, A, 120, (s) => 600 * s, { horse: true });
  const got = verdict(H, 'stamina_');
  note('stamina frozen, sprint 600 u/s with a dragged hosted horse (class mount)', got);
  ok(got === 'MISS', 'frozen stamina with a spoofed mount: residual (stamina_free is foot only)', acLines(H));
}

console.log('\nEVASION REPORT (gameplay lane, day-0 config)');
for (const r of report) console.log('  ' + r);
F.done();
