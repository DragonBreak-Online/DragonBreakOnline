// DragonBreak Online: the Skills tab of the F3 journal (design ~/claude-nate-release/specs/f3-hub-design.md 3.2, piece
// H6). Loaded by gamemode.js after journal.js.
//
// The section is the K menu's own object, from fork masterySystem's __alduinakMasteryMenu (the Wheel, the 18 skills with
// their rules text, lore and tierLore, the held levels and locks, the standing offers). K on a client that asks with
// preferJournal opens this tab instead of widget 25 (masterySystem asks __dboJournalOpenTab(actor, 'skills')).
// Journal contract (H1 shell): __dboJournalSections.skills = { visible, view } puts it at payload.skills; the event
//   journalSkill [nonce, op, skillId, arg?]   op: choose | drop | lock (arg raise|hold|lower) | takeUp
// runs the K menu's handler through __alduinakMasteryAction inside __dboJournalLimited (the 3 s rule) and answers with
// the handler's own words in the result line.
'use strict';

module.exports = (api) => {
  const { log, onUi } = api;
  const OPS = new Set(['choose', 'drop', 'lock', 'takeUp']);
  const menuOf = (a) => (typeof globalThis.__alduinakMasteryMenu === 'function' ? globalThis.__alduinakMasteryMenu(a >>> 0) : null);
  const sections = globalThis.__dboJournalSections || (globalThis.__dboJournalSections = {});
  // The client draws the journal's Skills tab natively (gamemode.js's panel state: the caps it announced)
  const nativeJournal = (a) => {
    try { const p = globalThis.__dboPanelState; const c = p && p.native ? p.native.get(a >>> 0) : null; return !!c && c.has('native:journalTab:skills'); } catch (e) { return false; }
  };
  const smithOf = (a) => { try { return typeof globalThis.__dboSmithView === 'function' ? globalThis.__dboSmithView(a >>> 0) || null : null; } catch (e) { return null; } };
  // Shown once the fork has the hook (server-f3-skills); before that K keeps opening widget 25. A link from elsewhere (Profile's meters) arrives as opts.focus { skill } and names the page to show
  sections.skills = {
    visible: () => typeof globalThis.__alduinakMasteryMenu === 'function',
    view: (a, opts) => {
      const m = menuOf(a);
      const want = opts && opts.focus && typeof opts.focus === 'object' ? String(opts.focus.skill || '') : '';
      const out = m && want ? Object.assign({}, m, { focus: want.slice(0, 40) }) : m;
      // A native journal gets Blacksmithing's recipes and Arcane Arts' schools only with that page in view, and asks for them
      // when the player opens it (paged; live, 3 Nov: the whole tab passed the 60,000 a native panel takes and went to the
      // browser). The page in view is the focus, else the highest held skill, else the first, as the tab picks it
      const paged = nativeJournal(a);
      const held = m && m.points && Array.isArray(m.points.held) ? m.points.held : [];
      const viewing = want || (held[0] && held[0].id) || (m && Array.isArray(m.skills) && m.skills[0] ? m.skills[0].id : '');
      // Blacksmithing's page shows the craft tiers and recipes (smithing.js __dboSmithView; null without the skill or with
      // smithing off, and then the page keeps its usual tier cards)
      const smith = !paged || viewing === 'blacksmith' ? smithOf(a) : null;
      // Arcane Arts' page shows each school's state and today's casting (schools.js __dboSchoolsBrief)
      let magic = null; try { magic = (!paged || viewing === 'arcane') && typeof globalThis.__dboSchoolsBrief === 'function' ? globalThis.__dboSchoolsBrief(a >>> 0) : null; } catch (e) { magic = null; }
      // A Master Scholar's two scribing timers (scribing.js; Nate and Swag, 17 Oct), added to the Scholar page's rules text: the
      // page draws the skill's description as it comes, so this needs no client or front change
      let scribe = null; try { scribe = typeof globalThis.__dboScribingBrief === 'function' ? globalThis.__dboScribingBrief(a >>> 0) : null; } catch (e) { scribe = null; }
      const skills = out && scribe && scribe.text && Array.isArray(out.skills)
        ? out.skills.map((k) => (k && k.id === 'scholar' ? Object.assign({}, k, { description: `${String(k.description || '').trim()} ${scribe.text}`.trim() }) : k)) : null;
      const res = out && (smith || magic || skills || paged) ? Object.assign({}, out, paged ? { paged: true } : {}, smith ? { smith } : {}, magic ? { magicSchools: magic } : {}, skills ? { skills } : {}) : out;
      return paged ? fitNative(a, res) : res;
    },
  };

  // Blacksmithing's page still passed what a native panel takes for about one open in eight after paging (live 3 Nov,
  // [native-size] journal:skills at 68-71k, sent to the browser): every family's recipe names ride along. Over the
  // budget, the names leave in this order, and both journals draw such a family as one locked line with how it is
  // learned (skills.as and features/smith, since 26 Oct and 9 Oct): unknown and past the craft tier, then unknown,
  // then known but past the tier. A known family within the tier keeps its names, so Learned recipes stays whole.
  const NATIVE_BUDGET = 55000;
  const sizeOf = (o) => { try { return JSON.stringify(o).length; } catch (e) { return 0; } };
  const noRecipes = (f) => { const c = Object.assign({}, f); delete c.recipes; return c; };
  const fitNative = (a, res) => {
    if (!res || !res.smith || !Array.isArray(res.smith.families)) return res;
    const before = sizeOf(res);
    if (before <= NATIVE_BUDGET) return res;
    const tier = Number(res.smith.tier) || 1;
    const steps = [(f) => !f.known && Number(f.tier) > tier, (f) => !f.known, (f) => Number(f.tier) > tier];
    let fams = res.smith.families, cut = 0, now = before, fit = res;
    for (const drop of steps) {
      fams = fams.map((f) => (f && Array.isArray(f.recipes) && drop(f) ? (cut++, noRecipes(f)) : f));
      fit = Object.assign({}, res, { smith: Object.assign({}, res.smith, { families: fams }) });
      now = sizeOf(fit);
      if (now <= NATIVE_BUDGET) break;
    }
    log(`journal skills: Blacksmithing's page ${before} -> ${now} chars for a native journal, ${cut} families without recipe names${now > NATIVE_BUDGET ? ' (still over: the browser draws it)' : ''}`);
    return fit;
  };

  const fresh = (a, args) => typeof globalThis.__dboJournalFresh === 'function' && !!globalThis.__dboJournalFresh(a, String((args || [])[0] || ''));
  onUi('journalSkill', (a, args) => {
    if (!fresh(a, args)) return;
    const op = String(args[1] || ''); const skill = String(args[2] || '').slice(0, 40); const arg = String(args[3] || '').slice(0, 16);
    if (!OPS.has(op) || !skill || typeof globalThis.__dboJournalLimited !== 'function') return;
    globalThis.__dboJournalLimited(a, () => {
      const act = globalThis.__alduinakMasteryAction;
      if (typeof act !== 'function') return { tab: 'skills', text: 'Your skills cannot be changed here just now. Press K.', kind: 'refused' };
      let r = null;
      try { r = act(a >>> 0, op, { skill, lock: arg }); } catch (e) { log('journalskills: action failed', e.message); }
      if (!r) return { tab: 'skills', text: 'That cannot be done just now.', kind: 'refused' };
      return { tab: 'skills', text: String(r.text || (r.ok ? 'Done.' : 'That cannot be done.')), kind: r.ok ? 'ok' : 'refused' };
    });
  });

  log('journal skills tab on');
  return { menuOf };
};
