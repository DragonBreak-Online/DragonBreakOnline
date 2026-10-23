// Apiaries and beehives give honey on a timer (apiaries.js, Nate 23 Oct). Loads the real module with a fake mp and clock:
// a ready hive gives honeycomb (and maybe a bee or a husk) and is not opened; an early one says how long; the timers are
// per hive and survive a reload (apiaries.json); other containers are left alone.
//   node tests/apiaries-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-apiaries-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the OS */ } });
let fails = 0;
const ok = (c, t, g) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${t}${c || g === undefined ? '' : '   ' + JSON.stringify(g)}`); if (!c) fails++; };
let now = 1790000000000; Date.now = () => now;
Math.random = () => 0;   // every chance comes up
const PLUGINS = { 'Skyrim.esm': 0, 'HearthFires.esm': 4, 'BSAssets.esm': 7 };
const idOf = (d) => { const [h, p] = String(d).split(':'); return ((PLUGINS[p] << 24) | parseInt(h, 16)) >>> 0; };
const APIARY = 0x10, WILD = 0x11, CHEST = 0x12, P = 0xff000002;
const base = { [APIARY]: '12a54:HearthFires.esm', [WILD]: 'a918c:Skyrim.esm', [CHEST]: '1:Skyrim.esm' };
const given = [], said = [];
const mp = { getIdFromDesc: idOf, get: (id, prop) => (prop === 'baseDesc' ? base[id] : undefined) };
const api = { mp, log: () => {}, personal: (a, t) => said.push(t), audit: () => {}, who: String, cfg: {}, giveItem: (a, id, n) => { given.push([id, n]); return true; } };
const load = () => { delete globalThis.__dboApiaries; delete require.cache[path.resolve(__dirname, '..', 'apiaries.js')]; require(path.resolve(__dirname, '..', 'apiaries.js'))(api); };
load();
const act = (t) => globalThis.__dboApiaryActivate(t, P);
ok(act(CHEST) === false, 'another container opens as usual');
ok(act(APIARY) === true && given.some(([id, n]) => id === idOf('b08c5:Skyrim.esm') && n === 2) && given.some(([id]) => id === idOf('a9195:Skyrim.esm')) && /You gather 2 Honeycomb/.test(said.at(-1)), 'a ready apiary gives honeycomb (2 at the lowest roll) and a bee, and is not opened', { given, said });
given.length = 0; now += 30 * 60000;
ok(act(APIARY) === true && !given.length && /Come back in 30 minutes/.test(said.at(-1)), 'thirty minutes on, the bees need thirty more', said.at(-1));
ok(act(WILD) === true && given.length > 0, 'a wild beehive keeps its own timer');
load();
given.length = 0;
ok(act(APIARY) === true && !given.length && /Come back in 30 minutes/.test(said.at(-1)), 'the timer survives a reload (apiaries.json)');
now += 31 * 60000; given.length = 0;
ok(act(APIARY) === true && given.length > 0, 'after the hour the apiary gives honey again');
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
