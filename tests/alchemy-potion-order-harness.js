// The Alchemist's tier picks a potion from its effect's list, weakest first. alchemy-potions.json lists two out of order
// (Invisibility 01, 04, 02, 03 and Fortify Stamina 01, 05, 02, 03, 04), so a tier 1 brewer got Invisibility04, the 50 s
// potion: about 420 brewed in 11 days, 240 by one player (Nate, 15 Oct: "too many invisibility potions"). alchemy.js now
// sorts each list by magnitude, then duration. Runs the real list building and potionAt cut from alchemy.js.
//   node tests/alchemy-potion-order-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'alchemy.js'), 'utf8');
const TABLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'alchemy-potions.json'), 'utf8')).effects;
const a0 = src.indexOf('  const POTIONS = new Map();'), a1 = src.indexOf('\n  }\n', a0) + 4;
const p0 = src.indexOf('  const potionAt = '), p1 = src.indexOf('\n', p0);
let fails = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) fails++; };
check('the list building and potionAt are in alchemy.js', a0 > 0 && a1 > a0 && p0 > 0);
const idOf = (desc) => parseInt(String(desc).split(':')[0], 16) || 0;
const { POTIONS, potionAt } = new Function('TABLE', 'idOf', `${src.slice(a0, a1)}\n${src.slice(p0, p1)}\nreturn { POTIONS, potionAt };`)(TABLE, idOf);
const byName = (n) => [...POTIONS.values()].find((v) => v.name === n);
const inv = byName('AlchInvisibillity'), stam = byName('AlchFortifyStamina');
check('Invisibility is listed weakest first', inv.potions.map((p) => p.edid).join() === 'Invisibility01,Invisibility02,Invisibility03,Invisibility04', inv.potions.map((p) => p.edid));
check('a tier 1 brewer no longer gets the 50 s Invisibility04', potionAt(inv, 1).edid !== 'Invisibility04', potionAt(inv, 1).edid);
check('...a Master does', potionAt(inv, 5).edid === 'Invisibility04', potionAt(inv, 5).edid);
check('Fortify Stamina: tier 1 no longer gets the +100 potion, a Master does', potionAt(stam, 1).edid !== 'FortifyStamina05' && potionAt(stam, 5).edid === 'FortifyStamina05', [potionAt(stam, 1).edid, potionAt(stam, 5).edid]);
let ordered = 0;
for (const v of POTIONS.values()) {
  const m = v.potions.map((p) => [p.mag, p.dur]);
  if (m.every((x, i) => i === 0 || x[0] > m[i - 1][0] || (x[0] === m[i - 1][0] && x[1] >= m[i - 1][1]))) ordered++;
}
check('every effect\'s list runs weakest to strongest', ordered === POTIONS.size, `${ordered}/${POTIONS.size}`);
console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
