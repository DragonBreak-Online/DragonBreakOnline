// Every key in gamemode-config's "supernatural" block must be one supernatural.js actually reads.
//   node tests/supernatural-config-harness.js   (from server/)
//
// C is Object.assign(DEFAULTS, cfg.supernatural), so a key the defaults do not name is merged in and never read: the
// setting silently does nothing and the default stands. That is how a balance change can look applied and not be
// (Nate, 13 Oct, raising infectWerewolf). Keys starting with _ are comments and are skipped.
'use strict';
const fs = require('fs');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 200)}`); if (!c) fails++; };

const src = fs.readFileSync(path.join(SERVER, 'supernatural.js'), 'utf8');
const cfg = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8')).supernatural || {};

// The DEFAULTS object literal: from "const C = Object.assign({" to the "}, cfg.supernatural" that closes it.
const start = src.indexOf('const C = Object.assign({');
const end = src.indexOf('}, cfg.supernatural', start);
ok(start > 0 && end > start, 'the defaults object is found in supernatural.js');
const defaults = src.slice(start, end);
const known = new Set([...defaults.matchAll(/(?:^|[{,\s])([A-Za-z][A-Za-z0-9]*)\s*:/g)].map((m) => m[1]));
// Some blocks are not in the defaults: they are merged on their own further down, as
// `C.feedPair = Object.assign({...}, (cfg.supernatural || {}).feedPair || {})` or read as `C.vampireRestoration`.
for (const m of src.matchAll(/\(cfg\.supernatural \|\| \{\}\)\.([A-Za-z][A-Za-z0-9]*)/g)) known.add(m[1]);
for (const m of src.matchAll(/\bC\.([A-Za-z][A-Za-z0-9]*)\b/g)) known.add(m[1]);

for (const key of Object.keys(cfg)) {
  if (key.startsWith('_')) continue;
  ok(known.has(key), `"${key}" is a setting supernatural.js reads`, key);
}
ok(known.has('infectWerewolf') && known.has('infectVampire'), 'the infection chances are among them');

// The value Nate set, and the shape of it: a probability per bite, not a percentage.
ok(cfg.infectWerewolf === 0.01, 'a werewolf bite infects at 1% (Nate, 13 Oct)', cfg.infectWerewolf);
for (const k of ['infectWerewolf', 'infectVampire', 'infectFeed', 'huntMarkChance']) {
  if (cfg[k] === undefined) continue;
  ok(typeof cfg[k] === 'number' && cfg[k] > 0 && cfg[k] <= 1, `${k} is a chance between 0 and 1, not a percentage`, cfg[k]);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
