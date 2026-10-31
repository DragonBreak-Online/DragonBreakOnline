// Runs the native Key Ring (swf/dbo_keyring) on the stub stage with the widget server keyring.js publishes (widget 91),
// against the browser ring's own rules (skymp5-front features/keyRing): an offer, keys by property, giving a key to a player
// beside you, cutting and taking back copies, one action in flight, the nonce on every event, Escape and Close.
//   node tests/native-keyring-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const P = (t) => t.root.dboPanel;
const visible = (c) => { for (let k = c; k; k = k._parent) if (k._visible === false) return false; return true; };
const buttons = (t) => { const out = []; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.label && k.onRelease && visible(k)) out.push(k); if (k.kids) walk(k); } }; walk(P(t)); return out; };
const btn = (t, label) => buttons(t).find((b) => b.label.text === label);
// a row's button on any of the flow's pages (a check about a row that may sit on page 2)
const anyPage = (c) => { for (let k = c; k; k = k._parent) if (k._visible === false && k.pageNo === undefined) return false; return true; };
const all = (t) => { const out = []; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.label && k.onRelease && anyPage(k)) out.push(k); if (k.kids) walk(k); } }; walk(P(t)); return out; };
const on = (t, row, label) => all(t).find((b) => b.label.text === label && b._parent.label && b._parent.label.text === row);
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const sent = (t) => t.msgs().filter((m) => /^dbo:keyRing/.test(m.key));
const last = (t) => sent(t).slice(-1)[0];
const texts = (t) => { const out = []; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (typeof k.text === 'string' && visible(k)) out.push(k.text); if (k.kids) walk(k); } }; walk(P(t)); return out.join(' | '); };

const keys = [{ name: 'Rose Hall key 1', place: 'Rose Hall', opens: true }, { name: 'Old shed key', place: 'Rose Hall', opens: false }, { name: 'Mill key', place: '', opens: true }];
const near = [{ actor: 0xff000010, name: 'Olaf' }, { actor: 0xff000011, name: 'Gerdur' }];
const owned = [{ ref: 0x5000, place: 'Thorn House', copies: [{ name: 'Thorn House key 2', holder: 'Olaf' }, { name: 'Thorn House key 3', holder: '' }] }, { ref: 0x6000, place: 'The Barn', copies: [] }];
const base = { type: 'keyRing', id: 91, nonce: 'r1', keys, near, owned, offer: null, result: '', resultKind: '' };
const w = (o) => Object.assign({}, base, o);

{
  const t = S.boot('dbo_keyring');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1);
  t.push(base);
  check('the title is Key Ring', P(t).head.title.text === 'KEY RING');
  check('keys come grouped by property, a key with no place under Other keys', /Rose Hall/.test(texts(t)) && /Other keys/.test(texts(t)) && texts(t).indexOf('Rose Hall key 1') < texts(t).indexOf('Old shed key') && texts(t).indexOf('Old shed key') < texts(t).indexOf('Mill key'));
  check('...each property once, its keys under it', texts(t).split(' | ').filter((x) => x === 'Rose Hall').length === 1, texts(t));
  const dead = on(t, 'Old shed key', 'Give')._parent.sub;
  check('a key that opens nothing says so in red', dead.text === 'Opens nothing' && dead.textColor === 0xB23A3A && on(t, 'Rose Hall key 1', 'Give')._parent.sub.text === 'Opens');
  on(t, 'Rose Hall key 1', 'Give').onRelease();
  check('Give shows the players beside you and Cancel, sends nothing', !!btn(t, 'Olaf') && !!btn(t, 'Gerdur') && !!btn(t, 'Cancel') && sent(t).length === 0);
  btn(t, 'Cancel').onRelease();
  check('Cancel hides them', !btn(t, 'Olaf'));
  on(t, 'Rose Hall key 1', 'Give').onRelease(); on(t, 'Rose Hall key 1', 'Give').onRelease();
  check('Give twice hides them too', !btn(t, 'Olaf'));
  on(t, 'Mill key', 'Give').onRelease();
  t.press(27);
  check('Escape hides the pick, not the panel', !btn(t, 'Olaf') && !t.closed());
  on(t, 'Mill key', 'Give').onRelease();
  btn(t, 'Gerdur').onRelease();
  check('picking a player gives that key with the nonce', last(t).key === 'dbo:keyRingGive' && last(t).args.join('|') === 'r1|Mill key|' + 0xff000011, last(t));
  check('one action in flight: every button greyed until the answer', on(t, 'Rose Hall key 1', 'Give').disabled === true);
  t.push(w({ result: 'Gerdur has your key.', resultKind: 'ok' }));
  check('the answer ends it and shows the result in green', on(t, 'Rose Hall key 1', 'Give').disabled !== true && P(t).foot.result.text === 'Gerdur has your key.' && P(t).foot.result.textColor === 0x7FBF7F);

  check('your properties list each with its copies and who holds them', /Thorn House key 2/.test(texts(t)) && /Held by Olaf/.test(texts(t)) && /Holder unknown/.test(texts(t)) && /No keys are out\./.test(texts(t)));
  on(t, 'Thorn House', 'Cut a key').onRelease();
  check('Cut a key cuts one for yourself (actor 0)', last(t).key === 'dbo:keyRingCut' && last(t).args.join('|') === 'r1|' + 0x5000 + '|0');
  t.push(w({ keys: [] }));
  on(t, 'The Barn', 'Cut for...').onRelease();
  btn(t, 'Olaf').onRelease();
  check('Cut for... cuts one for the player picked', last(t).args.join('|') === 'r1|' + 0x6000 + '|' + 0xff000010);
  t.push(base);
  on(t, 'Thorn House key 3', 'Take back').onRelease();
  check('Take back names the lock and the copy', last(t).key === 'dbo:keyRingTake' && last(t).args.join('|') === 'r1|' + 0x5000 + '|Thorn House key 3');
  t.push(w({ result: 'No such key.', resultKind: 'refused' }));
  check('a refusal is red', P(t).foot.result.textColor === 0xB23A3A);
}

{
  const t = S.boot('dbo_keyring');
  t.push(w({ offer: { from: 'Olaf', key: 'Mead Hall key 4' } }));
  check('an offer comes first with Accept and Decline', /Olaf offers you Mead Hall key 4\./.test(texts(t)) && !!btn(t, 'Accept') && !!btn(t, 'Decline'));
  btn(t, 'Accept').onRelease();
  check('Accept answers true', last(t).key === 'dbo:keyRingAnswer' && last(t).args[0] === 'r1' && last(t).args[1] === true);
  t.push(w({ offer: { from: 'Olaf', key: 'Mead Hall key 4' } }));
  btn(t, 'Decline').onRelease();
  check('Decline answers false', last(t).args[1] === false);
  t.push(w({ near: [] }));
  on(t, 'Mill key', 'Give').onRelease();
  check('nobody beside you says so, and Cancel is still there', /Nobody stands beside you\./.test(texts(t)) && !!btn(t, 'Cancel'));
  t.push(w({ near: [] }));
  check('a re-sent panel ends the pick', !/Nobody stands beside you\./.test(texts(t)));
  t.push(w({ keys: [], owned: [] }));
  check('no keys says so; no properties, no section', /No keys\. The owner of a property can cut one for you\./.test(texts(t)) && !/Your properties/i.test(texts(t)));
  t.press(40);
  check('Down focuses the first control', t.ctx.focus === 0);
  btn(t, 'Close').onRelease();
  check('Close sends keyRingClose and closes', msgs(t, 'dbo:keyRingClose').length === 1 && t.closed());
  const e = S.boot('dbo_keyring');
  e.push(base);
  e.press(27);
  check('Escape closes with keyRingClose', msgs(e, 'dbo:keyRingClose').length === 1 && e.closed());
  const many = [];
  for (let i = 0; i < 20; i++) many.push({ name: 'Key ' + i, place: 'Place ' + (i % 3), opens: true });
  const g = S.boot('dbo_keyring');
  g.push(w({ keys: many }));
  check('a long ring pages', /Page 1 of /.test(g.root.dboPanel.foot.pages.text));
  g.press(39);
  check('Right turns the page', /Page 2 of /.test(g.root.dboPanel.foot.pages.text));
  g.press(37);
  check('Left turns it back', /Page 1 of /.test(g.root.dboPanel.foot.pages.text));
  const n = S.boot('dbo_keyring');
  n.push({ type: 'keyRing', id: 91 });
  check('an unreadable payload draws nothing', !n.root.dboPanel.head);
  n.st.time += 8000; n.tick();
  check('...and with no payload the panel closes itself', n.closed());
}

T.done();
