// The ~ console gate (gamemode.js ff_console; Jake, 16 Oct: "Disable the ~ for normal users but keep it live for admins").
// No server and no game. The tier rules, the gate section, the watch block (the isAdmin resync), loginStep, onCharacterReady,
// the login waiter, the connect and disconnect handlers, the assignment hook, staffRolesSeen and the consoleRights loop are
// cut out of gamemode.js as they are written there and run together against a fake mp, a fake clock and timers, and a
// model of each player's client:
// - the client compiles every owner property's updateOwner code it was sent at connect (clientside hot reload is off) and
//   runs it once a frame against its owner model, skipping a property whose value is undefined (gamemodeUpdateService
//   onUpdate). ctx.state is one object for all of them. The owner model is taken a tick after the createActor message.
// - spawn.ts: setUserActor (the createActor message, with the values saved on the character), then this login's roles,
//   then onUserAssignActor, all in one call.
// - the Console is a menu: ~ shows it at the next frame, and TESModPlatform.closeMenu (a kHide on the UI message queue)
//   hides it at the next frame. A key typed goes into the console line only while it is open, and Enter runs the line.
//   A person types one key a frame.
// Usage: node tests/tilde-console-gate-harness.js [path/to/gamemode.js]   (the default is the one beside tests/; pass
// another to run it against an older line, which must fail)
'use strict';
const fs = require('fs');
const path = require('path');

const GM = path.resolve(process.argv[2] || path.join(__dirname, '..', 'gamemode.js'));
const src = fs.readFileSync(GM, 'utf8');
let shippedCfg = null; try { shippedCfg = JSON.parse(fs.readFileSync(path.join(path.dirname(GM), 'gamemode-config.json'), 'utf8')); } catch (e) { /* checked below */ }

let fails = 0, passes = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? '   ' + JSON.stringify(detail).slice(0, 500) : ''}`); if (ok) passes++; else fails++; };
const note = (text) => console.log(`note  ${text}`);

// ---- the code under test, cut out of gamemode.js -------------------------------------------------------------------------
const cut = (from, to, o = {}) => {
  const a = src.indexOf(from);
  if (a < 0) { if (o.optional) return ''; throw new Error(`the marker "${from}" is gone from gamemode.js`); }
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`the end marker "${to.trim()}" after "${from}" is gone from gamemode.js`);
  return src.slice(a, o.inclusive ? b + to.length : b);
};
const line = (re) => { const m = src.match(re); if (!m) throw new Error(`no line ${re} in gamemode.js`); return m[0]; };
let PIECES, GATE;
try {
  GATE = cut('// ---- the ~ console', '\n// ---- name / permission change watch', { optional: true });
  PIECES = [
    cut('const idList = ', '\n// ---- native helpers'),
    line(/^const actorOf = .*$/m), line(/^const userOf = .*$/m), line(/^const profileOf = .*$/m), line(/^const rolesOf = .*$/m),
    cut('const tierFrom = ', '\n// Chat commands a Trial GM may run'),
    cut('const staffRolesSeen = ', '\nconst TIER_LABEL = '),
    cut('const onlineActors = () => {', '\nconst distanceMeters'),
    GATE,
    cut('// ---- name / permission change watch', '\n// ---- chat commands'),
    cut('if (globalThis.__dboLoginWaits) {', '\nconst startLoginWait = '),
    cut('const startLoginWait = ', '\n// spawn.ts calls this right after setUserActor'),
    cut("if (typeof globalThis.__dboPrevAssign === 'undefined')", 'mp.onUserAssignActor = assignHook;', { inclusive: true }),
    cut('globalThis.__dboHandlers.disconnect = (userId) => {', '\n};\n', { inclusive: true }),
    line(/^const gmConsoleOff = .*$/m), line(/^every\('consoleRights', 15000, .*$/m),
  ];
} catch (e) { console.log(`FAIL  ${e.message}`); process.exit(1); }
const HAS_GATE = GATE !== '';
check('gamemode.js has the ~ console gate section', HAS_GATE);

// Runs the cut code in one scope. A name it uses that is neither in `scope` nor a real global is an inert stub (the many
// login steps this test is not about), so the real handlers run whole.
const REAL_GLOBALS = new Set(Object.getOwnPropertyNames(globalThis));
const stub = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === Symbol.iterator ? function* () {} : k === 'then' ? undefined : stub),
  apply: () => stub, construct: () => stub,
});
const runCut = (code, scope, ret) => {
  const proxy = new Proxy(scope, {
    has: (t, k) => typeof k === 'string' && (k in t || !REAL_GLOBALS.has(k)),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : stub),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return new Function('__scope', `with (__scope) {\n${code}\nreturn { ${ret} };\n}`)(proxy);
};

// ---- the world ----------------------------------------------------------------------------------------------------------
const ROLE = { senior: 'role-senior', dev: 'role-developer', lead: 'role-leadgm', gm: 'role-gm', trial: 'role-trialgm', legacy: 'role-legacy-admin', player: 'role-player', booster: 'role-booster' };
const SETTINGS = { maxPlayers: 100, adminProfileIds: [900], adminRoleIds: [ROLE.legacy],
  adminRoles: { senior: [ROLE.senior], developer: [ROLE.dev], leadgm: [ROLE.lead], gm: [ROLE.gm], trialgm: [ROLE.trial] } };
let user = 0;
const person = (name, id, profile, roles) => ({ name, id: id >>> 0, profile, roles, user: ++user });
const P = {
  bob: person('Bob', 0xff000b01, 5, [ROLE.player, ROLE.booster]),
  lydia: person('Lydia', 0xff000c01, 6, []),
  trina: person('Trina', 0xff000a30, 4, [ROLE.trial, ROLE.player]),
  gemma: person('Gemma', 0xff000a20, 3, [ROLE.gm]),
  gmtrial: person('Gwen', 0xff000a21, 7, [ROLE.gm, ROLE.trial]),
  leda: person('Leda', 0xff000a40, 9, [ROLE.lead]),
  nate: person('Nate', 0xff000a10, 2, [ROLE.dev]),
  jake: person('Jake', 0xff000a02, 1, [ROLE.senior]),
  olaf: person('Olaf', 0xff000a50, 11, [ROLE.legacy]),
  owner: person('Owner', 0xff000a60, 900, []),
  cfgadmin: person('Cora', 0xff000a70, 901, []),
};
const STAFF = ['trina', 'gemma', 'gmtrial', 'leda', 'nate', 'jake', 'olaf', 'owner', 'cfgadmin'];
const PLAYERS = ['bob', 'lydia'];
const BASE_CFG = { admins: [901] };

const clock = { now: 1000000 };
const RealDate = Date;
global.Date = class extends RealDate { static now() { return clock.now; } };

const makeSched = () => {
  let id = 0; const timers = new Map(); const named = new Map();
  const add = (fn, ms, repeat) => { const n = Math.max(0, Number(ms) || 0); const t = { id: ++id, at: clock.now + n, fn, repeat: repeat ? Math.max(1, n) : 0 }; timers.set(t.id, t); return t.id; };
  return {
    setTimeout: (fn, ms) => add(fn, ms, false), setInterval: (fn, ms) => add(fn, ms, true), clear: (h) => { timers.delete(h); },
    every: (name, ms, fn) => { if (named.has(name)) timers.delete(named.get(name)); named.set(name, add(fn, ms, true)); },
    clearAll: () => { timers.clear(); named.clear(); },
    fire: (errors) => {
      for (;;) {
        let next = null;
        for (const x of timers.values()) if (x.at <= clock.now && (!next || x.at < next.at || (x.at === next.at && x.id < next.id))) next = x;
        if (!next) return;
        if (next.repeat) next.at += next.repeat; else timers.delete(next.id);
        try { if (typeof next.fn === 'function') next.fn(); } catch (e) { errors.push(String((e && e.message) || e)); }
      }
    },
  };
};

class Client {
  constructor(name, lag) {
    Object.assign(this, { name, lag: lag || 0, funcs: {}, inbox: [], model: null, nextModel: null, modelSet: false, state: {}, menus: new Set(), ui: [], keys: [],
      line: '', commands: [], notes: [], closeCalls: 0, ignoreHides: 0, errors: [], openRun: 0, maxRun: 0, openFrames: 0 });
    const self = this;
    this.sp = {
      Ui: { isMenuOpen: (n) => self.menus.has(n) },
      TESModPlatform: { closeMenu: (n) => { self.closeCalls++; self.ui.push({ hide: n }); } },
      Debug: { notification: (t) => self.notes.push({ at: clock.now, t }) },
      Game: { getPlayer: () => ({}) },
    };
    this.ctx = { sp: this.sp, value: undefined, state: this.state, refr: {}, get: (k) => (self.model || {})[k] };
  }
  gamemodeData(registry) { this.funcs = {}; for (const [k, o] of registry) if (o.isVisibleByOwner && typeof o.updateOwner === 'string' && o.updateOwner.trim()) this.funcs[k] = new Function('ctx', o.updateOwner); }
  deliver(msg) { this.inbox.push(Object.assign({ at: clock.now + this.lag }, msg)); }
  // keys from the next frame on, one every `gap` ms
  press(keys, gap = 16) { let t = clock.now + 16; for (const k of keys) { this.keys.push({ at: t, k }); t += gap; } }
  resetCounts() { Object.assign(this, { commands: [], notes: [], closeCalls: 0, maxRun: 0, openFrames: 0, errors: [] }); }
  frame() {
    const q = this.ui; this.ui = [];
    for (const m of q) {
      if (m.show) this.menus.add(m.show);
      else if (this.ignoreHides > 0) this.ignoreHides--;
      else if (this.menus.delete(m.hide) && m.hide === 'Console') this.line = '';
    }
    if (this.nextModel) { this.model = this.nextModel; this.nextModel = null; this.modelSet = true; }
    while (this.inbox.length && this.inbox[0].at <= clock.now) {
      const m = this.inbox.shift();
      if (m.create) this.nextModel = Object.assign({}, m.create);
      else if (m.set) { const target = this.nextModel || this.model; if (target) target[m.set[0]] = m.set[1]; }
    }
    if (this.modelSet && this.model) {
      for (const k of Object.keys(this.funcs)) {
        const v = this.model[k]; if (v === undefined) continue;
        this.ctx.value = v;
        try { this.funcs[k](this.ctx); } catch (e) { this.errors.push(String(e.message)); }
      }
    }
    while (this.keys.length && this.keys[0].at <= clock.now) {
      const { k } = this.keys.shift();
      if (k === '~') { if (!this.menus.has('Console')) this.ui.push({ show: 'Console' }); }
      else if (k === 'Enter') { if (this.menus.has('Console') && this.line) this.commands.push(this.line); this.line = ''; }
      else if (this.menus.has('Console')) this.line += k;
    }
    if (this.menus.has('Console')) { this.openRun++; this.openFrames++; if (this.openRun > this.maxRun) this.maxRun = this.openRun; } else this.openRun = 0;
  }
}

const freshGlobal = () => ({ __dboHandlers: {}, __dboJournalOpen: new Map() });
const makeWorld = (cfg) => {
  const w = { forms: new Map(), users: new Map(), registry: new Map(), clients: new Map(), logs: [], audits: [], told: [], errors: [], connected: new Set(), g: freshGlobal(), sched: makeSched(), api: null };
  w.mp = {
    get: (id, k) => {
      if ((id >>> 0) === 0 && k === 'onlinePlayers') return [...w.users.values()].filter(Boolean);
      const f = w.forms.get(id >>> 0); if (!f) throw new Error('form not found'); return f[k];
    },
    set: (id, k, v) => {
      const f = w.forms.get(id >>> 0); if (!f) throw new Error('form not found');
      f[k] = v;
      const r = w.registry.get(k); if (!r || !r.isVisibleByOwner) return;
      for (const [u, a] of w.users) if (a === (id >>> 0)) { const c = w.clients.get(u); if (c) c.deliver({ set: [k, v] }); }
    },
    makeProperty: (name, o) => { w.registry.set(name, o); },
    makeEventSource: () => {},
    getUserActor: (u) => w.users.get(u) || 0,
    getUserByActor: (a) => { for (const [u, x] of w.users) if (x === (a >>> 0)) return u; return 65535; },
    getServerSettings: () => SETTINGS,
    kick: (u) => w.disconnect(u),
  };
  const nameOf = (a) => { const f = w.forms.get(a >>> 0); return (f && f.appearance && f.appearance.name) || 'Stranger'; };
  // A gamemode load: the reload's clear() empties the property registry, then the file registers again
  w.boot = (c) => {
    w.cfg = c; w.registry = new Map([['isAdmin', { isVisibleByOwner: true, isVisibleByNeighbors: false, updateOwner: '', updateNeighbor: '' }]]);
    const scope = {
      mp: w.mp, cfg: c, serverSettings: SETTINGS, ADMIN_PROP: 'isAdmin', connected: w.connected, globalThis: w.g,
      log: (...a) => w.logs.push(a.map(String).join(' ')), audit: (t) => w.audits.push(String(t)),
      display: nameOf, who: nameOf, staffWho: nameOf, realNameOf: nameOf, publicNameOf: nameOf, personal: (a, t) => w.told.push([a, t]), system: (a, t) => w.told.push([a, t]),
      setTimeout: w.sched.setTimeout, clearTimeout: w.sched.clear, setInterval: w.sched.setInterval, clearInterval: w.sched.clear,
      every: w.sched.every, timed: (n, f) => f, creationPending: () => false, inCreatorRealm: () => false, staffCharOf: () => false,
    };
    w.api = runCut(PIECES.join('\n'), scope, `staffCan, staffRolesSeen${HAS_GATE ? ', consoleGateValue' : ''}`);
  };
  w.add = (p) => { if (!w.forms.has(p.id)) w.forms.set(p.id, { profileId: p.profile, appearance: { name: p.name } }); return p; };
  w.snapshot = (a) => { const f = w.forms.get(a >>> 0), out = {}; for (const [k, o] of w.registry) if (o.isVisibleByOwner && f[k] !== undefined) out[k] = f[k]; return out; };
  w.connect = (u, name, lag) => { const c = new Client(name, lag); w.clients.set(u, c); c.gamemodeData(w.registry); w.g.__dboHandlers.connect(u); return c; };
  // spawn.ts onSelectCharacter: setUserActor, the createActor message, this login's roles, onUserAssignActor
  w.assign = (u, a, roles) => {
    w.users.set(u, a >>> 0);
    const c = w.clients.get(u); if (c) c.deliver({ create: w.snapshot(a) });
    if (roles !== undefined) w.forms.get(a >>> 0)['private.discordRoles'] = roles;
    if (typeof w.mp.onUserAssignActor === 'function') w.mp.onUserAssignActor(u, a >>> 0);
  };
  w.disconnect = (u) => { if (!w.clients.has(u)) return; try { w.g.__dboHandlers.disconnect(u); } catch (e) { w.errors.push(`disconnect: ${e.message}`); } w.users.delete(u); w.clients.delete(u); };
  // The server process dies: no disconnect handler runs, the saved values stay as they were
  w.crash = () => { w.sched.clearAll(); w.users.clear(); w.clients.clear(); w.connected.clear(); w.g = freshGlobal(); };
  w.run = (ms) => { const end = clock.now + ms; while (clock.now < end) { clock.now += 16; w.sched.fire(w.errors); for (const c of w.clients.values()) c.frame(); } };
  w.value = (p) => w.forms.get(p.id)[CONSOLE_PROP];
  // A full login: connect, character select, the character, the login waiter's turn
  w.login = (p, o = {}) => { w.add(p); const c = w.connect(p.user, p.name, o.lag); w.run(o.select || 300); w.assign(p.user, o.actor || p.id, o.roles === undefined ? p.roles : o.roles === 'none' ? undefined : o.roles); w.run(o.after === undefined ? 700 : o.after); return c; };
  w.boot(cfg || BASE_CFG);
  return w;
};
const CONSOLE_PROP = 'ff_console';
// A person opens the console and types tgm, one key a frame, then Enter. True when the command ran.
const tryCommand = (w, c, cmd = 'tgm') => { const before = c.commands.length; c.press(['~', ...cmd.split(''), 'Enter']); w.run(400); return c.commands.length > before; };

// ---- 1. who keeps the console ---------------------------------------------------------------------------------------------
{
  const w = makeWorld();
  if (HAS_GATE) {
    for (const k of [...STAFF, ...PLAYERS]) { w.add(P[k]); w.forms.get(P[k].id)['private.discordRoles'] = P[k].roles; }
    for (const k of STAFF) check(`${k} (${P[k].roles.join('+') || 'profile ' + P[k].profile}) keeps the console: value true`, w.api.consoleGateValue(P[k].id) === true, w.api.consoleGateValue(P[k].id));
    for (const k of PLAYERS) check(`${k}, a player (${P[k].roles.join('+') || 'no roles'}), gets false`, w.api.consoleGateValue(P[k].id) === false, w.api.consoleGateValue(P[k].id));
    check('the rule is the F7 panel\'s and the Admin tab\'s: value true exactly where staffCan(a, adminchat)', [...STAFF, ...PLAYERS].every((k) => (w.api.consoleGateValue(P[k].id) === true) === w.api.staffCan(P[k].id, 'adminchat')));
    delete w.forms.get(P.bob.id)['private.discordRoles'];
    check('roles never loaded: null (nothing is closed)', w.api.consoleGateValue(P.bob.id) === null, w.api.consoleGateValue(P.bob.id));
    w.forms.get(P.owner.id)['private.discordRoles'] = undefined;
    check('...but an adminProfileIds owner with no roles loaded keeps it (true)', w.api.consoleGateValue(P.owner.id) === true, w.api.consoleGateValue(P.owner.id));
    w.forms.get(P.jake.id).isAdmin = false;
    check('the isAdmin flag is not read (false during the Admin tab resync): a senior stays true', w.api.consoleGateValue(P.jake.id) === true);
    check('an unknown actor gives null, not a throw', (() => { try { return w.api.consoleGateValue(0xff0fffff) === null; } catch (e) { return false; } })());
  } else check('who keeps the console: there is no gate value to ask', false);
}

// ---- 2. the client code alone ---------------------------------------------------------------------------------------------
{
  const w = makeWorld();
  const prop = w.registry.get(CONSOLE_PROP);
  check('ff_console is registered, owner-only (isVisibleByOwner, not by neighbours)', !!prop && prop.isVisibleByOwner === true && !prop.isVisibleByNeighbors, prop && { o: prop.isVisibleByOwner, n: prop.isVisibleByNeighbors });
  let body = null; try { body = prop && new Function('ctx', prop.updateOwner); } catch (e) { check('the updateOwner code compiles', false, e.message); }
  check('it carries updateOwner code the client can compile', typeof body === 'function');
  if (body) {
    const fake = (o = {}) => {
      const r = { closed: [], told: 0, open: new Set(o.open || ['Console']) };
      r.ctx = { value: o.value, state: o.state || {}, sp: {
        Ui: { isMenuOpen: o.isMenuOpen || ((n) => r.open.has(n)) },
        TESModPlatform: o.noClose ? {} : o.noTm ? undefined : { closeMenu: (n) => { if (o.closeThrows) throw new Error('native'); r.closed.push(n); } },
        Debug: { notification: () => { if (o.noteThrows) throw new Error('native'); r.told++; } },
      } };
      return r;
    };
    for (const v of [true, null, undefined, 0, '', 'false', {}]) { const r = fake({ value: v }); body(r.ctx); check(`value ${JSON.stringify(v) === undefined ? 'undefined' : JSON.stringify(v)}: nothing is closed`, r.closed.length === 0 && r.told === 0, r.closed); }
    let r = fake({ value: false }); body(r.ctx);
    check('value false with the Console open: closeMenu("Console") and one notification', r.closed.join() === 'Console' && r.told === 1, r);
    r = fake({ value: false, open: ['Console', 'Console Native UI Menu'] }); body(r.ctx);
    check('both console menus are closed when both are open', r.closed.join('|') === 'Console|Console Native UI Menu', r.closed);
    r = fake({ value: false, open: [] }); body(r.ctx);
    check('value false with no console open: nothing is closed', r.closed.length === 0 && r.told === 0);
    const safe = (o) => { const x = fake(Object.assign({ value: false }, o)); try { body(x.ctx); return { ok: true, x }; } catch (e) { return { ok: false, e: e.message }; } };
    let s = safe({ noClose: true }); check('no closeMenu on this client: no throw, nothing closed, no notification', s.ok && s.x.closed.length === 0 && s.x.told === 0, s);
    s = safe({ noTm: true }); check('no TESModPlatform at all: no throw', s.ok, s);
    s = safe({ isMenuOpen: () => { throw new Error('native'); } }); check('isMenuOpen throws: no throw, nothing closed', s.ok && s.x.closed.length === 0, s);
    s = safe({ closeThrows: true }); check('closeMenu throws: no throw', s.ok, s);
    s = safe({ noteThrows: true }); check('the notification throws: no throw, the console was still closed', s.ok && s.x.closed.join() === 'Console', s);
    // the retry and notification limits on one shared state
    const state = {}; const realNow = clock.now; let closes = 0, told = 0;
    for (let t = 0; t <= 1000; t += 16) { clock.now = realNow + t; const x = fake({ value: false, state }); body(x.ctx); closes += x.closed.length; told += x.told; }
    check('a console that will not close is tried again at most every 100 ms (10 or 11 tries in 1 s)', closes >= 9 && closes <= 11, closes);
    check('...and the notification is shown once in that second', told === 1, told);
    clock.now = realNow + 10500; let x = fake({ value: false, state }); body(x.ctx);
    check('the notification comes again after 10 s', x.told === 1);
    clock.now = realNow + 10520; x = fake({ value: false, state, open: [] }); body(x.ctx); clock.now = realNow + 10536; x = fake({ value: false, state }); body(x.ctx);
    check('a console opened again after it closed is closed on the first frame (the retry wait is reset)', x.closed.join() === 'Console' && x.told === 0, x.closed);
    clock.now = realNow;
    const keys = [...prop.updateOwner.matchAll(/ctx\.state\.(\w+)/g)].map((m) => m[1]);
    check('every ctx.state key of the gate starts with dboConsole (ctx.state is shared by all owner code)', keys.length > 0 && keys.every((k) => k.startsWith('dboConsole')), keys);
    const elsewhere = [...src.replace(GATE, '').matchAll(/ctx\.state\.(dboConsole\w*)/g)].map((m) => m[1]);
    check('...and no other client code in gamemode.js uses a dboConsole key', elsewhere.length === 0, elsewhere);
  }
  check('the gate does not read the isAdmin flag', HAS_GATE && !/ADMIN_PROP|'isAdmin'/.test(GATE));
  check('the gate adds no mp.on, no __dboHandlers assignment and no event loop (the deploy gate refuses those)', HAS_GATE && !/mp\.on\(|__dboHandlers *= |for \(const ev of \[/.test(GATE));
}

// ---- 3. a normal player cannot keep it open or run a command through it ---------------------------------------------------------
{
  const w = makeWorld();
  const bob = w.login(P.bob);
  check('Bob\'s ff_console is false after login', w.value(P.bob) === false, w.value(P.bob));
  bob.resetCounts();
  const ran = tryCommand(w, bob);
  check('Bob types ~ tgm Enter: the command never runs', !ran, bob.commands);
  check('...the console was open for one frame at most', bob.maxRun <= 1, bob.maxRun);
  check('...and he was told why, once', bob.notes.length === 1 && /staff/.test(bob.notes[0].t), bob.notes);
  bob.resetCounts();
  bob.press(Array(10).fill('~'), 48); w.run(800);
  check('~ pressed 10 times fast: open one frame at most each time', bob.maxRun <= 1 && bob.openFrames <= 10, { maxRun: bob.maxRun, openFrames: bob.openFrames });
  check('...no second notification inside 10 s', bob.notes.length === 0, bob.notes.length);
  bob.resetCounts(); w.run(10000); tryCommand(w, bob);
  check('...and after 10 s the notification comes again', bob.notes.length === 1);
  bob.resetCounts(); bob.ignoreHides = 3; bob.press(['~']); w.run(1000);
  check('a console that ignores the first three closes is closed within 500 ms anyway', bob.maxRun > 1 && bob.maxRun * 16 <= 500 && !bob.menus.has('Console'), { maxRun: bob.maxRun, closeCalls: bob.closeCalls });
  check('...with no more than one try every 100 ms', bob.closeCalls <= Math.ceil((bob.maxRun * 16) / 100) + 1, { closeCalls: bob.closeCalls, ms: bob.maxRun * 16 });
  check('no client code threw', bob.errors.length === 0, bob.errors);
  const lydia = w.login(P.lydia);
  check('Lydia (no Discord roles at all) cannot run a command either', !tryCommand(w, lydia) && lydia.maxRun <= 1, { cmds: lydia.commands, maxRun: lydia.maxRun });
  // the known limit, printed and not counted
  const macro = w.login(person('Mac', 0xff000d01, 12, [ROLE.player]));
  macro.press(['~']); w.run(16); macro.keys.push(...['t', 'g', 'm', 'Enter'].map((k) => ({ at: clock.now + 16, k }))); w.run(200);
  note(`known limit: a macro that types the whole line and Enter on the one frame the console is open ${macro.commands.length ? 'still runs it' : 'did not run it'}; the server's checks stay the authority`);
}

// ---- 4. every staff rank keeps it exactly as now --------------------------------------------------------------------------------
{
  const w = makeWorld();
  for (const k of STAFF) {
    const c = w.login(P[k]);
    c.resetCounts();
    const ran = tryCommand(w, c);
    c.press(['~']); w.run(1000);
    check(`${k}: the command runs, the console stays open, nothing is closed`, ran && c.closeCalls === 0 && c.notes.length === 0 && c.menus.has('Console'), { ran, closeCalls: c.closeCalls, value: w.value(P[k]) });
  }
}

// ---- 5. the staff flag arriving late ------------------------------------------------------------------------------------------------
{
  let w = makeWorld();
  // a first login ever, on a slow connection: the console is opened before any value arrives
  const nate = w.login(P.nate, { lag: 400, after: 0 });
  nate.press(['~']); w.run(2000);
  check('an admin who opens the console before the value arrives (400 ms lag) is never closed', nate.closeCalls === 0 && nate.menus.has('Console'), nate.closeCalls);
  // roles not loaded at the assignment, written later: null, then true
  w = makeWorld();
  const jake = w.login(P.jake, { roles: 'none' });
  check('roles not loaded at the assignment: null', w.value(P.jake) === null, w.value(P.jake));
  jake.press(['~']); w.run(500);
  w.forms.get(P.jake.id)['private.discordRoles'] = P.jake.roles; w.run(16000);
  check('...the roles arrive: true within 15 s, and the open console was never closed', w.value(P.jake) === true && jake.closeCalls === 0 && jake.menus.has('Console'), { v: w.value(P.jake), closeCalls: jake.closeCalls });
  const bob = w.login(P.bob, { roles: 'none' });
  check('a player whose roles are not loaded is not closed yet (null: it fails open)', w.value(P.bob) === null && tryCommand(w, bob), w.value(P.bob));
  w.forms.get(P.bob.id)['private.discordRoles'] = P.bob.roles; w.run(16000); bob.resetCounts();
  check('...once they load, his console is closed within 15 s', w.value(P.bob) === false && !tryCommand(w, bob) && bob.maxRun <= 1, { v: w.value(P.bob), maxRun: bob.maxRun });
  // the isAdmin flag: written 8 s after login, then false for 2 s about 20 s later (resyncAdminFlag)
  w = makeWorld();
  const leda = w.login(P.leda, { after: 100 });
  const isAdminSeen = [];
  leda.press(['~']);
  for (let t = 0; t < 35000; t += 100) { w.run(100); isAdminSeen.push(w.forms.get(P.leda.id).isAdmin); }
  check('the test saw the isAdmin flag arrive late and go false in the resync window', isAdminSeen[0] === undefined && isAdminSeen.includes(true) && isAdminSeen.includes(false), [isAdminSeen[0], isAdminSeen.includes(true), isAdminSeen.includes(false)]);
  check('...and the Lead GM\'s console, open from the first second, was never closed through it', leda.closeCalls === 0 && leda.menus.has('Console') && w.value(P.leda) === true, { closeCalls: leda.closeCalls, v: w.value(P.leda) });
}

// ---- 6. a relog and a reconnect -----------------------------------------------------------------------------------------------------
{
  let w = makeWorld();
  const bob = w.login(P.bob);
  w.disconnect(P.bob.user);
  check('a logout writes null on the character: no answer is saved', w.value(P.bob) === null, w.value(P.bob));
  const gemma = w.login(P.gemma); w.disconnect(P.gemma.user);
  check('...a staff member\'s too', w.value(P.gemma) === null, w.value(P.gemma));
  // back at character select: nothing runs until the character exists, then false at once
  const bob2 = w.connect(P.bob.user, 'Bob'); w.run(1000);
  check('reconnected, at character select: no character, nothing closed', bob2.closeCalls === 0 && w.value(P.bob) === null);
  w.assign(P.bob.user, P.bob.id, P.bob.roles);
  bob2.press(['~', 't', 'g', 'm', 'Enter'], 16); w.run(400);
  check('...his character arrives: closed from the first frame it exists, the command never runs', bob2.commands.length === 0 && bob2.maxRun <= 1 && bob2.closeCalls >= 1, { cmds: bob2.commands, maxRun: bob2.maxRun });
  // a character switch to another of his characters, whose saved value is a stale true
  const alt = w.add(person('Bob Alt', 0xff000b02, 5, P.bob.roles)); w.forms.get(alt.id)[CONSOLE_PROP] = true;
  w.assign(P.bob.user, alt.id, P.bob.roles); bob2.resetCounts();
  bob2.press(['~', 't', 'g', 'm', 'Enter'], 16); w.run(400);
  check('a character switch to a character saved with a stale true: false at the assignment, closed at once', w.value(alt) === false && bob2.commands.length === 0 && bob2.maxRun <= 1, { v: w.value(alt), cmds: bob2.commands });
  // a crash: nobody's logout ran, so the saved values are the last session's
  w = makeWorld();
  w.login(P.gemma); w.login(P.bob); w.login(P.trina);
  w.forms.get(P.bob.id)[CONSOLE_PROP] = false;
  w.crash(); w.boot(BASE_CFG);
  check('a crash leaves the session\'s values saved (no logout ran)', w.value(P.gemma) === true && w.value(P.trina) === true);
  // while the server was down Gemma lost her GM role and Bob was made a GM
  const g = w.login(P.gemma, { roles: [ROLE.player], after: 0 });
  g.press(['~', 't', 'g', 'm', 'Enter']); w.run(800);
  check('demoted while offline, back after a crash: the stale true is replaced at the assignment, closed from the first frame', w.value(P.gemma) === false && g.commands.length === 0 && g.maxRun <= 1, { v: w.value(P.gemma), cmds: g.commands, maxRun: g.maxRun });
  const b = w.login(P.bob, { roles: [ROLE.gm], after: 0 });
  b.press(['~']); w.run(1500);
  check('promoted while offline, back after a crash with false saved: never closed', w.value(P.bob) === true && b.closeCalls === 0 && b.menus.has('Console'), { v: w.value(P.bob), closeCalls: b.closeCalls });
  // a hot reload with both online: everyone online is written at load, the login waiters come back, nothing changes
  w = makeWorld();
  const bob3 = w.login(P.bob), leda = w.login(P.leda);
  w.logs.length = 0; w.boot(BASE_CFG); w.run(1000);
  check('a hot reload logs the gate and its counts', w.logs.some((l) => /console gate on: online now 1 staff \(open\), 1 closed, 0 undecided/.test(l)), w.logs.filter((l) => /console gate/.test(l)));
  bob3.resetCounts(); leda.resetCounts();
  check('...after it Bob is still closed and Leda still open', !tryCommand(w, bob3) && tryCommand(w, leda) && leda.closeCalls === 0);
  // a connection that came before the gate (code is only sent at connect): its value is written, but no code runs it
  w = makeWorld();
  w.add(P.bob); const early = new Client('Bob'); w.clients.set(P.bob.user, early); early.gamemodeData(new Map()); w.g.__dboHandlers.connect(P.bob.user);
  w.run(300); w.assign(P.bob.user, P.bob.id, P.bob.roles); w.run(700);
  note(`a client connected before the deploy has no gate code until it reconnects: Bob ${tryCommand(w, early) ? 'can' : 'cannot'} still run a command there (value ${w.value(P.bob)})`);
}

// ---- 7. a demotion mid-session ------------------------------------------------------------------------------------------------------
{
  let w = makeWorld();
  const gemma = w.login(P.gemma);
  check('Gemma (GM) is online with true', w.value(P.gemma) === true && tryCommand(w, gemma));
  // the server's own rank changes mid-session (her roles on the character rewritten)
  w.forms.get(P.gemma.id)['private.discordRoles'] = [ROLE.player]; w.logs.length = 0;
  w.run(15100); gemma.resetCounts();
  check('her rank goes: false within 15 s, and the console closes on the next try', w.value(P.gemma) === false && !tryCommand(w, gemma) && gemma.maxRun <= 1, { v: w.value(P.gemma), cmds: gemma.commands });
  check('...a console she had open then is closed too', (() => { w.forms.get(P.gemma.id)['private.discordRoles'] = [ROLE.gm]; w.run(15100); gemma.press(['~']); w.run(500); const open = gemma.menus.has('Console'); w.forms.get(P.gemma.id)['private.discordRoles'] = [ROLE.player]; w.run(15100); return open && !gemma.menus.has('Console'); })());
  check('...and the change is logged', w.logs.some((l) => /console gate: Gemma now false \(was true\)/.test(l)), w.logs.filter((l) => /console gate/.test(l)));
  // the Discord role sync (discordroles.js -> staffRolesSeen): a lower tier is logged out, the next login decides afresh
  w = makeWorld();
  const leda = w.login(P.leda);
  w.api.staffRolesSeen(P.leda.id, [ROLE.player]); w.run(2000);
  check('the role sync logs a demoted Lead GM out, and the logout writes null', !w.clients.has(P.leda.user) && w.value(P.leda) === null, { online: w.clients.has(P.leda.user), v: w.value(P.leda) });
  const leda2 = w.login(P.leda, { roles: [ROLE.player], after: 0 });
  leda2.press(['~', 't', 'g', 'm', 'Enter']); w.run(800);
  check('...she logs in again as a player: closed from the first frame', w.value(P.leda) === false && leda2.commands.length === 0 && leda2.maxRun <= 1, { v: w.value(P.leda), cmds: leda2.commands });
  // a hot reload that takes a profile out of gamemode-config admins: false at once, before any loop
  w = makeWorld();
  const cora = w.login(P.cfgadmin);
  check('Cora (gamemode-config admins, no roles) keeps it', w.value(P.cfgadmin) === true && tryCommand(w, cora));
  w.boot({ admins: [] });
  check('...a reload without her in admins writes false at load', w.value(P.cfgadmin) === false);
  w.run(100);
  check('...and the console she had open closes', !cora.menus.has('Console'));
  cora.resetCounts();
  check('...and stays closed', !tryCommand(w, cora) && cora.maxRun <= 1, { cmds: cora.commands, maxRun: cora.maxRun });
  // and the other way: made staff mid-session
  w = makeWorld();
  const bob = w.login(P.bob);
  w.forms.get(P.bob.id)['private.discordRoles'] = [ROLE.trial]; w.run(15100); bob.resetCounts();
  check('made a Trial GM mid-session: true within 15 s, the command runs', w.value(P.bob) === true && tryCommand(w, bob) && bob.closeCalls === 0);
}

// ---- 8. the switches --------------------------------------------------------------------------------------------------------------
{
  let w = makeWorld();
  const bob = w.login(P.bob), leda = w.login(P.leda);
  w.logs.length = 0; w.boot({ admins: [901], consoleGate: { enabled: false } });
  check('consoleGate.enabled false: a reload writes everyone online null at once', w.value(P.bob) === null && w.value(P.leda) === null);
  bob.resetCounts(); w.run(100);
  check('...and Bob\'s console works again with no relog (the off switch)', tryCommand(w, bob) && bob.closeCalls === 0);
  check('...the load says the gate is off', w.logs.some((l) => /console gate off/.test(l)), w.logs);
  w.run(15100);
  check('...and the loop does not turn it back on', w.value(P.bob) === null);
  w.boot({ admins: [901], consoleGate: false });
  check('consoleGate: false is off too', w.value(P.bob) === null);
  w.boot({ admins: [901], consoleGate: { testProfiles: [P.leda.profile] } });
  leda.resetCounts(); w.run(100);
  check('testProfiles: a Lead GM listed there is closed, to check the gate in game as staff', w.value(P.leda) === false && !tryCommand(w, leda));
  check('...a missing enabled key is on (Bob closed again)', w.value(P.bob) === false);
  w = makeWorld({});
  w.login(P.bob);
  check('no consoleGate key at all: on', w.value(P.bob) === false);
  const sc = shippedCfg && shippedCfg.consoleGate;
  check('the shipped gamemode-config.json has consoleGate on, with no test profiles', !!sc && sc.enabled === true && Array.isArray(sc.testProfiles) && sc.testProfiles.length === 0, sc);
}

// ---- 9. the login wiring, as written ------------------------------------------------------------------------------------------------
{
  const assignBody = src.slice(src.indexOf('const assignHook = (userId, a) => {'), src.indexOf('assignHook.__dbo = true;'));
  check('the assignment hook writes the gate (same call as spawn.ts writes the roles)', /loginStep\('console gate on assign', \(\) => consoleGateWrite\(a, true\)\)/.test(assignBody));
  const ocr = src.slice(src.indexOf('const onCharacterReady = (userId, a) => {'), src.indexOf('const startLoginWait = '));
  const first = ocr.split('\n').slice(1).find((l) => !/^\s*\/\//.test(l)) || '';
  check('onCharacterReady writes it first, before anything that could throw', /loginStep\('console gate', \(\) => consoleGateWrite\(a, true\)\)/.test(first), first.trim());
  check('the logout writes null', /if \(a\) \{ try \{ consoleGateClear\(a\); \}/.test(src.slice(src.indexOf('globalThis.__dboHandlers.disconnect = '), src.indexOf('globalThis.__dboHandlers.disconnect = ') + 6000)));
  check('the consoleRights loop writes it when it changes', /every\('consoleRights', 15000, [^\n]*consoleGateWrite\(a, false\)/.test(src));
}

global.Date = RealDate;
console.log('');
console.log(fails ? `${fails} FAILURES (${passes} passed)` : `all ${passes} checks passed`);
process.exit(fails ? 1 : 0);
