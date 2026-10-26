// Builds a DBO Scaleform menu from source, headlessly, with no Adobe tooling.
//
// The received wisdom is that Skyrim UI needs Adobe Flash CS6. It does not: FFDec compiles AS2 source into a
// SWF from the command line, so the ActionScript lives in git as text and this runs in CI.
//
//   node swf/build-swf.js dbo_testmenu [outDir]
//
// Per menu, swf/<name>/ holds:
//   <name>.xml                 the base structure, ours, no assets
//   scripts/frame_1/DoAction.as   the AS2, which builds the UI at runtime
//
// Two steps: -xml2swf makes the empty base, -importScript compiles the source into it. Never round-trip
// somebody else's SWF: a decompile/recompile of a foreign file breaks sprite and class links.
//
// FFDec is GPLv3. It is a build tool we run, which does not affect the licence of the SWF it produces.

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const name = process.argv[2];
if (!name) {
  console.error('usage: node swf/build-swf.js <menuName> [outDir]');
  process.exit(2);
}

const here = __dirname;
const srcDir = path.join(here, name);
const baseXml = path.join(srcDir, name + '.xml');
const scriptsDir = path.join(srcDir, 'scripts');
const outDir = process.argv[3] ? path.resolve(process.argv[3]) : path.join(here, 'build');

// fork/skymp5-client/swf -> the working root, where tools/ffdec lives. DBO_FFDEC overrides it.
const ffdec = process.env.DBO_FFDEC ||
  path.join(here, '..', '..', '..', 'tools', 'ffdec', 'ffdec-cli.jar');

for (const [what, p] of [['base xml', baseXml], ['scripts dir', scriptsDir], ['ffdec', ffdec]]) {
  if (!fs.existsSync(p)) {
    console.error(`missing ${what}: ${p}`);
    process.exit(1);
  }
}
fs.mkdirSync(outDir, { recursive: true });

const stage = path.join(outDir, name + '.base.swf');
const final = path.join(outDir, name + '.swf');

const run = (args) => execFileSync('java', ['-jar', ffdec, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });

// swf/<name>/lib.txt names the swf/lib/*.as files to put ahead of the frame script, staged so the source stays clean
const libList = path.join(srcDir, 'lib.txt');
const stagedScripts = path.join(outDir, '.scripts-' + name);
fs.rmSync(stagedScripts, { recursive: true, force: true });
fs.cpSync(scriptsDir, stagedScripts, { recursive: true });
const frameAs = path.join(stagedScripts, 'frame_1', 'DoAction.as');
if (fs.existsSync(libList) && fs.existsSync(frameAs)) {
  const lib = fs.readFileSync(libList, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
    .map((f) => fs.readFileSync(path.join(here, 'lib', f), 'utf8')).join('\n');
  fs.writeFileSync(frameAs, lib + '\n' + fs.readFileSync(frameAs, 'utf8'));
}

run(['-xml2swf', baseXml, stage]);
if (!fs.existsSync(stage)) {
  console.error('xml2swf produced nothing');
  process.exit(1);
}
run(['-importScript', stage, final, stagedScripts]);
if (!fs.existsSync(final)) {
  console.error('importScript produced nothing');
  process.exit(1);
}
fs.unlinkSync(stage);
fs.rmSync(stagedScripts, { recursive: true, force: true });

// A SWF that builds is not a SWF that carries our code, so prove the source landed rather than trusting the
// exit code: decompile the result and look for a string only our AS2 has.
const verifyDir = path.join(outDir, '.verify-' + name);
fs.rmSync(verifyDir, { recursive: true, force: true });
run(['-export', 'script', verifyDir, final]);

// swf/<name>/verify.txt names strings only this menu's source has, one per line; else the shared wire's own names
const verifyList = path.join(srcDir, 'verify.txt');
const want = fs.existsSync(verifyList)
  ? fs.readFileSync(verifyList, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  : ['dboData', 'SendModEvent', 'dboOut', '$EverywhereFont'];
let text = '';
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.as')) text += fs.readFileSync(p, 'utf8');
  }
};
if (fs.existsSync(verifyDir)) walk(verifyDir);
const missing = want.filter((w) => !text.includes(w));
fs.rmSync(verifyDir, { recursive: true, force: true });

if (!text) {
  console.error('the built SWF decompiles to no ActionScript at all');
  process.exit(1);
}
if (missing.length) {
  console.error('the built SWF is missing: ' + missing.join(', '));
  process.exit(1);
}

console.log(`${name}.swf  ${fs.statSync(final).size} bytes  ${final}`);
console.log('verified: the AS2 decompiles back out of it, carrying ' + want.join(', '));
