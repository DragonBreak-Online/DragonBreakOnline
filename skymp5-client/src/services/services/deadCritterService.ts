import { Game, ObjectLoadedEvent, ObjectReference } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { DeadBody, deadBodiesToRemove, isSpawnedBody } from "../../view/deadCritterPolicy";
import { logError, logTrace } from "../../logging";
import { safeDelete } from "../../view/npcLifetimeRuntime";

// Dead hawks' bodies: fcHawkGO (Skyrim.esm, also overridden by BSHeartland) and Dawnguard's DLC1BoneHawkGO
const DEAD_BODY_BASES: [number, string][] = [[0x105821, "Skyrim.esm"], [0x002992, "Dawnguard.esm"]];
const PASS_MS = 15000;
const LOOT_METERS = 4;
const UNITS_PER_METER = 70;

// Removes dead hawks' bodies (view/deadCritterPolicy.ts decides which)
export class DeadCritterService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.on("objectLoaded", (e) => this.onObjectLoaded(e));
    this.controller.on("update", () => this.onUpdate());
  }

  private onObjectLoaded(e: ObjectLoadedEvent): void {
    if (!e.isLoaded) return;
    try {
      const ref = ObjectReference.from(e.object);
      if (!ref || !isSpawnedBody(ref.getFormID())) return;
      const base = ref.getBaseObject();
      if (!base || !this.bases().has(base.getFormID() >>> 0)) return;
      const id = ref.getFormID() >>> 0;
      if (!this.bodies.has(id)) this.bodies.set(id, { id, firstSeenMs: Date.now() });
    } catch (err) {
      logError(this, `onObjectLoaded failed: ${err}`);
    }
  }

  private onUpdate(): void {
    const now = Date.now();
    if (now - this.lastPassMs < PASS_MS || !this.bodies.size) return;
    this.lastPassMs = now;
    const player = Game.getPlayer();
    if (!player) return;
    const live: DeadBody[] = [];
    for (const b of Array.from(this.bodies.values())) {
      const ref = ObjectReference.from(Game.getFormEx(b.id));
      if (ref && !ref.isDisabled()) live.push(b); else this.bodies.delete(b.id);
    }
    const near = (id: number) => {
      const ref = ObjectReference.from(Game.getFormEx(id));
      return !!ref && player.getDistance(ref) <= LOOT_METERS * UNITS_PER_METER;
    };
    for (const id of deadBodiesToRemove(live, now, near)) {
      this.bodies.delete(id);
      const ref = ObjectReference.from(Game.getFormEx(id));
      if (!ref) continue;
      // Was DisableNoWait then Delete in the same frame: the queued Disable could then run on the deleted body (the 41702
      // crash). safeDelete orders the two, natively when the lifecycle switch is on
      safeDelete(ref);
      logTrace(this, `removed a dead hawk's body ${id.toString(16)}`);
    }
  }

  private bases(): Set<number> {
    if (!this.baseIds) {
      const ids = new Set<number>();
      for (const [local, file] of DEAD_BODY_BASES) {
        const f = Game.getFormFromFile(local, file);
        if (f) ids.add(f.getFormID() >>> 0);
      }
      if (!ids.size) return ids;
      this.baseIds = ids;
    }
    return this.baseIds;
  }

  private bodies = new Map<number, DeadBody>();
  private baseIds: Set<number> | null = null;
  private lastPassMs = 0;
}
