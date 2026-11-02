// The kick screen as a native panel (swf/dbo_kick, kickService), against the browser's form (widget 28): the caption, the
// reason, the seconds until the game closes counting down, Quit game sending kick:quit once, Escape doing nothing, the
// words it is given; and the service using the panel only in English (the game's fonts have no Cyrillic) and while the world
// runs, the browser form in Russian, over the main menu or when the panel fails.
//   node tests/native-kick-harness.js   (from skymp5-client)
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const read = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

const P = (t) => t.root.dboPanel;
const textsOf = (c) => { const out = []; const walk = (x) => { for (const k of Object.values(x.kids || {})) { if (typeof k.text === 'string') out.push(k.text); if (k.kids) walk(k); } }; walk(c); return out.join('|'); };
const buttons = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids || {})) { if (x.kids && x.label && x.onPick) out.push(x); else if (x.kids) walk(x); } }; walk(P(t)); return out; };
const quits = (t) => t.msgs().filter((m) => m.key === 'kick:quit');
const EN = { disconnected: 'Disconnected', closing: 'The game will close in {s} s. Restart it to play again.', quit: 'Quit game' };

{
  const t = S.boot('dbo_kick');
  t.push({ type: 'kick', reason: 'You were away too long.', seconds: 10, strings: EN });
  const tx = textsOf(P(t));
  check('the caption, the reason and the seconds left', /^disconnected$/i.test(textsOf(P(t).head)) && /You were away too long\./.test(tx) && /The game will close in 10 s\. Restart it to play again\./.test(tx), tx);
  check('...and Quit game', buttons(t).some((b) => b.label.text === 'Quit game'));
  t.st.time += 3000; t.tick();
  check('the seconds count down', /close in 7 s\./.test(textsOf(P(t))), textsOf(P(t)));
  t.st.time += 20000; t.tick();
  check('...and stop at 0', /close in 0 s\./.test(textsOf(P(t))));
  t.press(27);
  check('Escape does nothing: the game closes either way', !t.closed() && !quits(t).length);
  const q = buttons(t).find((b) => b.label.text === 'Quit game');
  q.onRelease(); q.onRelease();
  check('Quit game sends kick:quit once', quits(t).length === 1);
}
{
  const t = S.boot('dbo_kick');
  t.push({ type: 'kick', reason: '', seconds: 9, strings: { disconnected: 'Gone', closing: 'Closing in {s} seconds.', quit: 'Leave' } });
  check('the panel draws the words it is given, no empty reason line', /Closing in 9 seconds\./.test(textsOf(P(t))) && buttons(t).some((b) => b.label.text === 'Leave') && !/\|\|/.test(textsOf(P(t))));
  const n = S.boot('dbo_kick');
  n.push({ type: 'death' });
  check('a payload that is not a kick is refused', n.logs.some((l) => /kick: unreadable payload/.test(l)));
  n.st.time += 8001; n.tick();
  check('...and with none in 8 s the panel closes itself', n.closed());
}

// ---- the service ----
const SVC = read('src/services/services/kickService.ts');
check('nativeWidgets: kick is a client-service panel, dbo_kick', /\n  kick: "dbo_kick",\n/.test(read('src/services/services/nativeWidgets.ts')));
check('the panel only in English and while the world runs ("update" within 500 ms); the browser form otherwise', /const WORLD_RUNNING_MS = 500;/.test(SVC)
  && /this\.native = strings === translations\.en && Date\.now\(\) - this\.updatedAt < WORLD_RUNNING_MS && this\.openNative\(\);\s*if \(!this\.native\) openFormMenu\(/.test(SVC)
  && /this\.controller\.on\("update", \(\) => \{ this\.updatedAt = Date\.now\(\); \}\);/.test(SVC));
check('the panel gets the reason, the seconds and the client\'s words', /widget: \{ type: "kick", reason, seconds: this\.shownSeconds, strings \}/.test(SVC));
check('kick:quit closes the game as the browser\'s Quit does', /if \(key === "kick:quit" && this\.exitAt\) \{ this\.quitGame\(\); return; \}/.test(SVC));
check('a failed panel falls to the browser form with the seconds left', /if \(key === FAILED_KEY && this\.native && this\.exitAt\) \{\s*this\.native = false;[\s\S]{0,120}openFormMenu\(/.test(SVC));
check('the countdown still closes the game on its own, panel or not', /if \(seconds <= 0\) return this\.quitGame\(\);/.test(SVC) && /if \(this\.native\) return;\s*refreshFormMenu\(/.test(SVC));
check('the hide-UI key never puts the browser over the panel', /if \(!e\.hidden && this\.exitAt && !this\.native\) this\.sp\.browser\.setFocused\(true\);/.test(SVC));

// ---- mutants: each altered copy must fail this harness (tests/lib/mutants.js) ----
const AS = 'swf/dbo_kick/scripts/frame_1/DoAction.as';
const SV = 'src/services/services/kickService.ts';
const MUTANTS = [
  ['Quit can send twice', AS, [['   if (quitSent)\n', '   if (false)\n']]],
  ['Escape closes', AS, [['   if (code == 38 && actions.length)', '   if (code == 27) { dboClose(); return; }\n   if (code == 38 && actions.length)']]],
  ['the countdown never moves', AS, [['      if (panel.closingField != null)\n', '      if (false)\n']]],
  ['the panel even over the main menu', SV, [['this.native = strings === translations.en && Date.now() - this.updatedAt < WORLD_RUNNING_MS && this.openNative();', 'this.native = strings === translations.en && this.openNative();']]],
  ['Russian goes native too', SV, [['this.native = strings === translations.en && ', 'this.native = ']]],
  ['the browser form drawn over the panel each second', SV, [['    if (this.native) return;\n    refreshFormMenu(', '    refreshFormMenu(']]],
];
require('./lib/mutants')(__filename, MUTANTS, check);

T.done();
