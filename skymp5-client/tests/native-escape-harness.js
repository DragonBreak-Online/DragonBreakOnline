// Escape closes every native panel (Nat, 1 Nov: "allow us to click the Esc key for closing out the F7 and F3 panels"). The
// game may keep Escape from the movie, so the client hands it to lib/dbo.as's _root.dboEscape, which runs the panel's own
// key handler: each scene of tests/native-render.js (every panel, F7's tabs and F3's journal among them) is opened on the
// stub stage and Escape is given that way until the panel closes or says it is leaving, at most four presses (a form, a
// typing box or an Ask backs out one layer first). One press seen by both the movie and the client counts once.
//   node tests/native-escape-harness.js
'use strict';
const vm = require('vm');
const S = require('./native-swf-stub');
const { SETUPS } = require('./native-render.js');
const T = S.checker();
const check = T.check;

const LEAVING = /(^|:)(close|cancel|leave)|Close$|Cancel$|^dbo:journalClose$/i;
const escape = (t) => vm.runInContext('_root.dboEscape()', t.ctx);
const swfs = new Set();
for (const [name, setup] of SETUPS) {
  const t = S.boot(setup.swf, false, {});
  setup.drive(t);
  t.st.time += 2000; t.tick();
  const before = t.msgs().length;
  let presses = 0, done = false;
  while (presses < 4 && !done) {
    t.st.time += 400;
    escape(t);
    presses++;
    const sent = t.msgs().slice(before).map((m) => m.key);
    done = t.closed() || sent.some((k) => LEAVING.test(k));
  }
  swfs.add(setup.swf);
  if (/^rite/.test(name)) {
    check(`${name}: Escape never ends a rite by itself (yielding forfeits it, so it asks and the Yield button decides)`, !done, t.msgs().slice(before).map((m) => m.key));
    continue;
  }
  // A rite does not end on Escape: yielding forfeits it, so Escape asks and a second press backs out of the question
  check(`${name}: Escape from the client closes it (${presses} press${presses === 1 ? '' : 'es'})`, done, t.msgs().slice(before).map((m) => m.key));
}
// Every other panel, opened with no payload yet (as in the moment before the server's answer): Escape closes it
const fs = require('fs');
const path = require('path');
const all = fs.readdirSync(path.join(__dirname, '../swf')).filter((d) => /^dbo_/.test(d) && fs.existsSync(path.join(__dirname, '../swf', d, 'scripts/frame_1/DoAction.as'))
  && /dboKeys\(keys\)/.test(fs.readFileSync(path.join(__dirname, '../swf', d, 'scripts/frame_1/DoAction.as'), 'utf8')));
for (const swf of all.filter((d) => !swfs.has(d))) {
  const t = S.boot(swf, false, {});
  t.st.time += 400;
  escape(t);
  check(`${swf} (no payload yet): Escape from the client closes it`, t.closed() || t.msgs().some((m) => LEAVING.test(m.key)), t.msgs().map((m) => m.key));
  swfs.add(swf);
}
check('every native panel has a scene here (F7 dbo_admin and F3 dbo_journal included)', swfs.has('dbo_admin') && swfs.has('dbo_journal') && swfs.size === all.length, all.filter((d) => !swfs.has(d)));

// One press seen twice: the movie's own key and the client's hand-off within the gap
const seen = (first, second, gapMs) => {
  const t = S.boot('dbo_context', false, {});
  t.push({ type: 'contextMenu', id: 10, targetName: 'Lydia', mode: 'menu', lines: [], actions: [{ id: 'trade', label: 'Trade' }], events: { action: 'pa:action', close: 'pa:close' } });
  const codes = [];
  vm.runInContext('dboKeys({ onKeyDown: function () { dboSeen.push(dboKey()); } })', Object.assign(t.ctx, { dboSeen: codes }));
  const go = (how) => (how === 'key' ? t.press(27) : escape(t));
  go(first); t.st.time += gapMs; go(second);
  return codes.filter((c) => c === 27).length;
};
check('the movie\'s Escape then the client\'s 100 ms later is one press', seen('key', 'client', 100) === 1, seen('key', 'client', 100));
check('the client\'s then the movie\'s 100 ms later is one press', seen('client', 'key', 100) === 1, seen('client', 'key', 100));
check('two presses 400 ms apart are two', seen('key', 'client', 400) === 2 && seen('client', 'client', 400) === 2, [seen('key', 'client', 400), seen('client', 'client', 400)]);
T.done();
