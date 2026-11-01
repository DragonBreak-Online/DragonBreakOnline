// The native emote wheel's pure half (route H: drawn in the HUD Menu by swf/dbo_emotewheel, no menu opened, no cursor):
// the same rings and rules as the browser wheel (skymp5-front features/emoteWheel/wheelGeometry.ts), pointed by the mouse's
// own movement (SkyrimPlatform mouseMove) or the gamepad's right stick instead of a cursor. No game calls here, so
// tests/native-emote-wheel-harness.js runs it as is.

// The browser wheel's geometry, in its units (a 640-unit square, the hub at its centre)
export const HUB_R = 78;
export const GROUP_INNER = 86;
export const GROUP_OUTER = 158;
export const EMOTE_INNER = 166;
export const EMOTE_OUTER = 300;
const RING_SPLIT = (GROUP_OUTER + EMOTE_INNER) / 2;
export const GROUP_DWELL_MS = 200;
// Wheel units per unit of mouse movement; the pointer stops at the outer ring's edge, so a flick overshoots harmlessly
export const MOUSE_GAIN = 0.9;
const POINTER_MAX = EMOTE_OUTER;
// The right stick points straight at the ring: pushed fully, the middle of the emote ring
const STICK_REACH = (EMOTE_INNER + EMOTE_OUTER) / 2;
const STICK_DEAD = 0.25;

export type Ring = "hub" | "group" | "emote";
export interface Pick { ring: Ring; index: number }

export const angleOf = (dx: number, dy: number): number => {
  const a = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return a < 0 ? a + 360 : a;
};
export const indexAt = (angle: number, count: number): number => {
  if (count <= 0) return -1;
  const step = 360 / count;
  return Math.floor((((angle + step / 2) % 360) + 360) % 360 / step) % count;
};
// dx, dy: the pointer from the hub, in wheel units, y down
export const pickAt = (dx: number, dy: number, groups: number, emotes: number): Pick => {
  const r = Math.hypot(dx, dy);
  if (r < HUB_R) return { ring: "hub", index: -1 };
  const a = angleOf(dx, dy);
  if (r < RING_SPLIT) return { ring: "group", index: indexAt(a, groups) };
  return { ring: "emote", index: indexAt(a, emotes) };
};

export interface WheelEmote { anim: string; label: string }
export interface WheelGroup { id: string; label: string; emotes: WheelEmote[] }

export interface WheelState {
  open: boolean;
  x: number; y: number;              // the pointer
  group: number;                     // the group the outer ring shows
  dwell: { candidate: number; since: number };
  last: string;                      // the last emote played from the wheel, edged on it
}
export const newWheel = (): WheelState => ({ open: false, x: 0, y: 0, group: 0, dwell: { candidate: -1, since: 0 }, last: "" });

const groupOf = (groups: WheelGroup[], anim: string): number => {
  const i = groups.findIndex((g) => g.emotes.some((e) => e.anim === anim));
  return i >= 0 ? i : 0;
};

// Opened with the pointer on the hub and the outer ring on the last emote's group
export const openWheel = (st: WheelState, groups: WheelGroup[]): void => {
  st.open = true; st.x = 0; st.y = 0;
  st.group = groupOf(groups, st.last);
  st.dwell = { candidate: -1, since: 0 };
};
export const closeWheel = (st: WheelState): void => { st.open = false; };

const clampPointer = (st: WheelState): void => {
  const r = Math.hypot(st.x, st.y);
  if (r > POINTER_MAX) { st.x *= POINTER_MAX / r; st.y *= POINTER_MAX / r; }
};
// The mouse's movement (inputX right, inputY down: DirectInput's own axes) moves the pointer
export const moveMouse = (st: WheelState, inputX: number, inputY: number): void => {
  if (!st.open) return;
  st.x += (Number(inputX) || 0) * MOUSE_GAIN; st.y += (Number(inputY) || 0) * MOUSE_GAIN;
  clampPointer(st);
};
// The right stick (inputY up) points the wheel directly; let go, the pointer stays where it was
export const pointStick = (st: WheelState, inputX: number, inputY: number): void => {
  if (!st.open) return;
  const m = Math.hypot(inputX, inputY);
  if (m < STICK_DEAD) return;
  st.x = (inputX / Math.max(1, m)) * STICK_REACH; st.y = (-inputY / Math.max(1, m)) * STICK_REACH;
};

export const pickOf = (st: WheelState, groups: WheelGroup[]): Pick => {
  const emotes = groups[st.group] ? groups[st.group].emotes.length : 0;
  return pickAt(st.x, st.y, groups.length, emotes);
};
// Each frame: a group rested on for GROUP_DWELL_MS takes over the outer ring, so a flick across it to an emote does not
export const tickWheel = (st: WheelState, groups: WheelGroup[], now: number): void => {
  if (!st.open) return;
  const p = pickOf(st, groups);
  const hovered = p.ring === "group" ? p.index : -1;
  if (hovered < 0) { st.dwell = { candidate: -1, since: 0 }; return; }
  if (hovered !== st.dwell.candidate) st.dwell = { candidate: hovered, since: now };
  if (now - st.dwell.since >= GROUP_DWELL_MS) st.group = hovered;
};

// The emote under the pointer, or "" (a release or a click on anything else closes the wheel)
export const pointedAnim = (st: WheelState, groups: WheelGroup[]): string => {
  const p = pickOf(st, groups);
  const g = groups[st.group];
  return p.ring === "emote" && g && p.index >= 0 && p.index < g.emotes.length ? g.emotes[p.index].anim : "";
};
// 1..9: the shown group's emote of that number, or ""
export const numberedAnim = (st: WheelState, groups: WheelGroup[], n: number): string => {
  const g = groups[st.group];
  return g && n >= 1 && n <= g.emotes.length ? g.emotes[n - 1].anim : "";
};
// The mouse wheel or Left / Right: the next or previous group, at once
export const stepGroup = (st: WheelState, groups: WheelGroup[], by: number): void => {
  if (!groups.length) return;
  st.group = (((st.group + by) % groups.length) + groups.length) % groups.length;
  st.dwell = { candidate: -1, since: 0 };
};

// What dbo_emotewheel draws (its dboData)
export interface WheelPayload {
  groups: string[];
  group: number;
  emotes: string[];
  hover: Pick;
  last: number;               // the last emote's index in the shown group, -1 when it is in another
  pointer: [number, number];
  title: string;              // the hub's line: the hovered emote, else the hovered or shown group
}
export const payloadOf = (st: WheelState, groups: WheelGroup[]): WheelPayload => {
  const g = groups[st.group] || { label: "", emotes: [] };
  const hover = pickOf(st, groups);
  const title = hover.ring === "emote" && g.emotes[hover.index] ? g.emotes[hover.index].label
    : hover.ring === "group" && groups[hover.index] ? groups[hover.index].label : g.label;
  return {
    groups: groups.map((x) => x.label), group: st.group, emotes: g.emotes.map((e) => e.label), hover,
    last: g.emotes.findIndex((e) => e.anim === st.last), pointer: [Math.round(st.x), Math.round(st.y)], title,
  };
};
