// The draggable scrollbar for native list panels (Nat, 31 Oct: "add a scroll bar to click and drag"; swf/lib/dbo-scroll.as).
// Runs the AS2 maths block (between SCROLL-MATHS-BEGIN and -END, plain enough to be JavaScript) in node: thumb size and
// place, a drag's offset, a track click's page, the wheel, the clamps. Checks the control's wiring in its source, and
// kills mutants of the maths.
//   node tests/scrollbar-harness.js   (from skymp5-client)
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'swf', 'lib', 'dbo-scroll.as'), 'utf8').replace(/\r\n/g, '\n');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };
const a = SRC.indexOf('// SCROLL-MATHS-BEGIN'), b = SRC.indexOf('// SCROLL-MATHS-END');
const MATHS = a >= 0 && b > a ? SRC.slice(a, b) : '';
check('dbo-scroll.as has the marked maths block', !!MATHS);
const load = (src) => new Function(`${src}\nreturn { scrollMax, scrollClamp, scrollThumbH, scrollThumbY, scrollOffsetAt, scrollPage, scrollWheel, SCROLL_MIN_THUMB };`)();

const scenarios = (m, live) => {
  let bad = 0;
  const t = (name, ok, got) => { if (!ok) bad++; if (live) check(name, ok, got); };
  // A 300 px track, 40 rows, 10 on screen
  const H = 300, N = 40, V = 10;
  t('thumb size is the visible share: 10 of 40 on 300 px is 75', m.scrollThumbH(H, N, V) === 75, m.scrollThumbH(H, N, V));
  t('...never under the minimum (10 of 1000 is 24, not 3)', m.scrollThumbH(H, 1000, V) === m.SCROLL_MIN_THUMB);
  t('...and the whole track when everything fits', m.scrollThumbH(H, 8, V) === H);
  t('thumb at the top for offset 0, at the bottom for the last page', m.scrollThumbY(0, H, N, V) === 0 && m.scrollThumbY(30, H, N, V) === H - 75);
  t('...halfway for offset 15', m.scrollThumbY(15, H, N, V) === 113, m.scrollThumbY(15, H, N, V));
  t('a drag to the thumb\'s middle place reads offset 15', m.scrollOffsetAt(112.5, H, N, V) === 15, m.scrollOffsetAt(112.5, H, N, V));
  t('...a drag past either end clamps to 0 and 30', m.scrollOffsetAt(-80, H, N, V) === 0 && m.scrollOffsetAt(900, H, N, V) === 30);
  t('a drag and the thumb agree both ways', [0, 7, 15, 22, 30].every((o) => m.scrollOffsetAt(m.scrollThumbY(o, H, N, V), H, N, V) === o));
  t('a track click below the thumb pages down by the visible rows', m.scrollPage(0, 250, H, N, V) === 10);
  t('...above it pages up', m.scrollPage(20, 10, H, N, V) === 10);
  t('...never past the end', m.scrollPage(25, 299, H, N, V) === 30);
  t('...and on the thumb does nothing', m.scrollPage(15, 120, H, N, V) === 15);
  t('the wheel moves one row: up is back, down is on', m.scrollWheel(5, 1, N, V) === 4 && m.scrollWheel(5, -1, N, V) === 6);
  t('...clamped at both ends', m.scrollWheel(0, 1, N, V) === 0 && m.scrollWheel(30, -1, N, V) === 30);
  t('a list that fits never scrolls', m.scrollClamp(5, 8, V) === 0 && m.scrollThumbY(3, H, 8, V) === 0);
  return bad;
};
if (MATHS) scenarios(load(MATHS), true);

// The control: thumb drag, track click, the wheel only over its list, removed with the bar, hidden when the list fits
check('the thumb drags (press, move, release outside too)', /thumb\.onPress = function\(\)/.test(SRC) && /b\.onMouseMove = function\(\)/.test(SRC) && /thumb\.onRelease = thumb\.onReleaseOutside = function\(\)/.test(SRC));
check('a track click pages', /track\.onRelease = function\(\)[\s\S]*?b\.move\(scrollPage\(b\.offset, b\._ymouse/.test(SRC));
check('the wheel scrolls only over the list, and its listener goes with the bar', /b\.area\.hitTest\(_root\._xmouse, _root\._ymouse, false\)/.test(SRC) && /Mouse\.removeListener\(this\.wheel\)/.test(SRC));
check('the bar hides when the list fits and tells the panel on a change only', /this\._visible = total > visible;/.test(SRC) && /if \(o != this\.offset\)/.test(SRC));
check('drawn with the branded tokens (stone track, aqua thumb)', /dboBox\(track, 0, 0, SCROLL_W, h, C_STONE, 60\)/.test(SRC) && /C_ACCENT/.test(SRC));

const MUTANTS = [
  ['thumb not proportional', 'Math.round(trackH * visible / total)', 'Math.round(trackH / 2)'],
  ['no minimum thumb', 'Math.max(SCROLL_MIN_THUMB, Math.round', 'Math.max(0, Math.round'],
  ['no clamp', 'return Math.max(0, Math.min(scrollMax(total, visible), Math.round(offset)));', 'return Math.round(offset);'],
  ['track click pages one row', 'return scrollClamp(offset + visible, total, visible);', 'return scrollClamp(offset + 1, total, visible);'],
  ['wheel backwards', '(delta > 0 ? -1 : 1)', '(delta > 0 ? 1 : -1)'],
  ['drag ignores the thumb size', 'var room = trackH - scrollThumbH(trackH, total, visible);', 'var room = trackH;'],
];
for (const [name, from, to] of MUTANTS) {
  if (!MATHS.includes(from)) { check(`mutant "${name}": its line is in the maths`, false); continue; }
  let bad = 0; try { bad = scenarios(load(MATHS.replace(from, to)), false); } catch (e) { bad = 1; }
  check(`mutant "${name}" is caught (${bad} failing)`, bad > 0);
}
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
