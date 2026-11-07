// The native journal's What's new tab (swf/dbo_journal/tabs/news.as; server whatsnew.js, Nat 7 Nov): the patch notes a page
// at a time, the unread line, Newer and Older asking the server for another page, a full 12,000 character page drawn on the
// shell's own pages, and the client naming the tab (native:journalTab:news). The mutants at the end must each fail.
//   node tests/native-journal-news-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./native-swf-stub');
const T = S.checker();

const TABS = [{ id: 'profile', label: 'Profile' }, { id: 'news', label: "What's new", badge: '3' }, { id: 'settings', label: 'Settings', pinned: true }];
const hub = (news) => ({ type: 'journal', id: 50, nonce: 'n1', hub: 1, tabs: TABS, tab: 'news', opened: 1,
  clock: { date: 'Morndas, 26th of Frostfall', time: '14:05', moons: 'Masser full' }, head: { name: 'Olaf', title: 'Wanderer', race: 'Nord' }, news });
const entry = (i, n, len) => ({ date: `2026-11-0${(i % 9) + 1}`, title: `Fix number ${i}`, tag: i ? 'Fix' : 'New Feature',
  sections: [{ heading: 'Faith', items: Array.from({ length: n || 2 }, (_, k) => (len ? 'The pass was cold and the mule complained. '.repeat(Math.ceil(len / 44)).slice(0, len) : `Item ${i}.${k}.`)) }] });

const flowRoot = (t) => t.root.dboPanel.body.flowClip;
const walk = (c, out) => { for (const k of Object.keys(c.kids || {})) { const x = c.kids[k]; out.push(x); if (x.kids) walk(x, out); } return out; };
const all = (t) => walk(flowRoot(t), []);
const texts = (t) => all(t).filter((x) => typeof x.text === 'string').map((x) => x.text).join('|');
const buttons = (t) => all(t).filter((x) => x.label && x.onPick);
const btn = (t, label) => buttons(t).find((b) => b.label.text === label || b.label.text === label.toUpperCase());
const sentTabs = (t) => t.msgs().filter((m) => m.key === 'dbo:journalTab').map((m) => m.args);

const behaviour = (boot, c) => {
  const t = boot();
  t.push(hub({ entries: [entry(0), entry(1)], page: 0, pages: 3, total: 12, unread: 3 }));
  const x = texts(t);
  c('each entry: title, date in words, tag, heading and items', /Fix number 0/.test(x) && /1 November 2026/.test(x) && /New Feature/.test(x) && /Faith/.test(x) && /Item 1\.1\./.test(x), x.slice(0, 300));
  c('the unread line counts the new notes', /3 notes are new since you last looked/.test(x));
  c('...and says where it is among the pages', /Page 1 of 3 of the notes/.test(x));
  const newer = btn(t, 'Newer'), older = btn(t, 'Older');
  c('Newer is greyed on the first page, Older is not', !!newer && !!older && newer.disabled === true && older.disabled !== true);
  if (older) older.onRelease();
  const asked = sentTabs(t).pop();
  c('Older asks the server for page 2 (journalTab focus {page: 1})', !!asked && asked[0] === 'n1' && asked[1] === 'news' && asked[2] && asked[2].page === 1, asked);
  t.push(hub({ entries: [entry(9)], page: 2, pages: 3, total: 12, unread: 0 }));
  c('on the last page Older is greyed and Newer is not', btn(t, 'Older') && btn(t, 'Older').disabled === true && btn(t, 'Newer').disabled !== true);
  c('...and no unread line once read', !/new since you last looked/.test(texts(t)));
  t.push(hub({ entries: [entry(0)], page: 0, pages: 1, total: 1, unread: 1 }));
  c('one page has no pager, and one new note says so', !btn(t, 'Older') && /One note is new since you last looked/.test(texts(t)));
  // a page at the server's cap: 5 entries of 4 items of 590 characters (12,000 with the JSON around them)
  const big = { entries: [0, 1, 2, 3, 4].map((i) => entry(i, 4, 590)), page: 0, pages: 90, total: 446, unread: 0 };
  let threw = null; try { t.push(hub(big)); } catch (e) { threw = e.message; }
  const pages = Object.keys(flowRoot(t).kids).length;
  c(`a full page (${JSON.stringify(big.entries).length} characters) draws on the shell's own pages`, !threw && pages > 1 && /Fix number 4/.test(texts(t)), threw || pages);
};
behaviour(() => S.boot('dbo_journal'), T.check);

const sm = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'services', 'services', 'scaleformMenu.ts'), 'utf8');
T.check('the client names the tab (native:journalTab:news)', /export const JOURNAL_TABS = \[[^\]]*"news"/.test(sm));
const lib = fs.readFileSync(path.resolve(__dirname, '..', 'swf', 'dbo_journal', 'lib.txt'), 'utf8');
T.check('...and the journal swf carries tabs/news.as', /tabs\/news\.as/.test(lib));

// The mutants change tabs/news.as as the stub reads it
const read0 = fs.readFileSync;
const NEWS = path.resolve(__dirname, '..', 'swf', 'dbo_journal', 'tabs', 'news.as');
const MUTANTS = [
  ['Older asks for the same page', '{page: page + 1}', '{page: page}'],
  ['no pager', '   if (pages > 1)\n   {\n      flowHint("Page', '   if (false)\n   {\n      flowHint("Page'],
  ['the ends never greyed', 'ctx.busy || page >= pages - 1', 'ctx.busy'],
];
for (const [name, a, b] of MUTANTS) {
  const src = read0(NEWS, 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(a)) { T.check(`mutant "${name}": its text is in news.as`, false, a); continue; }
  fs.readFileSync = function (f, ...rest) { return /tabs[\\/]news\.as$/.test(String(f)) ? src.split(a).join(b) : read0.call(fs, f, ...rest); };
  let bad = 0;
  try { behaviour(() => S.boot('dbo_journal'), (w, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  fs.readFileSync = read0;
  T.check(`mutant caught: ${name}`, bad > 0);
}
T.done();
