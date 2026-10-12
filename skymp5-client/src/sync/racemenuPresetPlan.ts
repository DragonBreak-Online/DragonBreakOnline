// RaceMenu face presets (custom sliders, expressions, sculpt) carried between games as the face part of a skee .jslot.
// No imports, so a harness can load it on its own (tests/racemenu-preset-plan-harness.js). The server's racemenupresets.js
// applies the same rules and is the one that counts; this copy trims the upload and guards what reaches skee here.

// Longest face preset text sent or kept (a heavily sculpted head is a few hundred KB)
export const PRESET_MAX_CHARS = 1000000;
export const CHUNK_CHARS = 12000;
export const MAX_CHUNKS = Math.ceil(PRESET_MAX_CHARS / CHUNK_CHARS);
export const MAX_CUSTOM_MORPHS = 1024;
export const MAX_MORPH_NAME = 128;
// skee's ranges (FaceMorphInterface.cpp:963-968, 1318-1354): a preset index 0..255 is kept, any other value clamped to +-MAX_SLIDER
export const MAX_SLIDER = 10;
export const MAX_PRESET_INDEX = 255;
// skee applies a slider once per whole unit of its value on every watcher (FaceMorphInterface.cpp:1156-1167): a face's limit
export const MAX_MORPH_REPEATS = 4096;
// A sculpt moves a vertex at most this many units (a head is about 20 across); an offset past it is clamped
export const MAX_SCULPT_UNITS = 30;
export const MAX_SCULPT_HOSTS = 16;
// skee keeps sculpt indices as UInt16
export const MAX_VERTICES = 65535;
export const MAX_SCULPT_OFFSET = 10000000;
export const MAX_SCULPT_DIVISOR = 1000000;
export const MAX_MOD_NAMES = 512;
export const MAX_MOD_NAME = 260;
export const MAX_TRI_PATH = 200;
// skee's PresetHeader (PresetInterface.cpp:300-305): "SKSE" byte-swapped, format 3; its loader needs both (:932-946)
export const SKEE_SIGNATURE = 0x45534b53;
export const SKEE_FORMAT_VERSION = 3;

export interface PresetVersion {
  signature: number;
  formatVersion: number;
  skseVersion: number;
  runtimeVersion: number;
}

export interface CustomMorph {
  name: string;
  value: number;
}

export interface SculptHost {
  host: string;
  vertices: number;
  // [vertex index, x, y, z] with offsets multiplied by sculptDivisor
  data: number[][];
}

export interface FacePreset {
  version: PresetVersion;
  modNames: string[];
  custom: CustomMorph[];
  sculptDivisor: number;
  sculpt: SculptHost[];
}

// One kind of fix the rules made: its code, how many entries, and the first one (for the local diag file only, never the trace)
export interface FaceFix { code: string; n: number; first: string }
export interface FaceTaken { face: FacePreset; fixes: FaceFix[] }

const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isUint32 = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 0xffffffff;
const isIntIn = (x: unknown, lo: number, hi: number): x is number => typeof x === "number" && Number.isInteger(x) && x >= lo && x <= hi;
const hasControl = (s: string): boolean => /[\u0000-\u001f\u007f]/.test(s);
const isCleanString = (x: unknown, max: number): x is string => typeof x === "string" && x.length > 0 && x.length <= max && !hasControl(x);
// skee's names compare as _stricmp does (StringTable.h SKEEFixedString): ASCII letters only
const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

// ValidateTriPath's rule (platform PresetFiles.cpp) plus the apostrophe of KS Hairdo's; the platform answers -1 there, so that sculpt is dropped
export const isTriPath = (x: unknown): x is string => {
  if (typeof x !== "string" || !x.length || x.length > MAX_TRI_PATH) return false;
  if (!/^[A-Za-z0-9_\-. \\/']+$/.test(x)) return false;
  if (/^[\\/ ]/.test(x) || x.indexOf("..") !== -1) return false;
  return /\.tri$/i.test(x);
};

const versionFrom = (x: unknown): PresetVersion | null => {
  if (!isObject(x)) return null;
  const { signature, formatVersion, skseVersion, runtimeVersion } = x;
  if (!isUint32(signature) || !isUint32(formatVersion) || formatVersion < 1) return null;
  return { signature, formatVersion, skseVersion: isUint32(skseVersion) ? skseVersion : 0, runtimeVersion: isUint32(runtimeVersion) ? runtimeVersion : 0 };
};

// skee refuses a preset whose mods and modNames are both empty; the names themselves are not used for the face
const modNamesFrom = (root: Record<string, unknown>): string[] => {
  const out: string[] = [];
  const push = (n: unknown) => { if (isCleanString(n, MAX_MOD_NAME) && out.length < MAX_MOD_NAMES && out.indexOf(n) === -1) out.push(n); };
  if (Array.isArray(root.modNames)) root.modNames.forEach(push);
  if (!out.length && Array.isArray(root.mods)) root.mods.forEach((m) => { if (isObject(m)) push(m.name); });
  if (!out.length) out.push("Skyrim.esm");
  return out;
};

// A slider value as kept, or null for what is not a finite number
export const morphValueOf = (v: unknown): number | null => {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (Number.isInteger(v) && v >= 0 && v <= MAX_PRESET_INDEX) return v;
  return Math.min(MAX_SLIDER, Math.max(-MAX_SLIDER, v));
};
// A value kept unchanged by the rules
export const morphValueOk = (v: unknown): v is number => morphValueOf(v) === v;

// Collects the fixes in the order they first happen, so one input always gives one list
class Fixes {
  list: FaceFix[] = [];
  add(code: string, first: () => string, n = 1): void {
    const f = this.list.find((x) => x.code === code);
    if (f) f.n += n;
    else this.list.push({ code, n, first: first().slice(0, 120) });
  }
}

const customFrom = (x: unknown, fx: Fixes): CustomMorph[] => {
  if (x === undefined || x === null) return [];
  if (!Array.isArray(x)) { fx.add("custom-list", () => typeof x); return []; }
  // skee's ValueSet keeps one value per name (any case), the last one set (FaceMorphInterface.cpp:450-457)
  const byName = new Map<string, CustomMorph>();
  for (let i = 0; i < x.length; i++) {
    const m = x[i];
    if (!isObject(m) || !isCleanString(m.name, MAX_MORPH_NAME)) { fx.add("custom-name", () => `#${i}`); continue; }
    const name = m.name;
    const value = morphValueOf(m.value);
    if (value === null) { fx.add("custom-value", () => `${name}=${String(m.value)}`); continue; }
    if (value !== m.value) fx.add("custom-clamp", () => `${name}=${String(m.value)}`);
    const key = asciiLower(name);
    const had = byName.get(key);
    if (had) { fx.add("custom-dup", () => name); had.value = value; } else byName.set(key, { name, value });
  }
  const out: CustomMorph[] = [];
  let repeats = MAX_MORPH_REPEATS;
  for (const m of Array.from(byName.values())) {
    if (m.value === 0) continue;
    if (out.length >= MAX_CUSTOM_MORPHS) { fx.add("custom-count", () => m.name); continue; }
    const cost = Math.floor(Math.abs(m.value));
    if (cost > repeats) { fx.add("custom-budget", () => `${m.name}=${m.value}`); continue; }
    repeats -= cost;
    out.push({ name: m.name, value: m.value });
  }
  return out;
};

// A broken entry is dropped, an offset clamped, a repeated vertex kept once with its last offsets (skee's force_insert)
const sculptDataFrom = (raw: unknown[], vertices: number, maxOffset: number, host: string, fx: Fixes): number[][] => {
  const byIndex = new Map<number, number[]>();
  let clamped = 0;
  for (const v of raw) {
    if (!Array.isArray(v) || v.length !== 4 || !isIntIn(v[0], 0, vertices - 1)
      || !Number.isInteger(v[1]) || !Number.isInteger(v[2]) || !Number.isInteger(v[3])) { fx.add("sculpt-vertex", () => host); continue; }
    const e = [v[0] as number];
    let c = false;
    for (let k = 1; k < 4; k++) {
      const o = v[k] as number;
      const b = Math.min(maxOffset, Math.max(-maxOffset, o));
      if (b !== o) c = true;
      e.push(b);
    }
    if (c) clamped++;
    if (byIndex.has(e[0])) fx.add("sculpt-dupvertex", () => host);
    byIndex.set(e[0], e);
  }
  if (clamped) fx.add("sculpt-offset", () => host, clamped);
  return Array.from(byIndex.values());
};

// skee writes vertices 4294967295 for a host that is no chargen tri (PresetInterface.cpp:473-476): the capture reads this game's count
const sculptFrom = (x: unknown, divisor: number, fx: Fixes, vertexCountOf?: (host: string) => number): SculptHost[] => {
  if (x === undefined || x === null) return [];
  if (!Array.isArray(x)) { fx.add("sculpt-list", () => typeof x); return []; }
  const maxOffset = Math.min(MAX_SCULPT_OFFSET, MAX_SCULPT_UNITS * divisor);
  const out: SculptHost[] = [];
  for (let i = 0; i < x.length; i++) {
    const h = x[i];
    if (!isObject(h) || !isTriPath(h.host)) { fx.add("sculpt-host", () => (isObject(h) ? String(h.host) : `#${i}`)); continue; }
    const host = h.host;
    const raw = h.data === undefined || h.data === null ? [] : h.data;
    if (!Array.isArray(raw)) { fx.add("sculpt-data", () => host); continue; }
    // Empty, or a second entry for a host already taken (any case): left out
    if (!raw.length || out.some((o) => o.host.toLowerCase() === host.toLowerCase())) continue;
    let vertices = h.vertices;
    if (!isIntIn(vertices, 1, MAX_VERTICES)) {
      let local = -1;
      if (vertexCountOf) { try { local = vertexCountOf(host); } catch { local = -1; } }
      if (!isIntIn(local, 1, MAX_VERTICES)) { fx.add("sculpt-vertices", () => `${host} ${String(h.vertices)}`); continue; }
      fx.add("sculpt-recount", () => `${host} ${String(h.vertices)} -> ${local}`);
      vertices = local;
    }
    const data = sculptDataFrom(raw, vertices as number, maxOffset, host, fx);
    if (!data.length) continue;
    if (out.length >= MAX_SCULPT_HOSTS) { fx.add("sculpt-count", () => host); continue; }
    out.push({ host, vertices: vertices as number, data });
  }
  return out;
};

// An upper bound of encodeFace's length (a name char escapes to at most 6, a number is at most 25 chars), so most faces skip the encode
const encodedAtMost = (f: FacePreset): number => {
  let n = 400;
  for (const m of f.modNames) n += m.length * 6 + 3;
  for (const m of f.custom) n += m.name.length * 6 + 50;
  for (const h of f.sculpt) n += h.host.length * 6 + 60 + h.data.length * 40;
  return n;
};

// The face part of a .jslot with each bad entry dropped or clamped on its own (racemenupresets.js faceFixed is the same), null if no object
export const facePresetFixed = (jslot: unknown, vertexCountOf?: (host: string) => number): FaceTaken | null => {
  if (!isObject(jslot)) return null;
  const fx = new Fixes();
  let version = versionFrom(jslot.version);
  if (!version) { fx.add("version", () => "version"); version = { signature: SKEE_SIGNATURE, formatVersion: SKEE_FORMAT_VERSION, skseVersion: 0, runtimeVersion: 0 }; }
  const morphs = isObject(jslot.morphs) ? jslot.morphs : {};
  const custom = customFrom(morphs.custom, fx);
  const hasSculpt = Array.isArray(morphs.sculpt) && morphs.sculpt.some((h) => isObject(h) && Array.isArray(h.data) && h.data.length > 0);
  let sculpt: SculptHost[] = [];
  if (hasSculpt && !isIntIn(morphs.sculptDivisor, 1, MAX_SCULPT_DIVISOR)) fx.add("sculpt-divisor", () => String(morphs.sculptDivisor));
  else sculpt = sculptFrom(morphs.sculpt, hasSculpt ? morphs.sculptDivisor as number : 10000, fx, vertexCountOf);
  const face: FacePreset = { version, modNames: modNamesFrom(jslot), custom, sculptDivisor: sculpt.length ? morphs.sculptDivisor as number : 10000, sculpt };
  // Too long to send or keep: the largest sculpted parts go first, the sliders stay
  while (face.sculpt.length && encodedAtMost(face) > PRESET_MAX_CHARS && encodeFace(face).length > PRESET_MAX_CHARS) {
    let big = 0;
    for (let i = 1; i < face.sculpt.length; i++) if (face.sculpt[i].data.length > face.sculpt[big].data.length) big = i;
    const gone = face.sculpt[big];
    fx.add("sculpt-size", () => gone.host);
    face.sculpt = face.sculpt.filter((_, i) => i !== big);
    if (!face.sculpt.length) face.sculptDivisor = 10000;
  }
  return { face, fixes: fx.list };
};

export const facePresetFrom = (jslot: unknown, vertexCountOf?: (host: string) => number): FacePreset | null => {
  const taken = facePresetFixed(jslot, vertexCountOf);
  return taken ? taken.face : null;
};

// The trace's short form of the fixes: "code:n,code:n" (no names or paths)
export const fixesText = (fixes: FaceFix[]): string => fixes.map((f) => `${f.code}:${f.n}`).join(",");

// Why facePresetFrom gives null, or null when it takes the face
export interface PresetRefusal { code: string; at: number; value: string; detail: string }
export const facePresetRefusal = (jslot: unknown): PresetRefusal | null => (isObject(jslot) ? null : { code: "notobject", at: -1, value: typeof jslot, detail: "not an object" });

export const isEmptyFace = (f: FacePreset): boolean => !f.custom.length && !f.sculpt.length;

// Fixed key order, so one face is always one text and one hash
export const encodeFace = (f: FacePreset): string => JSON.stringify({
  version: { signature: f.version.signature, formatVersion: f.version.formatVersion, skseVersion: f.version.skseVersion, runtimeVersion: f.version.runtimeVersion },
  modNames: f.modNames,
  custom: f.custom.map((m) => ({ name: m.name, value: m.value })),
  sculptDivisor: f.sculptDivisor,
  sculpt: f.sculpt.map((h) => ({ host: h.host, vertices: h.vertices, data: h.data })),
});

export const decodeFace = (text: unknown): FacePreset | null => {
  if (typeof text !== "string" || !text.length || text.length > PRESET_MAX_CHARS) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!isObject(raw)) return null;
  return facePresetFrom({ version: raw.version, modNames: raw.modNames, morphs: { custom: raw.custom, sculptDivisor: raw.sculptDivisor, sculpt: raw.sculpt } });
};

// FNV-1a over UTF-16 code units, 8 hex digits; the server computes the same (racemenupresets.js)
export const hashText = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ("0000000" + h.toString(16)).slice(-8);
};

// skee adds each offset to the head's vertex data with no bounds check: a host goes only when this game's own mesh has
// the vertex count the owner's had. vertexCountOf answers -1 for a mesh it cannot read.
export const boundSculpt = (f: FacePreset, vertexCountOf: (host: string) => number): { face: FacePreset; dropped: string[] } => {
  const dropped: string[] = [];
  const sculpt = f.sculpt.filter((h) => {
    let local = -1;
    try { local = vertexCountOf(h.host); } catch { local = -1; }
    const ok = local === h.vertices && h.data.every((v) => v[0] < local);
    if (!ok) dropped.push(`${h.host} (${h.vertices} here ${local})`);
    return ok;
  });
  return { face: { ...f, sculpt }, dropped };
};

// skee's GetFormIdentifier: "<plugin>|<local id, 6 hex>"; a light plugin's local id is the low 12 bits
export const formIdentifierOf = (formId: number, modName: (index: number) => string, lightModName: (index: number) => string): string | null => {
  const id = formId >>> 0;
  const top = id >>> 24;
  if (top === 0xff) return null;
  let name = "";
  try { name = top === 0xfe ? lightModName((id >>> 12) & 0xfff) : modName(top); } catch { name = ""; }
  if (!name) return null;
  const local = top === 0xfe ? id & 0xfff : id & 0xffffff;
  return `${name}|${("00000" + local.toString(16).toUpperCase()).slice(-6)}`;
};

// The .jslot handed to CharGen.LoadCharacterPresetEx. skee resets the head parts to the race's defaults and adds these
// back, sets this weight, and leaves tints, face textures and the vanilla sliders alone when they are absent.
export const buildJslot = (f: FacePreset, headParts: string[], weight: number): string => JSON.stringify({
  version: f.version,
  modNames: f.modNames,
  headParts: headParts.map((formIdentifier) => ({ formIdentifier })),
  actor: { weight: Number.isFinite(weight) ? Math.min(100, Math.max(0, weight)) : 50 },
  morphs: { custom: f.custom, sculptDivisor: f.sculptDivisor, sculpt: f.sculpt },
});

export const chunkText = (text: string, size: number = CHUNK_CHARS): string[] => {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
};

// The preset file name for one character (platform rule [A-Za-z0-9_-]{1,64}); "self" for the player
export const presetFileName = (remoteId: number | "self"): string => remoteId === "self" ? "self" : `c${(remoteId >>> 0).toString(16)}`;

export interface ChunkPacket {
  actor: number;
  hash: string;
  i: number;
  n: number;
  data: string;
}

export const readChunkPacket = (content: Record<string, unknown> | null): ChunkPacket | null => {
  if (!content) return null;
  const actor = Number(content.actor) >>> 0;
  const hash = content.hash, i = content.i, n = content.n, data = content.data;
  if (!actor || typeof hash !== "string" || !/^[0-9a-f]{8}$/.test(hash)) return null;
  if (!isIntIn(n, 1, MAX_CHUNKS) || !isIntIn(i, 0, n - 1) || typeof data !== "string" || data.length > CHUNK_CHARS) return null;
  return { actor, hash, i, n, data };
};

// Collects one preset's chunks per character; a transfer that stalls is dropped
export class ChunkAssembler {
  constructor(private timeoutMs: number = 60000, private maxOpen: number = 8) {}

  // The whole text once every chunk is in and the hash matches, else null
  push(p: ChunkPacket, now: number): string | null {
    this.expire(now);
    const key = `${p.actor}:${p.hash}`;
    let t = this.open[key];
    if (!t || t.n !== p.n) {
      if (!t && Object.keys(this.open).length >= this.maxOpen) return null;
      t = this.open[key] = { n: p.n, parts: new Array<string | undefined>(p.n), got: 0, at: now };
    }
    t.at = now;
    if (t.parts[p.i] === undefined) { t.parts[p.i] = p.data; t.got++; }
    if (t.got < t.n) return null;
    delete this.open[key];
    const text = t.parts.join("");
    return text.length <= PRESET_MAX_CHARS && hashText(text) === p.hash ? text : null;
  }

  get openCount(): number {
    return Object.keys(this.open).length;
  }

  private expire(now: number): void {
    Object.keys(this.open).forEach((k) => { if (now - this.open[k].at > this.timeoutMs) delete this.open[k]; });
  }

  private open: Record<string, { n: number; parts: (string | undefined)[]; got: number; at: number }> = {};
}

// When a character's face may go onto its copy (or onto the player): its race is the one it was made with, never a
// beast form, no RaceMenu open or settling here, its 3D in, and not in a fight (a 3D rebuild there is the crash risk)
export interface ApplyGate {
  raceNow: number;
  presetRace: number;
  isBeast: boolean;
  raceMenuSettling: boolean;
  loaded3D: boolean;
  inCombat: boolean;
}

export const applyBlockedBy = (g: ApplyGate): string | null => {
  if (g.raceMenuSettling) return "racemenu";
  if (g.isBeast) return "beast";
  if (!g.loaded3D) return "3d";
  if (g.inCombat) return "combat";
  if (g.presetRace && (g.raceNow >>> 0) !== (g.presetRace >>> 0)) return "race";
  return null;
};

// The server's race families (racemenupresets.js sameFamily over racedefaultheads.json): a race and its vampire variant
const RACE_FAMILIES: number[][] = [
  [0x13740, 0x8883a], // Argonian
  [0x13741, 0x8883c], // Breton
  [0x13742, 0x8883d], // Dark Elf
  [0x13743, 0x88840], // High Elf (the Maormer on the High Elf record too)
  [0x13744, 0x88844], // Imperial
  [0x13745, 0x88845], // Khajiit
  [0x13746, 0x88794], // Nord
  [0x13747, 0xa82b9], // Orc
  [0x13748, 0x88846], // Redguard
  [0x13749, 0x88884], // Wood Elf
  [0x2c65c], [0x2c659], [0x2c65b], [0x2c658], // the Breton, Imperial, Nord and Redguard children
  [0x131f0], // Dremora
];
const FAMILY_OF: Record<number, number> = {};
for (const family of RACE_FAMILIES) for (const id of family) FAMILY_OF[id] = family[0];

// A face stored on another family's race never goes on this one; null when a race is not in the list
export const otherRaceFamily = (now: number, stored: number): boolean | null => {
  const a = now >>> 0, b = stored >>> 0;
  if (!a || !b) return null;
  if (a === b) return false;
  const fa = FAMILY_OF[a], fb = FAMILY_OF[b];
  if (fa === undefined || fb === undefined) return null;
  return fa !== fb;
};

// Which copies need their face: one go per local copy and preset hash. A copy that respawns has a new local id and a
// fresh base (sync/appearance.ts createNpc), so it is due again.
export class ApplyLedger {
  isDone(localId: number, hash: string): boolean {
    return this.done[localId >>> 0] === hash;
  }

  markDone(localId: number, hash: string): void {
    this.done[localId >>> 0] = hash;
  }

  forget(localId: number): void {
    delete this.done[localId >>> 0];
  }

  // Drops copies that are gone; keeps the list bounded across a long session
  keepOnly(localIds: number[]): void {
    const keep: Record<number, string> = {};
    for (const id of localIds) if (this.done[id >>> 0] !== undefined) keep[id >>> 0] = this.done[id >>> 0];
    this.done = keep;
  }

  clear(): void {
    this.done = {};
  }

  private done: Record<number, string> = {};
}
