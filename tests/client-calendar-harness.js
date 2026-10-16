// The client's calendar (fork client-worldclock-year, skymp5-client calendar.ts, used by TimeService): the engine's year
// comes from the server's dboClock packet (startYear, 4E 211 by the server's lore) instead of the engine's own 4E 201, so
// the Wait menu and the journal agree with /time. A packet with no or a nonsense startYear means 211. The weekday and the
// moon phase (clock-sync-1016) are checked against worldclock.js.
//   node tests/client-calendar-harness.js <bundled calendar.js>   (from server/; run-all bundles it from FORK)
'use strict';
const fs = require('fs');
const path = require('path');
const bundle = process.argv[2];
if (!bundle) { console.error('usage: node tests/client-calendar-harness.js <bundled calendar.js>'); process.exit(2); }
if (!fs.statSync(bundle).size) { require('./expect')('client-calendar', 'this client has no calendar module'); console.log('ok   skipped: this client has no calendar module yet (before client-worldclock-year)'); process.exit(0); }
const { calendarOf, startYearOf, DEFAULT_START_YEAR, MONTH_DAYS, weekdayOf, moonPhaseOf, WEEKDAYS } = require(path.resolve(bundle));
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

ok(DEFAULT_START_YEAR === 211, 'the default start year is 4E 211');
ok(JSON.stringify(calendarOf(0.5)) === JSON.stringify({ year: 211, month: 7, day: 17 }), 'day 0 is 17 Last Seed 4E 211', calendarOf(0.5));
ok(JSON.stringify(calendarOf(136.9)) === JSON.stringify({ year: 211, month: 11, day: 31 }), '136 days on is 31 Evening Star 4E 211', calendarOf(136.9));
ok(JSON.stringify(calendarOf(137)) === JSON.stringify({ year: 212, month: 0, day: 1 }), 'the next day is 1 Morning Star 4E 212', calendarOf(137));
ok(calendarOf(137 + 365).year === 213, 'a full year later is 4E 213 (365 days, no leap day)', calendarOf(137 + 365));
ok(MONTH_DAYS.reduce((n, d) => n + d, 0) === 365, 'the months add to 365');
ok(calendarOf(0, 215).year === 215, 'a start year from the server is used');
ok(startYearOf(211) === 211 && startYearOf('211') === 211 && startYearOf(215.7) === 215, "the packet's startYear is read");
ok([undefined, null, 'soon', NaN, 0, -5, 5000].every((v) => startYearOf(v) === 211), 'a missing or nonsense startYear (an older server) means 211');
// The server's own calendar (worldclock.js) must name the same day for the same GameDaysPassed
const src = fs.readFileSync(path.resolve(__dirname, '..', 'worldclock.js'), 'utf8');
ok(/month = 7, day = 17 \+ Math\.floor\(gameDays\(\)\)/.test(src) && /startYear: 211/.test(src), "the server's calendar starts on the same day and year (worldclock.js)");


// The weekday and the moons (clock-sync-1016): a client that has them must name what the server's clock names
if (typeof weekdayOf !== 'function' || typeof moonPhaseOf !== 'function') {
  console.log('ok   skipped: this client has no weekdayOf/moonPhaseOf yet (before clock-sync-1016)');
} else {
  ok(WEEKDAYS[weekdayOf(0)] === 'Sundas' && WEEKDAYS[weekdayOf(0.99)] === 'Sundas' && WEEKDAYS[weekdayOf(1)] === 'Morndas', 'day 0 is Sundas and day 1 Morndas (the engine: whole GameDaysPassed mod 7)');
  let steps = true;
  for (let d = 0; d < 400; d++) if (weekdayOf(d + 1) !== (weekdayOf(d) + 1) % 7 || weekdayOf(d + 0.999) !== weekdayOf(d)) steps = false;
  ok(steps, 'the weekday steps one a day for 400 days, never repeating or skipping, and holds all day');
  ok(weekdayOf(NaN) === 0 && weekdayOf(-1) === 6, 'a nonsense or negative day stays in 0-6');
  ok(moonPhaseOf(0) === 0 && moonPhaseOf(2.99) === 0 && moonPhaseOf(3) === 1 && moonPhaseOf(12) === 4 && moonPhaseOf(24) === 0, 'the moons: full at day 0, three days a phase, new at day 12, full again at day 24');
  delete globalThis.__dboWorldClock; delete globalThis.__dboClock;
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-calendar-'));
  const cwd = process.cwd(); process.chdir(dir);
  const realNow = Date.now; let now = 1790000000000; Date.now = () => now;
  let same = true, firstBad = null;
  try {
    for (const g of [0, 0.5, 1, 6.9, 7, 11.99, 12, 23.5, 24, 137.2, 400.75, 1000.1]) {
      fs.writeFileSync('worldclock.json', JSON.stringify({ epochRealMs: now, epochGameDays: g, timeScale: 6, weather: {} }));
      delete globalThis.__dboWorldClock; delete globalThis.__dboClock;
      const MOD = path.resolve(__dirname, '..', 'worldclock.js'); delete require.cache[MOD];
      require(MOD)({ mp: { get: () => null, set: () => {} }, log: () => {}, personal: () => {}, system: () => {}, registerChatCommand: () => {},
        sendPacket: () => {}, onlineActors: () => [], every: () => {}, zoneOfActor: () => null, audit: () => {}, who: String, cfg: {} });
      const s = globalThis.__dboClock.summary(), c = calendarOf(g, 211);
      const match = s.weekday === weekdayOf(g) && s.phase === moonPhaseOf(g) && s.day === c.day && s.year === c.year && s.month === ['Morning Star', "Sun's Dawn", 'First Seed', "Rain's Hand", 'Second Seed', 'Midyear', "Sun's Height", 'Last Seed', 'Hearthfire', 'Frostfall', "Sun's Dusk", 'Evening Star'][c.month];
      if (!match && !firstBad) firstBad = { g, server: s, client: { ...c, weekday: weekdayOf(g), phase: moonPhaseOf(g) } };
      same = same && match;
    }
  } finally { Date.now = realNow; process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true }); }
  ok(same, "the server's clock (worldclock.js) names the same weekday, moon phase and date for the same GameDaysPassed", firstBad || undefined);
}

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
