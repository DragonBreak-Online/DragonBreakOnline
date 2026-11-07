// One dbo-diag line each time a native panel (a CustomMenu) opens or closes, with its swf, so a crash report says
// which was up (Ben, 7 Nov: a Scaleform crash log could not tell). dbo-diag is the log Report a Problem sends.
export const PANEL_LOG_MAX = 300;

let written = 0;

export const panelLog = (sp: unknown, what: "open" | "close", swf: string, now: Date = new Date()): string | null => {
  if (written >= PANEL_LOG_MAX) return null;
  written++;
  const line = `[panel] ${what} ${swf || "?"} at ${now.toISOString().slice(11, 19)}Z` + (written === PANEL_LOG_MAX ? " (panel log stops here)" : "");
  try { (sp as { writeLogs: (plugin: string, ...rest: unknown[]) => void }).writeLogs("dbo-diag", line); } catch (e) { /* older platform */ }
  return line;
};
