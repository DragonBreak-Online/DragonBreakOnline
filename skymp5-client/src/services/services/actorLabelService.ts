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
// The nodes a label hangs from, in order; creatures such as the ice wraith have no "NPC Head [Head]" (it has "IW Head")
const ANCHORS = ["NPC Head [Head]", "NPC Head MagicNode [Hmag]"];
// Above TrueHUD's health bar (Nat 26 Oct: "can the name be ... above the health"): the bar is drawn at the head + 30
// (TrueHUD MCM fInfoBarOffsetZ 30, uInfoBarAnchor 1), so a label at + 32, as the nametags sit, lay on it. 72 clears the bar
// and keeps clear at any distance: both are world offsets, and the bar scales with distance (bInfoBarScaleWithDistance)
const LABEL_HEIGHT = 96;
// The title line under the name, a world offset like the name so both clear TrueHUD's bar (+ 30) at any distance
const SUB_HEIGHT = 70;
const TEXT_SIZE = 0.55;
const SUB_SIZE = 0.4;
const SUB_COLOR: [number, number, number, number] = [0.86, 0.86, 0.86, 0.92];

// The head node, else the magic node, else the top of the actor's bounds
const anchorOf = (actor: Actor): [number, number, number] => {
  for (const node of ANCHORS) {
    if (NetImmerse.hasNode(actor, node, false)) {
      return [NetImmerse.getNodeWorldPositionX(actor, node, false), NetImmerse.getNodeWorldPositionY(actor, node, false), NetImmerse.getNodeWorldPositionZ(actor, node, false)];
    }
  }
  return [actor.getPositionX(), actor.getPositionY(), actor.getPositionZ() + actor.getHeight()];
};

interface Entry extends LabelWanted { textId: number; shown: string; shownColor: string; subId: number; shownSub: string }

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
      if (cur) { cur.text = w.text; cur.sub = w.sub; cur.color = w.color; } else this.entries.set(id, { text: w.text, sub: w.sub, color: w.color, textId: 0, shown: "", shownColor: "", subId: 0, shownSub: "" });
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
      const [hx, hy, hz] = anchorOf(actor);
      const [p, q] = worldPointToScreenPoint([hx, hy, hz + LABEL_HEIGHT], [hx, hy, hz + SUB_HEIGHT]);
      if (!p || p[2] <= 0) { this.hide(e); continue; }
      this.drawSub(e, q, res);
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

  // The title line under the name, drawn only when the server sends one
  private drawSub(e: Entry, q: number[] | undefined, res: { width: number; height: number }): void {
    if (!e.sub || !q || q[2] <= 0) { this.hideSub(e); return; }
    const x = Math.round(q[0] * res.width), y = Math.round((1 - q[1]) * res.height);
    if (!e.subId) {
      e.subId = createText(x, y, e.sub, SUB_COLOR);
      setTextSize(e.subId, SUB_SIZE);
      e.shownSub = e.sub;
    } else {
      setTextPos(e.subId, x, y);
      if (e.shownSub !== e.sub) { setTextString(e.subId, e.sub); e.shownSub = e.sub; }
    }
  }

  private hideSub(e: Entry): void {
    if (e.subId) { try { destroyText(e.subId); } catch { /* gone */ } e.subId = 0; e.shownSub = ""; }
  }

  private hide(e: Entry): void {
    if (e.textId) { try { destroyText(e.textId); } catch { /* gone */ } e.textId = 0; e.shown = ""; e.shownColor = ""; }
    this.hideSub(e);
  }

  private drop(id: number): void {
    const e = this.entries.get(id);
    if (e) this.hide(e);
    this.entries.delete(id);
  }

  private entries = new Map<number, Entry>();
}
