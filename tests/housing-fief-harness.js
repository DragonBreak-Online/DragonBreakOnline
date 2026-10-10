// A fief's powers in the fork's housing (housingSystem.ts isFiefHolder / fiefExempt; gameplay nobility.js __dboNobility;
// Nate, 10 Oct): the holder of a fief manages the property inside it as a steward does (revoke, hand over, rooms), opens it,
// and their own buildings there do not count against the one-building cap; outside their fief they are an ordinary player,
// another character of their account holds nothing, and the gameplay's isManager (assessments, renting) stays hold-wide
// managers only. Their actions on others' property go to the admin log as a fief holder's. Without __dboNobility (the
// nobility off) nobody has any of it.
//   node tests/housing-fief-harness.js <bundled housingSystem.js>
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const bundle = process.argv[2];
if (!bundle) { console.error('usage: node tests/housing-fief-harness.js <bundled housingSystem.js>'); process.exit(2); }
const { HousingSystem } = require(path.resolve(bundle));
if (typeof HousingSystem.prototype.isFiefHolder !== 'function') { require('./expect')('housing-fief', 'this housingSystem has no fief powers'); console.log('skipped: no fief powers in this housingSystem'); process.exit(0); }
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };
const H = (n) => (0x08000000 | n) >>> 0;
// Mountain Watch: two houses of the Baron's, one of a townsman's (with a member chest), one free; Bruma city: one of the Baron's
const MW_A = H(0x6543f), MW_B = H(0x65440), MW_TOWN = H(0x65441), MW_TOWN_CHEST = H(0x65442), MW_FREE = H(0x6ca03), CITY = H(0x1093), CITY_FREE = H(0x1114);
const FIEF = new Set([MW_A, MW_B, MW_TOWN, MW_TOWN_CHEST, MW_FREE]);
const BARON = 0xff000070, ALT = 0xff000071, TOWNSMAN = 0xff000072, NEWBIE = 0xff000073, STEWARD = 0xff000074, GM = 0xff000075;
const PROFILE = { [BARON]: 70, [ALT]: 70, [TOWNSMAN]: 72, [NEWBIE]: 73, [STEWARD]: 74, [GM]: 75 };
const USER = { [BARON]: 1, [ALT]: 2, [TOWNSMAN]: 3, [NEWBIE]: 4, [STEWARD]: 5, [GM]: 6 };
const ROLES = { [GM]: ['role-leadgm'] };
const props = new Map();
const notices = [], adminLog = [];
const mp = {
  get: (id, k) => {
    if (k === 'profileId') return PROFILE[id >>> 0] || 0;
    if (k === 'private.discordRoles') return ROLES[id >>> 0] || [];
    if (k === 'appearance') return { name: 'P' + (PROFILE[id >>> 0] || 0) };
    if (k === 'inventory') return { entries: [] };
    const v = props.get(`${id >>> 0}:${k}`); return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  },
  set: (id, k, v) => props.set(`${id >>> 0}:${k}`, JSON.parse(JSON.stringify(v))),
  getUserByActor: (id) => USER[id >>> 0] || -1,
  getUserActor: (u) => Number(Object.keys(USER).find((a) => USER[a] === u) || 0),
  isConnected: () => false,
  sendCustomPacket: (u, raw) => { const p = JSON.parse(raw); if (p.customPacketType === 'propertyNotice') notices.push([u, p.text]); },
};
const ctx = { svr: mp };
globalThis.__alduinakAdminLog = (t) => adminLog.push(t);
const nobility = {
  fiefOf: (refs) => (refs.some((r) => FIEF.has(r >>> 0)) ? 'mountain-watch' : ''),
  holderOf: (id) => (id === 'mountain-watch' ? { actor: BARON, profile: 70, name: 'Lord Elion' } : null),
  holdsFiefAt: (a, refs) => (a >>> 0) === BARON && nobility.fiefOf(refs) === 'mountain-watch',
};
const base = (o) => Object.assign({ owner: 0, ownerName: '', name: null, locked: false, serial: 1, partner: 0, containers: [], issued: [] }, o);
const seed = () => {
  props.clear();
  props.set(`${MW_A}:private.housing`, base({ owner: 70, ownerName: 'Lord Elion' }));
  props.set(`${MW_B}:private.housing`, base({ owner: 70, ownerName: 'Lord Elion' }));
  props.set(`${MW_TOWN}:private.housing`, base({ owner: 72, ownerName: 'Zurikki', locked: true, place: { cells: ['65441:BSHeartland.esm'], builtAt: 1 } }));
  props.set(`${MW_TOWN_CHEST}:private.housing`, base({ owner: 72, ownerName: 'Zurikki', memberOf: MW_TOWN, locked: true }));
  props.set(`${CITY}:private.housing`, base({ owner: 70, ownerName: 'Lord Elion' }));
};
const build = (mode) => {
  const sys = new HousingSystem(() => {});
  sys.placeMigration = mode;
  sys.roleCfg = { tierRoles: { senior: [], developer: [], leadgm: ['role-leadgm'], gm: [] }, adminRoleIds: [], adminProfileIds: [] };
  sys.holdOf = () => 'bruma';
  sys.holdRanks = (c, a) => (a === STEWARD ? [{ hold: 'bruma', rank: 'steward' }] : []);
  sys.saveRegistry = () => {};
  sys.primaryOf = (c, id) => id >>> 0;
  sys.partnerOf = () => 0;
  sys.withinReach = () => true; sys.nearProperty = () => true; sys.standsInPlaceOf = () => true;
  sys.isEntrance = (c, p) => p !== MW_TOWN_CHEST;
  sys.sendMenu = () => {};
  sys.claimed = [MW_A, MW_B, MW_TOWN, MW_TOWN_CHEST, CITY];
  return sys;
};
const rec = (ref) => props.get(`${ref}:private.housing`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-fief-'));
const home = process.cwd();
process.chdir(dir);
try {
  fs.writeFileSync('gamemode-config.json', JSON.stringify({ housingPlaces: { staffProfiles: [] } }));
  const request = (sys, actor, action, target, extra) => { notices.length = 0; sys.lastRequestMs.clear(); sys.onPropertyRequest(ctx, USER[actor], Object.assign({ action, target }, extra || {})); return notices.map((n) => n[1]).join(' | '); };

  // ---- without the nobility ----------------------------------------------------------------------------------------------
  seed();
  delete globalThis.__dboNobility;
  let sys = build('apply');
  ok(!sys.isManager(ctx, BARON, MW_TOWN) && !sys.isFiefHolder(ctx, BARON, MW_TOWN), 'without __dboNobility nobody holds a fief or manages by it');
  ok(sys.countPlaces(ctx, 70) === 3 && sys.overCap(ctx, 70, BARON, false, true, MW_FREE) !== '', 'and every building counts against the cap', sys.countPlaces(ctx, 70));

  // ---- with it -----------------------------------------------------------------------------------------------------------
  globalThis.__dboNobility = nobility;
  seed();
  sys = build('apply');
  sys.exposeTenancy(ctx);
  ok(sys.isManager(ctx, BARON, MW_TOWN) && sys.isManager(ctx, BARON, MW_TOWN_CHEST), 'the Baron manages a townsman\'s house and its chest inside his fief');
  ok(!sys.isManager(ctx, BARON, CITY_FREE), '...and nothing outside it');
  ok(!sys.isManager(ctx, ALT, MW_TOWN) && !sys.isManager(ctx, TOWNSMAN, MW_A), 'another character of his account has no say, nor does the townsman in his');
  ok(globalThis.__dboHousing.isManager(BARON, MW_TOWN) === false && globalThis.__dboHousing.isFiefHolder(BARON, MW_TOWN) === true && globalThis.__dboHousing.isManager(STEWARD, MW_TOWN) === true,
    "the gameplay's isManager (assessments, renting) stays hold-wide; isFiefHolder tells the fief's");
  ok(sys.hasAccess(ctx, MW_TOWN, rec(MW_TOWN), BARON) && !sys.hasAccess(ctx, MW_TOWN, rec(MW_TOWN), ALT), 'he opens a locked house of his fief as a steward does; his alt does not');
  ok(sys.ownsOrManages(ctx, MW_TOWN, rec(MW_TOWN), sys.viewerAccess(ctx, BARON)), '...and its member chest\'s owner-or-manager test passes for him');

  // The cap
  ok(sys.countPlaces(ctx, 70) === 1, 'his two buildings in the fief are not counted; the one in Bruma city is', sys.countPlaces(ctx, 70));
  ok(sys.overCap(ctx, 70, BARON, false, true, MW_FREE) === '', 'he may take any number of buildings in his fief');
  ok(/one each/.test(sys.overCap(ctx, 70, BARON, false, true, CITY_FREE)), '...but a second outside it is refused (he holds Bruma city\'s)');
  ok(/one each/.test(sys.overCap(ctx, 70, ALT, false, true, MW_FREE)), 'his other character is capped in the fief like anyone');
  ok(globalThis.__dboHousing.grant(MW_FREE, BARON) === '' && rec(MW_FREE).owner === 70, 'a grant (tenancy) of a fief building to him passes the cap');

  // Steward's work inside the fief
  let said = request(sys, BARON, 'transfer', MW_TOWN, { recipient: NEWBIE });
  ok(rec(MW_TOWN).owner === 73, 'he hands a townsman\'s house to someone else', said);
  ok(adminLog.some((t) => /^HOUSING fief holder: actor ff000070 .* transfer on /.test(t)), 'logged as a fief holder\'s action, not a staff override', adminLog);
  said = request(sys, BARON, 'revoke', MW_TOWN);
  ok(rec(MW_TOWN).owner === 0 && /Revoked|revoked|taken/i.test(said), 'he takes a house back', said);
  props.set(`${CITY_FREE}:private.housing`, base({ owner: 72, ownerName: 'Zurikki' }));
  sys.claimed.push(CITY_FREE);
  said = request(sys, BARON, 'revoke', CITY_FREE);
  ok(rec(CITY_FREE).owner === 72 && /cannot revoke/.test(said), 'outside his fief he cannot', said);
  said = request(sys, STEWARD, 'revoke', CITY_FREE);
  ok(rec(CITY_FREE).owner === 0, 'the hold\'s steward still can, anywhere in the hold', said);
  adminLog.length = 0;
  request(sys, GM, 'rename', MW_A, { name: 'Bunkhouse' });
  ok(adminLog.some((t) => /^HOUSING staff override:/.test(t)), 'staff overrides are still logged as such');

  // ---- without the place rules: the old per-claim limit, fief buildings not counted --------------------------------------
  seed();
  sys = build('dryrun');
  sys.maxClaims = 1;
  ok(sys.countClaims(ctx, 70) === 1, 'dryrun: only his claim outside the fief counts', sys.countClaims(ctx, 70));
  sys.exposeTenancy(ctx);
  ok(globalThis.__dboHousing.grant(MW_FREE, BARON) === '', 'dryrun: a fief building is granted to him past housingMaxClaims');
  ok(globalThis.__dboHousing.grant(CITY_FREE, BARON) === 'They already hold 1 properties.', 'dryrun: one outside is refused as before');
} finally {
  process.chdir(home);
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
