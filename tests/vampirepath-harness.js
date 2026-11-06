// The vampire's path (vampirepath.js; Nat, 31 Oct): Feral, Molag Bal's devotion and tiers, the Embrace's gate, the backlash,
// Elders, the Crown sense and the drain. The real module against a stub world, with its clock, timers and dice held here.
//   node tests/vampirepath-harness.js   (from server\)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, name, got) => { if (!c) fails++; console.log(`${c ? 'ok  ' : 'FAIL'} ${name}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); };

// ---- clock, timers, dice ---------------------------------------------------------------------------------------------
let clock = Date.parse('2026-10-31T12:00:00Z');
Date.now = () => clock;
let timers = [];
global.setTimeout = (fn, ms) => { const t = { at: clock + (Number(ms) || 0), fn, id: Symbol('t') }; timers.push(t); return t.id; };
global.clearTimeout = (id) => { timers = timers.filter((t) => t.id !== id); };
const advance = (ms) => { const end = clock + ms; for (;;) { const due = timers.filter((t) => t.at <= end).sort((x, y) => x.at - y.at)[0]; if (!due) break; clock = due.at; timers = timers.filter((t) => t !== due); due.fn(); } clock = end; };
let dice = [];
Math.random = () => (dice.length ? dice.shift() : 0.999);

// ---- the world -----------------------------------------------------------------------------------------------------
const V = 0xff000001, V2 = 0xff000002, LORD = 0xff000003, ELDER = 0xff000004, MORTAL = 0xff000005, P = 0xff000006, ALT = 0xff000007;
const PROFILE = { [V]: 1, [V2]: 2, [LORD]: 3, [ELDER]: 4, [MORTAL]: 5, [P]: 6, [ALT]: 4 };
const WORLD = '3c:Skyrim.esm', INN = '9001:Skyrim.esm', JAILCELL = '9002:Skyrim.esm', PLAIN = '9003:Skyrim.esm';
const props = new Map();
const setp = (a, k, v) => props.set(`${a}|${k}`, v);
const getp = (a, k) => props.get(`${a}|${k}`);
const vampires = new Map(); // actor -> { stage, pure, unfed }
const ranks = new Map(), patrons = new Map(), downedSet = new Set(), duels = new Set();
let crown = 0, crownSince = 0;
const frenzied = new Set();
const onlineSet = new Set([V, V2, LORD, ELDER, MORTAL, P]);
const at = (a, m, world) => { setp(a, 'worldOrCellDesc', world || WORLD); setp(a, 'pos', [m * 70, 0, 0]); };
// A CELL whose location (XLCN) is an inn (KWDA: LocTypeInn 1cb87), and a plain one
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const RECORDS = {
  0x9001: { record: { type: 'CELL', fields: [{ type: 'XLCN', data: u32(0x9101) }] }, toGlobalRecordId: (x) => x },
  0x9003: { record: { type: 'CELL', fields: [{ type: 'XLCN', data: u32(0x9103) }] }, toGlobalRecordId: (x) => x },
  0x9101: { record: { type: 'LCTN', fields: [{ type: 'KWDA', data: u32(0x1cb87) }] }, toGlobalRecordId: (x) => x },
  0x9103: { record: { type: 'LCTN', fields: [{ type: 'KWDA', data: u32(0x1cb86) }] }, toGlobalRecordId: (x) => x },
};
const mp = {
  get: (a, k) => {
    if (k === 'isDead') return downedSet.has(a) || getp(a, k) === true;
    return getp(a, k);
  },
  set: setp,
  getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
  lookupEspmRecordById: (id) => RECORDS[id] || null,
};
const said = [], audits = [], packets = [], cmds = new Map(), every = new Map(), calls = [];
const lastSaid = (a) => { for (let i = said.length - 1; i >= 0; i--) if (said[i][0] === a) return said[i][1]; return ''; };
// supernatural.js, bloodranks.js, prayer.js, frenzy.js, downed.js, duel.js as hooks
Object.assign(globalThis, {
  __dboSuperVampState: (a) => (vampires.has(a) ? Object.assign({ kind: 'vampire' }, vampires.get(a)) : { kind: null, stage: 0, pure: false, unfed: false }),
  __dboSuperCrownHolder: () => crown,
  __dboSuperCrownSince: () => crownSince,
  __dboBloodRank: (a) => ranks.get(a) || 0,
  __dboBloodThirstRate: () => 1,
  // every vampire here is of a clan (Volkihar, whose line leaves the path alone): bloodlines has its own harness
  __dboGuildsOf: (a) => (vampires.has(a) ? [{ id: 'clan-volkihar' }] : []),
  __dboFaithOf: (a) => (patrons.has(a) ? { faith: 'daedric', patron: patrons.get(a) } : null),
  __dboIsDowned: (a) => downedSet.has(a),
  __dboInDuel: (a) => duels.has(a),
  __dboSuperSunBurnAt: () => 0,
  __dboSuperLoginAt: new Map([[V, 0], [V2, 0], [LORD, 0], [ELDER, 0], [MORTAL, 0], [P, 0]]),
  __dboFrenzyVampire: (a, o) => { calls.push(['frenzy', a, o.seconds]); frenzied.add(a); return ''; },
  __dboFrenzyActive: (a) => frenzied.has(a),
  __dboFrenzyEnd: (a, why) => { frenzied.delete(a); calls.push(['frenzyEnd', a, why]); },
  __dboSuperFeralMeal: (a) => { calls.push(['meal', a]); return true; },
  __dboSuperSetThirst: (a, n, why) => { calls.push(['thirst', a, n, why]); vampires.get(a).stage = n; return true; },
  __dboSuperHurt: (a, share) => { calls.push(['hurt', a, share]); return true; },
  __dboSuperTakeCrown: (a, how) => { calls.push(['crown', a, how]); crown = a; return true; },
  __dboPermaKill: (a, why) => calls.push(['perma', a, why]),
  __dboPrayerLastShrine: new Map(),
  __dboClock: { isNight: () => night, gameDays: () => clock / 14400000 },
  __dboRites: new Map(),
});
let night = false;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-vampath-'));
fs.writeFileSync(path.join(scratch, 'jail-cells.json'), JSON.stringify({ cells: [JAILCELL] }));
process.chdir(scratch);
const load = (cfg) => {
  delete globalThis.__dboVampPath; delete globalThis.__dboVampSafeCells; timers = []; every.clear(); cmds.clear();
  delete require.cache[path.join(SERVER, 'vampirepath.js')];
  return require(path.join(SERVER, 'vampirepath.js'))({
    mp, log: () => {}, personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t), who: (a) => `#${a.toString(16)}`, display: (a) => `A${a.toString(16)}`,
    sendPacket: (a, p) => packets.push([a, p]), onlineActors: () => [...onlineSet], every: (n, ms, fn) => every.set(n, fn),
    registerChatCommand: (n, fn) => cmds.set(n, fn), profileOf: (a) => (PROFILE[a] === undefined ? -1 : PROFILE[a]), cfg: { vampirePath: cfg || {} },
    isLeadStaff: () => true, findByName: () => null, inEditor: () => false,
  });
};
const tick = (n) => every.get(n)();
const reset = () => {
  vampires.clear(); ranks.clear(); patrons.clear(); downedSet.clear(); duels.clear(); props.clear(); calls.length = 0; dice = []; night = false; crown = 0; crownSince = 0; frenzied.clear();
  for (const a of [V, V2, LORD, ELDER, MORTAL, P]) { at(a, 0); setp(a, 'percentages', { health: 1 }); }
  clock += 3600000; // well past every login grace
};

// ---- the tiers and devotion -----------------------------------------------------------------------------------------
reset(); let M = load();
vampires.set(V, { stage: 1 });
ok(M.tierOf(V) === null, 'not sworn to Molag Bal: no tier');
patrons.set(V, 'molagbal');
ok(M.tierOf(V).name === 'Sworn', 'sworn, no devotion yet: Sworn');
setp(V, 'private.molagDevotion', { points: 150 }); ok(M.tierOf(V).name === 'Devout' && M.tierOf(V).feral === 0.5, 'devotion 150: Devout (feral x0.5)');
setp(V, 'private.molagDevotion', { points: 400 }); ok(M.tierOf(V).name === 'Chosen' && M.tierOf(V).power === 1.35, 'devotion 400: Chosen (power x1.35)');
vampires.get(V).pure = true; ok(M.tierOf(V).name === 'Pure-blood' && M.tierOf(V).feral === 0.15 && M.tierOf(V).backlash === 0.12, 'a sworn pure-blood: the pure factors');
vampires.get(V).pure = false; setp(V, 'private.molagDevotion', { points: 0 });

globalThis.__dboVampPrayed(V, 'molagbal', { atShrine: true });
ok(M.devOf(V).points === 5, 'a prayer at his shrine: +5');
globalThis.__dboVampPrayed(V, 'molagbal', { atShrine: true });
ok(M.devOf(V).points === 5, '...once a game day');
clock += 14400000; globalThis.__dboVampPrayed(V, 'molagbal', { atShrine: true });
ok(M.devOf(V).points === 10, '...and again the next game day');
globalThis.__dboVampPrayed(V, 'arkay', { atShrine: true }); globalThis.__dboVampPrayed(V2, 'molagbal', { atShrine: true });
ok(M.devOf(V).points === 10 && M.devOf(V2).points === 0, 'another god\'s prayer, or an unsworn worshipper, gives nothing');
globalThis.__dboVampFed(V, P, 'living');
ok(M.devOf(V).points === 20, 'a living person fed on: +10');
globalThis.__dboVampFed(V, P, 'living'); globalThis.__dboVampFed(V, P, 'body');
ok(M.devOf(V).points === 20, '...once per victim account a real day; a body gives nothing');
clock += 86400000; globalThis.__dboVampFed(V, P, 'living');
ok(M.devOf(V).points === 30, '...again a real day later');
PROFILE[ALT] = PROFILE[V]; globalThis.__dboVampFed(V, ALT, 'living'); PROFILE[ALT] = 4;
ok(M.devOf(V).points === 30, 'feeding on a character of their own account is no devotion');
tick('vampDaily'); ok(M.devOf(V).points === 32, 'a real day sworn: +2'); tick('vampDaily'); ok(M.devOf(V).points === 32, '...once a day');
// the offering
vampires.get(V).stage = 3;
cmds.get('offer')(V);
ok(/touch one, then say \/offer/.test(lastSaid(V)), '/offer away from his shrine is refused');
globalThis.__dboPrayerLastShrine.set(V, { deityId: 'molagbal', at: clock });
cmds.get('offer')(V);
ok(/filled black soul gem/.test(lastSaid(V)) && M.devOf(V).points === 32, 'no filled black soul gem: refused, no devotion');
setp(V, 'inventory', { entries: [{ baseId: 0x2e504, count: 2 }] });
cmds.get('offer')(V);
ok(M.devOf(V).points === 47 && getp(V, 'inventory').entries[0].count === 1 && calls.some((c) => c[0] === 'thirst' && c[2] === 2), 'the offering: one gem taken, +15, and the thirst one stage lower', { pts: M.devOf(V).points, calls });
// /offer <gold> is prayer.js's: this /offer replaced it for every god (#bugs 1567046457599598774, 0 gold offerings 5-6 Nov)
const goldOffers = [];
globalThis.__dboOfferGold = (a, s) => { goldOffers.push([a, s]); };
cmds.get('offer')(V, '50');
ok(goldOffers.length === 1 && goldOffers[0][1] === '50' && getp(V, 'inventory').entries[0].count === 1, '/offer <gold> at his shrine is a gold offering: no gem taken', goldOffers);
cmds.get('offer')(MORTAL, '');
ok(goldOffers.length === 2 && goldOffers[1][0] === MORTAL, 'a bare /offer by someone neither sworn nor at his shrine goes to the gold offering too', goldOffers);
const keptInv = getp(V, 'inventory');
setp(V, 'inventory', { entries: [] });
cmds.get('offer')(V);
ok(goldOffers.length === 2 && /filled black soul gem/.test(lastSaid(V)) && M.devOf(V).points === 47, '...and a bare /offer by his sworn at his shrine is still the soul offering', goldOffers);
setp(V, 'inventory', keptInv);
delete globalThis.__dboOfferGold;
// leaving him
patrons.set(V, 'boethiah'); tick('vampFeral');
ok(M.devOf(V).points === 0 && audits.some((t) => /left Molag Bal; devotion 47 lost/.test(t)), 'another patron empties the devotion');
patrons.set(V, 'molagbal');

// ---- the Embrace's gate ----------------------------------------------------------------------------------------------
ok(/Be turned first/.test(globalThis.__dboVampEmbraceRefusal(MORTAL)), 'a mortal is refused the Embrace (the bloodline is earned as a vampire)');
ok(/Swear yourself to Molag Bal/.test(globalThis.__dboVampEmbraceRefusal((vampires.set(V2, { stage: 1 }), V2))), 'an unsworn vampire is refused');
setp(V, 'private.molagDevotion', { points: 149 });
ok(/Devout \(149 of 150 devotion\)/.test(globalThis.__dboVampEmbraceRefusal(V)), 'a Sworn vampire is told how far from Devout', globalThis.__dboVampEmbraceRefusal(V));
setp(V, 'private.molagDevotion', { points: 150 });
ok(globalThis.__dboVampEmbraceRefusal(V) === '', 'a Devout vampire may kneel');
const sup = fs.readFileSync(path.join(SERVER, 'supernatural.js'), 'utf8');
const offer = sup.slice(sup.indexOf("if (deity === 'molagbal') {"), sup.indexOf("if (deity === 'hircine') {", sup.indexOf("if (deity === 'molagbal') {")));
ok(/__dboVampEmbraceRefusal/.test(offer) && offer.indexOf('__dboVampEmbraceRefusal') < offer.indexOf("type: 'embrace'"), 'supernatural.js riteOffer asks the gate before offering the Embrace');

// ---- the Feral's chance -----------------------------------------------------------------------------------------------
reset(); M = load();
vampires.set(V, { stage: 2 });
ok(M.feralChance(V, vampires.get(V)) === 0, 'stage 2: no chance');
vampires.get(V).stage = 4;
ok(Math.abs(M.feralChance(V, vampires.get(V)) - 0.04) < 1e-9, 'stage 4, by day, unsworn: 4% a minute');
night = true; ok(Math.abs(M.feralChance(V, vampires.get(V)) - 0.06) < 1e-9, '...x1.5 at night'); night = false;
globalThis.__dboSuperSunBurnAt = () => clock; ok(Math.abs(M.feralChance(V, vampires.get(V)) - 0.08) < 1e-9, '...x2 while the sun burns them'); globalThis.__dboSuperSunBurnAt = () => 0;
downedSet.add(P); at(P, 10); ok(Math.abs(M.feralChance(V, vampires.get(V)) - 0.2) < 1e-9, '...x5 with a downed player within 15 m (blood scent)');
at(P, 40); ok(Math.abs(M.feralChance(V, vampires.get(V)) - 0.04) < 1e-9, '...but not at 40 m'); downedSet.delete(P);
patrons.set(V, 'molagbal'); setp(V, 'private.molagDevotion', { points: 150 });
ok(Math.abs(M.feralChance(V, vampires.get(V)) - 0.02) < 1e-9, '...x0.5 for a Devout vampire');
patrons.delete(V); setp(V, 'private.molagDevotion', { points: 0 });

// ---- the Feral: who never, the warning, the frenzy, the end ---------------------------------------------------------------
const refusedFor = (setup, name) => { reset(); M = load(); vampires.set(V, { stage: 4 }); setup(); dice = [0]; tick('vampFeral'); ok(!M.S.due.has(V), name); };
refusedFor(() => { crown = V; }, 'the Crown\'s holder never goes Feral');
refusedFor(() => { vampires.get(V).unfed = true; }, 'a vampire not yet fed for the first time never goes Feral');
refusedFor(() => { setp(V, 'private.restrained', { boundHands: true }); }, 'bound hands: never');
refusedFor(() => { setp(V, 'private.dboSentence', { totalMs: 60000 }); }, 'jailed: never');
refusedFor(() => { duels.add(V); }, 'in a duel: never');
refusedFor(() => { globalThis.__dboSuperLoginAt.set(V, clock - 60000); }, 'in the login grace: never');
globalThis.__dboSuperLoginAt.set(V, 0);
refusedFor(() => { globalThis.__dboRites.set(V, {}); }, 'in a rite: never'); globalThis.__dboRites.clear();

reset(); M = load(); vampires.set(V, { stage: 4 });
dice = [0.05]; tick('vampFeral'); ok(!M.S.due.has(V), 'a roll above the chance: nothing');
dice = [0.01]; tick('vampFeral');
ok(M.S.due.has(V) && packets.some(([a, p]) => a === V && p.customPacketType === 'dboBanner' && /thirst is rising/.test(p.text)), 'a roll under it: the warning, as a banner');
advance(20000); ok(packets.some(([a, p]) => a === V && p.customPacketType === 'dboShake'), '...with the screen shaking');
advance(30000); ok(said.some(([a, t]) => a === V && /smell of blood/.test(t)), '...and the lines counting it down');
advance(40000);
ok(!M.S.due.has(V) && M.S.feral.has(V) && calls.some((c) => c[0] === 'frenzy' && c[1] === V && c[2] >= 30 && c[2] <= 60), '90 s later: Feral, the frenzy started for 30-60 s', calls);
ok(globalThis.__dboVampAggMult(V, false) === 1.15 && globalThis.__dboVampSunMult(V) === 1.2 && globalThis.__dboVampAggMult(V2, false) === 1, 'while Feral: hits x1.15, the sun x1.2; nobody else');
globalThis.__dboFeralKilled(V, P);
ok(!M.S.feral.has(V) && calls.some((c) => c[0] === 'meal' && c[1] === V) && calls.some((c) => c[0] === 'frenzyEnd'), 'a kill while Feral is a meal: it ends, the frenzy ends with it');
ok(!M.S.blocked.has(V), '...and having drunk, no block on the next roll');

reset(); M = load(); vampires.set(V, { stage: 4 }); dice = [0]; tick('vampFeral');
globalThis.__dboVampFed(V, 0, 'bottle');
ok(!M.S.due.has(V) && /blood calms you/.test(lastSaid(V)), 'blood during the warning (a bottle, a feed) ends it');
advance(200000); ok(!M.S.feral.has(V) && !calls.some((c) => c[0] === 'frenzy'), '...and no Feral follows');

reset(); M = load(); vampires.set(V, { stage: 3 }); dice = [0]; tick('vampFeral');
vampires.get(V).stage = 1; advance(100000);
ok(!M.S.feral.has(V) && /ebbs/.test(lastSaid(V)), 'fed meanwhile by other means (the thirst under stage 3): the Feral passes');

reset(); M = load(); vampires.set(V, { stage: 4 }); dice = [0]; tick('vampFeral'); advance(91000);
ok(M.S.feral.has(V), 'Feral (for the bound test)');
setp(V, 'private.restrained', { boundHands: true }); tick('vampAtBay');
ok(!M.S.feral.has(V) && M.S.blocked.get(V) > clock, 'bound hands end the Feral; it drank nothing, so the next roll waits blockMinutes');
setp(V, 'private.restrained', null);
dice = [0]; tick('vampFeral'); ok(!M.S.due.has(V), '...blocked: no roll');
advance(31 * 60000); dice = [0]; tick('vampFeral'); ok(M.S.due.has(V), '...after 30 min it can come again');

reset(); M = load(); vampires.set(V, { stage: 4 }); dice = [0]; tick('vampFeral'); advance(91000);
const fsecs = calls.find((c) => c[0] === 'frenzy')[2];
advance(fsecs * 1000 + 10);
ok(!M.S.feral.has(V) && audits.some((t) => /feral end #ff000001: time/.test(t)), 'the Feral\'s time runs out: it ends');

// at bay
reset(); M = load(); vampires.set(V, { stage: 3 });
setp(V, 'percentages', { health: 0.5 }); tick('vampAtBay');
setp(V, 'percentages', { health: 0.2 }); dice = [0.1]; tick('vampAtBay');
ok(M.S.due.has(V) && audits.some((t) => /feral warning #ff000001 \(at bay\)/.test(t)), 'at bay: health falling through 25% at stage 3 rolls 20% (0.1 hits)');
reset(); M = load(); vampires.set(V, { stage: 3 });
setp(V, 'percentages', { health: 0.2 }); tick('vampAtBay'); dice = [0]; tick('vampAtBay');
ok(!M.S.due.has(V), '...staying low rolls nothing more (only the fall through it)');
reset(); M = load(); vampires.set(V, { stage: 2 });
setp(V, 'percentages', { health: 0.5 }); tick('vampAtBay'); setp(V, 'percentages', { health: 0.2 }); dice = [0]; tick('vampAtBay');
ok(!M.S.due.has(V), '...not below stage 3');

// ---- the backlash and the power -------------------------------------------------------------------------------------------
reset(); M = load(); vampires.set(V, { stage: 2 });
dice = [0]; globalThis.__dboVampPowerUsed(V, 1); ok(!calls.length, 'unsworn: no backlash ever');
patrons.set(V, 'molagbal');
dice = [0.5]; globalThis.__dboVampPowerUsed(V, 1); ok(!calls.length, 'sworn (3%): a roll of 0.5 costs nothing');
dice = [0, 0]; globalThis.__dboVampPowerUsed(V, 1); ok(!calls.length && !M.S.due.has(V) && dice.length === 2, '...and a second use inside the use window rolls nothing (a Drain is many hits)', { calls, dice });
clock += 11000; dice = [0.01, 0]; globalThis.__dboVampPowerUsed(V, 1);
ok(calls.some((c) => c[0] === 'thirst' && c[2] === 3), 'backlash, thirst: the stage jumps by one', calls);
clock += 11000; dice = [0.01, 0.6]; globalThis.__dboVampPowerUsed(V, 1);
ok(calls.some((c) => c[0] === 'hurt' && c[2] === 0.25), 'backlash, price: a quarter of their health');
clock += 11000; dice = [0.01, 0.95]; globalThis.__dboVampPowerUsed(V, 1);
ok(M.S.due.has(V) && M.S.due.get(V).flare, 'backlash, flare: a Feral warning, short, at any stage (stage 3 here)');
advance(21000); ok(M.S.feral.has(V), '...20 s later, Feral');
setp(V, 'private.molagDevotion', { points: 150 });
ok(globalThis.__dboVampAggMult(V, true) === 1.15 * 1.2, 'a Devout vampire\'s Drain while Feral: x1.15 x1.2');
M.endFeral(V, 'test');
ok(globalThis.__dboVampAggMult(V, true) === 1.2 && globalThis.__dboVampAggMult(V, false) === 1, 'a Devout Drain x1.2; their other hits untouched');
const dm = sup.slice(sup.indexOf('const vampireDamageMult = globalThis.__dboSuperDamageMult;'), sup.indexOf('// rest.js: no Well Rested'));
ok(/__dboVampAggMult', agg >>> 0, VAMP_DRAIN_SET\.has/.test(dm), 'supernatural.js multiplies a vampire\'s hits by __dboVampAggMult, Drain named');
ok(/VAMP_POWER_SET\.has\(Number\(spellId\) >>> 0\) && isPlayer\(agg\) && kindOf\(agg\) === 'vampire'\) vampPath\('__dboVampPowerUsed'/.test(sup), 'supernatural.js reports a vampire power landing on someone');

// ---- Elders and the Crown sense -------------------------------------------------------------------------------------------
reset(); M = load();
vampires.set(ELDER, { stage: 1, pure: true }); ranks.set(ELDER, 4);
vampires.set(V, { stage: 1, pure: true }); ranks.set(V, 3);
vampires.set(V2, { stage: 1, pure: false }); ranks.set(V2, 4);
ok(M.isElder(ELDER) && !M.isElder(V) && !M.isElder(V2), 'an Elder is a pure-blood of Master Vampire rank; a Mistwalker pure-blood or an impure Master is not');
vampires.set(LORD, { stage: 1, pure: true }); crown = LORD;
const senseAt = (m, world) => { at(ELDER, m, world); said.length = 0; packets.length = 0; tick('vampSense'); return lastSaid(ELDER); };
ok(senseAt(2000) === '', '2 km: nothing');
ok(/Somewhere in this land/.test(senseAt(800)), '800 m: faint');
ok(senseAt(700) === '', '...said once while the band holds');
ok(/near\. You can feel its pulse/.test(senseAt(200)) && packets.some(([a, p]) => a === ELDER && p.customPacketType === 'dboShake'), '200 m: near, with a light shake');
const huntedLine = said.find(([a]) => a === LORD);
ok(huntedLine && /^Something old is hunting your blood\.$/.test(huntedLine[1]), 'the holder feels the hunt at near (no name, no count)', huntedLine);
ok(/close enough to taste/.test(senseAt(30)), '30 m: close');
ok(/close enough to taste/.test(senseAt(31)), '...close repeats each pass');
ok(!said.some(([, t]) => /\d/.test(t)), 'no line carries a number: no distance, no position');
ok(senseAt(30, '9003:Skyrim.esm') === '', 'another world or interior: nothing');
at(LORD, 0, INN); ok(senseAt(0, INN) === '', 'the holder in an inn (a safe place): the sense is quiet');
at(LORD, 0);

// ---- safe places --------------------------------------------------------------------------------------------------------
ok(M.safeCell(0x9001) === true && M.safeCell(0x9003) === false && M.safeCell(0x9002) === true, 'an inn\'s cell (location keyword) and a jail cell are safe; a store\'s is not');
at(P, 0, INN); ok(globalThis.__dboSafeZone(P) === true, '__dboSafeZone (frenzy.js asks it) answers for an inn');
at(P, 0); setp(P, 'private.dboSentence', { totalMs: 60000 }); ok(globalThis.__dboSafeZone(P) === true, '...and for a prisoner'); setp(P, 'private.dboSentence', null);
ok(globalThis.__dboSafeZone(P) === false, '...not the open world (cities included)');

// ---- the drain --------------------------------------------------------------------------------------------------------
reset(); M = load();
vampires.set(ELDER, { stage: 1, pure: true }); ranks.set(ELDER, 4);
vampires.set(LORD, { stage: 1, pure: true }); crown = LORD; crownSince = clock - 49 * 3600000;
downedSet.add(LORD);
ok(globalThis.__dboVampDrainSeconds(ELDER, LORD) === 15, 'an Elder on the downed holder, 49 h after they took the Crown: a 15 s drain');
const refused = (setup, why) => { setup(); const r = M.drainRefusal(ELDER, LORD); ok(r === why, `drain refused: ${why}`, r); };
refused(() => { crownSince = clock - 47 * 3600000; }, 'shielded'); crownSince = clock - 49 * 3600000;
refused(() => { globalThis.__dboSuperLoginAt.set(LORD, clock - 5 * 60000); }, 'just arrived'); globalThis.__dboSuperLoginAt.set(LORD, 0);
refused(() => { downedSet.delete(LORD); }, 'not down'); downedSet.add(LORD);
refused(() => { ranks.set(ELDER, 3); }, 'not an Elder'); ranks.set(ELDER, 4);
refused(() => { duels.add(LORD); }, 'duel'); duels.clear();
refused(() => { setp(LORD, 'private.dboSentence', { totalMs: 1 }); }, 'jail'); setp(LORD, 'private.dboSentence', null);
refused(() => { at(LORD, 0, INN); }, 'safe place'); at(LORD, 0);
refused(() => { crown = V; }, 'not the Crown'); crown = LORD;
PROFILE[ALT] = PROFILE[LORD]; vampires.set(ALT, { stage: 1, pure: true }); ranks.set(ALT, 4);
ok(M.drainRefusal(ALT, LORD) === 'own account', 'an Elder of the holder\'s own account cannot drain them', M.drainRefusal(ALT, LORD));
PROFILE[ALT] = 4;
ok(M.drainRefusal(ELDER, LORD) === '', 'a city street is no shelter (cities allowed)');
crownSince = clock - 47 * 3600000; said.length = 0;
ok(globalThis.__dboVampDrainSeconds(ELDER, LORD) === 0 && /shields a new Lord/.test(lastSaid(ELDER)), 'a refused drain is an ordinary feed, and the Elder is told why');
crownSince = clock - 49 * 3600000;
ok(globalThis.__dboVampDrainDone(ELDER, LORD) === true && calls.some((c) => c[0] === 'perma' && c[1] === LORD) && calls.some((c) => c[0] === 'crown' && c[1] === ELDER), 'the drain held to the end: the holder ended for good, the Crown to the Elder');
const ci = calls.findIndex((c) => c[0] === 'perma'), cc = calls.findIndex((c) => c[0] === 'crown');
ok(ci >= 0 && cc > ci, '...the end first, then the Crown (the end drops it; the Elder takes it up)');
ok(audits.some((t) => /drain: the Elder #ff000004 ended #ff000003 for good/.test(t)), '...audited');
reset(); M = load(); vampires.set(ELDER, { stage: 1, pure: true }); ranks.set(ELDER, 4); vampires.set(LORD, { stage: 1, pure: true }); crown = LORD; crownSince = clock - 49 * 3600000;
ok(globalThis.__dboVampDrainDone(ELDER, LORD) === false && !calls.some((c) => c[0] === 'perma'), 'raised before the drain finished: nobody is ended');
const fsrc = sup.slice(sup.indexOf('const startFeed = '), sup.indexOf("every('superFeed'"));
ok(/__dboVampDrainSeconds', a, t/.test(fsrc) && /f\.drain\) vampPath\('__dboVampDrainDone'/.test(fsrc) && /f\.drain\) vampPath\('__dboVampDrainBroken'/.test(fsrc), 'supernatural.js: the feed asks for the drain, and reports it done or broken');

// ---- the off switch ---------------------------------------------------------------------------------------------------
reset(); M = load({ enabled: false });
vampires.set(V, { stage: 4 }); dice = [0]; tick('vampFeral');
ok(!M.S.due.has(V) && globalThis.__dboVampEmbraceRefusal(MORTAL) === '' && globalThis.__dboVampAggMult(V, true) === 1 && globalThis.__dboSafeZone(P) === false, 'enabled false: no Feral, no gate, no multipliers, no safe zones');
vampires.set(ELDER, { stage: 1, pure: true }); ranks.set(ELDER, 4); vampires.set(LORD, { stage: 1, pure: true }); crown = LORD; downedSet.add(LORD);
ok(globalThis.__dboVampDrainSeconds(ELDER, LORD) === 0, '...and no drain');

// ---- wiring ---------------------------------------------------------------------------------------------------------
const gm = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
ok(gm.indexOf("path.resolve('vampirepath.js')") > gm.indexOf("path.resolve('frenzy.js')") && gm.indexOf("path.resolve('frenzy.js')") > 0, 'gamemode.js loads vampirepath.js after frenzy.js');
const conf = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));
ok(conf.vampirePath && conf.vampirePath.enabled === true && conf.vampirePath.embraceTier === 1 && conf.vampirePath.elder.rank === 4 && conf.vampirePath.drain.shieldHours === 48, 'gamemode-config.json: vampirePath on, Embrace from Devout, Elder at Master Vampire, 48 h shield');

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
