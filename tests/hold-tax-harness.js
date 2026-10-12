// One hold rate (Nate, 12 Oct: "everything in bruma that can be owned"): the hold's /tax rate (business.js, taxes.json) is
// also the weekly property tax on the hold's land (economy.js), and the faction panel's rate for a hold sets the same
// number. Loads the real business.js, guilds.js (with the real guild-defs.json) and economy.js in a scratch directory.
//
//   node tests/hold-tax-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-holdtax-'));
fs.copyFileSync(path.join(ROOT, 'guild-defs.json'), path.join(dir, 'guild-defs.json'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

const SUNDAY = Date.UTC(2026, 9, 11, 0, 1);
let now = SUNDAY - 3600000;
Date.now = () => now;

// Houses: BRUMA_HOUSE on county-bruma land (Lydia), GUILD_HOUSE on fighters-guild land (Olaf), WR_HOUSE on Whiterun's
// land (Ulf; Whiterun never set a /tax rate)
const BRUMA_HOUSE = 0x100, GUILD_HOUSE = 0x101, WR_HOUSE = 0x102;
const LYDIA = 0x20, OLAF = 0x21, ULF = 0x22, COUNT = 0x30;
const PROFILE = { [LYDIA]: 11, [OLAF]: 12, [ULF]: 14, [COUNT]: 10 };
const NAME = { [LYDIA]: 'Lydia', [OLAF]: 'Olaf', [ULF]: 'Ulf', [COUNT]: 'Count Carvain' };
const OWNER_OF = { [BRUMA_HOUSE]: [11, 'Lydia'], [GUILD_HOUSE]: [12, 'Olaf'], [WR_HOUSE]: [14, 'Ulf'] };
const LAND = { [BRUMA_HOUSE]: 'bruma', [GUILD_HOUSE]: 'greenwood', [WR_HOUSE]: 'whiterun' };
const OWNER_FACTION = { bruma: 'county-bruma', greenwood: 'fighters-guild', whiterun: 'hold-whiterun' };
fs.writeFileSync('housing.json', JSON.stringify([BRUMA_HOUSE, GUILD_HOUSE, WR_HOUSE]));
fs.writeFileSync('economy.json', JSON.stringify({
  rates: { 'fighters-guild': 0.2, 'hold-whiterun': 0.05 }, wages: {}, values: {}, owed: {}, overdue: {}, reports: {}, assessed: {},
  balanceAfter: {}, lastReckoning: SUNDAY - 7 * 86400000,
}));

const props = new Map();
const mp = {
  get: (id, p) => {
    if (p === 'type') return 'MpActor';
    if (p === 'worldOrCellDesc') return LAND[id >>> 0] || 'tamriel';
    if (p === 'pos') return [1, 1, 0];
    return props.get(`${id >>> 0}|${p}`);
  },
  set: (id, p, v) => props.set(`${id >>> 0}|${p}`, v),
  getActorsByProfileId: (pid) => Object.keys(PROFILE).filter((a) => PROFILE[a] === pid).map(Number),
  getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16),
  lookupEspmRecordById: () => null,
};
for (const a of Object.keys(PROFILE)) props.set(`${a}|profileId`, PROFILE[a]);
const bank = (a) => props.get(`${a}|private.bankGold`) || 0;
for (const a of [LYDIA, OLAF, ULF]) props.set(`${a}|private.bankGold`, 5000);

const treasuries = {};
globalThis.__dboTreasury = {
  balance: (f) => treasuries[f] || 0,
  spend: (f, n) => { if ((treasuries[f] || 0) < n) return false; treasuries[f] -= n; return true; },
  deposit: (f, n) => { treasuries[f] = (treasuries[f] || 0) + n; return true; },
};
globalThis.__dboHousing = {
  recordOf: (r) => (OWNER_OF[r] ? { owner: OWNER_OF[r][0], ownerName: OWNER_OF[r][1], partner: 0 } : null),
  primaryOf: (r) => (OWNER_OF[r] ? r : 0), isManager: () => false,
};
globalThis.__dboRealmTerritoryAt = (world) => ({ id: world, name: world });
globalThis.__dboRealmOwnerOf = (tid) => OWNER_FACTION[tid] || null;
globalThis.__dboRealmLeads = (a, f) => a === COUNT && f === 'county-bruma';
globalThis.__dboRealmFactionsLedBy = (a) => (a === COUNT ? ['county-bruma'] : []);

const said = [], cmds = {}, ui = {}, replies = [];
const noop = () => {};
const base = {
  mp, log: noop, audit: noop, who: (a) => NAME[a], display: (a) => NAME[a], personal: (a, t) => said.push([a, t]),
  onlineActors: () => [], isAdmin: () => false, profileOf: (a) => PROFILE[a] ?? -1, every: noop,
};
require(path.join(ROOT, 'business.js'))(Object.assign({}, base, {
  cfg: { rest: { holdShare: 0.1 }, business: {} }, openWidget: noop, closeWidget: noop,
  onUi: (n, f) => { ui[n] = f; }, registerChatCommand: (n, f) => { cmds[n] = f; },
  findByName: () => 0, takeGold: () => true, giveGold: () => true, depositToTreasury: (z, n) => n,
  zoneOfActor: () => 'bruma', zoneById: (id) => ({ id, name: id === 'bruma' ? 'Bruma' : id }),
  ranksOf: (p) => (p === 10 ? [{ zone: { id: 'bruma' }, rank: 'count' }] : []), distanceMeters: () => 1,
}));
require(path.join(ROOT, 'guilds.js'))(Object.assign({}, base, {
  system: noop, registerChatCommand: noop, onUi: noop, openWidget: noop, closeWidget: noop,
  nameOf: (a) => NAME[a], tagOf: () => 'TAG', findByName: () => 0, cfg: {},
}));
globalThis.__dboFactionNonceOk = () => true;
globalThis.__dboFactionRefresh = (a, text, ok) => { replies.push({ a, text, ok }); return true; };
const timers = new Map();
require(path.join(ROOT, 'economy.js'))(Object.assign({}, base, {
  cfg: { economy: { enabled: true } }, onUi: (ev, f) => ui[ev] = f, every: (n, ms, f) => timers.set(n, f),
  readOfficials: () => ({ bruma: { count: [10] } }),
  zoneById: (id) => (id === 'bruma' ? { id: 'bruma', name: 'Bruma', officials: ['count', 'steward'] } : null),
}));

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };
const taxes = () => JSON.parse(fs.readFileSync('taxes.json', 'utf8'));
const last = (a) => { for (let i = said.length - 1; i >= 0; i--) if (said[i][0] === a) return said[i][1]; return ''; };
const reckonAt = (t) => { now = t; timers.get('economy')(); };
const panelRate = (fid) => { const v = globalThis.__dboEconomyView(COUNT); return ((v && v.factions) || []).find((f) => f.id === fid)?.rate; };

// ---- /tax 10 in Bruma: one rate for rents and property ----
cmds.tax(COUNT, '10');
ok(taxes().bruma && taxes().bruma.rate === 0.1, "the Count's /tax 10 sets Bruma's rate", taxes());
ok(/every rent, and of every property's value/.test(last(COUNT)), '/tax says it covers property too', last(COUNT));
ok(panelRate('county-bruma') === 0.1, 'the faction panel shows the hold rate', panelRate('county-bruma'));

reckonAt(SUNDAY);
ok(bank(LYDIA) === 4800 && treasuries['county-bruma'] === 200, "Lydia's Bruma house pays 10% of 2,000 to the County", [bank(LYDIA), treasuries['county-bruma']]);
ok(bank(OLAF) === 4600 && treasuries['fighters-guild'] === 400, 'a guild still taxes its land at its own panel rate (20%)', [bank(OLAF), treasuries['fighters-guild']]);
ok(bank(ULF) === 4900 && treasuries['hold-whiterun'] === 100, 'a hold that never set /tax keeps its panel rate (5%)', [bank(ULF), treasuries['hold-whiterun']]);

// ---- the panel sets the same number ----
ui.econRate(COUNT, ['nonce', 'county-bruma', 15]);
ok(taxes().bruma.rate === 0.15, "the Count's panel rate 15% sets Bruma's /tax rate", taxes().bruma);
ok(/Count Carvain set the tax to 15% \(was 10%\)/.test(taxes().bruma.log.slice(-1)[0].text), 'the change is in the hold tax log', taxes().bruma.log.slice(-1)[0]);
ok(panelRate('county-bruma') === 0.15, 'the panel reads it back', panelRate('county-bruma'));
reckonAt(SUNDAY + 7 * 86400000);
ok(bank(LYDIA) === 4500 && treasuries['county-bruma'] === 500, 'the next reckoning charges 15% (300)', [bank(LYDIA), treasuries['county-bruma']]);

// ---- /tax 0 stops it; a rate over the cap is refused ----
cmds.tax(COUNT, '0');
reckonAt(SUNDAY + 14 * 86400000);
ok(bank(LYDIA) === 4500 && treasuries['county-bruma'] === 500, '/tax 0 taxes no property', [bank(LYDIA), treasuries['county-bruma']]);
ok(globalThis.__dboSetHoldTax('bruma', 31, 'X', 'X') === null && taxes().bruma.rate === 0, 'the shared setter refuses a rate over 30%', taxes().bruma.rate);

// ---- a house bought from the hold is taxed on its price ----
ok(globalThis.__dboEconomySaleValue(BRUMA_HOUSE, 5000, 'Lydia') === true, 'a sale sets the value');
const st = globalThis.__dboEconomy.data;
ok(st.values[String(BRUMA_HOUSE)] === 5000 && /sale to Lydia/.test(st.assessed[String(BRUMA_HOUSE)].by), 'the value is 5,000, stamped as an assessment', [st.values, st.assessed]);
cmds.tax(COUNT, '10');
const before = bank(LYDIA), tBefore = treasuries['county-bruma'];
reckonAt(SUNDAY + 21 * 86400000);
ok(bank(LYDIA) === before - 500 && treasuries['county-bruma'] === tBefore + 500, 'the next reckoning taxes 10% of 5,000', [before - bank(LYDIA), treasuries['county-bruma'] - tBefore]);
ok(globalThis.__dboEconomySaleValue(0x999, 100, 'X') === false, 'no value for something that is no property');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
