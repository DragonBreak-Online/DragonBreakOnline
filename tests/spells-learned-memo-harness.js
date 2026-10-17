// One read of a character's learned spells serves the rest of the server tick (17 Oct). The fork's GetNthSpell walks the
// whole list and re-reads the actor's base records for every index, so a list of N spells costs about N x N record reads:
// a lead GM given every spell (331) took about 4.5 s a read, a Magic tab draw read the list three times, and the login
// passes twice. Loads the real spells.js, manuals.js and schools.js (in gamemode.js's order) against an engine that counts
// its GetNthSpell calls, and checks:
//   reads in one tick walk the list once (spells.js, a Magic tab draw, manuals.js's marker check);
//   each read still asks the count, and a new tick reads afresh;
//   a change outside the wrappers that moves the count (a tome read by the engine) is seen at once;
//   a swap through spells.js (a held spell given back, a suspended one held back) is seen in the same tick;
//   a RemoveSpell the engine confirms leaves the kept list exact, so a login's hold-back and strip read the list once,
//     and spells.hold does not read it again for that login;
//   manuals.js's and schools.js's spell changes forget the kept list (__dboSpellsLearnedChanged);
//   a list handed out is a copy.
//
//   node tests/spells-learned-memo-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const SPELLS = path.join(SERVER, 'spells.js');
const MANUALS = path.join(SERVER, 'manuals.js');
const SCHOOLS = path.join(SERVER, 'schools.js');
const CONFIG = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spells-learned-memo-'));
process.chdir(dir);
for (const f of ['skills.json', 'spell-tomes.json', 'spell-lines.json']) { try { fs.copyFileSync(path.join(SERVER, f), f); } catch (e) { /* optional */ } }

const PLUGINS = { 'Skyrim.esm': 0x00, 'BSAssets.esm': 0x0a, 'BSHeartland.esm': 0x0b, 'DragonBreak Online Edits.esp': 0x60 };
const BY_INDEX = Object.fromEntries(Object.entries(PLUGINS).map(([k, v]) => [v, k]));
// Runtime forms (players' actors, ff......) have no plugin in their desc, as on the server
const idOf = (d) => { const [hex, plugin] = String(d).split(':'); if (plugin === undefined) return parseInt(hex, 16) >>> 0; if (!(plugin in PLUGINS)) throw new Error(`no plugin ${plugin}`); return ((PLUGINS[plugin] << 24) | parseInt(hex, 16)) >>> 0; };
const descOf = (id) => { if ((id >>> 24) === 0xff) return (id >>> 0).toString(16); const p = BY_INDEX[id >>> 24]; if (!p) throw new Error('no plugin'); return `${(id & 0xffffff).toString(16)}:${p}`; };

// School spells spell-tomes.json classifies (so __dboSpellsKnown lists them), and filler the server cannot classify
const FROSTBITE = idOf('2b96b:Skyrim.esm'), SPARKS = idOf('2dd2a:Skyrim.esm'), FIREBOLT = idOf('12fd0:Skyrim.esm'), HEALING = idOf('12fcc:Skyrim.esm');
const TRANSMUTE = idOf('109111:Skyrim.esm'); // spells.js removedSpells
const FILLER = Array.from({ length: 60 }, (_, i) => (0x00e00000 + i) >>> 0);
// A smithing manual (manuals.js's own table: book and marker spell)
const MANUAL_BOOK = idOf('800:DragonBreak Online Edits.esp'), MANUAL_MARKER = idOf('801:DragonBreak Online Edits.esp');
fs.writeFileSync('manuals.json', JSON.stringify({ manuals: [{ material: 'Steel', name: 'Steel', title: 'Steel Methods', tier: 1, book: descOf(MANUAL_BOOK), marker: descOf(MANUAL_MARKER), value: 100 }] }));
const RECORDS = { [MANUAL_BOOK]: { type: 'BOOK', editorId: 'DBO_BookManualSteel', fields: [] } };

const GM = 0xff000100, HOLDER = 0xff000101, LOGIN = 0xff000102, SMITH = 0xff000103, PUPIL = 0xff000104, TEACHER = 0xff000105;
const NAMES = { [GM]: 'Lead', [HOLDER]: 'Holder', [LOGIN]: 'Login', [SMITH]: 'Smith', [PUPIL]: 'Pupil', [TEACHER]: 'Teacher' };
const props = new Map();
const put = (id, p, v) => props.set(id + '|' + p, v);
for (const a of Object.keys(NAMES).map(Number)) { put(a, 'profileId', a & 0xfff); put(a, 'worldOrCellDesc', '3c:Skyrim.esm'); put(a, 'pos', [0, 0, 0]); }
const mastery = (a, skills) => put(a, 'private.mastery', { v: 2, order: Object.keys(skills), skills: Object.fromEntries(Object.entries(skills).map(([k, level]) => [k, { level, xp: 0, rank: level >= 90 ? 4 : level >= 75 ? 3 : level >= 50 ? 2 : level >= 25 ? 1 : 0 }])) });

// The engine: an ordered learned list per actor; GetNthSpell calls are what a read costs
const engine = new Map();
const list = (a) => engine.get(a >>> 0) || (engine.set(a >>> 0, []), engine.get(a >>> 0));
let walks = 0, counts = 0;
const mp = {
  getIdFromDesc: idOf,
  getDescFromId: descOf,
  get: (id, p) => props.get(id + '|' + p),
  set: (id, p, v) => props.set(id + '|' + p, JSON.parse(JSON.stringify(v))),
  lookupEspmRecordById: (id) => (RECORDS[id] ? { record: RECORDS[id], toGlobalRecordId: (l) => l } : null),
  callPapyrusFunction: (kind, cls, fn, self, args) => {
    if (cls !== 'Actor') return null;
    const s = list(idOf(self.desc));
    if (fn === 'GetSpellCount') { counts++; return s.length; }
    if (fn === 'GetNthSpell') { walks++; const id = s[args[0]]; return id === undefined ? null : { type: 'espm', desc: descOf(id) }; }
    const spell = idOf(args[0].desc);
    if (fn === 'AddSpell') { if (s.includes(spell)) return false; s.push(spell); return true; }
    if (fn === 'RemoveSpell') { const i = s.indexOf(spell); if (i < 0) return false; s.splice(i, 1); return true; }
    if (fn === 'EquipSpell' || fn === 'UnequipSpell') return null;
    throw new Error('unexpected papyrus ' + fn);
  },
};
mp.onReadBook = () => undefined;
globalThis.__alduinakMasteryFirstTouch = () => 'held';

const out = { said: [], audits: [], logs: [] };
const timers = new Map();
let online = [GM, HOLDER, LOGIN, SMITH, PUPIL, TEACHER];
const api = (cfg) => ({
  mp, cfg,
  log: (...a) => out.logs.push(a.join(' ')), personal: (a, t) => out.said.push([a, t]), system: (a, t) => out.said.push([a, t]),
  audit: (t) => out.audits.push(t), display: (a) => `${NAMES[a] || 'P'} #T${(a & 0xf).toString(16)}`, who: (a) => `P${(a >>> 0).toString(16)}`,
  openWidget: () => true, closeWidget: () => true, onUi: () => {}, registerChatCommand: () => {}, sendPacket: () => true, notify: () => true,
  onlineActors: () => online.slice(), every: (name, ms, fn) => timers.set(name, fn),
  distanceMeters: (a, b) => (props.get(a + '|worldOrCellDesc') === props.get(b + '|worldOrCellDesc') ? 1 : Infinity),
  takeGold: () => false, giveItem: () => true, depositToTreasury: (z, n) => n,
  isAdmin: () => false, findByName: () => null, isWorldspace: () => false,
  profileOf: (a) => { const v = props.get(a + '|profileId'); return v === undefined ? -1 : v; },
});
const cfg = {
  spells: Object.assign({}, CONFIG.spells, { suspendedSpells: [descOf(FROSTBITE)], removedSpells: [descOf(TRANSMUTE)] }),
  schools: Object.assign({}, CONFIG.schools, { enabled: true, requireClient: false }),
  manuals: Object.assign({}, CONFIG.manuals || {}, { enabled: true }),
};
for (const f of [SPELLS, MANUALS, SCHOOLS]) { delete require.cache[f]; require(f)(api(cfg)); }

let failures = 0, checks = 0;
const check = (name, ok, detail) => { checks++; if (!ok) { failures++; console.log(`FAIL ${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); } else console.log(`ok   ${name}`); };
const safe = (f) => { try { return f(); } catch (e) { return `threw: ${e.message}`; } };
const nextTick = () => new Promise((r) => setImmediate(r));
const knownIds = (a) => (globalThis.__dboSpellsKnown(a) || []).map((sp) => sp.id >>> 0).sort();
const learned = (a) => (typeof globalThis.__dboSpellsLearned === 'function' ? globalThis.__dboSpellsLearned(a) : null);
// manuals.js and schools.js tell spells.js through this hook; recorded here, passed on
const forgot = [];
const hook = globalThis.__dboSpellsLearnedChanged;
if (typeof hook === 'function') globalThis.__dboSpellsLearnedChanged = (a) => { forgot.push(a >>> 0); return hook(a); };

(async () => {
  // ---- the lead GM: every spell ----------------------------------------------------------------------------------
  list(GM).push(SPARKS, FIREBOLT, HEALING, ...FILLER);
  const N = list(GM).length;
  mastery(GM, { arcane: 60, priest: 40 });

  walks = 0; counts = 0;
  const first = safe(() => knownIds(GM)), second = safe(() => knownIds(GM));
  check('two reads of one character in one tick walk the spell list once', walks === N, { walks, N });
  check('...and both answer the same', JSON.stringify(first) === JSON.stringify(second) && Array.isArray(first) && first.length === 3, { first, second });
  check('...each read still asks the engine for the count (a cheap walk, so a change in the count is never missed)', counts === 2, counts);

  await nextTick();
  walks = 0;
  safe(() => globalThis.__dboSpellsTab(GM));
  safe(() => globalThis.__dboSpellsTomesFor(GM, 'Destruction', 'arcane', 4, 3));
  safe(() => globalThis.__dboSpellsTomesFor(GM, 'Restoration', 'priest', 4, 3));
  check('a Magic tab draw (the spellbook and two schools\' tomes) walks the list once', walks === N, { walks, N });

  await nextTick();
  walks = 0;
  const view = safe(() => (typeof globalThis.__dboMagicView === 'function' ? globalThis.__dboMagicView(GM) : 'no view'));
  check('schools.js\'s real Magic tab view walks the list once', walks === N && view && typeof view === 'object', { walks, N, open: view && view.open });

  await nextTick();
  walks = 0;
  safe(() => knownIds(GM));
  check('a new tick reads the list afresh', walks === N, { walks, N });

  // A tome read: the engine learns the spell itself, outside every wrapper, and the count moves
  list(GM).push(FROSTBITE);
  walks = 0;
  const afterTome = safe(() => knownIds(GM));
  check('a spell the engine learned outside the wrappers in the same tick is seen at once', Array.isArray(afterTome) && afterTome.includes(FROSTBITE) && walks === N + 1, { afterTome, walks });
  list(GM).splice(list(GM).indexOf(FROSTBITE), 1);

  // A list handed out is the caller's own
  await nextTick();
  const mine = safe(() => learned(GM));
  if (Array.isArray(mine)) mine.push(0xdeadbeef);
  const again = safe(() => learned(GM));
  check('a list handed out is a copy: changing it changes nothing kept', Array.isArray(again) && again.length === N && !again.includes(0xdeadbeef), Array.isArray(again) ? again.length : again);

  // ---- a swap through spells.js in one tick: a held spell given back (AddSpell), a suspended one held back (RemoveSpell) ----
  await nextTick();
  list(HOLDER).push(FROSTBITE, FIREBOLT);
  put(HOLDER, 'private.dboHeldSpells', [descOf(SPARKS)]);
  const before = safe(() => knownIds(HOLDER));
  safe(() => globalThis.__dboSpellsHoldSuspended(HOLDER));
  const after = safe(() => knownIds(HOLDER));
  check('the swap really happened in the engine (the count is the same before and after)', list(HOLDER).length === 2 && list(HOLDER).includes(SPARKS) && !list(HOLDER).includes(FROSTBITE), list(HOLDER));
  check('a read after a swap through spells.js in the same tick sees it, not the list from before', Array.isArray(after) && after.includes(SPARKS) && !after.includes(FROSTBITE) && Array.isArray(before) && before.includes(FROSTBITE), { before, after });

  // ---- a login: hold back a suspended spell, then strip a removed one (gamemode.js __dboSpellsStripRemoved) ----------
  await nextTick();
  list(LOGIN).push(FROSTBITE, TRANSMUTE, FIREBOLT, ...FILLER);
  const M = list(LOGIN).length;
  walks = 0;
  safe(() => globalThis.__dboSpellsStripRemoved(LOGIN));
  const loginWalks = walks;
  const left = safe(() => learned(LOGIN));
  check('a login that holds back one spell and strips another reads the list once', loginWalks === M && walks === M, { loginWalks, after: walks, M });
  check('...and the kept list it ends with is exact (both gone, the rest there)', Array.isArray(left) && left.length === M - 2 && !left.includes(FROSTBITE) && !left.includes(TRANSMUTE) && left.includes(FIREBOLT)
    && JSON.stringify(left) === JSON.stringify(list(LOGIN)), Array.isArray(left) ? left.length : left);
  check('...both taken off in the engine', !list(LOGIN).includes(FROSTBITE) && !list(LOGIN).includes(TRANSMUTE), list(LOGIN).length);
  await nextTick();
  online = [LOGIN];
  walks = 0;
  const hold = timers.get('spells.hold');
  safe(() => hold && hold());
  check('...and spells.hold does not read the list again after that login (the login held them)', !!hold && walks === 0, walks);
  online = [GM, HOLDER, LOGIN, SMITH, PUPIL, TEACHER];

  // ---- manuals.js: its marker check shares the tick's read, and its AddSpell forgets the kept list -----------------
  await nextTick();
  list(SMITH).push(FIREBOLT, ...FILLER);
  put(SMITH, 'private.dboManuals', { steel: { at: 1, from: 'harness' } });
  online = [SMITH];
  safe(() => knownIds(SMITH));
  walks = 0; forgot.length = 0;
  const regrant = timers.get('manuals.regrant');
  safe(() => regrant && regrant());
  check('manuals.js\'s marker check at login reads through spells.js: no second walk in the tick', walks === 0 && list(SMITH).includes(MANUAL_MARKER), { walks, marker: list(SMITH).includes(MANUAL_MARKER) });
  check('...and putting the marker back forgets the kept list', forgot.includes(SMITH >>> 0), forgot);
  const withMarker = safe(() => learned(SMITH));
  check('...so the next read in the tick has the marker', Array.isArray(withMarker) && withMarker.includes(MANUAL_MARKER), Array.isArray(withMarker) ? withMarker.length : withMarker);

  // ---- schools.js: an apprentice's loaned spell taken back at logout forgets the kept list ------------------------
  await nextTick();
  online = [PUPIL, TEACHER];
  list(PUPIL).push(HEALING, FIREBOLT);
  put(PUPIL, 'private.dboSchools', { v: 1, primary: null, secondary: null, grandfathered: [], levels: {}, study: { log: [] }, priestStudy: { log: [] }, cast: { day: '', units: {} }, ring: [], classAt: 0, paidAt: 0, teacher: null, picks: {}, pickTold: {}, swapAt: 0, swaps: [],
    apprentice: { teacher: TEACHER, teacherName: 'Teacher', spell: descOf(HEALING), held: true, xp: 0, at: 1 } });
  safe(() => knownIds(PUPIL));
  forgot.length = 0;
  const leave = safe(() => globalThis.__dboSchoolsLeave(PUPIL));
  check('schools.js takes the loaned spell back at logout', !list(PUPIL).includes(HEALING), { leave, list: list(PUPIL) });
  check('...and its RemoveSpell forgets the kept list', forgot.includes(PUPIL >>> 0), forgot);

  console.log(`${checks - failures}/${checks} checks passed`);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* scratch */ }
  process.exit(failures ? 1 : 0);
})();
