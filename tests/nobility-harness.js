// The nobility (nobility.js, docs/nobility/DESIGN.md; Nate, 10 Oct): the real nobility-fiefs.json, nobility.js, economy.js
// and bank.js against stubs in a temp folder. Covers: off by default (no tab, no fief power, no tax share); which fief a
// reference stands in (interior cell, worldspace cell, neither); only the hold's ruler grants and revokes, never staff, a
// steward or the ruler's own account; titles gendered by the character (Baroness, Dame, Lady, Countess); one holder per fief
// and one title per character per hold; a changed title says what it was; estates named and filtered; the decrees' words;
// the fork's questions (holdsFiefAt, holderOf); the 25% fief share of the weekly tax into a deposit-only fief treasury, the
// hold keeping the rest and the tithe counting what it kept; the migration seed for Lord Elion applied once; Skyrim's Lord
// and Thane under a Jarl; Underarch Harbor, Solitude's eastern harbor (Nate, 16 Oct): where it starts and ends, and its
// holder styled Harbormaster; the Bruma fiefs unchanged by it; the tab's views; a deleted character's title lapsing; the
// pending patch note.
//
//   node tests/nobility-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NOB = path.join(ROOT, 'nobility.js');
const ECON = path.join(ROOT, 'economy.js');
const BANK = path.join(ROOT, 'bank.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-nobility-'));
fs.copyFileSync(path.join(ROOT, 'nobility-fiefs.json'), path.join(dir, 'nobility-fiefs.json'));
const FIEFS = JSON.parse(fs.readFileSync(path.join(dir, 'nobility-fiefs.json'), 'utf8')).fiefs;
process.chdir(dir);

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && got !== undefined ? `: got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

let now = Date.UTC(2026, 9, 11, 12, 0); // a Sunday
Date.now = () => now;

// ---- the world ----------------------------------------------------------------------------------------------------------
const HL = 'a764b:BSHeartland.esm';
const MW = FIEFS.find((f) => f.id === 'mountain-watch'), AW = FIEFS.find((f) => f.id === 'applewatch');
const COUNTESS = 0x14, ELION = 0x15, ELION_ALT = 0x19, STEWARD = 0x16, ADMIN = 0x10, DAME = 0x17, OUT = 0x18, JARL = 0x1a, GONE = 0x1b, HJARL = 0x1d;
const chars = new Map([
  [COUNTESS, { pid: 11, name: 'Narina Carvain', female: true, online: true }],
  [ELION, { pid: 49, name: 'Lord Elion', female: false, online: true }],
  [ELION_ALT, { pid: 49, name: 'Sera', female: true, online: false }],
  [STEWARD, { pid: 12, name: 'Aldo Varro', female: false, online: true }],
  [ADMIN, { pid: 1, name: 'Admin', female: false, online: true }],
  [DAME, { pid: 13, name: 'Kesta', female: true, online: true }],
  [OUT, { pid: 15, name: 'Outsider', female: false, online: true }],
  [JARL, { pid: 20, name: 'Laila', female: true, online: true }],
  [GONE, { pid: 21, name: 'Brief', female: false, online: false }],
  [HJARL, { pid: 22, name: 'Elisif', female: true, online: true }],
]);
const deleted = new Set();
// References: a Mountain Watch house door (its interior cell), its door outside (a worldspace cell of the town), a house in
// Applewatch, and one in Bruma city (no fief)
const MW_DOOR = 0x500, MW_OUT = 0x501, AW_DOOR = 0x502, BRUMA_DOOR = 0x503, MW_CHEST = 0x504;
const g = MW.grid[0];
const places = {
  [MW_DOOR]: [MW.cells[0], [0, 0, 0]], [MW_CHEST]: [MW.cells[0].toUpperCase().replace('BSHEARTLAND.ESM', 'BSHeartland.esm'), [10, 10, 0]],
  [MW_OUT]: [HL, [g[0] * 4096 + 100, g[1] * 4096 + 100, 0]],
  [AW_DOOR]: [HL, [AW.grid[0][0] * 4096 + 5, AW.grid[0][1] * 4096 + 5, 0]],
  [BRUMA_DOOR]: [HL, [57750, 202700, 0]],
};
// Solitude's harbor, at the doors' real positions (doors-pos.json): Tamriel is 3c:Skyrim.esm, the walled city SolitudeWorld
const TAM = '3c:skyrim.esm', SOLW = '37edf:skyrim.esm';
const UH = FIEFS.find((f) => f.id === 'underarch-harbor');
const harbor = {
  0x600: ['the docks inn\'s door', TAM, [-59744.62, 101446.84, -13649.57], true],
  0x601: ['the Ondiel warehouse door', TAM, [-61906.61, 102202.52, -13438.46], true],
  0x602: ['the docks smithy\'s door', TAM, [-55891.69, 106007.19, -13669.96], true],
  0x603: ['the Breakwater farm\'s door', TAM, [-53373.05, 114667.05, -13516.31], true],
  0x604: ['the Dainty Sload\'s door', TAM, [-51949.44, 122067.12, -13693.74], true],
  0x605: ['inside the docks smithy', 'dad3:DragonBreak.esp', [0, 0, 0], true],
  0x606: ['the East Empire Warehouse\'s door (the line: Solitude keeps it)', TAM, [-67169, 99878, -13749], false],
  0x607: ['the Red Wave, west harbor', TAM, [-66175.26, 94445.03, -13663.72], false],
  0x608: ['the docks barracks west of the warehouse', TAM, [-67882.09, 97525.12, -12790.03], false],
  0x609: ['Katla\'s Farm', TAM, [-75489.09, 96292.72, -11404.86], false],
  0x60a: ['the prison across the water', TAM, [-56850.52, 93913.97, -14010.26], false],
  0x60b: ['the Katariah, at anchor off the harbor', TAM, [-49224, 105932, -13592], false],
  0x60c: ['the Bank of Solitude, in the city above the same cells', SOLW, [-60312.5, 104131.85, -8216.74], false],
  0x60d: ['inside Beirand\'s smithy (a city interior)', '37ee0:skyrim.esm', [0, 0, 0], false],
  0x60e: ['inside the Red Wave (west harbor)', 'a1793:skyrim.esm', [0, 0, 0], false],
};
for (const [id, [, w, pos]] of Object.entries(harbor)) places[id] = [w, pos];
const props = new Map();
const mp = {
  get: (id, k) => {
    if (places[id]) { if (k === 'worldOrCellDesc') return places[id][0]; if (k === 'pos') return places[id][1]; if (k === 'type') return 'ObjectReference'; }
    const c = chars.get(id);
    if (c) {
      if (deleted.has(id)) throw new Error('no such form');
      if (k === 'type') return 'Actor';
      if (k === 'appearance') return { name: c.name, isFemale: c.female };
      if (k === 'profileId') return c.pid;
    }
    if (props.has(id + '|' + k)) return props.get(id + '|' + k);
    if (!c && !places[id] && k === 'type') throw new Error('no such form');
    return undefined;
  },
  set: (id, k, v) => props.set(id + '|' + k, v),
  getActorsByProfileId: (pid) => [...chars.entries()].filter(([, c]) => c.pid === pid).map(([id]) => id),
};
const zones = [
  { id: 'bruma', name: 'Bruma', treasury: '79b22:BSHeartland.esm', officials: ['count', 'steward', 'captain', 'courtmage', 'guard'] },
  { id: 'riften', name: 'The Rift', officials: ['jarl', 'steward', 'commander', 'courtmage', 'guardcaptain', 'guard'] },
  { id: 'solitude', name: 'Haafingar', officials: ['jarl', 'steward', 'commander', 'courtmage', 'guardcaptain', 'guard'] },
];
const zoneById = (id) => zones.find((z) => z.id === String(id)) || null;
let officials = { bruma: { count: [11], steward: [12] }, riften: { jarl: [20] }, solitude: { jarl: [22] } };
const ranksOf = (pid) => { const out = []; for (const z of zones) for (const r of z.officials) if (((officials[z.id] || {})[r] || []).includes(pid)) out.push({ zone: z, rank: r }); return out; };
const online = () => [...chars.entries()].filter(([id, c]) => c.online && !deleted.has(id)).map(([id]) => id);
const profileOf = (a) => (chars.get(a) || { pid: -1 }).pid;
const nameOf = (a) => (chars.get(a) || { name: 'Stranger' }).name;
const who = (a) => `${nameOf(a)} (profile ${profileOf(a)})`;
const officialTarget = (q) => {
  const hit = [...chars.entries()].filter(([id, c]) => !deleted.has(id) && (c.name.toLowerCase() === q.toLowerCase() || `#${id.toString(16)}` === q.toLowerCase()));
  if (!hit.length) return { error: `No character called ${q}.` };
  const [actor, c] = hit[0];
  return { pid: c.pid, actor, online: c.online ? actor : 0, label: c.name, who: who(actor) };
};

const announced = [], told = [], audits = [], logs = [];
const handlers = new Map(), timers = new Map(), commands = new Map();
const api = {
  mp, log: (...a) => logs.push(a.join(' ')), audit: (t) => audits.push(t), who, display: (a) => `${nameOf(a)} #T`, nameOf, tagOf: (a) => a.toString(16).toUpperCase(),
  onUi: (ev, f) => handlers.set(ev, f), onlineActors: online, profileOf, cfg: {}, zoneById, readOfficials: () => JSON.parse(JSON.stringify(officials)), ranksOf,
  accountActors: (pid) => mp.getActorsByProfileId(pid), officialTarget, every: (n, ms, f) => timers.set(n, f),
  personal: (a, t) => told.push({ a, t }), announce: (t) => announced.push(t), registerChatCommand: (n, f) => commands.set(n, f),
  isLeadStaff: (a) => a === ADMIN,
};
// The journal: every action answers at once, with the text it returned
const answers = [];
globalThis.__dboJournalFresh = (a, n) => n === 'N';
globalThis.__dboJournalLimited = (a, fn) => { answers.push(fn()); return true; };
globalThis.__dboCourtFaction = (zid) => (zid === 'bruma' ? 'county-bruma' : zid === 'riften' ? 'hold-riften' : null);
globalThis.__dboGuildsOf = (a) => (a === JARL ? [{ id: 'hold-riften', role: 'leader' }] : []);

let nob;
const load = (cfg) => { api.cfg = cfg; handlers.clear(); delete require.cache[NOB]; nob = require(NOB)(api); };
const SEC0 = () => globalThis.__dboJournalSections.nobility;
const ui = (ev, a, ...args) => { answers.length = 0; handlers.get(ev)(a, ['N', ...args]); return answers[0] || {}; };

// ---- off by default -------------------------------------------------------------------------------------------------------
load({});
ok('off by default: no Nobility tab', !(globalThis.__dboJournalSections || {}).nobility);
ok('off: the fork is told of no fief and no holder', globalThis.__dboNobility.fiefOf([MW_DOOR]) === '' && globalThis.__dboNobility.holdsFiefAt(ELION, [MW_DOOR]) === false && globalThis.__dboNobility.holderOf('mountain-watch') === null);
ok('off: no tax share', globalThis.__dboNobilityFiefCut(MW_DOOR, { partner: MW_OUT }, 100) === null);
answers.length = 0; handlers.get('nobilityGrant')(COUNTESS, ['N', 'bruma', 'Lord Elion', 'baron', 'mountain-watch']);
ok('off: a grant does nothing', answers.length === 0 && !fs.existsSync('nobility.json'));

load({ nobility: { enabled: true, realms: { bruma: 'cyrodiil' }, seed: [{ fief: 'mountain-watch', title: 'baron', profile: 49, name: 'Elion' }] } });
ok('on: the tab is registered as Nobility', !!globalThis.__dboJournalSections.nobility && globalThis.__dboJournalSections.nobility.label() === 'Nobility');

// ---- where a fief is ----------------------------------------------------------------------------------------------------
const N = globalThis.__dboNobility;
ok('the fiefs are the four towns of the Bruma lock (Greenwood since Nate\'s go), all Bruma\'s, and Underarch Harbor, Haafingar\'s',
  FIEFS.map((f) => f.id).sort().join() === 'aleswell,applewatch,greenwood,mountain-watch,underarch-harbor'
  && FIEFS.filter((f) => f.id !== 'underarch-harbor').every((f) => f.hold === 'bruma') && FIEFS.every((f) => f.cells.length && f.grid.length) && UH.hold === 'solitude');
// The Bruma fiefs exactly as they were before Underarch Harbor was added (sha1 of each entry's compact JSON)
const BEFORE = {"applewatch": "78f8195397e4e41ef90f0c501d023613f2dfce3c", "aleswell": "2c0142e282c1a4bdbd0c0cab250ef0fecae8eda6", "mountain-watch": "a7724e015f30c3da39d43437a804e4f39fa9f957", "greenwood": "04bc8b82c444cf84dbd371ece8c0bdd605b1ed05"};
for (const [id, sha] of Object.entries(BEFORE)) {
  const f = FIEFS.find((x) => x.id === id);
  ok(`${id} is unchanged by the harbor`, !!f && crypto.createHash('sha1').update(JSON.stringify(f)).digest('hex') === sha);
}
ok('Underarch Harbor lies in Tamriel, outside the city\'s own worldspace', UH.world.toLowerCase() === TAM && UH.cells.every((c) => !/^37edf:/i.test(c)));
ok('no exterior cell or interior belongs to two fiefs', (() => { const seen = new Set(); for (const f of FIEFS) for (const k of f.grid.map((g) => `${f.world.toLowerCase()}|${g}`).concat(f.cells.map((c) => c.toLowerCase()))) { if (seen.has(k)) return false; seen.add(k); } return true; })());
ok('Solitude keeps the East Empire Warehouse\'s cell column (x -17) and everything west of it', UH.grid.every((g) => g[0] >= -16));
for (const [id, [label, , , inside]] of Object.entries(harbor)) ok(`${label} is ${inside ? '' : 'not '}in Underarch Harbor`, N.fiefOf([Number(id)]) === (inside ? 'underarch-harbor' : ''), N.fiefOf([Number(id)]));
ok('a house door inside Mountain Watch\'s interiors is in the fief', N.fiefOf([MW_DOOR]) === 'mountain-watch');
ok('a chest in the same interior, its desc in another case, too', N.fiefOf([MW_CHEST]) === 'mountain-watch');
ok('a door outside in the town\'s worldspace cells is in it', N.fiefOf([MW_OUT]) === 'mountain-watch');
ok('Applewatch is its own fief', N.fiefOf([AW_DOOR]) === 'applewatch');
ok('Bruma city is no fief', N.fiefOf([BRUMA_DOOR]) === '');
ok('the first reference that stands in a fief answers', N.fiefOf([BRUMA_DOOR, MW_OUT]) === 'mountain-watch');

// ---- the migration seed waits for the switch's minute tick ---------------------------------------------------------------
ok('nothing granted before the seed runs', N.holderOf('mountain-watch') === null);
timers.get('nobilitySeed')();
const seeded = N.holderOf('mountain-watch');
ok('the seed names Lord Elion (the account\'s character carrying "Elion", not Sera) Baron of Mountain Watch', !!seeded && seeded.actor === ELION && seeded.profile === 49, seeded);
ok('announced in the words of a decree, by the Countess', announced[0] === 'By decree of the Countess of Bruma, Lord Elion is named Baron of Mountain Watch.', announced);
ok('audited as the migration', audits.some((t) => /^NOBILITY migration: .*Lord Elion.* Baron of Mountain Watch \(Bruma\)/.test(t)), audits);
timers.get('nobilitySeed')();
ok('a seed is applied once', announced.length === 1 && Object.keys(JSON.parse(fs.readFileSync('nobility.json', 'utf8')).seeded).length === 1);
ok('the holder has the fief\'s powers at its doors and chests', N.holdsFiefAt(ELION, [MW_DOOR]) && N.holdsFiefAt(ELION, [MW_CHEST]) && N.holdsFiefAt(ELION, [BRUMA_DOOR, MW_OUT]));
ok('and none elsewhere, nor does anyone else at his', !N.holdsFiefAt(ELION, [AW_DOOR]) && !N.holdsFiefAt(ELION, [BRUMA_DOOR]) && !N.holdsFiefAt(ELION_ALT, [MW_DOOR]) && !N.holdsFiefAt(COUNTESS, [MW_DOOR]));

// ---- only the ruler grants -----------------------------------------------------------------------------------------------
ok('a steward cannot grant', /Only the Count or Countess of Bruma/.test(ui('nobilityGrant', STEWARD, 'bruma', 'Kesta', 'knight').text));
ok('staff cannot grant either (Nate: only the ruler)', /Only the Count or Countess/.test(ui('nobilityGrant', ADMIN, 'bruma', 'Kesta', 'knight').text));
ok('a stale nonce does nothing', (() => { answers.length = 0; handlers.get('nobilityGrant')(COUNTESS, ['old', 'bruma', 'Kesta', 'knight']); return answers.length === 0; })());
ok('a profile id is refused: titles go to a character', /Name the character/.test(ui('nobilityGrant', COUNTESS, 'bruma', '13', 'knight').text));
chars.set(0x1c, { pid: 11, name: 'Tarquin', female: false, online: false });
ok('the ruler cannot title a character of her own account', /No ruler raises their own house/.test(ui('nobilityGrant', COUNTESS, 'bruma', 'Tarquin', 'knight').text));
ok('an unknown title is refused, listing the county\'s', /Baron\/Baroness, Lord\/Lady, Knight\/Dame/.test(ui('nobilityGrant', COUNTESS, 'bruma', 'Kesta', 'thane').text));
ok('a fief title needs a fief of this hold', /Choose one of the fiefs of Bruma/.test(ui('nobilityGrant', COUNTESS, 'bruma', 'Kesta', 'baron', 'riverwood').text));
ok('a fief has one holder', /Mountain Watch is held by Lord Elion/.test(ui('nobilityGrant', COUNTESS, 'bruma', 'Kesta', 'baron', 'mountain-watch').text));

// bank.js's gem fee (Nat, 25 Oct): a flawless gem from the ruler for every grant or change, into the hold's counter
const gemsOf = new Map([[COUNTESS, 0]]); const gemTaken = [];
const GEM_FEE = globalThis.__dboGemFee = {
  need: (a, n) => ((gemsOf.has(a) ? gemsOf.get(a) : 99) >= n ? '' : `It also costs ${n} flawless gem of any kind, carried (you carry ${gemsOf.get(a)}).`),
  take: (a, n, zoneId) => { const has = gemsOf.has(a) ? gemsOf.get(a) : 99; if (has < n) return false; gemsOf.set(a, has - n); gemTaken.push({ a, n, zoneId }); return true; },
};
announced.length = 0;
ok('a title costs the ruler a flawless gem: none carried, none granted', /A title costs the crown a flawless gem\. It also costs 1 flawless gem/.test(ui('nobilityGrant', COUNTESS, 'bruma', 'Kesta', 'knight').text) && announced.length === 0);
gemsOf.set(COUNTESS, 1);
announced.length = 0;
const r1 = ui('nobilityGrant', COUNTESS, 'bruma', 'Kesta', 'knight');
ok('...with one, granted, and the gem goes to the Bruma counter', gemsOf.get(COUNTESS) === 0 && gemTaken.length === 1 && gemTaken[0].zoneId === 'bruma');
gemsOf.delete(COUNTESS);
ok('a woman is made a Dame, of the county', r1.kind === 'ok' && announced[0] === 'By decree of the Countess of Bruma, Kesta is made a Dame of Bruma.', [r1, announced]);
ok('she is told', told.some((x) => x.a === DAME && /Dame of Bruma/.test(x.t)));
ok('the same title again is refused', /already Dame of Bruma/.test(ui('nobilityGrant', COUNTESS, 'bruma', 'Kesta', 'knight').text));
announced.length = 0;
ui('nobilityGrant', COUNTESS, 'bruma', 'Kesta', 'baron', 'applewatch');
ok('a change replaces her title and says what it was', announced[0] === 'By decree of the Countess of Bruma, Kesta is named Baroness of Applewatch, formerly Dame of Bruma.', announced);
ok('one title per character per hold', JSON.parse(fs.readFileSync('nobility.json', 'utf8')).nobles.filter((n) => n.actor === DAME).length === 1);
ok('an estate needs a fitting name', /2 to 40 letters/.test(ui('nobilityGrant', COUNTESS, 'bruma', 'Outsider', 'lord', 'x').text) && /2 to 40 letters/.test(ui('nobilityGrant', COUNTESS, 'bruma', 'Outsider', 'lord', 'Hall<script>').text));
globalThis.__dboProseProblem = (s) => (/badword/i.test(s) ? 'Badword' : null);
ok('and passes the prose filter', /"Badword" will not do/.test(ui('nobilityGrant', COUNTESS, 'bruma', 'Outsider', 'lord', 'Badword Hall').text));
announced.length = 0;
ui('nobilityGrant', COUNTESS, 'bruma', 'Outsider', 'lord', '  Jerall   View ');
ok('a Lord of an estate, its name tidied', announced[0] === 'By decree of the Countess of Bruma, Outsider is named Lord of Jerall View.', announced);
ok('an estate is no fief', N.holderOf('applewatch').actor === DAME && !N.holdsFiefAt(OUT, [AW_DOOR]));

// ---- revoking ----------------------------------------------------------------------------------------------------------------
announced.length = 0;
ok('a steward cannot revoke', /Only the Count or Countess/.test(ui('nobilityRevoke', STEWARD, 'bruma', DAME.toString(16)).text));
const rv = ui('nobilityRevoke', COUNTESS, 'bruma', DAME.toString(16));
ok('the ruler revokes, announced as a decree', rv.kind === 'ok' && announced[0] === 'By decree of the Countess of Bruma, Kesta is no longer Baroness of Applewatch.', [rv, announced]);
ok('the fief is vacant again', N.holderOf('applewatch') === null && !N.holdsFiefAt(DAME, [AW_DOOR]));
ok('revoking someone with no title here is refused', /holds no title here/.test(ui('nobilityRevoke', COUNTESS, 'bruma', DAME.toString(16)).text));
ok('every change is audited', audits.filter((t) => /^NOBILITY /.test(t)).length === 5, audits.filter((t) => /^NOBILITY /.test(t)));

// ---- a Lead GM's emergency revoke (Nate, 10 Oct: revoke only, announced plainly) ------------------------------------
ui('nobilityGrant', COUNTESS, 'bruma', 'Kesta', 'knight');
announced.length = 0;
ok('a Lead GM still cannot grant', /Only the Count or Countess/.test(ui('nobilityGrant', ADMIN, 'bruma', 'Outsider', 'knight').text));
ok('a GM below Lead cannot revoke', /Only the Count or Countess/.test(ui('nobilityRevoke', STEWARD, 'bruma', DAME.toString(16)).text));
const sv = ui('nobilityRevoke', ADMIN, 'bruma', DAME.toString(16));
ok('a Lead GM revokes in an emergency, announced as the staff\'s act, not a decree', sv.kind === 'ok' && announced[0] === 'A title was revoked by the staff: Kesta is no longer Dame of Bruma.', [sv, announced]);
ok('...audited as STAFF', audits.some((t) => /^NOBILITY STAFF Admin \(profile 1\): revoked Kesta/.test(t)));
ok('...and the staff view offers Revoke but no titles to grant', (() => { const h = globalThis.__dboJournalSections.nobility.view(ADMIN).holds.find((x) => x.id === 'bruma'); return h.canRevoke && !h.isRuler && h.titles.length === 0; })());

// ---- a Count, and the hold faction's leader ----------------------------------------------------------------------------
chars.get(COUNTESS).female = false;
announced.length = 0;
ui('nobilityGrant', COUNTESS, 'bruma', 'Kesta', 'knight');
ok('a man rules as Count', announced[0] === 'By decree of the Count of Bruma, Kesta is made a Dame of Bruma.', announced);
chars.get(COUNTESS).female = true;
officials = { bruma: { steward: [12] }, riften: {} };
globalThis.__dboGuildsOf = (a) => (a === JARL ? [{ id: 'hold-riften', role: 'leader' }] : a === STEWARD ? [{ id: 'county-bruma', role: 'leader' }] : []);
ok('the hold faction\'s leader rules too, without the office', ui('nobilityGrant', STEWARD, 'bruma', 'Outsider', 'knight').kind === 'ok');
officials = { bruma: { count: [11], steward: [12] }, riften: { jarl: [20] }, solitude: { jarl: [22] } };
globalThis.__dboGuildsOf = (a) => (a === JARL ? [{ id: 'hold-riften', role: 'leader' }] : []);

// ---- Skyrim -----------------------------------------------------------------------------------------------------------------
announced.length = 0;
ok('a Skyrim hold grants Lord and Thane', /Lord\/Lady, Thane/.test(ui('nobilityGrant', JARL, 'riften', 'Kesta', 'baron').text));
ui('nobilityGrant', JARL, 'riften', 'Kesta', 'thane');
ok('a Thane is named by the Jarl of the Rift', announced[0] === 'By decree of the Jarl of the Rift, Kesta is named Thane of the Rift.', announced);
ok('a title in another hold is a second title', JSON.parse(fs.readFileSync('nobility.json', 'utf8')).nobles.filter((n) => n.actor === DAME).length === 2);
ok('the Jarl has no say in Bruma', /Only the Count or Countess/.test(ui('nobilityGrant', JARL, 'bruma', 'Kesta', 'knight').text));

// ---- Underarch Harbor: a Harbormaster, with a Lord's powers (Nate, 16 Oct) ------------------------------------------------
ok('the Jarl of the Rift cannot grant Haafingar\'s harbor', /Only the Jarl of Haafingar/.test(ui('nobilityGrant', JARL, 'solitude', 'Outsider', 'lord', 'underarch-harbor').text));
ok('Haafingar grants no Bruma fief', /Choose one of the fiefs of Haafingar/.test(ui('nobilityGrant', HJARL, 'solitude', 'Outsider', 'lord', 'applewatch').text));
announced.length = 0;
const hm = ui('nobilityGrant', HJARL, 'solitude', 'Kesta', 'lord', 'underarch-harbor');
ok('a woman granted the harbor is its Harbormaster, by the Jarl\'s decree', hm.kind === 'ok' && hm.text === 'Kesta is now Harbormaster of Underarch Harbor.'
  && announced[0] === 'By decree of the Jarl of Haafingar, Kesta is named Harbormaster of Underarch Harbor.', [hm, announced]);
ok('she holds the harbor\'s buildings and none of Solitude\'s', N.holdsFiefAt(DAME, [0x600]) && N.holdsFiefAt(DAME, [0x605]) && !N.holdsFiefAt(DAME, [0x606]) && !N.holdsFiefAt(DAME, [0x60c]) && N.holderOf('underarch-harbor').actor === DAME);
announced.length = 0;
ui('nobilityRevoke', HJARL, 'solitude', DAME.toString(16));
ok('revoked in the same style', announced[0] === 'By decree of the Jarl of Haafingar, Kesta is no longer Harbormaster of Underarch Harbor.', announced);
announced.length = 0;
ui('nobilityGrant', HJARL, 'solitude', 'Outsider', 'lord', 'underarch-harbor');
ok('a man is Harbormaster too', announced[0] === 'By decree of the Jarl of Haafingar, Outsider is named Harbormaster of Underarch Harbor.', announced);
ok('the roll and his own view say Harbormaster', SEC0().view(OUT).holds.find((h) => h.id === 'solitude').roll.map((n) => n.label).join() === 'Harbormaster of Underarch Harbor'
  && SEC0().view(OUT).mine.some((m) => m.hold === 'solitude' && m.label === 'Harbormaster of Underarch Harbor' && m.fief.id === 'underarch-harbor'));
ok('the harbor pays a quarter of its tax to its own treasury', JSON.stringify(globalThis.__dboNobilityFiefCut(0x602, { partner: 0 }, 100)) === JSON.stringify({ id: 'underarch-harbor', name: 'Underarch Harbor', share: 25 }));
ok('the Jarl\'s titles stay Lord and Thane: the style follows the fief', SEC0().view(HJARL).holds.find((h) => h.id === 'solitude').titles.map((t) => t.label).join() === 'Lord / Lady,Thane');
ok('fiefTitles in the config replaces the default', (() => { load({ nobility: { enabled: true, fiefTitles: { 'underarch-harbor': { m: 'Reeve', f: 'Reeve' } } } }); const l = SEC0().view(OUT).mine.find((m) => m.hold === 'solitude').label; load({ nobility: { enabled: true, realms: { bruma: 'cyrodiil' } } }); return l === 'Reeve of Underarch Harbor'; })());
ok('the Bruma Barons keep their style', nob.labelOf({ hold: 'bruma', title: 'baron', fief: 'mountain-watch', actor: ELION }) === 'Baron of Mountain Watch');

// ---- the tab (bank.js gives the fief treasuries) ---
delete require.cache[BANK];
const bankHandlers = new Map();
require(BANK)({ mp, log: () => {}, personal: () => {}, audit: (t) => audits.push(t), who, cfg: {}, openWidget: () => {}, closeWidget: () => {}, onUi: (e, f) => bankHandlers.set(e, f),
  registerChatCommand: () => {}, takeGold: () => 0, giveItem: () => {}, goldOf: () => 0, depositToTreasury: () => 0, zoneById, zoneList: () => zones, zoneOfActor: () => null,
  ranksOf, profileOf, distanceMeters: () => 0, every: () => {} });
globalThis.__dboHousing = {
  primaryOf: (r) => r, isBuilding: () => true, doorName: (r) => (r === MW_DOOR ? 'Zurikki\'s House' : ''),
  recordOf: (r) => ({ [MW_DOOR]: { owner: 49, ownerName: 'Lord Elion', partner: MW_OUT, name: null }, [AW_DOOR]: { owner: 13, ownerName: 'Kesta', partner: 0, name: 'Orchard' }, [BRUMA_DOOR]: { owner: 15, ownerName: 'Outsider', partner: 0 } }[r] || null),
};
fs.writeFileSync('housing.json', JSON.stringify([MW_DOOR, AW_DOOR, BRUMA_DOOR]));
const SEC = globalThis.__dboJournalSections.nobility;
const vOut = SEC.view(OUT), vC = SEC.view(COUNTESS), vE = SEC.view(ELION);
const brumaOf = (v) => v.holds.find((h) => h.id === 'bruma');
ok('everyone sees the roll', SEC.visible(OUT) === true && brumaOf(vOut).roll.map((n) => n.label).join('|') === 'Baron of Mountain Watch|Dame of Bruma|Knight of Bruma', brumaOf(vOut).roll.map((n) => n.label));
ok('and the fiefs with their holders, but no treasury and no titles to grant', brumaOf(vOut).fiefs.length === 4 && brumaOf(vOut).fiefs.every((f) => f.treasury === null) && brumaOf(vOut).titles.length === 0 && !brumaOf(vOut).isRuler);
ok('the ruler sees every fief treasury and the titles she grants', brumaOf(vC).isRuler && brumaOf(vC).titles.map((t) => `${t.id}:${t.needs}`).join() === 'baron:fief,lord:estate,knight:' && brumaOf(vC).fiefs.every((f) => f.treasury === 0));
ok('the ruler is named with her style', brumaOf(vOut).ruler.name === 'Narina Carvain' && brumaOf(vOut).ruler.style === 'Countess of Bruma', brumaOf(vOut).ruler);
const mine = vE.mine[0];
ok('a noble sees his title, fief, its properties and its treasury', mine && mine.label === 'Baron of Mountain Watch' && mine.fief.id === 'mountain-watch' && mine.fief.treasury === 0
  && mine.fief.properties.length === 1 && mine.fief.properties[0].name === 'Zurikki\'s House' && mine.fief.properties[0].owner === 'Lord Elion', mine);
ok('the holder sees his own fief\'s treasury only', brumaOf(vE).fiefs.filter((f) => f.treasury !== null).map((f) => f.id).join() === 'mountain-watch');
ok('the ruler of Bruma opens on Bruma; the Jarl rules the Rift there and not Bruma', vC.selected === 'bruma' && SEC.view(JARL).holds.find((h) => h.id === 'riften').isRuler && !brumaOf(SEC.view(JARL)).isRuler);
ok('a hold with titles shows its roll to everyone', vOut.holds.find((h) => h.id === 'riften').roll.map((n) => n.label).join() === 'Thane of the Rift');
// A ruler's own hold with no fiefs or nobles yet (Jarl of Falkreath, #bugs 22 Oct), and only a ruler's (review R3, 23 Oct):
// Solstheim has only guards and a stronghold's first office is its chieftain, neither of whom grants titles (DESIGN.md 4)
const EXTRA_ZONES = [
  { id: 'falkreath', name: 'Falkreath Hold', officials: ['jarl', 'steward', 'commander', 'courtmage', 'guardcaptain', 'guard'] },
  { id: 'solstheim', name: 'Solstheim', officials: ['guard'] },
  { id: 'dushnikh', name: 'Dushnikh Yal', officials: ['chieftain', 'shaman'] },
];
const FJARL = 0x30, FSTEW = 0x31, SGUARD = 0x32, CHIEF = 0x33;
zones.push(...EXTRA_ZONES);
Object.assign(officials, { falkreath: { jarl: [30], steward: [31] }, solstheim: { guard: [32] }, dushnikh: { chieftain: [33] } });
for (const [id, pid, n] of [[FJARL, 30, 'Siddgeir'], [FSTEW, 31, 'Nenya'], [SGUARD, 32, 'Gjalund'], [CHIEF, 33, 'Burguk']]) chars.set(id, { pid, name: n, female: false, online: true });
const holdOf = (a, zid) => SEC.view(a).holds.find((h) => h.id === zid);
ok('the Jarl of Falkreath sees his hold, with no fiefs or nobles yet, as its ruler', !!holdOf(FJARL, 'falkreath') && holdOf(FJARL, 'falkreath').isRuler, SEC.view(FJARL).holds.map((h) => h.id));
ok('...but his Steward and everyone else do not', !holdOf(FSTEW, 'falkreath') && !holdOf(OUT, 'falkreath'));
ok('a guard of Solstheim (its only office) is not shown Solstheim as a hold he rules', !holdOf(SGUARD, 'solstheim'), holdOf(SGUARD, 'solstheim'));
ok('nor an orc chieftain his stronghold', !holdOf(CHIEF, 'dushnikh'), holdOf(CHIEF, 'dushnikh'));
zones.splice(zones.length - EXTRA_ZONES.length, EXTRA_ZONES.length);
for (const z of EXTRA_ZONES) delete officials[z.id];
for (const id of [FJARL, FSTEW, SGUARD, CHIEF]) chars.delete(id);

// ---- the tax share ------------------------------------------------------------------------------------------------------------
const FT = globalThis.__dboFiefTreasury;
ok('a fief treasury takes deposits and has no way to take gold out', FT.deposit('aleswell', 7, 'test') && FT.balance('aleswell') === 7 && Object.keys(FT).sort().join() === 'balance,deposit');
ok('a bad fief id or amount is refused', !FT.deposit('../x', 5) && !FT.deposit('aleswell', 0) && FT.balance('aleswell') === 7);
ok('the cut is a quarter of a fief building\'s tax', JSON.stringify(globalThis.__dboNobilityFiefCut(MW_DOOR, { partner: MW_OUT }, 100)) === JSON.stringify({ id: 'mountain-watch', name: 'Mountain Watch', share: 25 }));
ok('none outside a fief', globalThis.__dboNobilityFiefCut(BRUMA_DOOR, { partner: 0 }, 100) === null);

// economy.js: one Mountain Watch house and one Bruma house, both at 20% of 1000; Cyrodiil land pays the 10% tithe
const treas = { 'county-bruma': 0, 'imperial-legion': 0 };
globalThis.__dboTreasury = {
  keyOf: (f) => f, balance: (f) => treas[f] || 0,
  spend: (f, n) => { if ((treas[f] || 0) < n) return false; treas[f] -= n; return true; },
  deposit: (f, n) => { treas[f] = (treas[f] || 0) + n; return true; },
};
globalThis.__dboRealmTerritoryAt = () => ({ id: 'bruma', name: 'Bruma', marker: { world: HL } });
globalThis.__dboRealmOwnerOf = () => 'county-bruma';
globalThis.__dboRegions = { placeOf: () => ({ province: 'cyrodiil' }) };
globalThis.__dboGuildInfo = (f) => ({ 'county-bruma': { id: f, name: 'County of Bruma', kind: 'hold', zone: 'bruma' }, 'imperial-legion': { id: f, name: 'Imperial Legion', kind: 'faction' } }[f] || null);
globalThis.__dboHousing.recordOf = (r) => ({ [MW_DOOR]: { owner: 49, ownerName: 'Lord Elion', partner: MW_OUT }, [BRUMA_DOOR]: { owner: 15, ownerName: 'Outsider', partner: 0 } }[r] || null);
fs.writeFileSync('housing.json', JSON.stringify([MW_DOOR, BRUMA_DOOR]));
fs.writeFileSync('economy.json', JSON.stringify({ rates: { 'county-bruma': 0.2 }, values: { [MW_DOOR]: 1000, [BRUMA_DOOR]: 1000 }, lastReckoning: 1 }));
mp.set(ELION, 'private.bankGold', 1000); mp.set(OUT, 'private.bankGold', 1000);
delete require.cache[ECON];
const econ = require(ECON)({ mp, log: () => {}, personal: () => {}, audit: (t) => audits.push(t), who, cfg: { economy: { enabled: true } }, onUi: () => {}, onlineActors: online,
  every: () => {}, readOfficials: () => ({}), zoneById });
const reports = econ.reckon();
ok('each house pays its 200 gold tax', mp.get(ELION, 'private.bankGold') === 800 && mp.get(OUT, 'private.bankGold') === 800);
ok('the fief\'s treasury gets a quarter of the Mountain Watch tax', FT.balance('mountain-watch') === 50, FT.balance('mountain-watch'));
ok('the hold keeps the rest of it and all of Bruma city\'s, less the tithe on what it kept', reports['county-bruma'].income === 350 && reports['county-bruma'].fiefShares === 50 && treas['imperial-legion'] === 35 && treas['county-bruma'] === 315,
  [reports['county-bruma'], treas]);
ok('the fief treasury balance shows in the noble\'s tab', SEC.view(ELION).mine[0].fief.treasury === 50);
const notice = audits.find((t) => /BANK fief treasury of mountain-watch received 50/.test(t));
ok('the deposit is audited', !!notice, audits.slice(-6));

// ---- a Baron assesses property in his own fief only (Nate, 10 Oct), through the court's own path ----------------------
const econUi = new Map();
delete require.cache[ECON];
require(ECON)({ mp, log: () => {}, personal: () => {}, audit: (t) => audits.push(t), who, cfg: { economy: { enabled: true } }, onUi: (e, f) => econUi.set(e, f), onlineActors: online,
  every: () => {}, readOfficials: () => ({}), zoneById });
const econReplies = [];
globalThis.__dboFactionNonceOk = () => true;
globalThis.__dboFactionRefresh = (a, text, ok) => { econReplies.push({ text, ok }); return true; };
globalThis.__dboHousing.primaryOf = (r) => r;
globalThis.__dboHousing.isManager = (a) => a === STEWARD;
globalThis.__dboHousing.isFiefHolder = (a, r) => globalThis.__dboNobility.holdsFiefAt(a, [r]);
econUi.get('econValue')(ELION, ['n', MW_DOOR, 1500]);
ok('the Baron assesses a building of his fief', econReplies[0] && econReplies[0].ok && JSON.parse(fs.readFileSync('economy.json', 'utf8')).values[String(MW_DOOR)] === 1500, econReplies);
ok('...audited as a fief holder\'s', audits.some((t) => /^ECONOMY Lord Elion \(profile 49\) \(fief holder\) assessed property 500 at 1500/.test(t)));
econReplies.length = 0;
econUi.get('econValue')(ELION, ['n', BRUMA_DOOR, 1500]);
ok('...but not one outside it', econReplies[0] && !econReplies[0].ok && /Only the officials/.test(econReplies[0].text), econReplies);

// ---- a deleted character's title lapses -------------------------------------------------------------------------------------
announced.length = 0;
// bank.js, loaded for the fief treasury, put the real gem fee in place: the mock again
globalThis.__dboGemFee = GEM_FEE;
const rGone = ui('nobilityGrant', COUNTESS, 'bruma', 'Brief', 'baron', 'aleswell');
ok('granted to a character offline', N.holderOf('aleswell') && N.holderOf('aleswell').actor === GONE, rGone);
deleted.add(GONE);
ok('once the character is deleted the fief is vacant and the roll forgets him', N.holderOf('aleswell') === null && !brumaOf(SEC.view(OUT)).roll.some((n) => n.name === 'Brief'));

// ---- a hot reload keeps the titles -------------------------------------------------------------------------------------------
load({ nobility: { enabled: true } });
ok('a reload keeps the titles', globalThis.__dboNobility.holderOf('mountain-watch').actor === ELION);
load({ nobility: { enabled: false } });
ok('switched off again: the tab goes and the fork is told nothing', !globalThis.__dboJournalSections.nobility && globalThis.__dboNobility.holdsFiefAt(ELION, [MW_DOOR]) === false);

// ---- the patch note ships with the switch (release 1012) ------------------------------------------------------------------------
const pending = path.join(ROOT, 'docs', 'patch-notes-pending', 'nobility.json');
ok('the pending copy is gone', !fs.existsSync(pending));
const live = JSON.parse(fs.readFileSync(path.join(ROOT, 'patch-notes.json'), 'utf8'));
// The 12 Oct notes ship as one combined entry (Nate: the update all together on the launcher): the nobility part is a section
const note = live.find((n) => n.title === 'The nobility of Bruma') || (() => { const u = live.find((n) => (n.sections || []).some((s) => s.heading === 'The nobility of Bruma')); return u ? Object.assign({}, u, { version: 'Server update' }) : null; })();
ok('the note is in the live patch notes, dated, a Server update, with the Barons and Elion', !!note && /^\d{4}-\d{2}-\d{2}$/.test(note.date) && note.version === 'Server update' && /Baron/.test(JSON.stringify(note)) && /Elion/.test(JSON.stringify(note)), note && note.date);
const gcfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
ok('gamemode-config ships it on (release 1012), with Elion\'s seed and without the interim uncapped 49', gcfg.nobility && gcfg.nobility.enabled === true && !((gcfg.housingPlaces || {}).uncappedProfiles || []).includes(49) && gcfg.nobility.fiefShare === 0.25 && gcfg.nobility.seed[0].fief === 'mountain-watch');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
