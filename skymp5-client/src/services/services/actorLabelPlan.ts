// The rules of actorLabelService, apart from the engine so tests/actor-label-harness.js can run them.
//
// Server -> client: { customPacketType: "dboActorLabels", list: [{ id: <server actor id>, text, sub?, color?: [r, g, b, a] }] },
// sub being a smaller title line under the name,
// the whole list of labelled actors near you, sent again only when it changes (bosses.js sendLabels); an empty list clears
// every label.

export type Rgba = [number, number, number, number];

export interface LabelWanted { text: string; sub: string; color: Rgba }

// A boss's gold (bosses.js LABEL_COLOR.boss), for a row that names no colour or a bad one
export const DEFAULT_COLOR: Rgba = [1, 0.84, 0.35, 0.95];
export const MAX_TEXT = 48;
// Drawn only for an actor alive, in line of sight and this near (game units)
export const MAX_DISTANCE = 3000;

const colorOf = (raw: unknown): Rgba => {
  if (!Array.isArray(raw) || raw.length !== 4) return DEFAULT_COLOR;
  const out = raw.map((x) => Number(x));
  return out.every((x) => Number.isFinite(x) && x >= 0 && x <= 1) ? out as Rgba : DEFAULT_COLOR;
};

// The packet's list as the labels wanted, by server actor id. Rows without an id or a text are skipped; a text is trimmed
// to one line of MAX_TEXT characters; a later row for the same id wins
export const parseLabels = (content: Record<string, unknown> | null | undefined): Map<number, LabelWanted> => {
  const out = new Map<number, LabelWanted>();
  const list = content && Array.isArray(content["list"]) ? content["list"] as unknown[] : [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = Number(r["id"]) >>> 0;
    const line = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) : "");
    const text = line(r["text"]);
    if (!id || !text) continue;
    out.set(id, { text, sub: line(r["sub"]), color: colorOf(r["color"]) });
  }
  return out;
};

export const shouldDraw = (o: { found: boolean; dead: boolean; distance: number; los: boolean }): boolean =>
  o.found && !o.dead && Number.isFinite(o.distance) && o.distance <= MAX_DISTANCE && o.los;
