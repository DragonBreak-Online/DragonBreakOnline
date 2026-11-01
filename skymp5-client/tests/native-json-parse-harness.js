// The native panels' JSON reader (swf/lib/dbo.as dboParse) against JSON.parse, and its cost: the F3 tab freeze (1 Nov,
// 4.9-6.4 s with no frame on a 44 KB journal answer, then still 3.2 s court and 4.8 s faction once strings were read in
// runs) follows how far into the one long payload each charAt, indexOf or substr call reaches. The cost counted here is
// those offsets summed, which must stay linear in the payload's length.
// Each mutant must fail. Run: node tests/native-json-parse-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const ROOT = path.resolve(__dirname, '..');
const LIB = fs.readFileSync(path.join(ROOT, 'swf/lib/dbo.as'), 'utf8').replace(/\r\n/g, '\n');

const parserOf = (src) => {
  const ctx = { Math, String, Number, isNaN, isFinite, parseInt, _root: {}, _global: {} };
  vm.createContext(ctx);
  vm.runInContext(src.slice(src.indexOf('// ---- JSON ----'), src.indexOf('// ---- drawing ----')), ctx);
  return ctx;
};
// Characters walked: every charAt, indexOf, substr and substring call costs the offset it starts reading at (Nat's
// numbers fit a reader that walks to the offset each time), split one pass over its string
const walked = (src, text) => {
  const P = parserOf(src);
  vm.runInContext(`var dboWalked = 0; var dboProto = ''.constructor.prototype;
    ['charAt', 'charCodeAt', 'substr', 'substring'].forEach(function (m) { var f = dboProto[m]; dboProto[m] = function (i) { dboWalked += Math.max(0, i || 0) + 1; return f.apply(this, arguments); }; });
    (function () { var f = dboProto.indexOf; dboProto.indexOf = function (c, i) { var r = f.apply(this, arguments); dboWalked += (r < 0 ? this.length : r) + 1; return r; }; })();
    (function () { var f = dboProto.split; dboProto.split = function () { dboWalked += this.length; return f.apply(this, arguments); }; })();`, P);
  P.dboParse(text);
  return P.dboWalked;
};
const CASES = [
  { a: 'plain', b: '', c: 'quote " inside', d: 'back \\ slash', e: 'line\nbreak\ttab\rcr', f: 'é ü ß 日本', g: '\u0001\u001f' },
  [1, -2.5, 3e5, true, false, null, '', 'x', [], {}, [[]], { k: [{ z: '"\\"' }] }],
  { long: 'a'.repeat(5000) + '\\' + 'b'.repeat(5000), after: 'no escape here', quotes: '\\"\\"' },
  'just a string with \\ and " and —',
  { nested: { deep: { deeper: { text: 'Tier 3 · Medium · Defense 30', n: 0 } } } },
  { path: 'Data\\Platform\\', next: 'after a trailing backslash', two: '\\\\' },
  42,
  false,
];
const SAMPLE = JSON.parse(fs.readFileSync(path.join(__dirname, 'native-journal-magic.json'), 'utf8'));
// A journal answer the size of Nat's (43,817 characters): rows of labels and hints, a few with quotes and line breaks
const big = { type: 'journal', id: 50, nonce: 'n1', hub: 1, tab: 'skills', tabs: [{ id: 'skills', label: 'Skills' }], skills: { groups: [] } };
for (let g = 0; JSON.stringify(big).length < 43817; g++) {
  big.skills.groups.push({ name: `Group ${g}`, rows: Array.from({ length: 8 }, (_, i) => ({ label: `Skill ${g}.${i}`, value: `${i * 7} / 100`,
    hint: i === 3 ? 'He said "again"\nand left' : `Rises with use; tier ${i} of 7, next at ${i * 15} points` })) });
}
const BIG = JSON.stringify(big);

const run = (lib, live) => {
  let bad = 0;
  const t = (ok, what, got) => { if (!ok) bad++; if (live) check(what, ok, got); };
  let P;
  try { P = parserOf(lib); } catch (e) { return 1; }
  for (const c of CASES) {
    const s = JSON.stringify(c);
    let got; try { got = P.dboParse(s); } catch (e) { got = String(e); }
    t(JSON.stringify(got) === s, `reads ${s.slice(0, 50)}...`, got);
  }
  let got; try { got = P.dboParse(JSON.stringify(SAMPLE)); } catch (e) { got = String(e); }
  t(JSON.stringify(got) === JSON.stringify(SAMPLE), 'reads the journal magic tab fixture exactly');
  // a backslash late in one payload must not hide an earlier one in the next
  try { P.dboParse(JSON.stringify({ x: 'y'.repeat(300) + '\\' })); got = P.dboParse(JSON.stringify({ a: 'q\\"r' })); } catch (e) { got = String(e); }
  t(got && got.a === 'q\\"r', 'a second payload starts its escape search afresh', got);
  try { got = P.dboParse(BIG); } catch (e) { got = String(e); }
  t(JSON.stringify(got) === BIG, `reads a ${BIG.length}-character journal answer exactly`);
  return bad;
};
check('the live parser reads everything exactly', run(LIB, true) === 0);

// Cost: linear. A court- or faction-shaped answer (many short values) at 1x and 2x; the walk may grow with the length,
// not with its square, and stays within a few passes of it
const court = (rows) => { const o = { type: 'journal', id: 50, nonce: 'n', hub: 1, tab: 'court', court: { members: [] } };
  for (let i = 0; i < rows; i++) o.court.members.push({ id: i, name: `Member ${i}`, rank: i % 7, title: i % 3 ? 'Thane' : 'Housecarl', online: i % 2 === 0, since: 210 + i, notes: i % 9 ? '' : 'Said "aye"\nthen left' });
  return JSON.stringify(o); };
const C1 = court(300), C2 = court(600);
const w1 = walked(LIB, C1), w2 = walked(LIB, C2), wb = walked(LIB, BIG);
console.log(`     walked: ${C1.length} ch court -> ${w1}, ${C2.length} ch -> ${w2}; ${BIG.length} ch skills -> ${wb}`);
check('a court-shaped answer twice the size walks at most 2.3x as far (linear, not quadratic)', w2 <= w1 * 2.3 * (C2.length / C1.length) / 2, { w1, w2 });
check('every answer is walked within 4 passes of its length', w1 <= 4 * C1.length && w2 <= 4 * C2.length && wb <= 4 * BIG.length, { w1, w2, wb });
const base = (() => { try { return execFileSync('git', ['show', 'HEAD:skymp5-client/swf/lib/dbo.as'], { cwd: ROOT, encoding: 'utf8' }).replace(/\r\n/g, '\n'); } catch (e) { return ''; } })();
if (base && base !== LIB) console.log(`     the reader before this branch walked ${walked(base, C2)} on the ${C2.length} ch court answer`);

const MUTANTS = [
  ['an escaped quote ends the string', 'while (dboJsonEscapedEnd(str) && i + 1 < parts.length)', 'while (false && i + 1 < parts.length)'],
  ['an even run of backslashes counts as an escape', 'return n % 2 == 1;', 'return n > 0;'],
  ['a \\u escape keeps its four digits', '         at += 4;\n', '\n'],
  ['numbers stay text', ': Number(lit));', ': lit);'],
  ['the text after the last escape is dropped', 'return out + s.substring(at);', 'return out;'],
  ['a value cut off by the end of its piece is lost', 'for (var i = 0; i <= p.length; i++)', 'for (var i = 0; i < p.length; i++)'],
  ['the payload is read by walking it', 'var parts = String(s).split("\\"");', 'var parts = []; var dboW = String(s); var dboQ = 0; for (var dboN = dboW.indexOf("\\"", 0); dboN >= 0; dboN = dboW.indexOf("\\"", dboQ)) { var dboX = ""; for (var dboK = dboQ; dboK < dboN; dboK++) dboX += dboW.charAt(dboK); parts.push(dboX); dboQ = dboN + 1; } var dboY = ""; for (var dboK = dboQ; dboK < dboW.length; dboK++) dboY += dboW.charAt(dboK); parts.push(dboY);'],
];
for (const [name, a, b] of MUTANTS) {
  if (!LIB.includes(a)) { check(`mutant "${name}": its line is in the code`, false, a); continue; }
  const M = LIB.replace(a, b);
  let costBad = false;
  try { costBad = walked(M, C2) > 4 * C2.length; } catch (e) { costBad = true; }
  check(`mutant caught: ${name}`, run(M, false) > 0 || costBad);
}
T.done();
