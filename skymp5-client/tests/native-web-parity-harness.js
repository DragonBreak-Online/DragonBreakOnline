// Native panels against their web versions (Nat, 3 Nov: "exactly like the web version"): the actions, order and wording
// the survey found missing natively (_work/native-panels-1103/NOTE.md), one block per panel.
//   node tests/native-web-parity-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const flowRoot = (t) => t.root.dboPanel.body.flowClip;
const shownPage = (t) => Object.keys(flowRoot(t).kids).map((k) => flowRoot(t)[k]).find((p) => p._visible);
const buttonsOf = (t) => { const out = []; const walk = (c) => { for (const k of Object.keys(c.kids)) { const x = c.kids[k]; if (x.kids && x.label && x.onPick) out.push(x); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out; };
const btn = (t, label) => buttonsOf(t).find((b) => b.label.text === label);
const texts = (t) => { const out = []; const walk = (c) => { for (const k of Object.keys(c.kids)) { const x = c.kids[k]; if (typeof x.text === 'string' && !x.kids) out.push(x.text); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out; };

// ---- Journal, Notes (features/journal/tabs/NotesTab.tsx) ----
{
  const TABS = [{ id: 'profile', label: 'Profile' }, { id: 'notes', label: 'Notes' }, { id: 'settings', label: 'Settings', pinned: true }];
  const hub = (nonce, notes) => ({ type: 'journal', id: 50, nonce, hub: 1, tabs: TABS, tab: 'notes', opened: 1,
    clock: { date: 'Morndas', time: '14:05', moons: '' }, head: { name: 'Olaf', title: 'Wanderer', race: 'Nord' }, notes });
  const limits = { entryMax: 4000, titleMax: 60, entriesMax: 50, foldersMax: 8, folderNameMax: 24, receivedMax: 20 };
  const base = { ready: true, limits, folders: [], entries: [{ id: 'e1', folder: '', title: 'The pass', at: 1790000000000, edited: 0, length: 18 }],
    received: [], carried: [{ id: 'w1', title: 'An unsent letter', itemKind: 'Letter', author: 'Olaf', kept: false }], write: { on: false } };
  const t = S.boot('dbo_journal');
  t.push(hub('n1', Object.assign({}, base, { open: { kind: 'work', id: 'w1', title: 'An unsent letter', text: 'Dear Gemma.', itemKind: 'Letter', author: 'Olaf', kept: false } })));
  const burn = btn(t, 'Burn it');
  check('a writing you carry can be burned, as on the web (Burn it, then asked)', !!burn && !!btn(t, 'Keep a copy in my journal'), buttonsOf(t).map((b) => b.label.text));
  if (burn) burn.onRelease();
  const sure = btn(t, 'Burn it');
  check('...the question names it and asks for good', /Burn An unsent letter for good\?/.test(texts(t).join('|')) && !!sure, texts(t));
  if (sure) sure.onRelease();
  const last = msgs(t, 'dbo:journalNotes').pop();
  check('...and yes sends burn with the work and yes (journalnotes.js burnOut)', !!last && last.args.join('|') === 'n1|burn|w1|yes', last && last.args);

  t.push(hub('n2', Object.assign({}, base, { open: { kind: 'entry', id: 'e1', title: 'The pass', text: 'Snow to the knees.', at: 1790000000000, folder: '' } })));
  const order = buttonsOf(t).map((b) => b.label.text).filter((l) => l === 'Tear out' || l === 'Edit...');
  check('an entry shows Tear out before Edit, the web order', order.join(',') === 'Tear out,Edit...', order);
  btn(t, 'Edit...').onRelease();
  const tx = texts(t).join('|');
  check('the editor counts Title and Page as typed (n / max), as the web does', /Title {2}\(8 \/ 60\)/.test(tx) && /Page {2}\(18 \/ 4000\)/.test(tx), tx);
}

T.done();
