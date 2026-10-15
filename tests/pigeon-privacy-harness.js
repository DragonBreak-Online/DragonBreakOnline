// The pigeon coop and the ledger tell nobody where a contact is, nor that they are about unless both chose so (security
// audit 15 Oct, L2-2). The flight fee was 5 gold plus 10 a km to wherever the recipient stood (indoors: where they last
// stood outside; offline: where they logged out), listed for every contact, so the fees read at three boards fixed their
// spot; and anyone met once, even forgotten, saw "In the land" for them. This cuts the pigeon code out of gamemode.js and
// runs it, with the real ledger.js beside it, on dummy actors at dummy places.
//   node tests/pigeon-privacy-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const GM = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const SHIPPED = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
let fails = 0;
const ok = (what, c, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const slice = (from, to) => { const i = GM.indexOf(from); const j = i < 0 ? -1 : GM.indexOf(to, i + from.length); return i < 0 || j < 0 ? null : GM.slice(i, j); };
const parts = [slice('const PIGEON_COOLDOWN_MS', 'const takeGold = '), slice('const sendPigeon = (a, to, rawText', "registerChatCommand('pigeonblock'")];
if (parts.some((p) => !p)) { console.log('FAIL the pigeon code is gone from gamemode.js'); process.exit(1); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pigeon-privacy-'));
const home = process.cwd();
process.chdir(dir);   // pigeon-cooldowns.json and ledger-points.json are read here, never a real one

// ---- the dummy world: one board at the origin, the viewer V, the one they look up T, and a third F -------------------
const TAMRIEL = '3c:skyrim.esm', SOLSTHEIM = '800:dragonborn.esm', HOUSE = '16000:skyrim.esm';
const V = 0xff000001, T = 0xff000002, F = 0xff000003, GOLD = 0xf;
const names = { [V]: 'Vel Andras', [T]: 'Tova Hale', [F]: 'Fen Ash' };
const tags = { [V]: 'VVV1', [T]: 'TTT1', [F]: 'FFF1' };
const props = new Map();
const mp = {
  get: (id, k) => { const key = `${id}|${k}`; return props.has(key) ? JSON.parse(JSON.stringify(props.get(key))) : undefined; },
  set: (id, k, v) => props.set(`${id}|${k}`, JSON.parse(JSON.stringify(v))),
  getIdFromDesc: () => 0, getDescFromId: () => '',
};
const place = (id, world, pos) => { mp.set(id, 'worldOrCellDesc', world); mp.set(id, 'pos', pos); };
for (const a of [V, T, F]) { mp.set(a, 'appearance', { name: names[a] }); place(a, TAMRIEL, [0, 0, 0]); }
let online = [V, T, F];
let atBoard = new Set([V, T, F]);
const purse = new Map([[V, 1000], [T, 1000], [F, 1000]]);
const letters = new Map();
const widgets = [];
const ticks = new Map();
const api = {
  mp, console, UNITS_PER_METER: 70, GOLD_BASE: GOLD, PIGEON_WIDGET_ID: 34,
  cfg: { rangesMeters: { say: 20 }, pigeons: SHIPPED.pigeons },
  normPlace: (w) => String(w || '').toLowerCase(), TAMRIEL_FRAME: new Set([TAMRIEL]), isWorldspace: (w) => [TAMRIEL, SOLSTHEIM].includes(String(w).toLowerCase()),
  log: () => {}, audit: () => {}, personal: () => {}, saveSoon: () => {}, every: (n, ms, fn) => ticks.set(n, fn),
  onlineActors: () => online.slice(), isAdmin: () => false, profileOf: (a) => a & 0xffff,
  ownNameOf: (a) => names[a], nameOf: (a) => names[a], tagOf: (a) => tags[a], who: (a) => names[a], ownDisplay: (a) => `${names[a]} #${tags[a]}`,
  disguisedOf: () => false, boardZoneNear: (a) => (atBoard.has(a) ? 'whiterun' : null), zoneById: (id) => ({ id, name: 'Whiterun' }),
  openWidget: (a, w) => { widgets.push({ a, w }); return true; }, closeWidget: () => true, sendMailState: () => {},
  pigeonNonces: new Map(), nextSignature: new Map(), FORGE: { tellChance: {} },
  lettersOf: (a) => (letters.get(a) || []).slice(), saveLetters: (a, box) => letters.set(a, box.slice()), pigeonsWaiting: () => 0,
  goldOf: (a) => purse.get(a) || 0, adminItemName: () => '', depositToTreasury: (z, n) => n,
  takeGold: (a, n) => { if ((purse.get(a) || 0) < n) return false; purse.set(a, purse.get(a) - n); return true; },
  giveItem: (a, base, n) => { purse.set(a, (purse.get(a) || 0) + n); return true; },
};
const ctx = vm.createContext(Object.assign({ fs, path, Math, JSON, Date, Number, String, Array, Object, Map, Set, Error }, api));
vm.runInContext(`${parts.join('\n')}
globalThis.__t = { openPigeonCoop, sendPigeon, metOf, forgetMet, pigeonLastSent,
  presenceShown: typeof presenceShown === 'function' ? presenceShown : null,
  togglePresenceShare: typeof togglePresenceShare === 'function' ? togglePresenceShare : null };`, ctx);
const G = ctx.__t;
// What V's coop window lists for a contact: open it at the board, read the last widget
const coopRow = (viewer, id) => { G.openPigeonCoop(viewer); const w = widgets[widgets.length - 1]; return ((w && w.w.contacts) || []).find((c) => c.id === id) || null; };

// ---- the real ledger.js, given what gamemode.js gives it -----------------------------------------------------------
const lcmd = {}; const lsaid = [];
globalThis.__dboGuildsOf = () => [];
require(path.join(ROOT, 'ledger.js'))(Object.assign({}, api, {
  personal: (a, t) => lsaid.push([a, t]), registerChatCommand: (n, f) => { lcmd[n] = f; },
  metOf: G.metOf, forgetMet: G.forgetMet, sendPigeon: G.sendPigeon, zoneOfActor: () => ({ id: 'whiterun' }), cfg: {},
  presenceShown: G.presenceShown, togglePresenceShare: G.togglePresenceShare,
}));
const ledger = (a, args) => { lsaid.length = 0; lcmd.ledger(a, args); return lsaid.filter((x) => x[0] === a).map((x) => x[1]).join('\n'); };
ok('gamemode.js hands the ledger the presence check and the share switch',
  /require\(LEDGER_JS\)\(\{[^}]*\bpresenceShown\b[^}]*\btogglePresenceShare\b[^}]*\}\)/.test(GM));

// ---- 1. they meet: one 5 s tick side by side at the board ------------------------------------------------------------
ticks.get('meet')();
ok('one meeting writes each into the others\' contacts', [V, T, F].every((a) => G.metOf(a).length === 2), [V, T, F].map((a) => G.metOf(a).length));

// ---- 2. the flight fee is the same wherever the recipient is --------------------------------------------------------
const flat = Math.max(0, Math.floor(Number((SHIPPED.pigeons || {}).baseFee) || 0));
const priceAt = (setup) => { setup(); const r = coopRow(V, T); return r ? r.price : null; };
const prices = {
  beside: priceAt(() => place(T, TAMRIEL, [700, 0, 0])),
  far: priceAt(() => place(T, TAMRIEL, [210000, 0, 0])),
  across: priceAt(() => place(T, TAMRIEL, [0, 140000, 0])),
  indoors: priceAt(() => { place(T, HOUSE, [0, 0, 0]); mp.set(T, 'private.lastOutside', { world: TAMRIEL, pos: [140000, 0, 0] }); }),
  otherLand: priceAt(() => place(T, SOLSTHEIM, [0, 0, 0])),
  offline: priceAt(() => { online = [V, F]; place(T, TAMRIEL, [70000, 70000, 0]); }),
};
online = [V, T, F]; place(T, TAMRIEL, [0, 0, 0]);
ok('the coop lists one fee for a contact beside you, 3 km off, behind a door, in another land or logged out',
  new Set(Object.values(prices)).size === 1 && prices.beside !== null, prices);
ok(`...and it is the configured flat fee (pigeons.baseFee ${flat})`, prices.beside === flat, prices.beside);
// Each step the old fee moved by was 100 m: a modified client bisecting 50 m to and fro saw it flip
const steps = [0, 3400, 3550, 3600, 3700].map((x) => priceAt(() => place(T, TAMRIEL, [x, 0, 0])));
ok('no step in the fee as the contact walks off a few metres at a time', new Set(steps).size === 1, steps);
// What the flight takes from the purse says no more than the list
const paid = (x) => { place(T, TAMRIEL, [x, 0, 0]); G.pigeonLastSent.clear(); const before = purse.get(V); const r = G.sendPigeon(V, T, 'Where are you?', 'whiterun'); return r.ok ? before - purse.get(V) : r.text; };
const charged = [paid(700), paid(280000)];
ok('sending takes the same gold whether the recipient stands beside you or 4 km off', charged[0] === charged[1] && charged[0] === flat, charged);
place(T, TAMRIEL, [0, 0, 0]);

// ---- 3. "about" only between two who met and both chose to share ----------------------------------------------------
const about = (viewer, id) => { const r = coopRow(viewer, id); return r ? r.online : null; };
ok('met both ways, online, nobody shared: the coop shows nobody about', about(V, T) === false && about(T, V) === false && about(F, T) === false,
  { VT: about(V, T), TV: about(T, V), FT: about(F, T) });
let book = ledger(V, '');
ok('...nor does the ledger', /Tova Hale #TTT1/.test(book) && !/\(about\)/.test(book), book);
ok('...nor one contact\'s page in it', !/about in the world/.test(ledger(V, 'Tova')), ledger(V, 'Tova'));
let r = ledger(T, 'share Vel');
ok('/ledger share <name> lets that one contact see you about', /Vel Andras/.test(r) && /share/i.test(r) && !/Nobody called/.test(r), r);
ok('...one side sharing is not enough: Vel has not shared back', about(V, T) === false && about(T, V) === false, { VT: about(V, T), TV: about(T, V) });
r = ledger(V, 'share Tova');
ok('both shared: each sees the other about, in the coop and the ledger', about(V, T) === true && about(T, V) === true && /Tova Hale #TTT1 \(about\)/.test(ledger(V, '')),
  { VT: about(V, T), TV: about(T, V), r });
ok('...and nobody else does', about(F, T) === false && about(F, V) === false && !/\(about\)/.test(ledger(F, '')), { FT: about(F, T), FV: about(F, V) });
online = [V, F];
ok('a sharing contact who logs out is not about', about(V, T) === false && !/\(about\)/.test(ledger(V, '')));
online = [V, T, F];
atBoard = new Set([T, F]);
r = ledger(V, 'share Tova');
ok('sharing is turned off again anywhere, away from any ledger', /no longer/i.test(r) && about(V, T) === false && about(T, V) === false, r);
atBoard = new Set([V, T, F]);
ledger(V, 'share Tova');
ok('...and on again', about(V, T) === true);
// One-sided: T strikes V out. V still has T, T no longer has V, and the share T gave V goes with it
ledger(T, 'forget Vel');
ok('struck out by the contact: Vel no longer sees Tova about', G.metOf(V).includes(T) && !G.metOf(T).includes(V) && about(V, T) === false, { VT: about(V, T) });
ticks.get('meet')();
ok('meeting again in person does not bring the share back: Tova must share again', G.metOf(T).includes(V) && about(V, T) === false && about(T, V) === false,
  { VT: about(V, T), TV: about(T, V) });
ok('the ledger\'s help names the switch', /ledger share/.test(ledger(V, 'help')));

process.chdir(home);
fs.rmSync(dir, { recursive: true, force: true });
delete globalThis.__dboGuildsOf; delete globalThis.__dboLedger;
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
