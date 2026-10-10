// The player's own look as put on the base vs read back from it, for the appearance trace (lib/clientDiag.ts). No imports.

export interface SentLook {
  raceId: number;
  isFemale: boolean;
  presets: number[];
  options: number[];
  headpartIds: number[];
}

export interface ReadLook {
  raceId: number;
  sex: number;
  presets: number[];
  options: number[];
  parts: number;
}

export interface LookBase {
  getRace(): { getFormID(): number } | null;
  getSex(): number;
  getFacePreset(i: number): number;
  getFaceMorph(i: number): number;
  getNumHeadParts(): number;
}

const MAX_PRESETS = 4;
const MAX_OPTIONS = 19;
const MAX_MISMATCHES = 12;
const EPS = 1e-3;

const hex = (n: number): string => (Number(n) >>> 0).toString(16);

// Two decimals, no leading zero: -0.42 -> -.42, 1 -> 1
export const num = (v: number): string => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "nan";
  const r = Math.round(v * 100) / 100;
  return String(r === 0 ? 0 : r).replace(/^(-?)0\./, "$1.");
};

export const readLook = (base: LookBase, nPresets: number = MAX_PRESETS, nOptions: number = MAX_OPTIONS): ReadLook => {
  const read = (f: () => number): number => { try { return Number(f()); } catch (e) { return NaN; } };
  let raceId = 0;
  try { const race = base.getRace(); raceId = race ? race.getFormID() >>> 0 : 0; } catch (e) { raceId = 0; }
  const presets: number[] = [];
  const options: number[] = [];
  for (let i = 0; i < nPresets; i++) presets.push(read(() => base.getFacePreset(i)));
  for (let i = 0; i < nOptions; i++) options.push(read(() => base.getFaceMorph(i)));
  return { raceId, sex: read(() => base.getSex()), presets, options, parts: read(() => base.getNumHeadParts()) };
};

const differs = (a: number, b: number): boolean => !(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < EPS);

// "r:13746>13741", "s:0>1", "p2:29>1", "o7:-.42>0" (sent > read back); at most MAX_MISMATCHES, then "+N"
export const lookMismatches = (sent: SentLook, got: ReadLook): string[] => {
  const out: string[] = [];
  if ((Number(sent.raceId) >>> 0) !== (got.raceId >>> 0)) out.push(`r:${hex(sent.raceId)}>${hex(got.raceId)}`);
  const sex = sent.isFemale ? 1 : 0;
  if (sex !== got.sex) out.push(`s:${sex}>${num(got.sex)}`);
  const presets = Array.isArray(sent.presets) ? sent.presets.slice(0, MAX_PRESETS) : [];
  presets.forEach((v, i) => { if (differs(v, got.presets[i])) out.push(`p${i}:${num(v)}>${num(got.presets[i])}`); });
  const options = Array.isArray(sent.options) ? sent.options.slice(0, MAX_OPTIONS) : [];
  options.forEach((v, i) => { if (differs(v, got.options[i])) out.push(`o${i}:${num(v)}>${num(got.options[i])}`); });
  if (out.length <= MAX_MISMATCHES) return out;
  return out.slice(0, MAX_MISMATCHES).concat([`+${out.length - MAX_MISMATCHES}`]);
};

// "own <event> r=<race> s=<sex> hp=<sent>/<on base> p=<presets> o=<options> mm=<mismatches or ->"
export const lookTraceLine = (event: string, sent: SentLook, got: ReadLook): string => {
  const presets = Array.isArray(sent.presets) ? sent.presets.slice(0, MAX_PRESETS) : [];
  const options = Array.isArray(sent.options) ? sent.options.slice(0, MAX_OPTIONS) : [];
  const parts = Array.isArray(sent.headpartIds) ? sent.headpartIds.length : 0;
  const mm = lookMismatches(sent, got);
  return `own ${event} r=${hex(sent.raceId)} s=${sent.isFemale ? 1 : 0} hp=${parts}/${num(got.parts)} p=${presets.map(num).join(",")}`
    + ` o=${options.map(num).join(",")} mm=${mm.length ? mm.join(",") : "-"}`;
};

// A later read-back against the same look: only the result ("ok" or the mismatches)
export const lookRecheckLine = (event: string, sent: SentLook, got: ReadLook): string => {
  const mm = lookMismatches(sent, got);
  return `own ${event} hp=${num(got.parts)} mm=${mm.length ? mm.join(",") : "-"}`;
};
