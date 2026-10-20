// DragonBreak Online: the Personal Journal tab of the F3 journal (staff suggestion "Personal Journal", mestreugway 6 Oct;
// design ~/claude-nate-release/specs/character-journal-design.md, phase 2). Loaded by gamemode.js after journal.js, whose
// section registry and hooks it uses; config "journalNotes" in gamemode-config.json, hot reloadable.
//
// Private entries in folders, a "Received" part for writings others gave the player, and writing an entry out as a physical
// note, letter, book or journal at a writing desk. Only the player sees their own tab: a staff member reading another's
// journal (journal.js __dboJournalOpenFor) never gets it.
//
// Written works are one BOOK record each, from a pool of blank records in a plugin (written-bases.json, as house-keys.json
// does for keys): the game stacks items of one record whatever their name, so two works on one record could not be told
// apart in a trade. A pool record is given to one work only and never reused. The item carries the title as its `name`.
// Its text lives in the registry (journal/written.json), never on the item: any holder can read it in their journal and
// keep a copy under Received. With the pool empty (before the plugin), writing out says so and nothing else changes.
//
//   Section notes (payload.notes): { ready, limits, folders, entries (no text), received, carried, open, write }
//   Client -> server: journalNotes [nonce, op, ...]
//     save [id|'', folder, title, text]   delete [id]   move [id, folder]
//     folderAdd [name]   folderRename [id, name]   folderDelete [id] (its entries go to no folder)
//     keep [work]   forget [receivedId]   write [entryId, kind, signed '1'|'']
//   Opening an entry is a tab switch with a focus: journalTab [nonce, 'notes', { entry | received | work | none }].
//
// Files: journal/notes/<journal key>.json per character (the key journalstats.js keeps on the character), read and written
// off the main thread; journal/written.json the registry { v, seq, works: { id: { id, base, kind, title, text, author,
// signed, at } } }, read once a process and written off the main thread.
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, onUi, distanceMeters } = api;
  const audit = typeof api.audit === 'function' ? api.audit : () => {};
  const who = typeof api.who === 'function' ? api.who : (a) => `#${(a >>> 0).toString(16)}`;
  const nameOf = typeof api.nameOf === 'function' ? api.nameOf : () => '';
  const personal = typeof api.personal === 'function' ? api.personal : () => {};
  const raw = (api.cfg && api.cfg.journalNotes) || {};
  const C = Object.assign({
    enabled: true, dir: 'journal/notes',
    entryMax: 4000, titleMax: 60, entriesMax: 200, foldersMax: 20, folderNameMax: 30, receivedMax: 100,
  }, raw);
  const KINDS_DEFAULT = { note: { label: 'Note', paper: 1 }, letter: { label: 'Letter', paper: 3 }, book: { label: 'Book', paper: 10 }, journal: { label: 'Journal', paper: 20 } };
  C.write = Object.assign({
    enabled: true, requireDesk: true, deskMeters: 3, paperId: '7cba1:BSHeartland.esm', nameItems: true,
    basesFile: 'written-bases.json', registry: 'journal/written.json', kinds: KINDS_DEFAULT,
  }, raw.write || {});
  const KINDS = C.write.kinds && typeof C.write.kinds === 'object' ? C.write.kinds : KINDS_DEFAULT;
  const TAB = 'notes';
  const DIR = path.resolve(C.dir);
  const REG = path.resolve(C.write.registry);

  // docs: key -> notes doc; loading: key -> actors waiting for it; writing/dirty: the one write in flight per key;
  // focus: actor -> { kind, id } the open page; desk: actor -> the writing desk or ledger last used
  const N = globalThis.__dboJournalNotes || (globalThis.__dboJournalNotes = {});
  for (const k of ['docs', 'loading', 'focus', 'desk']) if (!(N[k] instanceof Map)) N[k] = new Map();
  for (const k of ['writing', 'dirty']) if (!(N[k] instanceof Set)) N[k] = new Set();

  const get = (a, k, d) => { try { const v = mp.get(a, k); return v === undefined || v === null ? d : v; } catch (e) { return d; } };
  const keyOf = (a) => { const d = globalThis.__dboJournalDoc; try { return d && typeof d.keyOf === 'function' ? d.keyOf(a >>> 0) : null; } catch (e) { return null; } };
  // Newlines stay; every other control character goes
  const clean = (v, max) => String(v === undefined || v === null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').slice(0, max);
  const line = (v, max) => clean(v, max).replace(/\s+/g, ' ').trim();
  const redraw = (a) => { try { if (typeof globalThis.__dboJournalRedraw === 'function') globalThis.__dboJournalRedraw(a >>> 0, TAB); } catch (e) { /* no journal */ } };

  // ---- the notes files -------------------------------------------------------------------------------------------------
  const blankDoc = () => ({ v: 1, seq: 0, folders: [], entries: [], received: [] });
  const normal = (d) => {
    const o = d && typeof d === 'object' ? d : {};
    const out = blankDoc();
    out.seq = Number(o.seq) || 0;
    for (const k of ['folders', 'entries', 'received']) out[k] = Array.isArray(o[k]) ? o[k].filter((x) => x && typeof x === 'object' && x.id) : [];
    return out;
  };
  const fileOf = (k) => path.join(DIR, `${k}.json`);
  // The doc, or null while it is read (the tab shows "turning the page" and is drawn again when it arrives)
  const docOf = (a) => {
    const k = keyOf(a);
    if (!k) return null;
    if (N.docs.has(k)) return N.docs.get(k);
    const waiting = N.loading.get(k);
    if (waiting) { waiting.add(a >>> 0); return null; }
    N.loading.set(k, new Set([a >>> 0]));
    fs.readFile(fileOf(k), 'utf8', (e, text) => {
      let d = null;
      if (e && e.code !== 'ENOENT') log(`journal notes: cannot read ${k}: ${e.message}`);
      else if (!e) { try { d = JSON.parse(text); } catch (e2) { log(`journal notes: ${k} is unreadable, kept aside`); fs.rename(fileOf(k), `${fileOf(k)}.bad-${Date.now()}`, () => {}); } }
      const who2 = N.loading.get(k) || new Set();
      N.loading.delete(k);
      if (e && e.code !== 'ENOENT') return; // asked again on the next draw
      N.docs.set(k, normal(d));
      for (const x of who2) redraw(x);
    });
    return null;
  };
  // One write in flight per file, through its own temporary file; a change meanwhile is written when it lands
  const save = (k) => {
    if (N.writing.has(k)) { N.dirty.add(k); return; }
    const d = N.docs.get(k); if (!d) return;
    let body; try { body = JSON.stringify(d); } catch (e) { log('journal notes: cannot serialise', k, e.message); return; }
    N.writing.add(k);
    const f = fileOf(k), tmp = `${f}.${process.pid}.${Date.now().toString(36)}.tmp`;
    const done = (e) => {
      N.writing.delete(k);
      if (e) { log(`journal notes: write failed for ${k}: ${e.message}`); fs.unlink(tmp, () => {}); }
      if (e || N.dirty.has(k)) { N.dirty.delete(k); setTimeout(() => save(k), e ? 5000 : 0); }
    };
    fs.mkdir(DIR, { recursive: true }, (e0) => {
      if (e0) return done(e0);
      fs.writeFile(tmp, body, (e1) => { if (e1) return done(e1); fs.rename(tmp, f, done); });
    });
  };
  const nextId = (d, p) => `${p}${(++d.seq).toString(36)}`;

  // ---- the registry of written works --------------------------------------------------------------------------------------
  const R = (() => {
    if (N.reg && N.regFile === REG) return N.reg;
    let r = null;
    try { r = JSON.parse(fs.readFileSync(REG, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') log(`journal notes: ${REG} unreadable: ${e.message}`); }
    N.reg = { v: 1, seq: Number(r && r.seq) || 0, works: r && r.works && typeof r.works === 'object' ? r.works : {} };
    N.regFile = REG;
    return N.reg;
  })();
  const saveReg = () => {
    if (N.regWriting) { N.regDirty = true; return; }
    let body; try { body = JSON.stringify(R); } catch (e) { log('journal notes: cannot serialise the registry', e.message); return; }
    N.regWriting = true;
    const tmp = `${REG}.${process.pid}.${Date.now().toString(36)}.tmp`;
    const done = (e) => {
      N.regWriting = false;
      if (e) { log(`journal notes: the registry write failed: ${e.message}`); fs.unlink(tmp, () => {}); }
      if (e || N.regDirty) { N.regDirty = false; setTimeout(saveReg, e ? 5000 : 0); }
    };
    fs.mkdir(path.dirname(REG), { recursive: true }, (e0) => {
      if (e0) return done(e0);
      fs.writeFile(tmp, body, (e1) => { if (e1) return done(e1); fs.rename(tmp, REG, done); });
    });
  };
  // The pool: kind -> [{ desc, id }] of BOOK records that resolve; re-read when written-bases.json changes
  const idOf = (desc) => { try { return mp.getIdFromDesc(String(desc)) >>> 0; } catch (e) { return 0; } };
  const isBook = (id) => {
    if (typeof mp.lookupEspmRecordById !== 'function') return true;
    try { const r = mp.lookupEspmRecordById(id); return !!(r && r.record && String(r.record.type) === 'BOOK'); } catch (e) { return false; }
  };
  const pool = () => {
    const f = path.resolve(C.write.basesFile);
    let m = -1; try { m = fs.statSync(f).mtimeMs; } catch (e) { m = -1; }
    if (N.pool && N.poolMtime === m && N.poolFile === f) return N.pool;
    let j = {}; try { j = m >= 0 ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; } catch (e) { log(`journal notes: ${f} unreadable: ${e.message}`); j = {}; }
    const out = {};
    for (const kind of Object.keys(KINDS)) {
      out[kind] = (Array.isArray(j[kind]) ? j[kind] : []).filter((d) => typeof d === 'string' && d.includes(':'))
        .map((desc) => ({ desc, id: idOf(desc) })).filter((x) => x.id && isBook(x.id));
    }
    N.pool = out; N.poolMtime = m; N.poolFile = f; N.byBase = null;
    return out;
  };
  // base id -> work id, from the registry's pool descs (resolved once per pool or registry change)
  const byBase = () => {
    if (N.byBase && N.byBaseSize === Object.keys(R.works).length) return N.byBase;
    const m = new Map();
    for (const w of Object.values(R.works)) { const id = w && w.base ? idOf(w.base) : 0; if (id) m.set(id, w.id); }
    N.byBase = m; N.byBaseSize = Object.keys(R.works).length;
    return m;
  };
  const usedDescs = () => new Set(Object.values(R.works).map((w) => w && w.base));
  const freeBase = (kind) => { const used = usedDescs(); return (pool()[kind] || []).find((x) => !used.has(x.desc)) || null; };
  const freeCount = (kind) => { const used = usedDescs(); return (pool()[kind] || []).filter((x) => !used.has(x.desc)).length; };
  const workOfBase = (baseId) => { pool(); const id = byBase().get(baseId >>> 0); return id ? R.works[id] || null : null; };

  // ---- the pack ----------------------------------------------------------------------------------------------------------
  const entriesOf = (a) => { const inv = get(a, 'inventory', { entries: [] }); return Array.isArray(inv && inv.entries) ? inv.entries.map((e) => Object.assign({}, e)) : []; };
  const usable = (e) => e && !e.worn && !e.wornLeft && Number(e.count) > 0;
  const paperId = () => idOf(C.write.paperId);
  const paperOf = (entries) => { const p = paperId(); return p ? entries.filter((e) => usable(e) && (Number(e.baseId) >>> 0) === p && !e.name).reduce((n, e) => n + (Number(e.count) || 0), 0) : 0; };
  // The works this player carries: one row per work
  const carriedOf = (a, entries) => {
    const out = new Map();
    for (const e of entries || entriesOf(a)) {
      if (!e || !(Number(e.count) > 0)) continue;
      const w = workOfBase(Number(e.baseId) >>> 0);
      if (w && !out.has(w.id)) out.set(w.id, w);
    }
    return [...out.values()];
  };

  // ---- the writing desk -------------------------------------------------------------------------------------------------
  // salvage.js tells us each writing desk or ledger a player uses (sitting at a desk is using it)
  globalThis.__dboWritingDeskSeen = (a, target) => { N.desk.set(a >>> 0, { target: target >>> 0, at: Date.now() }); };
  const atDesk = (a) => {
    if (!C.write.requireDesk) return true;
    const d = N.desk.get(a >>> 0);
    if (!d) return false;
    let m = Infinity; try { m = distanceMeters(a >>> 0, d.target); } catch (e) { m = Infinity; }
    return m <= Number(C.write.deskMeters);
  };

  // ---- the view ------------------------------------------------------------------------------------------------------------
  const limits = () => ({ entryMax: C.entryMax, titleMax: C.titleMax, entriesMax: C.entriesMax, foldersMax: C.foldersMax, folderNameMax: C.folderNameMax, receivedMax: C.receivedMax });
  const authorText = (w) => (w.signed && w.author && w.author.name ? String(w.author.name) : 'Unsigned');
  const kindLabel = (k) => String((KINDS[k] && KINDS[k].label) || k);
  const openView = (a, d, f, carried) => {
    if (!f) return null;
    if (f.kind === 'entry') {
      const e = d.entries.find((x) => x.id === f.id);
      return e ? { kind: 'entry', id: e.id, folder: e.folder || '', title: e.title, text: e.text, at: e.at, edited: e.edited || 0, written: e.written || 0 } : null;
    }
    if (f.kind === 'received') {
      const r = d.received.find((x) => x.id === f.id);
      return r ? { kind: 'received', id: r.id, title: r.title, text: r.text, author: r.author, itemKind: kindLabel(r.itemKind), at: r.at } : null;
    }
    if (f.kind === 'work') {
      const w = carried.find((x) => x.id === f.id);
      return w ? { kind: 'work', id: w.id, title: w.title, text: w.text, author: authorText(w), itemKind: kindLabel(w.kind), at: w.at, kept: d.received.some((r) => r.work === w.id) } : null;
    }
    return null;
  };
  const writeView = (a, entries) => {
    const on = !!C.write.enabled;
    const kinds = Object.entries(KINDS).map(([id, k]) => ({ id, label: String(k.label || id), paper: Number(k.paper) || 0, free: freeCount(id) }));
    return { on, atDesk: atDesk(a), requireDesk: !!C.write.requireDesk, paper: paperOf(entries), kinds };
  };
  const focusFrom = (o) => {
    const f = o && o.focus && typeof o.focus === 'object' ? o.focus : null;
    if (!f) return undefined;
    for (const kind of ['entry', 'received', 'work']) if (typeof f[kind] === 'string') return f[kind] ? { kind, id: f[kind].slice(0, 24) } : null;
    if (f.none) return null;
    return undefined;
  };
  const view = (a, o) => {
    if (o && o.readOnly) return null;
    const f = focusFrom(o);
    if (f !== undefined) { if (f) N.focus.set(a >>> 0, f); else N.focus.delete(a >>> 0); }
    const d = docOf(a);
    if (!d) return { ready: false, limits: limits() };
    const entries = entriesOf(a);
    const carried = carriedOf(a, entries);
    const counts = new Map();
    for (const e of d.entries) counts.set(e.folder || '', (counts.get(e.folder || '') || 0) + 1);
    return {
      ready: true, limits: limits(),
      folders: d.folders.map((x) => ({ id: x.id, name: x.name, count: counts.get(x.id) || 0 })),
      entries: d.entries.map((e) => ({ id: e.id, folder: e.folder || '', title: e.title, at: e.at, edited: e.edited || 0, length: String(e.text || '').length })),
      received: d.received.map((r) => ({ id: r.id, title: r.title, author: r.author, itemKind: kindLabel(r.itemKind), at: r.at })),
      carried: carried.map((w) => ({ id: w.id, title: w.title, author: authorText(w), itemKind: kindLabel(w.kind), kept: d.received.some((r) => r.work === w.id) })),
      open: openView(a, d, N.focus.get(a >>> 0), carried),
      write: writeView(a, entries),
    };
  };
  const sections = globalThis.__dboJournalSections || (globalThis.__dboJournalSections = {});
  // Only the player's own journal: never in a staff member's read-only view of another's (m.viewer is who looks)
  sections[TAB] = {
    visible: (a, m) => !!C.enabled && (!m || m.viewer === undefined || (m.viewer >>> 0) === (a >>> 0)),
    view, label: () => 'Personal Journal',
  };

  // ---- the actions ----------------------------------------------------------------------------------------------------------
  const prose = (t) => { try { return typeof globalThis.__dboProseProblem === 'function' ? globalThis.__dboProseProblem(t) : null; } catch (e) { return null; } };
  const OPS = {
    save: (a, d, k, args) => {
      const id = String(args[0] || '').slice(0, 24);
      const folder = String(args[1] || '').slice(0, 24);
      const title = line(args[2], C.titleMax) || 'Untitled';
      const text = clean(args[3], C.entryMax);
      if (folder && !d.folders.some((x) => x.id === folder)) return ['That folder is gone.', false];
      if (id) {
        const e = d.entries.find((x) => x.id === id);
        if (!e) return ['That entry is gone.', false];
        Object.assign(e, { folder, title, text, edited: Date.now() });
        N.focus.set(a >>> 0, { kind: 'entry', id });
        return ['Saved.', true];
      }
      if (d.entries.length >= C.entriesMax) return [`Your journal holds ${C.entriesMax} entries. Remove one first.`, false];
      const e = { id: nextId(d, 'e'), folder, title, text, at: Date.now() };
      d.entries.push(e);
      N.focus.set(a >>> 0, { kind: 'entry', id: e.id });
      return ['Written in your journal.', true];
    },
    delete: (a, d, k, args) => {
      const i = d.entries.findIndex((x) => x.id === String(args[0] || ''));
      if (i < 0) return ['That entry is gone.', false];
      d.entries.splice(i, 1);
      N.focus.delete(a >>> 0);
      return ['The page is torn out.', true];
    },
    move: (a, d, k, args) => {
      const e = d.entries.find((x) => x.id === String(args[0] || ''));
      const folder = String(args[1] || '').slice(0, 24);
      if (!e) return ['That entry is gone.', false];
      if (folder && !d.folders.some((x) => x.id === folder)) return ['That folder is gone.', false];
      e.folder = folder;
      return ['Moved.', true];
    },
    folderAdd: (a, d, k, args) => {
      const name = line(args[0], C.folderNameMax);
      if (!name) return ['Name the folder first.', false];
      if (d.folders.length >= C.foldersMax) return [`You can keep ${C.foldersMax} folders.`, false];
      if (d.folders.some((x) => x.name.toLowerCase() === name.toLowerCase())) return ['You already have a folder of that name.', false];
      d.folders.push({ id: nextId(d, 'f'), name });
      return [`Folder "${name}" made.`, true];
    },
    folderRename: (a, d, k, args) => {
      const f = d.folders.find((x) => x.id === String(args[0] || ''));
      const name = line(args[1], C.folderNameMax);
      if (!f) return ['That folder is gone.', false];
      if (!name) return ['Name the folder first.', false];
      if (d.folders.some((x) => x !== f && x.name.toLowerCase() === name.toLowerCase())) return ['You already have a folder of that name.', false];
      f.name = name;
      return ['Renamed.', true];
    },
    folderDelete: (a, d, k, args) => {
      const i = d.folders.findIndex((x) => x.id === String(args[0] || ''));
      if (i < 0) return ['That folder is gone.', false];
      const id = d.folders[i].id;
      d.folders.splice(i, 1);
      let n = 0;
      for (const e of d.entries) if (e.folder === id) { e.folder = ''; n++; }
      return [n ? `Folder removed; its ${n} ${n === 1 ? 'entry is' : 'entries are'} kept outside any folder.` : 'Folder removed.', true];
    },
    keep: (a, d, k, args) => {
      const w = carriedOf(a).find((x) => x.id === String(args[0] || ''));
      if (!w) return ['You do not carry that writing.', false];
      if (d.received.some((r) => r.work === w.id)) return ['It is already in your journal.', false];
      if (d.received.length >= C.receivedMax) return [`Your journal keeps ${C.receivedMax} received writings. Remove one first.`, false];
      const r = { id: nextId(d, 'r'), work: w.id, title: w.title, text: w.text, author: authorText(w), itemKind: w.kind, at: Date.now() };
      d.received.push(r);
      N.focus.set(a >>> 0, { kind: 'received', id: r.id });
      return [`"${w.title}" is copied into your journal, under Received.`, true];
    },
    forget: (a, d, k, args) => {
      const i = d.received.findIndex((x) => x.id === String(args[0] || ''));
      if (i < 0) return ['That writing is gone.', false];
      d.received.splice(i, 1);
      N.focus.delete(a >>> 0);
      return ['Removed from your journal.', true];
    },
    write: (a, d, k, args) => writeOut(a, d, String(args[0] || ''), String(args[1] || ''), String(args[2] || '') === '1'),
  };
  // An entry made into a physical item: a free pool record of that kind, the paper spent, the work in the registry first,
  // then one inventory write (paper out, work in); a write that fails takes the work out of the registry again
  const writeOut = (a, d, entryId, kind, signed) => {
    if (!C.write.enabled) return ['Writing out entries is not open just now.', false];
    const e = d.entries.find((x) => x.id === entryId);
    if (!e) return ['That entry is gone.', false];
    if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) return ['Choose what to write it as.', false];
    if (!String(e.text || '').trim()) return ['There is nothing on that page to write out.', false];
    if (!atDesk(a)) return ['Sit at a writing desk, or stand at a ledger, to write it out.', false];
    const bad = prose(e.title) || prose(e.text);
    if (bad) return [`The word "${bad}" will not do in something others will read. Change it first.`, false];
    const slot = freeBase(kind);
    if (!slot) return [`There are no blank ${kindLabel(kind).toLowerCase()}s to be had just now.`, false];
    const cost = Math.max(0, Number(KINDS[kind].paper) || 0);
    const before = entriesOf(a);
    if (paperOf(before) < cost) return [`A ${kindLabel(kind).toLowerCase()} takes ${cost} paper; you carry ${paperOf(before)}.`, false];
    const after = before.map((x) => Object.assign({}, x));
    let left = cost;
    const p = paperId();
    for (const x of after) { if (!left) break; if (usable(x) && (Number(x.baseId) >>> 0) === p && !x.name) { const t = Math.min(left, Number(x.count) || 0); x.count -= t; left -= t; } }
    if (left) return ['Your paper could not be found. Try again.', false];
    const item = { baseId: slot.id >>> 0, count: 1 };
    if (C.write.nameItems) item.name = e.title;
    const id = `W${(++R.seq).toString(36).toUpperCase()}`;
    R.works[id] = { id, base: slot.desc, kind, title: e.title, text: e.text, signed: !!signed, at: Date.now(), author: { name: String(nameOf(a) || ''), key: keyOf(a) || '' } };
    N.byBase = null;
    let ok = false;
    try { mp.set(a >>> 0, 'inventory', { entries: after.filter((x) => Number(x.count) > 0).concat([item]) }); ok = true; } catch (err) { log('journal notes: inventory write failed', err.message); }
    if (!ok) { delete R.works[id]; N.byBase = null; return ['Your pages could not be bound. Nothing was spent; try again.', false]; }
    saveReg();
    e.written = Date.now();
    audit(`WRITTEN ${who(a)} wrote ${kind} ${id} on ${slot.desc} "${e.title}" (${String(e.text).length} chars, ${signed ? 'signed' : 'unsigned'}) for ${cost} paper`);
    log(`journal notes: ${who(a)} wrote out ${id} as a ${kind}; ${freeCount(kind)} blank ${kind} records left`);
    if (freeCount(kind) < 10) log(`journal notes: only ${freeCount(kind)} blank ${kind} records left in ${C.write.basesFile}`);
    return [`You write out "${e.title}" as a ${kindLabel(kind).toLowerCase()}${signed ? ', signed' : ''}. ${cost} paper spent.`, true];
  };
  // Changes the doc only when the op says so; a refusal leaves the file alone
  const MUTATES = new Set(['save', 'delete', 'move', 'folderAdd', 'folderRename', 'folderDelete', 'keep', 'forget', 'write']);
  const act = (a, op, args) => {
    if (!C.enabled) return { tab: TAB, text: 'Your personal journal is closed just now.', kind: 'refused' };
    const fn = Object.prototype.hasOwnProperty.call(OPS, op) ? OPS[op] : null;
    if (!fn) return { tab: TAB, text: 'Unknown action.', kind: 'refused' };
    const k = keyOf(a);
    const d = k ? N.docs.get(k) : null;
    if (!d) { docOf(a); return { tab: TAB, text: 'Your journal is still being opened. Try again in a moment.', kind: 'refused' }; }
    const [text, ok] = fn(a, d, k, args);
    if (ok && MUTATES.has(op)) save(k);
    return { tab: TAB, text, kind: ok ? 'ok' : 'refused' };
  };
  onUi('journalNotes', (a, args) => {
    const nonce = String((args || [])[0] || '');
    if (typeof globalThis.__dboJournalFresh !== 'function' || !globalThis.__dboJournalFresh(a, nonce)) return;
    const op = String((args || [])[1] || '').slice(0, 16);
    const rest = (args || []).slice(2, 6);
    globalThis.__dboJournalLimited(a, () => act(a >>> 0, op, rest));
  });

  // ---- reading a written work from the pack -----------------------------------------------------------------------------
  // spells.js's read hook asks this first: our works open in the journal at their page. The vanilla Book menu shows the
  // record's own blank text on top; the journal takes focus once it closes
  globalThis.__dboWrittenRead = (a, baseId) => {
    const w = workOfBase(baseId);
    if (!w) return false;
    let shown = false;
    try { shown = typeof globalThis.__dboJournalOpenTab === 'function' && !!globalThis.__dboJournalOpenTab(a >>> 0, TAB, { work: w.id }); } catch (e) { shown = false; }
    if (!shown) personal(a, `${w.title}: ${String(w.text).slice(0, 300)}${String(w.text).length > 300 ? '... (read it all in your journal, F3, after the next update)' : ''}`);
    return true;
  };
  // Staff and tools: a work by its base (the item) or its id
  globalThis.__dboWrittenWork = (x) => (typeof x === 'number' ? workOfBase(x) : R.works[String(x)] || null);

  log(`journal notes ${C.enabled ? 'on' : 'off'}: writing out ${C.write.enabled ? 'on' : 'off'}, ${Object.keys(R.works).length} works, blank records ${Object.keys(KINDS).map((k) => `${k} ${freeCount(k)}`).join(', ')}`);
  return { view, act, workOfBase, carriedOf, freeCount, docOf };
};
