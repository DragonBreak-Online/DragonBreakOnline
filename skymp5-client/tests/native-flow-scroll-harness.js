// A flow text taller than a page scrolls in its own box (swf/lib/dbo-flow.as flowScrollText), checked on the Character
// Journal's Notes page (sunk_turtle, 3 Nov: a long personal journal entry ran off the panel with no way to read the rest).
//   node tests/native-flow-scroll-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const TABS = [{ id: 'profile', label: 'Profile' }, { id: 'notes', label: 'Notes' }, { id: 'settings', label: 'Settings', pinned: true }];
const hub = (extra) => Object.assign({ type: 'journal', id: 50, nonce: 'n1', hub: 1, tabs: TABS, tab: 'notes', opened: 1,
  clock: { date: 'Morndas, 26th of Frostfall', time: '14:05', moons: 'Masser full' }, head: { name: 'Olaf', title: 'Wanderer', race: 'Nord' } }, extra || {});
const limits = { entryMax: 4000, titleMax: 60, entriesMax: 50, foldersMax: 8, folderNameMax: 24, receivedMax: 20 };
const notes = (text) => ({ ready: true, limits, folders: [], entries: [{ id: 'e1', folder: '', title: 'The pass', at: 1790000000000, edited: 0, length: text.length }],
  received: [], carried: [], write: { on: false }, open: { kind: 'entry', id: 'e1', title: 'The pass', text, at: 1790000000000, folder: '' } });

const BODY_H = 410;
const flowRoot = (t) => t.root.dboPanel.body.flowClip;
const pages = (t) => Object.keys(flowRoot(t).kids).map((k) => flowRoot(t)[k]);
// every clip under the flow, with its page
const walk = (c, out, page) => { for (const k of Object.keys(c.kids)) { const x = c.kids[k]; out.push({ x, page }); if (x.kids) walk(x, out, page); } return out; };
const all = (t) => pages(t).reduce((out, p) => walk(p, out, p), []);
const boxes = (t) => all(t).filter((e) => e.x.bar && e.x.inner).map((e) => e.x);
const buttonLabels = (t) => all(t).filter((e) => e.x.label && e.x.onPick).map((e) => e.x.label.text);

// A long entry: 4000 characters in paragraphs, as the server allows (journalnotes.js entryMax)
const para = 'The wind came down off the pass and we walked into it all morning, the mule complaining at every switchback. ';
let long = '';
for (let i = 0; long.length < 3900; i++) long += para + (i % 3 === 2 ? '\n\n' : '');
long = long.slice(0, 4000);

{
  const t = S.boot('dbo_journal');
  t.push(hub({ notes: notes(long) }));
  const b = boxes(t);
  const box = b[0];
  check('a page longer than the panel scrolls in one box', b.length === 1, b.length);
  check('...the box holds the whole text', !!box && box.inner.t.text === long, box ? box.inner.t.text.length : null);
  check('...masked to the box, which ends inside the page', !!box && box.inner._mask === box.mask && box._y + box.bar.trackH <= BODY_H, box ? [box._y, box.bar.trackH] : null);
  check('...with a scroll bar shown, more lines than fit', !!box && box.bar._visible && box.bar.total > box.bar.visible && box.bar.visible > 3, box ? [box.bar.total, box.bar.visible] : null);
  const unit = box ? box.bar.unit : 0;
  t.wheel(-1);
  check('the wheel down scrolls the text by a line', !!box && box.bar.offset === 1 && box.inner._y === -unit, box ? [box.bar.offset, box.inner._y] : null);
  for (let i = 0; i < 500; i++) t.wheel(-1);
  const max = box ? box.bar.total - box.bar.visible : 0;
  check('...and stops at the last line', !!box && box.bar.offset === max && box.inner._y === -max * unit, box ? [box.bar.offset, max] : null);
  for (let i = 0; i < 500; i++) t.wheel(1);
  check('the wheel up comes back to the top and no further', !!box && box.bar.offset === 0 && box.inner._y === 0, box ? [box.bar.offset, box.inner._y] : null);
  const labels = buttonLabels(t);
  check('the page keeps its actions (Back, Edit, Tear out)', ['Back to the list', 'Edit...', 'Tear out'].every((l) => labels.indexOf(l) >= 0), labels);
}

{
  const t = S.boot('dbo_journal');
  t.push(hub({ notes: notes('Snow to the knees.') }));
  check('a short page is plain text, with no box and no bar', boxes(t).length === 0 && all(t).some((e) => e.x.text === 'Snow to the knees.'), boxes(t).length);
}

T.done();
