// Player shops (shops.js through business.js, Nate 19 Oct): a business's shop chest, chosen like storage for rent; the
// guard (owner and staff only, fail closed); prices per item kind; the buy flow with exact roll-back; the money split
// through ledgersale.js (hold tax marked as sales income, the sink, the owner's bank or a faction's treasury); restarts;
// closing the business. Loads the real business.js, shops.js and ledgersale.js against a stub mp in a scratch directory,
// and the gamemode's stand-in (businessFailClosed) out of gamemode.js itself.
//   node tests/player-shops-harness.js   (from server/; scratch under $TMPDIR, e.g. TMPDIR=/dev/shm)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const BUSINESS = path.resolve(__dirname, '..', 'business.js');
const LEDGERSALE = path.resolve(__dirname, '..', 'ledgersale.js');
const GAMEMODE = path.resolve(__dirname, '..', 'gamemode.js');
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-shops-'));
process.chdir(scratch);

// Two businesses: Olaf's in CELL, Hal's in CELL2. Chests: SHOP and RENTC in CELL, SHOP2 in CELL2
const CELL = 0x100, CELL2 = 0x110, WORLD = 0x3c, DOOR = 0x200, OUTDOOR = 0x201, DOOR2 = 0x210, OUTDOOR2 = 0x211;
const SHOP = 0x300, RENTC = 0x302, SPARE = 0x303, SHOP2 = 0x310, CHEST_BASE = 0x301, LEDGER = 0x320, BARREL = 0x330;
const OWNER = 0xff000001, STAFF = 0xff000002, BUYER = 0xff000003, POOR = 0xff000004, STRAY = 0xff000005, HAL = 0xff000006, LEAD = 0xff000007, NEWOWNER = 0xff000008;
const PROFILE = { [OWNER]: 7, [STAFF]: 8, [BUYER]: 9, [POOR]: 10, [STRAY]: 11, [HAL]: 12, [LEAD]: 13, [NEWOWNER]: 14 };
const NAME = { [OWNER]: 'Olaf', [STAFF]: 'Sigrid', [BUYER]: 'Brand', [POOR]: 'Pell', [STRAY]: 'Stray', [HAL]: 'Hal', [LEAD]: 'Eadric', [NEWOWNER]: 'Nils' };
// Items: a plain iron sword, an artifact, a key, a potion; the enchanted sword is the iron sword's base with extra data
const SWORD = 0x500, DAWN = 0x501, KEY = 0x502, POTION = 0x503, GOLD = 0xf;
const RECORDS = {
  [CELL]: { type: 'CELL' }, [CELL2]: { type: 'CELL' }, [WORLD]: { type: 'WRLD' }, [CHEST_BASE]: { type: 'CONT' },
  [SWORD]: { type: 'WEAP', editorId: 'IronSword' }, [DAWN]: { type: 'WEAP', editorId: 'DA09Dawnbreaker' },
  [KEY]: { type: 'KEYM', editorId: 'BrumaHouseKey' }, [POTION]: { type: 'ALCH', editorId: 'RestoreHealth01' }, [GOLD]: { type: 'MISC', editorId: 'Gold001' },
};
globalThis.__alduinakItemName = (id) => ({ [SWORD]: 'Iron Sword', [DAWN]: 'Dawnbreaker', [KEY]: 'House Key', [POTION]: 'Potion of Minor Healing' })[id] || '';
const FG = { id: 'fighters-guild', name: 'Fighters Guild' };
const MEMBERS = { [OWNER]: [[FG, 'member']], [LEAD]: [[FG, 'leader']] };
globalThis.__dboGuildsOf = (a) => (MEMBERS[a] || []).map(([f, role]) => ({ id: f.id, name: f.name, role, title: role }));
globalThis.__dboGuildInfo = (id) => (id === FG.id ? { id, name: FG.name } : null);
globalThis.__dboHallOf = () => [];
const factionDeposits = [];
globalThis.__dboTreasury = { deposit: (fid, n, why, o) => { factionDeposits.push({ fid, n, why, income: o && o.income }); return true; } };

fs.writeFileSync('housing.json', JSON.stringify([DOOR, DOOR2]));
const props = new Map();
const setp = (id, k, v) => props.set(`${id >>> 0}|${k}`, v);
const getp = (id, k) => props.get(`${id >>> 0}|${k}`);
const desc = (id) => `${id.toString(16)}:Skyrim.esm`;
setp(DOOR, 'private.housing', { owner: 7, ownerName: 'Olaf', partner: OUTDOOR });
setp(DOOR2, 'private.housing', { owner: 12, ownerName: 'Hal', partner: OUTDOOR2 });
for (const [d, c] of [[DOOR, CELL], [OUTDOOR, WORLD], [DOOR2, CELL2], [OUTDOOR2, WORLD], [SHOP, CELL], [RENTC, CELL], [SPARE, CELL], [SHOP2, CELL2], [LEDGER, CELL], [BARREL, CELL]]) setp(d, 'worldOrCellDesc', desc(c));
for (const c of [SHOP, RENTC, SPARE, SHOP2]) setp(c, 'baseDesc', desc(CHEST_BASE));
setp(BARREL, 'baseDesc', desc(SWORD)); // not a container
for (const a of Object.keys(PROFILE).map(Number)) { setp(a, 'worldOrCellDesc', desc(CELL)); setp(a, 'type', 'MpActor'); }
setp(HAL, 'worldOrCellDesc', desc(CELL2));
setp(LEDGER, 'private.dboBizLedger', { claim: DOOR.toString(16) });
// Inventories
const inv = (id) => ((getp(id, 'inventory') || {}).entries || []);
const setInv = (id, entries) => setp(id, 'inventory', { entries });
const countOf = (id, base, pred) => inv(id).filter((e) => e.baseId === base && (!pred || pred(e))).reduce((n, e) => n + e.count, 0);
const goldOf = (id) => countOf(id, GOLD);
setInv(BUYER, [{ baseId: GOLD, count: 1000 }, { baseId: SWORD, count: 1, worn: true }]);
setInv(POOR, [{ baseId: GOLD, count: 15 }]);
setInv(STRAY, [{ baseId: GOLD, count: 500 }]);
const ENCH = { baseId: SWORD, count: 1, enchantmentId: 0xff001234, maxCharge: 1500, chargePercent: 80, health: 1.4, name: 'Frostbite' };
// Writes can be made to fail: throw on a target, or be silently dropped (the read-back must catch it)
const FAIL = { throwOn: 0, dropOn: 0, stickOn: 0, stuck: false };
const emptied = [];
globalThis.__dboEmptyWorldContainer = (ref) => { emptied.push(ref); };
const mp = {
  get: (id, k) => getp(id, k),
  set: (id, k, v) => {
    if (k === 'inventory' && FAIL.throwOn === (id >>> 0)) throw new Error('stub write refused');
    if (k === 'inventory' && FAIL.dropOn === (id >>> 0)) return;
    if (k === 'inventory' && FAIL.stickOn === (id >>> 0)) { if (!FAIL.stuck) { FAIL.stuck = true; setp(id, k, v); } throw new Error('stub write landed, then threw'); }
    setp(id, k, v);
  },
  getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16),
  getDescFromId: (id) => (id >>> 0).toString(16),
  lookupEspmRecordById: (id) => (RECORDS[id] ? { record: Object.assign({}, RECORDS[id]) } : null),
  getActorsByProfileId: (p) => Object.keys(PROFILE).filter((a) => PROFILE[a] === p).map(Number),
  callPapyrusFunction: () => null,
};
const treasury = {}, treasuryMarks = [], said = [], cmds = {}, ui = {}, audits = [], panels = new Map();
const takeGold = (a, n) => {
  const es = inv(a).map((e) => Object.assign({}, e));
  const g = es.find((e) => e.baseId === GOLD && !e.worn);
  if (!g || g.count < n) return false;
  g.count -= n; setInv(a, es.filter((e) => e.count > 0)); return true;
};
const giveGold = (a, n) => {
  const es = inv(a).map((e) => Object.assign({}, e));
  const g = es.find((e) => e.baseId === GOLD && Object.keys(e).length === 2);
  if (g) g.count += n; else es.push({ baseId: GOLD, count: n });
  setInv(a, es); return true;
};
const baseCfg = { rest: { holdShare: 0.1 }, business: { chestRentPaused: false }, ledgerSale: { hallCells: {} }, shops: { maxPrice: 100000 } };
const api = {
  mp, log: () => {}, audit: (t) => audits.push(t), who: (a) => NAME[a], display: (a) => NAME[a],
  personal: (a, t) => said.push([a >>> 0, t]), cfg: baseCfg,
  openWidget: (a, w) => { if (w.type === 'businessLedger') panels.set(a >>> 0, w); said.push([a >>> 0, w.type === 'businessLedger' ? 'PANEL' : 'MENU ' + w.targetName]); return true; },
  closeWidget: () => true,
  onUi: (n, f) => { ui[n] = f; }, registerChatCommand: (n, f) => { cmds[n] = f; },
  onlineActors: () => Object.keys(PROFILE).map(Number), profileOf: (a) => PROFILE[a >>> 0] ?? -1,
  findByName: (q) => Number(Object.keys(NAME).find((a) => NAME[a].toLowerCase() === String(q).toLowerCase())) || 0,
  takeGold, giveGold,
  depositToTreasury: (z, n, o) => { treasury[z] = (treasury[z] || 0) + n; treasuryMarks.push(o && o.income); return n; },
  zoneOfActor: () => 'bruma', zoneById: (id) => ({ id, name: 'Bruma' }),
  ranksOf: () => [], distanceMeters: () => 1, isAdmin: () => false,
};
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? `: got ${JSON.stringify(got)}` : ''}`); if (!c) fails++; };
const last = (a) => { for (let i = said.length - 1; i >= 0; i--) if (said[i][0] === (a >>> 0)) return String(said[i][1]); return ''; };
const load = (cfgOver) => {
  globalThis.__dboBusiness = undefined; globalThis.__dboBusinessPass = undefined;
  delete require.cache[BUSINESS]; delete require.cache[LEDGERSALE];
  require(BUSINESS)(Object.assign({}, api, cfgOver ? { cfg: cfgOver } : {}));
  require(LEDGERSALE)(api);
  for (const a of [OWNER, STAFF, BUYER, POOR, STRAY]) ui.uiCaps(a, ['businessLedger', 'playerShop']);
};
load();
const all = () => JSON.parse(fs.readFileSync('businesses.json', 'utf8')).businesses;
const biz = () => all()[DOOR.toString(16)];
const run = (a, args) => { cmds.business(a, args); return last(a); };
const shop = (a, args) => { cmds.shop(a, args); return last(a); };
const act = (ref, a) => globalThis.__dboBusinessActivate(ref, a);
const bank = (a) => Number(getp(a, 'private.bankGold')) || 0;

// ---- setting up ------------------------------------------------------------------------------------------------------
run(OWNER, 'open The Iron Fist');
run(HAL, 'open Hal\'s Wares');
run(OWNER, 'staff add Sigrid');
ok(biz() && biz().staff.length === 1, 'two businesses, Olaf\'s with Sigrid as staff');

// ---- choosing the shop chest ------------------------------------------------------------------------------------------
ok(/The Iron Fist, kept by Olaf/.test(run(STRAY, 'shop chest')) && !globalThis.__dboBusiness.armed.has(STRAY), 'a stranger never reaches the shop commands (they get the public page)');
ok(/within 60 seconds/.test(run(STAFF, 'shop chest')), 'staff arm "Make a shop chest"');
ok(act(BARREL, STAFF) === false && globalThis.__dboBusiness.armed.has(STAFF), 'something that is not a container leaves the arming in place');
ok(act(SHOP2, STAFF) === true && /not inside your business/.test(last(STAFF)) && !all()[DOOR2.toString(16)].shop, 'a container in another business is refused');
run(OWNER, 'chest 10');
act(RENTC, OWNER);
ok(biz().chests[RENTC.toString(16)], 'a chest is put up for rent');
run(OWNER, 'shop chest');
ok(act(RENTC, OWNER) === true && /listed as storage for rent/.test(last(OWNER)) && !(biz().shop && biz().shop.chest), 'a chest listed for rent cannot be the shop chest');
run(OWNER, 'shop chest');
ok(act(SHOP, OWNER) === true && biz().shop.chest === SHOP.toString(16), 'the owner makes a chest inside the business its shop chest');
ok(emptied.includes(SHOP) && audits.some((t) => /SHOP Olaf The Iron Fist: chest 300 is the shop chest/.test(t)) && biz().log.some((e) => /chose the shop chest/.test(e.text)), '...the world container is emptied first, audited and written in the ledger');
run(OWNER, 'chest 10');
ok(act(SHOP, OWNER) === true && /That is a shop chest/.test(last(OWNER)) && !biz().chests[SHOP.toString(16)], 'a shop chest cannot be put up for rent');
// Hal tries to take Olaf's shop chest as his (he would have to open it inside his own business, which it is not)
run(HAL, 'shop chest');
globalThis.__dboBusiness.data.businesses[DOOR2.toString(16)].shop = { chest: SHOP2.toString(16), prices: {} };
setp(SHOP2, 'worldOrCellDesc', desc(CELL)); // a chest both claim... (a data conflict: Hal's record names a chest in Olaf's cell)
run(OWNER, 'shop chest');
ok(act(SHOP2, OWNER) === true && /another business's shop chest/.test(last(OWNER)) && biz().shop.chest === SHOP.toString(16), 'another business\'s shop chest is refused');
delete globalThis.__dboBusiness.data.businesses[DOOR2.toString(16)].shop; setp(SHOP2, 'worldOrCellDesc', desc(CELL2));
globalThis.__dboBusiness.armed.delete(HAL);

// ---- the guard ----------------------------------------------------------------------------------------------------------
ok(act(SHOP, OWNER) === false, 'the shop chest opens for the owner');
ok(act(SHOP, STAFF) === false, '...and for staff');
ok(act(SHOP, STRAY) === true && /shop chest, for its owner and staff\. To buy its goods, use the ledger/.test(last(STRAY)), 'anyone else is refused and pointed to the ledger');
ok(act(SHOP, BUYER) === true, '...a customer too');
// faction staff: Olaf offers the business to the Fighters Guild, its leader accepts; the leader keeps the ledger as staff
run(OWNER, 'faction fighters-guild'); run(LEAD, 'faction fighters-guild');
ok(biz().faction && biz().faction.id === 'fighters-guild', 'the business keeps its books for the Fighters Guild');
ok(act(SHOP, LEAD) === false, 'the faction\'s leader opens the shop chest (faction staff)');
run(LEAD, 'faction off');
ok(act(SHOP, LEAD) === true, '...and not once the faction hands it back');
// The stand-in (gamemode.js businessFailClosed): a throw in the hook or business.js down keeps the shop chest shut
const gm = fs.readFileSync(GAMEMODE, 'utf8');
const i0 = gm.indexOf('function businessFailClosed('), j0 = i0 >= 0 ? gm.indexOf('\n}\n', i0) : -1;
const fc = new Function('mp', 'personal', 'profileOf', 'cfg', 'fs', 'path', 'log', `${gm.slice(i0, j0 + 2)}\nreturn businessFailClosed;`)(
  mp, api.personal, api.profileOf, { business: {} }, fs, path, () => {});
ok(fc(SHOP, STRAY) === true && /shop chest is closed for a moment/.test(last(STRAY)), 'fail closed: the stand-in refuses a stranger at the shop chest');
ok(fc(SHOP, OWNER) === true, '...and the owner too, until business.js is back');
ok(fc(SPARE, STRAY) === false, '...while a chest nobody lists is untouched');
// shops.js failing to load leaves the guard in business.js
const throwing = Object.assign({}, baseCfg); Object.defineProperty(throwing, 'shops', { get() { throw new Error('shops config unreadable'); } });
load(throwing);
ok(act(SHOP, STRAY) === true && act(SHOP, OWNER) === false, 'with shops.js failed to load, the guard still holds (stranger refused, owner allowed)');
ok(/Shops are closed/.test(shop(BUYER, '')), '...and nothing is sold');
load();

// ---- prices -------------------------------------------------------------------------------------------------------------
setInv(SHOP, [{ baseId: SWORD, count: 3 }, Object.assign({}, ENCH), { baseId: DAWN, count: 1 }, { baseId: KEY, count: 1 }, { baseId: POTION, count: 5 }, { baseId: GOLD, count: 40 }]);
const stockLines = () => { cmds.business(OWNER, 'shop'); const k = said.length; return said.slice(-8).map((x) => x[1]).filter((t) => /^\s+\d+\./.test(t)); };
const lines = stockLines();
ok(lines.length === 5 && !/Gold/.test(lines.join('|')) && /Dawnbreaker x1: not for sale \(artifacts are never sold\)/.test(lines.join('|')) && /House Key x1: not for sale/.test(lines.join('|')) && !/Gold/.test(lines.join('|')), 'the stock lists goods (not the gold); artifacts and keys are marked not for sale', lines);
const nOf = (rx) => String(lines.findIndex((l) => rx.test(l)) + 1);
const nSword = nOf(/Iron Sword x3/), nEnch = nOf(/Iron Sword \(enchanted, improved, named\) x1/), nPotion = nOf(/Potion/), nDawn = nOf(/Dawnbreaker/), nKey = nOf(/House Key/);
ok(/Iron Sword: 40 gold each/.test(run(OWNER, `shop price ${nSword} 40`)), 'the owner prices the plain sword');
ok(/improved, named\): 900 gold each/.test(run(STAFF, `shop price ${nEnch} 900`)), 'staff price the enchanted sword apart from the plain ones');
ok(/cannot be sold: artifacts are never sold/.test(run(OWNER, `shop price ${nDawn} 5`)) && /cannot be sold/.test(run(OWNER, `shop price ${nKey} 5`)), 'an artifact and a key cannot be priced');
ok(/from 1 to 100000/.test(run(OWNER, `shop price ${nPotion} 0.5`)) && /from 1 to 100000/.test(run(OWNER, `shop price ${nPotion} 100001`)) && /from 1 to 100000/.test(run(OWNER, `shop price ${nPotion} -3`)), 'prices outside the bounds are refused');
ok(/Potion of Minor Healing: 12 gold each/.test(run(OWNER, `shop price ${nPotion} 12`)), 'the potion at 12 each');
ok(/no longer for sale/.test(run(OWNER, `shop price ${nPotion} off`)) && /not for sale/.test(run(OWNER, `shop price ${nPotion} off`)), 'a price comes off');
run(OWNER, `shop price ${nPotion} 12`);
const pricesNow = JSON.stringify(biz().shop.prices);
ok(/The Iron Fist, kept by/.test(run(STRAY, 'shop price 1 1')) && JSON.stringify(biz().shop.prices) === pricesNow, 'a stranger cannot set prices');
act(LEDGER, STRAY); ui.bizLedger(STRAY, [panels.get(STRAY).nonce, 'shopPrice', '503', 1]);
ok(/kept for its owner and staff/.test(panels.get(STRAY).result) && JSON.stringify(biz().shop.prices) === pricesNow, '...nor through the panel');
ok(Object.keys(biz().shop.prices).length === 3, 'three kinds priced, kept in businesses.json', biz().shop.prices);

// ---- the public page and /shop ---------------------------------------------------------------------------------------------
act(LEDGER, BUYER);
const pub = panels.get(BUYER);
ok(pub && pub.role === 'customer' && pub.shopOpen === true && pub.shopItems.length === 3 && !pub.shopStock, 'the ledger\'s public page carries the Buy list (no stock page)', pub && pub.shopItems);
const swordRow = pub.shopItems.find((r) => r.name === 'Iron Sword' && !r.tags.length), enchRow = pub.shopItems.find((r) => r.tags.includes('enchanted')), potRow = pub.shopItems.find((r) => /Potion/.test(r.name));
ok(swordRow.price === 40 && swordRow.count === 3 && enchRow.price === 900 && potRow.count === 5, '...with unit prices and counts');
act(LEDGER, OWNER);
ok(panels.get(OWNER).shopStock.length === 5 && panels.get(OWNER).shopChest === true, 'the owner\'s panel carries the stock with prices');
ui.uiCaps(STRAY, ['businessLedger']);
act(LEDGER, STRAY);
ok(/has 3 kinds of goods for sale: \/shop/.test(last(STRAY)), 'a front without the shop pages is told about /shop in chat');
cmds.shop(STRAY, '');
ok(said.slice(-6).some(([a, t]) => a === STRAY && /\d\. Iron Sword: 40 gold each, 3 in stock/.test(t)), '/shop lists the goods');

// ---- buying --------------------------------------------------------------------------------------------------------------
const nonce = (a) => panels.get(a).nonce;
const buyP = (a, row, n, shown) => { ui.bizLedger(a, [nonce(a), 'buy', row.key, n, shown === undefined ? row.price : shown]); return panels.get(a).result; };
const tBefore = treasury.bruma || 0;
ok(/You buy 2x Iron Sword for 80 gold/.test(buyP(BUYER, swordRow, 2)), 'buying 2 swords at 40');
ok(goldOf(BUYER) === 920 && countOf(BUYER, SWORD, (e) => !e.worn) === 2 && countOf(BUYER, SWORD, (e) => e.worn) === 1 && countOf(SHOP, SWORD, (e) => !e.enchantmentId) === 1, '...80 gold out of the pack, 2 swords out of the chest into the pack (the worn one untouched)');
ok((treasury.bruma || 0) - tBefore === 8 && treasuryMarks[treasuryMarks.length - 1] === 'sales' && bank(OWNER) === 64, '...the hold takes 10% (8) marked as sales income, 8 sink, 64 into the owner\'s bank', [treasury.bruma, treasuryMarks, bank(OWNER)]);
ok(biz().log.some((e) => /Brand bought 2x Iron Sword at 40 gold each: 80 gold \(8 tax to the hold, 8 out of the game, 64 to Olaf's bank\)/.test(e.text)) && audits.some((t) => /^SHOP Brand bought 2x Iron Sword .* for 80 gold/.test(t)), '...written in the ledger and audited');
ok(biz().income.some((e) => e.gold === 64), '...and counted in the week\'s takings');
ok(/only 1 Iron Sword left/i.test(buyP(BUYER, swordRow, 2)) && countOf(SHOP, SWORD, (e) => !e.enchantmentId) === 1 && goldOf(BUYER) === 920, 'partial stock: asking for more than is left is refused, nothing changes');
ok(/You buy Iron Sword \(enchanted, improved, named\) for 900 gold/.test(buyP(BUYER, enchRow, 1, 900)), 'buying the enchanted sword at 900');
// the enchanted sword keeps every extra
const ench = inv(BUYER).find((e) => e.enchantmentId);
ok(ench && ench.enchantmentId === ENCH.enchantmentId && ench.maxCharge === 1500 && ench.chargePercent === 80 && ench.health === 1.4 && ench.name === 'Frostbite' && ench.count === 1 && goldOf(BUYER) === 20, 'an enchanted, tempered, named sword arrives with all its extra data, as its own entry', ench);
ok(!inv(SHOP).some((e) => e.enchantmentId), '...and has left the chest');
act(LEDGER, POOR);
ok(/costs 36 gold, and you do not have it/.test(buyP(POOR, potRow, 3)) && goldOf(POOR) === 15 && countOf(SHOP, POTION) === 5 && countOf(POOR, POTION) === 0, 'not enough gold: refused, nothing moves');
ok(/You buy Potion of Minor Healing for 12 gold/.test(buyP(POOR, potRow, 1)) && goldOf(POOR) === 3 && countOf(POOR, POTION) === 1, 'a single item at the unit price');
// the price shown is the price paid
const freshN = (rx) => { const l = stockLines(); return String(l.findIndex((x) => rx.test(x)) + 1); };
ok(/Potion of Minor Healing: 20 gold each \(was 12\)|20 gold each/.test(run(OWNER, `shop price ${freshN(/Potion/)} 20`)), 'the owner re-prices the potion (numbers follow the current stock list)');
ok(/now 20 gold each/.test(buyP(BUYER, potRow, 1, 12)) && countOf(SHOP, POTION) === 4, 'a price changed since the page was drawn: refused, told the new price');
act(LEDGER, BUYER);
// staff cannot buy from their own shop; bad counts
act(LEDGER, STAFF);
ok(/your own shop/.test(buyP(STAFF, potRow, 1, 20)), 'staff do not buy from their own shop');
ok(/Buy one or more/.test(buyP(BUYER, potRow, 0, 20)) && /Buy one or more/.test(buyP(BUYER, potRow, 1.5, 20)), 'a count below one or a fraction is refused');
ok(/not for sale any more/.test(buyP(BUYER, { key: 'abc', price: 1 }, 1)), 'an unknown item is refused');
// rollback: the chest write throws
setInv(BUYER, [{ baseId: GOLD, count: 500 }]);
const snapShop = JSON.stringify(inv(SHOP));
FAIL.throwOn = SHOP;
ok(/could not be finished\. Your gold is returned/.test(buyP(BUYER, potRow, 2, 20)), 'the chest write throws: the sale is refused');
ok(JSON.stringify(inv(SHOP)) === snapShop && goldOf(BUYER) === 500 && countOf(BUYER, POTION) === 0, '...the chest as it was, the gold back, no potion (no loss, no duplicate)');
FAIL.throwOn = 0;
// rollback: the chest write is silently dropped (the read-back catches it)
FAIL.dropOn = SHOP;
ok(/could not be finished/.test(buyP(BUYER, potRow, 2, 20)) && JSON.stringify(inv(SHOP)) === snapShop && goldOf(BUYER) === 500 && countOf(BUYER, POTION) === 0, 'a dropped chest write: caught, everything put back');
FAIL.dropOn = 0;
// rollback: the pack write throws after the goods left the chest
FAIL.throwOn = BUYER;
const treasBefore = treasury.bruma, bankBefore = bank(OWNER);
ok(/could not be finished/.test(buyP(BUYER, potRow, 2, 20)), 'the pack write throws: refused');
FAIL.throwOn = 0;
ok(JSON.stringify(inv(SHOP)) === snapShop && goldOf(BUYER) === 500 && countOf(BUYER, POTION) === 0 && treasury.bruma === treasBefore && bank(OWNER) === bankBefore, '...the potions back in the chest, the gold back, nobody paid');
// rollback: the pack write is silently dropped
FAIL.dropOn = BUYER;
ok(/could not be finished/.test(buyP(BUYER, potRow, 2, 20)), 'a dropped pack write: refused');
FAIL.dropOn = 0;
ok(JSON.stringify(inv(SHOP)) === snapShop && goldOf(BUYER) === 500 && countOf(BUYER, POTION) === 0, '...and everything put back');
ok(audits.filter((t) => /^SHOP FAILED Brand/.test(t)).length === 4 && audits.every((t) => !/COULD NOT BE PUT BACK|STILL HOLDS/.test(t)), 'each failure is audited, all put back cleanly');
// the pack write lands but reports a failure, and the pack cannot be put back: the sale stands (no duplicate, no loss)
FAIL.stickOn = BUYER;
const shopPot = countOf(SHOP, POTION), bankS = bank(OWNER);
ok(/You buy 2x Potion/.test(buyP(BUYER, potRow, 2, 20)), 'a pack write that landed but threw, with no way back: the sale stands');
FAIL.stickOn = 0;
ok(countOf(BUYER, POTION) === 2 && goldOf(BUYER) === 460 && countOf(SHOP, POTION) === shopPot - 2 && bank(OWNER) === bankS + 32 && audits.some((t) => /^SHOP STANDS Brand/.test(t)), '...the buyer has the goods and paid, the chest gave them once, the owner is paid; audited');
setInv(BUYER, [{ baseId: GOLD, count: 500 }]); setInv(SHOP, JSON.parse(snapShop));
// a refund that cannot be handed back waits for the next login
const realGive = api.giveGold; let giveFails = true;
FAIL.throwOn = SHOP;
// business.js (and shops.js through it) loaded with a giveGold that fails until giveFails is cleared
globalThis.__dboBusiness = undefined; delete require.cache[BUSINESS];
require(BUSINESS)(Object.assign({}, api, { giveGold: (a, n) => (giveFails ? false : realGive(a, n)) }));
for (const a of [OWNER, STAFF, BUYER, POOR, STRAY]) ui.uiCaps(a, ['businessLedger', 'playerShop']);
act(LEDGER, BUYER);
ok(/returned at your next login/.test(buyP(BUYER, potRow, 1, 20)) && goldOf(BUYER) === 480 && JSON.parse(fs.readFileSync('businesses.json', 'utf8')).shopRefunds.cff000003 === 20, 'a refund that cannot be given is held in businesses.json');
FAIL.throwOn = 0; giveFails = false;
globalThis.__dboBusinessLogin(BUYER);
ok(goldOf(BUYER) === 500 && !JSON.parse(fs.readFileSync('businesses.json', 'utf8')).shopRefunds.cff000003, '...and paid at the next login');
load();

// ---- a faction's business: the owner's share goes to its treasury ---------------------------------------------------------
run(OWNER, 'faction fighters-guild'); run(LEAD, 'faction fighters-guild');
act(LEDGER, BUYER);
const fBefore = factionDeposits.length, bankF = bank(OWNER);
ok(/You buy 2x Potion/.test(buyP(BUYER, potRow, 2, 20)), 'buying from a faction\'s business');
const dep = factionDeposits.slice(fBefore);
ok(dep.length === 1 && dep[0].fid === 'fighters-guild' && dep[0].n === 32 && dep[0].income === 'sales' && bank(OWNER) === bankF, '...40 gold: 4 tax, 4 sink, 32 to the Fighters Guild\'s treasury marked as sales, nothing to Olaf', dep);
ok(biz().log.some((e) => /32 to the treasury of Fighters Guild/.test(e.text)), '...written in the ledger');
run(LEAD, 'faction off');

// ---- restart: prices and the chest survive ---------------------------------------------------------------------------------
const pricesBefore = JSON.stringify(biz().shop.prices);
load();
ok(JSON.stringify(globalThis.__dboBusiness.data.businesses[DOOR.toString(16)].shop.prices) === pricesBefore, 'after a restart the prices are read back');
ok(act(SHOP, STRAY) === true && act(SHOP, OWNER) === false, '...the guard holds');
act(LEDGER, BUYER);
ok(panels.get(BUYER).shopItems.length === 2, '...and the Buy list is the same (the plain sword and the potion left)', panels.get(BUYER).shopItems);

// ---- a claim that changed hands: the old owner and the new holder may empty it; nobody else -------------------------------
setp(DOOR, 'private.housing', { owner: 14, ownerName: 'Nils', partner: OUTDOOR });
ok(act(SHOP, OWNER) === false && act(SHOP, NEWOWNER) === false && act(SHOP, STRAY) === true && act(SHOP, STAFF) === true, 'claim changed hands: old owner and new holder open it, staff and strangers do not');
setp(DOOR, 'private.housing', { owner: 7, ownerName: 'Olaf', partner: OUTDOOR });

// ---- unmarking and closing ---------------------------------------------------------------------------------------------------
ok(/plain chest again/.test(run(STAFF, 'shop chest off')) && !biz().shop.chest && act(SHOP, STRAY) === false, 'unmarked: a plain chest again (opens like any other)');
act(LEDGER, BUYER);
ok(panels.get(BUYER).shopOpen === false && panels.get(BUYER).shopItems.length === 0, '...and nothing is for sale');
run(OWNER, 'shop chest'); act(SHOP, OWNER);
ok(biz().shop.chest === SHOP.toString(16) && Object.keys(biz().shop.prices).length === 3, 'chosen again, the old prices still stand');
const stockKept = JSON.stringify(inv(SHOP));
// rented chest RENTC is free (not rented): closing is allowed
ok(/shop chest is a plain chest again; its goods are still in it/.test(run(OWNER, 'close')) && !all()[DOOR.toString(16)], 'closing the business unmarks the shop chest');
ok(JSON.stringify(inv(SHOP)) === stockKept && act(SHOP, STRAY) === false, '...its goods stay in it, and it is a plain chest');
ok(/Stand inside a business|sells nothing/.test(shop(BUYER, '')), '/shop finds no shop there');

// ---- config: shops off -----------------------------------------------------------------------------------------------------
run(OWNER, 'open The Iron Fist');
load(Object.assign({}, baseCfg, { shops: { enabled: false } }));
ok(/Shops are closed/.test(run(OWNER, 'shop chest')), 'shops.enabled false: no shop chest can be chosen');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* scratch */ }
process.exit(fails ? 1 : 0);
