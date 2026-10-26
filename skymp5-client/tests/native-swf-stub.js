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
  c.createTextField = (n) => { const t = { text: '', textColor: 0, _alpha: 100, _y: 0, setNewTextFormat(f) { this.fmt = f; this.textColor = f.color; } }; c[n] = t; c.kids[n] = t; };
  c.removeMovieClip = () => { if (c._parent) { delete c._parent[c._name]; delete c._parent.kids[c._name]; } };
  for (const f of ['beginFill', 'moveTo', 'lineTo', 'endFill', 'clear']) c[f] = () => {};
  return c;
};

// late: skse arrives only when arrive() is called, as on frame 1 in game
const boot = (menu, late) => {
  const sent = [], sounds = [], logs = [];
  const st = { time: 1000, code: 0 };
  const root = clip('_root');
  const skse = { SendModEvent: (e, s, n) => sent.push({ e, s, n }), Log: (m) => logs.push(m), CloseMenu: () => sent.push({ e: 'closeMenu' }) };
  const ctx = {
    _root: root,
    _global: { skse: late ? undefined : skse },
    flash: { external: { ExternalInterface: { call: (fn, uid, name) => sounds.push(fn + ':' + name) } } },
    TextFormat: function TextFormat() {},
    Key: { listeners: [], addListener(l) { this.listeners.push(l); }, getCode: () => st.code },
    getTimer: () => st.time,
    Math, String, Number, isNaN, isFinite, parseInt,
  };
  vm.createContext(ctx);
  vm.runInContext(sourceOf(menu), ctx);
  if (!late) root.dboBootClip.onEnterFrame();
  const msgs = () => sent.filter((m) => m.e === 'dboUi').map((m) => { const k = m.s.indexOf('\u0001'); return { key: m.s.slice(0, k), args: JSON.parse(m.s.slice(k + 1)) }; });
  const press = (code) => { st.code = code; for (const l of ctx.Key.listeners) l.onKeyDown(); };
  const tick = () => { for (const k of Object.values(root.kids)) if (k.onEnterFrame) k.onEnterFrame(); if (root.onEnterFrame) root.onEnterFrame(); };
  const push = (payload) => vm.runInContext('_root.dboData(' + JSON.stringify(JSON.stringify(payload)) + ')', ctx);
  return { ctx, root, st, sent, sounds, logs, msgs, press, tick, push, arrive: () => { ctx._global.skse = skse; } };
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
