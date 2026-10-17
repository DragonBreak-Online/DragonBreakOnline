import { ClientListener, CombinedController, Sp } from "./clientListener";
import { parseCustomPacket } from "./customPacketUtil";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { Weather } from "skyrimPlatform";
import { logTrace } from "../../logging";
import { calendarOf, startYearOf, DEFAULT_START_YEAR } from "./calendar";

const GAME_YEAR = 0x35, GAME_MONTH = 0x36, GAME_DAY = 0x37, GAME_HOUR = 0x38, GAME_DAYS_PASSED = 0x39, TIME_SCALE = 0x3a;
// A weather kind the region has no weather for falls back along these (0 pleasant, 1 cloudy, 2 rainy, 3 snow)
const WEATHER_FALLBACK: Record<number, number[]> = { 0: [0, 1], 1: [1, 0], 2: [2, 3, 1], 3: [3, 2, 1] };

// Server -> Client: { customPacketType: "dboClock", serverNow, gameDays, timeScale, weather, weatherId, startYear } (server\worldclock.js)
// The server owns the clock, so night, date and moon phase are the same for everyone. weatherId ("hex:Plugin") is the exact
// weather of the player's zone, the same for everyone there; an older server sends only the kind, and the region's own
// list supplies the look. Before the first packet the old real-time clock is used.
export class TimeService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    controller.on("update", () => this.onUpdate());
    controller.emitter.on("customPacketMessage", (e) => this.onClockMessage(e));
  }

  public getTime() {
    if (this.clock) {
      const gameDays = this.gameDaysNow();
      return { newGameHourValue: (gameDays - Math.floor(gameDays)) * 24, date: new Date() };
    }
    const hoursOffsetSetting = this.sp.settings["skymp5-client"]["hoursOffset"];
    const hoursOffset = typeof hoursOffsetSetting === "number" ? hoursOffsetSetting : 0;
    const d = new Date(Date.now() + hoursOffset * 60 * 60 * 1000);
    const newGameHourValue = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600 + d.getUTCMilliseconds() / 3600000;
    return { newGameHourValue, date: d };
  }

  private onClockMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(event);
    if (!content || content["customPacketType"] !== "dboClock") return;
    const gameDays = Number(content["gameDays"]), timeScale = Number(content["timeScale"]), serverNow = Number(content["serverNow"]);
    if (!Number.isFinite(gameDays) || !Number.isFinite(timeScale) || !Number.isFinite(serverNow)) return;
    // The calendar's start year comes from the server (4E 211, the server's lore) and is 211 from one that sends none
    this.clock = { gameDays, timeScale, localAt: Date.now(), startYear: startYearOf(content["startYear"]) };
    const kind = Number(content["weather"]);
    this.weatherKind = Number.isInteger(kind) && kind >= 0 && kind <= 3 ? kind : -1;
    const m = /^([0-9a-fA-F]{1,6}):(.+)$/.exec(String(content["weatherId"] || ""));
    this.weatherId = m ? { id: parseInt(m[1], 16), file: m[2], key: m[0] } : null;
    this.lastTimeUpd = 0;
  }

  private gameDaysNow(): number {
    const c = this.clock!;
    return c.gameDays + (Date.now() - c.localAt) * c.timeScale / 86400000;
  }

  private every2seconds() {
    const g = (id: number) => this.sp.GlobalVariable.from(this.sp.Game.getFormEx(id));
    const gameHour = g(GAME_HOUR), gameDay = g(GAME_DAY), gameMonth = g(GAME_MONTH), gameYear = g(GAME_YEAR), timeScale = g(TIME_SCALE);
    if (!gameHour || !gameDay || !gameMonth || !gameYear || !timeScale) return;

    if (!this.clock) {
      const { newGameHourValue, date } = this.getTime();
      if (Math.abs(gameHour.getValue() - newGameHourValue) >= 1 / 60) {
        gameHour.setValue(newGameHourValue);
        gameDay.setValue(date.getUTCDate());
        gameMonth.setValue(date.getUTCMonth());
        gameYear.setValue(DEFAULT_START_YEAR);
      }
      timeScale.setValue(gameHour.getValue() > newGameHourValue ? 0.6 : 1.2);
      return;
    }

    const daysPassed = g(GAME_DAYS_PASSED);
    const gameDays = this.gameDaysNow();
    const hour = (gameDays - Math.floor(gameDays)) * 24;
    // Two game minutes of drift snaps; less is left to the matching timescale. A year the engine does not show yet (the
    // first packet, or a server that moved its start year) snaps too
    const cal = calendarOf(gameDays, this.clock.startYear);
    if (!daysPassed || Math.abs(daysPassed.getValue() - gameDays) * 24 * 60 >= 2 || gameYear.getValue() !== cal.year) {
      if (daysPassed) daysPassed.setValue(gameDays);
      gameHour.setValue(hour);
      gameDay.setValue(cal.day);
      gameMonth.setValue(cal.month);
      gameYear.setValue(cal.year);
    }
    timeScale.setValue(this.clock.timeScale);
    this.applyWeather();
  }

  private applyWeather() {
    if (this.weatherKind < 0) return;
    const player = this.sp.Game.getPlayer();
    const cell = player ? player.getParentCell() : null;
    if (!player || !cell || cell.isInterior()) { this.appliedKey = ""; return; }
    const current = Weather.getCurrentWeather();
    const place = cell.getFormID().toString(16);
    // The server's exact weather: applied as is, so a region with no weather of the kind cannot keep an old one on
    if (this.weatherId) {
      const exact = Weather.from(this.sp.Game.getFormFromFile(this.weatherId.id, this.weatherId.file));
      if (exact) {
        const key = `${this.weatherId.key}|${place}`;
        if (key === this.appliedKey && current && current.getFormID() === this.appliedWeatherId) return;
        if (!current || current.getFormID() !== exact.getFormID()) exact.setActive(true, place !== this.appliedKey.split("|").pop());
        this.appliedKey = key;
        this.appliedWeatherId = exact.getFormID();
        logTrace(this, "Weather set to", this.weatherId.key);
        return;
      }
    }
    const key = `${this.weatherKind}|${place}`;
    // Re-apply on a new kind, a new cell, or when the region's own weather took over again
    if (key === this.appliedKey && current && current.getFormID() === this.appliedWeatherId) return;
    for (const kind of WEATHER_FALLBACK[this.weatherKind] || [this.weatherKind]) {
      const w = Weather.findWeather(kind);
      if (!w) continue;
      if (!current || current.getFormID() !== w.getFormID()) w.setActive(true, key.split("|")[1] !== this.appliedKey.split("|")[1]);
      this.appliedKey = key;
      this.appliedWeatherId = w.getFormID();
      logTrace(this, "Weather set to kind", kind, "for", this.weatherKind);
      return;
    }
    // No weather of the kind here: let the region's own weather go on rather than keep the last one forced
    if (this.appliedKey !== key) { Weather.releaseOverride(); this.appliedKey = key; this.appliedWeatherId = 0; }
  }

  private onUpdate() {
    if (Date.now() - this.lastTimeUpd <= 2000) return;
    this.lastTimeUpd = Date.now();
    this.every2seconds();
  }

  private lastTimeUpd = 0;
  private clock: { gameDays: number; timeScale: number; localAt: number; startYear: number } | null = null;
  private weatherKind = -1;
  private weatherId: { id: number; file: string; key: string } | null = null;
  private appliedKey = "";
  private appliedWeatherId = 0;
}
