// The native emote wheel's pure half (route H: drawn in the HUD Menu by swf/dbo_emotewheel, no menu opened, no cursor):
// the same ring and rules as the browser wheel (skymp5-front features/emoteWheel/wheelGeometry.ts), pointed by the mouse's
// own movement (SkyrimPlatform mouseMove) or the gamepad's right stick instead of a cursor. No game calls here, so
// tests/native-emote-wheel-harness.js runs it as is.
//
// One ring (Nat's pick, 2 Nov, option A of _work/emote-wheel-1102.md): the shown group's emotes fill the whole wheel from the
// hub out, so every emote is one motion from the hub. The groups are tabs under it, switched at once by the mouse wheel,
// Left / Right or the bumpers: no inner ring to cross and no rest on it. The wheel opens on Recent, the last emotes played
// this session, when there are any.

// The browser wheel's geometry, in its units (a 640-unit square, the hub at its centre)
export const HUB_R = 78;
export const EMOTE_INNER = 86;
export const EMOTE_OUTER = 300;
// Wheel units per unit of mouse movement; the pointer stops at the ring's edge, so a flick overshoots harmlessly
export const MOUSE_GAIN = 0.9;
const POINTER_MAX = EMOTE_OUTER;
// The right stick points straight at the ring: pushed fully, the middle of the emote ring
const STICK_REACH = (EMOTE_INNER + EMOTE_OUTER) / 2;
const STICK_DEAD = 0.25;
// Recent: the emotes played this session, newest first, at most this many
export const RECENT_MAX = 8;
export const RECENT_ID = "recent";
// The line under the tabs: how to change the group (the numbers are on the wedges)
export const SWITCH_HINT = "Mouse wheel or Left / Right: another group";

export type Ring = "hub" | "emote";
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
export const pickAt = (dx: number, dy: number, emotes: number): Pick => {
  if (Math.hypot(dx, dy) < HUB_R) return { ring: "hub", index: -1 };
  return { ring: "emote", index: indexAt(angleOf(dx, dy), emotes) };
};

export interface WheelEmote { anim: string; label: string }
export interface WheelGroup { id: string; label: string; emotes: WheelEmote[] }

export interface WheelState {
  open: boolean;
  x: number; y: number;              // the pointer
  group: number;                     // the group the ring shows
  last: string;                      // the last emote played from the wheel, edged on it
  recent: string[];                  // the emotes played this session, newest first
}
export const newWheel = (): WheelState => ({ open: false, x: 0, y: 0, group: 0, last: "", recent: [] });

// The groups the wheel shows: Recent first when anything has been played, then the catalogue's
export const wheelGroups = (st: WheelState, catalogue: WheelGroup[]): WheelGroup[] => {
  const byAnim = new Map<string, WheelEmote>();
  for (const g of catalogue) for (const e of g.emotes) if (!byAnim.has(e.anim)) byAnim.set(e.anim, e);
  const recent = st.recent.map((a) => byAnim.get(a)).filter((e): e is WheelEmote => !!e);
  return recent.length ? [{ id: RECENT_ID, label: "Recent", emotes: recent }, ...catalogue] : catalogue;
};
// An emote played from the wheel: edged next time, and first in Recent
export const notePlayed = (st: WheelState, anim: string): void => {
  if (!anim) return;
  st.last = anim;
  st.recent = [anim, ...st.recent.filter((a) => a !== anim)].slice(0, RECENT_MAX);
};

const groupOf = (groups: WheelGroup[], anim: string): number => {
  const i = groups.findIndex((g) => g.id !== RECENT_ID && g.emotes.some((e) => e.anim === anim));
  return i >= 0 ? i : 0;
};

// Opened with the pointer on the hub, on Recent when there is one, else on the last emote's group
export const openWheel = (st: WheelState, groups: WheelGroup[]): void => {
  st.open = true; st.x = 0; st.y = 0;
  st.group = groups[0] && groups[0].id === RECENT_ID ? 0 : groupOf(groups, st.last);
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
  return pickAt(st.x, st.y, emotes);
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
// The mouse wheel, Left / Right or the bumpers: the next or previous group, at once
export const stepGroup = (st: WheelState, groups: WheelGroup[], by: number): void => {
  if (!groups.length) return;
  st.group = (((st.group + by) % groups.length) + groups.length) % groups.length;
};

// What dbo_emotewheel draws (its dboData)
export interface WheelPayload {
  groups: string[];           // the tabs
  group: number;
  emotes: string[];
  hover: Pick;
  last: number;               // the last emote's index in the shown group, -1 when it is in another
  pointer: [number, number];
  title: string;              // the hub's line: the hovered emote, else the shown group
  hint: string;
}
export const payloadOf = (st: WheelState, groups: WheelGroup[]): WheelPayload => {
  const g = groups[st.group] || { label: "", emotes: [] };
  const hover = pickOf(st, groups);
  const title = hover.ring === "emote" && g.emotes[hover.index] ? g.emotes[hover.index].label : g.label;
  return {
    groups: groups.map((x) => x.label), group: st.group, emotes: g.emotes.map((e) => e.label), hover,
    last: g.emotes.findIndex((e) => e.anim === st.last), pointer: [Math.round(st.x), Math.round(st.y)], title, hint: SWITCH_HINT,
  };
};
