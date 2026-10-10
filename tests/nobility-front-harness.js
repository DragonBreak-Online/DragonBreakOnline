// The F3 Nobility tab (skymp5-front features/nobility; gameplay nobility.js): renders the real tab with React's static
// renderer for the sections nobility.js sends an ordinary player, a Baron and the Countess, and checks what each sees and which
// dbo:nobility* events the controls carry. run-all bundles the widget from $FORK:
//   node tests/nobility-front-harness.js <bundle of skymp5-front/src/features/nobility/index.tsx>
'use strict';
const fs = require('fs');
const path = require('path');
const bundle = process.argv[2];
if (!bundle) { console.log('usage: node tests/nobility-front-harness.js <bundle>'); process.exit(2); }
if (!/nobility__roll/.test(fs.readFileSync(bundle, 'utf8'))) {
  require('./expect')('nobility-front', 'this front has no Nobility tab');
  console.log('ok   skipped: this front has no Nobility tab');
  process.exit(0);
}
const { Widget: Tab, GrantForm, renderToStaticMarkup, createElement } = require(path.resolve(bundle));
let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 500) : ''}`); if (!cond) fails++; };
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const render = (section) => renderToStaticMarkup(createElement(Tab, { section, sections: {}, nonce: 'N', busy: false, act: () => {}, openTab: () => {} }));
const elion = { actor: '15', name: 'Lord Elion', tag: 'ELI1', online: true, title: 'baron', label: 'Baron of Mountain Watch', fief: 'mountain-watch', estate: '', since: Date.UTC(2026, 9, 11) };
const kesta = { actor: '17', name: 'Kesta', tag: 'KST1', online: false, title: 'knight', label: 'Dame of Bruma', fief: '', estate: '', since: Date.UTC(2026, 9, 11) };
const hold = (over) => Object.assign({
  id: 'bruma', name: 'Bruma', realm: 'cyrodiil', ruler: { name: 'Narina Carvain', style: 'Countess of Bruma' }, isRuler: false,
  fiefs: [{ id: 'applewatch', name: 'Applewatch', buildings: 3, holder: null, treasury: null }, { id: 'mountain-watch', name: 'Mountain Watch', buildings: 4, holder: elion, treasury: null }],
  roll: [elion, kesta], titles: [],
}, over);
const sec = (over) => Object.assign({ enabled: true, fiefShare: 25, holds: [hold()], mine: [], selected: 'bruma' }, over);

let t = text(render(sec()));
ok('everyone sees the county, its ruler, the fiefs with their holders and the roll', /County of Bruma/.test(t) && /Countess of Bruma: Narina Carvain/.test(t) && /Applewatch Vacant/.test(t)
  && /Mountain Watch Baron of Mountain Watch: Lord Elion #ELI1/.test(t) && /Roll of nobles/.test(t) && /Kesta #KST1 Dame of Bruma/.test(t), t);
ok('...but no treasury, no Revoke and no grant form', !/gold/.test(t) && !/Revoke/.test(t) && !/Grant a title/.test(t), t);
ok('...and says they hold no title', /Your titles You hold no title\./.test(t), t);

const mine = [{ hold: 'bruma', label: 'Baron of Mountain Watch', since: Date.UTC(2026, 9, 11), fief: { id: 'mountain-watch', name: 'Mountain Watch', treasury: 50,
  properties: [{ ref: '500', name: "Zurikki's House", owner: 'Lord Elion' }, { ref: '501', name: 'Bunkhouse', owner: 'Aubert' }] } }];
t = text(render(sec({ mine, holds: [hold({ fiefs: hold().fiefs.map((f) => (f.id === 'mountain-watch' ? Object.assign({}, f, { treasury: 50 }) : f)) })] })));
ok('a Baron sees his title, his fief\'s treasury and share, and its buildings with their owners', /Baron of Mountain Watch since/.test(t) && /The treasury of Mountain Watch holds 50 gold\. It takes 25%/.test(t)
  && /Buildings of Mountain Watch Zurikki's House Lord Elion Bunkhouse Aubert/.test(t), t);
ok('...and his own fief\'s treasury in the fief list', /Mountain Watch Baron of Mountain Watch: Lord Elion #ELI1 50 gold/.test(t), t);

const ruler = hold({ isRuler: true, fiefs: hold().fiefs.map((f) => Object.assign({}, f, { treasury: f.id === 'applewatch' ? 0 : 50 })),
  titles: [{ id: 'baron', label: 'Baron / Baroness', needs: 'fief' }, { id: 'lord', label: 'Lord / Lady', needs: 'estate' }, { id: 'knight', label: 'Knight / Dame', needs: '' }] });
const h = render(sec({ holds: [ruler] }));
t = text(h);
ok('the ruler sees every fief treasury, a Revoke on each noble and the grant form', /Applewatch Vacant 0 gold/.test(t) && (t.match(/Revoke/g) || []).length === 2 && /Grant a title/.test(t) && /Proclaim/.test(t), t);
ok('...whose fief choice lists only the vacant fiefs', /Fief Applewatch/.test(t) && !/Fief Mountain Watch/.test(t), t);
ok('...and the button waits for a name', /<button[^>]*disabled=""[^>]*>Proclaim/.test(h), h.slice(h.indexOf('Grant a title'), h.indexOf('Grant a title') + 900));
const allHeld = hold({ isRuler: true, fiefs: [{ id: 'mountain-watch', name: 'Mountain Watch', buildings: 4, holder: elion, treasury: 50 }], titles: ruler.titles });
t = text(renderToStaticMarkup(createElement(GrantForm, { hold: allHeld, busy: false, act: () => {} })));
ok('with every fief held, the form says so', /Every fief is held\. Revoke a title to free one\./.test(t), t);
t = text(render(sec({ holds: [hold({ canRevoke: true })] })));
ok('a Lead GM sees Revoke on each noble, and no grant form', (t.match(/Revoke/g) || []).length === 2 && !/Grant a title/.test(t) && !/gold/.test(t), t);
t = text(render(sec({ holds: [], mine: [] })));
ok('no hold with nobles yet', /No hold keeps a roll of nobles yet\./.test(t), t);
const src = fs.readFileSync(bundle, 'utf8');
ok('the controls send dbo:nobilityGrant and dbo:nobilityRevoke', /dbo:nobilityGrant/.test(src) && /dbo:nobilityRevoke/.test(src));
ok('the tab registers as nobility (journalTab:nobility in the HUD caps)', /registerJournalTab\)?\(\s*["']nobility["']/.test(src) || /["']nobility["'],\s*NobilityTab/.test(src));
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
