import { ClientListener, CombinedController, Sp } from "./clientListener";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { remoteIdToLocalId } from "../../view/worldViewMisc";
import { Container, Door, ObjectReference } from "skyrimPlatform";
import { logTrace } from "../../logging";
import { DecorWork, runBudget, VisitKind } from "./refDecorSweep";

const MASTER_LOCK_LEVEL = 100;
// Slow ticks a chest must stay 3D-loaded before it is renamed (about 3 s)
const CHEST_SETTLE_TICKS = 6;

type ApplyStats = { names: number; locks: number; errors: number; notLoaded: number; firstError: string };

// What the perf report shows of this service since its last take
export interface RefDecorPerf {
  n: number;
  live: number;
  q: number;
  pk: number;
  sweeps: number;
  msPerSweep: number;
  maxMs: number;
  visits: number;
  applied: number;
}

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
 * Work is spread over updates under a time budget (refDecorSweep.ts): server
 * changes are applied wherever the ref is, refs in loaded 3D re-apply on a
 * slow tick, and the rest are only probed, after a cell load or a few a tick.
 */
export class RefDecorService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onCustomPacketMessage(e));
    this.controller.on("update", () => this.onUpdate());
    this.controller.emitter.on("gameLoad", () => this.onGameLoad());
    this.controller.on("cellFullyLoaded", () => this.work.cellLoaded());
  }

  takePerf(): RefDecorPerf {
    const p = this.perf;
    const out: RefDecorPerf = {
      n: this.decor.size, live: this.work.liveCount, q: this.work.backlog, pk: p.packets, sweeps: p.sweeps,
      msPerSweep: p.sweeps ? Math.round((p.ms * 100) / p.sweeps) / 100 : 0, maxMs: p.maxMs, visits: p.visits, applied: p.applied,
    };
    this.perf = { packets: 0, sweeps: 0, ms: 0, maxMs: 0, visits: 0, applied: 0 };
    return out;
  }

  // A save load resets every engine lock and display name, so every ref is applied again wherever it is
  private onGameLoad(): void {
    this.applied.clear();
    this.loadedTicks.clear();
    this.hot.clear();
    this.work.reset();
    this.decor.forEach((_d, refId) => this.work.markDirty(refId));
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
    this.perf.packets++;
    const full = content["full"] === true;
    // Full syncs replace the set: refs we decorated that are gone from the
    // sync (abandoned claims) get a synthetic unlock entry so they revert.
    if (full) {
      const incoming = new Set((content["refs"] as any[]).map((r) => Number(r?.refId) >>> 0));
      this.decor.forEach((_d, refId) => {
        if (!incoming.has(refId)) {
          this.decor.set(refId, { refId, name: null, locked: false });
          this.work.markDirty(refId);
        }
      });
    }
    logTrace(this, `sync:`, (content["refs"] as any[]).length, `refs`);
    for (const raw of content["refs"] as any[]) {
      const refId = Number(raw?.refId) >>> 0;
      if (!refId) {
        continue;
      }
      const next: RefDecor = { refId, name: typeof raw.name === "string" && raw.name ? raw.name : null, locked: raw.locked === true };
      const prev = this.decor.get(refId);
      // A full sync repeats every claim; only the ones that differ need work
      if (full && prev && prev.name === next.name && prev.locked === next.locked) {
        continue;
      }
      this.decor.set(refId, next);
      this.applied.delete(refId);
      this.work.markDirty(refId);
    }
  }

  private onUpdate(): void {
    if (this.decor.size === 0) {
      return;
    }
    this.work.tick(() => Array.from(this.decor.keys()));
    const stats: ApplyStats = { names: 0, locks: 0, errors: 0, notLoaded: 0, firstError: "" };
    const t0 = Date.now();
    const visits = runBudget(this.work, (refId, kind) => this.visit(refId, kind, stats), Date.now);
    if (!visits) {
      return;
    }
    const ms = Date.now() - t0;
    this.perf.sweeps++;
    this.perf.ms += ms;
    this.perf.visits += visits;
    if (ms > this.perf.maxMs) this.perf.maxMs = ms;
    if (stats.names || stats.locks || stats.errors) {
      logTrace(this, `applied names=${stats.names} locks=${stats.locks} errors=${stats.errors} notloaded=${stats.notLoaded}${stats.firstError ? " | " + stats.firstError : ""}`);
    }
  }

  // Server changes apply wherever the ref resolves; otherwise only refs in loaded 3D, which skips every unattached cell
  private visit(refId: number, kind: VisitKind, stats: ApplyStats): void {
    const d = this.decor.get(refId);
    if (!d) {
      this.work.forget(refId);
      return;
    }
    const where = this.locate(refId);
    this.work.seen(refId, where === "loaded");
    if (where !== "loaded") {
      this.loadedTicks.delete(refId);
    }
    if (where === "gone") {
      stats.notLoaded++;
      this.hot.delete(refId);
      return;
    }
    if ((where === "loaded" || kind === "dirty") && this.work.mayApply(refId, kind)) {
      this.perf.applied++;
      this.apply(d, stats);
    }
  }

  private locate(refId: number): "gone" | "far" | "loaded" {
    try {
      const localId = remoteIdToLocalId(refId);
      if (!localId) {
        return "gone";
      }
      const refr = ObjectReference.from(this.sp.Game.getFormEx(localId));
      if (!refr) {
        return "gone";
      }
      return refr.is3DLoaded() ? "loaded" : "far";
    } catch (e) {
      return "gone";
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
  // apply()'s own record of refs that resolved; scheduling uses work instead
  private hot = new Set<number>();
  private work = new DecorWork();
  private applied = new Map<number, { name?: string }>();
  private loadedTicks = new Map<number, number>();
  private perf = { packets: 0, sweeps: 0, ms: 0, maxMs: 0, visits: 0, applied: 0 };
}
