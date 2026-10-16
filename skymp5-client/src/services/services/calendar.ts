// The Tamrielic calendar the server's world clock counts (server\worldclock.js), kept free of skyrimPlatform so it can be
// tested on its own. GameDaysPassed 0 is 17 Last Seed of the start year. The server's lore is set in 4E 211, so that is
// the start year unless the dboClock packet names another; before the change the client started from the engine's own
// 4E 201, and the Wait menu and the journal said so.

// Month lengths as the engine counts them (Morning Star = 0)
export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const DEFAULT_START_YEAR = 211;
const START_MONTH = 7, START_DAY = 17;

// The start year a dboClock packet carries, or the default for a missing or nonsense one (an older server sends none)
export const startYearOf = (value: unknown): number => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= 999 ? n : DEFAULT_START_YEAR;
};

// The date for a GameDaysPassed value, counted from 17 Last Seed of startYear
export const calendarOf = (gameDays: number, startYear: number = DEFAULT_START_YEAR): { year: number; month: number; day: number } => {
  let year = startYear, month = START_MONTH, day = START_DAY + Math.floor(gameDays);
  while (day > MONTH_DAYS[month]) {
    day -= MONTH_DAYS[month];
    month++;
    if (month > 11) { month = 0; year++; }
  }
  return { year, month, day };
};

// The engine's weekday: whole GameDaysPassed mod 7, 0 Sundas (CommonLibSSE RE::Calendar::GetDayOfWeek); server worldclock.js weekday()
export const WEEKDAYS = ["Sundas", "Morndas", "Tirdas", "Middas", "Turdas", "Fredas", "Loredas"];
export const weekdayOf = (gameDays: number): number => {
  const d = Math.floor(Number(gameDays));
  return Number.isFinite(d) ? ((d % 7) + 7) % 7 : 0;
};

// The moons' phase as the engine draws it: three days a phase (every Bruma and Skyrim climate), eight phases, 0 full
export const MOON_PHASES = ["full", "waning gibbous", "third quarter", "waning crescent", "new", "waxing crescent", "first quarter", "waxing gibbous"];
export const moonPhaseOf = (gameDays: number): number => {
  const d = Math.floor(Number(gameDays) / 3);
  return Number.isFinite(d) ? ((d % 8) + 8) % 8 : 0;
};
