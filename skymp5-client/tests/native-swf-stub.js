// A stub Scaleform stage for the native panel harnesses: runs swf/lib + a menu's frame script as JS and records what reaches skse.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const sourceOf = (menu) => {
  const dir = `swf/${menu}`;
  const libs = fs.existsSync(path.resolve(__dirname, '..', dir, 'lib.txt')) ? read(`${dir}/lib.txt`).split('\n').map((l) => l.trim()).filter(Boolean) : [];
  return libs.map((f) => read(`swf/lib/${f}`)).concat(read(`${dir}/scripts/frame_1/DoAction.as`)).join('\n');
};

const clip = (name) => {
  const c = { _name: name, _x: 0, _y: 0, _alpha: 100, _visible: true, kids: {} };
  c.createEmptyMovieClip = (n) => { if (c.kids[n]) delete c.kids[n]; const k = clip(n); k._parent = c; c[n] = k; c.kids[n] = k; return k; };
  c.createTextField = (n, d, x, y, w, h) => { const t = { text: '', textColor: 0, _alpha: 100, _x: x || 0, _y: y || 0, _width: w || 0, _height: h || 0, setNewTextFormat(f) { this.fmt = f; this.textColor = f.color; } }; c[n] = t; c.kids[n] = t; };
  c.removeMovieClip = () => { if (c._parent) { delete c._parent[c._name]; delete c._parent.kids[c._name]; } };
  // fills are recorded so tests/native-render.js can draw the panel
  c.fills = [];
  c.beginFill = (color, alpha) => { c._fill = { color, alpha: alpha === undefined ? 100 : alpha, pts: [] }; };
  c.moveTo = (x, y) => { if (c._fill) c._fill.pts.push([x, y]); };
  c.lineTo = (x, y) => { if (c._fill) c._fill.pts.push([x, y]); };
  c.endFill = () => { if (c._fill) c.fills.push(c._fill); c._fill = null; };
  c.clear = () => { c.fills = []; };
  return c;
};

// late: skse arrives only when arrive() is called, as on frame 1 in game
const boot = (menu, late, extra) => {
  const sent = [], sounds = [], logs = [];
  const st = { time: 1000, code: 0 };
  const root = clip('_root');
  const skse = { SendModEvent: (e, s, n) => sent.push({ e, s, n }), Log: (m) => logs.push(m), CloseMenu: () => sent.push({ e: 'closeMenu' }), AllowTextInput: (on) => sent.push({ e: 'allowTextInput', on }) };
  if (extra && extra.noTyping) delete skse.AllowTextInput;
  const ctx = {
    _root: root,
    _global: { skse: late ? undefined : skse },
    flash: { external: { ExternalInterface: { call: (fn, uid, name) => sounds.push(fn + ':' + name) } } },
    TextFormat: function TextFormat() {},
    Key: { listeners: [], addListener(l) { this.listeners.push(l); }, getCode: () => st.code },
    Mouse: { listeners: [], addListener(l) { this.listeners.push(l); } },
    Selection: { focused: null, setFocus(t) { this.focused = t; } },
    // the visible stage area; extra.visible simulates a screen that crops it (21:9, 16:10)
    Stage: { visibleRect: (extra && extra.visible) || { left: 0, top: 0, right: 1280, bottom: 720 }, listeners: [], addListener(l) { this.listeners.push(l); } },
    Date,
    getTimer: () => st.time,
    Math, String, Number, isNaN, isFinite, parseInt,
  };
  Object.assign(ctx, extra || {});
  vm.createContext(ctx);
  vm.runInContext(sourceOf(menu), ctx);
  if (!late) root.dboBootClip.onEnterFrame();
  const msgs = () => sent.filter((m) => m.e === 'dboUi').map((m) => { const k = m.s.indexOf('\u0001'); return { key: m.s.slice(0, k), args: JSON.parse(m.s.slice(k + 1)) }; });
  const press = (code) => { st.code = code; for (const l of ctx.Key.listeners) l.onKeyDown(); };
  const wheel = (delta) => { for (const l of ctx.Mouse.listeners) l.onMouseWheel(delta); };
  const tick = () => { for (const k of Object.values(root.kids)) if (k.onEnterFrame) k.onEnterFrame(); if (root.onEnterFrame) root.onEnterFrame(); };
  const push = (payload) => vm.runInContext('_root.dboData(' + JSON.stringify(JSON.stringify(payload)) + ')', ctx);
  // dboClose hides the panel at once and closes the menu some frames later (lib/dbo.as); closed() runs those frames first
  const closed = () => { for (let i = 0; i < 8; i++) tick(); return sent.some((m) => m.e === 'closeMenu'); };
  return { ctx, root, st, sent, sounds, logs, msgs, press, wheel, tick, push, closed, arrive: () => { ctx._global.skse = skse; } };
};

const checker = () => {
  const t = { failures: 0 };
  t.check = (name, ok, got) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
    if (!ok) t.failures++;
  };
  t.done = () => { console.log(t.failures ? `\n${t.failures} failed` : '\nall passed'); process.exit(t.failures ? 1 : 0); };
  return t;
};

module.exports = { boot, checker, sourceOf };
