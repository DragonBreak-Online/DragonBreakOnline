import { ClientListener, Sp, CombinedController } from "./clientListener";

// Keeps the difficulty at Legendary: the settings menu could change it, so it is set again every 60 frames, in game only.
// Before the first game load it made no difference and it was the only Papyrus call repeating at the main menu and
// character select: three 0.3.104 logins crashed at SkyrimSE.exe+144EF1A (19 Oct 05:52-05:54Z), the Papyrus VM finishing
// a queued call on a stack with no frame left (Stack::top null) right after the spawn save loaded, a
// NativeFunction2<StaticFunctionTag, void, BSFixedString const&, unsigned int> on the stack. A call queued just before
// the load ran against the VM the load had reset. Nothing is queued now until the first load is done, nor while a load
// the client started (LoadGameService, __dboLoadPending) is still under way
export class DisableDifficultySelectionService extends ClientListener {
    constructor(private sp: Sp, private controller: CombinedController) {
        super();
        this.controller.on("update", () => this.onUpdate());
        this.controller.on("loadGame", () => { this.inGame = true; });
    }

    private onUpdate() {
        if (!this.inGame || (globalThis as { __dboLoadPending?: boolean }).__dboLoadPending === true) {
            this.counter = 0;
            return;
        }
        this.counter++;
        if (this.counter >= 60) {
            this.counter = 0;
            this.sp.Utility.setINIInt("iDifficulty:GamePlay", this.difficulty);
        }
    }

    private readonly difficulty = 5;

    private counter = 0;

    private inGame = false;
}
