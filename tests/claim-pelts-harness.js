// gamemode.js __dboClaimPelts (Nate, 18 Oct: "bounties pay back"): a contract kill's pelts and hides come off the skinning
// stash for the hold, never a small creature's part nor a dragon's. Lifts the function out of gamemode.js with stubs.
//   node tests/claim-pelts-harness.js   (from server/)
'use strict';
const fs = require('fs'); const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'gamemode.js'), 'utf8');
const start = src.indexOf('globalThis.__dboClaimPelts = '); const end = src.indexOf('const peltValueCache = new Map();', start);
let fails = 0; const ok = (l, c, g) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${l}${!c && g !== undefined ? `: got ${JSON.stringify(g)}` : ''}`); if (!c) fails++; };
ok('__dboClaimPelts is in gamemode.js', start > 0 && end > start);
const REC = { 1: ['MISC', 'WolfPelt', 10], 2: ['MISC', 'BearCavePelt', 25], 3: ['INGR', 'MudcrabChitin', 2], 4: ['MISC', 'DragonBone', 500] };
const props = new Map();
const mp = { get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v) };
const recordOf = (id) => (REC[id] ? { record: { type: REC[id][0], editorId: REC[id][1] } } : null);
const peltValue = (id) => (REC[id] ? REC[id][2] : 0);
const PELT = /pelt|hide|skin$|fur$|pelts$/i;
new Function('mp', 'recordOf', 'peltValue', 'PELT', src.slice(start, end))(mp, recordOf, peltValue, PELT);
const B = 0xff000100;
props.set(`${B}|private.dboPelts`, [{ baseId: 1, count: 2 }, { baseId: 2, count: 1 }]);
let r = globalThis.__dboClaimPelts(B);
ok('two wolf pelts and a bear pelt: 3 claimed, worth 45', r && r.count === 3 && r.value === 45, r);
ok('...and the stash is empty, so nobody skins them', props.get(`${B}|private.dboPelts`).length === 0);
props.set(`${B}|private.dboPelts`, [{ baseId: 3, count: 1 }]);
r = globalThis.__dboClaimPelts(B);
ok('a mudcrab\'s chitin is not a pelt: nothing claimed, the stash kept', r && r.count === 0 && props.get(`${B}|private.dboPelts`).length === 1, r);
props.set(`${B}|private.dboPelts`, [{ baseId: 4, count: 1, dragon: true }]);
r = globalThis.__dboClaimPelts(B);
ok('dragon parts are never claimed', r && r.count === 0 && props.get(`${B}|private.dboPelts`).length === 1, r);
props.delete(`${B}|private.dboPelts`);
ok('no stash yet: null', globalThis.__dboClaimPelts(B) === null);
console.log(fails ? `${fails} FAILED` : 'all checks passed'); process.exit(fails ? 1 : 0);
