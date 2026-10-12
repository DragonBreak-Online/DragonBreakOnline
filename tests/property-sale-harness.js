// Scripted test for selling a hold's empty house (tenancy.js, Nate 12 Oct) and the property panel (front propertyMarket,
// widget 81) that drives buying and renting. Loads the real tenancy.js in a scratch folder against a mock housing system,
// doors, gold, treasury and the economy's sale-value hook. Run from this folder's parent:
//
//   node tests/property-sale-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE = path.resolve(__dirname, '..', 'tenancy.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-propsale-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
let now = 1790000000000;
Date.now = () => now;
globalThis.setTimeout = () => 0;

const DOOR = 0x5000, OTHER_DOOR = 0x5001;
fs.writeFileSync('doors.json', JSON.stringify({ doors: { '5000:Skyrim.esm': 'A house', '5001:Skyrim.esm': 'Another' } }));
fs.writeFileSync('doors-pos.json', JSON.stringify({ doors: { '5000:Skyrim.esm': [0, 0, 0, 'bruma'], '5001:Skyrim.esm': [3000, 0, 0, 'bruma'] } }));
const STEWARD = 1, BUYER = 2, LATE = 3, POOR = 4;
const chars = {
  [STEWARD]: { profile: 10, tag: 'STEW', name: 'Steward', gold: 0, pos: [0, 0, 0] },
  [BUYER]: { profile: 20, tag: 'BUYR', name: 'Buyer', gold: 6000, pos: [50, 0, 0] },
  [LATE]: { profile: 30, tag: 'LATE', name: 'Late', gold: 9000, pos: [60, 0, 0] },
  [POOR]: { profile: 40, tag: 'POOR', name: 'Poor', gold: 100, pos: [70, 0, 0] },
};
const houses = { [DOOR]: { owner: 0, ownerName: '', name: 'Snowpeak House' }, [OTHER_DOOR]: { owner: 0, ownerName: '' } };
let grantErr = '';
globalThis.__dboHousing = {
  primaryOf: (r) => (houses[r] ? r : 0), recordOf: (r) => houses[r] || null, holdOf: () => 'bruma',
  isManager: (a) => a === STEWARD,
  grant: (r, a) => { if (grantErr) return grantErr; houses[r].owner = chars[a].profile; houses[r].ownerName = chars[a].name; return ''; },
  release: (r) => { houses[r].owner = 0; houses[r].ownerName = ''; return true; },
};
const values = {};
globalThis.__dboEconomySaleValue = (ref, gold, by) => { values[ref] = { gold, by }; return true; };
globalThis.__dboHoldTax = () => 0.1;
const treasury = {}, said = [], audits = [], commands = {}, ui = {}, widgets = [], closed = [];
require(MODULE)({
  mp: {
    getIdFromDesc: (d) => parseInt(d, 16),
    get: (id, k) => (chars[id] ? (k === 'pos' ? chars[id].pos : k === 'worldOrCellDesc' ? 'bruma' : undefined) : undefined),
  },
  log: () => {}, personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t), who: (a) => chars[a].name, display: (a) => chars[a].name,
  tagOf: (a) => chars[a].tag, profileOf: (a) => chars[a].profile, onlineActors: () => [STEWARD, BUYER, LATE, POOR], every: () => {},
  registerChatCommand: (n, fn) => { commands[n] = fn; }, cfg: {},
  takeGold: (a, n) => { if (chars[a].gold < n) return false; chars[a].gold -= n; return true; },
  giveGold: (a, n) => { chars[a].gold += n; return true; },
  depositToTreasury: (z, n) => { treasury[z] = (treasury[z] || 0) + n; return n; },
  zoneById: (id) => ({ id, name: 'Bruma' }),
  openWidget: (a, w, focus) => widgets.push({ a, w, focus }), closeWidget: (a, id) => closed.push({ a, id }),
  onUi: (ev, fn) => { (ui[ev] = ui[ev] || []).push(fn); },
});

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };
const fire = (ev, a, args, wid) => (ui[ev] || []).forEach((fn) => fn(a, args || [], wid));
const panelOf = (a) => { for (let i = widgets.length - 1; i >= 0; i--) if (widgets[i].a === a) return widgets[i].w; return null; };
const act = (a, name, ...args) => fire('propertyMarketAct', a, [panelOf(a).nonce, name, ...args]);

// ---- the panel opens on the door the player stands at ----
fire('propertyMarket', BUYER);
let w = panelOf(BUYER);
ok(w && w.type === 'propertyMarket' && w.id === 82 && widgets[widgets.length - 1].focus === true, 'the panel opens with focus', w);
ok(w.state === 'none' && !w.owned && w.name === 'Snowpeak House' && w.hold === 'Bruma' && w.taxPct === 10, 'an empty house shows as neither for sale nor for rent, with the hold tax', w);
ok(w.manager === false, 'a player is no manager');
fire('propertyMarket', STEWARD);
ok(panelOf(STEWARD).manager === true && panelOf(STEWARD).maxPrice === 1000000, 'the steward gets the officials\' view');

// ---- selling ----
act(BUYER, 'sell', '500');
ok(/Only the officials/.test(panelOf(BUYER).result) && panelOf(BUYER).state === 'none', 'a player cannot put it up for sale', panelOf(BUYER).result);
act(STEWARD, 'sell', '0');
ok(/Usage: \/property sell/.test(panelOf(STEWARD).result), 'a price of 0 is refused');
act(STEWARD, 'sell', '5000');
ok(panelOf(STEWARD).state === 'sale' && panelOf(STEWARD).price === 5000 && /For sale at 5000 gold/.test(panelOf(STEWARD).result), 'the steward lists it at 5,000', panelOf(STEWARD));
fire('propertyMarket', BUYER);
ok(panelOf(BUYER).state === 'sale' && panelOf(BUYER).price === 5000, 'buyers see it for sale at 5,000');
act(BUYER, 'interest');
ok(/for sale, not for rent/.test(panelOf(BUYER).result), 'asking to rent a house for sale is refused', panelOf(BUYER).result);

// ---- buying ----
fire('propertyMarket', POOR);
act(POOR, 'buy');
ok(/do not have it/.test(panelOf(POOR).result) && chars[POOR].gold === 100 && houses[DOOR].owner === 0, 'without the gold nothing changes', panelOf(POOR).result);
grantErr = 'You already own a place.';
act(BUYER, 'buy');
ok(panelOf(BUYER).result === 'You already own a place.' && chars[BUYER].gold === 6000 && !treasury.bruma, 'a refused grant gives the gold back', [panelOf(BUYER).result, chars[BUYER].gold]);
grantErr = '';
act(BUYER, 'buy');
ok(houses[DOOR].owner === 20 && chars[BUYER].gold === 1000 && treasury.bruma === 5000, 'the buyer pays 5,000 to Bruma and owns it', [houses[DOOR], chars[BUYER].gold, treasury]);
ok(values[DOOR] && values[DOOR].gold === 5000 && values[DOOR].by === 'Buyer', 'the price becomes its tax value', values);
ok(panelOf(BUYER).state === 'none' && panelOf(BUYER).yours === true && /bought for 5000 gold/.test(panelOf(BUYER).result), 'the panel shows it is the buyer\'s', panelOf(BUYER));
ok(said.some(([a, t]) => a === STEWARD && /Buyer has bought the property/.test(t)), 'the steward who listed it is told');
fire('propertyMarket', LATE);
act(LATE, 'buy');
ok(/not for sale/.test(panelOf(LATE).result) && chars[LATE].gold === 9000, 'the second buyer is too late and pays nothing', panelOf(LATE).result);

// ---- a listing outlived by a grant ----
houses[OTHER_DOOR].owner = 0;
chars[STEWARD].pos = [3000, 0, 0]; chars[LATE].pos = [3010, 0, 0];
fire('propertyMarket', STEWARD); act(STEWARD, 'sell', '800');
houses[OTHER_DOOR].owner = 99; houses[OTHER_DOOR].ownerName = 'Granted';
fire('propertyMarket', LATE); act(LATE, 'buy');
ok(/no longer for sale/.test(panelOf(LATE).result) && chars[LATE].gold === 9000, 'a house granted after listing is not sold over its owner', panelOf(LATE).result);

// ---- renting through the panel ----
houses[OTHER_DOOR].owner = 0; houses[OTHER_DOOR].ownerName = '';
fire('propertyMarket', STEWARD); act(STEWARD, 'list', '100', '20');
ok(panelOf(STEWARD).state === 'rent' && panelOf(STEWARD).deposit === 100 && panelOf(STEWARD).weekly === 20, 'the steward lists it for rent from the panel', panelOf(STEWARD));
act(LATE, 'interest');
fire('propertyMarket', STEWARD);
ok(panelOf(STEWARD).interest.length === 1 && panelOf(STEWARD).interest[0].tag === 'LATE', 'the steward sees who asked');
act(STEWARD, 'offer', 'LATE');
fire('propertyMarket', LATE);
ok(panelOf(LATE).offeredToYou === true, 'the offer shows on the renter\'s panel');
act(LATE, 'accept');
ok(panelOf(LATE).state === 'let' && panelOf(LATE).youRent === true && chars[LATE].gold === 8880, 'accepting from the panel moves them in', panelOf(LATE));
act(LATE, 'pay', '2');
ok(/Paid 40 gold/.test(panelOf(LATE).result), 'rent is paid from the panel', panelOf(LATE).result);

// ---- the panel only acts on the door the player stands at ----
fire('propertyMarket', BUYER);
const stale = panelOf(BUYER).nonce;
chars[BUYER].pos = [3000, 0, 0];
const n = widgets.length;
fire('propertyMarketAct', BUYER, [stale, 'buy']);
ok(closed.some((c) => c.a === BUYER && c.id === 82) && widgets.length === n, 'walking to another door closes the panel instead of acting there');
fire('propertyMarketAct', LATE, ['wrong-nonce', 'leave']);
ok(houses[OTHER_DOOR].owner === 30, 'a wrong nonce does nothing');
ok(commands.property && /for sale|Usage/.test((() => { said.length = 0; commands.property(STEWARD, 'nonsense'); return said.map((x) => x[1]).join(' '); })()), 'the chat fallback still answers');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
