// The Place tool's box (W1, 2 Nov: an invisible activator showed nothing while staff placed or turned it): the base's
// object bounds (OBND, x1 y1 z1 x2 y2 z2 in its own frame, sent by the server's placeBounds) posed like the copy, and an
// arrow along its forward axis, as screen segments for the browser overlay.
export type Vec3 = [number, number, number];
export type Obnd = [number, number, number, number, number, number];
export type Segment = [Vec3, Vec3];

// A base with no bounds, or flat ones, still gets a box this big, so even a markerless invisible activator shows
export const FALLBACK_HALF = 16;
const MIN_SIZE = 1;

export const boundsOf = (raw: unknown): Obnd => {
  const v = Array.isArray(raw) && raw.length === 6 ? raw.map(Number) : null;
  const ok = !!v && v.every(Number.isFinite) && v[3] - v[0] >= MIN_SIZE && v[4] - v[1] >= MIN_SIZE && v[5] - v[2] >= MIN_SIZE;
  const h = FALLBACK_HALF;
  return ok ? (v as Obnd) : [-h, -h, -h, h, h, h];
};

// CommonLibSSE NiMatrix3::SetEulerAnglesXYZ at the fork's pin, applied as world = R * local + pos (the reference
// convention: z alone puts forward at (sin z, cos z)); angles in degrees as setAngle takes them
export const rotationOf = (rotDeg: number[]): number[][] => {
  const [x, y, z] = [0, 1, 2].map((i) => ((Number(rotDeg[i]) || 0) * Math.PI) / 180);
  const sx = Math.sin(x), sy = Math.sin(y), sz = Math.sin(z), cx = Math.cos(x), cy = Math.cos(y), cz = Math.cos(z);
  return [
    [cy * cz, cy * sz, -sy],
    [sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy],
    [cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy],
  ];
};

export const toWorld = (r: number[][], pos: number[], p: Vec3): Vec3 => [
  r[0][0] * p[0] + r[0][1] * p[1] + r[0][2] * p[2] + pos[0],
  r[1][0] * p[0] + r[1][1] * p[1] + r[1][2] * p[2] + pos[1],
  r[2][0] * p[0] + r[2][1] * p[1] + r[2][2] * p[2] + pos[2],
];

// The box's 12 edges and the facing arrow (centre to past the front face, a two-stroke head, and a tick up from the top
// face so a tilted object reads), all in the world
export const boxSegments = (obnd: Obnd, pos: number[], rotDeg: number[]): Segment[] => {
  const r = rotationOf(rotDeg);
  const [x1, y1, z1, x2, y2, z2] = obnd;
  const w = (p: Vec3) => toWorld(r, pos, p);
  const c: Vec3[] = [];
  for (const z of [z1, z2]) for (const [x, y] of [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]) c.push(w([x, y, z]));
  const segs: Segment[] = [];
  for (let k = 0; k < 4; k++) {
    segs.push([c[k], c[(k + 1) % 4]]);
    segs.push([c[4 + k], c[4 + ((k + 1) % 4)]]);
    segs.push([c[k], c[4 + k]]);
  }
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, mz = (z1 + z2) / 2;
  const len = Math.max(y2 - y1, 32);
  const tip: Vec3 = [mx, y2 + len * 0.5, mz];
  const head = len * 0.2;
  segs.push([w([mx, my, mz]), w(tip)]);
  segs.push([w(tip), w([mx - head, tip[1] - head, mz])]);
  segs.push([w(tip), w([mx + head, tip[1] - head, mz])]);
  segs.push([w([mx, my, z2]), w([mx, my, z2 + Math.max(z2 - z1, 32) * 0.3])]);
  return segs;
};

// The SVG path for segments already carried to the screen by worldPointToScreenPoint: x and y from 0 to 1 with y up,
// the third value not above 0 behind the camera. A segment with an end behind the camera is left out
export const pathOf = (projected: number[][]): string => {
  const out: string[] = [];
  const f = (v: number) => Math.round(v * 10000) / 10000;
  for (let i = 0; i + 1 < projected.length; i += 2) {
    const a = projected[i], b = projected[i + 1];
    if (!a || !b || !(a[2] > 0) || !(b[2] > 0)) continue;
    out.push(`M${f(a[0])} ${f(1 - a[1])}L${f(b[0])} ${f(1 - b[1])}`);
  }
  return out.join("");
};
