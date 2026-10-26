// Scripted test for hagraven.js (Nat, 25 Oct: the Hagraven's pact, design H1 H2 H4) and its ties to briarheart.js. Loads both
// real modules against stubs: women and men of the Reach and elsewhere, faiths, inventories, places and holds; the pact
// (every refusal, the confirm), the stages by time played (speed, citizenship lapsing, the daily renewal), the gifts
// (Destruction, magicka, no Divine but Kynareth), a full Hagraven performing the Briarheart rite, known on sight outside
// the exempt Reach, Kyne's cure, staff grant / stage / revoke, the login, and the hooks the other modules carry.
// Run it from this folder's parent with
//
//   node tests\hagraven-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!c) fails++; };

// ---- the world ---------------------------------------------------------------------------------------------------------
const WORLD = '3c:Skyrim.esm';
const RACES = { 1: 'DBOReachmanRace', 2: 'NordRace' };
const ID = { '3ad66:Skyrim.esm': 0x3ad66, '6b689:Skyrim.esm': 0x6b689, '2e4ff:Skyrim.esm': 0x2e4ff, '3ad61:Skyrim.esm': 0x3ad61, '2e504:Skyrim.esm': 0x2e504 };
const FEATHER = 0x3ad66, CLAW = 0x6b689, GRAND = 0x2e4ff, HEART = 0x3ad61;
const props = new Map();
const P = (a, k) => props.get(`${a >>> 0}|${k}`);
const setP = (a, k, v) => props.set(`${a >>> 0}|${k}`, v);
const papyrusCalls = [];
const mp = {
  get: (a, k) => { const v = P(a, k); return v === undefined ? null : JSON.parse(JSON.stringify(v)); },
  set: (a, k, v) => setP(a, k, v === null ? null : JSON.parse(JSON.stringify(v))),
  getIdFromDesc: (d) => ID[d] || 0,
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`,
  lookupEspmRecordById: (id) => (RACES[id] ? { record: { editorId: RACES[id] } } : { record: null }),
  callPapyrusFunction: (kind, cls, method, self, args) => { papyrusCalls.push({ method, self: self.desc, args: args.map((x) => (x && x.desc !== undefined ? x.desc : x)) }); return undefined; },
};
const faiths = new Map(); const zones = new Map();
const actor = (id, race, female, faith, pos, inv, zone) => {
  setP(id, 'appearance', { raceId: race, isFemale: female });
  setP(id, 'locationalData', { cellOrWorldDesc: WORLD, pos: pos || [0, 0, 0], rot: [0, 0, 0] });
  setP(id, 'inventory', { entries: inv || [] });
  faiths.set(id >>> 0, faith); zones.set(id >>> 0, zone || 'markarth');
  return id >>> 0;
};
const PACT_ITEMS = () => [{ baseId: FEATHER, count: 1 }, { baseId: CLAW, count: 1 }];
const WITCH = actor(0x20, 1, true, 'reach', [0, 0, 0], PACT_ITEMS());
const MAN = actor(0x21, 1, false, 'reach', [0, 0, 0], PACT_ITEMS());
const NORDW = actor(0x22, 2, true, 'reach', [0, 0, 0], PACT_ITEMS());
const IMPW = actor(0x23, 1, true, 'imperial', [0, 0, 0], PACT_ITEMS());
const VAMPW = actor(0x24, 1, true, 'reach', [0, 0, 0], PACT_ITEMS());
const STAFFW = actor(0x25, 1, true, 'reach', [0, 0, 0], PACT_ITEMS());
const LEAD = actor(0x26, 2, false, 'imperial', [0, 0, 0], []);
const REACHMAN = actor(0x27, 1, false, 'reach', [30, 0, 0], [{ baseId: HEART, count: 3 }]);
const PASSER = actor(0x28, 2, false, 'imperial', [100, 0, 0], [], 'whiterun');
setP(VAMPW, 'private.supernatural', { kind: 'vampire' });
const online = [WITCH, MAN, NORDW, IMPW, VAMPW, STAFFW, LEAD, REACHMAN, PASSER];
const said = []; const audits = []; const logs = []; const given = []; const commands = new Map(); const tickers = new Map();
const outlawed = []; const witnessedCalls = []; let citizenHolds = new Map([[WITCH, ['markarth', 'whiterun', 'solitude']]]);
const shrines = new Map();
globalThis.__dboFaithIdOf = (a) => faiths.get(a >>> 0) || '';
globalThis.__dboSuperKind = (a) => (P(a, 'private.supernatural') || {}).kind || null;
globalThis.__dboIsStaff = (a) => (a >>> 0) === STAFFW;
globalThis.__dboIsDowned = () => false;
globalThis.__dboCharLevelSyncBonus = () => {};
globalThis.__dboPrayerLastShrine = shrines;
globalThis.__dboCitizenHolds = (a) => (citizenHolds.get(a >>> 0) || []).slice();
globalThis.__dboCitizenOutlaw = (a, z, until, why) => { outlawed.push({ a, z, until, why }); citizenHolds.set(a >>> 0, (citizenHolds.get(a >>> 0) || []).filter((x) => x !== z)); return { removed: true }; };
globalThis.__dboBeastWitnessed = (a, form, seers, phase) => { witnessedCalls.push({ a, form, seers: seers.slice(), phase }); return true; };
const SKILLS = { 0x600: new Set([20]), 0x601: new Set([19]), 0x602: new Set([22]), 0x603: new Set() };

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hagraven-'));
const cwd = process.cwd(); process.chdir(scratch);
const api = (cfg) => ({
  mp, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => said.push([a >>> 0, t]), audit: (t) => audits.push(t), who: (a) => `who${(a >>> 0).toString(16)}`,
  display: (a) => `char${(a >>> 0).toString(16)}`, cfg, registerChatCommand: (n, f) => commands.set(n, f), onlineActors: () => online.slice(),
  isLeadStaff: (a) => (a >>> 0) === LEAD, findByName: (q) => ({ witch: WITCH, reachman: REACHMAN, man: MAN })[String(q).trim().toLowerCase()] || 0,
  every: (n, ms, f) => tickers.set(n, f), giveItem: (a, id, n) => given.push([a >>> 0, id, n]), sourceSkillsOf: (id) => SKILLS[id] || new Set(),
  sourceResistsOf: () => new Set(), zoneOfActor: (a) => ({ id: zones.get(a >>> 0) || '' }),
});
const HMOD = path.resolve(__dirname, '..', 'hagraven.js'), BMOD = path.resolve(__dirname, '..', 'briarheart.js');
const loadH = (cfg) => { delete require.cache[HMOD]; delete globalThis.__dboHagraven; return require(HMOD)(api(cfg)); };
const loadB = (cfg) => { delete require.cache[BMOD]; delete globalThis.__dboBriarheart; return require(BMOD)(api(cfg)); };
const run = (cmd, a, args) => { said.length = 0; commands.get(cmd)(a, args); return said.map(([, t]) => t).join(' | '); };
const inv = (a, id) => ((P(a, 'inventory') || {}).entries || []).filter((e) => e.baseId === id).reduce((n, e) => n + e.count, 0);
const HOUR = 3600000;

// ---- off ---------------------------------------------------------------------------------------------------------------
let H = loadH({});
ok(/No coven answers/.test(run('hagraven', WITCH, 'pact')), 'off by default: the pact is refused');
ok(globalThis.__dboHagravenStage(WITCH) === 0 && globalThis.__dboHagravenAttackMult(WITCH, 0x600) === 1, 'off: no hook does anything');

// ---- on: the altars come from briarheart.js -----------------------------------------------------------------------------
const CFG = { hagraven: { enabled: true }, briarheart: { enabled: true } };
let B = loadB(CFG);
H = loadH(CFG);
ok(/at a Hagraven altar/.test(run('hagraven', WITCH, 'pact')), 'no altar: refused');
run('briarheart', LEAD, 'altar add 300');
ok(B.data().altars.length === 1, 'a Lead GM places a Hagraven altar (briarheart.js)');
ok(/only women/.test(run('hagraven', MAN, 'pact')), 'a man is refused (femaleOnly)');
ok(/women of the Reach/.test(run('hagraven', NORDW, 'pact')), 'a Nord woman is refused (races)');
ok(/Old Gods of the Reach/.test(run('hagraven', IMPW, 'pact')), 'a Reachwoman of another faith is refused');
ok(/dead have no humanity/.test(run('hagraven', VAMPW, 'pact')), 'a vampire is refused');
ok(/Staff make no pact/.test(run('hagraven', STAFFW, 'pact')), 'staff are refused');
setP(WITCH, 'inventory', { entries: [{ baseId: FEATHER, count: 1 }] });
ok(/Feather and a Hagraven Claw/.test(run('hagraven', WITCH, 'pact')), 'without the claw: refused');
setP(WITCH, 'inventory', { entries: PACT_ITEMS() });
const offer = run('hagraven', WITCH, 'pact');
ok(/trade your humanity/.test(offer) && /Only Kyne can undo it/.test(offer) && /\/hagraven confirm within 5 minutes/.test(offer), 'the pact is offered with its price', offer);
ok(audits.some((t) => /asked for the pact and was told its price/.test(t)), 'audited');
ok(/You are Crone-touched/.test(run('hagraven', WITCH, 'confirm')) && globalThis.__dboHagravenStage(WITCH) === 1, 'confirmed: stage 1, Crone-touched');
ok(inv(WITCH, FEATHER) === 0 && inv(WITCH, CLAW) === 0, 'the feather and the claw are spent');
ok(/made the pact .* \(stage 1, Crone-touched\)/.test(audits.join('\n')), 'the pact is audited');
ok(/The pact is made, and cannot be made twice/.test(run('hagraven', WITCH, 'pact')), 'a second pact is refused');

// ---- the gifts ---------------------------------------------------------------------------------------------------------------
const am = globalThis.__dboHagravenAttackMult;
ok(Math.abs(am(WITCH, 0x600) - 1.1) < 1e-9, 'stage 1: her Destruction hits +10%');
ok(am(WITCH, 0x601) === 1 && am(WITCH, 0x602) === 1 && am(WITCH, 0x603) === 1, 'Conjuration, Restoration and weapons: unchanged (spellSkills is Destruction)');
ok(am(REACHMAN, 0x600) === 1, 'nobody else\'s Destruction changes');
ok(globalThis.__dboHagravenRegenMult(WITCH, 'magicka') === 1.5 && globalThis.__dboHagravenRegenMult(WITCH, 'stamina') === 1 && globalThis.__dboHagravenRegenMult(REACHMAN, 'magicka') === 1, 'magicka regeneration x1.5, hers only');
const rd = globalThis.__dboHagravenRefusesDeity;
ok(/turns from what you have become/.test(rd(WITCH, { id: 'talos', name: 'Talos', kind: 'divine' })), 'a Divine (Talos) refuses her');
ok(rd(WITCH, { id: 'kynareth', name: 'Kynareth', kind: 'divine' }) === '' && rd(WITCH, { id: 'hircine', name: 'Hircine', kind: 'daedra' }) === '', 'Kynareth still may, and the Daedra are not Divines');
ok(rd(REACHMAN, { id: 'talos', name: 'Talos', kind: 'divine' }) === '', 'a mortal is not refused');

// ---- the stages, by time played ------------------------------------------------------------------------------------------------
const tick = tickers.get('hagraven');
let rec = P(WITCH, 'private.dboHagraven'); rec.played = 20 * HOUR - 60000; setP(WITCH, 'private.dboHagraven', rec);
papyrusCalls.length = 0; outlawed.length = 0; said.length = 0;
tick();
ok(globalThis.__dboHagravenStage(WITCH) === 2, 'at 20 hours played: stage 2, Feathered');
ok(papyrusCalls.some((c) => c.method === 'SetActorValue' && c.args[0] === 'SpeedMult' && c.args[1] === 90), 'Feathered: SpeedMult 90 (to be measured in game)');
ok(logs.some((l) => /hagraven: SpeedMult 90 on char20/.test(l)), '...and logged');
ok(outlawed.map((o) => o.z).sort().join() === 'solitude,whiterun' && outlawed.every((o) => o.until > Date.now() + 6 * 24 * HOUR), 'her citizenship of every hold but the Reach lapses, barred 7 days', outlawed);
ok(said.some(([a, t]) => a === WITCH && /Feathers push through your skin/.test(t)) && said.some(([a, t]) => a === WITCH && /citizenship of whiterun, solitude is gone/.test(t)), 'she is told');
ok(audits.some((t) => /became Feathered \(stage 2/.test(t)), 'the stage is audited');
ok(Math.abs(am(WITCH, 0x600) - 1.2) < 1e-9, 'Feathered: Destruction +20%');
outlawed.length = 0; tick();
ok(outlawed.length === 0, 'the next minute bars nothing again (nothing held, not a day yet)');
rec = P(WITCH, 'private.dboHagraven'); rec.barredAt = Date.now() - 25 * HOUR; setP(WITCH, 'private.dboHagraven', rec); citizenHolds.set(WITCH, ['markarth', 'riften']);
tick();
ok(outlawed.length === 1 && outlawed[0].z === 'riften', 'a day on, a new citizenship outside the Reach is taken again (the bar renewed)', outlawed);
rec = P(WITCH, 'private.dboHagraven'); rec.played = 60 * HOUR - 60000; setP(WITCH, 'private.dboHagraven', rec);
tick();
ok(globalThis.__dboHagravenStage(WITCH) === 3 && Math.abs(am(WITCH, 0x600) - 1.3) < 1e-9, 'at 60 hours: stage 3, a Hagraven, Destruction +30%');
ok(/stage 3 of 3/.test(run('hagraven', WITCH, 'status')), '/hagraven says so');

// ---- a Hagraven performs the Briarheart rite --------------------------------------------------------------------------------------
const altar = B.data().altars[0];
ok(globalThis.__dboHagravenRiteAt(altar, REACHMAN) === WITCH, 'a full Hagraven at the altar is found as the rite\'s performer');
ok(globalThis.__dboHagravenRiteAt(altar, WITCH) === 0, '...never for herself');
setP(WITCH, 'locationalData', { cellOrWorldDesc: WORLD, pos: [900, 0, 0], rot: [0, 0, 0] });
ok(globalThis.__dboHagravenRiteAt(altar, REACHMAN) === 0, '...nor from outside the altar\'s radius');
setP(WITCH, 'locationalData', { cellOrWorldDesc: WORLD, pos: [0, 0, 0], rot: [0, 0, 0] });
ok(/made the Hagravens' pact yourself/.test(run('briarheart', WITCH, 'rite')), 'a Hagraven takes no briar herself');
Math.random = () => 0.99;
const ro = run('briarheart', REACHMAN, 'rite');
ok(/PERMANENT DEATH|die under the knife/.test(ro), 'the Reachman is offered the rite at the altar');
const done = run('briarheart', REACHMAN, 'confirm forever') || run('briarheart', REACHMAN, 'confirm');
ok(/char20 presses the briar into your chest/.test(done), 'the Hagraven is the one who presses the briar in', done);
ok(audits.some((t) => /took the briar heart at a Hagraven altar, from the Hagraven who20/.test(t)), 'the audit names her');
ok(said.some(([a, t]) => a === WITCH && /You press the briar into char27's chest/.test(t)), 'and she is told');
B.end(REACHMAN, 'test');
B = loadB({ briarheart: { enabled: true, hagravenRequired: true } }); B.data();
setP(WITCH, 'locationalData', { cellOrWorldDesc: WORLD, pos: [900, 0, 0], rot: [0, 0, 0] });
ok(/No Hagraven tends this altar/.test(run('briarheart', REACHMAN, 'rite')), 'hagravenRequired: with no Hagraven at the altar the rite waits');
setP(WITCH, 'locationalData', { cellOrWorldDesc: WORLD, pos: [0, 0, 0], rot: [0, 0, 0] });
ok(!/No Hagraven tends/.test(run('briarheart', REACHMAN, 'rite')), '...and goes ahead with her there');
B = loadB(CFG); B.data();

// ---- known on sight outside the Reach -----------------------------------------------------------------------------------------------
const wit = tickers.get('hagraven');
witnessedCalls.length = 0; wit();
ok(witnessedCalls.length === 0, 'in the Reach (exempt): nobody reports her');
zones.set(WITCH, 'whiterun'); setP(WITCH, 'locationalData', { cellOrWorldDesc: WORLD, pos: [100, 50, 0], rot: [0, 0, 0] });
globalThis.__dboHagraven.seenAt.clear();
wit();
ok(witnessedCalls.length === 1 && witnessedCalls[0].form === 'hagraven' && witnessedCalls[0].seers.includes(PASSER), 'in Whiterun: exposure.js is told she was seen as a Hagraven, with the people near', witnessedCalls);
wit();
ok(witnessedCalls.length === 1, 'at most once per witnessEveryMinutes');
zones.set(WITCH, 'markarth'); setP(WITCH, 'locationalData', { cellOrWorldDesc: WORLD, pos: [0, 0, 0], rot: [0, 0, 0] });

// ---- login, staff, Kyne's cure -----------------------------------------------------------------------------------------------------------
papyrusCalls.length = 0;
globalThis.__dboHagravenLogin(WITCH);
ok(papyrusCalls.some((c) => c.method === 'SetActorValue' && c.args[1] === 90), 'at login the slower step comes back');
ok(/Kynareth/.test(run('hagraven', WITCH, 'cure')), 'the cure needs a shrine of Kynareth');
shrines.set(WITCH, { deityId: 'arkay', at: Date.now() });
ok(/Kynareth/.test(run('hagraven', WITCH, 'cure')), '...Arkay will not do');
shrines.set(WITCH, { deityId: 'kynareth', at: Date.now() });
ok(/filled grand soul gem/.test(run('hagraven', WITCH, 'cure')), '...and a filled grand soul gem');
setP(WITCH, 'inventory', { entries: [{ baseId: GRAND, count: 1 }] });
papyrusCalls.length = 0;
ok(/a woman of the Reach again/.test(run('hagraven', WITCH, 'cure')) && globalThis.__dboHagravenStage(WITCH) === 0 && inv(WITCH, GRAND) === 0, 'Kyne cleanses her: the gem is spent, the pact gone');
ok(papyrusCalls.some((c) => c.method === 'SetActorValue' && c.args[1] === 100), 'her speed is restored');
ok(/Usage/.test(run('hagraven', WITCH, 'grant witch event')), 'a player cannot grant');
ok(/Give a reason/.test(run('hagraven', LEAD, 'grant witch')), 'a grant needs a reason');
ok(/Crone-touched\./.test(run('hagraven', LEAD, 'grant witch Lore Master event')) && globalThis.__dboHagravenStage(WITCH) === 1, 'a Lead GM grants the pact (stage 1)');
ok(/is Hagraven\./.test(run('hagraven', LEAD, 'stage witch 3 coven event')) && globalThis.__dboHagravenStage(WITCH) === 3, 'and sets a stage');
ok(audits.some((t) => /set who20 to stage 3 \(Hagraven\): coven event/.test(t)), 'audited with the reason');
ok(/no more/.test(run('hagraven', LEAD, 'revoke witch done')) && globalThis.__dboHagravenStage(WITCH) === 0, 'and revokes it');
ok(/char20 \(Crone-touched\)/.test((run('hagraven', LEAD, 'grant witch again'), run('hagraven', LEAD, 'list'))), '/hagraven list names the online ones and their stage');

// ---- the hooks in the other modules ----------------------------------------------------------------------------------------------------
const src = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
ok(/require\(HAGRAVEN_JS\)/.test(src('gamemode.js')) && /__dboHagravenAttackMult\(agg, src\)/.test(src('gamemode.js')) && /__dboHagravenLogin\(a\)/.test(src('gamemode.js')) && /const sourceSkillsOf = /.test(src('gamemode.js')), 'gamemode.js loads it, reads the schools, asks the attacker side, and calls the login');
ok(/__dboHagravenRegenMult/.test(src('racial.js')), 'racial.js asks for her magicka');
ok(/__dboHagravenRefusesDeity\(a, d\)/.test(src('prayer.js')), 'prayer.js asks before a blessing');
ok(/__dboHagravenStage/.test(src('supernatural.js')), 'supernatural.js keeps fevers and the Princes\' rites off her');
ok(/hagraven: \{ kind: 'hagraven'/.test(src('exposure.js')) && /form === 'hagraven'\) return/.test(src('exposure.js')) && /hagraven: \['vigil-of-stendarr'\]/.test(src('exposure.js')), 'exposure.js knows the form, keeps the case while she is stage 3, and tells the Vigil');
ok(/__dboBriarheartAltarNear = /.test(src('briarheart.js')) && /__dboHagravenRiteAt/.test(src('briarheart.js')), 'briarheart.js shares its altars and asks for a performing Hagraven');
const gcfg = JSON.parse(src('gamemode-config.json'));
ok(gcfg.hagraven && gcfg.hagraven.enabled === false && JSON.stringify(gcfg.hagraven.knownOnSightExemptHolds) === '["markarth"]' && gcfg.briarheart.hagravenRequired === false, 'the shipped config: OFF, the Reach exempt, no Hagraven required for a Briarheart');

process.chdir(cwd);
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
