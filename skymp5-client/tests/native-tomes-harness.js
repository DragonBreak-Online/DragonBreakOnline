// Runs the native spell tome shop (swf/dbo_tomes) on the stub stage with the widget server spells.js publishes (tomeShop),
// against the browser shop's own rules (skymp5-front features/tomeShop): the weekly line, the skills, the shelf by rank with
// school, rank and search, Buy asking once more, one purchase in flight, the nonce on every event, Escape and Close.
//   node tests/native-tomes-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const held = (t) => t.sent.reduce((n, m) => n + (m.e === 'allowTextInput' ? (m.on ? 1 : -1) : 0), 0);

const P = (t) => t.root.dboPanel;
const visible = (c) => { for (let k = c; k; k = k._parent) if (k._visible === false) return false; return true; };
const buttons = (t) => { const out = []; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.label && k.onRelease && visible(k)) out.push(k); if (k.kids) walk(k); } }; walk(P(t)); return out; };
const btn = (t, label) => buttons(t).find((b) => b.label.text === label);
const press = (t, label) => { const b = btn(t, label); if (!b) throw new Error('no button ' + label + ' among ' + buttons(t).map((x) => x.label.text).join('|')); b.onRelease(); };
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
// the tome rows on the shown page, top to bottom
const rows = (t) => { const out = []; for (const pg of Object.values(P(t).flowClip.kids)) { if (!pg._visible) continue; for (const r of Object.values(pg.kids)) if (r.kids && r.label && r.price) out.push(r); } return out.sort((a, b) => a._y - b._y); };
const spells = (t) => rows(t).map((r) => r.label.text);
const row = (t, spell) => rows(t).find((r) => r.label.text === spell);
// headings drawn on the shown page
const headings = (t) => { const out = []; for (const pg of Object.values(P(t).flowClip.kids)) { if (!pg._visible) continue; for (const k of Object.values(pg.kids)) if (typeof k.text === 'string' && /\(\d+\)$/.test(k.text)) out.push([k._y, k.text]); } return out.sort((a, b) => a[0] - b[0]).map((x) => x[1]); };

const tome = (id, spell, school, rank, rankName, price, extra) => Object.assign({ id, name: 'Spell Tome: ' + spell, spell, school, rank, rankName, price, canAfford: true, blocked: '' }, extra || {});
const tomes = [
  tome('t1', 'Fireball', 'Destruction', 2, 'Adept', 800),
  tome('t2', 'Flames', 'Destruction', 0, 'Novice', 50),
  tome('t3', 'Oakflesh', 'Alteration', 0, 'Novice', 60),
  tome('t4', 'Fast Healing', 'Restoration', 1, 'Apprentice', 200, { blocked: 'Sold in Skyrim' }),
  tome('t5', 'Ice Storm', 'Destruction', 2, 'Adept', 900, { canAfford: false }),
];
const base = { type: 'tomeShop', id: 60, nonce: 'n9', seller: 'The Synod', title: 'The Synod: Spell Tomes of Cyrodiil', gold: 850, canBuy: true, nextPurchaseAt: 0, whyNot: '',
  skills: [{ id: 'arcane', label: 'Arcane', tier: 2, tierName: 'Adept', schools: ['Destruction', 'Alteration'] }], tomes, result: 'The shelf changes each Monday.', resultKind: '' };
const w = (o) => Object.assign({}, base, o);

{
  const t = S.boot('dbo_tomes');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1);
  t.push(base);
  check('the title, the purse and an open week in green', P(t).head.title.text === 'THE SYNOD: SPELL TOMES OF CYRODIIL' && P(t).head.purse.text === '850 gold' && P(t).head.weekly.text === 'One tome this week: available' && P(t).head.weekly.textColor === 0x7FBF7F);
  check('a skill line: its tier, how far of five, its schools', P(t).head.skill0.text === 'Arcane: Adept (3 of 5)   Destruction · Alteration', P(t).head.skill0.text);
  check('the shelf by rank, lowest first, each heading with its count', headings(t).join('|') === 'Novice  (2)|Apprentice  (1)|Adept  (2)', headings(t));
  check('rows in the server\'s order within a rank', spells(t).join('|') === 'Flames|Oakflesh|Fast Healing|Fireball|Ice Storm', spells(t));
  check('a row: school and rank, and why it is blocked in red', row(t, 'Fast Healing').sub.text === 'Restoration  ·  Apprentice  ·  Sold in Skyrim' && row(t, 'Fast Healing').sub.textColor === 0xB23A3A && row(t, 'Fast Healing').btn0.disabled === true);
  check('a tome you cannot afford: its price red, Buy greyed', row(t, 'Ice Storm').price.textColor === 0xB23A3A && row(t, 'Ice Storm').btn0.disabled === true && row(t, 'Fireball').btn0.disabled !== true);
  check('the result line and the count', P(t).foot.result.text === 'The shelf changes each Monday.' && /^5 tomes/.test(P(t).foot.hint.text));
  row(t, 'Fireball').btn0.onRelease();
  check('Buy asks once more, focused, and sends nothing', /Spell Tome: Fireball \(Fireball, Adept\): buy for 800 gold\? This is your one tome this week\./.test(P(t).tools.question.text) && t.ctx.focus === P(t).tools.yes.idx && msgs(t, 'dbo:tomeBuy').length === 0);
  t.press(27);
  check('Escape takes the question back, not the shop', !P(t).tools.question && !t.closed());
  row(t, 'Fireball').btn0.onRelease(); press(t, 'Back');
  check('Back takes it back too', !P(t).tools.question && msgs(t, 'dbo:tomeBuy').length === 0);
  row(t, 'Fireball').btn0.onRelease();
  t.push(w({ gold: 100, tomes: tomes.map((x) => x.id === 't1' ? Object.assign({}, x, { canAfford: false }) : x) }));
  check('a re-sent shop drops a question that no longer applies', !P(t).tools.question);
  t.push(base);
  check('...for good: it does not come back when the tome can be bought again', !P(t).tools.question);
  row(t, 'Fireball').btn0.onRelease();
  t.push(base);
  check('...and keeps one that still does', !!P(t).tools.question);
  press(t, 'Buy');
  const b = msgs(t, 'dbo:tomeBuy');
  check('Buy sends the nonce and the tome', b.length === 1 && b[0].args.join('|') === 'n9|t1', b);
  check('one purchase in flight: its row says Buying..., every Buy greyed', row(t, 'Fireball').btn0.label.text === 'Buying...' && row(t, 'Flames').btn0.disabled === true);
  t.push(base);
  check('the answer ends the purchase at once', row(t, 'Fireball').btn0.label.text === 'Buy' && row(t, 'Flames').btn0.disabled !== true);
  row(t, 'Fireball').btn0.onRelease(); press(t, 'Buy');
  t.st.time += 10000; t.tick();
  check('a purchase that never comes back frees the shelf after ten seconds', row(t, 'Fireball').btn0.label.text === 'Buy' && row(t, 'Flames').btn0.disabled !== true);
  row(t, 'Flames').btn0.onRelease(); press(t, 'Buy');
  t.push(w({ canBuy: false, nextPurchaseAt: Date.now() + 2 * 3600000 + 5 * 60000, whyNot: 'You bought Flames this week.', result: 'You buy Flames.', resultKind: 'ok' }));
  check('the answer: the wait counts down, why under it, the result green', /^Next purchase in 2h [45]m$/.test(P(t).head.weekly.text) && P(t).head.why.text === 'You bought Flames this week.' && P(t).foot.result.textColor === 0x7FBF7F, P(t).head.weekly.text);
  check('...and no Buy is open this week', rows(t).every((r) => r.btn0.disabled === true));
  t.push(w({ canBuy: false, nextPurchaseAt: Date.now() - 1000, whyNot: '' }));
  check('a wait run out says to reopen', P(t).head.weekly.text === 'Your next tome is due. Reopen the shop to buy it.');
  t.push(w({ canBuy: false, nextPurchaseAt: 0, whyNot: 'Tomes are sold inside the Synod Conclave in Bruma.', result: 'No.', resultKind: 'refused' }));
  check('closed to you: the reason in red, a refusal red', P(t).head.weekly.text === 'Tomes are sold inside the Synod Conclave in Bruma.' && P(t).head.weekly.textColor === 0xB23A3A && P(t).foot.result.textColor === 0xB23A3A && !P(t).head.why);
}

// ---- school, rank, search ----
{
  const t = S.boot('dbo_tomes');
  t.push(base);
  check('the school starts at All with every tome counted', P(t).tools.school.label.text === 'School: All (5)');
  P(t).tools.school.onRelease();
  check('schools step in the browser\'s order: Alteration first', P(t).tools.school.label.text === 'School: Alteration (1)' && spells(t).join('|') === 'Oakflesh');
  P(t).tools.school.onRelease();
  check('...then Destruction (Restoration after it)', P(t).tools.school.label.text === 'School: Destruction (3)' && spells(t).join('|') === 'Flames|Fireball|Ice Storm');
  P(t).tools.rank.onRelease();
  check('the rank steps through that school\'s ranks', P(t).tools.rank.label.text === 'Rank: Novice' && spells(t).join('|') === 'Flames');
  P(t).tools.rank.onRelease();
  check('...skipping ranks it has none of', P(t).tools.rank.label.text === 'Rank: Adept' && spells(t).join('|') === 'Fireball|Ice Storm');
  P(t).tools.rank.onRelease();
  check('...and round to Every rank', P(t).tools.rank.label.text === 'Rank: Every rank' && spells(t).length === 3);
  P(t).tools.school.onRelease(); P(t).tools.school.onRelease();
  check('the schools come round to All', P(t).tools.school.label.text === 'School: All (5)');
  P(t).tools.school.onRelease(); P(t).tools.school.onRelease();
  t.push(w({ tomes: tomes.filter((x) => x.school !== 'Destruction') }));
  check('a school gone from the shelf shows All', P(t).tools.school.label.text === 'School: All (2)');
  t.push(base);
  check('the chosen school comes back with its tomes', P(t).tools.school.label.text === 'School: Destruction (3)');
  press(t, 'Search...');
  check('Search opens a box, typing allowed', P(t).tools.box && P(t).tools.box.type === 'input' && held(t) === 1);
  P(t).tools.box.text = ' ICE ';
  t.press(13);
  check('Enter filters spell, tome and school, case aside', spells(t).join('|') === 'Ice Storm' && /Showing 1 of 5 tomes/.test(P(t).foot.hint.text) && held(t) === 0);
  P(t).tools.school.onRelease();
  press(t, 'Clear');
  check('Clear shows the school again', spells(t).join('|') === 'Fast Healing', [P(t).tools.school.label.text, spells(t)]);
  press(t, 'Search...'); P(t).tools.box.text = 'restor'; t.press(13);
  check('the search reads the school too', spells(t).join('|') === 'Fast Healing');
  press(t, 'Clear'); P(t).tools.school.onRelease();
  press(t, 'Search...'); P(t).tools.box.text = '  Fireball Spell'; t.press(13);
  check('the search is trimmed', spells(t).join('|') === 'Fireball', spells(t));
  press(t, 'Search...'); P(t).tools.box.text = 'zzz'; t.press(13);
  check('no match says so', /No tomes match\./.test(texts(t)));
  press(t, 'Search...'); t.press(27);
  check('Escape leaves the box, not the shop', !P(t).tools.box && !t.closed() && held(t) === 0);
}

function texts(t) { const out = []; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (typeof k.text === 'string' && visible(k)) out.push(k.text); if (k.kids) walk(k); } }; walk(P(t)); return out.join(' | '); }

// ---- the countdown, on a clock the test moves ----
{
  let now = 1800000000000;
  function FakeDate() { this.t = now; }
  FakeDate.prototype.getTime = function () { return this.t; };
  const t = S.boot('dbo_tomes', false, { Date: FakeDate });
  t.push(w({ canBuy: false, nextPurchaseAt: now + 90000, whyNot: '' }));
  check('the wait reads 1m 30s', P(t).head.weekly.text === 'Next purchase in 1m 30s', P(t).head.weekly.text);
  now += 31000; t.tick();
  check('...and counts down by itself', P(t).head.weekly.text === 'Next purchase in 0m 59s', P(t).head.weekly.text);
}

// ---- leaving, paging, odd payloads ----
{
  const t = S.boot('dbo_tomes');
  const many = [];
  for (let i = 0; i < 20; i++) many.push(tome('m' + i, 'Spell ' + String(i).padStart(2, '0'), 'Illusion', i % 2, i % 2 ? 'Apprentice' : 'Novice', 10));
  t.push(w({ tomes: many, skills: [] }));
  check('a long shelf pages', /Page 1 of /.test(P(t).foot.hint.text));
  t.press(39);
  check('Right turns the page', /Page 2 of /.test(P(t).foot.hint.text));
  t.press(37);
  check('Left turns it back', /Page 1 of /.test(P(t).foot.hint.text));
  press(t, 'Close');
  const c = msgs(t, 'dbo:tomeClose');
  check('Close sends tomeClose with the nonce and closes', c.length === 1 && c[0].args[0] === 'n9' && t.closed());
  const e = S.boot('dbo_tomes');
  e.push(w({ tomes: [], seller: 'The Great Faiths' }));
  check('an empty shelf names its seller', /The Great Faiths has no tomes on its shelves for you\./.test(texts(e)) && !e.root.dboPanel.tools.school);
  e.press(27);
  check('Escape closes with tomeClose', msgs(e, 'dbo:tomeClose').length === 1 && e.closed());
  const nt = S.boot('dbo_tomes', false, { noTyping: true });
  nt.push(base);
  check('a game without typed input offers no Search', !btn(nt, 'Search...'));
  const n = S.boot('dbo_tomes');
  n.push({ type: 'tomeShop', id: 60 });
  check('an unreadable payload draws nothing', !n.root.dboPanel.head);
  n.st.time += 8000; n.tick();
  check('...and with no payload the panel closes itself', n.closed());
}

T.done();
