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
const load = (gemCounter) => { api.cfg = { bank: gemCounter ? { gemCounter } : {} }; handlers.clear(); delete require.cache[BANK]; return require(BANK)(api); };
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
check('an empty treasury buys nothing, nothing taken', /Whiterun treasury cannot pay 200 gold/.test(cmd(P1, 'gems sell ruby 2')) && count(P1, RUBY) === 5);
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

// No hold, and the off switch
at(P1, BANK_NOWHERE);
check('a bank that answers to no hold keeps no counter', /keeps no gem counter/.test(cmd(P1, 'gems')));
mod = load({ enabled: false });
at(P1, BANK_WR);
check('enabled false closes the counter', /gem counter is closed/.test(cmd(P1, 'gems')) && /closed/.test(cmd(P1, 'gems sell ruby')));
mod = load({ buyShare: 0.25, sellShare: 4 });
at(P1, BANK_WR);
check('the shares come from config bank.gemCounter', /Ruby: buys at 50, sells at 800 \(3 in stock\)/.test(cmd(P1, 'gems')));

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
