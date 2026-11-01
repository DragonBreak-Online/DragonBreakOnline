// Typed text in a native box keeps the box's format (swf/lib/dbo.as dboInput). On 1 Nov Nat typed into a native box and
// got four black boxes: the characters took the field's default format (black, a font the game's library does not have)
// instead of the $EverywhereFont format the box was made with. The stub models that: typing leaves the new characters
// without the box's format (applied cleared), and the next frame must put it back, whatever onChanged the panel set.
// Run: node tests/native-input-format-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const make = (menu) => {
  const b = S.boot(menu);
  const vm = require('vm');
  vm.runInContext("var dboProbeFmt = dboFmt(F_PLAIN, 18, C_TEXT, 0.5); var dboProbe = dboInput(_root, 'probe', 5, 10, 10, 300, 28, dboProbeFmt, 40, false); dboProbe.onChanged = function() { this.panelSaw = String(this.text); };", b.ctx);
  return { b, box: b.ctx.dboProbe, fmt: b.ctx.dboProbeFmt, keeper: b.root.probe_fmt };
};
const type = (box, text) => { box.text = text; box.applied = null; if (box.onChanged) box.onChanged(); };

for (const menu of ['dbo_board', 'dbo_housing', 'dbo_admin', 'dbo_bank']) {
  const { box, fmt, keeper } = make(menu);
  check(`${menu}: the box is made with the $Everywhere format, applied at once`, box.fmt === fmt && box.applied === fmt && /^\$Everywhere/.test(fmt.font) && fmt.color !== 0, { font: fmt.font, color: fmt.color });
  type(box, 'abcd');
  if (keeper && keeper.onEnterFrame) keeper.onEnterFrame();
  check(`${menu}: typed "abcd" carries the box's format again on the next frame`, box.applied === fmt && box.fmt === fmt, { applied: box.applied && box.applied.font });
  check(`${menu}: ...while the panel's own onChanged still runs`, box.panelSaw === 'abcd', box.panelSaw);
  box.applied = null;
  keeper.onEnterFrame();
  check(`${menu}: an unchanged box is left alone (no work every frame)`, box.applied === null);
  type(box, "Hjaalmarch's Jarl");
  keeper.onEnterFrame();
  check(`${menu}: and again after more typing`, box.applied === fmt);
  box.text = undefined;
  keeper.onEnterFrame();
  check(`${menu}: the keeper stops once its box is gone`, keeper.onEnterFrame === undefined);
}
T.done();
