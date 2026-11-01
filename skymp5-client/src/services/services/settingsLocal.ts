// F3, Settings: the five "This PC's settings" sections (Interface, Keys, Camera, Mouse, Voice) drawn by the native journal
// (swf/dbo_journal tabs/settings.as) instead of the browser journal. The values and the file are the browser's own:
// the chat-settings file (chat-settings-no-load), its ui block as front utils/uiSettings.ts reads and writes it, and its
// top-level chat values as the chat (constructorComponents/chat) keeps them. Pure, so a harness loads it on its own.

export type Json = Record<string, unknown>;

// utils/uiSettings.ts UI_DEFAULTS and ONE_OF, VITALS_FADE_CHOICES
export const UI_DEFAULTS: Json = { vitals: "fade", vitalsStyle: "quiet", vitalsFadeSeconds: 5, chat: "fade", chatLettering: "book" };
const UI_ONE_OF: Record<string, unknown[]> = {
  vitals: ["always", "fade", "hidden"], vitalsStyle: ["classic", "quiet"], chat: ["always", "fade", "hidden"], chatLettering: ["book", "plain"],
  vitalsFadeSeconds: [3, 5, 10],
};
// The chat's own values and the SettingsTab controls' ranges
const CHAT_DEFAULTS: Json = { fontSize: 16, chatTransparency: 25, fadeSeconds: 10, hidePlayerNames: false, showFormIds: true, customHighlights: "" };
const CHAT_RULES: Record<string, (v: unknown) => boolean> = {
  fontSize: (v) => Number.isInteger(v) && (v as number) >= 14 && (v as number) <= 22,
  chatTransparency: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 80 && (v as number) % 5 === 0,
  fadeSeconds: (v) => [5, 10, 20, 30, 0].indexOf(v as number) >= 0,
  hidePlayerNames: (v) => typeof v === "boolean",
  showFormIds: (v) => typeof v === "boolean",
  customHighlights: (v) => typeof v === "string" && v.length <= 300,
};

export const parseFile = (data: string | null | undefined): Json | null => {
  try {
    if (!data) return {};
    const parsed = JSON.parse(String(data).slice(2));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const block = (file: Json, key: string): Json => {
  const b = file[key];
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Json) : {};
};

// The values the five sections show, read as the browser pages read them
export const readUi = (file: Json): Json => {
  const raw = block(file, "ui");
  const out: Json = Object.assign({}, UI_DEFAULTS);
  for (const k of Object.keys(UI_DEFAULTS)) if (UI_ONE_OF[k].indexOf(raw[k]) >= 0) out[k] = raw[k];
  return out;
};
export const readChat = (file: Json): Json => ({
  fontSize: Number(file.fontSize) || CHAT_DEFAULTS.fontSize,
  chatTransparency: file.chatTransparency != null ? Number(file.chatTransparency) : CHAT_DEFAULTS.chatTransparency,
  fadeSeconds: file.fadeSeconds != null ? Number(file.fadeSeconds) : CHAT_DEFAULTS.fadeSeconds,
  hidePlayerNames: file.hidePlayerNames === true,
  showFormIds: file.showFormIds !== false,
  customHighlights: String(file.customHighlights || ""),
});

// Only the keys a section may change, each a value its control offers; anything else is dropped
export const cleanUi = (patch: unknown): Json => {
  const out: Json = {};
  if (!patch || typeof patch !== "object") return out;
  for (const k of Object.keys(patch as Json)) if (UI_ONE_OF[k] && UI_ONE_OF[k].indexOf((patch as Json)[k]) >= 0) out[k] = (patch as Json)[k];
  return out;
};
export const cleanChat = (patch: unknown): Json => {
  const out: Json = {};
  if (!patch || typeof patch !== "object") return out;
  for (const k of Object.keys(patch as Json)) if (CHAT_RULES[k] && CHAT_RULES[k]((patch as Json)[k])) out[k] = (patch as Json)[k];
  return out;
};

// The file after a change, as setUiSettings, writeUiExtra and the chat's persistChatSettings make it
export const withUi = (file: Json, patch: Json): Json => Object.assign({}, file, { ui: Object.assign({}, block(file, "ui"), patch) });
export const withChat = (file: Json, patch: Json): Json => Object.assign({}, file, patch);

// The page's copy of the file follows the client's write, and hears what changed: the HUD re-reads ui, the chat applies
// its own values (it saves them again, the same file)
export const pageSyncJs = (file: Json, chatPatch: Json | null): string => {
  const chat = chatPatch && Object.keys(chatPatch).length ? `window.dispatchEvent(new CustomEvent('dbo:chatSettings', { detail: ${JSON.stringify(chatPatch)} }));` : "";
  return `(function(){ try { window.__alduinakChatSettings = ${JSON.stringify(file)}; window.dispatchEvent(new CustomEvent('dbo:uiSettings')); ${chat} } catch (e) {} })();`;
};

// ---- Keys: SettingsKeys.tsx's rules, with the capture made by the client (it hears every key and mouse button) ----
// Escape, Backspace and Enter close panels, clear and open the chat; left and right click stay the panel's
export const ESCAPE = 1;
export const BACKSPACE = 14;
export const ENTER = 28;
export type Capture = { save: number | null } | { cancel: true } | { refuse: string } | null;
export const captureOf = (code: number, optional: boolean): Capture => {
  if (!Number.isInteger(code) || code <= 0) return null;
  if (code === ESCAPE) return { cancel: true };
  if (code === BACKSPACE) return { save: optional ? 0 : null };
  if (code === ENTER) return { refuse: "Enter is kept for the chat and for closing panels." };
  if (code === 256 || code === 257) return null;
  if (code > 255 && (code < 258 || code > 263)) return { refuse: "That key cannot be used here." };
  return { save: code };
};

// keyNames.ts in the front: the DX scan codes the key rows show
const NAMES: Array<[number, string]> = [
  [12, "-"], [13, "="], [15, "Tab"], [26, "["], [27, "]"], [29, "Left Ctrl"], [39, ";"], [40, "'"], [41, "~"], [42, "Left Shift"], [43, "\\"],
  [51, ","], [52, "."], [53, "/"], [54, "Right Shift"], [55, "Num *"], [56, "Left Alt"], [57, "Space"], [58, "Caps Lock"], [69, "Num Lock"],
  [70, "Scroll Lock"], [74, "Num -"], [78, "Num +"], [83, "Num ."], [156, "Num Enter"], [157, "Right Ctrl"], [181, "Num /"], [184, "Right Alt"],
  [197, "Pause"], [199, "Home"], [200, "Up"], [201, "Page Up"], [203, "Left"], [205, "Right"], [207, "End"], [208, "Down"], [209, "Page Down"],
  [210, "Insert"], [211, "Delete"], [30, "A"], [48, "B"], [46, "C"], [32, "D"], [18, "E"], [33, "F"], [34, "G"], [35, "H"], [23, "I"], [36, "J"],
  [37, "K"], [38, "L"], [50, "M"], [49, "N"], [24, "O"], [25, "P"], [16, "Q"], [19, "R"], [31, "S"], [20, "T"], [22, "U"], [47, "V"], [17, "W"],
  [45, "X"], [21, "Y"], [44, "Z"], [11, "0"], [2, "1"], [3, "2"], [4, "3"], [5, "4"], [6, "5"], [7, "6"], [8, "7"], [9, "8"], [10, "9"],
  [82, "Num 0"], [79, "Num 1"], [80, "Num 2"], [81, "Num 3"], [75, "Num 4"], [76, "Num 5"], [77, "Num 6"], [71, "Num 7"], [72, "Num 8"], [73, "Num 9"],
  [59, "F1"], [60, "F2"], [61, "F3"], [62, "F4"], [63, "F5"], [64, "F6"], [65, "F7"], [66, "F8"], [67, "F9"], [68, "F10"], [87, "F11"], [88, "F12"],
  [1, "Escape"], [14, "Backspace"], [28, "Enter"],
  [256, "Left Mouse"], [257, "Right Mouse"], [258, "Middle Mouse"], [259, "Mouse 4"], [260, "Mouse 5"], [261, "Mouse 6"], [262, "Mouse 7"], [263, "Mouse 8"],
];
const NAME_OF: Record<number, string> = {};
for (const [c, n] of NAMES) NAME_OF[c] = n;
export const keyName = (code: number): string => (code > 0 ? NAME_OF[code] || `Key ${code}` : "");

// The names of every code in use, so the panel holds no table of its own
export const keyNamesFor = (codes: number[]): Json => {
  const out: Json = {};
  for (const c of codes) if (c > 0) out[String(c)] = keyName(c);
  return out;
};

// ---- the page's own state: the interface size (UiScale.js, localStorage) and voice (VoiceManager.js) ----
// The page answers with "dbo:settingsPage" <json>. peers: the identities near the player, whose volume this PC keeps
export const PAGE_MESSAGE = "dbo:settingsPage";
export const pageQueryJs = (peers: string[]): string => `(function(){
  var send = function(o){ try { window.skyrimPlatform.sendMessage(${JSON.stringify(PAGE_MESSAGE)}, JSON.stringify(o)); } catch (e) {} };
  var out = {};
  try { var g = window.dboGetUiScale ? window.dboGetUiScale() : null; out.scale = g ? { override: Number(g.override) || 0, auto: Number(g.auto) || 0, launcher: Number(g.launcher) || 0 } : null; } catch (e) { out.scale = null; }
  var v = window.__alduinakVoice || null;
  if (!v) { send(out); return; }
  var voice = { prefs: v.getPrefs ? v.getPrefs() : {}, peers: {}, devices: { inputs: [], outputs: [] } };
  var ids = ${JSON.stringify(peers)};
  for (var i = 0; i < ids.length; i++) { try { voice.peers[ids[i]] = v.peerSetting ? v.peerSetting(ids[i]) : { gain: 1, muted: false }; } catch (e) {} }
  out.voice = voice;
  if (!v.listDevices) { send(out); return; }
  v.listDevices().then(function(d){ voice.devices = d || voice.devices; send(out); }, function(){ send(out); });
})();`;
export const micLevelJs = (): string => `(function(){ try { var v = window.__alduinakVoice; var n = v && v.mic && v.micLevel ? Number(v.micLevel()) || 0 : 0;
  window.skyrimPlatform.sendMessage(${JSON.stringify(PAGE_MESSAGE)}, JSON.stringify({ level: n })); } catch (e) {} })();`;

// What the page does for each change, exactly as its controls do
const VOICE_KEYS: Record<string, (v: unknown) => boolean> = {
  inputLabel: (v) => typeof v === "string" && v.length <= 200, outputLabel: (v) => typeof v === "string" && v.length <= 200,
  micGain: (v) => typeof v === "number" && v >= 0 && v <= 2, outputVolume: (v) => typeof v === "number" && v >= 0 && v <= 3,
  activation: (v) => v === "ptt" || v === "vad", vadThreshold: (v) => typeof v === "number" && v >= 0.005 && v <= 0.5,
};
export const cleanVoice = (patch: unknown): Json => {
  const out: Json = {};
  if (!patch || typeof patch !== "object") return out;
  for (const k of Object.keys(patch as Json)) if (VOICE_KEYS[k] && VOICE_KEYS[k]((patch as Json)[k])) out[k] = (patch as Json)[k];
  return out;
};
export const PEER_OPS = ["set", "mute", "unmute", "reset"];
export const pageActJs = (what: string, a: unknown[]): string => {
  const j = (v: unknown) => JSON.stringify(v);
  if (what === "scale") return `try { if (window.dboSetUiScaleInGame) window.dboSetUiScaleInGame(${j(Number(a[0]) || 0)}); } catch (e) {}`;
  if (what === "panelReset") return `try { if (window.dboResetPanelScales) window.dboResetPanelScales(${j(Number(a[0]) || 0)}); } catch (e) {}`;
  if (what === "voice") return `try { var v = window.__alduinakVoice; if (v && v.setPrefsInGame) v.setPrefsInGame(${j(a[0])}); } catch (e) {}`;
  if (what === "peer") return `try { var v = window.__alduinakVoice; if (v && v.adjustPeer) v.adjustPeer(${j(String(a[0]))}, ${j(String(a[1]))}, ${j(String(a[2] || ""))}${a[1] === "set" ? ", " + j(Number(a[3])) : ""}); } catch (e) {}`;
  return "";
};
// utils/UiScale.js and SettingsTab.tsx SCALES: Auto, then 100% to 200%
export const SCALES = [0, 1, 1.1, 1.25, 1.5, 1.75, 2];
