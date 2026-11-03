// A player's own /unstuck must put them in the town they can walk around in. The town finder used each town's map marker,
// and the markers of the walled capitals (Solitude, Whiterun, Windhelm, Riften, Markarth) are in Tamriel, where the city
// is only its outer shell. par.lar (1 Nov, #bugs 1566458667048501341): "it sent me to the World Cell of Solitude not the
// actual Cell", stuck on the wall, and the next /unstuck sent them back to the same spot; eldritchkobold and kingsman4256333
// the same. Runs the real town finder cut from gamemode.js on the real territories.json, temples and gamemode-config.
//   node tests/unstuck-city-world-harness.js   (from server/; GAMEMODE=<file> runs it on another gamemode.js)
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(process.env.GAMEMODE || path.join(root, 'gamemode.js'), 'utf8');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

// The real tables, as gamemode.js builds them
const cut = (from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i); if (i < 0 || j < 0) throw new Error('gamemode.js lost ' + from); return src.slice(i, j); };
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'gamemode-config.json'), 'utf8'));
const tables = new Function('cfg', cut('const TEMPLE_DEFAULTS = {', '\nconst REGION_PLUGINS') + '\nreturn { TEMPLES, templeFor, normPlace, TAMRIEL_FRAME };')(cfg);
const { TEMPLES, templeFor, normPlace, TAMRIEL_FRAME } = tables;
const finder = cut('const UNSTUCK_TOWNS = ', "const unstuckActor = (a, by, refs = '') => {");
const P = {}, G = {};
const worlds = new Set([...TAMRIEL_FRAME, 'a764b:bsheartland.esm']);
new Function('fs', 'path', 'log', 'mp', 'globalThis', 'isWorldspace', 'normPlace', 'TEMPLES', 'TAMRIEL_FRAME', finder)(
  { readFileSync: (f) => fs.readFileSync(path.join(root, path.basename(f)), 'utf8') }, path, () => {}, { get: (a, k) => P[k] }, G,
  (w) => worlds.has(normPlace(w)), normPlace, TEMPLES, TAMRIEL_FRAME);
const town = (world, pos) => { P.worldOrCellDesc = world; P.pos = pos; P['private.lastOutside'] = null; return G.__dboUnstuckTown(1); };
const terr = JSON.parse(fs.readFileSync(path.join(root, 'territories.json'), 'utf8')).territories;
const T = (id) => terr.find((x) => x.id === id);

// 1. Standing in Tamriel's shell of a walled capital, by its marker: the capital's own worldspace, at its temple's street spot
for (const id of ['solitude', 'whiterun', 'windhelm', 'riften', 'markarth']) {
  const x = T(id), t = templeFor(id);
  const got = town(x.marker.world, x.marker.pos);
  ok(got && got.name === x.name && normPlace(got.world) === normPlace(t.world) && String(got.pos) === String(t.pos.slice(0, 3)),
    `${x.name}: /unstuck by its marker lands in ${t.world} at the temple street spot, not Tamriel's shell`, got);
  // 2. And /unstuck from there again stays in the city: before, the player was sent back to the wall every time
  const again = got && town(got.world, got.pos);
  ok(again && normPlace(again.world) === normPlace(t.world), `${x.name}: a second /unstuck from inside the city stays in the city`, again);
}
// 3. Inside a city worldspace (a player stuck in Whiterun's own streets) the nearest town is still found
{
  const got = town('1a26f:Skyrim.esm', [21000, -5000, -3000]);
  ok(got && got.name === 'Whiterun' && normPlace(got.world) === '1a26f:skyrim.esm', 'in Whiterun\'s own worldspace the nearest town is Whiterun, in that worldspace', got);
}
// 4. Towns that are in Tamriel itself keep their markers: the open capitals and every town and village
for (const id of ['falkreath', 'morthal', 'dawnstar', 'winterhold', 'riverwood', 'dragon-bridge', 'kynesgrove', 'ivarstead', 'karthwasten']) {
  const x = T(id); const got = town(x.marker.world, x.marker.pos);
  ok(got && got.name === x.name && got.world === x.marker.world && String(got.pos) === String(x.marker.pos.slice(0, 3)), `${x.name}: keeps its own marker in Tamriel`, got);
}
// 5. The Bruma region keeps its markers (one worldspace, no city worldspace)
for (const id of ['bruma', 'applewatch']) {
  const x = T(id); const got = town(x.marker.world, x.marker.pos);
  ok(got && got.world === x.marker.world && String(got.pos) === String(x.marker.pos.slice(0, 3)), `${x.name}: keeps its own marker in BSHeartland`, got);
}
// 6. No town the finder can return puts anyone in Tamriel within a walled capital's walls (5000 units of its temple)
{
  const walled = ['solitude', 'whiterun', 'windhelm', 'riften', 'markarth'].map(templeFor);
  const bad = [];
  for (const x of terr.filter((y) => ['capital', 'town', 'village'].includes(y.kind) && y.marker)) {
    const got = town(x.marker.world, x.marker.pos);
    if (got && normPlace(got.world) === '3c:skyrim.esm' && walled.some((t) => Math.hypot(t.pos[0] - got.pos[0], t.pos[1] - got.pos[1]) < 5000)) bad.push(x.name);
  }
  ok(!bad.length, 'no /unstuck town lands in Tamriel inside a walled capital', bad);
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
