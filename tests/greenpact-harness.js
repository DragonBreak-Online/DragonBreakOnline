// The Green Pact (greenpact.js, Nate 18 Oct: "yes to all, players need consent"): a wood elf sworn to the Pact is refused
// wood and plants, and partakes of a person they or their party slew within 3 game days; a player's body only when that
// player allows it; the guard nearby is told. Loads the real module with a stand-in mp.
//   node tests/greenpact-harness.js   (from server/)
'use strict';
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'greenpact.js');

let fails = 0;
const ok = (l, c, g) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${l}${!c && g !== undefined ? `: got ${JSON.stringify(g)}` : ''}`); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Records: two races (a person, the undead), NPC bases, flora
const NPC_RACE = 0x500, UNDEAD_RACE = 0x501, WOOD_ELF = 0x502, NORD = 0x503;
const kw = (...ids) => { const b = new Uint8Array(ids.length * 4); const dv = new DataView(b.buffer); ids.forEach((id, i) => dv.setUint32(i * 4, id, true)); return { type: 'KWDA', data: b }; };
const u32 = (type, v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return { type, data: b }; };
const records = new Map([
  [NPC_RACE, { record: { type: 'RACE', editorId: 'ImperialRace', fields: [kw(0x13794)] } }],
  [UNDEAD_RACE, { record: { type: 'RACE', editorId: 'DraugrRace', fields: [kw(0x13794, 0x13796)] } }],
  [WOOD_ELF, { record: { type: 'RACE', editorId: 'WoodElfRace', fields: [] } }],
  [NORD, { record: { type: 'RACE', editorId: 'NordRace', fields: [] } }],
  [0x600, { record: { type: 'NPC_', editorId: 'EncBandit01', fields: [u32('RNAM', NPC_RACE)] } }],
  [0x601, { record: { type: 'NPC_', editorId: 'EncDraugr01', fields: [u32('RNAM', UNDEAD_RACE)] } }],
  [0x700, { record: { type: 'FLOR', editorId: 'MountainFlower01Red', fields: [] } }],
  [0x701, { record: { type: 'FLOR', editorId: 'BeehiveHarvestable', fields: [] } }],
  [0x702, { record: { type: 'FLOR', editorId: 'CoinPurseMedium', fields: [] } }],
  [0x703, { record: { type: 'ACTI', editorId: 'MineOreIron', fields: [] } }],
]);
for (const r of records.values()) r.toGlobalRecordId = (x) => x;

const ELF = 0xff000010, NORD_P = 0xff000011, MATE = 0xff000012, STRANGER = 0xff000013, GUARD = 0xff000014, FAR_GUARD = 0xff000015;
const BANDIT = 0xff100001, DRAUGR = 0xff100002, OLD_BANDIT = 0xff100003, THEIRS = 0xff100004, FLOWER = 0x1001, HIVE = 0x1002, PURSE = 0x1003, VEIN = 0x1004;
const props = new Map();
const set = (id, p, v) => props.set(id + '|' + p, v);
const players = { [ELF]: [1, WOOD_ELF], [NORD_P]: [2, NORD], [MATE]: [3, NORD], [STRANGER]: [4, NORD], [GUARD]: [5, NORD], [FAR_GUARD]: [6, NORD] };
for (const [id, [pid, race]] of Object.entries(players)) { set(id, 'profileId', pid); set(id, 'appearance', { raceId: race, name: `P${pid}` }); set(id, 'isDead', false); }
for (const [id, base] of [[BANDIT, 0x600], [DRAUGR, 0x601], [OLD_BANDIT, 0x600], [THEIRS, 0x600], [FLOWER, 0x700], [HIVE, 0x701], [PURSE, 0x702], [VEIN, 0x703]]) set(id, 'baseDesc', String(base));
set(GUARD, 'private.dboLawful', true); set(FAR_GUARD, 'private.dboLawful', true);

const said = []; const audits = []; const sated = []; const anims = []; const cmds = {};
const faith = { [ELF]: { faith: 'greenpact', patron: 'yffre', sworn: 'greenpact' }, [NORD_P]: { faith: 'oldways', patron: 'kynareth', sworn: 'oldways' } };
globalThis.__dboFaithOf = (a) => faith[a] || null;
let day = 10; globalThis.__dboClock = { summary: () => ({ gameDays: day }) };
const leaders = { [ELF]: 3, [MATE]: 3 }; globalThis.__dboPartyLeaderOf = (a) => (a in leaders ? leaders[a] : null);
const far = new Set([FAR_GUARD]);
require(MODULE)({
  mp: { get: (id, p) => props.get(id + '|' + p), set: (id, p, v) => set(id, p, v), getIdFromDesc: (d) => parseInt(d, 10),
    getDescFromId: String, callPapyrusFunction: (k, c, f, s, args) => anims.push(args[1]) },
  log: () => {}, personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t), who: (a) => `P${props.get(a + '|profileId')}`,
  cfg: { greenPact: { feedSeconds: 0.02 } }, registerChatCommand: (n, f) => { cmds[n] = f; },
  recordOf: (id) => records.get(id >>> 0) || null, nameOf: (a) => (props.get(a + '|appearance') || {}).name || 'Stranger',
  profileOf: (a) => props.get(a + '|profileId') || 0, onlineActors: () => Object.keys(players).map(Number),
  distanceMeters: (a, b) => (far.has(a) || far.has(b) ? 80 : 2), sendPacket: () => {}, sate: (a) => sated.push(a),
  isGoldFlora: (t) => t === PURSE,
});
const act = (t, a) => globalThis.__dboGreenPactActivate(t, a);
const lastTo = (a) => { for (let i = said.length - 1; i >= 0; i--) if (said[i][0] === a) return said[i][1]; return ''; };

(async () => {
  // The taboo
  ok('a sworn wood elf is refused the chopping block', /cut wood/.test(globalThis.__dboGreenPactRefusal(ELF, 'chop')));
  ok('a Nord is not', globalThis.__dboGreenPactRefusal(NORD_P, 'chop') === '');
  ok('a sworn wood elf is refused a flower', act(FLOWER, ELF) === true && /living plant/.test(lastTo(ELF)));
  ok('...but not a hive, a purse or an ore vein', act(HIVE, ELF) === false && act(PURSE, ELF) === false && act(VEIN, ELF) === false);
  ok('a Nord picks the flower', act(FLOWER, NORD_P) === false);
  faith[ELF].sworn = '';
  ok('an unsworn wood elf (a god from before the faiths) picks it too', act(FLOWER, ELF) === false && globalThis.__dboGreenPactRefusal(ELF, 'chop') === '');
  faith[ELF].sworn = 'greenpact';

  // The Partaking of an NPC
  for (const b of [BANDIT, DRAUGR, OLD_BANDIT, THEIRS]) set(b, 'isDead', true);
  globalThis.__dboGreenPactDeath(BANDIT, ELF);
  globalThis.__dboGreenPactDeath(DRAUGR, ELF);
  globalThis.__dboGreenPactDeath(THEIRS, STRANGER);
  day = 6; globalThis.__dboGreenPactDeath(OLD_BANDIT, MATE); day = 10;
  ok('a body slain by someone else is searched, not eaten', act(THEIRS, ELF) === false);
  ok('an undead body is searched, not eaten', act(DRAUGR, ELF) === false);
  ok('a body slain 4 days ago by the party is too old', act(OLD_BANDIT, ELF) === false);
  ok('a Nord who slew a bandit only searches it', act(BANDIT, NORD_P) === false);
  ok('the sworn elf\'s own kill: E partakes', act(BANDIT, ELF) === true && anims.includes('IdleCannibalFeedCrouching'));
  ok('E again while feeding keeps the feed', act(BANDIT, ELF) === true);
  await wait(60);
  ok('the feed ends: hunger sated, body spent, the idle stopped', sated.includes(ELF) && props.get(BANDIT + '|private.dboPartaken') === true && anims.includes('IdleForceDefaultState'));
  ok('the guard within 30 m is told; the far one is not', said.some(([a, t]) => a === GUARD && /eat of the body/.test(t)) && !said.some(([a]) => a === FAR_GUARD));
  ok('the audit names it and the witness', audits.some((t) => /^PARTAKE P1 ate of the body .*seen by P5/.test(t)), audits);
  ok('the spent body is searched on the next E', act(BANDIT, ELF) === false);
  globalThis.__dboGreenPactDeath(OLD_BANDIT, MATE);
  ok('a fresh kill by a party member: partakes', act(OLD_BANDIT, ELF) === true);
  await wait(60);
  set(ELF, 'private.dboPartakeOff', true);
  globalThis.__dboGreenPactDeath(BANDIT, ELF);
  ok('a new death makes the body whole again, but /partake off searches it', props.get(BANDIT + '|private.dboPartaken') === false && act(BANDIT, ELF) === false);
  cmds.partake(ELF, 'on');
  ok('/partake on turns it back on', props.get(ELF + '|private.dboPartakeOff') === false && act(BANDIT, ELF) === true);
  await wait(60);

  // A player's body: consent
  const before = sated.length;
  set(STRANGER, 'isDead', true);
  ok('a fallen player is asked, not eaten', act(STRANGER, ELF) === true && /asks to eat of your body/.test(lastTo(STRANGER)) && sated.length === before);
  ok('asking again waits for the answer', act(STRANGER, ELF) === true && /has not answered/.test(lastTo(ELF)));
  cmds.partake(MATE, 'yes');
  ok('someone else saying yes allows nothing', /Nobody is asking/.test(lastTo(MATE)));
  cmds.partake(STRANGER, 'yes');
  await wait(60);
  ok('/partake yes from the fallen: the feed runs', sated.length === before + 1 && props.get(STRANGER + '|private.dboPartaken') === true);
  ok('the consent is audited', audits.some((t) => /P4 allowed P1/.test(t)));
  set(NORD_P, 'isDead', true);
  ok('a Nord cannot ask', act(NORD_P, MATE) === false);
  ok('the living are never asked', act(MATE, ELF) === false);

  console.log(fails ? `${fails} FAILED` : 'all checks passed');
  process.exit(fails ? 1 : 0);
})();
