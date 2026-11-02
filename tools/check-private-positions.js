// Refuses coordinates read from the plugins of mods whose authors forbid AI work (Druadach, Summerset Isle, King of the
// Murkmire, Journey to Baan Malur) in a tracked JSON file (Nat, 2 Nov: such positions stay private on the server, never in
// this public repo; they go in a gitignored file such as territory-positions.json). An object counts when it names one of
// those plugins in a form desc ("12c4:Druadach.esm") and carries a position: pos, position, center or x and y.
//   node tools/check-private-positions.js --staged      what is staged (the pre-commit hook): only positions the commit
//                                                       adds, so a file that already holds some (dungeons.json and four
//                                                       others, 2 Nov) can still be edited until they are moved out
//   node tools/check-private-positions.js <file.json>...
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');

const PRIVATE_PLUGIN = /:(druadach\d*\.es[mp]|summersetisles\.esp|summersetfixes\.esp|king of the murkmire[^:]*\.esp|murkmire official housing pack\.esp|journey to baan malur[^:]*\.esp|baan ?malur[^:]*\.esp)$/i;
const isNums = (v, n) => Array.isArray(v) && v.length >= n && v.slice(0, n).every((x) => typeof x === 'number');
const hasPosition = (o) => isNums(o.pos, 2) || isNums(o.position, 2) || isNums(o.center, 2) || (typeof o.x === 'number' && typeof o.y === 'number');
const namesPrivate = (o) => Object.values(o).some((v) => typeof v === 'string' && PRIVATE_PLUGIN.test(v.trim()));

// Every object holding a position, or holding one through a nested object that names the plugin (a territory's marker)
const findings = (value, where, out) => {
  if (Array.isArray(value)) { value.forEach((v, i) => findings(v, `${where}[${i}]`, out)); return out; }
  if (!value || typeof value !== 'object') return out;
  if (namesPrivate(value) && hasPosition(value)) out.push({ where, sig: JSON.stringify([value.pos, value.position, value.center, value.x, value.y, Object.values(value).filter((v) => typeof v === 'string' && PRIVATE_PLUGIN.test(v.trim()))]) });
  for (const [k, v] of Object.entries(value)) findings(v, `${where}.${k}`, out);
  return out;
};

const check = (name, text) => {
  let data;
  try { data = JSON.parse(text); } catch (e) { return []; }
  return findings(data, name, []);
};

const files = process.argv.slice(2);
let bad = [];
if (files[0] === '--staged') {
  const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], { encoding: 'utf8' }).split('\n').filter((f) => /\.json$/i.test(f));
  const show = (rev) => { try { return execFileSync('git', ['show', rev], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return ''; } };
  for (const f of staged) {
    const before = new Set(check(f, show(`HEAD:${f}`)).map((x) => x.sig));
    bad = bad.concat(check(f, show(`:${f}`)).filter((x) => !before.has(x.sig)));
  }
} else {
  for (const f of files) bad = bad.concat(check(f, fs.readFileSync(f, 'utf8')));
}
for (const b of bad) console.error(`private position: ${b.where} gives a position read from a plugin whose author forbids AI work`);
if (bad.length) console.error('Keep it in a gitignored file (territory-positions.json); see the comment at the top of tools/check-private-positions.js');
process.exit(bad.length ? 1 : 0);
