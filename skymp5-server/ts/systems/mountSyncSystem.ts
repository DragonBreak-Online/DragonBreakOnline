import { System, Log, SystemContext, Content } from "./system";
import { baseIdOf, hex, isAlive, isNear, isPlayerActor, userOf } from "./actorUtil";
import { readFormIdField, toFormId } from "./formIdUtil";

// The ScampServer / `mp` API is untyped here, same convention as spawn.ts.
type Mp = any;

// Horse riding sync (_work/horse-sync-1108). Movement has no rider field and the binary wire is positional, so the
// rider state travels as relay packets. The rider's client reports its own mount and dismount from the engine; the
// server checks the report, makes the rider the horse's only host while it rides (so the horse's movement reaches the
// server and everyone else like a hosted NPC's), and tells each neighbour who rides what.
//   Client -> Server: { customPacketType: "dboRide", op: "mounted", horse } | { op: "dismounted" }
//   Server -> rider:  { customPacketType: "dboRide", op: "ride", horse }: E on a horse it may ride, mount it
//                     { customPacketType: "dboRide", op: "refused", horse, reason }: get off, or stay off
//                     { customPacketType: "dboRide", op: "ended", horse, reason }: the server ended the ride
//   Server -> others: { customPacketType: "dboRiders", on: [rider, horse, ...], off: [rider, ...] }
// The gameplay may decide ownership with globalThis.__dboMountMayRide(rider, horse): true, or the refusal to show.

const TICK_MS = 250;
// The engine seats the rider on the horse, so a report this far from it is not a mount
export const MOUNT_REACH = 512;
// A rider this far from the horse, or in another cell, was moved off it (teleport, load door)
export const RIDE_GAP = 1024;
// A ride order the client has not acted on is forgotten after this
export const PENDING_MS = 5000;
const REHOST_MS = 2000;

interface Ride {
  horse: number;
  since: number;
  rehostAt: number;
}

interface Pending {
  horse: number;
  at: number;
}

const rides = new Map<number, Ride>();
const pending = new Map<number, Pending>();

const riderOf = (horse: number): number => {
  for (const [rider, r] of rides) if (r.horse === horse) return rider;
  return 0;
};

const reservedFor = (horse: number): number => {
  const rider = riderOf(horse);
  if (rider) return rider;
  for (const [r, p] of pending) if (p.horse === horse) return r;
  return 0;
};

export const isRidden = (horse: number): boolean => riderOf(horse >>> 0) !== 0;
export const horseOf = (rider: number): number => rides.get(rider >>> 0)?.horse ?? 0;

export class MountSyncSystem implements System {
  systemName = "MountSyncSystem";
  constructor(private log: Log) { }

  // recipient -> rider -> horse it was last told
  private told = new Map<number, Map<number, number>>();
  private horseRaces = new Map<number, boolean>();
  private mp: Mp = null;

  async initAsync(ctx: SystemContext): Promise<void> {
    this.mp = ctx.svr as Mp;
    rides.clear();
    pending.clear();
    this.installHooks();
    (globalThis as any).__dboRides = {
      horseOf: (rider: unknown) => horseOf(Number(rider) >>> 0),
      riderOf: (horse: unknown) => riderOf(Number(horse) >>> 0),
    };
    this.log(`MountSyncSystem: riders relayed every ${TICK_MS} ms, a ride ends ${RIDE_GAP} units from its horse`);
  }

  async updateAsync(ctx: SystemContext): Promise<void> {
    await new Promise((r) => setTimeout(r, TICK_MS));
    this.tick(ctx.svr as Mp, Date.now());
  }

  customPacket(userId: number, type: string, content: Content, ctx: SystemContext): void {
    if (type !== "dboRide") return;
    const mp = ctx.svr as Mp;
    let rider = 0;
    try { rider = mp.getUserActor(userId) >>> 0; } catch { return; }
    if (!rider) return;
    if (content.op === "mounted") this.onMounted(mp, rider, toFormId(content.horse));
    else if (content.op === "dismounted") this.end(mp, rider, "dismounted", false);
  }

  disconnect(userId: number, ctx: SystemContext): void {
    let rider = 0;
    try { rider = ctx.svr.getUserActor(userId) >>> 0; } catch { return; }
    if (!rider) return;
    pending.delete(rider);
    if (rides.has(rider)) this.end(ctx.svr as Mp, rider, "left the game", false);
    this.told.delete(rider);
  }

  tick(mp: Mp, now: number): void {
    for (const [rider, p] of pending) if (now - p.at > PENDING_MS) pending.delete(rider);
    for (const [rider, ride] of Array.from(rides)) {
      const why = this.brokenRide(mp, rider, ride.horse);
      if (why) { this.end(mp, rider, why, true); continue; }
      if (now >= ride.rehostAt) {
        ride.rehostAt = now + REHOST_MS;
        this.host(mp, ride.horse, rider);
      }
    }
    this.relay(mp);
  }

  // A rider in another cell or far from its horse was moved off it; a dead horse or rider ends it too
  private brokenRide(mp: Mp, rider: number, horse: number): string {
    if (userOf(mp, rider) < 0) return "rider offline";
    if (!isAlive(mp, horse)) return "horse dead or gone";
    if (!isAlive(mp, rider)) return "rider dead";
    if (!isNear(mp, rider, horse, RIDE_GAP)) return "rider away from the horse";
    return "";
  }

  private onMounted(mp: Mp, rider: number, horse: number): void {
    const refusal = this.refusal(mp, rider, horse, MOUNT_REACH);
    if (refusal) {
      this.log(`MountSync: ${hex(rider)} mounted ${hex(horse)}, refused: ${refusal}`);
      this.sendRider(mp, rider, { op: "refused", horse, reason: refusal });
      if (rides.has(rider)) this.end(mp, rider, "mounted another", false);
      return;
    }
    if (horseOf(rider) === horse) return;
    if (rides.has(rider)) this.end(mp, rider, "mounted another", false);
    pending.delete(rider);
    rides.set(rider, { horse, since: Date.now(), rehostAt: Date.now() + REHOST_MS });
    this.host(mp, horse, rider);
    this.log(`MountSync: ${hex(rider)} rides ${hex(horse)}`);
  }

  // Empty when the rider may sit on this horse now
  private refusal(mp: Mp, rider: number, horse: number, reach: number): string {
    if (!horse || horse === rider) return "no horse";
    let type = "";
    try { type = String(mp.get(horse, "type")); } catch { type = ""; }
    if (type !== "MpActor" || isPlayerActor(mp, horse)) return "not a mount";
    if (!isAlive(mp, horse)) return "That horse is dead.";
    if (!isNear(mp, rider, horse, reach)) return "too far";
    const other = riderOf(horse);
    if (other && other !== rider) return "Someone is riding that horse.";
    return this.mayRide(rider, horse);
  }

  private mayRide(rider: number, horse: number): string {
    const hook = (globalThis as any).__dboMountMayRide;
    if (typeof hook === "function") {
      try {
        const v = hook(rider, horse);
        return v === true ? "" : typeof v === "string" && v ? v : "You cannot ride that.";
      } catch (e) {
        this.log(`MountSync: __dboMountMayRide threw: ${e}`);
        return "You cannot ride that.";
      }
    }
    const info = companionInfo(horse);
    if (info && info.ownerId >>> 0 !== rider) return "That horse is not yours.";
    return "";
  }

  // The ride order goes out with the host grant, so the horse is ours before the engine seats us
  private onActivate(mp: Mp, target: number, caster: number): boolean {
    if (!isPlayerActor(mp, caster) || userOf(mp, caster) < 0) return false;
    if (!this.isMountable(mp, target) || !isAlive(mp, target)) return false;
    // The client's own activate on the ride order comes back here
    if (horseOf(caster) === target || pending.get(caster)?.horse === target) return true;
    const refusal = this.refusal(mp, caster, target, Infinity);
    if (refusal) {
      this.sendRider(mp, caster, { op: "refused", horse: target, reason: refusal });
      return true;
    }
    pending.set(caster, { horse: target, at: Date.now() });
    this.host(mp, target, caster);
    this.sendRider(mp, caster, { op: "ride", horse: target });
    this.log(`MountSync: ${hex(caster)} may ride ${hex(target)}`);
    return true;
  }

  // A mount companion, or an actor whose race editor id says horse (as anticheat.js reads it)
  isMountable(mp: Mp, actorId: number): boolean {
    if (companionInfo(actorId)?.kind === "mount") return true;
    const base = baseIdOf(mp, actorId);
    if (!base) return false;
    const cached = this.horseRaces.get(base);
    if (cached !== undefined) return cached;
    let yes = false;
    try {
      const npc = mp.lookupEspmRecordById(base);
      if (npc?.record?.type === "NPC_" && typeof npc.toGlobalRecordId === "function") {
        const raceId = npc.toGlobalRecordId(readFormIdField(npc, "RNAM")) >>> 0;
        yes = /horse/i.test(String(mp.lookupEspmRecordById(raceId)?.record?.editorId || ""));
      }
    } catch { yes = false; }
    this.horseRaces.set(base, yes);
    return yes;
  }

  private end(mp: Mp, rider: number, reason: string, tellRider: boolean): void {
    const ride = rides.get(rider);
    if (!ride) return;
    rides.delete(rider);
    this.log(`MountSync: ${hex(rider)} off ${hex(ride.horse)}: ${reason}`);
    if (tellRider) this.sendRider(mp, rider, { op: "ended", horse: ride.horse, reason });
  }

  // Never a re-grant to the same hoster: its HostStart re-seats the horse and throws the rider off
  private host(mp: Mp, horse: number, rider: number): void {
    try { if ((mp.getHoster(horse) >>> 0) === rider) return; } catch { /* grant it */ }
    try { mp.setHoster(horse, rider); } catch (e) { this.log(`MountSync: setHoster ${hex(horse)} to ${hex(rider)} failed: ${e}`); }
  }

  private sendRider(mp: Mp, rider: number, packet: Record<string, unknown>): void {
    const user = userOf(mp, rider);
    if (user < 0) return;
    try { mp.sendCustomPacket(user, JSON.stringify({ customPacketType: "dboRide", ...packet })); } catch { }
  }

  // Each player hears a rider when it comes into view and when the ride ends; a pair out of view is told off
  private relay(mp: Mp): void {
    const want = new Map<number, Map<number, number>>();
    for (const [rider, ride] of rides) {
      let neighbors: number[] = [];
      try { neighbors = mp.get(rider, "actorNeighbors") ?? []; } catch { continue; }
      for (const raw of neighbors) {
        const n = Number(raw) >>> 0;
        if (n === rider || userOf(mp, n) < 0) continue;
        let m = want.get(n);
        if (!m) want.set(n, m = new Map());
        m.set(rider, ride.horse);
      }
    }
    const recipients = new Set<number>([...want.keys(), ...this.told.keys()]);
    for (const n of recipients) {
      const w = want.get(n) ?? new Map<number, number>();
      const t = this.told.get(n) ?? new Map<number, number>();
      const on: number[] = [];
      const off: number[] = [];
      for (const [rider, horse] of w) if (t.get(rider) !== horse) on.push(rider, horse);
      for (const rider of t.keys()) if (!w.has(rider)) off.push(rider);
      if (w.size) this.told.set(n, w); else this.told.delete(n);
      if (!on.length && !off.length) continue;
      const user = userOf(mp, n);
      if (user < 0) continue;
      try { mp.sendCustomPacket(user, JSON.stringify({ customPacketType: "dboRiders", on, off })); } catch { }
    }
  }

  private installHooks(): void {
    const mp = this.mp;
    const prevActivate = typeof mp.onActivate === "function" ? mp.onActivate : null;
    mp.onActivate = (targetId: number, casterId: number): boolean => {
      let handled = false;
      try { handled = this.onActivate(mp, targetId >>> 0, casterId >>> 0); } catch (e) { this.log(`MountSync: activate failed: ${e}`); }
      if (handled) return false;
      if (!prevActivate) return true;
      try { return prevActivate.call(mp, targetId, casterId) !== false; } catch { return true; }
    };
    const prevHost = typeof mp.onHostAttempt === "function" ? mp.onHostAttempt : null;
    mp.onHostAttempt = (requesterId: number, actorId: number): boolean => {
      const rider = reservedFor(actorId >>> 0);
      if (rider) return requesterId >>> 0 === rider;
      if (!prevHost) return true;
      try { return prevHost.call(mp, requesterId, actorId) !== false; } catch { return true; }
    };
  }
}

const companionInfo = (id: number): { ownerId: number; kind: string } | undefined => {
  try {
    const api = (globalThis as any).__dboCompanions;
    return typeof api?.info === "function" ? api.info(id >>> 0) ?? undefined : undefined;
  } catch {
    return undefined;
  }
};
