// The native tumbler lock (swf/dbo_lockpick) on the stub stage: pins rise, hang and fall on the panel's clock, a set in
// the hang catches, a soft miss drops the pins, a hard one snaps a pick, and the report goes out once. With a server
// checkout it also plays locks against the real lockpick.js, whose replay must agree with what the panel showed.
// Each mutant must fail.
//   node tests/native-lockpick-harness.js [server dir]
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const SERVER = process.argv[2] ? path.resolve(process.argv[2]) : null;
const SRC_FILE = path.resolve(__dirname, '..', 'swf/dbo_lockpick/scripts/frame_1/DoAction.as');
const SRC = fs.readFileSync(SRC_FILE, 'utf8');

const lock = (extra) => Object.assign({ type: 'lockpick', id: 46, nonce: 'k1', title: 'Chest (Adept lock)', level: 'Adept', riseMs: 450, fallMs: 650,
  holds: [380, 380, 380], set: [false, false, false], picks: 2, notice: '', noticeKind: '', done: false, judge: 'client', graceMs: 70, maxTries: 200,
  mode: 'tumbler', rises: [440, 460, 420], softMs: 80, auto: 0.08 }, extra || {});
const sends = (t, key) => t.msgs().filter((m) => m.key === key);
const at = (t, ms) => { t.st.time = 1000 + ms; t.tick(); };
const W = 87, SPACE = 32, A = 65, ESC = 27, ENTER = 13;
// pushes pin then sets it d ms after the push
const tryPin = (t, start, d) => { at(t, start); t.press(W); at(t, start + d); t.press(SPACE); };

const run = (src, live) => {
  let bad = 0;
  const c = (ok, what, got) => { if (!ok) bad++; if (live) check(what, ok, got); };
  const real = fs.readFileSync(SRC_FILE, 'utf8');
  fs.writeFileSync(SRC_FILE, src);
  try {
    let t = S.boot('dbo_lockpick');
    t.st.time = 1000;
    t.push(lock());
    const L = t.root.dboPanel.lock;
    c(L && L.pin0 && L.pin2 && !L.pin3, 'three pins drawn for an Adept lock');
    c(/Pins set 0 of 3 +Lockpicks 2 +Auto attempt 8%/.test(t.root.dboPanel.tallyTf.text), 'the tally: pins, picks, the auto chance', t.root.dboPanel.tallyTf.text);
    at(t, 100); t.press(W); at(t, 320);
    const y = t.root.dboPanel.lock.pin0.body._y;
    c(y < 110 && y > 40, 'a pushed pin rises on the panel clock', y);
    at(t, 100 + 440 + 190); t.press(SPACE);
    c(/catches/.test(t.root.dboPanel.lineTf.text) && /Pins set 1 of 3/.test(t.root.dboPanel.tallyTf.text), 'a set in the hang catches the pin', t.root.dboPanel.lineTf.text);
    tryPin(t, 2000, 460 + 380 + 70 + 40);
    c(/Too late/.test(t.root.dboPanel.lineTf.text) && /Pins set 0 of 3 +Lockpicks 2/.test(t.root.dboPanel.tallyTf.text), 'a set 40 ms late drops the pins and keeps the pick', [t.root.dboPanel.lineTf.text, t.root.dboPanel.tallyTf.text]);
    tryPin(t, 4000, 440 + 380 + 70 + 80 + 200);
    c(/snaps/.test(t.root.dboPanel.lineTf.text) && /Lockpicks 1/.test(t.root.dboPanel.tallyTf.text), 'a set far off snaps a pick', [t.root.dboPanel.lineTf.text, t.root.dboPanel.tallyTf.text]);
    c(sends(t, 'dbo:lockpickResult').length === 0, 'nothing is reported while the lock is in play');
    tryPin(t, 6000, 440 + 190); tryPin(t, 8000, 460 + 190); tryPin(t, 10000, 420 + 190);
    const r = sends(t, 'dbo:lockpickResult');
    const tries = r.length ? JSON.parse(r[0].args[2]) : [];
    c(r.length === 1 && r[0].args[0] === 'k1' && r[0].args[1] === 'win' && tries.length === 6 && tries[1][3] === 0 && tries[5][3] === 1,
      'the last pin reports the whole lock once: win, every try with its push, set and landed', r.length ? r[0].args : r);
    t.push(lock({ notice: 'The Adept lock gives way.', noticeKind: 'win', done: true }));
    c(/gives way/.test(t.root.dboPanel.lineTf.text) && t.root.dboPanel.acts.close, 'the server\'s verdict shows, with a Close button');
    t.press(ENTER);
    c(t.closed(), 'Enter closes a finished lock');

    t = S.boot('dbo_lockpick'); t.st.time = 1000; t.push(lock({ picks: 1 }));
    tryPin(t, 100, 1200);
    const f = sends(t, 'dbo:lockpickResult');
    c(f.length === 1 && f[0].args[1] === 'fail', 'a snapped last pick reports the lock failed', f.length ? f[0].args : f);

    t = S.boot('dbo_lockpick'); t.st.time = 1000; t.push(lock());
    at(t, 100); t.press(W); at(t, 100 + 440 + 380 + 700);
    c(t.root.dboPanel.acts.push.disabled !== true, 'a pin left to fall back can be pushed again');
    tryPin(t, 3000, 440 + 190);
    t.press(A);
    const au = sends(t, 'dbo:lockpickAuto');
    c(au.length === 1 && JSON.parse(au[0].args[1]).length === 1 && t.root.dboPanel.acts.push.disabled === true, 'A asks for an auto attempt with the tries so far, and the hands wait', au.length ? au[0].args : au);
    t.push(lock({ nonce: 'k2', notice: 'The pick snaps. The tumblers fall back.', noticeKind: 'snap', picks: 1 }));
    c(t.root.dboPanel.acts.push.disabled !== true && /Pins set 0 of 3 +Lockpicks 1/.test(t.root.dboPanel.tallyTf.text), 'a lost auto attempt\'s fresh lock starts afresh', t.root.dboPanel.tallyTf.text);

    t = S.boot('dbo_lockpick'); t.st.time = 1000; t.push(lock());
    tryPin(t, 100, 1200);
    t.press(ESC);
    const lv = sends(t, 'dbo:lockpickResult');
    c(lv.length === 1 && lv[0].args[1] === 'cancel' && JSON.parse(lv[0].args[2]).length === 1 && t.closed(), 'Escape reports the tries so far as a cancel (its snapped pick is taken) and closes', lv.length ? lv[0].args : lv);

    t = S.boot('dbo_lockpick'); t.st.time = 1000; t.push(lock({ mode: 'pick' }));
    c(t.logs.some((m) => /unreadable/.test(m)) && t.root.dboPanel.lock === undefined, 'a lock that is not a tumbler lock is refused, not drawn');

    if (SERVER) {
      // The real server module: its lock goes to the panel, the panel's report back to it
      const mod = path.join(SERVER, 'lockpick.js');
      let mono = 1e6; globalThis.performance = { now: () => mono };
      const props = new Map(); const get = (id, k) => props.get(id + '|' + k); const setp = (id, k, v) => props.set(id + '|' + k, v);
      const ui = {}; let widget = null; let opened = 0; const audits = [];
      delete require.cache[require.resolve(mod)];
      delete globalThis.__dboLockpickState; delete globalThis.__dboLockpickSpent; delete globalThis.__dboLockpickClosing; delete globalThis.__dboLockpickPaid;
      require(mod)({ mp: { get, set: setp, getDescFromId: (id) => (id >>> 0).toString(16) }, log: () => {}, personal: () => {}, audit: (x) => audits.push(x), who: () => 'P', display: () => 'P',
        openWidget: (a, w) => { widget = w; return true; }, closeWidget: () => true, onUi: (ev, fn) => { ui[ev] = fn; }, cfg: { lockpick: { enabled: true } },
        hasUiCap: (a, cap) => ['lockpickLocal', 'pickRound', 'native:lockpick'].includes(cap) });
      const P = 0xff000001;
      setp(P, 'pos', [0, 0, 0]); setp(0xa0001, 'pos', [50, 0, 0]);
      const play = (level, plan) => {
        setp(P, 'inventory', { entries: [{ baseId: 0xa, count: 3 }] });
        globalThis.__dboLockpick.begin(P, { target: 0xa0001 + level, level, label: 'Chest', onSuccess: () => { opened++; } });
        const w = widget;
        const pt = S.boot('dbo_lockpick'); pt.st.time = 1000; pt.push(w);
        let start = 100;
        for (const d of plan(w)) { tryPin(pt, start, d); start += 3000; }
        const rep = sends(pt, 'dbo:lockpickResult');
        if (!rep.length) { pt.press(ESC); }
        const out = sends(pt, 'dbo:lockpickResult')[0];
        mono += 120000;
        ui.lockpickResult(P, out.args);
        return { said: out.args[1], picks: (get(P, 'inventory').entries[0] || { count: 0 }).count };
      };
      const before = opened;
      let g = play(2, (w) => w.rises.map((r, i) => r + Math.round(w.holds[i] / 2)));
      c(g.said === 'win' && opened === before + 1 && g.picks === 3, 'against the server: a clean lock is a win on both sides', g);
      g = play(3, (w) => [w.rises[0] + w.holds[0] + 70 + 30, w.rises[0] + 100, w.rises[1] + 100, w.rises[2] + 100, w.rises[3] + 100]);
      c(g.said === 'win' && opened === before + 2 && g.picks === 3, 'against the server: a soft miss costs no pick on either side', g);
      g = play(1, (w) => [w.rises[0] + w.holds[0] + 70 + w.softMs + 200]);
      c(g.said === 'cancel' && opened === before + 2 && g.picks === 2, 'against the server: a hard miss takes the pick the panel showed snapping', g);
      c(!audits.some((x) => /MISMATCH/.test(x)), 'the server never disagrees with the panel', audits.filter((x) => /MISMATCH/.test(x)));
    }
  } catch (e) { bad++; if (live) check('scenarios ran', false, e.stack); }
  finally { fs.writeFileSync(SRC_FILE, real); }
  return bad;
};
check('every scenario passes on the panel as written', run(SRC, true) === 0);

const MUTANTS = [
  ['the soft band counts as a set', '   if (held >= lo && held <= hi)\n', '   if (held >= lo - softMs && held <= hi + softMs)\n'],
  ['a miss leaves the pins standing', '   else if (how == "soft")\n   {\n      dropAll();', '   else if (how == "soft")\n   {\n'],
  ['leaving drops the tries', '      submit("cancel");\n', '\n'],
  ['the hands keep working during an auto attempt', '   waiting = true;\n', ''],
];
for (const [name, a, b] of MUTANTS) {
  if (!SRC.includes(a)) { check(`mutant "${name}": its line is in the panel`, false, a); continue; }
  check(`mutant caught: ${name}`, run(SRC.replace(a, b), false) > 0);
}
T.done();
