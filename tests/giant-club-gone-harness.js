// Giant clubs are gone by all three routes (Nate, 12 Oct: "remove all giants clubs from being made and from peoples
// inventories"). A club is damage 80 two-handed, far above any player weapon.
//   node tests/giant-club-gone-harness.js   (from server/)
//
// Crafting is refused by the forge-never list, inventories and containers are swept by gearStrip, and loot is the
// third way back in: until 12 Oct only the Dawnguard club was on the loot never list, so the other three could still
// drop and then be stripped again.
'use strict';
const fs = require('fs');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const rj = (f) => JSON.parse(fs.readFileSync(path.join(SERVER, f), 'utf8'));
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 200)}`); if (!c) fails++; };

const CLUBS = ['12d14:Dawnguard.esm', '2f7067:SurWR.esp', '461da:Skyrim.esm', 'c334f:Skyrim.esm'];
const TIERS = require(path.join(SERVER, 'loottiers.js'))({ materials: rj('loot-materials.json'), factionGear: rj('faction-gear.json'), overrides: rj('loot-overrides.json'), cfg: undefined });

for (const d of CLUBS) {
  const c = TIERS.classOf(d);
  ok(c.kind === 'never', `${d} never drops as loot`, c);
}
const strip = (rj('gamemode-config.json').gearStrip || {});
const stripped = new Set((strip.items || []).map((i) => String(i.item).toLowerCase()));
ok(strip.enabled === true, 'gearStrip is on, so copies in hand are taken');
for (const d of CLUBS) ok(stripped.has(d.toLowerCase()), `${d} is on the gearStrip list`);
for (const i of (strip.items || [])) {
  if (!stripped.has(String(i.item).toLowerCase()) || !/club/i.test(i.name || '')) continue;
  ok(/Steel Warhammer/i.test(i.swapName || ''), `${i.item} is swapped for a Steel Warhammer, not simply taken`, i.swapName);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
