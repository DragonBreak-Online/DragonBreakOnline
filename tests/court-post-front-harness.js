// Scripted test for the Court tab's posting block (skymp5-front court, Nat 25 Oct: officials post hunting work and commissions
// from the treasury): renders the real tab with React's static renderer for the view contracts.js sends. run-all bundles the
// widget from $FORK; by hand:
//
//   node tests/court-post-front-harness.js <bundle of skymp5-front/src/features/court/index.tsx>
//
// A front from before the block has nothing to test, which is said and not failed: /contract post and commission still work.
'use strict';
const fs = require('fs');

const bundle = process.argv[2];
if (!bundle) { console.log('usage: node tests/court-post-front-harness.js <bundle>'); process.exit(2); }
if (!/courtCommissionPost/.test(fs.readFileSync(bundle, 'utf8'))) {
  console.log('ok   skipped: this front predates posting from the Court tab');
  process.exit(0);
}
const { Widget, renderToStaticMarkup, createElement } = require(bundle);
let failures = 0;
const check = (label, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '   ' + String(detail).slice(0, 600)}`); if (!ok) failures++; };
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const TERMS = {
  tiers: [{ tier: 1, name: 'pests', price: 12 }, { tier: 2, name: 'dangerous beasts', price: 25 }, { tier: 3, name: 'deadly beasts', price: 80 }],
  bounds: { min: 1, max: 200 }, budget: 1000, budgetMax: 100000, spent: 0, left: 1000, resetsAt: Date.now() + 86400000, standing: true,
  citizensOnly: true, canSet: false, by: '', at: 0, enabled: true,
  canPost: true, postBudget: 2000, postLeft: 1760, postsPerDay: 3, postsLeftToday: 2,
  fauna: [{ kind: 'boar', name: 'boars', tier: 1, perKill: 12, spots: 13 }, { kind: 'ogre', name: 'ogres', tier: 3, perKill: 80, spots: 41 }],
  posted: [{ id: 'p1', type: 'hunt', what: '3 ogres in Bruma for 240 gold', by: 'Rocco', held: 240, hoursLeft: 11, mine: true, canWithdraw: true },
    { id: 'p2', type: 'commission', what: '6 Wolf Pelt wanted by Bruma at 15 gold each', by: 'Ohoom', held: 90, hoursLeft: 40, mine: false, canWithdraw: false }],
  search: { query: 'pelt', items: [{ desc: '3ad6e:Skyrim.esm', name: 'Wolf Pelt', value: 10, maxPrice: 15 }] },
  commissionMaxCount: 200,
};
const court = (terms) => ({ id: 'bruma', name: 'Bruma', kind: 'region', mine: true, offices: [], outgoing: [], household: null, treasury: 9000, appointable: [], contracts: terms });
const render = (terms) => text(renderToStaticMarkup(createElement(Widget, { section: { staff: false, outright: false, courts: [court(terms)], selected: 'bruma', offers: [] }, busy: false, act: () => {} })));

let t = render(TERMS);
check('an official sees Post work with the week\'s posting budget and posts left today', /Post work/.test(t) && /1760 of 2000 gold left/.test(t) && /you may post 2 more today/.test(t), t);
// A Picker renders closed: only its current choice shows
check('...the hold\'s own beasts, the first picked with its pay per kill, and Post hunt', /boars \(12 a kill\) ▾ Post hunt/.test(t), t);
check('...after a search, the goods picker and Commission', /Pick the goods ▾/.test(t) && /Commission/.test(t), t);
check('...what is posted, a commission marked, Take down only where allowed', /3 ogres in Bruma for 240 gold \(by Rocco, 240 gold held, 11h left\) Take down/.test(t) && /Commission: 6 Wolf Pelt wanted by Bruma at 15 gold each \(by Ohoom, 90 gold held, 40h left\)(?! Take down)/.test(t), t);
t = render(Object.assign({}, TERMS, { canPost: false }));
check('someone without a post reads that officials post here, and the list', /Officials of Bruma post hunting work and commissions here/.test(t) && /3 ogres in Bruma/.test(t), t);
t = render(Object.assign({}, TERMS, { canSet: true }));
check('a tax-setter sets the posting budget', /Posted work a week/.test(t), t);
const old = Object.assign({}, TERMS); delete old.fauna; delete old.postBudget;
t = render(old);
check('an older server (no fauna) shows no posting block', !/Post work/.test(t) && !/Posted work a week/.test(t), t);

console.log(failures ? `${failures} FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
