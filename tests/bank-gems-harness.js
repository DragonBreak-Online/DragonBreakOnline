// Scripted test for the gem counter in server\bank.js (Nat, 25 Oct: "gems are a grind to get and cost a lot to buy from the
// bank"): a hold's banks buy gems at half their value, paid by the hold's treasury into the seller's account, and sell them at
// three times their value into the treasury; a hold sells only what players sold it, and a treasury that cannot pay buys
// none. With the real post.js for taking goods and a mock gamemode api. No server and no game:
//
//   node tests/bank-gems-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const BANK = path.join(SERVER, 'bank.js');
const SCRATCH = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-bankgems-'));
process.chdir(SCRATCH);
fs.copyFileSync(path.join(SERVER, 'artifacts.json'), path.join(SCRATCH, 'artifacts.json'));
process.on('exit', () => { try { process.chdir(os.tmpdir()); fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch (e) { /* best effort */ } });

let failures = 0;
const check = (label, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const GOLD = 0xf, BANK_BASE = 0x0b000005;
const RUBY = 0x63b42, RUBY_FLAWLESS = 0x68522, SWORD = 0x12eb7;
const BANK_WR = 0x0b000501, BANK_SOL = 0x0b000502, BANK_NOWHERE = 0x0b000504;
const P1 = 0xff000101, P2 = 0xff000202;
const misc = (ed) => ({ type: 'MISC', flags: 0, editorId: ed, fields: [{ type: 'DATA', data: new Uint8Array(8) }] });
const RECORDS = { [RUBY]: misc('GemRuby'), [RUBY_FLAWLESS]: misc('GemRubyFlawless'), [GOLD]: misc('Gold001'),
  [SWORD]: { type: 'WEAP', flags: 0, editorId: 'IronSword', fields: [{ type: 'DATA', data: new Uint8Array(10) }] } };
const NAMES = { [RUBY]: 'Ruby', [RUBY_FLAWLESS]: 'Flawless Ruby', [SWORD]: 'Iron Sword' };
// Only the two rubies have a value here: the other configured gems are skipped from the list
const VALUES = { [RUBY]: 200, [RUBY_FLAWLESS]: 350, [SWORD]: 25 };
globalThis.__dboBaseValue = (id) => VALUES[id >>> 0] || 0;

const props = new Map();
const set = (id, k, v) => props.set(`${id >>> 0}|${k}`, JSON.parse(JSON.stringify(v)));
const get = (id, k) => { const v = props.get(`${id >>> 0}|${k}`); return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
const inv = (id) => (get(id, 'inventory') || { entries: [] }).entries;
const count = (id, base) => inv(id).reduce((n, e) => n + ((Number(e.baseId) >>> 0) === base ? Number(e.count) : 0), 0);
const goldOf = (a) => count(a, GOLD);
for (const b of [BANK_WR, BANK_SOL, BANK_NOWHERE]) set(b, 'baseDesc', '5:DragonBreak.esp');
set(BANK_WR, 'worldOrCellDesc', '1a97:DragonBreak.esp'); set(BANK_SOL, 'worldOrCellDesc', '6053:DragonBreak.esp'); set(BANK_NOWHERE, 'worldOrCellDesc', 'abcd:Someone Else.esp');   // verify-formids: ignore - a cell in no plugin: a bank of no hold
const PINS = { '1a97:dragonbreak.esp': 'whiterun', '6053:dragonbreak.esp': 'solitude' };
const zones = {
  whiterun: { id: 'whiterun', name: 'Whiterun', treasury: 'f19f:DragonBreak.esp' },
  solitude: { id: 'solitude', name: 'Haafingar', treasury: 'f19e:DragonBreak.esp' },
};
const standing = new Map();
const out = { told: [], audits: [] };
const handlers = new Map();
let giveFails = false;
const api = {
  mp: {
    get, set,
    getIdFromDesc: (d) => (d === '5:DragonBreak.esp' ? BANK_BASE : parseInt(String(d).split(':')[0], 16) >>> 0),
    getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`,
    lookupEspmRecordById: (id) => (RECORDS[id >>> 0] ? { record: RECORDS[id >>> 0] } : { record: null }),
  },
  log: () => {}, personal: (a, t) => out.told.push({ a, t }), audit: (t) => out.audits.push(t), who: (a) => `P${(a >>> 0).toString(16)}`,
  cfg: { bank: {} }, openWidget: () => {}, closeWidget: () => {},
  onUi: (ev, fn) => handlers.set(ev, fn), registerChatCommand: (n, fn) => handlers.set('/' + n, fn),
  takeGold: (a, n) => { if (goldOf(a) < n) return false; set(a, 'inventory', { entries: inv(a).map((x) => ((x.baseId >>> 0) === GOLD ? Object.assign({}, x, { count: x.count - n }) : x)).filter((x) => x.count > 0) }); return true; },
  giveItem: (a, base, n) => { if (giveFails && base !== GOLD) return false; const e = inv(a); const h = e.find((x) => (x.baseId >>> 0) === base && Object.keys(x).length === 2); if (h) h.count += n; else e.push({ baseId: base, count: n }); set(a, 'inventory', { entries: e }); return true; },
  goldOf,
  depositToTreasury: (zid, n, opts) => globalThis.__dboTreasuryZone.deposit(zid, n, opts),
  zoneById: (id) => zones[id] || null, zoneList: () => Object.values(zones),
  zoneOfActor: () => 'whiterun',
  zoneOfCell: (desc) => PINS[String(desc).toLowerCase()] || null,
  isWorldspace: () => false,
  zoneAtPlace: () => null,
  ranksOf: () => [], profileOf: (a) => a & 0xfff,
  distanceMeters: (a, b) => (standing.get(a) === b ? 2 : 50),
  every: () => {},
  onlineActors: () => [P1, P2],
};
require(path.join(SERVER, 'post.js'))(Object.assign({}, api, {
  nameOf: () => 'X', tagOf: () => 'AAAA', discordOf: () => '', cfg: { post: {} }, GOLD_BASE: GOLD,
  recordOf: (id) => (RECORDS[id >>> 0] ? { record: RECORDS[id >>> 0] } : null), boardZoneNear: () => null,
  lettersOf: (a) => get(a, 'private.pigeons') || [], saveLetters: (a, list) => set(a, 'private.pigeons', list), sendMailState: () => {},
  itemName: (desc) => NAMES[parseInt(desc, 16)] || '',
}));
// The counter's mechanics are checked first with its limits opened (the release's numbers: half value, no cap, no reserve);
// the retune's limits (Nat, 25 Oct) are checked at the end with the shipped defaults (load(x, true))
const OPEN = { buyShare: 0.5, dailyPerCharacter: 1e9, dailyPerAccount: 1e9, reserveMin: 0, reserveShare: 0 };
const load = (gemCounter, real) => { api.cfg = { bank: { gemCounter: Object.assign({}, real ? {} : OPEN, gemCounter || {}) } }; handlers.clear(); delete require.cache[BANK]; return require(BANK)(api); };
let mod = load();
const cmd = (a, args) => { out.told.length = 0; handlers.get('/bank')(a, args); return out.told.map((x) => x.t).join(' | '); };
const at = (a, bank) => { standing.set(a, bank); out.told.length = 0; return globalThis.__dboBankActivate(bank, a); };
const ledger = () => JSON.parse(fs.readFileSync('bank.json', 'utf8'));
const zoneGold = (z) => Math.floor(Number((ledger().zones || {})[z]) || 0);
const stock = (z, id) => Math.floor(Number(((ledger().gemStock || {})[z] || {})[id.toString(16)]) || 0);

set(P1, 'inventory', { entries: [{ baseId: GOLD, count: 100 }, { baseId: RUBY, count: 5 }, { baseId: RUBY_FLAWLESS, count: 1 }, { baseId: SWORD, count: 1 }] });
set(P2, 'inventory', { entries: [{ baseId: GOLD, count: 400 }] });
set(P2, 'private.bankGold', 1000);

// Away from a bank, and the list
check('away from a bank the counter is refused', /not at a bank/.test(cmd(P1, 'gems')));
at(P1, BANK_WR);
const list = cmd(P1, 'gems');
check('the list: half the value to buy, three times to sell, with the stock', /Ruby: buys at 100, sells at 600 \(0 in stock\)/.test(list) && /Flawless Ruby: buys at 175, sells at 1050 \(0 in stock\)/.test(list), list);
check('a configured gem with no value is left off the list', !/Diamond|Garnet|Topaz/.test(list), list);
check('the usage line names the counter', /\/bank gems/.test(cmd(P1, 'nonsense')));

// Selling: the treasury pays, and must be able to
check('an empty treasury buys nothing, nothing taken', /Whiterun treasury keeps a reserve and is buying no more gems today/.test(cmd(P1, 'gems sell ruby 2')) && count(P1, RUBY) === 5);
globalThis.__dboTreasuryZone.deposit('whiterun', 1000);
check('a sword is no gem', /buys only gemstones/.test(cmd(P1, 'gems sell iron sword')) && count(P1, SWORD) === 1);
check('more than carried is refused', /between 1 and the 5 Ruby you carry/.test(cmd(P1, 'gems sell ruby 6')) && count(P1, RUBY) === 5);
const sold = cmd(P1, 'gems sell ruby 2');
check('selling 2 rubies: 200 gold into the account, from the treasury, into the stock', /Sold 2 Ruby for 200 gold, paid into your account/.test(sold)
  && count(P1, RUBY) === 3 && get(P1, 'private.bankGold') === 200 && zoneGold('whiterun') === 800 && stock('whiterun', RUBY) === 2, { sold, g: zoneGold('whiterun') });
check('"flawless ruby" is never read as a ruby', /Sold 1 Flawless Ruby for 175 gold/.test(cmd(P1, 'gems sell flawless ruby')) && count(P1, RUBY_FLAWLESS) === 0 && count(P1, RUBY) === 3 && stock('whiterun', RUBY_FLAWLESS) === 1);
check('the sale is audited', out.audits.some((t) => /BANK GEMS Pff000101 sold 2x Ruby \(63b42\) to whiterun for 200 gold from its treasury \(stock 2/.test(t)));
check('"all" sells every one carried', /Sold 3 Ruby for 300 gold/.test(cmd(P1, 'gems sell ruby all')) && stock('whiterun', RUBY) === 5 && zoneGold('whiterun') === 325);

// Buying: only from the stock of this hold, at three times the value, into the treasury
at(P2, BANK_SOL);
check('another hold sells only its own stock (none)', /Bank of Haafingar has no Ruby to sell/.test(cmd(P2, 'gems buy ruby')));
at(P2, BANK_WR);
check('more than the stock is refused', /between 1 and the 5 Ruby in stock/.test(cmd(P2, 'gems buy ruby 6')));
const before = zoneGold('whiterun');
const bought = cmd(P2, 'gems buy ruby 2');
check('buying 2 rubies: 1200 gold, the account first then gold carried, into the treasury', /Bought 2 Ruby for 1200 gold/.test(bought)
  && count(P2, RUBY) === 2 && get(P2, 'private.bankGold') === 0 && goldOf(P2) === 200 && zoneGold('whiterun') === before + 1200 && stock('whiterun', RUBY) === 3, { bought, bank: get(P2, 'private.bankGold'), carried: goldOf(P2) });
check('the purchase counts as the hold\'s income (tithed)', (((ledger().income || {}).whiterun || {}).kinds || {})['gem sales'] === 1200);
check('too little gold is refused, nothing moved', /cost 600 gold, and you have 0 banked and 200 carried/.test(cmd(P2, 'gems buy ruby')) && stock('whiterun', RUBY) === 3 && goldOf(P2) === 200);
set(P2, 'private.bankGold', 5000);
giveFails = true;
const g0 = zoneGold('whiterun');
check('a gem that cannot be handed over: gold back, stock back, treasury unpaid', /could not hand that over/.test(cmd(P2, 'gems buy ruby')) && get(P2, 'private.bankGold') === 5000 && stock('whiterun', RUBY) === 3 && zoneGold('whiterun') === g0);
giveFails = false;

// The gem fee of big deeds (realm.js, nobility.js, tenancy.js): flawless gems only, from the pack
const fee = globalThis.__dboGemFee;
api.giveItem(P2, RUBY_FLAWLESS, 1);
check('a deed asking 2 flawless gems of one who carries 1 (and plain rubies) is refused', /costs 2 flawless gems of any kind, carried \(you carry 1\)/.test(fee.need(P2, 2)) && fee.take(P2, 2, 'whiterun', 'x') === false && count(P2, RUBY_FLAWLESS) === 1);
check('a fee of none asks nothing', fee.need(P2, 0) === '' && fee.take(P2, 0) === true);
const fs0 = stock('whiterun', RUBY_FLAWLESS);
check('one flawless gem taken into the hold\'s counter stock', fee.need(P2, 1) === '' && fee.take(P2, 1, 'whiterun', 'a title') === true && count(P2, RUBY_FLAWLESS) === 0 && count(P2, RUBY) === 2 && stock('whiterun', RUBY_FLAWLESS) === fs0 + 1);
api.giveItem(P2, RUBY_FLAWLESS, 2);
check('without a hold the gems are spent', fee.take(P2, 2, '', 'a war') === true && count(P2, RUBY_FLAWLESS) === 0 && stock('whiterun', RUBY_FLAWLESS) === fs0 + 1
  && out.audits.some((t) => /BANK GEMS Pff000202 paid 2x Flawless Ruby for a war$/.test(t)));

// No hold, and the off switch
at(P1, BANK_NOWHERE);
check('a bank that answers to no hold keeps no counter', /keeps no gem counter/.test(cmd(P1, 'gems')));
mod = load({ enabled: false });
at(P1, BANK_WR);
check('enabled false closes the counter', /gem counter is closed/.test(cmd(P1, 'gems')) && /closed/.test(cmd(P1, 'gems sell ruby')));
mod = load({ buyShare: 0.25, sellShare: 4 });
at(P1, BANK_WR);
check('the shares come from config bank.gemCounter', /Ruby: buys at 50, sells at 800 \(3 in stock\)/.test(cmd(P1, 'gems')));

// ---- the retune (Nat, 25 Oct): 15% of value, a daily cap per character and per account, a treasury reserve ----
const realNow = Date.now; let clock = Date.UTC(2026, 9, 26, 9, 0, 0); Date.now = () => clock;
const P3 = 0xff001101;   // another character of P1's account (profileOf: a & 0xfff)
const ruby = (a, n) => { set(a, 'inventory', { entries: [{ baseId: RUBY, count: n }] }); set(a, 'private.bankGold', 0); };
mod = load({}, true);
globalThis.__dboTreasuryZone.deposit('solitude', 100000);
ruby(P1, 40); at(P1, BANK_SOL);
const rl = cmd(P1, 'gems');
check('the shipped price: a ruby (200) buys at 30, 15% of its value', /Ruby: buys at 30, sells at 600/.test(rl) && /Flawless Ruby: buys at 52,/.test(rl), rl);
check('the list says what the counter will still pay you today', /It pays you up to 500 more gold for gems today\./.test(rl), rl);
// The character's cap: 500 a day buys 16 rubies at 30 (480), and a 17th would cross it
let r = cmd(P1, 'gems sell ruby 20');
check('20 asked, 16 bought (480 of the 500 a day), and the seller is told why', /Sold 16 Ruby for 480 gold/.test(r) && /took only 16 of 20: that is all it pays you today/.test(r)
  && count(P1, RUBY) === 24 && get(P1, 'private.bankGold') === 480, r);
r = cmd(P1, 'gems sell ruby 1');
check('the next one is refused: the daily cap, nothing taken', /You have been paid the 500 gold a day the counter pays anyone for gems\. It buys again after midnight UTC\./.test(r) && count(P1, RUBY) === 24, r);
check('...and the refusal is audited', out.audits.some((t) => /^BANK GEMS Pff000101 refused at solitude: the daily cap \(1x 63b42 at 30\)$/.test(t)));
// The account's cap: an alt of the same profile cannot sell on, another account can
ruby(P3, 5); at(P3, BANK_SOL);
r = cmd(P3, 'gems sell ruby 1');
check('an alt of the same account is refused: the account has had its 500', /Your characters have been paid the 500 gold a day the counter pays an account/.test(r) && count(P3, RUBY) === 5, r);
check('...audited as the account\'s cap', out.audits.some((t) => /^BANK GEMS Pff001101 refused at solitude: the account's daily cap/.test(t)));
ruby(P2, 3); at(P2, BANK_SOL);
check('another account sells as usual', /Sold 3 Ruby for 90 gold/.test(cmd(P2, 'gems sell ruby 3')));
mod = load({ dailyPerCharacter: 300, dailyPerAccount: 500 }, true);
at(P3, BANK_SOL);
check('the caps come from config: the account has 20 of its 500 left, too little for one ruby at 30, so the alt sells none',
  /Your characters have been paid the 500 gold a day/.test(cmd(P3, 'gems sell ruby 5')) && count(P3, RUBY) === 5);
mod = load({ dailyPerCharacter: 300, dailyPerAccount: 560 }, true);
at(P3, BANK_SOL);
r = cmd(P3, 'gems sell ruby 5');
check('...raise the account cap to 560 and the alt sells the 2 that fit (60 of 80 left)', /Sold 2 Ruby for 60 gold/.test(r) && /took only 2 of 5/.test(r) && count(P3, RUBY) === 3, r);
// A new UTC day starts the counts again
clock += 86400000; mod = load({}, true);
at(P1, BANK_SOL);
check('the next UTC day the character may sell again', /Sold 5 Ruby for 150 gold/.test(cmd(P1, 'gems sell ruby 5')));
check('the day\'s counts are in bank.json gemSales', ledger().gemSales.day === '2026-10-27' && ledger().gemSales.chars.ff000101 === 150 && ledger().gemSales.accounts['257'] === 150, ledger().gemSales);
// The treasury reserve: half of what the hold held at its first sale today, and never below reserveMin
clock += 86400000; mod = load({ dailyPerCharacter: 1e9, dailyPerAccount: 1e9, reserveMin: 0 }, true);
const W = zoneGold('whiterun'); const spare = W - Math.floor(W * 0.5); const fit = Math.floor(spare / 30);
ruby(P2, fit + 20); at(P2, BANK_WR);
r = cmd(P2, `gems sell ruby ${fit + 20}`);
check(`the hold pays down to half its morning treasury: ${fit} of ${fit + 20} bought, then the reserve`, new RegExp(`Sold ${fit} Ruby for ${fit * 30} gold`).test(r) && /the Whiterun treasury keeps a reserve/.test(r)
  && zoneGold('whiterun') >= Math.floor(W * 0.5), { r, W, now: zoneGold('whiterun') });
r = cmd(P2, 'gems sell ruby 1');
check('then it buys none, with a clear line, and the refusal is audited', /The Whiterun treasury keeps a reserve and is buying no more gems today/.test(r)
  && out.audits.some((t) => /^BANK GEMS Pff000202 refused at whiterun: the treasury reserve/.test(t)), r);
globalThis.__dboTreasuryZone.deposit('whiterun', 300);
check('gold paid in later is spendable, but the reserve stays where the morning set it', /Sold 10 Ruby for 300 gold/.test(cmd(P2, 'gems sell ruby 12')) && /keeps a reserve/.test(cmd(P2, 'gems sell ruby 1')));
mod = load({ dailyPerCharacter: 1e9, dailyPerAccount: 1e9, reserveMin: 1e9 }, true);
at(P2, BANK_SOL);
check('reserveMin: a hold below it buys nothing', /The Haafingar treasury keeps a reserve/.test(cmd(P2, 'gems sell ruby 1')));
check('the shipped config: the counter is on (Nat OK, 25 Oct), with the retuned numbers', (() => {
  const c = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8')).bank.gemCounter;
  return c.enabled === true && c.buyShare === 0.15 && c.dailyPerCharacter === 500 && c.dailyPerAccount === 500 && c.reserveShare === 0.5 && c.reserveMin === 5000;
})());
Date.now = realNow;

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
