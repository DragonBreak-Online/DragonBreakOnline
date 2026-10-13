// The design's tax example (Nate, 14 Oct): a house listed by the hold at 15,000, weekly tax 10%, pays 1,500 a week; sold
// on to another player for 5,000 it still pays 1,500, on the original listed value. A steward cannot reassess a listed
// value; a Lead GM can correct it; a house never sold by the hold keeps today's assessment rules. Loads the real
// business.js, guilds.js (the real guild-defs.json) and economy.js in a scratch folder, as tests/hold-tax-harness.js does.
//
//   node tests/citizenship-tax-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-citizentax-'));
fs.copyFileSync(path.join(ROOT, 'guild-defs.json'), path.join(dir, 'guild-defs.json'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
const SUNDAY = Date.UTC(2026, 9, 18, 0, 1);
let now = SUNDAY - 3600000;
Date.now = () => now;
const WEEK = 7 * 86400000;

const MARE = 0x100, OLD = 0x101;
const FIRST = 0x20, SECOND = 0x21, OLDOWNER = 0x22, COUNT = 0x30, STEWARD = 0x31, LEADGM = 0x32;
const PROFILE = { [FIRST]: 11, [SECOND]: 12, [OLDOWNER]: 13, [COUNT]: 10, [STEWARD]: 15, [LEADGM]: 16 };
const NAME = { [FIRST]: 'First Buyer', [SECOND]: 'Second Buyer', [OLDOWNER]: 'Old Owner', [COUNT]: 'Count', [STEWARD]: 'Steward', [LEADGM]: 'Lead GM' };
const owner = { [MARE]: [0, ''], [OLD]: [13, 'Old Owner'] };
fs.writeFileSync('housing.json', JSON.stringify([MARE, OLD]));
fs.writeFileSync('economy.json', JSON.stringify({ rates: {}, wages: {}, values: { [String(OLD)]: 3000 }, owed: {}, overdue: {}, reports: {}, assessed: {}, balanceAfter: {}, lastReckoning: SUNDAY - WEEK }));
const props = new Map();
const mp = {
  get: (id, p) => { if (p === 'type') return 'MpActor'; if (p === 'worldOrCellDesc') return 'bruma'; if (p === 'pos') return [1, 1, 0]; return props.get(`${id >>> 0}|${p}`); },
  set: (id, p, v) => props.set(`${id >>> 0}|${p}`, v),
  getActorsByProfileId: (pid) => Object.keys(PROFILE).filter((a) => PROFILE[a] === pid).map(Number),
  getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16), lookupEspmRecordById: () => null,
};
for (const a of Object.keys(PROFILE)) props.set(`${a}|profileId`, PROFILE[a]);
for (const a of [FIRST, SECOND, OLDOWNER]) props.set(`${a}|private.bankGold`, 100000);
const bank = (a) => props.get(`${a}|private.bankGold`) || 0;
const treasuries = {};
globalThis.__dboTreasury = { balance: (f) => treasuries[f] || 0, spend: () => false, deposit: (f, n) => { treasuries[f] = (treasuries[f] || 0) + n; return true; } };
globalThis.__dboHousing = {
  recordOf: (r) => (owner[r] && owner[r][0] ? { owner: owner[r][0], ownerName: owner[r][1], partner: 0 } : owner[r] ? { owner: 0 } : null),
  primaryOf: (r) => (owner[r] ? r : 0), isManager: (a) => a === STEWARD || a === COUNT || a === LEADGM,
};
globalThis.__dboRealmTerritoryAt = () => ({ id: 'bruma', name: 'Bruma' });
globalThis.__dboRealmOwnerOf = () => 'county-bruma';
globalThis.__dboRealmLeads = (a, f) => a === COUNT && f === 'county-bruma';
globalThis.__dboRealmFactionsLedBy = (a) => (a === COUNT ? ['county-bruma'] : []);
const noop = () => {};
const said = [], cmds = {}, ui = {}, replies = [];
const base = { mp, log: noop, audit: noop, who: (a) => NAME[a], display: (a) => NAME[a], personal: (a, t) => said.push([a, t]), onlineActors: () => [], isAdmin: (a) => a === LEADGM, profileOf: (a) => PROFILE[a] ?? -1, every: noop };
require(path.join(ROOT, 'business.js'))(Object.assign({}, base, {
  cfg: { rest: { holdShare: 0.1 }, business: {} }, openWidget: noop, closeWidget: noop, onUi: (n, f) => { ui[n] = f; }, registerChatCommand: (n, f) => { cmds[n] = f; },
  findByName: () => 0, takeGold: () => true, giveGold: () => true, depositToTreasury: (z, n) => n, zoneOfActor: () => 'bruma', zoneById: (id) => ({ id, name: 'Bruma' }),
  ranksOf: (p) => (p === 10 ? [{ zone: { id: 'bruma' }, rank: 'count' }] : p === 15 ? [{ zone: { id: 'bruma' }, rank: 'steward' }] : []), distanceMeters: () => 1,
}));
require(path.join(ROOT, 'guilds.js'))(Object.assign({}, base, { system: noop, registerChatCommand: noop, onUi: noop, openWidget: noop, closeWidget: noop, nameOf: (a) => NAME[a], tagOf: () => 'TAG', findByName: () => 0, cfg: {} }));
globalThis.__dboFactionNonceOk = () => true;
globalThis.__dboFactionRefresh = (a, text, ok) => { replies.push({ a, text, ok }); return true; };
const timers = new Map();
require(path.join(ROOT, 'economy.js'))(Object.assign({}, base, {
  cfg: { economy: { enabled: true, defaultWages: {}, titheRate: 0, dominionStipend: 0 } }, onUi: (ev, f) => { ui[ev] = f; }, every: (n, ms, f) => timers.set(n, f),
  readOfficials: () => ({ bruma: { count: [10], steward: [15] } }), zoneById: (id) => (id === 'bruma' ? { id: 'bruma', name: 'Bruma', officials: ['count', 'steward'] } : null),
  isLeadStaff: (a) => a === LEADGM,
}));
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };
const reckon = () => { now += WEEK; timers.get('economy')(); };
const lastReply = () => replies[replies.length - 1] || {};

cmds.tax(COUNT, '10');
// The hold sells the house at its listed value of 15,000 (tenancy.js buy calls this)
owner[MARE] = [11, 'First Buyer'];
globalThis.__dboEconomySaleValue(MARE, 15000, 'First Buyer');
const mareTax = () => { const t = globalThis.__dboEconomyTaxOf(MARE); return t && t.weeklyTax; };
ok(mareTax() === 1500 && globalThis.__dboEconomyTaxOf(MARE).listedValue, 'listed at 15,000, 10% a week: 1,500', globalThis.__dboEconomyTaxOf(MARE));
let b = bank(FIRST); reckon();
ok(b - bank(FIRST) === 1500, 'the first owner pays 1,500 that week', b - bank(FIRST));
// Sold on to another player for 5,000: tenancy.js's resale moves the house and leaves the value alone
owner[MARE] = [12, 'Second Buyer'];
b = bank(SECOND); const t0 = treasuries['county-bruma'] || 0; reckon();
ok(b - bank(SECOND) === 1500 && (treasuries['county-bruma'] - t0) === 1500 + 300, 'after a resale for 5,000 the weekly tax is still 1,500, into the hold\'s treasury (with the older house\'s 300)', [b - bank(SECOND), treasuries['county-bruma'] - t0]);
// A steward cannot reassess a listed value
ui.econValue(STEWARD, ['n', String(MARE), '5000']);
ok(lastReply().ok === false && /listed value of 15000/.test(lastReply().text) && mareTax() === 1500, "a steward's reassessment of the listed value is refused", lastReply());
// A Lead GM may correct it
ui.econValue(LEADGM, ['n', String(MARE), '14000']);
ok(lastReply().ok === true && mareTax() === 1400, 'a Lead GM corrects it to 14,000', [lastReply(), mareTax()]);
// A house the hold never sold keeps today's rules: a steward reassesses it
ui.econValue(STEWARD, ['n', String(OLD), '4000']);
ok(lastReply().ok === true && globalThis.__dboEconomyTaxOf(OLD).weeklyTax === 400 && !globalThis.__dboEconomyTaxOf(OLD).listedValue, 'an older house (never listed) is still assessed as before', [lastReply(), globalThis.__dboEconomyTaxOf(OLD)]);
// The rate stays the Jarl's to change
cmds.tax(COUNT, '20');
ok(mareTax() === 2800, 'the ruler raises the rate to 20%: 2,800 on the 14,000', mareTax());

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
