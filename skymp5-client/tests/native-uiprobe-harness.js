// The UI probe (swf/dbo_uiprobe) on the stub stage: its first answer (can it type, did the filters stay) on ready, and the
// typed text on Send. Fake filter classes stand in for Scaleform's; whether they draw is Nat's eye in the game.
//   node tests/native-uiprobe-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
function GlowFilter() { this.kind = 'glow'; }
function DropShadowFilter() { this.kind = 'shadow'; }
const msgs = (t) => t.msgs().filter((m) => m.key === 'dbo:uiProbe');

const t = S.boot('dbo_uiprobe', false, { flash: { filters: { GlowFilter, DropShadowFilter }, external: { ExternalInterface: { call: () => {} } } } });
const first = msgs(t)[0];
check('on ready it reports that it can type, and that both filters stayed on their boxes', first && first.args[0].canType === true && first.args[0].glow === 'kept' && first.args[0].shadow === 'kept' && first.args[0].plain === 'plain', first);
check('the glow box has its filter', t.root.dboPanel.s1.filters && t.root.dboPanel.s1.filters[0].kind === 'glow');
const box = t.root.dboPanel.box;
check('the box takes typing: an input field, focused, with AllowTextInput on', box.type === 'input' && t.ctx.Selection.focused === box && t.sent.some((m) => m.e === 'allowTextInput' && m.on === true));
box.text = 'Hail Bruma 42';
t.root.dboPanel.send.onRelease();
const r = msgs(t).pop().args[0];
check('Send reports exactly what was typed', r.typed === 'Hail Bruma 42' && r.typedLength === 13, r);
const n = S.boot('dbo_uiprobe', false, { noTyping: true });
check('a game without the filter classes or AllowTextInput says so instead of failing', msgs(n)[0].args[0].canType === false && msgs(n)[0].args[0].glow === 'no glow class', msgs(n)[0]);
t.press(27);
check('Escape gives the keys back and closes', t.sent.filter((m) => m.e === 'allowTextInput').pop().on === false && t.closed());
T.done();
