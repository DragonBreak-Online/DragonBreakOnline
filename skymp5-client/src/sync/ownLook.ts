// The server's look for the player's own character arrives in tick context, so it waits here and goes on from an update
import { Game, Ui } from "skyrimPlatform";
import { Appearance, applyAppearanceToPlayer, applyNameToPlayer, ownLookOnBase, sameLookButName } from "./appearance";
import { isBeastRaceId, isGuardedActor } from "./beastRaces";
import { driftConfig } from "./driftConfig";
import { trace } from "../lib/clientDiag";

// Dropped this soon after a RaceMenu close (remoteServer RACE_MENU_SETTLE_MS); the server resends the stored look at 3.5 s
export const OWN_LOOK_SETTLE_MS = 3000;
// Held, never dropped, until skee's captures after the close are done (extras at +3.0 s, preset at +3.5 s)
export const OWN_LOOK_CAPTURE_MS = 5500;
// The server writes the look before it sends dboBeast, and a RaceMenu close may be noticed later in the same frame
export const OWN_LOOK_MIN_AGE_MS = 500;
// The race change (BeastFormService setRace) rebuilds the 3D itself
export const OWN_LOOK_AFTER_RACE_MS = 3000;
// After a create, spawn or load (appearanceExtrasService SPAWN_APPLY_AFTER_MS)
export const OWN_LOOK_AFTER_SPAWN_MS = 5000;

export interface OwnLookState {
  now: number;
  // The first update that saw the look
  seenAt: number;
  raceMenuOpen: boolean;
  raceMenuClosedAt: number;
  // dboBeast messages whose setRace has not run yet, and the last race change
  raceSwitches: number;
  raceSwitchAt: number;
  spawnAt: number;
  loaded3D: boolean;
  beastLook: boolean;
  // The player's live race is a beast's or cannot be read
  beastBody: boolean;
}

export interface OwnLookVerdict {
  act: "apply" | "wait" | "drop";
  why: string;
}

export const ownLookVerdict = (s: OwnLookState): OwnLookVerdict => {
  const sinceClose = s.raceMenuClosedAt ? s.now - s.raceMenuClosedAt : Infinity;
  if (s.raceMenuOpen || (sinceClose >= 0 && sinceClose < OWN_LOOK_SETTLE_MS)) return { act: "drop", why: "settle" };
  if (sinceClose >= 0 && sinceClose < OWN_LOOK_CAPTURE_MS) return { act: "wait", why: "capture" };
  if (s.now - s.seenAt < OWN_LOOK_MIN_AGE_MS) return { act: "wait", why: "young" };
  if (s.raceSwitches > 0 || s.now - s.raceSwitchAt < OWN_LOOK_AFTER_RACE_MS) return { act: "wait", why: "race" };
  if (s.now - s.spawnAt < OWN_LOOK_AFTER_SPAWN_MS) return { act: "wait", why: "spawn" };
  if (!s.loaded3D) return { act: "wait", why: "3d" };
  // A beast's look keeps the mortal race (server beastform.js), so the live race is what tells a beast body
  if (s.beastLook || s.beastBody) return { act: "drop", why: "beast" };
  return { act: "apply", why: "" };
};

export class OwnLookQueue {
  constructor(private readonly onUpdate: (fn: () => void) => void, private readonly log: (...args: unknown[]) => void) {}

  // Tick context: only the newest look is kept and one check is queued, since once callbacks run in no fixed order
  offer(look: Appearance): void {
    this.look = look;
    this.seenAt = 0;
    this.waitingFor = "";
    this.queue();
  }

  // The server created the player's character with its look of that moment, so a look waiting here is older
  created(): void {
    this.look = null;
    this.restart();
  }

  // The spawn or load put the created look on: earlier checks are void, and a look sent after the create waits again
  putOn(): void {
    this.restart();
    if (this.look) this.queue();
  }

  private look: Appearance | null = null;
  private seenAt = 0;
  private queued = false;
  private gen = 0;
  private spawnAt = 0;
  private waitingFor = "";

  private restart(): void {
    this.gen++;
    this.queued = false;
    this.seenAt = 0;
    this.waitingFor = "";
    this.spawnAt = Date.now();
  }

  private queue(): void {
    if (this.queued) return;
    this.queued = true;
    const gen = this.gen;
    this.onUpdate(() => {
      if (gen !== this.gen) return;
      this.queued = false;
      this.check();
    });
  }

  private check(): void {
    const look = this.look;
    if (!look) return;
    // The gamemode's switch (npcDriftConfig ownLook), read when the look would go on: "off" puts none on, before any native
    if (driftConfig.ownLook === "off") {
      this.look = null;
      this.log("Skipped own appearance: ownLook is off");
      trace("own drop=off");
      return;
    }
    const now = Date.now();
    if (!this.seenAt) this.seenAt = now;
    const player = Game.getPlayer();
    let loaded3D = false;
    try { loaded3D = !!player && player.is3DLoaded(); } catch { loaded3D = false; }
    const g = globalThis as any;
    const raceId = Number(look.raceId) >>> 0;
    const closedAt = Number(g.__dboRaceMenuClosedAt) || 0;
    const verdict = ownLookVerdict({
      now, seenAt: this.seenAt, raceMenuOpen: Ui.isMenuOpen("RaceSex Menu"), raceMenuClosedAt: closedAt,
      raceSwitches: Number(g.__dboRaceSwitches) || 0, raceSwitchAt: Number(g.__dboRaceSwitchAt) || 0, spawnAt: this.spawnAt, loaded3D,
      beastLook: isBeastRaceId(raceId) || !!(g.__dboBeastRaces as Set<number> | undefined)?.has(raceId),
      beastBody: isGuardedActor(player),
    });
    if (verdict.act === "wait") {
      if (this.waitingFor !== verdict.why) {
        this.waitingFor = verdict.why;
        this.log("Own appearance waits:", verdict.why);
        trace(`own hold=${verdict.why}`);
      }
      this.queue();
      return;
    }
    this.look = null;
    if (verdict.act === "drop") {
      this.log("Skipped own appearance:", verdict.why);
      trace(`own drop=${verdict.why}`);
      return;
    }
    // RaceMenu writes the base itself, so after a close the guardHead resend can equal the look from before the edit
    const onBase = ownLookOnBase();
    if (onBase && onBase.at > closedAt && sameLookButName(onBase.look, look)) {
      applyNameToPlayer(look, "name");
      this.log("Put the player's name on, the rest of the look is on already");
      return;
    }
    // ownLook "name": a look that needs more than its name is never put on, so the head is never rebuilt
    if (driftConfig.ownLook === "name") {
      this.log("Skipped own appearance: ownLook puts only a name on");
      trace("own drop=nameonly");
      return;
    }
    applyAppearanceToPlayer(look, true, "update");
    this.log("Applied appearance to the player");
  }
}
