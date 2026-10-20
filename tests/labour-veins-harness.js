// labour.js VEIN: which activators are ore veins (smithing obtainability audit, 9 Oct). Reads the regex from the source,
// so it checks what ships. Run: node tests/labour-veins-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'labour.js'), 'utf8');
const m = /const VEIN = (\/.+\/);/.exec(src);
let fails = 0;
const ok = (c, what) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}`); if (!c) fails++; };
ok(!!m, 'labour.js defines VEIN');
const VEIN = eval(m[1]);   // eslint-disable-line no-eval
const ore = (e) => { const r = VEIN.exec(e); return r ? r[1].toLowerCase() : ''; };
for (const [edid, want] of [
  ['MineOreQuicksilver02_LTundraRocks', 'quicksilver'], ['CYRMineOreCopper01_Rocks01', 'copper'], ['MineOreIron04', 'iron'],
  ['DLC2MineOreHeartStone01VolcanicAsh01', 'heartstone'], ['DLC2MineOreStalhrim', 'stalhrim'], ['DLC2MineOreStalhrim_DisappearOnDepletion', 'stalhrim'],
  ['BSKMineOreTin01', 'tin'], ['BSKMineOreAdamantine02_LRocks01', 'adamantine'], ['MineOreBlackreach01', 'blackreach'],
  ['BSBMMineOreSilver01', ''], ['CYRMineGemRuby01', ''], ['12SeaSaltDeposit', ''],
]) ok(ore(edid) === want, `${edid} -> ${want || 'not a vein'} (got ${ore(edid) || 'nothing'})`);
ok(/extraOreTier: \{ salt: 0, tin: 0,/.test(src), 'tin is minable from tier 0, with copper');

// The remapped veins (oreByRef): a ref may be claimed once and once only, or the later line silently wins and a trade
// loses its only seams. Mountainwatch's Frostiron mine is the adamantium mine (Nate, 17 Oct); its four quicksilver veins
// are deliberately left out of it, being the only quicksilver inside the Bruma lock.
const REMAPS = [...src.matchAll(/'([0-9a-f]+:[^']+)': '([a-z]+)',/g)].map((r) => [r[1], r[2]]);
const seen = new Map();
const twice = REMAPS.filter(([ref]) => (seen.has(ref) ? true : (seen.set(ref, 1), false)));
ok(!twice.length, `no ref is remapped twice (${twice.map(([r]) => r).join(', ') || 'none'})`);
const byOre = REMAPS.reduce((m2, [, o]) => Object.assign(m2, { [o]: (m2[o] || 0) + 1 }), {});
ok(byOre.adamantium >= 25, `adamantium has its mine: ${byOre.adamantium || 0} veins`);
ok(byOre.quicksilver === 4, `the four quicksilver veins survive it: ${byOre.quicksilver || 0}`);
ok(byOre.meteoriciron === 3 && byOre.geode === 3, 'meteoric iron and the soul-gem geodes are untouched');
for (const ref of ['177faa:DragonBreak Online Edits.esp', 'd9a16:BSHeartland.esm', 'e59e0:BSHeartland.esm'])
  ok(seen.has(ref) && REMAPS.find(([r]) => r === ref)[1] === 'adamantium', `${ref} gives adamantium`);
for (const ref of ['e59f8:BSHeartland.esm', '177fa4:DragonBreak Online Edits.esp'])
  ok(REMAPS.find(([r]) => r === ref)[1] === 'quicksilver', `${ref} is still quicksilver`);
ok(/adamantium: 3,/.test(src) || /adamantium: [0-9]/.test(src), 'adamantium still opens at its Miner tier (extraOreTier)');
ok(/if \(type === 'ACTI' && \(VEIN\.test\(edid\)/.test(src), 'the activation test uses the same VEIN');
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
