// The Khajiit's Cat-like Reflexes (server racial.js, the race's second racial power): what this player's own client does
// with the server's orders. Kept free of imports so a harness can drive it (tests/catreflexes-harness.js).
//
//   Server -> Client: { customPacketType: "dboCatReflexes", on: true, seconds: <left>, speed: 15, jump: 0.2 }
//                     { customPacketType: "dboCatReflexes", on: false }
//
// speed is the SpeedMult the player gains while it lasts, jump the share fJumpHeightMin rises by. Both are the server's
// numbers (racial.js, the power's buffs moveSpeed and jumpHeight), clamped here. Nothing is cast and nothing is relayed:
// the speed is this engine's own actor value and reaches the other players through the movement this client already
// streams, and the jump is a setting of this game alone. The server keeps the state and the wait; it sends "on" again
// after a relog while the power lasts, and "off" to a character that has none, so a switch of character takes it off.
//
// Why the jump is a game setting and not an actor value: JumpingBonus (actor value 62, as SpeedMult is 30) exists but
// does nothing in vanilla Skyrim - the engine reads the fJumpHeightMin setting - and the SKSE plugin that fixes it is
// not in the collection. A setting belongs to the whole game, so for the minute the power lasts every NPC on this
// screen jumps as high as well. It is runtime only, never saved, and the service puts it back.
export const CAT_REFLEXES = {
  jumpSetting: "fJumpHeightMin",
  maxSeconds: 600,  // one order lasts this long at most, whatever it says (the power is 60 s)
  maxSpeed: 100,    // and gives at most this much SpeedMult
  maxJump: 2,       // and raises the jump by at most this share
  graceMs: 3000,    // without the server's "off" (a lost packet) it ends this long after its own end
};

export interface CatReflexesOrder { on: boolean; seconds: number; speed: number; jump: number }

/** The order in a custom packet, or null when it is not one */
export function readCatReflexesOrder(content: Record<string, unknown> | null | undefined): CatReflexesOrder | null {
  if (!content || content["customPacketType"] !== "dboCatReflexes") return null;
  const on = content["on"] === true;
  const seconds = Number(content["seconds"]);
  if (on && !(seconds > 0)) return null;
  const share = (v: unknown, max: number) => { const n = Number(v); return n > 0 ? Math.min(n, max) : 0; };
  return {
    on,
    seconds: on ? Math.min(seconds, CAT_REFLEXES.maxSeconds) : 0,
    speed: on ? share(content["speed"], CAT_REFLEXES.maxSpeed) : 0,
    jump: on ? share(content["jump"], CAT_REFLEXES.maxJump) : 0,
  };
}

// start: the speed and the jump go on (with the numbers the order carried); end: both come off again
export type CatReflexesStep = { kind: "start"; speed: number; jump: number } | { kind: "end" };

export class CatReflexesPlan {
  private active = false;
  private until = 0;   // the end the server gave, on this client's clock

  isOn(): boolean { return this.active; }
  endsAt(): number { return this.until; }

  /** A server order: the steps to take now */
  receive(order: CatReflexesOrder, now: number): CatReflexesStep[] {
    if (!order.on) return this.stop();
    this.until = now + order.seconds * 1000;
    if (this.active) return []; // already on: only the end moves (a repeat never applies it a second time)
    this.active = true;
    return [{ kind: "start", speed: order.speed, jump: order.jump }];
  }

  /** Every frame: the end when the server's off never came */
  tick(now: number): CatReflexesStep[] {
    if (this.active && now >= this.until + CAT_REFLEXES.graceMs) return this.stop();
    return [];
  }

  /** The connection is gone: it comes off; the server sends it again on login if it still lasts */
  reset(): CatReflexesStep[] { return this.stop(); }

  private stop(): CatReflexesStep[] {
    if (!this.active) return [];
    this.active = false; this.until = 0;
    return [{ kind: "end" }];
  }
}
