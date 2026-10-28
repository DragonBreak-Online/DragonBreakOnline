// /fixloc moves an offline character too (Jake, 28 Oct: Neem #LBRF's game crashed about a minute after every login in
// Aubert's House, 6ca03:BSHeartland.esm, so no staff could catch them online). Runs the real findAnyByName and /fixloc
// handler cut from gamemode.js: an offline character is found by #TAG or by a unique name and moved to the hub, an
// ambiguous name asks for the #TAG, an unknown one is refused, and an online one moves as before.
//   node tests/fixloc-offline-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const cut = (from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i + 1); if (i < 0 || j < 0) { console.log(`FAIL ${from} not found in gamemode.js`); process.exit(1); } return src.slice(i, j); };

const ADMIN = 0xff000010, LYDIA = 0xff000020, NEEM = 0xff000030, BOB1 = 0xff000040, BOB2 = 0xff000050;
const NAMES = { [ADMIN]: 'Jake', [LYDIA]: 'Lydia', [NEEM]: 'Neem', [BOB1]: 'Bob', [BOB2]: 'Bob' };
const HUB = '17482:DragonBreak Hub.esp';
const props = new Map([[`${NEEM}|worldOrCellDesc`, '6ca03:BSHeartland.esm'], [`${LYDIA}|worldOrCellDesc`, 'a764b:BSHeartland.esm'], [`${ADMIN}|worldOrCellDesc`, '3c:Skyrim.esm']]);
const moves = [], said = [], cmds = new Map();
const online = [ADMIN, LYDIA];
const mp = {
  get: (id, k) => props.get(`${id >>> 0}|${k}`),
  set: (id, k, v) => { if (k === 'locationalData') { moves.push([id >>> 0, v]); props.set(`${id >>> 0}|worldOrCellDesc`, v.cellOrWorldDesc); } },
  findFormsByPropertyValue: (prop, v) => (prop === 'private.indexed.tagKey' ? (v === 'lbrf' ? [NEEM] : []) : prop === 'private.indexed.nameKey' ? (v === 'neem' ? [NEEM] : v === 'bob' ? [BOB1, BOB2] : v === 'lydia' ? [LYDIA] : []) : []),
};
// findByName finds only online characters, by their name (as gamemode.js does)
const findByName = (q) => online.find((a) => NAMES[a].toLowerCase() === String(q).trim().toLowerCase()) || 0;
const api = { mp, log: () => {}, personal: (a, t) => said.push([a, t]), nameOf: (a) => NAMES[a >>> 0] || '?', userOf: (a) => (online.includes(a >>> 0) ? 7 : -1),
  findByName, onlineActors: () => online.slice(), disguisedOf: () => false, registerChatCommand: (n, fn) => cmds.set(n, fn) };
new Function(...Object.keys(api), `${cut('const findAnyByName = ', '// ---- letters: kept in private.pigeons')}\n${cut("registerChatCommand('fixloc'", '// One line per online player on every reload')}`)(...Object.values(api));
const fixloc = (args) => { moves.length = 0; said.length = 0; cmds.get('fixloc')(ADMIN, args); return { moves: moves.slice(), said: said.map((x) => x[1]).join(' | ') }; };

let r = fixloc('#LBRF');
ok(r.moves.length === 1 && r.moves[0][0] === NEEM && r.moves[0][1].cellOrWorldDesc === HUB, 'an offline character named by #TAG is moved to the hub', r);
ok(/offline, was in 6ca03:BSHeartland\.esm/.test(r.said) && /next login/.test(r.said), "and staff are told it was offline, where it was, and that it arrives at its next login", r.said);
r = fixloc('Neem');
ok(r.moves.length === 1 && r.moves[0][0] === NEEM, 'an offline character named by a unique name is moved too', r);
r = fixloc('Bob');
ok(r.moves.length === 0 && /2 characters are called that; add their #TAG/.test(r.said), 'an ambiguous name moves nobody and asks for the #TAG', r);
r = fixloc('Nobody');
ok(r.moves.length === 0 && r.said === 'No such player.', 'an unknown name moves nobody', r);
props.set(`${LYDIA}|worldOrCellDesc`, 'a764b:BSHeartland.esm');
r = fixloc('Lydia');
ok(r.moves.length === 1 && r.moves[0][0] === LYDIA && /^Moved Lydia to the hub; server now says /.test(r.said), 'an online character moves as before, with the same reply', r);
r = fixloc('');
ok(r.moves.length === 1 && r.moves[0][0] === ADMIN, 'with no name it still moves the caller', r);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
