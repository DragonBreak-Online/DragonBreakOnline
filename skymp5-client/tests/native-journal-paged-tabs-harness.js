// The native Court and Faction tabs with a paged payload (swf/dbo_journal tabs/court.as, faction.as; live, 3 Nov: a staff
// tab passed the 60,000 characters a native panel takes): only the court or faction in view comes in full, so picking
// another that is only its list entry asks the server for its page (journalTab's focus) instead of drawing it empty, and
// picking one that came in full draws at once.
//   node tests/native-journal-paged-tabs-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const TABS = [{ id: 'court', label: 'Court' }, { id: 'faction', label: 'Faction' }];
const hub = (tab, section) => Object.assign({ type: 'journal', id: 50, nonce: 'n1', hub: 1, tabs: TABS, tab, opened: 1, clock: { date: 'd', time: 't' }, head: { name: 'Olaf', title: 'J', race: 'Nord' } }, { [tab]: section });
const P = (t) => t.root.dboPanel;
const findBy = (t, key, val) => { let hit = null; const walk = (c) => { for (const x of Object.values(c.kids || {})) { if (!hit && x[key] === val && typeof x.onRelease === 'function') hit = x; if (x.kids) walk(x); } }; walk(P(t).body); return hit; };
const asks = (t, before) => t.msgs().slice(before).filter((m) => m.key === 'dbo:journalTab');

const court = (id, name, full) => (full ? { id, name, kind: 'hold', mine: false, offices: [], outgoing: [], household: null, appointable: [] } : { id, name, mine: false, paged: true });
const faction = (id, name, full) => (full ? { id, name, kind: 'guild', myRank: -1, myTitle: '', canInvite: false, members: [], ranks: [] } : { id, name, kind: 'guild', myTitle: '', myRank: -1, paged: true });

for (const [label, paged] of [['paged', true], ['whole', false]]) {
  {
    const t = S.boot('dbo_journal');
    t.push(hub('court', { staff: true, courts: [court('bruma', 'Bruma', true), court('whiterun', 'Whiterun', !paged)], selected: 'bruma', ...(paged ? { paged: true } : {}) }));
    const before = t.msgs().length;
    const b = findBy(t, 'zone', 'whiterun');
    check(`Court (${label}): Whiterun is in the list`, !!b);
    if (b) b.onRelease();
    const a = asks(t, before);
    check(paged ? 'Court: picking a court that is only its list entry asks for its page' : 'Court: a court that came in full opens at once, nothing asked',
      paged ? a.length === 1 && a[0].args[1] === 'court' && a[0].args[2] && a[0].args[2].court === 'whiterun' : a.length === 0, a);
  }
  {
    const t = S.boot('dbo_journal');
    t.push(hub('faction', { staff: true, factions: [faction('fighters', 'Fighters Guild', true), faction('thieves', 'Thieves Guild', !paged)], selected: 'fighters', invites: [], roles: [], ...(paged ? { paged: true } : {}) }));
    const before = t.msgs().length;
    const b = findBy(t, 'fid', 'thieves');
    check(`Faction (${label}): the Thieves Guild is in the list`, !!b);
    if (b) b.onRelease();
    const a = asks(t, before);
    check(paged ? 'Faction: picking a faction that is only its list entry asks for its page' : 'Faction: a faction that came in full opens at once, nothing asked',
      paged ? a.length === 1 && a[0].args[1] === 'faction' && a[0].args[2] && a[0].args[2].faction === 'thieves' : a.length === 0, a);
  }
}

// a summary the tab lands on by itself (a default, a filter) is asked for once, and not again while the answer is on its way
{
  const t = S.boot('dbo_journal');
  const before = t.msgs().length;
  const pay = { staff: true, paged: true, factions: [faction('thieves', 'Thieves Guild', false), faction('fighters', 'Fighters Guild', true)], selected: 'fighters', invites: [], roles: [] };
  t.push(hub('faction', pay));
  t.push(hub('faction', pay));
  const a = asks(t, before);
  check('a faction shown by default without its page is asked for once, not again on the next draw', a.length === 1 && a[0].args[2].faction === 'thieves', a);
}
{
  const t = S.boot('dbo_journal');
  const before = t.msgs().length;
  const pay = { staff: true, paged: true, courts: [court('bruma', 'Bruma', false)], selected: 'nowhere' };
  t.push(hub('court', pay));
  t.push(hub('court', pay));
  const a = asks(t, before);
  check('a court shown by default without its page is asked for once', a.length === 1 && a[0].args[2].court === 'bruma', a);
}

T.done();
