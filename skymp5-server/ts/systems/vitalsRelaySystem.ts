import { System, Log, SystemContext } from "./system";
import { userOf } from "./actorUtil";

// The ScampServer / `mp` API is untyped here, same convention as spawn.ts.
type Mp = any;

// Mirrors each player's stamina and magicka onto their clones on neighbouring clients.
// Movement carries health only; the server already holds all three from the owner's ChangeValues.
//   Server -> Client: { customPacketType: "dboVitals", v: [actorId, stamina%, magicka%, ...] }
// A recipient hears a neighbour on first sight, then on a change of STEP points or on reaching empty or full.

const TICK_MS = 500;
const STEP = 5;
// The server's grid square (WorldState GetGridPos truncates toward zero): players in one square share their 3x3 block of
// neighbours, so actorNeighbors is read once per occupied square
const GRID_UNITS = 4096;

interface Sent {
  stamina: number;
  magicka: number;
  seen: number;
}

export class VitalsRelaySystem implements System {
  systemName = "VitalsRelaySystem";
  constructor(private log: Log) { }

  // source -> recipient -> values last sent, pruned once the pair is out of range. Number keys: a string key per pair
  // was most of this system's cost at 500 crowded players (CPU profile 19 Oct: ~95 ms a run, twice a second)
  private sent = new Map<number, Map<number, Sent>>();
  private tick = 0;

  async initAsync(): Promise<void> {
    this.log(`VitalsRelaySystem: stamina/magicka to neighbours every ${TICK_MS} ms on a ${STEP} point change`);
  }

  async updateAsync(ctx: SystemContext): Promise<void> {
    await new Promise((r) => setTimeout(r, TICK_MS));
    const mp = ctx.svr as Mp;
    let online: number[] = [];
    try { online = mp.get(0, "onlinePlayers") ?? []; } catch { return; }
    const tick = ++this.tick;
    const players = new Set(online.map((id) => Number(id) >>> 0));
    const packets = new Map<number, number[]>();
    // Players near each square's players, read and filtered once per square
    const nearBySquare = new Map<string, number[]>();

    for (const source of players) {
      let stamina: number, magicka: number, near: number[] | undefined;
      try {
        const p = mp.get(source, "percentages");
        stamina = toPercent(p?.stamina);
        magicka = toPercent(p?.magicka);
        const pos = mp.get(source, "pos");
        const square = `${mp.get(source, "worldOrCellDesc")}|${Math.trunc(pos[0] / GRID_UNITS)}|${Math.trunc(pos[1] / GRID_UNITS)}`;
        near = nearBySquare.get(square);
        if (!near) {
          const all: unknown[] = mp.get(source, "actorNeighbors") ?? [];
          near = [];
          for (const raw of all) {
            const id = Number(raw) >>> 0;
            if (players.has(id)) near.push(id);
          }
          nearBySquare.set(square, near);
        }
      } catch { continue; }
      let toRecipients = this.sent.get(source);
      if (!toRecipients) this.sent.set(source, (toRecipients = new Map()));
      for (const recipient of near) {
        if (recipient === source) continue;
        const prev = toRecipients.get(recipient);
        if (prev) {
          prev.seen = tick;
          if (!changed(prev.stamina, stamina) && !changed(prev.magicka, magicka)) continue;
          prev.stamina = stamina;
          prev.magicka = magicka;
        } else {
          toRecipients.set(recipient, { stamina, magicka, seen: tick });
        }
        const v = packets.get(recipient);
        if (v) v.push(source, stamina, magicka);
        else packets.set(recipient, [source, stamina, magicka]);
      }
    }

    for (const [source, toRecipients] of this.sent) {
      if (!players.has(source)) { this.sent.delete(source); continue; }
      for (const [recipient, s] of toRecipients) {
        if (s.seen !== tick) toRecipients.delete(recipient);
      }
    }
    for (const [recipient, v] of packets) {
      const user = userOf(mp, recipient);
      if (user < 0) continue;
      try { mp.sendCustomPacket(user, JSON.stringify({ customPacketType: "dboVitals", v })); } catch { }
    }
  }
}

const toPercent = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 100))) : 100;
};

const changed = (last: number, now: number): boolean =>
  last !== now && (Math.abs(now - last) >= STEP || now === 0 || now === 100);
