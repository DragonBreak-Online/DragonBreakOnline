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
  descParts, keyAction, kindIndex, legendJson, legendRows, readMarkers, wantedScale, SwfLoad, newSwfLoad, swfStep, swfReport,
} from "./mapRealm";
import {
  ANCHORS_PER_FRAME, OWNERS_HOST, OWNERS_SWF, OwnersData, TOGGLE_KEY, TOGGLE_SETTING,
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
    this.openings++;
    this.legendSwf = newSwfLoad();
    this.ownersSwf = newSwfLoad();
    this.drawnKey = "";
    this.lastFit = null;
    this.mapWorld = 0;
    if (this.testArmed) { this.testArmed = false; this.test = { tick: 0, samples: [], results: {} }; }
  }

  private onMapClose(): void {
    this.open = false;
    this.reportSwfs();
    if (!this.probe.done && this.ticksOpen > 0) this.sendProbe("the map closed early");
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
      if (this.test && this.ticksOpen <= 3) this.sp.browser.setVisible(true);
      if (this.markers.length) {
        this.loadLegend();
        this.readLabels();
        this.applyFilter();
        if (this.ticksOpen === 2 || this.ticksOpen % 30 === 0) this.publish();
      }
      if (this.owners) this.followOwners();
      if (this.test) this.runTests();
      if (!this.probe.done) this.runProbe();
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

  // A swf into the MapMenu by the HUD's rule, every step timed (mapRealm.ts swfStep); "inject", "up", "fail" or ""
  private loadSwf(st: SwfLoad, host: string, name: string, depth: string, swf: string): string {
    const ui = this.sp.Ui;
    const seen = { menu: false, clip: false, url: "", alive: false };
    try { seen.menu = ui.isMenuOpen(MAP_MENU); } catch { seen.menu = false; }
    if (st.phase === "loading" || st.phase === "up") {
      try { seen.clip = ui.getString(MAP_MENU, `${host}._name`) === name; } catch { seen.clip = false; }
      try { seen.url = ui.getString(MAP_MENU, `${host}._url`) || ""; } catch { seen.url = ""; }
      try { seen.alive = ui.getString(MAP_MENU, `${host}.dboAlive`) === "yes"; } catch { seen.alive = false; }
    }
    const step = swfStep(st, this.ticksOpen, seen, swf);
    if (step === "inject") {
      try {
        ui.invokeStringA(MAP_MENU, "_root.createEmptyMovieClip", [name, depth]);
        ui.invokeString(MAP_MENU, `${host}.loadMovie`, swf);
      } catch (err) { logError(this, `${swf} could not be loaded into the map`, err); }
    }
    return step;
  }

  // One line a map opening to the server log: how far each swf got, at which frames, and the fit
  private reportSwfs(): void {
    if (!this.markers.length && !this.owners) return;
    const f = this.lastFit;
    const report = {
      opening: this.openings, frames: this.ticksOpen,
      legend: this.markers.length ? swfReport(this.legendSwf) : null,
      owners: this.owners ? swfReport(this.ownersSwf) : null,
      world: this.mapWorld, anchors: this.anchorsSeen,
      fit: f ? { n: f.n, rms: Math.round(f.rms * 100) / 100, holds: fitHolds(f), turn: Math.round(clipTransform(f).rotation + clipTransform(f).inner) } : null,
    };
    logTrace(this, "map swfs", JSON.stringify(report));
    sendCustomPacket(this.controller, { customPacketType: "dbo", event: "mapSwf", args: [report], widget: 0 });
  }

  // The legend inside the map (dbo_maplegend): loaded each opening, the browser's for that opening if it never comes alive
  private loadLegend(): void {
    const step = this.loadSwf(this.legendSwf, LEGEND_HOST, "dboMapLegend", "9991", LEGEND_SWF);
    if (step === "up") {
      logTrace(this, "map legend drawn in the map");
      this.publish();
    } else if (step === "fail") {
      logTrace(this, "the map legend never came alive in the map: the browser draws it this opening");
      this.sp.browser.setVisible(true);
      this.publish();
    }
  }

  // ---- who owns what (mapOwners.ts): loaded like the legend, drawn once per world, lined up with the markers each frame ----
  private followOwners(): void {
    const ui = this.sp.Ui;
    const st = this.ownersSwf;
    const step = this.loadSwf(st, OWNERS_HOST, "dboMapOwners", "9989", OWNERS_SWF);
    if (step === "up") logTrace(this, "map owners overlay drawn in the map");
    else if (step === "fail") logTrace(this, "the map owners overlay never came alive in the map");
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
      if (st.t.drawn < 0) st.t.drawn = this.ticksOpen;
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
    if (holds && st.t.fit < 0) st.t.fit = this.ticksOpen;
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
    if (this.legendSwf.phase === "up") {
      if (widget) { widget = null; closeWidget(this.sp, WIDGET_ID); }
      try { this.sp.Ui.invokeString(MAP_MENU, `${LEGEND_HOST}.dboData`, legendJson(this.legendShown, rows)); } catch (err) { logError(this, "map legend data failed", err); }
      return;
    }
    // still loading: nothing yet (the swf, or after its last try the browser)
    if (this.legendSwf.phase !== "off") return;
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

  // ---- the map probe (Leader, 2 Nov), once a session, on the first opening of the map ----
  // Nat's mapSwf line showed load calls made and no clip ever there. This settles what the client can do with SkyUI's
  // map at all, in one opening: read (properties and the first marker clips' positions), write and read back a variable,
  // create a clip on three targets and read each back two ways, and (T5) whether our own CustomMenu opens over the open
  // map and the map stays open. It goes out as the mapTest event, which the server already logs and shows staff (T1 the
  // reads and clips, T3 the CustomMenu, T4 the variable), so no server change is needed.
  private runProbe(): void {
    const ui = this.sp.Ui;
    const p = this.probe;
    const t = this.ticksOpen;
    const str = (path: string) => { try { return ui.getString(MAP_MENU, path); } catch (e) { return "ERR"; } };
    const num = (path: string) => { try { return Math.round(ui.getFloat(MAP_MENU, path) * 10) / 10; } catch (e) { return NaN; } };
    const TARGETS = ["_root", "_root.WorldMap", "_root.MarkerClips"];
    if (t === 30) {
      const n = (() => { try { return ui.getInt(MAP_MENU, MARKER_COUNT); } catch (e) { return -1; } })();
      const first = [0, 1, 2].map((i) => `${str(`${MARKER_CLIP(i)}.label`)}@${num(`${MARKER_CLIP(i)}._x`)},${num(`${MARKER_CLIP(i)}._y`)}`).join(" | ");
      p.r.reads = `root ${str("_root._name")} WorldMap ${str("_root.WorldMap._name")} MarkerClips ${str("_root.MarkerClips._name")} at ${num("_root.MarkerClips._x")},${num("_root.MarkerClips._y")} x${num("_root.MarkerClips._xscale")}; ${n} markers; ${first}`;
      try { ui.setFloat(MAP_MENU, "_root.dboProbeVar", 42); } catch (e) { /* read back below */ }
      TARGETS.forEach((target, k) => { try { ui.invokeStringA(MAP_MENU, `${target}.createEmptyMovieClip`, [`dboProbe${k}`, String(9980 + k)]); } catch (e) { /* read back below */ } });
    } else if (t === 33) {
      p.r.variable = `_root.dboProbeVar ${num("_root.dboProbeVar")}`;
      p.r.clips = TARGETS.map((target, k) => {
        const c = `${target}.dboProbe${k}`;
        try { ui.setFloat(MAP_MENU, `${c}.dboMark`, 7); } catch (e) { /* read back below */ }
        return `${target}: name "${str(`${c}._name`)}" mark ${num(`${c}.dboMark`)}`;
      }).join(" | ");
    } else if (t === 60) {
      // T5: our own CustomMenu over the open map (the panel shows for about three seconds)
      try { if (!ui.isMenuOpen("CustomMenu")) { ui.openCustomMenu("dbo_testmenu", 0); p.opened = true; } else p.r.t5 = "skipped: a CustomMenu was already open"; } catch (e) { p.r.t5 = `open threw ${e}`; }
    } else if (t === 120 && p.opened) {
      let custom = false, map = false;
      try { custom = ui.isMenuOpen("CustomMenu"); map = ui.isMenuOpen(MAP_MENU); } catch (e) { /* both false */ }
      p.r.t5 = `CustomMenu open ${custom}, map still open ${map}, its version "${(() => { try { return ui.getString("CustomMenu", "_root.dboVersion"); } catch (e) { return "ERR"; } })()}"`;
    } else if (t === 240 && p.opened) {
      try { ui.closeCustomMenu(); } catch (e) { /* the map's own close will */ }
      p.opened = false;
    } else if (t === 250) {
      let map = false; try { map = ui.isMenuOpen(MAP_MENU); } catch (e) { map = false; }
      p.r.t5 = `${p.r.t5 || "not run"}; after closing it the map open ${map}`;
      this.sendProbe("done");
    }
  }

  private sendProbe(end: string): void {
    const p = this.probe;
    if (p.done) return;
    p.done = true;
    if (p.opened) { try { this.sp.Ui.closeCustomMenu(); } catch (e) { /* gone with the map */ } p.opened = false; }
    const r = { t1: `READS ${p.r.reads || "not run"} || CLIPS ${p.r.clips || "not run"}`, t3: `T5 ${p.r.t5 || "not run"}`, t4: p.r.variable || "not run", markers: "probe", end: `probe ${end} at frame ${this.ticksOpen}` };
    logTrace(this, "map probe", JSON.stringify(r));
    sendCustomPacket(this.controller, { customPacketType: "dbo", event: "mapTest", args: [r], widget: 0 });
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
  private legendSwf: SwfLoad = newSwfLoad();
  private ownersSwf: SwfLoad = newSwfLoad();
  private openings = 0;
  private probe: { done: boolean; opened: boolean; r: Record<string, string> } = { done: false, opened: false, r: {} };
  private owners: OwnersData | null = null;
  private anchors = new Map<string, Anchor>();
  private ownersShown = true;
  private ownersKey: number = TOGGLE_KEY;
  private drawnKey = "";
  private worldOwners = 0;
  private mapWorld = 0;
  private worldIds = new Map<string, number>();
  private anchorsSeen = 0;
  private lastFit: Fit | null = null;
}

interface MapTest { tick: number; samples: number[]; results: Record<string, unknown> }

