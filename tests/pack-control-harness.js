// Werewolf pack control (Nate, 23 Oct: three tiers, Lone Wolf / pack member / Alpha): loads the real supernatural.js,
// greathunt.js and beastform.js with this branch's gamemode-config.json and checks that a pack member (not the Alpha) may call
// the beast once a game day, is never forced by hunger, never tips into a frenzy, and is still taken by the full moon; a Lone
// Wolf is as before.
//   node tests/pack-control-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'tests', '.run-pack-control');
fs.mkdirSync(RUN, { recursive: true });
process.chdir(RUN);
process.on('exit', () => { try { fs.rmSync(RUN, { recursive: true, force: true }); } catch (e) { /* left behind */ } });

let now = 1790000000000;
Date.now = () => now;
global.setTimeout = () => 0;
const WOLF = 0xff000001, ALPHA = 0xff000002, PACK = 0xff000003, ADMIN = 0xff000005;
const ALL = [WOLF, ALPHA, PACK, ADMIN];
const props = new Map();
const ids = new Map();
const idFor = (d) => { d = String(d).toLowerCase(); if (!ids.has(d)) ids.set(d, 0x1000 + ids.size); return ids.get(d); };
const mp = {
  get: (id, k) => (k === 'type' ? 'MpActor' : props.get(`${id}|${k}`)),
  set: (id, k, v) => props.set(`${id}|${k}`, v),
  getIdFromDesc: idFor,
  getDescFromId: (id) => id.toString(16),
  callPapyrusFunction: () => true,
  lookupEspmRecordById: () => null,
};
const noop = () => {};
const said = [], packets = [], commands = new Map(), ticks = new Map();
let day = 30.1, hunger = 0;
globalThis.__dboClock = { gameDays: () => day, summary: () => ({ timeScale: 6 }), isNight: () => false, isFullMoon: () => false };
globalThis.__dboGuildIsPackLeader = (a) => (a >>> 0) === ALPHA;
globalThis.__dboGuildsOf = (a) => ((a >>> 0) === PACK || (a >>> 0) === ALPHA ? [{ id: 'pack-of-falkreath', kind: 'pack', name: 'Pack' }] : []);
const frenzied = []; globalThis.__dboFrenzyForced = (a) => frenzied.push(a >>> 0);
globalThis.__dboBeastPowers = undefined;
delete globalThis.__dboSuperState; delete globalThis.__dboGreatHunt;
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
const api = (cfg) => ({
  mp, log: noop, audit: noop, personal: (a, t) => said.push({ a, t }), registerChatCommand: (n, f) => commands.set(n, f),
  onUi: noop, openWidget: noop, closeWidget: noop, sendPacket: (a, p) => packets.push({ a, p }), display: String, who: String,
  isAdmin: (a) => (a >>> 0) === ADMIN, findByName: (n) => (n === 'wolf' ? WOLF : null), onlineActors: () => ALL,
  every: (n, ms, f) => ticks.set(n, f), redress: noop, profileOf: (a) => a, nameOf: String, isWorldspace: () => true,
  needsFeed: noop, hungerOf: () => hunger, zoneOfActor: () => null, zoneById: () => null, cfg,
});
const load = (cfg, files) => { for (const f of files) { const p = path.join(ROOT, f); delete require.cache[p]; require(p)(api(cfg)); } };
const CFG = JSON.parse(JSON.stringify(CONFIG)); CFG.supernatural = Object.assign({}, CFG.supernatural, { feralWarn: { seconds: 0 } });
load(CFG, ['supernatural.js', 'greathunt.js', 'beastform.js']);


let pass = 0, fail = 0;
const ok = (c, what, detail) => { if (c) { pass++; console.log('ok  ', what); } else { fail++; console.log('FAIL', what, detail !== undefined ? JSON.stringify(detail) : ''); } };
const POWER = idFor('92c48:Skyrim.esm');
const beast = (a) => props.get(`${a}|private.beast`);
const fresh = () => { for (const a of ALL) { props.set(`${a}|appearance`, { raceId: 0x13745, name: 'Uhtred' }); props.set(`${a}|private.beast`, null); props.set(`${a}|private.beastCarry`, null); props.set(`${a}|private.supernatural`, { kind: 'werewolf', stage: 0, blessed: false, beastDay: -1 }); } };
fresh();
globalThis.__dboBeastCast(WOLF, POWER);
ok(!beast(WOLF), 'a Lone Wolf still cannot call the beast');
globalThis.__dboBeastCast(PACK, POWER);
ok(!!beast(PACK), 'a pack member calls the beast');
props.set(`${PACK}|private.beast`, null);
globalThis.__dboBeastCast(PACK, POWER);
ok(!beast(PACK), '...once a game day: a second call the same day is refused');
day += 1;
globalThis.__dboBeastCast(PACK, POWER);
ok(!!beast(PACK), '...and the next game day it answers again');
globalThis.__dboBeastCast(ALPHA, POWER); props.set(`${ALPHA}|private.beast`, null); globalThis.__dboBeastCast(ALPHA, POWER);
ok(!!beast(ALPHA), 'the Alpha still calls it at will');
ok(globalThis.__dboBeastChangesLeft(PACK) === 0 && globalThis.__dboBeastChangesLeft(ALPHA) === Infinity, 'changes left: a pack member 0 after its one, the Alpha unlimited', [globalThis.__dboBeastChangesLeft(PACK)]);
// Hunger: the feral tick forces a Lone Wolf, never a pack member
fresh(); globalThis.__dboFeralDue && globalThis.__dboFeralDue.clear(); frenzied.length = 0;
const realRandom = Math.random; Math.random = () => 0; hunger = 100;
ticks.get('superFeral')();
Math.random = realRandom; hunger = 0;
ok(!!beast(WOLF) && !beast(PACK), 'hunger forces the Lone Wolf, never the pack member', [!!beast(WOLF), !!beast(PACK)]);
ok(frenzied.includes(WOLF >>> 0) && !frenzied.includes(PACK >>> 0), 'a forced Lone Wolf may tip into a frenzy; a pack member is never offered one');
// The full moon still takes a pack member
fresh(); globalThis.__dboFeralDue && globalThis.__dboFeralDue.clear(); frenzied.length = 0;
globalThis.__dboClock.isNight = () => true; globalThis.__dboClock.isFullMoon = () => true; day += 0.5;
ticks.get('superMoon')();
ok(!!beast(PACK) && !frenzied.includes(PACK >>> 0), 'the full moon still takes a pack member (and no frenzy)');
console.log(fail ? `${fail} failed` : `all ${pass} checks passed`);
process.exit(fail ? 1 : 0);
