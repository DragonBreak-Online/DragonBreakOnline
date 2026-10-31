import { ClientListener, CombinedController, Sp } from "./clientListener";
import { parseCustomPacket, sendCustomPacket } from "./customPacketUtil";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { logTrace } from "../../logging";

// One-shot test for the armour tier line on SkyUI's item card (_work/itemcard-route-1031.md), armed by /testmenu itemcard.
export const ITEM_MENUS = ["InventoryMenu", "BarterMenu", "ContainerMenu"];
export const CARD = "_root.Menu_mc.itemCardFadeHolder.ItemCard_mc";
export const SELECTED_FORM = "_root.Menu_mc.inventoryLists.itemList.selectedEntry.formId";
const PROBE_LABEL = "Tier 3 · Medium · Defense 30";
const PROBE_COLOR = 0xe0c060;
const ARMED_MS = 10 * 60 * 1000;

export class ItemCardProbeService extends ClientListener {
  private armedUntil = 0;
  private tick = 0;
  private results: Record<string, unknown> = {};

  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onMessage(e));
    this.controller.on("update", () => this.onUpdate());
  }

  private onMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(event);
    if (!content || content["customPacketType"] !== "dboItemCardTest") return;
    this.armedUntil = Date.now() + ARMED_MS;
    this.tick = 0;
    this.results = {};
    logTrace(this, "item card test armed for the next item menu with an item highlighted");
  }

  private onUpdate(): void {
    if (!this.armedUntil) return;
    if (Date.now() > this.armedUntil) return this.finish("never ran: no item menu with an item highlighted in 10 minutes");
    const ui = this.sp.Ui;
    const menu = ITEM_MENUS.find((m) => ui.isMenuOpen(m));
    if (!menu) { if (this.tick) this.finish("the menu closed"); return; }
    if (this.tick === 0 && !(ui.getInt(menu, SELECTED_FORM) !== 0)) return;
    this.tick++;
    const text = `${CARD}.SkillTextInstance.text`, color = `${CARD}.SkillTextInstance.textColor`;
    if (this.tick === 1) {
      this.results = { menu, formId: ui.getInt(menu, SELECTED_FORM).toString(16), before: ui.getString(menu, text), colorBefore: ui.getInt(menu, color) };
      ui.setString(menu, text, PROBE_LABEL);
      ui.setInt(menu, color, PROBE_COLOR);
    }
    if (this.tick === 2) Object.assign(this.results, { after: ui.getString(menu, text), colorAfter: ui.getInt(menu, color) });
    // Still ours a second later with the same item highlighted, before any redraw
    if (this.tick === 60) {
      Object.assign(this.results, { after60: ui.getString(menu, text), formId60: ui.getInt(menu, SELECTED_FORM).toString(16) });
      this.finish("done");
    }
  }

  private finish(why: string): void {
    this.armedUntil = 0;
    this.tick = 0;
    this.results.end = why;
    sendCustomPacket(this.controller, { customPacketType: "dbo", event: "itemCardTest", args: [this.results], widget: 0 });
    logTrace(this, "item card test", JSON.stringify(this.results));
  }
}
