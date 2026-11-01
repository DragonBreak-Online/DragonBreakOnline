// The HUD prompts drawn by the native HUD (swf/dbo_hud) and answered with Y and N (Nat, 1 Nov: no cursor in the HUD
// Menu, so a key answers): downed, a vampire's feeding, a robbery, a trade request and the capture and search consents.
// One prompt at a time. Each owner (DboRelayService for the server's widgets, TradeService, CaptureConsentService,
// SearchService) shows its prompt here while the native HUD is up and keeps the answer: Y or N calls it back, and the
// owner sends exactly what its browser buttons send. The keys act only while a prompt is up and not yet answered.
// No game calls here, so tests/native-hud-harness.js runs it as is.

// DxScanCode.Y and DxScanCode.N. Neither is bound in the game's controlmap (ours is vanilla with Wait off) nor among the
// client's default keys (keybindsService MENU_KEYS); a player who binds one of those to Y or N gets both on that key.
export const KEY_YES = 0x15;
export const KEY_NO = 0x31;

export interface PromptSpec {
  id: number;
  kicker: string;
  title: string;
  text: string;
  // the two answers' labels; "" when there is no such answer (downed has only Give up)
  yes: string;
  no: string;
  // 0: no clock (a menu that waits for the player, the level-up offer)
  seconds: number;
  // Y opens only after this many seconds (downed's Give up)
  lockSeconds?: number;
  // the line under the keys: what no answer means
  idle?: string;
}

export interface PromptState extends PromptSpec {
  shownAt: number;
  answered: boolean;
  answer: (yes: boolean) => void;
  // the owner's browser panel, for a native HUD that goes down while the prompt waits
  fallback?: () => void;
}

export const hudPrompt: { current: PromptState | null } = { current: null };

export const showPrompt = (spec: PromptSpec, answer: (yes: boolean) => void, now: number, fallback?: () => void): void => {
  hudPrompt.current = Object.assign({}, spec, { shownAt: now, answered: false, answer, fallback });
};

// The native HUD went down: an unanswered prompt goes back to its owner's browser panel
export const handBack = (): void => {
  const p = hudPrompt.current;
  hudPrompt.current = null;
  if (p && !p.answered && p.fallback) p.fallback();
};

// The owner's close: only its own prompt goes (another may have replaced it)
export const clearPrompt = (id: number): void => {
  if (hudPrompt.current && hudPrompt.current.id === id) hudPrompt.current = null;
};

export const lockLeft = (p: PromptState, now: number): number =>
  Math.max(0, Math.ceil((Number(p.lockSeconds) || 0) - (now - p.shownAt) / 1000));

// What a key press answers now: true, false, or null (no prompt, answered already, no such answer, or still locked)
export const keyAnswer = (p: PromptState | null, code: number, now: number): boolean | null => {
  if (!p || p.answered) return null;
  if (code === KEY_YES && p.yes) return lockLeft(p, now) > 0 ? null : true;
  if (code === KEY_NO && p.no) return false;
  return null;
};

// A key press: answers the prompt up, once. True when it did (the key was the prompt's)
export const pressKey = (code: number, now: number): boolean => {
  const p = hudPrompt.current;
  const a = keyAnswer(p, code, now);
  if (a === null || !p) return false;
  p.answered = true;
  p.answer(a);
  return true;
};

export interface HudPrompt {
  kicker: string; title: string; text: string;
  // the key lines as dbo_hud shows them, "" for none
  yes: string; no: string;
  left: number; frac: number; answered: boolean; idle: string;
}

export const promptView = (p: PromptState | null, now: number): HudPrompt | null => {
  if (!p) return null;
  const timed = Number(p.seconds) > 0;
  const total = Math.max(1, Number(p.seconds) || 1);
  const left = timed ? Math.max(0, Math.ceil(total - (now - p.shownAt) / 1000)) : 0;
  const lock = lockLeft(p, now);
  return {
    kicker: p.kicker, title: p.title, text: p.text,
    yes: p.yes ? `Y  ${p.yes}${lock > 0 ? ` (${lock})` : ""}` : "",
    no: p.no ? `N  ${p.no}` : "",
    // frac -1: no clock bar
    left, frac: timed ? Math.round((left / total) * 1000) / 1000 : -1, answered: p.answered,
    idle: p.answered ? "Answered." : timed ? `${left} s.${p.idle ? ` ${p.idle}` : ""}` : p.idle || "",
  };
};

// ---- the server's prompt widgets, as the front draws them (features/downed, feedPrompt, robPrompt) ----
// The packet each answer sends is the front's: dbo:<event> with the nonce and the choice
export interface ServerPrompt { spec: PromptSpec; yes: { event: string; args: unknown[] } | null; no: { event: string; args: unknown[] } | null }
export const SERVER_PROMPT_TYPES = ["downed", "feedPrompt", "robPrompt"];

export const serverPrompt = (w: Record<string, unknown>): ServerPrompt | null => {
  const id = Number(w["id"]);
  const nonce = String(w["nonce"] ?? "");
  if (!Number.isFinite(id) || id <= 0 || !nonce) return null;
  const str = (k: string, d: string): string => (typeof w[k] === "string" && w[k] ? String(w[k]) : d);
  if (w["type"] === "downed") {
    return {
      spec: {
        id, kicker: "Downed", title: str("title", "You're down!"),
        text: str("text", "You can be brought back to your feet by someone with healing magic or a Draught of Revival."),
        yes: "Give up", no: "", seconds: Math.max(1, Number(w["seconds"]) || 60), lockSeconds: Math.max(0, Number(w["giveUpIn"]) || 0),
        idle: "Then you wake at the temple.",
      },
      yes: { event: "downedGiveUp", args: [nonce] }, no: null,
    };
  }
  if (w["type"] === "feedPrompt") {
    const infect = Math.round(Number(w["infectPercent"]) || 0);
    return {
      spec: {
        id, kicker: "A vampire's hunger", title: `${str("vampire", "Someone")} wants to drink from you`,
        text: (w["deep"]
          ? "They mean to drink deeply. Offer your neck and you will lose much of your blood and black out for a while."
          : "Offer your neck and they drink until the thirst eases, leaving you weak.")
          + (infect > 0 ? ` A vampire's bite can carry Sanguinare Vampiris (${infect}%).` : "") + " Resist, and it comes to a fight, or a chase.",
        yes: "Offer your neck", no: "Resist / Flee", seconds: Math.max(1, Number(w["seconds"]) || 20), idle: "No answer means you resist.",
      },
      yes: { event: "feedAnswer", args: [nonce, "submit"] }, no: { event: "feedAnswer", args: [nonce, "resist"] },
    };
  }
  if (w["type"] === "robPrompt") {
    const share = Math.round((Number(w["goldShare"]) || 0.15) * 100);
    return {
      spec: {
        id, kicker: "You are being robbed", title: `${str("robber", "Someone")} demands your valuables`,
        text: `Hand them over and they take ${share}% of the gold you carry and three of your things. Refuse, and it comes to a fight, or a chase. Gold in the bank is safe.`
          + (Number(w["parcels"]) > 0 ? " The courier's parcel you carry may be taken too." : ""),
        yes: "Accept being robbed", no: "Fight / Flee", seconds: Math.max(1, Number(w["seconds"]) || 20), idle: "No answer means you stand your ground.",
      },
      yes: { event: "robAnswer", args: [nonce, "accept"] }, no: { event: "robAnswer", args: [nonce, "fight"] },
    };
  }
  return null;
};

// A trade request and the two consents (client services), as their browser panels word them
export const tradePrompt = (id: number, from: string, seconds: number): PromptSpec => ({
  id, kicker: "Trade request", title: (from || "").trim() || "Someone", text: "wants to trade with you.",
  yes: "Accept", no: "Decline", seconds, idle: "No answer declines.",
});
export const consentPrompt = (id: number, caption: string, text: string, seconds: number): PromptSpec => ({
  id, kicker: caption, title: caption, text: text || "Allow this?", yes: "Allow", no: "Refuse", seconds, idle: "No answer refuses.",
});

// A choice menu the server sent without focus (charlevel's level-up offer): a card with no clock while the native HUD is up.
// Y opens the menu itself, focused (DboRelayService opens it in dbo_context); N sends its close, when it has one
export const menuCard = (w: Record<string, unknown>): PromptSpec | null => {
  const id = Number(w["id"]);
  const actions = Array.isArray(w["actions"]) ? (w["actions"] as Array<Record<string, unknown>>) : [];
  if (w["type"] !== "contextMenu" || w["mode"] === "inspect" || !Number.isFinite(id) || id <= 0 || !actions.length) return null;
  const events = (w["events"] && typeof w["events"] === "object" ? w["events"] : {}) as Record<string, unknown>;
  return {
    id, kicker: "Waiting for you", title: String(w["targetName"] || "A choice"),
    text: actions.map((a) => String(a["label"] || "")).filter(Boolean).join("   "),
    yes: "Choose", no: typeof events["close"] === "string" && String(events["close"]).indexOf("dbo:") === 0 ? "Not now" : "", seconds: 0,
  };
};
