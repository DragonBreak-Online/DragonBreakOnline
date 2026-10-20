// The world clock's weekday and moons (clock-sync-1016): the engine names the weekday from whole GameDaysPassed mod 7
// (0 Sundas) and draws the moons from GameDaysPassed (eight phases of three days, 0 full), and the client sets
// GameDaysPassed to the server's gameDays. So /time, the journal and __dboClock must use the same two formulas.
// Loads the real worldclock.js in a scratch folder with a fixed clock.
//   node tests/worldclock-sync-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'worldclock.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worldclock-sync-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const realNow = Date.now;
let now = 1790000000000;
let zoneNow = null;
Date.now = () => now;

const load = (gameDays, worldClock) => {
  fs.writeFileSync('worldclock.json', JSON.stringify({ epochRealMs: now, epochGameDays: gameDays, timeScale: 6, weather: {} }));
  delete globalThis.__dboWorldClock; delete globalThis.__dboClock;
  const said = [], packets = [], cmds = {};
  delete require.cache[MODULE];
  require(MODULE)({
    mp: { get: () => null, set: () => {} }, log: () => {}, personal: (a, t) => said.push(t), system: () => {},
    registerChatCommand: (n, f) => { cmds[n] = f; }, sendPacket: (a, p) => packets.push(p), onlineActors: () => [0xff000014],
    every: () => {}, zoneOfActor: () => zoneNow, audit: () => {}, who: String, cfg: worldClock ? { worldClock } : {},
  });
  const time = () => { said.length = 0; cmds.time(0xff000014, ''); return said[0] || ''; };
  return { time, packets, cmds, clock: globalThis.__dboClock };
};
const WEEKDAYS = ['Sundas', 'Morndas', 'Tirdas', 'Middas', 'Turdas', 'Fredas', 'Loredas'];

// Day 0 (17 Last Seed) is Sundas, as on the vanilla game's first day (UESP Skyrim:Calendar, 4E 201 Last Seed starts on Fredas)
let w = load(0.34);
ok(w.clock.weekday() === 0 && w.clock.weekdayName() === 'Sundas', 'day 0 is Sundas', w.clock.weekday());
ok(/^It is 08:09, Sundas 17 Last Seed 4E 211\. The moons are full\.$/.test(w.time()), '/time names the weekday, the date and the moons', w.time());
ok(w.clock.summary().weekdayName === 'Sundas' && w.clock.summary().weekday === 0, 'the summary (journal, worldstats) carries the weekday');

// A weekday per day boundary: never a repeat or a skip, for 400 days, and the same all day long
let seq = true, bad = null;
for (let d = 0; d < 400 && seq; d++) {
  const a = load(d + 0.999).clock.weekday(), b = load(d + 1).clock.weekday(), m = load(d + 0.5).clock.weekday();
  if (b !== (a + 1) % 7 || m !== a || a !== d % 7) { seq = false; bad = { d, a, b, m }; }
}
ok(seq, 'the weekday steps Sundas..Loredas one a day across 400 day boundaries', bad || undefined);
ok(load(6.5).clock.weekdayName() === 'Loredas' && load(7.01).clock.weekdayName() === 'Sundas', 'Loredas turns to Sundas, not to Morndas twice');

// The moons: three days a phase, full at 0, new at 12, full again at 24
const phases = [0, 2.99, 3, 11.99, 12, 21, 23.99, 24, 48.5].map((g) => load(g).clock.moonPhase());
ok(JSON.stringify(phases) === JSON.stringify([0, 0, 1, 3, 4, 7, 7, 0, 0]), 'moon phases by day: full 0-2, new 12-14, full again from 24', phases);
ok(load(1).clock.isFullMoon() && !load(3).clock.isFullMoon() && load(25).clock.isFullMoon(), 'isFullMoon follows the phase (werewolves, supernatural)');
ok(/The moons are new\./.test(load(13).time()), '/time on day 13 says the moons are new', load(13).time());

// The packet is unchanged for old clients: gameDays drives everything, startYear stays
w = load(5.5);
w.clock.sendTo(0xff000014);
const p = w.packets.find((x) => x && x.customPacketType === 'dboClock');
ok(!!p && p.gameDays === 5.5 && p.startYear === 211 && p.timeScale === 6, 'the dboClock packet still carries gameDays, timeScale and startYear', p);

// Weather sync (Nate, 17 Oct: "we just need to sync everything"): the server picks the exact weather of a zone and every
// client applies it; Whiterun has its own tundra weathers, not a share of the default
{
  const P = (wl, a) => { wl.packets.length = 0; wl.clock.sendTo(a); return wl.packets.find((x) => x && x.customPacketType === 'dboClock'); };
  const TU = ['10a240', '10e1ee', '10a243', '10e1ed', '10a242', '10a241', '4d7fb'];
  w = load(5.5);
  zoneNow = 'whiterun';
  const a1 = P(w, 0xff000014), a2 = P(w, 0xff000015);
  ok(/^[0-9a-f]+:Skyrim\.esm$/.test(a1.weatherId) && TU.includes(a1.weatherId.split(':')[0]), 'weather: Whiterun is sent an exact tundra weather', a1.weatherId);
  ok(a1.weatherId === a2.weatherId && a1.weather === a2.weather, 'weather: every player in Whiterun gets the same one', [a1.weatherId, a2.weatherId]);
  w.cmds.setweather(0xff000014, 'rain');
  const r = P(w, 0xff000014);
  ok(r.weather === 2 && ['10a242', '10a241'].includes(r.weatherId.split(':')[0]), 'weather: /setweather rain in Whiterun sends a tundra rain', r);
  zoneNow = 'solitude';
  const s1 = P(w, 0xff000014);
  ok(s1.weather !== undefined && !TU.slice(0, 6).includes(s1.weatherId.split(':')[0]), 'weather: Solitude keeps its own weather, not Whiterun\'s', s1);
  zoneNow = 'windhelm';
  w.cmds.setweather(0xff000014, 'rain');
  ok(P(w, 0xff000014).weatherId === 'c821f:Skyrim.esm', 'weather: rain over Windhelm is the snow family\'s overcast rain');
  zoneNow = null;
  ok(!!P(w, 0xff000014).weatherId, 'weather: a place with no zone gets the default family');
  w = load(5.5);
  globalThis.__dboWorldClock.weather.default = { kind: 1, untilDays: 99, forced: false };
  zoneNow = null;
  ok(['12f89', '10e1f1', 'c821e'].includes(P(w, 0xff000014).weatherId.split(':')[0]), 'weather: a saved weather from before (no id) gets a cloudy one of its family');
}

Date.now = realNow;
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
