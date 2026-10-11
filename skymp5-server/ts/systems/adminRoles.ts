// Admin tier resolution shared by AdminSystem and HousingSystem: adminProfileIds are always senior, then adminRoles tiers, then legacy adminRoleIds as senior

export type AdminTier = "senior" | "developer" | "leadgm" | "gm";

// Precedence when a player holds roles from several tiers
const TIER_ORDER: AdminTier[] = ["senior", "developer", "leadgm", "gm"];

// spawn: anything that creates or changes the world or the economy (items, spells, beast forms, mastery, NPC zones,
// kill, the Smite and Heal on Hit modes) and the server console. Jake and Nate, 2026-09-27: a GM observes and reports.
export const TIER_CAPS: Record<AdminTier, { ban: boolean; spawn: boolean }> = {
  senior: { ban: true, spawn: true },
  developer: { ban: true, spawn: true },
  leadgm: { ban: false, spawn: true },
  gm: { ban: false, spawn: false },
};

export interface AdminRoleConfig {
  tierRoles: Record<AdminTier, string[]>;
  // adminRoles.trialgm: Trial GM roles (Nate, 11 Oct). Not an AdminTier: adminTierOf answers null for them, so no admin
  // check opens to a Trial GM; isTrialGm and TRIAL_GM_ACTIONS open the few panel actions they may use
  trialRoles: string[];
  adminRoleIds: string[];
  adminProfileIds: number[];
}

const idList = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : [];

export function readAdminRoleConfig(all: Record<string, unknown> | null): AdminRoleConfig {
  const raw = all?.["adminRoles"];
  const tiers = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const tierRoles: Record<AdminTier, string[]> = { senior: [], developer: [], leadgm: [], gm: [] };
  for (const tier of TIER_ORDER) tierRoles[tier] = idList(tiers[tier]);
  const profiles = all?.["adminProfileIds"];
  return {
    tierRoles,
    trialRoles: idList(tiers["trialgm"]),
    adminRoleIds: idList(all?.["adminRoleIds"]),
    adminProfileIds: Array.isArray(profiles) ? profiles.map(Number).filter(Number.isFinite) : [],
  };
}

// The tier from a profile id and its Discord roles, for callers that have no actor yet (spawn.ts at character select)
export function adminTierFrom(profileId: number, roles: string[], cfg: AdminRoleConfig): AdminTier | null {
  if (cfg.adminProfileIds.includes(Number(profileId))) return "senior";
  const has = (ids: string[]) => roles.some(r => ids.includes(r));
  for (const tier of TIER_ORDER) {
    if (has(cfg.tierRoles[tier])) return tier;
  }
  return has(cfg.adminRoleIds) ? "senior" : null;
}

// A Trial GM holds a trialgm role and no admin tier: a GM role beside it wins
export function isTrialGmFrom(profileId: number, roles: string[], cfg: AdminRoleConfig): boolean {
  return cfg.trialRoles.length > 0 && adminTierFrom(profileId, roles, cfg) === null && roles.some(r => cfg.trialRoles.includes(r));
}

const rolesOn = (mp: any, actorId: number): string[] => {
  try {
    const r = mp.get(actorId, "private.discordRoles");
    if (Array.isArray(r)) return r.map(String);
  } catch { }
  return [];
};
const profileOn = (mp: any, actorId: number): number => {
  try { return Number(mp.get(actorId, "profileId")); } catch { return -1; }
};

// Reads private.discordRoles (written by spawn.ts at login), so a Discord role change needs a relog
export function adminTierOf(mp: any, actorId: number, cfg: AdminRoleConfig): AdminTier | null {
  return adminTierFrom(profileOn(mp, actorId), rolesOn(mp, actorId), cfg);
}

export function isTrialGm(mp: any, actorId: number, cfg: AdminRoleConfig): boolean {
  return isTrialGmFrom(profileOn(mp, actorId), rolesOn(mp, actorId), cfg);
}

// The F7 panel for a Trial GM: the menu (the player list, without addresses or hardware ids), going to a player, the
// Invisible mode and a rename. Every other request and action is refused (AdminSystem.customPacket)
export const TRIAL_GM_ACTIONS = new Set(["teleportTo", "rename"]);
export const TRIAL_GM_MODES = new Set(["invis"]);
export const TRIAL_GM_TABS = ["debug", "players", "modes"];
