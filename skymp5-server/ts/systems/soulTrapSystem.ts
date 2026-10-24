import { System, Log, SystemContext } from "./system";
import { espmFieldFormIds, readFormIdField } from "./formIdUtil";
import { InventoryEntry } from "./inventoryExtras";

// The ScampServer / `mp` API is untyped here, same convention as spawn.ts.
type Mp = any;

// Soul Trap: a hit carrying a soul trap effect marks its target, and a death before the effect ends fills one of the caster's soul gems.
// Players have black souls, so only an empty black soul gem takes them, and a player whose soul was taken respawns once in the Soul Cairn.

const HIT_EVENT = "onPapyrusEvent:OnHit";
const TRAPPED_PROP = "private.soulTrapped";
const NOTICE_PACKET = "notification";
// getUserByActor reports failure with Networking::InvalidUserId, not -1.
const INVALID_USER_ID = 65535;
// craftedExtrasService.ts takes the server's copies of these base ids, dropping local extras the server never recorded
const RESYNC_PACKET = "craftedExtrasRefused";
// After a soul trap death: once the caster's own game has filled its gem, and again for a slow client
const RESYNC_AFTER_MS = [1500, 6000];
// Only marked actors are polled, and a respawn takes seconds.
const DEATH_POLL_MS = 100;

// MGEF archetype Soul Trap; the Soul Trap spell (SoulTrapFFActor) and weapon enchantments (EnchSoulTrapFFContact) use Script-archetype effects.
const ARCHETYPE_SOUL_TRAP = 23;
const SCRIPT_SOUL_TRAP_EFFECTS = new Set([0x0004dba3, 0x0005b452]);
// Script-archetype soul traps of other plugins, resolved by desc at init: Umbra's (Gray Fox Cowl)
const SCRIPT_SOUL_TRAP_DESCS = ["1807d:Gray Fox Cowl.esm"];
// libespm NPC_::TemplateFlags
const USE_TRAITS = 0x01;
const USE_STATS = 0x02;
const KEYWORD_ACTOR_TYPE_NPC = 0x00013794;
const KEYWORD_NO_SOUL_TRAP = 0x00103ad2;
// SLGM record flag "Can Hold NPC Soul": black soul gems and the Black Star.
const FLAG_CAN_HOLD_NPC_SOUL = 0x20000;
// ACBS flag: the level is a multiple of the player's.
const FLAG_PC_LEVEL_MULT = 0x80;
// WEAP DNAM animation type of a staff, ENCH ENIT flag "No Auto-Calc".
const ANIM_TYPE_STAFF = 8;
const ENCH_NO_AUTO_CALC = 0x1;
// craftedExtras keeps a copy run down to zero at 0.01, and clients only report charge changes of 1 or more.
const MIN_HIT_COST = 1;
// GMST iLesserSoulActorLevel, iCommonSoulActorLevel, iGreaterSoulActorLevel, iGrandSoulActorLevel.
const SOUL_ACTOR_LEVELS = [4, 16, 28, 38];
const SOUL_GRAND = 5;
// Empty vanilla gems and their filled forms; the stars and a smaller soul keep the soul as entry extra data.
const FILLED_GEMS = new Map<number, number>([
  [0x0002e4e2, 0x0002e4e3], // Petty
  [0x0002e4e4, 0x0002e4e5], // Lesser
  [0x0002e4e6, 0x0002e4f3], // Common
  [0x0002e4f4, 0x0002e4fb], // Greater
  [0x0002e4fc, 0x0002e4ff], // Grand
  [0x0002e500, 0x0002e504], // Black
]);
// Where the Castle Volkihar portal (Dawnguard.esm door 0200289B) sets the player down in DLC01SoulCairn.
const SOUL_CAIRN_ARRIVAL = {
  cellOrWorldDesc: "1408:Dawnguard.esm",
  pos: [-19965.66, -15986.51, 2079.48],
  rot: [0, 0, 77.35],
};

interface Trap {
  casterId: number;
  expiresAt: number;
}

interface Soul {
  size: number;
  black: boolean;
}

interface Gem {
  capacity: number;
  empty: boolean;
  black: boolean;
}

interface RecordEffect {
  id: number;
  magnitude: number;
  seconds: number;
  conditioned: boolean;
}

interface GemEntry {
  baseId: number;
  count: number;
  soul?: number;
  worn?: boolean;
  wornLeft?: boolean;
}

const hex = (id: number): string => (id >>> 0).toString(16);
const viewOf = (d: Uint8Array): DataView => new DataView(d.buffer, d.byteOffset, d.byteLength);

export class SoulTrapSystem implements System {
  systemName = "SoulTrapSystem";

  constructor(private log: Log, private companions?: { isCompanionActor(actorId: number): boolean }) { }

  async initAsync(ctx: SystemContext): Promise<void> {
    const mp = ctx.svr as Mp;
    for (const desc of SCRIPT_SOUL_TRAP_DESCS) {
      try {
        const id = mp.getIdFromDesc(desc) >>> 0;
        if (id) SCRIPT_SOUL_TRAP_EFFECTS.add(id);
      } catch {
        this.log(`[soultrap] ${desc} is not in the load order`);
      }
    }
    const previousHit = typeof mp[HIT_EVENT] === "function" ? mp[HIT_EVENT] : null;
    mp[HIT_EVENT] = (...args: unknown[]) => {
      try {
        // A blocked hit (abHitBlocked) applies no soul trap
        if (args[7] !== true) this.onHit(ctx, Number(args[0]) >>> 0, args[1], args[2]);
      } catch (e) {
        this.log(`[soultrap] hit check failed: ${e}`);
      }
      return previousHit ? previousHit.apply(mp, args) : undefined;
    };

    const previousRespawn = typeof mp.onRespawn === "function" ? mp.onRespawn : null;
    mp.onRespawn = (...args: unknown[]) => {
      const result = previousRespawn ? previousRespawn.apply(mp, args) : undefined;
      if (result !== false) {
        try {
          this.routeToSoulCairn(ctx, Number(args[0]) >>> 0);
        } catch (e) {
          this.log(`[soultrap] Soul Cairn respawn failed: ${e}`);
        }
      }
      return result;
    };
  }

  async updateAsync(ctx: SystemContext): Promise<void> {
    const now = Date.now();
    if (!this.traps.size || now < this.nextPollAt) return;
    this.nextPollAt = now + DEATH_POLL_MS;
    const mp = ctx.svr as Mp;
    for (const [targetId, trap] of Array.from(this.traps)) {
      let dead = false;
      try {
        dead = mp.get(targetId, "isDead") === true;
      } catch {
        this.traps.delete(targetId);
        continue;
      }
      if (dead) {
        this.traps.delete(targetId);
        try {
          this.capture(ctx, targetId, trap.casterId);
        } catch (e) {
          this.log(`[soultrap] capture of ${hex(targetId)} failed: ${e}`);
        }
      } else if (now > trap.expiresAt) {
        this.traps.delete(targetId);
      }
    }
  }

  private onHit(ctx: SystemContext, targetId: number, aggressor: unknown, source: unknown): void {
    const mp = ctx.svr as Mp;
    const sourceId = this.idOf(mp, source);
    const casterId = this.idOf(mp, aggressor);
    const seconds = this.hitTrapSeconds(ctx, casterId, sourceId);
    if (!seconds) return;
    if (!casterId || casterId === targetId) return;
    // Summons and reanimated corpses give no soul, so none can be farmed or taken twice
    if (this.companions?.isCompanionActor(targetId)) return;
    if (mp.get(targetId, "type") !== "MpActor" || mp.get(targetId, "isDead") === true) return;
    if (!this.isPlayer(mp, targetId) && this.npcKeywords(ctx, targetId).has(KEYWORD_NO_SOUL_TRAP)) return;
    // The latest soul trap on a target decides whose gem its soul goes to
    this.traps.set(targetId, { casterId, expiresAt: Date.now() + seconds * 1000 });
  }

  private capture(ctx: SystemContext, targetId: number, casterId: number): void {
    const mp = ctx.svr as Mp;
    this.resyncGems(ctx, casterId);
    const player = this.isPlayer(mp, targetId);
    const soul = this.soulOf(ctx, targetId, player);
    const gemId = this.fillGem(ctx, casterId, soul);
    const kind = soul.black ? "black" : `size ${soul.size}`;
    if (!gemId) {
      this.log(`[soultrap] ${hex(targetId)} died soul trapped by ${hex(casterId)}, no empty gem holds its ${kind} soul`);
      this.notify(ctx, casterId, soul.black ? "You do not have a black soul gem to hold this soul." : "You do not have a soul gem large enough.");
      return;
    }
    this.notify(ctx, casterId, "Soul captured!");
    if (player) {
      mp.set(targetId, TRAPPED_PROP, true);
      this.notify(ctx, targetId, "Your soul was trapped in a black soul gem.");
    }
    this.log(`[soultrap] ${hex(casterId)} trapped the ${kind} soul of ${hex(targetId)} in gem ${hex(gemId)}`);
    // The gameplay credits the capture as Enchanter work (alchemy.js); size 0 is a black soul
    try { (globalThis as any).__dboSoulCaptured?.(casterId, targetId, soul.black ? 0 : soul.size, player); } catch (e) { this.log(`[soultrap] capture hook failed: ${e}`); }
  }

  // The caster's own game runs Soul Trap too and fills a gem the server never records (24 Oct: 301 server refusals, 31 gems
  // that could not be stored or traded since). Its soul gems go back to the server's copies once the local fill has landed.
  private resyncGems(ctx: SystemContext, casterId: number): void {
    const send = () => {
      try {
        const userId = ctx.svr.getUserByActor(casterId);
        if (userId < 0 || userId >= INVALID_USER_ID) return;
        const inv = (ctx.svr as Mp).get(casterId, "inventory");
        const ids = new Set<number>([...FILLED_GEMS.keys(), ...FILLED_GEMS.values()]);
        for (const e of (inv && Array.isArray(inv.entries) ? inv.entries : [])) {
          const id = Number(e.baseId) >>> 0;
          if (this.gemOf(ctx, id)) ids.add(id);
        }
        ctx.svr.sendCustomPacket(userId, JSON.stringify({ customPacketType: RESYNC_PACKET, baseIds: Array.from(ids) }));
      } catch { /* offline */ }
    };
    for (const ms of RESYNC_AFTER_MS) setTimeout(send, ms);
  }

  // The engine reads the respawn point right after this hook, so the Soul Cairn stands in for this one respawn only
  private routeToSoulCairn(ctx: SystemContext, actorId: number): void {
    const mp = ctx.svr as Mp;
    if (mp.get(actorId, TRAPPED_PROP) !== true) return;
    mp.set(actorId, TRAPPED_PROP, false);
    const home = mp.get(actorId, "spawnPoint");
    mp.set(actorId, "spawnPoint", SOUL_CAIRN_ARRIVAL);
    setTimeout(() => {
      try {
        mp.set(actorId, "spawnPoint", home);
      } catch (e) {
        this.log(`[soultrap] restoring the spawn point of ${hex(actorId)} failed: ${e}`);
      }
    }, 0);
    this.log(`[soultrap] ${hex(actorId)} respawns in the Soul Cairn`);
  }

  // Smallest empty gem that holds the soul: black souls need a gem that can hold NPC souls, white souls a regular one
  private fillGem(ctx: SystemContext, casterId: number, soul: Soul): number {
    const mp = ctx.svr as Mp;
    let entries: GemEntry[];
    try {
      const inv = mp.get(casterId, "inventory");
      entries = (inv && Array.isArray(inv.entries) ? inv.entries : []).map((e: GemEntry) => ({ ...e }));
    } catch {
      return 0;
    }
    let best: GemEntry | null = null;
    let bestRank = Infinity;
    for (const e of entries) {
      if ((Number(e.count) || 0) <= 0 || e.soul) continue;
      const gem = this.gemOf(ctx, Number(e.baseId) >>> 0);
      if (!gem || !gem.empty || gem.black !== soul.black || gem.capacity < soul.size) continue;
      // Ties go to a regular gem so the reusable stars stay free
      const rank = gem.capacity * 2 + (FILLED_GEMS.has(Number(e.baseId) >>> 0) ? 0 : 1);
      if (rank < bestRank) {
        best = e;
        bestRank = rank;
      }
    }
    if (!best) return 0;

    const baseId = Number(best.baseId) >>> 0;
    best.count -= 1;
    const filledId = soul.size === this.gemOf(ctx, baseId)?.capacity ? FILLED_GEMS.get(baseId) : undefined;
    const filled: GemEntry = filledId ? { baseId: filledId, count: 1 } : { baseId, count: 1, soul: soul.size };
    const stack = entries.find((e) => (Number(e.baseId) >>> 0) === filled.baseId && (e.soul || 0) === (filled.soul || 0) &&
      e.count > 0 && !e.worn && !e.wornLeft);
    if (stack) stack.count += 1;
    else entries.push(filled);
    try {
      mp.set(casterId, "inventory", { entries: entries.filter((e) => e.count > 0) });
    } catch {
      return 0;
    }
    return filled.baseId;
  }

  private soulOf(ctx: SystemContext, actorId: number, player: boolean): Soul {
    if (player || this.npcKeywords(ctx, actorId).has(KEYWORD_ACTOR_TYPE_NPC)) return { size: SOUL_GRAND, black: true };
    const level = this.levelOf(ctx, actorId);
    return { size: 1 + SOUL_ACTOR_LEVELS.filter((l) => level >= l).length, black: false };
  }

  // ACBS level; a level relative to the player counts at its minimum since there is no single player to scale by
  private levelOf(ctx: SystemContext, actorId: number): number {
    const acbs = this.fieldData(this.templateNpc(ctx, actorId, USE_STATS), "ACBS");
    if (!acbs || acbs.byteLength < 12) return 1;
    const view = viewOf(acbs);
    return view.getUint32(0, true) & FLAG_PC_LEVEL_MULT ? Math.max(1, view.getUint16(10, true)) : view.getUint16(8, true);
  }

  // Keywords of the actor's NPC_ records and of the race its traits come from
  private npcKeywords(ctx: SystemContext, actorId: number): Set<number> {
    const out = new Set<number>();
    for (const id of this.templateChain(ctx.svr as Mp, actorId)) {
      for (const k of this.keywordsOf(ctx, id)) out.add(k);
    }
    const traits = this.templateNpc(ctx, actorId, USE_TRAITS);
    const raceId = traits ? espmFieldFormIds(traits, "RNAM")[0] || 0 : 0;
    for (const k of this.keywordsOf(ctx, raceId)) out.add(k);
    return out;
  }

  // The chain the server rolled for the actor (see EvaluateTemplate), or its base alone
  private templateChain(mp: Mp, actorId: number): number[] {
    try {
      const tpl = mp.get(actorId, "templateChain");
      if (Array.isArray(tpl) && tpl.length) return tpl.map((id) => Number(id) >>> 0);
    } catch { /* not an actor */ }
    try {
      return [mp.getIdFromDesc(String(mp.get(actorId, "baseDesc"))) >>> 0];
    } catch {
      return [];
    }
  }

  // First NPC_ in the chain that supplies the data a template flag covers
  private templateNpc(ctx: SystemContext, actorId: number, flag: number): any {
    for (const id of this.templateChain(ctx.svr as Mp, actorId)) {
      const res = this.lookup(ctx, id);
      if (!res || res.record.type !== "NPC_") return null;
      const acbs = this.fieldData(res, "ACBS");
      const templateFlags = acbs && acbs.byteLength >= 20 ? viewOf(acbs).getUint16(18, true) : 0;
      if (!readFormIdField(res, "TPLT") || !(templateFlags & flag)) return res;
    }
    return null;
  }

  // Longest unconditioned soul trap effect a hit applies: a spell, scroll, enchantment or a weapon's base enchantment
  private trapSeconds(ctx: SystemContext, sourceId: number): number {
    if (!sourceId) return 0;
    const hit = this.trapSecondsCache.get(sourceId);
    if (hit !== undefined) return hit;
    let seconds = 0;
    for (const e of this.recordEffects(ctx, sourceId)) {
      if (!e.conditioned && this.isSoulTrapEffect(ctx, e.id)) seconds = Math.max(seconds, e.seconds);
    }
    this.trapSecondsCache.set(sourceId, seconds);
    return seconds;
  }

  // Effects of a spell, scroll or enchantment record, or of a weapon's base enchantment
  private recordEffects(ctx: SystemContext, sourceId: number): RecordEffect[] {
    let res = this.lookup(ctx, sourceId);
    if (res && res.record.type === "WEAP") res = this.lookup(ctx, espmFieldFormIds(res, "EITM")[0] || 0);
    const effects: RecordEffect[] = [];
    if (!res || !["SPEL", "SCRL", "ENCH"].includes(String(res.record.type))) return effects;
    for (const f of res.record.fields || []) {
      if (!(f.data instanceof Uint8Array)) continue;
      const current = effects[effects.length - 1];
      if (f.type === "EFID" && f.data.byteLength >= 4) {
        let id = 0;
        try { id = res.toGlobalRecordId(viewOf(f.data).getUint32(0, true)) >>> 0; } catch { /* unmapped master */ }
        effects.push({ id, magnitude: 0, seconds: 0, conditioned: false });
      } else if (f.type === "EFIT" && current && f.data.byteLength >= 12) {
        current.magnitude = viewOf(f.data).getFloat32(0, true);
        current.seconds = viewOf(f.data).getUint32(8, true);
      } else if (f.type === "CTDA" && current) {
        // Conditions (the Soul Stealer perk on bound weapons) are not evaluated server-side
        current.conditioned = true;
      }
    }
    return effects;
  }

  // A player's weapon casts its enchantment only while the copy used has a hit's worth of charge; NPC weapons never run dry
  private hitTrapSeconds(ctx: SystemContext, casterId: number, sourceId: number): number {
    const recordSeconds = this.trapSeconds(ctx, sourceId);
    const weapon = this.lookup(ctx, sourceId);
    if (!casterId || !weapon || weapon.record.type !== "WEAP") return recordSeconds;
    const copies = this.heldCopies(ctx, casterId, sourceId);
    if (!copies.length) return recordSeconds;
    // A staff only hits when it casts, and the engine casts nothing from an empty one
    const drains = this.isPlayer(ctx.svr as Mp, casterId) && this.fieldData(weapon, "DNAM")?.[0] !== ANIM_TYPE_STAFF;
    let seconds = 0;
    for (const e of copies) {
      const copySeconds = Math.max(recordSeconds, this.copyTrapSeconds(ctx, e, sourceId));
      if (copySeconds && !(drains && this.isSpent(ctx, e, sourceId))) seconds = Math.max(seconds, copySeconds);
    }
    return seconds;
  }

  // The copies in either hand, or with none marked held, every carried copy of that weapon
  private heldCopies(ctx: SystemContext, casterId: number, weaponId: number): InventoryEntry[] {
    let entries: InventoryEntry[];
    try {
      const inv = (ctx.svr as Mp).get(casterId, "inventory");
      entries = (inv && Array.isArray(inv.entries) ? inv.entries : [])
        .filter((e: InventoryEntry) => (Number(e.baseId) >>> 0) === weaponId && (Number(e.count) || 0) > 0);
    } catch {
      return [];
    }
    const held = entries.filter((e) => e.worn || e.wornLeft);
    return held.length ? held : entries;
  }

  // A weapon's own copy can carry soul trap the record lacks: a player-made enchantment or one kept as extra data
  private copyTrapSeconds(ctx: SystemContext, e: InventoryEntry, weaponId: number): number {
    let seconds = 0;
    for (const x of Array.isArray(e.enchantmentEffects) ? e.enchantmentEffects : []) {
      if (this.isSoulTrapEffect(ctx, Number(x.effectId) >>> 0)) seconds = Math.max(seconds, Number(x.duration) || 0);
    }
    const ench = Number(e.enchantmentId) >>> 0;
    if (ench && ench !== weaponId) seconds = Math.max(seconds, this.trapSeconds(ctx, ench));
    return seconds;
  }

  // The engine stops casting once less than one hit's cost is left and keeps that remainder, which craftedExtras records
  private isSpent(ctx: SystemContext, e: InventoryEntry, weaponId: number): boolean {
    const charge = e.chargePercent;
    if (typeof charge !== "number" || !Number.isFinite(charge)) return false;
    return charge < Math.max(this.hitCost(ctx, e, weaponId), MIN_HIT_COST);
  }

  // Most one hit of this copy's enchantment can cost; live drains measured 0.72 to 0.88 of it, lower per wielder
  private hitCost(ctx: SystemContext, e: InventoryEntry, weaponId: number): number {
    const effects = Array.isArray(e.enchantmentEffects) ? e.enchantmentEffects : [];
    if (effects.length) {
      return effects.reduce((sum, x) =>
        sum + this.effectCost(ctx, Number(x.effectId) >>> 0, Number(x.magnitude) || 0, Number(x.duration) || 0), 0);
    }
    const ench = Number(e.enchantmentId) >>> 0;
    return this.enchantmentCost(ctx, ench && ench !== weaponId ? ench : weaponId);
  }

  // ENIT cost when the record opts out of auto-calc, otherwise the sum of its effects' costs
  private enchantmentCost(ctx: SystemContext, sourceId: number): number {
    const hit = this.costCache.get(sourceId);
    if (hit !== undefined) return hit;
    let res = this.lookup(ctx, sourceId);
    if (res && res.record.type === "WEAP") res = this.lookup(ctx, espmFieldFormIds(res, "EITM")[0] || 0);
    const enit = res && res.record.type === "ENCH" ? this.fieldData(res, "ENIT") : null;
    const cost = enit && enit.byteLength >= 8 && (viewOf(enit).getUint32(4, true) & ENCH_NO_AUTO_CALC)
      ? viewOf(enit).getInt32(0, true)
      : this.recordEffects(ctx, sourceId).reduce((sum, x) => sum + this.effectCost(ctx, x.id, x.magnitude, x.seconds), 0);
    this.costCache.set(sourceId, cost);
    return cost;
  }

  // Auto-calc: base cost x magnitude^1.1 x (duration / 10)^1.1
  private effectCost(ctx: SystemContext, mgefId: number, magnitude: number, seconds: number): number {
    const data = this.fieldData(this.lookup(ctx, mgefId), "DATA");
    const baseCost = data && data.byteLength >= 8 ? viewOf(data).getFloat32(4, true) : 0;
    return baseCost * Math.pow(Math.max(magnitude, 1), 1.1) * (seconds > 0 ? Math.pow(seconds / 10, 1.1) : 1);
  }

  private isSoulTrapEffect(ctx: SystemContext, mgefId: number): boolean {
    if (SCRIPT_SOUL_TRAP_EFFECTS.has(mgefId)) return true;
    const hit = this.effectCache.get(mgefId);
    if (hit !== undefined) return hit;
    const data = this.fieldData(this.lookup(ctx, mgefId), "DATA");
    const result = !!data && data.byteLength >= 0x44 && viewOf(data).getUint32(0x40, true) === ARCHETYPE_SOUL_TRAP;
    this.effectCache.set(mgefId, result);
    return result;
  }

  private gemOf(ctx: SystemContext, baseId: number): Gem | null {
    const hit = this.gemCache.get(baseId);
    if (hit !== undefined) return hit;
    const res = this.lookup(ctx, baseId);
    let gem: Gem | null = null;
    if (res && res.record.type === "SLGM") {
      const soul = this.fieldData(res, "SOUL");
      const capacity = this.fieldData(res, "SLCP");
      gem = {
        capacity: capacity && capacity.byteLength ? capacity[0] : 0,
        empty: !(soul && soul.byteLength && soul[0]),
        black: !!(Number(res.record.flags) & FLAG_CAN_HOLD_NPC_SOUL),
      };
    }
    this.gemCache.set(baseId, gem);
    return gem;
  }

  private keywordsOf(ctx: SystemContext, formId: number): number[] {
    if (!formId) return [];
    const hit = this.keywordCache.get(formId);
    if (hit) return hit;
    const keywords = espmFieldFormIds(this.lookup(ctx, formId), "KWDA");
    this.keywordCache.set(formId, keywords);
    return keywords;
  }

  private isPlayer(mp: Mp, actorId: number): boolean {
    try {
      return Number(mp.get(actorId, "profileId")) >= 0;
    } catch {
      return false;
    }
  }

  private idOf(mp: Mp, obj: unknown): number {
    const desc = obj && typeof obj === "object" ? (obj as { desc?: unknown }).desc : undefined;
    if (typeof desc !== "string") return 0;
    try {
      return mp.getIdFromDesc(desc) >>> 0;
    } catch {
      return 0;
    }
  }

  private notify(ctx: SystemContext, actorId: number, text: string): void {
    try {
      const userId = ctx.svr.getUserByActor(actorId);
      if (userId >= 0 && userId < INVALID_USER_ID) {
        ctx.svr.sendCustomPacket(userId, JSON.stringify({ customPacketType: NOTICE_PACKET, text }));
      }
    } catch { /* offline */ }
  }

  private fieldData(res: any, type: string): Uint8Array | null {
    const fields = res && res.record && Array.isArray(res.record.fields) ? res.record.fields : [];
    const f = fields.find((x: any) => x && x.type === type && x.data instanceof Uint8Array);
    return f ? f.data : null;
  }

  private lookup(ctx: SystemContext, formId: number): any {
    if (!formId) return null;
    try {
      const res = (ctx.svr as Mp).lookupEspmRecordById(formId >>> 0);
      return res && res.record ? res : null;
    } catch {
      return null;
    }
  }

  private traps = new Map<number, Trap>();
  private nextPollAt = 0;
  private trapSecondsCache = new Map<number, number>();
  private costCache = new Map<number, number>();
  private effectCache = new Map<number, boolean>();
  private gemCache = new Map<number, Gem | null>();
  private keywordCache = new Map<number, number[]>();
}
