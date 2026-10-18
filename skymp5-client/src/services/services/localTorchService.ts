import { Game, ObjectLoadedEvent, ObjectReference } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { localIdToRemoteId } from "../../view/worldViewMisc";
import { noteActorCall, safeDelete } from "../../view/npcLifetimeRuntime";
import { logError } from "../../logging";

// A torch sconce (RemovableTorchSconce01, vanilla RemovableTorchSconce01SCRIPT) places its torch with PlaceAtMe on cell
// load. The server's Papyrus runs it and every client sees that torch as a copy; the client's own game runs it too, on its
// local sconce, and places a second torch only that player sees. Taking the torch disables the server's, and the local one
// stays: visible, and nothing to take (Nat, Bruma caverns, 18 Oct). A RemovableTorch01 the server never sent is removed.
const TORCH_BASE: [number, string] = [0x09151f, "Skyrim.esm"]; // RemovableTorch01
// A copy just placed by formView gets its remote id a moment after it loads; a local torch never does
const SETTLE_MS = 2000;
const PASS_MS = 1000;

export class LocalTorchService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.on("objectLoaded", (e) => this.onObjectLoaded(e));
    this.controller.on("update", () => this.onUpdate());
  }

  private onObjectLoaded(e: ObjectLoadedEvent): void {
    if (!e.isLoaded) return;
    try {
      const ref = ObjectReference.from(e.object);
      if (!ref) return;
      const id = ref.getFormID() >>> 0;
      if (id < 0xff000000 || this.seen.has(id)) return;
      const base = ref.getBaseObject();
      if (!base || (base.getFormID() >>> 0) !== this.torchBase()) return;
      this.seen.set(id, Date.now());
    } catch (err) {
      logError(this, `onObjectLoaded failed: ${err}`);
    }
  }

  private onUpdate(): void {
    const now = Date.now();
    if (now - this.lastPassMs < PASS_MS || !this.seen.size) return;
    this.lastPassMs = now;
    for (const [id, at] of Array.from(this.seen)) {
      if (now - at < SETTLE_MS) continue;
      this.seen.delete(id);
      if (localIdToRemoteId(id)) continue; // the server's torch
      const ref = ObjectReference.from(Game.getFormEx(id));
      if (!ref || ref.isDeleted()) continue;
      noteActorCall("local-torch", id);
      safeDelete(ref);
    }
  }

  private torchBase(): number {
    if (!this.baseId) {
      const f = Game.getFormFromFile(TORCH_BASE[0], TORCH_BASE[1]);
      this.baseId = f ? f.getFormID() >>> 0 : 0;
    }
    return this.baseId;
  }

  private seen = new Map<number, number>();
  private lastPassMs = 0;
  private baseId = 0;
}
