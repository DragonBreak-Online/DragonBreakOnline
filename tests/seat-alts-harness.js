'use strict';
// Court seats per character (Nate, 19 Oct: "an account's other characters do not hold its office"; 3419354a4 binds a seat to
// the character seated in officials-seats.json). Three readers still asked officials.json by account, so another character
// of an official's account kept the office's powers there:
//   citizenship.js  the ruler's and the Steward's citizenship powers (policy, grant, decline) and Bruma's citizenship by office
//   guilds.js       a building shared with an office (Castle Bruma and Bruma's Steward, housingPlaces.shares)
//   weaponracks.js  a hold manager taking racked weapons down
// Loads the real modules (weaponracks' managerRank is cut out of the file) against stubs, in a scratch folder.
//   node tests/seat-alts-harness.js [server folder]   (from server/)
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRV = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-alts-'));
process.chdir(scratch);
process.on('exit', () => { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* left */ } });
let fail = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fail++; };

// Misfit_Panda's account (55): Mista Bojangles is Whiterun's Steward, Pippins the Tall is not. Bruma's Steward (150) likewise.
const MISTA = 0xff000746, PIPPIN = 0xff0024c0, CARLOFT = 0xff0017ea, CARLOFT_ALT = 0xff009999, OUTSIDER = 0xff001111;
const PID = new Map([[MISTA, 55], [PIPPIN, 55], [CARLOFT, 150], [CARLOFT_ALT, 150], [OUTSIDER, 7]]);
const NAME = new Map([[MISTA, 'Mista Bojangles'], [PIPPIN, 'Pippins the Tall'], [CARLOFT, 'Carloft Fhang'], [CARLOFT_ALT, 'Carloft Alt'], [OUTSIDER, 'Outsider']]);
const officials = { whiterun: { jarl: [167], steward: [55] }, bruma: { count: [35], steward: [150] } };
const seats = { whiterun: { steward: { 55: MISTA } }, bruma: { steward: { 150: CARLOFT } } };
fs.writeFileSync('officials.json', JSON.stringify(officials));
fs.writeFileSync('officials-seats.json', JSON.stringify(seats));
// gamemode.js's seatHolder, as it reads officials-seats.json
globalThis.__dboSeatHolder = (z, r, pid) => Number((((seats[z] || {})[r] || {})[pid])) >>> 0;
const profileOf = (a) => (PID.has(a >>> 0) ? PID.get(a >>> 0) : -1);

// ---- citizenship.js ----------------------------------------------------------------------------------------------------
const ZONES = [
  { id: 'bruma', name: 'Bruma', treasury: 'x', officials: ['count', 'steward', 'captain', 'courtmage', 'guard'] },
  { id: 'whiterun', name: 'Whiterun', treasury: 'y', officials: ['jarl', 'steward', 'commander', 'courtmage', 'guardcaptain', 'guard'] },
];
globalThis.__dboGuildsOf = () => [];
globalThis.__dboCourtFaction = () => null;
globalThis.__dboGuildHolders = () => [];
const mp = {
  get: (id, p) => {
    if (!PID.has(id >>> 0)) throw new Error('no such form');
    if (p === 'type') return 'MpActor';
    if (p === 'profileId') return PID.get(id >>> 0);
    if (p === 'appearance') return { raceId: 0x13746 };
    return undefined;
  },
  lookupEspmRecordById: () => ({ record: { editorId: 'NordRace' } }),
};
const noop = () => {};
const C = require(path.join(SRV, 'citizenship.js'))({
  mp, log: noop, audit: noop, who: (a) => NAME.get(a >>> 0) || 'someone', personal: noop, nameOf: (a) => NAME.get(a >>> 0), ownNameOf: (a) => NAME.get(a >>> 0),
  tagOf: () => 'TAG', onUi: noop, onlineActors: () => [...PID.keys()], isAdmin: () => false, isLeadStaff: () => false, profileOf,
  cfg: { citizenship: {} }, every: noop, zoneList: () => ZONES, zoneById: (id) => ZONES.find((z) => z.id === String(id)) || null,
  readOfficials: () => officials, rankTitle: (r) => r, officialTarget: () => ({ error: 'none' }),
  accountActors: (pid) => [...PID.entries()].filter(([, p]) => p === pid).map(([a]) => a), seatOfficial: () => ({ text: '' }), unseatOfficialBy: () => ({ text: '' }),
  takeGold: () => true, depositToTreasury: () => 0, openWidget: () => true, closeWidget: noop, boardZoneNear: () => null, raceEdidOf: () => 'NordRace',
});
let r = C.setPolicy(MISTA, 'whiterun', 'paid', 100);
ok(!r.error, 'citizenship: Mista Bojangles, the seated Steward, sets how Whiterun grants citizenship', r);
r = C.setPolicy(PIPPIN, 'whiterun', 'free');
ok(!!r.error, 'citizenship: Pippins the Tall, the same account, may not', r);
r = C.setPolicy(OUTSIDER, 'whiterun', 'free');
ok(!!r.error, 'citizenship: nor may anyone else', r);
ok(C.holdsOf(CARLOFT).some((h) => h.zone === 'bruma' && h.auto), "citizenship: Bruma's seated Steward is a Bruma citizen by the office", C.holdsOf(CARLOFT));
ok(!C.holdsOf(CARLOFT_ALT).some((h) => h.zone === 'bruma'), "citizenship: the Steward's other character is not", C.holdsOf(CARLOFT_ALT));
// An unbound seat still counts for the whole account (as gamemode.js ranksOf does)
delete seats.bruma.steward[150];
ok(C.holdsOf(CARLOFT_ALT).some((h) => h.zone === 'bruma' && h.auto), 'citizenship: an unbound seat still counts for the account', C.holdsOf(CARLOFT_ALT));
seats.bruma.steward[150] = CARLOFT;

// ---- guilds.js: a building shared with an office -------------------------------------------------------------------------
fs.copyFileSync(path.join(SRV, 'guild-defs.json'), 'guild-defs.json');
const CASTLE = 0x0806c473;
const props = new Map();
require(path.join(SRV, 'guilds.js'))({
  mp: { get: (id, p) => props.get(`${id}|${p}`), set: (id, p, v) => props.set(`${id}|${p}`, v), getDescFromId: (id) => ((id >>> 0) === CASTLE ? '6c473:BSHeartland.esm' : '') },
  log: noop, personal: noop, system: noop, audit: noop, registerChatCommand: noop, onUi: noop, openWidget: noop, closeWidget: noop,
  display: (a) => NAME.get(a >>> 0) || '?', who: (a) => NAME.get(a >>> 0) || '?', nameOf: (a) => NAME.get(a >>> 0) || '?', tagOf: () => 'TAG',
  onlineActors: () => [...PID.keys()], isAdmin: () => false, isLeadStaff: () => false, findByName: () => 0, findAnyByName: () => 0,
  cfg: { housingPlaces: { shares: { '6c473:bsheartland.esm': ['bruma:steward'] } } }, profileOf, readOfficials: () => officials,
});
ok(globalThis.__dboHallOffice([CASTLE], 35, CARLOFT) === true, "guilds: Bruma's seated Steward shares Castle Bruma");
ok(globalThis.__dboHallOffice([CASTLE], 35, CARLOFT_ALT) === false, "guilds: the Steward's other character does not");
ok(globalThis.__dboHallMember([CASTLE], 35, CARLOFT_ALT) === false, '...and is no member of the hall through it');

// ---- weaponracks.js: a hold manager takes racked weapons down -------------------------------------------------------------
const WR = fs.readFileSync(path.join(SRV, 'weaponracks.js'), 'utf8');
const from = WR.indexOf('  const MANAGER_RANKS = '), to = WR.indexOf('  const holdOfHome = ');
ok(from > 0 && to > from, 'weaponracks: managerRank found in the file');
const managerRank = new Function('fs', 'path', 'S', 'log', 'profileOf', 'mp', `${WR.slice(from, to)}; return managerRank;`)(
  fs, path, {}, noop, profileOf, { get: () => undefined });
ok(managerRank(MISTA, 'whiterun') === 'steward', "weaponracks: Whiterun's seated Steward manages its racks", managerRank(MISTA, 'whiterun'));
ok(managerRank(PIPPIN, 'whiterun') === '', "weaponracks: the Steward's other character does not", managerRank(PIPPIN, 'whiterun'));

console.log(fail ? `${fail} failed` : 'all checks passed');
process.exit(fail ? 1 : 0);
