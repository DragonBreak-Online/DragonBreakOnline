// Who owns what over the M map (mapOwners.ts, swf/dbo_mapowners, MapRealmService.followOwners): each territory's shape is
// exactly realm.js territoryAt's rule (the nearest marker in the world) cut to its circle, the hairlines lie only between
// two owners, the fit recovers the map's turn, zoom, flip and position from the markers and refuses a bad one, the clip
// split rebuilds the fit's matrix, and the swf sinks under the map's markers and draws the payload. Synthetic positions
// only. The mutants run the pure checks on altered copies of the compiled module and must each fail.
//   node tests/map-owners-harness.js [<tmp dir with mapOwners.js>]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const ROOT = path.resolve(__dirname, '..');

const out = process.argv[2] || (() => {
  const dir = path.join(os.tmpdir(), 'dbo-mapowners');
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), path.join(ROOT, 'src', 'services', 'services', 'mapOwners.ts'),
    '--outDir', dir, '--module', 'commonjs', '--target', 'es2019'], { stdio: 'pipe' });
  return dir;
})();
const M_FILE = [path.join(out, 'mapOwners.js'), path.join(out, 'services', 'services', 'mapOwners.js')].find((p) => fs.existsSync(p));
const M = require(M_FILE);

// a seeded random, so a failure repeats
const rng = (seed) => () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
const inside = (pts, x, y) => {
  // convex, either winding: every edge's cross product the same sign (or zero)
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const cr = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(cr) < 1e-6) continue;
    if (sign === 0) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) return false;
  }
  return true;
};
const WORLD = '3c:Skyrim.esm';
const territories = (n, r) => Array.from({ length: n }, (_, i) => ({ id: 't' + i, owner: ['hold-a', 'hold-b', 'hold-c'][i % 3], x: Math.round((r() - 0.5) * 200000), y: Math.round((r() - 0.5) * 200000) }));

const scenarios = (M, c) => {
  // ---- the packet ----
  const raw = {
    worlds: [{ world: WORLD, aliases: ['1a26f:Skyrim.esm', 'nonsense'], territories: [{ id: 'a', owner: 'hold-a', x: 0, y: 0 }, { id: 'b', owner: '', x: 1, y: 1 }, { id: 'c', owner: 'hold-b', x: 'x', y: 0 }] }, { world: 'bad world', territories: [{ id: 'z', owner: 'q', x: 0, y: 0 }] }],
    factions: { 'hold-a': { name: 'Hold A', rgb: [10, 20, 30] }, 'hold-b': { rgb: [300, 0, 0] } },
    anchors: [{ name: 'Whiterun', x: 1, y: 2, z: 3 }, { name: '', x: 0, y: 0 }, { name: 'NoZ', x: 5, y: 6 }],
    reach: 1000, fade: 500,
  };
  const d = M.readOwners(raw);
  c('a packet: only well-formed worlds, territories, colours and anchors kept', !!d && d.worlds.length === 1 && d.worlds[0].territories.length === 1 && JSON.stringify(d.worlds[0].aliases) === '["1a26f:Skyrim.esm"]'
    && Object.keys(d.factions).join() === 'hold-a' && d.anchors.length === 2 && d.anchors[1].z === 0, d);
  c('...a fade shorter than the reach is raised to it', !!d && d.reach === 1000 && d.fade >= 1000);
  c('...no world at all is no data', M.readOwners({ worlds: [] }) === null);
  c('the world shown is the player\'s, or a walled city\'s Tamriel', !!d && M.worldFor(d, (x) => ({ '3c:Skyrim.esm': 0x3c, '1a26f:Skyrim.esm': 0x1a26f }[x] || 0), 0x1a26f) === d.worlds[0]
    && M.worldFor(d, () => 0x3c, 0x3c) === d.worlds[0] && M.worldFor(d, () => 0x3c, 0x99) === null && M.worldFor(d, () => 0x3c, 0) === null);

  // ---- the shapes: exactly the nearest-marker rule, cut to the circle ----
  const r = rng(7);
  const ts = territories(14, r);
  const R = 45000;
  const cells = ts.map((_, i) => M.cellOf(ts, i, R));
  let agree = 0, total = 0, firstBad = null;
  for (let k = 0; k < 4000; k++) {
    const x = (r() - 0.5) * 260000, y = (r() - 0.5) * 260000;
    let best = -1, bd = Infinity;
    ts.forEach((t, i) => { const dd = Math.hypot(x - t.x, y - t.y); if (dd < bd) { bd = dd; best = i; } });
    // the circle is a 64-gon: leave out points in its sliver at the rim, and points on a bisector
    if (Math.abs(bd - R) < R * 0.002) continue;
    const sorted = ts.map((t) => Math.hypot(x - t.x, y - t.y)).sort((a, b) => a - b);
    if (sorted[1] - sorted[0] < 1) continue;
    const want = bd < R ? best : -1;
    const got = cells.map((s, i) => (s.pts.length >= 3 && inside(s.pts, x, y) ? i : -1)).filter((i) => i >= 0);
    total++;
    if ((want < 0 && got.length === 0) || (got.length === 1 && got[0] === want)) agree++; else firstBad = firstBad || { x, y, want, got };
  }
  c(`every point lies in its nearest marker's shape, within reach, and in no other (${total} points)`, total > 3000 && agree === total, firstBad);
  const sideOk = cells.every((s, i) => s.by.every((j, k) => {
    if (j < 0) return true;
    const a = s.pts[k], b = s.pts[(k + 1) % s.pts.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return Math.abs(Math.hypot(m[0] - ts[i].x, m[1] - ts[i].y) - Math.hypot(m[0] - ts[j].x, m[1] - ts[j].y)) < 1;
  }));
  c('each edge named for a neighbour lies on the line half way to it', sideOk);

  // ---- what is drawn ----
  const factions = { 'hold-a': { name: 'A', rgb: [200, 0, 0] }, 'hold-b': { name: 'B', rgb: [0, 200, 0] } };
  const w = { world: WORLD, aliases: [], territories: ts };
  const dr = M.drawingOf(w, factions, 30000, 45000);
  const tinted = ts.filter((t) => factions[t.owner]).length;
  c('two layers of tint for each owned territory, none for hold-c (no colour)', dr.fills.length === tinted * 2, [dr.fills.length, tinted]);
  c('...each layer half the tint', dr.fills.every((f) => f.alpha === M.TINT_ALPHA / 2));
  const S0 = M.DRAW_SCALE;
  const unit = (p) => [p[0] * S0, p[1] * S0];
  const ownerAt = (x, y) => { let best = null, bd = Infinity; for (const t of ts) { const dd = Math.hypot(x - t.x, y - t.y); if (dd < bd) { bd = dd; best = t; } } return best; };
  const lineOk = dr.lines.every((l) => {
    const a = unit([l.pts[0], l.pts[1]]), b = unit([l.pts[2], l.pts[3]]);
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], nx = -(b[1] - a[1]), ny = b[0] - a[0], len = Math.hypot(nx, ny) || 1;
    const o1 = ownerAt(m[0] + (nx / len) * 50, m[1] + (ny / len) * 50), o2 = ownerAt(m[0] - (nx / len) * 50, m[1] - (ny / len) * 50);
    return o1 && o2 && o1.owner !== o2.owner;
  });
  c('every hairline has a different owner on each side', dr.lines.length > 0 && lineOk, dr.lines.length);
  const key = (l) => [l.pts.slice(0, 2).join(','), l.pts.slice(2, 4).join(',')].sort().join('|');
  c('...and each is drawn once', new Set(dr.lines.map(key)).size === dr.lines.length);
  const same = M.drawingOf({ world: WORLD, aliases: [], territories: ts.map((t) => Object.assign({}, t, { owner: 'hold-a' })) }, factions, 30000, 45000);
  c('one owner everywhere: no hairline at all', same.lines.length === 0 && same.fills.length === ts.length * 2);
  c('the owners drawn, once each', JSON.stringify(dr.owners.slice().sort()) === '["hold-a","hold-b","hold-c"]');

  // ---- lining it up ----
  const affine = (rot, sx, sy, tx, ty) => { const cr = Math.cos(rot), sr = Math.sin(rot); return { m00: cr * sx, m01: -sr * sy, m10: sr * sx, m11: cr * sy, tx, ty }; };
  const toScreen = (A, x, y) => ({ sx: A.m00 * x + A.m01 * y + A.tx, sy: A.m10 * x + A.m11 * y + A.ty });
  const A = affine(0.4, 0.0021, -0.0023, 640, 360);
  const pts = Array.from({ length: 6 }, () => { const x = (r() - 0.5) * 200000, y = (r() - 0.5) * 200000; return Object.assign({ x, y }, toScreen(A, x, y)); });
  const f = M.fitOf(pts);
  c('the fit recovers a turned, zoomed, flipped map from six markers', !!f && ['m00', 'm01', 'm10', 'm11', 'tx', 'ty'].every((k) => Math.abs(f[k] - A[k]) < 1e-6 * Math.max(1, Math.abs(A[k]))) && f.rms < 1e-6 && f.n === 6, f);
  c('...and holds', M.fitHolds(f));
  const noisy = M.fitOf(pts.map((p, i) => Object.assign({}, p, { sx: p.sx + (i % 2 ? 3 : -3) })));
  c('three pixels of jitter: still holds, its rms says so', !!noisy && noisy.rms > 1 && noisy.rms < 4 && M.fitHolds(noisy), noisy && noisy.rms);
  const off = M.fitOf(pts.map((p, i) => Object.assign({}, p, { sx: p.sx + (i === 0 ? 120 : 0) })));
  c('one marker far from where the others say: the fit does not hold', !!off && off.rms > M.MAX_FIT_RMS && !M.fitHolds(off), off && off.rms);
  const mirror = M.fitOf(pts.map((p) => Object.assign({}, p, { sy: 720 - p.sy })));
  c('a mirrored map is refused', mirror === null);
  c('two markers, or three in a line, are no fit', M.fitOf(pts.slice(0, 2)) === null && M.fitOf([{ x: 0, y: 0, sx: 0, sy: 0 }, { x: 1, y: 1, sx: 1, sy: -1 }, { x: 2, y: 2, sx: 2, sy: -2 }]) === null);
  // the clip split: layer R(rotation) * S(xscale, yscale) of shapes R(inner), per drawing unit, is the fit's matrix
  const rot = (deg) => { const a = (deg * Math.PI) / 180; return [[Math.cos(a), -Math.sin(a)], [Math.sin(a), Math.cos(a)]]; };
  const mul = (P, Q) => [[P[0][0] * Q[0][0] + P[0][1] * Q[1][0], P[0][0] * Q[0][1] + P[0][1] * Q[1][1]], [P[1][0] * Q[0][0] + P[1][1] * Q[1][0], P[1][0] * Q[0][1] + P[1][1] * Q[1][1]]];
  let splitOk = true;
  for (const [rr, sx, sy] of [[0, 0.002, -0.002], [0.4, 0.0021, -0.0023], [-2.5, 0.01, -0.004], [3.1, 0.0005, -0.0005]]) {
    const F = Object.assign(affine(rr, sx, sy, 10, 20), { rms: 0, n: 3 });
    const t = M.clipTransform(F);
    const got = mul(mul(rot(t.rotation), [[t.xscale / 100, 0], [0, t.yscale / 100]]), rot(t.inner));
    const want = [[F.m00 * S0, F.m01 * S0], [F.m10 * S0, F.m11 * S0]];
    if (!(got.every((row, i) => row.every((v, j) => Math.abs(v - want[i][j]) < 1e-9 * Math.max(1, Math.abs(want[i][j])))) && t.x === 10 && t.y === 20)) splitOk = false;
  }
  c('the clips\' turn, scale and turn rebuild the fit exactly, at any angle', splitOk);

  // ---- which markers anchor it ----
  const idx = M.anchorIndex([{ name: 'Whiterun', x: 1, y: 2, z: 0 }, { name: 'Fort Twice', x: 0, y: 0, z: 0 }, { name: 'fort  twice', x: 9, y: 9, z: 0 }]);
  c('a name the server lists twice anchors nothing', idx.has('whiterun') && !idx.has('fort twice'));
  const clips = M.anchorClips(['Riverwood', 'WHITERUN', undefined, 'Whiterun '], idx);
  c('...nor a label the map shows twice', clips.length === 0);
  const one = M.anchorClips(['Riverwood', ' whiterun', undefined], idx);
  c('a label the map shows once, matched however it is spaced or cased', one.length === 1 && one[0].i === 1 && one[0].a.x === 1);
  c('the legend row: T, the owners on this map', JSON.stringify(M.legendRow(false, 4)) === JSON.stringify({ id: 'territories', label: 'Territory colours', key: 'T', count: 4, shown: false }));
};

scenarios(M, check);

// ---- mutants: altered copies of the compiled module ----
const M_SRC = fs.readFileSync(M_FILE, 'utf8');
const MUTANTS = [
  ['the bisector on the wrong side', [['s = clip(s, nx, ny, c, j);', 's = clip(s, -nx, -ny, -c, j);']]],
  ['the cut edge keeps the old label', [['by.push(da <= 0 ? label : s.by[i]);', 'by.push(s.by[i]);']]],
  ['a hairline between territories of one owner', [['if (j <= i || ts[j].owner === ts[i].owner)', 'if (j <= i)']]],
  ['the hairline drawn from both sides', [['if (j <= i || ts[j].owner', 'if (j === i || ts[j].owner']]],
  ['an unclaimed territory tinted grey', [['factions[owner] ? factions[owner].rgb : null', 'factions[owner] ? factions[owner].rgb : GREY']]],
  ['a mirrored fit kept', [['if (fx[0] * fy[1] - fx[1] * fy[0] >= 0)', 'if (false)']]],
  ['the split\'s turns swapped', [['rotation: ((a2 + a1) / 2) * DEG', 'rotation: ((a2 - a1) / 2) * DEG'], ['inner: ((a2 - a1) / 2) * DEG', 'inner: ((a2 + a1) / 2) * DEG']]],
  ['any fit holds', [['f.rms <= exports.MAX_FIT_RMS', 'true']]],
  ['a twice-listed name still anchors', [['twice.forEach((k) => m.delete(k));', '']]],
];
for (const [name, edits] of MUTANTS) {
  let src = M_SRC, missing = null;
  for (const [a, b] of edits) { if (!src.includes(a)) { missing = a; break; } src = src.replace(a, b); }
  if (missing) { check(`mutant "${name}": its text is in the compiled module`, false, missing); continue; }
  const file = path.join(path.dirname(M_FILE), 'mapOwners.mutant.js');
  fs.writeFileSync(file, src);
  delete require.cache[file];
  let bad = 0;
  try { scenarios(require(file), (w, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  fs.unlinkSync(file);
  check(`mutant caught: ${name}`, bad > 0);
}

// ---- swf/dbo_mapowners on the stub stage, loaded into a clip of a map that has MarkerClips at depth 50 ----
const swaps = [];
const taken = new Set([50, 49]);
const mapRoot = { MarkerClips: { getDepth: () => 50 }, getInstanceAtDepth: (k) => (taken.has(k) ? {} : undefined) };
const t = S.boot('dbo_mapowners', true, { _parent: mapRoot, swapDepths: (k) => swaps.push(k) });
const R0 = t.root;
check('the swf says it is alive, its version, and locks its root (it runs inside the MapMenu)', R0.dboAlive === 'yes' && R0.dboVersion === 'mapowners-1' && t.ctx._lockroot === true);
check('it sinks to the first free depth under the map\'s markers', JSON.stringify(swaps) === '[48]', swaps);
check('the layer starts hidden, with its shapes inside', R0.layer && R0.layer._visible === false && !!R0.layer.shapes);
const strokes = [];
const sh = R0.layer.shapes;
sh.lineStyle = (w, col, a) => strokes.push({ w, col, a, pts: [] });
const mv = sh.moveTo, lt = sh.lineTo;
sh.moveTo = (x, y) => { mv(x, y); if (!sh._fill && strokes.length) strokes[strokes.length - 1].pts.push([x, y]); };
sh.lineTo = (x, y) => { lt(x, y); if (!sh._fill && strokes.length) strokes[strokes.length - 1].pts.push([x, y]); };
t.push({ fills: [{ rgb: 0xc80000, alpha: 11, pts: [0, 0, 10, 0, 10, 10] }, { rgb: 0x00c800, alpha: 11, pts: [0, 0] }], lines: [{ rgb: 0x111111, alpha: 45, pts: [0, 0, 10, 10] }] });
check('each fill drawn, closed, in its colour and alpha; a fill of one point skipped', sh.fills.length === 1 && sh.fills[0].color === 0xc80000 && sh.fills[0].alpha === 11
  && JSON.stringify(sh.fills[0].pts) === '[[0,0],[10,0],[10,10],[0,0]]', sh.fills);
const hl = strokes.filter((s) => s.w === 0);
check('each line a hairline (thickness 0, so it stays thin at any zoom), in its colour', hl.length === 1 && hl[0].col === 0x111111 && hl[0].a === 45 && JSON.stringify(hl[0].pts) === '[[0,0],[10,10]]', strokes);
t.push({ fills: [], lines: [] });
check('a new payload clears the old drawing', sh.fills.length === 0);
let threw = false;
try { t.push({ fills: 'x' }); } catch (e) { threw = true; }
check('an unreadable payload is logged and changes nothing', !threw && t.ctx.dboQueue.some((q) => q[0] === 'log' && /unreadable/.test(q[1])));
const t2 = S.boot('dbo_mapowners', true, { _parent: { getInstanceAtDepth: () => undefined }, swapDepths: (k) => swaps.push('x' + k) });
check('a map with no MarkerClips: it stays where it was put, and says so', !swaps.some((s) => String(s).startsWith('x')) && t2.ctx.dboQueue.some((q) => q[0] === 'log' && /no MarkerClips/.test(q[1])));

// ---- the wiring in MapRealmService ----
const src = fs.readFileSync(path.join(ROOT, 'src/services/services/mapRealmService.ts'), 'utf8').replace(/\r\n/g, '\n');
const fn = (name) => { const i = src.indexOf(`  private ${name}(`); return i < 0 ? '' : src.slice(i, src.indexOf('\n  }\n', i)); };
const fo = fn('followOwners');
check('the overlay is loaded into a clip of the map each opening, like the legend', /createEmptyMovieClip", \["dboMapOwners", "9989"\]/.test(fo) && /\.loadMovie`, OWNERS_SWF\)/.test(fo) && /this\.ownersLoad = \{ phase: "idle", frames: 0 \};/.test(fn('onMapOpen')));
check('drawn again only when the world or an owner changes', /if \(key !== this\.drawnKey\)/.test(fo) && /world\.territories\.map\(\(t\) => t\.owner\)/.test(fo));
check('shown only while the player wants it and the fit holds; hidden where no world has owners', /const holds = this\.ownersShown && fitHolds\(fit\);/.test(fo) && /setBool\(MAP_MENU, `\$\{layer\}\._visible`, holds\)/.test(fo) && /if \(!world\) \{ ui\.setBool\(MAP_MENU, `\$\{layer\}\._visible`, false\); return; \}/.test(fo));
check('the six transform values set each frame it holds', ['_x', '_y', '_xscale', '_yscale', '_rotation'].every((k) => src.includes('`${layer}.' + k + '`')) && src.includes('`${layer}.shapes._rotation`, t.inner'));
check('the marker positions read in the root\'s units (MarkerClips\' own offset and scale applied)', /seen\.push\(\{ sx: bx \+ ui\.getFloat\(MAP_MENU, `\$\{clip\}\._x`\) \* kx, sy: by \+ ui\.getFloat\(MAP_MENU, `\$\{clip\}\._y`\) \* ky/.test(fn('fitNow')) && /\._visible`\)\) continue;/.test(fn('fitNow')));
check('T toggles the colours, with or without the realm\'s markers', /if \(e\.code === TOGGLE_KEY && this\.owners\) \{\n      this\.ownersShown = !this\.ownersShown;/.test(fn('onButton')) && fn('onButton').indexOf('TOGGLE_KEY') < fn('onButton').indexOf('if (!this.markers.length) return;'));
check('the legend gets the colours\' row once the world is drawn', /if \(this\.owners && this\.drawnKey\) rows = rows\.concat\(\[legendRow\(this\.ownersShown, this\.worldOwners\)\]\);/.test(fn('publish')));
check('the fit is measured and reported once an opening', /sendCustomPacket\(this\.controller, \{ customPacketType: "dbo", event: "mapOwnersFit"/.test(fo) && /this\.fitLogged = false;/.test(fn('onMapOpen')));

T.done();
