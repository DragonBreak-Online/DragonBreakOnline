// The Character Journal's last hand-offs as forms (swf/dbo_journal): a bounty, a friend's referral code and copying the link,
// a character looked up by staff, a notes entry written or changed and the folders, and the Thalmor's dossiers and notes.
// Each sends the browser tab's own action; nothing in the journal opens the browser any more.
//   node tests/native-journal-typed-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const held = (t) => t.sent.reduce((n, m) => n + (m.e === 'allowTextInput' ? (m.on ? 1 : -1) : 0), 0);

const hub = (tab, extra) => Object.assign({ type: 'journal', id: 50, nonce: 'n1', hub: 1, tabs: [{ id: 'stats', label: 'Stats' }, { id: tab, label: tab }], tab, opened: 1, clock: { date: 'd', time: 't' }, head: { name: 'Olaf', title: 'J', race: 'N' } }, extra || {});
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const last = (t, key) => msgs(t, key).slice(-1)[0];
const P = (t) => t.root.dboPanel;
const shownPage = (t) => Object.values(P(t).body.flowClip.kids).find((p) => p._visible);
const texts = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (typeof x.text === 'string' && !x.kids) out.push(x.text); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out.join('|'); };
const buttonsOf = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (x.kids && x.label && x.onPick) out.push(x); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out; };
const btn = (t, label) => buttonsOf(t).find((b) => b.label.text === label);
const seek = (t, label) => { let b = btn(t, label); if (b) return b; for (let i = 0; i < 6; i++) t.press(33); for (let i = 0; i < 8 && !(b = btn(t, label)); i++) { const n = P(t).foot.next; if (!n || n.disabled) break; n.onRelease(); } return b; };
const press = (t, label) => { const b = seek(t, label); if (!b) throw new Error('no button ' + label + ' among ' + buttonsOf(t).map((x) => x.label.text).join('|')); b.onRelease(); };
const boxOf = (t) => { let f = null; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.type === 'input') f = k; if (k.kids) walk(k); } }; walk(shownPage(t)); return f; };
const field = (t, label) => { for (let i = 0; i < 6; i++) t.press(33); for (let i = 0; i < 6; i++) { const r = buttonsOf(t).find((b) => b.label.text === 'Type...' && b._parent.label && (b._parent.label.text === label || b._parent.label.text.indexOf(label + ',') === 0 || b._parent.label.text.indexOf(label + '  (') === 0)); if (r) return r; const n = P(t).foot.next; if (!n || n.disabled) break; n.onRelease(); } return null; };
const typeOn = (t, label, text, keepOpen) => { const r = field(t, label); if (!r) throw new Error('no field ' + label); r.onRelease(); boxOf(t).text = text; if (!keepOpen) t.press(13); };
const noHandoff = (t) => !msgs(t, 'dbo:journalTab').some((m) => m.args[3] === 'browser');

// no tab hands its typing to the browser any more: the source says so. Settings opens the overlay's own sections (this
// PC's settings, kept by the browser page) there, which is no typing
{
  const dir = path.resolve(__dirname, '..', 'swf/dbo_journal/tabs');
  const left = fs.readdirSync(dir).filter((f) => f !== 'settings.as' && /ctx\.browser\(/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  check('no journal tab calls ctx.browser any more', left.length === 0, left);
}

// ---- a bounty ----
{
  const wanted = { hold: { id: 'bruma', name: 'Bruma' }, mine: [], wanted: [], canDeclare: true, max: 5000, goldPerMinute: 10 };
  const t = S.boot('dbo_journal');
  t.push(hub('wanted', { wanted }));
  press(t, 'Set a bounty...');
  check('Set a bounty: who, the gold (up to the most) and the reason; Set waits for all three', /Set a bounty in Bruma/.test(texts(t)) && btn(t, 'Set bounty').disabled === true && noHandoff(t));
  typeOn(t, 'Who', 'Bram'); typeOn(t, 'Gold', '200');
  check('a bounty needs its reason', btn(t, 'Set bounty').disabled === true);
  typeOn(t, 'Gold', '5001'); typeOn(t, 'Reason', 'murder');
  check('more than the most is refused', btn(t, 'Set bounty').disabled === true);
  typeOn(t, 'Gold', '0');
  check('nothing at all is refused', btn(t, 'Set bounty').disabled === true);
  typeOn(t, 'Gold', '200');
  press(t, 'Set bounty');
  check('Set bounty asks first, naming the gold and the outlaw', /Put 200 gold on Bram\?/.test(texts(t)) && !msgs(t, 'dbo:outlawJ').length);
  press(t, 'Set bounty');
  check('...then sends outlawJ set with the name, the gold and the reason', last(t, 'dbo:outlawJ').args.join('|') === 'n1|set|Bram|200|murder' && typeof last(t, 'dbo:outlawJ').args[3] === 'number');
}

// ---- referrals ----
{
  const ref = { link: 'https://dragonbreakonline.com/r/ABCD1234', code: 'ABCD1234', counted: 0, friends: [], queue: [], waitingBehind: false, carry: false, carryLive: false, canEnter: true, referredBy: null,
    rules: { qualifyHours: 10, qualifyDays: 3, boostHours: 20, firstMult: 1.5, laterMult: 1.25, welcomeMult: 1.2, queueCap: 3, carryWeight: 50, commandWindowHours: 24 } };
  const t = S.boot('dbo_journal');
  t.push(hub('referrals', { referrals: ref }));
  check('without a clipboard the link and code are shown to give, with no Copy', !seek(t, 'Copy the link') && /Give a friend the link or the code above\./.test(texts(t)));
  press(t, 'Enter a code...');
  const f = field(t, 'Their code'); f.onRelease();
  check('the code box takes letters and numbers, eight of them', boxOf(t).restrict === 'A-Za-z0-9' && boxOf(t).maxChars === 8 && held(t) === 1);
  boxOf(t).text = 'abc1234'; t.press(13);
  check('seven are not a code', btn(t, 'Enter code').disabled === true && noHandoff(t));
  typeOn(t, 'Their code', 'abcd5678');
  press(t, 'Enter code');
  check('Enter code sends referralCode in capitals', last(t, 'dbo:referralCode').args.join('|') === 'n1|ABCD5678');
  const copied = [];
  const c = S.boot('dbo_journal');
  c.ctx._global.System = { setClipboard: (x) => copied.push(x) };
  c.push(hub('referrals', { referrals: ref }));
  press(c, 'Copy the link');
  check('with a clipboard, Copy puts the link on it and says so', copied.join('') === ref.link && /Sent to the clipboard/.test(texts(c)));
}

// ---- the staff look-up ----
{
  const cit = { holds: [], maxHolds: 2, cooldownUntil: 0, requests: [], invites: [], elections: [], manage: [], staff: [], lookup: null };
  const t = S.boot('dbo_journal');
  t.push(hub('citizen', { citizen: cit }));
  press(t, 'Look up a character...');
  check('Look up a character is a form, Look up waits for a name', /Look up a character/.test(texts(t)) && btn(t, 'Look up').disabled === true && noHandoff(t));
  typeOn(t, 'Who', ' Gemma ');
  press(t, 'Look up');
  check('...and sends citizenJ lookup with the name, trimmed', last(t, 'dbo:citizenJ').args.join('|') === 'n1|lookup||Gemma');
}

// ---- notes ----
{
  const limits = { entryMax: 4000, titleMax: 60, entriesMax: 50, foldersMax: 2, folderNameMax: 24, receivedMax: 20 };
  const base = { ready: true, limits, folders: [{ id: 'f1', name: 'Travels', count: 1 }], entries: [{ id: 'e1', folder: 'f1', title: 'The pass', at: 1790000000000, edited: 0, length: 40 }],
    received: [], carried: [], open: null, write: null };
  const t = S.boot('dbo_journal');
  t.push(hub('notes', { notes: base }));
  press(t, 'New entry...');
  check('New entry: a title, a page and a folder (None chosen); Save waits for a page', /A new entry/.test(texts(t)) && btn(t, 'None')._alpha === 100 && btn(t, 'Save').disabled === true && noHandoff(t));
  field(t, 'Page').onRelease();
  check('the page is a box of several lines, its length the server\'s', boxOf(t).multiline === true && boxOf(t).maxChars === 4000);
  boxOf(t).text = 'First line\rSecond line';
  t.press(13);
  check('Enter in a page is a new line, not the end of typing', !!boxOf(t) && held(t) === 1);
  press(t, 'Done');
  check('Done takes it, its lines kept, and gives the keys back', held(t) === 0 && btn(t, 'Save').disabled !== true);
  typeOn(t, 'Title', 'Two lines');
  press(t, 'Travels');
  press(t, 'Save');
  check('Save sends a new entry: no id, the folder, the title and the page with its line', last(t, 'dbo:journalNotes').args.join('|') === 'n1|save||f1|Two lines|First line\nSecond line', last(t, 'dbo:journalNotes'));
  t.push(hub('notes', { nonce: 'n2', notes: Object.assign({}, base, { open: { kind: 'entry', id: 'e1', title: 'The pass', text: 'Snow to the knees.', at: 1790000000000, folder: 'f1' } }) }));
  press(t, 'Edit...');
  check('Edit opens with the entry in it, its folder chosen', /Change The pass/.test(texts(t)) && /Snow to the knees\./.test(texts(t)) && btn(t, 'Travels')._alpha === 100);
  typeOn(t, 'Page', 'Snow to the waist.', true); press(t, 'Done');
  press(t, 'Save');
  check('...and Save sends its id', last(t, 'dbo:journalNotes').args.join('|') === 'n2|save|e1|f1|The pass|Snow to the waist.');
  t.push(hub('notes', { nonce: 'n3', notes: base }));
  press(t, 'Folders...');
  check('Folders with no folder looked at: a new one, and how to rename', /Look at a folder to rename it/.test(texts(t)) && btn(t, 'Make').disabled === true);
  typeOn(t, 'A new folder', 'Dreams'); press(t, 'Make');
  check('Make sends folderAdd', last(t, 'dbo:journalNotes').args.join('|') === 'n3|folderAdd|Dreams');
  t.push(hub('notes', { nonce: 'n4', notes: base }));
  press(t, 'Travels (1)');
  press(t, 'New entry...');
  check('a new entry starts in the folder being looked at', btn(t, 'Travels')._alpha === 100);
  press(t, 'Cancel');
  press(t, 'Folders...');
  typeOn(t, 'Rename Travels', 'Roads'); press(t, 'Rename');
  check('a folder looked at can be renamed', last(t, 'dbo:journalNotes').args.join('|') === 'n4|folderRename|f1|Roads');
  const full = Object.assign({}, base, { folders: [{ id: 'f1', name: 'Travels', count: 1 }, { id: 'f2', name: 'Dreams', count: 0 }] });
  t.push(hub('notes', { nonce: 'n5', notes: full }));
  press(t, 'Folders...');
  check('at the most folders, no new one', !field(t, 'A new folder') && /You keep 2 folders at most\./.test(texts(t)));
}

// ---- the Thalmor ----
{
  const thal = { rank: 'Justiciar', canRead: true, canWrite: true, canArrest: false, concordat: { on: false },
    reports: [], dossiers: [{ key: 'k1', name: 'Bram', tag: 'BRAM', updated: 0, notes: [] }], limits: { noteMax: 300, notesPer: 20 } };
  const t = S.boot('dbo_journal');
  t.push(hub('thalmor', { thalmor: thal }));
  press(t, 'Dossiers (1)');
  press(t, 'A new dossier...');
  check('A new dossier: a name and the first note, both needed', /A new dossier/.test(texts(t)) && btn(t, 'Write it down').disabled === true && noHandoff(t));
  typeOn(t, 'The first note', 'Prays at night.', true); press(t, 'Done');
  check('...a note without a name is not enough', btn(t, 'Write it down').disabled === true);
  typeOn(t, 'Name or #TAG', '#GEMA');
  press(t, 'Write it down');
  check('Write it down sends thalmorNote with the name and the note', last(t, 'dbo:thalmorNote').args.join('|') === 'n1|#GEMA|Prays at night.');
  t.push(hub('thalmor', { nonce: 'n2', thalmor: thal }));
  press(t, 'Dossiers (1)');
  press(t, 'Bram #BRAM (0)');
  press(t, 'A note on Bram...');
  check('a note needs its text', btn(t, 'Write it down').disabled === true);
  field(t, 'The note').onRelease();
  check('a note on a dossier: no name asked, the box holds the server\'s limit', !field(t, 'Name or #TAG') && boxOf(t).maxChars === 300 && boxOf(t).multiline === true);
  boxOf(t).text = 'Seen at the shrine again.'; press(t, 'Done');
  press(t, 'Write it down');
  check('...and sends the dossier\'s key', last(t, 'dbo:thalmorNote').args.join('|') === 'n2|k1|Seen at the shrine again.');
}

T.done();
