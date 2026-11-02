// The character creator's state and rules for the native panel (swf/dbo_creator), as the browser creator keeps them
// (skymp5-front features/charCreator index.js and its screens): five steps, the same choices, limits and words. The rules
// and data are the front's own modules (frontModel.ts); this file is what its React components did around them. The panel
// draws the page view() describes and sends back ["key", value], which act() applies. No imports from SkyrimPlatform, so
// a harness runs it on its own.
import * as M from "./frontModel";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export const STEPS = ["Species", "Race", "Identity", "Appearance", "Story"];
export const NAME_MAX = 30;
export const BACKSTORY_MAX = 4000;
export const DESCRIPTION_MAX = 1000;
const NAME_CHARS = /^[A-Za-z' -]+$/;
const MORPH_TICK = 0.05;
const PART_KINDS = [
  { kind: "hair", label: "Hair", slot: "hair", noneAllowed: true },
  { kind: "eyes", label: "Eyes", slot: "eyes", noneAllowed: false },
  { kind: "brows", label: "Brows", slot: "brows", noneAllowed: true },
  { kind: "facialHair", label: "Facial Hair", slot: "", noneAllowed: false },
  { kind: "scars", label: "Scars", slot: "", noneAllowed: false },
];
const MORPH_GROUPS = [
  { name: "Nose", indices: [0, 1] }, { name: "Jaw", indices: [2, 3, 4] }, { name: "Cheeks", indices: [5, 6] },
  { name: "Eyes", indices: [7, 8, 17] }, { name: "Brows", indices: [9, 10, 11] }, { name: "Lips", indices: [12, 13] },
  { name: "Chin", indices: [14, 15, 16] },
];

export interface Config {
  statPool: number; disabledRaces: string[]; lockedRaces: string[]; allowChildren: boolean;
}
export interface State {
  step: number; species: string | null; race: string | null; sex: string; age: string; stats: Record<string, number>;
  look: Any; name: string; backstory: string; description: string; waiting: boolean; error: string;
}

export const configOf = (raw: unknown): Config => {
  const c = (raw && typeof raw === "object" ? raw : {}) as Any;
  return {
    statPool: Number.isInteger(c.statPool) && c.statPool >= 0 ? c.statPool : M.DEFAULT_STAT_POOL,
    disabledRaces: Array.isArray(c.disabledRaces) ? c.disabledRaces.map(String) : [],
    lockedRaces: Array.isArray(c.lockedRaces) ? c.lockedRaces.map(String) : [],
    allowChildren: !!c.allowChildren,
  };
};

export const initialState = (): State => ({
  step: 1, species: null, race: null, sex: "male", age: "adult", stats: M.defaultStats() as Record<string, number>, look: M.defaultLook(null, "adult", "male"),
  name: "", backstory: "", description: "", waiting: false, error: "",
});

// StoryScreen.js nameError: the server trims first and requires a letter
export const nameError = (raw: string): string | null => {
  const name = raw.trim();
  if (name.length < 2) return "Name must be at least 2 characters.";
  if (name.length > NAME_MAX) return "Name must be at most 30 characters.";
  if (!NAME_CHARS.test(name)) return "Only letters, spaces, ' and - are allowed.";
  if (!/[A-Za-z]/.test(name)) return "Name must contain letters.";
  return null;
};

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const raceOf = (s: State): Any => (s.race ? (M.findRace(s.race) || {}).race || null : null);
const visibleSpecies = (c: Config): Any[] => M.SPECIES.filter((sp: Any) => !sp.races.every((r: Any) => c.disabledRaces.includes(r.id)));

export const canNext = (s: State, c: Config): boolean => {
  if (s.step === 1) return !!s.species;
  if (s.step === 2) return !!s.race && !c.lockedRaces.includes(s.race);
  return s.step < 5;
};

// A head part kind's carousel (AppearanceScreen partCarousels), or null when it is not offered
export const partOptions = (s: State, kind: string): Array<{ value: number | null; label: string }> | null => {
  const race = raceOf(s);
  const def = PART_KINDS.find((d) => d.kind === kind);
  if (!race || !race.faceGen || !def) return null;
  const species = (M.findRace(race.id) || {}).species;
  if (kind === "facialHair" && (s.sex !== "male" || !species || !["human", "mer"].includes(species.id))) return null;
  const parts = M.partsFor(kind, race, s.age, s.sex) as Any[];
  const defaults = M.raceDefaultsFor(race, s.age, s.sex) as Any;
  const defaultId = def.slot ? defaults[def.slot] : undefined;
  const options: Array<{ value: number | null; label: string }> = [];
  if (def.noneAllowed || defaultId === undefined) options.push({ value: null, label: "None" });
  if (defaultId !== undefined && !parts.some((p) => p.id === defaultId)) options.push({ value: defaultId, label: "Default" });
  for (const p of parts) options.push({ value: p.id, label: p.label });
  if (!options.length || (options.length === 1 && options[0].value === null)) return null;
  return options;
};

const skinPresets = (s: State): number[][] => (M.tintsFor(raceOf(s), s.age, s.sex, M.TINT_TYPES.SKIN_TONE)[0] || { presets: [] }).presets;
const lipPresets = (s: State): number[][] => (M.tintsFor(raceOf(s), s.age, s.sex, M.TINT_TYPES.LIPS)[0] || { presets: [] }).presets;
const warpaints = (s: State): Any[] => M.tintsFor(raceOf(s), s.age, s.sex, M.TINT_TYPES.WARPAINT);
const hairColors = (): number[][] => ((M.headparts as Any).hairColors || []).map((c: Any) => c.rgb);
const sameRgb = (a: number[] | null, b: number[] | null): boolean => !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

const resetSexAge = (s: State, sex: string, age: string): Any => {
  const race = raceOf(s);
  if (!race) return s.look;
  return Object.assign({}, s.look, { parts: M.defaultParts(race, age, sex), warpaint: null });
};

export interface Result { state: State; preview: boolean; save: Any | null }

// One action from the panel: [key, value]. Anything unknown or not allowed now changes nothing
export const act = (s0: State, c: Config, key: string, value: unknown): Result => {
  const s: State = Object.assign({}, s0, { look: Object.assign({}, s0.look) });
  const race = raceOf(s);
  let preview = false;
  let save: Any = null;
  const look = (patch: Any): void => { s.look = Object.assign({}, s.look, patch); preview = true; };
  const [k, sub] = String(key).split(":");
  const n = Number(value);
  if (s.waiting) return { state: s0, preview: false, save: null };
  switch (k) {
    case "back": s.step = Math.max(1, s.step - 1); break;
    case "next": if (canNext(s, c)) s.step = Math.min(5, s.step + 1); break;
    case "species":
      if (visibleSpecies(c).some((sp: Any) => sp.id === value) && s.species !== value) { s.species = String(value); s.race = null; }
      break;
    case "race": {
      const spec = M.findSpecies(s.species) as Any;
      const r = spec ? spec.races.find((x: Any) => x.id === value && !c.disabledRaces.includes(x.id)) : null;
      if (r && !c.lockedRaces.includes(r.id)) { s.race = r.id; s.look = M.defaultLook(r, s.age, s.sex); preview = true; }
      break;
    }
    case "sex": if (value === "male" || value === "female") { s.look = resetSexAge(s, String(value), s.age); s.sex = String(value); preview = true; } break;
    case "age":
      if ((M.AGES as Any[]).some((a) => a.id === value) && (c.allowChildren || value !== "child")) { s.look = resetSexAge(s, s.sex, String(value)); s.age = String(value); preview = true; }
      break;
    case "stat": {
      if (!(M.ATTRIBUTES as Any[]).some((a) => a.id === sub) || !Number.isInteger(n) || !n) break;
      const stats = Object.assign({}, s.stats);
      for (let i = 0; i < Math.abs(n); i++) {
        const v = stats[sub] + Math.sign(n);
        if (v < M.STAT_MIN || v > M.STAT_MAX || (n > 0 && M.pointsSpent(stats) >= c.statPool)) break;
        stats[sub] = v;
      }
      s.stats = stats; preview = true;
      break;
    }
    case "part": {
      const opts = partOptions(s, sub);
      if (!opts || (n !== 1 && n !== -1)) break;
      const at = Math.max(0, opts.findIndex((o) => o.value === s.look.parts[sub]));
      look({ parts: Object.assign({}, s.look.parts, { [sub]: opts[(at + n + opts.length) % opts.length].value }) });
      break;
    }
    case "preset": {
      const p = (M.FACE_PRESETS as Any[]).find((x) => x.index === Number(sub));
      if (!p || (n !== 1 && n !== -1)) break;
      const presets = s.look.presets.slice();
      presets[p.index] = (presets[p.index] + n + p.max + 1) % (p.max + 1);
      look({ presets });
      break;
    }
    case "morph": {
      const i = Number(sub);
      if (!(M.FACE_MORPHS as Any[]).some((m) => m.index === i) || !Number.isFinite(n)) break;
      const morphs = s.look.morphs.slice();
      morphs[i] = Math.round(clamp(morphs[i] + n * MORPH_TICK, -1, 1) * 20) / 20;
      look({ morphs });
      break;
    }
    case "skin": { const p = skinPresets(s)[n]; if (p) look({ skinRgb: p }); break; }
    case "hair": { const p = hairColors()[n]; if (p) look({ hairRgb: p }); break; }
    case "lip": { if (n === -1) look({ lipRgb: null }); else { const p = lipPresets(s)[n]; if (p) look({ lipRgb: p }); } break; }
    case "warpaint": {
      const list = warpaints(s);
      if (!list.length || (n !== 1 && n !== -1)) break;
      const files = [null].concat(list.map((w: Any) => w.file));
      const at = Math.max(0, files.indexOf(s.look.warpaint ? s.look.warpaint.file : null));
      const file = files[(at + n + files.length) % files.length];
      if (file === null) { look({ warpaint: null }); break; }
      const prev = s.look.warpaint || {};
      const tint = list.find((w: Any) => w.file === file);
      look({ warpaint: { file, rgb: prev.rgb || (tint && tint.presets[0]) || [255, 255, 255], opacity: prev.opacity !== undefined ? prev.opacity : 60 } });
      break;
    }
    case "paint": {
      const w = s.look.warpaint;
      const tint = w ? warpaints(s).find((x: Any) => x.file === w.file) : null;
      const p = tint ? tint.presets[n] : null;
      if (w && p) look({ warpaint: Object.assign({}, w, { rgb: p }) });
      break;
    }
    case "opacity": if (s.look.warpaint && Number.isFinite(n)) look({ warpaint: Object.assign({}, s.look.warpaint, { opacity: clamp(s.look.warpaint.opacity + n, 0, 100) }) }); break;
    case "muscle": case "fat": {
      if (!Number.isFinite(n) || !race) break;
      const r = (M.bodyRangesFor(s.stats) as Any)[k];
      look({ [k]: clamp(clamp(s.look[k], r.min, r.max) + n, r.min, r.max) });
      break;
    }
    case "name": s.name = String(value ?? "").slice(0, NAME_MAX); break;
    case "backstory": s.backstory = String(value ?? "").slice(0, BACKSTORY_MAX); break;
    case "description": s.description = String(value ?? "").slice(0, DESCRIPTION_MAX); break;
    case "finish": {
      if (s.step !== 5 || nameError(s.name) || !race) break;
      const name = s.name.trim();
      save = {
        race: s.race, sex: s.sex, age: s.age, stats: s.stats, bodyExtras: M.clampedBody(s), appearance: M.buildAppearance(Object.assign({}, s, { name })),
        name, backstory: s.backstory, description: s.description,
      };
      s.waiting = true; s.error = "";
      break;
    }
    default: break;
  }
  return { state: s, preview: preview && s.step >= 3 && !!s.race, save };
};

// The server refused the character (charCreatorError): the Story step says why, and Finish is offered again
export const refused = (s: State, message: string): State => Object.assign({}, s, { waiting: false, error: message || "The server rejected this character." });

// ---- the page the panel draws ----
type Row = Any;
const text = (t: string, tone?: string): Row => ({ kind: "text", text: t, tone: tone || "" });
const chips = (key: string, options: Array<[string, string, boolean, boolean?]>): Row =>
  ({ kind: "chips", key, options: options.map(([v, label, on, off]) => ({ v, label, on, off: !!off })) });
const rgbInt = (rgb: number[]): number => ((rgb[0] & 0xff) << 16) | ((rgb[1] & 0xff) << 8) | (rgb[2] & 0xff);

export const view = (s: State, c: Config): Any => {
  const sections: Array<{ heading: string; rows: Row[] }> = [];
  const race = raceOf(s);
  if (s.step === 1) {
    const list = visibleSpecies(c);
    const shown = list.find((sp: Any) => sp.id === s.species);
    sections.push({ heading: "Choose your species", rows: [chips("species", list.map((sp: Any) => [sp.id, sp.name, sp.id === s.species])), text(shown ? shown.blurb : "Choose a species to learn more.", "lead")] });
  } else if (s.step === 2) {
    const spec = M.findSpecies(s.species) as Any;
    const races = spec ? spec.races.filter((r: Any) => !c.disabledRaces.includes(r.id)) : [];
    const rows: Row[] = [chips("race", races.map((r: Any) => [r.id, c.lockedRaces.includes(r.id) ? `${r.name} (locked)` : r.name, r.id === s.race, c.lockedRaces.includes(r.id)]))];
    for (const r of races) if (r.lockedNote && c.lockedRaces.includes(r.id)) rows.push(text(`${r.name}: ${r.lockedNote}`, "note"));
    if (race) {
      rows.push(text(race.name, "heading"), text(race.lore, "lead"));
      if (race.placeholder) rows.push(text("This race uses a temporary look until its own model is ready.", "note"));
    } else rows.push(text("Select a race to read about it.", "note"));
    sections.push({ heading: "Choose your race", rows });
  } else if (s.step === 3) {
    const remaining = c.statPool - M.pointsSpent(s.stats);
    sections.push({ heading: "Who are you?", rows: [
      text("Sex", "label"), chips("sex", [["male", "Male", s.sex === "male"], ["female", "Female", s.sex === "female"]]),
      text("Age", "label"), chips("age", (M.AGES as Any[]).filter((a) => c.allowChildren || a.id !== "child").map((a) => [a.id, a.name, s.age === a.id])),
    ] });
    sections.push({ heading: `Attributes: ${remaining} points left`, rows: (M.ATTRIBUTES as Any[]).map((a) => ({
      kind: "stepper", key: `stat:${a.id}`, label: a.name, value: String(s.stats[a.id]), hint: a.desc, steps: [-5, -1, 1, 5],
      dec: s.stats[a.id] > M.STAT_MIN, inc: s.stats[a.id] < M.STAT_MAX && remaining > 0,
    })).concat([text("Strength and Endurance set the limits of your body build.", "note")]) });
  } else if (s.step === 4 && race) {
    const ranges = M.bodyRangesFor(s.stats) as Any;
    const body = ["muscle", "fat"].map((k) => {
      const v = clamp(s.look[k], ranges[k].min, ranges[k].max);
      return { kind: "stepper", key: k, label: k === "muscle" ? "Muscle" : "Fat", value: String(v), hint: `${ranges[k].min} to ${ranges[k].max}`, steps: [-5, -1, 1, 5], dec: v > ranges[k].min, inc: v < ranges[k].max };
    });
    const weight = M.toVanillaWeight(clamp(s.look.muscle, ranges.muscle.min, ranges.muscle.max), clamp(s.look.fat, ranges.fat.min, ranges.fat.max));
    const bodySection = { heading: "Body", rows: (body as Row[]).concat([text(`In-game weight: ${weight}`, "note")]) };
    if (!race.faceGen) {
      sections.push({ heading: "Appearance", rows: [text("This race keeps its natural look; only the body can be shaped.", "note")] }, bodySection);
    } else {
      const parts: Row[] = [];
      for (const d of PART_KINDS) {
        const opts = partOptions(s, d.kind);
        if (!opts) continue;
        const at = opts.find((o) => o.value === s.look.parts[d.kind]) || opts[0];
        parts.push({ kind: "carousel", key: `part:${d.kind}`, label: d.label, value: at.label });
      }
      sections.push({ heading: "Head Parts", rows: parts });
      sections.push({ heading: "Face Shape", rows: (M.FACE_PRESETS as Any[]).map((p) => ({ kind: "carousel", key: `preset:${p.index}`, label: p.name, value: `${s.look.presets[p.index] + 1} / ${p.max + 1}` })) });
      for (const g of MORPH_GROUPS) {
        sections.push({ heading: g.name, rows: g.indices.map((i) => ({
          kind: "stepper", key: `morph:${i}`, label: ((M.FACE_MORPHS as Any[]).find((m) => m.index === i) || { name: "" }).name, value: s.look.morphs[i].toFixed(2), steps: [-5, -1, 1, 5],
          dec: s.look.morphs[i] > -1, inc: s.look.morphs[i] < 1,
        })) });
      }
      const sw = (key: string, label: string, list: number[][], current: number[] | null, none: boolean): Row =>
        ({ kind: "swatches", key, label, none: none ? { on: current === null } : null, colors: list.map((rgb) => ({ rgb: rgbInt(rgb), on: sameRgb(rgb, current) })) });
      sections.push({ heading: "Colors", rows: [
        sw("skin", "Skin Tone", skinPresets(s), s.look.skinRgb, false), sw("hair", "Hair Color", hairColors(), s.look.hairRgb, false), sw("lip", "Lip Color", lipPresets(s), s.look.lipRgb, true),
      ] });
      const wps = warpaints(s);
      if (wps.length) {
        const w = s.look.warpaint;
        const rows: Row[] = [{ kind: "carousel", key: "warpaint", label: "Pattern", value: w ? String(w.file).split("\\").pop()!.replace(/\.dds$/i, "") : "None" }];
        if (w) {
          const tint = wps.find((x: Any) => x.file === w.file);
          rows.push(sw("paint", "Paint Color", tint ? tint.presets : [], w.rgb, false));
          rows.push({ kind: "stepper", key: "opacity", label: "Opacity", value: String(w.opacity), steps: [-20, -5, 5, 20], dec: w.opacity > 0, inc: w.opacity < 100 });
        }
        sections.push({ heading: "Warpaint", rows });
      }
      sections.push(bodySection);
    }
  } else if (s.step === 5) {
    const msg = nameError(s.name);
    const rows: Row[] = [
      { kind: "field", key: "name", label: "Name", value: s.name, max: NAME_MAX, lines: 1, hint: "Character name" },
    ];
    if (s.name && msg) rows.push(text(msg, "error"));
    rows.push({ kind: "field", key: "backstory", label: `Backstory  ${s.backstory.length} / ${BACKSTORY_MAX}`, value: s.backstory, max: BACKSTORY_MAX, lines: 6, hint: "Where do you come from? Kept private for staff and your own records." });
    rows.push({ kind: "field", key: "description", label: `Description  ${s.description.length} / ${DESCRIPTION_MAX}`, value: s.description, max: DESCRIPTION_MAX, lines: 4, hint: "What a stranger sees at a glance." });
    rows.push(text("Strangers see this when they are introduced to you.", "note"));
    if (s.error) rows.push(text(s.error, "error"));
    sections.push({ heading: "Your story", rows });
  }
  return {
    type: "charCreator", step: s.step, steps: STEPS, sections,
    back: s.step > 1 && !s.waiting, next: s.step < 5 ? canNext(s, c) : null,
    finish: s.step === 5 ? { on: !nameError(s.name) && !s.waiting, waiting: s.waiting } : null,
  };
};
