// The Werewolf Behemoth (DLE race 1d1f9e, 1.3x) is the form of an Elder of the Great Hunt only (Nate, 15 Oct), behind
// config beastform.behemoth.enabled, which ships OFF until client 0.3.100 (its watcher guard) is out and a live two-player
// test passes. Loads the real greathunt.js and beastform.js: with the switch on an Elder changes into the Behemoth (own
// client and watchers' dboBeastBody), a Blood-Howler and a Fledgling keep the vanilla werewolf; with it off nobody gets it;
// the shipped config has it off. Vampire Lords never do.
//   node tests/behemoth-elder-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let now = 1790000000000;
Date.now = () => now;
global.setTimeout = () => 0;
const WEREWOLF = 0xcdd84, BEHEMOTH = 0x481d1f9e, VL = 0x0200283a;
const DESCS = { 'cdd84:Skyrim.esm': WEREWOLF, '92c48:Skyrim.esm': 0x92c48, '283a:Dawnguard.esm': VL, '283b:Dawnguard.esm': 0x0200283b, 'cd5c:Dawnguard.esm': 0x0200cd5c, '1d1f9e:DragonBreak Online Edits.esp': BEHEMOTH };
const props = new Map();
const packets = [];
const mp = {
  get: (id, k) => props.get(`${id}|${k}`),
  set: (id, k, v) => props.set(`${id}|${k}`, v),
  getIdFromDesc: (d) => DESCS[d] || 0,
  getDescFromId: (id) => id.toString(16),
  callPapyrusFunction: () => true,
  lookupEspmRecordById: (id) => ((id >>> 0) === BEHEMOTH || (id >>> 0) === WEREWOLF ? { record: { type: 'RACE', fields: [] } } : null),
};
const noop = () => {};
globalThis.__dboClock = { gameDays: () => 10.2 };
globalThis.__dboBeastAllow = () => null;
globalThis.__dboSuperKind = () => 'werewolf';
const ELDER = 0x11, HOWLER = 0x12, PUP = 0x13, WATCH = 0x14;
const online = [ELDER, HOWLER, PUP, WATCH];
const load = (behemoth) => {
  globalThis.__dboBeastPowers = undefined;
  const cfg = { beastform: behemoth === undefined ? {} : { behemoth }, greatHunt: {} };
  const api = { mp, log: noop, personal: noop, registerChatCommand: noop, sendPacket: (a, p) => packets.push({ a, p }), display: String, who: String,
    audit: noop, findByName: () => null, every: noop, redress: noop, cfg, isAdmin: () => false, onlineActors: () => online,
    hasUiCap: (a, cap) => cap === 'beastBody', profileOf: (a) => a, zoneOfActor: () => null, zoneById: () => null, isWorldspace: () => true };
  require(path.join(ROOT, 'greathunt.js'))(api);
  require(path.join(ROOT, 'beastform.js'))(api);
};
let fail = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fail++; };
for (const a of online) { props.set(`${a}|appearance`, { raceId: 0x13746, name: 'x' }); props.set(`${a}|worldOrCellDesc`, 'tamriel'); props.set(`${a}|pos`, [0, 0, 0]); }
props.set(`${ELDER}|private.greatHunt`, { renown: 1600, fedOn: {} });
props.set(`${HOWLER}|private.greatHunt`, { renown: 900, fedOn: {} });
props.set(`${PUP}|private.greatHunt`, { renown: 0, fedOn: {} });
const ownRace = (a) => { const x = packets.filter((q) => q.a === a && q.p.customPacketType === 'dboBeast' && q.p.beast === true).pop(); return x ? x.p.race >>> 0 : 0; };
const bodyRace = (a) => { const x = packets.filter((q) => q.a === WATCH && q.p.customPacketType === 'dboBeastBody').pop(); const b = x && x.p.bodies.find((y) => y.id === a); return b ? b.race >>> 0 : 0; };
const change = (a) => { globalThis.__dboBeastRevert(a, 'test'); packets.length = 0; return globalThis.__dboBeastTransform(a, 'werewolf'); };

const cfgFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
const shipped = (cfgFile.beastform || {}).behemoth || {};
ok(shipped.enabled === false && shipped.race === '1d1f9e:DragonBreak Online Edits.esp' && shipped.rank === 'Elder', 'shipped config: the Behemoth is off, race 1d1f9e, for the Elder', shipped);

// The switch as shipped (off)
load(shipped);
ok(globalThis.__dboHuntRank(ELDER).name === 'Elder' && globalThis.__dboHuntRank(HOWLER).name === 'Blood-Howler', 'greathunt ranks: 1600 renown is Elder, 900 Blood-Howler');
ok(change(ELDER) && ownRace(ELDER) === WEREWOLF, 'switch off: an Elder takes the vanilla werewolf', ownRace(ELDER).toString(16));
ok(!props.get(`${ELDER}|private.beast`).race, '...and no race is kept on the beast state');
ok(change(PUP) && ownRace(PUP) === WEREWOLF, 'switch off: a Fledgling takes the vanilla werewolf');

// No config at all: off too
load(undefined);
ok(change(ELDER) && ownRace(ELDER) === WEREWOLF, 'no behemoth config: an Elder takes the vanilla werewolf');

// Switched on
load(Object.assign({}, shipped, { enabled: true }));
ok(change(ELDER) && ownRace(ELDER) === BEHEMOTH, 'switch on: an Elder takes the Behemoth', ownRace(ELDER).toString(16));
ok(bodyRace(ELDER) === BEHEMOTH, '...and a watcher is sent the Behemoth body', bodyRace(ELDER).toString(16));
ok(change(HOWLER) && ownRace(HOWLER) === WEREWOLF && bodyRace(HOWLER) === WEREWOLF, 'switch on: a Blood-Howler keeps the vanilla werewolf, for watchers too');
ok(change(PUP) && ownRace(PUP) === WEREWOLF, 'switch on: a Fledgling keeps the vanilla werewolf');
props.set(`${HOWLER}|private.greatHunt`, { renown: 1500, fedOn: {} });
ok(change(HOWLER) && ownRace(HOWLER) === BEHEMOTH, 'switch on: reaching Elder (1500) gives the Behemoth at the next change');
props.set(`${HOWLER}|private.greatHunt`, { renown: 0, fedOn: {} });
ok(change(HOWLER) && ownRace(HOWLER) === WEREWOLF, 'switch on: renown reset by a cure, back to the vanilla werewolf');
globalThis.__dboBeastRevert(ELDER, 'test'); packets.length = 0;
ok(globalThis.__dboBeastTransform(ELDER, 'vampirelord') && ownRace(ELDER) === VL, 'a Vampire Lord is never the Behemoth');
globalThis.__dboBeastRevert(ELDER, 'test');
ok((props.get(`${ELDER}|appearance`).raceId >>> 0) === 0x13746, 'the revert restores the mortal race');

// On, but the race is not in the load order (the DLE without 1d1f9e): the vanilla werewolf
DESCS['1d1f9e:DragonBreak Online Edits.esp'] = 0;
load(Object.assign({}, shipped, { enabled: true }));
ok(change(ELDER) && ownRace(ELDER) === WEREWOLF, 'switch on without the race in the load order: the vanilla werewolf');

console.log(fail ? `${fail} failed` : 'all checks passed');
process.exit(fail ? 1 : 0);
