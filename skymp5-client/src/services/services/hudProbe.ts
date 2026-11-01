// The pure half of the HUD overlay probe (/testmenu hud, route H of _work/native-everything-1031.md): one step per frame
// against the HUD Menu through SkyrimPlatform's Ui calls, so a harness can drive it without the game. hudProbeService.ts
// arms it and sends the results.
//   T1 a clip the client makes in the HUD Menu (createEmptyMovieClip) and draws on through invokeFloatA: an aqua bar
//   T2 our own swf loaded into the HUD Menu (loadMovie of Data\Interface\dbo_hudprobe.swf into a second clip): whether it
//      loads and on which frame, whether its own frame clock runs, whether a call reaches it (dboPing) and whether its
//      SendModEvent comes back, whether it hears keys and the mouse while the HUD is up; it draws an amber bar
export const HUD_MENU = "HUD Menu";
export const T1_CLIP = "_root.dboHudProbe";
export const T2_CLIP = "_root.dboHudHost";
export const T2_SWF = "dbo_hudprobe.swf";
// About ten seconds at 60 frames: long enough for the tester to press a few keys and move the mouse
export const HOLD_TICKS = 600;
// A swf that has not said it is alive by then reads "never"; one that comes later still has its frame recorded
export const LOAD_TICKS = 180;
export const PING = "ping-1";

export interface HudUi {
  isMenuOpen(menu: string): boolean;
  invokeStringA(menu: string, target: string, args: string[] | null): void;
  invokeString(menu: string, target: string, arg: string): void;
  invokeFloatA(menu: string, target: string, args: number[] | null): void;
  getString(menu: string, target: string): string;
  getFloat(menu: string, target: string): number;
}

export interface ProbeState {
  tick: number;
  // the tick the loaded swf first said it was alive, 0 until then
  aliveAt: number;
  framesAtAlive: number;
  pongs: number;
  t1: Record<string, unknown>;
  t2: Record<string, unknown>;
  done: string;
}

export const newProbe = (): ProbeState => ({ tick: 0, aliveAt: 0, framesAtAlive: 0, pongs: 0, t1: {}, t2: {}, done: "" });

// The loaded swf's SendModEvent("dboHudProbe", "pong", frames), heard through on('modEvent')
export const notePong = (s: ProbeState, eventName: string, strArg: string): void => {
  if (eventName === "dboHudProbe" && strArg === "pong") s.pongs++;
};

// One frame; done is set when the probe has finished, with why
export const probeStep = (s: ProbeState, ui: HudUi): void => {
  if (s.done) return;
  if (!ui.isMenuOpen(HUD_MENU)) {
    if (s.tick) s.done = "the HUD menu closed";
    return;
  }
  s.tick++;
  const t = s.tick;
  if (t === 1) {
    ui.invokeStringA(HUD_MENU, "_root.createEmptyMovieClip", ["dboHudProbe", "9991"]);
    ui.invokeStringA(HUD_MENU, "_root.createEmptyMovieClip", ["dboHudHost", "9992"]);
  }
  if (t === 2) {
    s.t1.created = ui.getString(HUD_MENU, `${T1_CLIP}._name`);
    // An aqua bar, 200 x 40, left of centre
    ui.invokeFloatA(HUD_MENU, `${T1_CLIP}.beginFill`, [0x8fd3d0, 70]);
    ui.invokeFloatA(HUD_MENU, `${T1_CLIP}.moveTo`, [40, 300]);
    ui.invokeFloatA(HUD_MENU, `${T1_CLIP}.lineTo`, [240, 300]);
    ui.invokeFloatA(HUD_MENU, `${T1_CLIP}.lineTo`, [240, 340]);
    ui.invokeFloatA(HUD_MENU, `${T1_CLIP}.lineTo`, [40, 340]);
    ui.invokeFloatA(HUD_MENU, `${T1_CLIP}.lineTo`, [40, 300]);
    ui.invokeFloatA(HUD_MENU, `${T1_CLIP}.endFill`, []);
    s.t2.host = ui.getString(HUD_MENU, `${T2_CLIP}._name`);
    ui.invokeString(HUD_MENU, `${T2_CLIP}.loadMovie`, T2_SWF);
  }
  if (t === 3) Object.assign(s.t1, { width: ui.getFloat(HUD_MENU, `${T1_CLIP}._width`), height: ui.getFloat(HUD_MENU, `${T1_CLIP}._height`) });
  // T2: wait for the swf to say it is alive, then call into it once
  if (t >= 2 && !s.aliveAt) {
    if (ui.getString(HUD_MENU, `${T2_CLIP}.dboAlive`) === "yes") {
      s.aliveAt = t;
      s.framesAtAlive = ui.getFloat(HUD_MENU, `${T2_CLIP}.dboFrames`);
      Object.assign(s.t2, { loadedAtTick: t, version: ui.getString(HUD_MENU, `${T2_CLIP}.dboVersion`), skse: ui.getString(HUD_MENU, `${T2_CLIP}.dboSkse`) });
    } else if (t === LOAD_TICKS) {
      s.t2.loadedAtTick = "never";
    }
  }
  if (s.aliveAt && t === s.aliveAt + 5) ui.invokeString(HUD_MENU, `${T2_CLIP}.dboPing`, PING);
  if (t === HOLD_TICKS) {
    Object.assign(s.t1, { stillThere: ui.getString(HUD_MENU, `${T1_CLIP}._name`), widthLater: ui.getFloat(HUD_MENU, `${T1_CLIP}._width`) });
    if (s.aliveAt) {
      const frames = ui.getFloat(HUD_MENU, `${T2_CLIP}.dboFrames`);
      Object.assign(s.t2, {
        // the swf's own frames against the client's ticks over the same stretch: near 1 means its onEnterFrame runs every frame
        framesPerTick: Math.round(((frames - s.framesAtAlive) / Math.max(1, t - s.aliveAt)) * 100) / 100,
        pinged: ui.getString(HUD_MENU, `${T2_CLIP}.dboPinged`) === PING,
        pongs: s.pongs,
        keys: ui.getFloat(HUD_MENU, `${T2_CLIP}.dboKeys`), lastKey: ui.getFloat(HUD_MENU, `${T2_CLIP}.dboLastKey`),
        mouseMoves: ui.getFloat(HUD_MENU, `${T2_CLIP}.dboMouse`), clicks: ui.getFloat(HUD_MENU, `${T2_CLIP}.dboClicks`),
        skseLater: ui.getString(HUD_MENU, `${T2_CLIP}.dboSkse`),
        stage: `${ui.getFloat(HUD_MENU, `${T2_CLIP}.dboStageW`)}x${ui.getFloat(HUD_MENU, `${T2_CLIP}.dboStageH`)}`,
      });
    }
    ui.invokeStringA(HUD_MENU, `${T1_CLIP}.removeMovieClip`, []);
    ui.invokeStringA(HUD_MENU, `${T2_CLIP}.removeMovieClip`, []);
  }
  if (t === HOLD_TICKS + 2) {
    s.t1.afterRemove = ui.getString(HUD_MENU, `${T1_CLIP}._name`);
    s.t2.afterRemove = ui.getString(HUD_MENU, `${T2_CLIP}._name`);
    s.done = "done";
  }
};

// What goes to the server: T1's fields at the top (the shape the first probe reported), T2 under t2
export const probeResults = (s: ProbeState): Record<string, unknown> => Object.assign({}, s.t1, { t2: s.t2, end: s.done });
