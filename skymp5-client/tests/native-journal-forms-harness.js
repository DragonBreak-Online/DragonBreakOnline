// The Character Journal's forms (swf/dbo_journal ctx.form): typed input in place of the tab instead of the browser journal.
// The shell (fields, choices, one box at a time, Cancel, Escape, the keys given back), nobility's Grant a title and the
// Court's tax, Appoint and Offer, wages, renaming, Invite, the contract terms, posting a hunt and commissioning goods, each
// sending the browser court's own action and arguments.
//   node tests/native-journal-forms-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const held = (t) => t.sent.reduce((n, m) => n + (m.e === 'allowTextInput' ? (m.on ? 1 : -1) : 0), 0);
const lowest = (t) => t.sent.reduce((s, m) => { if (m.e === 'allowTextInput') { s.n += m.on ? 1 : -1; s.min = Math.min(s.min, s.n); } return s; }, { n: 0, min: 0 }).min;

const TABS = [{ id: 'stats', label: 'Stats' }, { id: 'nobility', label: 'Nobility' }, { id: 'court', label: 'Court' }];
const hub = (tab, extra) => Object.assign({ type: 'journal', id: 50, nonce: 'n1', hub: 1, tabs: TABS, tab, opened: 1, clock: { date: 'd', time: 't' }, head: { name: 'Olaf', title: 'Jarl', race: 'Nord' } }, extra || {});
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const last = (t, key) => msgs(t, key).slice(-1)[0];
const P = (t) => t.root.dboPanel;
const shownPage = (t) => Object.values(P(t).body.flowClip.kids).find((p) => p._visible);
const texts = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (typeof x.text === 'string' && !x.kids) out.push(x.text); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out.join('|'); };
const buttonsOf = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (x.kids && x.label && x.onPick) out.push(x); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out; };
const btn = (t, label) => buttonsOf(t).find((b) => b.label.text === label);
// a button on the shown page, else on a later one (the page is turned to it)
const seek = (t, label) => { let b = btn(t, label); if (b) return b; for (let i = 0; i < 6; i++) t.press(33); for (let i = 0; i < 6 && !(b = btn(t, label)); i++) { const n = t.root.dboPanel.foot.next; if (!n || n.disabled) break; n.onRelease(); } return b; };
const press = (t, label) => { const b = seek(t, label); if (!b) throw new Error('no button ' + label + ' among ' + buttonsOf(t).map((x) => x.label.text).join('|')); b.onRelease(); };
const boxOf = (t) => { let f = null; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.type === 'input') f = k; if (k.kids) walk(k); } }; walk(shownPage(t)); return f; };
// a field by its label, or the start of it (a limit can follow: "Reward, up to 45")
const typeOn = (t, label, text) => { const r = buttonsOf(t).find((b) => b.label.text === 'Type...' && b._parent.label && (b._parent.label.text === label || b._parent.label.text.indexOf(label + ',') === 0)); if (!r) throw new Error('no field ' + label + ' among ' + buttonsOf(t).map((x) => x.label.text).join('|')); r.onRelease(); boxOf(t).text = text; t.press(13); };
// every page's texts, turned through from the first
const everyPage = (t) => { for (let i = 0; i < 6; i++) t.press(33); const out = []; for (let i = 0; i < 6; i++) { out.push(texts(t)); const n = t.root.dboPanel.foot.next; if (!n || n.disabled) break; n.onRelease(); } return out.join('|'); };
const firstPage = (t) => { for (let i = 0; i < 6; i++) t.press(33); };

// ---- Nobility: Grant a title ----
const noble = (actor, name, label) => ({ actor, name, tag: name.slice(0, 4).toUpperCase(), online: true, title: 'baron', label, fief: '', estate: '', since: 1790000000000 });
const nob = { enabled: true, fiefShare: 10, selected: 'bruma', mine: [],
  holds: [{ id: 'bruma', name: 'Bruma', realm: 'cyrodiil', ruler: { name: 'Olaf', style: 'Count' }, isRuler: true, canRevoke: true,
    titles: [{ id: 'baron', label: 'Baron', needs: 'fief' }, { id: 'knight', label: 'Knight', needs: '' }, { id: 'lord', label: 'Lord', needs: 'estate' }],
    fiefs: [{ id: 'apple', name: 'Applewatch', buildings: 1, holder: noble('a1', 'Gemma', 'Baron of Applewatch'), treasury: 120 }, { id: 'pell', name: 'Pell', buildings: 0, holder: null, treasury: null },
      { id: 'cold', name: 'Coldcorn', buildings: 0, holder: null, treasury: null }],
    roll: [noble('a1', 'Gemma', 'Baron of Applewatch')] }] };
const grantOpen = (t) => { for (let i = 0; i < 6 && !btn(t, 'Grant a title...'); i++) t.root.dboPanel.foot.next.onRelease(); press(t, 'Grant a title...'); };
{
  const t = S.boot('dbo_journal');
  t.push(hub('nobility', { nobility: nob }));
  grantOpen(t);
  let tx = texts(t);
  check('Grant a title opens a form in place of the tab, nothing sent, no browser hand-off', /Grant a title/.test(tx) && /proclaimed to all by your decree/.test(tx) && !msgs(t, 'dbo:journalTab').some((m) => m.args[3] === 'browser') && !msgs(t, 'dbo:nobilityGrant').length, tx);
  check('the first title is chosen, its fief the first vacant one', btn(t, 'Baron')._alpha === 100 && btn(t, 'Pell')._alpha === 100 && !btn(t, 'Applewatch'));
  check('Proclaim waits for a name', btn(t, 'Proclaim').disabled === true);
  typeOn(t, 'Who', '  Bram ');
  check('a name typed (trimmed) readies it; the keys are given back', btn(t, 'Proclaim').disabled !== true && /Bram/.test(texts(t)) && held(t) === 0);
  press(t, 'Coldcorn');
  press(t, 'Proclaim');
  check('Proclaim sends the hold, the name, the title and the fief', last(t, 'dbo:nobilityGrant').args.join('|') === 'n1|bruma|Bram|baron|cold');
  check('...and the form goes', !btn(t, 'Proclaim'));
  t.push(hub('nobility', { nonce: 'n2', nobility: nob }));
  grantOpen(t);
  press(t, 'Knight');
  check('a title that needs nothing asks for no fief', !btn(t, 'Pell') && !/Fief/.test(texts(t)));
  typeOn(t, 'Who', 'Bram'); press(t, 'Proclaim');
  check('...and sends an empty extra', last(t, 'dbo:nobilityGrant').args.join('|') === 'n2|bruma|Bram|knight|');
  t.push(hub('nobility', { nonce: 'n3', nobility: nob }));
  grantOpen(t);
  press(t, 'Lord'); typeOn(t, 'Who', 'Bram');
  check('an estate title waits for the estate\'s name', btn(t, 'Proclaim').disabled === true && /The estate's name/.test(texts(t)));
  buttonsOf(t).find((b) => b.label.text === 'Type...' && b._parent.label.text === 'The estate\'s name').onRelease();
  press(t, 'Knight');
  check('a box whose field goes with another choice gives the keys back', !boxOf(t) && held(t) === 0 && lowest(t) === 0);
  press(t, 'Lord');
  typeOn(t, 'The estate\'s name', 'Hollowmere');
  press(t, 'Proclaim');
  check('...and sends it', last(t, 'dbo:nobilityGrant').args.join('|') === 'n3|bruma|Bram|lord|Hollowmere');
  const full = JSON.parse(JSON.stringify(nob)); full.holds[0].fiefs.forEach((f) => { f.holder = noble('x', 'X', 'Baron'); });
  t.push(hub('nobility', { nonce: 'n4', nobility: full }));
  grantOpen(t);
  typeOn(t, 'Who', 'Bram');
  check('every fief held: it says so and a baron cannot be proclaimed', /Every fief is held\. Revoke a title to free one\./.test(texts(t)) && btn(t, 'Proclaim').disabled === true);
  press(t, 'Cancel');
  check('Cancel closes the form, back on the tab, nothing sent', !btn(t, 'Proclaim') && msgs(t, 'dbo:nobilityGrant').length === 3);
}

// ---- the form shell ----
{
  const t = S.boot('dbo_journal');
  t.push(hub('nobility', { nobility: nob }));
  grantOpen(t);
  buttonsOf(t).find((b) => b.label.text === 'Type...').onRelease();
  check('Type... opens a box with the keys, forty characters', boxOf(t) && boxOf(t).maxChars === 40 && held(t) === 1);
  t.press(82);
  check('every key is typing while it is open (R does not turn the tab)', !msgs(t, 'dbo:journalTab').length && !!boxOf(t));
  boxOf(t).text = 'Gem';
  t.push(hub('nobility', { nobility: nob }));
  check('a payload for the same tab keeps the form and what is being typed, with no second count', boxOf(t) && boxOf(t).text === 'Gem' && held(t) === 1);
  t.press(27);
  check('Escape leaves the box first, the form stays', !boxOf(t) && btn(t, 'Proclaim') && held(t) === 0);
  t.press(27);
  check('Escape again closes the form, not the journal', !btn(t, 'Proclaim') && !t.closed());
  grantOpen(t);
  buttonsOf(t).find((b) => b.label.text === 'Type...').onRelease();
  t.push(hub('court', { court: { staff: false, outright: false, selected: '', courts: [], offers: [] } }));
  check('another tab arriving closes the form and gives the keys back', !boxOf(t) && held(t) === 0 && lowest(t) === 0);
  const r = S.boot('dbo_journal');
  r.push(hub('nobility', { nobility: nob, readOnly: 1 }));
  for (let i = 0; i < 6 && !btn(r, 'Grant a title...'); i++) r.root.dboPanel.foot.next.onRelease();
  check('a staff member reading someone\'s journal cannot open the form', btn(r, 'Grant a title...').disabled === true);
  const nt = S.boot('dbo_journal', false, { noTyping: true });
  nt.push(hub('nobility', { nobility: nob }));
  grantOpen(nt);
  check('a game that cannot type: no Type..., and the browser journal offered instead', !btn(nt, 'Type...') && !!btn(nt, 'In the browser...') && /cannot take typed input/.test(texts(nt)));
  press(nt, 'In the browser...');
  check('...which hands the tab to the browser', last(nt, 'dbo:journalTab').args[3] === 'browser');
  const x = S.boot('dbo_journal');
  x.push(hub('nobility', { nobility: nob }));
  grantOpen(x);
  buttonsOf(x).find((b) => b.label.text === 'Type...').onRelease();
  x.root.dboPanel.foot.close.onRelease();
  check('closing the journal with a box open gives the keys back', held(x) === 0 && lowest(x) === 0 && x.closed());
}

// ---- Court ----
const holder = (pid, name) => ({ pid, name, tag: name.slice(0, 4).toUpperCase(), online: true });
const court = { id: 'bruma', name: 'Bruma', kind: 'hold', mine: true, treasury: 900, keepsBooks: true, canName: true, tax: { pct: 5, max: 20, canSet: true },
  offices: [{ rank: 'steward', title: 'Steward', seats: 1, holders: [holder(7, 'Gemma')], canAppoint: true, wage: 40, named: true, default: 'Steward of the Hold' },
    { rank: 'guard', title: 'Guard Captain', seats: 2, holders: [], canAppoint: true, wage: 0 }],
  appointable: [{ rank: 'steward', title: 'Steward' }, { rank: 'guard', title: 'Guard Captain' }], outgoing: [],
  household: { id: 'hh', name: 'House of Bruma', myRank: 0, canInvite: true, canKick: true, canSetRank: true,
    ranks: [{ title: 'Jarl', role: 'leader' }, { title: 'Courtier', role: 'officer', canon: 'Thane' }, { title: 'Retainer', role: 'member' }], members: [], pending: [] },
  contracts: { tiers: [{ tier: 1, name: 'lesser', price: 20, kinds: ['wolf'] }], bounds: { min: 5, max: 100 }, budget: 500, budgetMax: 5000, spent: 0, left: 500, resetsAt: Date.now() + 86400000, standing: true,
    citizensOnly: false, canSet: true, canPost: true, postBudget: 200, postLeft: 150, postsLeftToday: 2, commissionMaxCount: 50,
    fauna: [{ kind: 'wolf', name: 'Wolves', perKill: 15 }, { kind: 'troll', name: 'Trolls', perKill: 80 }], posted: [] } };
const sec = (c, extra) => Object.assign({ staff: false, outright: true, selected: 'bruma', courts: [c || court], offers: [] }, extra || {});
const view = (t, name) => { firstPage(t); press(t, name); };
{
  const t = S.boot('dbo_journal');
  t.push(hub('court', { court: sec() }));
  press(t, 'Set...');
  check('Tax: Set... opens a number form, Set greyed until a new rate in bounds', /The tax of Bruma/.test(texts(t)) && btn(t, 'Set').disabled === true);
  buttonsOf(t).find((b) => b.label.text === 'Type...').onRelease();
  check('...the box takes digits only', boxOf(t).restrict === '0-9');
  boxOf(t).text = '5'; t.press(13);
  check('the same rate is not a change', btn(t, 'Set').disabled === true);
  typeOn(t, 'Percent', '21');
  check('past the most is refused', btn(t, 'Set').disabled === true);
  typeOn(t, 'Percent', '8');
  press(t, 'Set');
  check('Set sends courtTax with the court and the number', last(t, 'dbo:courtTax').args.join('|') === 'n1|bruma|8' && typeof last(t, 'dbo:courtTax').args[2] === 'number');

  t.push(hub('court', { nonce: 'n2', court: sec() }));
  view(t, 'Offices');
  check('each office has its own tools: Appoint where a seat is free, Wage, Rename and Default for a named one', !!btn(t, 'Appoint...') && buttonsOf(t).filter((b) => b.label.text === 'Default').length === 1 && buttonsOf(t).filter((b) => b.label.text === 'Wage...').length === 2 && buttonsOf(t).filter((b) => b.label.text === 'Rename...').length === 2);
  press(t, 'Appoint...');
  check('Appoint names the office, offers both ways when outright', /Guard Captain of Bruma/.test(texts(t)) && !!btn(t, 'Offer the post') && !!btn(t, 'Appoint') && btn(t, 'Appoint').disabled === true);
  typeOn(t, 'Who', 'Bram');
  press(t, 'Appoint');
  check('Appoint sends courtAppoint with the name and the rank', last(t, 'dbo:courtAppoint').args.join('|') === 'n2|bruma|Bram|guard');
  t.push(hub('court', { nonce: 'n3', court: sec(court, { outright: false }) }));
  view(t, 'Offices');
  press(t, 'Appoint...');
  check('not outright: only Offer the post', !!btn(t, 'Offer the post') && !btn(t, 'Appoint'));
  typeOn(t, 'Who', 'Bram'); press(t, 'Offer the post');
  check('Offer sends courtOffer', last(t, 'dbo:courtOffer').args.join('|') === 'n3|bruma|Bram|guard');
  t.push(hub('court', { nonce: 'n4', court: sec() }));
  view(t, 'Offices');
  buttonsOf(t).filter((b) => b.label.text === 'Wage...')[0].onRelease();
  check('Wage names the office and its current pay', /The wage of Steward/.test(texts(t)) && /now 40/.test(texts(t)));
  typeOn(t, 'Gold a week', '55'); press(t, 'Set');
  check('...and sends courtWage with the rank', last(t, 'dbo:courtWage').args.join('|') === 'n4|bruma|steward|55');
  t.push(hub('court', { nonce: 'n5', court: sec() }));
  view(t, 'Offices');
  buttonsOf(t).filter((b) => b.label.text === 'Rename...')[0].onRelease();
  check('Rename waits for a new name', /Rename Steward/.test(texts(t)) && btn(t, 'Save').disabled === true);
  typeOn(t, 'New name', 'Steward');
  check('...not the same one', btn(t, 'Save').disabled === true);
  typeOn(t, 'New name', 'Reeve'); press(t, 'Save');
  check('Save sends courtRename for the office', last(t, 'dbo:courtRename').args.join('|') === 'n5|bruma|office|steward|Reeve');
  t.push(hub('court', { nonce: 'n6', court: sec() }));
  view(t, 'Offices');
  press(t, 'Default');
  check('Default sends an empty name', last(t, 'dbo:courtRename').args.join('|') === 'n6|bruma|office|steward|');

  t.push(hub('court', { nonce: 'n7', court: sec() }));
  view(t, 'Household');
  press(t, 'Invite someone...');
  typeOn(t, 'Who', 'Sven'); press(t, 'Invite');
  check('Invite sends courtInvite', last(t, 'dbo:courtInvite').args.join('|') === 'n7|bruma|Sven');
  t.push(hub('court', { nonce: 'n8', court: sec() }));
  view(t, 'Household');
  check('Rank names: each rank, its canon in brackets, Rename and Default for a renamed one', /Rank names/.test(texts(t)) && /Courtier \(Thane\)/.test(texts(t)) && buttonsOf(t).filter((b) => b.label.text === 'Default').length === 1);
  buttonsOf(t).filter((b) => b.label.text === 'Rename...')[2].onRelease();
  typeOn(t, 'New name', 'Servant'); press(t, 'Save');
  check('a rank rename sends its index', last(t, 'dbo:courtRename').args.join('|') === 'n8|bruma|rank|2|Servant');
  t.push(hub('court', { nonce: 'n9', court: sec() }));
  view(t, 'Household');
  press(t, 'Default');
  check('a rank\'s Default sends an empty name', last(t, 'dbo:courtRename').args.join('|') === 'n9|bruma|rank|1|');
}

{
  const t = S.boot('dbo_journal');
  t.push(hub('court', { court: sec() }));
  view(t, 'Hunting');
  check('the setter sees Set... on the pay, the budget and posted work', buttonsOf(t).filter((b) => b.label.text === 'Set...').length === 3);
  buttonsOf(t).filter((b) => b.label.text === 'Set...')[0].onRelease();
  typeOn(t, 'Gold a kill', '4');
  check('pay below the bound is refused', btn(t, 'Set').disabled === true);
  typeOn(t, 'Gold a kill', '30'); press(t, 'Set');
  check('pay sends courtContractPrice with the tier', last(t, 'dbo:courtContractPrice').args.join('|') === 'n1|bruma|1|30');
  t.push(hub('court', { nonce: 'n2', court: sec() }));
  view(t, 'Hunting');
  buttonsOf(t).filter((b) => b.label.text === 'Set...')[1].onRelease();
  typeOn(t, 'Gold a week', '800'); press(t, 'Set');
  check('the budget sends courtContractBudget', last(t, 'dbo:courtContractBudget').args.join('|') === 'n2|bruma|800');
  t.push(hub('court', { nonce: 'n3', court: sec() }));
  view(t, 'Hunting');
  buttonsOf(t).filter((b) => b.label.text === 'Set...')[2].onRelease();
  typeOn(t, 'Gold a week', '300'); press(t, 'Set');
  check('posted work sends courtContractPostBudget', last(t, 'dbo:courtContractPostBudget').args.join('|') === 'n3|bruma|300');
  t.push(hub('court', { nonce: 'n4', court: sec() }));
  view(t, 'Hunting');
  check('posting: the budget left and today\'s posts', /150 of 200 gold left\); you may post 2 more today\./.test(everyPage(t)), everyPage(t));
  press(t, 'Post a hunt...');
  check('Post a hunt: the beasts with their pay, the first chosen', btn(t, 'Wolves (15 a kill)')._alpha === 100 && !!btn(t, 'Trolls (80 a kill)'));
  typeOn(t, 'How many', '3');
  check('the reward\'s most is the count times the pay', /Reward, up to 45/.test(texts(t)));
  typeOn(t, 'Reward', '46');
  check('...and a reward past it is refused', btn(t, 'Post hunt').disabled === true);
  press(t, 'Trolls (80 a kill)');
  check('another beast raises the most', /Reward, up to 240/.test(texts(t)) && btn(t, 'Post hunt').disabled !== true, texts(t));
  press(t, 'Post hunt');
  check('Post hunt sends the kind, the count and the reward as numbers', last(t, 'dbo:courtContractPost').args.join('|') === 'n4|bruma|troll|3|46' && typeof last(t, 'dbo:courtContractPost').args[3] === 'number');
  t.push(hub('court', { nonce: 'n5', court: sec() }));
  view(t, 'Hunting');
  press(t, 'Commission goods...');
  typeOn(t, 'Search', 'pelt'); press(t, 'Search');
  check('Commission goods searches first', last(t, 'dbo:courtCommissionSearch').args.join('|') === 'n5|bruma|pelt');
  const found = JSON.parse(JSON.stringify(court));
  found.contracts.search = { query: 'pelt', items: [{ desc: 'Skyrim.esm:03AD52', name: 'Wolf Pelt', value: 12, maxPrice: 30 }, { desc: 'Skyrim.esm:03AD8E', name: 'Bear Pelt', value: 40, maxPrice: 90 }] };
  t.push(hub('court', { nonce: 'n6', court: sec(found) }));
  view(t, 'Hunting');
  press(t, 'Commission one of 2...');
  check('the goods found are choices with their worth and most', !!btn(t, 'Wolf Pelt (worth 12, up to 30 each)') && btn(t, 'Commission').disabled === true);
  press(t, 'Bear Pelt (worth 40, up to 90 each)');
  typeOn(t, 'How many', '51'); typeOn(t, 'Gold each', '60');
  check('more than the most a commission takes is refused', btn(t, 'Commission').disabled === true);
  typeOn(t, 'How many', '5'); typeOn(t, 'Gold each', '91');
  check('a price past the goods\' most is refused', btn(t, 'Commission').disabled === true);
  typeOn(t, 'Gold each', '60'); press(t, 'Commission');
  check('Commission sends the goods, the count and the price', last(t, 'dbo:courtCommissionPost').args.join('|') === 'n6|bruma|Skyrim.esm:03AD8E|5|60');
  const none = JSON.parse(JSON.stringify(court));
  none.contracts.search = { query: 'unicorn', items: [] };
  none.contracts.fauna = [];
  t.push(hub('court', { nonce: 'n7', court: sec(none) }));
  view(t, 'Hunting');
  check('a search that found nothing says so; no beasts, no Post a hunt', /Nothing a hold buys matches "unicorn"\./.test(everyPage(t)) && /No dangerous beasts are known to roam Bruma\./.test(everyPage(t)) && !seek(t, 'Post a hunt...'));
  const reader = JSON.parse(JSON.stringify(court));
  reader.contracts.canSet = false; reader.contracts.canPost = false; reader.canName = false; reader.keepsBooks = false; reader.tax.canSet = false;
  reader.offices.forEach((o) => { o.canAppoint = false; }); reader.household.canInvite = false;
  t.push(hub('court', { nonce: 'n8', court: sec(reader) }));
  check('one who cannot set the tax gets no Set...', !btn(t, 'Set...'));
  view(t, 'Offices');
  check('...nor office tools', !btn(t, 'Appoint...') && !btn(t, 'Wage...') && !btn(t, 'Rename...'));
  view(t, 'Household');
  check('...nor Invite or rank names', !btn(t, 'Invite someone...') && !/Rank names/.test(texts(t)));
  view(t, 'Hunting');
  check('...nor terms or posting', !btn(t, 'Set...') && !btn(t, 'Commission goods...') && /Lesser\|20 gold a kill/.test(texts(t)));
}

T.done();
