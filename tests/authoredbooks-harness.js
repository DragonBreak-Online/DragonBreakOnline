// Scripted test for server\authoredbooks.js (Nat, 2 Nov: books written by the colleges, House Telvanni and the Bards
// College; Option B, a library on the character): who writes and where, the costs and the Quill, titles and pages through
// the prose filter, the weekly and storage limits, copies, giving, reading in the widget or in chat, the chat drafts, a GM's
// removal from every library and shelf, the ledger rows, and the gamemode, salvage and config wiring.
//   node tests/authoredbooks-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'authoredbooks.js');
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-books-'));
const home = process.cwd();
process.chdir(dir);

let now = 1790000000000;
Date.now = () => now;
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };

const GOLD = 0xf, PAPER = 0x33761, INK = 0x4c3c6, QUILL = 0x4c3c8, LEATHER = 0xdb5d2, LINEN = 0x34cd6;
const MAGE = 0x10, APPRENTICE = 0x11, OUTSIDER = 0x12, BARD = 0x13, TELV = 0x14, READER = 0x15, STAFF = 0x16, FAR = 0x17, WHISPER = 0x18;
const LEDGER = 0x900;
const store = new Map();
const mp = {
  get: (id, k) => store.get(`${id >>> 0}|${k}`),
  set: (id, k, v) => store.set(`${id >>> 0}|${k}`, v),
  getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
};
const ALL = [MAGE, APPRENTICE, OUTSIDER, BARD, TELV, READER, STAFF, FAR, WHISPER];
for (const a of ALL) mp.set(a, 'profileId', a + 1000);
const stock = (a, extra) => mp.set(a, 'inventory', { entries: [[GOLD, 1000], [PAPER, 30], [INK, 10], [QUILL, 1], [LEATHER, 5], [LINEN, 5]].map(([b, c]) => ({ baseId: b, count: c })).concat(extra || []) });
for (const a of ALL) stock(a);
const count = (a, base) => (mp.get(a, 'inventory').entries || []).filter((e) => e.baseId === base).reduce((s, e) => s + e.count, 0);
const GUILDS = {
  [MAGE]: { id: 'college-of-winterhold', name: 'College of Winterhold', role: 'mage' },
  [APPRENTICE]: { id: 'college-of-winterhold', name: 'College of Winterhold', role: 'member' },
  [BARD]: { id: 'bards-college', name: 'Bards College', role: 'sergeant' },
  [TELV]: { id: 'house-telvanni', name: 'House Telvanni', role: 'officer' },
  [WHISPER]: { id: 'college-of-whispers', name: 'College of Whispers', role: 'leader' },
};
globalThis.__dboGuildsOf = (a) => (GUILDS[a] ? [GUILDS[a]] : []);
globalThis.__dboProseProblem = (t) => (/\bslurword\b/i.test(t) ? 'slurword' : null);
const caps = new Set();
const dist = new Map();
const out = { said: [], widgets: [], closed: [], audits: [] };
const handlers = new Map(); const cmds = new Map(); let tick = null;
const api = {
  mp, log: () => {}, personal: (a, t) => out.said.push({ a: a >>> 0, t }), audit: (t) => out.audits.push(t), who: (a) => `P${a.toString(16)}`,
  display: (a) => `N${a.toString(16)}`, onlineActors: () => ALL.slice(), openWidget: (a, w) => out.widgets.push({ a, w }), closeWidget: (a, id) => out.closed.push({ a, id }),
  onUi: (ev, f) => handlers.set(ev, f), registerChatCommand: (n, f) => cmds.set(n, f), every: (n, ms, f) => { tick = f; }, isAdmin: (a) => a === STAFF,
  findByName: (q) => ({ reader: READER, mage: MAGE, far: FAR, telv: TELV }[String(q).toLowerCase()] || 0), offlineByTag: () => 0,
  takeGold: (a, n) => { const e = mp.get(a, 'inventory').entries.find((x) => x.baseId === GOLD); if (!e || e.count < n) return false; e.count -= n; return true; },
  goldOf: (a) => count(a, GOLD), giveItem: (a, b, n) => { mp.get(a, 'inventory').entries.push({ baseId: b, count: n }); return true; },
  distanceMeters: (a, b) => (dist.has(`${a >>> 0}:${b >>> 0}`) ? dist.get(`${a >>> 0}:${b >>> 0}`) : (a === FAR || b === FAR ? 50 : 2)),
  hasUiCap: (a, cap) => caps.has(`${a >>> 0}:${cap}`),
  cfg: { authoredBooks: JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8')).authoredBooks },
};
const load = (extra) => { handlers.clear(); cmds.clear(); delete require.cache[MODULE]; return require(MODULE)(Object.assign({}, api, extra ? { cfg: { authoredBooks: Object.assign({}, api.cfg.authoredBooks, extra) } } : {})); };
let M = load();
const clear = () => { for (const k of Object.keys(out)) out[k].length = 0; };
const told = (a) => out.said.filter((x) => x.a === a).map((x) => x.t).join(' | ');
const cmd = (a, line) => { clear(); cmds.get('books')(a, line); return told(a); };
const ledger = (a, kind) => { clear(); return globalThis.__dboBooksLedgerOpen(a, kind || 'write', LEDGER); };
const lib = (a) => mp.get(a, 'private.dboBooks') || {};
const bookId = (t) => (M.find(t) || {}).id;

// ---- who, and the ledger rows ----
ok(globalThis.__dboBooksLedgerActions(MAGE).map((r) => r.id).join() === 'books:write,books:copy', 'a ranked College mage gets Write a book and Copy a book at the ledger');
ok(globalThis.__dboBooksLedgerActions(BARD).length === 2 && globalThis.__dboBooksLedgerActions(TELV).length === 2 && globalThis.__dboBooksLedgerActions(WHISPER).length === 2, '...as do a Bards College Bard, a Telvanni officer and a College of Whispers leader');
ok(!globalThis.__dboBooksLedgerActions(APPRENTICE).length && !globalThis.__dboBooksLedgerActions(OUTSIDER).length, 'not an apprentice, nor an outsider');
ok(/at a Scholars' Ledger/.test(cmd(MAGE, 'draft The Frost Atronach')), 'away from a ledger, no draft');
ok(/Only a ranked scholar/.test((ledger(OUTSIDER), told(OUTSIDER))), 'an outsider at the ledger is refused');

// ---- chat drafting, the costs ----
ledger(MAGE);
ok(/\/books draft <title>/.test(told(MAGE)) && !out.widgets.length, 'without the book widget, the ledger explains the chat drafts');
ok(/A title is 3 to 60/.test(cmd(MAGE, 'draft Ab')) && /no brackets/.test(cmd(MAGE, 'draft The [Tome]')) && /"slurword" is not allowed/.test(cmd(MAGE, 'draft A slurword tale')), 'titles: length, plain words and the prose filter');
cmd(MAGE, 'draft On the Frost Atronach');
ok(/Page 1: 18 of 1500/.test(cmd(MAGE, 'page Cold, and patient.')), 'a page fills', told(MAGE));
ok(/"slurword" is not allowed/.test(cmd(MAGE, 'page and then slurword')), 'the prose filter on every page');
cmd(MAGE, 'newpage'); cmd(MAGE, 'page It waits in the snow.');
ok(/Page 2: It waits/.test(cmd(MAGE, 'preview')), 'a preview shows each page');
const goldBefore = count(MAGE, GOLD);
mp.get(MAGE, 'inventory').entries = mp.get(MAGE, 'inventory').entries.filter((e) => e.baseId !== QUILL);
ok(/a Quill to write with/.test(cmd(MAGE, 'finish tome')) && count(MAGE, GOLD) === goldBefore, 'no Quill: nothing written, nothing taken');
mp.get(MAGE, 'inventory').entries.push({ baseId: QUILL, count: 1 });
ok(/You finish writing On the Frost Atronach/.test(cmd(MAGE, 'finish tome')), 'with a Quill the book is written');
ok(count(MAGE, GOLD) === goldBefore - 100 && count(MAGE, PAPER) === 28 && count(MAGE, INK) === 9 && count(MAGE, LEATHER) === 4 && count(MAGE, LINEN) === 5 && count(MAGE, QUILL) === 1,
  'a 2-page tome costs 100 gold, 2 Paper Rolls, an Inkwell and Leather; the Quill stays', mp.get(MAGE, 'inventory'));
const atro = bookId('On the Frost Atronach');
ok(atro && lib(MAGE)[atro] === 1 && M.db().books[atro].pages.join('|') === 'Cold, and patient.|It waits in the snow.' && M.db().books[atro].faction === 'college-of-winterhold', 'the book is stored once, and the writer holds one copy');
ok(out.audits.some((t) => new RegExp(`^BOOKAUTHOR P10 wrote book #${atro} \\(college-of-winterhold, 2 page\\(s\\), tome\\)$`).test(t)) && !out.audits.some((t) => /Atronach|snow/.test(t)), 'audited by id, never the title or the text', out.audits);
ok(fs.existsSync(path.join(dir, 'authored-books.json')), 'stored in authored-books.json beside the world');
ledger(MAGE);
ok(/A book by that title already exists/.test(cmd(MAGE, 'draft on the frost  atronach')), 'titles are unique, whatever the case or spacing');

// ---- the widget writer ----
caps.add(`${TELV}:book`);
ledger(TELV);
const w = out.widgets[0] && out.widgets[0].w;
ok(w && w.type === 'book' && w.id === 119 && w.mode === 'write' && w.maxPages === 10 && w.pageChars === 1500 && /100 gold/.test(w.costs.tome) && w.events.write === 'dbo:bookWrite', 'with the book widget, the ledger opens the writer', w);
clear(); handlers.get('bookWrite')(TELV, ['stale', 'Wrong', '["x"]', 'book']);
ok(/out of date/.test(told(TELV)), 'a stale nonce is refused');
clear(); handlers.get('bookWrite')(TELV, [w.nonce, 'Mushroom Towers', JSON.stringify(['Grow them slowly.']), 'book']);
const tower = bookId('Mushroom Towers');
ok(tower && lib(TELV)[tower] === 1 && count(TELV, LINEN) === 4 && count(TELV, LEATHER) === 5 && out.closed.some((c) => c.id === 119), 'the widget writes a bound book: Linen Wrap, not Leather', mp.get(TELV, 'inventory'));
ledger(TELV); const w2 = out.widgets[0].w;
clear(); handlers.get('bookWrite')(TELV, [w2.nonce, 'A Long Scroll', JSON.stringify(['one', 'two']), 'scroll']);
ok(/A scroll is one page/.test(told(TELV)), 'a scroll is one page');
clear(); handlers.get('bookWrite')(TELV, [w2.nonce, 'Too Many Pages', JSON.stringify(Array(11).fill('x')), 'book']);
ok(/at most 10 pages/.test(told(TELV)), 'at most maxPages pages');
clear(); handlers.get('bookWrite')(TELV, [w2.nonce, 'A Rude Book', JSON.stringify(['fine', 'then a slurword here']), 'book']);
ok(/"slurword" is not allowed in a book \(page 2\)/.test(told(TELV)) && !bookId('A Rude Book'), 'the widget\'s pages go through the prose filter too');
clear(); handlers.get('bookWrite')(TELV, [w2.nonce, 'Too Long', JSON.stringify(['x'.repeat(1501)]), 'book']);
ok(/over 1500 characters/.test(told(TELV)), 'a page over pageChars is refused');
clear(); handlers.get('bookWrite')(TELV, [w2.nonce, 'A Short Scroll', JSON.stringify(['brief']), 'scroll']);
ok(bookId('A Short Scroll') && count(TELV, LINEN) === 4 && count(TELV, LEATHER) === 5, 'a scroll needs no binding');

// ---- limits ----
ledger(TELV); const w3 = out.widgets[0].w;
clear(); handlers.get('bookWrite')(TELV, [w3.nonce, 'A Third Book', JSON.stringify(['three']), 'book']);
ok(!ledger(TELV) && /written 3 books this week/.test(told(TELV)) && !out.widgets.length, 'three new books a week: the ledger says so before any writer opens');
now += 7 * 24 * 3600000 + 1000;
ledger(TELV); const w5 = out.widgets[0].w;
clear(); handlers.get('bookWrite')(TELV, [w5.nonce, 'A Fourth Book', JSON.stringify(['four']), 'book']);
ok(!!bookId('A Fourth Book'), '...and three more the week after');
M = load({ maxBooksPerAuthor: 4 }); ledger(TELV);
ok(/4 books to your name/.test(told(TELV)), 'maxBooksPerAuthor');
M = load({ maxBooks: 5 }); ledger(BARD);
ok(/libraries are full/.test(told(BARD)), 'maxBooks on the server');
M = load({ maxHeld: 1 }); ledger(MAGE);
ok(/holds 1 copies already/.test(told(MAGE)), 'maxHeld copies in one library');
M = load();

// ---- copies ----
now += 21 * 60000;
ok(/Books are copied at a Scholars' Ledger/.test(cmd(MAGE, `copy #${atro}`)) && lib(MAGE)[atro] === 1, 'copying needs the ledger (a ledger visit lasts ledgerMinutes)');
dist.set(`${MAGE}:${LEDGER}`, 9); globalThis.__dboBooksLedgerOpen(MAGE, 'copy', LEDGER);
ok(/Books are copied at a Scholars' Ledger/.test(cmd(MAGE, `copy #${atro}`)) && lib(MAGE)[atro] === 1, '...and standing at it'); dist.delete(`${MAGE}:${LEDGER}`);
ledger(MAGE, 'copy');
const cw = out.widgets[0] && out.widgets[0].w;
ok(cw && cw.type === 'contextMenu' && cw.id === 120 && cw.actions.some((r) => r.id === `bc:${atro}` && /50 gold/.test(r.label)) && !cw.actions.some((r) => r.id === `bc:${tower}`), 'the copy list: their own and their faction\'s books, at half the gold', cw && cw.actions);
const g0 = count(MAGE, GOLD), p0 = count(MAGE, PAPER);
clear(); handlers.get('booksCopyChoose')(MAGE, [`bc:${atro}`]);
ok(lib(MAGE)[atro] === 2 && count(MAGE, GOLD) === g0 - 50 && count(MAGE, PAPER) === p0 - 2 && M.db().books[atro].copies === 2, 'a copy: half the gold, the same paper, ink and binding', mp.get(MAGE, 'inventory'));
ok(out.audits.some((t) => new RegExp(`^BOOKAUTHOR P10 copied book #${atro} \\(copy 2\\)$`).test(t)), 'audited');
GUILDS[READER] = { id: 'college-of-winterhold', name: 'College of Winterhold', role: 'officer' };
globalThis.__dboBooksLedgerOpen(READER, 'copy', LEDGER);
ok(/You copy On the Frost Atronach/.test(cmd(READER, `copy #${atro}`)) && lib(READER)[atro] === 1, 'a ranked member of the book\'s faction copies it');
delete GUILDS[READER];
globalThis.__dboBooksLedgerOpen(TELV, 'copy', LEDGER);
ok(/Only its author or a ranked member of the College of Winterhold/.test(cmd(TELV, `copy #${atro}`)), 'another faction may not');
M = load({ copiesPerWeek: 1 }); globalThis.__dboBooksLedgerOpen(MAGE, 'copy', LEDGER);
ok(/made 1 copies this week/.test(cmd(MAGE, `copy #${atro}`)), 'copiesPerWeek, counted apart from writing');
M = load();

// ---- giving ----
const r0 = lib(READER)[atro] || 0;
ok(/hand over a copy/.test(cmd(MAGE, 'give reader On the Frost Atronach')) && lib(READER)[atro] === r0 + 1 && lib(MAGE)[atro] === 1, 'a copy is given hand to hand');
ok(out.audits.some((t) => new RegExp(`^BOOKAUTHOR P10 gave 1 copy of book #${atro} to P15$`).test(t)) && /hands you a copy of On the Frost Atronach/.test(told(READER)), 'audited, and the reader is told');
ok(/Stand closer/.test(cmd(MAGE, 'give far On the Frost Atronach')), 'giving needs to be close');
ok(/do not have that many/.test(cmd(MAGE, 'give reader On the Frost Atronach 5')), 'not more than held');

// ---- reading ----
clear(); cmds.get('books')(READER, 'read On the Frost Atronach');
ok(/On the Frost Atronach, by N10 of the College of Winterhold\. Page 1 of 2:/.test(told(READER)) && /Cold, and patient\./.test(told(READER)) && /books read #\d+ 2 for the next page/.test(told(READER)), 'without the widget, a page in chat', told(READER));
clear(); cmds.get('books')(READER, `read 1 2`);
ok(/Page 2 of 2/.test(told(READER)) && /It waits in the snow/.test(told(READER)), 'by library number and page');
caps.add(`${READER}:book`);
clear(); cmds.get('books')(READER, 'read On the Frost Atronach');
const rw = out.widgets[0] && out.widgets[0].w;
ok(rw && rw.type === 'book' && rw.mode === 'read' && rw.pages.length === 2 && rw.author === 'N10' && rw.faction === 'College of Winterhold' && rw.page === 0, 'with the widget, the reader opens with every page', rw);
ok(/not in your library/.test(cmd(OUTSIDER, 'read On the Frost Atronach')), 'a book not held is not read');
ok(!out.audits.some((t) => /skill|xp/i.test(t)) && !/skill/i.test(fs.readFileSync(MODULE, 'utf8').split('\n').filter((l) => !/^\/\//.test(l.trim())).join('\n').replace(/Reading gives no skill/g, '')), 'reading grants no skill (nothing in the module touches one)');
ok(/^1\. On the Frost Atronach, by N10/m.test(cmd(READER, '').split(' | ').join('\n')), '/books lists the library');

// ---- removal ----
const decorCalls = [];
globalThis.__dboDecorRemoveBook = (id) => { decorCalls.push(id); return 2; };
ok(/Staff: \/books remove|Use: \/books/.test(cmd(MAGE, `remove #${atro}`)) && !M.db().books[atro].removed, 'only staff remove');
ok(/is removed: from 2 online libraries now, from the rest as they are next read, and from 2 shelf piece/.test(cmd(STAFF, `remove #${atro}`)), 'a GM removes a book everywhere', told(STAFF));
ok(!lib(MAGE)[atro] && !lib(READER)[atro] && decorCalls[0] === atro && M.db().books[atro].removed && M.db().books[atro].pages.length === 2, 'it leaves every library and shelf; the record is kept');
ok(out.audits.some((t) => new RegExp(`^BOOKAUTHOR P16 removed book #${atro} of author profile 1016: 2 online libraries, 2 shelf piece\\(s\\)$`).test(t)), 'audited', out.audits);
ok(/ink has run/.test((out.said.length = 0, globalThis.__dboBookReadFor(READER, atro), told(READER))), 'a shelf copy of a removed book reads nothing');
ok(/#\d+ On the Frost Atronach.*REMOVED/.test(cmd(STAFF, 'list N10')), 'staff list it as removed');
ledger(MAGE);
ok(/A title is|draft titled/.test(cmd(MAGE, 'draft On the Frost Atronach')), 'a removed book\'s title is free again');

// ---- decor hooks ----
ok(globalThis.__dboBookTitle(tower) === 'Mushroom Towers' && globalThis.__dboBookTitle(atro) === '', 'decor asks a book\'s title (none once removed)');
ok(globalThis.__dboBookInLibrary(TELV, 'Mushroom Towers').id === tower && globalThis.__dboBookInLibrary(OUTSIDER, 'Mushroom Towers') === null, '...and whether it is in a library');

// ---- wiring and config ----
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
ok(/require\(AUTHOREDBOOKS_JS\)\(\{[^}]*takeGold, goldOf, giveItem, distanceMeters, hasUiCap \}\)/.test(gm) && gm.indexOf('AUTHOREDBOOKS_JS') > gm.indexOf("const DECOR_JS = path.resolve('decor.js')"), 'gamemode loads authoredbooks.js after decor.js');
const sv = fs.readFileSync(path.join(ROOT, 'salvage.js'), 'utf8');
ok(/writeActions\(a\), authorActions\(a\)\)/.test(sv) && /globalThis\.__dboBooksLedgerOpen\(a, id\.slice\(6\), p\.target\)/.test(sv), 'salvage.js offers the rows and hands them over');
const cfg = api.cfg.authoredBooks;
ok(cfg.enabled === true && cfg.factions.join() === 'college-of-winterhold,synod,college-of-whispers,house-telvanni,bards-college' && cfg.writeRoles.join() === 'leader,officer,sergeant,mage'
  && cfg.gold === 100 && cfg.copyGoldShare === 0.5 && cfg.writesPerWeek === 3 && cfg.copiesPerWeek === 15 && /Nat, 2 Nov/.test(cfg._comment), 'gamemode-config.json: Nat\'s factions, ranks, prices and limits');
ok(!/—/.test(fs.readFileSync(MODULE, 'utf8')), 'no em dash in authoredbooks.js');
ok(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').includes('authored-books.json'), 'authored-books.json is gitignored');

process.chdir(home);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Windows */ }
console.log(fails ? `${fails} failure(s)` : 'all checks passed');
process.exit(fails ? 1 : 0);
