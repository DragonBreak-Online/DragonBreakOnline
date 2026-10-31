// Runs the native shrine panel (swf/dbo_shrine, supernatural.js widget 74) and courier handover (swf/dbo_courier, couriers.js
// widget 81) on the stub stage, against the browser panels' own rules (skymp5-front features/shrinePanel, courierHandover):
// the choices or why not, the rite's warning held a moment, one press per answer, the offering, the courier's two modes and
// its countdown, and Escape closing the panel for the router to report.
//   node tests/native-shrine-courier-harness.js
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
const ours = (t, re) => t.msgs().filter((m) => re.test(m.key));
const texts = (t) => { const out = []; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (typeof k.text === 'string' && visible(k)) out.push(k.text); if (k.kids) walk(k); } }; walk(P(t)); return out.join(' | '); };

// ---- the shrine ----
const shrine = { type: 'shrinePanel', id: 74, nonce: 's1', title: 'Shrine of Hircine', deity: 'Hircine',
  pray: { label: 'Kneel and pray', title: 'Ask for the hunt', available: true, reason: '' },
  rite: { label: 'Perform the Rite', available: false, reason: 'The rite asks a full moon.' }, confirm: null, leave: 'Leave the shrine', result: '', resultKind: '',
  offer: { god: 'Hircine', min: 10, max: 500 } };
const sw = (o) => Object.assign({}, shrine, o);
{
  const t = S.boot('dbo_shrine');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1);
  t.push(shrine);
  check('the title, Pray as a button with its line, the rite as why not', P(t).head.title.text === 'SHRINE OF HIRCINE' && !!btn(t, 'Kneel and pray') && /Ask for the hunt/.test(texts(t))
    && !btn(t, 'Perform the Rite') && /Perform the Rite/.test(texts(t)) && /The rite asks a full moon\./.test(texts(t)));
  press(t, 'Kneel and pray');
  check('Pray sends shrinePray with the nonce', msgs(t, 'dbo:shrinePray').length === 1 && msgs(t, 'dbo:shrinePray')[0].args.join('|') === 's1');
  check('one press per answer: everything greyed', btn(t, 'Kneel and pray').disabled === true && btn(t, 'Offer').disabled === true);
  t.st.time += 3000; t.tick();
  check('a press nobody answers lets go after three seconds', btn(t, 'Kneel and pray').disabled !== true);
  press(t, 'Kneel and pray');
  t.push(sw({ result: 'Hircine hears you.', resultKind: 'ok' }));
  check('an answer frees it at once and shows the result green', btn(t, 'Kneel and pray').disabled !== true && P(t).foot.result.text === 'Hircine hears you.' && P(t).foot.result.textColor === 0x7FBF7F);
  t.push(sw({ result: 'Not here.', resultKind: 'refused' }));
  check('a refusal is red', P(t).foot.result.textColor === 0xB23A3A);
  t.push(sw({ rite: { label: 'Perform the Rite', title: 'The Wild Hunt', available: true, reason: '' } }));
  press(t, 'Perform the Rite');
  check('the rite sends shrineRite', msgs(t, 'dbo:shrineRite').length === 1);
  t.push(sw({ confirm: { title: 'The Rite of the Hunt', warning: 'You will become a beast.', confirm: 'I accept', cancel: 'Not yet' } }));
  check('the warning: its title, its words, the grave button red, no Leave', /THE RITE OF THE HUNT|The Rite of the Hunt/.test(texts(t)) && /You will become a beast\./.test(texts(t)) && !btn(t, 'Leave the shrine'));
  check('...comes up held: a double click\'s second press lands on nothing', btn(t, 'I accept').disabled === true);
  press(t, 'I accept');
  check('...and sends nothing while held', msgs(t, 'dbo:shrineConfirm').length === 0);
  t.st.time += 1200; t.tick();
  check('after the hold the buttons come back, the grave one red', btn(t, 'I accept').disabled !== true && btn(t, 'I accept').label.textColor === 0xB23A3A);
  press(t, 'I accept');
  check('Confirm sends shrineConfirm', msgs(t, 'dbo:shrineConfirm').length === 1);
  t.push(sw({ confirm: { title: 'R', warning: 'W', confirm: 'I accept', cancel: 'Not yet' } }));
  t.st.time += 1200; t.tick();
  press(t, 'Not yet');
  check('Cancel sends shrineCancel', msgs(t, 'dbo:shrineCancel').length === 1);
  t.push(shrine);
  check('the offering starts empty, Offer greyed', /10 to 500 gold/.test(texts(t)) && btn(t, 'Offer').disabled === true);
  press(t, '+100'); press(t, '+100'); press(t, '-10');
  check('the steppers set it: 190', /190 gold/.test(texts(t)));
  for (let i = 0; i < 6; i++) press(t, '+100');
  check('...never past the most', /500 gold/.test(texts(t)));
  press(t, 'Type...');
  check('Type... opens a digits box, typing allowed', P(t).flowClip && held(t) === 1);
  const box = (() => { let f = null; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.type === 'input') f = k; if (k.kids) walk(k); } }; walk(P(t)); return f; })();
  check('...digits only, six of them', box.restrict === '0-9' && box.maxChars === 6);
  box.text = '75'; t.press(13);
  check('Enter takes it and gives the keys back', /75 gold/.test(texts(t)) && held(t) === 0);
  press(t, 'Offer');
  check('Offer sends the gold', msgs(t, 'dbo:shrineOffer').length === 1 && msgs(t, 'dbo:shrineOffer')[0].args[0] === 's1' && msgs(t, 'dbo:shrineOffer')[0].args[1] === 75);
  t.push(sw({ offer: null }));
  check('no offering for a non-follower', !btn(t, 'Offer') && !/An offering/.test(texts(t)));
  press(t, 'Leave the shrine');
  check('Leave sends shrineLeave and leaves the closing to the server', msgs(t, 'dbo:shrineLeave').length === 1 && msgs(t, 'dbo:shrineLeave')[0].args[0] === 's1' && !t.closed());
  const e = S.boot('dbo_shrine');
  e.push(shrine);
  e.press(27);
  check('Escape closes the panel and sends nothing of its own', e.closed() && ours(e, /^dbo:/).length === 0);
  const nt = S.boot('dbo_shrine', false, { noTyping: true });
  nt.push(shrine);
  check('a game without typed input offers no Type...', !btn(nt, 'Type...') && !!btn(nt, '+10'));
  const n = S.boot('dbo_shrine');
  n.push({ type: 'shrinePanel', id: 74 });
  check('an unreadable payload draws nothing', !n.root.dboPanel.head);
  n.st.time += 8000; n.tick();
  check('...and with no payload the panel closes itself', n.closed());
}

// ---- the courier ----
const person = { type: 'courierHandover', id: 81, mode: 'person', nonce: 'c1', from: 'Faendal', sender: 'Lydia', goods: '3 Iron Ingot', seconds: 30 };
const drop = { type: 'courierHandover', id: 81, mode: 'drop', nonce: 'd1', place: 'Bruma', jobs: [{ id: 4, goods: 'a', pay: 40, recipient: 'Olaf', sender: 'Lydia' }, { id: 5, goods: 'b', pay: 25, recipient: 'Gerdur', sender: 'Faendal' }] };
{
  const t = S.boot('dbo_courier');
  t.push(person);
  check('person: who has a parcel, who sent what', P(t).head.title.text === 'FAENDAL HAS A PARCEL FOR YOU' && /Sent by Lydia: 3 Iron Ingot\./.test(texts(t)) && P(t).head.kicker.text === "A courier's parcel");
  check('the countdown starts at its seconds', P(t).clock.hint.text === '30 s. No answer sends it to your mailbox.');
  t.st.time += 10000; t.tick();
  check('...and runs on its own', P(t).clock.hint.text === '20 s. No answer sends it to your mailbox.');
  press(t, 'Take it');
  check('Take it answers take with the nonce', msgs(t, 'dbo:courierAnswer').length === 1 && msgs(t, 'dbo:courierAnswer')[0].args.join('|') === 'c1|take');
  check('one answer: both greyed, Answered.', btn(t, 'To my mailbox').disabled === true && P(t).clock.hint.text === 'Answered.');
  press(t, 'To my mailbox');
  check('...a second press sends nothing', msgs(t, 'dbo:courierAnswer').length === 1);
  t.push(person);
  check('the same window re-sent keeps its answer', btn(t, 'Take it').disabled === true);
  t.push(Object.assign({}, person, { nonce: 'c2', seconds: 45 }));
  check('a new parcel is a new answer and a new countdown', btn(t, 'Take it').disabled !== true && P(t).clock.hint.text === '45 s. No answer sends it to your mailbox.');
  press(t, 'To my mailbox');
  check('To my mailbox answers mailbox', msgs(t, 'dbo:courierAnswer')[1].args.join('|') === 'c2|mailbox');
  t.push(drop);
  check('drop: the place, each parcel with its pay, Not now, no clock', P(t).head.title.text === 'BRUMA' && P(t).head.kicker.text === "Courier's drop point" && /For Olaf, from Lydia: 40 gold/.test(texts(t)) && !!btn(t, 'Not now') && !P(t).clock.hint);
  buttons(t).filter((b) => b.label.text === 'Hand in')[1].onRelease();
  check('Hand in names its job', msgs(t, 'dbo:courierDropIn').length === 1 && msgs(t, 'dbo:courierDropIn')[0].args.join('|') === 'd1|5');
  check('...one answer per window', btn(t, 'Not now').disabled === true);
  t.push(Object.assign({}, drop, { nonce: 'd2', jobs: [drop.jobs[0]] }));
  press(t, 'Not now');
  check('Not now sends courierDismiss', msgs(t, 'dbo:courierDismiss').length === 1 && msgs(t, 'dbo:courierDismiss')[0].args[0] === 'd2');
  const e = S.boot('dbo_courier');
  e.push(person);
  e.press(27);
  check('Escape closes the panel and sends nothing of its own (the server reads the close as the mailbox)', e.closed() && ours(e, /^dbo:/).length === 0);
  const n = S.boot('dbo_courier');
  n.push({ type: 'courierHandover', id: 81 });
  check('an unreadable payload draws nothing', !n.root.dboPanel.head);
  n.st.time += 8000; n.tick();
  check('...and with no payload the panel closes itself', n.closed());
}

T.done();
