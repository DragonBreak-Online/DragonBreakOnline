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
        try {
            // @ts-ignore
            this.sp.loadGame(pos, rot, worldOrCell, changeFormNpc, loadOrder, time);
        } catch (e) {
            diagNote("loadGame", `threw (${String(e).slice(0, 120)}); retried without the character`);
            // Hotfix non-vanilla headparts bug
            // @ts-ignore
            this.sp.loadGame(pos, rot, worldOrCell, undefined, loadOrder, time);
        }
        this._isCausedBySkyrimPlatform = true;
    }

    private onLoadGame() {
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
