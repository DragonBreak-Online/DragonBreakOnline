// A hold's offices are paid default wages each week until its ruler or Steward sets others, and wages may come from the
// treasury's savings (wageSavingsShare), not only from the week's income (Nate, 12 Oct). Loads the real guilds.js (with the
// real guild-defs.json) and economy.js in a scratch directory.
//
//   node tests/hold-wages-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-holdwages-'));
fs.copyFileSync(path.join(ROOT, 'guild-defs.json'), path.join(dir, 'guild-defs.json'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

const SUNDAY = Date.UTC(2026, 9, 11, 0, 1);
let now = SUNDAY - 3600000;
Date.now = () => now;

// Bruma's court: the Count (10), a Steward (15), two guards (16, 17); one character each
const COUNT = 0x30, STEWARD = 0x31, GUARD1 = 0x32, GUARD2 = 0x33;
const PROFILE = { [COUNT]: 10, [STEWARD]: 15, [GUARD1]: 16, [GUARD2]: 17 };
fs.writeFileSync('housing.json', '[]');
fs.writeFileSync('economy.json', JSON.stringify({ rates: {}, wages: {}, values: {}, owed: {}, overdue: {}, reports: {}, assessed: {}, balanceAfter: {}, lastReckoning: SUNDAY - 7 * 86400000 }));
const props = new Map();
const mp = {
  get: (id, p) => (p === 'type' ? 'MpActor' : props.get(`${id >>> 0}|${p}`)),
  set: (id, p, v) => props.set(`${id >>> 0}|${p}`, v),
  getActorsByProfileId: (pid) => Object.keys(PROFILE).filter((a) => PROFILE[a] === pid).map(Number),
};
for (const a of Object.keys(PROFILE)) props.set(`${a}|profileId`, PROFILE[a]);
const bank = (a) => props.get(`${a}|private.bankGold`) || 0;
const treasuries = { 'county-bruma': 2000 };
globalThis.__dboTreasury = {
  balance: (f) => treasuries[f] || 0,
  spend: (f, n) => { if ((treasuries[f] || 0) < n) return false; treasuries[f] -= n; return true; },
  deposit: (f, n) => { treasuries[f] = (treasuries[f] || 0) + n; return true; },
};
globalThis.__dboHousing = { recordOf: () => null, primaryOf: () => 0, isManager: () => false };
globalThis.__dboRealmLeads = (a, f) => a === COUNT && f === 'county-bruma';
globalThis.__dboRealmLeadsAccount = (pid, f) => pid === 10 && f === 'county-bruma';
globalThis.__dboRealmFactionsLedBy = (a) => (a === COUNT ? ['county-bruma'] : []);
// business.js's rule for who sets the hold's tax and keeps its books: the Count and the Steward
globalThis.__dboCanSetHoldTax = (a, zone) => zone === 'bruma' && (a === COUNT || a === STEWARD);

const noop = () => {};
const ui = {}, timers = new Map(), replies = [];
const base = { mp, log: noop, audit: noop, who: (a) => `P${a.toString(16)}`, display: (a) => `P${a.toString(16)}`, personal: noop, onlineActors: () => [], isAdmin: () => false, profileOf: (a) => PROFILE[a] ?? -1 };
require(path.join(ROOT, 'guilds.js'))(Object.assign({}, base, {
  system: noop, registerChatCommand: noop, onUi: noop, openWidget: noop, closeWidget: noop, every: noop,
  nameOf: (a) => `P${a.toString(16)}`, tagOf: () => 'TAG', findByName: () => 0, cfg: {},
}));
globalThis.__dboFactionNonceOk = () => true;
globalThis.__dboFactionRefresh = (a, text, ok) => { replies.push({ a, text, ok }); return true; };
require(path.join(ROOT, 'economy.js'))(Object.assign({}, base, {
  cfg: { economy: { enabled: true } }, onUi: (ev, f) => { ui[ev] = f; }, every: (n, ms, f) => timers.set(n, f),
  readOfficials: () => ({ bruma: { count: [10], steward: [15], guard: [16, 17] } }),
  zoneById: (id) => (id === 'bruma' ? { id: 'bruma', name: 'Bruma', officials: ['count', 'steward', 'captain', 'guard', 'courtmage'] } : null),
}));

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };
const reckonAt = (t) => { now = t; timers.get('economy')(); };
const report = () => globalThis.__dboEconomy.data.reports['county-bruma'];
const WEEK = 7 * 86400000;

// ---- defaults, from savings ----
ok(JSON.stringify(globalThis.__dboEconomyWages('county-bruma')) === JSON.stringify({ steward: 150, captain: 100, guard: 50, courtmage: 100 }), "Bruma's offices start at the default wages, and the Count has none", globalThis.__dboEconomyWages('county-bruma'));
reckonAt(SUNDAY);
ok(bank(STEWARD) === 150 && bank(GUARD1) === 50 && bank(GUARD2) === 50 && bank(COUNT) === 0, 'with no tax coming in, the Steward and both guards are paid from savings; the Count is not', [bank(STEWARD), bank(GUARD1), bank(GUARD2), bank(COUNT)]);
ok(treasuries['county-bruma'] === 1750 && report().wageBudget === 2000, 'the budget is the whole 2,000 saved (Nate, 13 Oct: wages paid in full while the gold lasts); 250 paid', [treasuries['county-bruma'], report().wageBudget]);

// ---- the Steward changes the guards' wage; their own stays out of reach ----
ui.econWage(STEWARD, ['nonce', 'county-bruma', 'guard', 80]);
ui.econWage(STEWARD, ['nonce', 'county-bruma', 'steward', 500]);
ok(globalThis.__dboEconomyWages('county-bruma').guard === 80 && globalThis.__dboEconomyWages('county-bruma').steward === 150, "the Steward sets the guards' wage to 80, not their own", globalThis.__dboEconomyWages('county-bruma'));
const view = globalThis.__dboEconomyView(STEWARD).factions.find((f) => f.id === 'county-bruma');
ok(view && view.wages.guard === 80 && view.wages.steward === 150, "the Steward's faction panel shows the wages in force", view && view.wages);
reckonAt(SUNDAY + WEEK);
ok(bank(GUARD1) === 130 && bank(STEWARD) === 300, 'the next week pays the new wage', [bank(GUARD1), bank(STEWARD)]);

// ---- a thin treasury: what does not fit is owed, never overdrawn ----
treasuries['county-bruma'] = 200;
globalThis.__dboEconomy.data.balanceAfter['county-bruma'] = 200;
reckonAt(SUNDAY + 2 * WEEK);
ok(report().wageBudget === 200 && treasuries['county-bruma'] === 0, 'a 200-gold treasury pays out its 200 and no more', [report().wageBudget, treasuries['county-bruma']]);
ok(report().wagesPaid === 200 && report().owed === 110, 'the 110 of the 310 in wages that did not fit is owed', report());

// ---- a wage set to 0 stops it ----
ui.econWage(COUNT, ['nonce', 'county-bruma', 'guard', 0]);
ok(globalThis.__dboEconomyWages('county-bruma').guard === 0, 'the Count can stop a wage with 0', globalThis.__dboEconomyWages('county-bruma'));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
