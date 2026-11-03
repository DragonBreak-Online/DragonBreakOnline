// itemnames.js, the makers' marks (Grandmaster capstones, Nat 2 Nov): a mark is "<item>, <verb> <maker>", never doubled,
// and durability.js's wear tier stays last through wear and repair. durability.js's own tier names and suffix rule are
// read from its source, so a change there that would eat a mark fails here.
//   node tests/itemnames-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const N = require(path.join(__dirname, '..', 'itemnames.js'));
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };

const m = N.markName('Steel Sword', 'forged by', 'Eorlund Gray-Mane');
ok(m === 'Steel Sword, forged by Eorlund Gray-Mane', 'a mark reads "<item>, forged by <maker>"', m);
ok(JSON.stringify(N.markOf(m)) === JSON.stringify({ verb: 'forged by', maker: 'Eorlund Gray-Mane' }) && N.unmarked(m) === 'Steel Sword', '...and reads back to its maker and the bare item', [N.markOf(m), N.unmarked(m)]);
ok(N.markName(m, 'forged by', 'Someone Else') === 'Steel Sword, forged by Someone Else', 'marking again replaces the mark, never doubles it');
ok(N.markName('Steel Sword (Worn)', 'forged by', 'Eorlund') === 'Steel Sword, forged by Eorlund (Worn)', 'a wear tier already on the name stays last');
ok(N.markName("the Jarl's Winter Robe", 'sewn by', 'Endarie') === "the Jarl's Winter Robe, sewn by Endarie", "a buyer's name stands in for the item's");
ok(N.markName('Steel Sword', 'forged by', 'Ba, d (Name)') === 'Steel Sword, forged by Ba d Name', 'commas and brackets in a maker\'s name cannot fake a second mark or a wear tier');
ok(N.markName('Steel Sword', 'forged by', '   ') === null && N.markName('', 'forged by', 'Eorlund') === null, 'no maker or no item: no mark');
ok(N.markName('x'.repeat(200), 'forged by', 'Eorlund') === null, `a name past ${N.MAX} characters is refused`);
let threw = false; try { N.markName('Steel Sword', 'stolen by', 'Eorlund'); } catch (e) { threw = true; }
ok(threw, 'an unknown verb is a programming error, not a mark');

// durability.js's rule, from its own source: tierNames and the suffix it strips
const DUR = fs.readFileSync(path.join(__dirname, '..', 'durability.js'), 'utf8');
const names = JSON.parse(DUR.match(/tierNames:\s*(\[[^\]]*\])/)[1].replace(/'/g, '"'));
const SUFFIX = new RegExp(`\\s*\\((${names.filter(Boolean).join('|')})\\)$`);
const bareName = (n) => n.replace(SUFFIX, '');
const nameAt = (n, tier) => (tier > 0 ? `${bareName(n)} (${names[tier]})` : bareName(n));
ok(/const SUFFIX = new RegExp\(`\\\\s\*\\\\\(\(\$\{NAMES/.test(DUR) && /const nameAt = \(e, tier\) => \(tier > 0 \? `\$\{bareName\(e\)\} \(\$\{NAMES\[tier\]\}\)`/.test(DUR),
  "durability.js still strips only its own tier suffix and puts the tier after the whole name");
ok(names.filter(Boolean).every((t) => N.markOf(`Steel Sword, forged by Eorlund (${t})`)), "itemnames.js reads a mark under every one of durability.js's tiers", names);
const worn = nameAt(m, 1);
ok(worn === 'Steel Sword, forged by Eorlund Gray-Mane (Worn)' && N.markOf(worn).maker === 'Eorlund Gray-Mane', 'worn: the mark stays, the tier follows it', worn);
ok(nameAt(nameAt(worn, 3), 0) === m, 'broken and repaired: the mark is exactly as forged');

console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
