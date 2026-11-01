import { ClientListener, CombinedController, Sp } from "./clientListener";
import { parseCustomPacket, sendCustomPacket } from "./customPacketUtil";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { logError } from "../../logging";
import { CARD, ITEM_MENUS, SELECTED_FORM } from "./itemCardProbeService";
import { ArmourInfo, armourColor, armourLabel, readArmourAnswer, shouldAsk } from "./armourCardPlan";

// Draws the armour's tier, class and Defense on SkyUI's item card where "Heavy Armor" / "Light Armor" stands, while the
// inventory, a container or a barter is open. SkyUI rewrites that line on every highlight, so it is put back each frame.
export class ArmourCardService extends ClientListener {
  private infos = new Map<number, { info: ArmourInfo | null; at: number }>();
  private asked = new Map<number, number>();
  private defense: number | null = null;
  private failed = false;

  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onMessage(e));
    this.controller.emitter.on("connectionAccepted", () => { this.infos.clear(); this.asked.clear(); this.defense = null; });
    this.controller.on("update", () => this.onUpdate());
  }

  private onMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    const answer = readArmourAnswer(parseCustomPacket(event));
    if (!answer) return;
    this.infos.set(answer.id, { info: answer.info, at: Date.now() });
    if (answer.defense !== null) this.defense = answer.defense;
  }

  private onUpdate(): void {
    if (this.failed) return;
    const ui = this.sp.Ui;
    try {
      const menu = ITEM_MENUS.find((m) => ui.isMenuOpen(m));
      if (!menu) return;
      const id = ui.getInt(menu, SELECTED_FORM) >>> 0;
      if (!id) return;
      const now = Date.now(), known = this.infos.get(id);
      if (shouldAsk(id, known && known.at, this.asked.get(id), now)) {
        this.asked.set(id, now);
        sendCustomPacket(this.controller, { customPacketType: "dbo", event: "armourInfo", args: [id], widget: 0 });
      }
      if (!known || !known.info) return;
      const label = armourLabel(known.info);
      if (ui.getString(menu, `${CARD}.SkillTextInstance.text`) === label) return;
      ui.setString(menu, `${CARD}.SkillTextInstance.text`, label);
      ui.setInt(menu, `${CARD}.SkillTextInstance.textColor`, armourColor(known.info, this.defense));
    } catch (e) {
      // A SkyUI build without these paths: stop for the session rather than throw every frame
      this.failed = true;
      logError(this, "the item card's armour line is off for this session", e);
    }
  }
}
