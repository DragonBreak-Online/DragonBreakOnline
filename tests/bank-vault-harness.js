// Scripted test for the vaults in server\bank.js (Nate, 16 Oct: goods stored by weight, one vault per hold, the weekly fee
// to the hold's treasury), with the real post.js for taking and handing over goods and a mock gamemode api. Weights come
// from the records' DATA, the fee from the account then gold carried, arrears block withdrawals and never touch the goods,
// and a vault opens only at a bank of its own hold. No server and no game:
//
//   node tests/bank-vault-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const BANK = path.join(SERVER, 'bank.js');
process.chdir(fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-bankvault-')));

let failures = 0;
const check = (label, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const GOLD = 0xf, BANK_BASE = 0x0b000005;
const SWORD = 0x12eb7, POTION = 0x3eadd, BOOK = 0x1000, ARROW = 0x1397d, TORCH = 0x1d4ec, ROBE = 0x2000, KEY = 0x3000, PARCEL = 0x4000;
const BANK_WR = 0xff000501, BANK_SOL = 0xff000502, BANK_DAWN = 0xff000503, BANK_NOWHERE = 0xff000504;
const P1 = 0xff000101, P2 = 0xff000202;
// DATA with a float32 weight at the record type's offset
const data = (len, off, w) => { const b = new Uint8Array(len); new DataView(b.buffer).setFloat32(off, w, true); return b; };
const RECORDS = {
  [SWORD]: { type: 'WEAP', flags: 0, editorId: 'IronSword', fields: [{ type: 'DATA', data: data(10, 4, 9) }] },
  [POTION]: { type: 'ALCH', flags: 0, editorId: 'RestoreHealth01', fields: [{ type: 'DATA', data: data(4, 0, 0.5) }] },
  [BOOK]: { type: 'BOOK', flags: 0, editorId: 'SpellTomeX', fields: [{ type: 'DATA', data: data(16, 12, 1) }] },
  [ARROW]: { type: 'AMMO', flags: 0, editorId: 'IronArrow', fields: [{ type: 'DATA', data: data(20, 16, 0.1) }] },
  [TORCH]: { type: 'LIGH', flags: 0, editorId: 'Torch01', fields: [{ type: 'DATA', data: data(48, 44, 0.5) }] },
  [ROBE]: { type: 'ARMO', flags: 0x4, editorId: 'VampireLordRobe', fields: [{ type: 'DATA', data: data(8, 4, 1) }] },
  [KEY]: { type: 'KEYM', flags: 0, editorId: 'HouseKey', fields: [{ type: 'DATA', data: data(8, 4, 0) }] },
  [PARCEL]: { type: 'MISC', flags: 0, editorId: 'CourierParcel', fields: [{ type: 'DATA', data: data(8, 4, 2) }] },
  [GOLD]: { type: 'MISC', flags: 0, editorId: 'Gold001', fields: [{ type: 'DATA', data: data(8, 4, 0) }] },
};
const NAMES = { [SWORD]: 'Iron Sword', [POTION]: 'Potion of Minor Healing', [ARROW]: 'Iron Arrow' };

const props = new Map();
const set = (id, k, v) => props.set(`${id >>> 0}|${k}`, JSON.parse(JSON.stringify(v)));
const get = (id, k) => { const v = props.get(`${id >>> 0}|${k}`); return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
const inv = (id) => (get(id, 'inventory') || { entries: [] }).entries;
const count = (id, base) => inv(id).reduce((n, e) => n + ((Number(e.baseId) >>> 0) === base ? Number(e.count) : 0), 0);
const goldOf = (a) => count(a, GOLD);
for (const b of [BANK_WR, BANK_SOL, BANK_DAWN, BANK_NOWHERE]) set(b, 'baseDesc', '5:DragonBreak.esp');
const ZONE_AT = { [BANK_WR]: 'whiterun', [BANK_SOL]: 'solitude', [BANK_DAWN]: 'dawnstar', [BANK_NOWHERE]: null };
const zones = {
  whiterun: { id: 'whiterun', name: 'Whiterun', treasury: 'f19f:DragonBreak.esp' },
  solitude: { id: 'solitude', name: 'Haafingar', treasury: 'f19e:DragonBreak.esp' },
  dawnstar: { id: 'dawnstar', name: 'The Pale' },
};
const standing = new Map();   // actor -> bank ref they stand at
const out = { told: [], widgets: [], audits: [] };
const handlers = new Map(); const timers = new Map();
let clock = Date.UTC(2026, 9, 16, 12, 0, 0);
Date.now = () => clock;
globalThis.__dboTradeItemVeto = (a, id) => ((id >>> 0) === PARCEL ? 'A sealed parcel stays with its courier.' : null);

const api = {
  mp: {
    get, set,
    getIdFromDesc: (d) => (d === '5:DragonBreak.esp' ? BANK_BASE : parseInt(String(d).split(':')[0], 16) >>> 0),
    getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`,
    lookupEspmRecordById: (id) => (RECORDS[id >>> 0] ? { record: RECORDS[id >>> 0] } : { record: null }),
  },
  log: () => {}, personal: (a, t) => out.told.push({ a, t }), audit: (t) => out.audits.push(t), who: (a) => `P${(a >>> 0).toString(16)}`,
  cfg: {}, openWidget: (a, w) => out.widgets.push({ a, w }), closeWidget: () => {},
  onUi: (ev, fn) => handlers.set(ev, fn), registerChatCommand: (n, fn) => handlers.set('/' + n, fn),
  takeGold: (a, n) => { if (goldOf(a) < n) return false; set(a, 'inventory', { entries: inv(a).map((x) => ((x.baseId >>> 0) === GOLD ? Object.assign({}, x, { count: x.count - n }) : x)).filter((x) => x.count > 0) }); return true; },
  giveItem: (a, base, n) => { const e = inv(a); const h = e.find((x) => (x.baseId >>> 0) === base && Object.keys(x).length === 2); if (h) h.count += n; else e.push({ baseId: base, count: n }); set(a, 'inventory', { entries: e }); return true; },
  goldOf,
  depositToTreasury: (zid, n) => globalThis.__dboTreasuryZone.deposit(zid, n),
  zoneById: (id) => zones[id] || null, zoneList: () => Object.values(zones),
  zoneOfActor: (a) => ZONE_AT[standing.get(a)] || null,
  ranksOf: () => [], profileOf: (a) => a & 0xfff,
  distanceMeters: (a, b) => (standing.get(a) === b ? 2 : 50),
  every: (name, ms, fn) => timers.set(name, fn),
  onlineActors: () => [P1, P2],
};
// The real post.js, for takeItems, giveEntries, sendableBase and item names
require(path.join(SERVER, 'post.js'))(Object.assign({}, api, {
  nameOf: () => 'X', tagOf: () => 'AAAA', discordOf: () => '', cfg: { post: {} }, GOLD_BASE: GOLD,
  recordOf: (id) => (RECORDS[id >>> 0] ? { record: RECORDS[id >>> 0] } : null), boardZoneNear: () => null,
  lettersOf: () => [], saveLetters: () => {}, sendMailState: () => {}, itemName: (desc) => NAMES[parseInt(desc, 16)] || '',
}));
const load = () => { handlers.clear(); delete require.cache[BANK]; return require(BANK)(api); };
let mod = load();

const cmd = (a, args) => { out.told.length = 0; handlers.get('/bank')(a, args); return out.told.map((x) => x.t).join(' | '); };
const at = (a, bank) => { standing.set(a, bank); out.told.length = 0; return globalThis.__dboBankActivate(bank, a); };
const vault = (a, z) => (get(a, 'private.bankStorage') || {})[z];
const zoneGold = (z) => Math.floor(Number((JSON.parse(fs.readFileSync('bank.json', 'utf8')).zones || {})[z]) || 0);

// Weights from the records, at each type's DATA offset (checked against Skyrim.esm: IronSword 9, RestoreHealth01 0.5,
// a spell tome 1, IronArrow 0.1, Torch01 0.5)
check('weights come from DATA at the right offset per type', mod.weightOf(SWORD) === 9 && mod.weightOf(POTION) === 0.5 && mod.weightOf(BOOK) === 1 && mod.weightOf(ARROW) === 0.1 && mod.weightOf(TORCH) === 0.5,
  [SWORD, POTION, BOOK, ARROW, TORCH].map(mod.weightOf));

set(P1, 'inventory', { entries: [{ baseId: GOLD, count: 100 }, { baseId: SWORD, count: 20 }, { baseId: SWORD, count: 1, enchantmentId: 0xabc, health: 1.3 }, { baseId: SWORD, count: 1, worn: true },
  { baseId: POTION, count: 4 }, { baseId: ROBE, count: 1 }, { baseId: KEY, count: 1 }, { baseId: PARCEL, count: 1 }] });
set(P1, 'private.bankGold', 30);

// Renting at Whiterun
check('the bank resolves to its hold', at(P1, BANK_WR) === true);
check('/bank vault lists the tiers before one is rented', /Vaults in Whiterun: strongbox 100 weight for 25 gold a week; coffer 250 weight for 50 gold a week; vault 500 weight for 90 gold a week; strongroom 1000 weight for 150 gold a week/.test(cmd(P1, 'vault')), cmd(P1, 'vault'));
check('an unknown tier is refused with the list', /Rent one of: strongbox \(100 weight/.test(cmd(P1, 'rent huge')) && !vault(P1, 'whiterun'));
check('renting a coffer takes the first week from the account, then gold carried', /You rent a Coffer in Whiterun: 250 weight, 50 gold a week.*Paid 50 gold/.test(cmd(P1, 'rent coffer'))
  && get(P1, 'private.bankGold') === 0 && goldOf(P1) === 80 && vault(P1, 'whiterun').tier === 'coffer');
check('the fee goes into the Whiterun treasury', zoneGold('whiterun') === 50 && out.audits.some((t) => /BANK VAULT Pff000101 paid 50 gold \(30 banked, 20 carried\) to whiterun for renting a coffer vault/.test(t)));
check('the same tier twice is refused', /already rent a Coffer/.test(cmd(P1, 'rent coffer')) && zoneGold('whiterun') === 50);

// Storing
const carryList = () => mod.vaultView(P1).carry.map((e) => `${e.name}:${e.count}`).join(',');
check('what you can store: loose, playable, no gold, no keys, no game gear; worn items do not count', carryList() === 'Courier Parcel:1,Iron Sword:21,Potion of Minor Healing:4', carryList());
check('a courier\'s sealed parcel is refused by the trade veto', /sealed parcel stays/.test(mod.vaultStore(P1, PARCEL, 1).text) && count(P1, PARCEL) === 1);
check('gold and non-playable gear are refused', /will not take that/.test(mod.vaultStore(P1, GOLD, 10).text) && /will not take that/.test(mod.vaultStore(P1, ROBE, 1).text));
check('storing 10 swords (90 weight)', /Stored 10 Iron Sword in your vault in Whiterun \(90 of 250 weight\)/.test(mod.vaultStore(P1, SWORD, 10).text) && count(P1, SWORD) === 12);
api.giveItem(P1, SWORD, 20);
check('more than the vault holds is refused, nothing taken', /weighs 180; your vault holds 250 and 90 is used/.test(mod.vaultStore(P1, SWORD, 20).text) && count(P1, SWORD) === 32);
set(P1, 'inventory', { entries: inv(P1).map((e) => (e.baseId === SWORD && Object.keys(e).length === 2 ? Object.assign(e, { count: e.count - 20 }) : e)) });
check('more than you carry loose is refused', /between 1 and the 11 you carry/.test(mod.vaultStore(P1, SWORD, 12).text));
const r = mod.vaultStore(P1, SWORD, 'all');
check('"all" stores every loose one, plain first, the enchanted one kept apart; the worn one stays on you', r.ok && count(P1, SWORD) === 1 && inv(P1).find((e) => e.baseId === SWORD).worn === true
  && vault(P1, 'whiterun').items.length === 2 && vault(P1, 'whiterun').items[1].enchantmentId === 0xabc && mod.vaultView(P1).used === 189, JSON.stringify(vault(P1, 'whiterun')));
check('storing is audited with the base', out.audits.some((t) => /BANK VAULT Pff000101 stored 10x Iron Sword \(12eb7\) in whiterun \(90\/250\)/.test(t)));
check('the chat lists the vault with numbers, a special item marked', /1\) 20 Iron Sword, 2\) 1 Iron Sword\*/.test(cmd(P1, 'vault')), cmd(P1, 'vault'));

// Taking out
check('take by number gives back the enchanted sword with its enchantment and tempering', /Took 1 Iron Sword/.test(cmd(P1, 'take 2'))
  && inv(P1).some((e) => e.baseId === SWORD && e.enchantmentId === 0xabc && e.health === 1.3) && vault(P1, 'whiterun').items.length === 1);
check('a stale row (wrong base) is refused', /no longer in your vault/.test(mod.vaultTake(P1, 0, POTION, 1).text) && vault(P1, 'whiterun').items[0].count === 20);
check('take part of a stack', mod.vaultTake(P1, 0, SWORD, 5).ok && vault(P1, 'whiterun').items[0].count === 15 && count(P1, SWORD) === 7);
check('taking is audited', out.audits.some((t) => /BANK VAULT Pff000101 took 5x Iron Sword \(12eb7\) out of whiterun/.test(t)));

// Per hold: Solitude's bank does not open the Whiterun vault
at(P1, BANK_SOL);
const vs = mod.vaultView(P1);
check('at Solitude the Whiterun vault is only listed as stored elsewhere', vs.zone === 'solitude' && !vs.rented && vs.elsewhere.length === 1 && vs.elsewhere[0].zone === 'whiterun' && vs.elsewhere[0].used === 135, JSON.stringify(vs.elsewhere));
check('the chat says where the goods are', /Stored in Whiterun: 1 kind\(s\) of goods, 135 weight\. Only a bank of that hold opens it/.test(cmd(P1, 'vault')));
check('nothing comes out of Whiterun\'s vault at Solitude', /keep nothing in a vault in Haafingar/.test(mod.vaultTake(P1, 0, SWORD, 1).text) && vault(P1, 'whiterun').items[0].count === 15);
check('nothing goes in without a vault in this hold', /rent no vault in Haafingar/.test(mod.vaultStore(P1, POTION, 1).text));
set(P1, 'private.bankGold', 1000);
check('a second vault, its own tier, in another hold, paid to that hold', /You rent a Strongbox in Haafingar/.test(cmd(P1, 'rent strongbox')) && zoneGold('solitude') === 25 && zoneGold('whiterun') === 50 && vault(P1, 'whiterun').tier === 'coffer');
check('store in the Solitude strongbox', mod.vaultStore(P1, POTION, 4).ok && vault(P1, 'solitude').items[0].count === 4 && mod.vaultView(P1).used === 2);

// A bank whose cell resolves to no hold keeps no vaults
at(P1, BANK_NOWHERE);
check('a bank with no hold refuses vaults', /answers to no hold/.test(cmd(P1, 'rent strongbox')) && /answers to no hold/.test(cmd(P1, 'vault')));

// The weekly fee
at(P1, BANK_WR);
clock += 7 * 86400000 + 1000;
mod.vaultView(P1);
check('a week later the fee is taken from the account, to Whiterun', get(P1, 'private.bankGold') === 975 - 50 - 25 && zoneGold('whiterun') === 100 && !(vault(P1, 'whiterun').owed > 0), [get(P1, 'private.bankGold'), zoneGold('whiterun'), vault(P1, 'whiterun')]);
check('Solitude\'s week is settled at Solitude\'s rate too (its own vault, its own treasury)', zoneGold('solitude') === 50 && get(P1, 'private.bankGold') === 900, [zoneGold('solitude'), get(P1, 'private.bankGold')]);
// Penniless for two weeks
set(P1, 'private.bankGold', 0); set(P1, 'inventory', { entries: inv(P1).filter((e) => e.baseId !== GOLD) });
clock += 14 * 86400000;
timers.get('bankVaultFees')();
at(P1, BANK_WR);
check('the hourly tick settles online characters: two unpaid weeks are owed, nothing taken', vault(P1, 'whiterun').owed === 100 && vault(P1, 'whiterun').weeksOwed === 2 && vault(P1, 'whiterun').items[0].count === 15, vault(P1, 'whiterun'));
check('arrears block withdrawals and keep the goods', /held for 100 gold unpaid/.test(cmd(P1, 'take 1 1')) && vault(P1, 'whiterun').items[0].count === 15 && count(P1, SWORD) === 7);
check('deposits are still taken in arrears', mod.vaultStore(P1, SWORD, 1).ok && vault(P1, 'whiterun').items[0].count === 16);
check('a tier change waits for the debt', /Settle the 100 gold you owe/.test(cmd(P1, 'rent vault')));
check('giving it up waits for the debt', /Settle the 100 gold you owe first/.test(cmd(P1, 'vault end')));
clock += 70 * 86400000;
at(P1, BANK_WR);
mod.vaultView(P1);
check(`arrears stop growing after arrearsCapWeeks (4)`, vault(P1, 'whiterun').owed === 200 && vault(P1, 'whiterun').weeksOwed === 4, vault(P1, 'whiterun'));
check('paying needs the whole debt', /You owe 200 gold, and have 0 banked and 0 carried/.test(cmd(P1, 'pay')));
api.giveItem(P1, GOLD, 150); set(P1, 'private.bankGold', 100);
check('paying the arrears from account and carried gold opens the vault again', /Paid the 200 gold you owed/.test(cmd(P1, 'pay')) && vault(P1, 'whiterun').owed === 0 && get(P1, 'private.bankGold') === 0 && goldOf(P1) === 50 && zoneGold('whiterun') === 300);
check('after paying, goods come out', /Took 16 Iron Sword/.test(cmd(P1, 'take 1 all')) && vault(P1, 'whiterun').items.length === 0);

// Tier changes: down only if the goods fit, the rest of a paid week counts towards the new one
mod.vaultStore(P1, SWORD, 20);
check('downgrading below the goods\' weight is refused', /Your goods here weigh 180; a Strongbox holds 100/.test(cmd(P1, 'rent strongbox')));
set(P1, 'private.bankGold', 1000);
const wrBefore = zoneGold('whiterun');
const credit = Math.floor(50 * (vault(P1, 'whiterun').paidUntil - clock) / (7 * 86400000));
check('upgrading credits the unused part of the paid week against the new one', credit > 0 && new RegExp(`You rent a Vault in Whiterun: 500 weight.*Paid ${90 - credit} gold`).test(cmd(P1, 'rent vault')) && zoneGold('whiterun') === wrBefore + 90 - credit && vault(P1, 'whiterun').items[0].count === 20, cmd(P1, 'vault'));
check('giving up a vault with goods in it is refused', /Empty the vault/.test(cmd(P1, 'vault end')));
cmd(P1, 'take 1 all');
check('an empty vault, nothing owed, can be given up', /You gave up your vault in Whiterun/.test(cmd(P1, 'vault end')) && !vault(P1, 'whiterun') && !!vault(P1, 'solitude'));

// A hold without a treasury chest (The Pale) keeps the fee in its bank.json balance
at(P1, BANK_DAWN);
check('The Pale has no treasury: its fee is kept for it in bank.json', /You rent a Strongbox in The Pale/.test(cmd(P1, 'rent strongbox')) && zoneGold('dawnstar') === 25
  && out.audits.some((t) => /25 gold kept for dawnstar in bank.json/.test(t)));

// Being at the bank
standing.set(P1, 0);
check('away from the bank nothing moves', /not at a bank/.test(mod.vaultStore(P1, SWORD, 1).text) && /not at a bank/.test(cmd(P1, 'vault')));

// The panel: the vault rides in widget 48 only for a UI that says bankVault
handlers.get('uiCaps')(P2, ['bank']);
set(P2, 'inventory', { entries: [{ baseId: GOLD, count: 500 }, { baseId: POTION, count: 2 }] });
out.widgets.length = 0;
at(P2, BANK_WR);
check('an older panel gets no vault field and a chat line pointing to /bank vault', out.widgets.length === 1 && out.widgets[0].w.vault === undefined && out.told.some((x) => /\/bank vault/.test(x.t)));
handlers.get('uiCaps')(P2, ['bank', 'bankVault']);
out.widgets.length = 0;
at(P2, BANK_WR);
const w = out.widgets[0].w;
check('a vault panel gets this hold\'s vault data', w.vault && w.vault.zone === 'whiterun' && w.vault.tiers.length === 4 && w.vault.rented === false && w.vault.carry.length === 1, JSON.stringify(w.vault));
handlers.get('bankRent')(P2, [w.nonce, 'strongbox']);
const w2 = out.widgets[out.widgets.length - 1].w;
check('renting from the panel answers in the panel', w2.resultKind === 'ok' && w2.vault.rented && w2.vault.cap === 100 && w2.vault.weekly === 25);
handlers.get('bankStore')(P2, [w2.nonce, String(POTION), '2']);
const w3 = out.widgets[out.widgets.length - 1].w;
check('storing from the panel', w3.resultKind === 'ok' && w3.vault.items.length === 1 && w3.vault.used === 1 && count(P2, POTION) === 0);
handlers.get('bankTake')(P2, ['stale', 0, String(POTION), '2']);
check('a stale window is ignored', count(P2, POTION) === 0);
handlers.get('bankTake')(P2, [w3.nonce, 0, String(POTION), '1']);
check('taking from the panel', count(P2, POTION) === 1 && out.widgets[out.widgets.length - 1].w.vault.items[0].count === 1);

// A hot reload keeps the vaults (they live on the character) and who stands where
mod = load();
check('after a reload the vault and the session are still there', mod.vaultTake(P2, 0, POTION, 1).ok && count(P2, POTION) === 2 && vault(P2, 'whiterun').items.length === 0);

// The bank audit (16 Oct, every TheBank ref in the 140-plugin order): each bank cell is pinned to its hold in zone-cells.json
const CELLS = JSON.parse(fs.readFileSync(path.join(SERVER, 'zone-cells.json'), 'utf8'));
const BANK_CELLS = {
  '1a97:DragonBreak.esp': 'whiterun', '1fb39:DragonBreak.esp': 'riften', 'e6114:Riften Expansion.esp': 'riften', '6053:DragonBreak.esp': 'solitude',
  'b93c:DragonBreak.esp': 'windhelm', '613a:DragonBreak.esp': 'markarth', '7b62:DragonBreak.esp': 'falkreath', '7d80:DragonBreak.esp': 'morthal',
  '1b5f3f:DragonBreak Online Edits.esp': 'dawnstar', 'e682:DragonBreak.esp': 'winterhold', '26228:DragonBreak Online Edits.esp': 'winterhold',
  '130040:DragonBreak Online Edits.esp': 'bruma',
};
const ZONES = JSON.parse(fs.readFileSync(path.join(SERVER, 'zones.json'), 'utf8'));
const zoneIds = new Set([].concat(ZONES.holds || [], ZONES.regions || [], ZONES.strongholds || []).map((z) => z.id));
check('every bank cell is pinned to its hold, and every hold named exists in zones.json', Object.entries(BANK_CELLS).every(([c, z]) => CELLS[c] === z && zoneIds.has(z)),
  Object.entries(BANK_CELLS).filter(([c, z]) => CELLS[c] !== z || !zoneIds.has(z)));

console.log(failures ? `${failures} failure(s)` : 'all passed');
if (process.env.DUMP) console.log(out.audits.join('\n'));
