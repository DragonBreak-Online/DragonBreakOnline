'use strict';
// gamemode.js __dboCoinPurse, the hold's share (Nat, 25 Oct: "diversify how holds get more income"): coinPurses.holdShare of
// each purse goes to the treasury of the hold it stands in, the opener keeps the rest, and no gold is made or lost: a purse in
// no hold, in a hold without a treasury, or whose treasury refuses the deposit pays the opener the whole. Loads the real
// function with stubs, as bank-purse-harness does. Run from the server folder: node tests/purse-share-harness.js
const fs = require('fs'); const path = require('path');
const GM = fs.readFileSync(path.join(__dirname, '..', 'gamemode.js'), 'utf8');
const fnStart = GM.indexOf('globalThis.__dboCoinPurse = (targetId, casterId) => {');
const fnEnd = GM.indexOf('\n};\n', fnStart) + 3;
const np = GM.slice(GM.indexOf('const normPlace = '), GM.indexOf('\n', GM.indexOf('const normPlace = ')));
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'gamemode-config.json'), 'utf8'));
let fail = 0; const ok = (c, n, g) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${!c && g !== undefined ? '   ' + JSON.stringify(g) : ''}`); if (!c) fail++; };

// Purses: 0x201 outdoors in Whiterun's land, 0x202 in a pinned Bruma interior, 0x203 in no hold, 0x204 in a hold with no treasury
const at = { 0x201: ['3c:Skyrim.esm', [100, 100, 0]], 0x202: ['abc:Bruma.esp', null], 0x203: ['3c:Skyrim.esm', [-9e5, 0, 0]], 0x204: ['def:Pale.esp', null] };   // verify-formids: ignore - made-up test cells
const ZONES = { whiterun: { id: 'whiterun', name: 'Whiterun', treasury: 'f19f:DragonBreak.esp' }, bruma: { id: 'bruma', name: 'Bruma', treasury: 'f1a0:DragonBreak.esp' }, dawnstar: { id: 'dawnstar', name: 'The Pale' } };   // verify-formids: ignore - made-up test treasury chests
const placeZone = (world, pos) => (world === '3c:Skyrim.esm' ? (pos && pos[0] > 0 ? 'whiterun' : null) : world === 'abc:Bruma.esp' ? 'bruma' : world === 'def:Pale.esp' ? 'dawnstar' : null);   // verify-formids: ignore - the made-up test cells
let told = [], given = [], deposits = [], audits = [], refuse = false;
const purse = (opts) => new Function('mp', 'PURSE', 'personal', 'giveItem', 'zoneAtPlace', 'zoneById', 'depositToTreasury', 'audit', 'who', np + `;
  const purseDeny = new Map(); const purseRest = new Map();
  const isCoinPurse = () => true; const isPurseBase = () => true; const baseIdOf = () => 1; const isGoldFlora = () => true;
  const restUntil = () => 0; const setRest = () => {}; const harvestingTier = () => 4;
  const HARVESTING = { yieldChanceByTier: [1, 1, 1, 1, 1], yieldMultiplierByTier: [1, 1, 1, 1, 1] };
  const log = () => {};
  ${GM.slice(fnStart, fnEnd)}
  return globalThis.__dboCoinPurse;`)(
  { get: (id, p) => (p === 'worldOrCellDesc' ? at[id][0] : p === 'pos' ? at[id][1] : undefined) },
  Object.assign({}, cfg.coinPurses, { enabled: true, refuseCells: [], goldMin: 20, goldMax: 20 }, opts || {}),
  (a, t) => told.push(t), (a, id, n) => { given.push(n); return true; },
  placeZone, (id) => ZONES[id] || null,
  (zid, n) => { if (refuse) return 0; deposits.push([zid, n]); return n; },
  (t) => audits.push(t), () => 'Kesta (profile 1)');
const reset = () => { told = []; given = []; deposits = []; audits = []; refuse = false; };
const sum = (a) => a.reduce((s, n) => s + n, 0);

ok(cfg.coinPurses.holdShare === 0.1 || cfg.coinPurses.holdShare === undefined, 'the shipped share is 10% (config coinPurses.holdShare, or the 0.1 default)', cfg.coinPurses.holdShare);
let run = purse({ holdShare: 0.1 });
reset(); run(0x201, 0x14);
ok(sum(given) === 18 && deposits.length === 1 && deposits[0][0] === 'whiterun' && deposits[0][1] === 2, 'a 20-gold purse outdoors in Whiterun: 18 to the opener, 2 to the Whiterun treasury', { given, deposits });
ok(/You pocket 18 gold from the purse; 2 goes to the Whiterun treasury\./.test(told.pop()), 'the opener is told the split');
ok(audits.length === 1 && audits[0] === 'PURSE Kesta (profile 1) opened a purse in whiterun: 20 gold, 2 to its treasury', 'it is audited', audits);
reset(); run(0x202, 0x14);
ok(sum(given) === 18 && deposits[0] && deposits[0][0] === 'bruma', 'a purse in a pinned Bruma interior pays Bruma', { given, deposits });
reset(); run(0x203, 0x14);
ok(sum(given) === 20 && !deposits.length && !audits.length && /You pocket 20 gold from the purse\.$/.test(told.pop()), 'a purse in no hold: the opener keeps all 20, nothing audited', { given, deposits });
reset(); run(0x204, 0x14);
ok(sum(given) === 20 && !deposits.length, 'a hold without a treasury (The Pale here): the opener keeps all 20', { given, deposits });
reset(); refuse = true; run(0x201, 0x14);
ok(sum(given) === 20 && !audits.length, 'a treasury that refuses the deposit: its 2 go to the opener, no gold lost', { given });
run = purse({ holdShare: 0 });
reset(); run(0x201, 0x14);
ok(sum(given) === 20 && !deposits.length, 'holdShare 0 turns it off', { given, deposits });
run = purse({ holdShare: 0.25, goldMin: 7, goldMax: 7 });
reset(); run(0x201, 0x14);
ok(sum(given) === 6 && deposits[0][1] === 1 && sum(given) + deposits[0][1] === 7, 'the share rounds down (25% of 7 = 1) and every coin is accounted for', { given, deposits });
ok(/{ income: 'coin purses' }/.test(GM.slice(fnStart, fnEnd)), "the share is the hold's income (tithed like its other income)");
console.log(fail ? `${fail} failed` : 'all checks passed'); process.exit(fail ? 1 : 0);
