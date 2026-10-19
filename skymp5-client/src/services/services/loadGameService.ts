import { ClientListener, CombinedController, Sp } from "./clientListener";
import { ChangeFormNpc } from "skyrimPlatform";
import { loadGameLine } from "./loadGameDiag";

const diagNote = (kind: string, text: string): void => {
  try { const note = (globalThis as { __dboDiagNote?: (k: string, t: string) => void }).__dboDiagNote; if (typeof note === "function") note(kind, text); } catch { /* diagnostics only */ }
};

export class LoadGameService extends ClientListener {
    constructor(private sp: Sp, private controller: CombinedController) {
        super();
        this.controller.on("loadGame", () => this.onLoadGame());
    }

    public loadGame(pos: number[], rot: number[], worldOrCell: number, changeFormNpc?: ChangeFormNpc, loadOrder?: string[], time?: { seconds: number, minutes: number, hours: number }) {
        let line = "";
        try { line = loadGameLine(pos, rot, worldOrCell, changeFormNpc, loadOrder, time); } catch (e) { line = `unreadable: ${e}`; }
        diagNote("loadGame", line);
        // Services that repeat Papyrus calls hold them until the game reports this load done: a call still queued in the
        // VM when the load starts runs after it against the reset VM (DisableDifficultySelectionService, 19 Oct)
        (globalThis as { __dboLoadPending?: boolean }).__dboLoadPending = true;
        try {
            // @ts-ignore
            this.sp.loadGame(pos, rot, worldOrCell, changeFormNpc, loadOrder, time);
        } catch (e) {
            diagNote("loadGame", `threw (${String(e).slice(0, 120)}); retried without the character`);
            // Hotfix non-vanilla headparts bug
            try {
                // @ts-ignore
                this.sp.loadGame(pos, rot, worldOrCell, undefined, loadOrder, time);
            } catch (e2) {
                (globalThis as { __dboLoadPending?: boolean }).__dboLoadPending = false;
                throw e2;
            }
        }
        this._isCausedBySkyrimPlatform = true;
    }

    private onLoadGame() {
        (globalThis as { __dboLoadPending?: boolean }).__dboLoadPending = false;
        try {
            const gameLoadEvent = {
                isCausedBySkyrimPlatform: this._isCausedBySkyrimPlatform
            };
            this.controller.emitter.emit("gameLoad", gameLoadEvent);
        } catch (e) {
            this.controller.once("tick", () => {
                this._isCausedBySkyrimPlatform = false;
            });
            throw e;
        }
        this.controller.once("tick", () => {
            this._isCausedBySkyrimPlatform = false;
        });
    }

    private _isCausedBySkyrimPlatform = false;
}
