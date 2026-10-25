import * as fs from "fs";
import * as path from "path";

// ── Zones: where a place belongs and who rules it ────────────────────────────
//
// zones.json (next to the server, same lookup as skills.json) lists the nine holds
// with their capitals, the six sovereign orc strongholds with a centre and radius,
// and optional regions keyed by worldspace (Solstheim); regions sharing a worldspace split
// it by area polygon. A Tamriel position resolves to a stronghold when inside its radius,
// otherwise to the nearest hold capital.
// Interiors have no zone unless a region claims their worldspace.
//
// officials.json (same place) says who holds a rank in a zone, by profile id:
//   { "whiterun": { "jarl": [1], "steward": [2, 3] }, "gol-kharzum": { "chieftain": [4] } }
// It is written by the gamemode's /appoint and /dismiss commands and re-read on change.

export interface Zone {
  id: string;
  name: string;
  kind: "hold" | "stronghold" | "region";
  officials: string[];
  capital?: number[];
  center?: number[];
  radius?: number;
  worldspaces?: string[];
  // Container ref desc that receives the zone's fees, e.g. "f19f:DragonBreak.esp".
  treasury?: string;
  // The great city in the zone, if it has one; boards inside it charge city rates, the rest of the zone town rates
  majorCity?: { center: number[]; radius: number };
  // A region's land inside a shared worldspace, as a polygon of [x, y] in world units; a region without one takes the rest
  area?: number[][];
}

const ZONES_FILE = "zones.json";
const OFFICIALS_FILE = "officials.json";
const SEATS_FILE = "officials-seats.json";
const TAMRIEL_DESCS = ["3c:skyrim.esm"];
// City worldspaces share Tamriel's coordinate frame, so a board in WhiterunWorld resolves like one outside the walls.
const CITY_WORLD_DESCS = ["1a26f:skyrim.esm", "1691d:skyrim.esm", "16bb4:skyrim.esm", "16d71:skyrim.esm", "37edf:skyrim.esm"];

const numList = (v: unknown): number[] => Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : [];
const strList = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : [];
const optStr = (v: unknown): string | undefined => typeof v === "string" && v ? v : undefined;
const cityOf = (v: any): Zone["majorCity"] => {
  const center = numList(v && v.center);
  const radius = Number(v && v.radius);
  return center.length >= 2 && radius > 0 ? { center, radius } : undefined;
};
const areaOf = (v: unknown): number[][] | undefined => {
  const pts = Array.isArray(v) ? v.map(numList).filter((p) => p.length >= 2) : [];
  return pts.length >= 3 ? pts : undefined;
};
const inPolygon = (pts: number[][], x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

// "0x1A26F:Skyrim.esm", "1a26f:Skyrim.esm" and "01A26F:skyrim.esm" are one worldspace.
export const normDesc = (desc: unknown): string => {
  const s = String(desc || "");
  const i = s.indexOf(":");
  if (i < 0) return s.toLowerCase();
  const id = parseInt(s.slice(0, i), 16);
  return (Number.isFinite(id) ? id.toString(16) : s.slice(0, i).toLowerCase()) + ":" + s.slice(i + 1).toLowerCase();
};

export class Zones {
  constructor(private log: (...a: any[]) => void) { this.load(); }

  private dirs(): string[] {
    return [process.cwd(), path.dirname(process.argv[1] || ""), path.join(process.cwd(), "..")];
  }

  private load(): void {
    for (const dir of this.dirs()) {
      const file = path.join(dir, ZONES_FILE);
      let raw: any = null;
      try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
      this.zones = [];
      for (const h of Array.isArray(raw.holds) ? raw.holds : []) {
        if (!h || typeof h.id !== "string") continue;
        this.zones.push({ id: h.id, name: String(h.name || h.id), kind: "hold", officials: strList(h.officials), capital: numList(h.capital), treasury: optStr(h.treasury), majorCity: cityOf(h.majorCity) });
      }
      for (const s of Array.isArray(raw.strongholds) ? raw.strongholds : []) {
        if (!s || typeof s.id !== "string") continue;
        this.zones.push({ id: s.id, name: String(s.name || s.id), kind: "stronghold", officials: strList(s.officials), center: numList(s.center), radius: Number(s.radius) || 0, treasury: optStr(s.treasury), majorCity: cityOf(s.majorCity) });
      }
      for (const r of Array.isArray(raw.regions) ? raw.regions : []) {
        if (!r || typeof r.id !== "string") continue;
        this.zones.push({ id: r.id, name: String(r.name || r.id), kind: "region", officials: strList(r.officials), worldspaces: strList(r.worldspaces).map(normDesc), treasury: optStr(r.treasury), majorCity: cityOf(r.majorCity), area: areaOf(r.area) });
      }
      this.rankTitles = raw.rankTitles && typeof raw.rankTitles === "object" ? raw.rankTitles : {};
      this.strongholdsOverride = !(raw.sovereignty && raw.sovereignty.strongholdsOverrideHolds === false);
      this.officialsPath = path.join(dir, OFFICIALS_FILE);
      this.dataDir = dir;
      this.log(`[zones] ${this.zones.length} zones from ${file}`);
      return;
    }
    this.log(`[zones] ${ZONES_FILE} not found next to the server; nothing has a zone`);
  }

  get all(): Zone[] { return this.zones; }
  // The folder zones.json was found in; sidecar files (officials, notice boards) live there too.
  dataDir = "";
  byId(id: string): Zone | null { return this.zones.find((z) => z.id === id) || null; }
  // Inside the zone's great city; city worldspaces share their region's coordinate frame, so a position compares directly
  isMajorCity(zone: Zone, pos: unknown): boolean {
    const c = zone.majorCity;
    if (!c || !Array.isArray(pos) || pos.length < 2) return false;
    return Math.hypot(Number(pos[0]) - c.center[0], Number(pos[1]) - c.center[1]) <= c.radius;
  }
  // With a zone, the name staff gave the office there (gameplay rolenames.js via __dboOfficeTitle), else zones.json's title
  titleOf(rank: string, zoneId?: string): string {
    if (zoneId) {
      try {
        const hook = (globalThis as any).__dboOfficeTitle;
        const t = typeof hook === "function" ? hook(zoneId, rank) : null;
        if (typeof t === "string" && t) return t;
      } catch { /* the default below */ }
    }
    return String(this.rankTitles[rank] || rank);
  }

  // The zone a world position belongs to; null for interiors and unknown worldspaces.
  zoneAt(worldDesc: unknown, pos: unknown): Zone | null {
    const w = normDesc(worldDesc);
    const x = Array.isArray(pos) ? Number(pos[0]) : NaN, y = Array.isArray(pos) ? Number(pos[1]) : NaN;
    const regions = this.zones.filter((z) => z.kind === "region" && z.worldspaces && z.worldspaces.indexOf(w) !== -1);
    if (regions.length) {
      const known = Number.isFinite(x) && Number.isFinite(y);
      return regions.find((z) => z.area && known && inPolygon(z.area, x, y)) || regions.find((z) => !z.area) || null;
    }
    if (TAMRIEL_DESCS.indexOf(w) === -1 && CITY_WORLD_DESCS.indexOf(w) === -1) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (this.strongholdsOverride) {
      for (const z of this.zones) {
        if (z.kind !== "stronghold" || !z.center || !z.radius) continue;
        const dx = x - z.center[0], dy = y - z.center[1];
        if (dx * dx + dy * dy <= z.radius * z.radius) return z;
      }
    }
    let best: Zone | null = null, bestD2 = Infinity;
    for (const z of this.zones) {
      if (z.kind !== "hold" || !z.capital) continue;
      const dx = x - z.capital[0], dy = y - z.capital[1];
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = z; }
    }
    return best;
  }

  // ── Officials ───────────────────────────────────────────────────────────────

  private officials(): Record<string, Record<string, number[]>> {
    if (!this.officialsPath) return {};
    let mtime = 0;
    try { mtime = fs.statSync(this.officialsPath).mtimeMs; } catch { this.officialsCache = {}; return this.officialsCache; }
    if (mtime === this.officialsMtime) return this.officialsCache;
    this.officialsMtime = mtime;
    try {
      const raw = JSON.parse(fs.readFileSync(this.officialsPath, "utf8"));
      const out: Record<string, Record<string, number[]>> = {};
      for (const zoneId of Object.keys(raw || {})) {
        if (zoneId.startsWith("_") || !raw[zoneId] || typeof raw[zoneId] !== "object") continue;
        out[zoneId] = {};
        for (const rank of Object.keys(raw[zoneId])) out[zoneId][rank] = numList(raw[zoneId][rank]);
      }
      this.officialsCache = out;
    } catch (e) { this.log(`[zones] ${OFFICIALS_FILE} unreadable: ${e}`); this.officialsCache = {}; }
    return this.officialsCache;
  }

  // officials-seats.json (the gamemode writes it): which character holds an account's seat, { zone: { rank: { profileId: actorId } } }.
  // A seat with no character recorded is the account's, as before.
  private seats(): Record<string, Record<string, Record<string, number>>> {
    if (!this.officialsPath) return {};
    const p = path.join(path.dirname(this.officialsPath), SEATS_FILE);
    let mtime = 0;
    try { mtime = fs.statSync(p).mtimeMs; } catch { this.seatsCache = {}; this.seatsMtime = -1; return this.seatsCache; }
    if (mtime === this.seatsMtime) return this.seatsCache;
    this.seatsMtime = mtime;
    try { const raw = JSON.parse(fs.readFileSync(p, "utf8")); this.seatsCache = raw && typeof raw === "object" ? raw : {}; }
    catch (e) { this.log(`[zones] ${SEATS_FILE} unreadable: ${e}`); this.seatsCache = {}; }
    return this.seatsCache;
  }

  // The rank a profile holds in a zone ("jarl", "steward", ...), or null. With actorId, only a seat that character holds
  // (Nate, 19 Oct: an account's other characters do not hold its office).
  rankOf(profileId: number, zoneId: string, actorId?: number): string | null {
    const z = this.byId(zoneId);
    if (!z || !Number.isFinite(profileId) || profileId < 0) return null;
    const table = this.officials()[zoneId] || {};
    const bound = actorId ? (this.seats()[zoneId] || {}) : {};
    for (const rank of z.officials) {
      if ((table[rank] || []).indexOf(profileId) === -1) continue;
      const held = Number((bound[rank] || {})[String(profileId)]) >>> 0;
      if (actorId && held && held !== (actorId >>> 0)) continue;
      return rank;
    }
    return null;
  }

  isOfficial(profileId: number, zoneId: string): boolean { return this.rankOf(profileId, zoneId) !== null; }

  private zones: Zone[] = [];
  private rankTitles: Record<string, string> = {};
  private strongholdsOverride = true;
  private officialsPath = "";
  private officialsMtime = -1;
  private officialsCache: Record<string, Record<string, number[]>> = {};
  private seatsMtime = -1;
  private seatsCache: Record<string, Record<string, Record<string, number>>> = {};
}

let shared: Zones | null = null;
export const getZones = (log: (...a: any[]) => void): Zones => {
  if (!shared) shared = new Zones(log);
  return shared;
};
