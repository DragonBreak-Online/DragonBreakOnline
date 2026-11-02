// The native HUD's prompts answered with Y and N (src/services/services/nativePrompt.ts, swf/dbo_hud; Nat, 1 Nov): which
// key answers what and when, the packets each answer sends (checked against the front's own buttons), the hand-back to the
// browser, and dbo_hud drawing the card. The mutants at the end are compiled from altered copies of nativePrompt.ts and
// must each fail a check.
//   node tests/native-prompt-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('./native-swf-stub');
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'services', 'services', 'nativePrompt.ts');

const compile = (source, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  const ts = path.join(dir, 'nativePrompt.ts');
  fs.writeFileSync(ts, source);
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), ts, '--outDir', dir, '--module', 'commonjs', '--target', 'es2019'], { stdio: 'pipe' });
  const js = path.join(dir, 'nativePrompt.js');
  delete require.cache[js];
  return require(js);
};
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-nativeprompt-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* the OS */ } });
const front = (f) => fs.readFileSync(path.join(ROOT, '..', 'skymp5-front', 'src', 'features', f, 'index.tsx'), 'utf8').replace(/\r\n/g, '\n');

// Every decision check, against a compiled module P; check(what, ok, got) records
const decisions = (P, check) => {
  const Y = 0x15, N = 0x31, T0 = 100000;
  check('the keys are Y (0x15) and N (0x31)', P.KEY_YES === Y && P.KEY_NO === N, [P.KEY_YES, P.KEY_NO]);
  P.hudPrompt.current = null;
  check('no prompt: neither key answers anything', P.pressKey(Y, T0) === false && P.pressKey(N, T0) === false);
  const got = [];
  P.showPrompt(P.tradePrompt(15, 'Aela', 65), (yes) => got.push(yes), T0);
  check('another key answers nothing', P.pressKey(0x1e, T0) === false && got.length === 0);
  check('Y accepts', P.pressKey(Y, T0 + 500) === true && JSON.stringify(got) === '[true]', got);
  check('...once: a second press, Y or N, does nothing', P.pressKey(Y, T0 + 600) === false && P.pressKey(N, T0 + 700) === false && got.length === 1, got);
  P.showPrompt(P.consentPrompt(12, 'Restraint Request', 'Bind your hands?', 20), (yes) => got.push(yes), T0);
  check('N refuses', P.pressKey(N, T0) === true && got[1] === false, got);
  // downed: Give up only, locked for its first seconds
  const sp = P.serverPrompt({ type: 'downed', id: 70, nonce: 'd1', seconds: 60, giveUpIn: 30 });
  const sent = [];
  P.showPrompt(sp.spec, (yes) => sent.push(yes ? sp.yes : sp.no), T0);
  check('downed: Y does nothing while Give up is locked', P.pressKey(Y, T0 + 29000) === false && !sent.length);
  check('downed: N does nothing (no second answer)', P.pressKey(N, T0 + 31000) === false && !sent.length);
  check('downed: Y gives up once the lock has run', P.pressKey(Y, T0 + 30001) === true && JSON.stringify(sent) === JSON.stringify([{ event: 'downedGiveUp', args: ['d1'] }]), sent);
  // what the card shows
  P.showPrompt(sp.spec, () => {}, T0);
  let v = P.promptView(P.hudPrompt.current, T0 + 4000);
  check('the card: the lock counted on the Y line, no N line, the time left', v.yes === 'Y  Give up (26)' && v.no === '' && v.left === 56 && Math.abs(v.frac - 56 / 60) < 0.001 && /^56 s\./.test(v.idle), v);
  P.showPrompt(P.tradePrompt(15, '  ', 65), () => {}, T0);
  v = P.promptView(P.hudPrompt.current, T0);
  check('a trade request from a nameless player: Someone, Y Accept, N Decline', v.title === 'Someone' && v.yes === 'Y  Accept' && v.no === 'N  Decline' && v.kicker === 'Trade request', v);
  P.pressKey(Y, T0);
  check('answered: the card says so', P.promptView(P.hudPrompt.current, T0).answered === true && P.promptView(P.hudPrompt.current, T0).idle === 'Answered.');
  check('no prompt, no card', P.promptView(null, T0) === null);
  // the owners' close and the hand-back
  P.showPrompt(P.tradePrompt(15, 'Bo', 65), () => {}, T0);
  P.clearPrompt(12);
  check('closing another id leaves the prompt up', !!P.hudPrompt.current && P.hudPrompt.current.id === 15);
  P.clearPrompt(15);
  check('its owner\'s close takes it down', P.hudPrompt.current === null);
  let back = 0;
  P.showPrompt(P.tradePrompt(15, 'Bo', 65), () => {}, T0, () => back++);
  P.handBack();
  check('the HUD going down hands an unanswered prompt back to its browser panel', back === 1 && P.hudPrompt.current === null);
  P.showPrompt(P.tradePrompt(15, 'Bo', 65), () => {}, T0, () => back++);
  P.pressKey(Y, T0);
  P.handBack();
  check('...but not one already answered', back === 1);
  // the server's prompts: the front's own packets
  const feed = P.serverPrompt({ type: 'feedPrompt', id: 71, nonce: 'f1', vampire: 'Serana', seconds: 20, deep: true, infectPercent: 10 });
  check('feeding: Y offers the neck (submit), N resists, as the front\'s two buttons send',
    JSON.stringify(feed.yes) === JSON.stringify({ event: 'feedAnswer', args: ['f1', 'submit'] }) && JSON.stringify(feed.no) === JSON.stringify({ event: 'feedAnswer', args: ['f1', 'resist'] })
    && /Serana wants to drink/.test(feed.spec.title) && /deeply/.test(feed.spec.text) && /\(10%\)/.test(feed.spec.text), feed);
  const rob = P.serverPrompt({ type: 'robPrompt', id: 72, nonce: 'r1', robber: 'Vex', seconds: 20, goldShare: 0.2, parcels: 1 });
  check('robbery: Y accepts being robbed, N fights', JSON.stringify(rob.yes) === JSON.stringify({ event: 'robAnswer', args: ['r1', 'accept'] }) && JSON.stringify(rob.no) === JSON.stringify({ event: 'robAnswer', args: ['r1', 'fight'] })
    && /20%/.test(rob.spec.text) && /parcel/.test(rob.spec.text), rob);
  check('a widget without a nonce or of another type is not a prompt', P.serverPrompt({ type: 'feedPrompt', id: 71 }) === null && P.serverPrompt({ type: 'bank', id: 48, nonce: 'x' }) === null);
  // a choice menu sent without focus (charlevel's level-up offer): a card with no clock, Y Choose, N Not now
  const lv = { type: 'contextMenu', id: 120, mode: 'menu', targetName: 'Level 5: 2 points to spend', actions: [{ id: 'health', label: '+10 Health (now +0)' }, { id: 'stamina', label: '+10 Stamina (now +10)' }],
    events: { action: 'dbo:levelChoose', close: 'dbo:levelClose' } };
  const card = P.menuCard(lv);
  check('menuCard: the offer as a card, its choices listed, Y Choose and N Not now, no clock', card && card.title === 'Level 5: 2 points to spend' && /\+10 Health/.test(card.text) && /\+10 Stamina/.test(card.text)
    && card.yes === 'Choose' && card.no === 'Not now' && card.seconds === 0, card);
  check('menuCard: no N for a menu without a dbo: close; none for an inspect list or an empty menu',
    P.menuCard(Object.assign({}, lv, { events: { action: 'dbo:levelChoose' } })).no === '' && P.menuCard(Object.assign({}, lv, { mode: 'inspect', lines: ['x'] })) === null
    && P.menuCard(Object.assign({}, lv, { actions: [] })) === null);
  P.showPrompt(card, () => {}, T0);
  const cv = P.promptView(P.hudPrompt.current, T0 + 600000);
  check('an untimed card: no clock bar, no countdown, ten minutes on', cv.frac === -1 && cv.left === 0 && cv.idle === '' && cv.yes === 'Y  Choose' && cv.no === 'N  Not now', cv);
  check('...and Y still answers it', P.pressKey(Y, T0 + 600000) === true);
  P.hudPrompt.current = null;
};

let fails = 0;
const check = (what, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 300)}`); if (!ok) fails++; };
const SOURCE = fs.readFileSync(SRC, 'utf8');
const P = compile(SOURCE, path.join(TMP, 'live'));
decisions(P, check);

// The packets are the browser buttons' own: the front sends these events with these choices
const fe = front('feedPrompt'), ro = front('robPrompt'), dn = front('downed');
check('the front\'s buttons send the same events and choices', /send\('dbo:feedAnswer', data\.nonce, choice\)/.test(fe) && /answer\('submit'\)/.test(fe) && /answer\('resist'\)/.test(fe)
  && /send\('dbo:robAnswer', data\.nonce, choice\)/.test(ro) && /answer\('accept'\)/.test(ro) && /answer\('fight'\)/.test(ro) && /send\('dbo:downedGiveUp', data\.nonce\)/.test(dn));

// dbo_hud draws the card
const t = S.boot('dbo_hud', true);
const pay = (o) => Object.assign({ bars: { on: true, shown: true, quiet: false, h: 100, m: 100, s: 100 }, corner: { shown: true }, power: null, gold: null, hunger: null,
  voice: { mode: 'talk', talking: false }, party: null, watermark: false }, o || {});
t.push(pay({ prompt: null }));
check('dbo_hud: no prompt, no card', t.root.prompt._visible === false);
P.showPrompt(P.serverPrompt({ type: 'robPrompt', id: 72, nonce: 'r1', robber: 'Vex', seconds: 20 }).spec, () => {}, 0);
t.push(pay({ prompt: P.promptView(P.hudPrompt.current, 5000) }));
const C = t.root.prompt.card;
check('dbo_hud: the card centre screen with its kicker, title, text, both keys and the time', t.root.prompt._visible === true && !!C && C.kicker.text === 'YOU ARE BEING ROBBED'
  && C.title.text === 'Vex demands your valuables' && /Gold in the bank is safe/.test(C.body.text) && C.yes.text === 'Y  Accept being robbed' && C.no.text === 'N  Fight / Flee'
  && /^15 s\. No answer means you stand your ground\.$/.test(C.idle.text) && Math.abs(t.root.prompt._x - (1280 - 480) / 2) < 1, C && [C.kicker.text, C.yes.text, C.no.text, C.idle.text]);
const clockW = (() => { const f = C && C.fills[C.fills.length - 1]; return f ? Math.max(...f.pts.map((q) => q[0])) - Math.min(...f.pts.map((q) => q[0])) : -1; })();
check('dbo_hud: the clock bar shows the time left (15 of 20 s)', clockW === Math.round(444 * 0.75), clockW);
t.push(pay({ prompt: null }));
check('dbo_hud: the card goes with the prompt', t.root.prompt._visible === false);
P.showPrompt(P.menuCard({ type: 'contextMenu', id: 120, mode: 'menu', targetName: 'Level 5', actions: [{ id: 'h', label: '+10 Health' }], events: { close: 'dbo:levelClose' } }), () => {}, 0);
t.push(pay({ prompt: P.promptView(P.hudPrompt.current, 5000) }));
const C2 = t.root.prompt.card;
check('dbo_hud: an untimed card draws no clock bar (only its ground and accent line)', !!C2 && C2.fills.length === 2 && C2.yes.text === 'Y  Choose' && C2.idle.text === '', C2 && C2.fills.length);
P.hudPrompt.current = null;
check('dbo_hud carries no character the game\'s font lacks', !/[^\x00-\x7f]/.test(fs.readFileSync(path.join(ROOT, 'swf', 'dbo_hud', 'scripts', 'frame_1', 'DoAction.as'), 'utf8')));
P.hudPrompt.current = null;

// ---- mutants: each altered nativePrompt.ts must fail a decision check ----
const MUTANTS = [
  ['N accepts', 'if (code === KEY_NO && p.no) return false;', 'if (code === KEY_NO && p.no) return true;'],
  ['a second press answers again', '  p.answered = true;\n  p.answer(a);', '  p.answer(a);'],
  ['the lock is ignored', 'return lockLeft(p, now) > 0 ? null : true;', 'return true;'],
  ['feeding: Y resists', 'yes: { event: "feedAnswer", args: [nonce, "submit"] }', 'yes: { event: "feedAnswer", args: [nonce, "resist"] }'],
  ['robbery: N accepts', 'no: { event: "robAnswer", args: [nonce, "fight"] }', 'no: { event: "robAnswer", args: [nonce, "accept"] }'],
  ['any close takes the prompt down', 'if (hudPrompt.current && hudPrompt.current.id === id) hudPrompt.current = null;', 'hudPrompt.current = null;'],
  ['an answered prompt is handed back', 'if (p && !p.answered && p.fallback) p.fallback();', 'if (p && p.fallback) p.fallback();'],
  ['the lock is not shown', '${lock > 0 ? ` (${lock})` : ""}', ''],
  ['an untimed card shows a clock', '    left, frac: timed ? Math.round((left / total) * 1000) / 1000 : -1,', '    left, frac: Math.round((left / total) * 1000) / 1000,'],
  ['an inspect list becomes a card', 'w["mode"] === "inspect" || ', ''],
  ['N offered without a close', 'no: typeof events["close"] === "string" && String(events["close"]).indexOf("dbo:") === 0 ? "Not now" : "",', 'no: "Not now",'],
];
MUTANTS.forEach(([name, a, b], i) => {
  if (!SOURCE.includes(a)) { check(`mutant "${name}": its line is in nativePrompt.ts`, false, a); return; }
  let bad = 0;
  try { decisions(compile(SOURCE.replace(a, b), path.join(TMP, `m${i}`)), (w, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  check(`mutant caught: ${name}`, bad > 0);
});

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
