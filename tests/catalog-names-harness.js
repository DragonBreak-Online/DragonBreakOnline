// Every name the admin catalogues show a player can be read. On 2 Nov, 25 Place-tab rows and 7 items were raw bytes
// (Nat saw them as boxes, and raising one logged "raised 1 x ;("): DragonBreak Creature Patch.esp, a normal plugin, carries
// the vanilla masters' 4-byte localized string ids as FULL, and the generators printed them as text. The generators now
// skip such a FULL (tooling/admin_placeables.py, ck-mcp/admin_catalog.py). This harness checks the files themselves: a name
// is printable, has an ASCII letter or digit, and is not only question marks. A copied id that happens to read as letters
// ("yR") passes here; only the generators, which read the plugins, can see that one.
// node tests/catalog-names-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };

const readable = (s) => typeof s === 'string' && s.length > 0 && !/[\u0000-\u001f\u007f-\u009f�]/.test(s) && /[A-Za-z0-9]/.test(s) && !/^[?\s]+$/.test(s);
const DESC = /^[0-9a-f]+:.+\.(esm|esp|esl)$/i;

// [desc, name, ...] rows anywhere in the file, and every "name" or "label" field
function names(x, out) {
  if (Array.isArray(x)) {
    if (x.length >= 2 && typeof x[0] === 'string' && DESC.test(x[0]) && typeof x[1] === 'string') out.push([x[0], x[1]]);
    for (const y of x) names(y, out);
  } else if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      if ((k === 'name' || k === 'label') && typeof v === 'string') out.push([x.world || x.id || x.desc || k, v]);
      else names(v, out);
    }
  }
  return out;
}

const FILES = ['admin-items.json', 'admin-placeables.json', 'admin-locations.json', 'admin-powers.json', 'decor-catalog.json'];
for (const f of FILES) {
  const file = path.resolve(__dirname, '..', f);
  ok(fs.existsSync(file), `${f} exists`);
  if (!fs.existsSync(file)) continue;
  const all = names(JSON.parse(fs.readFileSync(file, 'utf8')), []);
  ok(all.length > 0, `${f} has names to check`, all.length);
  const bad = all.filter(([, n]) => !readable(n));
  ok(bad.length === 0, `${f}: all ${all.length} names readable`, bad.slice(0, 12));
}

// The check itself must catch the shapes seen on 2 Nov
const seen = ['\u007f\u0018\u0001', ';(', '?\u0007', '????????', '†$', '÷ó', '.', 'Ã¤ Ã¶ �'];
ok(seen.every((s) => !readable(s)), 'the check refuses every unreadable shape seen on 2 Nov', seen.filter(readable));
ok(['Arch Necromancer', "Karstaag's Skull", 'Fort Pale Pass', '3BBB'].every(readable), 'and accepts ordinary names');

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
