// Scripted test for the RaceMenu face rules of sync/racemenuPresetPlan.ts (facePresetFixed): every case of
// racemenu-face-rules-fixtures.js (the same table the server's racemenu-preset-plan-harness.js runs against
// racemenupresets.js), with and without this game's tri counts, and that the rules change nothing on their own output.
// Run from skymp5-client:
//
//   node tests/racemenu-face-rules-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP racemenu-face-rules (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);
const F = require('./racemenu-face-rules-fixtures');

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`);
  if (!ok) failures++;
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-facerules-'));
let P;
try {
  const out = path.join(dir, 'plan.js');
  esbuild.buildSync({ entryPoints: [path.resolve(__dirname, '../src/sync/racemenuPresetPlan.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error' });
  P = require(out);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
// The rules before facePresetFixed (0.3.95 14ef36d5b and older): the face or null, no fixes
const fixed = (j, counts) => (typeof P.facePresetFixed === 'function' ? P.facePresetFixed(j, counts)
  : ((f) => (f ? { face: f, fixes: [] } : null))(P.facePresetFrom(j)));
const textOf = (t) => (t ? F.encode(t.face) : null);
const want = (f) => (f ? F.encode(f) : null);

for (const c of F.cases) {
  let got = null;
  try { got = fixed(c.input()); } catch (e) { got = { error: String(e) }; }
  if (got && got.error) { check(`${c.name}: no throw`, false, got.error); continue; }
  const exp = want(c.out());
  check(`${c.name}`, textOf(got) === exp && F.fixesOf(got && got.fixes) === c.fixes,
    { got: textOf(got) === exp ? 'same face' : (textOf(got) || 'null').slice(0, 200), fixes: F.fixesOf(got && got.fixes) });
  // The owner's capture: tri counts from this game (-1 for a tri it cannot read)
  const tri = c.tri || {};
  const counts = (h) => (tri[h] === undefined ? -1 : tri[h]);
  let cap = null;
  try { cap = fixed(c.input(), counts); } catch (e) { cap = null; }
  const capExp = c.captureOut ? want(c.captureOut()) : exp;
  const capFixes = c.captureOut ? c.captureFixes : c.fixes;
  check(`  ...the owner's capture (with tri counts)`, textOf(cap) === capExp && F.fixesOf(cap && cap.fixes) === capFixes,
    { got: textOf(cap) === capExp ? 'same face' : (textOf(cap) || 'null').slice(0, 200), fixes: F.fixesOf(cap && cap.fixes) });
  // What is sent is what every client decodes and the server keeps: the rules change nothing on it
  for (const [label, t] of [['out', got], ['capture', cap]]) {
    if (!t) continue;
    const text = P.encodeFace(t.face);
    const again = fixed({ version: JSON.parse(text).version, modNames: JSON.parse(text).modNames, morphs: { custom: JSON.parse(text).custom, sculptDivisor: JSON.parse(text).sculptDivisor, sculpt: JSON.parse(text).sculpt } });
    const dec = text.length <= P.PRESET_MAX_CHARS ? P.decodeFace(text) : null;
    check(`  ...${label}: sent as encodeFace, decoded to the same text, the rules change nothing on it`, text === F.encode(t.face) && text.length <= P.PRESET_MAX_CHARS
      && !!dec && P.encodeFace(dec) === text && !!again && F.encode(again.face) === text && again.fixes.length === 0, { len: text.length, fixes: again && F.fixesOf(again.fixes) });
  }
}

// The trace's form of the fixes: codes and counts only
const t = fixed(F.cases.find((c) => /everything at once/.test(c.name)).input());
check('fixesText: "code:n,..." with no names or paths', typeof P.fixesText === 'function' && P.fixesText(t.fixes) === 'custom-name:1,custom-value:1,custom-dup:1,sculpt-vertex:1,sculpt-offset:1,sculpt-vertices:2'
  && !/[\\'"]|tri|Morph/.test(P.fixesText(t.fixes)), typeof P.fixesText === 'function' ? P.fixesText(t.fixes) : 'no fixesText');
check('each fix names its first entry for the player\'s own diag file (bounded)', t.fixes.every((f) => typeof f.first === 'string' && f.first.length <= 120)
  && t.fixes.find((f) => f.code === 'custom-dup').first === 'morph_A', t.fixes);
// A count that throws is a tri that cannot be read
const hair = F.cases.find((c) => /recounted from the tri/.test(c.name));
const thrown = fixed(hair.input(), () => { throw new Error('no native'); });
check('a tri count that throws drops that host only', !!thrown && thrown.face.sculpt.length === 1 && F.fixesOf(thrown.fixes) === 'sculpt-vertices:1', thrown && F.fixesOf(thrown.fixes));
check('the refusal finder: only what is not an object', P.facePresetRefusal('x').code === 'notobject' && P.facePresetRefusal([]).code === 'notobject' && P.facePresetRefusal({}) === null
  && P.facePresetRefusal(F.cases[10].input()) === null);
check('the host rule takes KS Hairdo\'s apostrophe and still refuses .., rooted, drive, spaces at the edges and long paths',
  P.isTriPath(F.KS) && P.isTriPath(F.HEAD) && P.isTriPath('a/b.TRI') && !P.isTriPath('a..b.tri') && !P.isTriPath(' a.tri') && !P.isTriPath('a.tri ')
  && !P.isTriPath('\\a.tri') && !P.isTriPath('C:\\a.tri') && !P.isTriPath('x'.repeat(197) + '.tri') && !P.isTriPath('a"b.tri'));

console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
