// Who owns what, drawn over Skyrim's own M map (Nat, 2 Nov: the borders as an overlay, for every world's map, and the
// colours able to be toggled off). The pure half of mapOwnersService, so it can be tested without the engine.
//
// The server sends each world's territories and their owners (realm.js, dboMapOwners). A point belongs to the nearest
// territory marker in its worldspace, realm.js territoryAt's own rule, so each territory is its marker's Voronoi cell, cut
// to a circle round the marker so the sea and the unreachable edge stay clear. The cells are drawn once, in world units,
// into a clip inside the MapMenu (swf/dbo_mapowners), under the map's markers, as a faint tint per owner with a hairline
// where two owners meet. The map gives script no projection (_work/mmap-feasibility-1026.md), but SkyUI places every
// marker clip at its screen position, so each frame the markers the server named (with their true positions) give the
// world-to-screen fit, and the clip takes it as its own position and scale. Nothing here comes from any world's land or
// art, so it works on every world's map. T toggles it.
//
//   Server -> Client: { customPacketType: "dboMapOwners", worlds: [{ world, aliases, territories: [{ id, owner, x, y }] }],
//                       factions: { <faction id>: { name, rgb: [r, g, b] } }, anchors: [{ name, x, y, z }], reach, fade }

export const OWNERS_HOST = "_root.dboMapOwners";
export const OWNERS_SWF = "dbo_mapowners.swf";
// Loaded into the map only while this is true: the 2 Nov probe showed no clip can be made inside SkyUI's map, so it is off
// until the overlay is drawn in our own menu over the map
export const OWNERS_IN_MAP = false;
// Where the colours are drawn now: a layer of our legend's CustomMenu over the map (swf/dbo_maplegend, "owners")
export const OWNERS_LAYER = "_root.owners.layer";
export const OWNERS_ALIVE_FRAMES = 60;
// World units per drawing unit inside the swf, so a province fits Flash's coordinate range
export const DRAW_SCALE = 64;
// The circle each territory is cut to, and the softer ring beyond it (W6's C2 tint: 30,000, fading out by 45,000)
export const DEFAULT_REACH = 30000;
export const DEFAULT_FADE = 45000;
const CIRCLE_SIDES = 64;
// The tint and the hairline, as W6's C2 (tint 0.22, line 0.45)
export const TINT_ALPHA = 22;
export const LINE_ALPHA = 45;
export const RING_ALPHA = 75;
// On a paper map (a flat world) the parchment is light and warm, so the tint is stronger and a colour near the paper's own
// is pushed off it (Nat, 2 Nov: "a little muted for some", the tans of the Reach and Whiterun almost gone): more saturated,
// and no lighter than PAPER_MAX_L. PAPER is the parchment as the Tamriel sheet shows it.
export const PAPER_TINT_ALPHA = 50;
export const PAPER: [number, number, number] = [224, 202, 164];
const PAPER_NEAR = 150;
const PAPER_MAX_L = 0.36;
const toHsl = (c: [number, number, number]): [number, number, number] => {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
};
const fromHsl = (h: number, s: number, l: number): [number, number, number] => {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
};
export const paperTint = (c: [number, number, number]): [number, number, number] => {
  if (Math.hypot(c[0] - PAPER[0], c[1] - PAPER[1], c[2] - PAPER[2]) >= PAPER_NEAR) return c;
  const [h, sat, l] = toHsl(c);
  return fromHsl(h, Math.min(1, sat + 0.3), Math.min(l, PAPER_MAX_L));
};
// A fit worse than this (stage px, root mean square) hides the overlay rather than drawing it in the wrong place
export const MAX_FIT_RMS = 12;
// Markers read per frame for the fit
export const ANCHORS_PER_FRAME = 16;
// The key that shows or hides the colours while the map is open: mapColoursKeyCode in skymp5-client-settings.txt, as the
// other hotkeys are read (0 turns it off), else T as a DirectX scan code
export const TOGGLE_SETTING = "mapColoursKeyCode";
export const TOGGLE_KEY = 20;

export interface Territory { id: string; owner: string; zone: string; x: number; y: number }
// With zones.json sovereignty.holdsFromCells on, Tamriel's holds by cell: the fork's hold-cells table (zones.ts), rows north
// first, one character a cell west to east, a hold's index in holds ("0".."9", "a".."z") or "." for none
export interface HoldCells { c0: number; n: number; size: number; holds: string[]; rows: string[] }
// A stronghold's radius, which wins over the holds (zones.ts strongholdsOverrideHolds)
export interface Stronghold { zone: string; x: number; y: number; r: number }
// flat: the server's word that this world's map is flat and top-down (war.mapFlatWorlds), where the colours start shown
export interface OwnersWorld { world: string; aliases: string[]; territories: Territory[]; cells?: HoldCells; strongholds?: Stronghold[]; flat?: boolean }
export interface Faction { name: string; rgb: [number, number, number] }
export interface Anchor { name: string; x: number; y: number; z: number }
export interface OwnersData { worlds: OwnersWorld[]; factions: Record<string, Faction>; anchors: Anchor[]; reach: number; fade: number }

const DESC = /^[0-9a-f]+:[^:]+\.es[mpl]$/i;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// The table if it is whole, as zones.ts parseHoldCells checks it; null otherwise (the world is then drawn by its markers)
export const readCells = (raw: unknown): HoldCells | null => {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const c0 = Number(o.c0), n = Number(o.n), size = Number(o.size) || 4096;
  const holds = Array.isArray(o.holds) ? o.holds.map(String) : [];
  const rows = Array.isArray(o.rows) ? o.rows.map(String) : [];
  if (!Number.isInteger(c0) || !Number.isInteger(n) || n <= 0 || rows.length !== n || !holds.length || holds.length > 36) return null;
  for (const r of rows) {
    if (r.length !== n) return null;
    for (let i = 0; i < r.length; i++) if (r[i] !== "." && !(parseInt(r[i], 36) < holds.length)) return null;
  }
  return { c0, n, size, holds, rows };
};
// The hold of the cell holding (x, y), zones.ts cellHold's own arithmetic, or null outside the table
export const cellHold = (t: HoldCells, x: number, y: number): string | null => {
  const i = Math.floor(x / t.size) - t.c0, j = t.c0 + t.n - 1 - Math.floor(y / t.size);
  if (!(i >= 0 && i < t.n && j >= 0 && j < t.n)) return null;
  const ch = t.rows[j][i];
  return ch === "." ? null : t.holds[parseInt(ch, 36)] || null;
};

export const readOwners = (raw: Record<string, unknown>): OwnersData | null => {
  const worlds: OwnersWorld[] = [];
  for (const w of Array.isArray(raw.worlds) ? raw.worlds : []) {
    if (!w || typeof w !== "object") continue;
    const o = w as Record<string, unknown>;
    if (typeof o.world !== "string" || !DESC.test(o.world)) continue;
    const territories: Territory[] = [];
    for (const t of Array.isArray(o.territories) ? o.territories : []) {
      const r = (t || {}) as Record<string, unknown>;
      const x = num(r.x), y = num(r.y);
      if (typeof r.id === "string" && r.id && typeof r.owner === "string" && r.owner && x !== null && y !== null) territories.push({ id: r.id, owner: r.owner, zone: typeof r.zone === "string" ? r.zone : "", x, y });
    }
    const aliases = (Array.isArray(o.aliases) ? o.aliases : []).filter((a): a is string => typeof a === "string" && DESC.test(a));
    if (!territories.length) continue;
    const out: OwnersWorld = { world: o.world, aliases, territories };
    if (o.flat === true) out.flat = true;
    const cells = readCells(o.cells);
    if (cells) out.cells = cells;
    const strongholds: Stronghold[] = [];
    for (const z of Array.isArray(o.strongholds) ? o.strongholds : []) {
      const r = (z || {}) as Record<string, unknown>;
      const x = num(r.x), y = num(r.y), rad = num(r.r);
      if (typeof r.zone === "string" && r.zone && x !== null && y !== null && rad !== null && rad > 0) strongholds.push({ zone: r.zone, x, y, r: rad });
    }
    if (cells) out.strongholds = strongholds;
    worlds.push(out);
  }
  const factions: Record<string, Faction> = {};
  const f = raw.factions && typeof raw.factions === "object" ? (raw.factions as Record<string, unknown>) : {};
  for (const [id, v] of Object.entries(f)) {
    const r = (v || {}) as Record<string, unknown>;
    const rgb = Array.isArray(r.rgb) && r.rgb.length === 3 && r.rgb.every((c) => typeof c === "number" && c >= 0 && c <= 255) ? (r.rgb as [number, number, number]) : null;
    if (rgb) factions[id] = { name: typeof r.name === "string" ? r.name : id, rgb };
  }
  const anchors: Anchor[] = [];
  for (const a of Array.isArray(raw.anchors) ? raw.anchors : []) {
    const r = (a || {}) as Record<string, unknown>;
    const x = num(r.x), y = num(r.y), z = num(r.z);
    if (typeof r.name === "string" && r.name && x !== null && y !== null) anchors.push({ name: r.name, x, y, z: z === null ? 0 : z });
  }
  if (!worlds.length) return null;
  const reach = num(raw.reach), fade = num(raw.fade);
  const R = reach !== null && reach > 0 ? reach : DEFAULT_REACH;
  return { worlds, factions, anchors, reach: R, fade: fade !== null && fade >= R ? fade : Math.max(R, DEFAULT_FADE) };
};

// ---- the territories' shapes ----
type Pt = [number, number];
// A convex polygon whose every edge carries what made it: a neighbouring territory's index, or -1 for the rim
interface Shape { pts: Pt[]; by: number[] }

// Keeps the side of the line where a.x * nx + a.y * ny <= c (Sutherland-Hodgman, one plane); the new edge along the
// line is labelled `label`, the cut edges keep theirs
const clip = (s: Shape, nx: number, ny: number, c: number, label: number): Shape => {
  const out: Pt[] = [], by: number[] = [];
  const n = s.pts.length;
  const side = (p: Pt) => p[0] * nx + p[1] * ny - c;
  for (let i = 0; i < n; i++) {
    const a = s.pts[i], b = s.pts[(i + 1) % n];
    const da = side(a), db = side(b);
    if (da <= 0) { out.push(a); by.push(s.by[i]); }
    if ((da <= 0) !== (db <= 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      // leaving the kept side the next edge runs along the line; entering it, along the old edge
      by.push(da <= 0 ? label : s.by[i]);
    }
  }
  return { pts: out, by };
};

// Territory i's cell: nearer its marker than any other in the world, and within r of it
export const cellOf = (ts: Territory[], i: number, r: number): Shape => {
  const p = ts[i];
  let s: Shape = { pts: [], by: [] };
  // the circle first, as a regular polygon round the marker (its edges are the rim)
  for (let k = 0; k < CIRCLE_SIDES; k++) {
    const a = (k / CIRCLE_SIDES) * Math.PI * 2;
    s.pts.push([p.x + r * Math.cos(a), p.y + r * Math.sin(a)]);
    s.by.push(-1);
  }
  for (let j = 0; j < ts.length && s.pts.length; j++) {
    if (j === i) continue;
    const q = ts[j];
    const nx = q.x - p.x, ny = q.y - p.y;
    if (nx === 0 && ny === 0) continue;
    // nearer p than q: (x - m) . (q - p) <= 0, m the midpoint
    const c = ((p.x + q.x) / 2) * nx + ((p.y + q.y) / 2) * ny;
    s = clip(s, nx, ny, c, j);
  }
  return s;
};

// What dbo_mapowners draws, in drawing units (world / DRAW_SCALE, y as the world's: the clip's negative y scale flips it)
export interface Drawing {
  // a fill is one polygon (pts) or many rectangles in one fill (rects: x0, y0, x1, y1, ...), so cells show no seams
  fills: Array<{ rgb: number; alpha: number; pts?: number[]; rects?: number[]; quads?: number[] }>;
  lines: Array<{ rgb: number; alpha: number; pts: number[] }>;
  owners: string[];
}
const rgbOf = (c: [number, number, number]): number => (c[0] << 16) | (c[1] << 8) | c[2];
const darker = (c: [number, number, number]): [number, number, number] => [Math.round(c[0] * 0.55), Math.round(c[1] * 0.55), Math.round(c[2] * 0.55)];
const GREY: [number, number, number] = [128, 128, 128];
const flat = (pts: Pt[]): number[] => {
  const out: number[] = [];
  for (const p of pts) out.push(Math.round((p[0] / DRAW_SCALE) * 10) / 10, Math.round((p[1] / DRAW_SCALE) * 10) / 10);
  return out;
};

// Who owns (x, y) with the hold-cells table: a stronghold's radius first, else the cell's hold, then the nearest of that
// zone's territories; null outside the table or for a zone with no territory. d: the distance to that territory's marker
export const ownerAt = (w: OwnersWorld, x: number, y: number): { t: number; d: number } | null => {
  let zone: string | null = null;
  for (const s of w.strongholds || []) if (Math.hypot(x - s.x, y - s.y) <= s.r) { zone = s.zone; break; }
  if (zone === null && w.cells) zone = cellHold(w.cells, x, y);
  if (zone === null) return null;
  let best = -1, bd = Infinity;
  w.territories.forEach((t, i) => { if (t.zone !== zone) return; const d = Math.hypot(x - t.x, y - t.y); if (d < bd) { bd = d; best = i; } });
  return best < 0 ? null : { t: best, d: bd };
};

// The holds by cell: each cell takes its centre's hold and the nearest of that hold's territories (the strongholds are drawn
// over them as their own circles), tinted within reach of any marker and fading out by fade; a hairline runs along every
// cell edge between two owners
const cellDrawing = (w: OwnersWorld, factions: Record<string, Faction>, reach: number, fade: number, paper = false): Drawing => {
  const tint = paper ? PAPER_TINT_ALPHA : TINT_ALPHA;
  const t = w.cells as HoldCells;
  const ts = w.territories;
  const holdsOnly: OwnersWorld = { world: w.world, aliases: w.aliases, territories: ts, cells: t };
  const colour = (owner: string): [number, number, number] | null => (factions[owner] ? (paper ? paperTint(factions[owner].rgb) : factions[owner].rgb) : null);
  const n = t.n, S = t.size;
  const own: number[] = new Array(n * n).fill(-1), lvl: number[] = new Array(n * n).fill(0);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (t.c0 + i + 0.5) * S, y = (t.c0 + n - 1 - j + 0.5) * S;
    const o = ownerAt(holdsOnly, x, y);
    // the table runs out to sea and into Cyrodiil, so the tint fades by the distance to any marker: a hold's own far
    // corner stays tinted as long as some marker is near, and only the province's edge fades
    let near = Infinity;
    for (const m of ts) near = Math.min(near, Math.hypot(x - m.x, y - m.y));
    if (!o || near > fade) continue;
    own[j * n + i] = o.t;
    lvl[j * n + i] = near <= reach ? 2 : 1;
  }
  const u = (v: number) => Math.round((v / DRAW_SCALE) * 10) / 10;
  // one fill per owner and layer: every run of cells of that owner in a row is a rectangle of it
  const groups = new Map<string, { rgb: number; rects: number[] }>();
  for (const layer of [1, 2]) for (let j = 0; j < n; j++) {
    let i = 0;
    while (i < n) {
      const k = own[j * n + i];
      const ownerName = k >= 0 ? ts[k].owner : "";
      const rgb = k >= 0 ? colour(ownerName) : null;
      if (!rgb || lvl[j * n + i] < layer) { i++; continue; }
      let e = i + 1;
      while (e < n && own[j * n + e] >= 0 && ts[own[j * n + e]].owner === ownerName && lvl[j * n + e] >= layer) e++;
      const key = layer + "#" + ownerName;
      if (!groups.has(key)) groups.set(key, { rgb: rgbOf(rgb), rects: [] });
      const yTop = (t.c0 + n - j) * S, yBottom = (t.c0 + n - 1 - j) * S;
      (groups.get(key) as { rects: number[] }).rects.push(u((t.c0 + i) * S), u(yBottom), u((t.c0 + e) * S), u(yTop));
      i = e;
    }
  }
  const fills: Drawing["fills"] = [];
  groups.forEach((g) => fills.push({ rgb: g.rgb, alpha: tint / 2, rects: g.rects }));
  // hairlines: where two neighbouring cells have different owners, merged along a run of cell edges of one colour
  const lines: Drawing["lines"] = [];
  const ownerOf = (i: number, j: number) => (i >= 0 && i < n && j >= 0 && j < n && own[j * n + i] >= 0 ? ts[own[j * n + i]].owner : "");
  const lineColour = (a: string, b: string) => rgbOf(darker(colour(a) || colour(b) || GREY));
  const differ = (a: string, b: string) => a !== "" && b !== "" && a !== b;
  // vertical edges: between column i and i + 1, running down the rows
  for (let i = 0; i + 1 < n; i++) {
    let j = 0;
    while (j < n) {
      const a = ownerOf(i, j), b = ownerOf(i + 1, j);
      if (!differ(a, b)) { j++; continue; }
      const c = lineColour(a, b);
      let e = j + 1;
      while (e < n && differ(ownerOf(i, e), ownerOf(i + 1, e)) && lineColour(ownerOf(i, e), ownerOf(i + 1, e)) === c) e++;
      const x = (t.c0 + i + 1) * S;
      lines.push({ rgb: c, alpha: LINE_ALPHA, pts: [u(x), u((t.c0 + n - j) * S), u(x), u((t.c0 + n - e) * S)] });
      j = e;
    }
  }
  // horizontal edges: between row j and j + 1, running east
  for (let j = 0; j + 1 < n; j++) {
    let i = 0;
    while (i < n) {
      const a = ownerOf(i, j), b = ownerOf(i, j + 1);
      if (!differ(a, b)) { i++; continue; }
      const c = lineColour(a, b);
      let e = i + 1;
      while (e < n && differ(ownerOf(e, j), ownerOf(e, j + 1)) && lineColour(ownerOf(e, j), ownerOf(e, j + 1)) === c) e++;
      const y = (t.c0 + n - 1 - j) * S;
      lines.push({ rgb: c, alpha: LINE_ALPHA, pts: [u((t.c0 + i) * S), u(y), u((t.c0 + e) * S), u(y)] });
      i = e;
    }
  }
  // each stronghold over the holds: its cells already carry its owner's colour (a stronghold wins inside its radius), so it
  // gets only its edge, a ring a little stronger than a hold's hairline (Nat, 2 Nov: a filled disc read as a grey blot)
  for (const sh of w.strongholds || []) {
    const o = ownerAt({ world: w.world, aliases: w.aliases, territories: ts, strongholds: [sh] }, sh.x, sh.y);
    const rgb = o ? colour(ts[o.t].owner) : null;
    if (!rgb) continue;
    const ring: Pt[] = [];
    for (let k = 0; k <= CIRCLE_SIDES; k++) { const a = (k / CIRCLE_SIDES) * Math.PI * 2; ring.push([sh.x + sh.r * Math.cos(a), sh.y + sh.r * Math.sin(a)]); }
    lines.push({ rgb: rgbOf(darker(rgb)), alpha: RING_ALPHA, pts: flat(ring) });
  }
  return { fills, lines, owners: Array.from(new Set(ts.map((x) => x.owner))) };
};

export const drawingOf = (w: OwnersWorld, factions: Record<string, Faction>, reach: number, fade: number, paper = false): Drawing => {
  if (w.cells) return cellDrawing(w, factions, reach, fade, paper);
  const tint = paper ? PAPER_TINT_ALPHA : TINT_ALPHA;
  const ts = w.territories;
  const fills: Drawing["fills"] = [], lines: Drawing["lines"] = [];
  // an owner with no colour (unclaimed) is not tinted, but its marker still shapes its neighbours
  const colour = (owner: string): [number, number, number] | null => (factions[owner] ? (paper ? paperTint(factions[owner].rgb) : factions[owner].rgb) : null);
  for (let i = 0; i < ts.length; i++) {
    const rgb = colour(ts[i].owner);
    // the soft ring to fade, then the core to reach over it: the core shows both halves of the tint
    const outer = cellOf(ts, i, fade);
    if (rgb && outer.pts.length >= 3) fills.push({ rgb: rgbOf(rgb), alpha: tint / 2, pts: flat(outer.pts) });
    const inner = cellOf(ts, i, reach);
    if (rgb && inner.pts.length >= 3) fills.push({ rgb: rgbOf(rgb), alpha: tint / 2, pts: flat(inner.pts) });
    // a hairline on each edge shared with another owner's territory, drawn once (from the lower index)
    for (let k = 0; k < outer.pts.length; k++) {
      const j = outer.by[k];
      if (j <= i || ts[j].owner === ts[i].owner) continue;
      const a = outer.pts[k], b = outer.pts[(k + 1) % outer.pts.length];
      lines.push({ rgb: rgbOf(darker(rgb || colour(ts[j].owner) || GREY)), alpha: LINE_ALPHA, pts: flat([a, b]) });
    }
  }
  return { fills, lines, owners: Array.from(new Set(ts.map((t) => t.owner))) };
};

// The world the player's map shows: the packet's world or one of its aliases (Skyrim's walled cities are Tamriel's map)
export const worldFor = (data: OwnersData, formIdOf: (desc: string) => number, worldId: number): OwnersWorld | null => {
  if (!worldId) return null;
  for (const w of data.worlds) {
    for (const d of [w.world, ...w.aliases]) {
      let id = 0;
      try { id = formIdOf(d) >>> 0; } catch { id = 0; }
      if (id && id === worldId >>> 0) return w;
    }
  }
  return null;
};

// ---- lining the drawing up with the map ----
// A marker the server named, where the map put it this frame (stage px) and where it is (world units)
export interface Seen { sx: number; sy: number; x: number; y: number }
// screen = [m00 m01; m10 m11] * world + [tx; ty]; rms: how far the markers sit from it, in stage px
export interface Fit { m00: number; m01: number; m10: number; m11: number; tx: number; ty: number; rms: number; n: number }

// Least squares v = p * x + q * y + r over the points; null when they lie on one line
const plane = (xs: number[], ys: number[], v: number[]): [number, number, number] | null => {
  const n = xs.length;
  let sx = 0, sy = 0, sv = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sv += v[i]; }
  const mx = sx / n, my = sy / n, mv = sv / n;
  let xx = 0, xy = 0, yy = 0, xv = 0, yv = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my, dv = v[i] - mv;
    xx += dx * dx; xy += dx * dy; yy += dy * dy; xv += dx * dv; yv += dy * dv;
  }
  const det = xx * yy - xy * xy;
  if (!(Math.abs(det) > 1e-9 * Math.max(1, xx * yy))) return null;
  const p = (xv * yy - yv * xy) / det, q = (yv * xx - xv * xy) / det;
  return [p, q, mv - p * mx - q * my];
};

// Any turn, zoom and position of the map (an affine fit); a mirrored one (north up on the land, the screen's y down, so
// the determinant is negative) is the only kind kept
export const fitOf = (seen: Seen[]): Fit | null => {
  if (seen.length < 3) return null;
  const xs = seen.map((s) => s.x), ys = seen.map((s) => s.y);
  const fx = plane(xs, ys, seen.map((s) => s.sx)), fy = plane(xs, ys, seen.map((s) => s.sy));
  if (!fx || !fy) return null;
  if (fx[0] * fy[1] - fx[1] * fy[0] >= 0) return null;
  let e = 0;
  for (const s of seen) e += (fx[0] * s.x + fx[1] * s.y + fx[2] - s.sx) ** 2 + (fy[0] * s.x + fy[1] * s.y + fy[2] - s.sy) ** 2;
  return { m00: fx[0], m01: fx[1], m10: fy[0], m11: fy[1], tx: fx[2], ty: fy[2], rms: Math.sqrt(e / seen.length), n: seen.length };
};

// Skyrim's map is a tilted perspective camera, so cells near the bottom of the screen show bigger than at the top, and no
// affine fit holds across the view (Nat, 2 Nov: rms 38, the colours warping as he panned; a simulated camera at his tilt
// gives an affine rms of 34 px and a homography's 0, or 4.5 px with 3,000 units of terrain height). A homography maps the
// ground plane to the screen exactly: screen = (H * [x, y, 1]) / w. It is fitted each frame from every anchor the map
// shows (at least HOM_MIN), with the world coordinates normalised first so the least squares stays well conditioned.
export const HOM_MIN = 5;
export interface Homography { h: number[]; rms: number; n: number }
const solveLS = (rows: number[][], b: number[]): number[] | null => {
  const n = rows[0].length;
  const M = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  rows.forEach((r, k) => { for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) M[i][j] += r[i] * r[j]; M[i][n] += r[i] * b[k]; } });
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    if (Math.abs(M[p][i]) < 1e-12) return null;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; }
  }
  return M.map((r, i) => r[n] / r[i]);
};
export const project = (H: Homography, x: number, y: number): [number, number, number] => {
  const h = H.h, w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w, w];
};
export const homographyOf = (seen: Seen[]): Homography | null => {
  if (seen.length < 4) return null;
  const n = seen.length;
  const mx = seen.reduce((a, s) => a + s.x, 0) / n, my = seen.reduce((a, s) => a + s.y, 0) / n;
  const md = seen.reduce((a, s) => a + Math.hypot(s.x - mx, s.y - my), 0) / n;
  if (!(md > 0)) return null;
  const k = Math.SQRT2 / md;
  const rows: number[][] = [], b: number[] = [];
  for (const s of seen) {
    const X = (s.x - mx) * k, Y = (s.y - my) * k;
    rows.push([X, Y, 1, 0, 0, 0, -s.sx * X, -s.sx * Y]); b.push(s.sx);
    rows.push([0, 0, 0, X, Y, 1, -s.sy * X, -s.sy * Y]); b.push(s.sy);
  }
  const g = solveLS(rows, b);
  if (!g) return null;
  // H = G * T, T taking world to the normalised coordinates
  const G = [g[0], g[1], g[2], g[3], g[4], g[5], g[6], g[7], 1];
  const h: number[] = [];
  for (let r = 0; r < 3; r++) h.push(G[r * 3] * k, G[r * 3 + 1] * k, G[r * 3 + 2] - G[r * 3] * k * mx - G[r * 3 + 1] * k * my);
  const H: Homography = { h, rms: 0, n };
  let e = 0, ahead = true;
  for (const s of seen) { const [u, v, w] = project(H, s.x, s.y); if (!(w > 0)) ahead = false; e += (u - s.sx) ** 2 + (v - s.sy) ** 2; }
  if (!ahead) return null;
  H.rms = Math.sqrt(e / n);
  return H;
};
export const homHolds = (H: Homography | null): boolean => !!H && H.n >= HOM_MIN && H.rms <= MAX_FIT_RMS;
// The drawing (world / DRAW_SCALE) carried to our menu's stage through H: a rectangle becomes a quad, a polygon's or a
// line's points are projected (a straight edge on the ground stays straight). A shape reaching behind the camera is left out.
export interface StageScale { kx: number; ky: number; left: number; top: number }
export const projectDrawing = (d: Drawing, H: Homography, st: StageScale): Drawing => {
  const p = (x: number, y: number): [number, number] | null => {
    const [u, v, w] = project(H, x * DRAW_SCALE, y * DRAW_SCALE);
    return w > 0 ? [Math.round((st.left + u * st.kx) * 10) / 10, Math.round((st.top + v * st.ky) * 10) / 10] : null;
  };
  const pts = (a: number[]): number[] | null => {
    const out: number[] = [];
    for (let i = 0; i + 1 < a.length; i += 2) { const q = p(a[i], a[i + 1]); if (!q) return null; out.push(q[0], q[1]); }
    return out;
  };
  const fills: Drawing["fills"] = [];
  for (const f of d.fills) {
    if (f.rects) {
      const quads: number[] = [];
      for (let r = 0; r + 3 < f.rects.length; r += 4) {
        const [x0, y0, x1, y1] = f.rects.slice(r, r + 4);
        const q = pts([x0, y0, x1, y0, x1, y1, x0, y1]);
        if (q) quads.push(...q);
      }
      if (quads.length) fills.push({ rgb: f.rgb, alpha: f.alpha, quads });
    } else if (f.pts) {
      const q = pts(f.pts);
      if (q) fills.push({ rgb: f.rgb, alpha: f.alpha, pts: q });
    }
  }
  const lines: Drawing["lines"] = [];
  for (const l of d.lines) { const q = pts(l.pts); if (q) lines.push({ rgb: l.rgb, alpha: l.alpha, pts: q }); }
  return { fills, lines, owners: d.owners };
};
// How far the drawing would move between two fits, in stage px, judged at the anchors' own places
export const homShift = (a: Homography, b: Homography, at: Seen[]): number => {
  let m = 0;
  for (const s of at) { const [u, v] = project(a, s.x, s.y), [u2, v2] = project(b, s.x, s.y); m = Math.max(m, Math.hypot(u - u2, v - v2)); }
  return m;
};

// A clip can only scale and then turn (Flash's _xscale, _yscale, _rotation), so the fit's matrix, per drawing unit, is
// split as R(outer) * S * R(inner): the "layer" clip turns by outer and scales, its "shapes" child turns by inner
export interface ClipTransform { x: number; y: number; rotation: number; xscale: number; yscale: number; inner: number }
const DEG = 180 / Math.PI;
// On a flat, top-down map (Nat's paper maps, 2 Nov: a homography's rms 0, an affine's 1.2) the view only zooms, pans and
// perhaps turns. So the map's shape is fitted once (an affine fit that holds, split once by clipTransform) and each frame
// solves only that: screen = a * (shape's matrix * world) + b, with a a complex number (zoom and turn) and b the pan, from
// the anchors the map shows, at least two. The layer then keeps the shape's split and only adds the turn, scales by the
// zoom and moves to the pan, so it follows the map in the same frame and never swings between two equal splits.
export interface Track { s: number; turn: number; x: number; y: number; rms: number; n: number }
export const trackOf = (shape: Fit, seen: Seen[]): Track | null => {
  if (seen.length < 2) return null;
  const n = seen.length;
  const P = seen.map((q) => [shape.m00 * q.x + shape.m01 * q.y, shape.m10 * q.x + shape.m11 * q.y]);
  let px = 0, py = 0, qx = 0, qy = 0;
  seen.forEach((q, k) => { px += P[k][0]; py += P[k][1]; qx += q.sx; qy += q.sy; });
  px /= n; py /= n; qx /= n; qy /= n;
  let ar = 0, ai = 0, den = 0;
  seen.forEach((q, k) => {
    const dpx = P[k][0] - px, dpy = P[k][1] - py, dqx = q.sx - qx, dqy = q.sy - qy;
    ar += dqx * dpx + dqy * dpy; ai += dqy * dpx - dqx * dpy; den += dpx * dpx + dpy * dpy;
  });
  if (den < 1e-9) return null;
  ar /= den; ai /= den;
  const bx = qx - (ar * px - ai * py), by = qy - (ai * px + ar * py);
  let e = 0;
  seen.forEach((q, k) => { e += (ar * P[k][0] - ai * P[k][1] + bx - q.sx) ** 2 + (ai * P[k][0] + ar * P[k][1] + by - q.sy) ** 2; });
  return { s: Math.hypot(ar, ai), turn: Math.atan2(ai, ar) * DEG, x: bx, y: by, rms: Math.sqrt(e / n), n };
};
// The layer for a track: the shape's split, turned, scaled and moved
export const trackTransform = (shapeT: ClipTransform, t: Track): ClipTransform =>
  ({ x: t.x, y: t.y, rotation: shapeT.rotation + t.turn, xscale: shapeT.xscale * t.s, yscale: shapeT.yscale * t.s, inner: shapeT.inner });
export const clipTransform = (f: Fit): ClipTransform => {
  const a = f.m00 * DRAW_SCALE, b = f.m01 * DRAW_SCALE, c = f.m10 * DRAW_SCALE, d = f.m11 * DRAW_SCALE;
  const E = (a + d) / 2, F = (a - d) / 2, G = (c + b) / 2, H = (c - b) / 2;
  const Q = Math.hypot(E, H), R = Math.hypot(F, G);
  const a1 = Math.atan2(G, F), a2 = Math.atan2(H, E);
  return { x: f.tx, y: f.ty, rotation: ((a2 + a1) / 2) * DEG, xscale: (Q + R) * 100, yscale: (Q - R) * 100, inner: ((a2 - a1) / 2) * DEG };
};

// The fit carried from the map's stage to our own menu's (2 Nov: the colours are drawn in our CustomMenu over the map, as
// nothing can be made inside SkyUI's). SkyUI puts a marker at its screen fraction times _mapWidth / _mapHeight, the map's
// visible size; the same fraction of our visible area is the same spot on screen. A size that does not read (0) is taken
// as ours, so the fraction is still right when both movies show the same stage
export interface StageArea { left: number; top: number; width: number; height: number }
export const fitToStage = (f: Fit, mapWidth: number, mapHeight: number, ours: StageArea): Fit => {
  const kx = ours.width / (mapWidth > 0 ? mapWidth : ours.width), ky = ours.height / (mapHeight > 0 ? mapHeight : ours.height);
  return { m00: f.m00 * kx, m01: f.m01 * kx, tx: ours.left + f.tx * kx, m10: f.m10 * ky, m11: f.m11 * ky, ty: ours.top + f.ty * ky, rms: f.rms * Math.max(kx, ky), n: f.n };
};

// Whether to draw this frame: a fit from at least three markers, and one that holds
export const fitHolds = (f: Fit | null): boolean => !!f && f.n >= 3 && f.rms <= MAX_FIT_RMS;

// The anchors whose names are on the map once each, by label (case and spacing ignored); a name twice is no anchor
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
export const anchorIndex = (anchors: Anchor[]): Map<string, Anchor> => {
  const m = new Map<string, Anchor>(), twice = new Set<string>();
  for (const a of anchors) { const k = norm(a.name); if (m.has(k)) twice.add(k); else m.set(k, a); }
  twice.forEach((k) => m.delete(k));
  return m;
};
// Which marker clips are anchors: their index in the map's list and the anchor, each label once
export const anchorClips = (labels: Array<string | undefined>, index: Map<string, Anchor>): Array<{ i: number; a: Anchor }> => {
  const out: Array<{ i: number; a: Anchor }> = [], seen = new Map<string, number>();
  for (const l of labels) if (typeof l === "string" && l) { const k = norm(l); seen.set(k, (seen.get(k) || 0) + 1); }
  labels.forEach((l, i) => {
    if (typeof l !== "string" || !l) return;
    const k = norm(l);
    const a = index.get(k);
    if (a && seen.get(k) === 1) out.push({ i, a });
  });
  return out;
};

// The legend's row for the colours, named for the key that toggles them
export const legendRow = (shown: boolean, owners: number, key = "T") => ({ id: "territories", label: "Territory colours", key, count: owners, shown });
