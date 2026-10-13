import { Actor, Debug, Game, Idle, ObjectReference, TESModPlatform, Utility } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { parseCustomPacket } from "./customPacketUtil";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { RemoteServer } from "./remoteServer";
import { remoteIdToLocalId } from "../../view/worldViewMisc";
import { allowIdleEvent } from "../../sync/animation";
import { logError } from "../../logging";

const PLAYER_FORM_ID = 0x14;
const UNLINK_SECONDS = 10;
// The graph events of the two idles, read from Skyrim.esm's IDLE records on CT 115 (13 Oct): IdleHeadChop (74ec5) ENAM
// IdleExecutionerChop, IdleExecutioneeChop (70c09) ENAM IdleExecutioneeChop. A server that names others is followed
const HEADSMAN_EVENT = "IdleExecutionerChop";
const VICTIM_EVENT = "IdleExecutioneeChop";
// Helgen's player-victim path (HeadChopBlockHookupSCRIPT on ExecutionerChoppingBlock 2e8eb, disassembled from Skyrim -
// Misc.bsa on CT 115 13 Oct): when the executionee is the player it plays its playerAnimIdle, IdleExecutionerChop_Player
// (Skyrim.esm f95be: no parent, no conditions, ENAM IdleExecutionerChop_Player), on the executioner and then on the
// executionee, both, with the executioner already linked to the executionee. The condemned here is always a player
const PLAYER_VICTIM_IDLE = "f95be:Skyrim.esm";
const PLAYER_VICTIM_EVENT = "IdleExecutionerChop_Player";
// The furniture's own exit: vanilla's IdleExecutionerExit1 (Skyrim.esm 2e8ef, under ExecutionerRoot) sends it to the
// headsman in this block, and IdleWoodChopStop the same at a chopping log
const FURNITURE_EXIT_EVENT = "IdleChairExitStart";
// How long each way out is given before the next is tried
const STEP_SECONDS = 1.5;

/** The stand-up's ways out, in order; the next one only while the game still has the player in the furniture */
export type StandStep = "dismount" | "exitEvent" | "forceDefault" | "done";
export const nextStandStep = (step: StandStep, stillSeated: boolean): StandStep => {
  if (!stillSeated) return "done";
  if (step === "dismount") return "exitEvent";
  if (step === "exitEvent") return "forceDefault";
  return "done";
};

// One line to the server log ("[dboDiag] ... exec ..."), through PageInputDiagService's relay. Never throws
const note = (text: string): void => {
  try {
    const n = (globalThis as { __dboDiagNote?: (kind: string, text: string) => void }).__dboDiagNote;
    if (typeof n === "function") n("exec", text.slice(0, 300));
  } catch {
    // diagnostics never break the caller
  }
};
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * The chopping block (server execution.js, Nate 12 Oct).
 *
 * dboExecute plays the beheading on this client's copies of the two actors. Vanilla's HeadChopBlock2ManHookupScript
 * (disassembled from Skyrim - Misc.bsa on CT 115, 13 Oct) links the headsman to the executionee
 * (AddDependentAnimatedObjectReference) and plays IdleHeadChop on the executionee, an NPC; for a player executionee it
 * plays nothing at all. The NPC pair, kept as the fallback: the victim gets IdleExecutioneeChop (AOExecutioneeChop.hkx: Decapitate at 11.839 s,
 * KillActor at 16.606 s) and the headsman IdleHeadChop (AOExecutionerChop.hkx), on one frame. A refused PlayIdle
 * (IdleExecutioneeChop wants ExecutioneeRoot's conditions: the FurnitureExecutioner keyword on the seat, the right-hand
 * entry, GetSitting 2) falls back to the bare graph event, which no idle condition stands in front of.
 *
 * dboExecuteStand stands this player up from the block. The block has no exit a player reaches (vanilla's only one,
 * IdleExecutionerExit1, sits under ExecutionerRoot, which wants the isExecutioner keyword; the executionee has none), and
 * the server's own short move (locationalData: a MoveTo) does not take a seated player out of it (13 Oct 21:31: GM Nate
 * stayed on the block). Tried in order, each given STEP_SECONDS, stopping as soon as the game says the player is out of
 * the furniture: Actor.Dismount, the furniture exit event, then IdleForceDefaultState (drops the furniture's graph state)
 * and a move to the server's spot past the seat. The server sends the player to the temple if all of it fails.
 *
 * Both packets arrive in tick context, where every Papyrus native throws "can't be called in this context" (0.3.96:
 * Game.getFormEx threw, the catch only printed to the console, and nothing played), so all the work runs on update.
 *
 * The victim is always a player, so the pair plays Helgen's player-victim path first: IdleExecutionerChop_Player on
 * the headsman, then on the victim (the order HeadChopBlockHookupSCRIPT uses), each falling back to the bare event. Only
 * if that idle is missing from this game, or the server sends playerIdle "" to turn it off, the NPC pair above plays.
 *
 *   Server -> Client: { customPacketType: "dboExecute", victim, executioner, idle, victimIdle, event?, victimEvent?,
 *                       playerIdle?, playerEvent? }
 *                     { customPacketType: "dboExecuteStand", pos: [x, y, z], rot?: [x, y, z] }
 */
export class ExecutionService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onPacket(e));
  }

  private onPacket(event: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(event);
    if (!content) return;
    const type = content["customPacketType"];
    if (type === "dboExecute") {
      this.controller.once("update", () => this.play(content));
    } else if (type === "dboExecuteStand") {
      const chain = ++this.standChain;
      this.controller.once("update", () => this.standStep(content, "dismount", chain));
    }
  }

  private play(content: Record<string, unknown>): void {
    try {
      const victim = this.localActor(Number(content["victim"]) >>> 0);
      const headsman = this.localActor(Number(content["executioner"]) >>> 0);
      const idle = this.idleOf(String(content["idle"] || ""));
      const victimIdle = this.idleOf(String(content["victimIdle"] || ""));
      if (!victim || !headsman || !idle) {
        note(`play skipped victim=${!!victim} headsman=${!!headsman} idle=${!!idle}`);
        return;
      }
      const linked = victim.addDependentAnimatedObjectReference(headsman);
      const playerIdleDesc = content["playerIdle"] === undefined ? PLAYER_VICTIM_IDLE : String(content["playerIdle"] || "");
      const playerIdle = playerIdleDesc ? this.idleOf(playerIdleDesc) : null;
      let path: string, victimHow: string, headsmanHow: string;
      if (playerIdle) {
        // Helgen: the headsman first, then the victim, the same idle on both
        const ev = String(content["playerEvent"] || PLAYER_VICTIM_EVENT);
        path = "helgen";
        headsmanHow = this.playOrEvent(headsman, playerIdle, ev);
        victimHow = this.playOrEvent(victim, playerIdle, ev);
      } else {
        const headsmanEvent = String(content["event"] || HEADSMAN_EVENT);
        const victimEvent = victimIdle ? String(content["victimEvent"] || VICTIM_EVENT) : headsmanEvent;
        path = "npc";
        // The victim's own clip carries the beheading; a server without victimIdle gets vanilla's single call
        victimHow = this.playOrEvent(victim, victimIdle || idle, victimEvent);
        headsmanHow = victimIdle ? this.playOrEvent(headsman, idle, headsmanEvent) : "-";
      }
      note(`play ${path} linked=${linked} victim=${this.describe(victim)} ${victimHow} headsman=${this.describe(headsman)} ${headsmanHow}`);
      const victimId = victim.getFormID(), headsmanId = headsman.getFormID();
      Utility.wait(UNLINK_SECONDS).then(() => this.controller.once("update", () => {
        try {
          const v = Actor.from(Game.getFormEx(victimId)), h = ObjectReference.from(Game.getFormEx(headsmanId));
          if (v && h) v.removeDependentAnimatedObjectReference(h);
        } catch (e) { /* gone */ }
      }));
    } catch (e) {
      logError(this, "dboExecute failed", e);
      note(`play failed ${errText(e)}`);
    }
  }

  // PlayIdle, or the bare graph event if the idle tree refuses it; a copy's idle event is let past animation.ts's filter
  private playOrEvent(a: Actor, idle: Idle, event: string): string {
    allowIdleEvent(a.getFormID(), event);
    if (a.playIdle(idle)) return "idle";
    allowIdleEvent(a.getFormID(), event);
    Debug.sendAnimationEvent(a, event);
    return "event";
  }

  // One way out of the block, then the next if the game still has the player in the furniture
  private standStep(content: Record<string, unknown>, step: StandStep, chain: number): void {
    if (chain !== this.standChain) return;
    try {
      const player = Game.getPlayer();
      if (!player) return;
      const furniture = player.getFurnitureReference();
      if (!furniture) {
        note(`stand ${step}: not in furniture sit=${player.getSitState()}`);
        return;
      }
      if (step === "dismount") {
        note(`stand dismount=${player.dismount()} sit=${player.getSitState()} furn=${furniture.getFormID().toString(16)}`);
      } else if (step === "exitEvent") {
        Debug.sendAnimationEvent(player, FURNITURE_EXIT_EVENT);
        note(`stand exitEvent sit=${player.getSitState()}`);
      } else if (step === "forceDefault") {
        Debug.sendAnimationEvent(player, "IdleForceDefaultState");
        Utility.wait(0.3).then(() => this.controller.once("update", () => this.moveOut(content)));
        return;
      } else {
        return;
      }
      Utility.wait(STEP_SECONDS).then(() => this.controller.once("update", () => {
        if (chain !== this.standChain) return;
        const p = Game.getPlayer();
        const next = nextStandStep(step, !!(p && p.getFurnitureReference()));
        if (next === "done") {
          if (p) note(`stand ${step} worked sit=${p.getSitState()}`);
          return;
        }
        this.standStep(content, next, chain);
      }));
    } catch (e) {
      logError(this, "dboExecuteStand failed", e);
      note(`stand ${step} failed ${errText(e)}`);
    }
  }

  // The last way out: set the player down at the server's spot past the seat, the teleport path's own move
  private moveOut(content: Record<string, unknown>): void {
    try {
      const p = Game.getPlayer();
      const pos = content["pos"] as unknown;
      if (!p || !Array.isArray(pos) || pos.length < 3 || !pos.slice(0, 3).every((v) => Number.isFinite(v))) {
        note(`stand forceDefault: no spot to move to`);
        return;
      }
      const rot = Array.isArray(content["rot"]) ? (content["rot"] as unknown[]).map(Number) : [0, 0, p.getAngleZ()];
      TESModPlatform.moveRefrToPosition(p, p.getParentCell(), p.getWorldSpace(), Number(pos[0]), Number(pos[1]), Number(pos[2]),
        rot[0] || 0, rot[1] || 0, rot[2] || 0);
      note(`stand forceDefault moved furn=${p.getFurnitureReference() ? "still" : "none"} sit=${p.getSitState()}`);
    } catch (e) {
      note(`stand move failed ${errText(e)}`);
    }
  }

  private describe(a: Actor): string {
    try {
      const f = a.getFurnitureReference();
      return `${a.getFormID().toString(16)}/sit${a.getSitState()}/${f ? f.getFormID().toString(16) : "nofurn"}`;
    } catch (e) {
      return "?";
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

  private standChain = 0;
}
