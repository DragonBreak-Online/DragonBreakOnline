// The Place tool's bounds box and facing arrow (placeBounds.ts, placementService.ts; W1, 2 Nov: invisible activators
// showed nothing while placed or turned). The geometry is compiled and run; the wiring is checked in the source. The
// mutants at the end run the geometry checks on altered copies and must each fail.
//   node tests/place-box-harness.js        (from skymp5-client)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 300)}`); if (!ok) failures++; };

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-pbox-'));
try {
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), path.join(ROOT, 'src', 'services', 'services', 'placeBounds.ts'),
    '--outDir', OUT, '--module', 'commonjs', '--target', 'es2019', '--skipLibCheck'], { stdio: 'pipe' });
} catch (e) { /* the emitted file is checked below */ }
const COMPILED = path.join(OUT, 'placeBounds.js');
if (!fs.existsSync(COMPILED)) { console.log('FAIL placeBounds.ts did not compile'); process.exit(1); }
const SRC = fs.readFileSync(COMPILED, 'utf8');
const load = (src) => { const f = path.join(OUT, `pb-${Math.random().toString(36).slice(2)}.js`); fs.writeFileSync(f, src); return require(f); };

const near = (a, b, e = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < e);
const geometry = (B, c) => {
  const O = [-10, -20, 0, 10, 20, 30];
  c('bounds: six numbers kept as they are', JSON.stringify(B.boundsOf(O)) === JSON.stringify(O));
  c('...none, the wrong count, or a flat box give the fallback cube', [null, [1, 2, 3], [0, 0, 0, 10, 0, 10]].every((v) => JSON.stringify(B.boundsOf(v)) === JSON.stringify([-16, -16, -16, 16, 16, 16])));
  // no turn: a corner lands at the position plus its own offset
  let s = B.boxSegments(O, [100, 200, 300], [0, 0, 0]);
  c('12 edges and 4 arrow strokes', s.length === 16, s.length);
  c('no turn: the box sits at the position, corner (x1, y1, z1) offset as it is', near(s[0][0], [90, 180, 300]), s[0][0]);
  c('...the arrow runs from the centre forward along +y, past the front face', near(s[12][0], [100, 200, 315]) && near(s[12][1], [100, 240, 315]), s[12]);
  // heading 90: forward (sin z, cos z) = +x, as the server's heading rule
  s = B.boxSegments(O, [0, 0, 0], [0, 0, 90]);
  c('heading 90: the arrow points along +x (forward is (sin z, cos z))', near(s[12][1], [40, 0, 15], 1e-9), s[12][1]);
  c('...and corner (x1, y1) turns to (y1, -x1)', near(s[0][0], [-20, 10, 0], 1e-9), s[0][0]);
  // pitch 90 (x): local +y goes to -z, local +z to +y (NiMatrix3 SetEulerAnglesXYZ, row 1 and 2)
  s = B.boxSegments(O, [0, 0, 0], [90, 0, 0]);
  c('pitch 90: forward tips down, the top tick points along +y', near(s[12][1], [0, 15, -40], 1e-9) && s[15][1][1] > s[15][0][1] + 1, [s[12][1], s[15]]);
  // the path: two segments, one with an end behind the camera, which is left out; y flips (screen y grows down)
  const p = B.pathOf([[0.25, 0.75, 1], [0.5, 0.5, 1], [0.1, 0.1, 1], [0.9, 0.9, -1]]);
  c('the path flips y for the screen and leaves out a segment with an end behind the camera', p === 'M0.25 0.25L0.5 0.5', p);
};
geometry(load(SRC), check);

// ---- the wiring in placementService.ts ----
const svc = fs.readFileSync(path.join(ROOT, 'src', 'services', 'services', 'placementService.ts'), 'utf8').replace(/\r\n/g, '\n');
const body = (name) => { const i = svc.indexOf(`  private ${name}(`); return i < 0 ? '' : svc.slice(i, svc.indexOf('\n  }\n', i)); };
check('a pick asks the server for its bounds', /this\.obnd = null;\n    if \(pick\) sendCustomPacket\(this\.controller, \{ customPacketType: "dbo", event: "placeBounds", args: \[pick\.desc\] \}\);/.test(body('start')));
check('...and the answer is kept only for the pick it was asked for', /customPacketType"\] === "placeBounds" && this\.pick && String\(content\["desc"\]\) === this\.pick\.desc\) this\.obnd = boundsOf\(content\["obnd"\]\)/.test(svc));
const draw = body('drawBox');
check('the box is posed from the copy\'s pose and projected with the verified call', /boxSegments\(this\.obnd, \[at\[0\], at\[1\], at\[2\]\], \[at\[3\], at\[4\], at\[5\]\]\)/.test(draw) && /worldPointToScreenPoint\(\.\.\.segs\.flatMap/.test(draw));
check('...nothing in menus, without a copy, or before the bounds came', /this\.pick && this\.ghostId && at && this\.obnd && !Utility\.isInMenuMode\(\)/.test(draw));
check('...sent only when it changed, and at most every BOX_MS while it moves', /if \(key === \(this\.boxSent \?\? ""\) \|\| \(key && now - this\.boxSentAt < BOX_MS\)\) return;/.test(draw));
check('stop() takes the box off the screen', /this\.boxSent = null;\n      this\.sp\.browser\.executeJavaScript\(boxScript\(null\)\);/.test(body('stop')));
// the browser side, run against a minimal DOM: made once, updated, removed
const m = /const boxScript = \(box: \{ edges: string; arrow: string \} \| null\): string =>\n([\s\S]*?);\n/.exec(svc);
check('boxScript found', !!m);
if (m) {
  const boxScript = new Function('box', `return ${m[1]};`);
  const els = [];
  const mk = (tag) => { const e = { tag, attrs: {}, childNodes: [], style: {}, setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.childNodes.push(c); }, remove() { els.splice(els.indexOf(this), 1); } }; return e; };
  const document = { getElementById: (id) => els.find((e) => e.id === id) || null, createElementNS: (n, t) => mk(t), body: { appendChild: (e) => els.push(e) } };
  const run = (b) => new Function('document', boxScript(b))(document);
  run({ edges: 'M0 0L1 1', arrow: 'M0.5 0.5L0.6 0.6' });
  run({ edges: 'M0 0L0.5 0.5', arrow: '' });
  const svg = els[0];
  check('the browser draws one SVG over the screen, two paths, no pointer input', els.length === 1 && svg.attrs.viewBox === '0 0 1 1' && svg.childNodes.length === 2 && /pointer-events:none/.test(svg.style.cssText), els.length);
  check('...updated in place', svg && svg.childNodes[0].attrs.d === 'M0 0L0.5 0.5' && svg.childNodes[1].attrs.d === '');
  run(null);
  check('...and removed', els.length === 0);
}

const MUTANTS = [
  ['heading turned the other way (the matrix transposed)', '[cy * cz, cy * sz, -sy]', '[cy * cz, -cy * sz, -sy]'],
  ['the position not added', '+ pos[1],', ','],
  ['a segment behind the camera drawn', '!(a[2] > 0) || !(b[2] > 0)', 'false'],
  ['a flat box kept', 'v[4] - v[1] >= MIN_SIZE', 'true'],
];
for (const [name, a, b] of MUTANTS) {
  if (!SRC.includes(a)) { check(`mutant "${name}": its text is in the compiled module`, false, a); continue; }
  let bad = 0;
  try { geometry(load(SRC.split(a).join(b)), (w, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  check(`mutant caught: ${name}`, bad > 0);
}
fs.rmSync(OUT, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
