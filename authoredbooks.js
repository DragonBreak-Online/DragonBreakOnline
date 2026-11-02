// DragonBreak Online: books written by players (Nat, 2 Nov: "make it so college factions can craft books to read that cost
// gold and resources, that way I don't have to CK books in. Telvanni too"; plan _work\authored-books-1102.md on the PC,
// Option B). Loaded by gamemode.js after salvage.js and decor.js.
//
// Who writes: a member of a faction in `factions` (the colleges, House Telvanni, the Bards College) whose rank's role is in
// `writeRoles`, at a Scholars' Ledger (salvage.js's ledger menu, rows "Write a book" and "Copy a book"). A book is a title and
// up to maxPages pages, each title and page through the journal's prose filter (__dboProseProblem); titles are unique.
// Writing costs gold, a Paper Roll per page, an Inkwell and a binding (Leather for a tome, Linen Wrap for a bound book, none
// for a one-page scroll) and needs a Quill in the pack, not spent. A copy costs copyGoldShare of the gold, with the same
// paper, ink and binding; the author or a member of the book's faction at writeRoles copies it.
// Limits (Nat: "add a certain limit"): writesPerWeek new books and copiesPerWeek copies per character, counted apart;
// maxBooksPerAuthor, maxBooks on the server, maxHeld copies in one library.
//
// Option B: a book is not an item. The text is stored once in authored-books.json (beside the world, as decor.json is), and a
// character's library is private.dboBooks { <book id>: copies }. Copies are given hand to hand (/books give), read in the
// `book` front widget (a client announcing the 'book' cap) or in chat (/books read <title> [page]). Reading gives no skill.
// Option A (the next native window) turns each copy into a named item on a written-book base; the stored text stays as is.
// Home decor: decor.js places a `book` piece for a book in the owner's library (/decor book <title>) and opens it here on
// activation (__dboBookReadFor). A GM's /books remove marks the book removed: it leaves every library as it is next read,
// at once for the online, and every shelf (decor.js __dboDecorRemoveBook). Audit lines name book ids, never titles or text.
//
// Chat, for a client without the widget, at the ledger after choosing "Write a book":
//   /books draft <title>   /books page <text>   /books newpage   /books preview   /books finish [tome|book|scroll]   /books discard
// Anywhere: /books (your library), /books read <title|n> [page], /books give <player> <title|n> [count], /books copy <title|n>
// (at the ledger). Staff: /books remove <title|#id>, /books list [author|faction], /books show <#id> [page].
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  enabled: true,
  factions: ['college-of-winterhold', 'synod', 'college-of-whispers', 'house-telvanni', 'bards-college'],
  writeRoles: ['leader', 'officer', 'sergeant', 'mage'],
  ledgerMeters: 6.5, ledgerMinutes: 20,
  titleMin: 3, titleMax: 60, maxPages: 10, pageChars: 1500,
  gold: 100, copyGoldShare: 0.5,
  // Skyrim.esm MISC, read from /opt/skyrim-data on 2 Nov: PaperRoll 033761, Inkwell01 04c3c6, Quill01 04c3c8, Leather01 0db5d2,
  // RuinsLinenPile01 (Linen Wrap) 034cd6
  paper: '033761:Skyrim.esm', paperPerPage: 1, ink: '04c3c6:Skyrim.esm', quill: '04c3c8:Skyrim.esm',
  bindings: { tome: '0db5d2:Skyrim.esm', book: '034cd6:Skyrim.esm', scroll: '' }, // verify-formids: ignore (binding materials, MISC, keyed by the kind of book)
  writesPerWeek: 3, copiesPerWeek: 15, maxBooksPerAuthor: 20, maxBooks: 2000, maxHeld: 100, giveMeters: 5,
  chatChunk: 350,
};
const WEEK = 7 * 24 * 3600000;
const BINDING_NAME = { tome: 'a leather tome', book: 'a bound book', scroll: 'a scroll' };

module.exports = (api) => {
  const { mp, log, personal, audit, who, onlineActors, openWidget, closeWidget, onUi, registerChatCommand, every, cfg } = api;
  const fn = (f, dflt) => (typeof f === 'function' ? f : dflt);
  const display = fn(api.display, who);
  const isAdmin = fn(api.isAdmin, () => false);
  const findByName = fn(api.findByName, () => 0);
  const offlineByTag = fn(api.offlineByTag, () => 0);
  const takeGold = fn(api.takeGold, () => false);
  const goldOf = fn(api.goldOf, () => 0);
  const giveItem = fn(api.giveItem, () => false);
  const distanceMeters = fn(api.distanceMeters, () => Infinity);
  const hasUiCap = fn(api.hasUiCap, () => false);
  const C = Object.assign({}, DEFAULTS, cfg.authoredBooks || {});
  C.bindings = Object.assign({}, DEFAULTS.bindings, (cfg.authoredBooks || {}).bindings || {});
  const FACTIONS = new Set((C.factions || []).map(String));
  const ROLES = new Set((C.writeRoles || []).map(String));
  const BOOK_WIDGET_ID = 119, COPY_MENU_ID = 120;
  const LIB = 'private.dboBooks', WRITES = 'private.dboBookWrites', COPIES = 'private.dboBookCopies';
  const S = globalThis.__dboBooks || (globalThis.__dboBooks = { db: null, drafts: new Map(), ledger: new Map(), nonces: new Map() });
  for (const k of ['drafts', 'ledger', 'nonces']) if (!(S[k] instanceof Map)) S[k] = new Map();

  // ---- the store, beside the world state ------------------------------------------------------------------------------
  const stateDir = () => { try { return path.dirname(fs.realpathSync(path.resolve('world'))); } catch (e) { return path.resolve('.'); } };
  const FILE = path.join(stateDir(), 'authored-books.json');
  const db = () => {
    if (!S.db) { try { S.db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { S.db = null; } }
    if (!S.db || typeof S.db !== 'object') S.db = {};
    S.db.next = Number(S.db.next) || 1; S.db.books = S.db.books || {};
    return S.db;
  };
  const save = () => { try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(db(), null, 1)); fs.renameSync(FILE + '.tmp', FILE); return true; } catch (e) { log('books: saving authored-books.json failed', e.message); return false; } };
  const bookOf = (id) => db().books[String(id)] || null;
  const live = (b) => !!b && !b.removed;
  const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();

  // ---- the character ----------------------------------------------------------------------------------------------------
  const get = (a, k, d) => { try { const v = mp.get(a >>> 0, k); return v === undefined || v === null ? d : v; } catch (e) { return d; } };
  const set = (a, k, v) => { try { mp.set(a >>> 0, k, v); return true; } catch (e) { log(`books: ${k} could not be set`, e.message); return false; } };
  const profile = (a) => Number(get(a, 'profileId', -1));
  const idOf = (desc) => { try { return desc ? mp.getIdFromDesc(String(desc)) >>> 0 : 0; } catch (e) { return 0; } };
  const guildsOf = (a) => { try { return typeof globalThis.__dboGuildsOf === 'function' ? globalThis.__dboGuildsOf(a >>> 0) || [] : []; } catch (e) { return []; } };
  const writerOrder = (a) => guildsOf(a).find((g) => FACTIONS.has(String(g.id)) && ROLES.has(String(g.role))) || null;
  const ranksIn = (a, fid) => guildsOf(a).some((g) => String(g.id) === String(fid) && ROLES.has(String(g.role)));
  // The library, without books staff removed (written back when any were)
  const library = (a) => {
    const raw = get(a, LIB, null), out = {};
    let changed = false;
    for (const [id, n] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
      if (live(bookOf(id)) && Number(n) > 0) out[id] = Math.floor(Number(n)); else changed = true;
    }
    if (changed) set(a, LIB, out);
    return out;
  };
  const held = (a) => Object.values(library(a)).reduce((s, n) => s + n, 0);
  const addCopies = (a, id, n) => { const l = library(a); l[String(id)] = (l[String(id)] || 0) + n; return set(a, LIB, l); };
  const takeCopies = (a, id, n) => { const l = library(a); if ((l[String(id)] || 0) < n) return false; l[String(id)] -= n; if (!l[String(id)]) delete l[String(id)]; return set(a, LIB, l); };
  const recent = (a, key) => (Array.isArray(get(a, key, null)) ? get(a, key, []) : []).filter((t) => Date.now() - Number(t) < WEEK);
  const stamp = (a, key) => set(a, key, recent(a, key).concat([Date.now()]));
  // A title, a library line number (1-based, as /books lists them) or #id, among the books in a library or all live books
  const listOf = (a) => Object.keys(library(a)).map(Number).sort((x, y) => x - y);
  const find = (q, a) => {
    const s = String(q || '').trim();
    if (!s) return null;
    const m = /^#(\d+)$/.exec(s);
    if (m) return bookOf(m[1]);
    if (a !== undefined && /^\d+$/.test(s)) { const id = listOf(a)[Number(s) - 1]; return id ? bookOf(id) : null; }
    return Object.values(db().books).find((b) => live(b) && norm(b.title) === norm(s)) || null;
  };
  const inLib = (a, q) => { const b = find(q, a); return b && library(a)[String(b.id)] ? b : null; };

  // ---- costs ---------------------------------------------------------------------------------------------------------
  const costOf = (pages, binding, copy) => {
    const items = {};
    const add = (d, n) => { if (d && n > 0) items[d] = (items[d] || 0) + n; };
    add(C.paper, pages * C.paperPerPage); add(C.ink, 1); add(C.bindings[binding], 1);
    return { gold: copy ? Math.ceil(C.gold * C.copyGoldShare) : C.gold, items };
  };
  const countOf = (a, d) => { const id = idOf(d); return id ? (get(a, 'inventory', { entries: [] }).entries || []).filter((e) => (Number(e.baseId) >>> 0) === id && !e.worn).reduce((s, e) => s + (Number(e.count) || 0), 0) : 0; };
  const itemName = (d) => ({ [C.paper]: 'Paper Roll', [C.ink]: 'Inkwell', [C.quill]: 'Quill', [C.bindings.tome]: 'Leather', [C.bindings.book]: 'Linen Wrap' }[d] || d);
  const costText = (c) => [`${c.gold} gold`].concat(Object.entries(c.items).map(([d, n]) => `${n} ${itemName(d)}`)).join(', ');
  const shortOf = (a, c) => {
    const out = [];
    if (goldOf(a) < c.gold) out.push(`${c.gold - goldOf(a)} gold`);
    for (const [d, n] of Object.entries(c.items)) { const h = countOf(a, d); if (h < n) out.push(`${n - h} ${itemName(d)}`); }
    if (C.quill && countOf(a, C.quill) < 1) out.push('a Quill to write with');
    return out;
  };
  // Gold, then the materials in one write; materials short at that moment give the gold back
  const pay = (a, c) => {
    if (shortOf(a, c).length) return false;
    if (c.gold > 0 && !takeGold(a, c.gold)) return false;
    const entries = (get(a, 'inventory', { entries: [] }).entries || []).map((e) => Object.assign({}, e));
    for (const [d, n] of Object.entries(c.items)) {
      let left = n; const id = idOf(d);
      for (const e of entries) { if (left <= 0) break; if ((Number(e.baseId) >>> 0) !== id || e.worn) continue; const k = Math.min(left, Number(e.count) || 0); e.count -= k; left -= k; }
      if (left > 0) { if (c.gold > 0) giveItem(a, 0xf, c.gold); return false; }
    }
    return set(a, 'inventory', { entries: entries.filter((e) => (Number(e.count) || 0) > 0) });
  };

  // ---- at the ledger --------------------------------------------------------------------------------------------------
  const atLedger = (a) => {
    const s = S.ledger.get(a >>> 0);
    if (!s || Date.now() > s.until) return false;
    try { return distanceMeters(a, s.target) <= C.ledgerMeters; } catch (e) { return false; }
  };
  const prose = (t) => { try { return typeof globalThis.__dboProseProblem === 'function' ? globalThis.__dboProseProblem(String(t)) : null; } catch (e) { return null; } };
  const titleProblem = (title) => {
    const t = String(title || '').replace(/\s+/g, ' ').trim();
    if (t.length < C.titleMin || t.length > C.titleMax) return `A title is ${C.titleMin} to ${C.titleMax} characters.`;
    if (/[\u0000-\u001f\u007f[\]{}<>#]/.test(t)) return 'A title is plain words: no brackets, # or control characters.';
    const bad = prose(t); if (bad) return `The word "${bad}" is not allowed in a book.`;
    if (Object.values(db().books).some((b) => live(b) && norm(b.title) === norm(t))) return 'A book by that title already exists. Choose another title.';
    return '';
  };
  const pagesProblem = (pages) => {
    if (!Array.isArray(pages) || !pages.length) return 'A book needs at least one page.';
    if (pages.length > C.maxPages) return `A book holds at most ${C.maxPages} pages.`;
    for (let i = 0; i < pages.length; i++) {
      const p = String(pages[i] || '');
      if (!p.trim()) return `Page ${i + 1} is empty.`;
      if (p.length > C.pageChars) return `Page ${i + 1} is over ${C.pageChars} characters.`;
      const bad = prose(p); if (bad) return `The word "${bad}" is not allowed in a book (page ${i + 1}).`;
    }
    return '';
  };
  const writeRefusal = (a) => {
    if (!C.enabled) return 'Books are not written right now.';
    if (!writerOrder(a)) return 'Only a ranked scholar of the colleges, House Telvanni or the Bards College writes books.';
    if (!atLedger(a)) return "Books are written at a Scholars' Ledger. Choose \"Write a book\" there.";
    if (recent(a, WRITES).length >= C.writesPerWeek) return `You have written ${C.writesPerWeek} books this week, the most a week allows.`;
    if (Object.values(db().books).filter((b) => live(b) && b.author.profile === profile(a)).length >= C.maxBooksPerAuthor) return `You have ${C.maxBooksPerAuthor} books to your name, the most anyone keeps.`;
    if (Object.values(db().books).filter(live).length >= C.maxBooks) return 'The libraries are full: no new book can be written until staff archive some.';
    if (held(a) >= C.maxHeld) return `Your library holds ${C.maxHeld} copies already. Give some away first.`;
    return '';
  };
  const write = (a, title, pages, binding) => {
    const why = writeRefusal(a); if (why) return why;
    const kind = Object.prototype.hasOwnProperty.call(BINDING_NAME, binding) ? binding : 'book';
    const t = String(title || '').replace(/\s+/g, ' ').trim();
    const ps = (Array.isArray(pages) ? pages : []).map((p) => String(p || '').replace(/\r\n/g, '\n').trim());
    const bad = titleProblem(t) || pagesProblem(ps) || (kind === 'scroll' && ps.length > 1 ? 'A scroll is one page.' : '');
    if (bad) return bad;
    const c = costOf(ps.length, kind, false), short = shortOf(a, c);
    if (short.length) return `${BINDING_NAME[kind].replace(/^a /, 'A ')} of ${ps.length} page${ps.length === 1 ? '' : 's'} needs ${costText(c)}. Short: ${short.join(', ')}.`;
    if (!pay(a, c)) return 'The materials could not be taken. Try again.';
    const order = writerOrder(a), d = db();
    const id = d.next++;
    d.books[String(id)] = { id, title: t, pages: ps, binding: kind, author: { profile: profile(a), name: display(a) }, faction: String(order.id), factionName: String(order.name || order.id), at: Date.now(), copies: 1 };
    if (!save()) { delete d.books[String(id)]; d.next--; if (c.gold) giveItem(a, 0xf, c.gold); return 'The book could not be stored; your gold is back. Tell staff.'; }
    addCopies(a, id, 1); stamp(a, WRITES); S.drafts.delete(a >>> 0);
    audit(`BOOKAUTHOR ${who(a)} wrote book #${id} (${order.id}, ${ps.length} page(s), ${kind})`);
    return '';
  };
  const copyRefusal = (a, b) => {
    if (!C.enabled) return 'Books are not copied right now.';
    if (!live(b)) return 'There is no such book.';
    if (b.author.profile !== profile(a) && !ranksIn(a, b.faction)) return `Only its author or a ranked member of the ${b.factionName} copies that book.`;
    if (!atLedger(a)) return "Books are copied at a Scholars' Ledger. Choose \"Copy a book\" there.";
    if (recent(a, COPIES).length >= C.copiesPerWeek) return `You have made ${C.copiesPerWeek} copies this week, the most a week allows.`;
    if (held(a) >= C.maxHeld) return `Your library holds ${C.maxHeld} copies already. Give some away first.`;
    return '';
  };
  const copy = (a, b) => {
    const why = copyRefusal(a, b); if (why) return why;
    const c = costOf(b.pages.length, b.binding, true), short = shortOf(a, c);
    if (short.length) return `A copy of that book needs ${costText(c)}. Short: ${short.join(', ')}.`;
    if (!pay(a, c)) return 'The materials could not be taken. Try again.';
    b.copies = (Number(b.copies) || 0) + 1; save();
    addCopies(a, b.id, 1); stamp(a, COPIES);
    audit(`BOOKAUTHOR ${who(a)} copied book #${b.id} (copy ${b.copies})`);
    return '';
  };

  // ---- reading ----------------------------------------------------------------------------------------------------------
  const send = (a, text) => personal(a, text);
  const readChat = (a, b, page) => {
    const n = Math.min(Math.max(1, Number(page) || 1), b.pages.length);
    const body = b.pages[n - 1];
    send(a, `${b.title}, by ${b.author.name} of the ${b.factionName}. Page ${n} of ${b.pages.length}:`);
    for (let i = 0; i < body.length; i += C.chatChunk) send(a, body.slice(i, i + C.chatChunk));
    if (n < b.pages.length) send(a, `/books read #${b.id} ${n + 1} for the next page.`);
  };
  const open = (a, b, page) => {
    if (!live(b)) return send(a, 'The ink has run; nothing can be read.');
    if (!hasUiCap(a, 'book')) return readChat(a, b, page);
    openWidget(a, { type: 'book', id: BOOK_WIDGET_ID, mode: 'read', bookId: b.id, title: b.title, author: b.author.name, faction: b.factionName,
      binding: b.binding, pages: b.pages.slice(), page: Math.min(Math.max(1, Number(page) || 1), b.pages.length) - 1, events: { close: 'dbo:bookClose' } }, true);
  };
  onUi('bookClose', (a) => { try { closeWidget(a, BOOK_WIDGET_ID); } catch (e) { /* gone */ } });
  // decor.js: a book on a shelf, read by anyone in the home
  globalThis.__dboBookReadFor = (a, id) => { const b = bookOf(id); open(a >>> 0, b, 1); return true; };
  globalThis.__dboBookTitle = (id) => { const b = bookOf(id); return live(b) ? b.title : ''; };
  globalThis.__dboBookInLibrary = (a, q) => { const b = inLib(a >>> 0, q); return b ? { id: b.id, title: b.title } : null; };

  // ---- the ledger rows (salvage.js) and the writer -----------------------------------------------------------------------
  globalThis.__dboBooksLedgerActions = (a) => (C.enabled && writerOrder(a) ? [{ id: 'books:write', label: 'Write a book' }, { id: 'books:copy', label: 'Copy a book' }] : []);
  const copyable = (a) => Object.values(db().books).filter((b) => live(b) && (b.author.profile === profile(a) || ranksIn(a, b.faction))).sort((x, y) => x.title.localeCompare(y.title));
  globalThis.__dboBooksLedgerOpen = (a, kind, target) => {
    a >>>= 0;
    S.ledger.set(a, { target: target >>> 0, until: Date.now() + C.ledgerMinutes * 60000 });
    if (kind === 'copy') {
      const rows = copyable(a).slice(0, 40);
      if (!rows.length) { send(a, 'There is no book you may copy yet.'); return false; }
      openWidget(a, { type: 'contextMenu', id: COPY_MENU_ID, mode: 'menu', targetName: 'Which book will you copy?',
        actions: rows.map((b) => ({ id: `bc:${b.id}`, label: `${b.title} (${costText(costOf(b.pages.length, b.binding, true))})` })),
        events: { action: 'dbo:booksCopyChoose', close: 'dbo:booksCopyClose' } }, true);
      return true;
    }
    const why = writeRefusal(a);
    if (why) { send(a, why); return false; }
    if (!hasUiCap(a, 'book')) {
      send(a, `Write at the ledger in chat: /books draft <title>, then /books page <text> (and /books newpage), /books preview, /books finish [tome|book|scroll]. A page holds ${C.pageChars} characters, a book ${C.maxPages} pages.`);
      return true;
    }
    const nonce = require('crypto').randomBytes(8).toString('hex');
    S.nonces.set(a, nonce);
    openWidget(a, { type: 'book', id: BOOK_WIDGET_ID, mode: 'write', nonce, maxPages: C.maxPages, pageChars: C.pageChars, titleMax: C.titleMax,
      costs: { tome: costText(costOf(1, 'tome', false)), book: costText(costOf(1, 'book', false)), scroll: costText(costOf(1, 'scroll', false)) },
      perPage: `${C.paperPerPage} Paper Roll a page`, events: { write: 'dbo:bookWrite', close: 'dbo:bookClose' } }, true);
    return true;
  };
  onUi('booksCopyChoose', (a, args) => {
    try { closeWidget(a, COPY_MENU_ID); } catch (e) { /* gone */ }
    const m = /^bc:(\d+)$/.exec(String((args || [])[0] || ''));
    if (!m) return;
    const b = bookOf(m[1]), why = copy(a, b);
    send(a, why || `You copy ${b.title}. It is in your library (/books).`);
  });
  onUi('booksCopyClose', (a) => { try { closeWidget(a, COPY_MENU_ID); } catch (e) { /* gone */ } });
  onUi('bookWrite', (a, args) => {
    const [nonce, title, pagesJson, binding] = Array.isArray(args) ? args : [];
    if (!nonce || S.nonces.get(a >>> 0) !== String(nonce)) return send(a, 'That page is out of date. Open the ledger again.');
    let pages = null; try { pages = JSON.parse(String(pagesJson || '[]')); } catch (e) { pages = null; }
    const why = write(a, title, pages, String(binding || 'book'));
    if (why) return send(a, why);
    S.nonces.delete(a >>> 0);
    try { closeWidget(a, BOOK_WIDGET_ID); } catch (e) { /* gone */ }
    send(a, `You finish writing ${String(title).trim()}. It is in your library (/books).`);
  });

  // ---- /books ------------------------------------------------------------------------------------------------------------
  const draftOf = (a) => S.drafts.get(a >>> 0) || null;
  registerChatCommand('books', (a, args) => {
    const line = String(args || '').trim();
    const sp = line.indexOf(' ');
    const sub = (sp < 0 ? line : line.slice(0, sp)).toLowerCase();
    const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
    if (!sub || sub === 'list' && !isAdmin(a)) {
      const ids = listOf(a);
      if (!ids.length) return send(a, 'Your library is empty. A scholar of the colleges, House Telvanni or the Bards College writes books at a Scholars\' Ledger.');
      send(a, `Your library (${held(a)} cop${held(a) === 1 ? 'y' : 'ies'}): read one with /books read <number>.`);
      ids.forEach((id, i) => { const b = bookOf(id); send(a, `${i + 1}. ${b.title}, by ${b.author.name} (${library(a)[id]} cop${library(a)[id] === 1 ? 'y' : 'ies'})`); });
      return;
    }
    if (sub === 'read') {
      const m = /^(.*?)(?:\s+(\d+))?$/.exec(rest);
      const b = inLib(a, m[1]) || (isAdmin(a) ? find(m[1]) : null);
      if (!b) return send(a, 'That book is not in your library. /books lists it.');
      return open(a, b, m[2]);
    }
    if (sub === 'give') {
      const words = rest.split(/\s+/);
      if (words.length < 2) return send(a, 'Use: /books give <player> <title or number> [count]');
      const t = (findByName(words[0]) || 0) >>> 0;
      if (!t || t === (a >>> 0)) return send(a, `No one called "${words[0]}" is here.`);
      if (distanceMeters(a, t) > C.giveMeters) return send(a, 'Stand closer to hand a book over.');
      const countM = /\s(\d+)$/.exec(words.slice(1).join(' '));
      const n = countM && words.length > 2 ? Math.max(1, Number(countM[1])) : 1;
      const q = countM && words.length > 2 ? words.slice(1, -1).join(' ') : words.slice(1).join(' ');
      const b = inLib(a, q);
      if (!b || library(a)[String(b.id)] < n) return send(a, 'You do not have that many copies of that book.');
      if (held(t) + n > C.maxHeld) return send(a, 'Their library is full.');
      if (!takeCopies(a, b.id, n)) return send(a, 'That could not be done. Try again.');
      addCopies(t, b.id, n);
      audit(`BOOKAUTHOR ${who(a)} gave ${n} cop${n === 1 ? 'y' : 'ies'} of book #${b.id} to ${who(t)}`);
      send(a, `You hand over ${n === 1 ? 'a copy' : `${n} copies`} of ${b.title}.`);
      return send(t, `${display(a)} hands you ${n === 1 ? 'a copy' : `${n} copies`} of ${b.title}. /books lists your library.`);
    }
    if (sub === 'copy') {
      const b = find(rest, a);
      const why = copy(a, b);
      return send(a, why || `You copy ${b.title}. It is in your library.`);
    }
    if (sub === 'draft') {
      const why = writeRefusal(a); if (why) return send(a, why);
      const t = rest.replace(/\s+/g, ' ').trim();
      const bad = titleProblem(t); if (bad) return send(a, bad);
      S.drafts.set(a >>> 0, { title: t, pages: [''] });
      return send(a, `A draft titled ${t}. Add text with /books page <text>, start a new page with /books newpage, then /books finish [tome|book|scroll].`);
    }
    if (sub === 'page' || sub === 'newpage' || sub === 'preview' || sub === 'finish' || sub === 'discard') {
      const d = draftOf(a);
      if (!d) return send(a, 'You have no draft. Start one at the ledger with /books draft <title>.');
      if (sub === 'discard') { S.drafts.delete(a >>> 0); return send(a, 'The draft is thrown away.'); }
      if (sub === 'newpage') {
        if (!d.pages[d.pages.length - 1].trim()) return send(a, 'This page is still empty.');
        if (d.pages.length >= C.maxPages) return send(a, `A book holds at most ${C.maxPages} pages.`);
        d.pages.push(''); return send(a, `Page ${d.pages.length} begins.`);
      }
      if (sub === 'page') {
        const cur = d.pages.length - 1, next = (d.pages[cur] ? `${d.pages[cur]} ` : '') + rest;
        if (!rest) return send(a, 'Use: /books page <text>');
        if (next.length > C.pageChars) return send(a, `Page ${cur + 1} would be over ${C.pageChars} characters (${next.length}). /books newpage starts another.`);
        const bad = prose(rest); if (bad) return send(a, `The word "${bad}" is not allowed in a book.`);
        d.pages[cur] = next; return send(a, `Page ${cur + 1}: ${next.length} of ${C.pageChars} characters.`);
      }
      if (sub === 'preview') { d.pages.forEach((p, i) => send(a, `Page ${i + 1}: ${p || '(empty)'}`)); return; }
      const why = write(a, d.title, d.pages, (rest || 'book').toLowerCase());
      return send(a, why || `You finish writing ${d.title}. It is in your library (/books).`);
    }
    if (!isAdmin(a)) return send(a, 'Use: /books, /books read <title|n> [page], /books give <player> <title|n> [count], /books copy <title|n>');
    // ---- staff ----
    if (sub === 'remove') {
      const b = find(rest);
      if (!b || b.removed) return send(a, 'No such book. /books list shows them; use its #id.');
      b.removed = { by: profile(a), at: Date.now() };
      if (!save()) { delete b.removed; return send(a, 'The book could not be removed (saving failed).'); }
      let n = 0;
      for (const p of onlineActors()) { const l = get(p, LIB, null); if (l && l[String(b.id)]) { library(p); n++; } }
      let shelves = 0;
      try { if (typeof globalThis.__dboDecorRemoveBook === 'function') shelves = Number(globalThis.__dboDecorRemoveBook(b.id)) || 0; } catch (e) { log('books: decor removal failed', e.message); }
      audit(`BOOKAUTHOR ${who(a)} removed book #${b.id} of author profile ${b.author.profile}: ${n} online librar${n === 1 ? 'y' : 'ies'}, ${shelves} shelf piece(s)`);
      return send(a, `Book #${b.id} is removed: from ${n} online librar${n === 1 ? 'y' : 'ies'} now, from the rest as they are next read, and from ${shelves} shelf piece(s).`);
    }
    if (sub === 'list') {
      const q = norm(rest);
      const rows = Object.values(db().books).filter((b) => !q || norm(b.author.name).includes(q) || b.faction === q).slice(-30);
      if (!rows.length) return send(a, 'No books.');
      for (const b of rows) send(a, `#${b.id} ${b.title}, by ${b.author.name} (profile ${b.author.profile}, ${b.faction}), ${b.pages.length} page(s), ${b.copies} cop${b.copies === 1 ? 'y' : 'ies'}${b.removed ? ', REMOVED' : ''}`);
      return;
    }
    if (sub === 'show') {
      const m = /^(#?\d+)(?:\s+(\d+))?$/.exec(rest);
      const b = m ? bookOf(m[1].replace('#', '')) : null;
      if (!b) return send(a, 'Use: /books show <#id> [page]');
      return readChat(a, b, m[2]);
    }
    return send(a, 'Staff: /books remove <title|#id>, /books list [author|faction], /books show <#id> [page]');
  }, { help: 'your library of written books: read <title|n> [page], give <player> <title|n> [count], copy <title|n>; writers draft at a Scholars\' Ledger' });

  every('authoredBooks', 60000, () => {
    const now = Date.now();
    for (const [k, s] of S.ledger) if (now > s.until) S.ledger.delete(k);
    for (const k of S.drafts.keys()) if (!onlineActors().includes(k)) S.drafts.delete(k);
  });
  log(`authored books ${C.enabled ? 'on' : 'off'}: ${Object.values(db().books).filter(live).length} book(s), factions ${[...FACTIONS].join(', ')}`);
  return { write, copy, library, costOf, db, find, writeRefusal };
};
