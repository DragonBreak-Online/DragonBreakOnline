// consequences.js (Dynamic Consequences, phase 1: measured only) against a stub mp in a scratch directory.
// node tests/consequences-harness.js [consequences.js to test]   (from server/; TMPDIR=/dev/shm/... on CT 115)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const MODULE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'consequences.js'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-conseq-'));
process.chdir(scratch);

const WR = 'whiterun', FK = 'falkreath', VAMP = 0xff000001, ALT = 0xff000002, DAWN = 0xff000003, GM = 0xff000004, WOLF = 0xff000005, DOOR = 0x500;
const NPC_VAMP = 0xff0000a1, NPC_DEER = 0xff0000a2;
fs.writeFileSync('zones.json', JSON.stringify({ holds: [{ id: WR, name: 'Whiterun' }, { id: FK, name: 'Falkreath' }], regions: [] }));
fs.writeFileSync('housing.json', JSON.stringify([DOOR]));
const props = new Map();
const setp = (id, k, v) => props.set(`${id}|${k}`, v);
const getp = (id, k) => props.get(`${id}|${k}`);
const ZONE = new Map([[VAMP, WR], [ALT, WR], [DAWN, WR], [GM, WR], [WOLF, WR], [DOOR, FK], [NPC_VAMP, WR], [NPC_DEER, WR]]);
const PROFILE = new Map([[VAMP, 7], [ALT, 7], [DAWN, 8], [GM, 9], [WOLF, 10]]);
const GUILDS = new Map([[DAWN, [{ id: 'dawnguard' }]], [GM, [{ id: 'clan-volkihar' }]], [WOLF, [{ id: 'cult-hircine' }]]]);
setp(VAMP, 'private.supernatural', { kind: 'vampire' });
setp(ALT, 'private.supernatural', { kind: 'vampire' });
setp(GM, 'ff_adminModes', { god: true });
setp(DOOR, 'private.housing', { owner: 7, ownerChar: VAMP });
setp(NPC_VAMP, 'baseDesc', '1:Skyrim.esm'); setp(NPC_DEER, 'baseDesc', '2:Skyrim.esm');
const EDID = { 1: 'EncVampire03', 2: 'EncDeer' };
const mp = {
  get: (id, k) => getp(id, k),
  getIdFromDesc: (d) => parseInt(String(d), 16) >>> 0,
  lookupEspmRecordById: (id) => (EDID[id] ? { record: { editorId: EDID[id] } } : null),
};
let online = [VAMP, DAWN, GM, WOLF];
const said = [], logs = [], cmds = {}, timers = {};
const api = {
  mp, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => said.push([a, t]), registerChatCommand: (n, f) => { cmds[n] = f; },
  onlineActors: () => online, every: (name, ms, fn) => { timers[name] = fn; }, profileOf: (a) => (PROFILE.has(a) ? PROFILE.get(a) : -1),
  zoneOfActor: (a) => ZONE.get(a) || null, isAdmin: () => true, cfg: {},
};
globalThis.__dboGuildsOf = (a) => GUILDS.get(a) || [];
let fails = 0;
const ok = (c, what, detail) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!c) fails++; };
const load = () => { globalThis.__dboConsequences = undefined; delete require.cache[MODULE]; return require(MODULE)(api)._test; };
let T = load();
const P = (zone, f) => ((T.data().holds[zone] || {})[f] || { p: 0, stage: 0 });

// One sample: the vampire feeds the Blight where they stand and, as an owner online, where their home is
timers.consequences();
const wrBlight = P(WR, 'blight');
ok(wrBlight.feed === 1 && wrBlight.oppose === 1 && wrBlight.p === 0, 'in Whiterun the vampire feeds the Blight 1 and the Dawnguard opposes it 1; a GM in god mode counts for nothing', wrBlight);
ok(P(FK, 'blight').feed === 2 && P(FK, 'blight').p === 1, 'the vampire\'s home in Falkreath adds 2 there while they are online', P(FK, 'blight'));
ok(P(WR, 'hunt').feed === 1 && P(WR, 'hunt').p === 0.5, 'a member of the cult of Hircine feeds the Hunt', P(WR, 'hunt'));
ok(!T.data().holds[WR].cult, 'nobody feeds the Dragon Cult, so it is not recorded');

// One account counts once, whichever characters it has online
online = [VAMP, ALT];
timers.consequences();
ok(P(WR, 'blight').feed === 1, 'two characters of one account count once', P(WR, 'blight'));

// Decay, stages and hysteresis
cmds.consequences(GM, `set ${WR} blight 52`);
ok(P(WR, 'blight').stage === 2 && /Incursion/.test(said[said.length - 1][1]), 'staff set the pressure; 52 is Incursion', said[said.length - 1]);
online = [];
for (let i = 0; i < 5; i++) timers.consequences();
ok(P(WR, 'blight').p < 50 && P(WR, 'blight').p > 40 && P(WR, 'blight').stage === 2, 'decaying below 50 but above 40 stays Incursion (hysteresis)', P(WR, 'blight'));
for (let i = 0; i < 10; i++) timers.consequences();
ok(P(WR, 'blight').p < 40 && P(WR, 'blight').stage === 1, 'below 40 it falls to Stirring', P(WR, 'blight'));
ok(logs.some((l) => /the Blight in Whiterun falls to Stirring/.test(l)), 'a stage change is logged');
ok(T.stageOf(30, 0) === 1 && T.stageOf(76, 1) === 3 && T.stageOf(0, 0) === 0, 'thresholds 25 / 50 / 75');

// Kills by players oppose the force of the creature, capped per player per day; NPC kills and deer do nothing
cmds.consequences(GM, `set ${WR} blight 20`);
for (let i = 0; i < 40; i++) globalThis.__dboConsequenceDeath(NPC_VAMP, DAWN);
globalThis.__dboConsequenceDeath(NPC_VAMP, NPC_DEER);
globalThis.__dboConsequenceDeath(NPC_DEER, DAWN);
timers.consequences();
ok(P(WR, 'blight').oppose === 30, 'a player\'s vampire kills oppose the Blight, at most 30 a day; an NPC killer and a deer count for nothing', P(WR, 'blight'));
ok(P(WR, 'blight').p === Math.max(0, Math.round((20 * 0.98 - 30 * 0.5) * 100) / 100), 'and lower the pressure', P(WR, 'blight'));

// Nothing in the world changes in phase 1: no packets, no spawn writes
ok(!fs.existsSync('NPC-Spawns.json'), 'phase 1 writes no spawn zones');

// The readout and its rights live in the command options; a restart reads the state back
said.length = 0;
cmds.consequences(GM, '');
ok(/^Dynamic Consequences\. Last sample .*Phase 2: writs, unrest, pressure, idleRuler\./.test(said[0][1]) && said.some(([, t]) => /Falkreath: the Blight/.test(t)), 'the readout lists the holds by pressure', said.map((x) => x[1]));
const saved = JSON.stringify(T.data().holds);
T = load();
ok(JSON.stringify(T.data().holds) === saved, 'a restart reads the pressures back from consequences.json');

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
