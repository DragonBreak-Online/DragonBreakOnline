// The player's base reading null (tickets mod-0558/0601, 2 Nov): after a relog in the same game session the client's
// Game.getPlayer().getBaseObject() returned null on every frame, so sync/inventory.ts could not build the player's
// inventory and the player saw it empty until a relaunch (the server's copy was whole). It has run for hundreds to 2,000+
// frames in many players' sessions since 26 Oct. The suspect, unproven: sync/appearance.ts applyTints gives every other
// player's temporary NPC base the player's own base form id (TESModPlatform.setFormIdUnsafe), and resolving the player's
// base by that id may then reach a temporary form destroyed when those players despawn. This records what is needed to
// prove or clear that, and sends one line through the client diag channel (__dboTrace, rate limited there too) when the
// player's base reads null: what Game.getFormEx(7) is, how many other players are spawned, how long since one despawned,
// and how many base ids were swapped and how long ago. Nothing here changes behaviour: inventory.ts already reads a null
// base as empty (a71f8e69), which is right for the player, whose base holds no items in the live order.
import { Game } from "skyrimPlatform";

const PLAYER_REF = 0x14;
const PLAYER_BASE = 0x7;
// One line at the first null, then at most one a minute while it lasts
export const REPORT_EVERY_MS = 60000;

interface ProbeState { remotes: number; lastDespawnAt: number; swaps: number; lastSwapAt: number; lastReportAt: number; nulls: number }
const state = (): ProbeState => {
  const g = globalThis as any;
  if (!g.__dboPlayerBaseProbe) g.__dboPlayerBaseProbe = { remotes: 0, lastDespawnAt: 0, swaps: 0, lastSwapAt: 0, lastReportAt: 0, nulls: 0 };
  return g.__dboPlayerBaseProbe as ProbeState;
};

// Another player's character spawned (remoteServer onCreateActorMessage) or despawned (onDestroyActorMessage)
export const noteRemotePlayerCreated = (): void => { state().remotes++; };
export const noteRemotePlayerDestroyed = (now: number): void => {
  const s = state();
  s.remotes = Math.max(0, s.remotes - 1);
  s.lastDespawnAt = now;
};
// appearance.ts applyTints gave a temporary NPC base the player's base form id
export const noteFormIdSwap = (now: number): void => {
  const s = state();
  s.swaps++;
  s.lastSwapAt = now;
};

const ago = (at: number, now: number): string => (at ? `${now - at}ms` : "never");

// The line, without the game: what Game.getFormEx(7) gave (described by the caller), and the counts
export const probeLine = (where: string, refrId: number, form7: string, s: ProbeState, now: number): string =>
  `pbase null at=${where} refr=${(refrId >>> 0).toString(16)} n=${s.nulls} getFormEx(7)=${form7} remotes=${s.remotes} despawn=${ago(s.lastDespawnAt, now)} swaps=${s.swaps} swap=${ago(s.lastSwapAt, now)}`;

// Whether this null is reported now: the first, then once a REPORT_EVERY_MS
export const shouldReport = (s: ProbeState, now: number): boolean => s.nulls === 1 || now - s.lastReportAt >= REPORT_EVERY_MS;

const describeForm7 = (): string => {
  try {
    const f = Game.getFormEx(PLAYER_BASE);
    if (!f) return "null";
    return `type ${f.getType()} name "${f.getName()}" id ${(f.getFormID() >>> 0).toString(16)}`;
  } catch (e) {
    return `threw ${e}`;
  }
};

// Called where a reference's base read null; reports only for the player's own reference
export const notePlayerBaseNull = (where: string, refrId: number): void => {
  try {
    if ((refrId >>> 0) !== PLAYER_REF) return;
    const s = state();
    const now = Date.now();
    s.nulls++;
    if (!shouldReport(s, now)) return;
    s.lastReportAt = now;
    const trace = (globalThis as any).__dboTrace;
    if (typeof trace === "function") trace(probeLine(where, refrId, describeForm7(), s, now));
  } catch (e) { /* diagnostics never get in the way */ }
};
