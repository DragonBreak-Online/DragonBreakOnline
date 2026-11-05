import { ClientListener, CombinedController, Sp } from "./clientListener";
import { parseCustomPacket } from "./customPacketUtil";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { ConstructibleObject, Keyword } from "skyrimPlatform";
import { logError, logTrace } from "../../logging";

const BATCH_SIZE = 100;
const DUMMY_KEYWORD_FORMID = 0x0008f959; // VendorItemArmor in Skyrim.esm

export class CraftFilterService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onPacket(e));
    this.controller.emitter.on("connectionDisconnect", () => this.restoreAll());
    this.controller.emitter.on("gameLoad", () => { this.reapplyPending = true; });
    this.controller.on("update", () => this.onUpdate());
  }

  private onPacket(event: ConnectionMessage<CustomPacketMessage>): void {
    const packet = parseCustomPacket(event);
    if (!packet || packet["customPacketType"] !== "dboCraftFilter") return;
    const lockedList = packet["locked"];
    if (!Array.isArray(lockedList)) return;
    this.pendingRawList = lockedList;
    this.hasPendingPacket = true;
  }

  private onUpdate(): void {
    if (this.hasPendingPacket) {
      this.hasPendingPacket = false;
      this.planUpdates(this.pendingRawList);
    }

    if (this.reapplyPending) {
      this.reapplyPending = false;
      this.queueReapply();
    }

    this.processQueue();
  }

  private getDummyKeyword(): Keyword | null {
    if (this.dummyKw) return this.dummyKw;
    try {
      this.dummyKw = Keyword.from(this.sp.Game.getFormFromFile(DUMMY_KEYWORD_FORMID, "Skyrim.esm")) ||
                     Keyword.from(this.sp.Game.getFormEx(DUMMY_KEYWORD_FORMID));
    } catch {
      this.dummyKw = null;
    }
    return this.dummyKw;
  }

  private formFromDesc(desc: string): number {
    let id = this.descToId.get(desc);
    if (id !== undefined) return id;
    id = 0;
    try {
      const sep = desc.indexOf(":");
      if (sep > 0) {
        const localId = parseInt(desc.slice(0, sep), 16);
        const plugin = desc.slice(sep + 1);
        const form = this.sp.Game.getFormFromFile(localId, plugin);
        id = form ? (form.getFormID() >>> 0) : 0;
      } else {
        id = (parseInt(desc, 16) >>> 0) || 0;
      }
    } catch {
      id = 0;
    }
    this.descToId.set(desc, id);
    return id;
  }

  private planUpdates(rawList: unknown[]): void {
    const newTargetSet = new Set<string>();
    rawList.forEach((item) => {
      if (typeof item === "string" && item.length > 0) {
        newTargetSet.add(item);
      }
    });

    // Descriptors that should no longer be locked -> queue for unlock
    this.currentLockedDescSet.forEach((desc) => {
      if (!newTargetSet.has(desc)) {
        if (!this.unlockQueue.includes(desc)) {
          this.unlockQueue.push(desc);
        }
      }
    });

    // Descriptors that need to be locked -> queue for lock
    newTargetSet.forEach((desc) => {
      if (!this.currentLockedDescSet.has(desc)) {
        if (!this.lockQueue.includes(desc)) {
          this.lockQueue.push(desc);
        }
      }
    });

    this.currentLockedDescSet = newTargetSet;
  }

  private queueReapply(): void {
    this.currentLockedDescSet.forEach((desc) => {
      if (!this.lockQueue.includes(desc)) {
        this.lockQueue.push(desc);
      }
    });
  }

  private processQueue(): void {
    const dummy = this.getDummyKeyword();
    if (!dummy) return;

    let budget = BATCH_SIZE;

    // 1. Process unlocks
    while (this.unlockQueue.length > 0 && budget > 0) {
      const desc = this.unlockQueue.shift();
      budget--;
      if (!desc) continue;

      const origKw = this.origKeywords.get(desc);
      const formId = this.formFromDesc(desc);
      if (formId > 0) {
        try {
          const cobj = ConstructibleObject.from(this.sp.Game.getFormEx(formId));
          if (cobj) {
            cobj.setWorkbenchKeyword(origKw ?? null);
          }
        } catch {
          // ignore
        }
      }
      this.origKeywords.delete(desc);
    }

    // 2. Process locks
    while (this.lockQueue.length > 0 && budget > 0) {
      const desc = this.lockQueue.shift();
      budget--;
      if (!desc) continue;

      const formId = this.formFromDesc(desc);
      if (formId > 0) {
        try {
          const cobj = ConstructibleObject.from(this.sp.Game.getFormEx(formId));
          if (cobj) {
            if (!this.origKeywords.has(desc)) {
              const orig = cobj.getWorkbenchKeyword();
              this.origKeywords.set(desc, orig);
            }
            cobj.setWorkbenchKeyword(dummy);
          }
        } catch {
          // ignore
        }
      }
    }
  }

  private restoreAll(): void {
    this.unlockQueue = [];
    this.lockQueue = [];
    this.currentLockedDescSet.clear();

    this.origKeywords.forEach((origKw, desc) => {
      const formId = this.formFromDesc(desc);
      if (formId > 0) {
        try {
          const cobj = ConstructibleObject.from(this.sp.Game.getFormEx(formId));
          if (cobj) {
            cobj.setWorkbenchKeyword(origKw ?? null);
          }
        } catch {
          // ignore
        }
      }
    });
    this.origKeywords.clear();
  }

  private pendingRawList: unknown[] = [];
  private hasPendingPacket = false;
  private reapplyPending = false;

  private currentLockedDescSet = new Set<string>();
  private unlockQueue: string[] = [];
  private lockQueue: string[] = [];

  private origKeywords = new Map<string, Keyword | null>();
  private descToId = new Map<string, number>();
  private dummyKw: Keyword | null = null;
}
