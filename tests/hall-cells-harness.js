// Hall cells (guilds.js __dboHallFactionAt, the REAL one, no stand-in): a faction's Scholars' Ledger and Class Lectern
// teach and sell under its own name where the plugins place them. The Imperial Cult teach at the Cathedral of St Martin's
// Scholars' Ledger and its tome sales pay their treasury (guild-defs' hall doors stand in Bruma's street, so the cell map
// never reached the Cathedral); the Synod teaches at its Conclave's ledger and Class Lectern (its hall doors stand in the
// basement, the ledger and lecterns in the main hall); and the map is built at all: doors-pos.json keeps cells in lower
// case, the engine's getIdFromDesc matches plugin names exactly (FormDesc::ToFormId), so every lookup threw and the map
// was empty on the live server (Frostcrag Spire included).
//
// Loads the real guilds.js (real guild-defs.json, doors-pos.json and buildings.json), spells.js, salvage.js, schools.js,
// skillrates.js, ledgersale.js and bank.js with gamemode-config.json's own settings, against one stub mp whose
// getIdFromDesc indexes plugins.server.txt and, like the engine, throws "<name> not found in loaded files" for a plugin
// name spelled any other way. Run twice over: "strict" (the engine as it is) and "lenient" (an engine that ignored case),
// so each of the two faults shows on its own.
//
// Where the refs stand (DragonBreak Online Edits.esp and BSHeartland.esm in /opt/skyrim-data, read 12 Oct; the scan is
// bughunt-r3/hall-cells/scripts/find_refs.py): Scholars' Ledgers (BookBreakdown, dcf0f:BSHeartland.esm) 1a7764 in 12cb
// CYRBrumaCathedralofStMartin, 13f774 in 20ff CYRBrumaSynodConclave, 13f775 in 6ff7d CYRFrostCragSpire; the Synod's
// Class Lecterns (ClassLectern, 15e4b7) 15e4bb and 15e4bc in 20ff. The Cathedral has no Class Lectern.
//
//   node tests/hall-cells-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const F = (n) => path.join(SERVER, n);
const CONFIG = JSON.parse(fs.readFileSync(F('gamemode-config.json'), 'utf8'));
const DEFS = JSON.parse(fs.readFileSync(F('guild-defs.json'), 'utf8'));
const TOMES = JSON.parse(fs.readFileSync(F('spell-tomes.json'), 'utf8')).tomes;
const BUILDINGS = JSON.parse(fs.readFileSync(F('buildings.json'), 'utf8')).buildings;
const DOORS_POS = JSON.parse(fs.readFileSync(F('doors-pos.json'), 'utf8')).doors;

const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hall-cells-'));
process.chdir(dir);
for (const f of ['skills.json', 'spell-tomes.json', 'salvage.json', 'guild-defs.json', 'doors-pos.json']) fs.copyFileSync(F(f), f);

let failures = 0, checks = 0;
const check = (name, ok, detail) => { checks++; if (!ok) { failures++; console.log(`FAIL ${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); } else console.log(`ok   ${name}`); };
const attempt = (fn) => { try { return fn(); } catch (e) { return `threw: ${e.message}`; } };

// ---- the engine: plugins.server.txt's names, matched exactly (FormDesc::ToFormId) or, "lenient", ignoring case --------
const ORDER = fs.readFileSync(F('plugins.server.txt'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.replace(/^\*/, ''));
const INDEX = new Map(ORDER.map((n, i) => [n, i]));
const BY_INDEX = new Map(ORDER.map((n, i) => [i, n]));
let strict = true;
const fileOf = (name) => {
  if (INDEX.has(name)) return name;
  if (!strict) { const hit = ORDER.find((n) => n.toLowerCase() === String(name).toLowerCase()); if (hit) return hit; }
  throw new Error(`${name} not found in loaded files`);
};
const idOf = (d) => { const s = String(d), i = s.indexOf(':'); if (i < 0) return parseInt(s, 16) >>> 0; return ((INDEX.get(fileOf(s.slice(i + 1))) << 24) | parseInt(s.slice(0, i), 16)) >>> 0; };
const descOf = (id) => { const p = BY_INDEX.get(id >>> 24); if (p === undefined) throw new Error('no plugin ' + (id >>> 0).toString(16)); return `${(id & 0xffffff).toString(16)}:${p}`; };
const canon = (c) => { const i = c.lastIndexOf(':'); return `${parseInt(c.slice(i + 1), 16).toString(16)}:${c.slice(0, i)}`; };
const keyOf = (d) => { const s = String(d), i = s.indexOf(':'); return `${parseInt(s.slice(0, i), 16).toString(16)}:${s.slice(i + 1).toLowerCase()}`; };

// Record types by the generated data: every building's world is a worldspace, its cells and every door's cell are cells
const WORLDS = new Set(BUILDINGS.map((b) => keyOf(b.world)).filter(Boolean));
const CELLS = new Set([].concat(...BUILDINGS.map((b) => b.cells || [])).map(keyOf));
for (const row of Object.values(DOORS_POS)) if (Array.isArray(row) && row[3] && !WORLDS.has(keyOf(row[3]))) CELLS.add(keyOf(row[3]));
const SCHOLARS_BASE = 'dcf0f:BSHeartland.esm', LECTERN_BASE = '15e4b7:DragonBreak Online Edits.esp';
const BASES = new Map([[keyOf(SCHOLARS_BASE), { type: 'ACTI', editorId: 'BookBreakdown', fields: [] }], [keyOf(LECTERN_BASE), { type: 'ACTI', editorId: 'ClassLectern', fields: [] }]]);
const recordOf = (id) => {
  let k; try { k = keyOf(descOf(id >>> 0)); } catch (e) { return null; }
  const r = BASES.get(k) || (WORLDS.has(k) ? { type: 'WRLD', editorId: k, fields: [] } : CELLS.has(k) ? { type: 'CELL', editorId: k, fields: [] } : null);
  return r ? { record: r, toGlobalRecordId: (l) => l } : null;
};

// ---- places, as the plugins place them ------------------------------------------------------------------------------
const CATHEDRAL = '12cb:BSHeartland.esm', UNDERCROFT = '5f78c:BSHeartland.esm', CHAPEL = '5f78d:BSHeartland.esm';
const CONCLAVE = '20ff:BSHeartland.esm', BASEMENT = '6c152:BSHeartland.esm', FROSTCRAG = '6ff7d:BSHeartland.esm', BRUMA = 'a764b:BSHeartland.esm';
const DLE = 'DragonBreak Online Edits.esp';
const REFS = {
  cathLedger: { desc: `1a7764:${DLE}`, base: SCHOLARS_BASE, cell: CATHEDRAL, pos: [-562.3, -69.8, -1027.1] },
  synodLedger: { desc: `13f774:${DLE}`, base: SCHOLARS_BASE, cell: CONCLAVE, pos: [-1.5, -41.5, -51.6] },
  synodLectern: { desc: `15e4bb:${DLE}`, base: LECTERN_BASE, cell: CONCLAVE, pos: [-274.0, 433.5, 196.6] },
  cragLedger: { desc: `13f775:${DLE}`, base: SCHOLARS_BASE, cell: FROSTCRAG, pos: [-1174.9, -218.9, -282.5] },
};

// ---- people -----------------------------------------------------------------------------------------------------------
const PRIEST = 0x14, ACOLYTE = 0x15, MAGISTER = 0x16, ASSOC = 0x17, WSENIOR = 0x18, BUYER = 0x19;
const NAMES = { [PRIEST]: 'Priest', [ACOLYTE]: 'Acolyte', [MAGISTER]: 'Magister', [ASSOC]: 'Assoc', [WSENIOR]: 'Wsenior', [BUYER]: 'Buyer' };
const ROSTER = [[PRIEST, 'imperial-cult', 'Oracle'], [ACOLYTE, 'imperial-cult', 'Acolyte'], [BUYER, 'imperial-cult', 'Acolyte'],
  [MAGISTER, 'synod', 'Senior Magister'], [ASSOC, 'synod', 'Associate'], [WSENIOR, 'college-of-whispers', 'Senior Whisperer']];
const guildsJson = {};
for (const [a, fid, title] of ROSTER) {
  const f = DEFS.factions.find((x) => x.id === fid);
  const rank = f.ranks.findIndex((r) => r.title === title);
  if (rank < 0) throw new Error(`no rank ${title} in ${fid}`);
  (guildsJson[fid] = guildsJson[fid] || {})[String(a)] = { rank, title, name: NAMES[a], tag: 'T', since: 1 };
}
fs.writeFileSync('guilds.json', JSON.stringify(guildsJson));

const tome = (edid) => { const t = TOMES.find((x) => x.name === edid); return { book: canon(t.id), spell: canon(t.spellId), rank: t.rank, title: t.fullName }; };
const FAST_HEALING = tome('SpellTomeFastHealing'), HEALING_HANDS = tome('SpellTomeHealingHands'), FIREBOLT = tome('SpellTomeFirebolt'), SPARKS = tome('SpellTomeSparks');
const GOLD = 0xf;

const props = new Map();
const put = (id, p, v) => props.set((id >>> 0) + '|' + p, v === undefined ? v : JSON.parse(JSON.stringify(v)));
const getp = (id, p) => props.get((id >>> 0) + '|' + p);
const at = (id, cell, pos) => { put(id, 'worldOrCellDesc', cell); put(id, 'pos', pos || [0, 0, 0]); };
const near = (ref, dx) => [ref.pos[0] + (dx || 70), ref.pos[1], ref.pos[2]];
const tierOfLevel = (l) => (l >= 90 ? 4 : l >= 75 ? 3 : l >= 50 ? 2 : l >= 25 ? 1 : 0);
const skillAt = (a, skill, level) => {
  const r = getp(a, 'private.mastery') || { v: 2, skills: {}, order: [] };
  r.skills[skill] = { level, xp: 0, rank: tierOfLevel(level) };
  if (!r.order.includes(skill)) r.order.push(skill);
  put(a, 'private.mastery', r);
};
const gold = (a, n) => put(a, 'inventory', { entries: n ? [{ baseId: GOLD, count: n }] : [] });
const count = (a, baseId) => ((getp(a, 'inventory') || { entries: [] }).entries.filter((e) => e.baseId === baseId).reduce((n, e) => n + e.count, 0));
const learned = new Map();
const known = (a) => learned.get(a >>> 0) || (learned.set(a >>> 0, new Set()), learned.get(a >>> 0));
const refId = (r) => idOf(r.desc);

const mp = {
  getIdFromDesc: idOf, getDescFromId: descOf,
  get: (id, p) => getp(id, p),
  set: (id, p, v) => put(id, p, v),
  lookupEspmRecordById: (id) => recordOf(id),
  getActorsByProfileId: () => [],
  callPapyrusFunction: (kind, cls, fn, self, args) => {
    if (cls === 'Debug') return null;
    const a = idOf(self.desc); const s = known(a);
    if (fn === 'GetSpellCount') return s.size;
    if (fn === 'GetNthSpell') { const id = [...s][args[0]]; return id === undefined ? null : { type: 'espm', desc: descOf(id) }; }
    const spell = idOf(args[0].desc);
    if (fn === 'AddSpell') { if (s.has(spell)) return false; s.add(spell); return true; }
    if (fn === 'RemoveSpell') return s.delete(spell);
    return false;
  },
};
mp.onReadBook = () => undefined;
globalThis.__alduinakMasteryFirstTouch = (a, skill) => { skillAt(a, skill, 1); return 'ok'; };
globalThis.__alduinakMasteryEvent = () => {};
globalThis.__alduinakMasteryAward = () => 0;
globalThis.__dboWheelRoom = () => null;

const people = Object.keys(NAMES).map(Number);
const out = { widgets: [], said: [], audits: [], logs: [], held: [] };
const handlers = new Map(), commands = new Map();
const cfg = {
  spells: Object.assign({}, CONFIG.spells, { shopStock: 999 }),
  schools: Object.assign({}, CONFIG.schools, { enabled: true }),
  salvage: CONFIG.salvage, skillRates: CONFIG.skillRates, ledgerSale: CONFIG.ledgerSale, rest: CONFIG.rest, bank: CONFIG.bank, factions: CONFIG.factions,
};
const api = {
  mp, cfg,
  log: (...a) => out.logs.push(a.join(' ')), personal: (a, t) => out.said.push([a >>> 0, t]), system: (a, t) => out.said.push([a >>> 0, t]),
  audit: (t) => out.audits.push(t), who: (a) => `P${(a >>> 0).toString(16)}`, display: (a) => NAMES[a >>> 0] || `P${(a >>> 0).toString(16)}`,
  nameOf: (a) => NAMES[a >>> 0] || '', tagOf: () => 'T',
  giveItem: (a, baseId, n) => { const e = (getp(a, 'inventory') || { entries: [] }).entries; const h = e.find((x) => x.baseId === baseId); if (h) h.count += n; else e.push({ baseId, count: n }); put(a, 'inventory', { entries: e }); return true; },
  takeGold: (a, n) => { const e = (getp(a, 'inventory') || { entries: [] }).entries; const g = e.find((x) => x.baseId === GOLD); if (!g || g.count < n) return false; g.count -= n; put(a, 'inventory', { entries: e.filter((x) => x.count > 0) }); return true; },
  goldOf: (a) => count(a, GOLD),
  depositToTreasury: (zone, n) => { out.held.push([zone, n]); return n; },
  zoneById: (z) => (z === 'bruma' ? { id: 'bruma', name: 'Bruma' } : null), zoneList: () => [], zoneOfActor: () => 'bruma', ranksOf: () => [],
  registerChatCommand: (name, fn, opts) => commands.set(name, { fn, opts }),
  onlineActors: () => people.slice(),
  every: () => {},
  openWidget: (a, w) => { out.widgets.push({ a: a >>> 0, w }); return true; },
  closeWidget: () => true,
  onUi: (ev, fn) => { const l = handlers.get(ev) || []; l.push(fn); handlers.set(ev, l); },
  distanceMeters: (a, b) => { if (getp(a, 'worldOrCellDesc') !== getp(b, 'worldOrCellDesc')) return Infinity; const p = getp(a, 'pos'), q = getp(b, 'pos'); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 70; },
  sendPacket: () => true, isAdmin: () => false, isLeadStaff: () => false, findByName: () => 0, findAnyByName: () => 0, isWorldspace: (d) => WORLDS.has(keyOf(d)),
  profileOf: (a) => { const v = getp(a, 'profileId'); return v === undefined ? -1 : v; },
  readOfficials: () => ({}),
  masteryOf: (a) => getp(a, 'private.mastery') || null,
  recordOf, fieldsOf: (lr, t) => ((lr && lr.record.fields) || []).filter((f) => f.type === t),
  itemName: () => 'something', inBeastForm: () => false,
};
// guilds.js first (the halls, the rosters), then the treasury, the payout, and the ledger, lectern and shop
const MODULES = ['guilds.js', 'bank.js', 'ledgersale.js', 'spells.js', 'schools.js', 'salvage.js', 'skillrates.js'].map(F);
const load = () => { handlers.clear(); commands.clear(); for (const f of MODULES) delete require.cache[f]; for (const f of MODULES) require(f)(api); };
const ui = (ev, a, args, widgetId) => (handlers.get(ev) || []).forEach((fn) => fn(a, args || [], widgetId || 0));
const lastWidget = (a, type) => { const l = out.widgets.filter((w) => w.a === (a >>> 0) && (!type || w.w.type === type)); return l.length ? l[l.length - 1].w : null; };
const said = (a) => { const l = out.said.filter((p) => p[0] === (a >>> 0)); return l.length ? l[l.length - 1][1] : ''; };
const lastAudit = (re) => out.audits.slice().reverse().find((t) => re.test(t)) || '';
const studiedAll = (a) => [].concat(...Object.values(getp(a, 'private.dboStudied') || {}));
const bankJson = () => { try { return JSON.parse(fs.readFileSync('bank.json', 'utf8')); } catch (e) { return { factions: {} }; } };
const actionIds = (w) => (w && Array.isArray(w.actions) ? w.actions.map((x) => x.id) : []);
// The rows __dboTeachLedgerActions gives a ledger's menu
const teachRows = (a, place) => { const r = attempt(() => globalThis.__dboTeachLedgerActions(a, place)); return Array.isArray(r) ? r.map((x) => x.id) : [String(r)]; };

// ---- the data the fix rests on (once; no engine involved) -------------------------------------------------------------
const hallOfDefs = (fid) => (DEFS.factions.find((f) => f.id === fid) || {}).hall || {};
const buildingOf = (door) => BUILDINGS.find((b) => (b.entrances || []).some((e) => keyOf(e.door) === keyOf(door)) || (b.innerDoors || []).map(keyOf).includes(keyOf(door)));
const sameSet = (x, y) => JSON.stringify([...new Set((x || []).map(keyOf))].sort()) === JSON.stringify([...new Set((y || []).map(keyOf))].sort());
const cathedral = buildingOf('7a815:BSHeartland.esm'), conclave = buildingOf('6ca59:BSHeartland.esm');
check('data: the Imperial Cult\' hall doors stand in Bruma\'s worldspace (doors-pos.json), so no door names the Cathedral',
  ['7a815:BSHeartland.esm', '7a816:BSHeartland.esm'].every((d) => WORLDS.has(keyOf(DOORS_POS[d][3]))), ['7a815', '7a816'].map((d) => DOORS_POS[`${d}:BSHeartland.esm`]));
check('data: the Synod\'s hall doors stand only in its basement (6c152), not the main hall (20ff) where its ledger and lecterns are',
  ['6ca59:BSHeartland.esm', '6ca75:BSHeartland.esm'].every((d) => keyOf(DOORS_POS[d][3]) === keyOf(BASEMENT)));
// Solitude's Temple of the Divines (16a02:Skyrim.esm) is the Imperial Cult's too since 19 Oct (Nate)
check('data: guild-defs lists the Cathedral building\'s cells (buildings.json CYRBrumaCathedralofStMartin) and Solitude\'s Temple of the Divines as the Imperial Cult\' hall',
  !!cathedral && cathedral.name === 'CYRBrumaCathedralofStMartin' && sameSet(hallOfDefs('imperial-cult').cells, cathedral.cells.concat(['16a02:Skyrim.esm'])), [hallOfDefs('imperial-cult').cells, cathedral && cathedral.cells]);
check('data: guild-defs lists the Conclave building\'s cells (buildings.json CYRBrumaSynodConclave) as the Synod\'s hall',
  !!conclave && conclave.name === 'CYRBrumaSynodConclave' && sameSet(hallOfDefs('synod').cells, conclave.cells), [hallOfDefs('synod').cells, conclave && conclave.cells]);
check('data: gamemode-config ledgerSale.hallCells pays the Imperial Cult for all three Cathedral cells, the Synod for its two',
  [CATHEDRAL, UNDERCROFT, CHAPEL].every((c) => (CONFIG.ledgerSale.hallCells || {})[c] === 'imperial-cult') && [CONCLAVE, BASEMENT].every((c) => (CONFIG.ledgerSale.hallCells || {})[c] === 'synod'), CONFIG.ledgerSale.hallCells);

for (const mode of ['strict', 'lenient']) {
  strict = mode === 'strict';
  const T = (s) => `${mode}: ${s}`;
  // A fresh world for each engine
  props.clear(); learned.clear(); out.widgets.length = 0; out.said.length = 0; out.audits.length = 0; out.held.length = 0; out.logs.length = 0;
  try { fs.unlinkSync('bank.json'); } catch (e) { /* none yet */ }
  delete globalThis.__dboBankState;
  for (const r of Object.values(REFS)) { put(refId(r), 'baseDesc', r.base); at(refId(r), r.cell, r.pos); }
  for (const a of people) { put(a, 'profileId', a); put(a, 'type', 'MpActor'); gold(a, 1000); at(a, BRUMA, [0, 0, 0]); ui('uiCaps', a, ['spellbook']); }
  load();
  // Logging in mirrors each character's factions onto it (guilds.js), as the shop reads them
  for (const a of people) attempt(() => globalThis.__dboFactionLogin(a));
  // The Class Lectern answers a client that draws the schools panels; the Magister's school is Destruction
  ui('uiCaps', MAGISTER, ['spellbook', 'schools']);
  put(MAGISTER, 'private.dboSchools', { v: 1, primary: 'Destruction', secondary: null, levels: { Destruction: { level: 80, xp: 0 } }, grandfathered: [], picks: { Destruction: { spell: '', how: 'none', at: 1 } }, pickTold: {}, teacher: { by: 'staff', at: 1 }, firstOffered: 1 });
  skillAt(PRIEST, 'priest', 80); skillAt(ACOLYTE, 'priest', 30); skillAt(BUYER, 'priest', 30);
  skillAt(MAGISTER, 'arcane', 80); skillAt(ASSOC, 'arcane', 30); skillAt(WSENIOR, 'arcane', 80);
  known(PRIEST).add(idOf(FAST_HEALING.spell)); known(MAGISTER).add(idOf(FIREBOLT.spell)); known(WSENIOR).add(idOf(SPARKS.spell));
  const hall = (cell) => attempt(() => { const h = globalThis.__dboHallFactionAt(cell); return h ? h.id : null; });
  console.log(`-- ${mode} engine: ${out.logs.filter((l) => /hall cell/.test(l)).join(' | ') || '(no hall-cell line logged)'}`);

  // ---- 1. the cell map itself ---------------------------------------------------------------------------------------
  check(T('the Cathedral of St Martin (12cb), its undercroft (5f78c) and chapel hall (5f78d) are the Imperial Cult\' hall'),
    [CATHEDRAL, UNDERCROFT, CHAPEL].every((c) => hall(c) === 'imperial-cult'), [CATHEDRAL, UNDERCROFT, CHAPEL].map(hall));
  check(T('the Synod Conclave\'s main hall (20ff) and its basement (6c152) are the Synod\'s'), hall(CONCLAVE) === 'synod' && hall(BASEMENT) === 'synod', [hall(CONCLAVE), hall(BASEMENT)]);
  check(T('Frostcrag Spire (6ff7d) is the College of Whispers\' (its hall door stands there)'), hall(FROSTCRAG) === 'college-of-whispers', hall(FROSTCRAG));
  check(T('the cell as the engine reports it and in lower case answer the same'), hall(CATHEDRAL.toLowerCase()) === hall(CATHEDRAL) && hall(FROSTCRAG.toLowerCase()) === hall(FROSTCRAG));
  check(T('Bruma\'s streets are no faction\'s hall, though hall doors stand there'), hall(BRUMA) === null, hall(BRUMA));

  // ---- 2. teaching at the Cathedral's Scholars' Ledger (a Priest of the Imperial Cult, an Acolyte) ----------------------
  const cath = refId(REFS.cathLedger);
  at(PRIEST, CATHEDRAL, near(REFS.cathLedger)); at(ACOLYTE, CATHEDRAL, near(REFS.cathLedger, 280));
  check(T('a Priest at the Cathedral\'s Scholars\' Ledger is offered "Teach a spell to a student"'), teachRows(PRIEST, cath).join() === 'teach', teachRows(PRIEST, cath));
  attempt(() => globalThis.__dboSalvageActivate(cath, PRIEST));
  const ledgerMenu = lastWidget(PRIEST, 'contextMenu');
  check(T('...the ledger\'s own menu lists it'), actionIds(ledgerMenu).includes('teach'), actionIds(ledgerMenu));
  ui('salvageChoose', PRIEST, ['teach'], 66);
  let w = lastWidget(PRIEST, 'contextMenu');
  check(T('...choosing it lists the Acolyte as a student of The Imperial Cult'), !!w && w.id === 45 && actionIds(w).includes(`cstudent:${ACOLYTE.toString(16)}`) && /The Imperial Cult/.test(w.targetName), w && [w.targetName, actionIds(w)]);
  ui('spellsChoose', PRIEST, [`cstudent:${ACOLYTE.toString(16)}`], 45);
  ui('spellsChoose', PRIEST, [`clesson:${ACOLYTE.toString(16)}:${FAST_HEALING.spell}`], 45);
  const offer = lastWidget(ACOLYTE, 'contextMenu');
  check(T('...Fast Healing is offered to the Acolyte'), !!offer && /Priest offers to teach you Fast Healing/.test(offer.targetName), offer && offer.targetName);
  ui('spellsOffer', ACOLYTE, ['accept'], 45);
  check(T('...who learns it: audited TEACH at the Cathedral\'s ledger for imperial-cult'),
    studiedAll(ACOLYTE).includes(FAST_HEALING.spell) && new RegExp(`^TEACH P14 taught ${FAST_HEALING.spell} Fast Healing to P15 at 1a7764:DragonBreak Online Edits.esp for imperial-cult `).test(lastAudit(/^TEACH/)),
    [studiedAll(ACOLYTE), lastAudit(/^TEACH/), said(PRIEST)]);

  // ---- 3. teaching at the Synod's ledger and Class Lectern (a Senior Magister, an Associate) ---------------------------
  const sled = refId(REFS.synodLedger), slec = refId(REFS.synodLectern);
  at(MAGISTER, CONCLAVE, near(REFS.synodLedger)); at(ASSOC, CONCLAVE, near(REFS.synodLedger, 280));
  check(T('a Senior Magister at the Synod Conclave\'s Scholars\' Ledger (20ff) is offered the teaching row'), teachRows(MAGISTER, sled).join() === 'teach', teachRows(MAGISTER, sled));
  attempt(() => globalThis.__dboTeachOpen(MAGISTER, sled));
  ui('spellsChoose', MAGISTER, [`cstudent:${ASSOC.toString(16)}`], 45);
  ui('spellsChoose', MAGISTER, [`clesson:${ASSOC.toString(16)}:${FIREBOLT.spell}`], 45);
  ui('spellsOffer', ASSOC, ['accept'], 45);
  check(T('...and teaches the Associate Firebolt there: audited TEACH at 13f774 for synod'),
    studiedAll(ASSOC).includes(FIREBOLT.spell) && /^TEACH P16 taught .* Firebolt to P17 at 13f774:DragonBreak Online Edits\.esp for synod /.test(lastAudit(/^TEACH/)), [studiedAll(ASSOC), lastAudit(/^TEACH/), said(MAGISTER)]);
  at(MAGISTER, CONCLAVE, near(REFS.synodLectern)); at(ASSOC, CONCLAVE, near(REFS.synodLectern, 280));
  attempt(() => globalThis.__dboSchoolsActivate(slec, MAGISTER));
  w = lastWidget(MAGISTER);
  check(T('the Synod\'s Class Lectern (15e4bb, 20ff) asks its Senior Magister first: a class, or teaching a spell'), !!w && w.type === 'contextMenu' && w.targetName === 'Class Lectern' && actionIds(w).join() === 'lectern,teach,cancel', w && [w.type, w.targetName, actionIds(w)]);
  ui('spellsChoose', MAGISTER, ['teach'], 45);
  check(T('..."Teach a spell" lists the Synod\'s students'), /which student of The Synod/.test((lastWidget(MAGISTER, 'contextMenu') || {}).targetName || ''), (lastWidget(MAGISTER, 'contextMenu') || {}).targetName);
  ui('spellsChoose', MAGISTER, ['cancel'], 45);

  // ---- 4. nobody teaches at another faction's hall --------------------------------------------------------------------
  at(MAGISTER, CATHEDRAL, near(REFS.cathLedger)); at(PRIEST, CONCLAVE, near(REFS.synodLedger));
  check(T('a Senior Magister gets no teaching row at the Cathedral, nor a Priest at the Synod'),
    teachRows(MAGISTER, cath).length === 0 && teachRows(PRIEST, sled).length === 0, [teachRows(MAGISTER, cath), teachRows(PRIEST, sled)]);

  // ---- 5. Frostcrag Spire (built from its hall door's cell) -----------------------------------------------------------
  const crag = refId(REFS.cragLedger);
  at(WSENIOR, FROSTCRAG, near(REFS.cragLedger));
  check(T('a Senior Whisperer at Frostcrag Spire\'s Scholars\' Ledger is offered the teaching row'), teachRows(WSENIOR, crag).join() === 'teach', teachRows(WSENIOR, crag));

  // ---- 6. a tome bought at the Cathedral's ledger: its title, and who is paid ------------------------------------------
  at(BUYER, CATHEDRAL, near(REFS.cathLedger, -70));
  attempt(() => globalThis.__dboSalvageActivate(cath, BUYER));
  check(T('the Cathedral\'s ledger shows the Acolyte "Buy spell tomes"'), actionIds(lastWidget(BUYER, 'contextMenu')).includes('tomes'), actionIds(lastWidget(BUYER, 'contextMenu')));
  ui('salvageChoose', BUYER, ['tomes'], 66);
  const shop = lastWidget(BUYER, 'tomeShop');
  check(T('...the shop is titled the Imperial Cult\', not the Synod\'s'), !!shop && /^The Imperial Cult: Spell Tomes/.test(shop.title), shop && shop.title);
  if (shop) ui('tomeBuy', BUYER, [shop.nonce, HEALING_HANDS.book], 44);
  const sale = lastAudit(/^LEDGERSALE/);
  const owner = Number(((sale.match(/owner (\d+)\/(\d+) to /) || [])[1]) || 0);
  check(T('...Healing Hands is bought there'), count(BUYER, idOf(HEALING_HANDS.book)) === 1, [said(BUYER), (lastWidget(BUYER, 'tomeShop') || {}).result]);
  check(T('...and the owner\'s share goes to the treasury of The Imperial Cult'), /^LEDGERSALE P19 paid 89 gold for Spell Tome: Healing Hands: .* owner \d+\/\d+ to the treasury of The Imperial Cult$/.test(sale) && owner > 0, sale);
  check(T('...where bank.js keeps it: bank.json factions["imperial-cult"] holds that share, audited BANK'),
    owner > 0 && Number((bankJson().factions || {})['imperial-cult']) === owner && /^BANK treasury of imperial-cult received \d+ gold \(ledger sale: Spell Tome: Healing Hands\)/.test(lastAudit(/^BANK treasury of imperial-cult/)),
    [bankJson().factions, lastAudit(/^BANK/)]);

  // ---- 7. sales elsewhere ------------------------------------------------------------------------------------------------
  const pay = (place) => attempt(() => globalThis.__dboLedgerSale({ buyer: BUYER, place, price: 100, what: 'a test' }));
  const ps = pay(sled), pc = pay(crag);
  check(T('a sale at the Synod\'s ledger still pays The Synod'), ps && ps.owner && ps.owner.kind === 'faction' && /owner \d+\/\d+ to the treasury of The Synod$/.test(ps.text), ps && ps.text);
  check(T('a sale at Frostcrag Spire\'s ledger pays the College of Whispers (Nate, 10 Oct)'), pc && pc.owner && pc.owner.kind === 'faction' && pc.owner.name === 'College of Whispers', pc && pc.text);
}

console.log(`\n${checks - failures}/${checks} checks passed${failures ? `, ${failures} FAILED` : ''}`);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left behind */ }
process.exit(failures ? 1 : 0);
