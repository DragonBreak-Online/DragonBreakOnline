import { Game, ObjectLoadedEvent, ObjectReference } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { ConnectionMessage } from "../events/connectionMessage";
import { CreateActorMessage } from "../messages/createActorMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { parseCustomPacket, sendCustomPacket } from "./customPacketUtil";
import { logError, logTrace } from "../../logging";

/**
 * Staff edits of what the plugins placed (server worldedit.js, F7 Place tab). The server keeps the list; this applies it
 * to the references in this game, since the server never sends a plugin reference's position (remoteServer.ts applies no
 * transform below 0xff000000) and keeps no form at all for statics. Every client applies the same list, so every player
 * sees the same world, and a restart or a relaunch changes nothing: the list comes again at login.
 *
 *   Client -> Server: dbo worldEditsRequest []   when this player's character arrives
 *   Server -> here:   worldEdits { edits: [{ ref, hide, pos?, rot? }] }   the whole list, again after every change
 *
 * A reference is put right when its 3D loads (objectLoaded) and on a slow sweep, since a reference far away has no 3D
 * to move. One that leaves the list is shown again and put back where it stood before this service first moved it.
 */
interface Edit { hide: boolean; pos?: number[]; rot?: number[] }
// Where a reference stood before a move here, and whether it was hidden here
interface Done { hid: boolean; origin?: number[] }

const SWEEP_MS = 1000;
const PER_SWEEP = 200;
const POS_EPS = 1;
const ROT_EPS = 0.5;

const angleOff = (a: number, b: number): number => { const d = Math.abs((((a - b) % 360) + 360) % 360); return Math.min(d, 360 - d); };
const vec3 = (v: unknown): number[] | undefined => (Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(Number(n))) ? v.map(Number) : undefined);
const angles = (v: unknown): number[] | undefined => (Array.isArray(v) && v.length === 3 ? v.map((n) => Number(n) || 0) : undefined);

export class WorldEditService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onCustomPacketMessage(e));
    this.controller.emitter.on("createActorMessage", (e) => this.onCreateActorMessage(e));
    this.controller.on("objectLoaded", (e) => this.onObjectLoaded(e));
    this.controller.on("update", () => this.onUpdate());
  }

  private onCreateActorMessage(e: ConnectionMessage<CreateActorMessage>): void {
    if (!e.message.isMe) return;
    sendCustomPacket(this.controller, { customPacketType: "dbo", event: "worldEditsRequest", args: [] });
  }

  private onCustomPacketMessage(e: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(e);
    if (!content || content["customPacketType"] !== "worldEdits" || !Array.isArray(content["edits"])) return;
    const next = new Map<number, Edit>();
    for (const raw of content["edits"] as Array<Record<string, unknown>>) {
      const ref = Number(raw && raw.ref) >>> 0;
      if (!ref || ref >= 0xff000000) continue;
      const pos = vec3(raw.pos);
      const rot = angles(raw.rot);
      next.set(ref, { hide: raw.hide === true, pos, rot: pos ? (rot || [0, 0, 0]) : undefined });
      // The plugin's pose from the server, kept for the put back: a server SpSnippet may have moved it before any sweep here
      const orig = (raw.orig || {}) as Record<string, unknown>;
      const origPos = pos ? vec3(orig.pos) : undefined;
      if (origPos) this.done.set(ref, { hid: false, ...this.done.get(ref), origin: [...origPos, ...(angles(orig.rot) || [0, 0, 0])] });
    }
    // Gone from the list: put back on the next sweep
    this.edits.forEach((_, ref) => { if (!next.has(ref)) this.dropped.add(ref); });
    next.forEach((_, ref) => this.dropped.delete(ref));
    this.edits = next;
    this.queue = this.pending();
    // Swept on the next update, before the VM runs a server SetPosition that came with the list
    this.lastSweep = 0;
    logTrace(this, `worldEdits: ${next.size} edits, ${this.dropped.size} to put back`);
  }

  // Natives are fine in this event; the reference is put right at once so it never shows where it should not be
  private onObjectLoaded(e: ObjectLoadedEvent): void {
    if (!e.isLoaded || !e.object) return;
    const id = e.object.getFormID() >>> 0;
    if (id >= 0xff000000 || (!this.edits.has(id) && !this.dropped.has(id))) return;
    try {
      const ref = ObjectReference.from(e.object);
      if (ref) this.applyTo(id, ref);
    } catch (err) {
      logError(this, `objectLoaded ${id.toString(16)} failed: ${err}`);
    }
  }

  private onUpdate(): void {
    const now = Date.now();
    if (now - this.lastSweep < SWEEP_MS || (!this.edits.size && !this.dropped.size)) return;
    this.lastSweep = now;
    if (!this.queue.length) this.queue = this.pending();
    for (const id of this.queue.splice(0, PER_SWEEP)) {
      try {
        const ref = ObjectReference.from(Game.getFormEx(id));
        if (ref) this.applyTo(id, ref);
      } catch (err) {
        logError(this, `sweep ${id.toString(16)} failed: ${err}`);
      }
    }
  }

  private pending(): number[] {
    return Array.from(this.edits.keys()).concat(Array.from(this.dropped));
  }

  private applyTo(id: number, ref: ObjectReference): void {
    const edit = this.edits.get(id);
    const done = this.done.get(id) || { hid: false };
    if (!edit) {
      // Off the list: shown again and back where it stood, then forgotten
      if (done.hid && ref.isDisabled()) ref.enable(false);
      if (done.origin) {
        if (!ref.is3DLoaded()) return;
        this.pose(ref, done.origin);
      }
      this.done.delete(id);
      this.dropped.delete(id);
      return;
    }
    if (edit.hide && !ref.isDisabled()) {
      ref.disable(false);
      done.hid = true;
    } else if (!edit.hide && done.hid) {
      if (ref.isDisabled()) ref.enable(false);
      done.hid = false;
    }
    if (edit.pos && ref.is3DLoaded()) {
      if (!done.origin) done.origin = [ref.getPositionX(), ref.getPositionY(), ref.getPositionZ(), ref.getAngleX(), ref.getAngleY(), ref.getAngleZ()];
      this.pose(ref, [...edit.pos, ...(edit.rot || [0, 0, 0])]);
    } else if (!edit.pos && done.origin && ref.is3DLoaded()) {
      this.pose(ref, done.origin);
      done.origin = undefined;
    }
    this.done.set(id, done);
  }

  // Moved only when it is off by more than a little: setPosition re-places the reference every time
  private pose(ref: ObjectReference, p: number[]): void {
    const off = Math.hypot(ref.getPositionX() - p[0], ref.getPositionY() - p[1], ref.getPositionZ() - p[2]);
    if (off > POS_EPS) ref.setPosition(p[0], p[1], p[2]).catch(() => { /* the reference went away */ });
    if (angleOff(ref.getAngleX(), p[3]) > ROT_EPS || angleOff(ref.getAngleY(), p[4]) > ROT_EPS || angleOff(ref.getAngleZ(), p[5]) > ROT_EPS) {
      ref.setAngle(p[3], p[4], p[5]).catch(() => { /* the reference went away */ });
    }
  }

  private edits = new Map<number, Edit>();
  private dropped = new Set<number>();
  private done = new Map<number, Done>();
  private queue: number[] = [];
  private lastSweep = 0;
}
