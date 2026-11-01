// Runs the notice board's native Citizenship and Voting (swf/dbo_citizen) on the stub stage with the widget server
// citizenship.js publishes (widget 84), against the browser panel's own rules (skymp5-front features/citizenBoard): the
// policy line, becoming a citizen (free, asked, paid after a question), renouncing after a question, a ruler's policy
// chips, typed fee and requests; the election in each phase, a court named by typed names, replacing a member, withdrawing,
// accepting an invitation, voting after a question, the result and the staff controls. Every action is dbo:citizenAct
// [nonce, action, ...args] as strings; Back and Close send their own keys; Escape leaves a box, a form, a question, then the
// panel; a game that cannot type hands the panel to the browser; typing is always released.
//   node tests/native-citizen-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const held = (t) => t.sent.reduce((n, m) => n + (m.e === 'allowTextInput' ? (m.on ? 1 : -1) : 0), 0);

const P = (t) => t.root.dboPanel;
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const acts = (t) => msgs(t, 'dbo:citizenAct');
const last = (t) => acts(t).slice(-1)[0];
const shownPage = (t) => Object.values(P(t).flowClip.kids).find((p) => p._visible);
const texts = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (typeof x.text === 'string' && !x.kids) out.push(x.text); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out.join('|'); };
const buttonsOf = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (x.kids && x.label && x.onPick) out.push(x); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out; };
const turn = (t, d) => t.press(d < 0 ? 33 : 34);
const first = (t) => { for (let i = 0; i < 6; i++) turn(t, -1); };
const seek = (t, label, test) => { const ok = (b) => (test ? test(b) : b.label.text === label); let b = buttonsOf(t).find(ok); if (b) return b; first(t); for (let i = 0; i < 8 && !(b = buttonsOf(t).find(ok)); i++) turn(t, 1); return b; };
const press = (t, label) => { const b = seek(t, label); if (!b) throw new Error('no button ' + label + ' among ' + buttonsOf(t).map((x) => x.label.text).join('|')); b.onRelease(); };
const everyPage = (t) => { first(t); const out = []; for (let i = 0; i < 8; i++) { out.push(texts(t)); const before = texts(t); turn(t, 1); if (texts(t) === before) break; } first(t); return out.join('|'); };
const boxOf = (t) => { let f = null; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.type === 'input') f = k; if (k.kids) walk(k); } }; walk(shownPage(t)); return f; };
const field = (t, label) => seek(t, null, (b) => b.label.text === 'Type...' && b._parent.label && b._parent.label.text.indexOf(label) === 0);
const typeOn = (t, label, text) => { const r = field(t, label); if (!r) throw new Error('no field ' + label); r.onRelease(); boxOf(t).text = text; t.press(13); };
const footBtn = (t, label) => Object.values(P(t).foot.kids).find((k) => k.label && k.label.text === label);
const tabBtn = (t, label) => Object.values(P(t).head.kids).find((k) => k.label && k.label.text === label);

const cship = (o) => Object.assign({ hold: 'solitude', name: 'Haafingar', ruler: 'Jarl', hasRuler: true, policy: 'free', fee: 0, citizen: false, primary: false, auto: false,
  holds: [], maxHolds: 2, cooldownUntil: 0, requested: false, can: 'free', why: '' }, o);
const seats = [{ id: 'jarl', label: 'Jarl' }, { id: 'steward', label: 'Steward' }, { id: 'commander', label: 'Lord Commander' }, { id: 'housecarl', label: 'Housecarl' }];
const member = (seat, label, name, o) => Object.assign({ seat, label, name, tag: name ? 'T' + seat.length : '', accepted: true, fit: true, why: '' }, o);
const court = (id, jarl, o) => Object.assign({ id, jarl, complete: true, struck: '', mine: false,
  members: [member('jarl', 'Jarl', jarl), member('steward', 'Steward', 'Ulf'), member('commander', 'Lord Commander', 'Hild'), member('housecarl', 'Housecarl', 'Brand')] }, o);
const vote = (o) => Object.assign({ hold: 'solitude', name: 'Haafingar', electing: true, threshold: 6, registrationHours: 48, votingHours: 24, seats, citizens: 3, phase: 'none' }, o);
const W = (o) => Object.assign({ type: 'citizenBoard', id: 84, nonce: 'c1', tab: 'citizenship', result: '', resultKind: '', hold: 'solitude', name: 'Haafingar', grants: true,
  citizenship: cship(), voting: vote() }, o);

// ---- citizenship ----
{
  const t = S.boot('dbo_citizen');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1);
  t.push(W());
  check('the title is the hold\'s notice board, both tabs drawn', P(t).head.title.text === 'HAAFINGAR NOTICE BOARD' && !!tabBtn(t, 'Citizenship') && !!tabBtn(t, 'Voting'));
  check('free: the policy line and Become a citizen', /The citizenship of Haafingar is free\./.test(texts(t)) && !!seek(t, 'Become a citizen'));
  check('no holds yet says so, with the count of the most', /You are a citizen of no hold\./.test(texts(t)) && /Your citizenship \(0 of 2\)/i.test(texts(t)));
  press(t, 'Become a citizen');
  check('Become a citizen sends join with the nonce', last(t).args.join('|') === 'c1|join', last(t));
  check('one action in flight: the buttons greyed until the answer', seek(t, 'Become a citizen').disabled === true);
  const sentOnce = acts(t).length;
  seek(t, 'Become a citizen').onPick();
  check('...and a second press before the answer sends nothing', acts(t).length === sentOnce);
  t.push(W({ result: 'You are now a citizen of Haafingar.', resultKind: 'ok' }));
  check('the answer ends it and shows the result in green', seek(t, 'Become a citizen').disabled !== true && P(t).foot.result.text === 'You are now a citizen of Haafingar.' && P(t).foot.result.textColor === 0x7FBF7F);
  t.push(W({ citizenship: cship({ policy: 'manual', can: 'manual' }) }));
  check('manual: granted by the ruler or Steward, Ask for citizenship', /granted by the Jarl or the Steward/.test(texts(t)) && !!seek(t, 'Ask for citizenship'));
  press(t, 'Ask for citizenship');
  check('...which sends join', last(t).args.join('|') === 'c1|join');
  t.push(W({ citizenship: cship({ policy: 'paid', fee: 250, can: 'paid' }) }));
  check('paid: the fee in the policy line', /costs 250 gold, paid into the hold's treasury/.test(texts(t)));
  const n0 = acts(t).length;
  press(t, 'Become a citizen for 250 gold');
  check('paying asks first and sends nothing', acts(t).length === n0 && /Pay 250 gold into the treasury of Haafingar\?/.test(texts(t)) && !!seek(t, 'Pay'));
  t.press(27);
  check('Escape answers the question, not the panel', !t.closed() && !!seek(t, 'Become a citizen for 250 gold') && acts(t).length === n0);
  press(t, 'Become a citizen for 250 gold'); press(t, 'Pay');
  check('Pay sends join', last(t).args.join('|') === 'c1|join' && acts(t).length === n0 + 1);
  t.push(W({ citizenship: cship({ hasRuler: false, ruler: 'Jarl' }) }));
  check('no ruler: free to all who ask', /has no Jarl in the seat, so its citizenship is free to all who ask/.test(texts(t)));
  t.push(W({ citizenship: cship({ citizen: true, holds: [{ zone: 'solitude', name: 'Haafingar', since: Date.UTC(2026, 9, 20, 12), how: 'free', auto: false }, { zone: 'riften', name: 'The Rift', since: 0, how: 'x', auto: false }], can: '' }) }));
  check('your holds: Primary then Secondary', /Haafingar\|Primary/.test(texts(t)) && /The Rift\|Secondary/.test(texts(t)));
  press(t, 'Renounce Haafingar');
  check('renouncing asks first, naming the 7 days', /You cannot take another citizenship for 7 days/.test(texts(t)) && !!seek(t, 'Renounce'));
  press(t, 'Renounce');
  check('...then sends renounce', last(t).args.join('|') === 'c1|renounce');
  t.push(W({ citizenship: cship({ citizen: true, auto: true, holds: [{ zone: 'solitude', name: 'Haafingar', since: 0, how: '', auto: true }], can: '' }) }));
  check('a citizen through a faction cannot renounce here', /for as long as you serve a faction or court based here/.test(texts(t)) && !seek(t, 'Renounce Haafingar') && /through a faction or court based there/.test(texts(t)));
  t.push(W({ citizenship: cship({ requested: true, can: '' }) }));
  check('asked already: go before the ruler, Withdraw the request', /You have asked\. Go before the Jarl or the Steward/.test(texts(t)) && !!seek(t, 'Withdraw the request'));
  press(t, 'Withdraw the request');
  check('...which sends renounce', last(t).args.join('|') === 'c1|renounce');
  t.push(W({ citizenship: cship({ can: '', why: 'You already hold two citizenships.', cooldownUntil: Date.UTC(2026, 10, 3, 9) }) }));
  const why = (() => { let f = null; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.text === 'You already hold two citizenships.') f = k; if (k.kids) walk(k); } }; walk(shownPage(t)); return f; })();
  check('a refusal reason in red, the cooldown named', why && why.textColor === 0xB23A3A && /you may take another from/.test(texts(t)));
  t.push(W({ result: 'That cannot be done.', resultKind: 'refused' }));
  check('a refused result is red', P(t).foot.result.textColor === 0xB23A3A);
}

// ---- a ruler's controls, typed fee ----
{
  const t = S.boot('dbo_citizen');
  const manage = { policy: 'manual', fee: 0, treasury: true, maxFee: 5000, requests: [{ actor: 'ff00abcd', name: 'Rolf', tag: 'RLF1', at: Date.UTC(2026, 10, 1, 8) }] };
  t.push(W({ citizenship: cship({ policy: 'manual', can: 'manual', manage }) }));
  check('the officials\' section with the three ways', /For the Jarl and the Steward/i.test(everyPage(t)) && !!seek(t, 'Manual approval') && !!seek(t, 'Free') && !!seek(t, 'Paid...'));
  check('the chosen way is lit', seek(t, 'Manual approval')._alpha >= seek(t, 'Free')._alpha);
  press(t, 'Free');
  check('Free sends policy free', last(t).args.join('|') === 'c1|policy|free');
  t.push(W({ citizenship: cship({ policy: 'manual', can: 'manual', manage }) }));
  press(t, 'Paid...');
  check('Paid opens a typed fee form, Set the fee greyed until a fee is typed', !!field(t, 'Fee in gold') && seek(t, 'Set the fee').disabled === true);
  typeOn(t, 'Fee in gold', '9999');
  check('a fee over the most stays greyed', seek(t, 'Set the fee').disabled === true);
  typeOn(t, 'Fee in gold', '300');
  check('a fee in range makes it ready', seek(t, 'Set the fee').disabled !== true);
  press(t, 'Set the fee');
  check('Set the fee sends policy paid 300', last(t).args.join('|') === 'c1|policy|paid|300', last(t));
  check('typing released after the form', held(t) === 0);
  t.push(W({ citizenship: cship({ policy: 'paid', fee: 300, can: 'paid', manage: Object.assign({}, manage, { policy: 'paid', fee: 300 }) }) }));
  check('paid now shows its fee on the chip', !!seek(t, 'Paid: 300 gold'));
  press(t, 'Grant');
  check('Grant names the requester\'s actor', last(t).args.join('|') === 'c1|grant|ff00abcd');
  t.push(W({ citizenship: cship({ manage }) }));
  press(t, 'Decline');
  check('Decline too', last(t).args.join('|') === 'c1|decline|ff00abcd');
  t.push(W({ citizenship: cship({ manage: Object.assign({}, manage, { treasury: false, requests: [] }) }) }));
  check('no treasury: no fee, nobody has asked', !seek(t, 'Paid...') && /No treasury here, so no fee\./.test(everyPage(t)) && /Nobody has asked\./.test(everyPage(t)));
  // Escape inside a box leaves the box, then the form, then the panel
  t.push(W({ citizenship: cship({ manage }) }));
  press(t, 'Paid...');
  field(t, 'Fee in gold').onRelease();
  check('a box takes the keys while open', held(t) === 1);
  t.press(27);
  check('Escape leaves the box and gives the keys back', held(t) === 0 && !!field(t, 'Fee in gold') && !t.closed());
  t.press(27);
  check('Escape again leaves the form', !field(t, 'Fee in gold') && !!seek(t, 'Paid...') && !t.closed());
  t.press(27);
  check('and then closes the panel with citizenClose', msgs(t, 'dbo:citizenClose').length === 1 && t.closed());
}

// ---- voting ----
{
  const t = S.boot('dbo_citizen');
  t.push(W());
  tabBtn(t, 'Voting').onRelease();
  check('the Voting tab asks the server for that tab', last(t).args.join('|') === 'c1|tab|voting');
  t.push(W({ tab: 'voting' }));
  check('no election yet: the threshold and today\'s count', /will choose its Jarl once 6 of its people are citizens\. Today: 3 of 6\./.test(texts(t)) && /48 hours to enter a full court, and the citizens 24 hours to vote/.test(texts(t)));
  t.push(W({ tab: 'voting', voting: vote({ electing: false, why: 'The Jarl of Haafingar is appointed by the Empire.' }) }));
  check('a hold that elects nobody says why', /appointed by the Empire/.test(texts(t)));
  const reg = vote({ phase: 'registration', endsAt: Date.UTC(2026, 10, 3, 18), courts: [court('k1', 'Sigrid', { complete: false, members: [member('jarl', 'Jarl', 'Sigrid'), member('steward', 'Steward', 'Ulf', { accepted: false }), member('commander', 'Lord Commander', '', { why: 'empty', fit: false }), member('housecarl', 'Housecarl', 'Brand', { fit: false, why: 'serves the Companions' })] })],
    invites: [{ court: 'k2', jarl: 'Egil', seat: 'Steward' }], inCourt: false });
  t.push(W({ tab: 'voting', voting: reg }));
  const all = everyPage(t);
  check('registration: the deadline and the four seats', /Courts may be entered until/.test(all) && /Jarl, Steward, Lord Commander, Housecarl/.test(all));
  check('a court with its members and their state', /The court of Sigrid/.test(all) && /Incomplete/.test(all) && /has not accepted yet/.test(all) && /not named/.test(all) && /serves the Companions/.test(all));
  check('an invitation with Accept and Refuse', /Egil names you Steward of their court\./.test(all) && !!seek(t, 'Accept') && !!seek(t, 'Refuse'));
  press(t, 'Accept');
  check('Accept names the court', last(t).args.join('|') === 'c1|accept|k2');
  t.push(W({ tab: 'voting', voting: reg }));
  press(t, 'Refuse');
  check('Refuse names it too', last(t).args.join('|') === 'c1|refuse|k2');
  t.push(W({ tab: 'voting', voting: reg }));
  press(t, 'Stand for Jarl...');
  check('Stand for Jarl opens a form of the three other seats, greyed until all are named', !!field(t, 'Steward') && !!field(t, 'Lord Commander') && !!field(t, 'Housecarl') && seek(t, 'Enter this court').disabled === true);
  typeOn(t, 'Steward', 'Ulf'); typeOn(t, 'Lord Commander', 'Hild');
  check('...still greyed with one seat empty', seek(t, 'Enter this court').disabled === true);
  typeOn(t, 'Housecarl', '#BRND');
  press(t, 'Enter this court');
  check('Enter this court registers the three names in seat order', last(t).args.join('|') === 'c1|register|Ulf|Hild|#BRND', last(t));
  t.push(W({ tab: 'voting', voting: Object.assign({}, reg, { standWhy: 'is not a citizen of Haafingar', invites: [] }) }));
  check('one who cannot stand is told why, in their own words', /You cannot stand for Jarl: you are not a citizen of Haafingar\./.test(everyPage(t)) && !seek(t, 'Stand for Jarl...'));
  const mine = Object.assign({}, reg, { inCourt: true, invites: [], courts: [court('k1', 'Sigrid', { mine: true, complete: false, members: [member('jarl', 'Jarl', 'Sigrid'), member('steward', 'Steward', 'Ulf'), member('commander', 'Lord Commander', '', { why: 'empty', fit: false }), member('housecarl', 'Housecarl', 'Brand')] })] });
  t.push(W({ tab: 'voting', voting: mine }));
  check('your own court: Replace for the open seat only, and Withdraw', !!seek(t, 'Replace the Lord Commander') && !seek(t, 'Replace the Steward') && !!seek(t, 'Withdraw your court'));
  press(t, 'Replace the Lord Commander');
  typeOn(t, 'Name or #TAG', 'Hild');
  press(t, 'Name them');
  check('Replace names the seat and the person', last(t).args.join('|') === 'c1|replace|commander|Hild', last(t));
  t.push(W({ tab: 'voting', voting: mine }));
  const before = acts(t).length;
  press(t, 'Withdraw your court');
  check('Withdraw asks first', acts(t).length === before && /Withdraw your court from the election\?/.test(texts(t)));
  press(t, 'Withdraw');
  check('...then withdraws', last(t).args.join('|') === 'c1|withdraw');
  const ballot = vote({ phase: 'voting', endsAt: Date.UTC(2026, 10, 4, 18), ballot: [court('k1', 'Sigrid'), court('k3', 'Egil')], voted: false });
  t.push(W({ tab: 'voting', voting: ballot }));
  check('the vote: one per player, no count', /Nobody sees a count until it ends/.test(everyPage(t)) && /One vote for each player\. Choose a court\./.test(everyPage(t)));
  const votes = (() => { first(t); let n = 0; for (let i = 0; i < 6; i++) { n += buttonsOf(t).filter((b) => b.label.text === 'Vote for this court').length; const before = texts(t); turn(t, 1); if (texts(t) === before) break; } first(t); return n; })();
  check('a vote button under each court', votes === 2, votes);
  press(t, 'Vote for this court');
  check('voting asks first, naming the court', /Cast your one vote for the court of Sigrid\? It cannot be changed\./.test(texts(t)));
  press(t, 'Vote');
  check('...then votes for it', last(t).args.join('|') === 'c1|vote|k1');
  t.push(W({ tab: 'voting', voting: Object.assign({}, ballot, { voted: true }) }));
  check('voted: said so, no more vote buttons', /Your vote is cast\./.test(everyPage(t)) && !seek(t, 'Vote for this court'));
  t.push(W({ tab: 'voting', voting: Object.assign({}, ballot, { voteWhy: 'Only citizens of Haafingar vote.' }) }));
  check('one who cannot vote is told why, no buttons', /Only citizens of Haafingar vote\./.test(everyPage(t)) && !seek(t, 'Vote for this court'));
  t.push(W({ tab: 'voting', voting: vote({ phase: 'voting', revote: true, endsAt: 1, ballot: [court('k1', 'Sigrid')] }) }));
  check('a tied vote says a new vote runs between the tied courts', /The vote was tied\. A new vote between the tied courts runs until/.test(everyPage(t)));
  t.push(W({ tab: 'voting', voting: vote({ phase: 'seated', result: { winner: court('k1', 'Sigrid'), empty: ['Housecarl'], at: Date.UTC(2026, 10, 5, 12), counts: [{ jarl: 'Sigrid', votes: 5 }, { jarl: 'Egil', votes: 1 }] } }) }));
  const res = everyPage(t);
  check('the result: the Jarl, the empty seat, the count', /Haafingar has chosen its Jarl: Sigrid/.test(res) && /The seat of Housecarl started empty/.test(res) && /5 votes/.test(res) && /1 vote\b/.test(res));
  t.push(W({ tab: 'voting', voting: vote({ phase: 'registration', staff: true, courts: [], endsAt: 1, inCourt: true }) }));
  check('staff: Hold the election and Restart now', !!seek(t, 'Hold the election') && !!seek(t, 'Restart now') && /No court has been entered yet\./.test(everyPage(t)));
  press(t, 'Hold the election'); press(t, 'Hold');
  check('Hold asks, then sends staff cancel', last(t).args.join('|') === 'c1|staff|cancel');
  t.push(W({ tab: 'voting', voting: vote({ phase: 'held', staff: true }) }));
  press(t, 'Let it start by itself again');
  check('held: resume', /The election is held by the staff for now\./.test(everyPage(t)) && last(t).args.join('|') === 'c1|staff|resume');
  t.push(W({ tab: 'voting', voting: vote({ phase: 'none', staff: true }) }));
  press(t, 'Restart now'); press(t, 'Restart');
  check('Restart asks with the registration hours, then sends staff restart', last(t).args.join('|') === 'c1|staff|restart');
}

// ---- the rest ----
{
  const t = S.boot('dbo_citizen');
  t.push(W({ grants: false, why: 'This land grants no citizenship: its people answer to their clan or to no one.', citizenship: undefined, voting: undefined }));
  check('a land that grants none says so', /This land grants no citizenship/.test(texts(t)));
  footBtn(t, 'Back to the board').onRelease();
  check('Back to the board sends citizenBack and closes', msgs(t, 'dbo:citizenBack').length === 1 && t.closed());
  const e = S.boot('dbo_citizen');
  e.push(W());
  e.press(40);
  check('Down focuses the first control', e.ctx.focus === 0);
  footBtn(e, 'Close').onRelease();
  check('Close sends citizenClose and closes', msgs(e, 'dbo:citizenClose').length === 1 && e.closed());
  const nt = S.boot('dbo_citizen', false, { noTyping: true });
  nt.push(W({ citizenship: cship({ manage: { policy: 'free', fee: 0, treasury: true, maxFee: 5000, requests: [] } }) }));
  press(nt, 'Paid...');
  check('a game that cannot type: no Type..., the browser board offered', !field(nt, 'Fee in gold') && !!seek(nt, 'In the browser...') && /the browser board has this form/.test(everyPage(nt)));
  press(nt, 'In the browser...');
  check('...which hands the panel to the browser', acts(nt).slice(-1)[0].args.join('|') === 'c1|browser');
  const n = S.boot('dbo_citizen');
  n.push({ type: 'citizenBoard', id: 84 });
  check('an unreadable payload draws nothing', !n.root.dboPanel.head);
  n.st.time += 8000; n.tick();
  check('...and with no payload the panel closes itself', n.closed());
  const typing = S.boot('dbo_citizen');
  typing.push(W({ tab: 'voting', voting: vote({ phase: 'registration', courts: [], endsAt: 1, inCourt: false }) }));
  press(typing, 'Stand for Jarl...');
  field(typing, 'Steward').onRelease();
  check('a box open holds the keys', held(typing) === 1);
  footBtn(typing, 'Close').onRelease();
  check('closing with a box open gives the keys back', held(typing) === 0 && typing.closed());
}

T.done();
