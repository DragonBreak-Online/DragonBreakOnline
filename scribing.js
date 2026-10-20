// DragonBreak Online: scribing. A Master Scholar writes spell tomes and scrolls at a Scholars' Ledger (Nate and Swag, 17 Oct;
// tome writing first shipped in spells.js on 16 Oct and moved here with these rules). Loaded by gamemode.js after spells.js
// and schools.js, whose spellbook and school ranks it reads through globalThis. salvage.js's ledger menu shows "Write a
// spell tome" and "Write a scroll" to a Master Scholar (Scholar tier 4, level 90) and hands over to this file's list (MENU_ID,
// opened before the ledger menu closes: the panel handoff). Config "scribing" in gamemode-config.json, hot reloadable.
//
// Tomes. The writer knows the spell (the spellbook or the engine; never a spell on loan to them as an apprentice), and a tome
// teaches it (spells.js __dboSpellsTomeOf); a spell with no tome is never listed. By the spell's rank (tome.scrolls,
// tome.cooldownHours): Novice no scroll, 24 h; Apprentice 1 scroll, 48 h; Adept 2, 4 days; Expert 4, 7 days, any scrolls
// the writer carries (the cheapest first). Master: 5 scrolls of that spell itself and 14 days, with a co-writer: a Master of
// the spell's school (the school's meter at 90 in schools.js, Priest for Restoration) who knows the spell, stands within
// tome.coWriterMeters and accepts. Both take the 14 days, so the co-writer's own tome writing must be ready too (our call,
// 17 Oct: else a co-writer could help every day and the shared wait would mean nothing). The writer of a Master tome need
// not know the spell. One tome timer per character, whatever the rank: writing any tome starts it for that rank's hours.
// Scrolls. A spell the writer knows that has a scroll (spell-scrolls.json, written by tools/scribing/spell_scrolls.py from
// the live plugins), below Master: Master scrolls are never written. Each spends one Linen Wrap, one Charcoal (from
// woodcutting, labour.js) and one filled soul gem of any size, the smallest first; its own timer, by rank 1, 2, 3, 4 days.
// The restricted arts (spells.js seniorOnlyTomes) are written only by a Senior rank, as they are sold and taught; a removed
// or held spell is never written (spells.js __dboSpellsOpenTo).
// Materials are taken first, then the item is given; a give that fails puts the pack back as it was. Every write is audited
// with what it spent. Both timers show on the F3 journal's Skills tab, on the Scholar page (journalskills.js asks
// __dboScribingBrief), and at the top of both lists.
//
// State, on the character (survives restarts):
//   private.dboScribeTome    { at, rank, spell } the last tome written or co-written
//   private.dboScribeScroll  { at, rank, spell } the last scroll written
//   private.dboTomeWrites    { rank: ms } spells.js's per-rank record from 16 Oct, read only until a tome is written here
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, audit, display, who, cfg, openWidget, closeWidget, onUi, onlineActors, distanceMeters, giveItem } = api;

  const DEFAULTS = {
    enabled: true,
    // Scholar tier index (0 Novice .. 4 Master): Master, from Scholar 90
    scholarTier: 4,
    // How far from the ledger a choice is still made (spells.js LEDGER_REACH_M)
    ledgerMeters: 6.5,
    tome: { enabled: true, scrolls: [0, 1, 2, 4, 5], cooldownHours: [24, 48, 96, 168, 336], coWriterMeters: 10, coWriterRank: 4, offerSeconds: 60 },
    scroll: {
      enabled: true, cooldownHours: [24, 48, 72, 96],
      materials: [{ id: '34cd6:Skyrim.esm', name: 'Linen Wrap', count: 1 }, { id: '33760:Skyrim.esm', name: 'Charcoal', count: 1 }],
      soulGems: 1,
      // Pre-filled soul gem bases, smallest first (SoulGemPettyFilled .. SoulGemGrandFilled, SoulGemBlackFilled; SOUL 1..5 in
      // Skyrim.esm, checked by tools/scribing/spell_scrolls.py), and the empty bases, which count when the entry holds a soul
      // (Inventory.h's "soul": a gem filled in play keeps its base)
      filledGems: ['2e4e3:Skyrim.esm', '2e4e5:Skyrim.esm', '2e4f3:Skyrim.esm', '2e4fb:Skyrim.esm', '2e4ff:Skyrim.esm', '2e504:Skyrim.esm'],
      emptyGems: ['2e4e2:Skyrim.esm', '2e4e4:Skyrim.esm', '2e4e6:Skyrim.esm', '2e4f4:Skyrim.esm', '2e4fc:Skyrim.esm', '2e500:Skyrim.esm'],
    },
  };
  const raw = cfg.scribing || {};
  const C = Object.assign({}, DEFAULTS, raw, {
    tome: Object.assign({}, DEFAULTS.tome, raw.tome || {}),
    scroll: Object.assign({}, DEFAULTS.scroll, raw.scroll || {}),
  });
  // A list of the wrong kind falls back to its default and is logged, never thrown (a typo must not hand out tomes)
  const numbers = (obj, key, len, dflt, where) => {
    const v = obj[key];
    if (Array.isArray(v) && v.length === len && v.every((n) => Number.isFinite(Number(n)) && Number(n) >= 0)) { obj[key] = v.map(Number); return; }
    log(`scribing: config ${where}.${key} ${JSON.stringify(v)} is not ${len} numbers; ${JSON.stringify(dflt)} is used`);
    obj[key] = dflt.slice();
  };
  numbers(C.tome, 'scrolls', 5, DEFAULTS.tome.scrolls, 'tome');
  numbers(C.tome, 'cooldownHours', 5, DEFAULTS.tome.cooldownHours, 'tome');
  numbers(C.scroll, 'cooldownHours', 4, DEFAULTS.scroll.cooldownHours, 'scroll');
  if (!Array.isArray(C.scroll.materials) || !C.scroll.materials.every((m) => m && typeof m.id === 'string' && Number(m.count) >= 1)) {
    log(`scribing: config scroll.materials ${JSON.stringify(C.scroll.materials)} is not a list of { id, name, count }; the default is used`);
    C.scroll.materials = DEFAULTS.scroll.materials.slice();
  }

  const MENU_ID = 93;
  const MAX_ROWS = 12;
  const HOUR = 3600000;
  const RANKS = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'];
  const TOME = 'private.dboScribeTome';
  const SCROLL = 'private.dboScribeScroll';
  const OLD_TOME = 'private.dboTomeWrites';

  const get = (id, prop, dflt) => { try { const v = mp.get(id, prop); return v === undefined || v === null ? dflt : v; } catch (e) { return dflt; } };
  const set = (id, prop, v) => { try { mp.set(id, prop, v); return true; } catch (e) { log(`scribing: set ${prop} failed`, e.message); return false; } };
  const idOf = (desc) => { try { return mp.getIdFromDesc(String(desc)) >>> 0; } catch (e) { return 0; } };
  const descOf = (id) => { try { return String(mp.getDescFromId(id >>> 0)); } catch (e) { return ''; } };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const an = (w) => (/^[AEIOU]/.test(w) ? 'an' : 'a');
  const listText = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  // "2 d 3 h", "5 h", "25 min"
  const waitText = (ms) => {
    const mins = Math.max(1, Math.ceil(ms / 60000));
    if (mins < 60) return `${mins} min`;
    const h = Math.ceil(mins / 60);
    return h >= 24 ? `${Math.floor(h / 24)} d${h % 24 ? ` ${h % 24} h` : ''}` : `${h} h`;
  };
  const hook = (name, ...args) => { try { const f = globalThis[name]; return typeof f === 'function' ? f(...args) : undefined; } catch (e) { log(`scribing: ${name} failed`, e.message); return undefined; } };

  // ---- the data: scrolls by spell, every scroll, the soul gems ---------------------------------------------------------
  const readJson = (file) => { try { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); } catch (e) { log(`scribing: ${file} unreadable`, e.message); return null; } };
  const DATA = readJson('spell-scrolls.json') || {};
  const SCROLL_OF = new Map(); // spell id -> { scrolls: [base ids], rank, school, name }
  for (const e of DATA.spells || []) {
    const spell = idOf(e.spellId);
    const ids = [e.scrollId].concat(e.alsoScrolls || []).map(idOf).filter(Boolean);
    if (spell && ids.length) SCROLL_OF.set(spell, { scrolls: ids, rank: Number(e.rank), school: e.school || '', name: e.name || '' });
  }
  const SCROLL_VALUE = new Map(); // every scroll base -> its value, for spending the cheapest first
  for (const s of DATA.scrolls || []) { const id = idOf(s.id); if (id) SCROLL_VALUE.set(id, Number(s.value) || 0); }
  const gemIds = (list) => (Array.isArray(list) ? list : []).map(idOf).filter(Boolean);
  const FILLED = gemIds(C.scroll.filledGems);
  const EMPTY = gemIds(C.scroll.emptyGems);
  const MATERIALS = C.scroll.materials.map((m) => ({ id: idOf(m.id), name: String(m.name || m.id), count: Math.max(1, Math.floor(Number(m.count) || 1)) })).filter((m) => m.id);
  if (MATERIALS.length !== C.scroll.materials.length) log('scribing: a scroll material is not in the load order and is left out');

  // ---- who and what ----------------------------------------------------------------------------------------------------
  const scholarTier = (a) => {
    const r = get(a, 'private.mastery', null);
    if (!r || !Array.isArray(r.order) || !r.order.includes('scholar')) return -1;
    return Math.max(0, Math.min(4, Number(((r.skills || {}).scholar || {}).rank) || 0));
  };
  const isMasterScholar = (a) => scholarTier(a) >= Number(C.scholarTier);
  const classify = (id) => {
    const sp = hook('__dboSpellsClassify', id >>> 0);
    if (sp) return sp;
    const s = SCROLL_OF.get(id >>> 0);
    return s && s.school ? { id: id >>> 0, desc: descOf(id), school: s.school, rank: s.rank, name: s.name || descOf(id) } : null;
  };
  const tomeOf = (id) => hook('__dboSpellsTomeOf', id >>> 0) || null;
  // The spells `a` knows as their own: the spellbook, and the engine's list less any spell on loan from a teacher
  const knownIds = (a) => {
    const book = new Set((hook('__dboSpellsBook', a) || []).map((sp) => sp.id >>> 0));
    const out = new Set(book);
    for (const sp of hook('__dboSpellsKnown', a) || []) { const id = sp.id >>> 0; if (!book.has(id) && hook('__dboSchoolsOnLoan', a, id)) continue; out.add(id); }
    return out;
  };
  // Why the spell may not be written by `a` at all (removed, held back, a restricted art below Senior, switched off), or ''.
  // A scroll's spell may have no tome: that answer from spells.js does not count for scrolls.
  const closed = (a, id, forScroll) => { const why = String(hook('__dboSpellsOpenTo', a, id >>> 0) || ''); return forScroll && why === 'not a spell of the tomes' ? '' : why; };
  const label = (sp) => `${sp.name} (${sp.school}, ${RANKS[sp.rank]})`;

  // ---- the two timers ------------------------------------------------------------------------------------------------------
  const DAY_HOURS = (h) => Math.max(0, Number(h) || 0) * HOUR;
  // The last tome: this file's record, else the newest end of spells.js's per-rank record under today's hours
  const tomeRecord = (a) => {
    const r = get(a, TOME, null);
    if (r && Number(r.at) > 0) return r;
    const old = get(a, OLD_TOME, null);
    if (!old || typeof old !== 'object') return null;
    let best = null;
    for (const [rank, at] of Object.entries(old)) {
      const k = Number(rank); if (!(k >= 0 && k <= 4) || !(Number(at) > 0)) continue;
      const end = Number(at) + DAY_HOURS(C.tome.cooldownHours[k]);
      if (!best || end > best.end) best = { at: Number(at), rank: k, end };
    }
    return best ? { at: best.at, rank: best.rank } : null;
  };
  const tomeWait = (a) => { const r = tomeRecord(a); return r ? Math.max(0, Number(r.at) + DAY_HOURS(C.tome.cooldownHours[Number(r.rank)] || 0) - Date.now()) : 0; };
  const scrollWait = (a) => { const r = get(a, SCROLL, null); return r && Number(r.at) > 0 ? Math.max(0, Number(r.at) + DAY_HOURS(C.scroll.cooldownHours[Number(r.rank)] || 0) - Date.now()) : 0; };
  const readyText = (ms) => (ms > 0 ? `in ${waitText(ms)}` : 'ready');
  const statusLine = (a) => `Tome writing: ${readyText(tomeWait(a))}. Scroll writing: ${readyText(scrollWait(a))}.`;

  // ---- the pack ------------------------------------------------------------------------------------------------------------
  const entriesOf = (a) => { const inv = get(a, 'inventory', { entries: [] }); return Array.isArray(inv && inv.entries) ? inv.entries.map((e) => Object.assign({}, e)) : []; };
  const base = (e) => Number(e && e.baseId) >>> 0;
  const usable = (e) => e && !e.worn && !e.wornLeft && Number(e.count) > 0;
  const countIn = (entries, pred) => entries.filter((e) => usable(e) && pred(e)).reduce((n, e) => n + (Number(e.count) || 0), 0);
  const isScroll = (e) => SCROLL_VALUE.has(base(e));
  const scrollsOf = (spellId) => { const s = SCROLL_OF.get(spellId >>> 0); return s ? s.scrolls : []; };
  const isFilledGem = (e) => FILLED.includes(base(e)) || (EMPTY.includes(base(e)) && Number(e.soul) > 0);
  // Smallest first: a pre-filled gem by its place in filledGems, a gem filled in play by its soul (1 Petty .. 5 Grand)
  const gemSize = (e) => (FILLED.includes(base(e)) ? FILLED.indexOf(base(e)) : Math.max(0, Number(e.soul) - 1) + 0.5);
  // Takes `n` from the entries matching `pred` in `order`; returns what it took, or null when there are not enough
  const takeFrom = (entries, pred, n, order) => {
    const list = entries.filter((e) => usable(e) && pred(e)).sort(order || (() => 0));
    const taken = [];
    let left = n;
    for (const e of list) {
      if (!left) break;
      const k = Math.min(left, Number(e.count) || 0);
      e.count -= k; left -= k;
      taken.push(Object.assign({}, e, { count: k }));
    }
    return left ? null : taken;
  };
  const takenText = (taken) => taken.length ? taken.map((t) => `${t.count} x ${descOf(t.baseId)}${Number(t.soul) > 0 ? ` (soul ${t.soul})` : ''}`).join(', ') : 'nothing';
  // Spends `taken` (a plan from takeFrom on a copy) and gives the item; a give that fails puts the pack back as it was
  const spendAndGive = (a, before, after, itemId, what) => {
    if (!set(a, 'inventory', { entries: after.filter((e) => Number(e.count) > 0) })) return { ok: false, text: `Your materials could not be used. Try again.` };
    if (giveItem(a, itemId, 1)) return { ok: true };
    const back = set(a, 'inventory', { entries: before });
    log(`scribing: ${who(a)} wrote ${what} but it could not be given; the pack was ${back ? 'put back' : 'NOT put back'}`);
    audit(`SCRIBE FAILED ${who(a)}: ${what} could not be given; materials ${back ? 'returned' : 'NOT RETURNED, check the pack'}`);
    return { ok: false, text: back ? `${what} could not be handed to you, and your materials are back in your pack. Try again, or ask a GM.` : `${what} could not be handed to you, and your materials could not be put back. Ask a GM: it is in the audit log.` };
  };

  // ---- tomes ------------------------------------------------------------------------------------------------------------------
  const tomeNeed = (sp) => Number(C.tome.scrolls[sp.rank]) || 0;
  const tomeScrollPred = (sp) => (sp.rank >= 4 ? (e) => scrollsOf(sp.id).includes(base(e)) : isScroll);
  const tomeNeedText = (sp, have) => {
    const n = tomeNeed(sp);
    if (!n) return 'no scrolls';
    return `${plural(n, 'scroll')}${sp.rank >= 4 ? ` of ${sp.name}` : ''} (you carry ${have})`;
  };
  // A Master of the school: the school's own meter in schools.js, Priest's for Restoration
  const schoolRankOf = (b, school) => { const r = hook('__dboSchoolRankOf', b, school); return Number.isFinite(Number(r)) ? Number(r) : -1; };
  const masterWord = (school) => (school === 'Restoration' ? 'a Master Priest' : `a Master of ${school}`);
  // What `a` may write a tome of: known spells with a tome below Master; every Master spell with a tome and a scroll of its own
  const tomeList = (a) => {
    const known = knownIds(a);
    const ids = new Set([...known].concat(hook('__dboSpellsTomeSpells') || []));
    const out = [];
    for (const id of ids) {
      const sp = classify(id);
      if (!sp || !tomeOf(id) || closed(a, id, false)) continue;
      if (sp.rank >= 4 ? !scrollsOf(id).length : !known.has(id)) continue;
      out.push(sp);
    }
    return out.sort((x, y) => x.school.localeCompare(y.school) || x.rank - y.rank || x.name.localeCompare(y.name));
  };
  const tomeRefusal = (a, sp) => {
    if (!C.enabled || !C.tome.enabled) return 'Spell tomes are not written just now.';
    if (!isMasterScholar(a)) return 'Only a Master Scholar writes spell tomes.';
    if (!tomeOf(sp.id)) return `No tome teaches ${sp.name}, so none can be written.`;
    const why = closed(a, sp.id, false);
    if (why) return `${sp.name} cannot be written: ${why}.`;
    if (sp.rank >= 4 && !scrollsOf(sp.id).length) return `${sp.name} has no scroll, and a Master tome is written from five scrolls of its own spell.`;
    if (sp.rank < 4 && !knownIds(a).has(sp.id)) return `You can only write a tome of a spell you know, and you do not know ${sp.name}.`;
    const wait = tomeWait(a);
    if (wait > 0) return `You wrote a spell tome not long ago; your next can be written in ${waitText(wait)}.`;
    const n = tomeNeed(sp); const have = countIn(entriesOf(a), tomeScrollPred(sp));
    if (have < n) return `${an(RANKS[sp.rank]).replace(/^a/, 'A')} ${RANKS[sp.rank]} tome needs ${plural(n, 'scroll')}${sp.rank >= 4 ? ` of ${sp.name}` : ''}; you carry ${have}.`;
    return '';
  };
  const coWriterRefusal = (a, b, sp) => {
    if ((b >>> 0) === (a >>> 0)) return 'You cannot be your own co-writer.';
    if (!onlineActors().includes(b >>> 0)) return `${display(b)} is not here.`;
    let d = Infinity; try { d = distanceMeters(a, b); } catch (e) { d = Infinity; }
    if (!(d <= Number(C.tome.coWriterMeters))) return `${display(b)} must stand within ${C.tome.coWriterMeters} m of you.`;
    if (schoolRankOf(b, sp.school) < Number(C.tome.coWriterRank)) return `${display(b)} is not ${masterWord(sp.school)}.`;
    if (!knownIds(b).has(sp.id)) return `${display(b)} does not know ${sp.name}.`;
    const wait = tomeWait(b);
    if (wait > 0) return `${display(b)} helped write a tome not long ago, and can again in ${waitText(wait)}.`;
    return '';
  };
  const coWriters = (a, sp) => onlineActors().filter((b) => !coWriterRefusal(a, b, sp));
  const stamp = (a, prop, sp) => set(a, prop, { at: Date.now(), rank: sp.rank, spell: descOf(sp.id) });
  const writeTome = (a, sp, helper) => {
    const why = tomeRefusal(a, sp);
    if (why) return { ok: false, text: why };
    if (sp.rank >= 4) {
      const hw = helper ? coWriterRefusal(a, helper, sp) : `A Master tome needs ${masterWord(sp.school)} who knows ${sp.name} beside you.`;
      if (hw) return { ok: false, text: hw };
    }
    const t = tomeOf(sp.id);
    const before = entriesOf(a); const after = before.map((e) => Object.assign({}, e));
    const taken = takeFrom(after, tomeScrollPred(sp), tomeNeed(sp), (x, y) => (SCROLL_VALUE.get(base(x)) || 0) - (SCROLL_VALUE.get(base(y)) || 0));
    if (!taken) return { ok: false, text: 'Your scrolls could not be found. Try again.' };
    const r = spendAndGive(a, before, after, t.bookId, t.title);
    if (!r.ok) return r;
    stamp(a, TOME, sp);
    if (helper) stamp(helper, TOME, sp);
    audit(`SCRIBE TOME ${who(a)} wrote ${descOf(t.bookId)} ${t.title} (${RANKS[sp.rank]}) spending ${takenText(taken)}${helper ? `, co-writer ${who(helper)}` : ''}`);
    const hours = C.tome.cooldownHours[sp.rank];
    return { ok: true, text: `You write ${t.title}.${taken.length ? ` ${plural(tomeNeed(sp), 'scroll')} ${tomeNeed(sp) === 1 ? 'is' : 'are'} spent.` : ''} Your next spell tome can be written in ${waitText(DAY_HOURS(hours))}.` };
  };

  // ---- scrolls ----------------------------------------------------------------------------------------------------------------
  const scrollList = (a) => [...knownIds(a)].map(classify)
    .filter((sp) => sp && sp.rank < 4 && scrollsOf(sp.id).length && !closed(a, sp.id, true))
    .sort((x, y) => x.school.localeCompare(y.school) || x.rank - y.rank || x.name.localeCompare(y.name));
  const gemsNeed = () => Math.max(0, Math.floor(Number(C.scroll.soulGems) || 0));
  const scrollMissing = (a) => {
    const entries = entriesOf(a);
    const out = [];
    for (const m of MATERIALS) { const have = countIn(entries, (e) => base(e) === m.id); if (have < m.count) out.push(m.count - have > 1 || m.count > 1 ? `${m.count - have} ${m.name}` : m.name); }
    const gems = countIn(entries, isFilledGem);
    if (gems < gemsNeed()) out.push(gemsNeed() - gems > 1 ? `${gemsNeed() - gems} filled soul gems` : 'a filled soul gem');
    return out;
  };
  const scrollCostText = () => listText(MATERIALS.map((m) => `${m.count} ${m.name}`).concat(gemsNeed() ? [`${gemsNeed()} filled soul gem${gemsNeed() === 1 ? '' : 's'}`] : []));
  const scrollRefusal = (a, sp) => {
    if (!C.enabled || !C.scroll.enabled) return 'Scrolls are not written just now.';
    if (!isMasterScholar(a)) return 'Only a Master Scholar writes scrolls.';
    if (sp.rank >= 4) return 'Master scrolls cannot be written.';
    if (!scrollsOf(sp.id).length) return `${sp.name} has no scroll, so none can be written.`;
    const why = closed(a, sp.id, true);
    if (why) return `${sp.name} cannot be written: ${why}.`;
    if (!knownIds(a).has(sp.id)) return `You can only write a scroll of a spell you know, and you do not know ${sp.name}.`;
    const wait = scrollWait(a);
    if (wait > 0) return `You wrote a scroll not long ago; your next can be written in ${waitText(wait)}.`;
    const missing = scrollMissing(a);
    if (missing.length) return `A scroll needs ${scrollCostText()}; you are missing ${listText(missing)}.`;
    return '';
  };
  const writeScroll = (a, sp) => {
    const why = scrollRefusal(a, sp);
    if (why) return { ok: false, text: why };
    const scrollId = scrollsOf(sp.id)[0];
    const before = entriesOf(a); const after = before.map((e) => Object.assign({}, e));
    const taken = [];
    for (const m of MATERIALS) { const t = takeFrom(after, (e) => base(e) === m.id, m.count); if (!t) return { ok: false, text: 'Your materials could not be found. Try again.' }; taken.push(...t); }
    if (gemsNeed()) { const t = takeFrom(after, isFilledGem, gemsNeed(), (x, y) => gemSize(x) - gemSize(y)); if (!t) return { ok: false, text: 'Your soul gem could not be found. Try again.' }; taken.push(...t); }
    const title = `a scroll of ${sp.name}`;
    const r = spendAndGive(a, before, after, scrollId, title.replace(/^a/, 'A'));
    if (!r.ok) return r;
    stamp(a, SCROLL, sp);
    audit(`SCRIBE SCROLL ${who(a)} wrote ${descOf(scrollId)} ${sp.name} (${RANKS[sp.rank]}) spending ${takenText(taken)}`);
    return { ok: true, text: `You write ${title}. ${scrollCostText().replace(/^./, (c) => c.toUpperCase())} ${MATERIALS.length + (gemsNeed() ? 1 : 0) > 1 ? 'are' : 'is'} spent. Your next scroll can be written in ${waitText(DAY_HOURS(C.scroll.cooldownHours[sp.rank]))}.` };
  };

  // ---- the lists -----------------------------------------------------------------------------------------------------------
  // Kept across a hot reload, so a list open during a deploy still answers
  const S = globalThis.__dboScribing || (globalThis.__dboScribing = { pending: new Map(), offers: new Map() });
  const atPlace = (a, place) => { try { return distanceMeters(a, place) <= Number(C.ledgerMeters); } catch (e) { return false; } };
  const show = (a, title, actions, state) => {
    S.pending.set(a >>> 0, state);
    openWidget(a, { type: 'contextMenu', id: MENU_ID, mode: 'menu', targetName: title, actions, events: { action: 'dbo:scribeChoose', close: 'dbo:scribeClose' } }, true);
    return true;
  };
  const tomeRow = (a, sp, entries, ready) => {
    const have = countIn(entries, tomeScrollPred(sp));
    const short = have < tomeNeed(sp);
    return { id: `t:${descOf(sp.id)}`, label: `${label(sp)}: ${tomeNeedText(sp, have)}${sp.rank >= 4 ? `, with ${masterWord(sp.school)}` : ''}${short ? ', short of scrolls' : ''} - ${ready}` };
  };
  const scrollRow = (a, sp, ready) => ({ id: `s:${descOf(sp.id)}`, label: `${label(sp)}: ${scrollCostText()} - ${ready}` });
  const open = (a, kind, place, note, page) => {
    const tomes = kind === 'tome';
    const all = tomes ? tomeList(a) : scrollList(a);
    const per = MAX_ROWS - 2;
    const pages = Math.max(1, Math.ceil(all.length / per));
    const pg = Math.min(pages - 1, Math.max(0, Number(page) || 0));
    const entries = entriesOf(a);
    const ready = readyText(tomes ? tomeWait(a) : scrollWait(a));
    const rows = all.slice(pg * per, pg * per + per).map((sp) => (tomes ? tomeRow(a, sp, entries, ready) : scrollRow(a, sp, ready)));
    if (pages > 1) rows.push({ id: `page:${(pg + 1) % pages}`, label: pg + 1 < pages ? `More spells (page ${pg + 2} of ${pages})` : 'Back to the first page' });
    rows.push({ id: 'close', label: 'Close' });
    const ask = all.length ? (tomes ? 'Write a tome of which spell?' : 'Write a scroll of which spell?')
      : (tomes ? 'You know no spell that has a tome to write.' : 'You know no spell below Master that has a scroll to write.');
    return show(a, `${statusLine(a)} ${note || ask}`, rows, { kind, place: place >>> 0, page: pg });
  };
  // A refusal is said in chat as well as at the top of the list, so it is never missed
  const refuse = (a, p, text) => { personal(a, text); return open(a, p.kind === 'helpers' ? 'tome' : p.kind, p.place, text, p.page); };
  const choose = (a, choice) => {
    const p = S.pending.get(a >>> 0);
    if (!p || choice === 'close') { S.pending.delete(a >>> 0); closeWidget(a, MENU_ID); return; }
    if (!atPlace(a, p.place)) { S.pending.delete(a >>> 0); closeWidget(a, MENU_ID); personal(a, 'You walked away from the ledger.'); return; }
    if (choice.startsWith('page:')) return open(a, p.kind === 'helpers' ? 'tome' : p.kind, p.place, null, Number(choice.slice(5)));
    if (choice === 'back') return open(a, 'tome', p.place, null, p.page);
    if (choice.startsWith('t:')) {
      const sp = classify(idOf(choice.slice(2)));
      if (!sp) return refuse(a, p, 'That spell cannot be written.');
      const why = tomeRefusal(a, sp);
      if (why) return refuse(a, p, why);
      if (sp.rank < 4) { const r = writeTome(a, sp, 0); if (!r.ok) return refuse(a, p, r.text); personal(a, r.text); return open(a, 'tome', p.place, r.text, p.page); }
      const list = coWriters(a, sp);
      if (!list.length) return refuse(a, p, `A Master tome of ${sp.name} needs a co-writer: ${masterWord(sp.school)} who knows ${sp.name}, within ${C.tome.coWriterMeters} m of you, whose own tome writing is ready.`);
      return show(a, `Who will write ${sp.name} with you? They are asked, and both of you wait ${waitText(DAY_HOURS(C.tome.cooldownHours[4]))} for the next tome.`,
        list.slice(0, MAX_ROWS - 1).map((b) => ({ id: `h:${b.toString(16)}:${descOf(sp.id)}`, label: display(b) })).concat([{ id: 'back', label: 'Back' }]),
        { kind: 'helpers', place: p.place, page: p.page });
    }
    if (choice.startsWith('h:')) {
      const [, h16, ...d] = choice.split(':'); const helper = parseInt(h16, 16) >>> 0; const sp = classify(idOf(d.join(':')));
      if (!sp || sp.rank < 4) return refuse(a, p, 'That spell cannot be written.');
      const why = tomeRefusal(a, sp) || coWriterRefusal(a, helper, sp);
      if (why) return refuse(a, p, why);
      S.offers.set(helper, { writer: a >>> 0, spellId: sp.id, place: p.place, at: Date.now() });
      S.pending.delete(helper);
      openWidget(helper, { type: 'contextMenu', id: MENU_ID, mode: 'menu', targetName: `${display(a)} asks you to co-write a Master tome of ${sp.name}. You would spend nothing, and wait ${waitText(DAY_HOURS(C.tome.cooldownHours[4]))} before your next tome.`,
        actions: [{ id: 'accept', label: 'Co-write it' }, { id: 'decline', label: 'Decline' }], events: { action: 'dbo:scribeHelp', close: 'dbo:scribeHelpClose' } }, true);
      personal(a, `You ask ${display(helper)} to co-write ${sp.name}.`);
      return open(a, 'tome', p.place, `You ask ${display(helper)} to co-write ${sp.name}.`, p.page);
    }
    if (choice.startsWith('s:')) {
      const sp = classify(idOf(choice.slice(2)));
      if (!sp) return refuse(a, p, 'That spell cannot be written.');
      const r = writeScroll(a, sp);
      if (!r.ok) return refuse(a, p, r.text);
      personal(a, r.text);
      return open(a, 'scroll', p.place, r.text, p.page);
    }
    S.pending.delete(a >>> 0); closeWidget(a, MENU_ID);
  };
  const answerHelp = (helper, accept) => {
    const o = S.offers.get(helper >>> 0);
    S.offers.delete(helper >>> 0);
    if (!o) return;
    closeWidget(helper, MENU_ID);
    if (Date.now() - o.at > Number(C.tome.offerSeconds) * 1000) return personal(helper, 'The request has lapsed.');
    if (!onlineActors().includes(o.writer)) return personal(helper, 'The writer has gone.');
    if (!accept) { personal(helper, 'You decline.'); return personal(o.writer, `${display(helper)} declines to co-write the tome.`); }
    if (!atPlace(o.writer, o.place)) { personal(helper, `${display(o.writer)} has left the ledger.`); return personal(o.writer, 'You walked away from the ledger.'); }
    const sp = classify(o.spellId);
    const r = sp ? writeTome(o.writer, sp, helper) : { ok: false, text: 'That spell cannot be written.' };
    personal(o.writer, r.text);
    personal(helper, r.ok ? `You co-write ${tomeOf(sp.id).title} with ${display(o.writer)}. Your next spell tome can be written in ${waitText(tomeWait(helper))}.` : `The tome could not be written: ${r.text}`);
    if (S.pending.has(o.writer)) { const p = S.pending.get(o.writer); open(o.writer, 'tome', p.place, r.text, p.page); }
  };
  onUi('scribeChoose', (a, args) => choose(a, String((args || [])[0] || '')));
  onUi('scribeClose', (a) => S.pending.delete(a >>> 0));
  onUi('scribeHelp', (a, args) => answerHelp(a, String((args || [])[0] || '') === 'accept'));
  onUi('scribeHelpClose', (a) => answerHelp(a, false));
  onUi('close', (a, args, widgetId) => { if (widgetId === MENU_ID) S.pending.delete(a >>> 0); });

  // ---- hooks ----------------------------------------------------------------------------------------------------------------
  // salvage.js's ledger menu rows, for a Master Scholar
  globalThis.__dboScribingActions = (a) => {
    if (!C.enabled || !isMasterScholar(a)) return [];
    return [].concat(C.tome.enabled ? [{ id: 'scribe:tome', label: 'Write a spell tome' }] : [], C.scroll.enabled ? [{ id: 'scribe:scroll', label: 'Write a scroll' }] : []);
  };
  // salvage.js hands over: kind 'tome' or 'scroll', at the ledger `place`. A refusal opens the list with it as the title.
  globalThis.__dboScribingOpen = (a, kind, place) => {
    const k = kind === 'scroll' ? 'scroll' : 'tome';
    if (!C.enabled || !(k === 'tome' ? C.tome.enabled : C.scroll.enabled)) return false;
    if (!isMasterScholar(a)) { personal(a, `Only a Master Scholar writes ${k === 'tome' ? 'spell tomes' : 'scrolls'}.`); return false; }
    return open(a, k, Number(place) >>> 0);
  };
  // The F3 Skills tab's Scholar page (journalskills.js): both timers for a Master Scholar, else null
  globalThis.__dboScribingBrief = (a) => {
    if (!C.enabled || !isMasterScholar(a)) return null;
    const tome = C.tome.enabled ? readyText(tomeWait(a)) : 'not just now', scroll = C.scroll.enabled ? readyText(scrollWait(a)) : 'not just now';
    return { tome, scroll, text: `Tome writing: ${tome}. Scroll writing: ${scroll}.` };
  };

  log(`scribing: ${SCROLL_OF.size} spells with a scroll, ${SCROLL_VALUE.size} scrolls, ${FILLED.length} filled soul gem bases`);
  return { tomeList, scrollList, tomeWait, scrollWait, writeTome, writeScroll };
};
