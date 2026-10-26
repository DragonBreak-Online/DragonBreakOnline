// The home Study Bookshelf (decor.js piece DBOStudyBookshelf; Nat via the Leader, 25 Oct) in schools.js: one shelf is both
// a Study Magic and a Priest Studies spot. A character with a school still learning at the shelves studies magic there,
// anyone else Priest Studies; study.homeRate / priestStudy.homeRate scale what a home shelf pays against a library's
// (1 by default: a home study is convenience, never extra study). decor.js decides first whether the home has enough
// shelves to be a study (tests/decor-growing-harness.js); this harness starts where schools.js is asked.
// Setup from tests/priest-study-units-harness.js. No server and no game:
//
//   node tests/home-study-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const SPELLS = path.join(SERVER, 'spells.js');
const SCHOOLS = path.join(SERVER, 'schools.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-study-'));
process.chdir(dir);
for (const f of ['skills.json', 'spell-tomes.json']) fs.copyFileSync(path.join(SERVER, f), f);
const CONFIG = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));
let wallClock = Date.parse('2026-10-25T18:00:00Z');
Date.now = () => wallClock;
const MIN = 60000;
const advance = (ms) => { wallClock += ms; };
const PLUGINS = { 'Skyrim.esm': 0x00, 'BSAssets.esm': 0x0a, 'BSHeartland.esm': 0x0b, 'DragonBreak Online Edits.esp': 0x60 };
const BY_INDEX = Object.fromEntries(Object.entries(PLUGINS).map(([k, v]) => [v, k]));
const idOf = (d) => { const [hex, plugin] = String(d).split(':'); if (!(plugin in PLUGINS)) throw new Error(`no plugin ${plugin}`); return ((PLUGINS[plugin] << 24) | parseInt(hex, 16)) >>> 0; };
const descOf = (id) => { const p = BY_INDEX[id >>> 24]; if (!p) throw new Error('no plugin'); return `${(id & 0xffffff).toString(16)}:${p}`; };
// A home (a made-up interior), its shelf (made-up ids: the merged DLE's are filled in later), and a library's StudyMagic box
const HOME = 'abcd0:Skyrim.esm', LIBRARY = '20ff:BSHeartland.esm';
const SHELF_BASE = '1d2240:DragonBreak Online Edits.esp', SHELF = idOf('1d2300:DragonBreak Online Edits.esp'); // verify-formids: ignore (made-up DLE ids)
const STUDY_BASE = '1636c2:DragonBreak Online Edits.esp', STUDYBOX = idOf('1d2301:DragonBreak Online Edits.esp'); // verify-formids: ignore (made-up DLE ids)
const HEAL = idOf('12fcc:Skyrim.esm');
const RECORDS = {
  [idOf(SHELF_BASE)]: { type: 'ACTI', editorId: 'DBOStudyBookshelf', fields: [] },
  [idOf(STUDY_BASE)]: { type: 'ACTI', editorId: 'StudyMagic', fields: [] },
};
const props = new Map();
const put = (id, p, v) => props.set(id + '|' + p, v);
const at = (id, cell, pos) => { put(id, 'worldOrCellDesc', cell); put(id, 'pos', pos || [0, 0, 0]); };
put(SHELF, 'baseDesc', SHELF_BASE); at(SHELF, HOME);
put(STUDYBOX, 'baseDesc', STUDY_BASE); at(STUDYBOX, LIBRARY);
const MAGE = 0x41, PRIEST = 0x42, MAGE2 = 0x43;
const NAMES = { [MAGE]: 'Mage', [PRIEST]: 'Priest', [MAGE2]: 'Mage2' };
const mastery = (a, skill, level) => {
  const r = props.get(a + '|private.mastery') || { v: 2, skills: {}, order: [] };
  r.skills[skill] = { level, xp: 0, rank: level >= 25 ? 1 : 0 };
  if (!r.order.includes(skill)) r.order.push(skill);
  put(a, 'private.mastery', r);
};
const school = (a, name, level) => put(a, 'private.dboSchools', { v: 1, primary: name, levels: { [name]: { level, xp: 0 } }, picks: {} });
for (const a of [MAGE, PRIEST, MAGE2]) { at(a, HOME); put(a, 'profileId', a); }
mastery(MAGE, 'arcane', 30); school(MAGE, 'Destruction', 10);
mastery(MAGE2, 'arcane', 30); school(MAGE2, 'Destruction', 10); at(MAGE2, LIBRARY);
mastery(PRIEST, 'priest', 12);

const events = [];
globalThis.__alduinakMasteryEvent = (kind, a, detail) => events.push({ kind, a, detail });
globalThis.__alduinakMasteryFirstTouch = () => 'ok';
globalThis.__alduinakMasteryAward = (a, skill, weight) => weight;
const mp = {
  getIdFromDesc: idOf,
  getDescFromId: descOf,
  get: (id, p) => props.get(id + '|' + p),
  set: (id, p, v) => props.set(id + '|' + p, JSON.parse(JSON.stringify(v))),
  lookupEspmRecordById: (id) => (RECORDS[id] ? { record: RECORDS[id], toGlobalRecordId: (local) => local } : null),
  callPapyrusFunction: (kind, cls, fn) => {
    if (fn === 'GetSpellCount') return 0;
    if (fn === 'GetNthSpell') return null;
    if (cls === 'Debug') return null;
    return false;
  },
};
mp.onReadBook = () => undefined;

const online = [MAGE, PRIEST, MAGE2];
const out = { widgets: [], said: [], audits: [], logs: [] };
const handlers = new Map(), timers = new Map();
const mkApi = (cfg) => ({
  mp, cfg,
  log: (...a) => out.logs.push(a.join(' ')),
  personal: (a, t) => out.said.push([a, t]),
  system: (a, t) => out.said.push([a, t]),
  audit: (t) => out.audits.push(t),
  display: (a) => `${NAMES[a] || 'P'} #TAG${(a & 0xf).toString(16)}`,
  who: (a) => `P${a.toString(16)}`,
  openWidget: (a, w, focus) => { out.widgets.push({ a, w, focus }); return true; },
  closeWidget: () => true,
  onUi: (ev, fn) => { const l = handlers.get(ev) || []; l.push(fn); handlers.set(ev, l); },
  registerChatCommand: () => {},
  onlineActors: () => online.slice(),
  every: (name, ms, fn) => timers.set(name, fn),
  distanceMeters: (a, b) => {
    if (props.get(a + '|worldOrCellDesc') !== props.get(b + '|worldOrCellDesc')) return Infinity;
    const p = props.get(a + '|pos'), q = props.get(b + '|pos');
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 70;
  },
  sendPacket: () => true,
  isAdmin: () => false,
  findByName: () => null,
  isWorldspace: () => false,
  profileOf: (a) => { const v = props.get(a + '|profileId'); return v === undefined ? -1 : v; },
  takeGold: () => false, giveItem: () => true, depositToTreasury: (z, n) => n,
});
const load = (study, priestStudy) => {
  handlers.clear(); timers.clear();
  const sc = Object.assign({}, CONFIG.schools, { enabled: true });
  sc.study = Object.assign({}, sc.study, study || {});
  sc.priestStudy = Object.assign({}, sc.priestStudy || {}, priestStudy || {});
  const cfg = { spells: Object.assign({}, CONFIG.spells), schools: sc };
  delete require.cache[SPELLS]; require(SPELLS)(mkApi(cfg));
  delete require.cache[SCHOOLS]; require(SCHOOLS)(mkApi(cfg));
  for (const a of online) (handlers.get('uiCaps') || []).forEach((fn) => fn(a, ['bank', 'spellbook', 'schools'], 0));
};

let failures = 0, checks = 0;
const check = (name, ok, detail) => { checks++; if (!ok) { failures++; console.log(`FAIL ${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); } else console.log(`ok   ${name}`); };
const ST = () => globalThis.__dboSchoolsState;
const tick = () => timers.get('schools.tick')();
const sit = (ms) => { for (let t = 0; t < ms; t += 2000) { advance(2000); tick(); } };
const casts = (a) => events.filter((e) => e.kind === 'cast' && e.a === a && e.detail.spellId === HEAL).length;
const stopAll = () => { for (const a of online) { ST().studying.delete(a); ST().priestStudying.delete(a); } };

load();
check('the tracked config keeps homeRate 1 (a library\'s rate) for Study Magic', CONFIG.schools.study.homeRate === 1, CONFIG.schools.study.homeRate);

// ---- one shelf, two kinds of study ----
check('a mage at the home shelf: schools.js takes the use', globalThis.__dboSchoolsActivate(SHELF, MAGE) === true);
check('...and it is Study Magic, not Priest Studies', ST().studying.has(MAGE) && !ST().priestStudying.has(MAGE));
check('a priest with no school at the same shelf: Priest Studies', globalThis.__dboSchoolsActivate(SHELF, PRIEST) === true && ST().priestStudying.has(PRIEST) && !ST().studying.has(PRIEST));
sit(MIN + 4000);
check('...at homeRate 1 the priest\'s minute pays one Wheel credit, as a library does', casts(PRIEST) === 1, casts(PRIEST));
check('...the mage\'s minute pays 6 units, as a library does', ST().studying.get(MAGE).gained === 6, ST().studying.get(MAGE).gained);
stopAll();

// ---- homeRate below 1 ----
load({ homeRate: 0.5 }, { homeRate: 0 });
globalThis.__dboSchoolsActivate(SHELF, MAGE);
globalThis.__dboSchoolsActivate(STUDYBOX, MAGE2);
const c0 = casts(PRIEST);
globalThis.__dboSchoolsActivate(SHELF, PRIEST);
sit(2 * MIN + 4000);
check('study.homeRate 0.5: the home shelf pays half a library\'s units in the same time', ST().studying.get(MAGE).gained === 6 && ST().studying.get(MAGE2).gained === 12, [ST().studying.get(MAGE).gained, ST().studying.get(MAGE2).gained]);
check('priestStudy.homeRate 0: no Wheel credit at home', casts(PRIEST) === c0 && ST().priestStudying.has(PRIEST), casts(PRIEST) - c0);
stopAll();

// ---- decor's shelf kinds (Nat, 26 Oct): a priest shelf opens Priest Studies, an arcane one Study Magic, whoever uses it ----
load();
globalThis.__dboDecorStudyKind = () => 'priest';
check('a priest shelf: a mage with a school gets Priest Studies, not Study Magic', globalThis.__dboSchoolsActivate(SHELF, MAGE) === true && ST().priestStudying.has(MAGE) && !ST().studying.has(MAGE));
stopAll();
globalThis.__dboDecorStudyKind = () => 'arcane';
const arcane = globalThis.__dboSchoolsActivate(SHELF, PRIEST);
check('an arcane shelf: a priest with no school is not sent to Priest Studies', arcane === true && !ST().priestStudying.has(PRIEST), { took: arcane, priest: ST().priestStudying.has(PRIEST) });
check('an arcane shelf: a mage studies magic there', globalThis.__dboSchoolsActivate(SHELF, MAGE) === true && ST().studying.has(MAGE));
stopAll();
globalThis.__dboDecorStudyKind = () => '';
check('no kind (a library shelf): the old rule, mage to Study Magic', globalThis.__dboSchoolsActivate(SHELF, MAGE) === true && ST().studying.has(MAGE));
stopAll();
// Nat, 26 Oct: both his shelves opened Priest Studies. An arcane shelf must never fall back to priest, even with Study Magic off
load({ enabled: false });
globalThis.__dboDecorStudyKind = () => 'arcane';
const off = globalThis.__dboSchoolsActivate(SHELF, PRIEST);
check('Study Magic off: an arcane shelf is left alone, never Priest Studies', off === false && !ST().priestStudying.has(PRIEST), { took: off, priest: ST().priestStudying.has(PRIEST) });
load(undefined, { enabled: false });
globalThis.__dboDecorStudyKind = () => 'priest';
const offP = globalThis.__dboSchoolsActivate(SHELF, MAGE);
check('Priest Studies off: a priest shelf is left alone, never Study Magic', offP === false && !ST().studying.has(MAGE), { took: offP, studying: ST().studying.has(MAGE) });
stopAll();
delete globalThis.__dboDecorStudyKind;
load();

// ---- a base that is not a study spot ----
const BARE = idOf('1d2302:DragonBreak Online Edits.esp'); put(BARE, 'baseDesc', '1d2241:DragonBreak Online Edits.esp'); at(BARE, HOME); // verify-formids: ignore (made-up DLE ids)
RECORDS[idOf('1d2241:DragonBreak Online Edits.esp')] = { type: 'ACTI', editorId: 'DBOPlanter', fields: [] }; // verify-formids: ignore (made-up DLE ids)
check('a planter is not a study spot: schools.js leaves it', globalThis.__dboSchoolsActivate(BARE, MAGE) === false);

console.log(`${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
