// DragonBreak Online: makers' marks in item names (the Grandmaster capstones, Nat 2 Nov; _work/grandmaster-capstones.md).
// Pure functions, no api: capstones.js requires it, and so can any module that writes a maker's name onto an item.
//
// A mark is "<item>, <verb> <maker>" ("Steel Sword, forged by Eorlund"). durability.js adds its wear tier after the whole
// name ("..., forged by Eorlund (Worn)") and strips only that suffix, so a mark survives wear and repair untouched.
// A buyer's own name for the piece (Tailor's bespoke work, a named enchantment) stands in for the item's name:
// "the Jarl's Winter Robe, sewn by Endarie".
'use strict';

const MAX = 120;
// A wear suffix as durability.js writes it, left on the end of whatever the name becomes
const WEAR = /\s*\((Worn|Damaged|Broken)\)$/;
const VERBS = ['forged by', 'sewn by', 'brewed by', 'enchanted by', 'seasoned by', 'mounted by'];
const MARK = new RegExp(`, (${VERBS.join('|')}) ([^,()]+)$`);

const clean = (s) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const wearOf = (name) => { const m = WEAR.exec(String(name || '')); return m ? m[0] : ''; };
const withoutWear = (name) => String(name || '').replace(WEAR, '');

// { verb, maker } of a marked name, or null
const markOf = (name) => {
  const m = MARK.exec(withoutWear(name));
  return m ? { verb: m[1], maker: m[2] } : null;
};
// The name with its mark (and wear) taken off: the item's own name, or the buyer's name for it
const unmarked = (name) => withoutWear(name).replace(MARK, '');
// itemName: the item's own name (or a buyer's name for it); verb: one of VERBS; maker: the character's own name.
// An existing mark is replaced, never doubled, and a wear tier already on the name stays last.
const markName = (itemName, verb, maker, current) => {
  if (!VERBS.includes(verb)) throw new Error(`itemnames: unknown verb ${verb}`);
  const who = clean(maker).replace(/[,()]/g, '');
  const base = clean(unmarked(itemName));
  if (!who || !base) return null;
  const out = `${base}, ${verb} ${who}${wearOf(current || itemName)}`;
  return out.length <= MAX ? out : null;
};

module.exports = { VERBS, MAX, markName, markOf, unmarked, withoutWear };
