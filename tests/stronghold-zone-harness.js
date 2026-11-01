// gamemode.js zoneAtPlace against the fork's own zoneAt (skymp5-server/ts/systems/zones.ts, compiled here with esbuild), so
// the gameplay layer (zoneOfActor: guards, citizenship, consequences) and the fork's systems (property, locks, Hold Notices)
// agree on every place (Nat, 1 Nov: strongholds honoured in both). Both read this repo's zones.json. Checked:
//   - every cell of the Tamriel grid, and points a few units inside and outside every stronghold's radius;
//   - sovereignty.strongholdsOverrideHolds false (the holds only), overlapping rings (the first listed), the city worldspaces,
//     a region's worldspace;
//   - holdAtPlace is the nearest capital everywhere, never a stronghold;
//   - the callers that mean geography (temples, weather, howls, bosses, gatherings, runners) use holdOfActor.
//   node tests/stronghold-zone-harness.js        (the fork beside this repo, or at $FORK_SERVER / $FORK)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const forkDir = [process.env.FORK_SERVER, process.env.FORK, path.resolve(ROOT, '..', 'fork'), 'E:/DragonBreak Online Dev files/fork'].find((p) => p && fs.existsSync(path.join(p, 'skymp5-server', 'ts', 'systems', 'zones.ts')));
const esbuildDir = forkDir && path.join(forkDir, 'skymp5-server', 'node_modules', 'esbuild');
if (!forkDir || !fs.existsSync(esbuildDir)) { console.log('SKIP stronghold-zone (no fork with esbuild beside this repo)'); process.exit(0); }

let fails = 0, oks = 0;
const ok = (c, what, detail) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && detail !== undefined ? '   ' + JSON.stringify(detail).slice(0, 600) : ''}`); if (c) oks++; else fails++; };

// ---- the fork's zone code, compiled, over a given zones.json ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-strongholdzone-'));
const forkJs = path.join(tmp, 'zones.js');
require(esbuildDir).buildSync({ entryPoints: [path.join(forkDir, 'skymp5-server', 'ts', 'systems', 'zones.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: forkJs, logLevel: 'silent' });
const ZM = require(forkJs);
const forkZones = (json) => {
  const d = fs.mkdtempSync(path.join(tmp, 'z-'));
  fs.writeFileSync(path.join(d, 'zones.json'), JSON.stringify(json));
  const was = process.cwd(); process.chdir(d);
  try { return new ZM.Zones(() => {}); } finally { process.chdir(was); }
};

// ---- gamemode.js's, cut out verbatim and run ----
const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');
const cut = (start) => {
  const i = src.indexOf(start); if (i < 0) throw new Error('not in gamemode.js: ' + start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{' || ch === '(' || ch === '[') depth++; else if (ch === '}' || ch === ')' || ch === ']') depth--;
    else if (ch === ';' && depth === 0) return src.slice(i, j + 1);
  }
  throw new Error('unterminated: ' + start);
};
const gameSrc = ['const normPlace = ', 'const TAMRIEL_FRAME = ', 'const isWorldspace = ', 'const holdAtPlace = ', 'const zoneAtPlace = '].map(cut).join('\n');
const WORLDS = new Set(['3c:skyrim.esm', '1a26f:skyrim.esm', '1691d:skyrim.esm', '16bb4:skyrim.esm', '16d71:skyrim.esm', '37edf:skyrim.esm', 'a764b:bsheartland.esm']);
const gameZones = (json) => new Function('ZONES', 'zoneOfCell', 'worldKind', 'mp', 'recordOf', `${gameSrc}\nreturn { holdAtPlace, zoneAtPlace };`)(
  json, () => null, new Map(), { getIdFromDesc: (d) => d }, (d) => (WORLDS.has(String(d).toLowerCase()) ? { record: { type: 'WRLD' } } : null));

const ZONES = JSON.parse(fs.readFileSync(path.join(ROOT, 'zones.json'), 'utf8'));
const TAM = '3c:Skyrim.esm';
const parity = (json, world, label, extraPoints) => {
  const F = forkZones(json), G = gameZones(json);
  let n = 0; const bad = [];
  const one = (x, y) => {
    n++;
    const f = F.zoneAt(world, [x, y, 0]); const g = G.zoneAtPlace(world, [x, y, 0]);
    if ((f ? f.id : null) !== g) bad.push([Math.round(x), Math.round(y), f ? f.id : null, g]);
  };
  for (let cy = -64; cy < 64; cy++) for (let cx = -64; cx < 64; cx++) one((cx + 0.5) * 4096, (cy + 0.5) * 4096);
  for (const s of json.strongholds || []) {
    if (!Array.isArray(s.center) || !(s.radius > 0)) continue;
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      for (const dr of [-50, -2, -0.01, 0, 0.01, 2, 50]) one(s.center[0] + Math.cos(a) * (s.radius + dr), s.center[1] + Math.sin(a) * (s.radius + dr));
    }
    one(s.center[0], s.center[1]);
  }
  for (const [x, y] of extraPoints || []) one(x, y);
  ok(bad.length === 0, `${label}: zoneAtPlace agrees with the fork's zoneAt at all ${n} points`, bad.slice(0, 10));
  return { F, G, n };
};

// ---- the live zones.json ----
const live = parity(ZONES, TAM, 'live zones.json, Tamriel');
const inRing = (ZONES.strongholds || []).map((s) => live.G.zoneAtPlace(TAM, s.center));
ok(inRing.every((z, i) => z === ZONES.strongholds[i].id) && inRing.length === 6, 'each stronghold\'s centre is the stronghold now', inRing);
const holdsOnly = (ZONES.strongholds || []).map((s) => live.G.holdAtPlace(TAM, s.center));
ok(holdsOnly.every((z) => (ZONES.holds || []).some((h) => h.id === z)), 'holdAtPlace there is a hold (geography), never a stronghold', holdsOnly);
parity(ZONES, '1a26f:Skyrim.esm', 'live zones.json, a city worldspace (Whiterun)');
const bruma = live.G.zoneAtPlace('a764b:BSHeartland.esm', [0, 0, 0]), forkBruma = live.F.zoneAt('a764b:BSHeartland.esm', [0, 0, 0]);
ok(bruma === 'bruma' && forkBruma && forkBruma.id === 'bruma', 'a region\'s worldspace is the region in both', [bruma, forkBruma && forkBruma.id]);
// a stronghold's ring is Tamriel's: in another worldspace the same coordinates stay that worldspace's region
const regionAtRing = (ZONES.strongholds || []).map((s) => [live.G.zoneAtPlace('a764b:BSHeartland.esm', s.center), (live.F.zoneAt('a764b:BSHeartland.esm', s.center) || {}).id]);
ok(regionAtRing.every(([g, f]) => g === 'bruma' && f === 'bruma'), '...even at a stronghold\'s coordinates', regionAtRing);

// ---- the switch, and overlapping rings ----
const off = JSON.parse(JSON.stringify(ZONES)); off.sovereignty = Object.assign({}, off.sovereignty, { strongholdsOverrideHolds: false });
const offRun = parity(off, TAM, 'strongholdsOverrideHolds false');
ok((off.strongholds || []).every((s) => (off.holds || []).some((h) => h.id === offRun.G.zoneAtPlace(TAM, s.center))), '...then every stronghold\'s centre is its hold again');
const lap = JSON.parse(JSON.stringify(ZONES));
const s0 = lap.strongholds[0];
lap.strongholds.push({ id: 'second-ring', name: 'Second Ring', center: [s0.center[0] + 1000, s0.center[1], 0], radius: 6000, officials: [] });
const lapRun = parity(lap, TAM, 'two overlapping rings', [[s0.center[0] + 500, s0.center[1]], [s0.center[0] + 6500, s0.center[1]]]);
ok(lapRun.G.zoneAtPlace(TAM, [s0.center[0] + 500, s0.center[1], 0]) === s0.id && lapRun.G.zoneAtPlace(TAM, [s0.center[0] + 6500, s0.center[1], 0]) === 'second-ring', '...the first listed wins where they overlap, the second beyond the first');
ok(live.G.zoneAtPlace(TAM, null) === null && live.G.zoneAtPlace(TAM, [NaN, 0]) === live.G.holdAtPlace(TAM, [NaN, 0]), 'no position, or not a number: no stronghold is guessed');

// ---- holdAtPlace is the nearest capital everywhere ----
let hb = 0;
for (let cy = -64; cy < 64; cy += 2) for (let cx = -64; cx < 64; cx += 2) {
  const x = (cx + 0.5) * 4096, y = (cy + 0.5) * 4096;
  let best = null, bd = Infinity;
  for (const h of ZONES.holds) { const d = Math.hypot(x - h.capital[0], y - h.capital[1]); if (d < bd) { bd = d; best = h.id; } }
  if (live.G.holdAtPlace(TAM, [x, y, 0]) !== best) hb++;
}
ok(hb === 0, 'holdAtPlace is the nearest capital at every sample', hb);

// ---- the wiring ----
const has = (file, re) => re.test(fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n'));
ok(has('gamemode.js', /const zoneOfActor = \(a\) => placeOfActor\(a, zoneAtPlace\);/) && has('gamemode.js', /const holdOfActor = \(a\) => placeOfActor\(a, holdAtPlace\);/), 'zoneOfActor is the sovereign zone, holdOfActor the geographic hold');
ok(has('gamemode.js', /const zone = holdOfActor\(a\);\n  if \(zone && !isHoldZone\(zone\)\) return zone;/), 'a respawn temple is chosen by the hold around a stronghold');
for (const mod of ['WORLDCLOCK_JS', 'GREATHUNT_JS', 'BOSSES_JS', 'HERALDS_JS', 'DISPATCHES_JS']) {
  const i = src.indexOf(`require(${mod})({`);
  ok(i >= 0 && src.slice(i, src.indexOf('});', i)).includes('zoneOfActor, holdOfActor'), `${mod} is given holdOfActor`);
}
ok(has('worldclock.js', /const zoneOf = \(a\) => \{ try \{ return holdOfActor\(a\);/), 'the weather follows the hold, not the ring');
ok(has('greathunt.js', /here = zoneKey\(holdOfActor\(a\)\)/) && has('bosses.js', /const v = holdOfActor\(a\);/), 'howls and bosses are heard across the hold');
ok(has('heralds.js', /api\.holdOfActor/) && has('dispatches.js', /api\.holdOfActor/), 'gatherings and runners count by the hold');

console.log(fails ? `\n${fails} failed` : `\nall passed (${oks})`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* left for the OS */ }
process.exit(fails ? 1 : 0);
