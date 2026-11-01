// Real hold borders (Leader, 1 Nov, Nat: "do what you recommend"): every Tamriel cell's hold from the game's own data
// (hold-cells.json beside zones.json, made by _work/map-borders/tools/hold_cells.py), read by the fork's zoneAt
// (skymp5-server/ts/systems/zones.ts, compiled here with esbuild) and by gamemode.js's zoneAtPlace / holdAtPlace, behind
// zones.json's sovereignty.holdsFromCells. Checked:
//   - with a synthetic table (no game data, so it runs anywhere): the table's validation, the cell arithmetic at cell edges
//     and negative coordinates, strongholds still winning inside their radius, a "." cell and a missing or broken table
//     falling back to the nearest capital, the switch off meaning nearest capital, and the gamemode never ahead of the
//     fork: it uses the table only as the fork published it (globalThis.__dboHoldCells), never the file;
//   - with the real table (its path as the first argument, or $HOLD_CELLS): both functions answer the table's hold at
//     three points of every cell outside the strongholds' radii, 0 mismatches;
//   - with a map build too (second argument: a borders_cells.py output with holdraster.bin): the map's hold at every
//     cell centre is the table's, 0 mismatches.
//   node tests/hold-cells-harness.js [hold-cells.json] [map build dir]   (the fork beside this repo, or $FORK_SERVER / $FORK)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const forkDir = [process.env.FORK_SERVER, process.env.FORK, path.resolve(ROOT, '..', 'fork'), 'E:/DragonBreak Online Dev files/fork'].find((p) => p && fs.existsSync(path.join(p, 'skymp5-server', 'ts', 'systems', 'zones.ts')));
const esbuildDir = [forkDir && path.join(forkDir, 'skymp5-server', 'node_modules', 'esbuild'), 'E:/DragonBreak Online Dev files/fork/skymp5-server/node_modules/esbuild'].find((p) => p && fs.existsSync(p));
if (!forkDir || !esbuildDir) { console.log('SKIP hold-cells (no fork with esbuild beside this repo)'); process.exit(0); }
const REAL = process.argv[2] || process.env.HOLD_CELLS || '';
const MAP = process.argv[3] || '';

let fails = 0, oks = 0;
const ok = (c, what, detail) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && detail !== undefined ? '   ' + JSON.stringify(detail).slice(0, 500) : ''}`); if (c) oks++; else fails++; };

// ---- the fork's zone code ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-holdcells-'));
const forkJs = path.join(tmp, 'zones.js');
require(esbuildDir).buildSync({ entryPoints: [path.join(forkDir, 'skymp5-server', 'ts', 'systems', 'zones.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: forkJs, logLevel: 'silent' });
const ZM = require(forkJs);
const logs = [];
const forkZones = (zonesJson, cells) => {
  const d = fs.mkdtempSync(path.join(tmp, 'z-'));
  fs.writeFileSync(path.join(d, 'zones.json'), JSON.stringify(zonesJson));
  if (cells !== undefined) fs.writeFileSync(path.join(d, 'hold-cells.json'), typeof cells === 'string' ? cells : JSON.stringify(cells));
  const was = process.cwd(); process.chdir(d);
  try { return new ZM.Zones((...a) => logs.push(a.join(' '))); } finally { process.chdir(was); }
};

// ---- the gamemode's, cut out verbatim ----
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
const gameSrc = ['const normPlace = ', 'const TAMRIEL_FRAME = ', 'const isWorldspace = ', 'const cellHoldOf = ', 'const holdAtPlace = ', 'const zoneAtPlace = '].map(cut).join('\n');
const WORLDS = new Set(['3c:skyrim.esm', '1a26f:skyrim.esm', 'a764b:bsheartland.esm']);
const gameZones = (json) => new Function('ZONES', 'zoneOfCell', 'worldKind', 'mp', 'recordOf', `${gameSrc}\nreturn { holdAtPlace, zoneAtPlace };`)(
  json, () => null, new Map(), { getIdFromDesc: (d) => d }, (d) => (WORLDS.has(String(d).toLowerCase()) ? { record: { type: 'WRLD' } } : null));
const TAM = '3c:Skyrim.esm', CITY = '1a26f:Skyrim.esm';

// ---- a synthetic world: three holds, a 4 x 4 cell table from cell -2 to 1, one stronghold ----
const ZS = {
  holds: [{ id: 'aa', name: 'A', capital: [-6000, 6000, 0] }, { id: 'bb', name: 'B', capital: [6000, 6000, 0] }, { id: 'cc', name: 'C', capital: [0, -7000, 0] }],
  strongholds: [{ id: 'ss', name: 'S', center: [4096 * 1.5, -4096 * 1.5, 0], radius: 1000 }],
  regions: [{ id: 'rr', name: 'R', worldspaces: ['a764b:BSHeartland.esm'] }],
  sovereignty: { strongholdsOverrideHolds: true, holdsFromCells: true },
};
// rows north first: cell y 1, 0, -1, -2; columns cell x -2..1
const T = { version: 7, c0: -2, n: 4, holds: ['cc', 'bb', 'aa'], rows: ['2211', '2.11', '0000', '0010'] };
const expectCell = (gx, gy) => { const ch = T.rows[T.c0 + T.n - 1 - gy][gx - T.c0]; return ch === '.' ? null : T.holds[+ch]; };

const F = forkZones(ZS, T);
ok(F.holdCells && F.holdCells.version === 7 && globalThis.__dboHoldCells === F.holdCells, 'the fork loads the table with the switch on and publishes it', F.holdCells);
const G = gameZones(ZS);
const nearest = (x, y) => ZS.holds.reduce((b, h) => (Math.hypot(x - h.capital[0], y - h.capital[1]) < Math.hypot(x - b.capital[0], y - b.capital[1]) ? h : b)).id;
let agree = 0, total = 0; const bad = [];
for (let gx = -3; gx <= 2; gx++) for (let gy = -3; gy <= 2; gy++) for (const [fx, fy] of [[0.5, 0.5], [0, 0], [0.999, 0.999], [0.001, 0.73]]) {
  const x = (gx + fx) * 4096, y = (gy + fy) * 4096;
  const inS = Math.hypot(x - ZS.strongholds[0].center[0], y - ZS.strongholds[0].center[1]) <= 1000;
  const inT = gx >= -2 && gx <= 1 && gy >= -2 && gy <= 1;
  const want = inS ? 'ss' : (inT && expectCell(gx, gy)) || nearest(x, y);
  for (const w of [TAM, CITY]) {
    total++;
    const f = F.zoneAt(w, [x, y, 0]); const g = G.zoneAtPlace(w, [x, y, 0]);
    if ((f && f.id) === want && g === want) agree++; else bad.push([w, gx, gy, fx, fy, f && f.id, g, want]);
  }
}
ok(agree === total, `the fork and the gamemode both answer the table (stronghold first, "." and beyond it the nearest capital) at all ${total} points, in Tamriel and a city world`, bad.slice(0, 6));
ok(F.zoneAt(TAM, [4096 * 1.5, -4096 * 1.5, 0]).id === 'ss' && G.holdAtPlace(TAM, [4096 * 1.5, -4096 * 1.5, 0]) === 'cc', 'a stronghold still wins inside its radius; holdAtPlace there is the table\'s hold under it');
ok(F.zoneAt(TAM, [-4096, 0, 0]).id === nearest(-4096, 0) && expectCell(-1, 0) === null, 'a "." cell falls back to the nearest capital');
ok(F.zoneAt(TAM, [4096 * 1 - 0.001, 0, 0]).id === 'bb' && F.zoneAt(TAM, [-4096 * 2, -4096 * 2 + 0.001, 0]).id === 'cc' && F.zoneAt(TAM, [-0.001, -4096, 0]).id === 'cc' && F.zoneAt(TAM, [0, -4096 * 2, 0]).id === 'bb', 'cell edges and negative coordinates land in the right cell (floor of x / 4096)');
ok(G.zoneAtPlace('a764b:BSHeartland.esm', [0, 0, 0]) === 'rr' && F.zoneAt('a764b:BSHeartland.esm', [0, 0, 0]).id === 'rr', 'a region\'s worldspace is still the region');

// a hold the gamemode's own zones.json no longer has (edited and hot-reloaded after the fork booted) is not answered
const Gless = gameZones(Object.assign({}, ZS, { holds: ZS.holds.filter((h) => h.id !== 'bb') }));
ok(Gless.zoneAtPlace(TAM, [4096 * 0.5, 4096 * 0.5, 0]) === 'aa' && G.zoneAtPlace(TAM, [4096 * 0.5, 4096 * 0.5, 0]) === 'bb', 'a table hold the gamemode\'s zones.json lacks falls back to the nearest capital it has');

// the gamemode never runs ahead of the fork
const off = JSON.parse(JSON.stringify(ZS)); off.sovereignty.holdsFromCells = false;
const Foff = forkZones(off, T);
const Goff = gameZones(ZS);   // the gamemode's own zones.json says on, yet the fork did not load the table
ok(Foff.holdCells === null && globalThis.__dboHoldCells === null, 'switch off: the fork loads nothing and publishes null');
ok(Foff.zoneAt(TAM, [-6000, 6500, 0]).id === 'aa' && Goff.zoneAtPlace(TAM, [-6000, 6500, 0]) === 'aa' && Goff.zoneAtPlace(TAM, [4096 * 1.1, 4096 * 1.1, 0]) === nearest(4096 * 1.1, 4096 * 1.1),
  'switch off: both by nearest capital, even with the gamemode\'s zones.json saying on (it follows the fork, never the file)');
const Fmiss = forkZones(ZS);
ok(Fmiss.holdCells === null && globalThis.__dboHoldCells === null && logs.some((l) => /missing or unreadable/.test(l)), 'switch on, no table: nearest capital, and the log says why');
for (const [what, broken] of [['a row too short', { ...T, rows: ['221', '2.11', '0000', '0010'] }], ['an unknown hold', { ...T, holds: ['cc', 'bb', 'zz'] }], ['an index past the holds', { ...T, rows: ['2211', '2.11', '0000', '0019'] }], ['not JSON', '{oops']]) {
  const Fb = forkZones(ZS, broken);
  ok(Fb.holdCells === null && globalThis.__dboHoldCells === null && Fb.zoneAt(TAM, [-6000, 6000, 0]).id === 'aa', `a table with ${what} is refused whole: nearest capital`);
}

// ---- the real table ----
if (!REAL || !fs.existsSync(REAL)) {
  console.log(`SKIP the real table (pass hold-cells.json as the first argument, or set HOLD_CELLS)`);
} else {
  const ZL = JSON.parse(fs.readFileSync(path.join(ROOT, 'zones.json'), 'utf8'));
  const ZR = JSON.parse(JSON.stringify(ZL)); ZR.sovereignty = Object.assign({}, ZR.sovereignty, { holdsFromCells: true });
  const RT = JSON.parse(fs.readFileSync(REAL, 'utf8'));
  const FR = forkZones(ZR, RT);
  ok(!!FR.holdCells, `the fork accepts the real table (${RT.n}x${RT.n}, version ${RT.version})`, logs.slice(-2));
  const GR = gameZones(ZR);
  const inStronghold = (x, y) => (ZR.strongholds || []).some((s) => Array.isArray(s.center) && Math.hypot(x - s.center[0], y - s.center[1]) <= Number(s.radius));
  let n = 0, cells = 0; const mis = [];
  for (let j = 0; j < RT.n; j++) for (let i = 0; i < RT.n; i++) {
    const ch = RT.rows[j][i]; if (ch === '.') continue;
    cells++;
    const gx = RT.c0 + i, gy = RT.c0 + RT.n - 1 - j, want = RT.holds[parseInt(ch, 36)];
    for (const [fx, fy] of [[0.5, 0.5], [0.02, 0.02], [0.98, 0.98]]) {
      const x = (gx + fx) * 4096, y = (gy + fy) * 4096;
      if (inStronghold(x, y)) continue;
      n++;
      const f = FR.zoneAt(TAM, [x, y, 0]); const g = GR.zoneAtPlace(TAM, [x, y, 0]); const h = GR.holdAtPlace(TAM, [x, y, 0]);
      if ((f && f.id) !== want || g !== want || h !== want) mis.push([gx, gy, want, f && f.id, g, h]);
    }
  }
  ok(mis.length === 0, `the real table: the fork's zoneAt, the gamemode's zoneAtPlace and holdAtPlace answer it at all ${n} points of its ${cells} cells (outside the strongholds)`, mis.slice(0, 8));
  if (MAP) {
    const meta = JSON.parse(fs.readFileSync(path.join(MAP, 'holdraster.json'), 'utf8'));
    const ras = fs.readFileSync(path.join(MAP, 'holdraster.bin'));
    const same = JSON.stringify(meta.holds) === JSON.stringify(RT.holds) && meta.c0 === RT.c0 && meta.n === RT.n;
    ok(same, 'the map was drawn from a table with the same holds and grid', [meta.holds, meta.c0, meta.n]);
    let m = 0; const mm = [];
    for (let j = 0; j < RT.n; j++) for (let i = 0; i < RT.n; i++) {
      const ch = RT.rows[j][i]; if (ch === '.') continue;
      const v = ras[(j * meta.res + (meta.res >> 1)) * meta.width + i * meta.res + (meta.res >> 1)];
      if (v !== parseInt(ch, 36)) { m++; if (mm.length < 8) mm.push([RT.c0 + i, RT.c0 + RT.n - 1 - j, RT.holds[parseInt(ch, 36)], meta.holds[v]]); }
    }
    ok(m === 0, `the map's border raster gives every cell centre the table's hold (${cells} cells)`, mm);
  }
}

console.log(fails ? `\n${fails} failed` : `\nall passed (${oks})`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* left for the OS */ }
process.exit(fails ? 1 : 0);
