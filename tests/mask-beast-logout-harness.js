// A masked character who logs out in a beast form lost its name for good (Masked Person #LLX8, 11 Oct 06:40:22: masked at
// 05:57:14, Beast Form at 05:57:18, logout; every JOIN after it as Masked Person and the mask refused). gamemode.js's
// disconnect handler unmasked first (playermenu.js: the real name back, maskName cleared), then reverted the beast
// (beastform.js: the look kept at the change, named "Masked Person", written back), so the mask name stayed with nothing
// kept behind it. The mask now comes off after the beast, as at login. Loads the real playermenu.js and beastform.js
// against one stub mp, and runs the disconnect handler cut out of gamemode.js.
//   node tests/mask-beast-logout-harness.js   (from server/; GAMEMODE=<file> runs another gamemode.js)
'use strict';
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (c, what, got) => { if (c) { pass++; console.log('ok  ', what); } else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); } };

const gmPath = process.env.GAMEMODE ? path.resolve(process.env.GAMEMODE) : path.resolve(__dirname, '..', 'gamemode.js');
const gm = fs.readFileSync(gmPath, 'utf8');
const a0 = gm.indexOf('globalThis.__dboHandlers.disconnect = (userId) => {');
const a1 = a0 < 0 ? -1 : gm.indexOf('\n};\n', a0);
if (a0 < 0 || a1 < 0) { console.log('FAIL the disconnect handler is gone from gamemode.js'); process.exit(1); }
const disconnectSrc = gm.slice(a0, a1 + 3);

const MASK = 0xfe00b808, NORD = 0x13746, P = 0xff000048, U = 7;
const DESCS = { '808:Armors of the Velothi Pt2.esp': MASK };
const props = new Map();
const mp = {
  get: (a, k) => props.get(`${a}|${k}`),
  set: (a, k, v) => props.set(`${a}|${k}`, v),
  getIdFromDesc: (d) => DESCS[d] || (0x1000 + [...String(d)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) & 0xffff, 7)),
  getDescFromId: (id) => (id >>> 0).toString(16),
  callPapyrusFunction: (kind, cls, method, self, args) => {
    if (method !== 'EquipItem' && method !== 'UnequipItem') return true;
    const a = parseInt(self.desc, 16) >>> 0, b = parseInt(args[0].desc, 16) >>> 0;
    const e = ((props.get(`${a}|inventory`) || { entries: [] }).entries).find((q) => (q.baseId >>> 0) === b);
    if (e) e.worn = method === 'EquipItem';
    return true;
  },
  lookupEspmRecordById: () => ({ record: { editorId: 'NordRace' } }),
};
const said = [], logs = [], ui = new Map(), timers = [];
const savedTimeout = global.setTimeout; global.setTimeout = (fn) => { timers.push(fn); return 0; };
const runTimers = () => { while (timers.length) timers.shift()(); };
let fakeNow = 1_900_000_000_000;
const savedNow = Date.now; Date.now = () => fakeNow;
const noop = () => {};
const give = (a, b, n) => { const x = props.get(`${a}|inventory`) || { entries: [] }; const es = x.entries.map((q) => Object.assign({}, q)); const h = es.find((q) => q.baseId === b && !q.worn); if (h) h.count += n; else es.push({ baseId: b, count: n }); props.set(`${a}|inventory`, { entries: es }); return true; };
const nameShown = (a) => (props.get(`${a}|appearance`) || {}).name;
const display = (a) => `${nameShown(a) || 'Stranger'} #LLX8`;
const api = {
  mp, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => said.push(t), system: noop, onUi: (n, fn) => ui.set(n, fn), sendPacket: noop,
  display, who: display, audit: (t) => logs.push('audit: ' + t), nameOf: (a) => nameShown(a) || 'Stranger', tagOf: () => 'LLX8', profileOf: () => 72,
  onlineActors: () => [P], isAdmin: () => false, ranksOf: () => [], giveItem: give, makeProp: noop, runCommand: noop, every: noop,
  registerChatCommand: noop, findByName: () => null, redress: noop, cfg: { playerMenu: {} },
};
require(path.resolve(__dirname, '..', 'playermenu.js'))(api);
require(path.resolve(__dirname, '..', 'beastform.js'))(api);

// The gamemode's own handler, with the hooks it reaches that live elsewhere stubbed
globalThis.__dboHandlers = globalThis.__dboHandlers || {};
globalThis.__dboNoteLogout = noop;
globalThis.__dboJournalOpen = new Map();
globalThis.__dboLoginWaits = new Map();
const connected = new Set();
new Function('actorOf', 'audit', 'who', 'log', 'connected', 'globalThis', disconnectSrc)(
  (userId) => (userId === U ? P : 0), api.audit, display, api.log, connected, globalThis);
const logout = () => { connected.add(U); globalThis.__dboHandlers.disconnect(U); runTimers(); };
const press = () => { said.length = 0; fakeNow += 2500; ui.get('maskToggle')(P); runTimers(); return said.join(' '); };
const fresh = () => {
  props.clear(); logs.length = 0; said.length = 0;
  props.set(`${P}|appearance`, { name: "Hatta'Kahu", raceId: NORD });
  props.set(`${P}|inventory`, { entries: [] });
};

// #LLX8: mask on, Beast Form, log out
fresh();
press();
ok(nameShown(P) === 'Masked Person' && mp.get(P, 'maskName') === "Hatta'Kahu", 'H masks: Masked Person shown, the real name kept', [nameShown(P), mp.get(P, 'maskName')]);
ok(globalThis.__dboBeastTransform(P, 'werewolf') === true && nameShown(P) === 'Werewolf', 'Beast Form while masked: the beast is named', nameShown(P));
ok((mp.get(P, 'private.beast').original || {}).name === 'Masked Person', '...and the look kept for the revert carries the mask name, as on the live server', mp.get(P, 'private.beast'));
logout();
ok(nameShown(P) === "Hatta'Kahu", 'logout in Beast Form while masked: the real name is back', nameShown(P));
ok(!mp.get(P, 'maskName'), '...with no mask left on', mp.get(P, 'maskName'));
ok(!mp.get(P, 'private.beast') && (mp.get(P, 'appearance') || {}).raceId === NORD, '...and the mortal race back, the beast state gone', mp.get(P, 'appearance'));
// The next session: H masks and unmasks as normal (it was refused for good on the live server)
said.length = 0;
let t = press();
ok(nameShown(P) === 'Masked Person' && mp.get(P, 'maskName') === "Hatta'Kahu" && !/lost behind/.test(t), 'next session: H masks again, keeping the real name', [nameShown(P), mp.get(P, 'maskName'), t]);
press();
ok(nameShown(P) === "Hatta'Kahu", '...and H takes it off again', nameShown(P));

// A crash: no logout ran, the beast state and the mask outlived the session; the login reverts the beast before it
// unmasks (onCharacterReady), and that order is kept
fresh();
press();
globalThis.__dboBeastTransform(P, 'werewolf');
globalThis.__dboBeastRevert(P, 'login');
globalThis.__dboPlayerMenuReady(P); runTimers();
ok(nameShown(P) === "Hatta'Kahu" && !mp.get(P, 'maskName'), 'a crash masked in Beast Form: the login gives the real name back', [nameShown(P), mp.get(P, 'maskName')]);
const ready = gm.slice(gm.indexOf('const onCharacterReady = '));
const iRevert = ready.indexOf("__dboBeastRevert(a, 'login')"), iReady = ready.indexOf('__dboPlayerMenuReady(a)');
ok(iRevert > 0 && iReady > iRevert, '...gamemode.js onCharacterReady reverts the beast before the mask comes off', [iRevert, iReady]);

// The plain cases are unchanged
fresh();
press(); logout();
ok(nameShown(P) === "Hatta'Kahu" && !mp.get(P, 'maskName'), 'a masked logout (no beast): the real name is back', nameShown(P));
fresh();
globalThis.__dboBeastTransform(P, 'werewolf'); logout();
ok(nameShown(P) === "Hatta'Kahu" && !mp.get(P, 'private.beast'), 'a Beast Form logout (no mask): the real name is back', nameShown(P));
// Death in Beast Form while masked: still masked after it, so H gives the name back
fresh();
press();
globalThis.__dboBeastTransform(P, 'werewolf');
globalThis.__dboBeastRevert(P, 'death'); runTimers();
ok(nameShown(P) === 'Masked Person' && mp.get(P, 'maskName') === "Hatta'Kahu", 'death in Beast Form while masked: still masked, the real name kept', [nameShown(P), mp.get(P, 'maskName')]);
press();
ok(nameShown(P) === "Hatta'Kahu", '...and H takes the mask off', nameShown(P));

Date.now = savedNow;
global.setTimeout = savedTimeout;
console.log(`${pass}/${pass + fail} passed`);
process.exitCode = fail ? 1 : 0;
