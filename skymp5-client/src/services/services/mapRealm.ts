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
