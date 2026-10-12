'use strict';
// /appearance (#suggestions #1 by votes; Jake, 2026-10-04: "Move forward with the appearance and keybind"): a player
// reopens the appearance editor for their own character, for gold ("even if it costs some money every time"). Loaded by
// gamemode.js, whose appearance hook hands a pending edit's result to finish() below. Config "appearance".
//
// - Race and sex stay as they are (allowRace / allowSex false), and so does the name: renames go through staff.
// - The gold is taken only when a changed look is saved; closing the editor unchanged costs nothing.
// - Once per cooldownHours. Not in a fight, down, in a beast form, jailed, bound, inside a dungeon, dead, or while
//   still making or rerolling a character.
// The engine applies the editor's result before the gamemode hears of it (ActionListener::OnUpdateAppearance applies it
// and tells the neighbours, then fires the event), so a locked change is undone here by setting the appearance back. The
// edit waits on the character (private.dboAppearanceEdit, with the look before it), so a relog or a restart in the
// middle neither loses the charge nor makes the change free.
//
// Three guards on the look an editor hands back (7 Oct; review fixes 8 Oct):
// 1. The Nord head. RaceMenu reopened on an existing non-Nord character (this command, a GM's /chargen on one, or a
//    patron's /reroll, patrons.js) can swap the race's own Face head part for the Nord default head (male 5162f, female
//    51623) while the race stays: 9 of the 10 non-Nord re-edits from 4 to 7 Oct were saved with it. With race and sex
//    unchanged, a head in the result that is another race's default head (racedefaultheads.json, written by
//    tools/racedefaultheads.js) and was not in the look before is taken out, and the head from before goes back in its
//    old slot: the race default head the look had, or for a look with none (a high-poly head) the Face part (HDPT PNAM
//    1) the editor took out, never a guess (several Face parts taken out, or records that cannot be read and more than a
//    plain swap: the result stands, with an audit line for staff). An edit that only swapped the head is then
//    unchanged and costs nothing. Config appearance.headGuard (default on).
//    Whatever the server puts back is written at once (the neighbours see it) and the stored look is sent again 3.5 s
//    later: the player's own client drops every write to its own look while RaceMenu settles, RACE_MENU_SETTLE_MS = 3000
//    from the close it sends the result with (fork skymp5-client remoteServer.ts isRaceMenuSettling and
//    sendInputsService.ts, client-0380 f25da5f0), so without the second write the player would see the editor's version
//    (and miss any other write made in the window) until a relog.
// 2. The silent drop. The engine stores an editor result only while the server has RaceMenu open (ActionListener.cpp
//    OnUpdateAppearance, IsRaceMenuOpen); the console's showracemenu is not, so its edit shows on the player's own screen
//    and is gone at the next login. The hook still hears it, with isAllowed false: when it differs from the stored look
//    the player is told, at most once a minute (refused below). The client sends its look on every RaceSex Menu close,
//    so a close with no change says nothing; creation, /appearance, /chargen and /reroll are opened by the server
//    (isAllowed true) and never come here. Config appearance.refusedNotice (default on).
// 3. A vampire's or werewolf's tells. supernatural.js keeps the look the tells hide (eyes, skin colour, skin tone) and
//    gives it back on a feed, which undid an edit saved while the tells showed (Selena #PXVM, 5 Oct). After a saved edit
//    (/appearance, a GM's /chargen or a patron's /reroll) the new look goes to globalThis.__dboTellsRetake
//    (supernatural.js), which takes what the player changed as the look under the tells and lays the tells back over it
//    when they are due; a lips or chin layer recoloured over a vampire's blood is taken as theirs the same way, so a wash
//    leaves it.
// /appearance (and patrons.js /reroll) is refused while a forced werewolf change is warned and on its way
// (supernatural.js __dboFeralDue). Nothing holds, delays or skips that change or the tells for an editor: supernatural.js
// runs both exactly as before these guards (a hold tried on 8 Oct let an /appearance opened just before the change's
// roll and closed unchanged, free, skip every forced change).
//
// Known issues, not fixed here (the same before these guards, rare; a separate follow-up): the engine stores what the
// editor hands back over anything the server wrote to the look meanwhile, and the player's own client drops every write
// to its own look while RaceMenu is open or settling. So a forced werewolf change (feral or full moon), a curse starting
// or ending, or the slow tick laying or clearing the tells (a feed, a rising thirst) while an editor is open can be
// overwritten by the editor's result: a beast form taken then keeps the look from before the edit to revert to
// (beastform.js tryTransform), and tells cleared then come back with the editor and stay as the mortal look (tells laid
// then are laid again by the next slow tick, or by the retake after a saved edit).
const fs = require('fs');
const path = require('path');

const GOLD = 0x0000000f;
const EDIT = 'private.dboAppearanceEdit';
const LAST = 'private.dboAppearanceAt';
// A GM's /chargen on a character that already exists: the look as it was when the GM opened it
const CHARGEN = 'private.dboChargenEdit';
// A /chargen snapshot older than this is not trusted as the look before (that editor never closed through the server)
const CHARGEN_MAX_MS = 24 * 3600000;
// The client's settle window (RACE_MENU_SETTLE_MS, 3000 from the close) and a margin
const SETTLE_RESEND_MS = 3500;
const REFUSED_EVERY_MS = 60000;
// A head part's type (HDPT PNAM): the Face part is the head
const FACE = 1;
// A forced beast change pending this long past its due time is a leftover, not one coming (its own timer clears it when
// it lands or passes)
const BEAST_DUE_STALE_MS = 60000;
const HEADS_JSON = path.join(__dirname, 'racedefaultheads.json');

const u32 = (v) => Number(v) >>> 0;
// The race default heads: race id -> race, head -> the first race it is the default of, race -> its own heads (both
// sexes)
const loadHeads = (log) => {
  const raceOf = new Map(); const owner = new Map(); const own = new Map();
  try {
    const j = JSON.parse(fs.readFileSync(HEADS_JSON, 'utf8'));
    for (const [edid, r] of Object.entries((j && j.races) || {})) {
      const male = parseInt(r.male, 16) >>> 0; const female = parseInt(r.female, 16) >>> 0;
      own.set(edid, new Set([male, female].filter(Boolean)));
      for (const h of [male, female]) if (h && !owner.has(h)) owner.set(h, edid);
      for (const id of r.ids || []) raceOf.set(parseInt(id, 16) >>> 0, edid);
    }
  } catch (e) { log('appearance: racedefaultheads.json could not be read, so the head guard is off:', e.message); }
  return { raceOf, owner, own };
};
// NordRace -> Nord, DarkElfRace -> Dark Elf, BretonRaceChild -> Breton Child
const raceName = (edid) => String(edid || 'another race').replace(/Race/, '').replace(/([a-z])([A-Z])/g, '$1 $2');

// The same look: head parts in any order (RaceMenu reorders them), fractions to float precision, whole numbers exactly
const sameVal = (p, q) => {
  if (typeof p === 'number' && typeof q === 'number') {
    if (p === q) return true;
    if (Number.isInteger(p) && Number.isInteger(q)) return Math.abs(p) <= 0xffffffff && Math.abs(q) <= 0xffffffff && (p >>> 0) === (q >>> 0);
    return Math.abs(p - q) <= 1e-5 * Math.max(1, Math.abs(p), Math.abs(q));
  }
  if (Array.isArray(p) || Array.isArray(q)) return Array.isArray(p) && Array.isArray(q) && p.length === q.length && p.every((v, i) => sameVal(v, q[i]));
  if (p && q && typeof p === 'object' && typeof q === 'object') {
    for (const k of new Set([...Object.keys(p), ...Object.keys(q)])) if (!sameVal(p[k], q[k])) return false;
    return true;
  }
  return p === q;
};
const partsOf = (x) => (Array.isArray(x.headpartIds) ? x.headpartIds.map(u32).sort((m, n) => m - n) : x.headpartIds);
const sameLook = (x, y) => {
  if (!x || !y || typeof x !== 'object' || typeof y !== 'object') return x === y;
  return sameVal(Object.assign({}, x, { headpartIds: partsOf(x) }), Object.assign({}, y, { headpartIds: partsOf(y) }));
};

module.exports = (api) => {
  const { mp, log, personal, system, audit, who, registerChatCommand, cfg } = api;
  const C = Object.assign({ enabled: true, cost: 500, cooldownHours: 24, allowRace: false, allowSex: false, combatSeconds: 30, headGuard: true, refusedNotice: true },
    (cfg && cfg.appearance) || {});
  const cost = Math.max(0, Math.floor(Number(C.cost) || 0));
  // The harness passes its own clock for the settle write
  const later = typeof api.later === 'function' ? api.later : (fn, ms) => setTimeout(fn, ms);
  const HEADS = loadHeads(log);
  // The DLE's MaormerRace and its vampire (config maormerRace) are copies of the High Elf's with its default heads: guarded as
  // the High Elf, so their own default head is never taken for another race's. Nothing until both are RACE records
  try {
    const M = (cfg && cfg.maormerRace) || {};
    const rec = (d) => { const id = d ? mp.getIdFromDesc(String(d)) >>> 0 : 0; const r = id ? mp.lookupEspmRecordById(id) : null; return r && r.record && String(r.record.type) === 'RACE' ? id : 0; };
    const r = rec(M.race), v = rec(M.vampire);
    if (r && v && HEADS.own.has('HighElfRace')) { HEADS.raceOf.set(r, 'HighElfRace'); HEADS.raceOf.set(v, 'HighElfRace'); }
  } catch (e) { log('appearance: the Maormer race could not be read', e.message); }

  const get = (a, k) => { try { return mp.get(a, k); } catch (e) { return undefined; } };
  const userOf = (a) => {
    if (typeof api.userOf === 'function') return api.userOf(a);
    try { const u = mp.getUserByActor(a); return u === 65535 ? -1 : u; } catch (e) { return -1; }
  };
  const profileOf = (a) => (typeof api.profileOf === 'function' ? api.profileOf(a) : Number(get(a, 'profileId')));
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const entriesOf = (a) => { const inv = get(a, 'inventory'); return inv && Array.isArray(inv.entries) ? inv.entries : []; };
  const goldOf = (a) => entriesOf(a).reduce((n, e) => n + ((Number(e && e.baseId) >>> 0) === GOLD ? Number(e.count) || 0 : 0), 0);
  // Takes n gold from the stacks; false (and nothing taken) when there is not enough
  const takeGold = (a, n) => {
    if (n <= 0) return true;
    const entries = entriesOf(a).map((e) => Object.assign({}, e));
    if (entries.reduce((s, e) => s + ((Number(e.baseId) >>> 0) === GOLD ? Number(e.count) || 0 : 0), 0) < n) return false;
    let left = n;
    for (const e of entries) {
      if (left <= 0) break;
      if ((Number(e.baseId) >>> 0) !== GOLD) continue;
      const t = Math.min(left, Number(e.count) || 0);
      e.count -= t; left -= t;
    }
    mp.set(a, 'inventory', { entries: entries.filter((e) => Number(e.count) > 0) });
    return true;
  };
  // Gives n gold back (a RaceMenu charge whose face could not be written, raceMenuSaveGate's settle)
  const giveGold = (a, n) => {
    if (!(n > 0)) return;
    const entries = entriesOf(a).map((e) => Object.assign({}, e));
    const stack = entries.find((e) => (Number(e.baseId) >>> 0) === GOLD);
    if (stack) stack.count = (Number(stack.count) || 0) + n; else entries.push({ baseId: GOLD, count: n });
    mp.set(a, 'inventory', { entries });
  };
  const normDesc = (d) => {
    const s = String(d || ''); const i = s.indexOf(':'); if (i < 0) return s.toLowerCase();
    const n = parseInt(s.slice(0, i), 16);
    return (Number.isFinite(n) ? n.toString(16) : s.slice(0, i).toLowerCase()) + ':' + s.slice(i + 1).toLowerCase();
  };
  const hours = (ms) => { const h = Math.ceil(ms / 3600000); return h <= 1 ? 'about an hour' : `${h} hours`; };
  // In a beast form (beastform.js private.beast; __dboBeastOriginalRace for an older beastform)
  const inBeastForm = (a) => {
    const b = get(a, 'private.beast'); if (b && b.form) return true;
    try { return typeof globalThis.__dboBeastOriginalRace === 'function' && !!globalThis.__dboBeastOriginalRace(a); } catch (e) { return false; }
  };
  // A forced werewolf change has been warned and is on its way (supernatural.js forcedChange, globalThis.__dboFeralDue:
  // actor -> when it lands). It lands whatever the editor does, and an editor still open then hands back a look that
  // overwrites it (the known issues above), so the editor waits for the beast instead. patrons.js /reroll asks the same.
  const beastComing = (a) => {
    const due = globalThis.__dboFeralDue instanceof Map ? globalThis.__dboFeralDue.get(a >>> 0) : undefined;
    return due !== undefined && Date.now() < (Number(due) || 0) + BEAST_DUE_STALE_MS;
  };

  // Why this player cannot open the editor now, or null
  const blocked = (a) => {
    if (!C.enabled) return 'The appearance editor is closed for now.';
    if (get(a, 'private.creationPending') === true || get(a, 'private.rerollPending') === true) return 'Finish making your character first.';
    if (get(a, 'isDead') === true) return 'Not while you are dead.';
    const fought = globalThis.__dboCombatAt instanceof Map ? globalThis.__dboCombatAt.get(a >>> 0) || 0 : 0;
    if (Date.now() - fought < (Number(C.combatSeconds) || 0) * 1000) return 'Not in the middle of a fight.';
    try { if (typeof globalThis.__dboIsDowned === 'function' && globalThis.__dboIsDowned(a)) return 'Not while you are down.'; } catch (e) { /* no downed module */ }
    try { if (typeof globalThis.__dboBeastOriginalRace === 'function' && globalThis.__dboBeastOriginalRace(a)) return 'Not while in a beast form.'; } catch (e) { /* no beast module */ }
    if (beastComing(a)) return 'Not while the beast is coming.';
    if (get(a, 'private.dboSentence')) return 'Not while you are in jail.';
    if (get(a, 'private.restrained')) return 'Not while you are bound.';
    const cells = globalThis.__dboDungeonCells;
    if (cells instanceof Set && cells.has(normDesc(get(a, 'worldOrCellDesc')))) return 'Not inside a dungeon.';
    return null;
  };

  registerChatCommand('appearance', (a) => {
    a = a >>> 0;
    if (get(a, EDIT)) return personal(a, 'Your appearance editor is already open. Finish it first.');
    const why = blocked(a); if (why) return personal(a, why);
    const wait = (Number(get(a, LAST)) || 0) + (Number(C.cooldownHours) || 0) * 3600000 - Date.now();
    if (wait > 0) return personal(a, `You can change your appearance again in ${hours(wait)}.`);
    const gold = goldOf(a);
    if (gold < cost) return personal(a, `Changing your appearance costs ${cost} gold. You have ${gold}.`);
    const before = get(a, 'appearance');
    if (!before || typeof before !== 'object') return personal(a, 'Your appearance could not be read. Ask a GM for help.');
    try {
      mp.set(a, EDIT, { at: Date.now(), before: copy(before) });
      mp.setRaceMenuOpen(a, true);
      noteEditorOpened(a);
    } catch (e) {
      try { mp.set(a, EDIT, null); } catch (e2) { /* nothing more to undo */ }
      log('appearance: could not open the editor for', who(a), e.message);
      return personal(a, 'The appearance editor could not be opened. Try again in a moment.');
    }
    personal(a, `The appearance editor is open. Saving a new look costs ${cost} gold; closing it unchanged costs nothing. Your race, sex and name stay as they are.`);
    audit(`APPEARANCE ${who(a)} opened the appearance editor (${cost} gold on a changed look)`);
  }, { help: 'reopen the appearance editor for your own character (gold, once a day; race, sex and name stay)' });

  const pending = (a) => { const e = get(a >>> 0, EDIT); return !!(e && e.before); };

  // A head part's type from its record (HDPT PNAM: 1 Face, 2 Eyes, 3 Hair, ...), as supernatural.js isEyePart reads it;
  // undefined when the record cannot be read
  const partType = (id) => {
    if (typeof mp.lookupEspmRecordById !== 'function') return undefined;
    let rec = null; try { const x = mp.lookupEspmRecordById(u32(id)); rec = x && x.record ? x.record : null; } catch (e) { return undefined; }
    for (const f of (rec && rec.fields) || []) {
      if (!f || f.type !== 'PNAM') continue;
      const d = f.data;
      if (!(d instanceof Uint8Array) || d.byteLength < 4) return undefined;
      return new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(0, true);
    }
    return undefined;
  };

  // Guard 1: the look with the head from before back in place of another race's default head, and that race; null when
  // the editor swapped none in. Only with race and sex unchanged, and only for a race in the table (its own heads known).
  // { look: null, from } when one was swapped in but the head from before cannot be told (the caller audits it and the
  // result stands as the editor gave it).
  const guardHead = (before, after) => {
    if (C.headGuard === false || !before || !after || !Array.isArray(before.headpartIds) || !Array.isArray(after.headpartIds)) return null;
    if (u32(after.raceId) !== u32(before.raceId) || !!after.isFemale !== !!before.isFemale) return null;
    const race = HEADS.raceOf.get(u32(after.raceId)); if (!race) return null;
    const own = HEADS.own.get(race) || new Set();
    const had = new Set(before.headpartIds.map(u32));
    const foreign = after.headpartIds.map(u32).filter((h) => HEADS.owner.has(h) && !own.has(h) && !had.has(h));
    if (!foreign.length) return null;
    const drop = new Set(foreign);
    // The head before: the race default head the look had (as a rule its own race's). A look with none wears a head that
    // is no race's default (a high-poly one, say), and nothing is guessed for it (review, 8 Oct: the race's vanilla head
    // used to go in here in place of the player's own, and the look then counted as changed and was charged). Of the
    // parts the editor took out, the one Face part is that head and goes back; with no Face part taken out the foreign
    // head was only added and just goes. When a record cannot be read, only a plain swap is certain: one part out and
    // nothing in but the foreign head (second review, 8 Oct: a hair the player replaced beside an added Nord head was
    // taken for the head). Anything else (several Face parts out, say) cannot be told, and the result stands.
    const now = new Set(after.headpartIds.map(u32));
    let at = before.headpartIds.findIndex((h) => HEADS.owner.has(u32(h)));
    if (at < 0) {
      const gone = before.headpartIds.map((h, i) => i).filter((i) => !now.has(u32(before.headpartIds[i])));
      const types = gone.map((i) => partType(before.headpartIds[i]));
      let heads = null;
      if (types.every((t) => t !== undefined)) heads = gone.filter((i, k) => types[k] === FACE);
      else if (gone.length === 1 && after.headpartIds.map(u32).every((h) => had.has(h) || drop.has(h))) heads = gone;
      if (!heads || heads.length > 1) return { look: null, from: HEADS.owner.get(foreign[0]) };
      at = heads.length ? heads[0] : -1;
    }
    const ids = after.headpartIds.filter((h) => !drop.has(u32(h)));
    const mine = at >= 0 ? before.headpartIds[at] : null;
    if (mine !== null && !ids.some((h) => u32(h) === u32(mine))) ids.splice(Math.min(at, ids.length), 0, mine);
    return { look: Object.assign({}, after, { headpartIds: ids }), from: HEADS.owner.get(foreign[0]) };
  };

  // A look the server put back (or laid tells on) inside the client's settle window reaches everyone but the player: it
  // is sent again once the window is over. Nothing when the stored look is what the client sent (it shows it already),
  // and nothing if by then the player has left, another session has the character or another edit is open. What goes is
  // the stored look as it is then: the client drops every write to its own look in the window, not only the echo
  // (remoteServer.ts onUpdateAppearanceMessage, isRaceMenuSettling), so a newer write made in it (a mask, the tells, a
  // GM's /rename) needs sending again as well, and being the newest it overwrites nothing (review, 8 Oct). Nothing in a
  // beast form taken meanwhile: beastform.js keeps the mortal race in the stored look, named after the form, so this
  // write would rebuild the mortal head on the beast body on the player's own screen (the client skips only a beast
  // race id); the revert sends the look the form kept, which the transform read after the close (second review, 8 Oct).
  const resendAfterSettle = (a, sent) => {
    const now = get(a, 'appearance');
    if (!now || typeof now !== 'object') return false;
    if (sent && typeof sent === 'object' && JSON.stringify(now) === JSON.stringify(sent)) return false;
    const user = userOf(a);
    if (!(user >= 0)) return false;
    later(() => {
      try {
        if (get(a, 'isOnline') === false || userOf(a) !== user) return;
        if (get(a, EDIT) || get(a, CHARGEN)) return;
        if (inBeastForm(a)) return;
        const cur = get(a, 'appearance');
        if (!cur || typeof cur !== 'object') return;
        mp.set(a, 'appearance', cur);
      } catch (e) { log('appearance: the settled look could not be sent again to', who(a), e.message); }
    }, SETTLE_RESEND_MS);
    return true;
  };
  // Guard 3: the new look becomes what a vampire's or werewolf's tells hide (supernatural.js)
  const retakeTells = (a, before) => {
    try { if (typeof globalThis.__dboTellsRetake === 'function') globalThis.__dboTellsRetake(a, before); }
    catch (e) { log('appearance: tells retake failed for', who(a), e.message); }
  };
  const HEAD_NOTE = 'The editor had given you another race\'s face; your own was kept.';
  // The head guard's verdict on a close: the guarded look, or null; a swap whose head from before cannot be told is
  // audited for staff and the editor's result stands
  const headGuardOf = (a, before, after, how) => {
    const g = guardHead(before, after);
    if (g && !g.look) audit(`APPEARANCE ${who(a)} editor swapped in ${raceName(g.from)}'s default head, but their own could not be told from the other parts changed; saved as made, check it${how ? ` (${how})` : ''}`);
    return g && g.look ? g : null;
  };
  // ---- The RaceMenu save window (9 Oct) ----
  // What skee keeps and SkyMP does not (face sliders and sculpt: racemenupresets.js; overlays, node scales, body morphs:
  // appearanceextras.js) reaches the server a few seconds after the editor closes (the client captures 3-3.5 s after the
  // close, then uploads), so after finish() below has settled the look. Both modules ask __dboRaceMenuSaveGate before they
  // store a change, so it keeps the look's rules: only an editor the server opened (creation, /appearance, a GM's /chargen,
  // a patron's /reroll), not one whose look was put back (race or sex changed, gold short), nor the console's
  // showracemenu (isAllowed false). An /appearance closed with the vanilla look unchanged would otherwise save a
  // RaceMenu-only change for free and start no cooldown, so that change is paid for when it arrives. A character's first
  // save of each kind is free (config appearance.raceMenuFirstSaveFree, default on): before these modules ran nothing of
  // it was ever kept, so a player putting back a face they already made (and maybe paid for) is not charged again.
  // Kept across a hot reload; config appearance.raceMenuSaveWindowSeconds (default 90: a full sculpt upload is about 25 s).
  const SAVE_WINDOW_MS = Math.max(10, Number(C.raceMenuSaveWindowSeconds) || 90) * 1000;
  // When each editor the server opened was opened (racemenupresets.js takes a change to a saved face only from an editor
  // opened after that face was put back on the player); creation in gamemode.js writes it too
  const editorOpenedAt = globalThis.__dboRaceMenuOpenedAt instanceof Map ? globalThis.__dboRaceMenuOpenedAt : (globalThis.__dboRaceMenuOpenedAt = new Map());
  function noteEditorOpened(a) {
    const now = Date.now();
    editorOpenedAt.set(a >>> 0, now);
    if (editorOpenedAt.size > 512) for (const [k, t] of editorOpenedAt) if (now - t > 3600000) editorOpenedAt.delete(k);
  }
  const saveWindows = globalThis.__dboRaceMenuSaveWindows instanceof Map ? globalThis.__dboRaceMenuSaveWindows : (globalThis.__dboRaceMenuSaveWindows = new Map());
  // headswap: the head guard put the player's own head back in place of another race's that the editor had swapped in
  // (finish() below). A sculpt made in that editor was made on the other head, whose .tri skee keys it by, so it would not
  // show on the player's own (10 Oct review 2-e2e G8, E5): a face from that close with a sculpt on a head its stored face
  // has none on (racemenupresets.js opts.newSculpt) is not taken, and nothing is charged for it. Slider changes, and a
  // sculpt the stored face already had, are taken as from any other close (12 Oct re-review, server-data 4)
  const openSaveWindow = (a, kind, charge, headswap) => {
    const now = Date.now();
    saveWindows.set(a >>> 0, Object.assign({ at: now, until: now + SAVE_WINDOW_MS, kind: String(kind || 'editor'), charge: !!charge }, headswap ? { headswap: true } : {}));
    if (saveWindows.size > 256) for (const [k, w] of saveWindows) if (now > w.until) saveWindows.delete(k);
  };
  const closeSaveWindow = (a) => { saveWindows.delete(a >>> 0); };
  // what: 'face' or 'extras'; first: nothing of that kind is stored for the character yet; opts.clear: the change empties
  // what is stored; opts.otherRace: the stored face was saved on a race that is neither the player's nor its vampire or
  // mortal variant; opts.hold: the change is kept only once a file write lands (racemenupresets.js), see settle below;
  // opts.newSculpt: the face carries a sculpt on a head the stored face has no sculpt on (racemenupresets.js, E5).
  // { ok, reason?, code?, paid?, settle? }; code is the short reason the modules hand on (racemenupresets.js sends it to
  // the client in dboPresetRefused)
  const raceMenuSaveGate = (a, what, first, opts) => {
    a = a >>> 0;
    const w = saveWindows.get(a);
    if (!w) return { ok: false, reason: 'no editor the server opened', code: 'noeditor' };
    if (Date.now() > w.until) { saveWindows.delete(a); return { ok: false, reason: 'the editor closed too long ago', code: 'late' }; }
    // /appearance keeps the race, so a face stored on another race was never on the player in it: what the editor hands
    // back is not that face changed, and it is not taken (10 Oct review R2). Creation, a reroll and a GM's /chargen may
    // change the race, so they may replace it
    if (opts && opts.otherRace && w.kind === 'appearance') return { ok: false, reason: 'the saved face is for another race', code: 'otherrace' };
    // A clear is never paid for: in a priced window (an unchanged /appearance) it is refused. A face is not cleared in any
    // /appearance window, paid or not: an empty capture is what every face that was not put back sends (10 Oct review R5),
    // so only creation, a reroll and a GM's /chargen clear one. Extras may be cleared after a paid look change
    if (opts && opts.clear) {
      if (w.charge) return { ok: false, reason: 'a clear is never paid for', code: 'clear' };
      if (what === 'face' && w.kind === 'appearance') return { ok: false, reason: 'a RaceMenu face is cleared only by staff or a reroll', code: 'clear' };
      return { ok: true, kind: w.kind };
    }
    // A sculpt made on a head the guard swapped back (see openSaveWindow): refused before any price, first save or not
    if (what === 'face' && w.headswap && opts && opts.newSculpt) return { ok: false, reason: 'made on another race\'s head the editor swapped in (own head kept)', code: 'headswap' };
    if (!w.charge) return { ok: true, kind: w.kind };
    if (first && C.raceMenuFirstSaveFree !== false) {
      audit(`APPEARANCE ${who(a)} kept their RaceMenu ${what} for the first time (free)`);
      return { ok: true, kind: w.kind, free: true };
    }
    if (!takeGold(a, cost)) {
      system(a, `Your RaceMenu changes weren't saved: they cost ${cost} gold and you don't have it. They are gone when you log out.`);
      audit(`APPEARANCE ${who(a)} changed only RaceMenu details (${what}) without ${cost} gold: not saved`);
      return { ok: false, reason: 'gold', code: 'gold' };
    }
    // One charge covers the face and the extras of the same close
    w.charge = false;
    const lastBefore = get(a, LAST);
    const chargedAt = Date.now();
    mp.set(a, LAST, chargedAt);
    const paidTold = () => {
      system(a, `Your RaceMenu changes are saved. ${cost} gold paid.`);
      audit(`APPEARANCE ${who(a)} changed only RaceMenu details (${what}) for ${cost} gold`);
    };
    if (!(opts && opts.hold)) { paidTold(); return { ok: true, kind: w.kind, paid: cost }; }
    // opts.hold: the gold is taken now, so it cannot be spent meanwhile, but the charge stands only once the change is on
    // disk (10 Oct review 2, a: a face write that failed kept the gold, and the face was gone at the next restart). The
    // caller runs settle once: settle(true) tells the player it is saved and paid; settle(false) gives the gold back, puts
    // the cooldown back as it was and the price back on this window (the caller tells the player it was not saved)
    let settled = false;
    const settle = (saved) => {
      if (settled) return;
      settled = true;
      if (saved) { paidTold(); return; }
      giveGold(a, cost);
      if (Number(get(a, LAST)) === chargedAt) mp.set(a, LAST, lastBefore === undefined ? 0 : lastBefore);
      if (saveWindows.get(a) === w) w.charge = true;
      audit(`APPEARANCE ${who(a)} RaceMenu ${what} could not be written: ${cost} gold given back`);
    };
    return { ok: true, kind: w.kind, paid: cost, settle };
  };
  // gamemode.js appearanceHook, for a close finish() does not take: an editor the server opened (creation, a reroll, a GM's
  // /chargen) may save what skee keeps, free; one it did not (isAllowed false, the console's showracemenu) may not
  const raceMenuClosed = (a, isAllowed, kind) => { if (isAllowed) openSaveWindow(a, kind || 'editor', false); else closeSaveWindow(a); };
  globalThis.__dboRaceMenuSaveGate = raceMenuSaveGate;
  // A RaceMenu-only change racemenupresets.js or appearanceextras.js did not keep: the player is told, with nothing charged
  // for it (10 Oct review S5: the refusals were silent, so a player saw "my face didn't save" with no reason). code is the
  // gate's or the module's own; 'gold' is told by the gate above. Each reason at most once a minute per player and kind.
  // Kept across a hot reload. True when the player was told.
  const toldAt = globalThis.__dboRaceMenuRefusedToldAt instanceof Map ? globalThis.__dboRaceMenuRefusedToldAt : (globalThis.__dboRaceMenuRefusedToldAt = new Map());
  const NOT_CHARGED = 'You were not charged for them.';
  const FACE_TOLD = {
    notloaded: `Your RaceMenu face changes weren't saved because your saved face was still loading. ${NOT_CHARGED} Wait a moment, then reopen /appearance and redo them.`,
    otherrace: `Your RaceMenu face changes weren't saved: your saved face was made for another race, and /appearance can't replace it. ${NOT_CHARGED} Ask a GM if it needs changing.`,
    clear: 'Your saved RaceMenu face was kept: /appearance doesn\'t remove it. You were not charged. If it isn\'t showing on you, relog. A GM can remove it if you want.',
    unreadable: `Your RaceMenu face changes weren't saved: your saved face couldn't be read just now. ${NOT_CHARGED} Try again in a few minutes.`,
    write: `Your RaceMenu face changes weren't saved: the server couldn't store them. ${NOT_CHARGED} Try again later, and tell a GM if it keeps happening.`,
    headswap: `Your RaceMenu face changes weren't saved: the editor had given you another race's head, and sculpting done on it wouldn't show on your own head, which was kept. ${NOT_CHARGED} Slider changes without sculpting save as usual.`,
  };
  const EXTRAS_TOLD = {
    clear: 'Your saved RaceMenu overlays and body sliders were kept. You were not charged. To remove all of them, change your standard look in /appearance as well, or ask a GM.',
    unreadable: `Your RaceMenu overlays and body sliders weren't saved: the saved ones couldn't be read. ${NOT_CHARGED} Tell a GM.`,
  };
  const ANY_TOLD = {
    noeditor: `Your RaceMenu changes weren't saved: only /appearance (or a GM) can change your saved look, and edits made with the console's showracemenu are lost when you log out.`,
    late: `Your RaceMenu changes arrived too late to be saved. ${NOT_CHARGED} Reopen /appearance and redo them.`,
  };
  const raceMenuRefused = (a, what, code) => {
    a = a >>> 0;
    code = String(code || 'gate');
    if (code === 'gold') return false;
    const now = Date.now();
    // The console's showracemenu: guard 2 below has just told them, for the look
    if (code === 'noeditor' && now - (refusedAt.get(a) || 0) < REFUSED_EVERY_MS) return false;
    const key = `${a}|${what}|${code}`;
    if (now - (toldAt.get(key) || 0) < REFUSED_EVERY_MS) return false;
    toldAt.set(key, now);
    if (toldAt.size > 512) for (const [k, t] of toldAt) if (now - t >= REFUSED_EVERY_MS) toldAt.delete(k);
    const text = (what === 'extras' ? EXTRAS_TOLD : FACE_TOLD)[code] || ANY_TOLD[code]
      || `Your RaceMenu ${what === 'extras' ? 'overlays and body sliders' : 'face changes'} weren't saved. ${NOT_CHARGED}`;
    system(a, text);
    return true;
  };
  globalThis.__dboRaceMenuRefused = raceMenuRefused;
  // Whether racemenupresets.js or appearanceextras.js keeps this player's RaceMenu-only changes: each module's own switch
  // and staff test list (a missing block is on, as in the modules). While neither does (both off, or on for a staff test
  // this player is not in), a close says those changes are not kept, instead of naming a price for a save that never comes
  const raceMenuKept = (a) => ['racemenuPresets', 'appearanceExtras'].some((k) => {
    const m = (cfg && cfg[k]) || {};
    if (m.enabled === false) return false;
    const test = Array.isArray(m.testProfiles) && m.testProfiles.length ? m.testProfiles.map(Number) : null;
    return !test || test.includes(Number(profileOf(a)));
  });
  const NOT_KEPT_NOTE = ' RaceMenu-only details (extra sliders, sculpt, overlays) are not saved yet and are gone when you log out.';

  // The editor closed with this appearance (gamemode.js appearanceHook, the engine has already applied it). True when it
  // was ours to handle.
  const finish = (a, appearance) => {
    a = a >>> 0;
    const e = get(a, EDIT);
    if (!e || !e.before) return false;
    mp.set(a, EDIT, null);
    // A GM's /chargen opened over it ends with this close too
    if (get(a, CHARGEN)) mp.set(a, CHARGEN, null);
    const before = e.before;
    const after = appearance && typeof appearance === 'object' ? copy(appearance) : null;
    closeSaveWindow(a);
    if (!after) return true;
    const raceChanged = C.allowRace !== true && Number(after.raceId) !== Number(before.raceId);
    const sexChanged = C.allowSex !== true && !!after.isFemale !== !!before.isFemale;
    if (raceChanged || sexChanged) {
      mp.set(a, 'appearance', before);
      resendAfterSettle(a, appearance);
      system(a, `${raceChanged ? 'Race' : 'Sex'} can't be changed here, so your previous look was kept. No gold was taken.`);
      audit(`APPEARANCE ${who(a)} tried to change ${raceChanged ? 'race' : 'sex'}: previous look kept, nothing charged`);
      return true;
    }
    const guarded = headGuardOf(a, before, after, '');
    const look = guarded ? guarded.look : after;
    if (guarded) audit(`APPEARANCE ${who(a)} editor swapped in ${raceName(guarded.from)}'s default head; kept their own`);
    const headNote = guarded ? ` ${HEAD_NOTE}` : '';
    const nameKept = String(look.name || '') !== String(before.name || '');
    if (nameKept) look.name = before.name;
    if (sameLook(look, before)) {
      if (nameKept || guarded) { mp.set(a, 'appearance', before); resendAfterSettle(a, appearance); }
      if (!raceMenuKept(a)) {
        system(a, `Your look is unchanged, so nothing was charged.${headNote}${nameKept ? ' Your name stays the same: a GM can rename you.' : ''}${NOT_KEPT_NOTE}`);
        return true;
      }
      // A RaceMenu-only change (sliders, sculpt, overlays) arrives after this and is paid for then (raceMenuSaveGate); a
      // face made on a swapped-in head is not taken (E5)
      openSaveWindow(a, 'appearance', true, !!guarded);
      system(a, `Your standard look is unchanged. RaceMenu-only changes (extra sliders, sculpt, overlays) cost ${cost} gold and are charged when they are saved.${headNote}${nameKept ? ' Your name stays the same: a GM can rename you.' : ''}`);
      return true;
    }
    if (!takeGold(a, cost)) {
      mp.set(a, 'appearance', before);
      resendAfterSettle(a, appearance);
      system(a, `You no longer have ${cost} gold, so your previous look was kept.`);
      audit(`APPEARANCE ${who(a)} closed the editor without ${cost} gold: previous look kept`);
      return true;
    }
    if (nameKept || guarded) mp.set(a, 'appearance', look);
    mp.set(a, LAST, Date.now());
    // Paid: what skee keeps from this close is saved with it, but for a face made on a swapped-in head (E5)
    openSaveWindow(a, 'appearance', false, !!guarded);
    retakeTells(a, before);
    resendAfterSettle(a, appearance);
    system(a, `Your new look is saved. ${cost} gold paid.${headNote}${nameKept ? ' Your name stays the same: a GM can rename you.' : ''}${raceMenuKept(a) ? '' : NOT_KEPT_NOTE}`);
    audit(`APPEARANCE ${who(a)} changed their look for ${cost} gold${nameKept ? ' (a name change in the editor was undone)' : ''}`);
    return true;
  };

  // A GM's /chargen (gamemode.js) on a character that already exists: the look as it stands, so that the close can be
  // guarded as /appearance's is. Not for a character still being made (creation's own path), nor while the player's own
  // /appearance edit is open (finish() takes that close). kind 'reroll': a patron's identity reroll (patrons.js open()),
  // which reopens the editor on the same character the same way and so gets the same head guard (review, 8 Oct); a
  // /chargen while a reroll is open leaves the close to the reroll. Taken once the editor is open, so a menu that failed
  // to open leaves none behind. True when a snapshot was taken.
  const chargenOpened = (t, kind) => {
    t = t >>> 0;
    noteEditorOpened(t);
    const reroll = kind === 'reroll';
    if (!reroll && get(t, 'private.rerollPending') === true) return false;
    const look = get(t, 'appearance');
    const fresh = !look || typeof look !== 'object' || get(t, 'private.creationPending') === true;
    if (fresh || pending(t)) { if (get(t, CHARGEN)) mp.set(t, CHARGEN, null); return false; }
    mp.set(t, CHARGEN, Object.assign({ at: Date.now(), before: copy(look) }, reroll ? { kind: 'reroll' } : {}));
    return true;
  };
  // That editor closed (gamemode.js appearanceHook, isAllowed). A GM, or a reroll, may change race and sex there, so only
  // the head guard (which needs both unchanged) and the tells apply; creation's and the reroll's steps in the hook still
  // run after this, as they always did (the reroll's __dboRerollDone and the vampire race fix read the look as this
  // leaves it). True when it was a /chargen or reroll close on an existing character.
  const chargenFinish = (a, appearance) => {
    a = a >>> 0;
    const e = get(a, CHARGEN);
    if (!e || !e.before) return false;
    mp.set(a, CHARGEN, null);
    if (!(Date.now() - (Number(e.at) || 0) < CHARGEN_MAX_MS)) return false;
    const reroll = e.kind === 'reroll';
    // Made, or for a /chargen rerolled, since the snapshot: that close is creation's (or the reroll's)
    if (get(a, 'private.creationPending') === true || (!reroll && get(a, 'private.rerollPending') === true)) return false;
    const after = appearance && typeof appearance === 'object' ? copy(appearance) : null;
    if (!after) return true;
    const before = e.before;
    const how = reroll ? 'reroll' : 'GM /chargen';
    const guarded = headGuardOf(a, before, after, how);
    const look = guarded ? guarded.look : after;
    if (guarded) {
      mp.set(a, 'appearance', look);
      system(a, HEAD_NOTE);
      audit(`APPEARANCE ${who(a)} editor swapped in ${raceName(guarded.from)}'s default head; kept their own (${how})`);
    }
    // A reroll's new look too (second review, 8 Oct): nothing else takes it as what the tells hide (setLookRace swaps
    // only the race, and the slow tick keeps the old kept look while the tell eyes stay in the list), so the next feed
    // gave back the skin and eyes from before the reroll. The retake compares with the look before and reads the race
    // family from the new look, so a reroll to another race is handled as well; the vampire race fix runs after it
    if (!sameLook(look, before)) retakeTells(a, before);
    resendAfterSettle(a, appearance);
    return true;
  };
  // Guard 2: an editor result the server did not open (isAllowed false: the engine kept the stored look). True when the
  // player was told. A pure echo (the client sends its look on every RaceSex Menu close) and a character still being made
  // say nothing, and one notice a minute at most (the audit line with it).
  const refusedAt = globalThis.__dboAppearanceRefusedAt instanceof Map ? globalThis.__dboAppearanceRefusedAt : (globalThis.__dboAppearanceRefusedAt = new Map());
  const refused = (a, appearance) => {
    a = a >>> 0;
    if (C.refusedNotice === false || !appearance || typeof appearance !== 'object') return false;
    if (!(profileOf(a) >= 0)) return false;
    if (get(a, 'private.creationPending') === true || get(a, 'private.rerollPending') === true) return false;
    const stored = get(a, 'appearance');
    if (!stored || typeof stored !== 'object' || sameLook(appearance, stored)) return false;
    const now = Date.now();
    if (now - (refusedAt.get(a) || 0) < REFUSED_EVERY_MS) return false;
    refusedAt.set(a, now);
    if (refusedAt.size > 512) for (const [k, t] of refusedAt) if (now - t >= REFUSED_EVERY_MS) refusedAt.delete(k);
    personal(a, 'That change to your look wasn\'t saved. Only /appearance (or a GM) can change your saved look, and edits made with the console\'s showracemenu are lost when you log out.');
    audit(`APPEARANCE ${who(a)} editor result refused (not opened by the server)`);
    return true;
  };

  globalThis.__dboAppearanceEdit = { pending, finish, blocked, chargenOpened, chargenFinish, refused, raceMenuClosed };
  log(`appearance ${C.enabled ? 'on' : 'off'}: /appearance costs ${cost} gold, every ${Number(C.cooldownHours) || 0} h, race ${C.allowRace === true ? 'free' : 'kept'}, sex ${C.allowSex === true ? 'free' : 'kept'}, head guard ${C.headGuard === false ? 'off' : `on (${HEADS.raceOf.size} race ids)`}`);
  return { pending, finish, blocked, goldOf, takeGold, C, chargenOpened, chargenFinish, refused, guardHead, sameLook, SETTLE_RESEND_MS, raceMenuClosed, raceMenuSaveGate, raceMenuRefused };
};
