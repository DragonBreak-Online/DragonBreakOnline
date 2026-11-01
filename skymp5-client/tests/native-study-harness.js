// Runs the native Study Magic panel (swf/dbo_study) on the stub stage with the widgets server schools.js publishes (Study
// Magic, a school's next spell, Priest Studies, Take an Apprentice), against the browser's features/studyMagic: choose with
// its question, studying with the meter and the clock running down, idle with why not or Study, the widget's own events.
//   node tests/native-study-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const P = (t) => t.root.dboPanel;
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const pagesOf = (t) => Object.values(P(t).flowClip.kids).sort((a, b) => a.pageNo - b.pageNo);
const texts = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids).sort((a, b) => (a._y || 0) - (b._y || 0))) { if (typeof x.text === 'string' && !x.kids) out.push(x.text); else if (x.kids) walk(x); } }; for (const pg of pagesOf(t)) walk(pg); return out.join('|'); };
const buttons = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (x.kids && x.label && x.onPick) out.push(x); else if (x.kids) walk(x); } }; for (const pg of pagesOf(t)) walk(pg); return out; };
const btn = (t, label) => buttons(t).find((b) => b.label.text === label);
const meter = (t) => { let m = null; const walk = (c) => { for (const x of Object.values(c.kids)) { if (x.fill !== undefined) m = x; else if (x.kids) walk(x); } }; for (const pg of pagesOf(t)) walk(pg); return m; };
const foot = (t) => P(t).foot;

const EV = { choose: 'dbo:schoolChoose', start: 'dbo:studyStart', stop: 'dbo:studyStop', close: 'dbo:studyClose' };
const choices = [{ name: 'Destruction', blurb: 'Fire, frost and shock.', confirm: 'Do you want to choose Destruction as your school of magic?' },
  { name: 'Illusion', blurb: 'The mind.', confirm: 'Do you want to choose Illusion?' }];
const base = { type: 'studyMagic', id: 73, nonce: 'k1', title: 'Study Magic', mode: 'choose', school: '', level: 0, rank: '', fill: 0, leftSeconds: 0, tickSeconds: 60, gained: 0, whyNot: '', choices, result: '', resultKind: '', events: EV };
const w = (o) => Object.assign({}, base, o);

{
  const t = S.boot('dbo_study');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1);
  t.push(base);
  check('choose: the title, the browser\'s lead, each school with its blurb', P(t).head.title.text === 'STUDY MAGIC' && /Before the books can teach you, choose the school/.test(texts(t)) && /Destruction\|Fire, frost and shock\./.test(texts(t)) && /Illusion\|The mind\./.test(texts(t)), texts(t));
  check('...no Study and no Close the books', !foot(t).start && !foot(t).stop);
  buttons(t)[0].onRelease();
  check('Choose... asks first, with the server\'s question, sending nothing', /Do you want to choose Destruction as your school of magic\?/.test(texts(t)) && !msgs(t, 'dbo:schoolChoose').length);
  t.press(27);
  check('Escape closes the question, not the panel', !t.closed() && /Illusion\|The mind\./.test(texts(t)));
  buttons(t)[1].onRelease();
  btn(t, 'Not yet').onRelease();
  check('Not yet goes back to the schools', /Destruction\|Fire/.test(texts(t)) && !msgs(t, 'dbo:schoolChoose').length);
  buttons(t)[1].onRelease();
  btn(t, 'Choose').onRelease();
  const c = msgs(t, 'dbo:schoolChoose');
  check('Choose sends the nonce, the school and primary', c.length === 1 && c[0].args.join('|') === 'k1|Illusion|primary', c);
  check('...and greys the choice in flight', btn(t, 'Choose').disabled === true);
  btn(t, 'Choose').onRelease();
  check('...once', msgs(t, 'dbo:schoolChoose').length === 1);
  t.push(w({ nonce: 'k2', result: 'Illusion it is.', resultKind: 'ok' }));
  check('a new nonce closes the question; the result in green', /Illusion\|The mind\./.test(texts(t)) && !btn(t, 'Choose') && foot(t).result.text === 'Illusion it is.' && foot(t).result.textColor === 0x7FBF7F);
  t.push(w({ nonce: 'k2', lead: 'Your study of Illusion has reached Apprentice: choose your second spell.', title: 'Your Apprentice Spell', events: { choose: 'dbo:firstSpellPick', start: 'dbo:firstSpellPick', stop: 'dbo:firstSpellPick', close: 'dbo:firstSpellClose' } }));
  check('a lead from the server replaces the line', /choose your second spell/.test(texts(t)) && !/Before the books/.test(texts(t)) && P(t).head.title.text === 'YOUR APPRENTICE SPELL');
  buttons(t)[0].onRelease(); btn(t, 'Choose').onRelease();
  check('the keys are the payload\'s own', msgs(t, 'dbo:firstSpellPick').length === 1 && msgs(t, 'dbo:firstSpellPick')[0].args[1] === 'Destruction');
  foot(t).leave.onRelease();
  check('Leave sends the payload\'s close and closes', msgs(t, 'dbo:firstSpellClose').length === 1 && msgs(t, 'dbo:firstSpellClose')[0].args.length === 0 && t.closed());
}

{
  const t = S.boot('dbo_study');
  t.push(w({ mode: 'studying', school: 'Illusion', level: 12, rank: 'Apprentice', fill: 0.4, leftSeconds: 125, gained: 3.14 }));
  check('studying: the school, rank and level, the sitting, the time left', /Illusion\|Apprentice  ·  12/.test(texts(t)) && /Stay at the books/.test(texts(t)) && /This sitting: 3\.1 units of study/.test(texts(t)) && /Time left for study: 2:05/.test(texts(t)), texts(t));
  check('...the meter at the fill', meter(t) && meter(t).fill === 0.4);
  check('...Close the books, no Study', foot(t).stop && !foot(t).start);
  t.st.time += 5000; t.tick();
  check('the clock runs down on screen', /Time left for study: 2:00/.test(texts(t)), texts(t));
  t.st.time += 200000; t.tick();
  check('...never below nothing', /Time left for study: 0:00/.test(texts(t)));
  foot(t).stop.onRelease();
  check('Close the books sends stop with the nonce', msgs(t, 'dbo:studyStop').length === 1 && msgs(t, 'dbo:studyStop')[0].args.join('|') === 'k1');
  check('...greyed while it goes', foot(t).stop.disabled === true);
  t.st.time += 8000; t.tick();
  check('a stop that never comes back frees it after eight seconds', foot(t).stop.disabled !== true);
  foot(t).stop.onRelease();
  t.push(w({ mode: 'idle', school: 'Illusion', level: 12, rank: 'Apprentice', fill: 0.4, leftSeconds: 60 }));
  check('idle with time: the time, standing still, and Study', /Time left for study: 1:00/.test(texts(t)) && foot(t).start && foot(t).start.disabled !== true && !foot(t).stop);
  t.st.time += 5000; t.tick();
  check('...the idle clock does not run', /Time left for study: 1:00/.test(texts(t)));
  foot(t).start.onRelease();
  check('Study sends start with the nonce', msgs(t, 'dbo:studyStart').length === 1 && msgs(t, 'dbo:studyStart')[0].args.join('|') === 'k1');
  t.st.time += 8000; t.tick();
  check('...and when it is freed unanswered, the idle clock still stands', foot(t).start.disabled !== true && /Time left for study: 1:00/.test(texts(t)), texts(t));
  t.push(w({ mode: 'idle', school: 'Illusion', level: 12, rank: 'Apprentice', whyNot: 'You have studied enough today.', result: 'No.', resultKind: 'refused' }));
  check('idle with why not: the reason, no Study, a refusal in red', /You have studied enough today\./.test(texts(t)) && !foot(t).start && foot(t).result.textColor === 0xB23A3A);
  t.press(27);
  check('Escape sends close and closes', msgs(t, 'dbo:studyClose').length === 1 && t.closed());
}

{
  const t = S.boot('dbo_study');
  t.push(w({ title: '', events: undefined }));
  check('no title: Study Magic; no events: the browser\'s keys', P(t).head.title.text === 'STUDY MAGIC');
  buttons(t)[0].onRelease(); btn(t, 'Choose').onRelease();
  check('...dbo:schoolChoose', msgs(t, 'dbo:schoolChoose').length === 1);
  const n = S.boot('dbo_study');
  n.push({ type: 'studyMagic', id: 73 });
  check('an unreadable payload draws nothing', !n.root.dboPanel.head);
  n.st.time += 8000; n.tick();
  check('...and with no payload the panel closes itself', n.closed());
}

T.done();
