// Better boss fights at the same strength (Nat, 31 Oct: "don't nerf the bosses, just make them better"; "make sure
// everything is optimized"). Loads the real bosses.js with a mock gamemode api and walks the engine: the shared fight timer
// (none until a player strikes a boss, stopped when no fight is on), the telegraph (a warning line and banner to the players
// in range only, then the window where the boss's blows land at hitMult and a blocked one at blockedMult), the stagger (a
// bash or a power attack in the warning cancels the window and leaves the boss open, no give-back), the phases (a champion
// called at 66%, the last stand at 33%), waves that grow with the fighters, the bonus pool picks (enraged, flawless, the
// first of the day), and the cost of one timer tick with a fight on.
//   node tests/boss-telegraph-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 500) : ''}`); if (!c) fails++; };
const REAL = JSON.parse(fs.readFileSync(path.join(ROOT, 'bosses.json'), 'utf8'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-bosstele-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
const copy = JSON.parse(JSON.stringify(REAL));
for (const b of copy.bosses) b.enabled = true;
fs.writeFileSync(path.join(dir, 'bosses.json'), JSON.stringify(copy));
fs.writeFileSync(path.join(dir, 'NPC-Spawns.json'), JSON.stringify({ zones: [] }));
const def = (id) => copy.bosses.find((b) => b.id === id);

let now = 1790000000000;
const realNow = Date.now; Date.now = () => now;
let rnd = 0.5; const realRandom = Math.random; Math.random = () => rnd;
const B = 0xff200001;   // the Centurion Master: no guardian, so a champion is called at 66%
const P = [0xff000101, 0xff000102, 0xff000103, 0xff000104, 0xff000105, 0xff000106];
const FAR = 0xff000107, ELSEWHERE = 0xff000108;
const PROFILE = {}; [...P, FAR, ELSEWHERE].forEach((a, i) => { PROFILE[a] = 20 + i; });
const props = new Map(), said = [], given = [], banners = [], logs = [], stopped = [];
const put = (id, k, v) => props.set(`${id}|${k}`, v);
const PLUGINS = { 'Skyrim.esm': 0, 'Update.esm': 1, 'Dawnguard.esm': 2, 'HearthFires.esm': 3, 'Dragonborn.esm': 4, 'BSAssets.esm': 7, 'BSHeartland.esm': 8, 'DragonBreak Online Edits.esp': 9 };
const idOf = (d) => { const [h, p] = String(d).split(':'); return (((PLUGINS[p] !== undefined ? PLUGINS[p] : 10) << 24) | parseInt(h, 16)) >>> 0; };
const mp = { get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v), getIdFromDesc: idOf, getDescFromId: (id) => (id >>> 0).toString(16), callPapyrusFunction: () => {} };
let online = [...P, FAR, ELSEWHERE];
const timers = new Map();
const cwd = process.cwd();
const load = (cfg) => {
  process.chdir(dir);
  try {
    delete require.cache[path.join(ROOT, 'bosses.js')];
    require(path.join(ROOT, 'bosses.js'))({ mp, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => said.push([a, t]), audit: () => {}, display: (a) => `P${(a >>> 0).toString(16)}`, who: String,
      cfg: cfg || {}, giveItem: (a, id, n) => { given.push([a, id, n]); return true; }, registerChatCommand: () => {}, isLeadStaff: () => false,
      sendPacket: (a, p) => { if (p.customPacketType === 'dboBanner') banners.push([a, p.text]); },
      onlineActors: () => online, every: (n, ms, fn) => timers.set(n, fn), stopTimer: (n) => { stopped.push(n); timers.delete(n); }, profileOf: (a) => (PROFILE[a] !== undefined ? PROFILE[a] : -1), zoneOfActor: () => null });
  } finally { process.chdir(cwd); }
};
const tick = (live) => { fs.writeFileSync(path.join(dir, 'zone-spawns.json'), JSON.stringify(live)); process.chdir(dir); try { timers.get('bosses')(); } finally { process.chdir(cwd); } };
const fightTick = () => { const t = timers.get('bossFights'); if (t) t(); };
const zones = () => JSON.parse(fs.readFileSync(path.join(dir, 'NPC-Spawns.json'), 'utf8')).zones;
const toldTo = (a) => said.filter((x) => x[0] === a).map((x) => x[1]).join(' | ');
const WORLD = '3c:Skyrim.esm';
for (const a of [...P, FAR, B]) put(a, 'worldOrCellDesc', WORLD);
put(ELSEWHERE, 'worldOrCellDesc', '1234:Skyrim.esm');   // verify-formids: ignore - harness fixture, any other cell
put(B, 'pos', [1000, 1000, 0]);
P.forEach((a, i) => put(a, 'pos', [1000 + 200 * i, 1000, 0]));
put(FAR, 'pos', [1000 + 9000, 1000, 0]);
put(ELSEWHERE, 'pos', [1000, 1000, 0]);   // the same coordinates in another cell
const hp = (id, h) => put(id, 'percentages', { health: h, magicka: 1, stamina: 1 });
const health = (id) => props.get(`${id}|percentages`).health;
const hit = (agg, dmg, after) => { hp(B, after); globalThis.__dboBossHit(agg, B, dmg); return health(B); };
const CB = def('centurion');
globalThis.__dboSchematicBook = (fam) => ({ bookId: 0x7000, name: `Schematics: ${fam}` });
globalThis.__dboKnowsFamily = () => false;
let downed = new Set();
globalThis.__dboIsDowned = (a) => downed.has(a);

// ---- nothing runs before a fight ----
load({});
put(B, 'private.npcSpawner', 'boss:centurion:boss'); hp(B, 1);
tick([B]);
ok(!timers.has('bossFights'), 'a boss standing up with nobody fighting it starts no fight timer');
// A blow on the boss's own target that is not a player (an NPC brawl) starts nothing either
globalThis.__dboBossHit(0xff300001, B, 50);
ok(!timers.has('bossFights'), '...nor does a blow from an NPC');

// ---- the fight starts: one shared timer ----
hit(P[0], 100, 0.98);
ok(timers.has('bossFights'), 'the first player blow starts the shared fight timer (bossFights, in the ticks log)');
fightTick();
const T = { everySeconds: 25, warnSeconds: 2, windowSeconds: 3, hitMult: 1.25, blockedMult: 0.25, range: 3000, exposedSeconds: 5 };
const mult = (flags) => globalThis.__dboBossDamageMult(B, P[0], 0, flags || {});
ok(mult() === CB.damageMult, `no window yet: his blows land at his own x${CB.damageMult}`, mult());
now += T.everySeconds * 1000 * 0.75; fightTick();
ok(banners.length === 0, 'no warning before the earliest time (a fifth under everySeconds)');
now += T.everySeconds * 1000 * 0.5; fightTick();
const warned = new Set(banners.map((b) => b[0]));
ok(warned.has(P[0]) && warned.has(P[5]) && !warned.has(FAR) && !warned.has(ELSEWHERE), 'the warning banner goes to the players within range only (not one 9000 away, nor one in another cell)', [...warned]);
ok(/gathers itself/.test(toldTo(P[1])) && /bash or a power attack/.test(toldTo(P[1])) && !toldTo(FAR), 'with a chat line saying how to answer it', toldTo(P[1]));
ok(mult() === CB.damageMult, 'during the warning his blows are still his own');
now += T.warnSeconds * 1000; fightTick();
ok(Math.abs(mult() - CB.damageMult * T.hitMult) < 1e-9, `in the window his blows land at x${T.hitMult}`, mult());
ok(Math.abs(mult({ blocked: true }) - CB.damageMult * T.blockedMult) < 1e-9, `a blocked one at x${T.blockedMult}`, mult({ blocked: true }));
ok(globalThis.__dboBossDamageMult(0xff300009, P[0], 0, {}) === 1 && globalThis.__dboBossDamageMult(B, 0xff300009, 0, {}) === 1, 'an add\'s blows, and his blows on an NPC, are untouched');
now += T.windowSeconds * 1000; fightTick();
ok(mult() === CB.damageMult, 'after the window his blows are his own again');

// ---- the stagger ----
const toWarn = () => { banners.length = 0; for (let i = 0; i < 100 && !banners.length; i++) { now += 1000; fightTick(); } };
toWarn();
globalThis.__dboBossStruck(P[2], B, 0, { power: false, bash: false });
ok(!logs.some((l) => /staggered/.test(l)), 'a plain blow in the warning does not stagger him');
globalThis.__dboBossStruck(P[2], B, 0, { bash: true });
ok(logs.some((l) => /centurion staggered/.test(l)) && /is staggered/.test(toldTo(P[4])), 'a bash in the warning staggers him, and the fighters are told');
now += T.warnSeconds * 1000; fightTick();
ok(mult() === CB.damageMult, '...so no window follows');
let h = health(B);
let h2 = hit(P[2], 100, h - 0.05);
ok(Math.abs(h2 - (h - 0.05)) < 1e-9, '...and he is open: no give-back on a blow', [h, h2]);
now += T.exposedSeconds * 1000 + 1;
h = h2; h2 = hit(P[2], 100, h - 0.05);
ok(h2 > h - 0.05 + 1e-6, `after ${T.exposedSeconds} s his give-back is back`, [h, h2]);
toWarn(); now += T.warnSeconds * 1000; fightTick();
globalThis.__dboBossStruck(P[2], B, 0, { power: true });
ok(Math.abs(mult() - CB.damageMult * T.hitMult) < 1e-9, 'a power attack once the window is open is too late: the window stays');
now += T.windowSeconds * 1000; fightTick();
toWarn(); globalThis.__dboBossStruck(0xff300001, B, 0, { power: true });
now += T.warnSeconds * 1000; fightTick();
ok(Math.abs(mult() - CB.damageMult * T.hitMult) < 1e-9, 'an NPC\'s power attack does not stagger him');
now += T.windowSeconds * 1000; fightTick();

// ---- six fighters: waves grow; phases ----
for (const a of P) hit(a, 10, health(B) - 0.0001);
const hitTo = (share) => { let x = health(B); for (let i = 0; x > share && i < 2000; i++) x = hit(P[i % 6], 50, Math.max(0.001, x - 0.3)); return x; };
hitTo(CB.waves[0][0]);
const w0 = zones().filter((z) => /^boss:centurion:w0-\d+$/.test(z.Name));
ok(w0.length === CB.waves[0][1] + 1, `six fighters: the first wave is ${CB.waves[0][1]} and one more`, w0.map((z) => z.Name));
hitTo(0.66);
ok(zones().some((z) => z.Name === 'boss:centurion:p0') && /calls its champion/.test(toldTo(P[3])), 'at 66% he calls a champion beside him', zones().map((z) => z.Name));
const before33 = mult();
hitTo(0.33);
ok(/last stand/.test(toldTo(P[1])) && Math.abs(mult() - before33 * 1.2) < 1e-9, 'at 33% his last stand: his blows x1.2', [before33, mult()]);
ok(!zones().some((z) => z.Name === 'boss:centurion:p1'), '...and no second champion');

// ---- the kill: bonus picks ----
const pool = CB.drops.pool; const poolIds = new Set(pool.items.map((x) => idOf(x[0])));
const poolGifts = (a) => given.filter((g) => g[0] === a && poolIds.has(g[1])).length;
now += CB.enrageSeconds * 1000; tick([B]); fightTick();
downed = new Set([P[5]]); now += 2000; fightTick();
given.length = 0; said.length = 0;
globalThis.__dboBossDeath(B, P[0]);
ok(poolGifts(P[0]) === pool.picks + 2 && /Bonus from the pool: enraged, the first of the day/.test(toldTo(P[0])), 'enraged and the first of the day: two more picks (P6 went down, so not flawless)', [poolGifts(P[0]), toldTo(P[0])]);
fightTick();
ok(!timers.has('bossFights') && stopped.includes('bossFights'), 'the fight over, the shared timer stops');

// ---- a second fight the same day, flawless, not enraged ----
now += 3700 * 1000;
const B2 = 0xff200002; put(B2, 'private.npcSpawner', 'boss:centurion:boss'); put(B2, 'worldOrCellDesc', WORLD); put(B2, 'pos', [1000, 1000, 0]); hp(B2, 1);
tick([B2]); downed = new Set();
const F = 0xff000109; PROFILE[F] = 40; put(F, 'worldOrCellDesc', WORLD); put(F, 'pos', [1000, 1000, 0]);
hp(B2, 0.5); globalThis.__dboBossHit(F, B2, 100); fightTick(); now += 2000; fightTick();
given.length = 0; said.length = 0;
globalThis.__dboBossDeath(B2, F);
ok(poolGifts(F) === pool.picks + 1 && /Bonus from the pool: flawless\./.test(toldTo(F)), 'a flawless kill later that day: one more pick', [poolGifts(F), toldTo(F)]);


// ---- config off ----
load({ bosses: { telegraph: { enabled: false }, phases: { enabled: false } } });
const B3 = 0xff200003; put(B3, 'private.npcSpawner', 'boss:centurion:boss'); put(B3, 'worldOrCellDesc', WORLD); put(B3, 'pos', [1000, 1000, 0]); hp(B3, 1);
now += 3700 * 1000; tick([B3]);
banners.length = 0; said.length = 0;
for (let i = 0; i < 2000 && (props.get(`${B3}|percentages`).health > 0.3); i++) { hp(B3, Math.max(0.01, props.get(`${B3}|percentages`).health - 0.3)); globalThis.__dboBossHit(P[0], B3, 10); }
for (let i = 0; i < 60; i++) { now += 1000; fightTick(); }
ok(banners.length === 0 && props.get(`${B3}|percentages`).health <= 0.3 && !/last stand/.test(said.map((s) => s[1]).join()), 'bosses.telegraph and bosses.phases enabled false: no warning, no last stand (the rollback)');
ok(globalThis.__dboBossDamageMult(B3, P[0], 0, {}) === CB.damageMult, '...and his own multiplier, untouched');

// ---- gamemode.js wiring ----
const gsrc = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
ok(/__dboBossDamageMult\(agg, tgt, src, flags\)/.test(gsrc) && /dmg > 0 && globalThis\.__dboBossStruck\) globalThis\.__dboBossStruck\(agg, tgt, src, flags\)/.test(gsrc) && /__dboBossStruck = null/.test(gsrc),
  'gamemode.js hands the hit flags to the boss damage hook, calls the stagger hook on a landed blow, and clears it if bosses.js fails');

// ---- cost: one fight tick with a fight on, 40 players online ----
load({});
const B4 = 0xff200004; put(B4, 'private.npcSpawner', 'boss:centurion:boss'); put(B4, 'worldOrCellDesc', WORLD); put(B4, 'pos', [1000, 1000, 0]); hp(B4, 1);
now += 3700 * 1000; tick([B4]);
online = []; for (let i = 0; i < 40; i++) { const a = 0xff010000 + i; online.push(a); PROFILE[a] = 100 + i; put(a, 'worldOrCellDesc', WORLD); put(a, 'pos', [1000 + 100 * i, 1000, 0]); }
hp(B4, 0.99); globalThis.__dboBossHit(online[0], B4, 10);
for (let i = 1; i < 10; i++) globalThis.__dboBossHit(online[i], B4, 10);
const N = 20000; let worst = 0n; const t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) { now += 250; const s = process.hrtime.bigint(); fightTick(); const d = process.hrtime.bigint() - s; if (d > worst) worst = d; }
const avgUs = Number(process.hrtime.bigint() - t0) / N / 1000;
const warnings = banners.length;
console.log(`cost  ${avgUs.toFixed(2)} us per fight tick on average (250 ms ticks, 1 fight, 10 fighters, 40 online), worst ${(Number(worst) / 1000).toFixed(0)} us (a warning going out); ${warnings} banners in ${N / 4} s`);
ok(avgUs < 50, 'a fight tick costs under 50 us on average', avgUs);

Date.now = realNow; Math.random = realRandom;
console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exitCode = fails ? 1 : 0;
