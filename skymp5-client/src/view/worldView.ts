import { Form } from "skyrimPlatform";

import { WorldModel } from './model';
import { FormViewArray } from './formViewArray';
import { PlayerCharacterDataHolder } from './playerCharacterDataHolder';
import { ClientListener, CombinedController, Sp } from '../services/services/clientListener';
import { logTrace } from "../logging";
import { SinglePlayerService } from "../services/services/singlePlayerService";
import { RemoteServer } from "../services/services/remoteServer";
import { FormViewGate, GATE_FALLBACK_SECONDS } from "./formViewGate";

const diagNote = (kind: string, text: string): void => {
  try { const note = (globalThis as { __dboDiagNote?: (k: string, t: string) => void }).__dboDiagNote; if (typeof note === "function") note(kind, text); } catch { /* diagnostics only */ }
};

export class WorldView extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();

    controller.on("update", () => this.onUpdate());
    controller.once("update", () => this.onceUpdate());

    this.state = this.makeEmptyState();

    const oldView = this.sp.storage["view"];

    // can't use instanceof here because each hot reload creates a new class
    this.oldView = typeof oldView === "object" ? oldView as WorldView : undefined;

    this.sp.storage["view"] = this;
  }

  getRemoteRefrId(clientsideRefrId: number): number {
    return this.state.formViews.getRemoteRefrId(clientsideRefrId);
  }

  getLocalRefrId(remoteRefrId: number): number {
    return this.state.formViews.getLocalRefrId(remoteRefrId);
  }

  isPlayerCharacter(remoteRefrId: number): boolean {
    return this.state.formViews.isPlayerCharacter(remoteRefrId);
  }

  syncFormArray(model: WorldModel) {
    const { settings } = this.sp;
    const showMe = settings['skymp5-client']['show-me'];
    this.state.formViews.syncFormView(model, !!showMe);
  }

  destroy() {
    this.state.formViews.resize(0);
    this.state.cloneFormViews.resize(0); // Recenrly added, not tested if it's needed
    this.state = this.makeEmptyState();
  }

  getFormViews() {
    return this.state.formViews;
  }

  private onUpdate() {
    this.openGateIfDue();
    this.resetAllFormViewsIfPlayerChangedWorld();

    const singlePlayerService = this.controller.lookupListener(SinglePlayerService);
    if (!singlePlayerService.isSinglePlayer) {
      const modelSource = this.controller.lookupListener(RemoteServer);
      this.updateWorld(modelSource.getWorldModel());
    }
  }

  private onceUpdate() {
    if (this.oldView) {
      this.oldView.destroy();
      this.oldView = undefined;
      logTrace(this, 'Previous View destroyed');
    }
    this.waitGameTimeAndAllowFormViewUpdate(1.0);
  }

  private resetAllFormViewsIfPlayerChangedWorld() {
    const state = this.state;
    const pc = this.sp.Game.getPlayer()!;
    const pcWorldOrCell = (
      (pc.getWorldSpace() || pc.getParentCell()) as Form
    ).getFormID();
    if (state.pcWorldOrCell !== pcWorldOrCell) {
      if (state.pcWorldOrCell) {
        logTrace(this, 'Reset all form views');
        state.formViews.resize(0);
        state.cloneFormViews.resize(0);
      }
      state.pcWorldOrCell = pcWorldOrCell;
    }
  }

  // Work around showRaceMenu issue
  // Default nord in Race Menu will have very ugly face
  // If other players are spawning when we show this menu
  // TODO: separate listener
  public waitGameTimeAndAllowFormViewUpdate(seconds: number) {
    // Counted on updates in openGateIfDue (time spent in Race Menu isn't counted); the Papyrus wait only reports when it returns
    const armedAt = Date.now();
    this.gate.arm(seconds, armedAt);
    this.sp.Utility.wait(seconds).then(() => diagNote("fv:gate", `papyrus wait returned after ${Date.now() - armedAt} ms`));
  }

  public setFormViewUpdateAllowed(allowed: boolean) {
    this.state.allowUpdate = allowed;
    if (allowed) this.gate.disarm();
    else this.gate.arm(GATE_FALLBACK_SECONDS, Date.now());
    logTrace(this, 'Update is now', allowed ? 'allowed' : 'disallowed');
  }

  private openGateIfDue() {
    if (this.state.allowUpdate || !this.gate.isArmed()) return;
    let paused = false;
    try { paused = this.sp.Ui.isMenuOpen("RaceSex Menu") || this.sp.Ui.isMenuOpen("Loading Menu"); } catch (e) { /* counted as play */ }
    const now = Date.now();
    if (!this.gate.tick(now, paused)) return;
    this.state.allowUpdate = true;
    logTrace(this, 'Update is now allowed');
    diagNote("fv:gate", `open after ${this.gate.ageMs(now)} ms`);
  }

  private gate = new FormViewGate();

  private updateWorld(model: WorldModel): void {
    const { settings } = this.sp;
    const state = this.state;

    if (!state.allowUpdate) {
      model = {
        forms: [],
        playerCharacterFormIdx: model.playerCharacterFormIdx,
        playerCharacterRefrId: model.playerCharacterRefrId
      }
    }

    const skipUpdates = settings['skymp5-client']['skipUpdates'];

    // skip 50% of updates if specified in the settings
    state.counter = !state.counter;
    if (state.counter && skipUpdates) {
      return;
    }

    state.formViews.resize(model.forms.length);

    const showMe = settings['skymp5-client']['show-me'];
    const showClones = settings['skymp5-client']['show-clones'];

    PlayerCharacterDataHolder.updateData();

    state.formViews.updateAll(model, !!showMe, false);

    if (showClones) {
      state.cloneFormViews.updateAll(model, false, true);
    } else {
      state.cloneFormViews.resize(0);
    }
  }

  private makeEmptyState() {
    return {
      formViews: new FormViewArray(),
      cloneFormViews: new FormViewArray(),
      allowUpdate: false,
      pcWorldOrCell: 0,
      counter: false,
    }
  }

  private state: {
    formViews: FormViewArray;
    cloneFormViews: FormViewArray;
    allowUpdate: boolean;
    pcWorldOrCell: number;
    counter: boolean;
  };

  private oldView?: WorldView;
}
