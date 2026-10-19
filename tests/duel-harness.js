// Scripted test for duels (server\duel.js) wrapped around downed.js, against a mock mp. No server, no game:
//
//   node tests/duel-harness.js
//
// Challenge, refuse and accept from the panels; rounds and a non-lethal loss; the wager held and paid without making or
// losing gold; disconnects, a restart's leftover wager, outsiders' blows, rule breaks, leaving the ground, a party's
// friendly fire, the engine's full blow under scaling, and a killing blow that got past the guard.
'use strict';
const path = require('path');

let now = 1790000000000;
Date.now = () => now;
// Timers run when the harness flushes them
let queue = [];
global.setTimeout = (fn, ms) => { queue.push({ fn, at: now + (Number(ms) || 0) }); return queue.length; };
const flush = () => { for (let i = 0; i < 20; i++) { const due = queue.filter((t) => t.at <= now); if (!due.length) return; queue = queue.filter((t) => t.at > now); for (const t of due) t.fn(); } };

const A = 0xff000001, B = 0xff000002, O = 0xff000003, N = 0xff0000aa, SUMMON = 0xff0000bb;
const FIREBOLT = 0x12fd0, OAKFLESH = 0x5ad5c, POWER = 0x92c48, POTION = 0x3eb15, FOOD = 0x64b30, SWORD = 0x12eb7;
const GOLD = 0xf;
const props = new Map();
const set = (id, k, v) => props.set(id + '|' + k, v);
const get = (id, k) => props.get(id + '|' + k);
const reset = (a, prof, pos) => {
  set(a, 'profileId', prof); set(a, 'isDead', false); set(a, 'percentages', { health: 1, stamina: 1, magicka: 1 });
  set(a, 'pos', pos || [0, 0, 0]); set(a, 'worldOrCellDesc', 'a764b:BSHeartland.esm');
};
reset(A, 1, [0, 0, 0]); reset(B, 2, [140, 0, 0]); reset(O, 3, [70, 70, 0]); reset(N, -1, [0, 140, 0]); reset(SUMMON, -1, [0, 70, 0]);
set(SUMMON, 'ff_companionOf', B);
const goldOfA = (a) => (((get(a, 'inventory') || {}).entries || []).find((e) => e.baseId === GOLD) || { count: 0 }).count;
const setGold = (a, n) => set(a, 'inventory', { entries: [{ baseId: GOLD, count: n }] });
setGold(A, 500); setGold(B, 300); setGold(O, 0);

// SPIT: cost, flags, type (0 = Spell, 2 = Power); ENIT: value, flags (0x2 = food)
const u32s = (...v) => { const b = new Uint8Array(v.length * 4); const dv = new DataView(b.buffer); v.forEach((x, i) => dv.setUint32(i * 4, x, true)); return b; };
const RECORDS = {
  [FIREBOLT]: { type: 'SPEL', fields: [{ type: 'SPIT', data: u32s(40, 0, 0, 0, 0, 0, 0, 0, 0) }] },
  [OAKFLESH]: { type: 'SPEL', fields: [{ type: 'SPIT', data: u32s(60, 0, 0, 0, 0, 0, 0, 0, 0) }] },
  [POWER]: { type: 'SPEL', fields: [{ type: 'SPIT', data: u32s(0, 0, 2, 0, 0, 0, 0, 0, 0) }] },
  [POTION]: { type: 'ALCH', fields: [{ type: 'ENIT', data: u32s(25, 0) }] },
  [FOOD]: { type: 'ALCH', fields: [{ type: 'ENIT', data: u32s(5, 2) }] },
  [SWORD]: { type: 'WEAP', fields: [] },
};
const recordOf = (id) => (RECORDS[id >>> 0] ? { record: RECORDS[id >>> 0] } : null);

const papyrus = [];
const packets = [];
const baseHit = { mult: 1 };
const mp = {
  get: (id, k) => { const v = get(id, k); if (v === undefined && k === 'private.permaDead') return false; return v; },
  set: (id, k, v) => set(id, k, v),
  getIdFromDesc: (d) => parseInt(d, 16),
  getDescFromId: (id) => (id >>> 0).toString(16),
  lookupEspmRecordById: (id) => recordOf(id),
  callPapyrusFunction: (kind, cls, fn, self, args) => { papyrus.push([fn, args && args[0] ? parseInt(args[0].desc, 16) : 0, args && args[1]]); return true; },
};
// The gamemode's own chain, which downed.js and duel.js wrap: it notes a scaling the way gamemode.js does
const installBase = () => {
  mp.onHitDamageAttempt = (agg, tgt, src, dmg) => {
    globalThis.__dboMasteryPending = baseHit.mult !== 1 ? { agg: agg >>> 0, tgt: tgt >>> 0, mult: baseHit.mult, health: get(tgt, 'percentages').health } : null;
    return true;
  };
  mp.onHitDamage = () => undefined;
  mp.onDeath = () => undefined;
  mp.onSpellCast = () => undefined;
  mp.onEatItem = () => undefined;
  mp.onSpellHit = () => undefined;
  mp.onActivate = () => true;
  mp.onReadBook = () => undefined;
};
const out = { banners: [], audits: [], personal: [], widgets: [], closed: [] };
const timers = {};
const commands = {};
const ui = new Map();
const online = new Set([A, B, O]);
const loadAll = (duelCfg) => {
  installBase();
  globalThis.__dboUiEvents = new Map();
  ui.clear();
  const api = {
    mp, log: () => {}, personal: (a, t) => out.personal.push([a, t]), system: () => {},
    sendPacket: (a, p) => { packets.push([a, p]); if (p.customPacketType === 'dboBanner') out.banners.push([a, p.text]); return true; },
    audit: (t) => out.audits.push(t), who: (a) => 'P' + (a >>> 0).toString(16), display: (a) => 'P' + (a >>> 0).toString(16),
    profileOf: (a) => Number(get(a, 'profileId')), nameOf: (a) => 'P' + (a >>> 0).toString(16),
    onlineActors: () => [...online], every: (n, ms, fn) => { timers[n] = fn; },
    registerChatCommand: (n, fn) => { commands[n] = fn; }, cfg: { downed: { recoverSeconds: 0, giveUpAfterSeconds: 0 }, duel: duelCfg || {} },
    openWidget: (a, w) => { out.widgets.push([a, w]); return true; }, closeWidget: (a, id) => { out.closed.push([a, id]); return true; },
    onUi: (ev, fn) => { const l = ui.get(ev) || []; l.push(fn); ui.set(ev, l); },
    redress: () => {},
    takeGold: (a, n) => { const g = goldOfA(a); if (g < n) return false; setGold(a, g - n); return true; },
    giveItem: (a, id, n) => { if (id !== GOLD) return false; setGold(a, goldOfA(a) + n); return true; },
    goldOf: (a) => goldOfA(a), recordOf, findByName: (q) => [A, B, O].find((x) => 'p' + x.toString(16) === String(q).toLowerCase()) || 0,
    isAdmin: (a) => a === O,
  };
  require(path.resolve(__dirname, '..', 'downed.js'))(api);
  delete require.cache[path.resolve(__dirname, '..', 'duel.js')];
  require(path.resolve(__dirname, '..', 'duel.js'))(api);
};
loadAll();

let failures = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail !== undefined ? '   ' + detail : ''}`); if (!ok) failures++; };
const fire = (ev, a, ...args) => { for (const fn of ui.get(ev) || []) fn(a, args); };
const lastWidget = (a, id) => [...out.widgets].reverse().find(([x, w]) => x === a && w.id === id);
const hp = (a) => get(a, 'percentages').health;
const tick = (ms) => { now += ms; flush(); timers.duels(); };
// The engine: ask the attempt hook, apply the hit, kill at 0, then onHitDamage
const hit = (agg, tgt, dmg, src = SWORD, max = 200) => {
  const okHit = mp.onHitDamageAttempt(agg, tgt, src, dmg, { targetMaxHealth: max });
  if (okHit === false) { flush(); return false; }
  const p = get(tgt, 'percentages');
  const h = p.health - dmg / max;
  set(tgt, 'percentages', Object.assign({}, p, { health: Math.max(0, h) }));
  if (h <= 0) { set(tgt, 'isDead', true); mp.onDeath(tgt, agg); } else mp.onHitDamage(agg, tgt, src, dmg);
  flush();
  return true;
};
const totalGold = () => goldOfA(A) + goldOfA(B) + goldOfA(O) + [A, B, O].reduce((s, x) => s + ((get(x, 'private.dboDuelEscrow') || {}).gold || 0), 0);
const GOLD_TOTAL = totalGold();
const entries = (a, t) => globalThis.__dboDuelEntries(a, t).map((e) => e.id);
const draft = (a, t, { format = 0, rules = 0, wager = 0 } = {}) => {
  globalThis.__dboDuelAction(a, 'duel:challenge', t);
  const w = lastWidget(a, 121);
  const nonce = w ? w[1].actions[0].id.split('|')[0] : '';
  for (let i = 0; i < format; i++) fire('duelDraft', a, `${nonce}|format`);
  for (let i = 0; i < rules; i++) fire('duelDraft', a, `${nonce}|rules`);
  for (let i = 0; i < wager; i++) fire('duelDraft', a, `${nonce}|wager`);
  return nonce;
};
const challenge = (a, t, opts) => { const n = draft(a, t, opts); fire('duelDraft', a, `${n}|send`); const w = lastWidget(t, 122); return w ? w[1].actions[0].id.split('|')[0] : ''; };
const duel = () => globalThis.__dboDuels.duels.values().next().value || null;
const full = () => { for (const x of [A, B, O]) set(x, 'percentages', { health: 1, stamina: 1, magicka: 1 }); };
const startFight = (opts) => { const n = challenge(A, B, opts); fire('duelOffer', B, `${n}|accept`); tick(3100); return duel(); };

// ---- the menu and refusals ------------------------------------------------------------------------------------------
check('X on a player offers Challenge to a Duel', entries(A, B).includes('duel:challenge'));
check('no entry on an NPC', entries(A, N).length === 0);
set(A, 'percentages', { health: 0.6, stamina: 1, magicka: 1 });
globalThis.__dboDuelAction(A, 'duel:challenge', B);
check('below full health a challenge is refused', !lastWidget(A, 121) && out.personal.some(([a, t]) => a === A && /full health/.test(t)));
full();
set(B, 'pos', [5000, 0, 0]);
globalThis.__dboDuelAction(A, 'duel:challenge', B);
check('too far apart a challenge is refused', !lastWidget(A, 121) && out.personal.some(([a, t]) => a === A && /Stand within 8 m/.test(t)));
set(B, 'pos', [140, 0, 0]);

// ---- the panels: draft, refuse, time out ------------------------------------------------------------------------------
let n = draft(A, B, { format: 1, rules: 1, wager: 4 });
const w = lastWidget(A, 121)[1];
check('the draft panel cycles format, rules and wager', /best of three/.test(w.actions[0].label) && /no magic/.test(w.actions[1].label) && /100 gold each/.test(w.actions[2].label), w.actions.map((x) => x.label).join(' / '));
check('to the death is never offered', !out.widgets.some(([, x]) => (x.actions || []).some((y) => /death/i.test(y.label))));
fire('duelDraft', A, `${n}|send`);
let offer = lastWidget(B, 122);
check('the challenged player gets an Accept / Refuse panel', !!offer && /best of three, no magic, 100 gold each/.test(offer[1].targetName), offer && offer[1].targetName);
fire('duelOffer', B, `${offer[1].actions[1].id}`);
check('refusing tells the challenger and starts nothing', !duel() && out.personal.some(([a, t]) => a === A && /refuses your duel/.test(t)));
check('refusing takes no gold', goldOfA(A) === 500 && goldOfA(B) === 300);
n = challenge(A, B);
tick(31000);
check('an unanswered challenge lapses after answerSeconds', !duel() && !globalThis.__dboDuels.offers.size);
fire('duelOffer', B, `${n}|accept`);
check('an accept after it lapsed does nothing', !duel());
n = challenge(A, B);
fire('duelOfferClose', B);
check('closing the panel refuses', !duel() && !globalThis.__dboDuels.offers.size);

// ---- a best of three with a wager -------------------------------------------------------------------------------------
n = challenge(A, B, { format: 1, wager: 4 });
fire('duelOffer', B, `${n}|accept`);
let d = duel();
check('accepting begins the duel', !!d && d.format === 'bo3' && d.wager === 100);
check('both wagers are taken and held', goldOfA(A) === 400 && goldOfA(B) === 200 && get(A, 'private.dboDuelEscrow').gold === 100 && get(B, 'private.dboDuelEscrow').gold === 100);
check('no gold made or lost at the start', totalGold() === GOLD_TOTAL, totalGold());
check('X on the opponent offers Yield, not Challenge', entries(A, B).join() === 'duel:yield');
check('nobody else can be challenged by a duellist', entries(A, O).length === 0 && entries(O, A).length === 0);
check('during the countdown blows are refused', hit(A, B, 30) === false && hp(B) === 1);
tick(3100);
check('the round starts after the countdown', d.phase === 'fight' && out.banners.some(([a, t]) => a === A && t === 'Fight!'));
check('a blow lands normally', hit(A, B, 60) === true && Math.abs(hp(B) - 0.7) < 1e-9, hp(B));
check('a beaten blow is refused (no death)', hit(A, B, 150) === false && get(B, 'isDead') === false && hp(B) <= 0.05 + 1e-9, hp(B));
check('the round goes to the winner', d.wins[0] === 1 && d.wins[1] === 0 && d.phase === 'pause');
check('the loser kneels (bleed-out pose) and is held', papyrus.some(([fn, a, ev]) => fn === 'SendAnimationEvent' && a === B && ev === 'BleedOutStart')
  && packets.some(([a, p]) => a === B && p.customPacketType === 'dboParalyse' && p.quiet === true));
check('the loser is not downed', !globalThis.__dboIsDowned(B) && !globalThis.__dboDownedState.downed.has(B));
check('no blows while the loser kneels', hit(A, B, 10) === false);
tick(6100);
check('after the pause both stand at full health for round 2', d.round === 2 && d.phase === 'countdown' && hp(A) === 1 && hp(B) === 1
  && papyrus.some(([fn, a, ev]) => a === B && ev === 'BleedOutStop'));
tick(3100);
hit(B, A, 195);
check('round 2 to B', d.wins.join() === '1,1');
tick(6100); tick(3100);
hit(A, B, 199);
check('round 3 decides the duel for A', d.winner === A && d.wins.join() === '2,1' && d.phase === 'pause');
tick(6100);
check('it ends once the loser has knelt', d.closed && !globalThis.__dboDuels.by.size);
check('the winner takes both wagers', goldOfA(A) === 600 && goldOfA(B) === 200 && !get(A, 'private.dboDuelEscrow') && !get(B, 'private.dboDuelEscrow'));
check('no gold made or lost by the payout', totalGold() === GOLD_TOTAL, totalGold());
check('both healed to full at the end', hp(A) === 1 && hp(B) === 1);
check('the payout and every round are audited', out.audits.some((t) => /^DUEL .*won round 3/.test(t)) && out.audits.some((t) => /^DUEL P1 .*paid 200 gold/.test(t.replace(/Pff00000/g, 'P'))));

// ---- disconnects -------------------------------------------------------------------------------------------------------
full();
d = startFight({ wager: 3 });
check('a 50 gold duel begins', d && d.wager === 50 && goldOfA(A) === 550 && goldOfA(B) === 150);
online.delete(B);
globalThis.__dboDuelLeave(B);
check('a disconnect ends the duel with no winner', d.closed && !d.winner && !globalThis.__dboDuels.by.size);
check('and each wager goes back', goldOfA(A) === 600 && goldOfA(B) === 200 && totalGold() === GOLD_TOTAL);
online.add(B);
full();
d = startFight({ wager: 3 });
online.delete(A);
tick(500);
check('a dropped connection the watch finds ends it too', d.closed && goldOfA(A) === 600 && goldOfA(B) === 200);
online.add(A);

// ---- a restart: the wager held on the character comes back at the next login ----------------------------------------
setGold(A, 550);
set(A, 'private.dboDuelEscrow', { id: 'lost-duel', gold: 50, at: now });
globalThis.__dboDuelLogin(A);
check('a wager left by a restart is returned at login', goldOfA(A) === 600 && !get(A, 'private.dboDuelEscrow'));
check('no gold made by the return', totalGold() === GOLD_TOTAL);

// ---- outsiders -----------------------------------------------------------------------------------------------------------
full();
d = startFight();
check('another player cannot hurt a duellist', hit(O, A, 40) === false && hp(A) === 1);
check('and is told to stay out', out.personal.some(([a, t]) => a === O && /fighting a duel/.test(t)));
check('a duellist cannot hurt another player', hit(A, O, 40) === false && hp(O) === 1);
check("the opponent's summon fights for them", hit(SUMMON, A, 40) === true && hp(A) < 1);
check('a creature still can', hit(N, A, 20) === true);
hit(N, A, 400);
check('falling to a creature ends the duel with no winner', d.closed && !d.winner && get(A, 'isDead') === true && globalThis.__dboIsDowned(A));
set(A, 'isDead', false); globalThis.__dboDownedState.downed.delete(A);

// ---- rules ----------------------------------------------------------------------------------------------------------------
full();
d = startFight({ rules: 1 });
check('no magic: a spell hit is refused', hit(A, B, 30, FIREBOLT) === false && hp(B) === 1);
mp.onSpellCast(B, POWER);
check('no magic: a power is not a spell', d.wins.join() === '0,0');
mp.onSpellCast(B, OAKFLESH);
check('no magic: casting a spell loses the round', d.wins.join() === '1,0' && d.phase === 'pause');
tick(6100);
check('a single round decided ends the duel', d.closed && d.winner === A);
full();
d = startFight({ rules: 2 });
mp.onEatItem(A, FOOD);
check('no potions: food is fine', d.wins.join() === '0,0');
mp.onEatItem(A, POTION);
check('no potions: a potion loses the round', d.wins.join() === '0,1');
tick(6100);
check('a spell lands under no potions', hit(A, B, 30, FIREBOLT) === true);
full();
d = startFight({ format: 1 });
globalThis.__dboDuelAction(A, 'duel:yield', B);
check('yielding gives the duel away', d.closed && d.winner === B && d.wins[1] === 2);

// ---- leaving the ground -------------------------------------------------------------------------------------------------
full();
d = startFight({ wager: 3 });
set(B, 'pos', [3000, 0, 0]);
tick(500); tick(1000); tick(1000); tick(1000);
check('stepping off the ground forfeits the duel', d.closed && d.wins[0] >= 1 && goldOfA(A) === 650 && goldOfA(B) === 150 && totalGold() === GOLD_TOTAL, `${goldOfA(A)} ${goldOfA(B)}`);
set(B, 'pos', [140, 0, 0]);
setGold(A, 600); setGold(B, 200);

// ---- a party's friendly fire does not cut a duel -------------------------------------------------------------------------
globalThis.__dboPartyLeaderOf = (a) => ((a === A || a === B) ? 1 : null);
full();
d = startFight();
hit(A, B, 100);
check('party members duel at full strength', Math.abs(hp(B) - 0.5) < 1e-9, hp(B));
globalThis.__dboDuelAction(A, 'duel:yield', B);
full();
hit(A, B, 100);
check('outside a duel the party still takes 20%', Math.abs(hp(B) - 0.9) < 1e-9, hp(B));
globalThis.__dboPartyLeaderOf = undefined;

// ---- the engine's full blow under scaling ---------------------------------------------------------------------------------
full();
d = startFight();
set(B, 'percentages', { health: 0.4, stamina: 1, magicka: 1 });
baseHit.mult = 0.5;
const r = hit(A, B, 100);
check('a blow the engine would make lethal but the scaling would not is refused, its scaled share taken', r === false && Math.abs(hp(B) - 0.15) < 1e-9 && d.phase === 'fight', hp(B));
check('and the scaled blow that would beat them still loses the round', hit(A, B, 60) === false && d.wins.join() === '1,0');
baseHit.mult = 1;
tick(6100);

// ---- a killing blow past the guard ----------------------------------------------------------------------------------------
full();
d = startFight({ wager: 3 });
set(B, 'isDead', true);
mp.onDeath(B, A);
tick(600);
check('a killing blow from the opponent gives the duel and the wagers to them', d.closed && goldOfA(A) === 650 && goldOfA(B) === 150 && totalGold() === GOLD_TOTAL);
check('and the winner raises the fallen at once', get(B, 'isDead') === false && out.audits.some((t) => /REVIVE .*mercy at the end of the duel/.test(t)));
setGold(A, 600); setGold(B, 200);

// ---- a hot reload keeps a running duel and does not stack the hooks --------------------------------------------------------
full();
d = startFight({ format: 1 });
loadAll();
check('a reload keeps the running duel', duel() === d && globalThis.__dboDuelPair(A, B));
hit(A, B, 30);
check('one blow after the reload is counted once', Math.abs(hp(B) - 0.85) < 1e-9, hp(B));
hit(A, B, 400);
check('the guard still holds after the reload', get(B, 'isDead') === false && d.wins.join() === '1,0');
commands.duel(O, `stop pff000001`);
check('staff can stop a duel (no winner)', d.closed && !d.winner);

// ---- disconnect: 'forfeit' ------------------------------------------------------------------------------------------------
loadAll({ disconnect: 'forfeit' });
full();
d = startFight({ wager: 3 });
online.delete(B);
globalThis.__dboDuelLeave(B);
check("with disconnect 'forfeit' the one who stayed wins the wagers", d.closed && goldOfA(A) === 650 && goldOfA(B) === 150 && totalGold() === GOLD_TOTAL);
online.add(B);

// ---- switched off -----------------------------------------------------------------------------------------------------------
loadAll({ enabled: false });
check('enabled false takes the entry away', entries(A, B).length === 0);

console.log(failures ? `${failures} failure(s)` : 'all checks passed');
process.exit(failures ? 1 : 0);
