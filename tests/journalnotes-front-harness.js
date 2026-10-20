// The F3 journal's Personal Journal tab (skymp5-front tabs/NotesTab.tsx, server journalnotes.js): renders the real journal
// with React's static renderer for the sections journalnotes.js sends. The HUD names the tab, the list carries titles and
// folders, an open entry shows its text and the write-out row (off away from a desk, a kind without blanks or paper
// disabled), a carried work offers Keep, a received one Remove, and the first draw says the page is on its way.
//
//   node tests/journalnotes-front-harness.js <bundle of skymp5-front/src/features/journal/index.tsx>
'use strict';
const fs = require('fs');

const bundle = process.argv[2];
if (!bundle) { console.log('usage: node tests/journalnotes-front-harness.js <bundle>'); process.exit(2); }
const SRC = fs.readFileSync(bundle, 'utf8');
if (!/jnotes__row/.test(SRC)) {
  require('./expect')('journalnotes-front', 'this front has no Personal Journal tab');
  console.log('ok   skipped: this front has no Personal Journal tab');
  process.exit(0);
}
const J = require(bundle);
const { Widget: Journal, renderToStaticMarkup, createElement } = J;

let failures = 0;
const check = (label, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!ok) failures++; };
const render = (data) => renderToStaticMarkup(createElement(Journal, { data }));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
const hub = (notes) => ({ type: 'journal', id: 50, nonce: 'n1', hub: 1, tab: 'notes', opened: 1,
  tabs: [{ id: 'profile', label: 'Profile' }, { id: 'notes', label: 'Personal Journal' }, { id: 'stats', label: 'Stats' }],
  head: { name: 'Lydia', title: 'Adept Knight', race: 'Nord' }, clock: { date: '1st of Frostfall, 4E 211', time: '9:00 in the morning' }, notes });
const limits = { entryMax: 4000, titleMax: 60, entriesMax: 200, foldersMax: 20, folderNameMax: 30, receivedMax: 100 };
const kinds = (free, paper) => ['Note', 'Letter', 'Book', 'Journal'].map((label, i) => ({ id: label.toLowerCase(), label, paper: [1, 3, 10, 20][i], free }));
const base = (extra) => Object.assign({
  ready: true, limits,
  folders: [{ id: 'f1', name: 'Bounties', count: 1 }],
  entries: [{ id: 'e1', folder: 'f1', title: 'Wanted: a Khajiit', at: 1_900_000_000_000, edited: 0, length: 40 }, { id: 'e2', folder: '', title: 'Shopping', at: 1_900_000_000_000, edited: 0, length: 5 }],
  received: [], carried: [], open: null, write: { on: true, atDesk: false, requireDesk: true, paper: 4, kinds: kinds(5) },
}, extra || {});

check('the HUD announces the tab (journalTab:notes)', J.journalCaps().includes('journalTab:notes'), J.journalCaps());

let t = text(render(hub({ ready: false, limits })));
check('the first draw says the page is on its way', /Turning the page/.test(t), t.slice(0, 300));

const listHtml = render(hub(base()));
t = text(listHtml);
check('the tab is drawn with its label', /Personal Journal/.test(t));
check('the list shows every entry, the folder and counts', /All entries \(2\)/.test(t) && /Bounties \(1\)/.test(t) && /Wanted: a Khajiit/.test(t) && /Shopping/.test(t) && /Received \(0\)/.test(t), t.slice(0, 600));
check('...no text of any entry is drawn in the list', !/Strong\. Dwarven/.test(t));
check('...nothing open: a hint, a New entry button, the folder maker', /Choose a page on the left/.test(t) && /New entry/.test(t) && /New folder/.test(listHtml));
check('...no Writings you carry without any', !/Writings you carry/.test(t));

const entry = { kind: 'entry', id: 'e1', folder: 'f1', title: 'Wanted: a Khajiit', text: 'Strong. Dwarven armor.\nSeen near the eastern gate.', at: 1_900_000_000_000, edited: 0 };
let html = render(hub(base({ open: entry })));
t = text(html);
check('an open entry shows its title, folder and text', /Wanted: a Khajiit/.test(t) && /Bounties · Written/.test(t) && /Seen near the eastern gate/.test(t), t.slice(0, 800));
check('...with Edit and Tear out', /Edit/.test(t) && /Tear out/.test(t));
check('...away from a desk the write-out row says where to go, its kinds disabled', /Sit at a writing desk/.test(t) && (html.match(/<button[^>]*disabled=""[^>]*>Note \(1 paper\)/g) || []).length === 1, html.match(/<button[^>]*>Note[^<]*/g));
html = render(hub(base({ open: entry, write: { on: true, atDesk: true, requireDesk: true, paper: 4, kinds: kinds(5).map((k) => (k.id === 'letter' ? Object.assign({}, k, { free: 0 }) : k)) } })));
const btn = (label) => (html.match(new RegExp(`<button[^>]*>${label} \\(\\d+ paper\\)`)) || [''])[0];
check('at a desk: a note can be written', !/disabled/.test(btn('Note')), btn('Note'));
check('...a letter with no blanks left cannot', /disabled/.test(btn('Letter')), btn('Letter'));
check('...a book needs more paper than carried', /disabled/.test(btn('Book')), btn('Book'));
check('...the paper carried is said, and Signed is the default', /You carry 4 paper/.test(text(html)) && /Signed with your name/.test(text(html)));
t = text(render(hub(base({ open: entry, write: { on: false, atDesk: true, requireDesk: true, paper: 4, kinds: kinds(5) } }))));
check('writing out switched off: no write-out row', !/Write it out/.test(t));

const carried = [{ id: 'W1', title: 'A letter to Hadvar', author: 'Lydia', itemKind: 'Letter', kept: false }];
t = text(render(hub(base({ carried, open: { kind: 'work', id: 'W1', title: 'A letter to Hadvar', text: 'Meet me at the inn.', author: 'Lydia', itemKind: 'Letter', at: 1, kept: false } }))));
check('a carried work shows its author and Keep a copy', /Writings you carry \(1\)/.test(t) && /Letter · Lydia/.test(t) && /Meet me at the inn/.test(t) && /Keep a copy in my journal/.test(t), t.slice(0, 900));
t = text(render(hub(base({ carried: [Object.assign({}, carried[0], { kept: true })], open: { kind: 'work', id: 'W1', title: 'A letter to Hadvar', text: 'x', author: 'Unsigned', itemKind: 'Letter', at: 1, kept: true } }))));
check('...kept already: it says where the copy is', /under Received/.test(t) && !/Keep a copy in my journal/.test(t) && /Unsigned/.test(t));
html = render(hub(base({ received: [{ id: 'r1', title: 'A letter to Hadvar', author: 'Lydia', itemKind: 'Letter', at: 1 }],
  open: { kind: 'received', id: 'r1', title: 'A letter to Hadvar', text: 'Meet me at the inn.', author: 'Lydia', itemKind: 'Letter', at: 1 } })));
t = text(html);
check('a received writing can be removed, never edited, and counts in the list', /Remove from my journal/.test(t) && /Received \(1\)/.test(t) && !/>Edit</.test(html), t.slice(0, 900));

console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
