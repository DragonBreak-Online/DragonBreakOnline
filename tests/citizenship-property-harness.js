// Scripted test for citizenship at the door (tenancy.js, Nate 14 Oct): in a hold that grants citizenship only its citizens
// buy property, from the hold or from another player; an owner sells their own house to an eligible citizen, the gold goes
// to the seller, and the house's tax value is never touched by a resale; the fork's hand-over asks the same gate. Loads the
// real tenancy.js in a scratch folder against a mock housing system, doors, gold, treasury and citizenship hooks.
//
//   node tests/citizenship-property-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE = path.resolve(__dirname, '..', 'tenancy.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-citizenprop-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
let now = 1790000000000;
Date.now = () => now;
globalThis.setTimeout = () => 0;

const DOOR = 0x5000, HOME = 0x5001, OUTSIDE = 0x5002;
fs.writeFileSync('doors.json', JSON.stringify({ doors: { '5000:Skyrim.esm': 'A house', '5001:Skyrim.esm': 'Old home', '5002:Skyrim.esm': 'Stronghold hut' } }));
fs.writeFileSync('doors-pos.json', JSON.stringify({ doors: { '5000:Skyrim.esm': [0, 0, 0, 'bruma'], '5001:Skyrim.esm': [3000, 0, 0, 'bruma'], '5002:Skyrim.esm': [9000, 0, 0, 'bruma'] } }));
const STEWARD = 1, CITIZEN = 2, OUTSIDER = 3, OWNER = 4, LATE = 5;
const chars = {
  [STEWARD]: { profile: 10, tag: 'STEW', name: 'Steward', gold: 0, pos: [0, 0, 0] },
  [CITIZEN]: { profile: 20, tag: 'CITI', name: 'Citizen Cyra', gold: 20000, pos: [50, 0, 0] },
  [OUTSIDER]: { profile: 30, tag: 'OUTS', name: 'Outsider Olaf', gold: 20000, pos: [60, 0, 0] },
  [OWNER]: { profile: 40, tag: 'OWNR', name: 'Owner Orla', gold: 0, pos: [3000, 10, 0] },
  [LATE]: { profile: 50, tag: 'LATE', name: 'Late Lars', gold: 20000, pos: [3000, 20, 0] },
};
// HOME: Orla's house, bought before citizenship existed (valued at 15,000 by the hold's sale)
const houses = { [DOOR]: { owner: 0, ownerName: '', name: 'Snowpeak House' }, [HOME]: { owner: 40, ownerChar: OWNER, ownerName: 'Owner Orla', name: 'Orla\'s Hall' }, [OUTSIDE]: { owner: 0, ownerName: '' } };
const HOLD = { [DOOR]: 'bruma', [HOME]: 'bruma', [OUTSIDE]: 'gol-kharzum' };
let online = [STEWARD, CITIZEN, OUTSIDER, OWNER, LATE];
globalThis.__dboHousing = {
  primaryOf: (r) => (houses[r] ? r : 0), recordOf: (r) => houses[r] || null, holdOf: (r) => HOLD[r] || '',
  isManager: (a) => a === STEWARD, perCharacter: () => true,
  ownsRecord: (rec, a) => !!rec && Number(rec.owner) === chars[a].profile && (!rec.ownerChar || rec.ownerChar === a),
  grant: (r, a) => { houses[r].owner = chars[a].profile; houses[r].ownerChar = a; houses[r].ownerName = chars[a].name; return ''; },
  release: (r) => { houses[r].owner = 0; houses[r].ownerName = ''; return true; },
};
const saleValues = [];
globalThis.__dboEconomySaleValue = (ref, gold, by) => { saleValues.push({ ref, gold, by }); return true; };
globalThis.__dboEconomyTaxOf = (ref) => ({ taxValue: 15000, weeklyTax: 1500, listedValue: ref === HOME });
globalThis.__dboHoldTax = () => 0.1;
// citizenship.js's hooks: Bruma grants citizenship, a stronghold none; Cyra and Lars are Bruma's citizens
const citizens = new Set([CITIZEN, LATE]);
const install = () => {
  globalThis.__dboCitizenGates = (z) => z === 'bruma';
  globalThis.__dboCitizenOf = (a, z) => z === 'bruma' && citizens.has(a);
};
install();
const treasury = {}, said = [], audits = [], ui = {}, widgets = [];
require(MODULE)({
  mp: { getIdFromDesc: (d) => parseInt(d, 16), get: (id, k) => (chars[id] ? (k === 'pos' ? chars[id].pos : k === 'worldOrCellDesc' ? 'bruma' : undefined) : undefined) },
  log: () => {}, personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t), who: (a) => chars[a].name, display: (a) => chars[a].name,
  tagOf: (a) => chars[a].tag, profileOf: (a) => chars[a].profile, onlineActors: () => online.slice(), every: () => {},
  registerChatCommand: () => {}, cfg: {},
  takeGold: (a, n) => { if (chars[a].gold < n) return false; chars[a].gold -= n; return true; },
  giveGold: (a, n) => { chars[a].gold += n; return true; },
  depositToTreasury: (z, n) => { treasury[z] = (treasury[z] || 0) + n; return n; },
  zoneById: (id) => (id === 'bruma' ? { id, name: 'Bruma', treasury: '1:x' } : id === 'gol-kharzum' ? { id, name: 'Gol-Kharzum', treasury: '2:x' } : null),
  openWidget: (a, w) => widgets.push({ a, w }), closeWidget: () => {},
  onUi: (ev, fn) => { (ui[ev] = ui[ev] || []).push(fn); },
});

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };
const fire = (ev, a, args) => (ui[ev] || []).forEach((fn) => fn(a, args || []));
const panelOf = (a) => { for (let i = widgets.length - 1; i >= 0; i--) if (widgets[i].a === a) return widgets[i].w; return null; };
const open = (a) => fire('propertyMarket', a);
const act = (a, name, ...args) => fire('propertyMarketAct', a, [panelOf(a).nonce, name, ...args]);

// ---- a hold sale: citizens only ----
open(STEWARD); act(STEWARD, 'sell', '15000');
open(OUTSIDER);
ok(panelOf(OUTSIDER).state === 'sale' && /Only the citizens of Bruma/.test(panelOf(OUTSIDER).citizenNeeded || ''), 'the panel tells a non-citizen they need Bruma\'s citizenship', panelOf(OUTSIDER));
ok(panelOf(OUTSIDER).taxValue === 15000 && panelOf(OUTSIDER).weeklyTax === 1500, 'and shows the tax value and the weekly tax', panelOf(OUTSIDER));
act(OUTSIDER, 'buy');
ok(/Only the citizens of Bruma may buy/.test(panelOf(OUTSIDER).result) && houses[DOOR].owner === 0 && chars[OUTSIDER].gold === 20000, 'a non-citizen cannot buy: nothing paid, nothing granted', panelOf(OUTSIDER).result);
open(CITIZEN);
ok(!panelOf(CITIZEN).citizenNeeded, 'a citizen is not warned');
act(CITIZEN, 'buy');
ok(houses[DOOR].owner === 20 && chars[CITIZEN].gold === 5000 && treasury.bruma === 15000, 'a citizen buys it at the Jarl-set price, paid into the treasury', [houses[DOOR], chars[CITIZEN].gold, treasury]);
ok(saleValues.length === 1 && saleValues[0].gold === 15000, 'the hold sale sets the listed value once', saleValues);

// ---- an existing owner keeps the house and may sell it ----
ok(houses[HOME].owner === 40, 'Orla, who bought before citizenship and is no citizen, keeps her house');
open(OWNER);
ok(panelOf(OWNER).canResell === true, 'her panel offers to sell it');
act(OWNER, 'resell', '0');
ok(/whole number/.test(panelOf(OWNER).result), 'a price of 0 is refused');
act(OWNER, 'resell', '5000');
ok(panelOf(OWNER).state === 'resale' && panelOf(OWNER).price === 5000 && panelOf(OWNER).yourSale, 'she puts it up for sale at 5,000', panelOf(OWNER));
open(STEWARD);
act(STEWARD, 'resell', '1');
ok(/Only its owner/.test(panelOf(STEWARD).result), "a manager cannot sell a citizen's house as theirs", panelOf(STEWARD).result);
chars[OUTSIDER].pos = [3000, 30, 0];
open(OUTSIDER);
ok(panelOf(OUTSIDER).state === 'resale' && panelOf(OUTSIDER).sellerName === 'Owner Orla', 'buyers see it for sale by its owner');
act(OUTSIDER, 'buy');
ok(/Only the citizens of Bruma/.test(panelOf(OUTSIDER).result) && houses[HOME].owner === 40, 'a non-citizen cannot buy it from her', panelOf(OUTSIDER).result);
open(LATE);
act(LATE, 'buy');
ok(houses[HOME].owner === 50 && houses[HOME].ownerChar === LATE && chars[LATE].gold === 15000, 'an eligible citizen buys it from her for 5,000', [houses[HOME], chars[LATE].gold]);
ok(chars[OWNER].gold === 5000, 'the gold goes to the seller', chars[OWNER].gold);
ok(saleValues.length === 1, 'the resale does not touch the tax value (still the 15,000 listed)', saleValues);
ok(/tax value unchanged/.test(audits.slice(-1)[0]), 'the audit says so', audits.slice(-1)[0]);

// ---- a seller offline is paid when they return ----
open(LATE); act(LATE, 'resell', '7000');
online = online.filter((a) => a !== LATE);
citizens.add(CITIZEN);
chars[CITIZEN].pos = [3000, 40, 0]; chars[CITIZEN].gold = 9000;
open(CITIZEN); act(CITIZEN, 'buy');
const td = JSON.parse(fs.readFileSync('tenancy.json', 'utf8'));
ok(houses[HOME].owner === 20 && td.owed.some((o) => o.tag === 'LATE' && o.gold === 7000), 'the seller is away: the 7,000 waits for them', td.owed);
online.push(LATE);

// ---- a listing whose owner changed is void ----
open(CITIZEN); act(CITIZEN, 'resell', '100');
houses[HOME].owner = 30; houses[HOME].ownerChar = OUTSIDER; // handed over meanwhile
chars[LATE].pos = [3000, 20, 0];
open(LATE);
ok(panelOf(LATE).state !== 'resale', 'a resale whose seller no longer owns the house is not shown');
act(LATE, 'buy');
ok(houses[HOME].owner === 30 && chars[LATE].gold === 15000, 'and cannot be bought', panelOf(LATE).result);

// ---- a rented house is never resold ----
houses[DOOR].owner = 0; houses[DOOR].ownerChar = 0;
chars[CITIZEN].pos = [50, 0, 0];
open(STEWARD); act(STEWARD, 'list', '100', '50');
const tdata = JSON.parse(fs.readFileSync('tenancy.json', 'utf8'));
ok(tdata.listings['5000'] && !tdata.listings['5000'].sale, 'the hold lists it for rent');
open(CITIZEN); act(CITIZEN, 'interest'); open(STEWARD); act(STEWARD, 'offer', 'CITI'); open(CITIZEN); act(CITIZEN, 'accept');
ok(houses[DOOR].owner === 20, 'renting is not gated: a tenant moves in');
act(CITIZEN, 'resell', '999');
ok(/rented property/.test(panelOf(CITIZEN).result), 'the tenant cannot sell the rented house', panelOf(CITIZEN).result);

// ---- the fork's hand-over asks the same gate ----
ok(globalThis.__dboPropertyTransferCheck(HOME, OUTSIDER).includes('may own property there'), 'handing a Bruma house to a non-citizen is refused', globalThis.__dboPropertyTransferCheck(HOME, OUTSIDER));
ok(globalThis.__dboPropertyTransferCheck(HOME, CITIZEN) === '', 'to a citizen it is allowed');
ok(globalThis.__dboPropertyTransferCheck(OUTSIDE, OUTSIDER) === '', 'a house in a land that grants no citizenship asks none');
// citizenship.js not loaded: no gate at all
delete globalThis.__dboCitizenGates; delete globalThis.__dboCitizenOf;
ok(globalThis.__dboPropertyTransferCheck(HOME, OUTSIDER) === '', 'without citizenship.js nothing is gated');
install();

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
