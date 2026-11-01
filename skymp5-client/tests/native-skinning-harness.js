// Skinning as a native panel (swf/dbo_skinning, a port of skymp5-front features/skinning) on the stub stage: the blade
// round and the pick round, the report the server reads, Escape and the Close after the verdict. With a server checkout
// the panel's blade arithmetic is compared with gamemode.js's bladeAt/bladeOff on 2,000 random cases. Each mutant must fail.
//   node tests/native-skinning-harness.js [server dir]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const SERVER = process.argv[2] ? path.resolve(process.argv[2]) : null;
const SRC_FILE = path.resolve(__dirname, '..', 'swf/dbo_skinning/scripts/frame_1/DoAction.as');
const SRC = fs.readFileSync(SRC_FILE, 'utf8');

const blade = (extra) => Object.assign({ type: 'skinning', id: 33, nonce: 's1', name: 'Wolf', cuts: 2, misses: 1, seam: 0.2, seams: [0.5, 0.25], sweepMs: 1000, reachMs: 0, totalMs: 15000, judge: 'client' }, extra || {});
const pickRound = (extra) => Object.assign({ type: 'skinning', id: 33, nonce: 'p1', name: 'Fox', mode: 'pick', cuts: 2, misses: 1, totalMs: 60000, minPickMs: 150, judge: 'client',
  steps: [[[20, 50, 0.3], [60, 50, 0.9], [80, 50, 0.4]], [[30, 50, 0.95], [50, 50, 0.2]]] }, extra || {});
const at = (t, ms) => { t.st.time = 1000 + ms; t.tick(); };
// the blade is on seam s (0..1) at ms s * sweep on its first pass
const onSeam = (s, sweep) => Math.round(s * sweep);
const reports = (t) => t.msgs().filter((m) => m.key === 'dbo:skinning');

const run = (src, live) => {
  let bad = 0;
  const c = (ok, what, got) => { if (!ok) bad++; if (live) check(what, ok, got); };
  const real = fs.readFileSync(SRC_FILE, 'utf8');
  fs.writeFileSync(SRC_FILE, src);
  try {
    let t = S.boot('dbo_skinning'); t.st.time = 1000;
    t.push(blade());
    c(/Two clean cuts free the pelt; the hide will bear one slip\./.test(t.root.dboPanel.lineTf.text), 'the opening line is the browser\'s', t.root.dboPanel.lineTf.text);
    at(t, onSeam(0.5, 1000)); t.press(32);
    c(/A clean line\. One more clean cut\./.test(t.root.dboPanel.lineTf.text), 'a cut on the seam is clean', t.root.dboPanel.lineTf.text);
    at(t, 2000 + onSeam(0.9, 1000)); t.press(32);
    c(/The blade snags\. One more slip will tear it\./.test(t.root.dboPanel.lineTf.text), 'a cut off the seam is a slip', t.root.dboPanel.lineTf.text);
    at(t, 4000 + onSeam(0.25, 1000)); t.press(32);
    const r = reports(t);
    const audit = r.length ? JSON.parse(r[0].args[3]) : {};
    c(r.length === 1 && r[0].args[0] === 's1' && JSON.stringify(JSON.parse(r[0].args[1])) === JSON.stringify([500, 2900, 4250]) && audit.v === 2 && audit.win === true && audit.hits === 2 && audit.slips === 1,
      'the second clean cut reports the round once: the cut times on the round\'s clock and the v2 verdict', r.length ? r[0].args : r);
    c(/The hide comes away clean\./.test(t.root.dboPanel.lineTf.text), 'the client-judged verdict shows at once');
    t.push(blade({ result: 'You take a fine wolf pelt.', resultKind: 'win' }));
    c(/fine wolf pelt/.test(t.root.dboPanel.lineTf.text) && t.root.dboPanel.acts.close, 'the server\'s verdict shows, with a Close button');
    t.press(13);
    c(t.closed() && !t.msgs().some((m) => m.key === 'dbo:skinningCancel'), 'Enter closes a finished round without a cancel');

    t = S.boot('dbo_skinning'); t.st.time = 1000; t.push(blade({ nonce: 's2' }));
    at(t, onSeam(0.9, 1000)); t.press(32); at(t, 2000 + onSeam(0.9, 1000)); t.press(32);
    const tr = reports(t);
    c(tr.length === 1 && JSON.parse(tr[0].args[3]).win === false && /the hide tears/.test(t.root.dboPanel.lineTf.text), 'one slip more than allowed tears the hide', tr.length ? tr[0].args : tr);

    t = S.boot('dbo_skinning'); t.st.time = 1000; t.push(blade({ nonce: 's3' }));
    at(t, 15001);
    c(reports(t).length === 1 && JSON.parse(reports(t)[0].args[1]).length === 0, 'the time running out reports the round');

    t = S.boot('dbo_skinning'); t.st.time = 1000; t.push(pickRound());
    at(t, 400); t.press(50); at(t, 800); t.press(49);
    const pr = reports(t);
    c(pr.length === 1 && JSON.stringify(JSON.parse(pr[0].args[1])) === JSON.stringify([[1, 400], [0, 800]]) && JSON.parse(pr[0].args[3]).mode === 'pick' && JSON.parse(pr[0].args[3]).win === true && JSON.parse(pr[0].args[3]).hits === 2,
      'a pick round: the clearest point each time, reported as [index, ms]', pr.length ? pr[0].args : pr);
    t = S.boot('dbo_skinning'); t.st.time = 1000; t.push(pickRound({ nonce: 'p2' }));
    at(t, 100); t.press(50);
    c(reports(t).length === 0 && t.root.dboPanel.hide.spot0 !== undefined, 'a pick before the points have shown (the lock) is ignored');

    t = S.boot('dbo_skinning'); t.st.time = 1000; t.push(blade({ nonce: 's4' }));
    t.press(27);
    c(t.msgs().some((m) => m.key === 'dbo:skinningCancel' && m.args[0] === 's4') && t.closed() && reports(t).length === 0, 'Escape stops it: a cancel, the panel closes, and no report follows');
    t = S.boot('dbo_skinning'); t.st.time = 1000; t.push(blade({ nonce: 's5' }));
    vm.runInContext('_root.dboEscape()', t.ctx);
    c(t.msgs().some((m) => m.key === 'dbo:skinningCancel') && t.closed(), 'and through the client\'s Escape too');

    if (SERVER) {
      const GM = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');
      const lift = (name) => { const i = GM.indexOf(`const ${name} = `); const j = GM.indexOf('\n};\n', i); const k = GM.indexOf('\n', i); return GM.slice(i, name === 'bladeAt' ? k : j + 3); };
      const srv = new Function(`${lift('bladeAt')}\n${lift('bladeOff')}\nreturn { bladeAt, bladeOff };`)();
      const p = S.boot('dbo_skinning');
      let rnd = 7; const rand = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648; };
      let diff = 0;
      for (let k = 0; k < 2000; k++) {
        const ms = Math.floor(rand() * 40000), sw = 400 + Math.floor(rand() * 2000), reach = Math.floor(rand() * 400), seam = rand();
        const mine = vm.runInContext(`bladeOff(${ms}, ${sw}, ${reach}, ${seam})`, p.ctx), theirs = srv.bladeOff(ms, { sweepMs: sw, reachMs: reach }, seam);
        if (Math.abs(mine - theirs) > 1e-12) diff++;
      }
      c(diff === 0, 'the blade is the server\'s: bladeOff agrees with gamemode.js on 2,000 random cases', diff);
    }
  } catch (e) { bad++; if (live) check('scenarios ran', false, e.stack); }
  finally { fs.writeFileSync(SRC_FILE, real); }
  return bad;
};
check('every scenario passes on the panel as written', run(SRC, true) === 0);

const MUTANTS = [
  ['the reach window is ignored', '   for (var s = Math.max(0, t - reach); s < t; s++)', '   for (var s = t; s < t; s++)'],
  ['the faintest point is the right one', '      if (Number(spots[i][2]) > Number(spots[best][2]))', '      if (Number(spots[i][2]) < Number(spots[best][2]))'],
  ['Escape sends no cancel', '      dboSend("dbo:skinningCancel", [nonce]);\n', '\n'],
  ['one slip too many does not tear', '   return misses > allowed;', '   return misses > allowed + 1;'],
];
for (const [name, a, b] of MUTANTS) {
  if (!SRC.includes(a)) { check(`mutant "${name}": its line is in the panel`, false, a); continue; }
  check(`mutant caught: ${name}`, run(SRC.replace(a, b), false) > 0);
}
T.done();
