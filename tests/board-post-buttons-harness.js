// The notice board's way in to Supply orders and Couriers (Nate, 12 Oct: "hard to find"). They are tabs of the pigeon
// coop behind Letters, and the only button on the board was Send a pigeon, so a player had to open the coop and go
// looking. The board now offers each one, and the coop opens straight onto it (gamemode onUi('pigeonOpen') takes the
// view). run-all bundles the widget from $FORK; by hand:
//
//   node tests/board-post-buttons-harness.js <bundle of skymp5-front/src/features/bountyBoard/index.tsx>
//
// A front from before the buttons has nothing to test, which is said and not failed.
'use strict';
const fs = require('fs');
const path = require('path');

const bundle = process.argv[2];
if (!bundle) { console.log('usage: node tests/board-post-buttons-harness.js <bundle>'); process.exit(2); }
if (!fs.existsSync(bundle) || !/Supply orders/.test(fs.readFileSync(bundle, 'utf8'))) {
  require('./expect')('board-post-buttons', 'this front has no Supply orders button on the board');
  console.log('ok   skipped: this front predates the board buttons');
  process.exit(0);
}
const { Widget, renderToStaticMarkup, createElement } = require(bundle);

let failures = 0;
const check = (label, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!ok) failures++; };
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const DATA = {
  boardName: 'Bruma', costGold: 30, gold: 500, maxTextLen: 300, maxNotes: 20, expiryDays: 7,
  tabs: [{ id: 'citizen', label: 'Citizen Notices', cost: 30, canPost: true }],
  notes: [], events: { post: 'dbo:boardPost', remove: 'dbo:boardRemove', close: 'dbo:boardClose' },
};
const html = renderToStaticMarkup(createElement(Widget, { data: DATA }));
const shown = text(html);

check('the board offers Supply orders', /Supply orders/.test(shown), shown.slice(0, 300));
check('the board offers Couriers', /\bCouriers\b/.test(shown), shown.slice(0, 300));
check('Send a pigeon is still there', /Send a pigeon/.test(shown));
check('Close is still there', /\bClose\b/.test(shown));

// Each button has to ask for its own view, or it just reopens the coop on Letters and nothing is solved.
const src = fs.readFileSync(bundle, 'utf8');
for (const view of ['send', 'supply', 'courier']) {
  check(`a button opens the coop on "${view}"`, new RegExp(`dbo:pigeonOpen["'\\s,]+${view}`).test(src));
}
// The coop is opened before the board is closed: closing first drops the cursor and the next panel opens unfocused.
const order = /pigeonOpen[^)]*\)[^}]*?events?\.?close|pigeonOpen['",\s\w]*\);\s*send\(ev\.close\)/;
check('the coop is opened before the board closes, so the cursor is kept', order.test(src), src.match(/pigeonOpen[\s\S]{0,60}/g));

// The coop must not strand a player on a view this board has no tab for.
const pigeonSrc = (() => {
  const FORK = process.env.FORK || path.resolve(__dirname, '..', '..', 'fork');
  const p = path.join(FORK, 'skymp5-front', 'src', 'features', 'pigeon', 'index.tsx');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
})();
if (pigeonSrc) {
  check('the coop falls back when the asked-for view has no tab', /const shown = /.test(pigeonSrc));
  check('...and the panel body reads the fallback, not the raw view', /\{shown === 'letters'/.test(pigeonSrc));
  check('...and the tab highlight follows it too', /shown === 'supply' \? ' pigeon__tab--active'/.test(pigeonSrc));
} else {
  require('./expect')('board-post-buttons', 'the pigeon widget source could not be read for the fallback checks');
  console.log('  (pigeon/index.tsx not found; fallback checks skipped)');
}

console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
