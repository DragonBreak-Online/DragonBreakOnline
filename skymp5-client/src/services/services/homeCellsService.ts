import { ActorBase, Cell, CellFullyLoadedEvent, Faction } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { ConnectionMessage } from "../events/connectionMessage";
import { CreateActorMessage } from "../messages/createActorMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { parseCustomPacket } from "./customPacketUtil";
import { logError, logTrace } from "../../logging";
import { DisplacedOwner, decideHomeCell, parseHomeCells } from "./homeCellsPlan";

// Nat, 31 Oct: players get "stolen" items out of their own home barrels. Skyrim's crime system sees the
// plugin's containers as NPC-owned (XOWN on the ref or its cell), so taking from them is theft, and the hold's
// guards act on it. The server tells each client which cells that player owns outright (housingSystem
// homeCells, sent at login and after any ownership change) and this makes the player the cell's actor owner,
// which is what vanilla checks before calling anything a crime.
//
// Cell-level and for the SOLE OWNER only, nothing for decorate rights (Nat via the Leader): owning a cell
// makes everything in it un-stealable, which is right for your own house and wrong for a shared one, where a
// co-decorator could then take a housemate's stored goods without it being theft.
//
// Two rules this file exists to enforce, both learned from this codebase rather than assumed:
//   - natives throw in the packet context, so a packet only records ids and defers the work to an update;
//   - a native object kept across frames is invalid after the next Papyrus update, so nothing here stores a
//     Cell or an ActorBase. Only form ids are kept, and handles are re-resolved each time they are used.

export class HomeCellsService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.on("cellFullyLoaded", (e) => this.onCellFullyLoaded(e));
    this.controller.emitter.on("customPacketMessage", (e) => this.onCustomPacketMessage(e));
    this.controller.emitter.on("createActorMessage", (e) => this.onCreateActorMessage(e));
  }

  private owned = new Set<number>();
  // cell form id -> what we displaced there, 0 for a field the cell did not have
  private taken = new Map<number, DisplacedOwner>();

  private onCustomPacketMessage(e: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(e);
    if (!content || content["customPacketType"] !== "homeCells") {
      return;
    }
    // An empty or missing list is meaningful: it is what arrives when the last property is given up, and it
    // has to reach reconcile so the cells we changed are handed back.
    this.owned = parseHomeCells(content);
    logTrace(this, `owns ${this.owned.size} cell(s)`);
    // Natives throw in the packet context. An ownership change can also take a cell away, so the loaded cell
    // is reconciled rather than only ever claimed.
    this.controller.once("update", () => this.reconcileLoadedCell());
  }

  private onCellFullyLoaded(e: CellFullyLoadedEvent): void {
    if (e.cell) {
      this.applyTo(e.cell);
    }
  }

  // The cell the player spawns into may have attached before this service saw a cellFullyLoaded event, and
  // the homeCells packet itself arrives around login. Both are covered by reconciling once on our own actor.
  private onCreateActorMessage(e: ConnectionMessage<CreateActorMessage>): void {
    if (!e.message.isMe) {
      return;
    }
    this.controller.once("update", () => this.reconcileLoadedCell());
  }

  private reconcileLoadedCell(): void {
    try {
      const cell = this.sp.Game.getPlayer()?.getParentCell();
      if (cell) {
        this.applyTo(cell);
      }
      // A cell we changed that the player is no longer standing in still has to be given back, and only its
      // id is kept, so it is re-resolved here.
      // Collected first with forEach, not spread: this target has no downlevelIteration, and the loop deletes
      // from the same map it is walking
      const held: number[] = [];
      this.taken.forEach((_v, cellId) => held.push(cellId));
      for (const cellId of held) {
        if (this.owned.has(cellId)) {
          continue;
        }
        const stale = Cell.from(this.sp.Game.getFormEx(cellId));
        if (stale) {
          this.applyTo(stale);
        } else {
          // Not loaded, so nothing to put back now; forget it rather than hold an id we can never act on
          this.taken.delete(cellId);
        }
      }
    } catch (err) {
      logError(this, `reconcileLoadedCell failed: ${err}`);
    }
  }

  private applyTo(cell: Cell): void {
    try {
      const cellId = cell.getFormID() >>> 0;
      const playerBase = ActorBase.from(this.sp.Game.getPlayer()?.getBaseObject() ?? null);
      const playerBaseId = playerBase ? playerBase.getFormID() >>> 0 : 0;
      if (!playerBaseId) {
        return;
      }
      const currentOwner = cell.getActorOwner();
      const currentOwnerId = currentOwner ? currentOwner.getFormID() >>> 0 : 0;
      const currentFaction = cell.getFactionOwner();
      const currentFactionId = currentFaction ? currentFaction.getFormID() >>> 0 : 0;
      const action = decideHomeCell(
        this.owned,
        this.taken,
        cellId,
        cell.isInterior(),
        currentOwnerId,
        currentFactionId,
        playerBaseId
      );
      if (action === "none") {
        return;
      }
      if (action === "take") {
        // Recorded before either write, and only if we have not recorded this cell already: walking back into
        // a cell we own would otherwise overwrite the plugin's owner with our own and lose it for good.
        if (!this.taken.has(cellId)) {
          this.taken.set(cellId, { owner: currentOwnerId, faction: currentFactionId });
        }
        cell.setActorOwner(playerBase);
        if (currentFactionId) {
          cell.setFactionOwner(null);
        }
        logTrace(
          this,
          `cell ${cellId.toString(16)} is now the player's own ` +
            `(was actor ${currentOwnerId.toString(16)}, faction ${currentFactionId.toString(16)})`
        );
        return;
      }
      // restore
      const previous = this.taken.get(cellId) ?? { owner: 0, faction: 0 };
      cell.setActorOwner(previous.owner ? ActorBase.from(this.sp.Game.getFormEx(previous.owner)) : null);
      if (previous.faction) {
        cell.setFactionOwner(Faction.from(this.sp.Game.getFormEx(previous.faction)));
      }
      this.taken.delete(cellId);
      logTrace(
        this,
        `cell ${cellId.toString(16)} given back to actor ${previous.owner.toString(16)}, ` +
          `faction ${previous.faction.toString(16)}`
      );
    } catch (err) {
      logError(this, `applyTo failed: ${err}`);
    }
  }
}
