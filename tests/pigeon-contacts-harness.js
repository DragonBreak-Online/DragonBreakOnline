// Who a pigeon can reach (gamemode.js pigeonContactsOf, 19 Oct): met in person, or introduced (playermenu.js ff_knownIds)
//   node tests/pigeon-contacts-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const gm = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const line = (name) => { const i = gm.indexOf(`const ${name} = `); return gm.slice(i, gm.indexOf('\n', i)); };
const props = new Map();
const mp = { get: (a, k) => props.get(`${a}|${k}`) };
const metOf = (a) => props.get(`${a}|private.metActors`) || [];
const { pigeonContactsOf } = new Function('mp', 'metOf', `${line('introducedTo')}\n${line('introducedBoth')}\n${line('pigeonContactsOf')}\nreturn { pigeonContactsOf };`)(mp, metOf);
let fails = 0;
const ok = (c, t, g) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${t}${c ? '' : '   ' + JSON.stringify(g)}`); if (!c) fails++; };
const A = 0xff000001, B = 0xff000002, C = 0xff000003, D = 0xff000004;
props.set(`${A}|private.metActors`, [B]);
props.set(`${A}|ff_knownIds`, [C, B, A, D]);
props.set(`${C}|ff_knownIds`, [A]);   // C and A introduced each other; D introduced themself to A, A never to D
const got = pigeonContactsOf(A).sort();
ok(JSON.stringify(got) === JSON.stringify([B, C].sort()), 'met (B) and introduced both ways (C) are contacts, once each, never oneself', got);
ok(!pigeonContactsOf(A).includes(D), 'one-way introduction (D to A only) is not enough');
ok(pigeonContactsOf(C).includes(A), 'and it works from both sides');
props.set(`${D}|ff_knownIds`, { marker: true });
ok(pigeonContactsOf(D).length === 0, 'a staff real-names marker is not a list');
ok(/!pigeonContactsOf\(a\)\.includes\(to >>> 0\)/.test(gm) && /for \(const id of pigeonContactsOf\(a\)\)/.test(gm), 'sendPigeon and the coop window both use it');
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
