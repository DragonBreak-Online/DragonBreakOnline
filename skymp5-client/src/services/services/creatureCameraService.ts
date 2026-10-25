import { ClientListener, CombinedController, Sp } from "./clientListener";
import { parseCustomPacket } from "./customPacketUtil";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { Game, NetImmerse } from "skyrimPlatform";
import { logError, logTrace } from "../../logging";
import { isPolymorphRaceId } from "../../sync/beastRaceIds";
import { CAM3_NODE, CameraOffsets, OVER_SHOULDER_INI, OverShoulderKey, planForBody, planForLeaving, readOffsets } from "./creatureCamera";

// How often the player's race is checked. The race is the signal rather than the dboBeast packet, because a body
// ends five ways (revert, death, logout, login, the tick guards) and only some of them send one; watching the race
// catches all of them and heals itself after a reconnect.
const CHECK_EVERY_MS = 500;

// The third-person camera in a polymorph body. Entering one forces third person where the skeleton can carry the
// camera and first person where it cannot, and leaving restores the view the player had. See creatureCamera.ts for
// why the ini is only touched when the camera node is really there.
export class CreatureCameraService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onBeastMessage(e));
    // Every native here runs from update: Game.getCameraState, forceThirdPerson, NetImmerse.hasNode and
    // Utility.setINIFloat all throw "can't be called in this context" from a packet handler or a tick task
    this.controller.on("update", () => this.check());
  }

  // The server names the offsets per form, so Nat can tune them in the gameplay config without a client build.
  // The packet only records them; nothing native runs here.
  private onBeastMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(event);
    if (!content || content["customPacketType"] !== "dboBeast") return;
    const raceId = Number(content["race"]) >>> 0;
    const offsets = readOffsets(content["camera"]);
    if (!raceId) return;
    if (offsets) this.offsetsByRace.set(raceId, offsets);
    else this.offsetsByRace.delete(raceId);
  }

  private check(): void {
    const now = Date.now();
    if (now - this.checkedAt < CHECK_EVERY_MS) return;
    this.checkedAt = now;
    let raceId = 0;
    try {
      const player = Game.getPlayer();
      const race = player ? player.getRace() : null;
      raceId = race ? race.getFormID() >>> 0 : 0;
    } catch (e) {
      return;   // mid-load; the next check sees it
    }
    const inBody = isPolymorphRaceId(raceId);
    if (inBody && this.bodyRace !== raceId) this.enter(raceId);
    else if (!inBody && this.bodyRace !== 0) this.leave();
  }

  private enter(raceId: number): void {
    // A change straight from one creature to another restores the first before taking the second
    if (this.bodyRace !== 0) this.leave();
    let hasNode = false;
    try {
      const player = Game.getPlayer();
      hasNode = !!player && NetImmerse.hasNode(player, CAM3_NODE, false);
      this.wasFirstPerson = Game.getCameraState() === 0;
    } catch (e) {
      logError(this, "could not read the camera or the skeleton", e);
      return;
    }
    const plan = planForBody(hasNode, this.offsetsByRace.get(raceId) ?? null);
    this.bodyRace = raceId;
    this.saved = null;
    this.wrote = null;
    if (plan.offsets) {
      const saved = this.readIni(plan.offsets);
      if (saved && this.writeIni(plan.offsets)) { this.saved = saved; this.wrote = plan.offsets; }
    }
    this.setPerson(plan.person);
    logTrace(this, "Creature camera", `race ${raceId.toString(16)}`, `node ${hasNode ? "yes" : "no"}`, plan.person, plan.why);
    this.note(`entered ${raceId.toString(16)}: node ${hasNode ? "yes" : "no"}, ${plan.person} person, ${plan.why}`);
  }

  private leave(): void {
    const plan = planForLeaving(this.wasFirstPerson, this.wrote, this.saved);
    if (plan.offsets) this.writeIni(plan.offsets);
    this.setPerson(plan.person);
    this.note(`left ${this.bodyRace.toString(16)}: ${plan.person} person, ${plan.why}`);
    this.bodyRace = 0;
    this.saved = null;
    this.wrote = null;
  }

  // The values as they are now, for the keys this form is about to move
  private readIni(wanted: CameraOffsets): CameraOffsets | null {
    const out: CameraOffsets = {};
    try {
      for (const k of Object.keys(wanted) as OverShoulderKey[]) {
        const v = this.sp.Utility.getINIFloat(OVER_SHOULDER_INI[k]);
        if (Number.isFinite(v)) out[k] = v;
      }
    } catch (e) {
      logError(this, "could not read the over-shoulder camera settings", e);
      return null;
    }
    return out;
  }

  private writeIni(values: CameraOffsets): boolean {
    try {
      for (const k of Object.keys(values) as OverShoulderKey[]) {
        const v = values[k];
        if (v !== undefined) this.sp.Utility.setINIFloat(OVER_SHOULDER_INI[k], v);
      }
      return true;
    } catch (e) {
      logError(this, "could not set the over-shoulder camera settings", e);
      return false;
    }
  }

  private setPerson(person: "first" | "third"): void {
    try {
      if (person === "first") Game.forceFirstPerson();
      else Game.forceThirdPerson();
    } catch (e) {
      logError(this, `could not force ${person} person`, e);
    }
  }

  private note(text: string): void {
    const n = (globalThis as { __dboDiagNote?: (kind: string, text: string) => void }).__dboDiagNote;
    try { if (typeof n === "function") n("creatureCamera", text); } catch { /* diagnostics only */ }
  }

  private checkedAt = 0;
  private bodyRace = 0;
  private wasFirstPerson = false;
  private saved: CameraOffsets | null = null;
  private wrote: CameraOffsets | null = null;
  private offsetsByRace = new Map<number, CameraOffsets>();
}
