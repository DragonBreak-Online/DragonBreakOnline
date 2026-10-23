import { Actor } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { parseCustomPacket, sendCustomPacket } from "./customPacketUtil";
import { RemoteServer } from "./remoteServer";
import { remoteIdToLocalId } from "../../view/worldViewMisc";

// Server -> client: { customPacketType: "dboFrenzy", on: true, target, seconds, disable? } | { customPacketType: "dboFrenzy", on: false }
// (server frenzy.js, a werewolf frenzy). disable: the eight Game.DisablePlayerControls flags while frenzied.
export interface FrenzyOrder { on: boolean; target: number; seconds: number; disable: boolean[] }
export const DEFAULT_DISABLE = [true, false, false, false, true, true, true, true];
// The failsafe: control comes back this long after the last order's seconds ran out, and never later than MAX_TOTAL_S
// after the frenzy began, whatever the server says (a lost "off" never leaves a player AI-driven)
export const FAILSAFE_GRACE_S = 5;
export const MAX_ORDER_S = 60;
export const MAX_TOTAL_S = 90;

export const readFrenzy = (content: Record<string, unknown> | null | undefined): FrenzyOrder | null => {
  if (!content || content["customPacketType"] !== "dboFrenzy") return null;
  if (content["on"] !== true) return { on: false, target: 0, seconds: 0, disable: DEFAULT_DISABLE };
  const target = Number(content["target"]) >>> 0, seconds = Number(content["seconds"]);
  if (!target || !Number.isFinite(seconds) || seconds <= 0) return null;
  const d = content["disable"];
  const disable = Array.isArray(d) && d.length === 8 ? d.map((v) => v === true) : DEFAULT_DISABLE;
  return { on: true, target, seconds: Math.min(MAX_ORDER_S, seconds), disable };
};

export const deadlineFor = (now: number, startedAt: number, seconds: number): number =>
  Math.min(now + (Math.min(MAX_ORDER_S, seconds) + FAILSAFE_GRACE_S) * 1000, startedAt + MAX_TOTAL_S * 1000);

const PLAYER_FORM_ID = 0x14;
const note = (text: string): void => {
  try {
    const n = (globalThis as { __dboDiagNote?: (kind: string, text: string) => void }).__dboDiagNote;
    if (typeof n === "function") n("frenzy", text.slice(0, 300));
  } catch {
    // diagnostics never break the caller
  }
};

/**
 * The werewolf frenzy: while the server says so, the player is AI-driven (Game.SetPlayerAIDriven), the flagged controls
 * are off, and the player fights the server's target (Actor.StartCombat), switching when a new one comes. Control comes
 * back on the server's "off", on death, on a disconnect or game load, and on the local failsafe (deadlineFor).
 * Papyrus natives throw in packet context, so all of it runs on update.
 */
export class FrenzyService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onPacket(e));
    this.controller.emitter.on("connectionDisconnect", () => this.controller.once("update", () => this.release("disconnect", false)));
    this.controller.emitter.on("gameLoad", () => this.controller.once("update", () => this.release("game load", false)));
    this.controller.on("update", () => this.onUpdate());
  }

  private onPacket(event: ConnectionMessage<CustomPacketMessage>): void {
    const order = readFrenzy(parseCustomPacket(event));
    if (!order) return;
    this.controller.once("update", () => (order.on ? this.apply(order) : this.release("server", false)));
  }

  private apply(order: FrenzyOrder): void {
    const now = Date.now();
    if (!this.active) {
      this.active = true;
      this.startedAt = now;
      this.target = 0;
      this.disable = order.disable;
      try { this.sp.Game.setPlayerAIDriven(true); } catch (e) { note(`aiDriven on failed ${e}`); }
      try { const f = this.disable; this.sp.Game.disablePlayerControls(f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7], 0); } catch (e) { note(`controls off failed ${e}`); }
      sendCustomPacket(this.controller, { customPacketType: "dboFrenzyReport", phase: "on" });
      note(`on ${order.seconds}s`);
    }
    this.deadline = deadlineFor(now, this.startedAt, order.seconds);
    const player = this.sp.Game.getPlayer();
    if (!player) return;
    const fresh = order.target !== this.target;
    if (!fresh && player.isInCombat()) return;
    const foe = this.localActor(order.target);
    if (!foe) {
      sendCustomPacket(this.controller, { customPacketType: "dboFrenzyReport", phase: "miss", target: order.target });
      note(`miss ${order.target.toString(16)}`);
      this.target = 0;
      return;
    }
    this.target = order.target;
    try { player.startCombat(foe); } catch (e) { note(`startCombat failed ${e}`); }
    if (fresh) note(`target ${order.target.toString(16)}`);
  }

  private onUpdate(): void {
    if (!this.active) return;
    let gone = false;
    try { const p = this.sp.Game.getPlayer(); gone = !p || p.isDead(); } catch { gone = false; }
    if (gone) this.release("dead", true);
    else if (Date.now() > this.deadline) this.release("failsafe", true);
  }

  private release(why: string, tell: boolean): void {
    if (!this.active) return;
    this.active = false;
    this.target = 0;
    try { const p = this.sp.Game.getPlayer(); if (p) p.stopCombat(); } catch { /* no player */ }
    try { this.sp.Game.setPlayerAIDriven(false); } catch (e) { note(`aiDriven off failed ${e}`); }
    try { const f = this.disable; this.sp.Game.enablePlayerControls(f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7], 0); } catch (e) { note(`controls on failed ${e}`); }
    if (tell) sendCustomPacket(this.controller, { customPacketType: "dboFrenzyReport", phase: "off", why });
    note(`off ${why}`);
  }

  // This game's actor for a server id: the local copy (a frenzied werewolf never targets itself)
  private localActor(serverId: number): Actor | null {
    const mine = this.controller.lookupListener(RemoteServer).getMyRemoteRefrId();
    if (mine && (mine >>> 0) === serverId) return null;
    const local = remoteIdToLocalId(serverId);
    if (!local || local === PLAYER_FORM_ID) return null;
    const a = this.sp.Actor.from(this.sp.Game.getFormEx(local));
    return a && !a.isDead() ? a : null;
  }

  private active = false;
  private startedAt = 0;
  private deadline = 0;
  private target = 0;
  private disable: boolean[] = DEFAULT_DISABLE;
}
