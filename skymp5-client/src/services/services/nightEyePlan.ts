// The Khajiit's Night Eye (server racial.js, the racial power): what the client does with the server's orders. Kept free
// of imports so a harness can drive it (tests/nighteye-harness.js).
//
//   Server -> Client: { customPacketType: "dboNightEye", on: true, seconds: <left> }   the power is upon this character
//                     { customPacketType: "dboNightEye", on: false }                   it has ended (or this character has none)
//
// The look is the player's own screen only: the imagespace modifiers of the vanilla Night Eye, applied and removed here.
// No spell is cast, so nothing reaches magicSyncService and nothing is relayed to other players (the vanilla power
// PowerKhajiitNightEye stays in BLOCKED_POWER_IDS). The server keeps the state and the wait; it sends "on" again after a
// relog while the power lasts, and "off" to a character that has none, so a switch of character takes it off.
//
// Record ids (Skyrim.esm, read with ck-mcp esplib.py from /opt/skyrim-data; Update.esm and the USSEP override the three
// IMADs at the same ids, none of the 105 plugins overrides the MGEF or the SPEL):
//   SPEL 0aa01d PowerKhajiitNightEye -> EFID MGEF 06b10c NightEyeEffect (archetype Script, no imagespace of its own),
//   whose magicNightEyeScript properties name IntroFX IMAD 06b10a NightEyeImodIntro (animated, 4 s),
//   MainFX IMAD 06b108 NightEyeImod (not animated: held until removed), OutroFX IMAD 06b10b NightEyeImodOutro (animated, 1 s),
//   IntroSoundFX SOUN 07c723 MAGIllusionNightEyeOn, OutroSoundFX SOUN 07c722 MAGIllusionNightEyeOff, fDelay 0.96.
export const NIGHT_EYE = {
  effect: 0x0006b10c, intro: 0x0006b10a, main: 0x0006b108, outro: 0x0006b10b,
  soundOn: 0x0007c723, soundOff: 0x0007c722,
  introMs: 960,
};
// The server's "off" normally ends it; without one (a lost packet) the look ends this long after its own end
export const NIGHT_EYE_GRACE_MS = 3000;
// One order lasts this long at most, whatever it says (the power is 60 s)
export const NIGHT_EYE_MAX_SECONDS = 600;

export interface NightEyeOrder { on: boolean; seconds: number }

/** The order in a custom packet, or null when it is not one */
export function readNightEyeOrder(content: Record<string, unknown> | null | undefined): NightEyeOrder | null {
  if (!content || content["customPacketType"] !== "dboNightEye") return null;
  const on = content["on"] === true;
  const seconds = Number(content["seconds"]);
  if (on && !(seconds > 0)) return null;
  return { on, seconds: on ? Math.min(seconds, NIGHT_EYE_MAX_SECONDS) : 0 };
}

// start: the intro (and its sound); main: the held look (after the intro, or at once when started with skipIntro);
// end: the held look off, the outro and its sound
export type NightEyeStep = "start" | "main" | "end";

export class NightEyePlan {
  private active = false;
  private mainAt = 0;   // when the intro gives way to the held look; 0 once it has
  private until = 0;    // the end the server gave, on this client's clock

  isOn(): boolean { return this.active; }
  endsAt(): number { return this.until; }

  /** A server order: the steps to take now */
  receive(order: NightEyeOrder, now: number): NightEyeStep[] {
    if (!order.on) return this.stop();
    this.until = now + order.seconds * 1000;
    if (this.active) return []; // already on: only the end moves (a repeat never plays the intro again)
    this.active = true;
    this.mainAt = now + NIGHT_EYE.introMs;
    return ["start"];
  }

  /** Every frame: the held look after the intro, and the end when the server's off never came */
  tick(now: number): NightEyeStep[] {
    if (!this.active) return [];
    if (now >= this.until + NIGHT_EYE_GRACE_MS) return this.stop();
    if (this.mainAt && now >= this.mainAt) { this.mainAt = 0; return ["main"]; }
    return [];
  }

  /** The connection is gone: the look ends with no outro; the server sends it again on login if it still lasts */
  reset(): NightEyeStep[] { return this.stop(); }

  private stop(): NightEyeStep[] {
    if (!this.active) return [];
    this.active = false; this.mainAt = 0; this.until = 0;
    return ["end"];
  }
}
