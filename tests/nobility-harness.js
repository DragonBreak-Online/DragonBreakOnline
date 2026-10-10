// The nobility (nobility.js, docs/nobility/DESIGN.md; Nate, 10 Oct): the real nobility-fiefs.json, nobility.js, economy.js
// and bank.js against stubs in a temp folder. Covers: off by default (no tab, no fief power, no tax share); which fief a
// reference stands in (interior cell, worldspace cell, neither); only the hold's ruler grants and revokes, never staff, a
// steward or the ruler's own account; titles gendered by the character (Baroness, Dame, Lady, Countess); one holder per fief
// and one title per character per hold; a changed title says what it was; estates named and filtered; the decrees' words;
// the fork's questions (holdsFiefAt, holderOf); the 25% fief share of the weekly tax into a deposit-only fief treasury, the
// hold keeping the rest and the tithe counting what it kept; the migration seed for Lord Elion applied once; Skyrim's Lord
// and Thane under a Jarl; the tab's views; a deleted character's title lapsing; the pending patch note.
//
//   node tests/nobility-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
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
const COUNTESS = 0x14, ELION = 0x15, ELION_ALT = 0x19, STEWARD = 0x16, ADMIN = 0x10, DAME = 0x17, OUT = 0x18, JARL = 0x1a, GONE = 0x1b;
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
];
const zoneById = (id) => zones.find((z) => z.id === String(id)) || null;
let officials = { bruma: { count: [11], steward: [12] }, riften: { jarl: [20] } };
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
ok('the fiefs are the four towns of the Bruma lock (Greenwood since Nate\'s go), all Bruma\'s', FIEFS.map((f) => f.id).sort().join() === 'aleswell,applewatch,greenwood,mountain-watch' && FIEFS.every((f) => f.hold === 'bruma' && f.cells.length && f.grid.length));
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

announced.length = 0;
const r1 = ui('nobilityGrant', COUNTESS, 'bruma', 'Kesta', 'knight');
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
officials = { bruma: { count: [11], steward: [12] }, riften: { jarl: [20] } };
globalThis.__dboGuildsOf = (a) => (a === JARL ? [{ id: 'hold-riften', role: 'leader' }] : []);

// ---- Skyrim -----------------------------------------------------------------------------------------------------------------
announced.length = 0;
ok('a Skyrim hold grants Lord and Thane', /Lord\/Lady, Thane/.test(ui('nobilityGrant', JARL, 'riften', 'Kesta', 'baron').text));
ui('nobilityGrant', JARL, 'riften', 'Kesta', 'thane');
ok('a Thane is named by the Jarl of the Rift', announced[0] === 'By decree of the Jarl of the Rift, Kesta is named Thane of the Rift.', announced);
ok('a title in another hold is a second title', JSON.parse(fs.readFileSync('nobility.json', 'utf8')).nobles.filter((n) => n.actor === DAME).length === 2);
ok('the Jarl has no say in Bruma', /Only the Count or Countess/.test(ui('nobilityGrant', JARL, 'bruma', 'Kesta', 'knight').text));

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
ui('nobilityGrant', COUNTESS, 'bruma', 'Brief', 'baron', 'aleswell');
ok('granted to a character offline', N.holderOf('aleswell') && N.holderOf('aleswell').actor === GONE);
deleted.add(GONE);
ok('once the character is deleted the fief is vacant and the roll forgets him', N.holderOf('aleswell') === null && !brumaOf(SEC.view(OUT)).roll.some((n) => n.name === 'Brief'));

// ---- a hot reload keeps the titles -------------------------------------------------------------------------------------------
load({ nobility: { enabled: true } });
ok('a reload keeps the titles', globalThis.__dboNobility.holderOf('mountain-watch').actor === ELION);
load({ nobility: { enabled: false } });
ok('switched off again: the tab goes and the fork is told nothing', !globalThis.__dboJournalSections.nobility && globalThis.__dboNobility.holdsFiefAt(ELION, [MW_DOOR]) === false);

// ---- the patch note waits for the switch ---------------------------------------------------------------------------------------
const pending = path.join(ROOT, 'docs', 'patch-notes-pending', 'nobility.json');
const note = fs.existsSync(pending) ? JSON.parse(fs.readFileSync(pending, 'utf8'))[0] : null;
ok('the patch note is pending (the switch is off), dated SHIP_DATE', !!note && note.date === 'SHIP_DATE' && note.version === 'Server update' && /Baron/.test(JSON.stringify(note)));
const live = JSON.parse(fs.readFileSync(path.join(ROOT, 'patch-notes.json'), 'utf8'));
ok('and not in the live patch notes', !live.some((n) => /nobility|Baron/i.test(JSON.stringify(n.sections || [])) && /fief/i.test(JSON.stringify(n))));
const gcfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
ok('gamemode-config ships it off, with Elion\'s seed', gcfg.nobility && gcfg.nobility.enabled === false && gcfg.nobility.fiefShare === 0.25 && gcfg.nobility.seed[0].fief === 'mountain-watch');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
