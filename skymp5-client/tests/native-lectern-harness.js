// Runs the native Class Lectern (swf/dbo_lectern) on the stub stage with the widgets server schools.js makeLectern publishes
// (the class and the temple's sermon, with its own words), against the browser's features/classLectern: a teacher picking a
// spell and beginning, the class in progress for the teacher, a student and a visitor, the countdown, cancelling after a
// question, the widget's own events.
//   node tests/native-lectern-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const P = (t) => t.root.dboPanel;
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const pagesOf = (t) => Object.values(P(t).flowClip.kids).sort((a, b) => a.pageNo - b.pageNo);
const texts = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids).sort((a, b) => (a._y || 0) - (b._y || 0))) { if (typeof x.text === 'string' && !x.kids) out.push(x.text); else if (x.kids) walk(x); } }; for (const pg of pagesOf(t)) walk(pg); return out.join('|'); };
const rows = (t) => { const out = []; for (const pg of pagesOf(t)) { const here = []; for (const r of Object.values(pg.kids)) if (r.kids && r.label && r.sub) here.push(r); out.push(...here.sort((a, b) => a._y - b._y)); } return out; };
const row = (t, name) => rows(t).find((r) => r.label.text.replace(/^> /, '') === name);
const buttons = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (x.kids && x.label && x.onPick) out.push(x); else if (x.kids) walk(x); } }; for (const pg of pagesOf(t)) walk(pg); return out; };
const btn = (t, label) => buttons(t).find((b) => b.label.text === label);
const foot = (t) => P(t).foot;

const EV = { start: 'dbo:lecternStart', join: 'dbo:lecternJoin', leave: 'dbo:lecternLeave', end: 'dbo:lecternEnd', cancel: 'dbo:lecternCancel', close: 'dbo:lecternClose' };
const sp = (id, name, school, rank, rankName) => ({ id, name, school, rank, rankName });
const spells = [sp('Skyrim.esm:1', 'Oakflesh', 'Alteration', 0, 'Novice'), sp('Skyrim.esm:2', 'Fireball', 'Destruction', 2, 'Adept'), sp('Skyrim.esm:3', 'Flames', 'Destruction', 0, 'Novice'), sp('Skyrim.esm:4', 'Fury', 'Illusion', 1, 'Apprentice')];
const idle = { type: 'classLectern', id: 72, nonce: 'l1', title: 'Class Lectern', mode: 'idle', status: 'No class', result: '', resultKind: '', events: EV, canTeach: true, whyNot: '', minutes: 30, spells };
const run = { type: 'classLectern', id: 72, nonce: 'l2', title: 'Class Lectern', mode: 'running', status: 'Class in Progress', result: '', resultKind: '', events: EV,
  teacher: 'Aria', spell: 'Fireball', school: 'Destruction', rankName: 'Adept', endsInMs: 125000, minutes: 30, teacherAway: 0, students: [{ name: 'Bjorn', away: false }, { name: 'Olaf', away: true }], role: 'visitor', gain: 'You would gain a fair share.', canJoin: true, whyNot: '', canEnd: false };
const w = (b, o) => Object.assign({}, b, o);

{
  const t = S.boot('dbo_lectern');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1);
  t.push(idle);
  check('idle teacher: the title, the status, the lead with the minutes', P(t).head.title.text === 'CLASS LECTERN' && P(t).head.status.text === 'No class' && /The class runs 30 minutes\./.test(texts(t)), texts(t));
  const order = rows(t).map((r) => r.label.text);
  check('the spells as the browser: Destruction, Illusion, Conjuration, Alteration, each by rank then name', order.join(',') === 'Flames,Fireball,Fury,Oakflesh', order);
  check('...Begin greyed until a spell is chosen', foot(t).begin.disabled === true && foot(t).begin.label.text === 'Begin the class');
  row(t, 'Fury').btn0.onRelease();
  check('choosing marks it and frees Begin', /^> Fury/.test(row(t, 'Fury').label.text) && row(t, 'Fury').btn0.label.text === 'Chosen' && foot(t).begin.disabled !== true);
  t.push(w(idle, { result: '' }));
  check('a redraw in place keeps the spell chosen', /^> Fury/.test(row(t, 'Fury').label.text));
  t.push(w(idle, { spells: spells.filter((s) => s.name !== 'Fury') }));
  check('...unless it is no longer offered', foot(t).begin.disabled === true && rows(t).every((r) => !/^> /.test(r.label.text)));
  row(t, 'Flames').btn0.onRelease();
  foot(t).begin.onRelease();
  const s = msgs(t, 'dbo:lecternStart');
  check('Begin sends the nonce and the spell\'s desc', s.length === 1 && s[0].args.join('|') === 'l1|Skyrim.esm:3', s);
  check('...greyed while it goes', foot(t).begin.disabled === true);
  t.st.time += 8000; t.tick();
  check('...freed after eight seconds unanswered', foot(t).begin.disabled !== true);
  t.push(w(idle, { canTeach: false, spells: [], whyNot: 'Only a named teacher may teach here.' }));
  check('not a teacher: told who may teach, no Begin', /Only a named teacher may teach here\./.test(texts(t)) && !foot(t).begin);
  t.push(w(idle, { minutes: 45 }));
  check('...the length of the class is the server\'s', /The class runs 45 minutes\./.test(texts(t)));
  t.press(27);
  check('Escape sends close and closes', msgs(t, 'dbo:lecternClose').length === 1 && msgs(t, 'dbo:lecternClose')[0].args.length === 0 && t.closed());
}

{
  const t = S.boot('dbo_lectern');
  t.push(run);
  check('running: teacher, lesson, students with the away marked, the gain', /Teacher\|Aria/.test(texts(t)) && /Lesson\|Fireball \(Destruction, Adept\)/.test(texts(t)) && /Students\|Bjorn, Olaf \(away\)/.test(texts(t)) && /You would gain a fair share\./.test(texts(t)), texts(t));
  check('...the status with the countdown', P(t).head.status.text === 'Class in Progress   2:05');
  t.st.time += 5000; t.tick();
  check('the countdown runs on screen', P(t).head.status.text === 'Class in Progress   2:00', P(t).head.status.text);
  t.st.time += 999999; t.tick();
  check('...to nothing', /0:00$/.test(P(t).head.status.text));
  check('a visitor who may: Sign up', foot(t).join && foot(t).join.label.text === 'Sign up' && !foot(t).leave && !foot(t).end);
  foot(t).join.onRelease();
  check('Sign up sends join with the nonce', msgs(t, 'dbo:lecternJoin').length === 1 && msgs(t, 'dbo:lecternJoin')[0].args.join('|') === 'l2');
  t.push(w(run, { canJoin: false, whyNot: 'You know more than this class teaches.' }));
  check('a visitor who may not: why, no Sign up', /You know more than this class teaches\./.test(texts(t)) && !foot(t).join);
  t.push(w(run, { role: 'student', students: [] }));
  check('a student: Leave the class; nobody else: None yet', foot(t).leave && /Students\|None yet/.test(texts(t)));
  foot(t).leave.onRelease();
  check('Leave sends leave', msgs(t, 'dbo:lecternLeave').length === 1);
}

{
  const t = S.boot('dbo_lectern');
  t.push(w(run, { role: 'teacher', gain: '', teacherAway: 0 }));
  check('the teacher before the time: End greyed, Cancel there', foot(t).end.disabled === true && foot(t).cancel.disabled !== true);
  foot(t).cancel.onRelease();
  check('Cancel asks first, sending nothing', /Cancel the class\?\|Nobody is paid for a cancelled class\./.test(texts(t)) && !msgs(t, 'dbo:lecternCancel').length && !foot(t).cancel);
  t.press(27);
  check('Escape closes the question, not the panel', !t.closed() && /Teacher\|Aria/.test(texts(t)));
  foot(t).cancel.onRelease();
  btn(t, 'Keep teaching').onRelease();
  check('Keep teaching goes back', /Teacher\|Aria/.test(texts(t)));
  foot(t).cancel.onRelease();
  t.push(w(run, { role: 'teacher', gain: '' }));
  check('a redraw in place keeps the question', /Cancel the class\?/.test(texts(t)));
  btn(t, 'Cancel it').onRelease();
  check('Cancel it sends cancel with the nonce', msgs(t, 'dbo:lecternCancel').length === 1 && msgs(t, 'dbo:lecternCancel')[0].args.join('|') === 'l2');
  t.push(w(run, { nonce: 'l3', role: 'teacher', canEnd: true, result: 'The class has run its course.', resultKind: 'ok' }));
  check('a new nonce closes the question; after the time End is free', /Teacher\|Aria/.test(texts(t)) && foot(t).end.disabled !== true && foot(t).result.textColor === 0x7FBF7F);
  foot(t).end.onRelease();
  check('End sends end', msgs(t, 'dbo:lecternEnd').length === 1 && msgs(t, 'dbo:lecternEnd')[0].args.join('|') === 'l3');
  t.push(w(run, { nonce: 'l4', role: 'teacher', teacherAway: 90000, result: 'Not now.', resultKind: 'refused' }));
  check('the teacher away: the warning with its clock; a refusal in red', /The teacher has left the classroom\. The class is cancelled in 1:30 unless they return\./.test(texts(t)) && foot(t).result.textColor === 0xB23A3A, texts(t));
  foot(t).close.onRelease();
  check('Close sends close and closes', msgs(t, 'dbo:lecternClose').length === 1 && t.closed());
}

{
  // The sermon: the same widget with the temple's words and its own events
  const words = { lead: 'Choose the Restoration spell your sermon is on. The sermon runs 20 minutes.', teacher: 'Priest', lesson: 'Sermon', students: 'Listeners', none: 'None yet',
    teacherAway: 'The priest has left the temple. The sermon is cancelled in {clock} unless they return.', begin: 'Begin the sermon', join: 'Join', leave: 'Leave the sermon', end: 'End Sermon', cancel: 'Cancel the sermon',
    cancelTitle: 'Cancel the sermon?', cancelText: 'Nobody is paid for a cancelled sermon.', cancelYes: 'Cancel it', cancelNo: 'Keep preaching' };
  const pev = { start: 'dbo:preachStart', join: 'dbo:preachJoin', leave: 'dbo:preachLeave', end: 'dbo:preachEnd', cancel: 'dbo:preachCancel', close: 'dbo:preachClose' };
  const t = S.boot('dbo_lectern');
  t.push(w(idle, { title: 'Sermon Lectern', words, events: pev, spells: [sp('Skyrim.esm:9', 'Healing', 'Restoration', 0, 'Novice')] }));
  check('the sermon: its lead and Begin the sermon', /Choose the Restoration spell your sermon is on\./.test(texts(t)) && foot(t).begin.label.text === 'Begin the sermon' && P(t).head.title.text === 'SERMON LECTERN');
  check('...a school outside the class\'s four is still listed', row(t, 'Healing') !== undefined);
  row(t, 'Healing').btn0.onRelease(); foot(t).begin.onRelease();
  check('...and its own events', msgs(t, 'dbo:preachStart').length === 1 && !msgs(t, 'dbo:lecternStart').length);
  t.push(w(run, { nonce: 'p2', words, events: pev, role: 'visitor', teacherAway: 60000 }));
  check('in progress: Priest, Sermon, Listeners, Join, the priest away', /Priest\|Aria/.test(texts(t)) && /Sermon\|Fireball/.test(texts(t)) && /Listeners\|Bjorn/.test(texts(t)) && foot(t).join.label.text === 'Join' && /The priest has left the temple\. The sermon is cancelled in 1:00/.test(texts(t)), texts(t));
  t.push(w(run, { nonce: 'p3', words, events: pev, role: 'teacher' }));
  foot(t).cancel.onRelease();
  check('...and its question', /Cancel the sermon\?\|Nobody is paid for a cancelled sermon\./.test(texts(t)) && btn(t, 'Keep preaching') !== undefined && foot(t).cancel === undefined);
  const n = S.boot('dbo_lectern');
  n.push({ type: 'classLectern', id: 72 });
  check('an unreadable payload draws nothing', !n.root.dboPanel.head);
  n.st.time += 8000; n.tick();
  check('...and with no payload the panel closes itself', n.closed());
}

T.done();
