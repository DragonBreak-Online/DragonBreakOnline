// Staff polymorph (Jake, 22 Oct: "I need you to figure out a way how I can polymorph into animals"; beastform.js /polymorph).
// A Lead GM and above turns themselves, and only themselves, into one of eight animals (chicken, hare/rabbit, goat, fox, dog,
// skeever, mudcrab, deer) through the werewolf's race swap. Jake's rules: staff themselves only; killable (not ethereal; a
// death reverts it and the player is seen); silent (no witness line on the change or on any revert; the werewolf's and the
// Vampire Lord's lines unchanged); refused while dead or down, mounted, seated, bound, jailed, in a duel or a fight, already a
// beast, indoors or in water; refused, and ended at the tick, while a player whose client lacks 'creatureBody' could be
// streamed the staff member (two grid squares out, 6000 units, or in the fork's actorNeighbors: review R1); an Owners' kill
// switch kept through reloads and restarts. The creature keys stay out of FORMS, so /beastform
// and the admin panel's grant and revoke never take one, and watchers are sent a creature body only when their client says
// 'creatureBody' (the werewolf and Vampire Lord bodies are unchanged for 'beastBody' clients).
//   node tests/polymorph-harness.js   (from server/; BEAST_ROOT=<dir> loads beastform.js from another tree)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = process.env.BEAST_ROOT ? path.resolve(process.env.BEAST_ROOT) : path.resolve(__dirname, '..');
const BEASTFORM = path.join(ROOT, 'beastform.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polymorph-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

let now = 1790000000000;
Date.now = () => now;
const timers = [];
global.setTimeout = (fn) => { timers.push(fn); return 0; };

let fail = 0, pass = 0;
const ok = (c, what, got) => { if (c) pass++; else fail++; console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 700)}`); };

// ---- the fake world ----------------------------------------------------------------------------------------------------------
const LEAD = 0x14, OWNER = 0x15, GM = 0x16, PLAYER = 0x17, NEWP = 0x18, WOLF = 0x19, LORD = 0x1a, FARP = 0x1b;
const HUMAN = 0x13746, WEREWOLF_RACE = 0xcdd84, VL_RACE = 0x283a;
const ANIMALS = { chicken: 0xa919d, hare: 0x6dc99, goat: 0x6fc4a, fox: 0x109c7c, dog: 0x131ee, skeever: 0x13201, mudcrab: 0xba545, deer: 0xcf89b };
const CREATURE_RACES = new Set(Object.values(ANIMALS));
const WORLD = '3c:Skyrim.esm', OTHER_WORLD = '9f:Skyrim.esm', INSIDE = '1691:Skyrim.esm'; // verify-formids: ignore - mock descs for a second worldspace and an interior; RECORDS below supplies their type, nothing looks them up in the load order
const RECORDS = { 0x3c: 'WRLD', 0x9f: 'WRLD', 0x1691: 'CELL' };
const TIER = { [LEAD]: 'leadgm', [OWNER]: 'senior', [GM]: 'gm' };
let props, commands, timersByName, said, audits, logs, packets, papyrus, appearanceWrites;
let online = [LEAD, OWNER, GM, PLAYER, NEWP, WOLF, LORD, FARP];
const caps = new Map();
const api = (cfg) => ({
  mp: {
    getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
    getDescFromId: (id) => `${(Number(id) >>> 0).toString(16)}:x`,
    get: (id, p) => props.get(`${id}|${p}`),
    set: (id, p, v) => { if (p === 'appearance') appearanceWrites.push({ id, v }); props.set(`${id}|${p}`, v); },
    callPapyrusFunction: (kind, cls, method, self, args) => { papyrus.push({ method, self, args }); return true; },
    lookupEspmRecordById: (id) => (RECORDS[id >>> 0] ? { record: { type: RECORDS[id >>> 0] } } : null),
  },
  log: (...a) => logs.push(a.join(' ')), personal: (a, t) => said.push({ a, t }), audit: (t) => audits.push(t),
  display: (a) => `P${(a >>> 0).toString(16)}`, who: (a) => `P${(a >>> 0).toString(16)} (profile ${a >>> 0})`,
  sendPacket: (a, p) => { packets.push({ a, p }); return true; },
  registerChatCommand: (n, fn, opts) => commands.set(n, { fn, opts: opts || {} }), onlineActors: () => online.slice(),
  every: (n, ms, fn) => timersByName.set(n, fn), findByName: (q) => ({ me: LEAD, p17: PLAYER, '#tag': PLAYER })[String(q).toLowerCase()] || 0,
  redress: () => undefined, isAdmin: (a) => !!TIER[a], cfg,
  isLeadStaff: (a) => !!TIER[a] && TIER[a] !== 'gm', tierOf: (a) => TIER[a] || null,
  hasUiCap: (a, c) => (caps.get(a) || new Set()).has(c),
});
const GLOBALS = ['__dboVampireLordRemote', '__dboVlRemoteSetBy', '__dboWerewolfRemote', '__dboWwRemoteSetBy', '__dboBeastBody', '__dboBeastNear', '__dboBeastCasts',
  '__dboBeastDrops', '__dboBeastDropLog', '__dboBeastPowers', '__dboPolymorphOn', '__dboPolymorphSetBy', '__dboBeastStaleTaken', '__dboAnticheat', '__dboCombatAt',
  '__dboIsDowned', '__dboInDuel'];
const reload = (cfg) => {
  commands = new Map(); timersByName = new Map(); logs = [];
  delete require.cache[BEASTFORM];
  require(BEASTFORM)(api(cfg || { beastform: { vampireLordRemoteRace: true, werewolfRemoteRace: true } }));
};
const restart = (cfg) => { for (const k of GLOBALS) delete globalThis[k]; reload(cfg); };
const place = (a, x, cell) => { props.set(`${a}|worldOrCellDesc`, cell || WORLD); props.set(`${a}|pos`, [x, 0, 0]); };
const freshWorld = () => {
  props = new Map(); said = []; audits = []; packets = []; papyrus = []; appearanceWrites = [];
  for (const a of online) {
    props.set(`${a}|appearance`, { raceId: HUMAN, name: `Name${a.toString(16)}`, headpartIds: [1, 2], tints: [], options: [], presets: [] });
    props.set(`${a}|isDead`, false);
    props.set(`${a}|inventory`, { entries: [] });
    place(a, 100000 + a * 10000, OTHER_WORLD);   // far away, in another worldspace
  }
  place(LEAD, 0);
  caps.clear();
  for (const a of [NEWP, OWNER]) caps.set(a, new Set(['beastBody', 'creatureBody']));
  caps.set(PLAYER, new Set(['beastBody']));
};
const run = (a, args) => { const n = said.length; commands.get('polymorph').fn(a, args); return said.slice(n).filter((x) => x.a === a).map((x) => x.t).join(' | '); };
const told = (from, a) => said.slice(from).filter((x) => x.a === a).map((x) => x.t);
const witnessLines = (from) => said.slice(from).filter((x) => /^You see /.test(x.t));
const beast = (a) => props.get(`${a}|private.beast`) || null;
const look = (a) => props.get(`${a}|appearance`) || {};
const tick = () => timersByName.get('beastForms')();
const lastBeastPacket = (a) => { const l = packets.filter((x) => x.a === a && x.p.customPacketType === 'dboBeast').pop(); return l ? l.p : null; };
const listTo = (v) => { const l = packets.filter((x) => x.a === v && x.p.customPacketType === 'dboBeastBody').pop(); return l ? l.p.bodies : null; };
const revertToOwn = () => { const s = beast(LEAD); if (s) globalThis.__dboBeastRevert(LEAD, 'test'); };

freshWorld();
restart();
// ---- 0. it exists (fails on a tree without /polymorph) -------------------------------------------------------------------------
ok(commands.has('polymorph'), '0. beastform.js registers /polymorph');
if (!commands.has('polymorph')) { console.log(`\n${fail} FAILED (no /polymorph in ${BEASTFORM})`); process.exit(1); }
const opts = commands.get('polymorph').opts;
ok(opts.admin === true && /^[\x20-\x7e]+$/.test(String(opts.help || '')), '0. it is a staff command (admin) with plain ASCII help', opts);
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
ok(/const LEAD_ONLY = new Set\(\[[^\]]*'polymorph'/.test(gm), '0. gamemode.js LEAD_ONLY holds polymorph (a GM is refused at the command gate)');
ok(/key: 'beasts'[^\n]*items: \[[^\]]*'polymorph'/.test(gm), '0. and /help admin beasts lists it');
ok(/require\(BEASTFORM_JS\)\(\{[^}]*isLeadStaff, tierOf, hasUiCap \}\)/.test(gm), '0. gamemode.js hands beastform.js isLeadStaff and tierOf (hasUiCap still last)');
ok(logs.some((l) => /beastform polymorph ON: chicken a919d, hare 6dc99, goat 6fc4a, fox 109c7c, dog 131ee, skeever 13201, mudcrab ba545, deer cf89b/.test(l)), '0. the boot line names each animal\'s race id', logs.filter((l) => /polymorph/.test(l)));

// ---- 1. the rank gate --------------------------------------------------------------------------------------------------------
let r = run(GM, 'chicken');
ok(/Lead GM and above/.test(r) && !beast(GM), '1. a GM is refused by the module too (isLeadStaff, the LEAD_ONLY rank)', r);
r = run(PLAYER, 'chicken');
ok(/Lead GM and above/.test(r) && !beast(PLAYER), '1. a player is refused', r);
r = run(OWNER, 'list');
ok(/Nobody is in an animal shape/.test(r), '1. an Owner may use it (list)', r);
restart({});
const noRank = Object.assign({}, api({}));
delete noRank.isLeadStaff; delete noRank.tierOf;
commands = new Map(); delete require.cache[BEASTFORM]; require(BEASTFORM)(noRank);
r = run(LEAD, 'chicken');
ok(/Lead GM and above/.test(r) && !beast(LEAD), '1. an older gamemode.js that hands no rank helper: closed for everyone', r);
restart();

// ---- 2. only on oneself ------------------------------------------------------------------------------------------------------
for (const args of ['chicken #TAG', 'chicken P17', 'chicken me', 'revert P17', 'chicken P17 now']) {
  const r2 = run(LEAD, args);
  ok(/yourself alone/.test(r2) && !beast(LEAD) && !beast(PLAYER), `2. /polymorph ${args}: refused, nobody changes, no name is looked up`, r2);
}
r = run(LEAD, 'p17');
ok(/^Usage: \/polymorph/.test(r) && !beast(PLAYER), '2. a player\'s name in place of the animal is just an unknown animal', r);

// ---- 3. every refusal --------------------------------------------------------------------------------------------------------
const refusal = (label, setup, undo, rx) => {
  setup();
  const n = said.length, was = beast(LEAD) ? beast(LEAD).form : null;
  const r3 = run(LEAD, 'chicken');
  ok(rx.test(r3) && (beast(LEAD) ? beast(LEAD).form : null) === was && witnessLines(n).length === 0, `3. ${label}: refused (${r3})`, r3);
  undo();
};
refusal('dead', () => props.set(`${LEAD}|isDead`, true), () => props.set(`${LEAD}|isDead`, false), /dead/);
refusal('down (bleed-out)', () => { props.set(`${LEAD}|isDead`, true); globalThis.__dboIsDowned = (a) => a === LEAD; }, () => { props.set(`${LEAD}|isDead`, false); delete globalThis.__dboIsDowned; }, /down/);
refusal('on a horse (the anticheat\'s mount)', () => { globalThis.__dboAnticheat = { players: new Map([[LEAD, { mounted: true, horse: 0x777 }]]) }; }, () => { delete globalThis.__dboAnticheat; }, /horse/);
refusal('on a horse (its relayed animation)', () => props.set(`${LEAD}|lastAnimEvent`, 'HorseEnter'), () => props.set(`${LEAD}|lastAnimEvent`, null), /horse/);
refusal('seated in a chair', () => props.set(`${LEAD}|lastAnimEvent`, 'IdleChairFrontEnter'), () => props.set(`${LEAD}|lastAnimEvent`, null), /sitting/);
refusal('at a crafting station', () => props.set(`${LEAD}|lastAnimEvent`, 'IdleBlacksmithForgeEnter'), () => props.set(`${LEAD}|lastAnimEvent`, null), /sitting or using/);
refusal('bound', () => props.set(`${LEAD}|private.restrained`, { boundHands: true }), () => props.set(`${LEAD}|private.restrained`, null), /bound/);
refusal('captured (held by a captor)', () => props.set(`${LEAD}|private.restrained`, { captorActorId: PLAYER }), () => props.set(`${LEAD}|private.restrained`, null), /held/);
refusal('carried', () => props.set(`${LEAD}|private.restrained`, { carried: true }), () => props.set(`${LEAD}|private.restrained`, null), /carried/);
refusal('jailed', () => props.set(`${LEAD}|private.dboSentence`, { totalMs: 600000, servedMs: 1000 }), () => props.set(`${LEAD}|private.dboSentence`, null), /jail/);
refusal('in a duel', () => { globalThis.__dboInDuel = (a) => a === LEAD; }, () => { delete globalThis.__dboInDuel; }, /duel/);
refusal('in a fight', () => { globalThis.__dboCombatAt = new Map([[LEAD, now - 5000]]); }, () => { delete globalThis.__dboCombatAt; }, /fight/);
refusal('already a werewolf', () => { props.set(`${LEAD}|private.werewolfGrant`, true); globalThis.__dboBeastTransform(LEAD, 'werewolf', true); }, () => { revertToOwn(); props.set(`${LEAD}|private.werewolfGrant`, undefined); }, /Leave your Beast Form shape first/);
refusal('indoors (an interior CELL)', () => place(LEAD, 0, INSIDE), () => place(LEAD, 0), /indoors/);
refusal('in water (a relayed swim)', () => props.set(`${LEAD}|lastAnimEvent`, 'SwimStart'), () => props.set(`${LEAD}|lastAnimEvent`, null), /water/);
refusal('with the appearance editor open', () => props.set(`${LEAD}|private.dboAppearanceEdit`, { at: now }), () => props.set(`${LEAD}|private.dboAppearanceEdit`, null), /appearance editor/);
refusal('not online', () => { online = online.filter((a) => a !== LEAD); }, () => { online.push(LEAD); }, /not in the world/);
globalThis.__dboCombatAt = new Map([[LEAD, now - 31000]]);
props.set(`${LEAD}|lastAnimEvent`, 'IdleChairFrontExit');
r = run(LEAD, 'chicken');
ok(beast(LEAD) && beast(LEAD).form === 'chicken', '3. a fight over 30 s ago and a chair already left do not refuse', r);
revertToOwn(); delete globalThis.__dboCombatAt; props.set(`${LEAD}|lastAnimEvent`, null);

// ---- 4. the visibility guard -------------------------------------------------------------------------------------------------
place(PLAYER, 3000);
r = run(LEAD, 'chicken');
ok(/^A player nearby cannot see this form yet/.test(r) && !beast(LEAD), '4. a player on a client with only beastBody 3000 units away: refused', r);
caps.set(PLAYER, new Set());
place(FARP, 5900);
r = run(LEAD, 'chicken');
ok(/^2 players nearby cannot see this form yet/.test(r) && !beast(LEAD), '4. two such players (one with no capability at all, at 5900): refused, counted, never named', r);
place(PLAYER, 3000, OTHER_WORLD); place(FARP, 13000);
r = run(LEAD, 'chicken');
ok(beast(LEAD) && beast(LEAD).form === 'chicken', '4. the same spot in another worldspace, and 13000 units (three grid squares off): allowed', r);
revertToOwn();
place(NEWP, 1500); place(OWNER, 2500);
r = run(LEAD, 'chicken');
ok(beast(LEAD) && beast(LEAD).form === 'chicken', '4. players near whose clients say creatureBody: allowed', r);
// the tick re-check
let n0 = said.length;
tick();
ok(beast(LEAD), '4. tick: still nobody near who cannot see it: kept');
place(PLAYER, 4000);
n0 = said.length;
tick();
ok(!beast(LEAD) && look(LEAD).raceId === HUMAN && look(LEAD).name === `Name${LEAD.toString(16)}`, '4. tick: a player without creatureBody walks within 6000: reverted at once', look(LEAD));
ok(told(n0, LEAD).some((t) => /You are yourself again: a player came near whose game cannot show the animal yet/.test(t)), '4. ...the staff member is told why', told(n0, LEAD));
ok(witnessLines(n0).length === 0, '4. ...and nobody near is told anything', witnessLines(n0));
ok(audits.some((t) => /^BEAST P14 \(profile 20\) left the Chicken shape \(polymorph\): a player who cannot see it came near$/.test(t)), '4. ...the staff audit says why it ended', audits.slice(-2));
place(PLAYER, 3000, OTHER_WORLD);
run(LEAD, 'chicken');
place(LEAD, 0, INSIDE);
n0 = said.length;
tick();
ok(!beast(LEAD) && told(n0, LEAD).some((t) => /cannot open doors, so it ends indoors/.test(t)), '4. tick: an animal moved indoors is reverted and told why', told(n0, LEAD));
place(LEAD, 0);
run(LEAD, 'chicken');
props.set(`${LEAD}|lastAnimEvent`, 'SwimStart');
n0 = said.length;
tick();
ok(!beast(LEAD) && told(n0, LEAD).some((t) => /cannot swim, so it ends in water/.test(t)) && witnessLines(n0).length === 0, '4. tick: an animal that swims is reverted, told, silently', told(n0, LEAD));
props.set(`${LEAD}|lastAnimEvent`, null);
place(NEWP, 100000, OTHER_WORLD); place(OWNER, 110000, OTHER_WORLD);

// ---- 4b. the fork's streaming block, not a radius (review R1, 22 Oct) --------------------------------------------------------
// The fork streams an actor to every player in the 3x3 block of grid squares around it (MpObjectReference GetGridPos
// int16(pos / 4096), truncated toward zero, height ignored; Grid.h MoveImpl i, j in -1..1). The guard counts two squares out,
// and the fork's own listener list (actorNeighbors). Every refusal and revert below is one the 6000-unit radius let through.
const at = (a, p, cell) => { props.set(`${a}|worldOrCellDesc`, cell || WORLD); props.set(`${a}|pos`, p.slice()); };
const kept4b = [LEAD, PLAYER, FARP, NEWP].map((a) => [a, props.get(`${a}|worldOrCellDesc`), props.get(`${a}|pos`)]);
const capsPlayer4b = caps.get(PLAYER);
caps.set(PLAYER, new Set(['beastBody']));   // a live 0.3.106 client
at(FARP, [100000, 0, 0], OTHER_WORLD); at(NEWP, [110000, 0, 0], OTHER_WORLD);
const streamed = [
  ['in the next square on one axis, 7000 units off (LEAD at x 100)', [100, 0, 0], [7100, 0, 0]],
  ['in the next square, 8000 units off (LEAD at x 4200)', [4200, 0, 0], [12200, 0, 0]],
  ['in the next square on the diagonal, 11000 units off', [4200, 4200, 0], [4200 + 7778, 4200 + 7778, 0]],
  ['across the x = 0 line (square 0 is 8191 units wide), 12000 units off', [-3900, 0, 0], [8100, 0, 0]],
  ['10000 units straight above (height is ignored)', [100, 0, 0], [100, 0, 10000]],
  ['two squares off, 8100 units (not streamed yet: the one-square margin)', [4200, 0, 0], [12300, 0, 0]],
];
for (const [label, lp, pp] of streamed) {
  at(LEAD, lp); at(PLAYER, pp);
  const r4 = run(LEAD, 'chicken');
  ok(/^A player nearby cannot see this form yet/.test(r4) && !beast(LEAD), `4b. a 0.3.106 player ${label}: refused`, r4);
  revertToOwn();
}
at(LEAD, [4200, 0, 0]); at(PLAYER, [16400, 0, 0]);
r = run(LEAD, 'chicken');
ok(beast(LEAD) && beast(LEAD).form === 'chicken', '4b. a 0.3.106 player three squares off (12200 units): allowed', r);
n0 = said.length;
tick();
ok(beast(LEAD), '4b. tick: still three squares off: kept');
at(PLAYER, [12300, 0, 0]);
tick();
ok(!beast(LEAD) && told(n0, LEAD).some((t) => /a player came near whose game cannot show the animal yet/.test(t)) && witnessLines(n0).length === 0,
  '4b. tick: the player walks to two squares off (8100 units): reverted, told, silently', told(n0, LEAD));
revertToOwn();
at(LEAD, [100, 0, 0]); at(PLAYER, [7100, 0, 0], OTHER_WORLD);
r = run(LEAD, 'chicken');
ok(beast(LEAD) && beast(LEAD).form === 'chicken', '4b. the next square\'s spot in another worldspace: allowed', r);
revertToOwn();
at(PLAYER, [100000, 0, 0], OTHER_WORLD); at(NEWP, [7100, 0, 0]);
r = run(LEAD, 'chicken');
ok(beast(LEAD) && beast(LEAD).form === 'chicken', '4b. a creatureBody player in the next square: allowed', r);
// the fork's own listener list counts whatever the place says; LEAD itself, an NPC and a creatureBody client in it do not
const NPC4B = 0xff000abc;
props.set(`${LEAD}|actorNeighbors`, [LEAD, NPC4B, NEWP]);
n0 = said.length;
tick();
ok(beast(LEAD), '4b. tick: actorNeighbors holding LEAD itself, an NPC and a creatureBody client: kept');
props.set(`${LEAD}|actorNeighbors`, [LEAD, NPC4B, NEWP, PLAYER]);
tick();
ok(!beast(LEAD) && told(n0, LEAD).some((t) => /a player came near whose game cannot show the animal yet/.test(t)) && witnessLines(n0).length === 0,
  '4b. tick: the fork lists a 0.3.106 player as a neighbour (their place says another worldspace): reverted, told, silently', told(n0, LEAD));
revertToOwn();
r = run(LEAD, 'chicken');
ok(/^A player nearby cannot see this form yet/.test(r) && !beast(LEAD), '4b. ...and refused while the fork lists them', r);
revertToOwn();
props.delete(`${LEAD}|actorNeighbors`);
at(PLAYER, [NaN, 0, 0]);
r = run(LEAD, 'chicken');
ok(/^A player nearby cannot see this form yet/.test(r) && !beast(LEAD), '4b. a player in the same worldspace whose place is not a number counts as near (fails closed)', r);
revertToOwn();
for (const [a, c, p] of kept4b) { props.set(`${a}|worldOrCellDesc`, c); props.set(`${a}|pos`, p); }
caps.set(PLAYER, capsPlayer4b);

// ---- 5. the change: the race swap, silent, the mortal race kept ---------------------------------------------------------------
place(NEWP, 1000);   // a creatureBody client watching
const appBefore = JSON.parse(JSON.stringify(look(LEAD)));
n0 = said.length;
const l0 = logs.length;
r = run(LEAD, 'chicken');
let s = beast(LEAD);
ok(s && s.form === 'chicken' && s.creature === true && s.race === ANIMALS.chicken && s.until === 0, '5. private.beast keeps the animal, its race and creature: true, untimed', s);
ok(s && JSON.stringify(s.original) === JSON.stringify(appBefore), '5. ...and the real look', s && s.original);
ok(look(LEAD).raceId === HUMAN && look(LEAD).name === 'Chicken', '5. the appearance keeps the mortal race for every client, named Chicken', look(LEAD));
let pk = lastBeastPacket(LEAD);
ok(pk && pk.beast === true && pk.race === ANIMALS.chicken && pk.form === 'chicken' && pk.abilities === null && Array.isArray(pk.wear) && !pk.wear.length, '5. the own client is sent dboBeast with the chicken race, no abilities, no outfit', pk);
ok(witnessLines(n0).length === 0 && !logs.slice(l0).some((l) => /near saw it/.test(l)), '5. silent: nobody near is told (no witness line)', witnessLines(n0));
ok(/You are a Chicken/.test(r), '5. the staff member is told', r);
ok(audits.some((t) => t === 'BEAST P14 (profile 20) took the Chicken shape (polymorph, staff, own character)'), '5. the staff audit line (who and which animal, no typed words)', audits.slice(-1));
ok(globalThis.__dboBeastName(LEAD) === 'Chicken' && globalThis.__dboBeastOriginalRace(LEAD) === HUMAN, '5. __dboBeastName says Chicken; __dboBeastOriginalRace the mortal race', [globalThis.__dboBeastName(LEAD), globalThis.__dboBeastOriginalRace(LEAD)]);
ok(globalThis.__dboBeastEthereal(LEAD) === false, '5. killable: the animal is not ethereal');
r = run(LEAD, 'list');
ok(/In an animal shape now: P14: Chicken for 0 min/.test(r), '5. /polymorph list names it', r);
r = run(LEAD, 'goat');
ok(/already a Chicken/.test(r) && beast(LEAD).form === 'chicken', '5. a second animal waits for the revert', r);
const papyrusBefore = papyrus.length;
n0 = said.length;
r = run(LEAD, 'revert');
ok(!beast(LEAD) && JSON.stringify(look(LEAD)) === JSON.stringify(appBefore), '5. /polymorph revert puts the exact look back', look(LEAD));
pk = lastBeastPacket(LEAD);
ok(pk && pk.beast === false && pk.race === HUMAN, '5. ...the own client is sent its own race', pk);
ok(witnessLines(n0).length === 0 && /You are yourself again/.test(r), '5. ...silently, and the staff member is told', [r, witnessLines(n0)]);
ok(papyrus.length === papyrusBefore, '5. no spell is learned or unlearned for an animal');
ok(audits.some((t) => /^BEAST P14 \(profile 20\) left the Chicken shape \(polymorph\): asked$/.test(t)), '5. the audit says it was asked', audits.slice(-1));
r = run(LEAD, 'revert');
ok(/your own shape/.test(r), '5. revert in one\'s own shape says so', r);

// every animal, by its proven race id; rabbit is the hare
for (const [k, race] of Object.entries(ANIMALS).concat([['rabbit', ANIMALS.hare]])) {
  run(LEAD, k);
  const st = beast(LEAD); const p = lastBeastPacket(LEAD);
  ok(st && st.race === race && p.race === race && p.beast === true, `5. /polymorph ${k}: race ${race.toString(16)}`, [st, p]);
  revertToOwn();
}
ok(!appearanceWrites.some((w) => CREATURE_RACES.has(Number(w.v && w.v.raceId) >>> 0)), '5. no appearance write ever carries an animal race');

// ---- 6. the werewolf and the Vampire Lord keep their witness lines -----------------------------------------------------------
props.set(`${LEAD}|private.werewolfGrant`, true);
n0 = said.length;
globalThis.__dboBeastTransform(LEAD, 'werewolf', true);
ok(witnessLines(n0).some((x) => x.a === NEWP && /twist into a beast/.test(x.t)), '6. a werewolf\'s change is still witnessed', witnessLines(n0));
n0 = said.length;
globalThis.__dboBeastRevert(LEAD, 'asked to revert');
ok(witnessLines(n0).some((x) => x.a === NEWP && /shed the beast/.test(x.t)), '6. ...and its revert', witnessLines(n0));
n0 = said.length;
globalThis.__dboBeastTransform(LEAD, 'vampirelord', true);
globalThis.__dboBeastRevert(LEAD, 'asked to revert');
ok(witnessLines(n0).filter((x) => x.a === NEWP).map((x) => x.t.replace(/^You see \S+ /, '')).join('|') === 'rise into a Vampire Lord.|sink back into mortal form.', '6. ...and the Vampire Lord\'s rise and fall', witnessLines(n0));
props.set(`${LEAD}|private.werewolfGrant`, undefined);
r = run(LEAD, 'revert');
globalThis.__dboBeastTransform(LEAD, 'vampirelord', true);
r = run(LEAD, 'revert');
ok(/not an animal shape: \/beast revert/.test(r) && beast(LEAD).form === 'vampirelord', '6. /polymorph revert leaves a Vampire Lord alone', r);
revertToOwn();

// ---- 7. death, logout and login: the mortal look and race back, never an animal saved ----------------------------------------
const mortal = JSON.parse(JSON.stringify(look(LEAD)));
run(LEAD, 'fox');
props.set(`${LEAD}|isDead`, true);
n0 = said.length;
globalThis.__dboBeastRevert(LEAD, 'death');   // gamemode.js's death hook
ok(!beast(LEAD) && JSON.stringify(look(LEAD)) === JSON.stringify(mortal), '7. killed as a fox: the mortal look is back at once (seen as themselves)', look(LEAD));
ok(lastBeastPacket(LEAD).beast === false && lastBeastPacket(LEAD).race === HUMAN, '7. ...the own race is sent');
ok(witnessLines(n0).length === 0 && told(n0, LEAD).some((t) => /the animal died/.test(t)), '7. ...silently; the staff member is told the animal died', told(n0, LEAD));
ok(audits.some((t) => /left the Fox shape \(polymorph\): died$/.test(t)), '7. ...and the audit says it died');
const sent = packets.length;
props.set(`${LEAD}|isDead`, false);
now += 3000;
tick();
ok(packets.slice(sent).some((x) => x.a === LEAD && x.p.customPacketType === 'dboBeast' && x.p.beast === false && x.p.race === HUMAN), '7. up again: the own race is sent once more (the bleed-out resend)');
run(LEAD, 'deer');
n0 = said.length;
globalThis.__dboBeastRevert(LEAD, 'logout');   // gamemode.js's disconnect
ok(!beast(LEAD) && JSON.stringify(look(LEAD)) === JSON.stringify(mortal) && told(n0, LEAD).length === 0, '7. logged out as a deer: the mortal look saved, nothing said', look(LEAD));
ok(audits.some((t) => /left the Deer shape \(polymorph\): logged out$/.test(t)), '7. ...the audit says logged out');
// a crash: the shape stayed on the character until the next login
props.set(`${LEAD}|private.beast`, { form: 'dog', original: mortal, at: now - 60000, until: 0, race: ANIMALS.dog, creature: true });
props.set(`${LEAD}|appearance`, Object.assign({}, mortal, { name: 'Dog' }));
n0 = said.length;
globalThis.__dboBeastRevert(LEAD, 'login');   // gamemode.js's login step
ok(!beast(LEAD) && JSON.stringify(look(LEAD)) === JSON.stringify(mortal) && lastBeastPacket(LEAD).race === HUMAN, '7. logged in still a dog: back to the mortal look and race', look(LEAD));
ok(told(n0, LEAD).some((t) => /still an animal when you left/.test(t)) && witnessLines(n0).length === 0, '7. ...silently, told why', told(n0, LEAD));
ok(!props.get(`${LEAD}|private.beastCarry`), '7. no rest is carried for an untimed animal');
ok(/globalThis\.__dboBeastRevert\(a, 'login'\)/.test(gm) && /globalThis\.__dboBeastRevert\(a, 'logout'\)/.test(gm) && /globalThis\.__dboBeastRevert\(actorId, 'death'\)/.test(gm), '7. gamemode.js reverts every form at login, logout and death');
ok(!appearanceWrites.some((w) => CREATURE_RACES.has(Number(w.v && w.v.raceId) >>> 0)), '7. still no appearance write with an animal race');

// ---- 8. the kill switch ------------------------------------------------------------------------------------------------------
const saved = () => { try { return JSON.parse(fs.readFileSync('beastform-state.json', 'utf8')); } catch (e) { return null; } };
ok(saved() === null || saved().polymorphOn === undefined, '8. nothing written before an Owner uses the switch', saved());
r = run(LEAD, 'off');
ok(/Only an Owner/.test(r) && globalThis.__dboPolymorphOn === true, '8. a Lead GM cannot switch it', r);
commands.get('wwremote').fn(OWNER, 'off');
run(LEAD, 'skeever');
n0 = said.length;
r = run(OWNER, 'off');
ok(globalThis.__dboPolymorphOn === false && saved().polymorphOn === false && saved().polymorphSetBy === 'admin', '8. an Owner\'s /polymorph off: off, written to beastform-state.json', saved());
ok(saved().werewolfRemote === false, '8. ...keeping /wwremote\'s key in the same file', saved());
ok(!beast(LEAD) && told(n0, LEAD).some((t) => /switched off/.test(t)) && witnessLines(n0).length === 0, '8. ...a skeever is turned back at once, told, silently', told(n0, LEAD));
ok(/turned back/.test(r) && audits.some((t) => t === 'BEAST P15 (profile 21) switched polymorph off for all staff (1 turned back)'), '8. ...audited', audits.slice(-2));
r = run(LEAD, 'chicken');
ok(/switched off/.test(r) && !beast(LEAD), '8. off: refused', r);
reload();
ok(globalThis.__dboPolymorphOn === false && /switched off/.test(run(LEAD, 'chicken')), '8. a hot reload keeps it off');
restart();
ok(globalThis.__dboPolymorphOn === false && /switched off/.test(run(LEAD, 'chicken')), '8. a restart keeps it off (read from the file)');
ok(logs.some((l) => /beastform polymorph off \(admin\)/.test(l)), '8. the boot line says it is off and who set it', logs.filter((l) => /polymorph/.test(l)));
// a shape left from before the switch went off (a crash) is ended by the tick
props.set(`${LEAD}|private.beast`, { form: 'goat', original: mortal, at: now, until: 0, race: ANIMALS.goat, creature: true });
tick();
ok(!beast(LEAD), '8. off: the tick ends any animal shape left over');
run(OWNER, 'on');
restart();
ok(globalThis.__dboPolymorphOn === true && saved().polymorphOn === true, '8. /polymorph on survives a restart');
run(LEAD, 'chicken');
ok(beast(LEAD) && beast(LEAD).form === 'chicken', '8. on: allowed again');
revertToOwn();
fs.unlinkSync('beastform-state.json');
restart({ beastform: { polymorph: { enabled: false } } });
ok(globalThis.__dboPolymorphOn === false, '8. no file: the config\'s polymorph.enabled false is the default');
restart({});
ok(globalThis.__dboPolymorphOn === true, '8. ...and the code default is on');
restart({ beastform: { polymorph: { forms: ['chicken'] } } });
ok(/not open for polymorph/.test(run(LEAD, 'goat')) && !beast(LEAD), '8. polymorph.forms narrows which animals may be taken');
restart();

// ---- 9. creature keys never reach the beast powers -----------------------------------------------------------------------------
const before = { ww: props.get(`${LEAD}|private.werewolfGrant`), vl: props.get(`${LEAD}|private.vampireLordGrant`) };
for (const op of ['grant', 'remove', 'now', 'revert', '']) {
  const p0 = papyrus.length, n = said.length;
  commands.get('beastform').fn(LEAD, `me chicken ${op}`.trim());
  ok(/^Usage: \/beastform/.test(told(n, LEAD).join(' ')) && papyrus.length === p0 && !beast(LEAD), `9. /beastform me chicken ${op || '(grant)'}: refused, no spell call, no change`, told(n, LEAD));
}
ok(props.get(`${LEAD}|private.werewolfGrant`) === before.ww && props.get(`${LEAD}|private.vampireLordGrant`) === before.vl, '9. ...and neither grant was written');
for (const op of ['now', 'grant', 'revoke']) {
  const p0 = papyrus.length;
  const out = globalThis.__dboBeastAdmin(LEAD, 'chicken', op);
  ok(/^Unknown form 'chicken'/.test(out) && papyrus.length === p0 && !beast(LEAD) && props.get(`${LEAD}|private.werewolfGrant`) === before.ww, `9. __dboBeastAdmin chicken ${op}: refused, nothing granted, revoked or changed`, out);
}
ok(globalThis.__dboBeastTransform(LEAD, 'chicken', true) === false && !beast(LEAD), '9. __dboBeastTransform(chicken) refuses: not a form');
ok(globalThis.__dboBeastCast(LEAD, ANIMALS.chicken) === false && !beast(LEAD), '9. no power id leads to an animal (byPower)');
run(LEAD, 'hare');
ok(/^Unknown form 'chicken'/.test(globalThis.__dboBeastAdmin(LEAD, 'chicken', 'now')) && beast(LEAD).form === 'hare', '9. still refused while a hare, and the hare stays');
const h = globalThis.__dboBeastHolds(LEAD);
ok(h.form === 'hare' && h.werewolf === false && h.vampirelord === false, '9. __dboBeastHolds: form hare, no power held', h);
n0 = said.length;
ok(/back in their own shape/.test(globalThis.__dboBeastAdmin(LEAD, 'hare', 'revert')) && !beast(LEAD) && witnessLines(n0).length === 0, '9. the admin panel\'s revert ends an animal shape by its key, silently');
run(LEAD, 'mudcrab');
ok(/back in their own shape/.test(globalThis.__dboBeastAdmin(LEAD, 'werewolf', 'revert')) && !beast(LEAD), '9. ...and by the werewolf key the panel sends');
run(LEAD, 'mudcrab');
n0 = said.length;
commands.get('beast').fn(LEAD, '');
ok(!beast(LEAD) && told(n0, LEAD).some((t) => /own shape/.test(t)) && witnessLines(n0).length === 0, '9. /beast reverts an animal shape too, silently');
run(LEAD, 'mudcrab');
n0 = said.length;
commands.get('beastform').fn(LEAD, 'me werewolf revert');
ok(!beast(LEAD) && witnessLines(n0).length === 0 && audits.some((t) => /left the Mudcrab shape \(polymorph\): staff command$/.test(t)), '9. /beastform <me> werewolf revert ends it, audited as a staff command (no name in the reason)', audits.slice(-1));

// ---- 10. bodies: creatureBody clients see the animal; beastBody clients get exactly the werewolf and the Lord ---------------
const OLDW = PLAYER, NEWW = NEWP, NONE = FARP;
place(OLDW, 0, OTHER_WORLD); place(NEWW, 0, OTHER_WORLD); place(NONE, 0, OTHER_WORLD); place(OWNER, 0, OTHER_WORLD); place(GM, 0, OTHER_WORLD);
caps.set(OLDW, new Set(['beastBody'])); caps.set(NEWW, new Set(['beastBody', 'creatureBody'])); caps.set(NONE, new Set());
props.set(`${WOLF}|private.werewolfGrant`, true); place(WOLF, 50000);
props.set(`${LORD}|private.vampireLordGrant`, true); place(LORD, 60000);
globalThis.__dboBeastTransform(WOLF, 'werewolf', true);
globalThis.__dboBeastTransform(LORD, 'vampirelord', true);
const beastOnly = JSON.stringify(listTo(OLDW));
ok(beastOnly === JSON.stringify([{ id: WOLF, race: WEREWOLF_RACE }, { id: LORD, race: VL_RACE }]), '10. before any animal: a beastBody client is sent the werewolf and the Lord', listTo(OLDW));
run(LEAD, 'chicken');
ok(JSON.stringify(listTo(OLDW)) === beastOnly, '10. a chicken beside them: the beastBody client\'s list is exactly as before (no animal entry)', listTo(OLDW));
ok(JSON.stringify(listTo(NEWW)) === JSON.stringify([{ id: WOLF, race: WEREWOLF_RACE }, { id: LORD, race: VL_RACE }, { id: LEAD, race: ANIMALS.chicken }]), '10. a creatureBody client gets the werewolf, the Lord and the chicken {id, race}', listTo(NEWW));
ok(listTo(NONE) === null, '10. a client with neither capability is sent nothing');
caps.set(LEAD, new Set(['beastBody', 'creatureBody'])); tick();
ok(!(listTo(LEAD) || []).some((b) => b.id === LEAD), '10. the animal is never listed to itself', listTo(LEAD));
// the trap: the creature's race never comes through FORMS[formOf()]; a state with no race falls back to the animal table
props.set(`${LEAD}|private.beast`, Object.assign({}, beast(LEAD), { race: undefined }));
now += 31000; tick();
ok(JSON.stringify(listTo(NEWW)) === JSON.stringify([{ id: WOLF, race: WEREWOLF_RACE }, { id: LORD, race: VL_RACE }, { id: LEAD, race: ANIMALS.chicken }]), '10. a creature state without its race: the table\'s race, the werewolf and the Lord still listed', listTo(NEWW));
// a key gone from both tables (a rollback): no throw, no entry, the beasts still listed, the name still read
props.set(`${LEAD}|private.beast`, { form: 'wolfling', original: mortal, at: now, until: 0, creature: true });
let threw = null; try { now += 31000; tick(); } catch (e) { threw = e.message; }
ok(threw === null && JSON.stringify(listTo(NEWW)) === JSON.stringify([{ id: WOLF, race: WEREWOLF_RACE }, { id: LORD, race: VL_RACE }]) && JSON.stringify(listTo(OLDW)) === beastOnly, '10. an unknown creature key: no throw, no entry, the werewolf and Lord bodies unchanged', [threw, listTo(NEWW)]);
ok(globalThis.__dboBeastName(LEAD) === 'wolfling', '10. __dboBeastName of an unknown key: the key, no throw', globalThis.__dboBeastName(LEAD));
props.set(`${LEAD}|private.beast`, { form: 'wolfling', original: mortal, at: now, until: 0 });
threw = null; let nm = null; try { nm = globalThis.__dboBeastName(LEAD); } catch (e) { threw = e.message; }
ok(threw === null && nm === 'wolfling', '10. ...nor without the creature mark (the old code threw on FORMS[s.form].name)', [threw, nm]);
props.set(`${LEAD}|private.beast`, null);
ok(globalThis.__dboBeastName(LEAD) === '', '10. __dboBeastName of no form: empty');
props.set(`${LEAD}|private.beast`, { form: 'wolfling', original: mortal, at: now, until: 0, creature: true });
n0 = said.length;
ok(globalThis.__dboBeastRevert(LEAD, 'asked to revert') === true && JSON.stringify(look(LEAD)) === JSON.stringify(mortal) && witnessLines(n0).length === 0, '10. ...and it still reverts, silently');
ok(audits.some((t) => /^BEAST P14 \(profile 20\) left the animal shape \(polymorph\): asked$/.test(t)), '10. ...audited with a fixed word, never the key', audits.slice(-1));
// the kill switch also takes every animal off the lists
run(LEAD, 'chicken');
ok((listTo(NEWW) || []).some((b) => b.id === LEAD), '10. the chicken is listed again');
run(OWNER, 'off');
ok(!(listTo(NEWW) || []).some((b) => b.id === LEAD) && JSON.stringify(listTo(OLDW)) === beastOnly, '10. off: the chicken leaves every list, the beasts stay', listTo(NEWW));
run(OWNER, 'on');
globalThis.__dboBeastRevert(WOLF, 'test'); globalThis.__dboBeastRevert(LORD, 'test');

// ---- 11. the rest of the wiring --------------------------------------------------------------------------------------------
const src = fs.readFileSync(BEASTFORM, 'utf8');
ok(!/mp\.on\(/.test(src), '11. beastform.js registers no mp.on listener (hot reload)');
ok(/globalThis\.__dboPolymorphOn/.test(src) && /polymorphOn: on === true/.test(src), '11. the switch lives on globalThis and in beastform-state.json');
ok(!/—/.test(src), '11. no em dash in beastform.js');
const R = require(path.join(ROOT, 'playerlog-rules.js'));
const sch = R.COMMAND_SCHEMA.polymorph;
ok(sch && Array.isArray(sch.subs) && sch.subs.includes('chicken') && sch.subs.includes('off') && !sch.target, '11. the player log keeps /polymorph by its word alone (never a name: it takes none)', sch);
r = run(LEAD, '');
ok(/Polymorph is on/.test(r) && /chicken, hare, goat, fox, dog, skeever, mudcrab, deer/.test(r) && !/on\|off/.test(r), '11. /polymorph alone: the state and the animals (the switch named to Owners only)', r);
ok(/on\|off/.test(run(OWNER, '')), '11. ...an Owner is shown the switch');
r = run(LEAD, 'wolf');
// The usage line stopped naming the animals once there were eighteen; what matters is that the wolf, the
// horse and the giant are not among them, so this asks the form list rather than the sentence
ok(/^Usage: \/polymorph <animal> \| revert \| list\./.test(r) && !beast(LEAD), '11. an unknown animal gets the usage line', r);
ok(!globalThis.__dboPolymorphPanel().forms.some((f) => /wolf|horse|giant/.test(f.key)), '11. wolf, horse and giant are not animals here', globalThis.__dboPolymorphPanel().forms.map((f) => f.key));
ok(/^Usage/.test(run(LEAD, 'horse')) && !beast(LEAD), '11. ...nor the horse');

// ---- 12. what the admin panel is fed -------------------------------------------------------------------------------
// The panel's two hops are the fork's adminSystem.ts payload and adminMenuService's panelData mirror; everything the
// gameplay layer has to say rides these two hooks. The front must keep NO list of its own, or it offers an animal the
// server refuses.
restart({ beastform: {} });
let P = globalThis.__dboPolymorphPanel();
ok(P.on === true && Array.isArray(P.forms) && P.forms.length === 18, '12. __dboPolymorphPanel: the switch and all eighteen animals', P.forms.length);
ok(P.forms.map((f) => f.key).join(',') === 'chicken,hare,goat,fox,dog,skeever,mudcrab,deer,hagraven,bear,snowbear,sabrecat,snowsabrecat,troll,draugr,skeleton,spriggan,falmer', '12. ...in the table order, by key', P.forms.map((f) => f.key));
// The ten added on 25 Oct must each resolve in this load order, or the panel offers a shape the server refuses
ok(['hagraven', 'bear', 'snowbear', 'sabrecat', 'snowsabrecat', 'troll', 'draugr', 'skeleton', 'spriggan', 'falmer'].every((k) => P.forms.some((f) => f.key === k)), '12. every form added on 25 Oct resolves in the load order');
ok(P.forms.every((f) => f.name && f.name !== f.key) && P.forms.find((f) => f.key === 'mudcrab').name === 'Mudcrab', '12. ...each with the name the panel shows', P.forms);
ok(!P.forms.some((f) => /wolf|horse/.test(f.key)), '12. ...and never the wolf or the horse');

// A narrowed config must narrow the panel too, or the picker offers what /polymorph will refuse
restart({ beastform: { polymorph: { forms: ['fox', 'deer'] } } });
P = globalThis.__dboPolymorphPanel();
ok(P.forms.length === 2 && P.forms.map((f) => f.key).join(',') === 'fox,deer', '12. polymorph.forms narrows the panel\'s picker as well as the command', P.forms);
ok(/not open for polymorph/.test(run(LEAD, 'goat')), '12. ...and the command still refuses what the picker no longer offers');

restart({ beastform: {} });
run(OWNER, 'off');
P = globalThis.__dboPolymorphPanel();
ok(P.on === false && P.setBy === 'admin', '12. the panel sees the Owners\' switch and who set it', P);
run(OWNER, 'on');
ok(globalThis.__dboPolymorphPanel().on === true, '12. ...and sees it come back on');

// creature and since: the panel tells an animal from a beast without a list, and can print "for N min"
revertToOwn();
let H = globalThis.__dboBeastHolds(LEAD);
ok(H.form === null && H.creature === false && H.since === null, '12. __dboBeastHolds in one\'s own shape: no form, no creature, no since', H);
run(LEAD, 'skeever');
H = globalThis.__dboBeastHolds(LEAD);
ok(H.form === 'skeever' && H.creature === true && typeof H.since === 'number' && H.since > 0, '12. ...a skeever: creature true, since set', H);
revertToOwn();
props.set(`${LEAD}|private.werewolfGrant`, true);
globalThis.__dboBeastTransform(LEAD, 'werewolf', true);
H = globalThis.__dboBeastHolds(LEAD);
ok(H.form === 'werewolf' && H.creature === false && typeof H.since === 'number', '12. ...a werewolf: a form with a since, but NOT a creature', H);
revertToOwn();
props.set(`${LEAD}|private.werewolfGrant`, undefined);

ok(!/\u2014/.test(src), '12. still no em dash in beastform.js');

// ---- 13. __dboPolymorphSelf, the hook the F7 panel calls ------------------------------------------------------------
// The fork's adminSystem.ts 'polymorphSelf' action calls globalThis.__dboPolymorphSelf(actorId, form) and shows its
// return value. It was missing: I wrote the fork side and never the gameplay side, so the panel answered "This
// server's beastform.js has no panel polymorph" and Nat hit it on dev (25 Oct). Section 12 checked the panel's DATA
// and never the panel's ACTION, which is the gap that let it through. These call it exactly as adminSystem does.
restart({ beastform: {} });
ok(typeof globalThis.__dboPolymorphSelf === 'function', '13. beastform.js defines __dboPolymorphSelf for the panel');
revertToOwn();
let r13 = globalThis.__dboPolymorphSelf(LEAD, 'fox');
ok(r13 === '' && beast(LEAD) && beast(LEAD).form === 'fox', '13. a Lead GM takes a fox from the panel: \'\' and the shape is on', [r13, beast(LEAD) && beast(LEAD).form]);
revertToOwn();

// the rank is re-checked here, so the gate never depends on the caller
r13 = globalThis.__dboPolymorphSelf(GM, 'fox');
ok(/Lead GM/.test(r13) && !beast(GM), '13. a GM is refused by the hook itself, whatever the caller gated', r13);

// the command's alias works, and an unknown word is refused rather than thrown
revertToOwn();
r13 = globalThis.__dboPolymorphSelf(LEAD, 'rabbit');
ok(r13 === '' && beast(LEAD) && beast(LEAD).form === 'hare', '13. the rabbit alias reaches the hare, as /polymorph does', [r13, beast(LEAD) && beast(LEAD).form]);
revertToOwn();
ok(/no such animal/i.test(globalThis.__dboPolymorphSelf(LEAD, 'dragon')) && !beast(LEAD), '13. an animal that is not in the table is refused');
ok(/no such animal/i.test(globalThis.__dboPolymorphSelf(LEAD, '')) && !beast(LEAD), '13. ...and so is an empty form');
ok(/no such animal/i.test(globalThis.__dboPolymorphSelf(LEAD, undefined)) && !beast(LEAD), '13. ...and undefined, which a packet with no form gives');

// every refusal of the chat command applies, because it is the same path: the Owners' switch
run(OWNER, 'off');
r13 = globalThis.__dboPolymorphSelf(LEAD, 'fox');
ok(/switched off/i.test(r13) && !beast(LEAD), '13. the Owners\' switch refuses the panel too', r13);
run(OWNER, 'on');

// and the config allow-list
restart({ beastform: { polymorph: { forms: ['fox'] } } });
revertToOwn();
ok(globalThis.__dboPolymorphSelf(LEAD, 'fox') === '', '13. a narrowed allow-list still lets its own form through');
revertToOwn();
ok(/not open for polymorph/i.test(globalThis.__dboPolymorphSelf(LEAD, 'goat')) && !beast(LEAD), '13. ...and refuses one it leaves out');
restart({ beastform: {} });
revertToOwn();

// the fork calls it with an actor and a form and nothing else: there is no target to aim at anybody
ok(globalThis.__dboPolymorphSelf.length === 2, '13. the hook takes an actor and a form alone, so the panel cannot target anyone else');


// ---- 14. __dboPolymorphAs, the entry for a module that has decided eligibility itself ------------------------------
// hagraven.js (Worker 5) turns a stage-3 Hagraven into the creature and back. It must reuse this path so every guard
// applies, but it cannot use __dboPolymorphSelf, which gates on Lead GM. 'fox' throughout: these check the hook, not
// the form table. LEAD has no creatureBody cap, so it is kept outside the guard radius; NEWP has one.
restart({ beastform: {} });
revertToOwn();
place(LEAD, 900000, OTHER_WORLD);
place(NEWP, 0);

const hasAs = typeof globalThis.__dboPolymorphAs === 'function';
// Through a wrapper so a missing hook FAILS every check below instead of throwing and ending the run early, which
// would report far fewer failures than there are
const polyAs = (a, k, o) => (hasAs ? globalThis.__dboPolymorphAs(a, k, o) : 'no __dboPolymorphAs hook');
ok(hasAs, '14. beastform.js defines __dboPolymorphAs for gameplay modules');
ok(hasAs && globalThis.__dboPolymorphAs.length === 3, '14. it takes an actor, a form and an opts, so the caller can name itself');

let r14 = globalThis.__dboPolymorphSelf(NEWP, 'fox');
ok(/Lead GM/.test(r14) && !beast(NEWP), '14. a plain player is still refused by the staff hook', r14);
r14 = polyAs(NEWP, 'fox', { by: 'hagraven' });
ok(r14 === '' && beast(NEWP) && beast(NEWP).form === 'fox', '14. ...and allowed by __dboPolymorphAs, which does not check rank', [r14, beast(NEWP) && beast(NEWP).form]);
ok(beast(NEWP) && beast(NEWP).by === 'hagraven', '14. private.beast.by names the module, so others can tell whose shape it is', beast(NEWP));
ok(audits.some((t) => /took the Fox shape \(polymorph, hagraven\)$/.test(t)), '14. the audit names the caller instead of staff', audits.slice(-1));

// These three ended only the START before: a shape taken a moment earlier survived them
// Each of these asserts the shape was ON first: without that, a run where no shape is ever taken passes them all
let on14 = !!beast(NEWP);
globalThis.__dboIsDowned = (a) => a === NEWP;
tick();
ok(on14 && !beast(NEWP), '14. tick: a player who goes down while in a shape is reverted', on14);
delete globalThis.__dboIsDowned;

polyAs(NEWP, 'fox', { by: 'hagraven' });
on14 = !!beast(NEWP);
props.set(NEWP + '|private.dboSentence', { totalMs: 60000, servedMs: 0 });
tick();
ok(on14 && !beast(NEWP), '14. tick: a player taken to jail while in a shape is reverted', on14);
props.set(NEWP + '|private.dboSentence', null);

polyAs(NEWP, 'fox', { by: 'hagraven' });
on14 = !!beast(NEWP);
props.set(NEWP + '|private.restrained', { boundHands: true });
tick();
ok(on14 && !beast(NEWP), '14. tick: a player bound while in a shape is reverted', on14);
props.set(NEWP + '|private.restrained', null);

// The module says its own ending, so the animal wording is not put in a Hagraven's mouth
polyAs(NEWP, 'fox', { by: 'hagraven' });
let n14 = said.length;
on14 = !!beast(NEWP);
place(NEWP, 0, INSIDE);
tick();
ok(on14 && !beast(NEWP), '14. tick: indoors still ends a module shape', on14);
ok(!told(n14, NEWP).some((t) => /cannot open doors/.test(t)), '14. ...and the player is NOT told the animal line, so the module can say its own', told(n14, NEWP));
ok(audits.some((t) => /left the Fox shape \(polymorph, hagraven\): went indoors$/.test(t)), '14. ...while the audit still names the caller and the reason', audits.slice(-1));
place(NEWP, 0);

// A staff shape keeps the animal wording it always had
place(NEWP, 900000, OTHER_WORLD);
place(LEAD, 0);
globalThis.__dboPolymorphSelf(LEAD, 'fox');
n14 = said.length;
place(LEAD, 0, INSIDE);
tick();
ok(told(n14, LEAD).some((t) => /cannot open doors/.test(t)), '14. a staff shape is still told the animal line', told(n14, LEAD));
place(LEAD, 0);

// The same three for a STAFF shape, taken through the hook that already existed. This isolates the polymorphBreak
// change from the new entry point, and covers Worker 5's point that it should apply to staff too.
place(NEWP, 900000, OTHER_WORLD);
place(LEAD, 0);
globalThis.__dboPolymorphSelf(LEAD, 'fox');
on14 = !!beast(LEAD);
globalThis.__dboIsDowned = (a) => a === LEAD;
tick();
ok(on14 && !beast(LEAD), '14. tick: a STAFF shape also ends on a down', on14);
delete globalThis.__dboIsDowned;

globalThis.__dboPolymorphSelf(LEAD, 'fox');
on14 = !!beast(LEAD);
props.set(LEAD + '|private.dboSentence', { totalMs: 60000, servedMs: 0 });
tick();
ok(on14 && !beast(LEAD), '14. tick: a STAFF shape also ends on a jail sentence', on14);
props.set(LEAD + '|private.dboSentence', null);

globalThis.__dboPolymorphSelf(LEAD, 'fox');
on14 = !!beast(LEAD);
props.set(LEAD + '|private.restrained', { carried: true });
tick();
ok(on14 && !beast(LEAD), '14. tick: a STAFF shape also ends on being carried', on14);
props.set(LEAD + '|private.restrained', null);
revertToOwn();

// Every other refusal is unchanged
place(LEAD, 900000, OTHER_WORLD);
place(NEWP, 0);
run(OWNER, 'off');
ok(/switched off/i.test(polyAs(NEWP, 'fox', { by: 'hagraven' })) && !beast(NEWP), '14. the Owners\' switch refuses a module shape too');
run(OWNER, 'on');
ok(/no such animal/i.test(polyAs(NEWP, 'dragon', { by: 'hagraven' })) && !beast(NEWP), '14. an animal not in the table is refused');
props.set(NEWP + '|isDead', true);
ok(/dead/i.test(polyAs(NEWP, 'fox', { by: 'hagraven' })) && !beast(NEWP), '14. polymorphRefusal still applies: not while dead');
props.set(NEWP + '|isDead', false);
restart({ beastform: { polymorph: { forms: ['chicken'] } } });
place(LEAD, 900000, OTHER_WORLD);
place(NEWP, 0);
ok(/not open for polymorph/i.test(polyAs(NEWP, 'fox', { by: 'hagraven' })) && !beast(NEWP), '14. ...and so does the allow-list');
restart({ beastform: {} });

// ---- 15. a creature form with a loadout: the Hagraven ---------------------------------------------------------------
// The four spells are exactly what EncHagraven (023ab0) carries, read off the record: HagravenRace has no SPLO at all.
// Whether a player can CAST them in the body is an in-game question; these checks are that they are granted, announced
// and removed, which is the part a harness can settle.
restart({ beastform: {} });
revertToOwn();
place(LEAD, 900000, OTHER_WORLD);
place(NEWP, 0);

const FIREBOLT = 0x7d98f, FIREBALL = 0x7d997, FASTHEAL = 0x7231c, CLOSEWOUNDS = 0xf95eb, REVERT = 0xcd5c;

let r15 = polyAs(NEWP, 'chicken', { by: 'test' });
let pk15 = lastBeastPacket(NEWP);
ok(r15 === '' && pk15 && pk15.abilities === null, '15. a form with no loadout still sends abilities null', pk15 && pk15.abilities);
ok(pk15 && (pk15.camera === null || pk15.camera === undefined), '15. ...and no camera offsets when the config names none', pk15 && pk15.camera);
globalThis.__dboBeastRevert(NEWP, 'test');

const papyrus15 = papyrus.length;
r15 = polyAs(NEWP, 'hagraven', { by: 'hagraven' });
pk15 = lastBeastPacket(NEWP);
ok(r15 === '' && !!pk15 && !!pk15.abilities, '15. the Hagraven sends a real loadout rather than null', r15 || (pk15 && pk15.abilities));
// Null-safe on purpose: without it a run where abilities come back null throws here and the later checks never
// report at all, which reads as fewer failures than there are
const ab15 = (slot) => (pk15 && pk15.abilities && pk15.abilities[slot]) || [];
const ids15 = (list) => (list || []).map((x) => x.id);
// NOTHING in the hands: a creature body crashed on the humanoid weapon-draw path (25 Oct), and
// equipping anything into a creature graph is unproven, so the hands stay empty until the client
// guard ships. A safety property, so it is asserted rather than merely untested.
ok(ids15(ab15('right')).length === 0, '15. ...and NOTHING in the right hand while a creature body is worn', ids15(ab15('right')));
ok(ids15(ab15('left')).length === 0, '15. ...nor the left', ids15(ab15('left')));
ok(!ids15(ab15('right')).includes(FIREBOLT) && !ids15(ab15('left')).includes(FASTHEAL),
  '15. ...so her verified EncHagraven spells are held back rather than equipped', [ids15(ab15('right')), ids15(ab15('left'))]);
ok(ids15(ab15('voice')).includes(REVERT), '15. ...and Revert Form on the shout key, so the form can be ended there', ids15(ab15('voice')));
// self() wraps the actor in an espm/form object, so the method is what to filter on; the window holds only this change
const added15 = papyrus.slice(papyrus15).filter((x) => x.method === 'AddSpell');
ok(added15.length >= 3, '15. the server grants the voice powers too (AddSpell), as the beast path does', added15.length);

const papyrusRevert15 = papyrus.length;
globalThis.__dboBeastRevert(NEWP, 'test');
const removed15 = papyrus.slice(papyrusRevert15).filter((x) => x.method === 'RemoveSpell');
ok(removed15.length >= 3, '15. and the shared revert takes them away again (RemoveSpell)', removed15.length);

// ---- the camera offsets the client service reads --------------------------------------------------------------------
restart({ beastform: { polymorph: { camera: { hagraven: { z: 50, combatZ: 40 } } } } });
place(LEAD, 900000, OTHER_WORLD);
place(NEWP, 0);
polyAs(NEWP, 'hagraven', { by: 'hagraven' });
pk15 = lastBeastPacket(NEWP);
ok(pk15 && pk15.camera && pk15.camera.z === 50 && pk15.camera.combatZ === 40,
  '15. the camera offsets come from the config, so they can be tuned without a client build', pk15 && pk15.camera);
ok(pk15 && pk15.camera && pk15.camera.x === undefined, '15. ...and only the keys the config names are sent', pk15 && pk15.camera);
globalThis.__dboBeastRevert(NEWP, 'test');

restart({ beastform: { polymorph: { camera: { hagraven: { z: 'high', combatX: null } } } } });
place(LEAD, 900000, OTHER_WORLD);
place(NEWP, 0);
polyAs(NEWP, 'hagraven', { by: 'hagraven' });
pk15 = lastBeastPacket(NEWP);
ok(pk15 && pk15.camera === null, '15. a camera value that is not a number is dropped rather than sent to an ini', pk15 && pk15.camera);
globalThis.__dboBeastRevert(NEWP, 'test');
restart({ beastform: {} });


// ---- 16. the Hagraven's two powers (DLE records, Nat 25 Oct) --------------------------------------------------------
// Scream reuses the howl's sweep with her own kind spared; Summon Spriggan has NO POWERS entry on purpose, because
// the fork's ConjurationSystem already spawns any SummonCreature a player casts.
restart({ beastform: {} });
revertToOwn();
place(LEAD, 900000, OTHER_WORLD);
place(NEWP, 0);

const SCREAM = 0x1d2233, SUMMON_SPRIGGAN = 0x1d2234;

polyAs(NEWP, 'hagraven', { by: 'hagraven' });
let pk16 = lastBeastPacket(NEWP);
const voice16 = ((pk16 && pk16.abilities && pk16.abilities.voice) || []).map((x) => x.id);
ok(voice16.indexOf(SCREAM) >= 0, '16. the Hagraven is granted her Scream', voice16);
ok(voice16.indexOf(SUMMON_SPRIGGAN) >= 0, '16. ...and Summon Spriggan', voice16);
ok(voice16[voice16.length - 1] === 0xcd5c, '16. ...with Revert Form LAST, so the default shout-key power never ends the form', voice16);

// A victim who can be frightened: same place, alive, with percentages to write
place(PLAYER, 100);
props.set(`${PLAYER}|percentages`, { health: 1, magicka: 1, stamina: 1 });
props.set(`${PLAYER}|isDead`, false);

let n16 = packets.length;
globalThis.__dboBeastPower(NEWP, SCREAM);
const terrors = packets.slice(n16).filter((x) => x.p && x.p.customPacketType === 'dboStatus' && x.p.kind === 'terror');
ok(terrors.length === 1 && terrors[0].a === PLAYER, '16. the Scream terrifies a player nearby', terrors.map((t) => t.a));
ok(terrors.length === 1 && /shriek/i.test(terrors[0].p.text), '16. ...and it is a shriek, not a howl, in her mouth', terrors[0] && terrors[0].p.text);

// The negative that matters: no POWERS entry for the summon, so nothing here runs it twice
n16 = packets.length;
globalThis.__dboBeastPower(NEWP, SUMMON_SPRIGGAN);
const after16 = packets.slice(n16).filter((x) => x.p && x.p.customPacketType === 'dboStatus' && x.p.kind === 'terror');
ok(after16.length === 0, '16. Summon Spriggan runs NOTHING here: ConjurationSystem owns the spawn', after16.length);

// Her kind is spared, where a werewolf would not be
props.set(`${PLAYER}|percentages`, { health: 1, magicka: 1, stamina: 1 });
polyAs(PLAYER, 'hagraven', { by: 'hagraven' });
n16 = packets.length;
globalThis.__dboBeastPower(NEWP, SCREAM);
const kinSpared = packets.slice(n16).filter((x) => x.p && x.p.customPacketType === 'dboStatus' && x.p.kind === 'terror');
ok(kinSpared.length === 0, '16. another Hagraven is kin and is not frightened', kinSpared.length);
globalThis.__dboBeastRevert(PLAYER, 'test');

// And the form gate still holds: her power does nothing in somebody else's body
globalThis.__dboBeastRevert(NEWP, 'test');
props.set(`${PLAYER}|percentages`, { health: 1, magicka: 1, stamina: 1 });
n16 = packets.length;
globalThis.__dboBeastPower(NEWP, SCREAM);
ok(packets.slice(n16).filter((x) => x.p && x.p.kind === 'terror').length === 0,
  '16. the Scream does nothing when she is not in the body', packets.slice(n16).length);


// ---- 17. a missing ability record says so, instead of granting nothing in silence ----------------------------------
// The DLE id table is an interface with no failure signal (Worker 3, 26 Oct): a desc that stops resolving gives id 0
// and allSpells filters it, so a shifted id would leave the Hagraven with no powers and no complaint. These check the
// complaint exists, because a safety net nobody triggers is not one.

// the normal case first: everything resolves, so nothing is said
restart({ beastform: {} });
ok(logs.filter((l) => /not in this load order/.test(l)).length === 0,
  '17. a load order that has every record says nothing', logs.filter((l) => /not in this load order/.test(l)));

// now a load order where the DLE records are absent, as an older client or a shifted candidate would be
logs = [];
delete require.cache[BEASTFORM];
delete globalThis.__dboBeastAbilitiesChecked;
const api17 = api({ beastform: {} });
const realDesc17 = api17.mp.getIdFromDesc;
api17.mp.getIdFromDesc = (d) => (/DragonBreak Online Edits/.test(String(d)) ? 0 : realDesc17(d));
require(BEASTFORM)(api17);

const gone17 = logs.filter((l) => /not in this load order/.test(l));
ok(gone17.length === 2, '17. both missing DLE records are named, one line each', gone17);
ok(gone17.some((l) => /Hagraven Scream/.test(l) && /1d2233/.test(l)),
  '17. ...the Scream, with the desc that failed, so a log search finds it', gone17);
ok(gone17.some((l) => /Summon Spriggan/.test(l) && /1d2234/.test(l)), '17. ...and Summon Spriggan', gone17);
ok(gone17.every((l) => /grants it to nobody/.test(l)), '17. ...and each says what the consequence is', gone17);
ok(logs.some((l) => /2 ability record\(s\) missing/.test(l)), '17. ...with a count to notice at a glance',
  logs.filter((l) => /missing from the load order/.test(l)));

// and it is once per process: a hot reload must not repeat it on every save
logs = [];
delete require.cache[BEASTFORM];
require(BEASTFORM)(api17);
ok(logs.filter((l) => /not in this load order/.test(l)).length === 0,
  '17. a hot reload does not say it again: the load order cannot change without a restart',
  logs.filter((l) => /not in this load order/.test(l)));

restart({ beastform: {} });



// ---- 18. the Hagraven keeps her body indoors (Nat, 26 Oct: "allow the form in interiors") -------------------
// Hers alone: she has hands and a humanoid-ish graph, so unlike the animals she can work a door. Every animal
// still ends indoors, which is the half of this that is easiest to break by accident.
restart({ beastform: {} });
// Everyone else parked in another worldspace: anybody standing near trips the "nobody near can see this form
// yet" guard, and then every refusal below would be that guard rather than the indoors rule under test.
for (const a of [OWNER, GM, PLAYER, WOLF, LORD, FARP, LEAD]) place(a, 900000, OTHER_WORLD);
place(NEWP, 0);

let n18 = said.length;
polyAs(NEWP, 'hagraven', { by: 'hagraven' });
const hagOn = !!beast(NEWP);
ok(hagOn, '18. the Hagraven body can be taken', hagOn);
place(NEWP, 0, INSIDE);
tick();
ok(hagOn && !!beast(NEWP), '18. tick: she KEEPS the body indoors', { on: hagOn, still: !!beast(NEWP) });
ok(!told(n18, NEWP).some((t) => /cannot open doors/.test(t)),
  '18. ...and is never told the animals line about doors', told(n18, NEWP));
tick(); tick();
ok(!!beast(NEWP), '18. ...and still has it several ticks later, so it is not a one-tick reprieve');

// The exemption covers the INDOORS rule only.
globalThis.__dboPolymorphOn = false;
tick();
ok(!beast(NEWP), '18. the Owners switch still ends her shape indoors, so the exemption is scoped to one rule');
globalThis.__dboPolymorphOn = true;
place(NEWP, 0);

// The regression that matters most.
let n18b = said.length;
polyAs(NEWP, 'fox', { by: 'hagraven' });
const foxOn = !!beast(NEWP);
place(NEWP, 0, INSIDE);
tick();
ok(foxOn && !beast(NEWP), '18. a fox indoors is STILL reverted: the exemption is hers alone', { on: foxOn, still: !!beast(NEWP) });
place(NEWP, 0);

// Entry too: refusing the change indoors while not reverting indoors would be incoherent.
place(NEWP, 900000, OTHER_WORLD);
place(LEAD, 0, INSIDE);   // alone in an interior, with everyone else a worldspace away
const rIn = run(LEAD, 'hagraven');
ok(!!beast(LEAD) && !/indoors/.test(rIn), '18. she can be taken WHILE indoors', rIn);
run(LEAD, 'revert');
const rFox = run(LEAD, 'chicken');
ok(!beast(LEAD) && /indoors/.test(rFox), '18. ...while an animal taken indoors is still refused', rFox);
place(LEAD, 0);

// Her line must not promise something that no longer happens.
const n18c = said.length;
run(LEAD, 'hagraven');
const hagTell = told(n18c, LEAD).join(' | ');
ok(!/going indoors/.test(hagTell), '18. her own line does not promise that going indoors turns her back', hagTell);
run(LEAD, 'revert');
const n18d = said.length;
run(LEAD, 'chicken');
ok(/going indoors/.test(told(n18d, LEAD).join(' | ')), '18. ...while an animal is still told that it does', told(n18d, LEAD));
run(LEAD, 'revert');

// It is a per-form capability, not a default: fail closed.
ok((src.match(/indoors: true/g) || []).length === 1, '18. exactly one form carries the indoors flag');
ok(/allowsIndoors\(key\)/.test(src) && /allowsIndoors\(form\)/.test(src), '18. both the refusal and the tick consult it');

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nall ${pass} checks passed`);
process.exit(fail ? 1 : 0);
