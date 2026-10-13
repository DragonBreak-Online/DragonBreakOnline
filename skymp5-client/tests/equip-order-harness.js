// applyEquipment's order (UNPROVEN fix for crash SkyrimSE.exe+0CC90EF, 13 Oct): unequipAll first, then exactly one
// removeAllItems, then setInventory. Source check. Run from skymp5-client: node tests/equip-order-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };
const src = fs.readFileSync(path.resolve(__dirname, '../src/sync/equipment.ts'), 'utf8');
const body = (src.match(/export const applyEquipment = [\s\S]*?\n};/) || [''])[0]
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
check('applyEquipment found', !!body);
const calls = [...body.matchAll(/ac\.(unequipAll|removeAllItems)\(|setInventory\(/g)].map((m) => m[1] || 'setInventory');
check('unequipAll, then one removeAllItems, then setInventory', JSON.stringify(calls) === JSON.stringify(['unequipAll', 'removeAllItems', 'setInventory']), calls);
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
