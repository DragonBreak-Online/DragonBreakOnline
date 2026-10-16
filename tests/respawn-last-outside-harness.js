// A death in a worldspace with no zone (Blackreach, ShadowgreenCavernWorld, AlftandWorld) must still wake at the temple
// of the land around it. The 'outside' timer recorded every worldspace as the last outdoor spot, so Blackreach overwrote
// Tamriel, the death found no zone, and the spawn point stayed at the Bruma cathedral (16 Oct 07:40, Dreams-In-Twilight
// #RGEZ in ShadowgreenCavernWorld 2a9d8 after the Solitude Sewers; 10:47 Masked Person #LBRF in Blackreach 1ee62).
// Runs the real zone and temple code cut from gamemode.js on stubs.
//   node tests/respawn-last-outside-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i); if (i < 0 || j < 0) { console.log(`FAIL  marker gone: ${a}`); process.exit(1); } return src.slice(i, j); };
const zoneSrc = cut('const TEMPLE_DEFAULTS = {', '\nconst ZONE_CELLS = ');
const placeSrc = cut('const isWorldspace = (desc) => {', '\n// ---- /unstuck');
const deathSrc = cut('const setDeathTemple = (a) => {', '\n\n// ---- deaths');

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

const ZONES = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'zones.json'), 'utf8'));
const WRLD = new Set(['3c:Skyrim.esm', '37edf:Skyrim.esm', '1a26f:Skyrim.esm', '1ee62:Skyrim.esm', '2a9d8:Skyrim.esm', '69857:Skyrim.esm', 'a764b:BSHeartland.esm']);
const A = 0xff000c5f;
const props = { profileId: 191, spawnPoint: { cellOrWorldDesc: 'a764b:BSHeartland.esm', pos: [59150, 201644, 7560] } };
const logs = [];
const mp = {
  get: (a, k) => props[k],
  set: (a, k, v) => { props[k] = v; },
  getIdFromDesc: (d) => d,
};
const recordOf = (d) => (WRLD.has(d) ? { record: { type: 'WRLD' } } : { record: { type: 'CELL' } });
let timerFn = null;
const body = `${zoneSrc}\n const ZONE_CELLS = new Map(); const zoneOfCell = () => null;\n${placeSrc}\n${deathSrc}\n return { noteOutside, zoneOfActor, setDeathTemple, timer: timerFn };`;
const api = new Function('cfg', 'mp', 'recordOf', 'ZONES', 'every', 'onlineActors', 'log', 'display', 'timerFn', body)(
  {}, mp, recordOf, ZONES, (n, ms, fn) => { if (n === 'outside') timerFn = fn; }, () => [A], (t) => logs.push(t), () => 'Dreams-In-Twilight #RGEZ', null);
ok(typeof api.noteOutside === 'function' && typeof timerFn === 'function', 'the outside timer is registered and calls noteOutside');

const at = (world, pos) => { props.worldOrCellDesc = world; props.pos = pos; timerFn(); };
// Outside on Tamriel by the Solitude Sewers entrance, then the sewers (interior), then ShadowgreenCavernWorld
at('3c:Skyrim.esm', [-61000, 104000, -8000]);
ok(props['private.lastOutside'] && props['private.lastOutside'].world === '3c:Skyrim.esm', 'Tamriel is recorded as the last outdoor spot');
at('31897:Skyrim.esm', [0, 0, 0]);
at('2a9d8:Skyrim.esm', [500, 800, -200]);
ok(props['private.lastOutside'].world === '3c:Skyrim.esm', 'ShadowgreenCavernWorld (no zone) does not overwrite it', props['private.lastOutside']);
ok(api.zoneOfActor(A) === 'solitude', 'a player in ShadowgreenCavernWorld is in the Solitude zone', api.zoneOfActor(A));
api.setDeathTemple(A);
ok(props.spawnPoint.cellOrWorldDesc === '37edf:Skyrim.esm', 'dying there wakes at the Temple of the Divines in Solitude', props.spawnPoint);

// Whiterun, then Blackreach
at('1a26f:Skyrim.esm', [24000, -3400, -2970]);
at('1ee62:Skyrim.esm', [10000, 20000, -3000]);
ok(props['private.lastOutside'].world === '1a26f:Skyrim.esm', 'Blackreach does not overwrite Whiterun', props['private.lastOutside']);
api.setDeathTemple(A);
ok(props.spawnPoint.cellOrWorldDesc === '1a26f:Skyrim.esm', 'a death in Blackreach wakes at the Whiterun temple, not the old spot', props.spawnPoint);

// Bruma still counts by its region
at('a764b:BSHeartland.esm', [59000, 202000, 7480]);
ok(props['private.lastOutside'].world === 'a764b:BSHeartland.esm' && api.zoneOfActor(A) === 'bruma', 'Bruma is still recorded and still the bruma zone');

// No zone and nothing recorded: the spawn point stays, with a log line saying so
delete props['private.lastOutside']; props.spawnPoint = { cellOrWorldDesc: 'x' }; props.worldOrCellDesc = '1ee62:Skyrim.esm';
api.setDeathTemple(A);
ok(props.spawnPoint.cellOrWorldDesc === 'x' && logs.some((l) => /no zone at 1ee62:Skyrim\.esm; the spawn point stays/.test(l)), 'with no zone at all it logs the place and leaves the spawn point', logs);

console.log(fails ? `\n${fails} check(s) FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
