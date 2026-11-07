// A native panel's second typed box must still take the keys (swf/lib/dbo.as dboInput). Players could type only the first
// box of a panel - rent but not deposit, a title but not the journal text (#bugs, 4-7 Nov): each box made a new
// dboTypeGuard at the same depth, which replaced the old one, and the old one's onUnload gave the keys back to the game
// (AllowTextInput(false)) straight after the new box took them. The stub fires onUnload on replace, as Flash does.
// Run: node tests/native-input-twice-harness.js
'use strict';
const S = require('./native-swf-stub');
const vm = require('vm');
const T = S.checker();
const check = T.check;
const typing = (b) => b.sent.filter((m) => m.e === 'allowTextInput').map((m) => m.on);

for (const menu of ['dbo_bank', 'dbo_housing', 'dbo_board', 'dbo_admin']) {
  const b = S.boot(menu);
  vm.runInContext("var f = dboFmt(F_PLAIN, 18, C_TEXT, 0.5); dboInput(_root, 'first', 5, 10, 10, 300, 28, f, 40, false);", b.ctx);
  check(`${menu}: the first box takes the keys`, typing(b).join() === 'true' && b.ctx.dboTyping === true, typing(b));
  vm.runInContext("dboInputEnd(); dboInput(_root, 'second', 6, 10, 50, 300, 28, f, 40, false);", b.ctx);
  const t = typing(b);
  check(`${menu}: after the first is done, the second box takes the keys and keeps them`, t[t.length - 1] === true && b.ctx.dboTyping === true, t);
  vm.runInContext("dboInput(_root, 'third', 7, 10, 90, 300, 28, f, 40, false);", b.ctx);
  const n = typing(b).filter((x) => x === true).length - typing(b).filter((x) => x === false).length;
  check(`${menu}: a redraw while typing takes no second count and gives none back (net count 1)`, n === 1 && b.ctx.dboTyping === true, typing(b));
  vm.runInContext("dboInputEnd();", b.ctx);
  const n2 = typing(b).filter((x) => x === true).length - typing(b).filter((x) => x === false).length;
  check(`${menu}: closing gives the keys back exactly once (net count 0)`, n2 === 0 && b.ctx.dboTyping === false, typing(b));
}
T.done();
