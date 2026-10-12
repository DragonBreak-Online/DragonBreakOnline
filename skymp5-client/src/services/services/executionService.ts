import { Actor, Game, Idle, ObjectReference } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { parseCustomPacket } from "./customPacketUtil";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { RemoteServer } from "./remoteServer";
import { remoteIdToLocalId } from "../../view/worldViewMisc";
import { logError, logTrace } from "../../logging";

const PLAYER_FORM_ID = 0x14;
const UNLINK_MS = 10000;

/**
 * The chopping block (server execution.js, Nate 12 Oct): plays vanilla's beheading on this client's copies of the two
 * actors. Vanilla's HeadChopBlock2ManHookupScript (disassembled 12 Oct) does exactly this with both seated in the block:
 * executionee.AddDependentAnimatedObjectReference(executioner), then PlayIdle on the pair. Read from Skyrim -
 * Animations.bsa on the PC (12 Oct): IdleHeadChop (idle) plays AOExecutionerChop.hkx, the headsman's swing (impact
 * 11.9 s); IdleExecutioneeChop (victimIdle) plays AOExecutioneeChop.hkx on the victim, whose Decapitate trigger
 * (11.839 s) takes the head and KillActor (16.606 s) drops the body. Both start on the same frame here so the blow
 * lands as the head comes off. The server's own death follows at its chopMs (16.7 s).
 *
 *   Server -> Client: { customPacketType: "dboExecute", victim: <server id>, executioner: <server id>, idle: "<hex>:<plugin>",
 *                       victimIdle: "<hex>:<plugin>" }
 */
export class ExecutionService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onPacket(e));
  }

  private onPacket(event: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(event);
    if (!content || content["customPacketType"] !== "dboExecute") return;
    try {
      const victim = this.localActor(Number(content["victim"]) >>> 0);
      const headsman = this.localActor(Number(content["executioner"]) >>> 0);
      const idle = this.idleOf(String(content["idle"] || ""));
      const victimIdle = this.idleOf(String(content["victimIdle"] || ""));
      if (!victim || !headsman || !idle) {
        logTrace(this, "dboExecute: an actor or the idle is not here", content["victim"], content["executioner"], content["idle"]);
        return;
      }
      const linked = victim.addDependentAnimatedObjectReference(headsman);
      // The victim's own clip carries the beheading; a server without victimIdle gets vanilla's single call
      const victimPlayed = victimIdle ? victim.playIdle(victimIdle) : victim.playIdle(idle);
      const headsmanPlayed = victimIdle ? headsman.playIdle(idle) : false;
      logTrace(this, `dboExecute: linked=${linked} victim=${victimPlayed} headsman=${headsmanPlayed}`);
      const victimId = victim.getFormID(), headsmanId = headsman.getFormID();
      setTimeout(() => {
        try {
          const v = Actor.from(Game.getFormEx(victimId)), h = ObjectReference.from(Game.getFormEx(headsmanId));
          if (v && h) v.removeDependentAnimatedObjectReference(h);
        } catch (e) { /* gone */ }
      }, UNLINK_MS);
    } catch (e) {
      logError(this, "dboExecute failed", e);
    }
  }

  // This game's actor for a server id: the player for one's own character, else the local copy
  private localActor(serverId: number): Actor | null {
    if (!serverId) return null;
    const mine = this.controller.lookupListener(RemoteServer).getMyRemoteRefrId();
    const local = mine && (mine >>> 0) === serverId ? PLAYER_FORM_ID : remoteIdToLocalId(serverId);
    return local ? Actor.from(Game.getFormEx(local)) : null;
  }

  private idleOf(desc: string): Idle | null {
    const sep = desc.indexOf(":");
    if (sep <= 0) return null;
    const form = Game.getFormFromFile(parseInt(desc.slice(0, sep), 16), desc.slice(sep + 1));
    return form ? Idle.from(form) : null;
  }
}
