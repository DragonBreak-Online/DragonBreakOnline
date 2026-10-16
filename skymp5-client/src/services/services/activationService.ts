import { ActivateEvent, Actor, FormType, ObjectReference } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { MsgType } from "../../messages";
import { getInventory } from "../../sync/inventory";

// TODO: refactor this out
import { localIdToRemoteId } from "../../view/worldViewMisc";

import { LastInvService } from "./lastInvService";
import { selfActivated } from "../../sync/selfActivation";
import { logError, logTrace } from "../../logging";
import { ObjectReferenceEx } from "../../extensions/objectReferenceEx";

const diagNote = (kind: string, text: string): void => {
  try { const note = (globalThis as { __dboDiagNote?: (k: string, t: string) => void }).__dboDiagNote; if (typeof note === "function") note(kind, text); } catch { /* diagnostics only */ }
};

const isUnblockedServerDoor = (ref: ObjectReference): boolean => {
  try {
    const base = ref.getBaseObject();
    return !!base && base.getType() === FormType.Door && ObjectReferenceEx.wantsActivationBlock(base) && !ref.isActivationBlocked();
  } catch {
    return false;
  }
};

export class ActivationService extends ClientListener {
    constructor(private sp: Sp, private controller: CombinedController) {
        super();
        this.controller.on("activate", (e) => this.onActivate(e));
    }

    private onActivate(e: ActivateEvent) {
        const lastInvService = this.controller.lookupListener(LastInvService);
        // A player whose base reads null threw here and the activation was never sent; ContainersService reads its own when unset
        try {
          lastInvService.lastInv = getInventory(this.sp.Game.getPlayer() as Actor);
        } catch (err) {
          lastInvService.lastInv = undefined;
          logError(this, "Inventory read failed before an activation, sending it anyway", err);
          try { const report = (globalThis as { __dboReportError?: (w: string, e: unknown) => void }).__dboReportError; if (typeof report === "function") report("on:activate:inv", err); } catch { /* diagnostics only */ }
        }

        let caster = e.caster ? e.caster.getFormID() : 0;
        let target = e.target ? e.target.getFormID() : 0;

        if (!target || !caster) {
          return;
        }

        // Actors never have non-ff ids locally in skymp
        if (caster !== 0x14 && caster < 0xff000000) {
          return;
        }

        const isPlayer = caster === 0x14;

        // An NPC sitting down would have the server seat the hosting player instead, over and over
        if (!isPlayer && e.target.getBaseObject()?.getType() === FormType.Furniture) {
          logTrace(this, "Not relaying an NPC's furniture activation");
          return;
        }

        target = localIdToRemoteId(target);
        if (!target) {
            logError(this, 'localIdToRemoteId returned 0 (target) in on(\'activate\')');
            return;
        }

        caster = localIdToRemoteId(caster);
        if (!caster) {
            logError(this, 'localIdToRemoteId returned 0 (caster) in on(\'activate\')');
            return;
        }

        const openState = e.target.getOpenState();

        // TODO: add this to skyrimPlatform.ts
        const enum OpenState {
            None,
            Open,
            Opening,
            Closed,
            Closing,
        }

        // A server-run door that was not activation-blocked has already been opened or walked through by the engine, so the server must hear it
        if (isPlayer && isUnblockedServerDoor(e.target)) {
            try { e.target.blockActivation(true); } catch { /* unloaded ref */ }
            diagNote("door:unblocked", `${target.toString(16)} state ${openState}`);
        } else if (openState === OpenState.Opening || openState === OpenState.Closing) {
            logTrace(this, "Ignoring activation of door because it's already opening or closing");
            return;
        }

        if (isPlayer) selfActivated(target);

        this.controller.emitter.emit("sendMessage", {
            message: {
                t: MsgType.Activate,
                data: { caster, target, isSecondActivation: false }
            },
            reliability: "reliable"
        });

        logTrace(this, `Sent activation for caster=`, caster.toString(16), `and target=`, target.toString(16));
    }
};
