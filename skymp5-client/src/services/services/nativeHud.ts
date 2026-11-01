// The native HUD's pure half (route H of _work/native-everything-1031.md; NativeHudService draws it with swf/dbo_hud in
// the HUD Menu): what it shows, decided as the browser HUD decides it (skymp5-front features/hud), so a player's F3,
// Settings, Interface choice holds on either. No game calls here, so tests/native-hud-harness.js runs it as is.

import { HudPrompt } from "./nativePrompt";

// What the other services leave for the native HUD: DboRelayService the server's dboHud fields and the player's vitals,
// VoiceService the voice range, the browser's voice manager (through a page message) whether V is held
export interface HudServerState {
  hunger: number; stage: string; hungerOn: boolean; vitalsOn: boolean;
  gold?: number; goldOn?: boolean;
  racialPower?: { name: string; endsAt: number };
  watermarkOn?: boolean;
}
export const hudShared: {
  server: HudServerState | null;
  vitals: { h: number; m: number; s: number } | null;
  voiceMode: string;
  talking: boolean;
  // true while the native HUD is drawn: the browser HUD then leaves out its corner and bars
  nativeUp: boolean;
  // the party list as DboRelayService builds it for the browser's party widget (null: no party and no companions)
  party: { rows: PartyRow[]; self: number } | null;
  // the activate wording beside the crosshair (InteractionPromptService), and the letters over boards (BoardMailService)
  interact: { verb: string; label: string } | null;
  mail: { markers: Array<{ x: number; y: number; near: number }>; unread: number } | null;
} = { server: null, vitals: null, voiceMode: "", talking: false, nativeUp: false, party: null, interact: null, mail: null };

// One party row as the relay builds it: a member (server id) or an own summon or companion
export interface PartyRow {
  id: number; name: string; leader?: boolean; far?: boolean; dead?: boolean; health?: number;
  summon?: boolean; leftSec?: number; staying?: boolean;
}

// The party as dbo_hud draws it, decided as the browser's features/party draws it: Party while a player is in it, else
// Companions; a member's bar from its health, "far" when it is not loaded; a summon's stay tag and m:ss left. Passive: no
// Leave button and no dragging in the HUD Menu (no cursor there), so leaving stays /leave
export interface HudPartyRow { name: string; leader: boolean; self: boolean; dead: boolean; far: boolean; pct: number; tag: string; clock: string }
export const partyOf = (party: { rows: PartyRow[]; self: number } | null): { title: string; rows: HudPartyRow[] } | null => {
  if (!party || !Array.isArray(party.rows) || !party.rows.length) return null;
  const clock = (sec: number): string => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  return {
    title: party.rows.some((r) => !r.summon) ? "Party" : "Companions",
    rows: party.rows.map((r) => ({
      name: String(r.name || "?"), leader: !!r.leader, self: r.id === party.self && !r.summon, dead: !!r.dead, far: !!r.far,
      pct: Math.max(0, Math.min(100, Number(r.health) || 0)),
      tag: r.summon && r.staying ? "stay" : "",
      clock: r.summon && r.leftSec ? clock(Math.max(0, Math.floor(Number(r.leftSec)))) : "",
    })),
  };
};

export type VitalsMode = "always" | "fade" | "hidden";
export type VitalsStyle = "classic" | "quiet";
export interface UiChoice { vitals: VitalsMode; vitalsStyle: VitalsStyle; vitalsFadeSeconds: number }

// The front's own defaults (utils/uiSettings.ts): the saved file's defaults once it exists, today's look before it does
export const UI_DEFAULTS: UiChoice = { vitals: "fade", vitalsStyle: "quiet", vitalsFadeSeconds: 5 };
export const BEFORE_FILE: UiChoice = { vitals: "always", vitalsStyle: "classic", vitalsFadeSeconds: 5 };
export const VITALS_FADE_CHOICES = [3, 5, 10];

// The ui block of the chat-settings file, read as the front's getUiSettings reads it; file: the parsed file or null
export const uiFromFile = (file: unknown): UiChoice => {
  const f = file && typeof file === "object" ? file as Record<string, unknown> : null;
  const base = f ? UI_DEFAULTS : BEFORE_FILE;
  const out: UiChoice = Object.assign({}, base);
  const raw = f && f["ui"] && typeof f["ui"] === "object" ? f["ui"] as Record<string, unknown> : null;
  if (raw) {
    if (raw["vitals"] === "always" || raw["vitals"] === "fade" || raw["vitals"] === "hidden") out.vitals = raw["vitals"];
    if (raw["vitalsStyle"] === "classic" || raw["vitalsStyle"] === "quiet") out.vitalsStyle = raw["vitalsStyle"];
    if (typeof raw["vitalsFadeSeconds"] === "number") out.vitalsFadeSeconds = raw["vitalsFadeSeconds"];
  }
  if (!VITALS_FADE_CHOICES.includes(out.vitalsFadeSeconds)) out.vitalsFadeSeconds = base.vitalsFadeSeconds;
  return out;
};

// The front's two rules (features/hud vitalsShown, cornerShown), word for word
export const vitalsShown = (ui: UiChoice, full: boolean, sinceChangeMs: number): boolean =>
  ui.vitals === "always" || (ui.vitals === "fade" && (!full || sinceChangeMs < ui.vitalsFadeSeconds * 1000));
export const cornerShown = (ui: UiChoice, talking: boolean, sinceChangeMs: number, stage: string): boolean =>
  ui.vitals === "always" || talking
  || (ui.vitals === "fade" && (sinceChangeMs < ui.vitalsFadeSeconds * 1000 || stage === "hungry" || stage === "starving"));

const STAGE_LABEL: Record<string, string> = { sated: "Well fed", peckish: "Peckish", hungry: "Hungry", starving: "Starving" };
const VOICE_MODES = ["whisper", "talk", "shout"];
const pct = (v: unknown): number => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

// What dbo_hud draws (its dboData), every field already decided
export interface HudPayload {
  bars: { on: boolean; shown: boolean; quiet: boolean; h: number; m: number; s: number };
  corner: { shown: boolean };
  power: { name: string; left: number } | null;
  gold: number | null;
  hunger: { label: string; stage: string; fed: number } | null;
  voice: { mode: string; talking: boolean };
  party: { title: string; rows: HudPartyRow[] } | null;
  // the hourglass top right, unless the server switched it off (dboHud watermarkOn false)
  watermark: boolean;
  // the prompt up, answered with Y and N (nativePrompt.ts promptView); set by NativeHudService
  prompt?: HudPrompt | null;
  // the activate wording, and the mail letters at screen fractions (x from the left, y from the top); set by NativeHudService
  interact?: { verb: string; label: string } | null;
  mail?: { markers: Array<{ x: number; y: number; scale: number }>; unread: number } | null;
}

// The letters over boards as dbo_hud draws them: the browser's scale (0.6 far, 1.2 at the board), a count past one letter
export const mailOf = (m: { markers: Array<{ x: number; y: number; near: number }>; unread: number } | null): { markers: Array<{ x: number; y: number; scale: number }>; unread: number } | null => {
  if (!m || !Array.isArray(m.markers) || !m.markers.length || !(m.unread > 0)) return null;
  const r3 = (v: number): number => Math.round(v * 1000) / 1000;
  return { unread: m.unread, markers: m.markers.map((k) => ({ x: r3(k.x), y: r3(k.y), scale: r3(0.6 + 0.6 * Math.max(0, Math.min(1, Number(k.near) || 0))) })) };
};

// The two change clocks the fade rules count from, kept between frames as the front's refs keep them
export interface HudClock { barsKey: string; barsAt: number; cornerKey: string; cornerAt: number }
export const newClock = (now: number): HudClock => ({ barsKey: "", barsAt: now, cornerKey: "", cornerAt: now });

export const payloadOf = (server: HudServerState | null, vitals: { h: number; m: number; s: number } | null, voiceMode: string, talking: boolean,
  ui: UiChoice, clock: HudClock, now: number, party: { rows: PartyRow[]; self: number } | null = null): HudPayload | null => {
  if (!server) return null;
  const h = vitals ? pct(vitals.h) : 100, m = vitals ? pct(vitals.m) : 100, s = vitals ? pct(vitals.s) : 100;
  const barsKey = `${h}|${m}|${s}`;
  if (barsKey !== clock.barsKey) { clock.barsKey = barsKey; clock.barsAt = now; }
  const full = h >= 100 && m >= 100 && s >= 100;
  const stage = String(server.stage || "").toLowerCase();
  const mode = VOICE_MODES.includes(voiceMode) ? voiceMode : "talk";
  const goldShown = server.goldOn !== false && server.gold !== undefined;
  const gold = goldShown ? Math.max(0, Math.round(Number(server.gold) || 0)) : null;
  const power = server.racialPower && server.racialPower.name && server.racialPower.endsAt > now
    ? { name: String(server.racialPower.name), left: Math.ceil((server.racialPower.endsAt - now) / 1000) } : null;
  // What counts as a change for the corner: the front's `watch` (stage, voice range, gold, the power's end)
  const cornerKey = `${stage}|${mode}|${gold === null ? "" : gold}|${server.racialPower ? server.racialPower.endsAt : ""}`;
  if (cornerKey !== clock.cornerKey) { clock.cornerKey = cornerKey; clock.cornerAt = now; }
  return {
    bars: { on: server.vitalsOn !== false && ui.vitals !== "hidden", shown: vitalsShown(ui, full, now - clock.barsAt), quiet: ui.vitalsStyle === "quiet", h, m, s },
    corner: { shown: cornerShown(ui, talking, now - clock.cornerAt, stage) },
    power,
    gold,
    hunger: server.hungerOn !== false ? { label: STAGE_LABEL[stage] || String(server.stage || "") || "Well fed", stage: stage || "sated", fed: 100 - pct(server.hunger) } : null,
    voice: { mode, talking },
    party: partyOf(party),
    watermark: server.watermarkOn !== false,
  };
};

// Whether the HUD swf needs this payload, as the JSON it would get (null: nothing new)
export const changedJson = (p: HudPayload | null, last: string): string | null => {
  if (!p) return null;
  const j = JSON.stringify(p);
  return j === last ? null : j;
};

// Loading the swf: frames to wait for it to say it is alive, and how many tries before the browser HUD keeps the job
export const ALIVE_FRAMES = 240;
export const MAX_TRIES = 3;
export interface LoadState { phase: "idle" | "loading" | "up" | "failed"; tries: number; frames: number }
export const newLoad = (): LoadState => ({ phase: "idle", tries: 0, frames: 0 });
// One frame of loading: hudOpen, whether the HUD Menu is up; alive, whether the swf says it is alive. Returns what to do:
// "inject" (make the clip and load the swf), "up" (it came alive), "lost" (it was up and is gone), "fail" (give up) or ""
export const loadStep = (st: LoadState, hudOpen: boolean, alive: boolean): string => {
  if (st.phase === "failed" || !hudOpen) return "";
  if (st.phase === "up") {
    if (alive) return "";
    st.phase = "idle";
    return "lost";
  }
  if (st.phase === "idle") {
    if (st.tries >= MAX_TRIES) { st.phase = "failed"; return "fail"; }
    st.tries++; st.frames = 0; st.phase = "loading";
    return "inject";
  }
  // loading
  if (alive) { st.phase = "up"; st.tries = 0; return "up"; }
  if (++st.frames >= ALIVE_FRAMES) st.phase = "idle";
  return "";
};
