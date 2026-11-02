import { Movement } from "../sync/movement";
import { Animation } from "../sync/animation";
import { Appearance } from "../sync/appearance";
import { Equipment } from "../sync/equipment";
import { Inventory } from "../sync/inventory";
import { CreateActorMessageMainProps, CreateActorMessageAdditionalProps } from "src/services/messages/createActorMessage";

// Own properties (not inherited) are being assigned locally
export interface FormModel extends CreateActorMessageAdditionalProps, CreateActorMessageMainProps{
  idx?: number;
  movement?: Movement;
  numMovementChanges?: number;
  // Date.now() when the last movement for this form arrived
  movementAt?: number;
  // Smoothed ms between movement updates for this form: ~130 at full rate, longer when the server's interest management
  // sends a far mover less often (sync/movementApply.ts stretches its interpolation to match)
  movementGapMs?: number;
  // The server drives this actor: no client may ask to host it, whatever isHostedByOther says. A property like isHostedByOther
  // (the server sends both from UpdateHoster at the same moment, and in CreateActor props for a client that arrives later;
  // the generic property paths in remoteServer put it here). Never set from movement: the wire format is positional, so a
  // field there would change the protocol (W4, 2 Nov), and a movement without it would clear the property
  isServerDriven?: boolean;
  numAppearanceChanges?: number;
  isMyClone?: boolean;
}

export interface WorldModel {
  forms: Array<FormModel | undefined>;
  playerCharacterFormIdx: number;
  playerCharacterRefrId: number;
}
