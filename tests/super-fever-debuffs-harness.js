// The fever's debuffs (Nate, 23 Oct: "fevers need debuffs"): three stages by the share of the incubation played, each with
// its own effects, announced once; a cure and the turning take them off at once; enabled false turns them all off. Loads
// the real supernatural.js against a stub api and world clock and drives its ticks by hand.
//   node tests/super-fever-debuffs-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-fever-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
fs.copyFileSync(path.join(SERVER, 'skills.json'), 'skills.json');
fs.writeFileSync('supernatural.json', JSON.stringify({ crown: null, revoke: [] }));

// Records: a Cure Disease potion, a fire spell (MagicDamageFire 1cead), raw beef, a cooked steak, an apple
const CURE_MGEF = 0xae722, POTION = 0x65a6b, FIREBOLT = 0x12fcd, FIRE_MGEF = 0x12e49, KW_FIRE = 0x1cead;
const BEEF = 0x65c9f, STEAK = 0x65c9e, APPLE = 0x64b2f;
const u32 = (...v) => { const b = new Uint8Array(4 * v.length); const d = new DataView(b.buffer); v.forEach((x, i) => d.setUint32(4 * i, x >>> 0, true)); return b; };
const RECORDS = {
  [POTION]: { type: 'ALCH', editorId: 'CureDisease', fields: [{ type: 'EFID', data: u32(CURE_MGEF) }] },
  [FIREBOLT]: { type: 'SPEL', editorId: 'Firebolt', fields: [{ type: 'EFID', data: u32(FIRE_MGEF) }] },
  [FIRE_MGEF]: { type: 'MGEF', editorId: 'FireDamageFFAimed', fields: [{ type: 'KWDA', data: u32(KW_FIRE) }] },
  [BEEF]: { type: 'ALCH', editorId: 'FoodBeef', fields: [] },
  [STEAK]: { type: 'ALCH', editorId: 'FoodBeefCooked', fields: [] },
  [APPLE]: { type: 'ALCH', editorId: 'FoodApple', fields: [] },
};
const lookup = (id) => (RECORDS[id >>> 0] ? { record: RECORDS[id >>> 0], toGlobalRecordId: (x) => x >>> 0 } : null);

const A = 0x71, B = 0x72;
const store = new Map(), said = [], packets = [], avs = [], timers = {};
let online = [A];
let now = Date.UTC(2026, 9, 23, 12, 0);
Date.now = () => now;
global.setTimeout = () => 0;
const GAME_DAY_MS = 4 * 3600000;
const start = now;
let night = false;
globalThis.__dboClock = { gameDays: () => (now - start) / GAME_DAY_MS, isNight: () => night, isFullMoon: () => false, weatherFor: () => 0 };
globalThis.__dboConnectedAt = new Map([[A, now - 3600000], [B, now - 3600000]]);
let refreshes = 0;
globalThis.__dboNeedsRefresh = () => { refreshes++; };
globalThis.__dboSetActorValue = (a, av, v) => { avs.push([a, av, v]); return true; };
const mp = {
  get: (id, p) => (p === 'type' ? 'MpActor' : store.get(`${id}|${p}`)),
  set: (id, p, v) => store.set(`${id}|${p}`, v),
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:x`,
  getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
  callPapyrusFunction: () => null, lookupEspmRecordById: lookup,
};
const noop = () => {};
const cfgFile = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));
const load = (superCfg) => {
  delete globalThis.__dboSuperState;
  mp.onHitDamageAttempt = () => true;
  require(path.join(SERVER, 'supernatural.js'))({
    mp, log: noop, audit: noop, personal: (a, t) => said.push([a, t]), registerChatCommand: noop, onUi: noop, openWidget: noop, closeWidget: noop,
    sendPacket: (a, p) => { packets.push([a, p]); return true; }, display: String, who: String, isAdmin: () => false, findByName: () => null,
    onlineActors: () => online, every: (n, ms, fn) => { timers[n] = fn; }, profileOf: (a) => (a < 0x1000 ? a : -1), nameOf: String,
    isWorldspace: (d) => !!d, needsFeed: noop, hungerOf: () => 0, cfg: { supernatural: superCfg, needs: cfgFile.needs }, sourceResistsOf: () => new Set(),
  });
};

let fail = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fail++; };
const near = (x, y) => Math.abs(x - y) < 1e-6;
const state = (a = A) => store.get(`${a}|private.supernatural`) || {};
const carry = (kind, played, a = A) => store.set(`${a}|private.supernatural`, { kind: null, disease: { kind, since: 0, played } });
const rate = (av, a = A) => globalThis.__dboSuperRateMult(a, av);
const food = (id, a = A) => globalThis.__dboSuperFoodMult(a, id);
const fire = (a = A) => globalThis.__dboSuperDamageMult(B, a, FIREBOLT);
const lastSaid = () => (said[said.length - 1] || [0, ''])[1];
const tick = () => { now += 15000; timers.superFever(); };
const pct = (v) => store.set(`${A}|percentages`, v);
store.set(`${A}|isDead`, false); store.set(`${A}|worldOrCellDesc`, '3c:Skyrim.esm');
store.set(`${B}|isDead`, false);

const C = cfgFile.supernatural;
ok(C.feverDebuffs && C.feverDebuffs.enabled === true, 'gamemode-config.json carries supernatural.feverDebuffs, on');
load(C);
ok(typeof timers.superFever === 'function', 'the fever tick is registered');

// ---- vampire fever ----
// early (under a third of three days)
carry('vampire', 0.2);
ok(near(rate('StaminaRateMult'), 0.75) && rate('HealRateMult') === 1, 'vampire, early: stamina recovers 25% slower, health as before', [rate('StaminaRateMult'), rate('HealRateMult')]);
ok(food(APPLE) === 1 && fire() === 1, 'vampire, early: food and fire as for anyone', [food(APPLE), fire()]);
ok(globalThis.__dboFeverRestless(A) === true, 'any carrier is restless: no Well Rested');
said.length = 0; refreshes = 0;
tick();
ok(said.length === 0 && refreshes === 1 && state().disease.feverStage === 1, 'the first stage is not announced again (the bite said it), and the rates are set', [said, refreshes, state().disease]);
tick();
ok(refreshes === 1, 'an unchanged stage does not resend the rates', refreshes);
// worsening
carry('vampire', 1.2); state().disease.feverStage = 1;
store.set(`${A}|private.supernatural`, Object.assign(state(), { disease: Object.assign(state().disease, { feverStage: 1 }) }));
pct({ health: 1, magicka: 1, stamina: 0.8 });
tick();
ok(/fever worsens/i.test(lastSaid()) && state().disease.feverStage === 2 && refreshes === 2, 'vampire, worsening: announced once in a short line, the rates resent', [lastSaid(), refreshes]);
ok(near(rate('HealRateMult'), 0.5) && near(rate('StaminaRateMult'), 0.75), 'vampire, worsening: health recovers half as fast, stamina still 25% slower');
ok(near(store.get(`${A}|percentages`).stamina, 0.8 - 0.06 / 4), 'vampire, worsening: daylight outdoors takes a little stamina each tick', store.get(`${A}|percentages`));
pct({ health: 1, magicka: 1, stamina: 0.3 });
tick();
ok(store.get(`${A}|percentages`).stamina === 0.3, 'never below the floor', store.get(`${A}|percentages`));
night = true; pct({ health: 1, magicka: 1, stamina: 0.8 }); tick();
ok(store.get(`${A}|percentages`).stamina === 0.8, 'nothing at night', store.get(`${A}|percentages`));
night = false; store.set(`${A}|worldOrCellDesc`, ''); tick();
ok(store.get(`${A}|percentages`).stamina === 0.8, 'nothing indoors', store.get(`${A}|percentages`));
store.set(`${A}|worldOrCellDesc`, '3c:Skyrim.esm');
said.length = 0; tick();
ok(said.length === 0, 'the stage is announced only once');
// near the peak
carry('vampire', 2.2); store.set(`${A}|private.supernatural`, Object.assign(state(), { disease: Object.assign(state().disease, { feverStage: 2 }) }));
tick();
ok(/burns cold/.test(lastSaid()), 'vampire, near the peak: announced', lastSaid());
ok(near(rate('HealRateMult'), 0.25), 'vampire, near the peak: health recovers at a quarter', rate('HealRateMult'));
ok(near(food(APPLE), 0.5) && near(food(STEAK), 0.5), 'vampire, near the peak: all food fills half', [food(APPLE), food(STEAK)]);
ok(/turns your stomach/.test(globalThis.__dboSuperFoodLine(A, APPLE)), 'and gamemode.js is given a fever line, not the vampire\'s ash', globalThis.__dboSuperFoodLine(A, APPLE));
ok(near(fire(), 1.15), 'vampire, near the peak: fire hurts 15% more', fire());
const prog = globalThis.__dboSuperProgress(A);
const row = prog && prog.rows.find((r) => r.label === 'How it takes you');
ok(row && row.value === 'Near its peak' && /fire/.test(row.hint) && !/\bturn\b|hours|minutes/.test(row.hint), 'the F3 fever tab names the stage in plain words, with no countdown', row);
// the cure: a Cure Disease potion
avs.length = 0; refreshes = 0;
globalThis.__dboSuperEat(A, POTION);
ok(!state().disease && rate('HealRateMult') === 1 && rate('StaminaRateMult') === 1 && food(APPLE) === 1 && fire() === 1 && !globalThis.__dboFeverRestless(A), 'the cure takes every debuff off at once', [state(), rate('HealRateMult'), food(APPLE), fire()]);
ok(refreshes === 1, 'and the rates are resent at once', refreshes);

// ---- werewolf fever ----
carry('werewolf', 0.1); avs.length = 0; refreshes = 0;
tick();
ok(rate('HealRateMult') === 1 && rate('StaminaRateMult') === 1 && food(STEAK) === 1 && avs.length === 0, 'werewolf, early: only the restless sleep', avs);
ok(globalThis.__dboFeverRestless(A) === true, 'werewolf, early: no Well Rested');
carry('werewolf', 1.5); store.set(`${A}|private.supernatural`, Object.assign(state(), { disease: Object.assign(state().disease, { feverStage: 1 }) }));
tick();
ok(/Magic slips/.test(lastSaid()), 'werewolf, worsening: announced', lastSaid());
ok(avs.some(([a, av, v]) => a === A && av === 'MagickaRateMult' && v === 50), 'werewolf, worsening: magicka recovers half as fast (MagickaRateMult 50)', avs);
ok(near(food(STEAK), 0.5) && food(BEEF) === 1 && food(APPLE) === 1, 'werewolf, worsening: cooked food fills half; raw meat and the rest as before', [food(STEAK), food(BEEF), food(APPLE)]);
ok(/raw meat/.test(globalThis.__dboSuperFoodLine(A, STEAK)), 'with a line about raw meat', globalThis.__dboSuperFoodLine(A, STEAK));
avs.length = 0; tick();
ok(avs.length === 0, 'the magicka rate is not resent every tick');
now += 60000; tick();
ok(avs.some(([, av, v]) => av === 'MagickaRateMult' && v === 50), 'but again after reapplySeconds, since Death\'s Chill writes it too', avs);
globalThis.__dboChillRateMult = (a, av) => (av === 'MagickaRateMult' ? 0.5 : 1);
avs.length = 0; now += 60000; tick();
ok(avs.some(([, av, v]) => av === 'MagickaRateMult' && v === 25), 'combined with the chill when one runs', avs);
globalThis.__dboChillRateMult = null;
// near the peak: by day and by night
carry('werewolf', 2.5); store.set(`${A}|private.supernatural`, Object.assign(state(), { disease: Object.assign(state().disease, { feverStage: 2 }) }));
night = false; refreshes = 0; packets.length = 0;
tick();
ok(/fever rages/.test(lastSaid()), 'werewolf, near the peak: announced', lastSaid());
ok(near(rate('HealRateMult'), 0.5), 'werewolf, near the peak: by day health recovers half as fast', rate('HealRateMult'));
ok(!packets.some(([, p]) => p.customPacketType === 'dboShake'), 'no jitters by day');
night = true; refreshes = 0;
const rnd = Math.random; Math.random = () => 0;
tick();
ok(rate('HealRateMult') === 1 && refreshes === 1, 'by night health recovers as before, and nightfall resends the rates', [rate('HealRateMult'), refreshes]);
ok(packets.some(([a, p]) => a === A && p.customPacketType === 'dboShake' && p.strength > 0 && p.strength < 0.5), 'by night a small screen shake', packets);
packets.length = 0; tick();
ok(!packets.some(([, p]) => p.customPacketType === 'dboShake'), 'not again before everyMinutes');
Math.random = rnd;
// the turning: the fever peaks and they become a werewolf; every fever effect goes
avs.length = 0;
carry('werewolf', 3); store.set(`${A}|private.supernatural`, Object.assign(state(), { disease: Object.assign(state().disease, { feverStage: 3 }) }));
globalThis.__dboFeverApplied.set(A, { key: 'werewolf:3:n', magicka: 0.5, at: now, shakeAt: now });
now += 15000; timers.superSlow();
ok(state().kind === 'werewolf' && !state().disease, 'the peak turns the carrier', state());
ok(avs.some(([, av, v]) => av === 'MagickaRateMult' && v === 100) && rate('HealRateMult') === 1 && !globalThis.__dboFeverRestless(A) && !globalThis.__dboFeverApplied.has(A), 'and the turning takes the fever\'s effects off at once', avs);
night = false;

// ---- enabled false ----
load(Object.assign({}, C, { feverDebuffs: Object.assign({}, C.feverDebuffs, { enabled: false }) }));
carry('vampire', 2.5);
said.length = 0; pct({ health: 1, magicka: 1, stamina: 0.8 });
tick();
ok(rate('HealRateMult') === 1 && rate('StaminaRateMult') === 1 && food(APPLE) === 1 && fire() === 1 && !globalThis.__dboFeverRestless(A), 'enabled false: no debuff at all', [rate('HealRateMult'), food(APPLE), fire()]);
ok(said.length === 0 && store.get(`${A}|percentages`).stamina === 0.8, 'enabled false: no line, no daylight toll');
const offRow = globalThis.__dboSuperProgress(A).rows.find((r) => r.label === 'How it takes you');
ok(!offRow, 'enabled false: no stage row in the fever tab');
carry('werewolf', 1.5); avs.length = 0; tick();
ok(avs.length === 0, 'enabled false: the magicka rate is never written');
// A switch-off with effects on takes them off
load(C); carry('werewolf', 1.5); tick();
load(Object.assign({}, C, { feverDebuffs: Object.assign({}, C.feverDebuffs, { enabled: false }) }));
avs.length = 0; tick();
ok(avs.some(([, av, v]) => av === 'MagickaRateMult' && v === 100), 'switching it off with a reload restores magicka recovery', avs);

// ---- a vampire's own food rule is untouched; gamemode.js hands the food line its baseId ----
load(C);
store.set(`${A}|private.supernatural`, { kind: 'vampire', stage: 1, lastFed: globalThis.__dboClock.gameDays(), unfed: null });
ok(food(APPLE) === 0.25 && globalThis.__dboSuperFoodLine(A, APPLE) === '', 'a vampire keeps the 25% food and the ash line', [food(APPLE), globalThis.__dboSuperFoodLine(A, APPLE)]);
const GM = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
ok(/__dboSuperFoodMult\(a, baseId\)/.test(GM) && /__dboSuperFoodLine\(a, baseId\)/.test(GM), 'gamemode.js passes the eaten item to the food hooks');
ok(/'__dboFeverRestless'/.test(GM), 'gamemode.js nulls the fever hooks if supernatural.js fails to load');

console.log(fail ? `${fail} failed` : 'all checks passed');
process.exit(fail ? 1 : 0);
