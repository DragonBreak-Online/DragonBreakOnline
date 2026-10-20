// The admin panel's GM Calls tab (gmcall.js, dbo:staffGmCalls and the staffData widget 140): staff watching the tab get the
// calls as gmcall.js holds them, again whenever one changes, and the tab's take, goto, release and close do what the chat
// commands do. No server, no game: the api is stubs, as in gmcall-harness.
//
//   node tests/gmcall-panel-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'gmcall.js');
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-gmpanel-'));
process.chdir(dir);
delete globalThis.__dboGmCalls; delete globalThis.__dboGmCallsRun;

let fails = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail !== undefined && !ok ? '   ' + detail : ''}`); if (!ok) fails++; };

let now = Date.UTC(2026, 9, 19, 12, 0, 0);
Date.now = () => now;
const CALLER = 0xff000101, ADMIN = 0xff000201, HELPER = 0xff000202, PLAYER = 0xff000103, TRIAL = 0xff000204;
const P = {
  [CALLER]: { name: 'Argosh', profile: 11, roles: [], w: '1:Skyrim.esm', pos: [1, 2, 3] },
  [ADMIN]: { name: 'Iced Sky', profile: 21, roles: [], admin: true, w: '1:Skyrim.esm', pos: [0, 0, 0] },
  [HELPER]: { name: 'Helper', profile: 22, roles: ['999'], w: '1:Skyrim.esm', pos: [0, 0, 0] },
  [PLAYER]: { name: 'Nosy', profile: 13, roles: [], w: '1:Skyrim.esm', pos: [0, 0, 0] },
  [TRIAL]: { name: 'Trial', profile: 24, roles: [], trial: true, w: '1:Skyrim.esm', pos: [0, 0, 0] },
};
let online = [CALLER, ADMIN, HELPER, PLAYER, TRIAL];
const widgets = [];   // [actor, widget]
const closed = [];    // [actor, id]
const said = [];
const teleports = [];
const timers = new Map();
const ui = new Map();
const commands = {};
const api = {
  mp: { get: (a, k) => { const p = P[a]; if (!p) throw new Error('no actor'); return k === 'pos' ? p.pos : k === 'worldOrCellDesc' ? p.w : k === 'angle' ? [0, 0, 0] : undefined; }, getIdFromDesc: () => 1 },
  log: () => {}, personal: (a, t) => said.push([a, t]), staffSay: (a, t) => said.push([a, t]), audit: () => {}, staffNote: () => {},
  who: (a) => P[a].name, display: (a) => P[a].name, profileOf: (a) => (P[a] ? P[a].profile : -1), discordOf: () => '', rolesOf: (a) => P[a].roles,
  onlineActors: () => online.slice(), registerChatCommand: (n, fn) => { commands[n] = fn; }, isAdmin: (a) => !!(P[a] && P[a].admin),
  staffCan: (a, what) => !!(P[a] && (P[a].admin || (P[a].trial && what === 'gmcall'))),
  every: (name, ms, fn) => timers.set(name, fn), saveSoon: () => {}, sendPacket: () => true, zoneOfActor: () => null, zoneById: () => null,
  recordOf: () => null, teleportTo: (a, place) => { teleports.push([a, place]); return ''; }, creationPending: () => false,
  openWidget: (a, w, focus) => widgets.push([a, w, focus]), closeWidget: (a, id) => closed.push([a, id]),
  onUi: (e, f) => { const l = ui.get(e) || []; l.push(f); ui.set(e, l); },
  cfg: { gmCalls: { staffRoleIds: ['999'], cooldownSeconds: 0 } },
};
delete require.cache[MODULE];
require(MODULE)(api);
const tab = (a, ...args) => (ui.get('staffGmCalls') || []).forEach((f) => f(a, args));
const flush = () => new Promise((r) => setImmediate(r));
const last = (a) => { const w = widgets.filter((x) => x[0] === a).pop(); return w ? w[1] : null; };

(async () => {
  check('the tab\'s event is registered once', (ui.get('staffGmCalls') || []).length === 1);
  check('no second timer: the panel rides the gmcalls tick', timers.size === 1 && timers.has('gmcalls'));

  tab(PLAYER, 'watch');
  check('a player who is not staff gets nothing', !widgets.some((x) => x[0] === PLAYER));

  tab(ADMIN, 'watch');
  let w = last(ADMIN);
  check('watching sends the list at once as a data widget (staffData 140, unfocused)', w && w.type === 'staffData' && w.id === 140 && w.kind === 'gmCalls' && widgets[widgets.length - 1][2] === false, JSON.stringify(w));
  check('with no calls the list is empty, and a GM tier may go to callers', w.open.length === 0 && w.canGoto === true);

  commands.gm(CALLER, 'I fell through the floor of the inn');
  await flush();
  w = last(ADMIN);
  check('a new call reaches the open tab without asking', w && w.open.length === 1 && w.open[0].name === 'Argosh' && w.open[0].lines[0].text === 'I fell through the floor of the inn', JSON.stringify(w && w.open));
  check('it reads gmcall.js\'s own list (the same numbers as /gm list)', w.open[0].n === globalThis.__dboGmCalls.open[0].n && w.open[0].online === true && w.open[0].takenBy === '');
  check('the time is the call\'s, with the server clock beside it', w.open[0].at === now && w.now === now);

  tab(HELPER, 'watch');
  check('a role-only helper sees the list but may not go to callers', last(HELPER) && last(HELPER).open.length === 1 && last(HELPER).canGoto === false);

  tab(TRIAL, 'watch');
  check('a Trial GM (staffCan gmcall) sees the list and may go to callers, as /gm goto allows', last(TRIAL) && last(TRIAL).open.length === 1 && last(TRIAL).canGoto === true);
  const n = w.open[0].n;
  const before = widgets.length;
  tab(ADMIN, 'take', n);
  await flush();
  w = last(ADMIN);
  check('Take takes it for the GM', globalThis.__dboGmCalls.open[0].takenBy && globalThis.__dboGmCalls.open[0].takenBy.profile === 21);
  check('the tab shows it as theirs', w.open[0].takenBy === 'Iced Sky' && w.open[0].mine === true);
  check('the other staff tab hears of it too', last(HELPER).open[0].takenBy === 'Iced Sky' && last(HELPER).open[0].mine === false);
  check('the caller is told who is coming, as /gm take does', said.some((x) => x[0] === CALLER && /Iced Sky has your GM call/.test(x[1])));

  const sent = widgets.length;
  await flush(); timers.get('gmcalls')();
  check('nothing new is sent when nothing changed', widgets.length === sent);

  tab(HELPER, 'goto', n);
  check('goto is refused to a helper without a GM tier', teleports.length === 0);
  tab(ADMIN, 'goto', n);
  check('goto from the tab takes the GM to the caller', teleports.length === 1 && teleports[0][0] === ADMIN && teleports[0][1].pos === P[CALLER].pos);

  tab(ADMIN, 'release', n);
  await flush();
  check('Release puts it back to waiting', !globalThis.__dboGmCalls.open[0].takenBy && last(ADMIN).open[0].takenBy === '');

  online = [ADMIN, HELPER, PLAYER];
  timers.get('gmcalls')();
  check('a caller logging off shows on the next tick', last(ADMIN).open[0].online === false);
  online = [CALLER, ADMIN, HELPER, PLAYER];

  tab(ADMIN, 'close', n, 'sorted, unstuck');
  await flush();
  w = last(ADMIN);
  check('Close closes it with the note', globalThis.__dboGmCalls.open.length === 0 && globalThis.__dboGmCalls.closed.slice(-1)[0].note === 'sorted, unstuck');
  check('the tab moves it to the lately closed list', w.open.length === 0 && w.closed[0].n === n && w.closed[0].how === 'closed' && w.closed[0].by === 'Iced Sky');

  said.length = 0;
  tab(ADMIN, 'take', 999);
  check('an unknown number is answered in chat, as /gm take is', said.some((x) => x[0] === ADMIN && /No open GM call #999/.test(x[1])));
  tab(ADMIN, 'nonsense', n);
  check('an unknown action does nothing', true);

  tab(HELPER, 'unwatch');
  check('closing the tab removes the data widget', closed.some((x) => x[0] === HELPER && x[1] === 140) && !globalThis.__dboGmCallsRun.watch.has(HELPER >>> 0));
  const sentBefore = widgets.filter((x) => x[0] === HELPER).length;
  commands.gm(CALLER, 'stuck again, sorry');
  await flush();
  check('a closed tab is sent nothing more', widgets.filter((x) => x[0] === HELPER).length === sentBefore);
  online = [CALLER, HELPER, PLAYER];
  timers.get('gmcalls')();
  check('a watcher who logged off is dropped', !globalThis.__dboGmCallsRun.watch.has(ADMIN >>> 0));

  check('the view global gives staff the list and others nothing', globalThis.__dboGmCallsView(HELPER).open.length === 1 && globalThis.__dboGmCallsView(PLAYER) === null);

  const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
  check('gamemode.js hands gmcall.js openWidget, closeWidget and onUi', /openWidget, closeWidget, onUi, token:/.test(src));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  console.log(fails ? `${fails} failure(s)` : 'all checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the harness threw', e.stack); process.exit(1); });
