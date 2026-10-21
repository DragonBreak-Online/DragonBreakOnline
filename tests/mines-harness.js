// Mines owned like property (mines.js, Nate 20 Oct): the mine list, sale and tax, access rules, the owner's share, an Orc
// clan's mine and a mine nobody owns. Loads the real mines.js, labour.js, economy.js and tenancy.js against an mp stub in a
// temp working directory with the real mines.json, skills.json and minigames.js. Run it from this folder's parent with
//
//   node tests/mines-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mines-'));
for (const f of ['mines.json', 'skills.json', 'guild-defs.json']) fs.copyFileSync(path.join(SERVER, f), path.join(dir, f));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

let failures = 0;
const check = (label, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

// ---- the mine list ---------------------------------------------------------------------------------------------------
const LIST = JSON.parse(fs.readFileSync('mines.json', 'utf8'));
const M = new Map(LIST.mines.map((m) => [m.id, m]));
const defs = JSON.parse(fs.readFileSync('guild-defs.json', 'utf8'));
const clans = new Set(defs.factions.filter((f) => f.kind === 'stronghold').map((f) => f.id));
check('43 mines in Skyrim and Bruma\'s land (28 mines, 15 bandit camps with ore veins: Nate, 21 Oct)', LIST.mines.length === 43, LIST.counts);
{
  // Ticket #0308: Halted Stream Camp is a mine (outside the one-building cap), out of the dungeon leases, so its hold rents it
  const hs = LIST.mines.find((m) => m.id === 'HaltedStreamCamp01');
  check('Halted Stream Camp is a mine with its rented door, and leaves the leases', !!hs && hs.leaseExcluded === true
    && hs.entrances.some((e) => /^0*460a8:Skyrim\.esm$/i.test(e.inside) || /^0*460a8:Skyrim\.esm$/i.test(e.door)), hs && { lease: hs.lease, ex: hs.leaseExcluded, e: hs.entrances });
}
check('every id is unique', new Set(LIST.mines.map((m) => m.id)).size === LIST.mines.length);
check('every mine has a way in, a hold, a name and its cells', LIST.mines.every((m) => m.entrances.length && m.hold && m.name && m.cells.length), LIST.mines.filter((m) => !(m.entrances.length && m.hold && m.name)).map((m) => m.id));
check('only the open lands: Skyrim and Bruma', LIST.mines.every((m) => m.world === 'skyrim' || m.world === 'bruma'));
check('Bruma\'s four: Bleak-Frost, Frost-Iron, Gutted, Plundered', ['CYRBleakFrostMine01', 'CYRFrostironmine01', 'CYRGuttedMine', 'CYRPlunderedMine'].every((i) => M.has(i) && M.get(i).hold === 'bruma'));
const want = { GloomboundMine: 'clan-narzulbur', DushnikhYalMine: 'clan-dushnikh-yal', MorKhazgurMine: 'clan-mor-khazgur', DuskgourdMine: 'clan-largashbur', GolKharzumMine1: 'clan-gol-kharzum', CrackedTuskMine1: 'clan-cracked-tusk' };
for (const [id, clan] of Object.entries(want)) check(`${M.has(id) ? M.get(id).name : id} belongs to ${clan}`, M.has(id) && M.get(id).clan === clan, M.get(id));
check('six clan mines, every clan a stronghold faction of guild-defs', LIST.mines.filter((m) => m.clan).length === 6 && LIST.mines.filter((m) => m.clan).every((m) => clans.has(m.clan)));
check('Frost-Iron Mine is a lease dungeon kept out of the leases', M.get('CYRFrostironmine01').leaseExcluded === true);
check('the veins carry their ore and the list keeps the Bleak-Frost meteoric-iron veins', M.get('CYRBleakFrostMine01').veins.some((v) => v.ref === '178031:DragonBreak Online Edits.esp'));

// ---- an mp stub: ids by plugin index ---------------------------------------------------------------------------------------
const PLUG = new Map();
const idOf = (desc) => { const [loc, plugin] = String(desc).split(':'); const k = String(plugin).toLowerCase(); if (!PLUG.has(k)) PLUG.set(k, PLUG.size + 1); return ((PLUG.get(k) << 24) | parseInt(loc, 16)) >>> 0; };
const descOf = (id) => { const p = [...PLUG].find(([, i]) => i === id >>> 24); return p ? `${(id & 0xffffff).toString(16)}:${p[0]}` : ''; };
const props = new Map();
const mp = {
  getIdFromDesc: idOf, getDescFromId: descOf,
  get: (id, p) => props.get(`${id >>> 0}|${p}`),
  set: (id, p, v) => props.set(`${id >>> 0}|${p}`, v),
  getActorsByProfileId: (pid) => [...props].filter(([k, v]) => k.endsWith('|profileId') && v === pid).map(([k]) => Number(k.split('|')[0])),
  lookupEspmRecordById: (id) => records.get(id >>> 0) || null,
};
const records = new Map();
const OWNER = 0x20, STRANGER = 0x21, FRIEND = 0x22, CHIEF = 0x30, OFFICER = 0x31, ORC = 0x32;
const pids = { [OWNER]: 11, [STRANGER]: 12, [FRIEND]: 13, [CHIEF]: 20, [OFFICER]: 21, [ORC]: 22 };
for (const [a, pid] of Object.entries(pids)) props.set(`${a}|profileId`, pid);
const near = new Map(); // actor -> meters to anything
// An actor is 2 m from everyone, and 2 m from the doors of the mine it stands at (atMine), 100 m from every other door
const atMine = new Map();
const distanceMeters = (a, b) => {
  if (near.has(a >>> 0)) return near.get(a >>> 0);
  const isDoor = LIST.mines.some((x) => x.entrances.some((e) => idOf(e.door) === (b >>> 0) || idOf(e.inside) === (b >>> 0)));
  if (!isDoor) return 2;
  const m = atMine.get(a >>> 0);
  return m && m.entrances.some((e) => idOf(e.door) === (b >>> 0) || idOf(e.inside) === (b >>> 0)) ? 2 : 100;
};
const at = (a, cell) => props.set(`${a}|worldOrCellDesc`, cell);

// Factions: the owner and FRIEND in the Fighters Guild; Clan Narzulbur's Chief, an officer and a member
const memberships = { [OWNER]: [{ id: 'fighters-guild', name: 'Fighters Guild', role: 'member' }], [FRIEND]: [{ id: 'fighters-guild', name: 'Fighters Guild', role: 'member' }],
  [CHIEF]: [{ id: 'clan-narzulbur', name: 'Clan Narzulbur', role: 'leader' }], [OFFICER]: [{ id: 'clan-narzulbur', name: 'Clan Narzulbur', role: 'officer' }], [ORC]: [{ id: 'clan-narzulbur', name: 'Clan Narzulbur', role: 'member' }] };
globalThis.__dboGuildsOf = (a) => memberships[a >>> 0] || [];
globalThis.__dboGuildInfo = (id) => ({ id, name: ({ 'clan-narzulbur': 'Clan Narzulbur', 'fighters-guild': 'Fighters Guild' })[id] || id });

// The housing registry: claims by door, owned per character
const claims = new Map();
globalThis.__dboHousing = {
  primaryOf: (r) => Number(r) >>> 0, recordOf: (r) => claims.get(Number(r) >>> 0) || null, holdOf: () => 'markarth',
  isManager: (a) => a === 0x40, isFiefHolder: () => false, perCharacter: () => true,
  ownsRecord: (rec, a) => !!rec && (Number(rec.ownerChar) >>> 0) === (a >>> 0),
  ownerKeyOf: (rec) => `c${(Number(rec.ownerChar) >>> 0).toString(16)}`,
  ownerActorsOf: (rec) => [Number(rec.ownerChar) >>> 0],
  grant: (ref, a) => { claims.set(Number(ref) >>> 0, { owner: pids[a], ownerChar: a, ownerName: `P${a.toString(16)}` }); return ''; },
  release: (ref) => claims.delete(Number(ref) >>> 0), isBuilding: () => true,
};

const out = { personal: [], audits: [], widgets: [], items: [], logs: [] };
const handlers = new Map();
const timers = new Map();
const commands = new Map();
const api = {
  mp, log: (...x) => out.logs.push(x.join(' ')), personal: (a, t) => out.personal.push([a, t]), audit: (t) => out.audits.push(t),
  who: (a) => `P${(a >>> 0).toString(16)}`, display: (a) => `P${(a >>> 0).toString(16)}`, ownDisplay: (a) => `P${(a >>> 0).toString(16)}`,
  tagOf: (a) => `T${a}`, profileOf: (a) => pids[a >>> 0] || -1,
  openWidget: (a, w) => { out.widgets.push([a, w]); return true; }, closeWidget: () => true,
  onUi: (ev, f) => handlers.set(ev, (handlers.get(ev) || []).concat([f])), every: (n, ms, f) => timers.set(n, f),
  registerChatCommand: (n, f) => commands.set(n, f), onlineActors: () => Object.keys(pids).map(Number),
  giveItem: (a, id, n) => { out.items.push([a, id, n]); return true; }, distanceMeters, zoneById: (id) => ({ id, name: id === 'markarth' ? 'The Reach' : id, treasury: 'x' }),
  isLeadStaff: () => false, skills: JSON.parse(fs.readFileSync('skills.json', 'utf8')), hasUiCap: () => false, sendPacket: () => true,
  cfg: { mines: {}, labour: { clientJudged: true, perPlayerNodes: false }, economy: { enabled: true, defaultPropertyValue: 500, titheRate: 0.25 } },
};
const fire = (ev, a, args, wid) => (handlers.get(ev) || []).forEach((f) => f(a, args, wid));
const load = (file) => { const p = path.join(SERVER, file); delete require.cache[p]; require(p)(api); };
load('mines.js');

const KOL = M.get('KolskeggrMineMine'), GLOOM = M.get('GloomboundMine'), BLEAK = M.get('CYRBleakFrostMine01'), GUTTED = M.get('CYRGuttedMine');
const door = (m) => idOf(m.entrances[0].door);
const vein = (m) => idOf(m.veins[0].ref);
const lastMenu = (a) => { const w = out.widgets.filter(([x, w2]) => x === a && w2.id === 95).pop(); return w ? w[1] : null; };
const choose = (a, label) => {
  const w = lastMenu(a); const act = w && w.actions.find((x) => (label instanceof RegExp ? label.test(x.label) : x.label === label));
  if (!act) return false;
  fire('mineChoose', a, [act.id]); return true;
};
const panel = (a, m) => { at(a, m.cells[0]); return globalThis.__dboMinePanel(a, m); };

// ---- a mine nobody owns -------------------------------------------------------------------------------------------------
check('a mine nobody owns: anyone strikes its veins', globalThis.__dboMineGate(vein(KOL), STRANGER) === '');
check('...and gives no share', globalThis.__dboMineShareQuote(vein(KOL), STRANGER, '5ace0:Skyrim.esm', 5, 'Gold Ore') === null);
panel(STRANGER, KOL);
check('...its panel says nobody owns it and offers it from the hold', /Owned by nobody/.test(lastMenu(STRANGER).targetName) && lastMenu(STRANGER).actions.some((x) => x.label === 'Buy it from the hold'), lastMenu(STRANGER));
check('a vein outside every mine is nobody\'s business', globalThis.__dboMineGate(0x999999, STRANGER) === '');

// ---- sale and tax ---------------------------------------------------------------------------------------------------------
check('an ordinary mine may be sold', globalThis.__dboMineSaleRefusal(door(KOL)) === '');
check('a clan\'s mine is never sold', /never sold/.test(globalThis.__dboMineSaleRefusal(door(GLOOM))));
check('a lease dungeon\'s mine is a lair, not for sale', /lair/.test(globalThis.__dboMineSaleRefusal(door(GUTTED))));
check('Frost-Iron Mine (kept out of the leases) may be sold', globalThis.__dboMineSaleRefusal(door(M.get('CYRFrostironmine01'))) === '');
check('a mine\'s tax value: 1,000 + 50 a vein (Kolskeggr, 17 veins: 1,850)', globalThis.__dboMineValueOf(door(KOL)) === 1850, globalThis.__dboMineValueOf(door(KOL)));
check('...by either half of its way in', globalThis.__dboMineValueOf(idOf(KOL.entrances[0].inside)) === 1850);
check('a house door has no mine value', globalThis.__dboMineValueOf(0x12345) === null);
check('a mine is no home (housingSystem notHome)', globalThis.__dboHousingNotHome([door(KOL)]) === true && globalThis.__dboHousingNotHome([0x12345]) === false);

// tenancy.js: the hold lists it, a citizen buys it at the door; a clan mine cannot be listed
globalThis.__dboCitizenGates = () => true;
globalThis.__dboCitizenOf = (a) => a === OWNER;
const gold = new Map([[OWNER, 5000], [STRANGER, 5000]]);
const treasury = [];
let nearDoor = door(KOL);
fs.writeFileSync('doors-pos.json', JSON.stringify({ doors: {} }));
fs.writeFileSync('doors.json', JSON.stringify({ doors: {} }));
const tenApi = Object.assign({}, api, {
  takeGold: (a, n) => { if ((gold.get(a) || 0) < n) return false; gold.set(a, gold.get(a) - n); return true; },
  giveGold: (a, n) => { gold.set(a, (gold.get(a) || 0) + n); return true; },
  depositToTreasury: (z, n) => { treasury.push([z, n]); return n; },
});
globalThis.__dboTenancy = { data: null, doors: [] };
const TEN = path.join(SERVER, 'tenancy.js'); delete require.cache[TEN]; require(TEN)(tenApi);
// The nearest load door is the one the test stands at
globalThis.__dboTenancy.doors = [{ desc: 'x', pos: [0, 0, 0], where: 'here', id: 0 }];
Object.defineProperty(globalThis.__dboTenancy.doors[0], 'id', { get: () => nearDoor });
for (const a of [0x40, OWNER, STRANGER, CHIEF]) { props.set(`${a}|pos`, [0, 0, 0]); }
const property = (a, line) => { out.personal.length = 0; commands.get('property')(a, line); return out.personal.map(([, t]) => t).join(' '); };
for (const a of [0x40, OWNER, STRANGER, CHIEF]) at(a, 'here');
check('the hold\'s official puts the mine up for sale', /For sale at 2000 gold/.test(property(0x40, 'sell 2000')), out.personal);
check('a stranger who is no citizen cannot buy it', /Only the citizens/.test(property(STRANGER, 'buy 2000')));
check('a citizen buys it at the door; the price goes to the hold', /It is yours/.test(property(OWNER, 'buy 2000')) && gold.get(OWNER) === 3000 && treasury.some(([, n]) => n === 2000) && claims.get(door(KOL)).ownerChar === OWNER);
nearDoor = door(GLOOM);
check('the hold cannot list a clan\'s mine for sale', /never sold/.test(property(0x40, 'sell 500')));
nearDoor = door(GUTTED);
check('...nor a lair', /lair/.test(property(0x40, 'sell 500')));
// The door's property menu ("Buy or rent") opens the mine's panel at a mine, the market elsewhere
nearDoor = door(KOL); out.widgets.length = 0;
fire('propertyMarket', STRANGER, []);
check('the door\'s property menu opens the mine panel at a mine door', !!lastMenu(STRANGER) && !out.widgets.some(([, w]) => w.type === 'propertyMarket'));
atMine.set(STRANGER, KOL);
choose(STRANGER, 'Buy it from its owner');
check('...whose Buy button opens the property panel', out.widgets.some(([, w]) => w.type === 'propertyMarket'));

// The weekly tax on every mine, and the Legion's tithe only on Cyrodiil's (economy.js)
claims.set(door(BLEAK), { owner: 11, ownerChar: OWNER, ownerName: 'Owner' });
fs.writeFileSync('housing.json', JSON.stringify([door(KOL), door(BLEAK)]));
props.set(`${OWNER}|private.bankGold`, 10000);
const T = { 'county-bruma': 0, 'hold-markarth': 0, 'imperial-legion': 0 };
globalThis.__dboTreasury = { balance: (f) => T[f] || 0, spend: (f, n) => { if ((T[f] || 0) < n) return false; T[f] -= n; return true; }, deposit: (f, n) => { T[f] = (T[f] || 0) + n; return true; }, keyOf: () => 'k' };
globalThis.__dboRealmTerritoryAt = (w, p) => null;
const land = { [door(KOL)]: { id: 'reach', name: 'The Reach', marker: { world: 'tamriel' } }, [door(BLEAK)]: { id: 'bruma', name: 'Bruma', marker: { world: 'bsheartland' } } };
props.set(`${door(KOL)}|worldOrCellDesc`, 'tamriel'); props.set(`${door(BLEAK)}|worldOrCellDesc`, 'bsheartland');
props.set(`${door(KOL)}|pos`, [1, 0, 0]); props.set(`${door(BLEAK)}|pos`, [2, 0, 0]);
globalThis.__dboRealmTerritoryAt = (w, p) => Object.values(land).find((t) => (p[0] === 1 && t.id === 'reach') || (p[0] === 2 && t.id === 'bruma')) || null;
globalThis.__dboRealmOwnerOf = (tid) => (tid === 'bruma' ? 'county-bruma' : 'hold-markarth');
globalThis.__dboRegions = { placeOf: (w) => ({ province: w === 'bsheartland' ? 'cyrodiil' : 'skyrim' }) };
globalThis.__dboGuildInfo = (id) => ({ id, name: id, kind: '' });
delete globalThis.__dboEconomy;
const SUNDAY = Date.UTC(2026, 9, 25, 0, 1); const realNow = Date.now;
fs.writeFileSync('economy.json', JSON.stringify({ rates: { 'county-bruma': 0.1, 'hold-markarth': 0.1 }, values: {}, lastReckoning: SUNDAY - 7 * 86400000 }));
Date.now = () => SUNDAY;
load('economy.js');
timers.get('economy')();
Date.now = realNow;
globalThis.__dboGuildInfo = (id) => ({ id, name: ({ 'clan-narzulbur': 'Clan Narzulbur', 'fighters-guild': 'Fighters Guild' })[id] || id });
const bleakTax = Math.floor((1000 + 50 * BLEAK.veins.length) * 0.1);
check('the Reach taxes the Kolskeggr Mine on its vein value, 1,850: 185 gold', T['hold-markarth'] === 185, T);
check(`Bruma taxes the Bleak-Frost Mine on its vein value: ${bleakTax} gold, less the Imperial tithe`, T['county-bruma'] + T['imperial-legion'] === bleakTax && T['imperial-legion'] === Math.floor(bleakTax * 0.25), T);
const econReports = (() => { try { return JSON.parse(fs.readFileSync('economy.json', 'utf8')).reports || {}; } catch (e) { return {}; } })();
check('a Skyrim mine\'s tax is outside the Legion\'s tithe base: the Reach pays no tithe', !!econReports['hold-markarth'] && !(econReports['hold-markarth'] || {}).tithe && !(econReports['hold-markarth'] || {}).titheTax, econReports['hold-markarth']);
check('a Bruma mine\'s tax is in the tithe base', (econReports['county-bruma'] || {}).titheTax === bleakTax, econReports['county-bruma']);
check('the owner paid both from the bank', props.get(`${OWNER}|private.bankGold`) === 10000 - 185 - bleakTax, props.get(`${OWNER}|private.bankGold`));

// ---- access rules ----------------------------------------------------------------------------------------------------------
check('a bought mine starts open to all', globalThis.__dboMineGate(vein(KOL), STRANGER) === '');
out.widgets.length = 0;
panel(STRANGER, KOL);
check('a stranger sees no rules to set', !lastMenu(STRANGER).actions.some((x) => /Who may mine/.test(x.label)));
panel(OWNER, KOL);
choose(OWNER, /^Who may mine/); choose(OWNER, 'You alone');
check('the owner closes it: a stranger is refused at the vein', /belongs to P20.*closed to all but its owner/.test(globalThis.__dboMineGate(vein(KOL), STRANGER)), globalThis.__dboMineGate(vein(KOL), STRANGER));
check('...the owner still mines it', globalThis.__dboMineGate(vein(KOL), OWNER) === '');
check('...and the change is audited', out.audits.some((t) => /MINE P20 set Kolskeggr Mine \(P20\): access closed/.test(t)), out.audits.slice(-3));
choose(OWNER, /^Who may mine/); choose(OWNER, 'Open to Fighters Guild and the people named');
check('open to the owner\'s faction: a member mines, a stranger does not', globalThis.__dboMineGate(vein(KOL), FRIEND) === '' && /Fighters Guild/.test(globalThis.__dboMineGate(vein(KOL), STRANGER)));
choose(OWNER, 'Name someone beside you'); choose(OWNER, 'P21');
check('a named stranger may mine there', globalThis.__dboMineGate(vein(KOL), STRANGER) === '' && out.personal.some(([a, t]) => a === STRANGER && /You may now mine at Kolskeggr/.test(t)));
choose(OWNER, /^Who may mine/); choose(OWNER, 'Only the people named');
check('named only: the named stranger yes, the guild member no', globalThis.__dboMineGate(vein(KOL), STRANGER) === '' && globalThis.__dboMineGate(vein(KOL), FRIEND) !== '');
choose(OWNER, /^Strike a name/); choose(OWNER, 'P21');
check('a struck name is refused again', globalThis.__dboMineGate(vein(KOL), STRANGER) !== '');
choose(OWNER, /^Who may mine/); choose(OWNER, 'Open to every miner');
check('reopened to all', globalThis.__dboMineGate(vein(KOL), STRANGER) === '' && globalThis.__dboMineGate(vein(KOL), FRIEND) === '');
check('a vein placed in the mine\'s cell counts as the mine\'s', (() => { props.set(`${0xff000123}|worldOrCellDesc`, KOL.cells[0]); choose(OWNER, /^Who may mine/); choose(OWNER, 'You alone'); const r = globalThis.__dboMineGate(0xff000123, STRANGER) !== ''; choose(OWNER, /^Who may mine/); choose(OWNER, 'Open to every miner'); return r; })());
check('the rules are kept in mines-state.json', JSON.parse(fs.readFileSync('mines-state.json', 'utf8')).rules.KolskeggrMineMine.access === 'open');

// ---- the share -------------------------------------------------------------------------------------------------------------
choose(OWNER, /^The owner's share/); choose(OWNER, '20%');
const q = globalThis.__dboMineShareQuote(vein(KOL), STRANGER, '5ace0:Skyrim.esm', 5, 'Gold Ore');
check('20% of a stranger\'s 5 ore is 1 to the owner', !!q && q.cut === 1 && q.to === 'P20', q);
check('...nothing is stored until the miner\'s part is in hand', !JSON.parse(fs.readFileSync('mines-state.json', 'utf8')).stock.KolskeggrMineMine);
q.commit();
check('...then it is in the mine\'s store', JSON.parse(fs.readFileSync('mines-state.json', 'utf8')).stock.KolskeggrMineMine.c20['5ace0:Skyrim.esm'] === 1);
check('the owner pays no share', globalThis.__dboMineShareQuote(vein(KOL), OWNER, '5ace0:Skyrim.esm', 5, 'Gold Ore') === null);
let cuts = 0; for (let i = 0; i < 2000; i++) { const x = globalThis.__dboMineShareQuote(vein(KOL), STRANGER, '5ace0:Skyrim.esm', 1, 'Gold Ore'); cuts += x ? x.cut : 0; }
check('a yield of 1 at 20% goes to the owner about one time in five', cuts > 300 && cuts < 500, cuts);
check('the share cannot pass maxShare', (() => { const before = out.audits.length; fire('mineChoose', OWNER, [`${(lastMenu(OWNER).actions[0].id.split('|')[0])}|share:90`]); return !out.audits.slice(before).some((t) => /share 90/.test(t)); })());
// labour.js: a won round in the mine at a 50% share (a Master miner's 2 gold ore: 1 each, no chance in it)
panel(OWNER, KOL); choose(OWNER, /^The owner's share/); choose(OWNER, '50%');
load('labour.js');
records.set(idOf('10dcc9:Skyrim.esm'), { record: { type: 'ACTI', editorId: 'MineOreGold01' } });
props.set(`${vein(KOL)}|baseDesc`, '10dcc9:Skyrim.esm');
props.set(`${STRANGER}|private.mastery`, { order: ['miner'], skills: { miner: { rank: 4 } } });
let clock = 0; globalThis.performance = { now: () => clock };
out.widgets.length = 0; out.items.length = 0;
globalThis.__dboLabour(vein(KOL), STRANGER);
const round = out.widgets.filter(([, w]) => w.type === 'labour').pop()[1];
const mk = (ms, sw) => { const ph = (ms % (sw * 2)) / sw; return ph <= 1 ? ph * 100 : (2 - ph) * 100; };
const strikes = []; let ready = 0;
for (const b of round.bands) { let t = ready; while (Math.abs(mk(t, round.sweepMs) - b) > round.band) t++; strikes.push(t); ready = t + round.hitMs; }
clock = strikes[strikes.length - 1] + 200;
const cfgOre = Number((JSON.parse(fs.readFileSync(path.join(SERVER, 'skills.json'), 'utf8')).skills.find((k) => k.id === 'miner').yieldMultiplierByTier || [])[4]) || 1;
fire('labour', STRANGER, [round.nonce, JSON.stringify(strikes), strikes[strikes.length - 1] + 100, JSON.stringify({ v: 1, win: true, hits: round.strikes })], 33);
const gave = out.items.filter(([a]) => a === STRANGER).map(([, , n]) => n);
const text = (out.widgets.filter(([, w]) => w.type === 'labour').pop() || [])[1];
check('a won round in an owned mine gives the miner the yield less the share', gave.length === 1 && gave[0] === cfgOre - Math.floor(cfgOre / 2) && /1 more goes to P20, the mine's share/.test(text.result || ''), { gave, result: text && text.result, cfgOre });
check('...and the MINE audit names the share', out.audits.some((t) => /MINE P21 worked a gold seam .*to P20, the share of Kolskeggr Mine/.test(t)), out.audits.slice(-2));
// The owner collects at the mine
panel(OWNER, KOL); out.items.length = 0;
check('the owner sees the store to collect', choose(OWNER, /^Collect the share: \d+ Gold Ore/), lastMenu(OWNER).actions.map((x) => x.label));
check('...and collects it into the pack', out.items.some(([a, id, n]) => a === OWNER && id === idOf('5ace0:Skyrim.esm') && n >= 1) && out.audits.some((t) => /collected the share of Kolskeggr Mine/.test(t)));
// The hourly summary of shares paid
out.audits.length = 0; globalThis.__dboMinesFlush();
check('shares are summed into one audit line per mine', out.audits.length === 1 && /MINE share Kolskeggr Mine -> P20: \d+ Gold Ore from 1 miner/.test(out.audits[0]), out.audits);
// A walked-away panel acts on nothing
at(OWNER, 'elsewhere'); near.set(OWNER, 500);
const auditsBefore = out.audits.length; choose(OWNER, /^Who may mine/);
check('a panel left behind acts on nothing', out.audits.length === auditsBefore && out.personal.some(([a, t]) => a === OWNER && /walked away/.test(t)));
near.delete(OWNER);

// ---- a new owner starts from the defaults; the old owner keeps the old store -------------------------------------------------
globalThis.__dboMineShareQuote(vein(KOL), STRANGER, '5ace0:Skyrim.esm', 10, 'Gold Ore').commit();
claims.set(door(KOL), { owner: 13, ownerChar: FRIEND, ownerName: 'P22' });
check('a new owner: open and no share again', globalThis.__dboMineGate(vein(KOL), STRANGER) === '' && globalThis.__dboMineShareQuote(vein(KOL), STRANGER, '5ace0:Skyrim.esm', 10, 'Gold Ore') === null);
panel(OWNER, KOL); out.items.length = 0;
check('the former owner collects the share left from their time', choose(OWNER, /^Collect your share from when you held it/) && out.items.some(([a, , n]) => a === OWNER && n === 5), out.items);
panel(FRIEND, KOL);
check('the new owner sees none of it', !lastMenu(FRIEND).actions.some((x) => /^Collect/.test(x.label)));

// ---- an Orc clan's mine ----------------------------------------------------------------------------------------------------
check('Gloombound Mine is Clan Narzulbur\'s, held by the clan with no claim needed', globalThis.__dboMines.ownerOf('GloomboundMine').kind === 'clan');
check('...open to all at first', globalThis.__dboMineGate(vein(GLOOM), STRANGER) === '');
panel(ORC, GLOOM);
check('a clan member sets no rules', !lastMenu(ORC).actions.some((x) => /Who may mine/.test(x.label)) && !lastMenu(ORC).actions.some((x) => /^Buy|^Sell/.test(x.label)));
panel(CHIEF, GLOOM);
check('the Chief sets them, and the panel offers no sale', lastMenu(CHIEF).actions.some((x) => /Who may mine/.test(x.label)) && !lastMenu(CHIEF).actions.some((x) => /^Buy|^Sell/.test(x.label)));
choose(CHIEF, /^Who may mine/); choose(CHIEF, 'The clan alone');
check('the clan alone: a stranger is refused, every clan member mines', /Clan Narzulbur.*worked by the clan alone/.test(globalThis.__dboMineGate(vein(GLOOM), STRANGER)) && globalThis.__dboMineGate(vein(GLOOM), ORC) === '' && globalThis.__dboMineGate(vein(GLOOM), OFFICER) === '');
panel(OFFICER, GLOOM); choose(OFFICER, /^Who may mine/); choose(OFFICER, 'Open to every miner'); choose(OFFICER, /^The owner's share/); choose(OFFICER, '10%');
const cq = globalThis.__dboMineShareQuote(vein(GLOOM), STRANGER, '5acdd:Skyrim.esm', 10, 'Orichalcum Ore');
check('an officer opens it with a 10% share: 1 of 10 to the clan, none from a clan member', !!cq && cq.cut === 1 && cq.to === 'Clan Narzulbur' && globalThis.__dboMineShareQuote(vein(GLOOM), ORC, '5acdd:Skyrim.esm', 10, 'Orichalcum Ore') === null, cq);
cq.commit();
panel(ORC, GLOOM);
check('a clan member cannot collect the clan\'s store', !lastMenu(ORC).actions.some((x) => /^Collect/.test(x.label)));
panel(CHIEF, GLOOM); out.items.length = 0;
check('the Chief collects it', choose(CHIEF, /^Collect the share: 1 Orichalcum Ore/) && out.items.some(([a, , n]) => a === CHIEF && n === 1));

// ---- guilds.js: a clan's mine is the clan's hall (lairs left out) ------------------------------------------------------------
fs.writeFileSync('guilds.json', JSON.stringify({ 'clan-narzulbur': { [String(CHIEF)]: { rank: 0, name: 'Chief', since: 0 }, [String(ORC)]: { rank: 5, name: 'Orc', since: 0 } },
  'clan-cracked-tusk': { [String(OFFICER)]: { rank: 0, name: 'Chief', since: 0 } } }));
const saved = { info: globalThis.__dboGuildInfo, of: globalThis.__dboGuildsOf };
const noop = () => {};
const GUILDS = path.join(SERVER, 'guilds.js'); delete require.cache[GUILDS];
require(GUILDS)({ mp, log: noop, personal: noop, system: noop, audit: noop, registerChatCommand: noop, onUi: noop, openWidget: noop, closeWidget: noop,
  display: api.display, who: api.who, nameOf: api.display, tagOf: () => 'TAG', onlineActors: () => [], isAdmin: () => false, findByName: () => 0,
  cfg: { mines: {} }, profileOf: api.profileOf });
const hallOf = (m) => globalThis.__dboHallOf([door(m)]);
check('guilds.js: Gloombound Mine\'s door is Clan Narzulbur\'s hall door', JSON.stringify(hallOf(GLOOM)) === '["clan-narzulbur"]', hallOf(GLOOM));
check('...its Chief holds it as a hall\'s leader (no home cap) and a clan member shares it', globalThis.__dboHallLeader([door(GLOOM)], CHIEF) === true && globalThis.__dboHallMember([door(GLOOM)], 0, ORC) === true && globalThis.__dboHallMember([door(GLOOM)], 0, STRANGER) === false);
// The strongholds release (21 Oct: AIO + CrackedTuskKeepExpanded + the Strongholds Fix): CTK's own mine is the clan's, and
// the Fix switches off Bilegulch's old door, so Bilegulch is no mine any more
check('...CrackedTuskMine1 (CTK) is Clan Cracked Tusk\'s hall door', JSON.stringify(hallOf(M.get('CrackedTuskMine1'))) === '["clan-cracked-tusk"]', hallOf(M.get('CrackedTuskMine1')));
check('...and Bilegulch is gone from mines.json', !M.has('BilegulchMine'));
globalThis.__dboGuildInfo = saved.info; globalThis.__dboGuildsOf = saved.of;

// ---- switched off ------------------------------------------------------------------------------------------------------
api.cfg.mines = { enabled: false }; load('mines.js');
check('mines.enabled false: closed rules no longer bind, no share, no sale refusal, mines count as homes', globalThis.__dboMineGate(vein(GLOOM), STRANGER) === '' && globalThis.__dboMineShareQuote(vein(GLOOM), STRANGER, '5acdd:Skyrim.esm', 10, 'x') === null && globalThis.__dboMineSaleRefusal(door(GLOOM)) === '' && globalThis.__dboHousingNotHome([door(KOL)]) === false);

console.log(failures ? `${failures} failure(s)` : 'all checks passed');
process.exit(failures ? 1 : 0);
