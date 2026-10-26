import { Actor, createText, destroyText, Game, NetImmerse, setTextColor, setTextPos, setTextSize, setTextString, worldPointToScreenPoint } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { parseCustomPacket } from "./customPacketUtil";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { remoteIdToLocalId } from "../../view/worldViewMisc";
import { getScreenResolution } from "../../view/formView";
import { LabelWanted, parseLabels, shouldDraw } from "./actorLabelPlan";

// A name over a boss's head (Nat, 25 Oct: "can bosses have names over their head so we know what's a boss").
//
// The server sends dboActorLabels (actorLabelPlan.ts has the shape and the rules) to players near a boss; each label is drawn
// above the actor's head (head node + LABEL_HEIGHT, in screen space) while its actor is alive, in line of sight and within
// MAX_DISTANCE, and hidden otherwise. The client announces 'actorLabels' in its UI caps (lib/clientUiCaps.ts).
const HEAD = "NPC Head [Head]";
// Above TrueHUD's health bar (Nat 26 Oct: "can the name be ... above the health"): the bar is drawn at the head + 30
// (TrueHUD MCM fInfoBarOffsetZ 30, uInfoBarAnchor 1), so a label at + 32, as the nametags sit, lay on it. 72 clears the bar
// and keeps clear at any distance: both are world offsets, and the bar scales with distance (bInfoBarScaleWithDistance)
const LABEL_HEIGHT = 72;
const TEXT_SIZE = 0.5;

interface Entry extends LabelWanted { textId: number; shown: string; shownColor: string }

export class ActorLabelService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onCustomPacketMessage(e));
    this.controller.on("update", () => this.onUpdate());
  }

  private onCustomPacketMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(event);
    if (!content || content["customPacketType"] !== "dboActorLabels") return;
    const wanted = parseLabels(content);
    for (const id of Array.from(this.entries.keys())) if (!wanted.has(id)) this.drop(id);
    for (const [id, w] of Array.from(wanted.entries())) {
      const cur = this.entries.get(id);
      if (cur) { cur.text = w.text; cur.color = w.color; } else this.entries.set(id, { text: w.text, color: w.color, textId: 0, shown: "", shownColor: "" });
    }
  }

  private onUpdate(): void {
    if (this.entries.size === 0) return;
    const player = Game.getPlayer();
    if (!player) return;
    const res = getScreenResolution();
    for (const [id, e] of Array.from(this.entries.entries())) {
      let actor: Actor | null = null;
      try { actor = Actor.from(Game.getFormEx(remoteIdToLocalId(id))); } catch { actor = null; }
      let draw = false;
      try { draw = shouldDraw({ found: !!actor, dead: !!actor && actor.isDead(), distance: actor ? player.getDistance(actor) : Infinity, los: !!actor && player.hasLOS(actor) }); } catch { draw = false; }
      if (!draw || !actor) { this.hide(e); continue; }
      const p = worldPointToScreenPoint([
        NetImmerse.getNodeWorldPositionX(actor, HEAD, false),
        NetImmerse.getNodeWorldPositionY(actor, HEAD, false),
        NetImmerse.getNodeWorldPositionZ(actor, HEAD, false) + LABEL_HEIGHT,
      ])[0];
      if (!p || p[2] <= 0) { this.hide(e); continue; }
      const x = Math.round(p[0] * res.width);
      const y = Math.round((1 - p[1]) * res.height);
      const color = e.color.join(",");
      if (!e.textId) {
        e.textId = createText(x, y, e.text, e.color);
        setTextSize(e.textId, TEXT_SIZE);
        e.shown = e.text; e.shownColor = color;
      } else {
        setTextPos(e.textId, x, y);
        if (e.shown !== e.text) { setTextString(e.textId, e.text); e.shown = e.text; }
        if (e.shownColor !== color) { setTextColor(e.textId, e.color); e.shownColor = color; }
      }
    }
  }

  private hide(e: Entry): void {
    if (e.textId) { try { destroyText(e.textId); } catch { /* gone */ } e.textId = 0; e.shown = ""; e.shownColor = ""; }
  }

  private drop(id: number): void {
    const e = this.entries.get(id);
    if (e) this.hide(e);
    this.entries.delete(id);
  }

  private entries = new Map<number, Entry>();
}
