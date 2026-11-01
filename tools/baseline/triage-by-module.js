// Route failing harnesses by the source they actually exercise, not by guessed ownership.
//
// WHY NOT BY WORKER. Per-worker attribution is not recoverable from this history: of the last 400 merges only
// 39 name a worker at all, and they mix two incompatible schemes (Worker 1-7 now, Worker B-G retired). Reading
// the harness header gives the person who ASKED for the feature (Nat, Nate, Jake), not the session that owns
// the test. A mapping built from either would look authoritative and be partly invented.
//
// WHAT THIS DOES INSTEAD. For each failing harness, lists the server modules and fork components it reads.
// That is derivable from the harness source, and it is the key a leader can actually route on: whoever is
// working in durability.js owns the durability failures.
//
//   node triage-by-module.js <server-tree> <failing-list-file>
'use strict';
const fs = require('fs');
const path = require('path');

const tree = process.argv[2];
const listFile = process.argv[3];
if (!tree || !listFile) {
  console.error('usage: node triage-by-module.js <server-tree> <failing-list-file>');
  process.exit(2);
}
const names = fs.readFileSync(listFile, 'utf8').split(/\s+/).filter(Boolean);

// Modules a harness names directly. Deliberately conservative: a literal 'x.js' or 'x.json' in the source,
// and the fork components, rather than anything inferred.
const scan = (src) => {
  const mods = new Set();
  for (const m of src.matchAll(/['"]([a-z0-9][a-z0-9_-]*\.(?:js|json))['"]/g)) mods.add(m[1]);
  for (const c of ['skymp5-front', 'skymp5-client', 'skymp5-server']) if (src.includes(c)) mods.add(c + '/');
  return mods;
};

const rows = [];
const missing = [];
for (const n of names) {
  const f = path.join(tree, 'tests', n.endsWith('.js') ? n : n + '-harness.js');
  if (!fs.existsSync(f)) { missing.push(n); continue; }
  const src = fs.readFileSync(f, 'utf8');
  const mods = [...scan(src)]
    // gamemode.js and gamemode-config.json are read by almost everything; they route nothing.
    .filter((m) => m !== 'gamemode.js' && m !== 'gamemode-config.json' && m !== 'package.json')
    .sort();
  rows.push({ name: n, mods });
}

// Group by the most specific shared module, so each harness lands under one heading.
const byMod = new Map();
const count = new Map();
for (const r of rows) for (const m of r.mods) count.set(m, (count.get(m) || 0) + 1);
for (const r of rows) {
  // the rarest module it names is the most specific thing it is about
  const key = r.mods.length
    ? r.mods.slice().sort((a, b) => (count.get(a) - count.get(b)) || a.localeCompare(b))[0]
    : '(reads no module directly — source-shape checks only)';
  if (!byMod.has(key)) byMod.set(key, []);
  byMod.get(key).push(r.name);
}

const groups = [...byMod.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
console.log(`${rows.length} failing harness(es) grouped by the source they exercise\n`);
for (const [mod, list] of groups) {
  console.log(`${mod}  (${list.length})`);
  console.log('  ' + list.sort().join(' '));
  console.log('');
}
if (missing.length) {
  console.log(`not found in ${tree}/tests (${missing.length}): ${missing.join(' ')}`);
}
