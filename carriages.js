// DragonBreak Online: hold carriages between Skyrim's towns (Jake, 5 Nov). Loaded by gamemode.js; config "carriages".
// Talk to a driver at a capital's stable, or /carriage there; the vanilla fare is paid on departure to the hold's treasury.
// ROLLBACK: carriages.enabled false (hot reload) removes the drivers and the service.
'use strict';
const fs = require('fs');
const path = require('path');

const PREFIX = 'carriage:';
const WIDGET_ID = 176;
// The five Skyrim.esm drivers' own spots (refs 13698, 9b7b1, 3f220, 9b7b4, 9b7c8, disabled by the DLE)
const DEFAULT_STOPS = [
  { id: 'whiterun', name: 'Whiterun', hire: [17589.8, -12411.6, -4745.1], heading: 275, npc: '13669:Skyrim.esm' },
  { id: 'solitude', name: 'Solitude', hire: [-73225.0, 99456.7, -10906.7], heading: 229, npc: '9b7a6:Skyrim.esm' },
  { id: 'markarth', name: 'Markarth', hire: [-169005.7, 5125.1, -4098.1], heading: 352, npc: '3f21e:Skyrim.esm' },
  { id: 'riften', name: 'Riften', hire: [173670.0, -91149.0, 11104.9], heading: 120, npc: '9b7aa:Skyrim.esm' },
  { id: 'windhelm', name: 'Windhelm', hire: [136473.5, 24429.4, -12800.4], heading: 183, npc: '9b7ab:Skyrim.esm' },
  { id: 'falkreath', name: 'Falkreath' },
  { id: 'morthal', name: 'Morthal' },
  { id: 'dawnstar', name: 'Dawnstar' },
  { id: 'winterhold', name: 'Winterhold' },
];

module.exports = (api) => {
  const { mp, log, personal, audit, who, cfg, registerChatCommand, openWidget, closeWidget, onUi, sendPacket, takeGold, giveGold, goldOf, depositToTreasury, zoneById, creationPending, arrivalFor, onlineActors } = api;
  const combatAt = api.combatAt instanceof Map ? api.combatAt : new Map();
  const pvpAt = api.pvpAt instanceof Map ? api.pvpAt : new Map();
  const own = (cfg && cfg.carriages) || {};
  const C = Object.assign({ enabled: true, world: '3c:Skyrim.esm', reach: 600, rideSeconds: 6, fadeSafetyMs: 10000, cooldownMinutes: 0, combatSeconds: 60, pvpSeconds: 120, allowParcels: false }, own);
  const FARES = Object.assign({ major: 20, minor: 50 }, own.fares || {});
  // radius: how near a player comes before a driver spawns (as guards.js); leash: a driver's reach from the stable
  const DRIVERS = Object.assign({ enabled: true, radius: 4000, leash: 2000, despawnSeconds: 300, respawnSeconds: 600 }, own.drivers || {});
  const SPAWNS_FILE = path.resolve('NPC-Spawns.json');
  const id = (a) => Number(a) >>> 0;
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const normDesc = (d) => { const s = String(d || ''); const i = s.indexOf(':'); if (i < 0) return s.toLowerCase(); const n = parseInt(s.slice(0, i), 16); return `${Number.isFinite(n) ? n.toString(16) : s.slice(0, i)}:${s.slice(i + 1)}`.toLowerCase(); };
  const validPos = (p) => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every((v) => Number.isFinite(Number(v)));

  // carriages.stops { <id>: { name, hire, heading, npc, major, arrival, rotZ, off } } changes a stop or adds one
  const STOPS = (() => {
    const over = own.stops && typeof own.stops === 'object' ? own.stops : {};
    const ids = [...new Set(DEFAULT_STOPS.map((s) => s.id).concat(Object.keys(over).filter((k) => k[0] !== '_')))];
    return ids.map((sid) => {
      const s = Object.assign({}, DEFAULT_STOPS.find((d) => d.id === sid) || {}, over[sid] || {}, { id: sid });
      if (!s.name || s.off === true) return null;
      s.hire = validPos(s.hire) ? s.hire.slice(0, 3).map(Number) : null;
      s.arrival = Array.isArray(s.arrival) ? s.arrival.filter(validPos).map((q) => q.slice(0, 3).map(Number)) : [];
      const z = typeof zoneById === 'function' ? zoneById(sid) : null;
      s.major = typeof s.major === 'boolean' ? s.major : !!(z && z.majorCity);
      return s;
    }).filter(Boolean);
  })();
  const byId = (sid) => STOPS.find((s) => s.id === sid) || null;
  const fareTo = (s) => Math.max(0, Math.floor(num(s.major ? FARES.major : FARES.minor, 0)));
  // With no actor only whether the stop has an arrival: arrivalFor(name, 0) picks and holds no spot
  const arrivalOf = (s, a) => {
    if (s.arrival.length) return { pos: s.arrival[Math.floor(Math.random() * s.arrival.length)], rotZ: num(s.rotZ, 0) };
    try { const r = typeof arrivalFor === 'function' ? arrivalFor(s.name, a ? id(a) : 0) : null; return r && validPos(r.pos) ? r : null; } catch (e) { return null; }
  };
  const destinationsFrom = (from) => STOPS.filter((s) => s.id !== from.id && arrivalOf(s, 0));
  const stopsWithStable = () => STOPS.filter((s) => s.hire);
  const listNames = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list.join(''));

  const get = (a, k) => { try { return mp.get(id(a), k); } catch (e) { return undefined; } };
  // stop id -> the driver last talked to: a driver who wandered within the leash still counts as the stable
  const driverOf = globalThis.__dboCarriageDrivers instanceof Map ? globalThis.__dboCarriageDrivers : (globalThis.__dboCarriageDrivers = new Map());
  const stopNear = (a) => {
    if (normDesc(get(a, 'worldOrCellDesc')) !== normDesc(C.world)) return null;
    const p = get(a, 'pos'); if (!validPos(p)) return null;
    let best = null, bestD = Infinity;
    for (const s of stopsWithStable()) {
      const points = [s.hire];
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
    const near = stopNear(a); if (!near || near.id !== from.id) return personal(a, `Stand by the driver at the ${from.name} stables to hire the carriage.`);
    if (riding.has(id(a))) return personal(a, 'You are already aboard.');
    const fare = fareTo(to);
    if (shown !== undefined && Number(shown) !== fare) return personal(a, 'The fare has changed. Ask the driver again.');
    if (!arrivalOf(to, 0)) return personal(a, `The road to ${to.name} is closed.`);
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
    const actions = dests.map((s) => { fares[s.id] = fareTo(s); return { id: s.id, label: `${s.name}: ${fares[s.id]} gold` }; });
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

  // gamemode.js's activate chain: true refuses the engine's own talk (the menu opens) and a dead driver's search
  globalThis.__dboCarriageActivate = (target, caster) => {
    if (!C.enabled) return false;
    const s = driverStopOf(target); if (!s) return false;
    if (get(target, 'isDead')) { personal(caster, 'The carriage company sees to its own. There is nothing to take.'); return true; }
    driverOf.set(s.id, id(target));
    if (stopNear(caster) !== s) { personal(caster, 'Come closer to the driver.'); return true; }
    openMenu(caster, s);
    return true;
  };

  const findStop = (word) => {
    const w = String(word || '').trim().toLowerCase(); if (!w) return null;
    return STOPS.find((s) => s.id === w || s.name.toLowerCase() === w) || STOPS.find((s) => s.name.toLowerCase().startsWith(w)) || null;
  };
  registerChatCommand('carriage', (a, args) => {
    const word = String(args || '').trim();
    const from = stopNear(a);
    if (!C.enabled) return personal(a, 'The carriages are not running.');
    if (!from) return personal(a, `Carriages leave from the stables outside ${listNames(stopsWithStable().map((s) => s.name))}. Talk to the driver there.`);
    if (!word) return openMenu(a, from);
    if (/^(list|fares?)$/i.test(word)) return personal(a, `From ${from.name}: ${destinationsFrom(from).map((s) => `${s.name} ${fareTo(s)} gold`).join(', ')}.`);
    const to = findStop(word);
    if (!to) return personal(a, `The driver does not know "${word.slice(0, 30)}". /carriage list shows where the carriage goes.`);
    return board(a, from, to);
  }, { help: '[town|list]: hire the carriage at a stable (or talk to its driver)' });

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
  log(`carriages ${C.enabled ? 'on' : 'off'}: ${STOPS.length} stops, ${stopsWithStable().length} stables, ${drivers} driver(s), fares ${fareTo({ major: true })}/${fareTo({ major: false })} gold`);
};
