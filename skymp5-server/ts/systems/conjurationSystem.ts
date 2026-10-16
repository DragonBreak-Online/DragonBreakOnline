import { Settings } from "../settings";
import { System, Log, SystemContext } from "./system";
import { CompanionSystem } from "./companionSystem";
import { spellEffects, SpellEffect, MgefArchetype, npcLevel, keywordConditionsPass, turnsToAsh, pickSummon, explosionPlacedNpc, NORD_RACE } from "./espmMagic";
import { isPlayerActor, isNear, baseIdOf, hex } from "./actorUtil";

// The ScampServer / `mp` API is untyped here, same convention as spawn.ts.
type Mp = any;

// Server-side Conjuration fed by the onSpellCast / onSpellHit gamemode events (ActionListener.cpp):
// SummonCreature spells place a summon, Reanimate spells raise a dead NPC within the level cap, Banish sends a summoned daedra away,
// Command Daedra takes another player's summoned daedra over, an explosion that places an NPC (Conjure Ash Guardian) places a summon.

// Effects lasting this long are "until killed" (the Thralls)
const PERMANENT_SEC = 1e7;
const REANIMATE_RANGE = 4096;
const REANIMATE_LIFT = 16;
// A cast whose hit on a corpse never arrives picks the nearest valid corpse in front of the caster
const REANIMATE_FALLBACK_MS = 1500;
const REANIMATE_FALLBACK_RANGE = 2048;
const REANIMATE_FALLBACK_CONE_DEG = 20;
// A hit that arrives before its cast already handled that cast
const REANIMATE_HIT_FIRST_MS = 1000;
// One refusal notice per caster this often, and the user id getUserByActor reports for none (Networking::InvalidUserId)
const REFUSAL_NOTICE_MS = 3000;
const INVALID_USER_ID = 65535;
// A cast whose explosion hits no actor places its summon in front of the caster after this long
const PLACE_FALLBACK_MS = 1500;
const PLACE_HIT_FIRST_MS = 1000;
const PLACE_LIFT = 16;

interface PendingPlace {
  spellId: number;
  baseId: number;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingReanimate {
  spellId: number;
  effect: SpellEffect;
  timer: ReturnType<typeof setTimeout>;
}

export class ConjurationSystem implements System {
  systemName = "ConjurationSystem";
  constructor(private log: Log, private companions: CompanionSystem) { }

  private mp: Mp = null;
  private pending = new Map<number, PendingReanimate>();
  private lastReanimateHit = new Map<number, number>();
  private lastRefusalNotice = new Map<number, number>();
  // server-settings "commandDaedraEnabled"
  private commandDaedraOn = true;
  // server-settings "explosionSummonEnabled", and "explosionSummonSeconds" (0: until killed, as vanilla's Ash Guardian)
  private explosionSummonOn = true;
  private explosionSummonSec = 0;
  // server-settings "summonRaceVariants": Summon Skeleton conjures the caster race's own skeleton. Off by default: the
  // Khajiit, Argonian, Elf and Orc skeletons (ISS_BeastSkeletonRace) use Issgard\actors\BeastSkeletons meshes that no
  // launcher archive ships, so they never load on a client (#bugs 15 Oct "Summon Skeleton is not working": 5 of 5 Elf
  // skeletons for an elf caster never loaded, every other summon base did). Off, every caster gets the human skeleton.
  private summonRaceVariants = false;
  private pendingPlace = new Map<number, PendingPlace>();
  private lastPlaceHit = new Map<number, number>();

  async initAsync(ctx: SystemContext): Promise<void> {
    this.mp = ctx.svr as Mp;
    const all = (await Settings.get()).allSettings as Record<string, unknown> | null;
    this.commandDaedraOn = all?.["commandDaedraEnabled"] !== false;
    this.explosionSummonOn = all?.["explosionSummonEnabled"] !== false;
    this.summonRaceVariants = all?.["summonRaceVariants"] === true;
    const placeSec = Number(all?.["explosionSummonSeconds"]);
    if (Number.isFinite(placeSec) && placeSec > 0) this.explosionSummonSec = placeSec;
    this.hook("onSpellCast", (casterId, spellId) => this.onSpellCast(casterId, spellId));
    this.hook("onSpellHit", (aggressorId, targetId, spellId) => this.onSpellHit(aggressorId, targetId, spellId));
  }

  disconnect(userId: number, ctx: SystemContext): void {
    let actorId = 0;
    try { actorId = ctx.svr.getUserActor(userId) >>> 0; } catch { return; }
    this.clearPending(actorId);
    this.clearPlace(actorId);
    this.lastReanimateHit.delete(actorId);
    this.lastPlaceHit.delete(actorId);
    this.lastRefusalNotice.delete(actorId);
  }

  // Handlers run after the native event returns: they may destroy the hit target, which the C++ hit path still uses
  private hook(event: string, handler: (...ids: number[]) => void): void {
    const mp = this.mp;
    const previous = typeof mp[event] === "function" ? mp[event] : null;
    mp[event] = (...args: unknown[]) => {
      const ids = args.map((x) => Number(x) >>> 0);
      setImmediate(() => {
        try {
          handler(...ids);
        } catch (e) {
          this.log(`ConjurationSystem: ${event} failed: ${e}`);
        }
      });
      if (!previous) return true;
      try {
        return previous.apply(mp, args) !== false;
      } catch {
        return true;
      }
    };
  }

  private onSpellCast(casterId: number, spellId: number): void {
    if (!isPlayerActor(this.mp, casterId)) return;
    const effects = spellEffects(this.mp, spellId);
    // The first summon effect is the unperked one; perk conditions are not evaluated server-side. A spell with one summon
    // per caster race (Summon Skeleton) conjures the caster's (pickSummon)
    const summons = effects.filter((e) => e.archetype === MgefArchetype.SummonCreature && e.assocId);
    const pick = pickSummon(summons, () => (this.summonRaceVariants ? this.casterRace(casterId) : NORD_RACE));
    if (pick) {
      this.companions.spawn(casterId, pick.effect.assocId, { kind: "summon", durationSec: this.duration(pick.timed, casterId, "summon"), source: spellId });
      return;
    }
    const placed = this.placedNpc(spellId, effects);
    if (placed) {
      if (Date.now() - (this.lastPlaceHit.get(casterId) ?? 0) <= PLACE_HIT_FIRST_MS) return;
      this.clearPlace(casterId);
      const timer = setTimeout(() => this.placeFallback(casterId), PLACE_FALLBACK_MS);
      this.pendingPlace.set(casterId, { spellId, baseId: placed, timer });
      return;
    }
    const reanimate = effects.find((e) => e.archetype === MgefArchetype.Reanimate);
    if (reanimate && Date.now() - (this.lastReanimateHit.get(casterId) ?? 0) > REANIMATE_HIT_FIRST_MS) {
      this.clearPending(casterId);
      const timer = setTimeout(() => this.reanimateFallback(casterId), REANIMATE_FALLBACK_MS);
      this.pending.set(casterId, { spellId, effect: reanimate, timer });
    }
  }

  private onSpellHit(aggressorId: number, targetId: number, spellId: number): void {
    const placed = this.placedNpc(spellId, spellEffects(this.mp, spellId));
    if (placed && isPlayerActor(this.mp, aggressorId)) this.placeAtHit(aggressorId, targetId, spellId, placed);
    for (const effect of spellEffects(this.mp, spellId)) {
      if (effect.archetype === MgefArchetype.Banish) {
        this.banish(aggressorId, targetId, spellId, effect);
      } else if (effect.archetype === MgefArchetype.Reanimate && isPlayerActor(this.mp, aggressorId)) {
        this.clearPending(aggressorId);
        this.lastReanimateHit.set(aggressorId, Date.now());
        const refusal = this.reanimateRefusal(aggressorId, targetId, effect);
        if (refusal) {
          this.log(`ConjurationSystem: ${hex(aggressorId)} cannot reanimate ${hex(targetId)} with ${hex(spellId)}: ${refusal}`);
          this.tellRefusal(aggressorId, refusal);
        } else this.reanimate(aggressorId, targetId, spellId, effect);
      } else if (effect.archetype === MgefArchetype.CommandSummoned && this.commandDaedraOn && isPlayerActor(this.mp, aggressorId)) {
        this.command(aggressorId, targetId, spellId, effect);
      }
    }
  }

  private casterRace(casterId: number): number {
    try {
      return Number(this.mp.get(casterId, "appearance")?.raceId) >>> 0;
    } catch {
      return 0;
    }
  }

  // The gameplay may lengthen a player's summon by the caster's Conjuration rank (server gamemode.js summonBuff)
  private duration(effect: SpellEffect, casterId = 0, kind = ""): number {
    if (effect.durationSec >= PERMANENT_SEC) return 0;
    let mult = 1;
    try {
      const f = (globalThis as any).__dboSummonDurationMult;
      if (casterId && typeof f === "function") mult = Number(f(casterId, kind));
    } catch { mult = 1; }
    return Number.isFinite(mult) && mult >= 1 && mult <= 10 ? effect.durationSec * mult : effect.durationSec;
  }

  private clearPending(casterId: number): void {
    const p = this.pending.get(casterId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(casterId);
  }

  // The caster hears why a body they could see rise did not; a living target or one out of reach stays silent, as in vanilla
  private tellRefusal(casterId: number, refusal: string): void {
    const text = refusal.startsWith("level ") ? "That body is too powerful for this spell to raise."
      : refusal === "a player body" ? "The bodies of other adventurers cannot be raised."
      : refusal === "a companion" ? "That body is already bound to another's will." : "";
    const now = Date.now();
    if (!text || now - (this.lastRefusalNotice.get(casterId) ?? 0) < REFUSAL_NOTICE_MS) return;
    this.lastRefusalNotice.set(casterId, now);
    try {
      const userId = this.mp.getUserByActor(casterId);
      if (userId >= 0 && userId < INVALID_USER_ID) this.mp.sendCustomPacket(userId, JSON.stringify({ customPacketType: "notification", text }));
    } catch { /* offline */ }
  }

  // Empty when the corpse can be raised; player bodies, companions and their bodies never can
  private reanimateRefusal(casterId: number, corpseId: number, effect: SpellEffect): string {
    const mp = this.mp;
    let dead = false;
    try { dead = mp.get(corpseId, "isDead") === true; } catch { return "not an actor"; }
    if (!dead) return "not dead";
    // A plugin-placed actor cannot be destroyed (the world loads it again with its items), so only server-placed corpses rise
    if (corpseId < 0xff000000) return "a plugin-placed NPC";
    if (isPlayerActor(mp, corpseId)) return "a player body";
    if (this.companions.isCompanionActor(corpseId)) return "a companion";
    if (!isNear(mp, casterId, corpseId, REANIMATE_RANGE)) return "out of range";
    if (!keywordConditionsPass(mp, effect.mgefId, corpseId)) return "keyword conditions";
    const level = npcLevel(mp, corpseId);
    if (level > effect.magnitude) return `level ${level} over ${effect.magnitude}`;
    return "";
  }

  // A fresh actor of the corpse's base takes its place and inventory, so the old hoster and the zone spawner let go of it
  private reanimate(casterId: number, corpseId: number, spellId: number, effect: SpellEffect): void {
    const mp = this.mp;
    let loc: { pos: number[]; rot: number[] };
    let inventory: unknown;
    try {
      loc = mp.get(corpseId, "locationalData");
      inventory = mp.get(corpseId, "inventory");
    } catch {
      return;
    }
    const pos = [loc.pos[0], loc.pos[1], loc.pos[2] + REANIMATE_LIFT];
    const id = this.companions.spawn(casterId, baseIdOf(mp, corpseId),
      { kind: "reanimated", pos, rot: loc.rot, durationSec: this.duration(effect, casterId, "reanimated"), source: spellId, ashPile: turnsToAsh(mp, spellId) });
    if (id === null) return;
    try { mp.set(id, "inventory", inventory); } catch (e) { this.log(`ConjurationSystem: inventory copy to ${hex(id)} failed: ${e}`); }
    try { mp.destroyActor(corpseId); } catch { }
    this.log(`ConjurationSystem: ${hex(casterId)} reanimated ${hex(corpseId)} as ${hex(id)}`);
  }

  private reanimateFallback(casterId: number): void {
    const p = this.pending.get(casterId);
    if (!p) return;
    this.pending.delete(casterId);
    const mp = this.mp;
    let neighbors: number[] = [];
    let origin: number[];
    let heading = 0;
    try {
      neighbors = mp.get(casterId, "actorNeighbors") ?? [];
      origin = mp.getActorPos(casterId);
      heading = ((Number(mp.get(casterId, "angle")?.[2]) || 0) * Math.PI) / 180;
    } catch {
      return;
    }
    let best = 0;
    let bestDistance = REANIMATE_FALLBACK_RANGE;
    for (const raw of neighbors) {
      const id = Number(raw) >>> 0;
      let q: number[];
      try { q = mp.getActorPos(id); } catch { continue; }
      const dx = q[0] - origin[0], dy = q[1] - origin[1];
      const distance = Math.hypot(dx, dy);
      if (distance >= bestDistance) continue;
      const off = Math.atan2(Math.sin(Math.atan2(dx, dy) - heading), Math.cos(Math.atan2(dx, dy) - heading));
      if (Math.abs(off) * (180 / Math.PI) > REANIMATE_FALLBACK_CONE_DEG) continue;
      if (this.reanimateRefusal(casterId, id, p.effect)) continue;
      best = id;
      bestDistance = distance;
    }
    if (best) this.reanimate(casterId, best, p.spellId, p.effect);
  }

  // Vanilla Banish: a summoned daedra whose level is within the magnitude returns to Oblivion
  private banish(casterId: number, targetId: number, spellId: number, effect: SpellEffect): void {
    const info = this.companions.info(targetId);
    if (!info || info.kind !== "summon") return;
    if (!keywordConditionsPass(this.mp, effect.mgefId, targetId)) return;
    if (npcLevel(this.mp, targetId) > effect.magnitude) return;
    this.companions.dismiss(targetId, `banished by ${hex(casterId)} with ${hex(spellId)}`);
  }

  // Vanilla Command Daedra: another's summoned daedra within the magnitude's level serves the caster for the effect's duration
  // (0: the rest of its life); another player's only while the PvP rules let the caster fight them
  private command(casterId: number, targetId: number, spellId: number, effect: SpellEffect): void {
    const info = this.companions.info(targetId);
    if (!info || info.kind !== "summon" || info.ownerId === casterId) return;
    if (!keywordConditionsPass(this.mp, effect.mgefId, targetId)) return;
    const level = npcLevel(this.mp, targetId);
    if (level > effect.magnitude) {
      this.log(`ConjurationSystem: ${hex(casterId)} cannot command ${hex(targetId)}: level ${level} over ${effect.magnitude}`);
      return;
    }
    const side = this.companions.playerSideOf(targetId);
    if (side && !this.companions.mayFightPlayer(casterId, side)) {
      this.log(`ConjurationSystem: ${hex(casterId)} cannot command ${hex(targetId)} of ${hex(side)}: PvP not allowed`);
      return;
    }
    if (this.companions.command(targetId, casterId, this.duration(effect))) {
      this.log(`ConjurationSystem: ${hex(casterId)} commands ${hex(targetId)} with ${hex(spellId)}`);
    }
  }

  // The NPC_ the spell's explosion places in the caster's own game only, which the server places for everyone instead
  private placedNpc(spellId: number, effects: SpellEffect[]): number {
    if (!this.explosionSummonOn) return 0;
    for (const e of effects) {
      const id = explosionPlacedNpc(this.mp, e.mgefId);
      // A spell's only: Dragonborn's spider scrolls place their spiders through the same chain
      if (id) return this.isSpell(spellId) ? id : 0;
    }
    return 0;
  }

  private isSpell(spellId: number): boolean {
    try { return this.mp.lookupEspmRecordById(spellId)?.record?.type === "SPEL"; } catch { return false; }
  }

  private clearPlace(casterId: number): void {
    const p = this.pendingPlace.get(casterId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pendingPlace.delete(casterId);
  }

  // The first actor the explosion hits marks where it went off; the rest of the same blast place nothing
  private placeAtHit(casterId: number, targetId: number, spellId: number, baseId: number): void {
    const now = Date.now();
    const pending = this.pendingPlace.has(casterId);
    if (!pending && now - (this.lastPlaceHit.get(casterId) ?? 0) <= PLACE_HIT_FIRST_MS) return;
    this.clearPlace(casterId);
    this.lastPlaceHit.set(casterId, now);
    let pos: number[] | undefined;
    try {
      const p = this.mp.getActorPos(targetId);
      if (Array.isArray(p) && isNear(this.mp, casterId, targetId, REANIMATE_RANGE)) pos = [p[0], p[1], p[2] + PLACE_LIFT];
    } catch { }
    this.placeSummon(casterId, baseId, spellId, pos);
  }

  private placeFallback(casterId: number): void {
    const p = this.pendingPlace.get(casterId);
    if (!p) return;
    this.pendingPlace.delete(casterId);
    this.placeSummon(casterId, p.baseId, p.spellId);
  }

  // It guards where it was placed until ordered to follow
  private placeSummon(casterId: number, baseId: number, spellId: number, pos?: number[]): void {
    const id = this.companions.spawn(casterId, baseId, { kind: "summon", pos, durationSec: this.explosionSummonSec, source: spellId });
    if (id === null) return;
    this.companions.orderStay(id);
    this.log(`ConjurationSystem: ${hex(casterId)} placed ${hex(id)} with ${hex(spellId)}${pos ? " where it hit" : " in front of them"}`);
  }
}
