// Scripted test for the Imperial tithe on all of a Cyrodiil hold's income (Nate, 18 Oct): bank.js counts each deposit its
// caller marks as income, economy.js's reckoning tithes the property tax kept plus that income at titheRate (25%) to the
// Imperial Legion, never the Legion's own, never Skyrim's Holds; deposits not marked income (refunds, transfers, gifts,
// the tithe itself) are never counted; the count survives a hot reload and a restart, and is reset after each reckoning.
// Loads the real bank.js and economy.js in a temp working directory (in /dev/shm). Run it from this folder's parent:
//
//   node tests/tithe-income-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BANK = path.join(ROOT, 'bank.js');
const ECON = path.join(ROOT, 'economy.js');
const base = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
const dir = fs.mkdtempSync(path.join(base, 'claude-nate-tithe-income-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

const SUNDAY = Date.UTC(2026, 9, 18, 0, 1);
const WEEK = 7 * 86400000;
let now = SUNDAY - WEEK + 3600000;
Date.now = () => now;

let failures = 0;
const check = (label, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

// Holds: Bruma (Cyrodiil, the County), Whiterun (Skyrim), Fort Caractacus (Cyrodiil, the Legion's own)
const CYR = 'a764b:BSHeartland.esm', TAM = '3c:Skyrim.esm';
const zones = {
  bruma: { id: 'bruma', name: 'Bruma', treasury: '1:Chest.esp' },
  whiterun: { id: 'whiterun', name: 'Whiterun', treasury: '2:Chest.esp' },
  caractacus: { id: 'caractacus', name: 'Fort Caractacus', treasury: '3:Chest.esp' },
};
const FACTIONS = {
  'county-bruma': { id: 'county-bruma', name: 'County of Bruma', kind: 'hold', zone: 'bruma', world: CYR },
  'hold-whiterun': { id: 'hold-whiterun', name: 'Whiterun Hold', kind: 'hold', zone: 'whiterun', world: TAM },
  'imperial-legion': { id: 'imperial-legion', name: 'Imperial Legion', kind: 'hold', zone: 'caractacus', world: CYR },
};
globalThis.__dboGuildInfo = (f) => FACTIONS[f] || null;
globalThis.__dboHoldFactionOf = (z) => (Object.values(FACTIONS).find((f) => f.zone === z) || {}).id || null;
globalThis.__dboRealmSeatTerritoryOf = (z) => { const f = Object.values(FACTIONS).find((x) => x.zone === z); return f ? { id: z, name: zones[z].name, zone: z, marker: { world: f.world } } : null; };
globalThis.__dboRegions = { placeOf: (d) => ({ province: String(d).endsWith('BSHeartland.esm') ? 'cyrodiil' : 'skyrim' }) };

// One house in Bruma (owner account 11, character 0x21), value 1,000 at the County's 20%: 200 gold of property tax a week
const HOUSE = 0x101;
const props = new Map();
const mp = {
  get: (id, p) => {
    if (id === HOUSE && p === 'worldOrCellDesc') return CYR;
    if (id === HOUSE && p === 'pos') return [1, 1, 0];
    if (p === 'type') return 'MpActor';
    return props.get(`${id >>> 0}|${p}`);
  },
  set: (id, p, v) => props.set(`${id >>> 0}|${p}`, v),
  getIdFromDesc: (d) => ({ '1:Chest.esp': 0x9001, '2:Chest.esp': 0x9002, '3:Chest.esp': 0x9003 }[d] || 0),
  getActorsByProfileId: (pid) => (pid === 11 ? [0x21] : []),
};
props.set(`${0x21}|profileId`, 11); props.set(`${0x21}|private.bankGold`, 1000000);
fs.writeFileSync('housing.json', JSON.stringify([HOUSE]));
fs.writeFileSync('economy.json', JSON.stringify({ rates: { 'county-bruma': 0.2 }, values: { [HOUSE]: 1000 }, lastReckoning: SUNDAY - WEEK }));
fs.writeFileSync('bank.json', JSON.stringify({ factions: {}, zones: { bruma: 1000, whiterun: 1000, caractacus: 0 } }));
globalThis.__dboHousing = { recordOf: (r) => (r === HOUSE ? { owner: 11, ownerName: 'Owner', partner: 0 } : null), primaryOf: (r) => r, isManager: () => false };
globalThis.__dboRealmTerritoryAt = (world) => (world === CYR ? { id: 'bruma', name: 'Bruma', marker: { world: CYR } } : null);
globalThis.__dboRealmOwnerOf = (tid) => (tid === 'bruma' ? 'county-bruma' : null);
globalThis.__dboRealmLeads = () => false;
globalThis.__dboRealmLeadsAccount = () => false;

const logs = [], audits = [];
const noop = () => {};
// As gamemode.js's depositToTreasury: into the hold's bank balance, the caller's income mark passed on
const depositToTreasury = (zid, n, opts) => globalThis.__dboTreasuryZone.deposit(typeof zid === 'object' && zid ? zid.id : zid, Math.floor(Number(n) || 0), opts);
const loadBank = () => {
  delete require.cache[BANK];
  require(BANK)({
    mp, log: (...x) => logs.push(x.join(' ')), personal: noop, audit: (t) => audits.push(t), who: (a) => `P${a.toString(16)}`, cfg: {},
    openWidget: noop, closeWidget: noop, onUi: noop, registerChatCommand: noop, takeGold: () => true, giveItem: () => true, goldOf: () => 0,
    depositToTreasury, zoneById: (id) => zones[id] || null, zoneList: () => Object.values(zones), zoneOfActor: () => 'bruma',
    ranksOf: () => [], profileOf: () => -1, distanceMeters: () => 50, every: noop,
  });
};
let econ;
const loadEcon = () => {
  delete require.cache[ECON];
  econ = require(ECON)({
    mp, log: (...x) => logs.push(x.join(' ')), personal: noop, who: (a) => `P${a.toString(16)}`, display: (a) => `P${a.toString(16)}`,
    audit: (t) => audits.push(t), cfg: { economy: { enabled: true, titheRate: 0.25 } }, onUi: noop, onlineActors: () => [],
    every: noop, readOfficials: () => ({}), zoneById: (id) => zones[id] || null,
  });
};
loadBank(); loadEcon();
const Z = () => globalThis.__dboTreasuryZone;
const T = () => globalThis.__dboTreasury;
const bal = (z) => Z().balance(z);
const income = (z) => Z().income()[z] || { total: 0, kinds: {} };
const report = (f) => globalThis.__dboEconomy.data.reports[f] || {};
const reckon = () => { now += WEEK; audits.length = 0; return econ.reckon(); };

// ---- every call site that pays a hold's income marks it; the returns and transfers do not --------------------------
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MARKED = [
  ['tenancy.js', /depositToTreasury\(L\.zone, L\.weekly, \{ income: 'rent' \}\)/, 'first week of rent'],
  ['tenancy.js', /depositToTreasury\(L\.zone, price, \{ income: 'house sales' \}\)/, 'a house sold by the hold'],
  ['tenancy.js', /depositToTreasury\(L\.zone, cost, \{ income: 'rent' \}\)/, 'rent paid'],
  ['tenancy.js', /depositToTreasury\(L\.zone, dep, \{ income: 'rent' \}\)/, 'a deposit the hold keeps'],
  ['business.js', /depositToTreasury\(zone, tax, \{ income: 'business tax' \}\)/, 'the shop tax on a business rent'],
  ['ledgersale.js', /depositToTreasury\(zone, n, \{ income: 'sales' \}\)/, 'sales tax on a ledger sale'],
  ['ledgersale.js', /T\.deposit\(r\.fid, s\.owner, `ledger sale: \$\{o\.what \|\| 'goods'\}`, \{ income: 'sales' \}\)/, "a faction-owned shop's sale"],
  ['post.js', /depositToTreasury\(zone\.id, fee, \{ income: 'board fees' \}\)/, 'supply order fee'],
  ['couriers.js', /depositToTreasury\(origin\.zone, fee \+ premium, \{ income: 'board fees' \}\)/, 'courier fee and premium'],
  ['commissions.js', /depositToTreasury\(c\.zone, duty, \{ income: 'commission duty' \}\)/, 'commission duty'],
  ['commissions.js', /depositToTreasury\(zone, fee, \{ income: 'board fees' \}\)/, 'commission fee'],
  ['rest.js', /depositToTreasury\(zone, holdCut, \{ income: 'inn rent' \}\)/, 'inn rent'],
  ['spells.js', /depositToTreasury\(CFG\.shopTreasury, price, \{ income: 'sales' \}\)/, 'tome sale'],
  ['manuals.js', /depositToTreasury\(C\.shop\.treasury, price, \{ income: 'sales' \}\)/, 'manual sale'],
  ['citizenship.js', /depositToTreasury\(z\.id, chk\.fee, \{ income: 'citizenship fees' \}\)/, 'citizenship fee'],
  ['outlaws.js', /__dboTreasuryZone\.deposit\(zid, paid, \{ income: 'bounties' \}\)/, 'bounty paid'],
  ['gamemode.js', /depositToTreasury\(zoneId, taxed, \{ income: 'postage' \}\)/g, 'pigeon postage', 2],
  ['gamemode.js', /depositToTreasury\(z && typeof z === 'object' \? z\.id : z, gold, \{ income: 'temple offerings' \}\)/, 'temple offering'],
  ['bank.js', /depositToTreasury\(zone\.id, n, \{ income: 'vault fees' \}\)/, 'vault fees'],
];
for (const [f, rx, what, count] of MARKED) check(`${f}: ${what} is marked income`, (src(f).match(rx.global ? rx : new RegExp(rx.source, 'g')) || []).length === (count || 1));
check('contracts.js: a contract reward returned is not income', /bankTreasury\(\)\.deposit\(zone\.id, amount\);/.test(src('contracts.js')));
check('realm.js: a peace tribute (a transfer) is not income', !/peace tribute from[^\n]*income/.test(src('realm.js')));
check('economy.js: no deposit of its own (tax, tithe, returns, stipend) is marked income', !/deposit\([^\n]*\{ income:/.test(src('economy.js')));
check('bank.js: a ruler paying into a treasury is not income', /if \(depositToTreasury\(t\.key\.slice\(5\), n\) !== n\)/.test(src('bank.js')));
check('bank.js: the chest sweep is not income', /data\(\)\.zones\[zone\.id\] = had \+ gold;/.test(src('bank.js')) && !/sweepChest[^]*?zoneAdd\(zone, gold/.test(src('bank.js')));

// ---- week 1: Bruma's income from each kind, and deposits that are not income ----------------------------------------
depositToTreasury('bruma', 400, { income: 'rent' });
depositToTreasury('bruma', 100, { income: 'postage' });
Z().deposit('bruma', 100, { income: 'bounties' });
depositToTreasury('bruma', 50, { income: 'board fees' });
T().deposit('county-bruma', 50, 'ledger sale: bread', { income: 'sales' });
check('each marked deposit is counted, by kind', income('bruma').total === 700 && income('bruma').kinds.rent === 400 && income('bruma').kinds.postage === 100 && income('bruma').kinds.bounties === 100 && income('bruma').kinds['board fees'] === 50 && income('bruma').kinds.sales === 50, income('bruma'));
Z().deposit('bruma', 300);                                    // contracts.js: a reward returned
depositToTreasury('bruma', 77, 'rent');                       // a bare string is no mark
depositToTreasury('bruma', 66, { income: '' });               // nor an empty kind
T().deposit('county-bruma', 500, 'a gift from the staff');    // a transfer or gift
mp.set(0x9001, 'inventory', { entries: [{ baseId: 0xf, count: 40 }] }); Z().balance('bruma');   // the chest sweep
check('deposits not marked income are not counted, and the gold still lands', income('bruma').total === 700 && bal('bruma') === 1000 + 700 + 300 + 77 + 66 + 500 + 40, [income('bruma'), bal('bruma')]);
check('the count is written to bank.json', JSON.parse(fs.readFileSync('bank.json', 'utf8')).income.bruma.total === 700);
depositToTreasury('whiterun', 1000, { income: 'rent' });
depositToTreasury('caractacus', 200, { income: 'rent' });

const legion0 = bal('caractacus'), white0 = bal('whiterun');
reckon();
const rb = report('county-bruma');
check('Bruma: 200 property tax, 700 other income, a tithe of 25% of 900 = 225', rb.income === 200 && rb.titheTax === 200 && rb.titheOther === 700 && rb.titheBase === 900 && rb.tithe === 225 && !rb.titheOwed, rb);
check('property tax is not counted twice (its deposit is not income)', rb.titheBase === 900);
check('the report keeps the kinds of income tithed', rb.titheOtherKinds && rb.titheOtherKinds.rent === 400 && rb.titheOtherKinds.sales === 50, rb.titheOtherKinds);
check('the audit line splits property tax and other income', audits.some((t) => t === 'ECONOMY County of Bruma: Imperial tithe 225 gold to Imperial Legion (25% of 900: 200 in property tax, 700 in other income (rent 400, postage 100, bounties 100, board fees 50, sales 50))'), audits);
check('the Legion received the tithe, and its own income is not tithed', bal('caractacus') === legion0 + 225 && !report('imperial-legion').tithe && report('imperial-legion').tithesIn === 225 && !audits.some((t) => /Imperial Legion: Imperial tithe/.test(t)), [bal('caractacus') - legion0, report('imperial-legion')]);
check('Whiterun, a Hold of Skyrim, pays no tithe on its income', bal('whiterun') === white0 && report('hold-whiterun').tithe === undefined, report('hold-whiterun'));
check('every hold\'s count is reset after the reckoning (the tithe paid in is not income)', Object.keys(Z().income()).length === 0, Z().income());
check('the reckoning logged no failure', !logs.some((l) => /fail/i.test(l)), logs);

// ---- week 2: a treasury that cannot pay all of it owes the rest ------------------------------------------------------
depositToTreasury('bruma', 4000, { income: 'house sales' });
Z().spend('bruma', bal('bruma'));
reckon();
check('arrears: a treasury of 200 (the week\'s tax) pays 200 of 25% of 4,200 = 1,050, and owes 850', report('county-bruma').tithe === 200 && report('county-bruma').titheOwed === 850 && globalThis.__dboEconomy.data.titheOwed['county-bruma'] === 850 && bal('bruma') === 0, [report('county-bruma'), bal('bruma')]);
check('the count is reset though the tithe is owed (the arrears carry it)', !Z().income().bruma);

// ---- week 3: the arrears first ----------------------------------------------------------------------------------------
T().deposit('county-bruma', 2000, 'a gift');
reckon();
check('the arrears and the week\'s 25% of 200: 850 + 50', report('county-bruma').tithe === 900 && !report('county-bruma').titheOwed && !('county-bruma' in globalThis.__dboEconomy.data.titheOwed), report('county-bruma'));
check('with no other income the audit line is as before', audits.some((t) => t === 'ECONOMY County of Bruma: Imperial tithe 900 gold to Imperial Legion (25% of 200 in taxes, 850 in arrears)'), audits);

// ---- the count survives a hot reload and a restart --------------------------------------------------------------------
depositToTreasury('bruma', 300, { income: 'rent' });
loadBank(); loadEcon();
check('a hot reload keeps the count', income('bruma').total === 300, income('bruma'));
globalThis.__dboBankState.data = null; globalThis.__dboEconomy.data = null;
loadBank(); loadEcon();
check('a restart reads the count back from bank.json', income('bruma').total === 300 && income('bruma').kinds.rent === 300, income('bruma'));
reckon();
check('after the restart the week\'s tithe is 25% of 200 + 300', report('county-bruma').tithe === 125 && report('county-bruma').titheOther === 300, report('county-bruma'));

// ---- a deposit made after the count was read stays for next week ------------------------------------------------------
depositToTreasury('bruma', 100, { income: 'rent' });
const seen = Z().income().bruma;
depositToTreasury('bruma', 40, { income: 'postage' });
Z().clearIncome('bruma', seen);
check('clearIncome takes off only what was read', income('bruma').total === 40 && income('bruma').kinds.postage === 40 && !income('bruma').kinds.rent, income('bruma'));

// ---- a write that fails leaves the count as it was --------------------------------------------------------------------
{
  const wf = fs.writeFileSync; fs.writeFileSync = () => { throw new Error('disk full'); };
  const ok = depositToTreasury('bruma', 500, { income: 'rent' });
  fs.writeFileSync = wf;
  check('a deposit whose write fails counts nothing', ok === 0 && income('bruma').total === 40, income('bruma'));
}

// ---- the rate is the config's; 0 turns it off and the count still resets ------------------------------------------------
{
  delete require.cache[ECON];
  econ = require(ECON)({ mp, log: noop, personal: noop, who: String, display: String, audit: (t) => audits.push(t), cfg: { economy: { enabled: true, titheRate: 0 } }, onUi: noop, onlineActors: () => [], every: noop, readOfficials: () => ({}), zoneById: (id) => zones[id] || null });
  const legion = bal('caractacus');
  reckon();
  check('titheRate 0: no tithe, and the count resets', bal('caractacus') === legion && !Z().income().bruma);
}
const cfgRate = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8')).economy.titheRate;
check('gamemode-config.json sets economy.titheRate to 0.25', cfgRate === 0.25, cfgRate);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
