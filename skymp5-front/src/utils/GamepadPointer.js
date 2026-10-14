// The gamepad pointer (client gamepadPointerService): the client calls window.__dboPad while a panel has the browser
// focus. move draws a pointer and hovers what is under it, click clicks it, back is an Escape keydown (index.js turns
// that into menu:escape), scroll scrolls the nearest scrollable box under it. Hidden after HIDE_AFTER_MS idle.

export const HIDE_AFTER_MS = 6000;
const SIZE = 22;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The nearest box under `el` that can scroll vertically, else the page
export const scrollableOf = (el, win = window) => {
  for (let n = el; n && n !== win.document.body && n.nodeType === 1; n = n.parentElement) {
    const oy = win.getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return win.document.scrollingElement || win.document.documentElement;
};

export const createPad = (win = window) => {
  const doc = win.document;
  let x = -1, y = -1, under = null, hideTimer = 0, dot = null;

  const ensureDot = () => {
    if (dot && dot.isConnected) return dot;
    dot = doc.createElement('div');
    dot.className = 'dbo-pad-pointer';
    dot.setAttribute('aria-hidden', 'true');
    Object.assign(dot.style, {
      position: 'fixed', left: '0', top: '0', width: `${SIZE}px`, height: `${SIZE}px`, zIndex: '2147483647', pointerEvents: 'none',
      borderRadius: '50%', border: '2px solid #f3e6c4', background: 'rgba(200, 160, 80, 0.45)', boxShadow: '0 0 6px rgba(0,0,0,0.8)',
      transform: 'translate(-50%, -50%)', display: 'none',
    });
    doc.body.appendChild(dot);
    return dot;
  };
  const show = () => {
    const d = ensureDot();
    d.style.display = 'block';
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    win.clearTimeout(hideTimer);
    hideTimer = win.setTimeout(() => { if (dot) dot.style.display = 'none'; }, HIDE_AFTER_MS);
  };
  const mouse = (type, target, extra) => {
    const init = Object.assign({ bubbles: true, cancelable: true, view: win, clientX: x, clientY: y, button: 0, buttons: type === 'mousedown' ? 1 : 0 }, extra || {});
    target.dispatchEvent(new win.MouseEvent(type, init));
  };
  const at = () => doc.elementFromPoint(x, y);
  const start = () => { if (x < 0) { x = Math.round(win.innerWidth / 2); y = Math.round(win.innerHeight / 2); } };

  const pad = {
    move(dx, dy) {
      start();
      x = clamp(x + (Number(dx) || 0), 0, win.innerWidth - 1);
      y = clamp(y + (Number(dy) || 0), 0, win.innerHeight - 1);
      show();
      const el = at();
      if (el !== under) {
        if (under) mouse('mouseout', under, { relatedTarget: el });
        if (el) mouse('mouseover', el, { relatedTarget: under });
        under = el;
      }
      if (el) mouse('mousemove', el);
    },
    click() {
      start();
      show();
      const el = at();
      if (!el) return;
      mouse('mousedown', el);
      if (typeof el.focus === 'function' && el.matches && el.matches('input, textarea, select, button, a, [tabindex]')) el.focus();
      mouse('mouseup', el);
      if (typeof el.click === 'function') el.click(); else mouse('click', el);
    },
    back() {
      const t = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : doc.body;
      t.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
    },
    scroll(dy) {
      start();
      const box = scrollableOf(at() || doc.body, win);
      if (box && typeof box.scrollBy === 'function') box.scrollBy(0, Number(dy) || 0); else if (box) box.scrollTop += Number(dy) || 0;
    },
    position: () => ({ x, y }),
  };
  return pad;
};

if (typeof window !== 'undefined') window.__dboPad = createPad(window);
