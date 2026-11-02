// Splits admin-powers.json's spells and staffSpells into the tracked public file and the gitignored sidecar
// admin-powers.private.json (privaterows.js; Nat, 2 Nov: AI-forbidding mods' data stays off the public repo). Proves the
// split before writing: the public file holds no private row, and merging the two gives back the whole lists, in order.
// spellSources is recounted from the public spells. tooling/admin_catalog_merge.js splits the same way on --write.
//   node tooling/admin_powers_split.js [--write]      (from server/; without --write, a dry run)
'use strict';
const fs = require('fs');
const path = require('path');
const privaterows = require(path.resolve('privaterows.js'));

const FILE = path.resolve('admin-powers.json');
const KEYS = ['spells', 'staffSpells'];
const ascii = (s) => s.replace(/[\u007f-￿]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));

// The whole file: the tracked one with any sidecar already merged
const { data: whole } = privaterows.readMerged(FILE, KEYS);
const { pub, side } = privaterows.splitPowers(whole);

// Proof: no private row is public, and the merge restores every list exactly
const bad = KEYS.flatMap((k) => (pub[k] || []).filter(privaterows.isPrivateRow).map((r) => `${k} ${r[0]}`));
if (bad.length) { console.error('FAIL: private rows left in the public file:', bad.slice(0, 5)); process.exit(1); }
for (const k of KEYS) {
  if (!Array.isArray(whole[k])) continue;
  if (JSON.stringify(privaterows.mergeList(pub[k], side.lists[k] || [])) !== JSON.stringify(whole[k])) { console.error(`FAIL: merging ${k} does not give the whole list back`); process.exit(1); }
}
for (const k of KEYS) console.log(`${k}: ${(whole[k] || []).length} -> ${(pub[k] || []).length} public + ${(side.lists[k] || []).length} private`);
if (process.argv.includes('--write')) {
  const nl = fs.readFileSync(FILE, 'utf8').endsWith('\n') ? '\n' : '';
  fs.writeFileSync(FILE, ascii(JSON.stringify(pub, null, 1)) + nl);
  fs.writeFileSync(privaterows.sidecarOf(FILE), JSON.stringify(side, null, 1) + '\n');
  console.log('wrote', path.basename(FILE), 'and', path.basename(privaterows.sidecarOf(FILE)));
} else console.log('dry run; --write to write');
