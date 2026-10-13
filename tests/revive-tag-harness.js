// supernatural.js findCharacter: a '#TAG' resolves through the saved tag index before the online name search (13 Oct:
// '#XE62' returned an unrelated online actor and revive.json could not restore a permadead offline character).
//   node tests/revive-tag-harness.js
'use strict';
const fs = require('fs'); const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'supernatural.js'), 'utf8');
const i = src.indexOf('const findCharacter = (q) => {'); const j = src.indexOf('\n  };', i);
let fails = 0; const ok = (c, w, g) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${w}${c ? '' : '  ' + JSON.stringify(g)}`); if (!c) fails++; };
ok(i > 0 && j > i, 'findCharacter is in supernatural.js');
const body = src.slice(i, j + 5);
const make = (online, index) => new Function('findByName', 'mp', body + '\nreturn findCharacter;')((q) => online[q] || 0, { findFormsByPropertyValue: (k, v) => (k === 'private.indexed.tagKey' && index[v] ? [index[v]] : []) });
let f = make({ '#XE62': 0xff0077 }, { xe62: 0xab9 });
ok(f('#XE62') === 0xab9, '#TAG takes the saved index even when the online search would answer someone else', f('#XE62'));
f = make({ Jake: 0xab9 }, {});
ok(f('Jake') === 0xab9, 'a plain name still finds an online character');
f = make({ '#ZZZZ': 0x55 }, {});
ok(f('#ZZZZ') === 0x55, 'a #TAG not in the index falls back to the online search');
f = make({}, {});
ok(f('#NONE') === 0, 'nobody: 0');
console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
