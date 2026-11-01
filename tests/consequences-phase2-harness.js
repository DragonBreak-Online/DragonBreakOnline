// consequences.js, phase 2 (a hold that harbours the supernatural is answered by the world): hunters' writs and their
// bounties, unrest, the courts' censure and a court that does no business, against a stub mp in a scratch directory.
// node tests/consequences-phase2-harness.js [consequences.js to test]   (from server/; TMPDIR=/dev/shm/... on CT 115)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const MODULE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'consequences.js'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-conseq2-'));
process.chdir(scratch);

const WR = 'whiterun', FK = 'falkreath', DAY = 86400000;
const HUNTER = 0xff000001, PLAIN = 0xff000002, VAMP = 0xff000003, JARL = 0xff000004, NPC_VAMP = 0xff0000a1, NPC_WOLF = 0xff0000a2, NPC_THRALL = 0xff0000a3, NPC_FK = 0xff0000a4;
fs.writeFileSync('zones.json', JSON.stringify({ holds: [{ id: WR, name: 'Whiterun', officials: ['jarl', 'steward'] }, { id: FK, name: 'Falkreath', officials: ['jarl', 'steward'] }], regions: [] }));
fs.writeFileSync('housing.json', '[]');
const props = new Map();
const setp = (id, k, v) => props.set(`${id}|${k}`, v);
const ZONE = new Map([[HUNTER, WR], [PLAIN, WR], [VAMP, WR], [JARL, WR], [NPC_VAMP, WR], [NPC_WOLF, WR], [NPC_THRALL, WR], [NPC_FK, FK]]);
const PROFILE = new Map([[HUNTER, 1], [PLAIN, 2], [VAMP, 3], [JARL, 4]]);
const GUILDS = new Map([[HUNTER, [{ id: 'dawnguard' }]]]);
setp(VAMP, 'private.supernatural', { kind: 'vampire' });
for (const [id, d] of [[NPC_VAMP, '1'], [NPC_WOLF, '2'], [NPC_THRALL, '3'], [NPC_FK, '1']]) setp(id, 'baseDesc', `${d}:Skyrim.esm`);
const EDID = { 1: 'EncVampire03', 2: 'EncWerewolf01', 3: 'EncVampireThrall' };
const mp = { get: (id, k) => props.get(`${id}|${k}`), getIdFromDesc: (d) => parseInt(String(d), 16) >>> 0, lookupEspmRecordById: (id) => (EDID[id] ? { record: { editorId: EDID[id] } } : null) };
let online = [HUNTER, PLAIN];
const said = [], logs = [], audits = [], cmds = {}, timers = {}, gold = [];
let officials = { [WR]: { jarl: [4] } };
const cfg = { consequences: {} };
const api = {
  mp, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => said.push([a, t]), registerChatCommand: (n, f) => { cmds[n] = f; },
  onlineActors: () => online, every: (name, ms, fn) => { timers[name] = fn; }, profileOf: (a) => (PROFILE.has(a) ? PROFILE.get(a) : -1),
  zoneOfActor: (a) => ZONE.get(a) || null, isAdmin: () => true, cfg, audit: (t) => audits.push(t), giveItem: (a, base, n) => gold.push([a, base, n]), readOfficials: () => officials,
};
globalThis.__dboGuildsOf = (a) => GUILDS.get(a) || [];
globalThis.__dboGuildInfo = (id) => ({ id, name: { 'vigil-of-stendarr': 'the Vigil of Stendarr', dawnguard: 'the Dawnguard', 'silver-hand': 'the Silver Hand' }[id] || id });
globalThis.__dboHoldFactionOf = (z) => ({ [WR]: 'hold-whiterun', [FK]: 'hold-falkreath' }[z] || null);
globalThis.__dboSeatHolder = () => 0;
const notices = [], calls = [];
let canCall = { [WR]: '' };
globalThis.__dboCitizenCourtNotice = (z, t) => notices.push([z, t]);
globalThis.__dboCitizenNoConfidence = (z, why, dry) => { const no = canCall[z] === undefined ? 'the hold holds no election' : canCall[z]; if (no) return { error: no }; if (!dry) calls.push([z, why]); return { text: 'ok' }; };

let fails = 0;
const ok = (c, what, detail) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!c) fails++; };
const load = () => { globalThis.__dboConsequences = undefined; delete require.cache[MODULE]; return require(MODULE)(api)._test; };
let T = load();
const set = (zone, f, p) => cmds.consequences(JARL, `set ${zone} ${f} ${p}`);
const sample = () => timers.consequences();
const lastSaid = (a) => said.filter((x) => x[0] === a).map((x) => x[1]).pop() || '';

// ---- writs ----
set(WR, 'blight', 45); sample();
ok(!T.data().p2.writs[WR], 'below writs.at (50) no writ is open', T.data().p2.writs);
const before = said.length;
set(WR, 'blight', 60); sample();
ok(T.data().p2.writs[WR] && T.data().p2.writs[WR].blight > 0 && !T.data().p2.writs[WR].hunt, 'at 60 the Blight opens a writ in Whiterun, the Hunt none', T.data().p2.writs);
ok(said.slice(before).some(([a, t]) => a === HUNTER && /Word from your order: the Vigil of Stendarr, the Dawnguard and the Silver Hand hold an open writ in Whiterun against the vampires: 15 gold/.test(t))
  && !said.slice(before).some(([a]) => a === PLAIN), 'the hunters online are told on their order\'s word; nobody else', said.slice(before));
ok(notices.some(([z, t]) => z === WR && /open writ: the hold harbours vampires/.test(t)), 'the hold\'s court is told the hunters have come');
ok(globalThis.__dboConsequenceBoardLines(WR).some((t) => /open writ in Whiterun against the vampires/.test(t)) && globalThis.__dboConsequenceBoardLines(FK).length === 0, 'Whiterun\'s boards carry the writ, Falkreath\'s nothing');

globalThis.__dboConsequenceDeath(NPC_VAMP, HUNTER);
ok(gold.length === 1 && gold[0][0] === HUNTER && gold[0][1] === 0xf && gold[0][2] === 15 && /The writ in Whiterun pays 15 gold for the vampire\./.test(lastSaid(HUNTER)), 'a hunter\'s vampire kill there is paid the bounty in gold', gold);
globalThis.__dboConsequenceDeath(NPC_VAMP, PLAIN);
ok(gold.length === 1, 'someone of no hunting order is paid nothing');
globalThis.__dboConsequenceDeath(NPC_THRALL, HUNTER);
ok(gold.length === 1, 'a thrall is no vampire for the writ');
globalThis.__dboConsequenceDeath(NPC_WOLF, HUNTER);
ok(gold.length === 1, 'a werewolf is not paid where only the vampires\' writ is open');
globalThis.__dboConsequenceDeath(NPC_FK, HUNTER);
ok(gold.length === 1, 'a vampire slain in a hold with no writ pays nothing');
globalThis.__dboConsequenceDeath(VAMP, HUNTER);
ok(gold.length === 1, 'a player vampire pays nothing while writs.players is off');
ok(T.data().holds[WR].blight && [...Array(1)].length, 'the writ kill still opposes the Blight as in phase 1');
for (let i = 0; i < 30; i++) globalThis.__dboConsequenceDeath(NPC_VAMP, HUNTER);
ok(gold.length === 20, 'a hunter is paid at most writs.capPerDay (20) kills a day', gold.length);

set(WR, 'hunt', 55); sample();
const g0 = gold.length;
globalThis.__dboConsequenceDeath(NPC_WOLF, 0xff000009);
ok(gold.length === g0, 'a killer with no profile is paid nothing');
PROFILE.set(0xff000009, 9); GUILDS.set(0xff000009, [{ id: 'silver-hand' }]);
globalThis.__dboConsequenceDeath(NPC_WOLF, 0xff000009);
ok(gold.length === g0 + 1 && gold[gold.length - 1][2] === 20, 'with the Hunt\'s writ open, a Silver Hand\'s werewolf kill is paid 20', gold.slice(g0));

set(WR, 'blight', 42); sample();
ok(T.data().p2.writs[WR].blight, 'between 40 and 50 the writ stays (hysteresis)');
set(WR, 'blight', 38); set(WR, 'hunt', 0); sample();
ok(!T.data().p2.writs[WR], 'below 40 the writs close', T.data().p2.writs);
ok(said.some(([a, t]) => a === HUNTER && /close their writ against the vampires in Whiterun/.test(t)), 'and the hunters are told');

// player kills, when switched on
cfg.consequences = { phase2: { writs: { players: true } } };
T = load();
set(WR, 'blight', 60); sample();
const g1 = gold.length;
PROFILE.set(0xff000009, 9);
globalThis.__dboConsequenceDeath(VAMP, 0xff000009);
ok(gold.length === g1 + 1 && gold[gold.length - 1][2] === 100, 'with writs.players on, a hunter slaying a vampire player there is paid playerBounty (100)', gold.slice(g1));
globalThis.__dboConsequenceDeath(PLAIN, 0xff000009);
ok(gold.length === g1 + 1, 'a player who is no vampire pays nothing');
cfg.consequences = {};
T = load();

// ---- unrest ----
set(WR, 'blight', 30); set(WR, 'hunt', 0); sample();
ok(globalThis.__dboHoldUnrest(WR).cut === 0 && globalThis.__dboHoldUnrest(WR).stability === 70 + Math.round(30 - T.harbouring(WR)), 'below unrest.at (40): stability falls with the harbouring, no cut', globalThis.__dboHoldUnrest(WR));
set(WR, 'blight', 65); sample();
let u = globalThis.__dboHoldUnrest(WR);
const want = (h, at, full, max) => Math.round(Math.min(1, (h - at) / (full - at)) * max * 100) / 100;
ok(u.cut === want(T.harbouring(WR), 40, 90, 0.4) && u.cut > 0.15 && u.cut < 0.21, 'about half way from 40 to 90, petitions need about 20% fewer (maxCut 0.4)', [u, T.harbouring(WR)]);
set(WR, 'hunt', 95); sample();
u = globalThis.__dboHoldUnrest(WR);
ok(u.cut === 0.4 && u.stability === Math.round(100 - T.harbouring(WR)) && T.harbouring(WR) > 90, 'the higher force counts: at 90 and past, the full maxCut; stability is 100 less the harbouring', u);
ok(globalThis.__dboHoldUnrest(FK).cut === 0 && globalThis.__dboHoldUnrest(FK).stability === 100, 'a calm hold is stable');

// ---- censure ----
ok(T.data().p2.censure[WR] && globalThis.__dboHoldCensureShare('hold-whiterun') === 0.2 && globalThis.__dboHoldCensureShare('hold-falkreath') === 0, 'from 75 the courts censure Whiterun: its faction loses 20% of its tax income; Falkreath none');
ok(notices.some(([z, t]) => z === WR && /The other courts of the realm censure Whiterun/.test(t)), 'the court is told of the censure');
ok(globalThis.__dboConsequenceBoardLines(WR).some((t) => /censure Whiterun/.test(t)), 'and the boards carry it');
set(WR, 'hunt', 70); set(WR, 'blight', 0); sample();
ok(T.data().p2.censure[WR], 'between 65 and 75 the censure holds (hysteresis)');
set(WR, 'hunt', 60); sample();
ok(!T.data().p2.censure[WR] && globalThis.__dboHoldCensureShare('hold-whiterun') === 0 && notices.some(([, t]) => /lift their censure of Whiterun/.test(t)), 'below 65 it is lifted, and the court told');
set(WR, 'hunt', 0); sample();

// ---- a court that does no business ----
delete T.data().p2.court[WR];
const t0 = Date.now();
const realNow = Date.now;
let clock = t0;
Date.now = () => clock;
sample();
ok(T.data().p2.court[WR] === t0 && !T.data().p2.court[FK], 'a ruled hold starts its clock at the first sample; one with no ruler has none', T.data().p2.court);
clock = t0 + 4 * DAY; sample();
ok(!notices.some(([, t]) => /grow restless/.test(t)), 'four days idle: nothing yet');
clock = t0 + 5 * DAY + 1000; sample();
ok(notices.filter(([z, t]) => z === WR && /grow restless: the court has done no business for 5 days\. In 2 days without it, they will call a vote of no confidence\./.test(t)).length === 1, 'at N-2 (5 days) the ruler is warned once', notices.filter(([, t]) => /restless/.test(t)));
clock = t0 + 5 * DAY + 2000; sample();
ok(notices.filter(([, t]) => /grow restless/.test(t)).length === 1, '...not again the next sample');
globalThis.__dboCourtBusiness(WR, 'tax');
ok(T.data().p2.court[WR] === clock, 'court business restarts the clock');
clock += 7 * DAY + 1000; sample();
ok(calls.length === 1 && calls[0][0] === WR && /no business for 7 days/.test(calls[0][1]), 'seven idle days call a vote of no confidence through citizenship', calls);
ok(notices.some(([, t]) => /have called a vote of no confidence/.test(t)) && audits.some((t) => /CONSEQUENCES Whiterun: a vote of no confidence called/.test(t)), 'the court is told and it is audited');
sample();
ok(calls.length === 1 && T.data().p2.court[WR] === clock, 'once: the call restarts the clock', calls.length);
clock += 7 * DAY + 1000;
canCall[WR] = 'an election is already running';
sample();
ok(calls.length === 1 && T.data().p2.blocked[WR] === 'an election is already running' && logs.some((l) => /cannot call a vote of no confidence yet: an election is already running/.test(l)), 'a hold that cannot call one now is left, and the reason logged', T.data().p2.blocked);
const logged = logs.length;
sample();
ok(logs.slice(logged).filter((l) => /cannot call/.test(l)).length === 0, '...once, not every sample');
canCall[WR] = '';
sample();
ok(calls.length === 2 && !T.data().p2.blocked[WR], 'it is called once it can be', calls.length);
// the warning only where a vote could be called
canCall[WR] = 'the hold holds no election';
const n0 = notices.length;
clock += 5 * DAY + 1000; sample();
ok(!notices.slice(n0).some(([, t]) => /restless/.test(t)), 'no warning in a hold that cannot hold the vote (Bruma\'s Count)');
canCall[WR] = '';
// stamps by faction and by an official's seat
clock += 1000;
globalThis.__dboCourtBusinessFaction('hold-whiterun', 'wage');
ok(T.data().p2.court[WR] === clock, 'a wage set for the hold\'s faction is its court\'s business');
clock += 1000;
globalThis.__dboCourtBusinessBy(JARL, 'herald');
ok(T.data().p2.court[WR] === clock, 'a herald cried by one of its officials is too');
clock += 1000;
globalThis.__dboCourtBusinessBy(PLAIN, 'herald');
ok(T.data().p2.court[WR] === clock - 1000, '...but not by someone with no seat');
officials = {};
sample();
ok(!T.data().p2.court[WR], 'an empty ruler\'s seat clears the clock');
officials = { [WR]: { jarl: [4] } };
Date.now = realNow;

// ---- switches ----
cfg.consequences = { phase2: { writs: { enabled: false }, unrest: { enabled: false }, pressure: { enabled: false }, idleRuler: { enabled: false } } };
T = load();
set(WR, 'blight', 99); sample();
ok(!T.data().p2.writs[WR] && !T.data().p2.censure[WR] && globalThis.__dboHoldUnrest(WR).cut === 0 && !T.data().p2.court[WR], 'each part has its own switch: all off, nothing happens', T.data().p2);
cfg.consequences = { phase2: { writs: { at: 90 }, pressure: { at: 95, censure: 0.5 }, unrest: { at: 80, full: 100, maxCut: 0.6 } } };
T = load();
set(WR, 'blight', 85); sample();
ok(!T.data().p2.writs[WR] && !T.data().p2.censure[WR] && globalThis.__dboHoldUnrest(WR).cut === want(T.harbouring(WR), 80, 100, 0.6) && globalThis.__dboHoldUnrest(WR).cut > 0, 'every threshold comes from config', [T.data().p2, globalThis.__dboHoldUnrest(WR)]);
cfg.consequences = {};
T = load();

// ---- staff readout, and the state survives a restart ----
set(WR, 'blight', 80); sample();
said.length = 0;
cmds.consequences(JARL, '');
ok(said.some(([, t]) => /^Whiterun: writs against the Blight; stability \d+, petitions need \d+% fewer; censured by the courts; court idle 0 of 7 days$/.test(t)), 'staff read phase 2 per hold', said.map((x) => x[1]));
T = load();
ok(T.data().p2.writs[WR] && T.data().p2.censure[WR], 'a restart reads phase 2 back from consequences.json');

console.log(fails ? `\n${fails} failed` : '\nall passed');
try { process.chdir(os.tmpdir()); fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* left for the OS */ }
process.exit(fails ? 1 : 0);
