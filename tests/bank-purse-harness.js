'use strict';
// gamemode.js __dboCoinPurse: a coin purse in a bank cell (coinPurses.refuseCells, Nate 19 Oct) never pays; one elsewhere
// still does. Loads the real function with stubs. Run from the server folder: node tests/bank-purse-harness.js
const fs = require('fs'); const path = require('path');
const GM = fs.readFileSync(path.join(__dirname, '..', 'gamemode.js'), 'utf8');
const fnStart = GM.indexOf('globalThis.__dboCoinPurse = (targetId, casterId) => {');
const fnEnd = GM.indexOf('\n};\n', fnStart) + 3;
const np = GM.slice(GM.indexOf('const normPlace = '), GM.indexOf('\n', GM.indexOf('const normPlace = ')));
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'gamemode-config.json'), 'utf8'));
let fail = 0; const ok = (c, n, g) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${!c && g !== undefined ? '   ' + JSON.stringify(g) : ''}`); if (!c) fail++; };
const cells = { 0x101: '1A97:DragonBreak.esp', 0x102: '00e6114:Riften Expansion.esp', 0x103: '3c:Skyrim.esm' };
const told = []; const given = [];
const run = new Function('mp', 'PURSE', 'personal', 'giveItem', np + `;
  const purseDeny = new Map(); const purseRest = new Map();
  const isCoinPurse = () => true; const isPurseBase = () => true; const baseIdOf = () => 1; const isGoldFlora = () => true;
  const restUntil = () => 0; const setRest = () => {}; const harvestingTier = () => 4;
  const HARVESTING = { yieldChanceByTier: [1, 1, 1, 1, 1], yieldMultiplierByTier: [1, 1, 1, 1, 1] };
  const log = () => {};
  ${GM.slice(fnStart, fnEnd)}
  return globalThis.__dboCoinPurse;`)(
  { get: (id, p) => (p === 'worldOrCellDesc' ? cells[id] : undefined) },
  Object.assign({ enabled: true, restMinutes: 45, goldMin: 8, goldMax: 30, unskilledChance: 1, unskilledMult: 1 }, cfg.coinPurses),
  (a, t) => told.push(t), (a, id, n) => { given.push(n); return true; });

ok((cfg.coinPurses.refuseCells || []).length === 12, 'gamemode-config.json lists the 12 bank cells of the bank audit', cfg.coinPurses.refuseCells);
ok(run(0x101, 0x14) === true && given.length === 0 && /belongs to the bank/.test(told.pop()), 'a purse in the Whiterun bank (1A97, any case) pays nothing and says so');
ok(run(0x102, 0x15) === true && given.length === 0, 'a purse in the Riften Expansion bank (leading zeros in the id) pays nothing');
ok(run(0x103, 0x16) === true && given.length === 1, 'a purse outside a bank still pays', given);
console.log(fail ? `${fail} failed` : 'all checks passed'); process.exit(fail ? 1 : 0);
