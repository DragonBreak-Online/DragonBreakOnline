// Blacksmithing's page in the native journal's Skills tab (swf/dbo_journal tabs/skills.as skillsSmith), against the
// browser's features/smith SmithTiers, from smithing.js __dboSmithView: the craft tier and its points, the apprenticeship,
// the upgrade rule, and per tier the craftable equipment, the learned recipes and the unlearned ones with how to learn them.
//   node tests/native-journal-smith-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const TABS = [{ id: 'profile', label: 'Profile' }, { id: 'skills', label: 'Skills' }];
const hub = (skills, extra) => Object.assign({ type: 'journal', id: 50, nonce: 'n1', hub: 1, tabs: TABS, tab: 'skills', opened: 1, clock: { date: 'd', time: 't' }, head: { name: 'Olaf', title: 'J', race: 'N' }, skills }, extra || {});
const P = (t) => t.root.dboPanel;
const shownPage = (t) => Object.values(P(t).body.flowClip.kids).find((p) => p._visible);
const texts = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids).sort((a, b) => (a._y || 0) - (b._y || 0))) { if (typeof x.text === 'string' && !x.kids) out.push(x.text); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out.join('|'); };
const first = (t) => { for (let i = 0; i < 6; i++) t.press(33); };
const everyPage = (t) => { first(t); const out = []; for (let i = 0; i < 12; i++) { out.push(texts(t)); const n = P(t).foot.next; if (!n || n.disabled) break; n.onRelease(); } return out.join('|'); };

const sk = (id, label) => ({ id, category: 'profession', label, title: 'the ' + label, description: label + ' rule.', tiers: ['t0', 't1', 't2', 't3', 't4'], lore: label + ' lore.', tierLore: ['', '', '', '', ''] });
const fam = (id, name, tier, known, how, recipes, learnHint) => ({ id, name, tier, known, how, canMake: 0, learnHint: learnHint || '', recipes });
const smith = {
  tier: 2, tierName: 'Journeyman', tierNames: ['Novice', 'Journeyman', 'Adept'], points: 140, nextAt: 300,
  families: [
    fam('iron', 'Iron', 1, true, 'book', ['Iron Sword', 'Iron Helmet']),
    fam('steel', 'Steel', 2, true, 'apprentice', ['Steel Sword', { name: 'Steel Plate', learned: false }]),
    fam('elven', 'Elven', 2, false, null, ['Elven Bow'], 'from an Elven smith\'s book'),
    fam('orcish', 'Orcish', 3, true, 'staff', ['Orcish Axe'], 'from an orc stronghold'),
  ],
  apprentice: { family: 'elven', count: 2, of: 5 },
  upgradeRule: 'You can temper gear up to your craft tier.',
};
const skills = { tierNames: ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'], skills: [sk('blacksmith', 'Blacksmithing'), sk('alchemy', 'Alchemy')], chosen: [{ id: 'blacksmith', rank: 1, hours: '12 h' }], focus: 'blacksmith', smith };

{
  const t = S.boot('dbo_journal');
  t.push(hub(skills));
  const tx = everyPage(t);
  check('the craft tier, its name and the points to the next', /Craft tier 2   Journeyman/.test(tx) && /140 points, tier 3 at 300/.test(tx), tx);
  check('...the apprenticeship by the family\'s name, and the upgrade rule', /Apprenticeship: Elven, 2 of 5/.test(tx) && /You can temper gear up to your craft tier\./.test(tx));
  check('tier 1 by its name: the families with how they were learned, the recipes learned', /Tier 1: Novice/.test(tx) && /Craftable equipment\|Iron \(from a book\)/.test(tx) && /Learned recipes\|Iron Sword, Iron Helmet/.test(tx), tx);
  check('tier 2: a recipe the server marks unlearned stays locked, an unknown family with how to learn it', /Iron Helmet\|Tier 2: Journeyman/.test(tx) && /Steel \(as an apprentice\), Elven/.test(tx) && /Learned recipes\|Steel Sword\|/.test(tx) && /Unlearned recipes\|Steel  -  Steel Plate/.test(tx) && /Elven: from an Elven smith's book  -  Elven Bow/.test(tx), tx);
  check('tier 3 out of reach: needs the tier, nothing learned, no how, no hint', /Tier 3: Adept \(needs craft tier 3\)/.test(tx) && /Craftable equipment\|Orcish\|/.test(tx) && /Learned recipes\|None yet\./.test(tx) && /Orcish  -  Orcish Axe/.test(tx) && !/from an orc stronghold/.test(tx) && !/from staff/.test(tx), tx);
  check('the smith page replaces the generic tiers', !/The tiers/.test(tx));
}

{
  const t = S.boot('dbo_journal');
  t.push(hub(Object.assign({}, skills, { smith: Object.assign({}, smith, { tier: 12, nextAt: null, apprentice: null, tierNames: undefined, families: [fam('iron', 'Iron', 9, false, null, undefined, 'a book')] }) })));
  const tx = everyPage(t);
  check('a tier past seven is seven; the highest: no next, no apprenticeship', /Craft tier 7   Journeyman/.test(tx) && /140 points, the highest tier/.test(tx) && !/Apprenticeship/.test(tx), tx);
  check('a tier past seven is seven; no tier names, just the number; an unknown family without recipes is unlearned with its hint', /Tier 7\|/.test(tx) && /Unlearned recipes\|Iron: a book/.test(tx), tx);
  const a = S.boot('dbo_journal');
  a.push(hub(Object.assign({}, skills, { focus: 'alchemy' })));
  check('another skill has no smith page', !/Craft tier/.test(everyPage(a)));
}

T.done();
