// One diag line per sit at a crafting station: menu opened or not, items moved, crafts sent (grain mill and oven: seated, no craft)
import { hex } from "../../lib/clientDiag";

// Keyword editor ids of crafting stations; chairs and benches have none
export const WORKBENCH_KEYWORD = /^(Crafting|BYOHCrafting|isGrainMill|isCraftingOven|CYRproxy_HF_BYOHCrafting|WICrafting)/i;

// The seat is polled, so a Crafting Menu opened this shortly before the seat is seen still belongs to it
export const MENU_BEFORE_SEAT_MS = 1500;

export interface SeatInfo {
  remoteId: number;
  baseId: number;
  keyword: string;
}

interface Seat {
  localId: number;
  at: number;
  info: SeatInfo | null;
  menuAt: number;
  out: number;
  in: number;
  sent: number;
}

export class WorkbenchDiag {
  // Returns the line for a seat that has just ended; describe runs once per new seat and may throw
  seat(localId: number, now: number, describe: () => SeatInfo | null): string | null {
    const id = localId >>> 0;
    if (this.current && this.current.localId === id) return null;
    const line = this.current ? this.finish(this.current, now) : null;
    this.current = null;
    if (id) {
      let info: SeatInfo | null = null;
      try { info = describe(); } catch (e) { info = null; }
      const menuAt = this.lastMenuAt > 0 && now - this.lastMenuAt <= MENU_BEFORE_SEAT_MS ? this.lastMenuAt : 0;
      this.lastMenuAt = 0;
      this.current = { localId: id, at: now, info, menuAt, out: 0, in: 0, sent: 0 };
    }
    return line;
  }

  menuOpened(now: number): void {
    if (!this.current) this.lastMenuAt = now;
    else if (!this.current.menuAt) this.current.menuAt = now;
  }

  moved(direction: "out" | "in"): void {
    if (!this.current) return;
    if (direction === "out") this.current.out++;
    else this.current.in++;
  }

  // Counts only a report for this seat's furniture
  sent(localId: number): void {
    if (this.current && this.current.localId === localId >>> 0) this.current.sent++;
  }

  private finish(s: Seat, now: number): string | null {
    const keyword = s.info ? s.info.keyword : "";
    // A chair says nothing unless something a bench does happened on it
    if (!keyword && !s.menuAt && !s.out && !s.in && !s.sent) return null;
    const remote = s.info && s.info.remoteId ? hex(s.info.remoteId) : `local:${hex(s.localId)}`;
    const base = s.info && s.info.baseId ? hex(s.info.baseId) : "?";
    const menu = s.menuAt ? (Math.max(0, s.menuAt - s.at) / 1000).toFixed(1) : "no";
    const sat = ((now - s.at) / 1000).toFixed(1);
    return `wb seat ${remote} base=${base} kw=${keyword || "-"} sat=${sat} menu=${menu} out=${s.out} in=${s.in} sent=${s.sent}`;
  }

  private current: Seat | null = null;
  private lastMenuAt = 0;
}
