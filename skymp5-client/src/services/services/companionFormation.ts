// Where each of the owner's companions stands when it follows (Nate, 3 Oct: a GM's warband "collide with each other when
// several try to follow closely"). Every follower used to keep the same offset behind the owner, so a band of ten pushed
// for one spot. Slot 0 keeps the old spot; the rest stand in rows of three behind it, the middle first.
// Pure: no game calls, so a harness can check it.

// Offsets in the owner's own frame: x to the owner's right, y ahead of the owner (negative: behind)
export const FORMATION_FIRST_Y = -128;
export const FORMATION_SPACING = 120;
const COLUMNS = [0, -1, 1];

// Ranged members (a bow, crossbow, staff or spell in hand) stand on the flanks instead of in the rows behind the owner, so
// what they loose at a foe ahead does not pass through the owner (warband rework step 2, Nat 25 Oct; 24 Oct a Dremora's
// Incinerate hit its own GM twice). Flank places are slots from FLANK_SLOT_BASE: right, left, then a rank further out and back.
export const FLANK_SLOT_BASE = 1000;
export const FLANK_X = 240;
export const FLANK_Y = -64;
export const FLANK_RANK_BACK = 60;
export const flankSlot = (k: number): number => FLANK_SLOT_BASE + Math.max(0, Math.floor(Number(k) || 0));

export const formationOffset = (slot: number): [number, number] => {
  const i = Math.max(0, Math.floor(Number(slot) || 0));
  if (i >= FLANK_SLOT_BASE) {
    const k = i - FLANK_SLOT_BASE;
    const side = k % 2 === 0 ? 1 : -1;
    const rank = Math.floor(k / 2);
    return [side * (FLANK_X + rank * FORMATION_SPACING), FLANK_Y - rank * FLANK_RANK_BACK];
  }
  const row = Math.floor(i / COLUMNS.length);
  const column = COLUMNS[i % COLUMNS.length];
  return [column * FORMATION_SPACING, FORMATION_FIRST_Y - row * FORMATION_SPACING];
};

// The same offset in world axes for an owner facing angleZ degrees (Skyrim: 0 is +Y, clockwise), for moveTo, whose
// offsets are world axes
export const formationWorldOffset = (slot: number, angleZ: number): [number, number] => {
  const [x, y] = formationOffset(slot);
  const rad = (Number(angleZ) || 0) * Math.PI / 180;
  return [x * Math.cos(rad) + y * Math.sin(rad), -x * Math.sin(rad) + y * Math.cos(rad)];
};

// The point a follower in this slot stands at, in world space, for an owner at ownerPos facing angleZ (height: the owner's)
export const formationPoint = (slot: number, ownerPos: number[], angleZ: number): [number, number, number] => {
  const [dx, dy] = formationWorldOffset(slot, angleZ);
  return [ownerPos[0] + dx, ownerPos[1] + dy, ownerPos[2]];
};

// How far a follower is from its own place in the formation. The stuck watch and the driven walk measure from here: a
// back-row follower resting in its slot can stand 1,000 units from the owner, past the stuck watch's 800, and measured
// from the owner it was lifted, driven to heel and sent back, over and over (review rv3, 3 Oct)
export const formationGap = (actorPos: number[], slot: number, ownerPos: number[], angleZ: number): number => {
  const p = formationPoint(slot, ownerPos, angleZ);
  return Math.hypot(actorPos[0] - p[0], actorPos[1] - p[1], actorPos[2] - p[2]);
};

// ---- organic movement (warband rework step 2, Nat 25 Oct: "the AI more fluid and organic") ------------------------------
// A band moved as one machine: one packet, one 250 ms loop, every member on an exact grid point with the same radii. Each
// member now has its own small, stable difference, taken from its server id so it never changes between ticks or reloads.
const unitHash = (id: number, salt: number): number => {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < 4; i++) {
    h ^= (Number(id) >>> (i * 8)) & 0xff;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h / 4294967296;
};
// Up to JITTER_UNITS off its formation point, and its own catch-up and follow radii within RADIUS_SPREAD of the service's
export const JITTER_UNITS = 25;
export const RADIUS_SPREAD = 0.15;
export const memberJitter = (id: number): { dx: number; dy: number; radiusMult: number } => ({
  dx: (unitHash(id, 1) * 2 - 1) * JITTER_UNITS,
  dy: (unitHash(id, 2) * 2 - 1) * JITTER_UNITS,
  radiusMult: 1 + (unitHash(id, 3) * 2 - 1) * RADIUS_SPREAD,
});
// A new order reaches the band as a ripple: the first member takes it at once, member n waits n steps (capped) plus its
// own share of a random spread
export const STAGGER_STEP_MS = 90;
export const STAGGER_CAP_MS = 900;
export const STAGGER_RANDOM_MS = 250;
export const staggerDelayMs = (order: number, id: number): number => Math.floor(Number(order) || 0) <= 0 ? 0 :
  Math.min(STAGGER_CAP_MS, Math.max(0, Math.floor(Number(order) || 0)) * STAGGER_STEP_MS) + Math.floor(unitHash(id, 4) * STAGGER_RANDOM_MS);
// The leash with a gap: past LEASH_OUT_UNITS from the owner a member breaks off its fight and comes back, and it does not
// take up a fight again until it is within LEASH_BACK_UNITS. One cutoff (1500) made a member at the edge of a fight flip
// between fighting and following.
export const LEASH_OUT_UNITS = 1800;
export const LEASH_BACK_UNITS = 1200;
export const leashStep = (leashed: boolean, distance: number): boolean => (leashed ? distance >= LEASH_BACK_UNITS : distance > LEASH_OUT_UNITS);
// A bow, crossbow, staff or spell in either hand (skyrimPlatform EquippedItemType: Bow 7, Staff 8, Spell 9, Crossbow 12)
export const RANGED_ITEM_TYPES = [7, 8, 9, 12];
export const isRangedHands = (right: number, left: number): boolean => RANGED_ITEM_TYPES.includes(right) || RANGED_ITEM_TYPES.includes(left);

// ---- holding and fighting, each in its own way (warband rework step 3, Nat 25 Oct) -------------------------------------
// A member holding its ground glances at its owner now and then instead of staring ahead: for GLANCE_MS out of every
// GLANCE_EVERY_MS..+GLANCE_SPREAD_MS (its own period, and its own phase, from its server id)
export const GLANCE_MS = 2500;
export const GLANCE_EVERY_MS = 8000;
export const GLANCE_SPREAD_MS = 6000;
export const glancing = (id: number, now: number): boolean => {
  const period = GLANCE_EVERY_MS + Math.floor(unitHash(id, 5) * GLANCE_SPREAD_MS);
  const phase = Math.floor(unitHash(id, 6) * period);
  return ((Number(now) + phase) % period) < GLANCE_MS;
};
// How bold each member is in a fight: the engine's Confidence actor value (0 Cowardly, 1 Cautious, 2 Average, 3 Brave,
// 4 Foolhardy). Half are Average, a third Brave, the rest Foolhardy; never Cowardly or Cautious, which flee a fight the
// owner ordered.
export const memberConfidence = (id: number): number => {
  const u = unitHash(id, 7);
  return u < 0.5 ? 2 : u < 0.85 ? 3 : 4;
};
