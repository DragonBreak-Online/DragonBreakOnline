import { ClientListener, CombinedController, Sp } from "./clientListener";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { parseCustomPacket } from "./customPacketUtil";
import { logTrace } from "../../logging";
import { readLearned, readForget, toForget } from "./learnedEnchantments";

/**
 * Marks known again the enchantments a character learned at the table (#bugs thread 7: gone after a relog, because the
 * game keeps them in a save a SkyMP client never loads). The server keeps them per character and sends them at login
 * (dboEnchLearned); each magic effect is set known with Form.setPlayerKnows(true), as the arcane enchanter does when it
 * teaches one. Ids the game does not have are skipped. Ids set for another character earlier in this game session and missing
 * from the list are set unknown first, so each character knows only its own (an empty list clears them all).
 */
export class LearnedEnchantmentsService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onCustomPacketMessage(e));
  }

  private onCustomPacketMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(event);
    const effects = readLearned(content);
    if (!effects) return;
    const forget = readForget(content);
    this.controller.once("update", () => {
      let known = 0, missing = 0, forgot = 0;
      for (const id of toForget(this.setThisSession, effects, forget)) {
        const form = this.sp.Game.getFormEx(id);
        try { if (form) { form.setPlayerKnows(false); forgot++; } } catch { /* gone from this game */ }
      }
      this.setThisSession = effects.slice();
      for (const id of effects) {
        const form = this.sp.Game.getFormEx(id);
        if (!form) { missing++; continue; }
        try { form.setPlayerKnows(true); known++; } catch { missing++; }
      }
      logTrace(this, `Learned enchantments restored`, known, `missing`, missing, `forgotten`, forgot);
      const note = (globalThis as { __dboDiagNote?: (kind: string, text: string) => void }).__dboDiagNote;
      try { if (typeof note === "function") note("enchLearned", `restored ${known} effect(s), ${missing} not in this game, ${forgot} from another character forgotten`); } catch { /* diagnostics only */ }
    });
  }

  // What this game session has set known through the server's lists, for whichever character was playing
  private setThisSession: number[] = [];
}
