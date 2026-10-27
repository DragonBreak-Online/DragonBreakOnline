import { ClientListener, CombinedController, Sp } from "./clientListener";
import { sendCustomPacket, parseCustomPacket } from "./customPacketUtil";
import { refreshFormMenu, closeWidget } from "./widgetMenuUtil";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { ButtonEvent, InputDeviceType, Menu } from "skyrimPlatform";
import { logError, logTrace } from "../../logging";
import {
  LABELS_PER_TICK, MAP_MENU, MARKER_CLIP, MARKER_COUNT, RealmMarker, WIDGET_ID,
  descParts, keyAction, kindIndex, legendRows, readMarkers, wantedScale,
} from "./mapRealm";

// for the browser-side widget setter (executed inside the CEF browser)
declare const window: any;

// Module-level so the browser-side widget setter can read it (runtime injection)
let widget: Record<string, unknown> | null = null;

// The realm on Skyrim's M map; see mapRealm.ts for the contract and the reasons
export class MapRealmService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onPacket(e));
    this.controller.on("menuOpen", (e) => { if (e.name === Menu.Map) this.onMapOpen(); });
    this.controller.on("menuClose", (e) => { if (e.name === Menu.Map) this.onMapClose(); });
    this.controller.on("buttonEvent", (e) => this.onButton(e));
    this.controller.on("browserMessage", (e) => { if (e.arguments[0] === "mapRealm:mounted") this.mounted = true; });
    this.controller.on("update", () => this.onUpdate());
  }

  private onPacket(event: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(event);
    if (!content) return;
    if (content["customPacketType"] === "dboMapRealm") {
      this.markers = readMarkers(content["markers"]);
      this.index = kindIndex(this.markers);
      this.toReveal = this.markers.slice();
      logTrace(this, "realm markers", String(this.markers.length));
    } else if (content["customPacketType"] === "dboMapTest") {
      this.testArmed = true;
      logTrace(this, "map tests armed for the next opening of the map");
    }
  }

  // ---- the map opening and closing ----
  private onMapOpen(): void {
    this.open = true;
    this.labels = [];
    this.applied = [];
    this.mounted = false;
    this.ticksOpen = 0;
    if (this.testArmed) { this.testArmed = false; this.test = { tick: 0, samples: [], results: {} }; }
  }

  private onMapClose(): void {
    this.open = false;
    if (widget) { widget = null; closeWidget(this.sp, WIDGET_ID); }
    if (this.test) this.finishTests("the map closed");
  }

  // Digits toggle a kind and R the legend, while the map is open; the map keeps its own keys, nothing is focused
  private onButton(e: ButtonEvent): void {
    if (!this.open || !e.isDown || e.device !== InputDeviceType.Keyboard || !this.markers.length) return;
    const a = keyAction(e.code);
    if (!a) return;
    if (a.legend) this.legendShown = !this.legendShown;
    if (a.toggle) {
      if (this.hidden.has(a.toggle)) this.hidden.delete(a.toggle); else this.hidden.add(a.toggle);
      this.applied = [];
    }
    this.publish();
  }

  // ---- every frame the map is open ----
  private onUpdate(): void {
    this.reveal();
    if (!this.open) return;
    this.ticksOpen++;
    try {
      // browserService hides the browser for the map; the legend needs it shown (unfocused: the map keeps the keys)
      if ((this.markers.length || this.test) && this.ticksOpen <= 3) this.sp.browser.setVisible(true);
      if (this.markers.length) {
        this.readLabels();
        this.applyFilter();
        if (this.ticksOpen === 2 || this.ticksOpen % 30 === 0) this.publish();
      }
      if (this.test) this.runTests();
    } catch (err) {
      logError(this, "map frame failed", err);
    }
  }

  // Once per session, a few a frame: Papyrus calls can only be made in the update tick
  private reveal(): void {
    for (let n = 0; n < 10 && this.toReveal.length; n++) {
      const m = this.toReveal.shift() as RealmMarker;
      try {
        const p = descParts(m.desc);
        const ref = p ? this.sp.ObjectReference.from(this.sp.Game.getFormFromFile(p.id, p.file)) : null;
        if (ref) ref.addToMap(false); else logTrace(this, "no marker for", m.desc, m.name);
      } catch (err) {
        logError(this, "addToMap failed for", m.desc, err);
      }
    }
  }

  // The markers' labels, LABELS_PER_TICK a frame; SkyUI creates them ten a frame, so the count is read each frame
  private readLabels(): void {
    const ui = this.sp.Ui;
    const n = ui.getInt(MAP_MENU, MARKER_COUNT);
    let read = 0;
    for (let i = 0; i < n && read < LABELS_PER_TICK; i++) {
      if (typeof this.labels[i] === "string") continue;
      this.labels[i] = ui.getString(MAP_MENU, `${MARKER_CLIP(i)}.label`) || "";
      read++;
    }
  }

  private applyFilter(): void {
    const ui = this.sp.Ui;
    for (let i = 0; i < this.labels.length; i++) {
      const want = wantedScale(typeof this.labels[i] === "string" ? (this.labels[i] as string) : null, this.index, this.hidden);
      if (want === null || this.applied[i] === want) continue;
      ui.setFloat(MAP_MENU, `${MARKER_CLIP(i)}._xscale`, want);
      ui.setFloat(MAP_MENU, `${MARKER_CLIP(i)}._yscale`, want);
      this.applied[i] = want;
    }
  }

  private publish(): void {
    if (!this.open) return;
    widget = {
      type: "mapRealm", id: WIDGET_ID, mapMode: true, shown: this.legendShown,
      rows: legendRows(this.labels.map((l) => (typeof l === "string" ? l : null)), this.index, this.hidden),
    };
    refreshFormMenu(this.sp, this.browsersideWidgetSetter, { widget });
  }

  // ---- the four map tests (_work/mmap-build-1026.md), armed by /testmenu mapmenu ----
  private runTests(): void {
    const t = this.test as MapTest;
    const ui = this.sp.Ui;
    t.tick++;
    const marker0 = `${MARKER_CLIP(0)}`;
    if (t.tick === 5) {
      // T1: can the client call an AS2 built-in on a menu it did not author?
      ui.invokeStringA(MAP_MENU, "_root.createEmptyMovieClip", ["dboProbeClip", "9990"]);
    }
    if (t.tick === 6) t.results.t1 = ui.getString(MAP_MENU, "_root.dboProbeClip._name") || "(nothing)";
    if (t.tick === 8) {
      // T3: the legend widget, shown over the map; mounted is what the front reports, the rest is Nat's eye
      widget = { type: "mapRealm", id: WIDGET_ID, mapMode: true, shown: true, test: true, rows: legendRows([], this.index, this.hidden) };
      refreshFormMenu(this.sp, this.browsersideWidgetSetter, { widget });
      // T4: a marker shrunk to nothing, read back after the panning below
      ui.setFloat(MAP_MENU, `${marker0}._xscale`, 0);
    }
    // T2: how often SkyUI moves a marker: 60 frames still, then 60 while Nat pans
    if (t.tick > 10 && t.tick <= 130) t.samples.push(ui.getFloat(MAP_MENU, `${marker0}._x`));
    if (t.tick === 131) {
      const changes = (a: number[]) => a.reduce((n, v, i) => (i && v !== a[i - 1] ? n + 1 : n), 0);
      t.results.t2 = { still: changes(t.samples.slice(0, 60)), panning: changes(t.samples.slice(60)), frames: t.samples.length };
      t.results.t4 = ui.getFloat(MAP_MENU, `${marker0}._xscale`);
      t.results.t3 = this.mounted ? "the legend widget mounted" : "the legend widget never reported";
      t.results.markers = ui.getInt(MAP_MENU, MARKER_COUNT);
      this.finishTests("done");
    }
  }

  private finishTests(why: string): void {
    const t = this.test as MapTest;
    this.test = null;
    t.results.end = why;
    sendCustomPacket(this.controller, { customPacketType: "dbo", event: "mapTest", args: [t.results], widget: 0 });
    logTrace(this, "map tests", JSON.stringify(t.results));
  }

  // Runs inside the CEF browser. Only injected vars + window are available.
  // No spread syntax: it breaks after FunctionInfo stringification (8d7c0c05).
  private browsersideWidgetSetter = () => {
    const others = (window.skyrimPlatform.widgets.get() || []).filter((w: any) => w.id !== (widget as any).id);
    window.skyrimPlatform.widgets.set(others.concat([widget]));
  };

  private markers: RealmMarker[] = [];
  private index = new Map<string, string>();
  private toReveal: RealmMarker[] = [];
  private hidden = new Set<string>([]);
  private legendShown = true;
  private open = false;
  private ticksOpen = 0;
  private labels: Array<string | undefined> = [];
  private applied: number[] = [];
  private mounted = false;
  private testArmed = false;
  private test: MapTest | null = null;
}

interface MapTest { tick: number; samples: number[]; results: Record<string, unknown> }

