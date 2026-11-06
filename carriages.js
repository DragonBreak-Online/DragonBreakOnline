// DragonBreak Online: hold carriages between Skyrim's towns (Jake, 5-6 Nov). Loaded by gamemode.js; config "carriages".
// Activate a capital's carriage, or its driver, and choose a town; the fare grows with the distance and goes to the hold's treasury on departure.
// ROLLBACK: carriages.enabled false (hot reload) removes the drivers and the service.
'use strict';
const fs = require('fs');
const path = require('path');

const PREFIX = 'carriage:';
const WIDGET_ID = 176;
// The five Skyrim.esm drivers' own spots (refs 13698, 9b7b1, 3f220, 9b7b4, 9b7c8, disabled by the DLE); carts: each carriage's passenger and driver seats
const DEFAULT_STOPS = [
  { id: 'whiterun', name: 'Whiterun', hire: [17589.8, -12411.6, -4745.1], heading: 275, npc: '13669:Skyrim.esm', carts: ['1070f0:Skyrim.esm', '1070f1:Skyrim.esm'] },
  { id: 'solitude', name: 'Solitude', hire: [-73225.0, 99456.7, -10906.7], heading: 229, npc: '9b7a6:Skyrim.esm', carts: ['1070e4:Skyrim.esm', '1070e5:Skyrim.esm'] },
  { id: 'markarth', name: 'Markarth', hire: [-169005.7, 5125.1, -4098.1], heading: 352, npc: '3f21e:Skyrim.esm', carts: ['1070ed:Skyrim.esm', '1070ee:Skyrim.esm'] },
  { id: 'riften', name: 'Riften', hire: [173670.0, -91149.0, 11104.9], heading: 120, npc: '9b7aa:Skyrim.esm', carts: ['1070e3:Skyrim.esm', '1070e1:Skyrim.esm'] },
  { id: 'windhelm', name: 'Windhelm', hire: [136473.5, 24429.4, -12800.4], heading: 183, npc: '9b7ab:Skyrim.esm', carts: ['1070e7:Skyrim.esm', '1070e8:Skyrim.esm'] },
  { id: 'falkreath', name: 'Falkreath' },
  { id: 'morthal', name: 'Morthal' },
  { id: 'dawnstar', name: 'Dawnstar' },
  // Jake, 6 Nov: Winterhold needs one. No stable in the base game: the MQ201 party's "Carriage Driver" (essential) on the last of the hub gate's checked spots
  { id: 'winterhold', name: 'Winterhold', hire: [109080.1, 102630.9, -8940.6], heading: 25, npc: '424ae:Skyrim.esm' },
];

module.exports = (api) => {
  const { mp, log, personal, audit, who, cfg, openWidget, closeWidget, onUi, sendPacket, takeGold, giveGold, goldOf, depositToTreasury, creationPending, arrivalFor, onlineActors } = api;
  const combatAt = api.combatAt instanceof Map ? api.combatAt : new Map();
  const pvpAt = api.pvpAt instanceof Map ? api.pvpAt : new Map();
  const own = (cfg && cfg.carriages) || {};
  const C = Object.assign({ enabled: true, world: '3c:Skyrim.esm', reach: 600, rideSeconds: 6, fadeSafetyMs: 10000, cooldownMinutes: 0, combatSeconds: 60, pvpSeconds: 120, allowParcels: false }, own);
  // A carriage a GM placed (F7) within cartReach of a stop is that stop's carriage too: the base game's "Carriage" and its driver seat
  const CART_BASES = new Set((Array.isArray(own.cartBases) ? own.cartBases : ['103445:Skyrim.esm', '103442:Skyrim.esm']).map((d) => String(d)));
  const CART_REACH = Math.max(0, Number(own.cartReach) || 1500);
  // Jake, 6 Nov: further costs more. base, plus per10k for every 10,000 units from the stable to the arrival, to the nearest round, within min and max
  const FARES = Object.assign({ base: 5, per10k: 1.25, round: 5, min: 10, max: 500 }, own.fares || {});
  // radius: how near a player comes before a driver spawns (as guards.js); leash: a driver's reach from the stable
  const DRIVERS = Object.assign({ enabled: true, radius: 4000, leash: 2000, despawnSeconds: 300, respawnSeconds: 600 }, own.drivers || {});
  const SPAWNS_FILE = path.resolve('NPC-Spawns.json');
  const id = (a) => Number(a) >>> 0;
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const normDesc = (d) => { const s = String(d || ''); const i = s.indexOf(':'); if (i < 0) return s.toLowerCase(); const n = parseInt(s.slice(0, i), 16); return `${Number.isFinite(n) ? n.toString(16) : s.slice(0, i)}:${s.slice(i + 1)}`.toLowerCase(); };
  const validPos = (p) => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every((v) => Number.isFinite(Number(v)));

  // carriages.stops { <id>: { name, hire, heading, npc, carts, arrival, rotZ, off } } changes a stop or adds one
  const STOPS = (() => {
    const over = own.stops && typeof own.stops === 'object' ? own.stops : {};
    const ids = [...new Set(DEFAULT_STOPS.map((s) => s.id).concat(Object.keys(over).filter((k) => k[0] !== '_')))];
    return ids.map((sid) => {
      const s = Object.assign({}, DEFAULT_STOPS.find((d) => d.id === sid) || {}, over[sid] || {}, { id: sid });
      if (!s.name || s.off === true) return null;
      s.hire = validPos(s.hire) ? s.hire.slice(0, 3).map(Number) : null;
      s.arrival = Array.isArray(s.arrival) ? s.arrival.filter(validPos).map((q) => q.slice(0, 3).map(Number)) : [];
      s.carts = Array.isArray(s.carts) ? s.carts.map(String) : [];
      return s;
    }).filter(Boolean);
  })();
  const byId = (sid) => STOPS.find((s) => s.id === sid) || null;
  // With no actor only whether the stop has an arrival (its first spot): arrivalFor(name, 0) picks and holds no spot
  const arrivalOf = (s, a) => {
    if (s.arrival.length) return { pos: a ? s.arrival[Math.floor(Math.random() * s.arrival.length)] : s.arrival[0], rotZ: num(s.rotZ, 0) };
    try { const r = typeof arrivalFor === 'function' ? arrivalFor(s.name, a ? id(a) : 0) : null; return r && validPos(r.pos) ? r : null; } catch (e) { return null; }
  };
  const fareBetween = (from, to) => {
    const spot = arrivalOf(to, 0); if (!spot || !from.hire) return null;
    const d = Math.hypot(spot.pos[0] - from.hire[0], spot.pos[1] - from.hire[1]);
    const step = Math.max(1, num(FARES.round, 5));
    const fare = Math.round((num(FARES.base, 5) + num(FARES.per10k, 1.25) * d / 10000) / step) * step;
    return Math.max(0, Math.min(num(FARES.max, 500), Math.max(num(FARES.min, 10), fare)));
  };
  const destinationsFrom = (from) => STOPS.filter((s) => s.id !== from.id && fareBetween(from, s) !== null)
    .sort((x, y) => fareBetween(from, x) - fareBetween(from, y) || x.name.localeCompare(y.name));
  const stopsWithStable = () => STOPS.filter((s) => s.hire);

  const get = (a, k) => { try { return mp.get(id(a), k); } catch (e) { return undefined; } };
  // stop id -> the driver last talked to: a driver who wandered within the leash still counts as the stable
  const driverOf = globalThis.__dboCarriageDrivers instanceof Map ? globalThis.__dboCarriageDrivers : (globalThis.__dboCarriageDrivers = new Map());
  // cart ref id -> its stop, and where each stop's carts stand (read from the server once a load)
  const CART_STOP = new Map(), cartsAt = new Map();
  // stop id -> placed carriages talked to, so a player beside one counts as the stable
  const placedOf = globalThis.__dboCarriagePlaced instanceof Map ? globalThis.__dboCarriagePlaced : (globalThis.__dboCarriagePlaced = new Map());
  const placedCartStop = (ref) => {
    const base = normDesc(get(ref, 'baseDesc')); if (![...CART_BASES].some((d) => normDesc(d) === base)) return null;
    const q = get(ref, 'pos'); if (!validPos(q) || normDesc(get(ref, 'worldOrCellDesc')) !== normDesc(C.world)) return null;
    let best = null, bestD = Infinity;
    for (const s of STOPS.filter((x) => x.hire)) { const d = Math.hypot(q[0] - s.hire[0], q[1] - s.hire[1], q[2] - s.hire[2]); if (d <= CART_REACH && d < bestD) { best = s; bestD = d; } }
    return best;
  };
  for (const s of STOPS.filter((x) => x.hire)) for (const desc of s.carts) { try { const cid = mp.getIdFromDesc(desc) >>> 0; if (cid) CART_STOP.set(cid, s); } catch (e) { log(`carriages: cart ${desc} is not in the load order`); } }
  const cartPoints = (s) => {
    if (!cartsAt.has(s.id)) cartsAt.set(s.id, [...CART_STOP].filter(([, x]) => x === s).map(([cid]) => get(cid, 'pos')).filter(validPos));
    return cartsAt.get(s.id).concat([...(placedOf.get(s.id) || [])].map((cid) => get(cid, 'pos')).filter(validPos));
  };
  const stopNear = (a) => {
    if (normDesc(get(a, 'worldOrCellDesc')) !== normDesc(C.world)) return null;
    const p = get(a, 'pos'); if (!validPos(p)) return null;
    let best = null, bestD = Infinity;
    for (const s of stopsWithStable()) {
      const points = [s.hire, ...cartPoints(s)];
      const drv = driverOf.get(s.id);
      const dp = drv ? get(drv, 'pos') : null;
      if (drv && !get(drv, 'isDead') && normDesc(get(drv, 'worldOrCellDesc')) === normDesc(C.world) && validPos(dp)
        && Math.hypot(dp[0] - s.hire[0], dp[1] - s.hire[1], dp[2] - s.hire[2]) <= num(DRIVERS.leash, 2000)) points.push(dp);
      for (const q of points) { const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); if (d <= num(C.reach, 600) && d < bestD) { best = s; bestD = d; } }
    }
    return best;
  };
  const driverStopOf = (ref) => { const tag = String(get(ref, 'private.npcSpawner') || ''); return tag.startsWith(PREFIX) ? byId(tag.slice(PREFIX.length)) : null; };
  const secondsLeft = (ms) => Math.max(1, Math.ceil(ms / 1000));

  // Why a character may not ride now ('' when it may): the /unstuck rules, a parcel, the cooldown
  const blocked = (a) => {
    if (get(a, 'isDead')) return 'You cannot travel while you are down.';
    try { if (typeof creationPending === 'function' && creationPending(id(a))) return 'Your character is not finished yet.'; } catch (e) { /* finished */ }
    try { if (typeof globalThis.__dboIsDowned === 'function' && globalThis.__dboIsDowned(id(a))) return 'You cannot travel while you are down.'; } catch (e) { /* up */ }
    const r = get(a, 'private.restrained'); if (r && (r.boundHands || r.carried || r.captorActorId)) return 'The driver will not take someone bound or carried.';
    try { if ((typeof onlineActors === 'function' ? onlineActors() : []).some((o) => id(o) !== id(a) && id((get(o, 'private.restrained') || {}).captorActorId) === id(a))) return 'The driver will not take a captive. Let them go first.'; } catch (e) { /* nobody held */ }
    try { if (typeof globalThis.__dboJailUnstuck === 'function' && globalThis.__dboJailUnstuck(id(a))) return 'No carriage takes a prisoner out of a jail or a sentence.'; } catch (e) { /* free */ }
    const now = Date.now();
    const fought = now - Math.max(pvpAt.get(id(a)) || 0, combatAt.get(id(a)) || 0);
    if (fought < num(C.combatSeconds, 60) * 1000) return `The driver will not leave with a fight on. Try again in ${secondsLeft(num(C.combatSeconds, 60) * 1000 - fought)} seconds.`;
    const sincePvp = now - (pvpAt.get(id(a)) || 0);
    if (sincePvp < num(C.pvpSeconds, 120) * 1000) return `The driver will not leave so soon after a fight with another traveller. Try again in ${secondsLeft(num(C.pvpSeconds, 120) * 1000 - sincePvp)} seconds.`;
    if (C.allowParcels !== true) {
      try { const base = typeof globalThis.__dboCourierParcelBase === 'function' ? globalThis.__dboCourierParcelBase() : 0; if (base && globalThis.__dboCourierSealed(id(a), base) > 0) return 'The driver will not carry a sealed courier\'s parcel. Deliver it on foot first.'; } catch (e) { /* no couriers */ }
    }
    const wait = (Number(get(a, 'private.carriageAt')) || 0) + num(C.cooldownMinutes, 0) * 60000 - now;
    if (wait > 0) return `The next carriage leaves in ${Math.ceil(wait / 60000)} minute${Math.ceil(wait / 60000) === 1 ? '' : 's'}.`;
    return '';
  };

  const riding = globalThis.__dboCarriageRiding instanceof Map ? globalThis.__dboCarriageRiding : (globalThis.__dboCarriageRiding = new Map());
  const pending = globalThis.__dboCarriagePending instanceof Map ? globalThis.__dboCarriagePending : (globalThis.__dboCarriagePending = new Map());
  const fading = globalThis.__dboCarriageFading instanceof Map ? globalThis.__dboCarriageFading : (globalThis.__dboCarriageFading = new Map());
  const setFade = (a, on) => {
    try { sendPacket(id(a), { customPacketType: 'dboFade', on: !!on }); } catch (e) { /* the client lifts it itself */ }
    clearTimeout(fading.get(id(a))); fading.delete(id(a));
    if (on) fading.set(id(a), setTimeout(() => setFade(a, false), num(C.fadeSafetyMs, 10000)));
  };

  const depart = (a) => {
    const r = riding.get(id(a)); riding.delete(id(a));
    if (!r) return 'gone';
    const from = byId(r.from), to = byId(r.to);
    const stop = (text) => { setFade(a, false); personal(a, text); return 'refused'; };
    if (!(typeof onlineActors !== 'function' || onlineActors().includes(id(a)))) { setFade(a, false); return 'offline'; }
    if (!from || !to) return stop('The carriage cannot make that trip any more.');
    const near = stopNear(a); if (!near || near.id !== from.id) return stop('You stepped off before the carriage left. You paid nothing.');
    const why = blocked(a); if (why) return stop(`${why} You paid nothing.`);
    const spot = arrivalOf(to, id(a)); if (!spot) return stop(`The road to ${to.name} is closed. You paid nothing.`);
    if (r.fare > 0 && !takeGold(id(a), r.fare)) return stop(`You cannot pay the fare to ${to.name}, ${r.fare} gold.`);
    try { mp.set(id(a), 'locationalData', { cellOrWorldDesc: to.world || C.world, pos: spot.pos, rot: [0, 0, num(spot.rotZ, 0)] }); }
    catch (e) {
      log('carriages: move failed', e.message);
      let back = r.fare === 0; try { back = back || (typeof giveGold === 'function' && giveGold(id(a), r.fare) !== false); } catch (e2) { back = false; }
      return stop(back ? 'The carriage could not leave. Your fare is returned.' : 'The carriage could not leave. Tell a GM: your fare was not returned.');
    }
    let kept = 0; try { kept = r.fare > 0 ? depositToTreasury(from.id, r.fare, { income: 'carriage' }) || 0 : 0; } catch (e) { log('carriages: treasury deposit failed', e.message); }
    try { const h = globalThis.__dboPlogHook; if (typeof h === 'function') h('travel', id(a), 'carriage'); } catch (e) { /* the player log is optional */ }
    try { mp.set(id(a), 'private.carriageAt', Date.now()); } catch (e) { /* the cooldown is optional */ }
    personal(a, `The carriage sets you down at ${to.name}.`);
    audit(`CARRIAGE ${who(id(a))} rode from ${from.name} to ${to.name} for ${r.fare} gold (${kept} to the ${from.id} treasury)`);
    return 'rode';
  };

  // Boards a for the trip; the fare shown in the menu is the fare paid, or nothing
  const board = (a, from, to, shown) => {
    if (!C.enabled) return personal(a, 'The carriages are not running.');
    if (!from || !to || from.id === to.id) return personal(a, 'The driver does not go there.');
    const near = stopNear(a); if (!near || near.id !== from.id) return personal(a, `You walked away from the ${from.name} carriage.`);
    if (riding.has(id(a))) return personal(a, 'You are already aboard.');
    const fare = fareBetween(from, to);
    if (fare === null) return personal(a, `The road to ${to.name} is closed.`);
    if (shown !== undefined && Number(shown) !== fare) return personal(a, 'The fare has changed. Ask the driver again.');
    const why = blocked(a); if (why) return personal(a, why);
    if ((Number(goldOf(id(a))) || 0) < fare) return personal(a, `The fare to ${to.name} is ${fare} gold, and you do not have it.`);
    riding.set(id(a), { from: from.id, to: to.id, fare, at: Date.now() });
    personal(a, `You climb aboard. The carriage leaves for ${to.name}; the fare, ${fare} gold, is paid when it sets off.`);
    setFade(a, true);
    setTimeout(() => { try { depart(a); } catch (e) { log('carriages: departure failed', e.message); setFade(a, false); } }, num(C.rideSeconds, 6) * 1000);
    return 'boarded';
  };

  const openMenu = (a, from) => {
    const dests = destinationsFrom(from);
    if (!dests.length) return personal(a, 'The driver has nowhere to go today.');
    const fares = {};
    const actions = dests.map((s) => { fares[s.id] = fareBetween(from, s); return { id: s.id, label: `${s.name}: ${fares[s.id]} gold` }; });
    pending.set(id(a), { from: from.id, fares });
    openWidget(id(a), { type: 'contextMenu', id: WIDGET_ID, mode: 'menu', targetName: `Carriage from ${from.name}: where to?`, actions, events: { action: 'dbo:carriageChoose', close: 'dbo:carriageClose' } }, true);
    return 'menu';
  };

  onUi('carriageChoose', (a, args) => {
    const p = pending.get(id(a)); pending.delete(id(a));
    try { closeWidget(id(a), WIDGET_ID); } catch (e) { /* already closed */ }
    const choice = String((args && args[0]) || '');
    if (!p || !choice || choice === 'cancel' || !Object.prototype.hasOwnProperty.call(p.fares, choice)) return;
    board(a, byId(p.from), byId(choice), p.fares[choice]);
  });
  onUi('carriageClose', (a) => { pending.delete(id(a)); });
  onUi('arrived', (a) => { if (fading.has(id(a)) && !riding.has(id(a))) setFade(a, false); });

  // gamemode.js's activate chain: true refuses the engine's own sit or talk (the menu opens) and a dead driver's search
  globalThis.__dboCarriageActivate = (target, caster) => {
    if (!C.enabled) return false;
    const driver = CART_STOP.has(id(target)) ? null : driverStopOf(target);
    const placed = CART_STOP.has(id(target)) || driver ? null : placedCartStop(target);
    const s = CART_STOP.get(id(target)) || driver || placed; if (!s) return false;
    if (driver) {
      if (get(target, 'isDead')) { personal(caster, 'The carriage company sees to its own. There is nothing to take.'); return true; }
      driverOf.set(s.id, id(target));
    }
    if (placed) { if (!placedOf.has(s.id)) placedOf.set(s.id, new Set()); placedOf.get(s.id).add(id(target)); }
    if (stopNear(caster) !== s) { personal(caster, 'Come closer to the carriage.'); return true; }
    openMenu(caster, s);
    return true;
  };

  // The drivers' zones in NPC-Spawns.json, written the guards.js way (other writers' zones are kept)
  const writeZones = () => {
    let root = null, list = [], key = 'zones';
    try {
      const parsed = JSON.parse(fs.readFileSync(SPAWNS_FILE, 'utf8'));
      if (Array.isArray(parsed)) list = parsed; else if (parsed && typeof parsed === 'object') { root = parsed; key = Object.keys(parsed).find((k) => k.toLowerCase() === 'zones') || 'zones'; list = Array.isArray(parsed[key]) ? parsed[key] : []; }
    } catch (e) { /* no file yet */ }
    const on = C.enabled && DRIVERS.enabled !== false;
    const mine = on ? stopsWithStable().filter((s) => /^[0-9a-f]+:.+\.es[mpl]$/i.test(String(s.npc || ''))).map((s) => ({ Name: `${PREFIX}${s.id}`, ID: C.world, POS: s.hire, Size: num(DRIVERS.radius, 2000),
      Heading: num(s.heading, 0), NPC: [{ id: s.npc, count: 1 }], Despawn: num(DRIVERS.despawnSeconds, 300), Respawn: num(DRIVERS.respawnSeconds, 600), Hostile: false })) : [];
    const kept = list.filter((z) => !String((z && (z.Name || z.name)) || '').startsWith(PREFIX));
    const sig = JSON.stringify(mine);
    if (globalThis.__dboCarriagesSig === sig && list.length - kept.length === mine.length) return mine.length;
    const payload = root ? Object.assign({}, root, { [key]: kept.concat(mine) }) : { zones: kept.concat(mine) };
    try { fs.writeFileSync(SPAWNS_FILE + '.carriages.tmp', JSON.stringify(payload, null, 1)); fs.renameSync(SPAWNS_FILE + '.carriages.tmp', SPAWNS_FILE); globalThis.__dboCarriagesSig = sig; }
    catch (e) { log('NPC-Spawns.json write failed (carriages)', e.message); }
    return mine.length;
  };
  const drivers = writeZones();
  const all = stopsWithStable().flatMap((f) => destinationsFrom(f).map((t) => fareBetween(f, t)));
  log(`carriages ${C.enabled ? 'on' : 'off'}: ${STOPS.length} stops, ${stopsWithStable().length} stables, ${CART_STOP.size} cart seats, ${drivers} driver(s), fares ${all.length ? Math.min(...all) : 0}-${all.length ? Math.max(...all) : 0} gold by distance`);
};
