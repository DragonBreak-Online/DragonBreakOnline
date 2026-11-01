// Runs the native birthsign picker (swf/dbo_birthsign) on the stub stage with birthsigns.js's payload shape: the three
// Guardians, their charges and the Serpent under none. Same messages as the browser picker (dbo:birthsignPick,
// dbo:birthsignClose); the list scrolls with the shared scrollbar. The sign order is checked against the browser's
// layout() and its mutants must fail.
//   node tests/native-birthsign-harness.js   (from skymp5-client)
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const sign = (id, name, guardian) => ({ id, name, guardian, lore: `${name} lore.`, effect: `${name} gift.` });
const SIGNS = [
  sign('warrior', 'The Warrior', ''), sign('mage', 'The Mage', ''), sign('thief', 'The Thief', ''),
  sign('lady', 'The Lady', 'warrior'), sign('steed', 'The Steed', 'warrior'), sign('lord', 'The Lord', 'warrior'),
  sign('apprentice', 'The Apprentice', 'mage'), sign('atronach', 'The Atronach', 'mage'), sign('ritual', 'The Ritual', 'mage'),
  sign('lover', 'The Lover', 'thief'), sign('shadow', 'The Shadow', 'thief'), sign('tower', 'The Tower', 'thief'),
  sign('serpent', 'The Serpent', 'none'),
];
const picker = (o) => Object.assign({ type: 'birthsignPicker', id: 163, nonce: 'b1', signs: SIGNS }, o || {});
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const P = (t) => t.root.dboPanel;
const rowsOf = (t) => Object.keys(P(t).list.kids).filter((n) => /^r\d$/.test(n)).map((n) => P(t).list[n]);

{
  const t = S.boot('dbo_birthsign');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1, t.msgs());
  t.push(picker());
  check('the browser\'s title and line', P(t).head.title.text === 'CHOOSE YOUR BIRTHSIGN' && P(t).head.sub.text === 'The stars you were born under. Yours for life; only staff can change it later.');
  const names = rowsOf(t).map((r) => r.label.text);
  check('nine rows, each Guardian heading its charges (the browser\'s columns, read down)', names.length === 9 && names.join('|') === 'The Warrior|The Lady|The Steed|The Lord|The Mage|The Apprentice|The Atronach|The Ritual|The Thief', names);
  check('a Guardian reads Guardian on its row', rowsOf(t)[0].kicker.text === 'Guardian' && rowsOf(t)[1].kicker.text === '');
  check('13 signs on 9 rows: the scrollbar shows', P(t).bar._visible === true);
  check('nothing chosen yet: the prompt, and Choose greyed', /Choose a sign on the left/.test(P(t).detail.empty.text) && P(t).foot.take.disabled === true);
  t.wheel(-1);
  check('the wheel scrolls the list one row', rowsOf(t)[0].label.text === 'The Lady', rowsOf(t)[0].label.text);
  t.wheel(1); t.wheel(-1); t.push(picker()); t.wheel(-1);
  check('...and still one row after redraws (one bar, one listener)', t.ctx.Mouse.listeners.length === 1, t.ctx.Mouse.listeners.length);
  t.press(34);
  check('Page Down shows the end: the Serpent last, under no Guardian', rowsOf(t)[rowsOf(t).length - 1].label.text === 'The Serpent' && rowsOf(t)[rowsOf(t).length - 1].kicker.text === 'Wanders');
  t.press(33);
  rowsOf(t)[5].onRelease();
  check('a click shows the sign: name, charge, lore, gift', P(t).detail.name.text === 'The Apprentice' && P(t).detail.kicker.text === 'Charge of The Mage' && P(t).detail.lore.text === 'The Apprentice lore.' && P(t).detail.effect.text === 'The Apprentice gift.');
  check('...its emblem drawn (the browser\'s art for a payload without one)', P(t).detail.emblem.strokes > 0);
  check('...its row lit, the rest at rest', rowsOf(t)[5]._alpha === 100 && rowsOf(t)[0]._alpha === 50);
  P(t).foot.take.onRelease();
  check('Choose asks first, as the browser does', P(t).foot.ask.text === 'Be born under The Apprentice? It is yours for life; only staff can change it.' && msgs(t, 'dbo:birthsignPick').length === 0);
  t.press(27);
  check('Escape on the ask goes back, sending nothing', P(t).foot.ask === undefined && msgs(t, 'dbo:birthsignClose').length === 0 && !t.closed());
  P(t).foot.take.onRelease();
  P(t).foot.go.onRelease();
  const pk = msgs(t, 'dbo:birthsignPick');
  check('confirmed: dbo:birthsignPick [nonce, id]', pk.length === 1 && pk[0].args.join('|') === 'b1|apprentice', pk);
  t.push(picker({ nonce: 'b2', notice: 'The Lord answers no one tonight.' }));
  check('a new payload starts again, with its notice', P(t).detail.empty !== undefined && P(t).head.notice.text === 'The Lord answers no one tonight.');
  t.press(27);
  check('Escape closes: dbo:birthsignClose [nonce], the menu shut', msgs(t, 'dbo:birthsignClose').length === 1 && msgs(t, 'dbo:birthsignClose')[0].args[0] === 'b2' && t.closed());
}
{
  const u = S.boot('dbo_birthsign');
  u.push({ nonce: 'x' });
  check('an unreadable payload is logged, not drawn', u.logs.some((s) => s.indexOf('unreadable payload') >= 0) && !u.root.dboPanel.list);
}

// The order block against the browser's layout() (skymp5-front features/birthsignPicker): columns read down, then below
const SRC = fs.readFileSync(path.join(__dirname, '..', 'swf', 'dbo_birthsign', 'scripts', 'frame_1', 'DoAction.as'), 'utf8').replace(/\r\n/g, '\n');
const a = SRC.indexOf('// BIRTHSIGN-ORDER-BEGIN'), b = SRC.indexOf('// BIRTHSIGN-ORDER-END');
const ORDER = a >= 0 && b > a ? SRC.slice(a, b) : '';
check('the swf has the marked order block', !!ORDER);
const browserOrder = (signs) => {
  const guardians = signs.filter((s) => s.guardian === '');
  const ids = new Set(guardians.map((g) => g.id));
  const columns = guardians.map((g) => [g, ...signs.filter((s) => s.guardian === g.id)]);
  const below = signs.filter((s) => s.guardian !== '' && !ids.has(s.guardian));
  return [].concat(...columns, below).map((s) => s.id).join('|');
};
const shuffled = (n) => { const x = SIGNS.slice(); let seed = n; for (let i = x.length - 1; i > 0; i--) { seed = (seed * 9301 + 49297) % 233280; const j = Math.floor((seed / 233280) * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const CASES = [SIGNS, shuffled(1), shuffled(7), SIGNS.filter((s) => s.id !== 'mage'), SIGNS.filter((s) => s.guardian !== '')];
const scenarios = (src) => { const f = new Function(`${src}\nreturn { signOrder, kickerOf };`)(); let bad = 0; for (const c of CASES) if (f.signOrder(c).map((s) => s.id).join('|') !== browserOrder(c)) bad++; if (f.kickerOf(SIGNS[3], SIGNS) !== 'Charge of The Warrior') bad++; return bad; };
check('the order equals the browser\'s for the list, two shuffles, a missing Guardian and none at all', ORDER && scenarios(ORDER) === 0);
const MUTANTS = [
  ['charges not under their Guardian', 'if (signs[c].guardian == signs[g].id)', 'if (false)'],
  ['orphans dropped', 'if (signs[b].guardian != "" && ids[signs[b].guardian] != true)', 'if (false)'],
  ['orphans include the charges', 'ids[signs[b].guardian] != true', 'true'],
  ['no charge line', 'return "Charge of " + signs[i].name;', 'return "";'],
];
for (const [name, from, to] of MUTANTS) {
  if (!ORDER.includes(from)) { check(`mutant "${name}": its line is in the block`, false); continue; }
  let bad = 0; try { bad = scenarios(ORDER.replace(from, to)); } catch (e) { bad = 1; }
  check(`mutant "${name}" is caught (${bad} failing)`, bad > 0);
}
T.done();
