// DragonBreak Online: keeps two vanilla Papyrus loops off the server, and names the next one (server\papyrusguard.js,
// config "papyrusGuard"). Loaded by gamemode.js.
//
// The server runs the vanilla scripts of Skyrim - Misc.bsa on the references that carry them. Two of them, once started,
// get an OnUpdate every second until the next restart and log errors each time (21 Oct, bug sweep item 4: about 3,600
// "VarValue::operator/ - Wrong type" an hour, and 3,600 "VarValue::operator> - Wrong type" with 7,200 "Unable to determine
// Actor for 'Game.GetPlayer' in 'OnUpdate'" an hour):
//  - dunSoljundsBossSCRIPT, on the trigger 6aebe:Skyrim.esm in Soljund's Sinkhole. A player walking in starts it. Its boss
//    (335f3) and its four statues are not in the server's world, so the properties are None: bossMob.IsDead() never says
//    yes, its health over its base health is None / None (the operator/ line), and OnCellDetach, the script's only other
//    way out, is never sent by the server.
//  - BYOHHouseTrophyBaseScript, on the trophy bases BYOHHouseTrophyBase1 and 2 (a31a, a31e:HearthFires.esm; DragonBreak
//    Online Edits.esp puts two in Fort Greymoor, bf794 and bf86c, and players sit on them). Activating one starts it; on
//    21 Oct both looped at once from 02:42 to the 03:25 restart. In an OnUpdate the server has no player for
//    Game.GetPlayer() (only an actor's own OnUpdate has one), so GetItemCount on None is None (the operator> line), and
//    GetDistance(None) is 0.0, so "the player is within 250 units" is true forever.
// Neither OnUpdate can do anything on the server but log and ask for the next one, so this module refuses that one event
// for those forms. The first refused OnUpdate ends the loop (nothing asks for the next), a loop already running ends
// within a second of a reload, and nothing else about them changes: the trigger, activating, sitting.
//
// Diagnostic, cheap: every OnUpdate the server sends is counted per form (one Map update). At most once per
// reportMinutes, and only when something was refused or a form got reportMin or more in that window, one line names the
// busiest forms with their base, so the next loop like these is named by its reference, not by a "Wrong type" line.
// config "papyrusGuard": { enabled, refs: [desc], bases: [desc], report, reportMinutes, reportMin }
// Undo on a hot reload: "enabled": false. Taking this module or its loader out (a revert) does not: the wrapper and the
// last hook live on mp and globalThis until a restart, so set enabled false first (or revert and restart).
'use strict';

module.exports = (api) => {
  const { mp, log, cfg } = api;
  const C = Object.assign({ enabled: true, refs: ['6aebe:Skyrim.esm'], bases: ['a31a:HearthFires.esm', 'a31e:HearthFires.esm'],
    report: true, reportMinutes: 10, reportMin: 120 }, (cfg && cfg.papyrusGuard) || {});
  // '0006AEBE:Skyrim.esm' and '6aebe:skyrim.esm' are the same form
  const normDesc = (d) => { const s = String(d || ''); const i = s.indexOf(':'); if (i < 0) return s.toLowerCase(); const n = parseInt(s.slice(0, i), 16); return (Number.isFinite(n) ? n.toString(16) : s.slice(0, i).toLowerCase()) + ':' + s.slice(i + 1).toLowerCase(); };
  const REFS = new Set((Array.isArray(C.refs) ? C.refs : []).map(normDesc));
  const BASES = new Set((Array.isArray(C.bases) ? C.bases : []).map(normDesc));
  const WINDOW_MS = Math.max(1, Number(C.reportMinutes) || 10) * 60000;
  const REPORT_MIN = Math.max(1, Number(C.reportMin) || 120);
  const CAP = 4096; // forms kept in each Map; a full Map is emptied (verdicts) or takes no new forms (counts)

  // Kept over a reload: the counts of the window in progress. Verdicts are worked out again (the lists may have changed).
  const S = globalThis.__dboPapyrusGuard || (globalThis.__dboPapyrusGuard = { verdict: new Map(), counts: new Map(), refused: new Map(), since: Date.now(), dropped: 0 });
  S.verdict.clear();

  const u32 = (x) => Number(x) >>> 0;
  const descOf = (id) => { try { return normDesc(mp.getDescFromId(id)); } catch (e) { return ''; } };
  const baseOf = (id) => { try { return normDesc(mp.get(id, 'baseDesc')); } catch (e) { return ''; } };
  // A form's verdict, worked out on its first OnUpdate: one desc lookup, and one baseDesc lookup when bases are listed.
  // Plugin forms keep theirs; a runtime form (ff......) is asked each time, as its id can be given to another form later.
  const guarded = (id) => {
    const plugin = id < 0xff000000;
    if (plugin) { const v = S.verdict.get(id); if (v !== undefined) return v; }
    const v = (REFS.size > 0 && REFS.has(descOf(id))) || (BASES.size > 0 && BASES.has(baseOf(id)));
    if (plugin) { if (S.verdict.size >= CAP) S.verdict.clear(); S.verdict.set(id, v); }
    return v;
  };
  const bump = (m, id) => { const n = m.get(id); if (n !== undefined) m.set(id, n + 1); else if (m.size < CAP) m.set(id, 1); else S.dropped++; };
  const name = (id) => { const d = descOf(id) || id.toString(16); const b = baseOf(id); return b ? `${d} (base ${b})` : d; };
  const report = (t) => {
    const busy = [...S.counts.entries()].filter(([, n]) => n >= REPORT_MIN).sort((x, y) => y[1] - x[1]);
    let refused = 0; for (const n of S.refused.values()) refused += n;
    if (C.report !== false && (refused > 0 || busy.length > 0)) {
      const mins = Math.round((t - S.since) / 60000);
      const top = busy.slice(0, 5).map(([id, n]) => `${name(id)} x${n}`).join(', ');
      log(`papyrus OnUpdate, last ${mins} min: refused ${refused} on ${S.refused.size} guarded form(s)`
        + (S.refused.size ? ` [${[...S.refused.entries()].slice(0, 3).map(([id, n]) => `${descOf(id) || id.toString(16)} x${n}`).join(', ')}]` : '')
        + (busy.length ? `; ${busy.length} other form(s) at ${REPORT_MIN}+ (a loop?): ${top}` : '; no other form looping')
        + (S.dropped ? `; ${S.dropped} event(s) on forms past the ${CAP} counted` : ''));
    }
    S.counts.clear(); S.refused.clear(); S.dropped = 0; S.since = t;
  };

  // true: refuse this OnUpdate. Never throws (the wrapper lets the script run if it did).
  globalThis.__dboPapyrusOnUpdate = (formId) => {
    const id = u32(formId);
    const t = Date.now();
    if (t - S.since >= WINDOW_MS) report(t);
    if (C.enabled !== false && guarded(id)) { bump(S.refused, id); return true; }
    bump(S.counts, id);
    return false;
  };
  // The slot is wrapped once per process; a reload swaps what the wrapper asks (traps.js does the same for OnTriggerEnter)
  if (!globalThis.__dboPapyrusGuardWrapped) {
    globalThis.__dboPapyrusGuardWrapped = true;
    const inner = mp['onPapyrusEvent:OnUpdate'];
    mp['onPapyrusEvent:OnUpdate'] = function (formId, ...rest) {
      try { const g = globalThis.__dboPapyrusOnUpdate; if (typeof g === 'function' && g(formId) === true) return false; } catch (e) { /* the script runs */ }
      return typeof inner === 'function' ? inner.call(this, formId, ...rest) : undefined;
    };
  }
  log(`papyrus guard ${C.enabled !== false ? 'on' : 'off'}: OnUpdate refused on ${REFS.size} reference(s) and ${BASES.size} base(s); `
    + `${C.report !== false ? `loop report every ${Math.round(WINDOW_MS / 60000)} min at ${REPORT_MIN}+` : 'no loop report'}`);
  globalThis.__dboPapyrusGuardTest = { normDesc, guarded, report, state: () => S };
};
