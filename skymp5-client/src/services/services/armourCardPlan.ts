// The armour line on SkyUI's item card (Nat, 1 Nov: the tier, class and Defense in the inventory's item info, not a
// separate card; _work/itemcard-route-1031.md). Pure, so tests/armour-card-harness.js runs it in node.
//   Client -> Server: { customPacketType: "dbo", event: "armourInfo", args: [baseId] }
//   Server -> Client: { customPacketType: "dboArmourInfo", id, none } | { id, tier, klass, need, cosmetic, defense }

export interface ArmourInfo { tier: number; klass: string; need: number; cosmetic: boolean }
export interface ArmourAnswer { id: number; info: ArmourInfo | null; defense: number | null }

// How long an answer is trusted before the piece is asked about again
export const ARMOUR_INFO_TTL_MS = 60 * 1000;
// Within the Defense keeps SkyUI's own grey; then yellow, orange and red as the gap grows (the debuff's full weight at 45)
export const CARD_COLORS = { within: 0x999999, near: 0xe0c060, short: 0xe08a3c, far: 0xc84b3c, cosmetic: 0x999999 };

export const readArmourAnswer = (content: Record<string, unknown> | null | undefined): ArmourAnswer | null => {
  if (!content || content["customPacketType"] !== "dboArmourInfo") return null;
  const id = Number(content["id"]);
  if (!Number.isInteger(id) || id <= 0) return null;
  const defense = Number(content["defense"]);
  if (content["none"] === true) return { id: id >>> 0, info: null, defense: null };
  const tier = Number(content["tier"]), need = Number(content["need"]);
  const klass = String(content["klass"] || "");
  if (!Number.isInteger(tier) || tier < 1 || tier > 7 || !Number.isFinite(need) || ["light", "medium", "heavy"].indexOf(klass) < 0) return null;
  return { id: id >>> 0, info: { tier, klass, need: Math.max(0, Math.round(need)), cosmetic: content["cosmetic"] === true }, defense: Number.isFinite(defense) ? defense : null };
};

// "Tier 3 · Medium · Defense 30", the format the in-game probe drew on 1 Nov
export const armourLabel = (info: ArmourInfo): string =>
  `Tier ${info.tier} · ${info.klass[0].toUpperCase()}${info.klass.slice(1)} · ${info.cosmetic ? "no Defense needed" : `Defense ${info.need}`}`;

export const armourColor = (info: ArmourInfo, defense: number | null): number => {
  if (info.cosmetic) return CARD_COLORS.cosmetic;
  const gap = info.need - (defense === null ? info.need : defense);
  return gap <= 0 ? CARD_COLORS.within : gap <= 15 ? CARD_COLORS.near : gap < 45 ? CARD_COLORS.short : CARD_COLORS.far;
};

// Ask about a piece the server has not answered for, or not lately; dynamic forms (a crafted copy) are not plugin records
export const shouldAsk = (id: number, answeredAt: number | undefined, askedAt: number | undefined, now: number): boolean => {
  if (!(id > 0) || id >= 0xff000000) return false;
  if (askedAt !== undefined && now - askedAt < 1000) return false;
  return answeredAt === undefined || now - answeredAt >= ARMOUR_INFO_TTL_MS;
};
