import { ClientListener, CombinedController, Sp } from "./clientListener";
import { sendCustomPacket, parseCustomPacket } from "./customPacketUtil";
import { refreshFormMenu, closeWidget, readMenuKeyCode } from "./widgetMenuUtil";
import { keyName } from "./settingsLocal";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { ButtonEvent, InputDeviceType, Menu } from "skyrimPlatform";
import { logError, logTrace } from "../../logging";
import {
  LABELS_PER_TICK, LEGEND_HOST, LEGEND_SWF, MAP_MENU, MARKER_CLIP, MARKER_COUNT, RealmMarker, WIDGET_ID,
  descParts, keyAction, kindIndex, legendJson, legendReset, legendRows, legendStep, newLegendLoad, readMarkers, wantedScale,
} from "./mapRealm";
import {
  ANCHORS_PER_FRAME, OWNERS_ALIVE_FRAMES, OWNERS_HOST, OWNERS_SWF, OwnersData, TOGGLE_KEY, TOGGLE_SETTING,
  anchorClips, clipTransform, drawingOf, fitHolds, fitOf, anchorIndex, legendRow, readOwners, worldFor, Anchor, Fit, Seen,
} from "./mapOwners";

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
    this.ownersKey = readMenuKeyCode(this.sp, TOGGLE_SETTING, TOGGLE_KEY);
  }

  private onPacket(event: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(event);
    if (!content) return;
    if (content["customPacketType"] === "dboMapRealm") {
      this.markers = readMarkers(content["markers"]);
      this.index = kindIndex(this.markers);
      this.toReveal = this.markers.slice();
      logTrace(this, "realm markers", String(this.markers.length));
    } else if (content["customPacketType"] === "dboMapOwners") {
      this.owners = readOwners(content);
      this.anchors = anchorIndex(this.owners ? this.owners.anchors : []);
      this.drawnKey = "";
      logTrace(this, "map owners", this.owners ? `${this.owners.worlds.length} world(s), ${this.owners.anchors.length} anchors` : "unreadable");
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
    this.ownersLoad = { phase: "idle", frames: 0 };
    this.drawnKey = "";
    this.fitLogged = false;
    this.lastFit = null;
    this.mapWorld = 0;
    if (this.testArmed) { this.testArmed = false; this.test = { tick: 0, samples: [], results: {} }; }
  }

  private onMapClose(): void {
    this.open = false;
    legendReset(this.legendLoad);
    if (widget) { widget = null; closeWidget(this.sp, WIDGET_ID); }
    if (this.test) this.finishTests("the map closed");
  }

  // Digits toggle a kind and R the legend, while the map is open; the map keeps its own keys, nothing is focused
  private onButton(e: ButtonEvent): void {
    if (!this.open || !e.isDown || e.device !== InputDeviceType.Keyboard) return;
    if (this.ownersKey && e.code === this.ownersKey && this.owners) {
      this.ownersShown = !this.ownersShown;
      this.publish();
      return;
    }
    if (!this.markers.length) return;
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
      // browserService hides the browser for the map; a browser legend needs it shown (unfocused: the map keeps the keys)
      if (((this.markers.length && this.legendLoad.phase === "off") || this.test) && this.ticksOpen <= 3) this.sp.browser.setVisible(true);
      if (this.markers.length) {
        this.loadLegend();
        this.readLabels();
        this.applyFilter();
        if (this.ticksOpen === 2 || this.ticksOpen % 30 === 0) this.publish();
      }
      if (this.owners) this.followOwners();
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

  // The legend inside the map (dbo_maplegend): loaded each opening, the browser's only if it never comes alive
  private loadLegend(): void {
    const ui = this.sp.Ui;
    let alive = false;
    try { alive = this.legendLoad.phase === "loading" && ui.getString(MAP_MENU, `${LEGEND_HOST}.dboAlive`) === "yes"; } catch { alive = false; }
    const step = legendStep(this.legendLoad, alive);
    if (step === "inject") {
      try {
        ui.invokeStringA(MAP_MENU, "_root.createEmptyMovieClip", ["dboMapLegend", "9991"]);
        ui.invokeString(MAP_MENU, `${LEGEND_HOST}.loadMovie`, LEGEND_SWF);
      } catch (err) { logError(this, "the map legend could not be loaded", err); }
    } else if (step === "up") {
      logTrace(this, "map legend drawn in the map");
      this.publish();
    } else if (step === "fail") {
      logTrace(this, "the map legend never came alive in the map: the browser draws it this session");
      this.sp.browser.setVisible(true);
      this.publish();
    }
  }

  // ---- who owns what (mapOwners.ts): loaded like the legend, drawn once per world, lined up with the markers each frame ----
  private followOwners(): void {
    const ui = this.sp.Ui;
    const st = this.ownersLoad;
    if (st.phase === "idle") {
      st.phase = "loading";
      try {
        ui.invokeStringA(MAP_MENU, "_root.createEmptyMovieClip", ["dboMapOwners", "9989"]);
        ui.invokeString(MAP_MENU, `${OWNERS_HOST}.loadMovie`, OWNERS_SWF);
      } catch (err) { logError(this, "the map owners overlay could not be loaded", err); st.phase = "off"; }
      return;
    }
    if (st.phase === "loading") {
      let alive = false;
      try { alive = ui.getString(MAP_MENU, `${OWNERS_HOST}.dboAlive`) === "yes"; } catch { alive = false; }
      if (alive) { st.phase = "up"; logTrace(this, "map owners overlay drawn in the map"); }
      else if (++st.frames >= OWNERS_ALIVE_FRAMES) { st.phase = "off"; logTrace(this, "the map owners overlay never came alive in the map"); }
      return;
    }
    if (st.phase !== "up" || !this.owners) return;
    // the world this map shows: the player's (an interior has none, so no colours there)
    if (!this.mapWorld) {
      try { const w = this.sp.Game.getPlayer()?.getWorldSpace(); this.mapWorld = w ? w.getFormID() >>> 0 : -1; } catch { this.mapWorld = -1; }
    }
    const world = this.mapWorld > 0 ? worldFor(this.owners, (d) => this.formIdOf(d), this.mapWorld) : null;
    const layer = `${OWNERS_HOST}.layer`;
    if (!world) { ui.setBool(MAP_MENU, `${layer}._visible`, false); return; }
    const key = world.world + "#" + world.territories.map((t) => t.owner).join("|");
    if (key !== this.drawnKey) {
      this.drawnKey = key;
      this.worldOwners = new Set(world.territories.map((t) => t.owner)).size;
      try { ui.invokeString(MAP_MENU, `${OWNERS_HOST}.dboData`, JSON.stringify(drawingOf(world, this.owners.factions, this.owners.reach, this.owners.fade))); } catch (err) { logError(this, "map owners data failed", err); }
      this.publish();
    }
    const fit = this.ownersShown ? this.fitNow() : null;
    const holds = this.ownersShown && fitHolds(fit);
    ui.setBool(MAP_MENU, `${layer}._visible`, holds);
    if (holds && fit) {
      const t = clipTransform(fit);
      ui.setFloat(MAP_MENU, `${layer}._x`, t.x);
      ui.setFloat(MAP_MENU, `${layer}._y`, t.y);
      ui.setFloat(MAP_MENU, `${layer}._xscale`, t.xscale);
      ui.setFloat(MAP_MENU, `${layer}._yscale`, t.yscale);
      ui.setFloat(MAP_MENU, `${layer}._rotation`, t.rotation);
      ui.setFloat(MAP_MENU, `${layer}.shapes._rotation`, t.inner);
    }
    if (fit) this.lastFit = fit;
    // once an opening, after three seconds: how well the markers fit, so the alignment is measured, not judged by eye alone
    if (!this.fitLogged && this.ticksOpen >= 180) {
      this.fitLogged = true;
      const f = this.lastFit;
      const report = { world: world.world, anchors: this.anchorsSeen, fit: f ? { n: f.n, rms: Math.round(f.rms * 100) / 100, m: [f.m00, f.m01, f.m10, f.m11], turn: Math.round(clipTransform(f).rotation + clipTransform(f).inner) } : null, holds: fitHolds(f) };
      logTrace(this, "map owners fit", JSON.stringify(report));
      sendCustomPacket(this.controller, { customPacketType: "dbo", event: "mapOwnersFit", args: [report], widget: 0 });
    }
  }

  // The markers the server named, where the map has put them this frame, in the root's own units
  private fitNow(): Fit | null {
    const ui = this.sp.Ui;
    const clips = anchorClips(this.labels, this.anchors);
    this.anchorsSeen = clips.length;
    if (clips.length < 2) return null;
    const box = "_root.MarkerClips";
    const bx = ui.getFloat(MAP_MENU, `${box}._x`) || 0, by = ui.getFloat(MAP_MENU, `${box}._y`) || 0;
    const kx = (ui.getFloat(MAP_MENU, `${box}._xscale`) || 100) / 100, ky = (ui.getFloat(MAP_MENU, `${box}._yscale`) || 100) / 100;
    const seen: Seen[] = [];
    // a different slice each frame when there are more than a frame's worth
    const start = clips.length > ANCHORS_PER_FRAME ? (this.ticksOpen * ANCHORS_PER_FRAME) % clips.length : 0;
    for (let n = 0; n < Math.min(ANCHORS_PER_FRAME, clips.length); n++) {
      const { i, a } = clips[(start + n) % clips.length];
      const clip = MARKER_CLIP(i);
      if (!ui.getBool(MAP_MENU, `${clip}._visible`)) continue;
      seen.push({ sx: bx + ui.getFloat(MAP_MENU, `${clip}._x`) * kx, sy: by + ui.getFloat(MAP_MENU, `${clip}._y`) * ky, x: a.x, y: a.y });
    }
    return fitOf(seen);
  }

  private formIdOf(desc: string): number {
    const cached = this.worldIds.get(desc);
    if (cached !== undefined) return cached;
    const p = descParts(desc);
    let id = 0;
    try { const f = p ? this.sp.Game.getFormFromFile(p.id, p.file) : null; id = f ? f.getFormID() >>> 0 : 0; } catch { id = 0; }
    this.worldIds.set(desc, id);
    return id;
  }

  private publish(): void {
    if (!this.open) return;
    let rows = legendRows(this.labels.map((l) => (typeof l === "string" ? l : null)), this.index, this.hidden);
    if (this.owners && this.drawnKey) rows = rows.concat([legendRow(this.ownersShown, this.worldOwners, keyName(this.ownersKey))]);
    if (this.legendLoad.phase === "up") {
      if (widget) { widget = null; closeWidget(this.sp, WIDGET_ID); }
      try { this.sp.Ui.invokeString(MAP_MENU, `${LEGEND_HOST}.dboData`, legendJson(this.legendShown, rows)); } catch (err) { logError(this, "map legend data failed", err); }
      return;
    }
    // still loading: nothing yet (the swf or, failing it, the browser follows within a second)
    if (this.legendLoad.phase !== "off") return;
    widget = { type: "mapRealm", id: WIDGET_ID, mapMode: true, shown: this.legendShown, rows };
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
  private legendLoad = newLegendLoad();
  private owners: OwnersData | null = null;
  private anchors = new Map<string, Anchor>();
  private ownersShown = true;
  private ownersKey: number = TOGGLE_KEY;
  private ownersLoad: { phase: "idle" | "loading" | "up" | "off"; frames: number } = { phase: "idle", frames: 0 };
  private drawnKey = "";
  private worldOwners = 0;
  private mapWorld = 0;
  private worldIds = new Map<string, number>();
  private anchorsSeen = 0;
  private fitLogged = false;
  private lastFit: Fit | null = null;
}

interface MapTest { tick: number; samples: number[]; results: Record<string, unknown> }

