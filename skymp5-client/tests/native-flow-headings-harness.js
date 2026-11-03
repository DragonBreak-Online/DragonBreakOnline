// A section heading never ends a page apart from its section (otome, 3 Nov 2026: the journal's Backstory header on page 1,
// its text on page 2). swf/lib/dbo-flow.as flowHeading notes the heading and the next block draws it, on a new page when
// the two do not fit together. Checked on the lib itself (a heading at a page's foot before a tall block, two headings in a
// row, a gap between a heading and its text, a heading with nothing after it) and on the journal's Profile tab with
// backstories of every length that brings the Backstory heading to a page's foot.
//   node tests/native-flow-headings-harness.js
'use strict';
const vm = require('vm');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

// Every block on a page, top to bottom: a heading is a text field in the 22-point bold heading format
const isHeading = (x, ctx) => typeof x.text === 'string' && !x.kids && x.fmt && x.fmt.size === 22 && x.fmt.font === vm.runInContext('F_BOLD', ctx);
const blocksOf = (page, ctx) => Object.values(page.kids)
  .filter((x) => (typeof x.text === 'string' && !x.kids) || x.kids)
  .map((x) => ({ y: x._y || 0, heading: isHeading(x, ctx), text: typeof x.text === 'string' ? x.text : '' }))
  .sort((a, b) => a.y - b.y);
const pagesOf = (flowClip) => Object.keys(flowClip.kids).filter((k) => /^p\d+$/.test(k)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((k) => flowClip.kids[k]);
// The headings that end a page which is not the last (orphans), as "page n: text"
const orphans = (flowClip, ctx) => {
  const pages = pagesOf(flowClip); const out = [];
  pages.forEach((p, i) => { const b = blocksOf(p, ctx); if (i < pages.length - 1 && b.length && b[b.length - 1].heading) out.push(`page ${i + 1}: ${b[b.length - 1].text}`); });
  return out;
};
const where = (flowClip, ctx, text) => { const pages = pagesOf(flowClip); for (let i = 0; i < pages.length; i++) if (blocksOf(pages[i], ctx).some((b) => b.text === text)) return i; return -1; };

// ---- the lib on its own, in a booted journal's context --------------------------------------------------------------
const TABS = [{ id: 'profile', label: 'Profile' }];
const t = S.boot('dbo_journal');
const run = (src) => vm.runInContext(src, t.ctx);
const stage = () => { run('flowStart(_root, 900, 0, 0)'); return t.root.flowClip; };
// fill a page to y, then a heading, then a block of height h: where do they land?
const lib = (fillTo, blockH, extra) => {
  const fc = stage();
  run(`flowNeed(${fillTo}); flowHeading("H"); ${extra || ''} flowNeed(${blockH}); flowShow(0)`);
  return fc;
};
const BODY_H = run('BODY_H');
{
  const fc = lib(BODY_H - 60, 200);
  check('a heading with room for itself but not its section goes to the next page with it', orphans(fc, t.ctx).length === 0 && where(fc, t.ctx, 'H') === 1, orphans(fc, t.ctx));
}
{
  const fc = lib(100, 80);
  check('a heading and its section that fit stay where they are', where(fc, t.ctx, 'H') === 0 && pagesOf(fc).length === 1);
}
{
  const fc = stage();
  run(`flowNeed(${BODY_H - 70}); flowHeading("A"); flowHeading("B"); flowNeed(120); flowShow(0)`);
  check('two headings in a row: neither is left at a page foot', orphans(fc, t.ctx).length === 0 && where(fc, t.ctx, 'B') === where(fc, t.ctx, 'A') || where(fc, t.ctx, 'A') === 0 && orphans(fc, t.ctx).length === 0, [where(fc, t.ctx, 'A'), where(fc, t.ctx, 'B'), orphans(fc, t.ctx)]);
}
{
  const fc = stage();
  run(`flowNeed(${BODY_H - 70}); flowHeading("G"); flowGap(12); flowNeed(100); flowShow(0)`);
  check('a gap between a heading and its section counts toward keeping them together', orphans(fc, t.ctx).length === 0 && where(fc, t.ctx, 'G') === 1, orphans(fc, t.ctx));
}
{
  const fc = stage();
  run('flowNeed(100); flowHeading("Last"); flowShow(0)');
  check('a heading with nothing after it is still drawn', where(fc, t.ctx, 'Last') === 0);
}
{
  const fc = stage();
  // flowNeed only reserves the room, so where the block went is read from the place it was given
  run(`flowNeed(10); flowHeading("Top"); var tallAt = flowNeed(${BODY_H + 50}); flowShow(0)`);
  const blockPage = run('tallAt.clip.pageNo');
  check('a section taller than a page starts on the same page as its heading, never on the next one', blockPage === where(fc, t.ctx, 'Top') && pagesOf(fc).length === 2, [where(fc, t.ctx, 'Top'), blockPage, pagesOf(fc).length]);
}

// ---- the journal's Profile tab: the Backstory heading at every place near a page's foot ------------------------------
const hub = (profile) => ({ type: 'journal', id: 50, nonce: 'n1', hub: 1, tabs: TABS, tab: 'profile', opened: 1, clock: { date: 'd', time: 't' }, head: { name: 'Olaf', title: 'J', race: 'N' }, profile });
const base = {
  name: 'Olaf', race: 'Nord', playtime: '12 h', created: '3 Oct 2026', joined: '1 Oct 2026', origin: 'Bruma.', backstoryMax: 4000, originMax: 1000,
  skills: [{ id: 'smithing', name: 'Smithing', level: 42, tier: 2, tierName: 'Adept', epithet: '' }], status: [], canReroll: false, levelPoints: 0,
  title: 'Wanderer', titleEpithet: '', titleId: 'wanderer', titles: [{ id: 'wanderer', label: 'Wanderer' }],
};
let bad = [], spread = new Set();
for (let titles = 0; titles <= 14; titles += 2) {
  for (let n = 0; n <= 1600; n += 40) {
    const j = S.boot('dbo_journal');
    const p = Object.assign({}, base, { backstory: 'A smith from Bruma. '.repeat(Math.max(1, n / 20)), titles: base.titles.concat(Array.from({ length: titles }, (_, i) => ({ id: 't' + i, label: 'Title ' + i }))) });
    j.push(hub(p));
    const fc = j.root.dboPanel.body.flowClip;
    const o = orphans(fc, j.ctx);
    if (o.length) bad.push(`titles ${titles}, story ${n}: ${o.join('; ')}`);
    spread.add(where(fc, j.ctx, 'Backstory'));
  }
}
check('the sweep moves the Backstory heading across pages (the test reaches page feet)', spread.size >= 2, [...spread]);
check('no Profile page ends on a heading, for any backstory length', bad.length === 0, bad.slice(0, 4));

T.done();
