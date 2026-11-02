// The gamemode loader (index.ts requireTemp) across hot reloads: each generation is required from a new temp path, and
// Node keeps a required module in require.cache and in its parent's module.children, so before 2 Nov every generation
// stayed alive with everything it loaded (dev, 5 reloads: Module objects 353 -> 1053, snapshot 318 -> 663 MB; live ran out
// of heap after 165 reloads). This runs the real requireTemp, taken out of index.ts and built with esbuild, over a stub
// gamemode 30 times: the module tables stay empty, the heap stays flat, a gamemode that throws leaves nothing either, and
// each generation still runs. A mutant without the eviction must fail. Run from skymp5-server with node_modules present:
//
//   node tests/gamemode-reload-modules-harness.js [index.ts to test]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');

// The child: runs the loader built from the given index.ts and prints its counts as JSON
if (process.argv[2] === '--child') {
  const [loaderFile, gmFile, badFile] = process.argv.slice(3);
  const requireTemp = require(loaderFile);
  const loader = require.cache[require.resolve(loaderFile)];
  const tempEntries = () => Object.keys(require.cache).filter((k) => /skymp5-server/.test(path.basename(path.dirname(k)))).length;
  const tempChildren = () => [loader, require.main].reduce((n, m) => n + (m ? m.children.filter((c) => /skymp5-server/.test(path.basename(path.dirname(c.id)))).length : 0), 0);
  const heap = () => { global.gc(); global.gc(); return process.memoryUsage().heapUsed; };
  const errors = [];
  console.error = (...a) => errors.push(a.join(' '));
  for (let i = 0; i < 5; i++) requireTemp(gmFile);
  const h5 = heap();
  for (let i = 0; i < 25; i++) requireTemp(gmFile);
  const h30 = heap();
  const runs = globalThis.__gen;
  requireTemp(badFile);
  process.stdout.write(JSON.stringify({ runs, entries: tempEntries(), children: tempChildren(), growMB: (h30 - h5) / 1048576, badThrew: errors.some((e) => /bad gamemode/.test(e)), hookWorks: globalThis.__hook() === 200000 }));
  process.exit(0);
}

const indexFile = path.resolve(process.argv[2] || path.join(root, 'ts', 'index.ts'));
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-reloadmods-'));
process.on('exit', () => { try { fs.rmSync(out, { recursive: true, force: true }); } catch (e) { /* the OS */ } });

// requireTemp's source, by its braces
const extract = (src) => {
  const start = src.indexOf('function requireTemp(');
  if (start < 0) throw new Error('requireTemp is not in index.ts');
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
};

// A stub gamemode loading a module the way gamemode.js does (cache entry deleted, then required): the child's module scope
// holds ~1.6 MB behind the function it exports, so an old generation stays alive only if Node's module tables keep it
const child = path.join(out, 'child.js');
fs.writeFileSync(child, 'const big = new Array(200000).fill(1);\nmodule.exports = () => () => big.length;\n');
const gm = path.join(out, 'gm.js');
fs.writeFileSync(gm, `const CHILD = ${JSON.stringify(child)};\ndelete require.cache[CHILD];\nglobalThis.__gen = (globalThis.__gen || 0) + 1;\nglobalThis.__hook = require(CHILD)();\n`);
const bad = path.join(out, 'bad.js');
fs.writeFileSync(bad, 'const keep = new Array(200000).fill(1);\nthrow new Error("bad gamemode");\n');

const run = (srcText) => {
  const loader = path.join(out, `loader-${Math.random().toString(36).slice(2)}.js`);
  const ts = `import * as fs from 'fs';\nimport * as path from 'path';\nimport * as os from 'os';\n${extract(srcText)}\nmodule.exports = requireTemp;\n`;
  fs.writeFileSync(loader, esbuild.transformSync(ts, { loader: 'ts', format: 'cjs', platform: 'node', target: 'node16' }).code);
  return JSON.parse(execFileSync(process.execPath, ['--expose-gc', __filename, '--child', loader, gm, bad], { encoding: 'utf8' }));
};

let fails = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) fails++; };
const checks = (r, ck) => {
  ck('every generation runs (30 reloads, 30 runs)', r.runs === 30, r.runs);
  ck('...and the newest one is the live one', r.hookWorks === true);
  ck('no generation stays in require.cache', r.entries === 0, r.entries);
  ck('no generation stays in a parent\'s module.children', r.children === 0, r.children);
  ck('the heap is flat across 25 more reloads (under 4 MB; a kept generation is ~1.6 MB)', r.growMB < 4, r.growMB.toFixed(1));
  ck('a gamemode that throws is reported and leaves nothing behind', r.badThrew && r.entries === 0, r);
};

const SRC = fs.readFileSync(indexFile, 'utf8').replace(/\r\n/g, '\n');
checks(run(SRC), check);

// ---- mutant: the loader without the eviction ----
const from = '    const loaded = tempPath ? require.cache[tempPath] : undefined;\n';
if (!SRC.includes(from)) check('mutant: its line is still in index.ts', false, from);
else {
  let bad2 = 0;
  checks(run(SRC.replace(from, '    const loaded = undefined as NodeModule | undefined;\n')), (_n, ok) => { if (!ok) bad2++; });
  check('mutant caught: generations kept without the eviction', bad2 > 0);
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exitCode = fails ? 1 : 0;
