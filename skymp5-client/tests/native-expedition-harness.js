// Runs the native Expeditions and Hunting Contracts board (swf/dbo_expedition) on the stub stage with the widget server
// dungeons.js openExpeditions sends (widget 63), against the browser board's own rules (skymp5-front
// features/expeditionBoard): a paper per ruin with its stamp, reading it, Gather or Rejoin your party (events.pick with the
// id), the Contracts tab only when contracts come, held contracts with Give up, a contract taken while fewer than maxActive
// are held, a commission handed in (id and count), the empty notes, the hints, Escape backing out of a paper before it
// closes, and every key exactly the widget's events.* value.
//   node tests/native-expedition-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const P = (t) => t.root.dboPanel;
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const lastAny = (t) => t.msgs().filter((m) => m.key !== 'ready').slice(-1)[0];
const shownPage = (t) => Object.values(P(t).flowClip.kids).find((p) => p._visible);
const texts = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (typeof x.text === 'string' && !x.kids) out.push(x.text); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out.join('|'); };
const buttonsOf = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (x.kids && x.label && x.onPick) out.push(x); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out; };
const turn = (t, d) => t.press(d < 0 ? 33 : 34);
const first = (t) => { for (let i = 0; i < 6; i++) turn(t, -1); };
const seek = (t, label, test) => { const ok = (b) => (test ? test(b) : b.label.text === label); let b = buttonsOf(t).find(ok); if (b) return b; first(t); for (let i = 0; i < 8 && !(b = buttonsOf(t).find(ok)); i++) turn(t, 1); return b; };
const press = (t, label) => { const b = seek(t, label); if (!b) throw new Error('no button ' + label + ' among ' + buttonsOf(t).map((x) => x.label.text).join('|')); b.onRelease(); };
const readOn = (t, row) => { const b = seek(t, null, (x) => x.label.text === 'Read' && x._parent.label && x._parent.label.text.indexOf(row) === 0); if (!b) throw new Error('no paper ' + row); b.onRelease(); };
const everyPage = (t) => { first(t); const out = []; for (let i = 0; i < 8; i++) { out.push(texts(t)); const before = texts(t); turn(t, 1); if (texts(t) === before) break; } first(t); return out.join('|'); };
const tabBtn = (t, re) => Object.values(P(t).head.kids).find((k) => k.label && re.test(k.label.text));
const footBtn = (t, label) => Object.values(P(t).foot.kids).find((k) => k.label && k.label.text === label);

const EV = { pick: 'dbo:expeditionPick', close: 'dbo:expeditionClose', contractTake: 'dbo:contractTake', contractAbandon: 'dbo:contractAbandon', contractDeliver: 'dbo:contractDeliver' };
const exps = [
  { id: 'varsa', name: 'Varsa Ruins', county: 'Bruma County', kind: 'Ayleid ruin', status: 'open', state: 'open', masters: ['an Ayleid lich', 'a bandit chief', 'a wraith'] },
  { id: 'nenyond', name: 'Nenyond Twyll', county: '', kind: 'Ayleid ruin', status: 'your party is inside', state: 'yours', masters: [] },
  { id: 'sardavar', name: 'Sardavar Leed', county: 'Cheydinhal County', kind: 'Ayleid ruin', status: 'rests for you 40 min', state: 'resting', masters: ['a necromancer'] },
];
const work = [
  { id: 'w1', what: '3 wolves', count: 3, reward: 90, danger: 1, hoursLeft: 5, state: 'open', postedBy: '' },
  { id: 'w2', what: 'a troll', count: 1, reward: 300, danger: 3, hoursLeft: 1, state: 'yours', postedBy: 'Jarl Sigrid' },
  { id: 'w3', what: '2 bears', count: 2, reward: 150, danger: 2, hoursLeft: 8, state: 'posted' },
  { id: 'c1', what: 'Iron ore', count: 10, reward: 200, danger: 0, hoursLeft: 30, state: 'open', type: 'commission', item: 'iron ore', price: 20, have: 4 },
];
const held = { id: 'w2', what: 'a troll', zone: 'Bruma', progress: 0, count: 1, reward: 300, hoursLeft: 1 };
const ctabs = (o) => Object.assign({ enabled: true, zone: 'Bruma', treasury: 5000, note: '', held, heldAll: [held], maxActive: 3, list: work, canPost: false }, o);
const W = (o) => Object.assign({ type: 'expeditionBoard', id: 63, hall: 'the Synod Conclave', expeditions: exps, bossReturnMinutes: 10, leaseMinutes: 60, tab: 'expeditions', events: EV }, o);

// ---- expeditions only (an older server: no contracts) ----
{
  const t = S.boot('dbo_expedition');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1);
  t.push(W());
  check('the title is Expeditions, no tabs without contracts', P(t).head.title.text === 'EXPEDITIONS' && !tabBtn(t, /Contracts/));
  check('the lead names the hall', /posted in the Synod Conclave\. Gather your party and set out\./.test(texts(t)));
  check('a paper per ruin with its stamp, kind, county and status', /Varsa Ruins  -  Wanted/.test(texts(t)) && /Ayleid ruin, Bruma County  -  open/.test(texts(t)) && /Nenyond Twyll  -  Your party/.test(texts(t)) && /Sardavar Leed  -  Resting/.test(everyPage(t)));
  check('your party\'s paper stands out', seek(t, null, (b) => b._parent.label && /Nenyond/.test(b._parent.label.text))._parent.label.textColor === 0x7FBF7F);
  check('the hint: claim length and the return after the master falls', /A claim lasts 60 minutes\. Once the ruin's master falls, the party comes home 10 minutes later\./.test(P(t).foot.hint.text));
  readOn(t, 'Varsa Ruins');
  check('reading: the ruin, its keepers listed, Gather your party and Back', /Sellswords and scholars wanted for Varsa Ruins, Bruma County\./.test(texts(t)) && /kept by an Ayleid lich, a bandit chief and a wraith\./.test(texts(t)) && !!seek(t, 'Gather your party') && !!seek(t, 'Back'));
  check('reading sends nothing', t.msgs().filter((m) => m.key !== 'ready').length === 0);
  t.press(27);
  check('Escape backs out of the paper, not the board', !t.closed() && /Varsa Ruins  -  Wanted/.test(texts(t)) && !msgs(t, EV.close).length);
  readOn(t, 'Varsa Ruins');
  press(t, 'Gather your party');
  check('Gather your party sends events.pick with the ruin\'s id', lastAny(t).key === 'dbo:expeditionPick' && lastAny(t).args.join('|') === 'varsa');
  readOn(t, 'Nenyond Twyll');
  check('your own party: Rejoin, and a ruin with no known keeper says none', !!seek(t, 'Rejoin your party') && !/kept by/.test(texts(t)) && /far to the south/.test(texts(t)));
  press(t, 'Back');
  check('Back returns to the papers', /Varsa Ruins  -  Wanted/.test(texts(t)));
  t.push(W({ expeditions: [] }));
  check('none posted says so', /No expeditions are being organised right now\./.test(texts(t)));
  t.press(27);
  check('Escape on the board closes with events.close', msgs(t, EV.close).length === 1 && t.closed());
}

// ---- contracts ----
{
  const t = S.boot('dbo_expedition');
  t.push(W({ contracts: ctabs() }));
  check('contracts come with two tabs and their counts', !!tabBtn(t, /^Expeditions \(3\)$/) && !!tabBtn(t, /^Contracts \(4\)$/));
  tabBtn(t, /^Contracts/).onRelease();
  check('the Contracts tab: its title, lead, held contract and the papers', P(t).head.title.text === 'HUNTING CONTRACTS' && /pays for dangerous beasts slain in its wilds/.test(texts(t))
    && /You hold: a troll in Bruma/.test(texts(t)) && /0 of 1 slain  -  300 gold  -  fades within the hour/.test(texts(t)));
  const all = everyPage(t);
  check('each paper\'s stamp and line', /3 wolves  -  Wanted/.test(all) && /A pest  -  90 gold  -  fades in 5 hours/.test(all) && /a troll  -  Yours/.test(all) && /2 bears  -  Your notice/.test(all) && /Iron ore  -  Buying/.test(all) && /You carry 4/.test(all));
  check('switching tabs sends nothing', t.msgs().filter((m) => m.key !== 'ready').length === 0);
  check('the hint: up to 3 at a time, kills in the hold\'s wilds', /You may hold up to 3 contracts at a time/.test(P(t).foot.hint.text) && /Kills count only in Bruma's wilds/.test(P(t).foot.hint.text) && !/As an official/.test(P(t).foot.hint.text));
  press(t, 'Give up');
  check('Give up on a held contract sends contractAbandon with its id', lastAny(t).key === 'dbo:contractAbandon' && lastAny(t).args.join('|') === 'w2');
  readOn(t, '3 wolves');
  check('an open contract with one held of three: open to any hunter, Take the contract', /Open to any hunter\./.test(texts(t)) && /pays 90 gold for 3 wolves slain in its wilds/.test(texts(t)) && !!seek(t, 'Take the contract'));
  press(t, 'Take the contract');
  check('...which sends contractTake with its id', lastAny(t).key === 'dbo:contractTake' && lastAny(t).args.join('|') === 'w1');
  t.push(W({ tab: 'contracts', contracts: ctabs({ heldAll: [held, held, held] }) }));
  readOn(t, '3 wolves');
  check('three held of three: no Take, and it says the most', !seek(t, 'Take the contract') && /You already hold 3 contracts, the most at once\./.test(texts(t)));
  t.push(W({ tab: 'contracts', contracts: ctabs({ maxActive: 1 }) }));
  readOn(t, '3 wolves');
  check('one at a time, one held: You already hold a contract', !seek(t, 'Take the contract') && /You already hold a contract\./.test(texts(t)));
  t.push(W({ tab: 'contracts', contracts: ctabs() }));
  readOn(t, 'a troll');
  check('your own contract: Give it up, posted by named', !!seek(t, 'Give it up') && /You hold this contract\. Posted by Jarl Sigrid\./.test(texts(t)));
  press(t, 'Give it up');
  check('...which sends contractAbandon', lastAny(t).args.join('|') === 'w2' && lastAny(t).key === 'dbo:contractAbandon');
  readOn(t, '2 bears');
  check('a notice you posted: someone else hunts, no Take', /You posted this notice; someone else must do the hunting\./.test(texts(t)) && !seek(t, 'Take the contract'));
  press(t, 'Back');
  readOn(t, 'Iron ore');
  check('a commission: what the hold buys and at what price, Hand in 4 for 80 gold', /buys 10 iron ore at 20 gold each/.test(texts(t)) && /You carry 4\./.test(texts(t)) && !!seek(t, 'Hand in 4 for 80 gold'));
  press(t, 'Hand in 4 for 80 gold');
  check('...which sends contractDeliver with its id and the count', lastAny(t).key === 'dbo:contractDeliver' && lastAny(t).args.join('|') === 'c1|4', lastAny(t));
  t.push(W({ tab: 'contracts', contracts: ctabs({ list: [Object.assign({}, work[3], { have: 0 })] }) }));
  readOn(t, 'Iron ore');
  check('carrying none: no hand-in', !seek(t, 'Hand in 0 for 0 gold') && !seek(t, null, (b) => /^Hand in/.test(b.label.text)));
  t.push(W({ tab: 'contracts', contracts: ctabs({ enabled: false }) }));
  readOn(t, '3 wolves');
  check('contracts off: no Take', !seek(t, 'Take the contract'));
  t.push(W({ tab: 'contracts', contracts: ctabs({ list: [], heldAll: [], held: null, note: 'Budget spent for today.', canPost: true, maxActive: 1 }) }));
  check('empty with a note says the note; an official is told where to post', /Budget spent for today\./.test(texts(t)) && /As an official you post work/.test(P(t).foot.hint.text) && /You may hold one contract at a time/.test(P(t).foot.hint.text));
  t.push(W({ tab: 'contracts', contracts: ctabs({ list: [], heldAll: [], held: null, note: '' }) }));
  check('empty without a note says the default', /No hunting work is posted here right now\./.test(texts(t)));
  t.push(W({ tab: 'contracts', contracts: ctabs({ heldAll: undefined, held }) }));
  check('an older contracts tab with held only still shows it', /You hold: a troll in Bruma/.test(texts(t)));
  footBtn(t, 'Close').onRelease();
  check('Close sends events.close and closes', msgs(t, EV.close).length === 1 && t.closed());
}

// ---- the server's own events, re-sent board, the rest ----
{
  const t = S.boot('dbo_expedition');
  const ev2 = { pick: 'dbo:expeditionPickX', close: 'dbo:expeditionCloseX', contractTake: 'dbo:takeX' };
  t.push(W({ events: ev2, contracts: ctabs(), tab: 'contracts' }));
  check('a board the server sends on Contracts opens there', P(t).head.title.text === 'HUNTING CONTRACTS');
  check('no abandon event: no Give up button on the held contract', !seek(t, 'Give up'));
  readOn(t, '3 wolves'); press(t, 'Take the contract');
  check('the keys are the widget\'s own events, verbatim', lastAny(t).key === 'dbo:takeX');
  readOn(t, '3 wolves');
  t.push(W({ events: ev2, contracts: ctabs(), tab: 'contracts' }));
  check('a re-sent board ends the reading', /3 wolves  -  Wanted/.test(everyPage(t)) && !seek(t, 'Take the contract'));
  t.press(27);
  check('Escape closes with that board\'s close event', msgs(t, 'dbo:expeditionCloseX').length === 1 && t.closed());
  const d = S.boot('dbo_expedition');
  d.push(W({ events: undefined }));
  readOn(d, 'Varsa Ruins'); press(d, 'Gather your party');
  check('no events at all: the browser board\'s defaults', lastAny(d).key === 'dbo:expeditionPick');
  d.press(40);
  check('Down focuses the first control', d.ctx.focus === 0);
  const many = [];
  for (let i = 0; i < 18; i++) many.push(Object.assign({}, exps[0], { id: 'r' + i, name: 'Ruin ' + i }));
  const g = S.boot('dbo_expedition');
  g.push(W({ expeditions: many }));
  check('a long board pages', /Page 1 of /.test(P(g).foot.pages.text));
  g.press(39);
  check('Right turns the page', /Page 2 of /.test(P(g).foot.pages.text));
  const n = S.boot('dbo_expedition');
  n.push({ type: 'expeditionBoard', id: 63 });
  check('an unreadable payload draws nothing', !n.root.dboPanel.head);
  n.st.time += 8000; n.tick();
  check('...and with no payload the panel closes itself', n.closed());
}

T.done();
