import { ClientListener, CombinedController, Sp } from "./clientListener";
import { sendCustomPacket, parseCustomPacket, notifyNextUpdate } from "./customPacketUtil";
import { openFormMenu, closeFormMenu } from "./widgetMenuUtil";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { BrowserMessageEvent, ButtonEvent, DxScanCode, InputDeviceType } from "skyrimPlatform";
import { logTrace } from "../../logging";
import { ScaleformMenuService } from "./scaleformMenuService";
import { CLOSE_KEY, FAILED_KEY, HANDOFF_KEY } from "./nativeWidgets";

// for the browser-side widget setter (executed inside the CEF browser)
declare const window: any;

const WIDGET_ID = 26;

// Event keys exchanged with the browser. Namespaced to avoid collisions.
const events = {
  post: 'bountyBoard:post',
  remove: 'bountyBoard:remove',
  close: 'bountyBoard:close',
};

interface BoardNote {
  id: number;
  tab: string;
  author: string;
  text: string;
  ageHours: number;
  canRemove: boolean;
}

interface BoardTab {
  id: string;
  label: string;
  cost: number;
  canPost: boolean;
}

// The server's bountyBoardMenu reply, mirrored into the widget.
interface BoardInfo {
  board: string;
  boardName: string;
  costGold: number;
  gold: number;
  maxTextLen: number;
  maxNotes: number;
  expiryDays: number;
  tabs: BoardTab[];
  notes: BoardNote[];
}

// Module-level so the browser-side widget setter can read it (runtime injection).
// handoff: the native board handed its typed input to the browser ('compose:<tab>'); the front then draws only the composer
let handoff = "";
let info: BoardInfo = {
  board: "", boardName: "", costGold: 30, gold: 0,
  maxTextLen: 500, maxNotes: 60, expiryDays: 7, tabs: [], notes: [],
};

/**
 * Notice board menu: opens when a board is activated (the server pushes the
 * menu). One board per hold,
 * three tabs (Hold Notices for officials, Shop Ads, Citizen Notices). Reading
 * is free; a Shop or Citizen post costs gold, taken server-side.
 *
 * Protocol - all messages are MsgType.CustomPacket with a JSON dump.
 *
 *   (bountyBoardOpenRequest is still accepted server-side; the gamemode's
 *    /board command reaches the same handler. The client no longer sends it.)
 *   Server -> Client: { "customPacketType": "bountyBoardMenu", "board", "boardName",
 *                       "reason", "costGold", "gold", "maxTextLen", "maxNotes",
 *                       "expiryDays", "tabs", "notes" }
 *   Client -> Server: { "customPacketType": "bountyBoardPost", "board", "tab", "text" }
 *   Client -> Server: { "customPacketType": "bountyBoardRemove", "board", "id" }
 *   Client -> Server: { "customPacketType": "bountyBoardClose" }
 *   Server -> Client: { "customPacketType": "bountyBoardNotice", "text" }
 */
export class BountyBoardService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.on("buttonEvent", (e) => this.onButtonEvent(e));
    this.controller.on("browserMessage", (e) => this.onBrowserMessage(e));
    this.controller.emitter.on("customPacketMessage", (e) => this.onCustomPacketMessage(e));
    // A front reload drops the widget without a close message; the server
    // still holds a board session, so close that too.
    this.controller.emitter.on("browserWindowLoaded", () => {
      if (!this.menuOpen || this.native) return;
      this.menuOpen = false;
      sendCustomPacket(this.controller, { customPacketType: "bountyBoardClose" });
    });
    this.controller.emitter.on("uiHiddenChanged", (e) => { if (e.hidden && this.menuOpen) this.closeMenu(); });
  }

  // A board is opened by activating it. The only key left here closes the menu.
  private onButtonEvent(e: ButtonEvent): void {
    // Gamepad idCodes are bitmasks that alias onto keyboard scancodes
    if (e.device !== InputDeviceType.Keyboard) return;
    if (e.code === DxScanCode.Escape && e.isDown && this.menuOpen) {
      this.closeMenu();
      return;
    }
  }

  private onCustomPacketMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(event);
    if (!content) return;

    switch (content["customPacketType"]) {
      case "bountyBoardMenu": {
        const notes = Array.isArray(content["notes"]) ? content["notes"] : [];
        const tabs = Array.isArray(content["tabs"]) ? content["tabs"] : [];
        info = {
          board: String(content["board"] || ""),
          boardName: typeof content["boardName"] === "string" ? content["boardName"] as string : "",
          costGold: Number(content["costGold"]) || 0,
          gold: Number(content["gold"]) || 0,
          maxTextLen: Number(content["maxTextLen"]) || 500,
          maxNotes: Number(content["maxNotes"]) || 60,
          expiryDays: Number(content["expiryDays"]) || 7,
          tabs: tabs as BoardTab[],
          notes: notes as BoardNote[],
        };
        // A refresh (someone posted) updates the open menu but must never
        // force a closed one open; only an activation reply opens it.
        if (content["reason"] === "open") {
          logTrace(this, `Opening board`, info.boardName);
          this.openMenu();
        } else if (this.menuOpen) {
          // The refresh after our own post from the composer brings the native board back; anyone else's leaves it
          if (handoff && this.posted) this.endHandoff();
          this.openMenu();
        }
        break;
      }
      case "bountyBoardNotice":
        if (typeof content["text"] === "string") {
          notifyNextUpdate(this.controller, this.sp, content["text"]);
        }
        break;
      default:
        break;
    }
  }

  private onBrowserMessage(e: BrowserMessageEvent): void {
    const key = e.arguments[0];
    // Escape pressed inside the browser closes the menu on the first press.
    if (key === "menu:escape") {
      if (this.menuOpen) this.closeMenu();
      return;
    }
    if (typeof key !== "string" || !key.startsWith("bountyBoard:")) return;
    this.handleKey(key, Array.prototype.slice.call(e.arguments, 1));
  }

  // The board's keys, from the browser or the native panel (the router's onKey) alike
  private handleKey(key: string, args: unknown[]): void {
    if (key === FAILED_KEY) {
      // The panel could not be drawn: the browser one for the rest of this opening
      this.native = false;
      this.noNative = true;
      if (this.menuOpen) this.openMenu();
      return;
    }
    if (key === CLOSE_KEY) {
      // The panel went without the board's own close (Skyrim Souls' walk-away): end the session as Close would
      this.native = false;
      if (this.menuOpen) this.closeMenu();
      return;
    }
    if (key === HANDOFF_KEY) {
      this.native = false;
      handoff = typeof args[1] === "string" ? (args[1] as string) : "compose";
      this.posted = false;
      if (this.menuOpen) this.openMenu();
      return;
    }
    if (!this.menuOpen) return;

    if (key === events.close) {
      this.closeMenu();
      return;
    }
    if (key === events.post) {
      const tab = typeof args[0] === "string" ? (args[0] as string) : "";
      const text = typeof args[1] === "string" ? (args[1] as string).trim() : "";
      if (tab && text) {
        sendCustomPacket(this.controller, { customPacketType: "bountyBoardPost", board: info.board, tab, text });
        if (handoff) this.posted = true;
      }
      return;
    }
    if (key === events.remove) {
      const id = Number(args[0]);
      if (Number.isFinite(id)) {
        sendCustomPacket(this.controller, { customPacketType: "bountyBoardRemove", board: info.board, id });
      }
    }
  }

  // The native board when the client has it, else the browser one; the composer hand-off is always the browser
  private openMenu(): void {
    this.menuOpen = true;
    if (!handoff && !this.noNative) {
      const scaleform = this.controller.lookupListener(ScaleformMenuService);
      const widget = {
        type: "bountyBoard", id: WIDGET_ID, boardName: info.boardName, costGold: info.costGold, gold: info.gold,
        maxTextLen: info.maxTextLen, maxNotes: info.maxNotes, expiryDays: info.expiryDays, tabs: info.tabs, notes: info.notes, events,
      };
      if (scaleform && scaleform.openNative({ type: "bountyBoard", widget, widgetId: WIDGET_ID, onKey: (k, a) => this.handleKey(k, a) })) {
        this.native = true;
        return;
      }
    }
    openFormMenu(this.sp, this.browsersideWidgetSetter, { events, info, WIDGET_ID, handoff }, this.controller);
  }

  // The composer's post was answered: the browser composer goes, the native board comes back on the next open
  private endHandoff(): void {
    handoff = "";
    this.posted = false;
    closeFormMenu(this.sp, WIDGET_ID);
  }

  private closeMenu(): void {
    this.menuOpen = false;
    this.noNative = false;
    if (this.native) {
      this.native = false;
      this.controller.lookupListener(ScaleformMenuService).closeNative("bountyBoard");
    } else {
      closeFormMenu(this.sp, WIDGET_ID);
    }
    handoff = "";
    this.posted = false;
    // The server keeps a per-player board session; tell it we walked away.
    sendCustomPacket(this.controller, { customPacketType: "bountyBoardClose" });
  }

  // Runs inside the CEF browser. Only injected vars + window are available.
  // No spread syntax: it breaks after FunctionInfo stringification (8d7c0c05).
  private browsersideWidgetSetter = () => {
    const widget = {
      type: "bountyBoard",
      id: WIDGET_ID,
      boardName: info.boardName,
      costGold: info.costGold,
      gold: info.gold,
      maxTextLen: info.maxTextLen,
      maxNotes: info.maxNotes,
      expiryDays: info.expiryDays,
      tabs: info.tabs,
      notes: info.notes,
      events: events,
      handoff: handoff,
    };
    const others = (window.skyrimPlatform.widgets.get() || []).filter((w: any) => w.id !== WIDGET_ID);
    window.skyrimPlatform.widgets.set(others.concat([widget]));
  };

  private menuOpen = false;
  private native = false;
  private noNative = false;
  private posted = false;
}
