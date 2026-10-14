// What the client hands sp.loadGame for the login save, as one diag line written before the call (Worker D, 12 Oct: the
// BGSLoadFormBuffer crashes come 2.5-3 s after Play, inside the engine reading that save, and no report said what went in).
// Import-free, so harnesses can bundle it.

const hex = (n: unknown): string => (typeof n === "number" && Number.isFinite(n) ? (n >>> 0).toString(16) : String(n));
const count = (v: unknown): string => (Array.isArray(v) ? String(v.length) : v === undefined || v === null ? "none" : "?");
const nums = (v: unknown, max: number): string =>
  Array.isArray(v) ? v.slice(0, max).map(hex).join(",") + (v.length > max ? `,+${v.length - max}` : "") : "none";
const round = (v: unknown): string => (Array.isArray(v) ? v.map((x) => (typeof x === "number" ? Math.round(x) : String(x))).join(",") : "none");

// A small stable hash of the load order, so two reports can be told apart or matched without the whole list
export const orderHash = (order: string[]): string => {
  let h = 2166136261;
  for (const name of order) for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
};

export const loadGameLine = (pos: unknown, rot: unknown, worldOrCell: unknown, npc: unknown, loadOrder: unknown, time: unknown): string => {
  const n = (npc && typeof npc === "object" ? npc : null) as Record<string, unknown> | null;
  const face = (n && n["face"] && typeof n["face"] === "object" ? n["face"] : null) as Record<string, unknown> | null;
  const order = Array.isArray(loadOrder) ? (loadOrder as unknown[]).map(String) : [];
  const name = n && typeof n["name"] === "string" ? (n["name"] as string) : "";
  const parts = [
    `world ${hex(worldOrCell)} pos ${round(pos)} rot ${round(rot)}`,
    n ? `npc race ${hex(n["raceId"])} female ${String(n["isFemale"])} name ${name.length}ch${/[^\x20-\x7e]/.test(name) ? " non-ascii" : ""}` : "npc none",
    face ? `headparts ${count(face["headPartIds"])} [${nums(face["headPartIds"], 16)}] presets ${count(face["presets"])} texset ${hex(face["headTextureSetId"])} hair ${hex(face["hairColor"])} skin ${hex(face["bodySkinColor"])}` : "face none",
    `mods ${order.length} hash ${orderHash(order)} last ${order.length ? order[order.length - 1] : "none"}`,
    `hour ${time && typeof time === "object" ? String((time as Record<string, unknown>)["hours"]) : "none"}`,
  ];
  return parts.join("; ");
};
