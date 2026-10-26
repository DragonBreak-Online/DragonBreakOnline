// The emote wheel's geometry and pointer rules, kept free of React so a harness can drive them
// (tests/emote-wheel-front-harness.js). Angles are degrees clockwise from straight up; segment 0 is centred at the top.

export const VIEW = 640;
export const CENTER = VIEW / 2;
export const HUB_R = 78;
export const GROUP_INNER = 86;
export const GROUP_OUTER = 158;
export const EMOTE_INNER = 166;
export const EMOTE_OUTER = 300;
// Past the group ring's middle gap the pointer reads the emote ring, however far out it goes (a flick overshoots)
const RING_SPLIT = (GROUP_OUTER + EMOTE_INNER) / 2;
// The pointer must rest this long on a group before the outer ring changes, so a flick across it to an emote does not
export const GROUP_DWELL_MS = 200;
// The wheel key held at least this long is a hold: its release plays the emote under the pointer
export const HOLD_MS = 220;
const GAP_DEG = 1.2;

export type Ring = 'hub' | 'group' | 'emote';

export interface Pick {
  ring: Ring;
  index: number;
}

export const angleOf = (dx: number, dy: number): number => {
  const a = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return a < 0 ? a + 360 : a;
};

export const indexAt = (angle: number, count: number): number => {
  if (count <= 0) return -1;
  const step = 360 / count;
  return Math.floor((((angle + step / 2) % 360) + 360) % 360 / step) % count;
};

// dx, dy: the pointer from the wheel's centre, in wheel units
export const pickAt = (dx: number, dy: number, groups: number, emotes: number): Pick => {
  const r = Math.hypot(dx, dy);
  if (r < HUB_R) return { ring: 'hub', index: -1 };
  const a = angleOf(dx, dy);
  if (r < RING_SPLIT) return { ring: 'group', index: indexAt(a, groups) };
  return { ring: 'emote', index: indexAt(a, emotes) };
};

export interface Dwell {
  candidate: number;
  since: number;
}

// The group the outer ring shows: a hovered group takes over once it has been held GROUP_DWELL_MS
export const dwellStep = (d: Dwell, hovered: number, now: number, current: number): { dwell: Dwell; group: number } => {
  if (hovered < 0) return { dwell: { candidate: -1, since: 0 }, group: current };
  const dwell = hovered === d.candidate ? d : { candidate: hovered, since: now };
  return { dwell, group: now - dwell.since >= GROUP_DWELL_MS ? hovered : current };
};

// What a release of the held wheel key does: play the emote under the pointer, or close
export const releaseAction = (p: Pick, emoteCount: number): { play: number } | { close: true } =>
  p.ring === 'emote' && p.index >= 0 && p.index < emoteCount ? { play: p.index } : { close: true };

const polar = (radius: number, angleDeg: number) => {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) };
};

export const segmentAngles = (index: number, count: number): { start: number; end: number; mid: number } => {
  const step = 360 / count;
  const mid = index * step;
  return { start: mid - step / 2 + GAP_DEG, end: mid + step / 2 - GAP_DEG, mid };
};

export const pointAt = polar;

export const arcPath = (innerR: number, outerR: number, start: number, end: number): string => {
  const o0 = polar(outerR, start);
  const o1 = polar(outerR, end);
  const i0 = polar(innerR, end);
  const i1 = polar(innerR, start);
  const large = end - start > 180 ? 1 : 0;
  return `M ${o0.x} ${o0.y} A ${outerR} ${outerR} 0 ${large} 1 ${o1.x} ${o1.y} L ${i0.x} ${i0.y} A ${innerR} ${innerR} 0 ${large} 0 ${i1.x} ${i1.y} Z`;
};
