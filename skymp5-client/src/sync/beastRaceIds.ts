// Werewolf (Skyrim 0CDD84), Vampire Lord (Dawnguard 00283A) and PLUGIN_BEAST_RACES. Their behaviour graphs are not the humanoid master
// graph, which matters twice: a copy's first moments after a race swap (formView), and the caster animation variables
// a relayed spell carries (remoteServer). SkyrimPlatform's ApplyVariablesToActor writes those at the humanoid master
// graph's fixed indexes (AnimVariableMasterGraphIndexes::CreateDefault, up to 291) with no graph or bounds check, and a
// werewolf's howls crashed three watchers within seconds of their relayed stops (2026-09-30). No imports, so a harness
// can load it on its own (tests/beastguard-harness.js).
export const WEREWOLF_RACE_ID = 0x000cdd84;
export const BEAST_RACE_IDS = new Set([WEREWOLF_RACE_ID, 0x0200283a]);

// Plugin races that are a vanilla beast race in another body, found by plugin name at runtime: [plugin, local id, editor id, vanilla race]
export const PLUGIN_BEAST_RACES: ReadonlyArray<readonly [string, number, string, number]> = [
  // The Werewolf Behemoth (1.3x): its own skeleton on the werewolf's behaviour graph WerewolfBeastProject.hkx
  ["DragonBreak Online Edits.esp", 0x1d1f9e, "DBO_WerewolfBehemothRace", WEREWOLF_RACE_ID],
];

const pluginBeastRaces = new Map<number, number>(); // runtime id -> the vanilla beast race it plays
let pluginBeastResolver: (() => void) | null = null;

// beastRaces.ts hands in the runtime lookup; every check runs it until it clears itself
export const setPluginBeastResolver = (resolver: (() => void) | null): void => {
  pluginBeastResolver = resolver;
};

// lookup gives a plugin race's runtime form id, or 0 or a throw when the plugin or the record is missing; one line per race
export const resolvePluginBeastRaces = (lookup: (file: string, localId: number) => number): string[] => {
  pluginBeastRaces.clear();
  return PLUGIN_BEAST_RACES.map(([file, localId, editorId, vanilla]) => {
    let id = 0;
    try { id = Number(lookup(file, localId)) >>> 0; } catch { id = 0; }
    if (id && !BEAST_RACE_IDS.has(id)) pluginBeastRaces.set(id, vanilla);
    return `${editorId} ${id ? id.toString(16) : "missing"}`;
  });
};

// The vanilla beast race this race is or plays, else 0
export const vanillaBeastRaceOf = (raceId: number | undefined | null): number => {
  const id = Number(raceId) >>> 0;
  if (!id || BEAST_RACE_IDS.has(id)) return id;
  if (pluginBeastResolver) pluginBeastResolver();
  return pluginBeastRaces.get(id) || 0;
};

export const isBeastRaceId = (raceId: number | undefined | null): boolean => vanillaBeastRaceOf(raceId) !== 0;

// Every other race whose behaviour graph is not the humanoid master graph (sync/nonHumanoidRaceList.ts), resolved at
// runtime by beastRaces.ts. An Ayleid Pelinaga's copy (draugr graph) crashed a watcher 2 s after its relayed stop (1 Oct).
const nonHumanoidRaceIds = new Set<number>();

export const setNonHumanoidRaceIds = (ids: number[]): void => {
  nonHumanoidRaceIds.clear();
  for (const id of ids) nonHumanoidRaceIds.add(Number(id) >>> 0);
};

// A copy of this race takes no caster or animation variables
export const isGuardedRaceId = (raceId: number | undefined | null): boolean =>
  isBeastRaceId(raceId) || nonHumanoidRaceIds.has(Number(raceId) >>> 0);

export interface CasterVariables {
  booleans: Uint8Array;
  floats: Uint8Array;
  integers: Uint8Array;
}

// No caster variables at all: ApplyVariablesToActor returns before writing anything. A stop still stops the clone;
// a cast is not replayed, since the native casts only after applying them
export const emptyCasterVariables = (): CasterVariables => ({ booleans: new Uint8Array(0), floats: new Uint8Array(0), integers: new Uint8Array(0) });

// What a relayed cast or stop may write into the copy of a caster of this race
export const casterVariablesFor = <T extends CasterVariables>(copyRaceId: number, vars: T): T | CasterVariables =>
  isGuardedRaceId(copyRaceId) ? emptyCasterVariables() : vars;

// A Vampire Lord's copy refuses an update every 500 ms, and Report a Problem sends only the last 60 KB of the diag file
export const SKIP_LINE_INTERVAL_MS = 5 * 60 * 1000;
export const SKIP_MAX_LINES = 50;

export type BeastSkipKind = "cast" | "stop" | "keep-alive" | "anim variables update";

const hex = (n: number): string => (Number(n) >>> 0).toString(16);

// One line per caster and kind per interval, carrying the skips it held back, and nothing past maxLines this session
export const createBeastSkipLog = (write: (line: string) => void, now: () => number = () => Date.now(),
  intervalMs = SKIP_LINE_INTERVAL_MS, maxLines = SKIP_MAX_LINES) => {
  const last = new Map<string, { at: number; held: number }>();
  let lines = 0;
  return (remoteId: number, raceId: number, kind: BeastSkipKind, spellId?: number): boolean => {
    if (lines >= maxLines) return false;
    const key = `${hex(remoteId)}:${kind}`;
    const at = now();
    const prev = last.get(key);
    if (prev && at - prev.at < intervalMs) {
      prev.held++;
      return false;
    }
    last.set(key, { at, held: 0 });
    lines++;
    const spell = spellId === undefined ? "" : ` spell ${hex(spellId)}`;
    const held = prev && prev.held ? ` (${prev.held} more since the last line)` : "";
    write(`beast cast guard: ${hex(remoteId)} race ${hex(raceId)}${spell} ${kind}: caster variables not applied${held}`);
    if (lines === maxLines) {
      last.clear();
      write(`beast cast guard: stopped after ${maxLines} lines this session`);
    }
    return true;
  };
};
