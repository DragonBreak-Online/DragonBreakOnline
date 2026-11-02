// The realm on Skyrim's own M map (Nat, 26 Oct; _work/mmap-build-1026.md): the pure half of mapRealmService, so it can be
// tested without the engine.
// The server sends the realm's places as the map markers that stand for them; the client reveals each with
// ObjectReference.addToMap. While the MapMenu is open, a legend (front widget mapRealm) lists them by kind, and a kind can
// be hidden. A hidden marker gets its clip's scale set to 0, because SkyUI's RefreshMarkers rewrites _visible, _x, _y and
// _rotation on every refresh but never the scale (map.swf, read only).
//
//   Server -> Client: { customPacketType: "dboMapRealm", markers: [{ desc, kind, name }] }
//                     { customPacketType: "dboMapTest" }   arms the four map tests for the next opening of the map

export const WIDGET_ID = 210;
export const MAP_MENU = "MapMenu";
export const MARKER_CLIP = (i: number): string => `_root.MarkerClips.Marker${i}`;
export const MARKER_COUNT = "_root.WorldMap._markerList.length";
// Labels read from the map per update tick, so a few hundred markers never stall one frame
export const LABELS_PER_TICK = 40;

export interface RealmMarker { desc: string; kind: string; name: string }

// The legend's order; a digit key toggles the kind at its place, 0 toggles everything that is not the realm's
export const KINDS: Array<{ id: string; label: string }> = [
  { id: "seat", label: "County seat" },
  { id: "town", label: "Towns" },
  { id: "village", label: "Villages" },
  { id: "fort", label: "Forts" },
  { id: "stronghold", label: "Strongholds" },
  { id: "boss", label: "Bosses" },
];
export const OTHER = "other";

export const readMarkers = (raw: unknown): RealmMarker[] => {
  if (!Array.isArray(raw)) return [];
  const out: RealmMarker[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    const desc = typeof o.desc === "string" ? o.desc : "";
    const kind = typeof o.kind === "string" ? o.kind : "";
    const name = typeof o.name === "string" ? o.name : "";
    if (/^[0-9a-f]+:[^:]+\.es[mpl]$/i.test(desc) && KINDS.some((k) => k.id === kind) && name) out.push({ desc, kind, name });
  }
  return out;
};

// "<hex local id>:<plugin>" to what Game.getFormFromFile takes
export const descParts = (desc: string): { id: number; file: string } | null => {
  const i = desc.indexOf(":");
  if (i <= 0) return null;
  const id = parseInt(desc.slice(0, i), 16);
  return Number.isFinite(id) ? { id, file: desc.slice(i + 1) } : null;
};

// A map label's kind: the realm's own by name (case and spacing ignored), else everything else
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
export const kindIndex = (markers: RealmMarker[]): Map<string, string> => {
  const m = new Map<string, string>();
  for (const x of markers) m.set(norm(x.name), x.kind);
  return m;
};
export const kindOf = (index: Map<string, string>, label: string): string => index.get(norm(label)) || OTHER;

// What a key does while the map is open: a digit toggles a kind, R the whole legend; null when it is not ours
export const keyAction = (code: number): { toggle?: string; legend?: boolean } | null => {
  // DirectX scan codes: 1-9 are 2-10, 0 is 11, R is 19
  if (code >= 2 && code < 2 + KINDS.length) return { toggle: KINDS[code - 2].id };
  if (code === 11) return { toggle: OTHER };
  if (code === 19) return { legend: true };
  return null;
};

// The legend's rows: every kind with how many of its markers this map shows, and whether it is hidden
export const legendRows = (labels: Array<string | null>, index: Map<string, string>, hidden: Set<string>) => {
  const counts: Record<string, number> = {};
  for (const l of labels) if (l) { const k = kindOf(index, l); counts[k] = (counts[k] || 0) + 1; }
  return KINDS.map((k, i) => ({ id: k.id, label: k.label, key: String(i + 1), count: counts[k.id] || 0, shown: !hidden.has(k.id) }))
    .concat([{ id: OTHER, label: "Everything else", key: "0", count: counts[OTHER] || 0, shown: !hidden.has(OTHER) }]);
};

// The scale each marker clip should have: 0 when its kind is hidden, 100 otherwise; null for a label not read yet
export const wantedScale = (label: string | null, index: Map<string, string>, hidden: Set<string>): number | null =>
  label === null ? null : hidden.has(kindOf(index, label)) ? 0 : 100;

// ---- the legend drawn inside the MapMenu (swf/dbo_maplegend) ----
// Loaded into a clip of the map each time it opens, as dbo_hud is into the HUD Menu. One that never says it is alive
// within LEGEND_ALIVE_FRAMES leaves the legend to the browser for the rest of the session, as before
export const LEGEND_HOST = "_root.dboMapLegend";
// Since 2 Nov the legend is our own CustomMenu over the map instead (nothing can be made inside SkyUI's map); the menu SKSE
// opens for a custom swf is always this one
export const LEGEND_MENU = "CustomMenu";
// The frame of the map's opening our legend menu is opened from at the earliest (T5's, which came alive)
export const LEGEND_OPEN_FRAME = 60;
export const LEGEND_SWF = "dbo_maplegend.swf";
export const LEGEND_ALIVE_FRAMES = 60;
export interface LegendLoad { phase: "idle" | "loading" | "up" | "off"; frames: number }
export const newLegendLoad = (): LegendLoad => ({ phase: "idle", frames: 0 });
// One frame while the map is open: "inject" (make the clip and load the swf), "up", "fail" (the browser from now on) or ""
export const legendStep = (st: LegendLoad, alive: boolean): string => {
  if (st.phase === "off" || st.phase === "up") return "";
  if (st.phase === "idle") { st.phase = "loading"; st.frames = 0; return "inject"; }
  if (alive) { st.phase = "up"; return "up"; }
  if (++st.frames >= LEGEND_ALIVE_FRAMES) { st.phase = "off"; return "fail"; }
  return "";
};
// The map closed and its clip with it: the next opening loads it again, unless the session gave up on it
export const legendReset = (st: LegendLoad): void => {
  if (st.phase !== "off") { st.phase = "idle"; st.frames = 0; }
};
// What the swf draws (its dboData), the browser widget's fields
export const legendJson = (shown: boolean, rows: Array<{ id: string; label: string; key: string; count: number; shown: boolean }>): string =>
  JSON.stringify({ shown, rows });

// ---- loading a swf into the MapMenu, step by step (Leader, 2 Nov) ----
// The legend and the owners overlay never came alive in the map on Nat's dev copy, and whether a clip can be put into
// SkyUI's map.swf at all is unproven (_work/mmap-feasibility-1026.md). So each is loaded by the HUD's own rule (nativeHud.ts:
// only once the menu is open, ALIVE frames a try, MAX tries) and every step is timed: the menu seen open, each load call,
// the host clip there, our swf loaded into it (its _url names the swf), its script run (dboAlive), the first draw and the
// first fit. On close, one line a map opening goes to the server log, naming the last step reached.
export const MAP_SWF_ALIVE_FRAMES = 240;
export const MAP_SWF_TRIES = 3;
export interface SwfTrace { menu: number; inject: number[]; clip: number; loaded: number; alive: number; drawn: number; fit: number; url: string }
export interface SwfLoad { phase: "idle" | "loading" | "up" | "off"; frames: number; tries: number; t: SwfTrace }
export const newSwfLoad = (): SwfLoad => ({ phase: "idle", frames: 0, tries: 0, t: { menu: -1, inject: [], clip: -1, loaded: -1, alive: -1, drawn: -1, fit: -1, url: "" } });
// What one frame shows: the menu open, the host clip there, its _url, our swf's dboAlive
export interface SwfSeen { menu: boolean; clip: boolean; url: string; alive: boolean }
// One frame, at tick (frames since the map opened): "inject" (make the clip and load the swf), "up", "fail" or ""
// A movie's _url names this swf: Scaleform escapes it ("Interface/dbo%5Fmaplegend.swf", Nat's 04:33Z line), so it is decoded first
export const urlNames = (url: string, swf: string): boolean => {
  let u = String(url || "");
  try { u = decodeURIComponent(u); } catch { /* a stray % leaves it as it is */ }
  return u.toLowerCase().endsWith(swf.toLowerCase());
};
// tries: MAP_SWF_TRIES for a clip loaded into the map; 1 for our own CustomMenu, which must never be opened twice
export const swfStep = (st: SwfLoad, tick: number, seen: SwfSeen, swf: string, tries = MAP_SWF_TRIES): string => {
  const t = st.t;
  if (seen.menu && t.menu < 0) t.menu = tick;
  if (st.phase === "loading" || st.phase === "up") {
    if (seen.clip && t.clip < 0) t.clip = tick;
    if (seen.url) t.url = seen.url;
    if (urlNames(seen.url, swf) && t.loaded < 0) t.loaded = tick;
    if (seen.alive && t.alive < 0) t.alive = tick;
  }
  if (st.phase === "idle") {
    if (!seen.menu) return "";
    st.phase = "loading"; st.tries = 1; st.frames = 0; t.inject.push(tick);
    return "inject";
  }
  if (st.phase !== "loading") return "";
  if (seen.alive) { st.phase = "up"; return "up"; }
  if (++st.frames < MAP_SWF_ALIVE_FRAMES) return "";
  if (st.tries < tries) { st.tries++; st.frames = 0; t.inject.push(tick); return "inject"; }
  st.phase = "off";
  return "fail";
};
// The steps in order, and the last one this opening reached
export const SWF_STEPS = ["opened", "menu", "inject", "clip", "loaded", "alive", "drawn", "fit"];
export const lastSwfStep = (t: SwfTrace): string => {
  const at: Record<string, boolean> = { opened: true, menu: t.menu >= 0, inject: t.inject.length > 0, clip: t.clip >= 0, loaded: t.loaded >= 0, alive: t.alive >= 0, drawn: t.drawn >= 0, fit: t.fit >= 0 };
  let last = "opened";
  for (const s of SWF_STEPS) { if (!at[s]) break; last = s; }
  return last;
};
export const swfReport = (st: SwfLoad) => ({ last: lastSwfStep(st.t), phase: st.phase, tries: st.tries, menu: st.t.menu, inject: st.t.inject, clip: st.t.clip, loaded: st.t.loaded, alive: st.t.alive, drawn: st.t.drawn, fit: st.t.fit, url: st.t.url.slice(-80) });
