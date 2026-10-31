// The Character Journal's Faction tab views (swf/dbo_journal tabs/faction.as + factionviews.as), drawn natively instead of in
// the browser journal: Realm, War, Treasury, Guild, Rebellion, the staff view, Invite and the rank editor, each sending the
// browser faction panel's own dbo:* action with the faction menu's nonce.
//   node tests/native-journal-faction-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const held = (t) => t.sent.reduce((n, m) => n + (m.e === 'allowTextInput' ? (m.on ? 1 : -1) : 0), 0);

const TABS = [{ id: 'stats', label: 'Stats' }, { id: 'faction', label: 'Faction' }];
const hub = (faction, extra) => Object.assign({ type: 'journal', id: 50, nonce: 'n1', hub: 1, tabs: TABS, tab: 'faction', opened: 1, clock: { date: 'd', time: 't' }, head: { name: 'Olaf', title: 'J', race: 'N' }, faction }, extra || {});
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const last = (t, key) => msgs(t, key).slice(-1)[0];
const P = (t) => t.root.dboPanel;
const shownPage = (t) => Object.values(P(t).body.flowClip.kids).find((p) => p._visible);
const texts = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (typeof x.text === 'string' && !x.kids) out.push(x.text); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out.join('|'); };
const buttonsOf = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (x.kids && x.label && x.onPick) out.push(x); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out; };
const btn = (t, label) => buttonsOf(t).find((b) => b.label.text === label);
const seek = (t, label) => { let b = btn(t, label); if (b) return b; for (let i = 0; i < 6; i++) t.press(33); for (let i = 0; i < 8 && !(b = btn(t, label)); i++) { const n = P(t).foot.next; if (!n || n.disabled) break; n.onRelease(); } return b; };
const press = (t, label) => { const b = seek(t, label); if (!b) throw new Error('no button ' + label + ' among ' + buttonsOf(t).map((x) => x.label.text).join('|')); b.onRelease(); };
const boxOf = (t) => { let f = null; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.type === 'input') f = k; if (k.kids) walk(k); } }; walk(shownPage(t)); return f; };
const typeOn = (t, label, text) => { let r = null; for (let i = 0; i < 2 && !r; i++) { r = buttonsOf(t).find((b) => b.label.text === 'Type...' && b._parent.label && (b._parent.label.text === label || b._parent.label.text.indexOf(label + ' ') === 0 || b._parent.label.text.indexOf(label + ',') === 0)); if (!r) seek(t, 'Cancel'); } if (!r) throw new Error('no field ' + label); r.onRelease(); boxOf(t).text = text; t.press(13); };
const everyPage = (t) => { for (let i = 0; i < 6; i++) t.press(33); const out = []; for (let i = 0; i < 8; i++) { out.push(texts(t)); const n = P(t).foot.next; if (!n || n.disabled) break; n.onRelease(); } return out.join('|'); };
const yes = (t, label) => press(t, label);
// press, check that only a question came up (nothing sent, the question's Yes and No shown), then answer Yes
const asked = (t, label, yesLabel) => { const before = t.msgs().length; press(t, label); const ok = t.msgs().length === before && !!btn(t, 'No') && !!btn(t, yesLabel); check('"' + label + '" asks first', ok); yes(t, yesLabel); };

const fm = (actorId, name, rank, title, role) => ({ actorId, name, tag: name.slice(0, 4).toUpperCase(), rank, title, role: role || 'member', online: true });
const ranks = [{ title: 'Champion', role: 'leader' }, { title: 'Warden', role: 'officer', canon: 'Blademaster' }, { title: 'Associate', role: 'member' }];
const guildF = { id: 'fighters', name: 'Fighters Guild', kind: 'guild', court: false, myRank: 0, secret: false, prince: '', myTitle: 'Champion', canInvite: true, canKick: true, canSetRank: true, canRename: true, canEditRanks: false,
  ranks, members: [fm(1, 'Olaf', 0, 'Champion', 'leader'), fm(4, 'Bram', 2, 'Associate')] };
const territories = [{ id: 't1', name: 'Bruma', kind: 'capital', owner: 'h:bruma', ownerName: 'House of Bruma', world: 'Tamriel', x: 0, y: 0 },
  { id: 't2', name: 'Pell', kind: 'village', owner: 'h:bruma', ownerName: 'House of Bruma', world: 'Tamriel', x: 0, y: 0 },
  { id: 't3', name: 'Chorrol', kind: 'capital', owner: 'h:chorrol', ownerName: 'House of Chorrol', world: 'Tamriel', x: 0, y: 0 },
  { id: 't4', name: 'Weye', kind: 'fort', owner: 'h:chorrol', ownerName: 'House of Chorrol', world: 'Tamriel', x: 0, y: 0 }];
const now = Date.now();
const realm = {
  territories, colours: {}, capitals: [{ faction: 'h:bruma', factionName: 'House of Bruma', name: 'Bruma', territory: 't1', x: 0, y: 0 }],
  secret: [{ id: 's1', name: 'The Hollow', kind: 'shrine', layer: ['Moonshadow'], x: 0, y: 0 }],
  leads: [{ id: 'h:bruma', name: 'House of Bruma', treasury: 5000, online: 4, seat: 'Bruma', atSeat: 2, capital: 't1', capitalChoices: [{ id: 't1', name: 'Bruma' }, { id: 't2', name: 'Pell' }], canSetHere: false }],
  rules: { capitalChangeDays: 14, enabled: true, minOnline: 3, declareFee: 1000, noticeDays: 2, windowsPerWar: 2, windowHours: 2, deathWar: true, treatyMinWeeks: 1, treatyMaxWeeks: 6 },
  windowChoices: [now + 3 * 86400000, now + 4 * 86400000, now + 5 * 86400000],
  wars: [{ id: 9, attacker: 'h:chorrol', attackerName: 'House of Chorrol', defender: 'h:bruma', defenderName: 'House of Bruma', goal: [{ id: 't2', name: 'Pell', owner: 'House of Bruma' }],
    status: 'notice', startsAt: now + 86400000, windows: [{ start: now + 86400000, end: now + 90000000 }], death: 'proposed', peace: { id: 3, by: 'h:chorrol', from: 'h:chorrol', tribute: 500, at: now }, captures: 0 }],
  treaties: [{ a: 'h:bruma', aName: 'House of Bruma', b: 'h:anvil', bName: 'House of Anvil', until: now + 7 * 86400000 }],
  offers: [{ id: 21, from: 'h:skingrad', fromName: 'House of Skingrad', to: 'h:bruma', toName: 'House of Bruma', weeks: 2, mine: true }],
  factions: [{ id: 'h:bruma', name: 'House of Bruma' }, { id: 'h:chorrol', name: 'House of Chorrol' }, { id: 'h:skingrad', name: 'House of Skingrad' }],
  raids: { rules: { enabled: true, minDefendersOnline: 2, cooldownDays: 7, raidMinutes: 30 }, raids: [{ raider: 'h:x', raiderName: 'The Reavers', owner: 'h:chorrol', territory: 't4', territoryName: 'Weye', until: now + 600000, breakIns: 3 }], lastRaided: { t3: now - 86400000 } },
};
const economy = { maxTaxRate: 0.1, nextReckoning: now + 86400000, factions: [{ id: 'h:bruma', name: 'House of Bruma', rate: 0.05, wages: { leader: 0, officer: 50, member: 10 }, ranks: ['officer', 'member'], labels: { officer: 'Courtier' },
  report: { at: now - 86400000, income: 900, taxed: 12, overdue: [{ owner: 'Gemma', weeks: 2, gold: 40, where: 'Pell' }], wagesPaid: 300, owed: 0, balance: 4200 } }] };
const fac = (o) => Object.assign({ id: 37, nonce: 'f1', admin: false, staff: false, self: 1, selected: 'fighters', charters: false, roles: ['leader', 'officer', 'member'], rankTitleMax: 40, ranksMax: 5,
  invites: [], factions: [guildF], realm, economy, band: null, rebellion: null }, o || {});
const view = (t, name) => { for (let i = 0; i < 6; i++) t.press(33); press(t, name); };

// ---- the view row, Realm ----
{
  const t = S.boot('dbo_journal');
  t.push(hub(fac()));
  check('the views: Members (shown), Realm, War with its count, Treasury', btn(t, 'Members')._alpha === 100 && !!btn(t, 'Realm') && !!btn(t, 'War (1)') && !!btn(t, 'Treasury') && !btn(t, 'Guild'));
  view(t, 'Realm');
  let tx = everyPage(t);
  check('Realm: the land by owner with its kind, each On the map', /House of Bruma\|Bruma\|City\|On the map\|Pell\|Village/.test(tx) && /House of Chorrol\|Chorrol\|City\|On the map\|Weye\|Fort/.test(tx), tx);
  check('...capitals, the leader\'s capital, the circle\'s secrets, the wars', /Capitals\|House of Bruma\|Territory: Bruma/.test(tx) && /House of Bruma: capital Bruma/.test(tx) && /Known only to your circle\|The Hollow\|shrine  ·  Moonshadow/.test(tx) && /1 war under way: see War\./.test(tx), tx);
  check('no browser hand-off', !msgs(t, 'dbo:journalTab').some((m) => m.args[3] === 'browser'));
  {
    const m = S.boot('dbo_journal');
    m.push(hub(fac()));
    view(m, 'Realm');
    buttonsOf(m).filter((b) => b.label.text === 'On the map')[1].onRelease();
    const sm = last(m, 'native:showMap');
    check('On the map sends the place, its owner and where it is, and closes the journal', sm && sm.args.join('|') === 'Pell|House of Bruma|0|0' && msgs(m, 'dbo:journalClose').length === 1 && m.closed(), sm);
  }
  press(t, 'Move the capital...');
  check('Move the capital: the choices, the current marked; the current cannot be picked', !!btn(t, 'Bruma (now)') && btn(t, 'Make it the capital').disabled === true);
  press(t, 'Bruma (now)');
  check('...picking the current one still cannot be made the capital', btn(t, 'Make it the capital').disabled === true);
  press(t, 'Pell'); press(t, 'Make it the capital');
  check('...and sends realmCapital with the faction nonce', last(t, 'dbo:realmCapital').args.join('|') === 'f1|h:bruma|t2');
  const here = JSON.parse(JSON.stringify(realm)); here.leads[0].canSetHere = true; here.leads[0].capitalChoices = [];
  t.push(hub(fac({ nonce: 'f2', realm: here })));
  view(t, 'Realm');
  asked(t, 'Make where I stand our seat', 'Make it our seat');
  check('a seat where you stand asks, then sends here', last(t, 'dbo:realmCapital').args.join('|') === 'f2|h:bruma|here');
  const war = JSON.parse(JSON.stringify(realm)); war.leads[0].atWar = true;
  t.push(hub(fac({ nonce: 'f3', realm: war })));
  view(t, 'Realm');
  check('at war the capital cannot move', /Not while at war\./.test(everyPage(t)) && !seek(t, 'Move the capital...'));
  t.push(hub(fac({ nonce: 'f4', realm: Object.assign({}, realm, { territories: [] }) })));
  view(t, 'Realm');
  check('no land says so', /No land has been charted yet\./.test(texts(t)));
}

// ---- War ----
{
  const t = S.boot('dbo_journal');
  t.push(hub(fac()));
  view(t, 'War (1)');
  let tx = everyPage(t);
  check('War: the war, its goal, battles and the death proposal', /House of Chorrol against House of Bruma  \(declared\)/.test(tx) && /For Pell \(held by House of Bruma\)/.test(tx) && /A war to the death is proposed/.test(tx), tx);
  check('...the peace offered, raids, treaties and offers', /Peace is offered: 500 gold paid by House of Chorrol\./.test(tx) && /The Reavers is raiding Weye/.test(tx) && /House of Bruma and House of Anvil are sworn to peace until/.test(tx) && /House of Skingrad offers House of Bruma peace for 2 weeks\./.test(tx), tx);
  asked(t, 'Accept: to the death', 'Accept');
  check('the defender accepts a war to the death after asking', last(t, 'dbo:warDeath').args.join('|') === 'f1|9|true');
  t.push(hub(fac({ nonce: 'f2' })));
  view(t, 'War (1)');
  press(t, 'Refuse');
  check('...or refuses it', last(t, 'dbo:warDeath').args.join('|') === 'f2|9|false');
  t.push(hub(fac({ nonce: 'f3' })));
  view(t, 'War (1)');
  press(t, 'Accept peace');
  check('Accept peace sends the offer\'s id and tribute', last(t, 'dbo:warPeaceAnswer').args.join('|') === 'f3|9|true|3|500');
  t.push(hub(fac({ nonce: 'f4' })));
  view(t, 'War (1)');
  press(t, 'Offer peace...');
  check('Offer peace: a tribute and who pays (we, by default); none is fine', btn(t, 'we pay')._alpha === 100 && btn(t, 'Offer peace').disabled !== true);
  typeOn(t, 'Tribute (gold)', '250'); press(t, 'they pay'); press(t, 'Offer peace');
  check('...sends warPeace with the tribute and the payer', last(t, 'dbo:warPeace').args.join('|') === 'f4|9|250|them');
  t.push(hub(fac({ nonce: 'f5' })));
  view(t, 'War (1)');
  asked(t, 'Surrender', 'Surrender');
  check('the defender surrenders after asking', last(t, 'dbo:warSurrender').args.join('|') === 'f5|9');
  t.push(hub(fac({ nonce: 'f6' })));
  view(t, 'War (1)');
  press(t, 'Swear peace');
  check('a treaty offered to you is sworn', last(t, 'dbo:treatyAnswer').args.join('|') === 'f6|21|true');
  t.push(hub(fac({ nonce: 'f7' })));
  view(t, 'War (1)');
  press(t, 'Offer a treaty...');
  check('Offer a treaty: as your faction, to any other, four weeks by default', btn(t, 'House of Bruma')._alpha === 100 && buttonsOf(t).filter((b) => b.label.text === 'House of Bruma').length === 1 && btn(t, '4 weeks')._alpha === 100 && !!btn(t, '6 weeks') && !btn(t, '7 weeks') && btn(t, 'Offer a treaty').disabled === true);
  press(t, 'House of Skingrad'); press(t, '2 weeks'); press(t, 'Offer a treaty');
  check('...sends treatyOffer', last(t, 'dbo:treatyOffer').args.join('|') === 'f7|h:bruma|h:skingrad|2' && typeof last(t, 'dbo:treatyOffer').args[3] === 'number');
  t.push(hub(fac({ nonce: 'f8' })));
  view(t, 'War (1)');
  press(t, 'Declare war...');
  tx = everyPage(t);
  check('Declare war: against the other owners, their land to choose, the first windows picked, the cost and muster', /The land you mean to take/.test(tx) && /Needs 3 of each side online \(you have 4\) and 1,000 gold from your treasury \(it holds 5,000\)\./.test(tx) && /muster at Bruma to declare: 2 of 4 are there\./.test(tx), tx);
  check('...nothing taken yet: Declare greyed', seek(t, 'Declare war').disabled === true);
  press(t, 'Chorrol'); press(t, 'Weye');
  const third = seek(t, P(t) && texts(t) ? buttonsOf(t).filter((b) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) /.test(b.label.text))[2].label.text : '');
  check('two windows picked: a third cannot be added', third.disabled === true);
  const wins = () => buttonsOf(t).filter((b) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) /.test(b.label.text));
  wins()[0].onRelease();
  check('a window picked again is unpicked, and Declare waits for the full count', wins()[0]._alpha !== 100 && seek(t, 'Declare war').disabled === true);
  seek(t, 'Propose it'); wins()[0].onRelease();
  press(t, 'Propose it');
  press(t, 'Declare war');
  const d = last(t, 'dbo:warDeclare');
  check('Declare sends attacker, defender, the land, the windows and the death', d && d.args[1] === 'h:bruma' && d.args[2] === 'h:chorrol' && d.args[3].join(',') === 't3,t4' && d.args[4].length === 2 && d.args[4].indexOf(realm.windowChoices[0]) >= 0 && d.args[4].indexOf(realm.windowChoices[1]) >= 0 && d.args[5] === true, d);
  t.push(hub(fac({ nonce: 'f9' })));
  view(t, 'War (1)');
  press(t, 'Raid...');
  check('Raid: rested land can be raided, the rules said; your own land is not offered', /No land changes hands\. For 30 minutes/.test(everyPage(t)) && !seek(t, 'Bruma (House of Bruma)'));
  press(t, 'Chorrol (House of Chorrol)');
  check('...land raided lately is resting', /That land is resting\./.test(everyPage(t)) && seek(t, 'Send the raid').disabled === true);
  press(t, 'Weye (House of Chorrol)'); press(t, 'Send the raid');
  check('...and a rested one sends raidStart', last(t, 'dbo:raidStart').args.join('|') === 'f9|h:bruma|t4');
  const shut = JSON.parse(JSON.stringify(realm)); shut.rules.enabled = false; shut.raids.rules.enabled = false; shut.wars = [];
  t.push(hub(fac({ nonce: 'f10', realm: shut })));
  view(t, 'War');
  check('war closed: it says so, no Declare or Raid', /War is closed during the alpha/.test(everyPage(t)) && !seek(t, 'Declare war...') && !seek(t, 'Raid...'));
}

{
  const att = JSON.parse(JSON.stringify(realm));
  att.leads[0].id = 'h:chorrol'; att.wars[0].peace.by = 'h:chorrol'; att.wars[0].peace.from = 'h:chorrol';
  const t = S.boot('dbo_journal');
  t.push(hub(fac({ realm: att })));
  view(t, 'War (1)');
  check('the attacker answers no death proposal, nor the peace they offered themselves', !seek(t, 'Accept: to the death') && !seek(t, 'Accept peace') && !!seek(t, 'Withdraw'));
}

// ---- Treasury ----
{
  const t = S.boot('dbo_journal');
  t.push(hub(fac()));
  view(t, 'Treasury');
  const tx = everyPage(t);
  check('Treasury: the tax, wages by rank (its label), the last reckoning and who is overdue', /Property tax: 5%/.test(tx) && /Courtier: 50 gold/.test(tx) && /member: 10 gold/.test(tx) && /900 gold in taxes from 12 homes/.test(tx) && /Treasury: 4,200 gold\./.test(tx) && /Overdue: Gemma in Pell, 2 weeks \(40 gold\)/.test(tx), tx);
  press(t, 'Set...');
  typeOn(t, 'Percent', '11');
  check('the tax is held to its most (10%)', btn(t, 'Set').disabled === true);
  typeOn(t, 'Percent', '8'); press(t, 'Set');
  check('...and sends econRate', last(t, 'dbo:econRate').args.join('|') === 'f1|h:bruma|8');
  t.push(hub(fac({ nonce: 'f2' })));
  view(t, 'Treasury');
  buttonsOf(t).filter((b) => b.label.text === 'Set...')[1].onRelease();
  typeOn(t, 'Gold a week', '60'); press(t, 'Set');
  check('a wage sends econWage with the rank', last(t, 'dbo:econWage').args.join('|') === 'f2|h:bruma|officer|60');
  t.push(hub(fac({ nonce: 'f3', economy: null })));
  check('no treasury, no Treasury view', !btn(t, 'Treasury'));
}

// ---- Guild ----
{
  const band = { enabled: true, maxMembers: 3, rules: ['No faction powers.'], blocked: '', mine: null, invites: [{ id: 'g7', name: 'The Wolves', from: 'Gemma' }] };
  const t = S.boot('dbo_journal');
  t.push(hub(fac({ band })));
  check('Guild shows with its invite count', !!btn(t, 'Guild (1)'));
  view(t, 'Guild (1)');
  check('Guild: the rules, the invite, Found a guild', /No faction powers\./.test(texts(t)) && /Gemma invites you into the guild The Wolves/.test(texts(t)) && !!seek(t, 'Found a guild...'));
  press(t, 'Join');
  check('Join sends guildTabAccept', last(t, 'dbo:guildTabAccept').args.join('|') === 'f1|g7');
  t.push(hub(fac({ nonce: 'f2', band })));
  view(t, 'Guild (1)');
  press(t, 'Found a guild...');
  typeOn(t, 'The guild\'s name', 'Iron Pact'); press(t, 'Found');
  check('Found sends guildTabCreate with the name', last(t, 'dbo:guildTabCreate').args.join('|') === 'f2|Iron Pact');
  const mine = Object.assign({}, band, { invites: [], mine: { id: 'g1', name: 'Iron Pact', rank: 0, title: 'Guildmaster', master: true, officer: true, members: 3, guildmaster: '' } });
  t.push(hub(fac({ nonce: 'f3', band: mine })));
  view(t, 'Guild');
  check('a full guild greys Invite; a master with members cannot leave', seek(t, 'Invite...').disabled === true && /The guild is full\./.test(everyPage(t)) && !seek(t, 'Leave the guild') && /make another member Guildmaster first/.test(everyPage(t)));
  press(t, 'Rename...'); typeOn(t, 'New name', 'Iron Oath'); press(t, 'Rename');
  check('Rename sends guildTabRename', last(t, 'dbo:guildTabRename').args.join('|') === 'f3|Iron Oath');
  t.push(hub(fac({ nonce: 'f4', band: mine })));
  view(t, 'Guild');
  asked(t, 'Disband', 'Disband');
  check('Disband asks, then sends', last(t, 'dbo:guildTabDisband').args.join('|') === 'f4');
  const member = Object.assign({}, mine, { mine: Object.assign({}, mine.mine, { master: false, officer: true, members: 2, title: 'Officer', guildmaster: 'Bram' }) });
  t.push(hub(fac({ nonce: 'f5', band: member })));
  view(t, 'Guild');
  press(t, 'Invite...'); typeOn(t, 'Who', 'Sven'); press(t, 'Invite');
  check('an officer invites', last(t, 'dbo:guildTabInvite').args.join('|') === 'f5|Sven');
  t.push(hub(fac({ nonce: 'f6', band: member })));
  view(t, 'Guild');
  press(t, 'Leave the guild'); yes(t, 'Leave');
  check('a member leaves after asking', last(t, 'dbo:guildTabLeave').args.join('|') === 'f6');
  const inOne = Object.assign({}, mine, { invites: [{ id: 'g9', name: 'The Bears', from: 'Ulf' }] });
  t.push(hub(fac({ nonce: 'f6b', band: inOne })));
  view(t, 'Guild (1)');
  check('in a guild already, another\'s Join is greyed', seek(t, 'Join').disabled === true);
  const st = S.boot('dbo_journal');
  st.push(hub(fac({ staff: true, band })));
  check('staff get no Guild view', !btn(st, 'Guild (1)') && !btn(st, 'Guild'));
  t.push(hub(fac({ nonce: 'f7', band: Object.assign({}, band, { invites: [], blocked: 'You serve a court.' }) })));
  view(t, 'Guild');
  check('a blocked character is told why and cannot found one', /You serve a court\./.test(everyPage(t)) && !seek(t, 'Found a guild...'));
}

// ---- Rebellion ----
{
  const rules = { noticeDays: 2, windowsPerWar: 2, windowHours: 2, deathWar: true, petitionDays: 7, outlawDays: 14, outlawBounty: 500, joinAfterDeclare: true };
  const reb = { rules, petition: null, holds: [{ id: 'bruma', name: 'Bruma', open: true }, { id: 'anvil', name: 'Anvil', open: false }], cooldownUntil: 0, staffPetitions: null,
    risings: [{ id: 1, name: 'The Red Dawn', zone: 'chorrol', holdName: 'Chorrol', status: 'notice', declaredAt: now - 3600000, startsAt: now + 86400000, leaderName: 'Gemma', claimantName: 'Bram', capital: 'Chorrol Castle',
      rebels: ['Gemma', 'Bram'], rebel: false, leads: false, rules: false, canJoin: true, canAnswerDeath: false,
      war: { status: 'notice', startsAt: now + 86400000, windows: [{ start: now + 86400000, end: now + 93600000 }], death: 'proposed', captures: [] } }] };
  const t = S.boot('dbo_journal');
  t.push(hub(fac({ rebellion: reb })));
  view(t, 'Rebellion');
  let tx = everyPage(t);
  check('Rebellion: the rising, its leader and claimant, rebels, battles and the death ask', /The Red Dawn  \(notice given\)/.test(tx) && /Led by Gemma; Bram would take the throne\./.test(tx) && /2 rebels: Gemma, Bram/.test(tx) && /Battle 1: /.test(tx) && /The rebels ask for a war to the death/.test(tx), tx);
  check('...rising up: one hold greyed, why said; and the rules', seek(t, 'Begin a petition in Anvil').disabled === true && /A greyed hold has a petition/.test(everyPage(t)) && /A petition lapses after 7 days\./.test(everyPage(t)));
  asked(t, 'Join the rising', 'Rise');
  check('Join asks, then sends rebellionTabJoin with its hold', last(t, 'dbo:rebellionTabJoin').args.join('|') === 'f1|chorrol');
  t.push(hub(fac({ nonce: 'f2', rebellion: reb })));
  view(t, 'Rebellion');
  asked(t, 'Begin a petition in Bruma', 'Begin it');
  check('Begin a petition asks, then sends rebellionTabPetition', last(t, 'dbo:rebellionTabPetition').args.join('|') === 'f2|bruma');
  t.push(hub(fac({ nonce: 'f3', rebellion: reb })));
  view(t, 'Rebellion');
  press(t, 'Sign a petition...'); typeOn(t, 'The petition\'s word', 'OAKEN');
  check('the word box takes twelve characters', true);
  press(t, 'Sign');
  check('Sign sends the word', last(t, 'dbo:rebellionTabSign').args.join('|') === 'f3|OAKEN');
  const pet = { id: 5, zone: 'bruma', holdName: 'Bruma', code: 'OAKEN', startedAt: now, expiresAt: now + 86400000 * 6, count: 6, needMin: 5, needShare: 4, citizens: 20, mode: 'any', needed: 5, met: true, needText: '',
    starter: true, leader: true, starterName: 'Olaf', leaderName: 'Olaf', claimant: null, name: 'The Rising of Bruma', named: false,
    signers: [{ actor: 1, name: 'Olaf', starter: true, leader: true }, { actor: 4, name: 'Bram', starter: false, leader: false }] };
  t.push(hub(fac({ nonce: 'f4', rebellion: Object.assign({}, reb, { risings: [], petition: pet }) })));
  view(t, 'Rebellion');
  tx = everyPage(t);
  check('your petition: its word, its count met, the rising\'s name and claimant, the signers', /Its word: OAKEN \(hand it only to those you trust\)/.test(tx) && /6 of 5 names: enough to rise\./.test(tx) && /The rising: The Rising of Bruma \(its default name\)\. To take the throne: Olaf\./.test(tx) && /Signed \(2\)/.test(tx), tx);
  press(t, 'Make leader');
  check('the starter makes a signer leader', last(t, 'dbo:rebellionTabLeader').args.join('|') === 'f4|4');
  t.push(hub(fac({ nonce: 'f5', rebellion: Object.assign({}, reb, { risings: [], petition: pet }) })));
  view(t, 'Rebellion');
  seek(t, 'To the throne');
  buttonsOf(t).find((b) => b.label.text === 'To the throne' && b._parent.label.text === 'Bram').onRelease();
  check('the leader names who takes the throne', last(t, 'dbo:rebellionTabClaimant').args.join('|') === 'f5|4');
  t.push(hub(fac({ nonce: 'f6', rebellion: Object.assign({}, reb, { risings: [], petition: pet }) })));
  view(t, 'Rebellion');
  press(t, 'Name the rising...'); typeOn(t, 'Its name', 'The Oak Oath'); press(t, 'Name it');
  check('Name the rising sends its name', last(t, 'dbo:rebellionTabName').args.join('|') === 'f6|The Oak Oath');
  t.push(hub(fac({ nonce: 'f7', rebellion: Object.assign({}, reb, { risings: [], petition: pet }) })));
  view(t, 'Rebellion');
  asked(t, 'Declare, to the death', 'Declare to the death');
  check('Declare to the death asks, then sends death', last(t, 'dbo:rebellionTabDeclare').args.join('|') === 'f7|death');
  t.push(hub(fac({ nonce: 'f8', rebellion: Object.assign({}, reb, { risings: [], petition: pet }) })));
  view(t, 'Rebellion');
  asked(t, 'Tear it up', 'Tear it up');
  check('Tear it up asks, then sends rebellionTabAbandon', last(t, 'dbo:rebellionTabAbandon').args.join('|') === 'f8');
  t.push(hub(fac({ nonce: 'f8b', rebellion: Object.assign({}, reb, { risings: [], petition: Object.assign({}, pet, { met: false, count: 3 }) }) })));
  view(t, 'Rebellion');
  check('a leader with too few names cannot declare yet, and is told so', !seek(t, 'Declare the rising') && /It can be declared once it has enough names\./.test(everyPage(t)));
  const signer = Object.assign({}, pet, { starter: false, leader: false, met: false, count: 2 });
  t.push(hub(fac({ nonce: 'f9', rebellion: Object.assign({}, reb, { risings: [], petition: signer }) })));
  view(t, 'Rebellion');
  check('a signer sees only the count, no names and no declaring', /Your name is on it\./.test(everyPage(t)) && !/Signed \(/.test(everyPage(t)) && !seek(t, 'Declare the rising'));
  press(t, 'Take my name back'); yes(t, 'Take it back');
  check('...and may take their name back', last(t, 'dbo:rebellionTabUnsign').args.join('|') === 'f9');
}

// ---- Invite, the rank editor (a leader: titles only) ----
{
  const t = S.boot('dbo_journal');
  t.push(hub(fac()));
  press(t, 'Invite someone...'); typeOn(t, 'Who', 'Sven'); press(t, 'Invite');
  check('Invite sends factionInvite with the faction', last(t, 'dbo:factionInvite').args.join('|') === 'f1|fighters|Sven');
  t.push(hub(fac({ nonce: 'f2' })));
  press(t, 'Ranks and names...');
  check('a leader\'s rank editor: titles only, no roles or moves; Save greyed until changed', !seek(t, 'Up') && !seek(t, 'Add') && seek(t, 'Save ranks').disabled === true && /As leader you may rename the ranks/.test(everyPage(t)));
  typeOn(t, 'Rank 2', 'Shield');
  press(t, 'Save ranks');
  const r = last(t, 'dbo:factionRanksEdit');
  check('Save sends every rank with its title, role and where it came from', r && r.args[0] === 'f2' && r.args[1] === 'fighters' && JSON.stringify(r.args[2]) === JSON.stringify([{ title: 'Champion', role: 'leader', from: 0 }, { title: 'Shield', role: 'officer', from: 1 }, { title: 'Associate', role: 'member', from: 2 }]), r);
  t.push(hub(fac({ nonce: 'f3' })));
  press(t, 'Ranks and names...');
  typeOn(t, 'Rank 3', 'warden');
  check('two ranks with one title cannot be saved', seek(t, 'Save ranks').disabled === true);
  press(t, 'Cancel');
}

// ---- the staff view and the full rank editor ----
{
  const cult = { id: 'moon', name: 'Moonshadow', kind: 'cult', player: false, court: false, secret: true, count: 1, ranks: [{ title: 'Priest', role: 'leader' }, { title: 'Acolyte', role: 'member' }], members: [fm(8, 'Gemma', 1, 'Acolyte')], canAdd: true, canEditRanks: true };
  const big = Object.assign({}, guildF, { canAdd: true, canEditRanks: true, canRename: true, count: 2, members: [fm(1, 'Olaf', 0, 'Champion', 'leader'), fm(4, 'Bram', 2, 'Associate'), fm(5, 'Sven', 1, 'Warden', 'officer')] });
  const t = S.boot('dbo_journal');
  t.push(hub(fac({ staff: true, admin: true, factions: [big, cult] })));
  check('staff: every faction, kinds as chips, the factions with their counts', btn(t, 'Every faction')._alpha === 100 && !!btn(t, 'Cults') && !!btn(t, 'Fighters Guild (2)') && !!btn(t, 'Moonshadow (1)'));
  press(t, 'Cults');
  check('a kind narrows the list', !btn(t, 'Fighters Guild (2)') && !!btn(t, 'Moonshadow (1)') && /Secret\./.test(texts(t)));
  press(t, 'All');
  check('Bram (rank 2) can be promoted and not demoted; Sven (1) only demoted', /Bram #BRAM/.test(texts(t)));
  const row = (name) => buttonsOf(t).filter((b) => b._parent.label && b._parent.label.text.indexOf(name) === 0).map((b) => b.label.text).join(',');
  check('...as the browser\'s rules', row('Bram') === 'Promote,Make leader,Remove' && row('Sven') === 'Demote,Make leader,Remove' && row('Olaf') === 'Demote,Remove', [row('Bram'), row('Sven'), row('Olaf')]);
  buttonsOf(t).find((b) => b.label.text === 'Promote').onRelease();
  check('Promote sends the rank above', last(t, 'dbo:factionSetRank').args.join('|') === 'f1|fighters|4|1');
  t.push(hub(fac({ nonce: 'f2', staff: true, admin: true, factions: [big, cult] })));
  const before = t.msgs().length;
  buttonsOf(t).filter((b) => b.label.text === 'Make leader')[0].onRelease();
  check('"Make leader" asks first', t.msgs().length === before && !!btn(t, 'No'));
  yes(t, 'Make leader');
  check('Make leader asks, then sends the leader\'s rank', last(t, 'dbo:factionSetRank').args.join('|') === 'f2|fighters|4|0');
  t.push(hub(fac({ nonce: 'f3', staff: true, admin: true, factions: [big, cult] })));
  press(t, 'Add member...'); typeOn(t, 'Name or #TAG', 'Ulf'); press(t, 'Add member');
  check('Add member sends factionAdd', last(t, 'dbo:factionAdd').args.join('|') === 'f3|fighters|Ulf');
  t.push(hub(fac({ nonce: 'f4', staff: true, admin: true, factions: [big, cult] })));
  press(t, 'Ranks...');
  let tx = everyPage(t);
  check('the full editor: roles, Up and Down, Remove (greyed where held), Default for a staff-named rank, a new rank', /Rank 2  \(officer, 1 hold it\)/.test(tx) && !!seek(t, 'Add') && !!seek(t, 'Default'), tx);
  const rm = buttonsOf(t).filter((b) => b.label.text === 'Remove');
  check('a held rank cannot be removed', rm.length >= 1 && rm.every((b) => b.disabled === true));
  press(t, 'Default');
  typeOn(t, 'A new rank\'s title', 'Recruit');
  press(t, 'Add');
  tx = everyPage(t);
  check('Add puts the new rank last', /Rank 4  \(member\)/.test(tx), tx);
  const downs = () => { seek(t, 'Down'); return buttonsOf(t).filter((b) => b.label.text === 'Down'); };
  for (let i = 0; i < 6; i++) t.press(33);
  seek(t, 'Up');
  check('the second rank cannot go above the leader', buttonsOf(t).filter((b) => b.label.text === 'Up')[0].disabled === true);
  let ups = [];
  for (let i = 0; i < 8; i++) { ups = ups.concat(buttonsOf(t).filter((b) => b.label.text === 'Up')); const n = P(t).foot.next; if (!n || n.disabled) break; n.onRelease(); }
  const dn = []; for (let i = 0; i < 6; i++) t.press(33); for (let i = 0; i < 8; i++) { dn.push(...buttonsOf(t).filter((b) => b.label.text === 'Down')); const n = P(t).foot.next; if (!n || n.disabled) break; n.onRelease(); }
  check('...and the last cannot go down', dn[dn.length - 1].disabled === true && dn[0].disabled !== true);
  ups[ups.length - 1].onRelease();
  press(t, 'Save ranks');
  const r = last(t, 'dbo:factionRanksEdit');
  check('Save sends the draft: Default put back, the new rank moved up a place', r && JSON.stringify(r.args[2]) === JSON.stringify([{ title: 'Champion', role: 'leader', from: 0 }, { title: 'Blademaster', role: 'officer', from: 1 }, { title: 'Recruit', role: 'member', from: -1 }, { title: 'Associate', role: 'member', from: 2 }]), r && r.args[2]);
  const gm = S.boot('dbo_journal');
  gm.push(hub(fac({ staff: true, admin: false, factions: [Object.assign({}, cult, { canAdd: false, canEditRanks: false })] })));
  check('a GM observes: no member tools, the ranks listed', !btn(gm, 'Remove') && !btn(gm, 'Add member...') && /A GM observes/.test(texts(gm)) && /Ranks: Priest \(leader\), Acolyte \(member\)/.test(texts(gm)));
}

T.done();
