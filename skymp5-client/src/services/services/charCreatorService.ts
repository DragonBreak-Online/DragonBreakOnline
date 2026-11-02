import { ClientListener, CombinedController, Sp } from "./clientListener";
import { sendCustomPacket, parseCustomPacket } from "./customPacketUtil";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { CreateActorMessage } from "../messages/createActorMessage";
import { focusEventString } from "./browserService";
import { showUi } from "./widgetMenuUtil";
import { BrowserMessageEvent, Menu, MenuOpenEvent } from "skyrimPlatform";
import { logTrace, logError } from "../../logging";
import { applyAppearanceToPlayer, Appearance } from "../../sync/appearance";
import { reenforceServerSpells } from "../../sync/spell";
import { ScaleformMenuService } from "./scaleformMenuService";
import { CLOSE_KEY, FAILED_KEY } from "./nativeWidgets";
import * as Creator from "./charCreator/creatorModel";
import { buildAppearance, setModHeadparts } from "./charCreator/frontModel";

// Preview payloads larger than this are ignored (malformed or hostile page state).
const MAX_PREVIEW_JSON = 32 * 1024;
// The browser creator debounces its previews by this much; the native panel does the same
const PREVIEW_MS = 200;

// Character creator bridge.
//
// Server → client custom packets:
//   { "customPacketType": "charCreatorOpen", "config": { ... } }
//   { "customPacketType": "charCreatorClose" }
//   { "customPacketType": "charCreatorError", "message": "..." }
//
// Client → server (on finish):
//   { "customPacketType": "charCreatorResult", "data": { ... } }
//
// The creator is drawn natively first (swf/dbo_creator): its rules run here, in charCreator/creatorModel.ts, built on the
// front's own modules, and the panel sends back cc:act [key, value]. The `charCreator` widget rendered by skymp5-front
// is the fallback when the panel is off or fails. Either way this service applies local appearance previews and relays
// the final result. Inert until the server sends charCreatorOpen.
export class CharCreatorService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onCustomPacketMessage(e));
    this.controller.on("browserMessage", (e) => this.onBrowserMessage(e));
    this.controller.emitter.on("createActorMessage", (e) => this.onCreateActorMessage(e));
    this.controller.on("menuOpen", (e) => this.onMenuOpen(e));
    this.controller.on("update", () => this.onUpdate());
  }

  // A character switch respawns the player and authService wipes the widgets;
  // close locally so controls and state never go stale. If the new character
  // still has the creator pending, the server re-sends charCreatorOpen.
  private onCreateActorMessage(e: ConnectionMessage<CreateActorMessage>): void {
    if (e.message.isMe && this.menuOpen) this.close();
  }

  // Quitting to the main menu opens character select; the creator must not overlay it.
  private onMenuOpen(e: MenuOpenEvent): void {
    if (e.name !== Menu.Main || !this.menuOpen) return;
    // menuOpen events can arrive late; only act when the menu is really open (stale-event guard).
    try {
      if (!this.sp.Ui.isMenuOpen(Menu.Main)) return;
    } catch {
      return;
    }
    this.close();
  }

  private onCustomPacketMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(event);
    if (!content) return;

    switch (content["customPacketType"]) {
      case 'charCreatorOpen':
        this.open(content["config"]);
        break;
      case 'charCreatorClose':
        if (this.menuOpen) this.close();
        break;
      case 'charCreatorError':
        if (this.menuOpen) this.forwardError(String(content["message"] ?? ""));
        break;
      default:
        break;
    }
  }

  private open(config: unknown): void {
    this.config = config && typeof config === 'object' ? config : {};
    this.menuOpen = true;
    logTrace(this, 'opening character creator');
    // Native game-thread calls throw from the packet handler; defer to update.
    this.controller.once("update", () => {
      if (!this.menuOpen) return;
      if (!this.openNative()) this.showBrowser();
      try {
        this.sp.Game.forceThirdPerson();
        // (movement, fighting, camSwitch, looking, sneaking, menu, activate, journalTabs, disablePOVType)
        this.sp.Game.disablePlayerControls(false, true, false, false, false, true, false, false, 0);
        this.controlsDisabled = true;
      } catch (e) {
        logError(this, `failed to lock controls: ${e}`);
      }
    });
  }

  private openNative(): boolean {
    const config = this.withModHair(this.config ?? {}) as { modParts?: unknown; modExtras?: unknown };
    setModHeadparts(Array.isArray(config.modParts) ? config.modParts : [], config.modExtras && typeof config.modExtras === "object" ? config.modExtras : {});
    this.cc = Creator.initialState();
    this.ccConfig = Creator.configOf(config);
    try {
      this.native = this.controller.lookupListener(ScaleformMenuService).openNative({
        type: "charCreator", widget: Creator.view(this.cc, this.ccConfig), onKey: (key, args) => this.onNativeKey(key, args),
      });
    } catch (e) {
      logError(this, `no native creator: ${e}`);
      this.native = false;
    }
    return this.native;
  }

  private onNativeKey(key: string, args: unknown[]): void {
    if (!this.menuOpen || !this.native) return;
    // the panel could not be drawn, went away on its own, or the game cannot type the name: the browser creator instead
    if (key === FAILED_KEY || key === CLOSE_KEY || (key === "cc:act" && args[0] === "browser")) {
      logTrace(this, `native creator gave way to the browser (${key})`);
      if (key !== FAILED_KEY && key !== CLOSE_KEY) this.closeNative();
      this.native = false;
      this.cc = undefined;
      this.showBrowser();
      return;
    }
    if (key !== "cc:act" || !this.cc || !this.ccConfig) return;
    const r = Creator.act(this.cc, this.ccConfig, String(args[0]), args[1]);
    this.cc = r.state;
    if (r.save) {
      logTrace(this, 'sending charCreatorResult');
      sendCustomPacket(this.controller, { customPacketType: 'charCreatorResult', data: r.save });
    }
    if (r.preview) this.previewAt = Date.now() + PREVIEW_MS;
    // every action is answered, so the panel never stays waiting
    this.refreshNative();
  }

  private refreshNative(): void {
    if (!this.cc || !this.ccConfig) return;
    try {
      this.controller.lookupListener(ScaleformMenuService).refreshNative(Creator.view(this.cc, this.ccConfig));
    } catch (e) {
      logError(this, `failed to refresh the native creator: ${e}`);
    }
  }

  private closeNative(): void {
    try {
      this.controller.lookupListener(ScaleformMenuService).closeNative("charCreator");
    } catch (e) {
      logError(this, `failed to close the native creator: ${e}`);
    }
  }

  private onUpdate(): void {
    if (!this.previewAt || Date.now() < this.previewAt) return;
    this.previewAt = 0;
    if (!this.menuOpen || !this.native || !this.cc || !this.cc.race) return;
    try {
      applyAppearanceToPlayer(buildAppearance(Object.assign({}, this.cc, { name: this.cc.name.trim() })) as Appearance, false, "preview");
    } catch (e) {
      logError(this, `failed to apply preview appearance: ${e}`);
    }
  }

  private showBrowser(): void {
    const js =
      "(function(){" +
      "if(!window.skyrimPlatform||!window.skyrimPlatform.widgets)return;" +
      "var others=(window.skyrimPlatform.widgets.get()||[]).filter(function(w){return w&&w.type!=='charCreator';});" +
      "window.skyrimPlatform.widgets.set(others.concat([{type:'charCreator',config:" + JSON.stringify(this.withModHair(this.config ?? {})) + "}]));" +
      "})();";
    try {
      showUi(this.controller);
      this.sp.browser.executeJavaScript(js);
      this.sp.browser.setVisible(true);
      this.sp.browser.setFocused(true);
    } catch (e) {
      logError(this, `failed to show character creator: ${e}`);
    }
  }

  // The race menu grants race and Player-record spells (Flames, Healing, the racial power) as it
  // closes. On a freshly created character that happens after the last login enforcement pass, so
  // without a second round they stick for the life of the character. Measured 2026-09-20: JOIN at
  // 01:49:31.8, last pass at +20 s, creation finished 01:49:52.0 - 240 ms too late.
  private reenforceSpellsAfterCreation(): void {
    [1, 3, 6, 10].forEach((seconds) => {
      this.sp.Utility.wait(seconds).then(() => {
        try {
          const player = this.sp.Game.getPlayer();
          if (!player) return;
          const changed = reenforceServerSpells(player);
          if (changed > 0) {
            logTrace(this, 'spells re-enforced after creation at', seconds, 's:', changed, 'change(s)');
          }
        } catch (e) {
          logError(this, `spell re-enforcement failed: ${e}`);
        }
      });
    });
  }

  private close(): void {
    this.menuOpen = false;
    this.config = undefined;
    logTrace(this, 'closing character creator');
    this.reenforceSpellsAfterCreation();
    if (this.native) this.closeNative();
    this.native = false;
    this.cc = undefined;
    this.previewAt = 0;
    const js =
      "(function(){" +
      "if(!window.skyrimPlatform||!window.skyrimPlatform.widgets)return;" +
      "window.skyrimPlatform.widgets.set((window.skyrimPlatform.widgets.get()||[]).filter(function(w){return w&&w.type!=='charCreator';}));" +
      "})();";
    try {
      this.sp.browser.executeJavaScript(js);
      this.sp.browser.setFocused(false);
    } catch (e) {
      logError(this, `failed to hide character creator: ${e}`);
    }
    if (this.controlsDisabled) {
      this.controller.once("update", () => {
        try {
          this.sp.Game.enablePlayerControls(false, true, false, false, false, true, false, false, 0);
        } catch (e) {
          logError(this, `failed to unlock controls: ${e}`);
        }
      });
      this.controlsDisabled = false;
    }
  }

  private forwardError(message: string): void {
    if (this.native && this.cc) {
      this.cc = Creator.refused(this.cc, message);
      this.refreshNative();
      return;
    }
    const js =
      "window.dispatchEvent(new CustomEvent('charCreator:error',{detail:" + JSON.stringify(message) + "}));";
    try {
      this.sp.browser.executeJavaScript(js);
    } catch (e) {
      logError(this, `failed to forward error: ${e}`);
    }
  }

  private onBrowserMessage(e: BrowserMessageEvent): void {
    const eventKey = e.arguments[0];
    if (typeof eventKey !== 'string') return;
    // the native panel has the keys: the browser is neither refocused nor listened to
    if (!this.menuOpen || this.native) return;

    switch (eventKey) {
      case 'charCreator:save':
        this.onSave(e.arguments[1]);
        break;
      case 'charCreator:preview':
        this.onPreview(e.arguments[1]);
        break;
      case 'cef::browser:unfocus':
      case 'menu:escape':
        // Chat Escape/Enter and BrowserService's Escape poll drop focus; re-assert it next update so the wizard stays usable
        this.controller.once("update", () => {
          if (!this.menuOpen) return;
          try {
            this.sp.browser.setFocused(true);
            this.sp.browser.executeJavaScript(focusEventString);
          } catch (e2) {
            logError(this, `failed to refocus browser: ${e2}`);
          }
        });
        break;
      default:
        break;
    }
  }

  private onSave(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      logError(this, 'charCreator:save is not valid JSON');
      return;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      logError(this, 'charCreator:save is not an object');
      return;
    }
    logTrace(this, 'sending charCreatorResult');
    sendCustomPacket(this.controller, { customPacketType: 'charCreatorResult', data });
  }

  private onPreview(raw: unknown): void {
    if (typeof raw !== 'string' || raw.length > MAX_PREVIEW_JSON) return;
    let appearance: Appearance;
    try {
      appearance = JSON.parse(raw);
    } catch {
      logError(this, 'charCreator:preview is not valid JSON');
      return;
    }
    if (!appearance || typeof appearance !== 'object'
      || typeof appearance.raceId !== 'number' || !Array.isArray(appearance.headpartIds)) {
      logError(this, 'charCreator:preview is not an Appearance');
      return;
    }
    this.controller.once("update", () => {
      if (!this.menuOpen) return;
      try {
        applyAppearanceToPlayer(appearance, false, "preview");
        logTrace(this, 'applied preview appearance');
      } catch (e) {
        logError(this, `failed to apply preview appearance: ${e}`);
      }
    });
  }

  // Swaps the server's mod hair descs for runtime ids; hair from plugins this client lacks is dropped
  private withModHair(config: object): object {
    const { modHair, ...rest } = config as { modHair?: { raceSets?: unknown; hairs?: unknown } };
    if (!modHair || !Array.isArray(modHair.raceSets) || !Array.isArray(modHair.hairs)) return rest;
    const raceSets = modHair.raceSets as unknown[];
    const modParts: object[] = [];
    const modExtras: Record<string, number[]> = {};
    for (const h of modHair.hairs as { desc?: unknown; label?: unknown; male?: unknown; female?: unknown; races?: unknown; extras?: unknown }[]) {
      const id = this.formIdOf(h?.desc);
      const races = typeof h?.races === 'number' ? raceSets[h.races] : undefined;
      if (!id || !Array.isArray(races)) continue;
      modParts.push({ id, label: String(h.label ?? ''), kind: 'hair', male: h.male === true, female: h.female === true, races });
      const extras = (Array.isArray(h.extras) ? h.extras : []).map((d) => this.formIdOf(d)).filter((x) => x !== 0);
      if (extras.length) modExtras[String(id)] = extras;
    }
    logTrace(this, `resolved ${modParts.length}/${modHair.hairs.length} mod hairs`);
    return { ...rest, modParts, modExtras };
  }

  private formIdOf(desc: unknown): number {
    if (typeof desc !== 'string') return 0;
    const sep = desc.indexOf(':');
    if (sep <= 0) return 0;
    try {
      const form = this.sp.Game.getFormFromFile(parseInt(desc.slice(0, sep), 16), desc.slice(sep + 1));
      return form ? form.getFormID() : 0;
    } catch {
      return 0;
    }
  }

  private menuOpen = false;
  private native = false;
  private cc?: Creator.State;
  private ccConfig?: Creator.Config;
  private previewAt = 0;
  private controlsDisabled = false;
  private config?: object;
}
