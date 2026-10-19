'use strict';
// gamemode.js officials-seats.json (Nate, 19 Oct: Misfit_Panda's every character was Whiterun's Steward): a seat bound to a
// character counts for that character only; an unbound seat still counts for the account; ranksOf(profileId) alone lists
// every seat. Loads the real code with stubs. Run from the server folder: node tests/office-per-character-harness.js
const fs = require('fs'); const os = require('os'); const path = require('path');
const GM = fs.readFileSync(path.join(__dirname, '..', 'gamemode.js'), 'utf8');
let fail = 0; const ok = (c, n, g) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${!c && g !== undefined ? '   ' + JSON.stringify(g) : ''}`); if (!c) fail++; };
const code = GM.slice(GM.indexOf("const SEATS_PATH = path.resolve('officials-seats.json');"), GM.indexOf('globalThis.__dboSeatHolder = seatHolder;'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-seats-')); const here = process.cwd(); process.chdir(dir);
const officials = { whiterun: { steward: [55], jarl: [167] } };
const zones = [{ id: 'whiterun', officials: ['jarl', 'steward'] }];
const { ranksOf, bindSeat, seatHolder } = new Function('fs', 'path', 'readOfficials', 'zoneList', 'profileOf', 'log',
  `${code}; return { ranksOf, bindSeat, seatHolder };`)(fs, path, () => officials, () => zones, () => -1, () => {});
const MISTA = 0xff000746, PIPPIN = 0xff000999, UHTRED = 0xff001275;
ok(ranksOf(55, PIPPIN).length === 1, 'before binding, any character of the account holds the seat (as before)');
bindSeat('whiterun', 'steward', 55, MISTA);
ok(seatHolder('whiterun', 'steward', 55) === MISTA, 'the seat names Mista Bojangles');
ok(ranksOf(55, MISTA).map((m) => m.rank).join() === 'steward', 'Mista Bojangles is Steward');
ok(ranksOf(55, PIPPIN).length === 0, 'Pippin the Tall, same account, is not');
ok(ranksOf(55).length === 1, 'ranksOf(profileId) alone still lists the account\'s seat (staff lists)');
ok(ranksOf(167, UHTRED).length === 1, 'an unbound seat (the Jarl) still counts for its account');
bindSeat('whiterun', null, 55, 0);
ok(seatHolder('whiterun', 'steward', 55) === 0, 'unseating clears the binding');
ok(fs.existsSync(path.join(dir, 'officials-seats.json')), 'the binding is kept in officials-seats.json');
process.chdir(here);
console.log(fail ? `${fail} failed` : 'all checks passed'); process.exit(fail ? 1 : 0);
