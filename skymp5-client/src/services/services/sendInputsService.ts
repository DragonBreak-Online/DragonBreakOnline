import { ClientListener, CombinedController, Sp } from "./clientListener";
import { SinglePlayerService } from "./singlePlayerService";
import { FormModel, WorldModel } from "../../view/model";
import { MsgType } from "../../messages";
import { getMovement } from "../../sync/movementGet";

// TODO: refactor this out
import * as worldViewMisc from "../../view/worldViewMisc";

import { Animation, AnimationSource } from "../../sync/animation";
import { Actor, ActorBase, EquipEvent, FormType } from "skyrimPlatform";
import { getAppearance } from "../../sync/appearance";
import { ActorValues, getActorValues } from "../../sync/actorvalues";
import { getEquipment } from "../../sync/equipment";
import { nextHostAttempt } from "../../view/hostAttempts";
import { SkympClient } from "./skympClient";
import { MessageWithRefrId } from "../events/sendMessageWithRefrIdEvent";
import { UpdateMovementMessage } from "../messages/updateMovementMessage";
import { Movement } from "../../sync/movement";
import { ChangeValuesMessage } from "../messages/changeValuesMessage";
import { CloneSpellGuardService } from "./cloneSpellGuardService";
import { UpdateAnimationMessage } from "../messages/updateAnimationMessage";
import { UpdateEquipmentMessage } from "../messages/updateEquipmentMessage";
import { UpdateAppearanceMessage } from "../messages/updateAppearanceMessage";
import { RemoteServer } from "./remoteServer";
import { DeathService } from "./deathService";
import { RestraintService } from "./restraintService";
import { logTrace } from "../../logging";
import { hex, trace } from "../../lib/clientDiag";

const playerFormId = 0x14;

// TODO: split this service into EquipmentService, MovementService, AnimationService, ActorValueService, HostAttemptsService
// Nothing a watcher would see changed: same place within 2 units and 1 degree, same stance, health and look target
const near = (a: number, b: number, d: number) => Math.abs(a - b) <= d;
const sameMovement = (a: Movement, b: Movement): boolean =>
    a.worldOrCell === b.worldOrCell &&
    near(a.pos[0], b.pos[0], 2) && near(a.pos[1], b.pos[1], 2) && near(a.pos[2], b.pos[2], 2) &&
    near(a.rot[0], b.rot[0], 1) && near(a.rot[1], b.rot[1], 1) && near(a.rot[2], b.rot[2], 1) &&
    a.runMode === b.runMode && a.isInJumpState === b.isInJumpState && a.isSneaking === b.isSneaking &&
    a.isBlocking === b.isBlocking && a.isWeapDrawn === b.isWeapDrawn && a.isDead === b.isDead &&
    near(a.healthPercentage, b.healthPercentage, 0.005) && near(a.direction, b.direction, 1) &&
    near(a.speed || 0, b.speed || 0, 1) &&
    (!a.lookAt || !b.lookAt ? a.lookAt === b.lookAt :
        near(a.lookAt[0], b.lookAt[0], 5) && near(a.lookAt[1], b.lookAt[1], 5) && near(a.lookAt[2], b.lookAt[2], 5));

export class SendInputsService extends ClientListener {
    constructor(private sp: Sp, private controller: CombinedController) {
        super();
        this.controller.on("update", () => this.onUpdate());
        this.controller.on("equip", (e) => this.onEquip(e));
        this.controller.on("unequip", (e) => this.onUnequip(e));
        this.controller.on("loadGame", () => this.onLoadGame());
    }

    private onUpdate() {
        if (!this.singlePlayerService.isSinglePlayer) {
            this.sendInputs();

            const player = this.sp.Game.getPlayer()!;
            const isPlayerCasting = player.getAnimationVariableBool("IsCastingRight")
                || player.getAnimationVariableBool("IsCastingLeft")
                || player.getAnimationVariableBool("IsCastingDual");

            if (isPlayerCasting) {
                this.prevCastingDetectedTime = Date.now();
            }

            this.checkSpellEquipmentChanged(player);
        }
    }

    // Spell-to-hand changes fire no TESEquipEvent, so poll them; otherwise clones keep the last weapon/spell loadout (desync S1/S3)
    private checkSpellEquipmentChanged(player: Actor) {
        // Slot ids left/right/voice/instant (SpellType enum not exported here)
        const sig = [0, 1, 2, 3]
            .map(t => player.getEquippedSpell(t as never)?.getFormID() ?? 0)
            .join(',');
        if (this.lastSpellSignature === undefined) {
            this.lastSpellSignature = sig;
        } else if (sig !== this.lastSpellSignature) {
            this.lastSpellSignature = sig;
            this.equipmentChanged = true;
        }
    }

    private onEquip(event: EquipEvent) {
        if (!event.actor || !event.baseObj) {
            return;
        }

        if (event.actor.getFormID() !== playerFormId) {
            return;
        }

        const type = event.baseObj.getType();
        if (type !== FormType.Book && type !== FormType.Potion && type !== FormType.Ingredient) {
            // Trigger UpdateEquipment only for equips that are not spell tomes, potions, ingredients
            this.equipmentChanged = true;
        }

        // Send OnEquip for all equips, else the server won't trigger spell learn, potion drink, eating, Papyrus
        this.controller.emitter.emit("sendMessage", {
            message: { t: MsgType.OnEquip, baseId: event.baseObj.getFormID() },
            reliability: "reliable"
        });
    }

    private onUnequip(event: EquipEvent) {
        if (!event.actor || !event.baseObj) {
            return;
        }

        if (event.actor.getFormID() === playerFormId) {
            this.equipmentChanged = true;
        }
    }

    private onLoadGame() {
        // Only armor is equipped after relogging (see remoteServer.ts); this hack re-sends equipment to the server
        this.sp.Utility.wait(3).then(() => (this.equipmentChanged = true));
    }

    private sendInputs() {
        const hosted =
            typeof this.sp.storage['hosted'] === typeof [] ? this.sp.storage['hosted'] : [];
        const targets = [undefined].concat(hosted as any);

        const modelSource = this.controller.lookupListener(RemoteServer);

        const world = modelSource.getWorldModel();

        const liveAnimSources = new Set<string>();
        targets.forEach((target) => {
            const targetFormModel = target ? this.getForm(target, world) : this.getForm(undefined, world);
            this.sendMovement(target, targetFormModel);
            this.sendAnimation(target, liveAnimSources);
            this.sendAppearance(target);
            this.sendEquipment(target);
            this.sendActorValuePercentage(target, targetFormModel);
        });
        this.pruneAnimSources(liveAnimSources);
        this.sendHostAttempts();
    }

    // A copy no longer hosted here, or gone, gives its animation hook back. They were never removed: each one ran
    // on every animation event in the game, so frame rate decayed with every NPC hosted in a session
    private pruneAnimSources(live: Set<string>) {
        this.playerAnimSource.forEach((source, key) => {
            if (live.has(key) || !source.dispose()) {
                return;
            }
            this.playerAnimSource.delete(key);
            this.lastAnimationSent.delete(key);
        });
    }

    private sendMovement(_refrId?: number, form?: FormModel) {
        const owner = this.getInputOwner(_refrId);
        if (!owner) {
          return;
        }
        // An unloaded hosted actor has no AI or physics here; going silent lets a nearby player take it over
        if (_refrId && !owner.is3DLoaded()) {
          return;
        }

        const refrIdStr = `${_refrId}`;
        const sendMovementRateMs = 130;
        const now = Date.now();
        const last = this.lastSendMovementMoment.get(refrIdStr);
        if (!last || now - last > sendMovementRateMs) {
            const movement = getMovement(owner, form);
            const data = _refrId ? movement : this.controller.lookupListener(RestraintService).filterOwnMovement(movement);
            this.lastSendMovementMoment.set(refrIdStr, now);
            // An actor standing still re-sent the same position every 130 ms: about half of all movement traffic at 500
            // bots carried nothing new (Worker B, 18 Oct). An unchanged one is sent only as a heartbeat, often enough
            // that the server never sees a stale host (5 s) and watchers never take a hosted NPC over (rehostAfterMs 2.1 s)
            const sent = this.lastSentMovement.get(refrIdStr);
            if (sent && now - sent.at < SendInputsService.movementHeartbeatMs && sameMovement(sent.data, data)) {
                return;
            }
            const message: MessageWithRefrId<UpdateMovementMessage> = {
                t: MsgType.UpdateMovement,
                data,
                _refrId
            };
            this.controller.emitter.emit("sendMessageWithRefrId", {
                message,
                reliability: "unreliable"
            });
            this.lastSentMovement.set(refrIdStr, { data, at: now });
        }
    }

    private static readonly movementHeartbeatMs = 700;
    private lastSentMovement = new Map<string, { data: Movement; at: number }>();

    private sendActorValuePercentage(_refrId?: number, form?: FormModel) {
        const canSend = form && (form.isDead ?? false) === false;
        if (!canSend) {
          return;
        }

        const owner = this.getInputOwner(_refrId);
        if (!owner) {
          return;
        }

        // A clone's replayed hostile spell must not lower the reported health
        this.controller.lookupListener(CloneSpellGuardService).enforce();

        const av = getActorValues(this.sp.Game.getPlayer() as Actor);
        const currentTime = Date.now();
        if (
            this.actorValuesNeedUpdate === false &&
            this.prevValues.health === av.health &&
            this.prevValues.stamina === av.stamina &&
            this.prevValues.magicka === av.magicka
        ) {
            return;
        }


        if (
            currentTime - this.prevActorValuesUpdateTime < 1000 &&
            this.actorValuesNeedUpdate === false
        ) {
            return;
        }

        // Delaying actor values update due to casting
        // TODO: partial updates once the server supports it (keep health/stamina during casting, delay magicka)
        if (
            currentTime - this.prevCastingDetectedTime < 500 &&
            av.health > 0 // don't delay death actor value update
        ) {
            return;
        }

        const deathService = this.controller.lookupListener(DeathService);
        if (deathService.isBusy()) {
            logTrace(this, "Not sending actor values, death service is busy");
            return;
        }

        const message: MessageWithRefrId<ChangeValuesMessage> = {
            t: MsgType.ChangeValues,
            data: av,
            _refrId
        };
        this.controller.emitter.emit("sendMessageWithRefrId", {
            message,
            reliability: "unreliable"
        });
        this.actorValuesNeedUpdate = false;
        this.prevValues = av;
        this.prevActorValuesUpdateTime = currentTime;

    }

    private sendAnimation(_refrId: number | undefined, liveAnimSources: Set<string>) {
        const owner = this.getInputOwner(_refrId);
        if (!owner) {
          return;
        }

        // Extermly important that it's a local id since AnimationSource depends on it
        const refrIdStr = owner.getFormID().toString(16);
        liveAnimSources.add(refrIdStr);

        let animSource = this.playerAnimSource.get(refrIdStr);
        if (!animSource) {
            // Adding the hook throws while an engine thread is inside it; skip this copy for a frame, not every
            // hosted copy after it (review of 48be192d)
            try { animSource = new AnimationSource(owner); }
            catch (e) { return; }
            this.playerAnimSource.set(refrIdStr, animSource);
        }
        const anim = animSource.getAnimation();

        const lastAnimationSent = this.lastAnimationSent.get(refrIdStr);
        if (
            !lastAnimationSent ||
            anim.numChanges !== lastAnimationSent.numChanges
        ) {
            // Drink potion anim from this mod https://www.nexusmods.com/skyrimspecialedition/mods/97660
            if (anim.animEventName !== '' && !anim.animEventName.startsWith("DrinkPotion_")) {
                this.lastAnimationSent.set(refrIdStr, anim);
                this.updateActorValuesAfterAnimation(anim.animEventName);
                const message: MessageWithRefrId<UpdateAnimationMessage> = {
                    t: MsgType.UpdateAnimation,
                    data: anim,
                    _refrId
                };
                this.controller.emitter.emit("sendMessageWithRefrId", {
                    message,
                    reliability: "unreliable"
                });
            }
        }
    }

    private preMenuHead: { race: number; baseRace: number; sex: number; face: number } | null = null;

    // The player's race, its base form's race, the base's sex and the Face head part (HeadPart type 1)
    private headState(): { race: number; baseRace: number; sex: number; face: number } {
        const player = this.sp.Game.getPlayer() as Actor;
        const base = ActorBase.from(player.getBaseObject());
        const race = player.getRace();
        const baseRace = base ? base.getRace() : null;
        let face = 0;
        const n = base ? base.getNumHeadParts() : 0;
        for (let i = 0; i < n; ++i) {
            const part = base ? base.getNthHeadPart(i) : null;
            if (part && part.getType() === 1) { face = part.getFormID(); break; }
        }
        return { race: race ? race.getFormID() : 0, baseRace: baseRace ? baseRace.getFormID() : 0, sex: base ? base.getSex() : -1, face };
    }

    // Data\Platform\Logs\dbo-diag-logs.txt, which Report a Problem sends
    private diag(line: string) {
        try { (this.sp as unknown as { writeLogs: (plugin: string, ...rest: unknown[]) => void }).writeLogs('dbo-diag', `[appearance] ${line}`); } catch { /* older platform */ }
    }

    private sendAppearance(_refrId?: number) {
        if (_refrId) {
          return;
        }
        const shown = this.sp.Ui.isMenuOpen('RaceSex Menu');
        if (shown != this.isRaceSexMenuShown) {
            this.isRaceSexMenuShown = shown;
            if (shown) {
                // The head the character had before the menu: RaceMenu swaps in its race's default face on a non-Nord re-edit
                this.preMenuHead = this.headState();
                this.diag(`racemenu open: ${JSON.stringify(this.preMenuHead)}`);
                trace(`rm open r=${hex(this.preMenuHead.race)} s=${this.preMenuHead.sex} face=${hex(this.preMenuHead.face)}`);
            }
            if (!shown) {
                this.sp.printConsole('Exited from race menu');
                // remoteServer holds player rebuilds while the menu tears down its head parts
                (globalThis as any).__dboRaceMenuClosedAt = Date.now();

                const appearance = getAppearance(this.sp.Game.getPlayer() as Actor);
                const after = this.headState();
                this.diag(`racemenu close: ${JSON.stringify(after)}`);
                // The look goes as the editor left it; the server's guardHead (appearance.js) puts back another race's default head
                const before = this.preMenuHead;
                trace(`rm close r=${hex(after.race)} s=${after.sex} face=${hex(after.face)} race=${before && before.race === after.race ? "same" : "changed"}`
                    + ` sex=${before && before.sex === after.sex ? "same" : "changed"} facepart=${before && before.face === after.face ? "same" : "changed"} hp=${appearance.headpartIds.length}`);
                if (before && before.face && after.face !== before.face) {
                    this.diag(`racemenu: Face part ${before.face.toString(16)} -> ${after.face.toString(16)} sent as the editor left it (race ${before.race === after.race ? "same" : "changed"}, sex ${before.sex === after.sex ? "same" : "changed"}); the server's head guard decides`);
                }
                this.preMenuHead = null;
                const message: MessageWithRefrId<UpdateAppearanceMessage> = {
                    t: MsgType.UpdateAppearance,
                    data: appearance,
                    _refrId
                };
                this.controller.emitter.emit("sendMessageWithRefrId", {
                    message,
                    reliability: "reliable"
                });
            }
        }
    }

    private sendEquipment(_refrId?: number) {
        if (_refrId) {
          return;
        }
        // Coalesce bursts: rapid re-equips flood the server with reliable updates whose forced-revert snippets can freeze the client (S2)
        // While the login dress runs (remoteServer applyPcInv) the player is briefly naked; a report now
        // would be stored as the outfit. equipmentChanged stays set, so the dressed state goes out after.
        const dressUntil = Number((globalThis as any).__dboDressUntil) || 0;
        if (Date.now() < dressUntil) return;
        if (this.equipmentChanged && Date.now() - this.lastEquipmentSentMs >= 300) {
            this.lastEquipmentSentMs = Date.now();
            this.equipmentChanged = false;

            ++this.numEquipmentChanges;

            const eq = getEquipment(
                this.sp.Game.getPlayer() as Actor,
                this.numEquipmentChanges,
            );
            const message: MessageWithRefrId<UpdateEquipmentMessage> = {
                t: MsgType.UpdateEquipment,
                data: eq,
                _refrId
            };

            this.controller.emitter.emit("sendMessageWithRefrId", {
                message,
                reliability: "reliable"
            });
        }
    }

    // How many host requests leave in one update. Upstream sent one; 4754a774 (dungeon pre-spawn, 2026-09-18) raised
    // it to 25 so a pre-spawned group is hosted quickly. That is what hands a player six NPCs in a single tick, which
    // is the shape of the Niryastare and GroundedPasta crashes, so it comes down to five: a crowded cell still fills
    // its hosts within a few frames (onUpdate runs every tick), and the server stops seeing them arrive all at once.
    // Five rather than one on purpose - one would undo the dungeon change outright rather than temper it.
    private static readonly hostAttemptsPerUpdate = 5;

    private sendHostAttempts() {
        let remoteId: number | undefined;
        let count = 0;
        while ((remoteId = nextHostAttempt()) !== undefined && count < SendInputsService.hostAttemptsPerUpdate) {
            count++;
            this.controller.emitter.emit("sendMessage", {
                message: {
                    t: MsgType.Host,
                    remoteId
                },
                reliability: "reliable"
            });
        }
    }

    private getInputOwner(_refrId?: number) {
        return _refrId
            ? this.sp.Actor.from(this.sp.Game.getFormEx(worldViewMisc.remoteIdToLocalId(_refrId)))
            : this.sp.Game.getPlayer();
    }

    private getForm(refrId: number | undefined, world: WorldModel): FormModel | undefined {
        const form = refrId
            ? world?.forms.find((f) => f?.refrId === refrId)
            : world.forms[world.playerCharacterFormIdx];
        return form;
    }

    private updateActorValuesAfterAnimation(animName: string) {
        if (
            animName === 'JumpLand' ||
            animName === 'JumpLandDirectional' ||
            animName === 'DeathAnim'
        ) {
            this.actorValuesNeedUpdate = true;
        }
    }

    private get singlePlayerService() {
        return this.controller.lookupListener(SinglePlayerService);
    }

    private lastSendMovementMoment = new Map<string, number>();
    private playerAnimSource = new Map<string, AnimationSource>(); // TODO: make service
    private lastAnimationSent = new Map<string, Animation>();
    private actorValuesNeedUpdate = false;
    private isRaceSexMenuShown = false;
    private equipmentChanged = false;
    private lastSpellSignature?: string;
    private lastEquipmentSentMs = 0;
    private numEquipmentChanges = 0;
    private prevValues: ActorValues = { health: 0, stamina: 0, magicka: 0 };
    private prevActorValuesUpdateTime = 0;
    private prevCastingDetectedTime = 0;
}
