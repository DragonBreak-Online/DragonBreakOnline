// Property belongs to one character, not the account (Nate, 10 Oct: "dont keep property shared, breaks rp"). The owner
// character is its actor id: a player character's form id is its changeform's key, so it is the same after every restart
// (guild membership and patron rerolls are kept by it too), and a deleted character's replacement in the same slot is a
// new actor, so it inherits nothing. Pure, so the boot-time dry run, the migration and the harness resolve alike.

export interface OwnerCandidate {
  actor: number;
  // The names this character answers to: its appearance name, and the real name kept while it wears a mask
  names: string[];
  slot: number;
  dead: boolean;
}

export interface OwnerRecord {
  ref: number;
  owner: number;
  ownerName: string;
  ownerChar?: number;
  memberOf?: number;
  assigned?: Record<string, { profile: number; name: string; char?: number }>;
}

export type OwnerHow = "kept" | "name" | "name-partial" | "name-ambiguous" | "root" | "only" | "first" | "none";

export interface OwnerDecision {
  ref: number;
  // "" for the record's owner, else the hex ref of the assigned room or chest
  room: string;
  profile: number;
  recordName: string;
  char: number;
  charName: string;
  how: OwnerHow;
  note: string;
}

// The names nothing can be resolved by: what a masked or unnamed character shows
export const UNNAMED = ["masked person", "stranger", "someone", "prisoner", "player", ""];

export const nameKey = (s: string): string =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9' -]/g, "").replace(/\s+/g, " ").trim();

// One name inside the other on word boundaries: "Lord Aldemar Vauclaire" and "Aldemar Vauclaire"
const partOf = (a: string, b: string): boolean => !!a && !!b && a !== b && (` ${b} `.includes(` ${a} `) || ` ${a} `.includes(` ${b} `));

const label = (c: OwnerCandidate): string => c.names.find((n) => !!n) || "";

// The character a record names, among the account's characters: the one carrying that name (a living one first), else one
// whose name contains it or is contained in it, else the account's only living character, else its first by slot
export const resolveOwner = (recordName: string, cands: OwnerCandidate[]): { char: number; charName: string; how: OwnerHow; note: string } => {
  const all = [...cands].sort((a, b) => a.slot - b.slot || a.actor - b.actor);
  const living = all.filter((c) => !c.dead);
  if (!all.length) return { char: 0, charName: "", how: "none", note: "the account has no characters; left to the account" };
  const want = nameKey(recordName);
  const unnamed = UNNAMED.includes(want);
  const pick = (list: OwnerCandidate[], how: OwnerHow, note: string) => ({ char: list[0].actor >>> 0, charName: label(list[0]), how, note });
  if (!unnamed) {
    const exact = all.filter((c) => c.names.some((n) => nameKey(n) === want));
    const exactLiving = exact.filter((c) => !c.dead);
    if (exactLiving.length === 1) return pick(exactLiving, "name", "");
    if (exactLiving.length > 1) return pick(exactLiving, "name-ambiguous", `${exactLiving.length} characters carry this name; the first by slot`);
    if (exact.length && living.length) return pick(living, "first", `the named character is permanently dead; the account's first living character`);
    const partial = living.filter((c) => c.names.some((n) => partOf(nameKey(n), want)));
    if (partial.length === 1) return pick(partial, "name-partial", "");
    if (partial.length > 1) return pick(partial, "name-ambiguous", `${partial.length} characters' names contain or are contained in it; the first by slot`);
  }
  const why = unnamed ? `the record names no one ("${recordName}")` : "no character carries this name";
  if (living.length === 1) return pick(living, "only", `${why}; the account's only living character`);
  if (living.length > 1) return pick(living, "first", `${why}; the account's first living character of ${living.length}`);
  return pick(all, "first", `${why}; every character is permanently dead, the first by slot`);
};

// Every owned record and every room or chest assignment, resolved. A record that names its character already is kept as
// it is, so a second run changes nothing. A member of a place goes with its place's root, so a house stays one owner's.
export const planOwners = (records: OwnerRecord[], charsOf: (profile: number) => OwnerCandidate[]): OwnerDecision[] => {
  const out: OwnerDecision[] = [];
  const byRef = new Map<number, OwnerRecord>(records.map((r) => [r.ref >>> 0, r]));
  const rootChar = new Map<number, { char: number; charName: string }>();
  const nameOfChar = (profile: number, char: number) => label(charsOf(profile).find((c) => c.actor >>> 0 === char >>> 0) || { actor: 0, names: [], slot: 0, dead: false });
  const decide = (r: OwnerRecord): OwnerDecision => {
    if (r.ownerChar) return { ref: r.ref, room: "", profile: r.owner, recordName: r.ownerName, char: r.ownerChar >>> 0, charName: nameOfChar(r.owner, r.ownerChar), how: "kept", note: "" };
    const root = r.memberOf && r.memberOf !== r.ref ? byRef.get(r.memberOf >>> 0) : undefined;
    if (root && root.owner === r.owner) {
      const known = rootChar.get(root.ref >>> 0) || (() => { const d = decide(root); return { char: d.char, charName: d.charName }; })();
      if (known.char) return { ref: r.ref, room: "", profile: r.owner, recordName: r.ownerName, char: known.char, charName: known.charName, how: "root", note: "" };
    }
    const d = resolveOwner(r.ownerName, charsOf(r.owner));
    return { ref: r.ref, room: "", profile: r.owner, recordName: r.ownerName, ...d };
  };
  const sorted = records.filter((r) => r.owner > 0).sort((a, b) => (a.memberOf ? 1 : 0) - (b.memberOf ? 1 : 0) || a.ref - b.ref);
  for (const r of sorted) {
    const d = decide(r);
    if (!r.memberOf || r.memberOf === r.ref) rootChar.set(r.ref >>> 0, { char: d.char, charName: d.charName });
    out.push(d);
    for (const [room, a] of Object.entries(r.assigned || {})) {
      const profile = Number(a && a.profile) || 0;
      if (!profile) continue;
      if (a.char) { out.push({ ref: r.ref, room, profile, recordName: a.name, char: a.char >>> 0, charName: nameOfChar(profile, a.char), how: "kept", note: "" }); continue; }
      out.push({ ref: r.ref, room, profile, recordName: String(a.name || ""), ...resolveOwner(String(a.name || ""), charsOf(profile)) });
    }
  }
  return out;
};
