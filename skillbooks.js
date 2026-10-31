// DragonBreak Online: skill books, studied, train our skills (Leader, 31 Oct, _work/skill-books-1031.md, approved; asked for
// in #ooc-general by athny, dangerbush and par.lar). Loaded by gamemode.js; manuals.js hands its skill books here.
//
// A skill book (BOOK DATA "teaches skill", the vanilla actor value at 4) teaches the DBO skill whose skills.json
// vanillaSkills names that actor value: Block, Light and Heavy Armor train Defense, One- and Two-Handed train whichever of
// Blade or Blunt the reader holds higher, and so on; Sneak and Pickpocket train Lockpicking (the thieves' craft) and
// Speechcraft trains Scholar (extraSkills). Read from the inventory in a place fit for study (an inn, a home, a temple:
// vampirepath.js __dboSafeZone, never a jail cell; or a spell study point, skills.json spellStudyPoints), the reader
// studies for studySeconds, staying within stayMeters and out of a fight; then the book gives `levels` (half a level) of
// that skill at its own band, a Scholar of Adept rank or more scholarBonus more, through masterySystem's
// __alduinakMasteryStudy (fork mastery-study-1031): outside the Wheel's hourly pace, never past Expert (75), never a skill
// not taken up. Once per book per character (private.dboStudiedBooks), at most perDay books a day
// (private.dboStudyDay). The book is kept: lend it, sell it, shelve it. Until the fork hook ships this is inert, and
// manuals.js keeps its old Blacksmith award for smithing books.
//
// gamemode-config.json "skillBooks": { enabled, levels: 0.5, scholarBonus: 0.25, scholarRank: 2, perDay: 3,
//   studySeconds: 20, stayMeters: 4, extraSkills: { Sneak: 'lockpicking', Pickpocket: 'lockpicking', Speechcraft: 'scholar' },
//   extraBooks: { "<book desc>": "<skill>" } }
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, audit, who, cfg } = api;
  const C = Object.assign({ enabled: true, levels: 0.5, scholarBonus: 0.25, scholarRank: 2, perDay: 3, studySeconds: 20, stayMeters: 4,
    extraSkills: { Sneak: 'lockpicking', Pickpocket: 'lockpicking', Speechcraft: 'scholar' }, extraBooks: {} }, cfg.skillBooks || {});
  const ON = C.enabled !== false;
  const STUDIED = 'private.dboStudiedBooks', DAY = 'private.dboStudyDay';
  const UNITS_PER_METER = 70;
  // The vanilla skill actor values (ActorValue.h: 6 OneHanded .. 23 Enchanting), named as skills.json names them
  const AV_NAMES = { 6: 'OneHanded', 7: 'TwoHanded', 8: 'Archery', 9: 'Block', 10: 'Smithing', 11: 'HeavyArmor', 12: 'LightArmor', 13: 'Pickpocket',
    14: 'Lockpicking', 15: 'Sneak', 16: 'Alchemy', 17: 'Speechcraft', 18: 'Alteration', 19: 'Conjuration', 20: 'Destruction', 21: 'Illusion', 22: 'Restoration', 23: 'Enchanting' };
  const SK = (() => { try { return JSON.parse(fs.readFileSync(path.resolve('skills.json'), 'utf8')); } catch (e) { log('skillbooks: skills.json unreadable', e.message); return { skills: [] }; } })();
  const SKILLS = new Map((SK.skills || []).map((s) => [s.id, s]));
  // vanilla skill name -> our skill ids that it trains
  const BY_VANILLA = new Map();
  for (const s of SK.skills || []) for (const v of s.vanillaSkills || []) BY_VANILLA.set(v, (BY_VANILLA.get(v) || []).concat([s.id]));
  for (const [v, id] of Object.entries(C.extraSkills || {})) if (SKILLS.has(id) && !BY_VANILLA.has(v)) BY_VANILLA.set(v, [id]);
  const STUDY_CELLS = new Set((SK.spellStudyPoints || []).flatMap((p) => p.cells || []).map((d) => norm(d)));
  function norm(d) { const s = String(d || ''); const i = s.indexOf(':'); if (i < 0) return s.toLowerCase(); const n = parseInt(s.slice(0, i), 16); return (Number.isFinite(n) ? n.toString(16) : s.slice(0, i).toLowerCase()) + ':' + s.slice(i + 1).toLowerCase(); }
  const get = (a, k, d) => { try { const v = mp.get(a, k); return v === undefined || v === null ? d : v; } catch (e) { return d; } };
  const set = (a, k, v) => { try { mp.set(a, k, v); return true; } catch (e) { return false; } };
  const descOf = (id) => { try { return String(mp.getDescFromId(id >>> 0)); } catch (e) { return ''; } };
  const idOf = (d) => { try { return mp.getIdFromDesc(String(d)) >>> 0; } catch (e) { return 0; } };
  const EXTRA = new Map(Object.entries(C.extraBooks || {}).map(([d, s]) => [idOf(d), String(s)]).filter(([id, s]) => id && SKILLS.has(s)));
  const call = (name, ...args) => { try { const f = globalThis[name]; return typeof f === 'function' ? f(...args) : undefined; } catch (e) { return undefined; } };
  const studyHook = () => (typeof globalThis.__alduinakMasteryStudy === 'function' ? globalThis.__alduinakMasteryStudy : null);
  // { av name, edid } of a skill book, null for any other book
  const cache = new Map();
  const bookOf = (bookId) => {
    const id = bookId >>> 0;
    if (cache.has(id)) return cache.get(id);
    let out = null;
    try {
      const r = mp.lookupEspmRecordById(id); const rec = r && r.record;
      if (rec && String(rec.type) === 'BOOK') {
        const f = (rec.fields || []).find((x) => x && x.type === 'DATA' && x.data && x.data.byteLength >= 8);
        if (f && (f.data[0] & 0x01)) out = { vanilla: AV_NAMES[new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getInt32(4, true)] || '', edid: String(rec.editorId || '') };
        else if (EXTRA.has(id)) out = { skill: EXTRA.get(id), edid: String(rec.editorId || '') };
      }
    } catch (e) { out = null; }
    cache.set(id, out);
    return out;
  };
  const mastery = (a) => { const r = get(a, 'private.mastery', null); return r && typeof r === 'object' ? r : { order: [], skills: {} }; };
  const held = (a, id) => { const r = mastery(a); return Array.isArray(r.order) && r.order.includes(id) && Number(((r.skills || {})[id] || {}).level) >= 1; };
  const levelIn = (a, id) => Number(((mastery(a).skills || {})[id] || {}).level) || 0;
  const rankIn = (a, id) => Number(((mastery(a).skills || {})[id] || {}).rank) || 0;
  // The skill this book trains for this reader: the held one, the higher of two (Blade or Blunt)
  const skillFor = (a, b) => {
    const ids = b.skill ? [b.skill] : BY_VANILLA.get(b.vanilla) || [];
    const mine = ids.filter((id) => held(a, id)).sort((x, y) => levelIn(a, y) - levelIn(a, x));
    return { id: mine[0] || '', any: ids };
  };
  const labelOf = (id) => String((SKILLS.get(id) || {}).label || id);
  const titleOf = (edid) => String(edid || 'the book').replace(/^(BSK)?Skill/, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/\s*\d+$/, '').trim() || 'the book';
  const fitPlace = (a) => {
    if (get(a, 'private.dboSentence', null)) return false;
    if (STUDY_CELLS.has(norm(get(a, 'worldOrCellDesc', '')))) return true;
    return call('__dboSafeZone', a >>> 0) === true;
  };
  const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
  const today = (a, now) => { const d = get(a, DAY, null); return d && d.day === dayKey(now) ? Number(d.n) || 0 : 0; };
  const fighting = (a, now) => { const m = globalThis.__dboCombatAt; const at = m instanceof Map ? Number(m.get(a >>> 0)) || 0 : 0; return at > 0 && now - at < 10000; };
  const studying = globalThis.__dboStudying instanceof Map ? globalThis.__dboStudying : (globalThis.__dboStudying = new Map()); // actor -> { book, at }

  // From manuals.js's read hook for every book read from the inventory: null when this is not ours to answer (no skill
  // book, or the fork hook has not shipped), else a line for the reader ('' for nothing to say)
  const read = (a, bookId) => {
    if (!ON || !studyHook()) return null;
    const b = bookOf(bookId);
    if (!b) return null;
    const desc = descOf(bookId);
    const { id, any } = skillFor(a, b);
    if (!any.length) return 'This book speaks of a craft no one here practises.';
    if ((get(a, STUDIED, []) || []).includes(desc)) return `You know ${titleOf(b.edid)} already; there is nothing more in it for you.`;
    if (!id) return `${titleOf(b.edid)} would teach ${any.map(labelOf).join(' or ')}, a skill you have not taken up.`;
    const now = Date.now();
    if (today(a, now) >= C.perDay) return `You have studied ${C.perDay} books today. Let them settle; read again tomorrow.`;
    if (!fitPlace(a)) return 'This wants study, in a quiet place: an inn, a home, a temple or a college.';
    if (studying.has(a >>> 0)) return 'You are already deep in a book.';
    const start = get(a, 'pos', null);
    studying.set(a >>> 0, { book: desc, at: now });
    setTimeout(() => {
      try {
        studying.delete(a >>> 0);
        const p = get(a, 'pos', null);
        const moved = Array.isArray(start) && Array.isArray(p) ? Math.hypot(p[0] - start[0], p[1] - start[1], p[2] - start[2]) : Infinity;
        if (moved > C.stayMeters * UNITS_PER_METER || fighting(a, Date.now())) return personal(a, `You lose the thread of ${titleOf(b.edid)}. Sit with it a while, undisturbed.`);
        finish(a, b, desc, id);
      } catch (e) { log('skillbooks: study failed', e.message); }
    }, Math.max(0, C.studySeconds) * 1000);
    return `You settle down to study ${titleOf(b.edid)}. Stay where you are a little while.`;
  };
  const finish = (a, b, desc, id) => {
    const hook = studyHook(); if (!hook) return;
    const scholar = held(a, 'scholar') && rankIn(a, 'scholar') >= C.scholarRank ? 1 + Number(C.scholarBonus || 0) : 1;
    const before = levelIn(a, id);
    const r = hook(a >>> 0, id, Number(C.levels) * scholar, idOf(desc)) || {};
    if (r.refused === 'ceiling' || (r.refused && !(Number(r.units) > 0))) {
      return personal(a, r.refused === 'ceiling' ? `${titleOf(b.edid)} has nothing left to teach an expert ${labelOf(id)}; the rest is practice.` : `${titleOf(b.edid)} will not settle in your mind just now.`);
    }
    set(a, STUDIED, (get(a, STUDIED, []) || []).concat([desc]));
    const now = Date.now(); set(a, DAY, { day: dayKey(now), n: today(a, now) + 1 });
    personal(a, `What ${titleOf(b.edid)} teaches stays with you: your ${labelOf(id)} grows${Number(r.level) > before ? ` to ${r.level}` : ''}.`);
    audit(`SKILLBOOK ${who(a)} studied ${b.edid}: ${labelOf(id)} +${Math.round((Number(r.units) || 0) * 10) / 10} units${scholar > 1 ? ' (scholar)' : ''}`);
  };
  globalThis.__dboSkillBookRead = read;
  log(`skillbooks: ${ON ? `${studyHook() ? 'on' : 'waiting for the fork\'s __alduinakMasteryStudy'}, ${BY_VANILLA.size} vanilla skills mapped, ${EXTRA.size} extra books, ${STUDY_CELLS.size} study cells` : 'off'}`);
  return { read, finish, bookOf, skillFor };
};
