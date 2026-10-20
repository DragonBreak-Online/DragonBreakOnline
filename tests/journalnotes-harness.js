// Scripted test for the F3 journal's Personal Journal tab (journalnotes.js) with the real journal.js: who sees the tab,
// entries and folders and their limits, the files on disk, writing an entry out as an item at a desk (the pool of blank
// records, paper, the prose filter, the registry), and a receiver reading the work and keeping a copy. Run it from this
// folder's parent:
//
//   node tests/journalnotes-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
process.chdir(root);
if (!fs.existsSync('journalnotes.js')) {
  require('./expect')('journalnotes', 'journalnotes.js is missing');
  console.log('ok   skipped: no journalnotes.js on this line');
  process.exit(0);
}
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`); if (!ok) failures++; };
const tick = () => new Promise((r) => setTimeout(r, 30));

const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-jnotes-'));
const BASES = path.join(TMP, 'written-bases.json');
const REG = path.join(TMP, 'journal', 'written.json');
const NOTES = path.join(TMP, 'journal', 'notes');

// ---- a fake world: an author, a reader, a staff member ----
const AUTHOR = 0xff000030, READER = 0xff000031, STAFF = 0xff000032;
const DESK = 0x0005a1b2;
const PAPER = 0x0807cba1;
const props = new Map();
const setp = (a, k, v) => props.set(`${a >>> 0}|${k}`, v);
const getp = (a, k) => props.get(`${a >>> 0}|${k}`);
for (const [a, name] of [[AUTHOR, 'Lydia'], [READER, 'Hadvar'], [STAFF, 'Kodlak']]) {
  setp(a, 'appearance', { name, raceId: 0x13746 });
  setp(a, 'private.mastery', { skills: {} });
  setp(a, 'inventory', { entries: [] });
}
const keys = new Map([[AUTHOR, 'aaaaaaaaaaaaaaaa'], [READER, 'bbbbbbbbbbbbbbbb'], [STAFF, 'cccccccccccccccc']]);
const dist = new Map();
const caps = new Set(['journal', 'journalHub', 'journalTab:notes']);
const widgets = [], told = [], audits = [];
const ui = new Map();

const idOf = (desc) => {
  const [hex, plugin] = String(desc).split(':');
  const n = parseInt(hex, 16);
  if (plugin === 'BSHeartland.esm') return (0x08000000 + n) >>> 0;
  if (plugin === 'Test.esp') return (0x05000000 + n) >>> 0;
  throw new Error('unknown plugin');
};
const mp = {
  get: (a, k) => getp(a, k),
  set: (a, k, v) => { if (getp(a, 'failSet') && k === 'inventory') throw new Error('refused'); setp(a, k, v); },
  getIdFromDesc: idOf,
  lookupEspmRecordById: (id) => ((id >>> 24) === 0x05 ? { record: { type: (id & 0xff) === 0x99 ? 'MISC' : 'BOOK', editorId: 'x' } } : id === 0x13746 ? { record: { editorId: 'NordRace' } } : null),
};
globalThis.__dboJournalDoc = { of: () => ({}), touch: () => {}, keyOf: (a) => keys.get(a >>> 0) || null };
globalThis.__dboStatsData = () => ({ since: 0, playMs: 0, sessions: 0, distanceUnits: 0 });
globalThis.__dboClock = { summary: () => ({ hour: 12, day: 1, month: 'Morning Star', year: 211, phaseName: '' }) };
globalThis.__dboCombatAt = new Map();
globalThis.__dboProseProblem = (t) => (/\bslurword\b/i.test(String(t)) ? 'slurword' : null);

const cfg = {
  journal: { saveEveryMs: 0 },
  journalNotes: { dir: NOTES, entriesMax: 3, foldersMax: 2, entryMax: 50, titleMax: 20, receivedMax: 5,
    write: { basesFile: BASES, registry: REG, deskMeters: 3 } },
};
const skillsDef = JSON.parse(fs.readFileSync('skills.json', 'utf8')).skills;
const common = { mp, log: () => {}, display: (a) => `#${(a >>> 0).toString(16)}`, nameOf: (a) => ((getp(a, 'appearance') || {}).name || ''),
  personal: (a, t) => told.push([a >>> 0, t]), onUi: (ev, fn) => { const l = ui.get(ev) || []; l.push(fn); ui.set(ev, l); }, cfg };
const load = (fresh) => {
  if (fresh) { delete globalThis.__dboJournal; delete globalThis.__dboJournalSections; delete globalThis.__dboJournalNotes; }
  ui.clear();
  for (const f of ['journal.js', 'journalnotes.js']) delete require.cache[path.resolve(f)];
  require(path.resolve('journal.js'))(Object.assign({}, common, {
    openWidget: (a, w, focus) => widgets.push({ a: a >>> 0, w, focus }), closeWidget: () => {}, sendPacket: () => {},
    every: () => {}, onlineActors: () => [AUTHOR, READER, STAFF], skills: skillsDef, hasCap: (a, cap) => caps.has(cap), isAdmin: (a) => (a >>> 0) === STAFF,
  }));
  return require(path.resolve('journalnotes.js'))(Object.assign({}, common, {
    audit: (t) => audits.push(t), who: (a) => `#${(a >>> 0).toString(16)}`,
    distanceMeters: (a, b) => (dist.has(`${a >>> 0}|${b >>> 0}`) ? dist.get(`${a >>> 0}|${b >>> 0}`) : Infinity),
  }));
};
const fire = (ev, a, args) => { for (const fn of ui.get(ev) || []) fn(a, args, 50); };
const last = (a) => (widgets.filter((x) => x.a === (a >>> 0)).pop() || {}).w;
const notes = (a) => (last(a) || {}).notes;
const act = (a, op, ...rest) => fire('journalNotes', a, [last(a).nonce, op, ...rest]);
const result = (a) => (last(a) || {}).result || '';
const inv = (a) => (getp(a, 'inventory') || {}).entries || [];

(async () => {
  load(true);

  // ---- the tab ----
  check('the tab is registered with its label', !!globalThis.__dboJournalSections.notes && globalThis.__dboJournalSections.notes.label() === 'Personal Journal');
  globalThis.__dboJournalOpenTab(AUTHOR, 'notes');
  let w = last(AUTHOR);
  check('F3 on the tab: listed, and the first draw waits for the file', w && w.tabs.some((t) => t.id === 'notes') && w.notes && w.notes.ready === false, w && w.notes);
  await tick();
  check('...drawn again once the file is read (none yet: empty)', notes(AUTHOR).ready === true && notes(AUTHOR).entries.length === 0 && notes(AUTHOR).folders.length === 0, notes(AUTHOR));
  check('...limits come with it', notes(AUTHOR).limits.entryMax === 50 && notes(AUTHOR).limits.entriesMax === 3);
  globalThis.__dboJournalOpenFor(STAFF, AUTHOR, 'profile');
  check('staff reading another\'s journal never get the tab', !last(STAFF).tabs.some((t) => t.id === 'notes'), last(STAFF).tabs.map((t) => t.id));
  check('...nor its section when asked for it', !('notes' in last(STAFF)) || last(STAFF).notes === null);

  // ---- entries and folders ----
  act(AUTHOR, 'folderAdd', 'Bounties');
  check('a folder is made', notes(AUTHOR).folders.length === 1 && notes(AUTHOR).folders[0].name === 'Bounties' && /made/.test(result(AUTHOR)));
  act(AUTHOR, 'folderAdd', 'bounties');
  check('...a second of the same name is refused', notes(AUTHOR).folders.length === 1 && last(AUTHOR).resultKind === 'refused');
  act(AUTHOR, 'folderAdd', 'Songs');
  act(AUTHOR, 'folderAdd', 'Third');
  check('...foldersMax holds', notes(AUTHOR).folders.length === 2 && /2 folders/.test(result(AUTHOR)), result(AUTHOR));
  const fid = notes(AUTHOR).folders[0].id;
  act(AUTHOR, 'save', '', fid, 'Wanted: a Khajiit', 'Strong. Dwarven armor. Seen near the eastern gate.\u0007 And more text beyond the cap here.');
  let n = notes(AUTHOR);
  check('an entry is written, opened, and the list carries no text', n.entries.length === 1 && n.open && n.open.kind === 'entry' && !('text' in n.entries[0]) && n.entries[0].folder === fid, n);
  check('...the text is cut to entryMax and control characters go', n.open.text.length === 50 && !/\u0007/.test(n.open.text), n.open.text);
  check('...the folder counts it', n.folders.find((f) => f.id === fid).count === 1);
  const eid = n.open.id;
  act(AUTHOR, 'save', eid, fid, 'A very long title that goes past the cap', 'Edited.');
  n = notes(AUTHOR);
  check('an edit keeps the id and cuts the title', n.entries.length === 1 && n.open.id === eid && n.open.text === 'Edited.' && n.open.title.length === 20 && n.open.edited > 0, n.open);
  act(AUTHOR, 'save', eid, 'nofolder', 't', 'x');
  check('...a folder that is gone is refused', last(AUTHOR).resultKind === 'refused' && notes(AUTHOR).open.text === 'Edited.');
  act(AUTHOR, 'save', '', '', 'Two', 'b');
  act(AUTHOR, 'save', '', '', 'Three', 'c');
  act(AUTHOR, 'save', '', '', 'Four', 'd');
  check('entriesMax holds', notes(AUTHOR).entries.length === 3 && /holds 3 entries/.test(result(AUTHOR)), result(AUTHOR));
  const e2 = notes(AUTHOR).entries[1].id;
  act(AUTHOR, 'move', e2, fid);
  check('an entry moves into a folder', notes(AUTHOR).entries[1].folder === fid);
  act(AUTHOR, 'folderRename', fid, 'Wanted');
  check('a folder is renamed', notes(AUTHOR).folders[0].name === 'Wanted');
  act(AUTHOR, 'folderDelete', fid);
  n = notes(AUTHOR);
  check('removing a folder keeps its entries outside any folder', n.folders.length === 1 && n.entries.length === 3 && n.entries.every((e) => e.folder === '') && /2 entries are kept/.test(result(AUTHOR)), result(AUTHOR));
  act(AUTHOR, 'delete', notes(AUTHOR).entries[2].id);
  check('an entry is deleted', notes(AUTHOR).entries.length === 2 && notes(AUTHOR).open === null);
  fire('journalTab', AUTHOR, [last(AUTHOR).nonce, 'notes', { entry: eid }]);
  check('a tab switch with a focus opens that entry', notes(AUTHOR).open && notes(AUTHOR).open.id === eid);
  fire('journalNotes', AUTHOR, ['stale-nonce', 'delete', eid]);
  check('a stale nonce changes nothing', notes(AUTHOR).entries.length === 2);
  act(AUTHOR, 'nonsense');
  check('an unknown op is refused', last(AUTHOR).resultKind === 'refused');
  await tick();
  const file = JSON.parse(fs.readFileSync(path.join(NOTES, 'aaaaaaaaaaaaaaaa.json'), 'utf8'));
  check('the file on disk holds the entries and folders', file.entries.length === 2 && file.folders.length === 1 && file.entries.some((e) => e.text === 'Edited.'), file);
  check('...and no temporary files are left', fs.readdirSync(NOTES).every((f) => !/\.tmp$/.test(f)), fs.readdirSync(NOTES));

  // ---- writing out ----
  act(AUTHOR, 'write', eid, 'note', '1');
  check('writing out away from a desk is refused', /writing desk/.test(result(AUTHOR)) && last(AUTHOR).resultKind === 'refused', result(AUTHOR));
  globalThis.__dboWritingDeskSeen(AUTHOR, DESK);
  dist.set(`${AUTHOR}|${DESK}`, 10);
  act(AUTHOR, 'write', eid, 'note', '1');
  check('...and too far from the desk last used', /writing desk/.test(result(AUTHOR)));
  dist.set(`${AUTHOR}|${DESK}`, 1);
  act(AUTHOR, 'write', eid, 'note', '1');
  check('with no blank records the player is told', /no blank notes/.test(result(AUTHOR)), result(AUTHOR));
  check('...and the tab says how many are free', notes(AUTHOR).write.kinds.find((k) => k.id === 'note').free === 0 && notes(AUTHOR).write.atDesk === true);
  fs.writeFileSync(BASES, JSON.stringify({ note: ['a01:Test.esp', 'a99:Test.esp', 'a02:Test.esp', 'bad'], book: ['b01:Test.esp'] }));
  act(AUTHOR, 'write', eid, 'note', '1');
  check('without paper it is refused', /takes 1 paper; you carry 0/.test(result(AUTHOR)), result(AUTHOR));
  check('...two free notes (a MISC and a bad desc skipped)', notes(AUTHOR).write.kinds.find((k) => k.id === 'note').free === 2, notes(AUTHOR).write.kinds);
  setp(AUTHOR, 'inventory', { entries: [{ baseId: PAPER, count: 4 }, { baseId: 0x12eb7, count: 1 }] });
  act(AUTHOR, 'write', eid, 'book', '');
  check('a book costs 10 paper', /takes 10 paper; you carry 4/.test(result(AUTHOR)), result(AUTHOR));
  act(AUTHOR, 'save', eid, '', 'Rude', 'a slurword here');
  act(AUTHOR, 'write', eid, 'note', '1');
  check('the prose filter guards what others will read', /slurword/.test(result(AUTHOR)) && inv(AUTHOR).find((e) => e.baseId === PAPER).count === 4, result(AUTHOR));
  act(AUTHOR, 'save', eid, '', 'Wanted', 'Seen near the eastern gate.');
  act(AUTHOR, 'write', eid, 'note', '1');
  const work = inv(AUTHOR).find((e) => e.baseId === 0x05000a01);
  check('written out: a signed note, one paper spent, the item named', /signed/.test(result(AUTHOR)) && work && work.count === 1 && work.name === 'Wanted' && inv(AUTHOR).find((e) => e.baseId === PAPER).count === 3, inv(AUTHOR));
  check('...audited', audits.some((t) => /^WRITTEN .* note W1 on a01:Test.esp "Wanted"/.test(t)), audits);
  check('...the author carries it', notes(AUTHOR).carried.length === 1 && notes(AUTHOR).carried[0].author === 'Lydia');
  act(AUTHOR, 'write', eid, 'note', '');
  const work2 = inv(AUTHOR).find((e) => e.baseId === 0x05000a02);
  check('a second note takes the next record, unsigned', work2 && work2.count === 1 && notes(AUTHOR).carried.length === 2 && notes(AUTHOR).carried.find((c) => c.author === 'Unsigned'));
  act(AUTHOR, 'write', eid, 'note', '');
  check('...and the pool runs out', /no blank notes/.test(result(AUTHOR)) && inv(AUTHOR).find((e) => e.baseId === PAPER).count === 2, result(AUTHOR));
  setp(AUTHOR, 'failSet', true);
  fs.writeFileSync(BASES, JSON.stringify({ note: ['a01:Test.esp', 'a02:Test.esp', 'a03:Test.esp'] }));
  act(AUTHOR, 'write', eid, 'note', '');
  setp(AUTHOR, 'failSet', false);
  check('a failed inventory write spends nothing and frees the record', /Nothing was spent/.test(result(AUTHOR)) && notes(AUTHOR).write.kinds.find((k) => k.id === 'note').free === 1, result(AUTHOR));
  await tick();
  const reg = JSON.parse(fs.readFileSync(REG, 'utf8'));
  check('the registry on disk has both works with their text', Object.keys(reg.works).length === 2 && reg.works.W1.text === 'Seen near the eastern gate.' && reg.works.W1.signed === true && reg.works.W2.signed === false, reg);

  // ---- the receiver ----
  setp(AUTHOR, 'inventory', { entries: inv(AUTHOR).filter((e) => e.baseId !== 0x05000a01) });
  setp(READER, 'inventory', { entries: [{ baseId: 0x05000a01, count: 1, name: 'Wanted' }] });
  check('the reader is told nothing until they read it', !widgets.some((x) => x.a === READER));
  const r = globalThis.__dboWrittenRead(READER, 0x05000a01);
  await tick();
  n = notes(READER);
  check('reading the item opens the journal at the work', r === true && last(READER).tab === 'notes' && n && n.open && n.open.kind === 'work' && n.open.text === 'Seen near the eastern gate.' && n.open.author === 'Lydia' && n.open.kept === false, n);
  check('...any other book is left alone', globalThis.__dboWrittenRead(READER, 0x12eb7) === false);
  act(READER, 'keep', 'W1');
  n = notes(READER);
  check('keeping a copy puts it under Received and opens it', n.received.length === 1 && n.received[0].title === 'Wanted' && n.open.kind === 'received' && n.open.text === 'Seen near the eastern gate.', n);
  act(READER, 'keep', 'W1');
  check('...once only', notes(READER).received.length === 1 && /already/.test(result(READER)));
  act(READER, 'keep', 'W2');
  check('a work not carried cannot be kept', /do not carry/.test(result(READER)));
  check('...and the work shows as kept', notes(READER).carried[0].kept === true);
  globalThis.__dboJournalRedraw(AUTHOR, 'notes');
  check('the author no longer carries the given note', notes(AUTHOR).carried.length === 1);

  // ---- reload and restart ----
  load(false);
  globalThis.__dboJournalOpenTab(READER, 'notes');
  check('a hot reload keeps the notes', notes(READER).ready === true && notes(READER).received.length === 1);
  await tick();
  load(true);
  globalThis.__dboJournalOpenTab(READER, 'notes');
  await tick();
  n = notes(READER);
  check('a restart reads notes and the registry back from disk', n.ready === true && n.received.length === 1 && n.carried.length === 1 && n.carried[0].id === 'W1', n);
  act(READER, 'forget', n.received[0].id);
  check('a received writing is removed', notes(READER).received.length === 0);

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : 'all ok');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL threw', e.stack); process.exit(1); });
