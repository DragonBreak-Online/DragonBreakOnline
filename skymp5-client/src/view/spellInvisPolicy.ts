// Whether a watcher hides its copy of another player for an Invisibility spell, potion or scroll (Nate, 23 Oct: the
// invisibility exploit). The copy drinks the potion too (the server's MpActor::EquipItem snippet) and a replayed spell
// lands on it (magicSyncService), but an attack or an activation ends the effect only on the owner's own screen: the
// copy kept its Invisibility actor value for the effect's full 30-50 s, so everyone else could not see a player who was
// already fighting them.
//
// The owner's client reports its own state (SpellInvisReportService: dbo "spellInvis" [on]) and the server mirrors it in
// the neighbour-visible ff_spellInvis { on, n } (server spellinvis.js); n grows with every report, and a report repeats
// every REPORT_HEARTBEAT_MS while the owner stays invisible. A watcher hides a player copy only when BOTH hold:
//   - the copy's own Invisibility actor value is above 0 (a client cannot hide itself by sending a report alone), and
//   - the owner's latest report says on and is fresh: a report changes n at most CONFIRM_MAX_AGE_MS ago (the upper bound,
//     so a lost "off" or a dropped owner hides nobody for longer than that).
// An NPC copy (no ff_spellInvis ever) keeps the old rule: its own actor value alone.
//
// No imports, so it transpiles on its own for tests/spellinvis-harness.js.

export const REPORT_HEARTBEAT_MS = 3000;
export const CONFIRM_MAX_AGE_MS = 8000;

export interface OwnerInvis { on: boolean; n: number }

/** ff_spellInvis as the server mirrors it, or null when the owner never reported. */
export function ownerInvisOf(prop: unknown): OwnerInvis | null {
  if (!prop || typeof prop !== "object") return null;
  const p = prop as Record<string, unknown>;
  const n = Number(p["n"]);
  return { on: p["on"] === true, n: Number.isFinite(n) ? n : 0 };
}

export interface ConfirmState { n: number; at: number }

/** The watcher's record of the last report it saw change: a new n (or the first look) is a confirmation made now. */
export function nextConfirm(prev: ConfirmState | null, owner: OwnerInvis | null, now: number): ConfirmState | null {
  if (!owner) return null;
  if (!prev || prev.n !== owner.n) return { n: owner.n, at: now };
  return prev;
}

/**
 * Hidden for an Invisibility effect. playerCopy: the copy is another player's (model.appearance); copyAv: the copy's
 * own Invisibility actor value; owner/confirm: the owner's report and when this watcher saw it change.
 */
export function spellHidden(playerCopy: boolean, copyAv: number, owner: OwnerInvis | null, confirm: ConfirmState | null, now: number): boolean {
  if (!(copyAv > 0)) return false;
  if (!playerCopy) return true;
  if (!owner || !owner.on || !confirm) return false;
  return now - confirm.at <= CONFIRM_MAX_AGE_MS;
}

/** The owner's side: report on a change, and again every REPORT_HEARTBEAT_MS while invisible. */
export function reportDue(lastSent: boolean | null, lastSentAt: number, onNow: boolean, now: number): boolean {
  if (lastSent === null || lastSent !== onNow) return true;
  return onNow && now - lastSentAt >= REPORT_HEARTBEAT_MS;
}
