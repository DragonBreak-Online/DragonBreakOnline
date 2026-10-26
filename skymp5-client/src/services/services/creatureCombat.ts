// TEST-CLIENT instrument for the 25 Oct crash. Nat pressed draw in the Hagraven form and the game died in the
// humanoid weapon path: the engine sent the animation event "weaponDraw" (the exact string is in the crash log at
// RSP+2F8), RightHandWeaponDrawHandler took it, played the humanoid clip H2H_Equip (Animations\H2H_Equip.hkx)
// against HagravenProject, and dereferenced garbage. H2H_Equip is the BARE-HANDED equip clip, so nothing need be
// equipped, and every one of the eighteen polymorph forms has a non-humanoid graph - a chicken would do the same.
//
// It cannot be measured without also guarding it, because pressing the button IS the crash. So this rewrites the
// event in SendAnimationEventHook (Context.animEventName is writable) and records what happened.
//
// The Hagraven's own attack events are verified from RACE ATKD/ATKE, not remembered:
//   HagravenRace 000131FB: attackStart_L (flags 0x8, left attack) and attackStart_R, both damageMult 1.00,
//   both carrying attack spell 000B877F = DiseaseBrainRot. Graph: Actors\Hagraven\HagravenProject.hkx.
//
// No imports, so a harness can load it on its own (tests/creature-combat-harness.js).

export const HAGRAVEN_RACE = 0x000131fb;

export interface AttackEvents {
  left: string;
  right: string;
}

// Only forms whose ATKE names a player's input can plausibly drive. The Hagraven is the only one with clean
// left/right names; Draugr and Skeleton use the humanoid vocabulary and may need no rewrite at all; the other
// eleven have AI-style names (attackStart_AttackLeft2, attackStartRightB) that nothing a player presses emits,
// and Chicken and Hare have no attack data whatsoever. This test client deliberately covers the Hagraven only:
// every other creature body gets the draw BLANKED, which is the guard without the claws.
export const CREATURE_ATTACKS: ReadonlyMap<number, AttackEvents> = new Map([
  [HAGRAVEN_RACE, { left: "attackStart_L", right: "attackStart_R" }],
]);

// MEASURED, not taken from the crash log. The 26 Oct 02:00Z session proved the crash-log string was wrong:
// the probe recorded "attack/cast: NONE EMITTED | other: WeapEquip 3/0 WeapUnEquip 2/0 ...", so a draw press in
// a creature body emits WeapEquip, and the graph accepts it. "weaponDraw" at RSP+2F8 in the crash log was the
// engine handler's own constant, not the event SendAnimationEventHook sees, so the first guard matched nothing
// and reported "nothing intercepted". The crash-log names are kept because they cost nothing and may yet appear
// on another input path. All compared lowercased.
const DRAW_EVENTS = ["weapequip", "weapondraw"];
// Their counterparts run the humanoid unequip clip, so they must be intercepted too - but are NEVER rewritten to
// an attack: putting a weapon away should not swing a claw.
const SHEATHE_EVENTS = ["weapunequip", "weaponsheathe"];

// Furniture and crafting entry, which is the SAME mismatch waiting to happen: IdleBlacksmithForgeEnter and friends
// are humanoid furniture animations. Deliberately the same vocabulary beastform.js already uses for its "seated"
// test, so the client and the gameplay layer agree about what furniture looks like.
const FURNITURE_RE = /chair|stool|bench|throne|bedroll|furniture|sitting|kneel|enter(instant|start|tosit)?$/;
// Leaving furniture is never blanked. "stand" is in here deliberately: it only ever makes the guard blank LESS,
// and blanking a get-up animation would be the worse failure - stuck in a chair with no revert.
const EXIT_RE = /exit|stop|forcedefault|dismount|stand/;

export type GuardKind = "attack" | "blank-draw" | "blank-furniture";

export interface GuardPlan {
  // What to put in animEventName instead. "" means blank it.
  to: string;
  kind: GuardKind;
  why: string;
}

const isLeft = (lower: string): boolean => /left|_l$/.test(lower);

// null leaves the event completely alone. Only ever called for the player while in a creature body.
export const planFor = (raceId: number, eventName: string): GuardPlan | null => {
  const name = String(eventName || "");
  if (!name) return null;
  const lower = name.toLowerCase();

  if (SHEATHE_EVENTS.indexOf(lower) >= 0) {
    return { to: "", kind: "blank-draw", why: "the humanoid unequip clip, blanked (never an attack)" };
  }

  if (DRAW_EVENTS.indexOf(lower) >= 0) {
    const attacks = CREATURE_ATTACKS.get(Number(raceId) >>> 0);
    if (attacks) {
      // The test conflates a draw with an attack ON PURPOSE: it answers both open questions in one press -
      // whether rewriting stops RightHandWeaponDrawHandler, and whether her own event produces a hit. The
      // shipped version should map the real attack input, once the probe says which event that is.
      // WeapEquip names no hand, so this is the right claw unless a left-handed event turns up. The probe
      // will say if one ever does; guessing a hand from an event that has none would be inventing data.
      const to = isLeft(lower) ? attacks.left : attacks.right;
      return { to, kind: "attack", why: "draw rewritten to the form's own attack event" };
    }
    return { to: "", kind: "blank-draw", why: "this form has no attack data, so the draw is blanked" };
  }

  if (!EXIT_RE.test(lower) && FURNITURE_RE.test(lower)) {
    return { to: "", kind: "blank-furniture", why: "humanoid furniture animation in a creature body" };
  }

  return null;
};

// ---- what the session reports -------------------------------------------------------------------------------------

export interface GuardTally {
  kind: GuardKind;
  from: string;
  to: string;
  seen: number;
  // the graph accepted the rewritten event (SendAnimationEventHook leave: animationSucceeded)
  ok: number;
  failed: number;
  // a hit arrived within the window after this rewrite
  hits: number;
}

export const MAX_TALLIES = 24;
// A claw hit should land within a swing of the event; beyond this it is somebody else's hit
export const HIT_WINDOW_MS = 1500;

export class GuardLog {
  private tally = new Map<string, GuardTally>();
  private dropped = 0;

  record(plan: GuardPlan, from: string): GuardTally | null {
    const key = `${plan.kind}|${from}|${plan.to}`;
    let t = this.tally.get(key);
    if (!t) {
      if (this.tally.size >= MAX_TALLIES) { this.dropped++; return null; }
      t = { kind: plan.kind, from, to: plan.to, seen: 0, ok: 0, failed: 0, hits: 0 };
      this.tally.set(key, t);
    }
    t.seen++;
    return t;
  }

  list(): GuardTally[] { const out: GuardTally[] = []; this.tally.forEach((t) => out.push(t)); return out; }
  get count(): number { return this.tally.size; }

  // One line, because Report a Problem carries only the last 60 KB of the diagnostic file
  summary(raceHex: string): string {
    const parts = this.list().map((t) =>
      `${t.kind} "${t.from}"->"${t.to || "(blank)"}" seen ${t.seen} graph ${t.ok}/${t.failed} hits ${t.hits}`);
    const line = parts.length ? parts.join(" | ") : "nothing intercepted";
    return `${raceHex}: ${line}${this.dropped ? ` | (${this.dropped} past the ${MAX_TALLIES} cap)` : ""}`;
  }

  reset(): void { this.tally.clear(); this.dropped = 0; }
}
