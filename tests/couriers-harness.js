// couriers.js (Nate, 11 Oct): courier jobs posted at a notice board, carried as one sealed parcel, delivered to a board,
// a settlement drop point or a person; insurance, robbery, expiry in world-clock game days, the protections and reload
// safety. Runs the real post.js beside it, against a fake mp. Scratch files in /dev/shm.
//   node tests/couriers-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const SERVER = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-couriers-'));
let failures = 0;
const check = (label, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const GOLD = 0xf, PARCEL = 0xdab04;
const SWORD = 0x12eb7, INGOT = 0x5ace4, KEY = 0x2000, DAGGER = 0x1397e;
const data32 = (v, at = 0, len = 8) => { const b = new Uint8Array(len); new DataView(b.buffer).setInt32(at, v, true); return b; };
const RECORDS = {
  [SWORD]: { type: 'WEAP', flags: 0, editorId: 'SteelSword', fields: [{ type: 'DATA', data: data32(45) }] },
  [DAGGER]: { type: 'WEAP', flags: 0, editorId: 'IronDagger', fields: [{ type: 'DATA', data: data32(10) }] },
  [INGOT]: { type: 'MISC', flags: 0, editorId: 'IngotSteel', fields: [{ type: 'DATA', data: data32(20) }] },
  [KEY]: { type: 'KEYM', flags: 0, editorId: 'HouseKey' },
  [PARCEL]: { type: 'MISC', flags: 0, editorId: 'FFI04Sack', fields: [{ type: 'DATA', data: data32(0) }] },
  [GOLD]: { type: 'MISC', flags: 0, editorId: 'Gold001' },
};
const NAMES = { [SWORD]: 'Steel Sword', [DAGGER]: 'Iron Dagger', [INGOT]: 'Steel Ingot' };
// S sends; K is a courier; R receives; T robs; ALT is the sender's own second character (same Discord); MATE is in K's party
const S = 0xff000101, K = 0xff000202, R = 0xff000303, T = 0xff000404, ALT = 0xff000505, MATE = 0xff000606;
const NAME = { [S]: 'Sela', [K]: 'Kor', [R]: 'Rin', [T]: 'Tav', [ALT]: 'Alt', [MATE]: 'Mate' };
const DISCORD = { [S]: 'd-s', [K]: 'd-k', [R]: 'd-r', [T]: 'd-t', [ALT]: 'd-s', [MATE]: 'd-m' };
const props = new Map();
const set = (id, k, v) => props.set(`${id >>> 0}|${k}`, JSON.parse(JSON.stringify(v)));
const get = (id, k) => { const v = props.get(`${id >>> 0}|${k}`); return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
const inv = (id) => (get(id, 'inventory') || { entries: [] }).entries;
const count = (id, base) => inv(id).reduce((n, e) => n + ((Number(e.baseId) >>> 0) === base ? Number(e.count) : 0), 0);
const named = (id, name) => inv(id).filter((e) => e.name === name).reduce((n, e) => n + e.count, 0);
const treasury = { bruma: 0 };
const told = [];
const audits = [];
let handlers = new Map();
const timers = new Map();
const widgets = [];
const closed = [];
const commands = new Map();
let board = 'bruma';
let online = [S, K, R, T, ALT, MATE];
const goneSet = new Set();
let clock = Date.now();
Date.now = () => clock;
const HOUR = 3600000;
// The world clock: timeScale 6, so a game day every 4 real hours
let gameDay0 = 100, clockOn = true;
const clockAt0 = clock;
const setClock = () => { globalThis.__dboClock = clockOn ? { gameDays: () => gameDay0 + (Date.now() - clockAt0) * 6 / 86400000, summary: () => ({ timeScale: 6 }) } : null; };
setClock();
globalThis.__dboFormGone = (id) => goneSet.has(id >>> 0);
globalThis.__dboPartyLeaderOf = (a) => (a === K || a === MATE ? K : null);
let guilds = {};
globalThis.__dboGuildsOf = (a) => (guilds[a] || []).map((id) => ({ id }));
// The bank's treasury (bank.js __dboTreasuryZone)
globalThis.__dboTreasuryZone = {
  balance: (z) => treasury[z] || 0,
  deposit: (z, n) => { treasury[z] = (treasury[z] || 0) + n; return n; },
  spend: (z, n) => { if ((treasury[z] || 0) < n) return false; treasury[z] -= n; return true; },
};

const cfg = {
  post: { goldOnly: true },
  playtest: { enabled: true, allowedWorlds: ['a764b:BSHeartland.esm'] },
  couriers: {
    enabled: true, parcelItem: 'dab04:Skyrim.esm', minFee: 10, feeShare: 0.1, premiumRate: 0.1, maxPayoutsPerWeek: 2, robChance: 0.5,
    limitGameDays: 3, maxOpen: 5,
    places: [], lockZones: ['bruma'],
    dropPoints: [{ id: 'aleswell', name: 'Aleswell', hint: 'at the door of the Aleswell Inn', zone: 'bruma', world: 'a764b:BSHeartland.esm', pos: [64227.91, 156549.83, -4624.79] }],
  },
};
const ZONES = { bruma: { id: 'bruma', name: 'Bruma', treasury: 'x:Skyrim.esm' }, whiterun: { id: 'whiterun', name: 'Whiterun', treasury: 'y:Skyrim.esm' } };
const api = {
  mp: { get, set, getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`, getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0 },
  log: () => {}, personal: (a, t) => told.push([a >>> 0, t]), audit: (t) => audits.push(t), who: (a) => `who${(a >>> 0).toString(16)}`,
  nameOf: (a) => NAME[a >>> 0] || 'X', tagOf: (a) => (NAME[a >>> 0] || 'X').toUpperCase(),
  profileOf: (a) => (a === ALT ? 0x101 : a & 0xfff), discordOf: (a) => DISCORD[a >>> 0] || '',
  onlineActors: () => online.slice(), every: (name, ms, fn) => timers.set(name, fn), cfg, onUi: (ev, fn) => { const l = handlers.get(ev) || []; l.push(fn); handlers.set(ev, l); },
  takeGold: (a, n) => { const g = count(a, GOLD); if (g < n) return false; const e = inv(a).map((x) => ((x.baseId >>> 0) === GOLD ? Object.assign({}, x, { count: x.count - n }) : x)).filter((x) => x.count > 0); set(a, 'inventory', { entries: e }); return true; },
  giveItem: (a, base, n) => { const e = inv(a); const h = e.find((x) => (x.baseId >>> 0) === base && Object.keys(x).length === 2); if (h) h.count += n; else e.push({ baseId: base, count: n }); set(a, 'inventory', { entries: e }); return true; },
  goldOf: (a) => count(a, GOLD), GOLD_BASE: GOLD,
  recordOf: (id) => (RECORDS[id >>> 0] ? { record: RECORDS[id >>> 0] } : null),
  depositToTreasury: (z, n) => globalThis.__dboTreasuryZone.deposit(z, n),
  zoneById: (id) => ZONES[String(id)] || null, zoneList: () => Object.values(ZONES),
  boardZoneNear: () => board,
  lettersOf: (a) => (get(a, 'private.pigeons') || []),
  saveLetters: (a, list) => set(a, 'private.pigeons', list),
  sendMailState: () => {},
  itemName: (desc) => NAMES[parseInt(desc, 16)] || '',
  metOf: (a) => [S, K, R, T, ALT, MATE].filter((x) => x !== a), isAdmin: () => false,
  registerChatCommand: (name, fn, opts) => commands.set(name, { fn, opts }),
  openWidget: (a, w, focus) => widgets.push({ a: a >>> 0, w, focus }), closeWidget: (a, id) => closed.push({ a: a >>> 0, id }),
};
process.chdir(TMP);
fs.writeFileSync('admin-items.json', JSON.stringify({ categories: [{ items: [] }] }));
const load = () => {
  handlers = new Map();
  for (const f of ['post.js', 'couriers.js']) { delete require.cache[path.join(SERVER, f)]; require(path.join(SERVER, f))(api); }
  return globalThis.__dboCourierApi;
};
let CA = load();
globalThis.__dboPigeonNonces = new Map([[S, 'nS'], [K, 'nK'], [R, 'nR'], [T, 'nT'], [ALT, 'nA'], [MATE, 'nM']]);
let opened = [];
globalThis.__dboOpenPigeonCoop = (a, text, kind, view) => opened.push({ a, text, kind, view });
const ui = (ev, a, ...args) => { opened = []; for (const fn of handlers.get(ev) || []) fn(a, [globalThis.__dboPigeonNonces.get(a), ...args]); return opened[0] || {}; };
const rawUi = (ev, a, args, widgetId) => { for (const fn of handlers.get(ev) || []) fn(a, args, widgetId); };
const jobs = () => JSON.parse(fs.readFileSync(path.join(TMP, 'couriers.json'), 'utf8')).jobs;
const job = (id) => jobs().find((j) => j.id === id);
const at = (a, where, pos) => { set(a, 'worldOrCellDesc', where); set(a, 'pos', pos); };
const lettersFor = (a) => get(a, 'private.pigeons') || [];
const reset = () => {
  for (const k of [...props.keys()]) if (!k.endsWith('|private.pigeons')) props.delete(k);
  for (const a of [S, K, R, T, ALT, MATE]) { set(a, 'private.pigeons', []); at(a, 'a764b:bsheartland.esm', [0, 0, 0]); }
  set(S, 'inventory', { entries: [{ baseId: GOLD, count: 2000 }, { baseId: SWORD, count: 4 }, { baseId: INGOT, count: 10 }, { baseId: DAGGER, count: 1, worn: true }, { baseId: KEY, count: 1 }] });
  set(K, 'inventory', { entries: [{ baseId: GOLD, count: 10 }] });
  set(R, 'inventory', { entries: [{ baseId: GOLD, count: 0 }] });
  set(T, 'inventory', { entries: [{ baseId: GOLD, count: 0 }] });
  set(ALT, 'inventory', { entries: [{ baseId: GOLD, count: 0 }] });
  set(MATE, 'inventory', { entries: [{ baseId: GOLD, count: 0 }] });
  told.length = 0; audits.length = 0;
};
const lastId = () => Math.max(...jobs().map((j) => j.id));

// ---- the boot and the view ----
reset();
const v = CA.view(S).courier;
check('the view: enabled, at the Bruma board', v && v.enabled && v.place === 'Bruma', v);
check('under the region lock: Whiterun\'s boards are not offered, the Aleswell drop point and in person are', v.destinations.map((d) => d.key).join(',') === 'drop:aleswell,person', v.destinations);
check('the goods list leaves out worn things and keys, and shows base values', v.goods.some((g) => g.baseId === SWORD && g.count === 4 && g.value === 45) && !v.goods.some((g) => g.baseId === DAGGER || g.baseId === KEY), v.goods);
check('the rules carry the limit in game days', v.rules.limitGameDays === 3, v.rules);
check('off in the config: nothing in the coop window', (() => { cfg.couriers.enabled = false; const r = load().view(S); cfg.couriers.enabled = true; CA = load(); return Object.keys(r).length === 0; })());
cfg.playtest.enabled = false; CA = load();
check('without the region lock another hold\'s boards are a destination', CA.view(S).courier.destinations.some((d) => d.key === 'board:whiterun'));
cfg.playtest.enabled = true; CA = load();

// ---- posting ----
reset();
let r = ui('courierPost', S, 'drop:aleswell', R, 100, 0, JSON.stringify([[SWORD, 2], [INGOT, 5]]));
let id = lastId();
check('post a job: refused text none, sent kind', r.kind === 'sent' && r.view === 'courier', r);
check('the goods leave the sender\'s pack', count(S, SWORD) === 2 && count(S, INGOT) === 5);
check('the pay and a fee of 10 (10% of 100, at least 10) are taken', count(S, GOLD) === 2000 - 110, count(S, GOLD));
check('the fee goes to the Bruma treasury', treasury.bruma === 10, treasury);
check('the job is written: open, held pay 100, the goods worth 190', job(id).state === 'open' && job(id).held === 100 && job(id).value === 190, job(id));
check('a job may not go to the sender in person', ui('courierPost', S, 'person', S, 50, 0, JSON.stringify([[INGOT, 1]])).kind === 'refused');
check('no more than 6 kinds', ui('courierPost', S, 'person', R, 50, 0, JSON.stringify([[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1]])).kind === 'refused');
check('a worn dagger cannot go', /Iron Dagger|not wearing/.test(ui('courierPost', S, 'person', R, 50, 0, JSON.stringify([[DAGGER, 1]])).text || ''));
check('a key cannot go', ui('courierPost', S, 'person', R, 50, 0, JSON.stringify([[KEY, 1]])).kind === 'refused');
check('the parcel item itself cannot go', ui('courierPost', S, 'person', R, 50, 0, JSON.stringify([[PARCEL, 1]])).kind === 'refused');
check('a Whiterun board is refused under the lock', ui('courierPost', S, 'board:whiterun', R, 50, 0, JSON.stringify([[INGOT, 1]])).kind === 'refused');
check('insurance above the goods\' base value is refused', /worth 20 gold at most/.test(ui('courierPost', S, 'person', R, 50, 21, JSON.stringify([[INGOT, 1]])).text || ''));
check('a pay of 0 is refused', ui('courierPost', S, 'person', R, 0, 0, JSON.stringify([[INGOT, 1]])).kind === 'refused');
check('nothing changed after the refusals', count(S, INGOT) === 5 && count(S, GOLD) === 1890 && treasury.bruma === 10);
r = ui('courierPost', S, 'person', R, 30, 90, JSON.stringify([[SWORD, 2]]));
const pid = lastId();
check('an insured job in person: pay 30 + fee 10 + premium 9 (10% of 90)', r.kind === 'sent' && count(S, GOLD) === 1890 - 49 && treasury.bruma === 29 && job(pid).premium === 9 && job(pid).insured === 90, [r, count(S, GOLD), treasury]);

// ---- taking a job ----
check('the sender cannot carry their own parcel', ui('courierTake', S, id).kind === 'refused');
check('nor their second character (same Discord)', ui('courierTake', ALT, id).kind === 'refused');
r = ui('courierTake', K, id);
check('the courier takes it and gets ONE sealed parcel, named', r.kind === 'sent' && count(K, PARCEL) === 1 && named(K, 'Sealed Courier\'s Parcel') === 1, [r, inv(K)]);
check('the job is carried, due in 3 game days by the world clock', job(id).state === 'carried' && Math.abs(job(id).dueDay - (globalThis.__dboClock.gameDays() + 3)) < 1e-6, job(id));
check('and in the view: carrying, 72 game hours, 12 real hours left', (() => { const c = CA.view(K).courier.carrying[0]; return c && c.gameHoursLeft === 72 && c.hoursLeft === 12; })(), CA.view(K).courier.carrying);
check('the open list no longer shows it', !CA.view(T).courier.open.some((o) => o.id === id));

// ---- protections ----
check('__dboCourierMove refuses giving up the sealed copy (drop, put, trade)', typeof globalThis.__dboCourierMove(K, PARCEL, 1) === 'string');
check('...but not other things', globalThis.__dboCourierMove(K, GOLD, 1) === null);
check('__dboCourierSealed counts it for robbery.js and pickpocket.js', globalThis.__dboCourierSealed(K, PARCEL) === 1 && globalThis.__dboCourierSealed(K, SWORD) === 0);
check('a spare copy beyond the sealed ones may move', (() => { api.giveItem(K, PARCEL, 1); const ok = globalThis.__dboCourierMove(K, PARCEL, 1) === null && typeof globalThis.__dboCourierMove(K, PARCEL, 2) === 'string'; const e = inv(K).filter((x) => !(x.baseId === PARCEL && !x.name)); set(K, 'inventory', { entries: e }); return ok; })());
{
  // itemguards.js asks __dboCourierMove for drop and put
  const IG = path.join(SERVER, 'itemguards.js');
  delete require.cache[IG]; delete globalThis.__dboItemGuards;
  const mpg = { get: (a, k) => get(a, k) };
  const gt = [];
  require(IG)({ mp: mpg, log: () => {}, who: () => 'P', personal: (a, t) => gt.push([a, t]), recordOf: api.recordOf, cfg: {} });
  check('itemguards: the sealed parcel cannot be dropped', mpg.onDropItem(K, PARCEL, 1) === false);
  check('itemguards: nor put in a container or rack', mpg.onPutItem(0x5000, K, PARCEL, 1) === false);
  check('itemguards: the courier is told why', gt.length === 1 && /stays with you/.test(gt[0][1]), gt);
  check('itemguards: gold still drops', mpg.onDropItem(K, GOLD, 1) !== false);
  delete globalThis.__dboItemGuards; delete globalThis.__dboTakeGuard; delete require.cache[IG];
}
{
  // gamemode.js __dboTradeItemVeto, cut out of the file
  const src = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
  const m = src.match(/globalThis\.__dboTradeItemVeto = \(a, baseId, count\) => \{[\s\S]*?\n\};/);
  check('gamemode.js carries the trade veto', !!m);
  if (m) {
    // eslint-disable-next-line no-new-func
    new Function(m[0])();
    check('trade: the sealed parcel is held back', typeof globalThis.__dboTradeItemVeto(K, PARCEL, 1) === 'string');
    check('trade: gold is not', globalThis.__dboTradeItemVeto(K, GOLD, 5) === null);
    delete globalThis.__dboTradeItemVeto;
  }
}
check('the pickpocket and rob takes subtract the sealed parcels (pickpocket.js, robbery.js)', /__dboCourierSealed\(t, id\)/.test(fs.readFileSync(path.join(SERVER, 'pickpocket.js'), 'utf8')) && /- sealed\(id\)/.test(fs.readFileSync(path.join(SERVER, 'robbery.js'), 'utf8')));

// ---- delivery at a drop point ----
handlers.get('uiCaps').forEach((fn) => fn(K, ['courierHandover']));
widgets.length = 0;
timers.get('courierDrops')();
check('far from Aleswell: nothing asked', widgets.length === 0);
r = ui('courierDeliver', K, id);
check('the board refuses a drop-point parcel', r.kind === 'refused' && /Aleswell/.test(r.text), r);
at(K, 'a764b:bsheartland.esm', [64227.91 + 300, 156549.83, -4624.79]);
timers.get('courierDrops')();
const dw = widgets.find((w) => w.a === K && w.w.type === 'courierHandover');
check('standing at Aleswell: the hand-in panel (widget 81) lists the parcel', dw && dw.w.id === 81 && dw.w.mode === 'drop' && dw.w.jobs.length === 1 && dw.w.jobs[0].id === id, widgets);
widgets.length = 0; timers.get('courierDrops')();
check('...asked once, not every 2 s', widgets.length === 0);
rawUi('courierDismiss', K, [dw.w.nonce]);
check('Not now closes the panel', closed.some((c) => c.a === K && c.id === 81));
widgets.length = 0; clock += 61000; timers.get('courierDrops')();
check('...and it is not asked again a minute later while still there', widgets.length === 0);
clock += 600000; timers.get('courierDrops')();
const dw2 = widgets.find((w) => w.a === K && w.w.type === 'courierHandover');
check('...but after ten minutes it is', !!dw2);
dw.w.nonce = dw2 ? dw2.w.nonce : dw.w.nonce;
rawUi('courierDropIn', K, ['wrong', id]);
check('a wrong nonce does nothing', job(id).state === 'carried');
rawUi('courierDropIn', K, [dw.w.nonce, id]);
check('delivered: the courier is paid 100 and loses the parcel', job(id).state === 'delivered' && count(K, GOLD) === 110 && count(K, PARCEL) === 0, [job(id), inv(K)]);
const rl = lettersFor(R).find((l) => l.parcel && l.parcel.items.length);
check('the goods wait in the recipient\'s mailbox, from the Bruma board', rl && rl.from === 'The Bruma notice board' && rl.parcel.items.reduce((n, t) => n + t.count, 0) === 7, lettersFor(R));
check('the sender hears of it', lettersFor(S).some((l) => /delivered by Kor/.test(l.text)));
check('the protection ends with the job', globalThis.__dboCourierMove(K, PARCEL, 1) === null);

// ---- in person ----
reset();
set(K, 'inventory', { entries: [{ baseId: GOLD, count: 0 }] });
ui('courierTake', K, pid);
check('the in-person job is taken', job(pid).state === 'carried' && count(K, PARCEL) === 1);
at(R, 'a764b:bsheartland.esm', [1000, 0, 0]);
check('no Hand over entry when the recipient is far', globalThis.__dboCourierEntries(K, R).length === 0);
at(R, 'a764b:bsheartland.esm', [250, 0, 0]);
check('Hand over within 300 units', globalThis.__dboCourierEntries(K, R).length === 1);
check('no entry on someone else', globalThis.__dboCourierEntries(K, T).length === 0);
handlers.get('uiCaps').forEach((fn) => fn(R, ['courierHandover']));
widgets.length = 0;
globalThis.__dboCourierAction(K, 'courierHand', R, () => 'Kor');
const pw = widgets.find((w) => w.a === R && w.w.type === 'courierHandover');
check('the recipient gets the accept panel', pw && pw.w.mode === 'person' && pw.focus === true, widgets);
rawUi('courierAnswer', R, [pw.w.nonce, 'take']);
check('accepted: the goods go into the recipient\'s pack', count(R, SWORD) === 2 && job(pid).state === 'delivered' && job(pid).inPack === true, [inv(R), job(pid)]);
check('the courier is paid 30', count(K, GOLD) === 30);
// a recipient without the panel: the mailbox
reset();
set(K, 'inventory', { entries: [{ baseId: GOLD, count: 0 }] });
ui('courierPost', S, 'person', T, 20, 0, JSON.stringify([[INGOT, 2]]));
let qid = lastId();
ui('courierTake', K, qid);
at(T, 'a764b:bsheartland.esm', [100, 0, 0]);
globalThis.__dboCourierAction(K, 'courierHand', T, () => 'Kor');
check('no panel on the recipient\'s UI: straight to their mailbox', job(qid).state === 'delivered' && count(T, INGOT) === 0 && lettersFor(T).some((l) => l.parcel && l.parcel.items.length), job(qid));
// no answer in time: the mailbox
reset();
ui('courierPost', S, 'person', R, 20, 0, JSON.stringify([[INGOT, 2]]));
qid = lastId();
ui('courierTake', K, qid);
at(R, 'a764b:bsheartland.esm', [100, 0, 0]);
widgets.length = 0;
globalThis.__dboCourierAction(K, 'courierHand', R, () => 'Kor');
clock += 31000; timers.get('courierDrops')();
check('no answer in 30 s: the mailbox', job(qid).state === 'delivered' && count(R, INGOT) === 0 && lettersFor(R).some((l) => l.parcel), job(qid));

// ---- expiry in game days ----
reset();
ui('courierPost', S, 'drop:aleswell', R, 100, 0, JSON.stringify([[SWORD, 1]]));
qid = lastId();
ui('courierTake', K, qid);
clock += 11 * HOUR; timers.get('courierSweep')();
check('11 real hours (2.75 game days): still carried', job(qid).state === 'carried');
clock += 1.1 * HOUR; timers.get('courierSweep')();
check('past 3 game days: expired, the parcel taken back', job(qid).state === 'expired' && count(K, PARCEL) === 0, [job(qid), inv(K)]);
check('the goods and the pay go back to the sender\'s mailbox', lettersFor(S).some((l) => l.parcel && l.parcel.gold === 100 && l.parcel.items.length === 1));
check('the courier is told, and unpaid', told.some(([a, t]) => a === K && /run out/.test(t)) && count(K, GOLD) === 10);
// the limit follows a changed timescale: a /settime jump of the clock counts
reset();
ui('courierPost', S, 'drop:aleswell', R, 100, 0, JSON.stringify([[SWORD, 1]]));
qid = lastId();
ui('courierTake', K, qid);
gameDay0 += 3.01; timers.get('courierSweep')();
check('the world clock moved on 3 game days: expired at once', job(qid).state === 'expired');
gameDay0 -= 3.01;
// without the world clock: the real-time fallback (4 real hours a game day)
reset();
clockOn = false; setClock();
ui('courierPost', S, 'drop:aleswell', R, 100, 0, JSON.stringify([[SWORD, 1]]));
qid = lastId();
ui('courierTake', K, qid);
check('no clock: no game day, a real due time 12 h on', job(qid).dueDay === null && job(qid).dueAt === clock + 12 * HOUR, job(qid));
clock += 12 * HOUR + 1; timers.get('courierSweep')();
check('no clock: expired after 12 real hours', job(qid).state === 'expired');
clockOn = true; setClock();
// an open job nobody takes lapses after openDays (real days)
reset();
ui('courierPost', S, 'drop:aleswell', R, 100, 0, JSON.stringify([[SWORD, 1]]));
qid = lastId();
clock += 7 * 24 * HOUR + 1; timers.get('courierSweep')();
check('an open job no courier took lapses, back to the sender', job(qid).state === 'lapsed' && lettersFor(S).some((l) => l.parcel && l.parcel.gold === 100));

// ---- robbery and insurance ----
const robWith = (robber, victim, roll) => { const real = Math.random; Math.random = () => roll; try { return globalThis.__dboCourierRobbed(robber, victim); } finally { Math.random = real; } };
const insuredJob = (value) => { ui('courierPost', S, 'drop:aleswell', R, 50, value, JSON.stringify([[SWORD, 2]])); const n = lastId(); ui('courierTake', K, n); return n; };
reset();
treasury.bruma = 1000;
let rid = insuredJob(90);
check('a robbery above robChance takes no parcel', robWith(T, K, 0.9) === null && job(rid).state === 'carried');
const before = treasury.bruma;
check('below robChance: the parcel is taken', robWith(T, K, 0.1) === 'a sealed courier\'s parcel');
check('the robber holds a Broken Courier\'s Parcel, the courier nothing', named(T, 'Broken Courier\'s Parcel') === 1 && count(K, PARCEL) === 0, [inv(T), inv(K)]);
check('the broken parcel is not protected', globalThis.__dboCourierMove(T, PARCEL, 1) === null);
check('the job is robbed, the courier unpaid', job(rid).state === 'robbed' && count(K, GOLD) === 10);
check('the insurance pays the sender 90 from the Bruma treasury', treasury.bruma === before - 90 && lettersFor(S).some((l) => l.parcel && l.parcel.gold === 90), treasury);
check('the sender also gets the pay back and is told', lettersFor(S).some((l) => /robbed on the road/.test(l.text) && l.parcel && l.parcel.gold === 50));
r = ui('courierOpen', T, rid);
check('the robber opens it at a board for the goods', r.kind === 'sent' && count(T, SWORD) === 2 && count(T, PARCEL) === 0 && job(rid).state === 'opened', [r, inv(T)]);
// anti-fraud
reset(); treasury.bruma = 1000;
rid = insuredJob(90);
robWith(ALT, K, 0.1);
check('no payout when the robber shares a Discord with the sender', job(rid).state === 'robbed' && !job(rid).payout && treasury.bruma === 1000 + 10 + 9, [job(rid), treasury]);
reset(); treasury.bruma = 1000;
rid = insuredJob(90);
robWith(MATE, K, 0.1);
check('no payout when the robber is in the courier\'s party', job(rid).state === 'robbed' && !job(rid).payout);
reset(); treasury.bruma = 1000;
rid = insuredJob(90);
robWith(R, K, 0.1);
check('no payout when the robber is the recipient', job(rid).state === 'robbed' && !job(rid).payout);
reset(); treasury.bruma = 1000;
guilds = { [T]: ['g1'], [K]: ['g1'] };
rid = insuredJob(90);
robWith(T, K, 0.1);
check('no payout when the robber shares a faction with the courier', job(rid).state === 'robbed' && !job(rid).payout);
guilds = {};
// the weekly cap (2 a week per sender account): one paid above, two more now
reset(); treasury.bruma = 1000;
rid = insuredJob(90); robWith(T, K, 0.1);
check('the second payout this week is paid', job(rid).payout === 90);
reset(); treasury.bruma = 1000;
rid = insuredJob(90); robWith(T, K, 0.1);
check('the third this week is not (maxPayoutsPerWeek 2)', !job(rid).payout && audits.some((t) => /2 payouts this week/.test(t)), audits.slice(-3));
clock += 7 * 24 * HOUR + 1;
reset(); treasury.bruma = 1000;
rid = insuredJob(90); robWith(T, K, 0.1);
check('a week later it pays again', job(rid).payout === 90);
// bounded by the treasury
reset(); treasury.bruma = 0;
rid = insuredJob(90);
// the fee and premium just went in: 10 + 9 = 19
robWith(T, K, 0.1);
check('the payout is bounded by the treasury (19 held of 90)', job(rid).payout === 19 && treasury.bruma === 0, [job(rid), treasury]);
// a robbed parcel never opened goes back after brokenDays (lost when insurance paid)
reset(); treasury.bruma = 0;
ui('courierPost', S, 'drop:aleswell', R, 50, 0, JSON.stringify([[INGOT, 3]]));
rid = lastId(); ui('courierTake', K, rid); robWith(T, K, 0.1);
clock += 7 * 24 * HOUR + 1; timers.get('courierSweep')();
check('an uninsured robbed parcel never opened comes back to the sender', job(rid).state === 'recovered' && lettersFor(S).some((l) => l.parcel && l.parcel.items.some((t) => t.baseId === INGOT)));
check('...and the robber\'s broken copy is taken away', named(T, 'Broken Courier\'s Parcel') === 0, inv(T));
check('...and opening it after that is refused', ui('courierOpen', T, rid).kind === 'refused');

// ---- robbery.js lists and takes the parcel ----
{
  reset();
  ui('courierPost', S, 'drop:aleswell', R, 50, 0, JSON.stringify([[INGOT, 3]]));
  rid = lastId(); ui('courierTake', K, rid);
  const RB = path.join(SERVER, 'robbery.js');
  delete require.cache[RB]; delete globalThis.__dboRobbery;
  const rh = new Map();
  require(RB)({ mp: { get, set, getDescFromId: api.mp.getDescFromId }, log: () => {}, personal: api.personal, audit: api.audit, who: api.who,
    onlineActors: api.onlineActors, recordOf: api.recordOf, adminItemName: () => '', openWidget: api.openWidget, closeWidget: api.closeWidget,
    onUi: (ev, fn) => rh.set(ev, fn), sendPacket: () => {}, every: () => {}, cfg: {} });
  rh.get('uiCaps')(K, ['robPrompt']);
  globalThis.__dboPartyLeaderOf = () => null;
  const entry = globalThis.__dboRobEntries(T, K);
  check('the rob menu shows the courier carries a parcel', entry.length === 1 && /courier/.test(entry[0].label), entry);
  widgets.length = 0;
  globalThis.__dboRobAction(T, 'rob', K, () => 'Someone');
  const rw = widgets.find((w) => w.w.type === 'robPrompt');
  check('the victim\'s rob panel says how many parcels they carry', rw && rw.w.parcels === 1, rw);
  const real = Math.random; Math.random = () => 0.1;
  rh.get('robAnswer')(K, [rw.w.nonce, 'accept']);
  Math.random = real;
  check('accepting a robbery hands the parcel over broken (robChance)', job(rid).state === 'robbed' && named(T, 'Broken Courier\'s Parcel') === 1 && named(K, 'Sealed Courier\'s Parcel') === 0, [job(rid), inv(T)]);
  check('the robbery\'s message names it', told.some(([a, t]) => a === T && /courier's parcel/.test(t)));
  globalThis.__dboPartyLeaderOf = (a) => (a === K || a === MATE ? K : null);
  delete require.cache[RB];
}

// ---- cancel, the staff command, a gone sender ----
reset();
ui('courierPost', S, 'drop:aleswell', R, 50, 0, JSON.stringify([[INGOT, 3]]));
qid = lastId();
check('only the sender takes a job down', ui('courierCancel', K, qid).kind === 'refused');
r = ui('courierCancel', S, qid);
check('taken down: the goods and the pay to the mailbox, the fee kept', r.kind === 'sent' && job(qid).state === 'cancelled' && lettersFor(S).some((l) => l.parcel && l.parcel.gold === 50));
ui('courierPost', S, 'drop:aleswell', R, 50, 0, JSON.stringify([[INGOT, 3]]));
qid = lastId(); ui('courierTake', K, qid);
check('the staff command is admin-only', commands.get('couriers').opts.admin === true);
told.length = 0; commands.get('couriers').fn(T, '');
check('the staff list shows the carried job', told.some(([, t]) => new RegExp(`#${qid} carried`).test(t)), told);
commands.get('couriers').fn(T, `clear ${qid}`);
check('clear: the parcel back from the courier, the goods to the sender', job(qid).state === 'cleared' && count(K, PARCEL) === 0 && lettersFor(S).some((l) => /cleared by the staff/.test(l.text)));
ui('courierPost', S, 'drop:aleswell', R, 50, 0, JSON.stringify([[INGOT, 3]]));
qid = lastId(); ui('courierTake', K, qid);
goneSet.add(K); timers.get('courierSweep')(); goneSet.delete(K);
check('a courier who is gone (permadeath): the goods go back', job(qid).state === 'returned');

// ---- reload safety ----
reset();
ui('courierPost', S, 'drop:aleswell', R, 50, 0, JSON.stringify([[INGOT, 3]]));
qid = lastId(); ui('courierTake', K, qid);
CA = load(); CA = load();
check('after two reloads the job is still carried and protected', job(qid).state === 'carried' && typeof globalThis.__dboCourierMove(K, PARCEL, 1) === 'string');
check('...and a ui event has exactly one courier handler', (handlers.get('courierTake') || []).length === 1);
const before2 = count(K, GOLD);
at(K, 'a764b:bsheartland.esm', [64227.91, 156549.83, -4624.79]);
told.length = 0;
commands.get('courier').fn(K, 'deliver');
check('the chat fallback hands it in at the drop point', job(qid).state === 'delivered' && count(K, GOLD) === before2 + 50);
fs.writeFileSync(path.join(TMP, 'couriers.json'), '{ not json');
CA = load();
check('an unreadable couriers.json turns couriers off and is never overwritten', CA.enabled() === false && fs.readFileSync(path.join(TMP, 'couriers.json'), 'utf8') === '{ not json');
check('...and posting is refused', ui('courierPost', S, 'drop:aleswell', R, 50, 0, JSON.stringify([[INGOT, 1]])).kind === 'refused');

console.log('');
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* scratch */ }
console.log(failures ? `${failures} FAILURES` : 'all checks passed');
process.exit(failures ? 1 : 0);
