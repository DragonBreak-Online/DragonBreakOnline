// Mutants for a harness, run from the harness itself so the claim is reproducible: each mutant alters a COPY of src, swf and
// tests (never the tracked files) and runs the same harness there, which must print a FAIL or stop on an error.
//   mutants(__filename, [[name, file, [[from, to], ...]], ...], check)
// The copy's run sets DBO_MUTANT_RUN, and a harness skips its own mutants then.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

module.exports = (harness, list, check) => {
  if (process.env.DBO_MUTANT_RUN) return;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-mutants-'));
  list.forEach(([name, file, edits], i) => {
    const dir = path.join(base, String(i));
    for (const d of ['src', 'swf', 'tests']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
    const f = path.join(dir, file);
    let s = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    const missing = edits.filter(([a]) => !s.includes(a));
    if (missing.length) { check(`mutant "${name}": its line is still in ${file}`, false, missing[0][0]); return; }
    for (const [a, b] of edits) s = s.replace(a, b);
    fs.writeFileSync(f, s);
    let out = '';
    let crashed = false;
    try {
      out = execFileSync(process.execPath, [path.join(dir, 'tests', path.basename(harness))],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { DBO_MUTANT_RUN: '1' }) });
    } catch (e) {
      out = String(e.stdout || '');
      crashed = /Error/.test(String(e.stderr || ''));
    }
    check(`mutant caught: ${name}`, /^FAIL/m.test(out) || crashed);
  });
  try { fs.rmSync(base, { recursive: true, force: true }); } catch (e) { /* a busy file on Windows */ }
};
