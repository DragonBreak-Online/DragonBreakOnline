// The beast defends its own (Nat, 25 Oct; config werewolfDefend): a werewolf in mortal form at defendAtHealth or under in a
// fight, before the day's first change, may change at once and spends that change: one roll of chance per fall through
// defendAtHealth, re-armed only by health back above it. The old checks run at chance 1. Loads the real supernatural.js against a
// stub api (as feral-warning-harness.js does) and drives the superDefend tick by hand.
// node tests/werewolf-defend-harness.js   (from server/)
'use strict';
const path = require('path');
const store = new Map();
const said = [], logs = [], changes = [], frenzies = [];
const timers = {};
let online = [];
const noop = () => {};
let now = Date.UTC(2026, 9, 25, 3, 0);
Date.now = () => now;
let gameDays = 10.4;
let night = false, fullMoon = false;
globalThis.__dboClock = { gameDays: () => gameDays, isNight: () => night, isFullMoon: () => fullMoon, weatherFor: () => 0, summary: () => ({ timeScale: 6 }) };
const mp = {
  get: (id, p) => store.get(`${id}|${p}`),
  set: (id, p, v) => { store.set(`${id}|${p}`, v); },
  getDescFromId: (id) => `${id.toString(16)}:x`, getIdFromDesc: () => 0x1234,
  callPapyrusFunction: () => null, lookupEspmRecordById: () => null, setRaceMenuOpen: () => {},
};
let outdoors = true;
const api = {
  mp, log: (...x) => logs.push(x.join(' ')), audit: noop, personal: (a, t) => said.push([a, t]), system: (a, t) => said.push([a, t]), registerChatCommand: noop,
  onUi: noop, openWidget: noop, closeWidget: noop, sendPacket: noop, display: String, who: String,
  isAdmin: () => false, findByName: () => null, onlineActors: () => online, every: (n, ms, fn) => { timers[n] = fn; }, profileOf: (a) => a,
  nameOf: String, isWorldspace: () => outdoors, needsFeed: noop, hungerOf: () => 0, cfg: {},
};
globalThis.__dboBeastTransform = (a, key, forced) => { changes.push([a, key, forced]); store.set(`${a}|private.beast`, { form: key }); return true; };
globalThis.__dboFrenzyForced = (a) => frenzies.push(a);
globalThis.__dboCombatAt = new Map();
const MODULE = path.resolve(__dirname, '..', 'supernatural.js');
const audits = [];
api.audit = (t) => { if (/defensive roll/.test(t)) audits.push(t); };
const load = (def) => { api.cfg = { werewolfDefend: def && Object.assign({ chance: 1 }, def) }; delete require.cache[MODULE]; require(MODULE)(api); };
let roll = 0.5;
Math.random = () => roll;

let fail = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fail++; };
const A = 7;
const SP = `${A}|private.supernatural`;
const fresh = () => {
  said.length = 0; logs.length = 0; changes.length = 0; frenzies.length = 0;
  for (const k of [...store.keys()]) store.delete(k);
  store.set(SP, { kind: 'werewolf', disease: null, stage: 0, blessed: false, beastDay: -1 });
  store.set(`${A}|isDead`, false);
  store.set(`${A}|percentages`, { health: 0.2, magicka: 1, stamina: 1 });
  globalThis.__dboCombatAt.set(A, now);
  globalThis.__dboIsDowned = () => false; globalThis.__dboInDuel = () => false; globalThis.__dboAnticheat = null;
  globalThis.__dboGuildIsPackLeader = () => false; globalThis.__dboGuildsOf = () => [];
  globalThis.__dboFeralDue && globalThis.__dboFeralDue.clear();
  globalThis.__dboDefendRolled && globalThis.__dboDefendRolled.clear(); audits.length = 0; roll = 0.5;
  outdoors = true; gameDays = 10.4; night = false; fullMoon = false;
  online = [A];
};
const tick = () => timers.superDefend();
const why = () => globalThis.__dboDefendRefusal(A);

// ---- off by default ----
fresh(); load(undefined);
const bootOff = logs.some((l) => /werewolf defence off/.test(l));
fresh(); tick();
ok(changes.length === 0 && bootOff,'off unless werewolfDefend.enabled: nothing happens, the boot line says off');

load({ enabled: true });
ok(logs.some((l) => /werewolf defence ON: chance 1 at 25% health in a fight, once each fall through it, before the day's first change; frenzy off/.test(l)), 'on: the boot line names the chance, 25%, once a fall, the day\'s first change, no frenzy');

// ---- the change ----
fresh(); tick();
ok(changes.length === 1 && changes[0][1] === 'werewolf' && changes[0][2] === true, 'at 20% health in a fight, before any change today: the beast takes them at once, forced', changes);
const s1 = store.get(SP);
ok(s1.beastDay === 10 && s1.beastDayUses === 1, 'it spends the day\'s change (beastDay 10, one use)', s1);
ok(said.some(([a, t]) => a === A && /Pain wakes the beast/.test(t)) && logs.some((l) => /changed to defend themselves \(the day's change spent\)/.test(l)), 'the werewolf is told, and the log says so');
ok(frenzies.length === 0, 'no frenzy (frenzy false)');
store.delete(`${A}|private.beast`); changes.length = 0; tick();
ok(changes.length === 0 && why() === 'changed today', 'reverted and hit low again the same day: no second change (changed today)');
store.set(`${A}|percentages`, { health: 0.9, magicka: 1, stamina: 1 }); tick(); store.set(`${A}|percentages`, { health: 0.2, magicka: 1, stamina: 1 });
gameDays = 11.1; tick();
ok(changes.length === 1, 'the next game day it can defend again (per world-clock day, not real time)');

// ---- when it does not come ----
const refused = (setup, want, what) => { fresh(); setup(); tick(); ok(changes.length === 0 && why() === want, what, { changes, why: why() }); };
refused(() => { store.set(SP, { kind: 'werewolf', beastDay: 10, beastDayUses: 1 }); }, 'changed today', 'already changed today (a feral or called change): nothing');
refused(() => { store.set(`${A}|percentages`, { health: 0.3, magicka: 1, stamina: 1 }); }, 'health', 'at 30% health: nothing');
refused(() => { store.set(`${A}|percentages`, { health: 0, magicka: 1, stamina: 1 }); }, 'health', 'at 0 (fallen): nothing');
refused(() => { globalThis.__dboCombatAt.set(A, now - 60000); }, 'no fight', 'low health with no blow for a minute (a fall, a slow bleed): nothing');
refused(() => { globalThis.__dboIsDowned = () => true; }, 'downed', 'down: nothing');
refused(() => { globalThis.__dboInDuel = () => true; }, 'duel', 'in a duel: nothing (a fair fight)');
refused(() => { store.set(`${A}|private.restrained`, { boundHands: true }); }, 'bound', 'bound: nothing');
refused(() => { store.set(`${A}|private.restrained`, { carried: true }); }, 'bound', 'carried: nothing');
refused(() => { store.set(`${A}|private.dboSentence`, { totalMs: 600000, servedMs: 1000 }); }, 'jailed', 'jailed: nothing');
refused(() => { globalThis.__dboAnticheat = { players: new Map([[A, { mounted: true, horse: 0xff000123 }]]) }; }, 'mounted', 'on a horse: nothing');
refused(() => { store.set(`${A}|lastAnimEvent`, 'HorseEnter'); }, 'mounted', 'on a horse by its relayed animation: nothing');
refused(() => { store.set(`${A}|private.beast`, { form: 'chicken' }); }, 'beast form', 'in a staff polymorph: nothing');
refused(() => { store.set(`${A}|private.beast`, { form: 'werewolf' }); }, 'beast form', 'already the beast: nothing');
refused(() => { store.set(`${A}|private.dboAppearanceEdit`, { at: now }); }, 'editor', 'in the character editor: nothing');
refused(() => { globalThis.__dboFeralDue.set(A, now + 30000); }, 'changing', 'a forced change already on its way: nothing (it comes on its own clock)');
refused(() => { store.set(SP, { kind: 'werewolf', blessed: true }); }, 'spared', 'Hircine\'s blessed (calls the beast at will): left to it');
refused(() => { globalThis.__dboGuildIsPackLeader = () => true; }, 'spared', 'a pack\'s Alpha: left to it');
refused(() => { store.set(SP, { kind: 'vampire' }); }, 'no werewolf', 'a vampire: nothing');
refused(() => { store.set(SP, { kind: null, disease: { kind: 'werewolf' } }); }, 'no werewolf', 'a carrier still in the fever: nothing');
refused(() => { online = []; }, '', 'offline: nothing (only online actors are looked at)');

// ---- indoors, the pack, the frenzy switch ----
fresh(); outdoors = false; tick();
ok(changes.length === 1, 'indoors with indoors true (the default, as the full moon\'s change): it comes');
load({ enabled: true, indoors: false });
fresh(); outdoors = false; tick();
ok(changes.length === 0 && why() === 'indoors', 'indoors: false keeps it outdoors only');
load({ enabled: true });
fresh(); globalThis.__dboGuildsOf = () => [{ kind: 'pack' }]; tick();
ok(changes.length === 1 && frenzies.length === 0, 'a pack member defends too (packMembers true), and never frenzies');
load({ enabled: true, packMembers: false });
fresh(); globalThis.__dboGuildsOf = () => [{ kind: 'pack' }]; tick();
ok(changes.length === 0 && why() === 'pack', 'packMembers false leaves a pack member to the pack');
load({ enabled: true, frenzy: true });
fresh(); tick();
ok(changes.length === 1 && frenzies.length === 1, 'frenzy true: the change may tip into a frenzy (frenzy.js rolls its own chance)');
fresh(); fullMoon = true; night = true; tick();
ok(store.get(`${A}|private.fullMoonTaken`) === Math.floor(10.4 / 24), 'under the full moon it counts as the moon\'s change too');
load({ enabled: true, defendAtHealth: 0.4 });
fresh(); store.set(`${A}|percentages`, { health: 0.35, magicka: 1, stamina: 1 }); tick();
ok(changes.length === 1, 'defendAtHealth 0.4: at 35% it comes');

// ---- the chance (Nat, 25 Oct: random, not certain) ----
load({ enabled: true, chance: 0.35 });
fresh(); roll = 0.9; tick();
ok(changes.length === 0 && audits.some((t) => /^BEAST 7 defensive roll 0\.900 against 0\.35: nothing$/.test(t)), 'chance 0.35, roll 0.9: no change, and the roll is audited (player, roll, chance, result)', audits);
ok(store.get(SP).beastDay === -1, '...a failed roll costs nothing: the day\'s change is still there');
roll = 0.0; for (let i = 0; i < 20; i++) tick();
ok(changes.length === 0 && audits.length === 1, 'still under 25% in the fight: no second roll on later checks, however many (one roll per fall)', audits);
store.set(`${A}|percentages`, { health: 0.3, magicka: 1, stamina: 1 }); tick();
store.set(`${A}|percentages`, { health: 0.2, magicka: 1, stamina: 1 }); tick();
ok(changes.length === 1 && audits.length === 2 && /roll 0\.000 against 0\.35: the beast comes$/.test(audits[1]), 'healed over 25% and fallen through it again: a new roll, and this one wins', audits);
fresh(); roll = 0.2; tick();
ok(changes.length === 1, 'chance 0.35, roll 0.2: the beast comes');
fresh(); store.set(`${A}|percentages`, { health: 0.2, magicka: 1, stamina: 1 }); globalThis.__dboCombatAt.set(A, now - 60000); tick();
ok(audits.length === 0, 'under 25% out of a fight: no roll is spent');
globalThis.__dboCombatAt.set(A, now); roll = 0.0; tick();
ok(changes.length === 1 && audits.length === 1, '...the first blow while still under it brings the one roll');
load({ enabled: true, chance: 0 });
fresh(); roll = 0; for (let i = 0; i < 5; i++) { tick(); store.set(`${A}|percentages`, { health: 0.5, magicka: 1, stamina: 1 }); tick(); store.set(`${A}|percentages`, { health: 0.2, magicka: 1, stamina: 1 }); }
ok(changes.length === 0 && audits.length === 5, 'chance 0: never, over five falls (each one rolled and audited)', audits.length);
load({ enabled: true, chance: 1 });
fresh(); roll = 0.999; tick();
ok(changes.length === 1, 'chance 1: always');
fresh(); store.set(SP, { kind: 'werewolf', beastDay: 10, beastDayUses: 1 }); roll = 0; tick();
ok(changes.length === 0 && audits.length === 0, 'already changed today: no roll at all');

console.log(fail ? `${fail} FAILED` : 'all checks passed');
process.exit(fail ? 1 : 0);
