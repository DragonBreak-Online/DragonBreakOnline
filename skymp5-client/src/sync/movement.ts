export type NiPoint3 = [number, number, number];

export interface Transform {
  worldOrCell: number;
  pos: NiPoint3;
  rot: NiPoint3;
}

export type RunMode = "Standing" | "Walking" | "Running" | "Sprinting";

export interface AnimationVariables {
  runMode: RunMode;
  direction: number;
  isInJumpState: boolean;
  isSneaking: boolean;
  isBlocking: boolean;
  isWeapDrawn: boolean;
  isDead: boolean;
  healthPercentage: number;
  lookAt?: NiPoint3;
  speed: number;
}

// isServerDriven: the server itself moves this actor (the server-hosted NPC slice, _work/server-npc-movement-1102.md), set on
// every movement it sends and absent from a client's, so a player who takes the actor over (a fight) clears it
export type Movement = Transform & AnimationVariables & { isServerDriven?: boolean };

// // This doesn't work in SkyrimPlatform 0.5.0:
// export * from './movementApply';
// export * from './movementGet';

// Temporary workaround:
import * as movementApply from "./movementApply";
export const applyMovement = movementApply.applyMovement;
import * as movementGet from "./movementGet";
export const getMovement = movementGet.getMovement;
