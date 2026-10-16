import { ClientListener, CombinedController, Sp } from "./clientListener";
import { sendCustomPacket } from "./customPacketUtil";
import { NetworkingService } from "./networkingService";
import { DBO_CLIENT_VERSION, ErrorDigest, TraceGate } from "../../lib/clientDiag";

// The appearance trace ("apr") and client error reports ("cerr") on their way to the server log, through the dboDiag packet
// that gamemode.js writeDiagLines already writes as "[dboDiag] ...". Its own queue and limits, apart from PageInputDiagService.

const FLUSH_MS = 1000;
const LINES_PER_PACKET = 8;
const QUEUE_MAX = 60;
const LOG_NAME = "dbo-diag";
const LOG_MAX_LINES = 400;

type Reporter = (where: unknown, err: unknown, urgent?: boolean) => void;

// Without a listener Node (started with no --unhandled-rejections flag) ends the whole game with exit(1) and no crash log
const installProcessHook = (): void => {
  try {
    const g = globalThis as any;
    if (g.__dboProcessHookVersion >= 2) return;
    const proc = g.process;
    if (!proc || typeof proc.on !== "function") return;
    // An older bundle hot-reloaded under this one keeps its uncaughtExceptionMonitor, which already reports uncaught errors
    const monitorReports = !!g.__dboProcessHookInstalled;
    const report = (where: string, err: unknown): void => {
      try {
        const r = g.__dboReportError as Reporter | undefined;
        if (typeof r === "function") r(where, err, true);
      } catch (e) { /* never in the way of the game going on */ }
    };
    proc.on("unhandledRejection", (reason: unknown) => report("rejection", reason));
    proc.on("uncaughtException", (err: unknown, origin: unknown) => {
      if (!monitorReports) report(origin === "unhandledRejection" ? "rejection" : "uncaught", err);
    });
    g.__dboProcessHookVersion = 2;
    g.__dboProcessHookInstalled = true;
  } catch (e) { /* a runtime without it: no uncaught or rejection reports, the client starts as before */ }
};

export class ClientDiagService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    const g = globalThis as any;
    g.__dboTrace = (text: unknown) => { try { this.trace(String(text)); } catch (e) { /* never throws */ } };
    g.__dboReportError = ((where: unknown, err: unknown, urgent?: boolean) => {
      try { this.reportError(where, err, !!urgent); } catch (e) { /* never throws */ }
    }) as Reporter;
    installProcessHook();
    this.controller.on("tick", () => this.flush(Date.now(), false));
    this.controller.emitter.on("connectionAccepted", () => {
      let platform = "?";
      try { platform = String((this.sp as any).getPlatformVersion()); } catch (e) { /* older platform */ }
      this.trace(`client v=${DBO_CLIENT_VERSION} sp=${platform}`);
    });
  }

  private trace(text: string): void {
    const now = Date.now();
    const line = this.traces.admit(text, now);
    if (line) this.queue(line);
  }

  private reportError(where: unknown, err: unknown, urgent: boolean): void {
    const first = this.errors.add(where, err);
    if (first) this.write(first);
    // An uncaught exception may end the process: it goes now
    if (first && urgent) this.flush(Date.now(), true);
  }

  private queue(line: string): void {
    if (this.lines.length >= QUEUE_MAX) { this.dropped++; return; }
    this.lines.push(line);
  }

  private flush(now: number, force: boolean): void {
    try {
      if (!force && now - this.lastFlush < FLUSH_MS) return;
      this.lastFlush = now;
      const stats = this.traces.stats(now);
      if (stats) this.queue(stats);
      if (this.dropped && this.lines.length < QUEUE_MAX) { this.lines.push(`apr stats queue full, ${this.dropped} line(s) dropped`); this.dropped = 0; }
      if (!this.controller.lookupListener(NetworkingService).isConnected()) return;
      // Error lines are taken only when they can go at once, so the per-minute limit holds on the wire
      const errors = this.errors.drain(now, LINES_PER_PACKET);
      const lines = errors.concat(this.lines.splice(0, LINES_PER_PACKET - errors.length));
      if (!lines.length) return;
      try {
        sendCustomPacket(this.controller, { customPacketType: "dboDiag", lines });
      } catch (e) {
        this.lines.unshift(...lines);
      }
    } catch (e) { /* too early (no networking yet) or anything else: the lines wait */ }
  }

  // Data\Platform\Logs\dbo-diag-logs.txt, which Report a Problem sends
  private write(line: string): void {
    if (this.logged >= LOG_MAX_LINES) return;
    this.logged++;
    try { (this.sp as unknown as { writeLogs: (plugin: string, ...rest: unknown[]) => void }).writeLogs(LOG_NAME, line); } catch (e) { /* older platform */ }
  }

  private traces = new TraceGate();
  private errors = new ErrorDigest();
  private lines: string[] = [];
  private dropped = 0;
  private lastFlush = 0;
  private logged = 0;
}
