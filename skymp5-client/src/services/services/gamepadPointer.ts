// A gamepad pointer for the browser panels, which only hear the mouse. While a panel has the browser focus the right
// stick moves a pointer the page draws (skymp5-front utils/GamepadPointer.js), as it moves the vanilla menu cursor
// (controlmap Cursor context: Cursor on the right stick, Click on A); A clicks under it, B is Escape, the left stick and
// the D-pad up and down scroll. Import-free, so harnesses can bundle it.

export const DEAD_ZONE = 0.2;
export const POINTER_SPEED = 1100; // px a second at full tilt
export const SCROLL_SPEED = 1400;
export const DPAD_SCROLL = 160;
export const SEND_EVERY_MS = 33;

// Stick tilt past the dead zone, rescaled to 0..1 and squared for fine control near the centre
export const curve = (v: number): number => {
  const a = Math.abs(v);
  if (!Number.isFinite(a) || a <= DEAD_ZONE) return 0;
  const t = Math.min(1, (a - DEAD_ZONE) / (1 - DEAD_ZONE));
  return Math.sign(v) * t * t;
};

// Pixels for one step of `ms`; stick Y is up-positive, page Y down-positive
export const pointerStep = (x: number, y: number, ms: number): { dx: number; dy: number } => {
  const k = (POINTER_SPEED * ms) / 1000;
  return { dx: Math.round(curve(x) * k), dy: Math.round(-curve(y) * k) };
};
export const scrollStep = (y: number, ms: number): number => Math.round((-curve(y) * SCROLL_SPEED * ms) / 1000);

// The page call for one batch of input, or "" for none
export const pageCall = (dx: number, dy: number, scroll: number, action: "" | "click" | "back"): string => {
  const parts: string[] = [];
  if (dx || dy) parts.push(`p.move(${dx | 0},${dy | 0})`);
  if (scroll) parts.push(`p.scroll(${scroll | 0})`);
  if (action === "click") parts.push("p.click()");
  if (action === "back") parts.push("p.back()");
  return parts.length ? `(function(){var p=window.__dboPad;if(!p)return;${parts.join(";")};})();` : "";
};
