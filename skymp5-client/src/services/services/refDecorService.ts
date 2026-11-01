import { ClientListener, CombinedController, Sp } from "./clientListener";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { remoteIdToLocalId } from "../../view/worldViewMisc";
import { Container, Door, ObjectReference } from "skyrimPlatform";
import { logTrace } from "../../logging";
import { pickSweep } from "./refDecorSweep";

const MASTER_LOCK_LEVEL = 100;
const APPLY_EVERY_N_UPDATES = 30;
// Slow ticks a chest must stay 3D-loaded before it is renamed (about 3 s)
const CHEST_SETTLE_TICKS = 6;

// One claimed reference's presentation, as sent by the server.
interface RefDecor {
  refId: number;
  name: string | null;
  locked: boolean;
}

/**
 * Applies claim state to the actual game world. Locks are enforced server-side
 * regardless; this service makes them visible and physical on each client:
 *
 *   Server -> Client: { "customPacketType": "refDecor", "refs": [
 *     { "refId", "name", "locked" } ] }
 *
 * - name: setDisplayName so the crosshair shows the claim's name.
 * - locked: Master lock via setLockLevel(100) + lock(true) for every player;
 *   the server refuses activation until someone with access unlocks it.
 * Entries re-apply on a slow tick so refs that load later (cell changes)
 * converge without extra packets.
 */
export class RefDecorService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onCustomPacketMessage(e));
    this.controller.on("update", () => this.onUpdate());
    this.controller.emitter.on("gameLoad", () => this.onGameLoad());
    // Walking into an area changes which refs are loaded: resolve everything once, during the load, rather
    // than discovering it a cursor step at a time afterwards
    this.controller.on("cellFullyLoaded", () => { this.fullSweep = true; });
  }

  // A save load resets every engine lock and display name
  private onGameLoad(): void {
    this.applied.clear();
    this.loadedTicks.clear();
    this.hot.clear();
    this.sweepCursor = 0;
    this.fullSweep = true;
    this.updateCounter = APPLY_EVERY_N_UPDATES;
  }

  private onCustomPacketMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    let content: Record<string, unknown> = {};
    try {
      content = JSON.parse(event.message.contentJsonDump);
    } catch (e) {
      return;
    }
    if (content["customPacketType"] !== "refDecor" || !Array.isArray(content["refs"])) {
      return;
    }
    // Full syncs replace the set: refs we decorated that are gone from the
    // sync (abandoned claims) get a synthetic unlock entry so they revert.
    if (content["full"] === true) {
      const incoming = new Set((content["refs"] as any[]).map((r) => Number(r?.refId) >>> 0));
      this.decor.forEach((_d, refId) => {
        if (!incoming.has(refId)) {
          this.decor.set(refId, { refId, name: null, locked: false });
        }
      });
    }
    logTrace(this, `sync:`, (content["refs"] as any[]).length, `refs`);
    for (const raw of content["refs"] as any[]) {
      const refId = Number(raw?.refId) >>> 0;
      if (!refId) {
        continue;
      }
      this.decor.set(refId, {
        refId,
        name: typeof raw.name === "string" && raw.name ? raw.name : null,
        locked: raw.locked === true,
      });
      this.applied.delete(refId);
    }
    // Apply on the next update rather than the next slow tick, and look at everything: the refs that just
    // changed are wherever they are in the id order, not necessarily under the cursor
    this.fullSweep = true;
    this.updateCounter = APPLY_EVERY_N_UPDATES;
  }

  private onUpdate(): void {
    if (this.decor.size === 0 || ++this.updateCounter < APPLY_EVERY_N_UPDATES) {
      return;
    }
    this.updateCounter = 0;
    const stats = { names: 0, locks: 0, errors: 0, notLoaded: 0, firstError: "" };
    // Not every ref every sweep: see refDecorSweep.ts. The whole set is ~1,700 refs and nearly all of them
    // are in cells that are not loaded, so resolving them all cost one frame in thirty about 3,400 native
    // calls to throw almost all of the answers away.
    const pick = pickSweep(Array.from(this.decor.keys()), { hot: this.hot, cursor: this.sweepCursor, full: this.fullSweep });
    this.sweepCursor = pick.cursor;
    if (pick.covered) {
      this.fullSweep = false;
    }
    for (const refId of pick.ids) {
      const d = this.decor.get(refId);
      if (d) {
        this.apply(d, stats);
      }
    }
    if (stats.names || stats.locks || stats.errors) {
      logTrace(this, `applied names=${stats.names} locks=${stats.locks} errors=${stats.errors} notloaded=${stats.notLoaded}${stats.firstError ? " | " + stats.firstError : ""}`);
    }
  }

  private apply(d: RefDecor, stats: { names: number; locks: number; errors: number; notLoaded: number; firstError: string }): void {
    let refr: ObjectReference | null = null;
    try {
      const localId = remoteIdToLocalId(d.refId);
      if (!localId) {
        return;
      }
      refr = ObjectReference.from(this.sp.Game.getFormEx(localId));
    } catch (e) {
      return;
    }
    if (!refr) {
      stats.notLoaded++;
      this.loadedTicks.delete(d.refId);
      this.hot.delete(d.refId);
      return; // not loaded yet; retried on a later sweep
    }
    // It resolved, so it is near the player: visited on every sweep from now on, which keeps a chest's
    // CHEST_SETTLE_TICKS counting at the rate it always did
    this.hot.add(d.refId);

    const prev = this.applied.get(d.refId) || {};
    // SKSE's SetDisplayName on a ref with no extra data yet writes through a null pointer (skse64+42EC, Frostcrag Spire's
    // chests on 5 Oct): doors are named once 3D-loaded, chests once 3D-loaded for CHEST_SETTLE_TICKS ticks in a row.
    let nameable = false;
    try {
      const loaded = refr.is3DLoaded();
      const base = refr.getBaseObject();
      if (!loaded) {
        this.loadedTicks.delete(d.refId);
      } else if (Door.from(base)) {
        nameable = true;
      } else if (Container.from(base)) {
        const ticks = (this.loadedTicks.get(d.refId) || 0) + 1;
        this.loadedTicks.set(d.refId, ticks);
        nameable = ticks > CHEST_SETTLE_TICKS;
      }
    } catch (e) { nameable = false; }
    if (d.name && prev.name !== d.name && nameable) {
      try {
        refr.setDisplayName(d.name, true);
        prev.name = d.name;
        stats.names++;
      } catch (e: any) {
        stats.errors++;
        if (!stats.firstError) stats.firstError = "name: " + (e && e.message);
      }
    }
    // A released claim hands the crosshair back to the base object's name
    if (!d.name && prev.name && nameable) {
      try {
        refr.setDisplayName(refr.getBaseObject()?.getName() || "", true);
        delete prev.name;
        stats.names++;
      } catch (e: any) {
        stats.errors++;
        if (!stats.firstError) stats.firstError = "name: " + (e && e.message);
      }
    }
    try {
      // Compared with the engine every pass, since a re-created view unlocks the ref behind this service's back
      if (refr.isLocked() !== d.locked) {
        if (d.locked) {
          refr.setLockLevel(MASTER_LOCK_LEVEL);
          refr.lock(true, false);
        } else {
          refr.lock(false, false);
        }
        stats.locks++;
      }
      if (!d.locked && !d.name) {
        this.decor.delete(d.refId);
        this.loadedTicks.delete(d.refId);
      }
    } catch (e: any) {
      stats.errors++;
      if (!stats.firstError) stats.firstError = "lock: " + (e && e.message);
    }
    this.applied.set(d.refId, prev);
  }

  private decor = new Map<number, RefDecor>();
  // refs that resolved to a real reference last time they were looked at
  private hot = new Set<number>();
  private sweepCursor = 0;
  private fullSweep = true;
  private applied = new Map<number, { name?: string }>();
  private loadedTicks = new Map<number, number>();
  private updateCounter = 0;
}
