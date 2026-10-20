// DragonBreak Online: the world clock and weather, owned by the server. Loaded by gamemode.js on every hot reload.
//
// GameDaysPassed runs from an epoch at a fixed time scale, so hour, date and the moons' phase are the same for every
// player; each client follows the dboClock packet (client TimeService). Weather is scheduled per zone as a kind
// (0 pleasant, 1 cloudy, 2 rainy, 3 snow) and each client takes that kind from its own region's weather list.
// State (epoch, scale, weather) lives in worldclock.json beside the server (runtime, gitignored).
// Other modules ask globalThis.__dboClock for the hour, night, full moon and a player's weather.
'use strict';

module.exports = (api) => {
  const fs = require('fs');
  const path = require('path');
  const { mp, log, personal, system, registerChatCommand, sendPacket, onlineActors, every, zoneOfActor, audit, who, cfg } = api;

  const C = Object.assign({
    timeScale: 6,               // game minutes per real minute: a game day every 4 real hours
    // The year the calendar started in. The server's lore is set in 4E 211 (the Discord lore archives), ten years after
    // the vanilla game's 4E 201, which this clock used to start from (/time said 4E 201)
    startYear: 211,
    broadcastSeconds: 20,
    // The hour a player in character creation sees (the Realm's Sovngarde climate is dark 20:30-05:30); -1 turns it off
    creatorHour: 12,
    weatherHours: [2, 5],       // a weather lasts this many game hours
    // Chance of each kind per zone; zones not listed use default
    weather: {
      default: [45, 30, 20, 5],
      bruma: [35, 30, 10, 25],
      winterhold: [20, 25, 0, 55], dawnstar: [25, 25, 5, 45], windhelm: [30, 30, 10, 30],
      markarth: [45, 30, 20, 5], falkreath: [30, 35, 30, 5], riften: [40, 30, 25, 5],
    },
    // The exact weathers of each kind, by family (Nate, 17 Oct: "we just need to sync everything"): the server picks one and
    // every client applies that one, never one of its own from the region (the Whiterun region lists no rain by chance, so
    // a rain weather could stay on there for good). Families follow each hold's Obsidian Weathers region (Skyrim.esm ids):
    // [clear, cloudy, rain, snow]
    families: {
      base: [['81a', '10e1f2'], ['12f89', '10e1f1', 'c821e'], ['c821f', 'c8220'], ['4d7fb', 'c8221']],
      tundra: [['10a240', '10e1ee'], ['10a243', '10e1ed'], ['10a242', '10a241'], ['4d7fb']],
      forest: [['10a23b', '10e1ec'], ['10a23f', '10e1eb', '10a23e'], ['10a23d', '10a23c'], ['4d7fb']],
      reach: [['10a237', '10e1ea'], ['10a23a', '10e1e9', '10a239'], ['10a238'], ['4d7fb']],
      snow: [['10a244', '10e1f0'], ['10a245', '10e1ef'], ['c821f'], ['4d7fb', 'c8221']],
      marsh: [['10a230', '10e1e6'], ['10a233', '10e1e5', '10a232'], ['10a231'], ['4d7fb']],
    },
    weatherPlugin: 'Skyrim.esm',
    // Each zone's family; a zone listed here keeps its own weather (the rest share default's)
    zoneFamily: { default: 'base', whiterun: 'tundra', riften: 'forest', falkreath: 'forest', markarth: 'reach', solitude: 'base',
      morthal: 'marsh', windhelm: 'snow', winterhold: 'snow', dawnstar: 'snow', bruma: 'snow' },
  }, cfg.worldClock || {});
  const STATE_PATH = path.resolve('worldclock.json');
  const START_HOUR = 8;

  const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
  const ST = globalThis.__dboWorldClock || (globalThis.__dboWorldClock = readJson(STATE_PATH) || {
    epochRealMs: Date.now(), epochGameDays: START_HOUR / 24, timeScale: C.timeScale, weather: {},
  });
  const save = () => { try { fs.writeFileSync(STATE_PATH + '.tmp', JSON.stringify(ST, null, 1)); fs.renameSync(STATE_PATH + '.tmp', STATE_PATH); } catch (e) { log('worldclock.json write failed', e.message); } };

  const gameDays = () => ST.epochGameDays + (Date.now() - ST.epochRealMs) * ST.timeScale / 86400000;
  // Moving the clock moves the epoch, so nothing else needs saving
  const setGameDays = (d) => { ST.epochRealMs = Date.now(); ST.epochGameDays = d; save(); };
  const hour = () => { const d = gameDays(); return (d - Math.floor(d)) * 24; };
  const isNight = () => { const h = hour(); return h >= 20 || h < 6; };
  // The engine's moons, which the client draws from the GameDaysPassed it is sent: eight phases of three days (every
  // climate in the load order has phase length 3), phase 0 full at day 0 (CommonLibSSE RE::Moon::Phase, CS wiki Climates)
  const moonPhase = () => ((Math.floor(gameDays() / 3) % 8) + 8) % 8;
  const isFullMoon = () => moonPhase() === 0;
  const PHASES = ['full', 'waning gibbous', 'third quarter', 'waning crescent', 'new', 'waxing crescent', 'first quarter', 'waxing gibbous'];

  // The engine's weekday: whole GameDaysPassed mod 7, 0 Sundas (CommonLibSSE RE::Calendar::GetDayOfWeek; client calendar.ts weekdayOf)
  const WEEKDAYS = ['Sundas', 'Morndas', 'Tirdas', 'Middas', 'Turdas', 'Fredas', 'Loredas'];
  const weekday = () => ((Math.floor(gameDays()) % 7) + 7) % 7;
  const MONTHS = ['Morning Star', "Sun's Dawn", 'First Seed', "Rain's Hand", 'Second Seed', 'Midyear', "Sun's Height", 'Last Seed', 'Hearthfire', 'Frostfall', "Sun's Dusk", 'Evening Star'];
  const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const calendar = () => {
    let year = Math.floor(Number(C.startYear)) || 211, month = 7, day = 17 + Math.floor(gameDays());
    while (day > MONTH_DAYS[month]) { day -= MONTH_DAYS[month]; month++; if (month > 11) { month = 0; year++; } }
    return { year, month, day };
  };
  const clockText = () => {
    const c = calendar(); const h = hour(); const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}, ${WEEKDAYS[weekday()]} ${c.day} ${MONTHS[c.month]} 4E ${c.year}. The moons are ${PHASES[moonPhase()]}.`;
  };

  // ---- weather -------------------------------------------------------------------------------------
  const KINDS = ['clear', 'cloudy', 'rain', 'snow'];
  const pick = (weights) => { const w = Array.isArray(weights) && weights.length === 4 ? weights : C.weather.default; const total = w.reduce((n, x) => n + x, 0) || 1; let r = Math.random() * total; for (let i = 0; i < 4; i++) { r -= w[i]; if (r < 0) return i; } return 0; };
  const keyOf = (zone) => (zone && (C.weather[zone] || (C.zoneFamily || {})[zone]) ? zone : 'default');
  // One exact weather of the kind from the zone's family ("hex:Plugin"), falling back as the client did (clear->cloudy,
  // rain->snow->cloudy, snow->rain->cloudy); '' when the family has none
  const FALLBACK = { 0: [0, 1], 1: [1, 0], 2: [2, 3, 1], 3: [3, 2, 1] };
  const idFor = (key, kind) => {
    const fam = (C.families || {})[(C.zoneFamily || {})[key] || (C.zoneFamily || {}).default];
    if (!Array.isArray(fam)) return '';
    for (const k of FALLBACK[kind] || [kind]) {
      const list = fam[k];
      if (Array.isArray(list) && list.length) return `${list[Math.floor(Math.random() * list.length)]}:${C.weatherPlugin || 'Skyrim.esm'}`;
    }
    return '';
  };
  const stateOf = (zone) => {
    const key = keyOf(zone);
    const now = gameDays();
    let w = ST.weather[key];
    if (!w || now >= w.untilDays) {
      const [lo, hi] = C.weatherHours;
      const kind = pick(C.weather[key]);
      w = ST.weather[key] = { kind, id: idFor(key, kind), untilDays: now + (lo + Math.random() * (hi - lo)) / 24, forced: false };
      save();
    } else if (!w.id) { w.id = idFor(key, w.kind); save(); }
    return w;
  };
  const weatherOf = (zone) => stateOf(zone).kind;
  const zoneOf = (a) => { try { return zoneOfActor(a); } catch (e) { return null; } };
  const weatherFor = (a) => weatherOf(zoneOf(a));
  const weatherIdFor = (a) => stateOf(zoneOf(a)).id || '';

  // A player in character creation is sent the noon nearest now, running at real time; only their packet changes, the
  // world clock and everything read from it server-side (night, the moons, sunlight) do not
  const inCreator = (a) => { try { return typeof api.inCreator === 'function' && api.inCreator(a) === true; } catch (e) { return false; } };
  const clockFor = (a) => {
    const d = gameDays();
    const h = Number(C.creatorHour);
    if (!(h >= 0 && h < 24) || !inCreator(a)) return { gameDays: d, timeScale: ST.timeScale };
    return { gameDays: Math.round(d - h / 24) + h / 24, timeScale: 1 };
  };
  // startYear sets the engine's year (client calendar.ts); the engine derives the weekday and the moons from gameDays itself
  const packetFor = (a) => Object.assign({ customPacketType: 'dboClock', serverNow: Date.now() }, clockFor(a), { weather: weatherFor(a), weatherId: weatherIdFor(a), startYear: Math.floor(Number(C.startYear)) || 211 });
  const broadcast = () => { for (const a of onlineActors()) sendPacket(a, packetFor(a)); };
  every('worldClock', C.broadcastSeconds * 1000, broadcast);

  globalThis.__dboClock = {
    gameDays, hour, isNight, isFullMoon, moonPhase, weekday, weekdayName: () => WEEKDAYS[weekday()], weatherFor, text: clockText, sendTo: (a) => sendPacket(a, packetFor(a)),
    // For the launcher Stats window (worldstats.js)
    summary: () => { const c = calendar(); return { gameDays: gameDays(), timeScale: ST.timeScale, hour: hour(), day: c.day, month: MONTHS[c.month], year: c.year, weekday: weekday(), weekdayName: WEEKDAYS[weekday()], phase: moonPhase(), phaseName: PHASES[moonPhase()], night: isNight(), weather: KINDS[weatherOf('bruma')] }; },
  };

  registerChatCommand('time', (a) => personal(a, `It is ${clockText()}`), { help: 'the time, date and the moons' });
  registerChatCommand('settime', (a, args) => {
    const h = Number(String(args || '').trim());
    if (!(h >= 0 && h < 24)) return personal(a, 'Usage: /settime <hour 0-23.99>');
    const d = gameDays(); setGameDays(Math.floor(d) + (h < hour() ? 1 : 0) + h / 24);
    broadcast(); audit(`CLOCK ${who(a)} set the hour to ${h}`); personal(a, `It is now ${clockText()}`);
  }, { admin: true, help: '<hour> move the world clock forward to that hour' });
  registerChatCommand('timescale', (a, args) => {
    const s = Number(String(args || '').trim());
    if (!(s >= 1 && s <= 120)) return personal(a, `Usage: /timescale <1-120> (now ${ST.timeScale})`);
    setGameDays(gameDays()); ST.timeScale = s; save(); broadcast();
    audit(`CLOCK ${who(a)} set the timescale to ${s}`); personal(a, `Time now runs ${s}x (a game day every ${(24 / s).toFixed(1)} real hours).`);
  }, { admin: true, help: '<1-120> game minutes per real minute' });
  registerChatCommand('setweather', (a, args) => {
    const [kindName, hours] = String(args || '').trim().split(/\s+/);
    const kind = KINDS.indexOf(String(kindName || '').toLowerCase());
    if (kind < 0) return personal(a, `Usage: /setweather <${KINDS.join('|')}> [game hours]`);
    let z = null; try { z = zoneOfActor(a); } catch (e) { /* default */ }
    const key = keyOf(z);
    ST.weather[key] = { kind, id: idFor(key, kind), untilDays: gameDays() + (Number(hours) > 0 ? Number(hours) : 3) / 24, forced: true }; save(); broadcast();
    audit(`CLOCK ${who(a)} set the ${key} weather to ${KINDS[kind]}`); personal(a, `${KINDS[kind]} over ${key} for ${Number(hours) > 0 ? Number(hours) : 3} game hours.`);
  }, { admin: true, help: '<clear|cloudy|rain|snow> [game hours] weather where you stand' });

  if (!fs.existsSync(STATE_PATH)) save();
  log(`worldclock on: ${clockText()} timescale ${ST.timeScale}, weather zones ${Object.keys(C.weather).length}`);
};
