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
// A fit worse than this (stage px, root mean square) hides the overlay rather than drawing it in the wrong place
export const MAX_FIT_RMS = 12;
// Markers read per frame for the fit
export const ANCHORS_PER_FRAME = 16;
// T, as a DirectX scan code
export const TOGGLE_KEY = 20;

export interface Territory { id: string; owner: string; x: number; y: number }
export interface OwnersWorld { world: string; aliases: string[]; territories: Territory[] }
export interface Faction { name: string; rgb: [number, number, number] }
export interface Anchor { name: string; x: number; y: number; z: number }
export interface OwnersData { worlds: OwnersWorld[]; factions: Record<string, Faction>; anchors: Anchor[]; reach: number; fade: number }

const DESC = /^[0-9a-f]+:[^:]+\.es[mpl]$/i;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

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
      if (typeof r.id === "string" && r.id && typeof r.owner === "string" && r.owner && x !== null && y !== null) territories.push({ id: r.id, owner: r.owner, x, y });
    }
    const aliases = (Array.isArray(o.aliases) ? o.aliases : []).filter((a): a is string => typeof a === "string" && DESC.test(a));
    if (territories.length) worlds.push({ world: o.world, aliases, territories });
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
  fills: Array<{ rgb: number; alpha: number; pts: number[] }>;
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

export const drawingOf = (w: OwnersWorld, factions: Record<string, Faction>, reach: number, fade: number): Drawing => {
  const ts = w.territories;
  const fills: Drawing["fills"] = [], lines: Drawing["lines"] = [];
  // an owner with no colour (unclaimed) is not tinted, but its marker still shapes its neighbours
  const colour = (owner: string): [number, number, number] | null => (factions[owner] ? factions[owner].rgb : null);
  for (let i = 0; i < ts.length; i++) {
    const rgb = colour(ts[i].owner);
    // the soft ring to fade, then the core to reach over it: the core shows both halves of the tint
    const outer = cellOf(ts, i, fade);
    if (rgb && outer.pts.length >= 3) fills.push({ rgb: rgbOf(rgb), alpha: TINT_ALPHA / 2, pts: flat(outer.pts) });
    const inner = cellOf(ts, i, reach);
    if (rgb && inner.pts.length >= 3) fills.push({ rgb: rgbOf(rgb), alpha: TINT_ALPHA / 2, pts: flat(inner.pts) });
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

// A clip can only scale and then turn (Flash's _xscale, _yscale, _rotation), so the fit's matrix, per drawing unit, is
// split as R(outer) * S * R(inner): the "layer" clip turns by outer and scales, its "shapes" child turns by inner
export interface ClipTransform { x: number; y: number; rotation: number; xscale: number; yscale: number; inner: number }
const DEG = 180 / Math.PI;
export const clipTransform = (f: Fit): ClipTransform => {
  const a = f.m00 * DRAW_SCALE, b = f.m01 * DRAW_SCALE, c = f.m10 * DRAW_SCALE, d = f.m11 * DRAW_SCALE;
  const E = (a + d) / 2, F = (a - d) / 2, G = (c + b) / 2, H = (c - b) / 2;
  const Q = Math.hypot(E, H), R = Math.hypot(F, G);
  const a1 = Math.atan2(G, F), a2 = Math.atan2(H, E);
  return { x: f.tx, y: f.ty, rotation: ((a2 + a1) / 2) * DEG, xscale: (Q + R) * 100, yscale: (Q - R) * 100, inner: ((a2 - a1) / 2) * DEG };
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

// The legend's row for the colours (T)
export const legendRow = (shown: boolean, owners: number) => ({ id: "territories", label: "Territory colours", key: "T", count: owners, shown });
