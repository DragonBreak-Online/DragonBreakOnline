// The native panels' JSON reader (swf/lib/dbo.as dboParse) against JSON.parse, and its cost in interpreted steps: the F3
// tab freeze (1 Nov, 4.9-6.4 s with no frame on a 44 KB journal answer) came from reading strings one charAt at a time.
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
// charAt calls stand for interpreted steps: each is one in AS2, where indexOf and substring run natively
const charAts = (src, text) => {
  const P = parserOf(src);
  vm.runInContext("var dboSteps = 0; var dboCharAt = ''.charAt; ''.constructor.prototype.charAt = function (i) { dboSteps++; return dboCharAt.call(this, i); };", P);
  P.dboParse(text);
  return P.dboSteps;
};
const CASES = [
  { a: 'plain', b: '', c: 'quote " inside', d: 'back \\ slash', e: 'line\nbreak\ttab\rcr', f: 'é ü ß 日本', g: '\u0001\u001f' },
  [1, -2.5, 3e5, true, false, null, '', 'x', [], {}, [[]], { k: [{ z: '"\\"' }] }],
  { long: 'a'.repeat(5000) + '\\' + 'b'.repeat(5000), after: 'no escape here', quotes: '\\"\\"' },
  'just a string with \\ and " and —',
  { nested: { deep: { deeper: { text: 'Tier 3 · Medium · Defense 30', n: 0 } } } },
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

// Cost: the parser as it was (the branch's base) against this one, on the 44 KB answer
const base = (() => { try { return execFileSync('git', ['show', 'HEAD:skymp5-client/swf/lib/dbo.as'], { cwd: ROOT, encoding: 'utf8' }).replace(/\r\n/g, '\n'); } catch (e) { return ''; } })();
if (base && base !== LIB) {
  const before = charAts(base, BIG), after = charAts(LIB, BIG);
  console.log(`     ${BIG.length} characters: ${before} charAt steps before, ${after} now (${(before / after).toFixed(1)}x fewer)`);
  check('the 44 KB answer takes at least 3x fewer interpreted steps than before', after * 3 <= before, { before, after });
}

const MUTANTS = [
  ['the escape search is not reset per payload', '   dboJsonBs = -1;\n', ''],
  ['a run loses its last character', 's += dboJsonSrc.substring(dboJsonAt, q);', 's += dboJsonSrc.substring(dboJsonAt, q - 1);'],
  ['the text before an escape is dropped', 's += dboJsonSrc.substring(dboJsonAt, dboJsonBs);', ''],
  ['an escaped quote ends the string', 'if (q <= dboJsonBs)', 'if (q <= dboJsonBs + 1)'],
];
for (const [name, a, b] of MUTANTS) {
  if (!LIB.includes(a)) { check(`mutant "${name}": its line is in the code`, false, a); continue; }
  check(`mutant caught: ${name}`, run(LIB.replace(a, b), false) > 0);
}
T.done();
