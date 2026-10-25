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

// Staff polymorph creatures (server beastform.js CREATURES): kept apart from BEAST_RACE_IDS so world NPC copies of these
// races are unchanged. All Skyrim.esm (runtime id = local id), no FaceGen head, all in NON_HUMANOID_RACES.
// This map and the server's table must agree: a race the server offers but this map omits is shown as a stripped human,
// which is why the server refuses the change while such a watcher is near (beastform.js unseeingNear).
// Wolf, horse and giant are left out - the horse because its copy can be ridden, the giant because creature scale is not
// in the RACE record so its clipping risk is untested, and the wolf because clients make a player wolf's copy hostile,
// though that reason may now be stale since attacksEveryone returns false on model.appearance before the race test.
export const POLYMORPH_RACES: ReadonlyMap<number, string> = new Map([
  [0x000a919d, "ChickenRace"],
  [0x0006dc99, "HareRace"],
  [0x0006fc4a, "GoatDomesticsRace"],
  [0x00109c7c, "FoxRace"],
  [0x000131ee, "DogRace"],
  [0x00013201, "SkeeverRace"],
  [0x000ba545, "MudcrabRace"],
  [0x000cf89b, "DeerRace"],
  // Added 25 Oct with the server's ten (_work/polymorph-more-forms-1025.md). Walk-around shapes: whether a player can
  // attack in any of them is an in-game question, because the werewolf fights while sharing no attack event names with
  // the humanoid set, so name overlap predicts nothing. Draugr and Skeleton are the first two to test.
  [0x000131fb, "HagravenRace"],
  [0x000131e8, "BearBlackRace"],
  [0x000131e9, "BearSnowRace"],
  [0x00013200, "SabreCatRace"],
  [0x00013202, "SabreCatSnowyRace"],
  [0x00013205, "TrollRace"],
  [0x00000d53, "DraugrRace"],
  [0x000b7998, "SkeletonRace"],
  [0x00013204, "SprigganRace"],
  [0x000131f4, "FalmerRace"],
]);

export const isPolymorphRaceId = (raceId: number | undefined | null): boolean => POLYMORPH_RACES.has(Number(raceId) >>> 0);

// A body the server may list a player in (dboBeastBody): no queued 3D reset, a settle and no name tag on its copy
export const isBeastOrPolymorphRaceId = (raceId: number | undefined | null): boolean =>
  isBeastRaceId(raceId) || isPolymorphRaceId(raceId);

// Every other race whose behaviour graph is not the humanoid master graph (sync/nonHumanoidRaceList.ts), resolved at
// runtime by beastRaces.ts. An Ayleid Pelinaga's copy (draugr graph) crashed a watcher 2 s after its relayed stop (1 Oct).
const nonHumanoidRaceIds = new Set<number>();

export const setNonHumanoidRaceIds = (ids: number[]): void => {
  nonHumanoidRaceIds.clear();
  for (const id of ids) nonHumanoidRaceIds.add(Number(id) >>> 0);
};

// A copy of this race takes no caster or animation variables; polymorph races count before the non-humanoid list resolves
export const isGuardedRaceId = (raceId: number | undefined | null): boolean =>
  isBeastRaceId(raceId) || isPolymorphRaceId(raceId) || nonHumanoidRaceIds.has(Number(raceId) >>> 0);

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
