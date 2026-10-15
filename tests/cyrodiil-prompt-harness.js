// The start prompt after the deity step (gamemode.js "where a new character starts"): with Skyrim open a finished
// character is asked, Yes goes to the Pale Pass arrival, No / Close / no answer stay in the Realm; with Skyrim closed
// nothing is asked. Runs the block from gamemode.js against stubs.   node tests/cyrodiil-prompt-harness.js
'use strict';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const a0 = src.indexOf('// ---- where a new character starts'), a1 = src.indexOf("onUi('startClose'");
const block = src.slice(a0, src.indexOf('\n', a1) + 1);
let fails = 0; const ok = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${w}`); if (!c) fails++; };
function run(playtest, answer) {
  const ev = new Map(), sent = [], logs = [], timers = [];
  const env = {
    cfg: { playtest }, creation: new Map([[7, 'hub']]), mp: { get: (a, k) => (k === 'isOnline' ? true : undefined) },
    creationPending: () => false, inHub: () => true, leftRealm: () => sent.push('leftRealm'),
    sendToArrival: (a) => { sent.push('arrival'); env.creation.delete(a); },
    creatorSpotRelease: () => {}, setCreatorHidden: () => {}, setFade: () => {}, display: () => 'P', system: (a, t) => sent.push('system'),
    log: (t) => logs.push(t), openWidget: (a, w) => sent.push('open:' + w.id), closeWidget: (a, id) => sent.push('close:' + id),
    onUi: (e, f) => ev.set(e, f), setTimeout: (f, ms) => timers.push(f),
  };
  globalThis.__dboStartPending = undefined;
  const fn = new Function(...Object.keys(env), block + '\nreturn leaveRealm;');
  const leave = fn(...Object.values(env));
  leave(7);
  if (answer === 'yes') ev.get('startChoose')(7, ['cyrodiil']);
  if (answer === 'no') ev.get('startChoose')(7, ['skyrim']);
  if (answer === 'close') ev.get('startClose')(7);
  if (answer === 'timeout') timers.forEach((f) => f());
  leave(7); // the deity step's 5-minute fallback after an answer must not ask again
  return { sent, creation: env.creation, logs };
}
const open = { enabled: true, gatesToArrival: false };
let r = run(open, 'yes');   ok(r.sent[0] === 'open:86' && r.sent.includes('arrival') && r.sent.filter((s) => s === 'open:86').length === 1, 'Skyrim open, Yes: asked once, sent to the Pale Pass');
r = run(open, 'no');        ok(r.sent.includes('open:86') && !r.sent.includes('arrival') && !r.creation.has(7), 'No: stays in the Realm, creation ended');
r = run(open, 'close');     ok(!r.sent.includes('arrival') && !r.creation.has(7), 'Close: stays in the Realm');
r = run(open, 'timeout');   ok(!r.sent.includes('arrival') && !r.creation.has(7), 'no answer: stays in the Realm');
r = run({ enabled: true }, 'none'); ok(!r.sent.includes('open:86') && r.sent[0] === 'arrival', 'Skyrim closed (gates to the arrival): not asked, sent to the arrival');
r = run(Object.assign({ askCyrodiil: false }, open), 'none'); ok(!r.sent.includes('open:86') && r.sent[0] === 'arrival', 'askCyrodiil false: not asked');
// Every way out of creation asks: the deity step, its timeout, and a name given at last (naming.js __dboNamed)
ok(/__dboNamed = \(a\) => \{ if \(inHubForName\(a\)\) leaveRealm\(a\); \}/.test(src), 'a character named at last leaves the Realm through the same question');
ok(!/setTimeout\(\(\) => sendToArrival\(a\), (wait|DEITY_STEP_MAX_MS)\)/.test(src), 'the deity step and its timeout no longer send straight to the arrival');
// The answers are worded as Nat asked (14 Oct): Cyrodiil is the Pale Pass, Skyrim is a hold gate
ok(/Cyrodiil or Skyrim\?/.test(block) && /Pale Pass/.test(block) && /gate of a hold/.test(block), 'the question names both lands and where each answer leads');
console.log(fails ? `${fails} failure(s)` : 'all checks passed'); process.exit(fails ? 1 : 0);
