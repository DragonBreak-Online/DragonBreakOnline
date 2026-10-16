// Melee reach trace for meleeReachDiagService.ts: per player, whether Precision runs and how far each melee weapon's hits land.
// Precision sizes the swing capsule from the weapon mesh's bounds, not the record's reach, so a short mesh shows as a short dmax.
// Lines (clientDiag trace, numbers and hex ids only; distances in game units, player to target position at the hit event):
//   mel eq w=<weapon id> t=<weapon type> pa=<1 Precision active for the player | 0 loaded, not active | - not loaded>
//   mel hits w=<weapon id> t=<weapon type> n=<hits> p=<power hits> d50=<median> d90=<90th percentile> dmax=<max>
import { hex } from "../../lib/clientDiag";

/** Papyrus Weapon.GetWeaponType: 1 sword, 2 dagger, 3 war axe, 4 mace, 5 greatsword, 6 battleaxe or warhammer */
export const MELEE_TYPES = [1, 2, 3, 4, 5, 6];
/** A weapon's hits are summed up this often while it lands them, and when the player equips another weapon */
export const SUMMARY_MS = 300000;
/** Distances kept per weapon for the percentiles; past that only n, p and dmax move */
export const SAMPLES_MAX = 200;
/** A hit farther than this is a stale position, not a swing (a cell is 4096 units) */
export const DISTANCE_MAX = 2048;
/** Lines per game process, so the appearance trace keeps most of the shared budget */
export const EQUIP_LINES_MAX = 6;
export const HIT_LINES_MAX = 12;

export type PrecisionState = "1" | "0" | "-";

interface Tally { type: number; n: number; p: number; dmax: number; samples: number[]; since: number }

export const isMeleeType = (t: number): boolean => MELEE_TYPES.indexOf(t) !== -1;

// The q-quantile of sorted values (nearest rank)
const quantile = (sorted: number[], q: number): number =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] : 0;

export class MeleeReachTrace {
  // The line for an equipped melee weapon, once per weapon and Precision state in a game process; also closes the weapon
  // the player held before (its summary comes first). Nothing here throws.
  onEquip(weaponId: number, type: number, precision: PrecisionState): string[] {
    const out: string[] = [];
    try {
      if (!isMeleeType(type)) return out;
      for (const id of Array.from(this.tallies.keys())) {
        if (id !== weaponId) { const l = this.summary(id); if (l) out.push(l); }
      }
      const key = `${weaponId}:${precision}`;
      if (!this.equipSeen.has(key) && this.equipLines < EQUIP_LINES_MAX) {
        this.equipSeen.add(key);
        this.equipLines++;
        out.push(`mel eq w=${hex(weaponId)} t=${type} pa=${precision}`);
      }
    } catch (e) { /* diagnostics never break the caller */ }
    return out;
  }

  // One melee hit by the player; a summary line when the weapon's window is over
  onHit(weaponId: number, type: number, distance: number, power: boolean, now: number): string[] {
    const out: string[] = [];
    try {
      if (!isMeleeType(type) || !Number.isFinite(distance) || distance < 0 || distance > DISTANCE_MAX) return out;
      let t = this.tallies.get(weaponId);
      if (!t) { t = { type, n: 0, p: 0, dmax: 0, samples: [], since: now }; this.tallies.set(weaponId, t); }
      t.n++;
      if (power) t.p++;
      t.dmax = Math.max(t.dmax, distance);
      if (t.samples.length < SAMPLES_MAX) t.samples.push(distance);
      if (now - t.since >= SUMMARY_MS) { const l = this.summary(weaponId); if (l) out.push(l); }
    } catch (e) { /* never throws */ }
    return out;
  }

  // Summaries of every weapon whose window is over (called each tick)
  due(now: number): string[] {
    const out: string[] = [];
    try {
      for (const [id, t] of Array.from(this.tallies.entries())) {
        if (now - t.since >= SUMMARY_MS) { const l = this.summary(id); if (l) out.push(l); }
      }
    } catch (e) { /* never throws */ }
    return out;
  }

  private summary(weaponId: number): string | null {
    const t = this.tallies.get(weaponId);
    this.tallies.delete(weaponId);
    if (!t || t.n === 0 || this.hitLines >= HIT_LINES_MAX) return null;
    this.hitLines++;
    const s = t.samples.slice().sort((a, b) => a - b);
    const r = (v: number) => Math.round(v);
    return `mel hits w=${hex(weaponId)} t=${t.type} n=${t.n} p=${t.p} d50=${r(quantile(s, 0.5))} d90=${r(quantile(s, 0.9))} dmax=${r(t.dmax)}`;
  }

  private tallies = new Map<number, Tally>();
  private equipSeen = new Set<string>();
  private equipLines = 0;
  private hitLines = 0;
}
