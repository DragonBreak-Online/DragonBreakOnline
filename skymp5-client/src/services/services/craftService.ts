// TODO: refactor this out
import { localIdToRemoteId } from "../../view/worldViewMisc";

import { Actor, ContainerChangedEvent, MenuCloseEvent, MenuOpenEvent, ObjectReference } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { Inventory } from "../../sync/inventory";
import { PROPERTY_KEY_BASE_ID } from "../../sync/propertyKey";
import { MsgType } from "../../messages";
import { logTrace, logError } from "../../logging";
import { trace } from "../../lib/clientDiag";
import { SeatInfo, WORKBENCH_KEYWORD, WorkbenchDiag } from "./workbenchDiag";

type FurnitureId = number;

export class CraftService extends ClientListener {
    constructor(private sp: Sp, private controller: CombinedController) {
        super();
        controller.on('containerChanged', (e) => this.onContainerChanged(e));
        controller.on('menuClose', (e) => this.onMenuClose(e));
        controller.on('menuOpen', (e) => this.onMenuOpen(e));
        controller.on('update', () => this.onUpdate());
    }

    // A report nothing arrived to close (a disenchant: the item goes and nothing comes back) is sent once the Crafting Menu
    // has been closed a moment, or once the player has left that furniture, with no result; the gamemode reads it
    // (alchemy.js onCraftUnmatched). The moment lets an item still on its way close the report the usual way
    private onMenuClose(e: MenuCloseEvent) {
        if (e.name === CRAFTING_MENU && this.furnitureStreak.size > 0) this.menuClosedAt = Date.now();
    }

    private onMenuOpen(e: MenuOpenEvent) {
        if (e.name === CRAFTING_MENU) this.workbenchDiag.menuOpened(Date.now());
    }

    private onUpdate() {
        const now = Date.now();
        if (now < this.nextCheckAt) return;
        this.nextCheckAt = now + CHECK_EVERY_MS;
        let seatedAt = 0;
        let furnitureRef: ObjectReference | null = null;
        try {
            furnitureRef = (this.sp.Game.getPlayer() as Actor).getFurnitureReference();
            seatedAt = furnitureRef ? furnitureRef.getFormID() : 0;
        } catch (e) {
            return;
        }
        const seatLine = this.workbenchDiag.seat(seatedAt, now, () => describeSeat(furnitureRef));
        if (seatLine) trace(seatLine);
        if (this.furnitureStreak.size === 0) return;
        const closed = this.menuClosedAt > 0 && now - this.menuClosedAt >= FLUSH_AFTER_CLOSE_MS;
        if (closed) this.menuClosedAt = 0;
        for (const furnitureId of Array.from(this.furnitureStreak.keys())) {
            if (closed || furnitureId !== seatedAt) this.sendCraft(furnitureId, 0, closed ? 'menu closed' : 'left the furniture');
        }
    }

    // Sends the report bundled for this furniture, if it holds anything, and forgets it
    private sendCraft(furnitureId: FurnitureId, resultObjectId: number, why: string) {
        const craftInputObjects = this.furnitureStreak.get(furnitureId);
        if (!craftInputObjects || !craftInputObjects.entries.length) {
            this.furnitureStreak.delete(furnitureId);
            return;
        }
        this.furnitureStreak.delete(furnitureId);
        const workbench = localIdToRemoteId(furnitureId);
        if (!workbench) {
            logError(this, `localIdToRemoteId returned 0 for furnitureId`, furnitureId);
            return;
        }

        logTrace(this, `Sending craft (${why}) workbench`, workbench, `resultObjectId`, resultObjectId, `craftInputObjects`, JSON.stringify(craftInputObjects.entries));

        this.controller.emitter.emit("sendMessage", {
            message: {
                t: MsgType.CraftItem,
                data: { workbench, craftInputObjects, resultObjectId },
            },
            reliability: "reliable"
        });
        this.workbenchDiag.sent();
    }

    private onContainerChanged(e: ContainerChangedEvent) {
        const oldContainerId = e.oldContainer ? e.oldContainer.getFormID() : 0;
        const newContainerId = e.newContainer ? e.newContainer.getFormID() : 0;
        const baseObjId = e.baseObj ? e.baseObj.getFormID() : 0;
        if (oldContainerId !== 0x14 && newContainerId !== 0x14) {
          return;
        }

        // No recipe takes or makes a property key (the housing system cuts them), and the periodic inventory apply takes
        // every key off and adds the server's set back (inventory.ts withKeysRebuilt): seated, that read as a craft
        if ((baseObjId >>> 0) === PROPERTY_KEY_BASE_ID) {
          return;
        }

        const furnitureRef = (this.sp.Game.getPlayer() as Actor).getFurnitureReference();
        if (!furnitureRef) {
          return;
        }

        const furnitureId = furnitureRef.getFormID();

        this.workbenchDiag.moved(oldContainerId === 0x14 ? "out" : "in");

        if (oldContainerId === 0x14 && newContainerId === 0) {
            let craftInputObjects = this.furnitureStreak.get(furnitureId);
            if (!craftInputObjects) {
                craftInputObjects = { entries: [] };
            }
            craftInputObjects.entries.push({
                baseId: baseObjId,
                count: e.numItems,
            });
            this.furnitureStreak.set(furnitureId, craftInputObjects);
            logTrace(this,
                `Adding baseObjId`, baseObjId.toString(16), `numItems`, e.numItems, `to craft`,
            );
        } else if (oldContainerId === 0 && newContainerId === 0x14) {
            logTrace(this, 'Finishing craft');
            const craftInputObjects = this.furnitureStreak.get(furnitureId);
            if (craftInputObjects && craftInputObjects.entries.length) {
                this.sendCraft(furnitureId, baseObjId, 'item arrived');
            }
        }
    }

    private furnitureStreak = new Map<FurnitureId, Inventory>();
    private menuClosedAt = 0;
    private nextCheckAt = 0;
    private workbenchDiag = new WorkbenchDiag();
}

const describeSeat = (furnitureRef: ObjectReference | null): SeatInfo | null => {
    if (!furnitureRef) return null;
    const base = furnitureRef.getBaseObject();
    let keyword = "";
    const n = base ? Math.min(base.getNumKeywords(), 16) : 0;
    for (let i = 0; i < n && !keyword; i++) {
        const name = base?.getNthKeyword(i)?.getString() || "";
        if (WORKBENCH_KEYWORD.test(name)) keyword = name;
    }
    return { remoteId: localIdToRemoteId(furnitureRef.getFormID()), baseId: base ? base.getFormID() : 0, keyword };
};

const CRAFTING_MENU = "Crafting Menu";
const CHECK_EVERY_MS = 250;
const FLUSH_AFTER_CLOSE_MS = 500;
