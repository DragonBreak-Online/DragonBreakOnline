// Which fights a companion may have with another player (Nate, 5 Oct: summons and raised corpses fight players "in pvp").
// The server decides (companionSystem.ts): it names a player as a companion's target only while the PvP rules allow that
// fight, and marks that order pvp. A player target without the mark (an older server, or an order the rules no longer
// allow) is no order at all, and a fight the engine picked itself with a player the server has not named is left. These
// rules are for summons and raised corpses; a GM's warband (kind "companion", server/warband.js) keeps its own.

export interface CompanionOrder {
  // Remote id of the target the server recorded, 0 for none
  target: number;
  // The server judged the target a player, or what fights for one, and the PvP rules allow the fight
  pvp: boolean;
  // The server's companion kind: "summon", "reanimated", "companion"
  kind?: string;
}

// Every kind but a GM warband's follower; an unknown kind is ruled too
export const pvpRuled = (order: CompanionOrder): boolean => order.kind !== "companion";

// The target to fight, 0 when there is none to carry out
export const orderedTarget = (order: CompanionOrder, isPlayer: (remoteId: number) => boolean): number => {
  if (!order.target) return 0;
  return order.pvp || !pvpRuled(order) || !isPlayer(order.target) ? order.target : 0;
};

// Staff are never fought (Nat, 28 Oct: a GM's warband kept swinging at another GM): the server's warband.js sends the GM
// leading a band { customPacketType: "companionSpare", ids } with the remote ids of the staff online, and any companion's
// own fight with one of them is left, whatever its kind. An older server sends none, and nothing changes
export const parseSpare = (content: Record<string, unknown>): Set<number> => {
  const ids = content["ids"];
  return new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === "number" && x > 0).map((x) => (x as number) >>> 0) : []);
};
export const leavesSparedFight = (combatTarget: number, spare: Set<number>): boolean => !!combatTarget && spare.has(combatTarget >>> 0);

// The engine is fighting a player (combatTarget, a remote id; 0 for none) that the server has not named for this companion
export const leavesPlayerFight = (combatTarget: number, order: CompanionOrder, isPlayer: (remoteId: number) => boolean): boolean => {
  if (!combatTarget || !pvpRuled(order) || !isPlayer(combatTarget)) return false;
  return !(order.pvp && order.target === combatTarget);
};
