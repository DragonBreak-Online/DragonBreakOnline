// Runs the native name prompt (swf/dbo_naming) on the stub stage with the widget server naming.js sends (widget 68), against
// the browser prompt's own rules (skymp5-front features/namePrompt): the limits in the text, one box typed in place, "Take
// this name" ready from two letters, the name sent once as events.choose [nonce, name] with its spaces folded, the reason of
// a refusal shown and the typed name kept for mending, Escape closing with the plain close, typing given back, and a game
// that cannot type pointed at /name and the browser panel (dbo:nameBrowser [nonce]).
//   node tests/native-naming-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const held = (t) => t.sent.reduce((n, m) => n + (m.e === 'allowTextInput' ? (m.on ? 1 : -1) : 0), 0);
const P = (t) => t.root.dboPanel;
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const box = (t) => P(t).box;
const take = (t) => P(t).state.take;
const W = (o) => Object.assign({ type: 'namePrompt', id: 68, nonce: 'n1', error: '', maxLength: 24, maxWords: 3, events: { choose: 'dbo:nameChoose' } }, o);

{
  const t = S.boot('dbo_naming');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1);
  t.push(W());
  check('the title and the limits from the payload', P(t).text.title.text === 'NAME YOUR CHARACTER' && /up to 3 words of letters, apostrophes and hyphens/.test(P(t).text.body.text));
  check('one box, typed in place, at the payload\'s length, holding the keys', box(t) && box(t).type === 'input' && box(t).maxChars === 24 && held(t) === 1);
  check('Take this name is greyed with nothing typed', take(t).label.text === 'Take this name' && take(t).disabled === true);
  box(t).text = 'A'; box(t).onChanged();
  check('...and with one letter', take(t).disabled === true);
  t.press(13);
  check('Enter with one letter sends nothing', msgs(t, 'dbo:nameChoose').length === 0);
  box(t).text = '  Aela   Brightwater '; box(t).onChanged();
  check('two letters or more make it ready', take(t).disabled !== true);
  t.press(13);
  check('Enter takes it: events.choose with the nonce and the name, spaces folded', msgs(t, 'dbo:nameChoose').length === 1 && msgs(t, 'dbo:nameChoose')[0].args.join('|') === 'n1|Aela Brightwater', msgs(t, 'dbo:nameChoose'));
  check('...then the button says it is checking, greyed', take(t).label.text === 'Checking the name...' && take(t).disabled === true);
  t.press(13); take(t).onRelease();
  check('a second Enter or click before the answer sends nothing', msgs(t, 'dbo:nameChoose').length === 1);
  t.push(W({ nonce: 'n2', error: 'Someone already carries that name. Choose another.' }));
  check('a refusal: the reason in red, the box keeps the name, ready again', P(t).state.error.text === 'Someone already carries that name. Choose another.' && P(t).state.error.textColor === 0xB23A3A && box(t).text === '  Aela   Brightwater ' && take(t).disabled !== true);
  check('...the same box, so the keys are held once', held(t) === 1);
  box(t).text = 'Aela Stone'; box(t).onChanged();
  take(t).onRelease();
  check('the button takes it too, with the new nonce', msgs(t, 'dbo:nameChoose').length === 2 && msgs(t, 'dbo:nameChoose')[1].args.join('|') === 'n2|Aela Stone');
  check('...and the reason hides while the name is out', P(t).state.error.text === '');
  check('the hint: unique names, leaving the Realm once named', /Names are unique across the realm/.test(P(t).state.hint.text));
  t.press(27);
  check('Escape closes with the plain close and gives the keys back', msgs(t, 'close').length === 1 && t.closed() && held(t) === 0);
}

{
  const t = S.boot('dbo_naming');
  t.push(W({ events: undefined, maxLength: undefined, maxWords: undefined }));
  check('no limits sent: the browser\'s defaults (3 words, 30 letters)', /up to 3 words/.test(P(t).text.body.text) && box(t).maxChars === 30);
  box(t).text = 'Ulf Strong'; box(t).onChanged(); t.press(13);
  check('no events sent: dbo:nameChoose, as the browser\'s fallback', msgs(t, 'dbo:nameChoose').length === 1);
  t.push(W({ events: { choose: 'dbo:nameChooseX' }, nonce: 'n9' }));
  box(t).text = 'Ulf Strong'; box(t).onChanged(); t.press(13);
  check('the key is the widget\'s own events.choose, verbatim', msgs(t, 'dbo:nameChooseX').length === 1);
}

{
  const t = S.boot('dbo_naming', false, { noTyping: true });
  t.push(W());
  check('a game that cannot type: no box, /name explained, the browser panel offered', !box(t) && /type \/name and the name in the chat/.test(P(t).notype.text) && !!P(t).state.browser && !take(t));
  P(t).state.browser.onRelease();
  check('In the browser... sends nameBrowser with the nonce', msgs(t, 'dbo:nameBrowser').length === 1 && msgs(t, 'dbo:nameBrowser')[0].args.join('|') === 'n1');
  check('...and never asked for the keys', held(t) === 0);
}

{
  const n = S.boot('dbo_naming');
  n.push({ type: 'namePrompt', id: 68 });
  check('an unreadable payload draws nothing', !n.root.dboPanel.text);
  n.st.time += 8000; n.tick();
  check('...and with no payload the panel closes itself', n.closed());
}

T.done();
