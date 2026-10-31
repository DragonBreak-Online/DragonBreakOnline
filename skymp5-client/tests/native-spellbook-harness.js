// Runs the native spellbook (swf/dbo_spellbook) on the stub stage with the widget server spells.js publishes, against the
// browser book's own rules (skymp5-front features/spellbook): the prepared places, the book by school and rank, preparing and
// putting away only at a college, a full book, one change in flight, the widget's own events, Escape and Close.
//   node tests/native-spellbook-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const P = (t) => t.root.dboPanel;
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const shownPage = (t) => Object.values(P(t).flowClip.kids).find((p) => p._visible);
// every page of the book, in order (the flow keeps its hidden pages, and their buttons work)
const pagesOf = (t) => Object.values(P(t).flowClip.kids).sort((a, b) => a.pageNo - b.pageNo);
const texts = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids).sort((a, b) => (a._y || 0) - (b._y || 0))) { if (typeof x.text === 'string' && !x.kids) out.push(x.text); else if (x.kids) walk(x); } }; for (const pg of pagesOf(t)) walk(pg); return out.join('|'); };
const rows = (t) => { const out = []; for (const pg of pagesOf(t)) { const here = []; for (const r of Object.values(pg.kids)) if (r.kids && r.label && r.sub) here.push(r); out.push(...here.sort((a, b) => a._y - b._y)); } return out; };
const row = (t, name) => rows(t).filter((r) => r.label.text === name).pop();

const sp = (id, name, school, rank, rankName, prepared) => ({ id, name, school, rank, rankName, prepared: !!prepared });
const known = [sp('s1', 'Flames', 'Destruction', 0, 'Novice', true), sp('s2', 'Oakflesh', 'Alteration', 0, 'Novice'), sp('s3', 'Fireball', 'Destruction', 2, 'Adept'),
  sp('s4', 'Firebolt', 'Destruction', 1, 'Apprentice'), sp('s5', 'Healing', 'Restoration', 0, 'Novice')];
const base = { type: 'spellbook', id: 58, nonce: 'b1', max: 3, atCollege: true, hint: '', prepared: [known[0]], known, result: '', resultKind: '',
  events: { prepare: 'dbo:spellbookPrepare', unprepare: 'dbo:spellbookUnprepare', close: 'dbo:spellbookClose' } };
const w = (o) => Object.assign({}, base, o);

{
  const t = S.boot('dbo_spellbook');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1);
  t.push(base);
  check('the title, the places prepared of the most, empty places said', P(t).head.title.text === 'SPELLBOOK' && /Prepared 1 of 3/.test(texts(t)) && (texts(t).match(/An empty place/g) || []).length === 2, texts(t));
  check('the book by school in the browser\'s order (Alteration, Destruction, Restoration), each by rank then name', /Alteration  \(1\)\|(Prepare\|)?Oakflesh/.test(texts(t)) && texts(t).indexOf('Alteration') < texts(t).indexOf('Destruction  (3)') && texts(t).indexOf('Destruction  (3)') < texts(t).indexOf('Restoration'), texts(t));
  const d = rows(t).filter((r) => r.sub.text.indexOf('In the book') >= 0 || r.sub.text.indexOf('Prepared') >= 0).map((r) => r.label.text);
  check('...Destruction: Flames (Novice), Firebolt (Apprentice), Fireball (Adept)', d.indexOf('Flames') < d.indexOf('Firebolt') && d.indexOf('Firebolt') < d.indexOf('Fireball'), d);
  check('a prepared spell in the book has no Prepare', !rows(t).filter((r) => r.label.text === 'Flames').some((r) => r.btn0 && r.btn0.label.text === 'Prepare'));
  row(t, 'Oakflesh').btn0.onRelease();
  const p = msgs(t, 'dbo:spellbookPrepare');
  check('Prepare sends the nonce and the spell', p.length === 1 && p[0].args.join('|') === 'b1|s2');
  check('one change in flight: its button says ..., the others are greyed', row(t, 'Oakflesh').btn0.label.text === '...' && row(t, 'Healing').btn0.disabled === true);
  t.push(w({ prepared: [known[0], Object.assign({}, known[1], { prepared: true })], known: known.map((s) => (s.id === 's2' ? Object.assign({}, s, { prepared: true }) : s)), result: 'Oakflesh is prepared.', resultKind: 'ok' }));
  check('the answer: two prepared, the result in green, the buttons back', /Prepared 2 of 3/.test(texts(t)) && P(t).foot.result.text === 'Oakflesh is prepared.' && P(t).foot.result.textColor === 0x7FBF7F && row(t, 'Healing').btn0.disabled !== true);
  const put = rows(t).find((r) => r.btn0 && r.btn0.label.text === 'Put away');
  put.btn0.onRelease();
  check('Put away sends unprepare with the spell', msgs(t, 'dbo:spellbookUnprepare').length === 1 && msgs(t, 'dbo:spellbookUnprepare')[0].args.join('|') === 'b1|s1');
  t.st.time += 8000; t.tick();
  check('a change that never comes back frees the buttons after eight seconds', rows(t).every((r) => !r.btn0 || r.btn0.label.text !== '...'));
}

{
  const t = S.boot('dbo_spellbook');
  const all = known.map((s) => (s.id !== 's5' ? Object.assign({}, s, { prepared: true }) : s));
  t.push(w({ prepared: all.filter((s) => s.prepared).slice(0, 3), known: all }));
  check('a full book: Prepare is greyed and says why', row(t, 'Healing').btn0.disabled === true && /put a prepared spell away first/.test(row(t, 'Healing').sub.text));
  t.push(w({ atCollege: false, hint: 'Prepare spells at a magic college.' }));
  check('away from a college: the hint, Put away and Prepare greyed, why said', /Prepare spells at a magic college\./.test(texts(t)) && rows(t).filter((r) => r.btn0).every((r) => r.btn0.disabled === true) && /only at a college/.test(row(t, 'Healing').sub.text));
  t.push(w({ result: 'Not here.', resultKind: 'refused' }));
  check('a refusal is red', P(t).foot.result.textColor === 0xB23A3A);
  t.push(w({ prepared: [], known: [] }));
  check('an empty book says how to fill it, and every place is empty', /Your spellbook is empty\. Study a spell tome/.test(texts(t)) && (texts(t).match(/An empty place/g) || []).length === 3);
  check('the footer counts the book', /^0 spells in your book\./.test(P(t).foot.hint.text));
  t.push(w({ prepared: [], known: [], max: 5 }));
  check('the places are the payload\'s max', /Prepared 0 of 5/.test(texts(t)) && (texts(t).match(/An empty place/g) || []).length === 5, texts(t));
}

{
  const many = [];
  for (let i = 0; i < 30; i++) many.push(sp('m' + i, 'Spell ' + i, 'Illusion', i % 3, 'Rank', false));
  const t = S.boot('dbo_spellbook');
  t.push(w({ prepared: [], known: many }));
  check('a long book pages', /Page 1 of /.test(P(t).foot.hint.text));
  t.press(39);
  check('Right turns the page', /Page 2 of /.test(P(t).foot.hint.text));
  t.press(37);
  check('Left turns it back', /Page 1 of /.test(P(t).foot.hint.text));
  P(t).foot.close.onRelease();
  check('Close sends the close event and closes', msgs(t, 'dbo:spellbookClose').length === 1 && t.closed());
  const e = S.boot('dbo_spellbook');
  e.push(base);
  e.press(27);
  check('Escape sends close and closes', msgs(e, 'dbo:spellbookClose').length === 1 && e.closed());
  const o = S.boot('dbo_spellbook');
  o.push(w({ events: { prepare: 'x:prep', unprepare: 'x:unprep', close: 'x:close' } }));
  row(o, 'Oakflesh').btn0.onRelease();
  check('the keys are the payload\'s own events', msgs(o, 'x:prep').length === 1 && msgs(o, 'dbo:spellbookPrepare').length === 0);
  const n = S.boot('dbo_spellbook');
  n.push({ type: 'spellbook', id: 58 });
  check('an unreadable payload draws nothing', !n.root.dboPanel.head);
  n.st.time += 8000; n.tick();
  check('...and with no payload the panel closes itself', n.closed());
}

T.done();
