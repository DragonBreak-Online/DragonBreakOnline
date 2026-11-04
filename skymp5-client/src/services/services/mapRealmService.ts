import { ClientListener, CombinedController, Sp } from "./clientListener";
import { sendCustomPacket, parseCustomPacket } from "./customPacketUtil";
import { refreshFormMenu, closeWidget, readMenuKeyCode } from "./widgetMenuUtil";
import { keyName } from "./settingsLocal";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { ButtonEvent, InputDeviceType, Menu } from "skyrimPlatform";
import { logError, logTrace } from "../../logging";
import {
  LABELS_PER_TICK, LEGEND_MENU, LEGEND_OPEN_FRAME, LEGEND_SWF, MAP_MENU, MARKER_CLIP, MARKER_COUNT, RealmMarker, WIDGET_ID,
  descParts, keyAction, kindIndex, legendJson, legendRows, readMarkers, wantedScale, SwfLoad, newSwfLoad, swfStep, swfReport,
} from "./mapRealm";
import {
  ANCHORS_PER_FRAME, OWNERS_LAYER, StageArea, fitToStage, OwnersData, TOGGLE_KEY, TOGGLE_SETTING,
  anchorClips, drawingOf, fitOf, anchorIndex, legendRow, readOwners, worldFor, Anchor, Drawing, Homography, HOM_MIN, MAX_FIT_RMS, Seen,
  homographyOf, homHolds, homShift, projectDrawing, Fit, ClipTransform, fitHolds, clipTransform, trackOf, trackTransform,
} from "./mapOwners";
import { MapCost } from "./mapCost";

// for the browser-side widget setter (executed inside the CEF browser)
declare const window: any;

// Module-level so the browser-side widget setter can read it (runtime injection)
let widget: Record<string, unknown> | null = null;

// The realm on Skyrim's M map; see mapRealm.ts for the contract and the reasons
// How often a marker clip that reads no label is read again before it is taken as having none
const LABEL_TRIES = 10;

export class MapRealmService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onPacket(e));
    this.controller.on("menuOpen", (e) => { if (e.name === Menu.Map) this.onMapOpen(); });
    this.controller.on("menuClose", (e) => { if (e.name === Menu.Map) this.onMapClose(); });
    this.controller.on("buttonEvent", (e) => this.onButton(e));
    this.controller.on("mouseMove", () => { if (this.open && this.legendMenuOpen && !this.probe.done) this.probe.mouseMoves++; });
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
      this.labelsVer++;
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
    this.labelTries = [];
    this.applied = [];
    this.mounted = false;
    this.ticksOpen = 0;
    this.openings++;
    this.legendSwf = newSwfLoad();
    this.ownersSwf = newSwfLoad();
    this.drawnKey = "";
    this.lastFit = null;
    this.goodFit = null;
    this.drawnFit = null;
    this.drawnAt = 0;
    this.flatSent = false;
    this.notFlat = false;
    this.prevView = new Map();
    this.relabelAt = 0;
    this.relabels = 0;
    this.shape = null;
    this.shapeT = null;
    this.tracked = false;
    this.layerAt = {};
    this.samplesSent = 0;
    this.sampledAt = 0;
    this.layerShown = false;
    this.passTabAt = 0;
    this.mapSeen = false;
    this.flash = newFlash();
    this.mapWorld = 0;
    this.cost = new MapCost(Date.now());
    this.labelsVer++;
    if (this.testArmed) { this.testArmed = false; this.test = { tick: 0, samples: [], results: {} }; }
  }

  private onMapClose(): void {
    this.open = false;
    this.closeLegendMenu();
    this.reportSwfs();
    this.reportCost();
    if (!this.probe.done && this.ticksOpen > 0) this.sendProbe("the map closed early");
    if (widget) { widget = null; closeWidget(this.sp, WIDGET_ID); }
    if (this.test) this.finishTests("the map closed");
  }

  // Digits toggle a kind and R the legend, while the map is open; the map keeps its own keys, nothing is focused
  private onButton(e: ButtonEvent): void {
    if (this.open && this.legendMenuOpen && !this.probe.done && e.isDown && e.device === InputDeviceType.Mouse) this.probe.clicks++;
    if (!this.open || !e.isDown || e.device !== InputDeviceType.Keyboard) return;
    // another CustomMenu over the map (a server panel; ours is the only other): its keys, not the map's (W5, 2 Nov)
    let panelUp = false;
    try { panelUp = (this.overlay || !this.legendMenuOpen) && this.sp.Ui.isMenuOpen(LEGEND_MENU); } catch { panelUp = false; }
    if (panelUp) return;
    if (this.legendMenuOpen && !this.overlay && MAP_CLOSE_KEYS.includes(e.code)) {
      this.closeLegendMenu();
      this.passTabAt = this.ticksOpen + 2;
      return;
    }
    if (this.ownersKey && e.code === this.ownersKey && this.owners) {
      this.ownersShown = !this.ownersShown;
      if (this.mapWorld > 0) this.ownersChoice.set(this.mapWorld, this.ownersShown);
      this.publish();
      return;
    }
    if (!this.markers.length) return;
    const a = keyAction(e.code);
    if (!a) return;
    if (a.legend) { this.legendShown = !this.legendShown; if (!this.legendShown) this.closeLegendMenu(true); }
    if (a.toggle) {
      if (this.hidden.has(a.toggle)) this.hidden.delete(a.toggle); else this.hidden.add(a.toggle);
      this.applied = [];
    }
    this.publish();
  }

  // ---- every frame the map is open ----
  private onUpdate(): void {
    this.reveal();
    this.sweep();
    if (!this.open) return;
    this.ticksOpen++;
    this.cost.frame(Date.now());
    try {
      // our menu had the key, so the map never heard it: Tab now closes the map (only while it is still open)
      if (this.passTabAt && this.ticksOpen >= this.passTabAt) { this.passTabAt = 0; this.sp.Input.tapKey(TAB); }
      // browserService hides the browser for the map; a browser legend needs it shown (unfocused: the map keeps the keys)
      if (this.test && this.ticksOpen <= 3) this.sp.browser.setVisible(true);
      if (this.markers.length) {
        this.cost.time("legend", () => this.loadLegend());
        this.cost.time("labels", () => this.readLabels());
        this.cost.time("filter", () => this.applyFilter());
        if (this.ticksOpen === 2 || this.ticksOpen % 30 === 0) this.cost.time("publish", () => this.publish());
      }
      // Who owns what is drawn in our legend menu over the map (nothing can be made inside SkyUI's map: the 2 Nov probe)
      if (this.owners) this.cost.time("owners", () => this.followOwners());
      if (this.test) this.runTests();
      if (!this.probe.done) this.runProbe();
    } catch (err) {
      logError(this, "map frame failed", err);
    }
  }

  // The safety net (Leader, 2 Nov: Nat's game kept running with every key swallowed, and an invisible CustomMenu fits).
  // Our legend is opened a frame or more after openCustomMenu, so a map that closes in between leaves it open over
  // nothing; a map the engine closes may also never send us its close. So on every tick: once the MapMenu has been shut
  // for two ticks, the opening is closed if we still think it open, and a CustomMenu whose movie is our legend is closed.
  // Only ours: another CustomMenu (a server panel) has no maplegend version and is left alone.
  private sweep(): void {
    const ui = this.sp.Ui;
    let mapOpen = true;
    try { mapOpen = ui.isMenuOpen(MAP_MENU); } catch { return; }
    if (mapOpen && this.open) this.mapSeen = true;
    this.mapShutTicks = mapOpen ? 0 : this.mapShutTicks + 1;
    if (this.mapShutTicks < 2) return;
    // an opening whose map has not shown yet is waiting for it (its open event can come first), not closed
    if (this.open && this.mapSeen) { logTrace(this, "the map closed without telling us; closing its opening"); this.onMapClose(); }
    let ours = false;
    try { ours = ui.isMenuOpen(this.menu) && /^maplegend/.test(String(ui.getString(this.menu, "_root.dboVersion") || "")); } catch { ours = false; }
    if (!ours) return;
    this.legendMenuOpen = false;
    this.orphans++;
    // once in the log per session and then every 100th, with the trace of the opening it outlived
    if (this.orphans === 1 || this.orphans % 100 === 0) logTrace(this, "our map legend was open with no map: closed", String(this.orphans));
    try { this.closeMenu(); } catch (err) { logError(this, "the orphaned map legend could not be closed", err); }
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
      const label = ui.getString(MAP_MENU, `${MARKER_CLIP(i)}.label`) || "";
      read++;
      // A clip SkyUI has made but not labelled yet reads empty: kept unread and tried again (Nat, 2 Nov: a legend that
      // stored those empties counted 10 of 388 markers and none of the realm's), up to LABEL_TRIES times for one with none
      const tries = (this.labelTries[i] || 0) + 1;
      if (label || tries >= LABEL_TRIES) { this.labels[i] = label; this.labelsVer++; } else this.labelTries[i] = tries;
    }
    if (this.labels.length > n) { this.labels.length = n; this.applied.length = Math.min(this.applied.length, n); this.labelsVer++; }
    // Read again, a few a frame: a clip SkyUI gives another marker while the map is open kept the old label here, and a
    // number key's hide then landed on the wrong places (live, 3 Nov: "the toggles toggle things completely unrelated")
    if (read < LABELS_PER_TICK && n > 0) {
      for (let k = 0; k < RELABEL_PER_TICK; k++) {
        const i = this.relabelAt++ % n;
        if (typeof this.labels[i] !== "string" || !this.labels[i]) continue;
        const label = ui.getString(MAP_MENU, `${MARKER_CLIP(i)}.label`) || "";
        if (label && label !== this.labels[i]) { this.labels[i] = label; delete this.applied[i]; this.relabels++; this.labelsVer++; }
      }
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
      this.cost.act("filter");
    }
  }

  // One line a map opening to the server log: how far each swf got, at which frames, and the fit
  private reportSwfs(): void {
    if (!this.markers.length && !this.owners) return;
    const f = this.lastFit;
    const report = {
      opening: this.openings, frames: this.ticksOpen,
      legend: this.markers.length ? swfReport(this.legendSwf) : null,
      owners: this.owners ? swfReport(this.ownersSwf) : null,
      world: this.mapWorld, anchors: this.anchorsSeen, notFlat: this.notFlat, relabels: this.relabels,
      flash: Object.assign({}, this.flash, { lastHolds: undefined, seconds: Math.round((Date.now() - this.flash.at) / 100) / 10 }),
      fit: f ? { n: f.n, rms: Math.round(f.rms * 100) / 100, affine: f.affine, holds: f.n >= HOM_MIN && f.rms <= MAX_FIT_RMS } : null,
    };
    logTrace(this, "map swfs", JSON.stringify(report));
    sendCustomPacket(this.controller, { customPacketType: "dbo", event: "mapSwf", args: [report], widget: 0 });
  }

  // The legend as our own CustomMenu over the map (Leader, 2 Nov: the probe showed nothing can be made inside SkyUI's map,
  // and our CustomMenu draws over it with the map staying open). dbo_maplegend runs as that menu's movie; R closes it.
  // Opened only while no other CustomMenu is up (there is one at a time, and the server's panels use it), one try an
  // opening, the browser's legend for that opening if it never comes alive
  private loadLegend(): void {
    if (!this.legendShown) return;
    const ui = this.sp.Ui;
    const st = this.legendSwf;
    const seen = { menu: false, clip: false, url: "", alive: false };
    // Only once the map has settled and shows its markers: our CustomMenu opened on frame 60 came alive (T5, 04:11Z), the
    // legend's opened on frame 1 loaded its swf but its script never answered (04:32Z). "menu" is that moment in its trace
    try { seen.menu = ui.isMenuOpen(MAP_MENU) && this.ticksOpen >= LEGEND_OPEN_FRAME && this.labels.length > 0; } catch { seen.menu = false; }
    let busy = false;
    try { busy = st.phase === "idle" && !this.overlay && ui.isMenuOpen(LEGEND_MENU); } catch { busy = false; }
    if (busy) return;
    if (st.phase === "loading" || st.phase === "up") {
      try { seen.clip = ui.isMenuOpen(this.menu); } catch { seen.clip = false; }
      try { seen.url = ui.getString(this.menu, "_root._url") || ""; } catch { seen.url = ""; }
      // read back as "Yes" from a CustomMenu though the movie sets "yes" (Nat, 05:05Z: its script had run, and the exact
      // compare called it dead), so any case counts
      try { seen.alive = /^yes$/i.test(String(ui.getString(this.menu, "_root.dboAlive") || "")); } catch { seen.alive = false; }
    }
    const step = swfStep(st, this.ticksOpen, seen, LEGEND_SWF, 1);
    if (step === "inject") {
      try { this.openMenu(LEGEND_SWF.replace(/\.swf$/i, "")); this.legendMenuOpen = true; } catch (err) { logError(this, "the map legend menu could not be opened", err); }
      return;
    }
    if (step === "up") {
      logTrace(this, "map legend drawn over the map");
      this.publish();
    } else if (step === "fail") {
      logTrace(this, "the map legend menu never came alive: the browser draws it this opening");
      st.t.url = `${st.t.url} [${this.legendMenuState()}]`;
      this.closeLegendMenu();
      this.sp.browser.setVisible(true);
      this.publish();
    }
  }

  // reopenable: R hid it, so showing it again opens it again (the opening's trace kept); a failed or closing one stays down
  // What our CustomMenu's movie is doing: its frame, frames loaded and the version its script sets (empty if it never ran)
  private legendMenuState(): string {
    const ui = this.sp.Ui;
    const get = (path: string) => { try { return ui.getString(this.menu, path); } catch (e) { return "ERR"; } };
    const n = (path: string) => { try { return ui.getFloat(this.menu, path); } catch (e) { return NaN; } };
    return `frame ${n("_root._currentframe")}/${n("_root._framesloaded")}, version "${get("_root.dboVersion")}", alive "${get("_root.dboAlive")}"`;
  }

  private closeLegendMenu(reopenable = false): void {
    if (!this.legendMenuOpen) return;
    this.flash.closes.push(this.ticksOpen);
    this.legendMenuOpen = false;
    // the colours went with the menu: drawn again when it is back
    this.drawnKey = "";
    this.layerShown = false;
    this.drawnFit = null;
    this.flatSent = false;
    this.tracked = false;
    this.layerAt = {};
    if (this.ownersSwf.phase === "up") this.ownersSwf.phase = "idle";
    try { this.closeMenu(); } catch (err) { logError(this, "the map legend menu could not be closed", err); }
    if (reopenable && this.legendSwf.phase === "up") { this.legendSwf.phase = "idle"; this.legendSwf.frames = 0; this.legendSwf.tries = 0; }
  }

  // ---- who owns what (mapOwners.ts): loaded like the legend, drawn once per world, lined up with the markers each frame ----
  private followOwners(): void {
    const ui = this.sp.Ui;
    const st = this.ownersSwf;
    // It rides on the legend's CustomMenu (one CustomMenu at a time): nothing until that is up; its trace says when
    if (this.legendSwf.phase !== "up" || !this.owners) return;
    if (st.phase !== "up") { st.phase = "up"; st.t.menu = this.ticksOpen; st.t.alive = this.ticksOpen; this.stage = null; }
    // the world this map shows: the player's (an interior has none, so no colours there)
    if (!this.mapWorld) {
      try { const w = this.sp.Game.getPlayer()?.getWorldSpace(); this.mapWorld = w ? w.getFormID() >>> 0 : -1; } catch { this.mapWorld = -1; }
    }
    const world = this.mapWorld > 0 ? worldFor(this.owners, (d) => this.formIdOf(d), this.mapWorld) : null;
    const layer = `${OWNERS_LAYER}`;
    if (!world) { ui.setBool(this.menu, `${layer}._visible`, false); this.layerShown = false; return; }
    // Shown from the start only on a flat map (over the 3D relief no fit from the markers holds: Nat, 2 Nov); T turns
    // them on or off anywhere, and that choice stays with the world for the session
    const chosen = this.ownersChoice.get(this.mapWorld);
    this.ownersShown = chosen !== undefined ? chosen : world.flat === true && !this.notFlat;
    const key = world.world + "#" + world.territories.map((t) => t.owner).join("|");
    if (key !== this.drawnKey) {
      this.drawnKey = key;
      this.worldOwners = new Set(world.territories.map((t) => t.owner)).size;
      this.flash.redraws++;
      this.drawing = drawingOf(world, this.owners.factions, this.owners.reach, this.owners.fade, world.flat === true);
      this.drawnFit = null;
      this.flatSent = false;
      this.publish();
    }
    // the two stages, read once an opening: the map's visible size (SkyUI's _mapWidth/_mapHeight) and our menu's
    if (!this.stage) {
      const g = (menu: string, path: string) => { try { return ui.getFloat(menu, path); } catch (e) { return 0; } };
      this.stage = {
        mapW: g(MAP_MENU, "_root.WorldMap._mapWidth"), mapH: g(MAP_MENU, "_root.WorldMap._mapHeight"),
        ours: { left: g(this.menu, "_root.dboStageL"), top: g(this.menu, "_root.dboStageT"), width: g(this.menu, "_root.dboStageW") || 1280, height: g(this.menu, "_root.dboStageH") || 720 },
      };
      st.t.url = `map ${this.stage.mapW}x${this.stage.mapH}, ours ${this.stage.ours.width}x${this.stage.ours.height} at ${this.stage.ours.left},${this.stage.ours.top}`;
    }
    if (world.flat === true && !this.notFlat) { this.followFlat(layer); return; }
    // Off a flat map (T turned them on over the 3D relief): each frame fits a homography to every anchor the map shows; one that does not hold leaves the colours where they
    // were (never hidden: Nat saw them flash on 2 Nov). The drawing is projected and sent again only when the fit would
    // move it by more than LAYER_STILL px, at most every REDRAW_FRAMES frames while the map moves: a still map sends nothing.
    const fit = this.ownersShown ? this.fitNow() : null;
    const holds = this.ownersShown && homHolds(fit);
    const fl = this.flash;
    if (this.ownersShown) { if (!fit) fl.noFit++; else if (holds) fl.held++; else fl.failed++; }
    if (fit && fl.lastHolds !== null && fl.lastHolds !== holds) fl.flips++;
    if (fit) fl.lastHolds = holds;
    try { if (!this.sp.Ui.isMenuOpen(this.menu)) fl.menuGone++; } catch { /* counted only when readable */ }
    if (holds && fit) this.goodFit = fit;
    const good = this.goodFit;
    if (this.ownersShown && good && this.drawing) {
      const shift = this.drawnFit ? homShift(this.drawnFit, good, this.lastSeen) : Infinity;
      if (shift > LAYER_STILL && this.ticksOpen - this.drawnAt >= REDRAW_FRAMES) {
        const o = this.stage.ours;
        const k = { kx: o.width / (this.stage.mapW > 0 ? this.stage.mapW : o.width), ky: o.height / (this.stage.mapH > 0 ? this.stage.mapH : o.height), left: o.left, top: o.top };
        try { ui.invokeString(this.menu, "_root.dboOwners", JSON.stringify(projectDrawing(this.drawing, good, k))); } catch (err) { logError(this, "map owners data failed", err); }
        this.cost.act("owners");
        if (!this.drawnFit) { for (const [p, v] of LAYER_FLAT) ui.setFloat(this.menu, `${layer}${p}`, v); }
        if (this.drawnFit) fl.maxStep.px = Math.max(fl.maxStep.px || 0, Math.round(shift * 10) / 10);
        this.drawnFit = good;
        this.drawnAt = this.ticksOpen;
        fl.moves++;
        if (st.t.drawn < 0) st.t.drawn = this.ticksOpen;
      }
    }
    const show = this.ownersShown && !!this.drawnFit;
    if (show !== this.layerShown) { ui.setBool(this.menu, `${layer}._visible`, show); this.layerShown = show; if (show) fl.shown++; else fl.hidden++; }
    if (fit) this.lastFit = { n: fit.n, rms: fit.rms, affine: this.lastAffine };
    if (holds && st.t.fit < 0) st.t.fit = this.ticksOpen;
  }

  // A flat map: the drawing sent once in world units, the shape fitted once, and the layer moved to the map's zoom, pan and
  // turn every frame from the anchors it shows (trackOf), in the same frame (Nat, 2 Nov: the redrawn colours lagged a pan
  // and snapped back). Positions are carried to our stage first, so the layer's numbers are our stage's.
  private followFlat(layer: string): void {
    const ui = this.sp.Ui;
    const st = this.ownersSwf;
    const fl = this.flash;
    if (!this.ownersShown || !this.drawing || !this.stage) {
      if (this.layerShown) { ui.setBool(this.menu, `${layer}._visible`, false); this.layerShown = false; fl.hidden++; }
      return;
    }
    if (!this.flatSent) {
      try { ui.invokeString(this.menu, "_root.dboOwners", JSON.stringify(this.drawing)); } catch (err) { logError(this, "map owners data failed", err); }
      this.cost.act("owners");
      this.flatSent = true;
      this.layerAt = {};
      if (st.t.drawn < 0) st.t.drawn = this.ticksOpen;
    }
    this.fitNow();
    const o = this.stage.ours;
    const kx = o.width / (this.stage.mapW > 0 ? this.stage.mapW : o.width), ky = o.height / (this.stage.mapH > 0 ? this.stage.mapH : o.height);
    const seen = this.lastSeenAt === this.ticksOpen ? this.lastSeen.map((q) => ({ x: q.x, y: q.y, sx: o.left + q.sx * kx, sy: o.top + q.sy * ky })) : [];
    // Flat or not, judged on a still view of enough anchors: Nat's paper maps fit to 0.02-0.9 px and the 3D relief to 30+.
    // Three points fit any map, so a shape from fewer warped the colours for players whose paper maps had not installed
    // (live, 3 Nov: right at the bottom left, warped going right); a map that is not flat leaves the flat path this opening
    if (seen.length >= FLAT_MIN_ANCHORS && this.steadyView(seen)) {
      const f = fitOf(seen);
      if (f && f.rms > FLAT_MAX_RMS) {
        this.notFlat = true;
        logTrace(this, "the map is not flat (affine rms", String(Math.round(f.rms)), "over", String(seen.length), "anchors): no flat colours this opening");
        if (this.layerShown) { ui.setBool(LEGEND_MENU, `${layer}._visible`, false); this.layerShown = false; fl.hidden++; }
        return;
      }
      if (f && !this.shape) { this.shape = f; this.shapeT = clipTransform(f); }
    }
    const t = this.shape ? trackOf(this.shape, seen) : null;
    const holds = !!t && t.rms <= MAX_FIT_RMS;
    if (!t) fl.noFit++; else if (holds) fl.held++; else fl.failed++;
    if (t && fl.lastHolds !== null && fl.lastHolds !== holds) fl.flips++;
    if (t) fl.lastHolds = holds;
    if (holds && t && this.shapeT) {
      const c = trackTransform(this.shapeT, t);
      const parts: [string, number][] = [["._x", c.x], ["._y", c.y], ["._xscale", c.xscale], ["._yscale", c.yscale], ["._rotation", c.rotation], [".shapes._rotation", c.inner]];
      let wrote = false;
      for (const [p, v] of parts) {
        const was = this.layerAt[p];
        if (was !== undefined && Math.abs(was - v) < LAYER_STILL / 10) continue;
        if (was !== undefined) fl.maxStep[p] = Math.max(fl.maxStep[p] || 0, Math.round(Math.abs(was - v) * 10) / 10);
        ui.setFloat(this.menu, `${layer}${p}`, v);
        this.cost.act(p === "._x" || p === "._y" ? "move" : "scale");
        this.layerAt[p] = v;
        wrote = true;
      }
      if (wrote) fl.moves++;
      this.tracked = true;
      if (st.t.fit < 0) st.t.fit = this.ticksOpen;
    }
    const show = this.tracked;
    if (show !== this.layerShown) { ui.setBool(this.menu, `${layer}._visible`, show); this.layerShown = show; if (show) fl.shown++; else fl.hidden++; }
    if (t) this.lastFit = { n: t.n, rms: t.rms, affine: this.lastAffine };
  }

  // A view is still when every anchor seen on the frame before has moved less than half a pixel since
  private steadyView(seen: Seen[]): boolean {
    const now = new Map<string, [number, number]>();
    let common = 0, moved = false;
    for (const q of seen) {
      const k = q.x + "," + q.y;
      now.set(k, [q.sx, q.sy]);
      const was = this.prevView.get(k);
      if (!was) continue;
      common++;
      if (Math.hypot(was[0] - q.sx, was[1] - q.sy) >= 0.5) moved = true;
    }
    this.prevView = now;
    return common >= FLAT_MIN_ANCHORS && !moved;
  }

  // Every anchor the map shows this frame, in the root's own units; the affine rms on the same set is kept for the report,
  // so a line from the game says how much the homography gains on that map
  private fitNow(): Homography | null {
    const ui = this.sp.Ui;
    const clips = this.anchorClipsNow();
    this.anchorsSeen = clips.length;
    if (clips.length < 2) return null;
    const box = "_root.MarkerClips";
    const bx = ui.getFloat(MAP_MENU, `${box}._x`) || 0, by = ui.getFloat(MAP_MENU, `${box}._y`) || 0;
    const kx = (ui.getFloat(MAP_MENU, `${box}._xscale`) || 100) / 100, ky = (ui.getFloat(MAP_MENU, `${box}._yscale`) || 100) / 100;
    const seen: Seen[] = [];
    for (const { i, a } of clips) {
      const clip = MARKER_CLIP(i);
      if (!ui.getBool(MAP_MENU, `${clip}._visible`)) continue;
      seen.push({ sx: bx + ui.getFloat(MAP_MENU, `${clip}._x`) * kx, sy: by + ui.getFloat(MAP_MENU, `${clip}._y`) * ky, x: a.x, y: a.y });
    }
    this.lastSeen = seen;
    this.lastSeenAt = this.ticksOpen;
    const H = homographyOf(seen);
    if (H) { const af = fitOf(seen); this.lastAffine = af ? Math.round(af.rms * 100) / 100 : -1; }
    if (H) this.sampleFit(H, seen);
    return H;
  }

  // A few whole marker sets a map opening, for checking the fit on the real map (Leader, 2 Nov): the first fit and then one
  // every SAMPLE_EVERY frames, SAMPLES at most, each its own mapOwnersFit line (the server logs 400 characters of it): the
  // homography and its rms, the affine rms on the same set, and up to SAMPLE_POINTS anchors as world x, y and screen x, y
  private sampleFit(H: Homography, seen: Seen[]): void {
    if (this.samplesSent >= SAMPLES || (this.samplesSent > 0 && this.ticksOpen - this.sampledAt < SAMPLE_EVERY)) return;
    this.samplesSent++;
    this.sampledAt = this.ticksOpen;
    const r1 = (v: number) => Math.round(v * 10) / 10;
    const sample = {
      t: this.ticksOpen, n: H.n, rms: r1(H.rms), affine: this.lastAffine,
      h: H.h.map((v) => Number(v.toPrecision(5))),
      p: seen.slice(0, SAMPLE_POINTS).map((s) => [Math.round(s.x), Math.round(s.y), r1(s.sx), r1(s.sy)]),
    };
    sendCustomPacket(this.controller, { customPacketType: "dbo", event: "mapOwnersFit", args: [sample], widget: 0 });
  }

  private anchorClipsNow(): Array<{ i: number; a: Anchor }> {
    if (this.clipsVer !== this.labelsVer) { this.clips = anchorClips(this.labels, this.anchors); this.clipsVer = this.labelsVer; }
    return this.clips;
  }

  // One line a map opening: the JS each step cost and the frames over SLOW_FRAME_MS by what the frame before sent
  private reportCost(): void {
    if (!this.owners && !this.markers.length) return;
    const extra = { opening: this.openings, world: this.mapWorld, colours: this.ownersShown, notFlat: this.notFlat, anchors: this.anchorsSeen };
    const r = Object.assign(this.cost.report(Date.now()), extra);
    logTrace(this, "map cost", JSON.stringify(r));
    sendCustomPacket(this.controller, { customPacketType: "dbo", event: "npcDrift", args: [r], widget: 0 });
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
      try { this.sp.Ui.invokeString(this.menu, "_root.dboData", legendJson(this.legendShown, rows)); } catch (err) { logError(this, "map legend data failed", err); }
      this.cost.act("legend");
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
  // The first probe (04:11Z) showed: nothing can be made inside SkyUI's map; names, labels, counts and variables read and
  // write; marker positions read 0,0, once, on frame 30; and our CustomMenu draws over the open map. This one settles the
  // positions and the input, so the owners overlay can be drawn in our own menu or given up: the first six markers' _x/_y
  // and MarkerClips' own offset and scale at frames 120 and 240, then every 120 frames to frame 1200 (twenty seconds, for
  // Nat to pan in), whether they move between samples, and, while the legend's CustomMenu is up, the mouse moves and clicks
  // the client still hears. It goes out as the mapTest event the server already logs: T1 the positions, T2 how many samples
  // moved, T3 the legend menu, T4 the input.
  private runProbe(): void {
    const ui = this.sp.Ui;
    const p = this.probe;
    const t = this.ticksOpen;
    if (t < 120 || t % 120 !== 0) return;
    const num = (path: string) => { try { return Math.round(ui.getFloat(MAP_MENU, path) * 10) / 10; } catch (e) { return NaN; } };
    const box = `${num("_root.MarkerClips._x")},${num("_root.MarkerClips._y")} x${num("_root.MarkerClips._xscale")}`;
    const marks = [0, 1, 2, 3, 4, 5].map((i) => `${num(`${MARKER_CLIP(i)}._x`)},${num(`${MARKER_CLIP(i)}._y`)}`).join(" ");
    p.samples.push(`${box} | ${marks}`);
    if (t === 360) {
      let custom = false, map = false;
      try { custom = ui.isMenuOpen(this.menu); map = ui.isMenuOpen(MAP_MENU); } catch (e) { /* both false */ }
      p.r.menu = `legend menu ${this.legendSwf.phase} (open ${custom}${custom ? `, ${this.legendMenuState()}` : ""}), map open ${map}`;
    }
    if (t >= 1200) this.sendProbe("done");
  }

  private sendProbe(end: string): void {
    const p = this.probe;
    if (p.done) return;
    p.done = true;
    const labels = [0, 1, 2, 3, 4, 5].map((i) => (typeof this.labels[i] === "string" ? this.labels[i] : "?")).join(", ");
    let moved = 0, still = 0;
    for (let i = 1; i < p.samples.length; i++) { if (p.samples[i] !== p.samples[i - 1]) moved++; else still++; }
    const r = {
      t1: `POSITIONS of ${labels}: ${p.samples.length ? `at 120 ${p.samples[0]} || last ${p.samples[p.samples.length - 1]}` : "none read"}`,
      t2: { still, panning: moved, frames: p.samples.length },
      t3: p.r.menu || `legend menu ${this.legendSwf.phase}`,
      t4: `input while our menu was open: ${p.mouseMoves} mouse moves, ${p.clicks} clicks`,
      markers: `${this.labels.length}`,
      end: `probe ${end} at frame ${this.ticksOpen}`,
    };
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
  private labelTries: number[] = [];
  private applied: number[] = [];
  private mounted = false;
  private testArmed = false;
  private test: MapTest | null = null;
  private legendSwf: SwfLoad = newSwfLoad();
  private legendMenuOpen = false;
  private stage: { mapW: number; mapH: number; ours: StageArea } | null = null;
  private ownersSwf: SwfLoad = newSwfLoad();
  private openings = 0;
  private probe: { done: boolean; r: Record<string, string>; samples: string[]; mouseMoves: number; clicks: number } = { done: false, r: {}, samples: [], mouseMoves: 0, clicks: 0 };
  private owners: OwnersData | null = null;
  private anchors = new Map<string, Anchor>();
  private ownersShown = true;
  private ownersChoice = new Map<number, boolean>();
  private ownersKey: number = TOGGLE_KEY;
  private drawnKey = "";
  private worldOwners = 0;
  private mapWorld = 0;
  private worldIds = new Map<string, number>();
  private anchorsSeen = 0;
  private lastFit: { n: number; rms: number; affine: number } | null = null;
  private goodFit: Homography | null = null;
  private drawnFit: Homography | null = null;
  private drawnAt = 0;
  private drawing: Drawing | null = null;
  private lastSeen: Seen[] = [];
  private lastAffine = -1;
  private lastSeenAt = -1;
  private flatSent = false;
  // This opening's map measured not flat (a 3D map where the server's world list says paper)
  private notFlat = false;
  private prevView = new Map<string, [number, number]>();
  private relabelAt = 0;
  private relabels = 0;
  private shape: Fit | null = null;
  private shapeT: ClipTransform | null = null;
  private tracked = false;
  private layerAt: Record<string, number> = {};
  private samplesSent = 0;
  private sampledAt = 0;
  private layerShown = false;
  private passTabAt = 0;

  // SkyrimPlatform's overlay menu (no input taken, so the map keeps WASD and the wheel) when this build has it, else SKSE's
  // modal CustomMenu
  private get overlay(): boolean {
    const o = (this.sp as any).overlayMenu;
    return !!o && typeof o.open === "function" && typeof o.menuName === "string";
  }
  private get menu(): string { return this.overlay ? (this.sp as any).overlayMenu.menuName : LEGEND_MENU; }
  private openMenu(swf: string): void { if (this.overlay) (this.sp as any).overlayMenu.open(swf); else this.sp.Ui.openCustomMenu(swf, 0); }
  private closeMenu(): void { if (this.overlay) (this.sp as any).overlayMenu.close(); else this.sp.Ui.closeCustomMenu(); }
  private mapShutTicks = 0;
  private mapSeen = false;
  private orphans = 0;
  private flash: Flash = newFlash();
  private cost = new MapCost(Date.now());
  // Bumped whenever a label or the anchors change, so the cached anchor clips are made again
  private labelsVer = 0;
  private clipsVer = -1;
  private clips: Array<{ i: number; a: Anchor }> = [];
}

// What could make the colours flash, counted per opening: frames whose fit held, failed or had too few markers, how often
// that changed, the layer shown and hidden, frames it moved, its largest single step per value, sign or half-turn changes,
// owners redrawn, our menu closed (frames) and frames it was not open; seconds give the frame rate
interface Flash { at: number; held: number; failed: number; noFit: number; flips: number; lastHolds: boolean | null; shown: number; hidden: number; moves: number; maxStep: Record<string, number>; signFlips: number; redraws: number; closes: number[]; menuGone: number }
const newFlash = (): Flash => ({ at: Date.now(), held: 0, failed: 0, noFit: 0, flips: 0, lastHolds: null, shown: 0, hidden: 0, moves: 0, maxStep: {}, signFlips: 0, redraws: 0, closes: [], menuGone: 0 });

// While the map moves, one redraw every REDRAW_FRAMES frames at most (each sends the projected drawing to the movie). The
// layer itself stays flat: the points are already on our stage
const REDRAW_FRAMES = 2;
// A map is taken as flat only from a still view of this many anchors fitting within FLAT_MAX_RMS px
const FLAT_MIN_ANCHORS = 6;
const FLAT_MAX_RMS = 3;
// Labels read again each frame, round the map, once all are read
const RELABEL_PER_TICK = 8;
// Marker sets sent for checking the fit: SAMPLES an opening, SAMPLE_EVERY frames apart, SAMPLE_POINTS anchors each
const SAMPLES = 4;
const SAMPLE_EVERY = 600;
const SAMPLE_POINTS = 7;
const LAYER_FLAT: [string, number][] = [["._x", 0], ["._y", 0], ["._xscale", 100], ["._yscale", 100], ["._rotation", 0], [".shapes._rotation", 0]];
// A redraw that would move the colours by less than this (stage px) is not sent: the fit wobbles by that much
const LAYER_STILL = 0.5;
// Tab and Esc close the map; our CustomMenu takes the keys while it is up (2 Nov, Nat: Tab only worked after R)
const MAP_CLOSE_KEYS = [0x0f, 0x01];
const TAB = 0x0f;

interface MapTest { tick: number; samples: number[]; results: Record<string, unknown> }
