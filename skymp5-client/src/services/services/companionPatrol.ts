// A warband defending an area walks about in it while it has nothing to fight (Nat, 28 Oct: "it rubber-bands them back
// to the spot rather than patrol around"). The server's warband.js sends { customPacketType: "companionPatrol", centre,
// radius, ids } to the GM when a band is told to defend, and ids [] when the order ends; companionService.ts walks each
// listed member that is staying with no target to a new point every patrolEveryMs. An older client ignores the packet.

export interface Patrol {
  centre: number[];
  radius: number;
  ids: number[];
}

export const PATROL_EVERY_MS = 15000;
// A walk point lies within this share of the radius, so a walk never ends on the area's edge
const POINT_SHARE = 0.8;

// The packet's patrol, or null when it ends one or is malformed
export const parsePatrol = (content: Record<string, unknown>): Patrol | null => {
  const centre = content["centre"], radius = content["radius"], ids = content["ids"];
  if (!Array.isArray(ids) || !ids.length) return null;
  if (!Array.isArray(centre) || centre.length !== 3 || !centre.every((x) => typeof x === "number" && Number.isFinite(x))) return null;
  if (typeof radius !== "number" || !(radius > 0) || radius > 10000) return null;
  return { centre: centre as number[], radius, ids: ids.filter((x) => typeof x === "number").map((x) => (x as number) >>> 0) };
};

// Deterministic per member and walk, so members spread out and a test can repeat it
const unit = (seed: number): number => {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// The n-th walk point of a member: uniform over the disc of POINT_SHARE * radius around the centre, at the centre's height
export const patrolPoint = (p: Patrol, id: number, n: number): number[] => {
  const a = unit(id * 31 + n * 2654435761) * Math.PI * 2;
  const r = Math.sqrt(unit(id * 17 + n * 40503 + 7)) * p.radius * POINT_SHARE;
  return [p.centre[0] + Math.cos(a) * r, p.centre[1] + Math.sin(a) * r, p.centre[2]];
};

// A member walks again once its interval, staggered by up to 3 s per member, has passed since its last walk
export const patrolDue = (lastAt: number, now: number, id: number): boolean =>
  now - lastAt >= PATROL_EVERY_MS + Math.floor(unit(id) * 3000);
