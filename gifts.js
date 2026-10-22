// DragonBreak Online: staff gifts delivered at the next login (Nate, 4 Oct: 50 gold to the parties a restart threw out of
// their dungeons). Loaded by gamemode.js on every hot reload.
//
// Staff queue a gift from the shell with tools/gift.js, which drops one file per gift into gifts-inbox/ beside the
// gamemode. Every few seconds this module looks at the inbox: a gift whose character (#TAG) or profile is in the world
// is handed over, the player is told why, the staff audit log gets a line, and the gift moves into gift-ledger.json.
// A gift for someone offline waits in the inbox until they are back, across restarts.
//
//   gifts-inbox/<id>.json  { tag: "KKVT" | profile: 71, gold: 50, items: [{ baseId: 0x1397e, count: 1 }], schools: { Destruction: 21 }, reason, by, at }
//   gift-ledger.json       { delivered: { <id>: { at, to, gold, items, schools?, schoolsGiven?, rest?, reason, by } } }, written only here
//
// `schools` (mod-0311, Jake 22 Oct) adds whole levels 1-100 to a school of magic through schools.js __dboSchoolsGrant,
// which caps at 100 and holds at an unmade Apprentice or Adept pick as class pay does; a gift may be schools only, and
// only a #TAG gift carries them (levels belong to one character, not a profile). Before a gift is spent schools.js is
// asked what it would give: the gift waits while schools.js is not loaded, while it refuses a school, or while nothing
// at all can be given yet. Levels held at a pick are queued again as a new gift (<id>-restN), paid once it is chosen;
// the ledger then records what each school really got (schoolsGiven) and the id of the rest.
//
// A gift is handed over at most once: the ledger is written before the gold is given, so a crash in between loses one
// gift rather than paying it twice. A gift already in the ledger is only cleared from the inbox.
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, audit, who, onlineActors, profileOf, giveItem, every } = api;
  const INBOX = path.resolve('gifts-inbox');
  const LEDGER = path.resolve('gift-ledger.json');
  const GOLD = 0x0000000f;
  const MAX_GOLD = 100000, MAX_COUNT = 1000, MAX_FILES = 200;
  // Restoration is not one: it follows Priest on the Wheel
  const SCHOOLS = ['Alteration', 'Conjuration', 'Destruction', 'Illusion'];
  const schoolsOk = (s) => !!s && typeof s === 'object' && !Array.isArray(s) && Object.keys(s).length > 0
    && Object.entries(s).every(([k, n]) => SCHOOLS.includes(k) && Number.isInteger(n) && n >= 1 && n <= 100);
  const grantHook = () => (typeof globalThis.__dboSchoolsGrant === 'function' ? globalThis.__dboSchoolsGrant : null);

  const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; } };
  const ledger = () => { const l = readJson(LEDGER, null); return l && typeof l.delivered === 'object' && l.delivered ? l : { delivered: {} }; };
  const saveLedger = (l) => { const tmp = `${LEDGER}.tmp`; fs.writeFileSync(tmp, JSON.stringify(l, null, 1)); fs.renameSync(tmp, LEDGER); };

  // A gift file read and checked, or null; bad files are logged once and left for staff to look at
  const badOnce = globalThis.__dboGiftBad || (globalThis.__dboGiftBad = new Set());
  const parse = (file) => {
    const id = path.basename(file, '.json');
    const g = readJson(path.join(INBOX, file), null);
    const why = !g || typeof g !== 'object' ? 'not JSON'
      : !(typeof g.tag === 'string' && /^[A-Z0-9]{4}$/.test(g.tag)) && !(Number.isInteger(g.profile) && g.profile > 0) ? 'no #TAG or profile'
      : g.gold !== undefined && !(Number.isInteger(g.gold) && g.gold > 0 && g.gold <= MAX_GOLD) ? `gold must be 1-${MAX_GOLD}`
      : g.items !== undefined && !(Array.isArray(g.items) && g.items.length <= 20 && g.items.every((i) => i && Number.isInteger(i.baseId) && i.baseId > 0 && Number.isInteger(i.count) && i.count > 0 && i.count <= MAX_COUNT)) ? 'bad items'
      : g.schools !== undefined && !schoolsOk(g.schools) ? `bad schools (${SCHOOLS.join(', ')}: whole levels 1-100)`
      : g.schools !== undefined && !(typeof g.tag === 'string' && /^[A-Z0-9]{4}$/.test(g.tag)) ? 'schools need a #TAG, not a profile'
      : !g.gold && !(g.items && g.items.length) && !g.schools ? 'nothing to give'
      : '';
    if (why) { if (!badOnce.has(file)) { badOnce.add(file); log(`gifts: ${file} refused (${why}); fix or delete it`); } return null; }
    return { id, file, tag: g.tag || '', profile: Number.isInteger(g.profile) ? g.profile : 0, gold: g.gold || 0, items: g.items || [], schools: g.schools || null,
      reason: String(g.reason || '').slice(0, 200), by: String(g.by || 'staff').slice(0, 40) };
  };

  const levelsWord = (n) => `${n} level${n === 1 ? '' : 's'}`;
  const describe = (g) => [g.gold ? `${g.gold} gold` : '', ...g.items.map((i) => `${i.count}x 0x${(i.baseId >>> 0).toString(16)}`),
    ...Object.entries(g.schools || {}).map(([k, n]) => `${n} ${k} level${n === 1 ? '' : 's'}`)].filter(Boolean).join(', ');

  // The next id for levels held at a pick: <id>-rest1, then -rest2
  const restId = (id) => { const m = /^(.*)-rest(\d+)$/.exec(id); return m ? `${m[1]}-rest${Number(m[2]) + 1}` : `${id}-rest1`; };
  const queueRest = (id, g, schools) => {
    const tmp = path.join(INBOX, `.${id}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify({ tag: g.tag, schools, reason: g.reason, by: g.by, at: new Date().toISOString(), after: g.id }, null, 1));
    fs.renameSync(tmp, path.join(INBOX, `${id}.json`));
  };

  const deliver = (a, g, l) => {
    l.delivered[g.id] = { at: new Date().toISOString(), to: who(a), gold: g.gold, items: g.items, ...(g.schools ? { schools: g.schools } : {}), reason: g.reason, by: g.by };
    saveLedger(l);
    const given = [];
    if (g.gold && giveItem(a, GOLD, g.gold)) given.push(`${g.gold} gold`);
    for (const i of g.items) if (giveItem(a, i.baseId >>> 0, i.count)) given.push(`${i.count}x 0x${(i.baseId >>> 0).toString(16)}`);
    const goods = given.length, told = [], refused = [], got = {}, rest = {};
    const nextId = g.schools ? restId(g.id) : '';
    for (const [school, n] of Object.entries(g.schools || {})) {
      const hook = grantHook();
      const r = (hook && hook(a, school, n, g.by, g.reason)) || { ok: false, text: 'schools.js is not loaded' };
      const added = r.ok && r.added > 0 ? r.added : 0;
      got[school] = added;
      // Held at a pick: the rest is queued again; capped at 100 or refused: it is not given
      if (r.heldFor && r.school) rest[school] = n - added;
      if (!added) { refused.push(`${school}: ${r.text}${rest[school] ? ` ${n} queued again as ${nextId}` : ''}`); if (rest[school]) told.push(`${levelsWord(n)} of ${school} once you choose its ${r.heldFor} spell`); continue; }
      const short = n - added;
      given.push(`${added} ${r.school} level${added === 1 ? '' : 's'} (${r.from} to ${r.to}${short ? (rest[school] ? `, ${short} more queued as ${nextId}` : `, ${short} not given`) : ''})`);
      told.push(`${levelsWord(added)} of ${r.school}${!short ? '' : rest[school] ? ` (it stops at ${r.to} until you choose its ${r.heldFor} spell; the other ${levelsWord(short)} follow${short === 1 ? 's' : ''} then)` : ' (it is now 100, the most there is)'}`);
    }
    if (g.schools) {
      // What each school really got, and the rest queued again; written after the grants, so it never risks paying twice
      if (Object.keys(rest).length) { try { queueRest(nextId, g, rest); } catch (e) { log(`gifts: ${g.id}: the rest ${JSON.stringify(rest)} could not be queued again (${e.message}); queue it by hand`); } }
      Object.assign(l.delivered[g.id], { schoolsGiven: got }, Object.keys(rest).length ? { rest: nextId } : {});
      try { saveLedger(l); } catch (e) { log(`gifts: ${g.id}: ledger not updated with what was given (${e.message})`); }
      const short = Object.entries(g.schools).filter(([k, n]) => got[k] < n && !rest[k]);
      if (short.length) log(`gifts: ${g.id}: ${short.map(([k, n]) => `${k} gave ${got[k]} of ${n}`).join(', ')}; see its GIFT audit line`);
    }
    try { fs.unlinkSync(path.join(INBOX, g.file)); } catch (e) { /* the ledger keeps it from paying twice */ }
    const what = [goods ? (g.gold ? `${g.gold} gold` : 'items') : '', ...told].filter(Boolean).join(', ');
    if (what) personal(a, `A gift from the staff: ${what}${g.reason ? `. ${g.reason}` : '.'}`);
    audit(`GIFT ${g.id} by ${g.by} to ${who(a)}: ${given.join(', ') || 'NOTHING (give failed)'}${given.length < (g.gold ? 1 : 0) + g.items.length + Object.keys(g.schools || {}).length ? ` of ${describe(g)}` : ''}${refused.length ? ` (${refused.join('; ')})` : ''}; ${g.reason}`);
  };

  // Asked before a schools gift is spent: false (logged once) while schools.js refuses one of its schools (a name the live
  // config has no school for) or while nothing at all could be given yet (every school held at a pick, or already 100)
  const schoolsReady = (a, g) => {
    const hook = grantHook();
    const pre = Object.entries(g.schools).map(([k, n]) => [k, (hook && hook(a, k, n, g.by, g.reason, true)) || { ok: false, text: 'schools.js gave no answer' }]);
    const bad = pre.filter(([, r]) => !r.school);
    const why = bad.length ? `refused by schools.js (${bad.map(([k, r]) => `${k}: ${r.text}`).join('; ')}); fix or delete it`
      : !g.gold && !g.items.length && pre.every(([, r]) => !(r.added > 0)) ? `waits: nothing can be given yet (${pre.map(([k, r]) => `${k}: ${r.text}`).join('; ')})` : '';
    if (!why) return true;
    const key = `${g.file}:${why}`;
    if (!badOnce.has(key)) { badOnce.add(key); log(`gifts: ${g.file} ${why}`); }
    return false;
  };

  const tick = () => {
    let files;
    try { files = fs.readdirSync(INBOX).filter((f) => f.endsWith('.json')).slice(0, MAX_FILES); } catch (e) { return; }
    if (!files.length) return;
    const gifts = files.map(parse).filter(Boolean);
    if (!gifts.length) return;
    const l = ledger();
    const online = onlineActors();
    for (const g of gifts) {
      if (l.delivered[g.id]) { try { fs.unlinkSync(path.join(INBOX, g.file)); } catch (e) { /* gone */ } continue; }
      if (g.schools && !grantHook()) { if (!badOnce.has(`${g.file}:schools`)) { badOnce.add(`${g.file}:schools`); log(`gifts: ${g.file} waits: schools.js is not loaded to grant its levels`); } continue; }
      const a = online.find((x) => {
        if (g.tag) { try { return mp.get(x, 'private.charTag') === g.tag; } catch (e) { return false; } }
        return profileOf(x) === g.profile;
      });
      if (!a) continue;
      if (g.schools && !schoolsReady(a, g)) continue;
      try { deliver(a, g, l); } catch (e) { log(`gifts: ${g.id} failed: ${e.message}`); }
    }
  };
  every('gifts', 10000, tick);
  return { tick };
};
