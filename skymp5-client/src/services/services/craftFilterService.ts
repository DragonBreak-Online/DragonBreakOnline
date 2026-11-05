import { ClientListener, CombinedController, Sp } from "./clientListener";
import { parseCustomPacket } from "./customPacketUtil";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { ConstructibleObject, Keyword } from "skyrimPlatform";
import { logError, logTrace } from "../../logging";

export class CraftFilterService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onPacket(e));
    this.controller.emitter.on("connectionDisconnect", () => this.restoreAll());
    this.controller.emitter.on("gameLoad", () => { this.reapply(); });
  }

  private onPacket(event: ConnectionMessage<CustomPacketMessage>): void {
    const packet = parseCustomPacket(event);
    if (!packet || packet["customPacketType"] !== "dboCraftFilter") return;
    const lockedList = packet["locked"];
    if (!Array.isArray(lockedList)) return;
    this.updateLocked(lockedList);
  }

  // Restore all modified constructible objects to their original bench keywords
  private restoreAll(): void {
    if (this.origKeywords.size === 0) return;
    let restored = 0;
    this.origKeywords.forEach((origKw, formId) => {
      try {
        const cobj = ConstructibleObject.from(this.sp.Game.getFormEx(formId));
        if (cobj) {
          cobj.setWorkbenchKeyword(origKw);
          restored++;
        }
      } catch {
        // ignore
      }
    });
    this.origKeywords.clear();
    this.lockedFormIds.clear();
    if (restored > 0) {
      logTrace(this, "Craft filter: restored recipes", restored);
    }
  }

  private getDummyKeyword(): Keyword | null {
    if (this.dummyKw) return this.dummyKw;
    try {
      const kw = Keyword.from(this.sp.Game.getFormFromFile(0x0008f959, "Skyrim.esm")) ||
                 Keyword.from(this.sp.Game.getFormEx(0x0008f959));
      if (kw) {
        this.dummyKw = kw;
        return kw;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private formFromDesc(desc: string): number {
    let id = this.descToId.get(desc);
    if (id !== undefined) return id;
    const sep = desc.indexOf(":");
    if (sep > 0) {
      const localId = parseInt(desc.slice(0, sep), 16);
      const plugin = desc.slice(sep + 1);
      const form = this.sp.Game.getFormFromFile(localId, plugin);
      id = form ? form.getFormID() : 0;
    } else {
      id = parseInt(desc, 16) || 0;
    }
    this.descToId.set(desc, id);
    return id;
  }

  private resolveFormId(entry: unknown): number {
    if (typeof entry === "number") return entry >>> 0;
    if (typeof entry === "string") return this.formFromDesc(entry);
    return 0;
  }

  private updateLocked(newList: unknown[]): void {
    const dummy = this.getDummyKeyword();
    if (!dummy) {
      logError(this, "Craft filter: failed to resolve dummy keyword");
      return;
    }

    const nextLocked = new Set<number>();
    newList.forEach((item) => {
      const formId = this.resolveFormId(item);
      if (formId > 0) {
        nextLocked.add(formId);
      }
    });

    let newlyLocked = 0;
    let newlyUnlocked = 0;

    // 1. Unlock recipes that are no longer in nextLocked
    const toUnlock: number[] = [];
    this.origKeywords.forEach((_, formId) => {
      if (!nextLocked.has(formId)) {
        toUnlock.push(formId);
      }
    });

    toUnlock.forEach((formId) => {
      const origKw = this.origKeywords.get(formId);
      try {
        const cobj = ConstructibleObject.from(this.sp.Game.getFormEx(formId));
        if (cobj) {
          cobj.setWorkbenchKeyword(origKw ?? null);
          newlyUnlocked++;
        }
      } catch {
        // ignore
      }
      this.origKeywords.delete(formId);
    });

    // 2. Lock recipes in nextLocked
    nextLocked.forEach((formId) => {
      if (!this.origKeywords.has(formId)) {
        try {
          const cobj = ConstructibleObject.from(this.sp.Game.getFormEx(formId));
          if (cobj) {
            const orig = cobj.getWorkbenchKeyword();
            this.origKeywords.set(formId, orig);
            cobj.setWorkbenchKeyword(dummy);
            newlyLocked++;
          }
        } catch {
          // ignore
        }
      }
    });

    this.lockedFormIds = nextLocked;
    logTrace(this, "Craft filter updated", `locked=${nextLocked.size} (+${newlyLocked}/-${newlyUnlocked})`);
  }

  private reapply(): void {
    const dummy = this.getDummyKeyword();
    if (!dummy) return;
    this.lockedFormIds.forEach((formId) => {
      try {
        const cobj = ConstructibleObject.from(this.sp.Game.getFormEx(formId));
        if (cobj) {
          cobj.setWorkbenchKeyword(dummy);
        }
      } catch {
        // ignore
      }
    });
  }

  private origKeywords = new Map<number, Keyword | null>();
  private lockedFormIds = new Set<number>();
  private descToId = new Map<string, number>();
  private dummyKw: Keyword | null = null;
}
