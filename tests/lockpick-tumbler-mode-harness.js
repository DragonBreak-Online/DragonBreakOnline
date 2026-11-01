// The tumbler lock for the native panel (Nat, 1 Nov; _work/lockpick-native-1031.md): every pin its own rise, a soft miss
// drops the set pins, a hard miss breaks the pick, the server's replay is the verdict, and the auto attempt is rolled here.
// Each mutant must fail at least one scenario.
//   node tests/lockpick-tumbler-mode-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'lockpick.js');
const SRC = fs.readFileSync(MODULE, 'utf8');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 300)}`); if (!c) fails++; };

const A = 0xff000001, DOOR = 0x0a0001, PICK = 0x0000000a;
const scenarios = (src, live) => {
  let bad = 0;
  const t = (c, what, got) => { if (!c) bad++; if (live) ok(c, what, got); };
  const file = path.join(path.dirname(MODULE), `.lockpick-tumbler-test-${process.pid}.js`);
  fs.writeFileSync(file, src);
  try {
    let mono = 1000000;
    globalThis.performance = { now: () => mono };
    const caps = new Set(['lockpickLocal', 'pickRound', 'lockpickTumbler']);
    const props = new Map();
    const set = (id, k, v) => props.set(id + '|' + k, v);
    const get = (id, k) => props.get(id + '|' + k);
    const mp = { get, set, getDescFromId: (id) => (id >>> 0).toString(16) };
    let widgets = []; const ui = {}; const audits = []; let opened = 0;
    const realRandom = Math.random;
    let roll = 0.5, drift = 0;
    Math.random = () => roll + (drift = (drift + 1e-7) % 1e-4);
    const load = (cfg) => {
      delete require.cache[require.resolve(file)];
      delete globalThis.__dboLockpickState; delete globalThis.__dboLockpickSpent; delete globalThis.__dboLockpickClosing; delete globalThis.__dboLockpickPaid;
      require(file)({ mp, log: () => {}, personal: () => {}, audit: (x) => audits.push(x), who: () => 'P', display: () => 'P',
        openWidget: (a, w) => { widgets.push(w); return true; }, closeWidget: () => true, onUi: (ev, fn) => { ui[ev] = fn; }, cfg, hasUiCap: (a, c) => caps.has(c) });
    };
    const picks = (n) => set(A, 'inventory', { entries: [{ baseId: PICK, count: n }] });
    const pickCount = () => ((get(A, 'inventory') || {}).entries || []).reduce((n, e) => n + (e.baseId === PICK ? e.count : 0), 0);
    set(A, 'pos', [0, 0, 0]); set(DOOR, 'pos', [100, 0, 0]);
    const last = () => widgets[widgets.length - 1];
    const begin = (level) => { widgets = []; globalThis.__dboLockpick.begin(A, { target: DOOR + level * 16 + (drift * 1e7 | 0), level, label: 'Chest', onSuccess: () => { opened++; } }); return last(); };
    // a try that lands in the middle of pin i's hang, one off by d ms past its window, the report itself
    const good = (w, i, at) => [i, at, at + w.rises[i] + Math.round(w.holds[i] / 2)];
    const late = (w, i, at, d) => [i, at, at + w.rises[i] + w.holds[i] + 70 + d];
    const report = (w, outcome, tries) => { mono += 60000; ui.lockpickResult(A, [w.nonce, outcome, JSON.stringify(tries), 0, 60000]); };

    load({ lockpick: { enabled: true } });
    picks(3);
    let w = begin(2);
    t(w.mode === 'tumbler' && Array.isArray(w.rises) && w.rises.length === 3 && w.snaps === undefined && w.softMs > 0 && w.auto > 0,
      'a client naming lockpickTumbler gets a tumbler lock: a rise per pin, a soft band, the auto chance, and no snap list', w);
    t(w.rises.every((r) => r >= 250) && w.holds.every((h) => h >= 150), 'no rise under 250 ms and no hang under 150 ms (30 fps in the menu)', [w.rises, w.holds]);
    report(w, 'win', [good(w, 0, 0), good(w, 1, 2000), good(w, 2, 4000)]);
    t(opened === 1 && pickCount() === 3 && last().noticeKind === 'win', 'three pins set in their hang open the lock, no pick lost', [opened, pickCount(), last().noticeKind]);

    w = begin(2);
    report(w, 'win', [good(w, 0, 0), late(w, 1, 2000, 40), good(w, 0, 4000), good(w, 1, 6000), good(w, 2, 8000)]);
    t(opened === 2 && pickCount() === 3, 'a soft miss (40 ms late) drops the set pins and costs no pick', [opened, pickCount()]);

    w = begin(2);
    report(w, 'win', [good(w, 0, 0), late(w, 1, 2000, 400), good(w, 0, 4000), good(w, 1, 6000), good(w, 2, 8000)]);
    t(opened === 3 && pickCount() === 2, 'a hard miss (400 ms late) breaks one pick and drops the set pins', [opened, pickCount()]);

    w = begin(2);
    audits.length = 0;
    report(w, 'win', [good(w, 0, 0), good(w, 1, 2000)]);
    t(opened === 3 && audits.some((x) => /LOCKPICK-MISMATCH .*claimed win, the tries add up to cancel/.test(x)), 'a claimed win the tries do not add up to opens nothing and is audited', audits);

    w = begin(2);
    report(w, 'cancel', [good(w, 0, 0), good(w, 1, 2000), good(w, 2, 4000)]);
    t(opened === 4, 'tries that add up to a win open the lock even when the report says cancel: the replay decides', opened);
    opened--;

    w = begin(2);
    audits.length = 0;
    const lie = late(w, 0, 0, 400); lie.push(1);
    report(w, 'cancel', [lie]);
    t(pickCount() === 1 && audits.some((x) => /LOCKPICK-MISMATCH .*1 try/.test(x)), 'a hard miss claimed as landed still breaks the pick, and is audited', [pickCount(), audits]);

    picks(1);
    w = begin(2);
    report(w, 'fail', [late(w, 0, 0, 400)]);
    t(pickCount() === 0 && opened === 3 && last().noticeKind === 'fail', 'a hard miss with the last pick fails the lock', [pickCount(), last().noticeKind]);

    picks(3);
    w = begin(0);
    roll = 0.1;
    ui.lockpickAuto(A, [w.nonce, '[]', 0, 10]);
    t(opened === 4 && pickCount() === 3, 'an auto attempt under its chance (25% on a Novice lock untrained) opens the lock', [opened, pickCount()]);
    roll = 0.5;
    w = begin(4);
    const before = w.nonce;
    roll = 0.9;
    ui.lockpickAuto(A, [w.nonce, '[]', 0, 10]);
    roll = 0.5;
    t(opened === 4 && pickCount() === 2 && last().nonce !== before && last().mode === 'tumbler' && last().noticeKind === 'snap',
      'a lost auto attempt breaks one pick and deals a fresh lock', [opened, pickCount(), last().nonce !== before, last().noticeKind]);
    picks(1);
    w = begin(4);
    roll = 0.9;
    ui.lockpickAuto(A, [w.nonce, '[]', 0, 10]);
    roll = 0.5;
    t(pickCount() === 0 && last().noticeKind === 'fail', 'a lost auto attempt on the last pick ends the lock', [pickCount(), last().noticeKind]);
    picks(3);
    w = begin(1);
    roll = 0.01;
    ui.lockpickAuto(A, [w.nonce, JSON.stringify([late(w, 0, 0, 400)]), 0, 10]);
    roll = 0.5;
    t(pickCount() === 2 && opened === 5, 'the hand tries before an auto attempt are judged first: their broken pick is taken', [pickCount(), opened]);

    w = begin(3);
    audits.length = 0;
    report(w, 'win', [good(w, 0, 0), good(w, 1, 2000), good(w, 2, 4000), good(w, 3, 6000)]);
    t(opened === 6 && audits.some((x) => /^LOCKPICK-PERFECT /.test(x)), 'an Expert lock won with no miss is audited for review', audits);

    globalThis.__dboBirthsignSnapMult = () => 0.75;
    const plain = (() => { delete globalThis.__dboBirthsignSnapMult; return begin(2).softMs; })();
    globalThis.__dboBirthsignSnapMult = () => 0.75;
    const tower = begin(2).softMs;
    delete globalThis.__dboBirthsignSnapMult;
    t(tower === Math.round(plain * 1.25), 'the Tower widens the soft band by a quarter', [plain, tower]);

    caps.delete('lockpickTumbler');
    w = begin(2);
    t(w.mode === 'pick' && w.rises === undefined, 'without the tumbler cap the pick round is unchanged', w.mode);
    caps.add('lockpickTumbler');
    load({ lockpick: { enabled: true, tumbler: { enabled: false } } });
    picks(3);
    w = begin(2);
    t(w.mode === 'pick', 'tumbler.enabled false falls back to the pick round', w.mode);
    Math.random = realRandom;
  } catch (e) { bad++; if (live) ok(false, 'scenarios ran', e.stack); }
  finally { try { fs.unlinkSync(file); } catch (e) { /* gone */ } }
  return bad;
};
ok(scenarios(SRC, true) === 0, 'all scenarios pass on the live code');

const MUTANTS = [
  ['a soft miss breaks the pick', 'if (held >= lo - L.softMs && held <= hi + L.softMs) r.soft++;', 'if (false) r.soft++;'],
  ['the report\'s claim is trusted', '      outcome = r.outcome;\n', '\n'],
  ['a lost auto attempt costs nothing', "    takePick(a);\n    verdictLine(L, 'fail', ` judge=server auto", "    verdictLine(L, 'fail', ` judge=server auto"],
  ['the snap list is still sent', '      delete w.snaps;\n', ''],
  ['the hand tries before an auto attempt are not judged', '    for (let k = 0; k < (r.snapped || 0); k++) takePick(a);\n', ''],
  ['the Tower does nothing', ' * (2 - signSnap(a)));', ');'],
];
for (const [name, a, b] of MUTANTS) {
  if (!SRC.includes(a)) { ok(false, `mutant "${name}": its line is in the code`, a); continue; }
  ok(scenarios(SRC.replace(a, b), false) > 0, `mutant caught: ${name}`);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
