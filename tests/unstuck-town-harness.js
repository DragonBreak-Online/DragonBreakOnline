// A player's own /unstuck goes to the nearest town marker (territories.json, Nat 31 Oct). A walled capital's marker is in
// Tamriel's frame but inside the city, which Tamriel draws with no floor, so those moves dropped players under Solitude and
// looped them there (#bugs 1568341368630415380, 1566458667048501341, about 25 such moves 5-6 Nov). Runs the real
// __dboUnstuckTown and temple table cut from gamemode.js, against the real territories.json.
//   node tests/unstuck-town-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

// From `from` up to `to`, which is kept only when keepTo
const cut = (from, to, keepTo) => {
  const s = src.indexOf(from);
  const e = s < 0 ? -1 : src.indexOf(to, s);
  if (s < 0 || e < 0) { console.log(`FAIL  marker gone from gamemode.js: ${from}`); process.exit(1); }
  return src.slice(s, keepTo ? e + to.length : e);
};
const temples = cut('const TEMPLE_DEFAULTS = {', '\nconst TAMRIEL_FRAME', false);
const towns = cut('const UNSTUCK_TOWNS = ', 'rotZ: 0 };\n};', true);

const WORLDS = new Set(['3c:skyrim.esm', '37edf:skyrim.esm', '1a26f:skyrim.esm', '1691d:skyrim.esm', '16bb4:skyrim.esm', '16d71:skyrim.esm', 'a764b:bsheartland.esm']);
const props = {};
const mp = { get: (a, k) => props[k] };
const G = {};
process.chdir(ROOT);
new Function('fs', 'path', 'mp', 'log', 'cfg', 'isWorldspace', 'globalThis', `${temples}\n${towns}\nreturn null;`)(
  fs, path, mp, () => {}, {}, (w) => WORLDS.has(String(w).toLowerCase()), G);
const town = G.__dboUnstuckTown;
ok(typeof town === 'function', 'the cut defines __dboUnstuckTown');

const at = (world, pos, lastOutside = null) => { props.worldOrCellDesc = world; props.pos = pos; props['private.lastOutside'] = lastOutside; return town(1); };

// The spot below Solitude the live log shows four unstucks from (6 Nov), and the shore at 19:06Z
let r = at('3c:Skyrim.esm', [-61560, 102400, -13533]);
ok(r && r.name === 'Solitude' && r.world === '37edf:Skyrim.esm', 'stuck below Solitude: moved into SolitudeWorld, not Tamriel', r);
ok(r && r.pos[0] === -58718.41 && r.pos[1] === 110638.56, '...at the temple door spot the dead wake at', r && r.pos);
r = at('3c:Skyrim.esm', [-46857, 111198, -14246]);
ok(r && r.world === '37edf:Skyrim.esm', 'the Solitude shore: SolitudeWorld too', r);
r = at('3c:Skyrim.esm', [19000, -7000, -3500]);
ok(r && r.name === 'Whiterun' && r.world === '1a26f:Skyrim.esm', 'beside Whiterun: WhiterunWorld', r);
r = at('3c:Skyrim.esm', [134000, 35000, -12400]);
ok(r && r.name === 'Windhelm' && r.world === '1691d:Skyrim.esm', 'beside Windhelm: WindhelmWorld', r);
r = at('3c:Skyrim.esm', [-174000, 5000, -3300]);
ok(r && r.name === 'Markarth' && r.world === '16d71:Skyrim.esm', 'beside Markarth: MarkarthWorld', r);
r = at('16a02:Skyrim.esm', [0, 0, 0], { world: '3c:Skyrim.esm', pos: [173000, -96000, 11100] });
ok(r && r.name === 'Riften' && r.world === '16bb4:Skyrim.esm', 'indoors, last outside beside Riften: RiftenWorld', r);

// Towns whose temple is another city's (TEMPLES aliases) keep their own marker in Tamriel
r = at('3c:Skyrim.esm', [-38600, 66700, -13200]);
ok(r && r.name === 'Morthal' && r.world === '3c:Skyrim.esm' && r.pos[0] === -38640, 'beside Morthal: Morthal\'s marker, never Solitude\'s temple', r);
r = at('3c:Skyrim.esm', [30800, 106100, -13900]);
ok(r && r.name === 'Dawnstar' && r.world === '3c:Skyrim.esm', 'beside Dawnstar: Dawnstar\'s marker, never Windhelm\'s temple', r);
r = at('3c:Skyrim.esm', [110800, 102900, -9000]);
ok(r && r.name === 'Winterhold' && r.world === '3c:Skyrim.esm', 'beside Winterhold: Winterhold\'s marker', r);
// A town of a walled capital's hold keeps its own marker: its zone is the hold's, never a reason to go to the city
r = at('3c:Skyrim.esm', [76300, -64200, 10800]);
ok(r && r.name === 'Ivarstead' && r.world === '3c:Skyrim.esm' && r.pos[0] === 76375, 'beside Ivarstead (zone riften): Ivarstead, never the Riften temple', r);
r = at('3c:Skyrim.esm', [21900, -44700, -140]);
ok(r && r.name === 'Riverwood' && r.world === '3c:Skyrim.esm', 'beside Riverwood (zone whiterun): Riverwood', r);
r = at('3c:Skyrim.esm', [-102000, 83000, -12200]);
ok(r && r.name === 'Dragon Bridge' && r.world === '3c:Skyrim.esm', 'beside Dragon Bridge (zone solitude): Dragon Bridge', r);
r = at('3c:Skyrim.esm', [-30300, -86300, -3100]);
ok(r && r.name === 'Falkreath' && r.world === '3c:Skyrim.esm' && r.pos[0] === -30296, 'beside Falkreath (no walls): its marker, as before', r);

// Inside a city's own worldspace there is no marker of that world: null, so the zone's temple is used as before
r = at('37edf:Skyrim.esm', [-60000, 105000, -8000]);
ok(r === null, 'inside SolitudeWorld itself: no town, the temple as before', r);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
