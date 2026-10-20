// Client diagnostics that reach the server log through the existing dboDiag relay: gamemode.js writeDiagLines writes each
// line as "[dboDiag] profile <id> <name> #<tag> <line>" (or "user <n>" before the player has an actor). Two kinds:
//   apr ...   the appearance trace: what the client put on the player's own base and read back, and each RaceMenu
//             face/extras step (ask, answer, apply, capture, upload, refusal). Codes, numbers and hashes only: no names,
//             no paths, no free text.
//   cerr ...  client errors: uncaught exceptions, unhandled rejections, errors thrown in a controller on/once handler and
//             errors a service caught and reported (reportError),
//             deduplicated with counts and at most ERROR_LINES_PER_MINUTE lines a minute.
// No imports, so a harness loads it on its own (tests/client-diag-harness.js). Nothing here ever throws.

// The client build these lines come from (the launcher package version)
export const DBO_CLIENT_VERSION = "0.3.107";
// gamemode.js keeps the first 500 characters of a line
export const DIAG_LINE_MAX = 480;
export const ERROR_LINES_PER_MINUTE = 10;
export const ERROR_FRAMES = 8;
export const ERROR_MESSAGE_MAX = 160;
// Distinct errors remembered per game process; past that they are only counted
export const ERROR_KEYS_MAX = 64;
// A repeated error is reported as a count at most this often
export const ERROR_REPEAT_MS = 60000;
export const TRACE_LINES_PER_MINUTE = 20;
export const TRACE_LINES_PER_PROCESS = 300;
// The same line again for the same step within this long is counted, not sent
export const TRACE_REPEAT_MS = 60000;
export const TRACE_STATS_MS = 300000;

// FNV-1a over UTF-16 code units, 8 hex digits (the same as racemenuPresetPlan hashText)
export const hash8 = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
};

// At most `max` events in any `windowMs`
export class WindowGate {
  constructor(private readonly max: number, private readonly windowMs: number) {}
  take(now: number): boolean {
    while (this.times.length && now - this.times[0] >= this.windowMs) this.times.shift();
    if (this.times.length >= this.max) return false;
    this.times.push(now);
    return true;
  }
  private times: number[] = [];
}

const safeString = (raw: unknown): string => {
  try {
    if (typeof raw === "string") return raw;
    if (raw === undefined) return "undefined";
    if (raw === null) return "null";
    return String(raw);
  } catch (e) {
    return "(unprintable)";
  }
};

// A token that names a file keeps only its last part: a Windows path carries the player's user name
const PATHY = /\\|^[A-Za-z]:|^(?:file|webpack|https?):\/\/|^[^/]*\/[^/]*\//;
const lastPart = (token: string): string => {
  const m = /^([("'`[<]*)(.*?)([)"'`\]>,;.]*)$/.exec(token);
  const lead = m ? m[1] : "", body = m ? m[2] : token, tail = m ? m[3] : "";
  if (!PATHY.test(body)) return token;
  const parts = body.split(/[\\/]+/).filter((p) => p.length > 0);
  return `${lead}${parts.length ? parts[parts.length - 1] : ""}${tail}`;
};

// Everything from a path's first separator to its last on one line: a user or folder name with spaces in it ("C:\Users\A B\",
// "/home/a b/", "D:\Games\N's Skyrim\") is inside the run, so only the file name is left. It runs before the control
// characters become spaces, so a line break ends a run (10 Oct review, client-code required change 1)
const PATH_RUN = /(?:\b[A-Za-z]:|file:\/\/\/?|\\\\)?[\\/][^"`<>|\r\n]*[\\/]/g;

// One line of printable text without paths, at most `max` characters. The input is cut to max * 8 first, so a very long
// message costs no more than a short one (lastPart is quadratic in a token's length)
export const scrubText = (raw: unknown, max: number): string => {
  const s = safeString(raw).slice(0, max * 8).replace(PATH_RUN, "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  const out = s.split(" ").map(lastPart).join(" ");
  return out.length > max ? `${out.slice(0, Math.max(0, max - 3))}...` : out;
};

// The bundle is named "b" in a frame; any other file by its last part. A V8 frame line is a few hundred characters; a longer
// "at ..." line can only come from an error message and is skipped (the frame regex is quadratic in a line's length)
const BUNDLE = "skymp5-client.js";
const FRAME_LINE_MAX = 1024;
const frameOf = (line: string): string | null => {
  if (line.length > FRAME_LINE_MAX) return null;
  const m = /^\s*at\s+(?:(.*?)\s+\()?(.*?):(\d+):(\d+)\)?\s*$/.exec(line);
  if (!m) return null;
  const fn = (m[1] || "").replace(/^(?:async |new )/, "").replace(/^Object\./, "").slice(0, 40) || "?";
  let file = m[2].split(/[\\/]+/).pop() || "?";
  if (file === BUNDLE) file = "b";
  return `${fn}@${file.slice(0, 24)}:${m[3]}:${m[4]}`;
};

// The top `n` frames of a V8 stack, "fn@file:line:col"
export const stackFrames = (stack: unknown, n: number = ERROR_FRAMES): string[] => {
  const out: string[] = [];
  try {
    for (const line of safeString(stack).split("\n")) {
      const f = frameOf(line);
      if (f) out.push(f);
      if (out.length >= n) break;
    }
  } catch (e) { /* no frames */ }
  return out;
};

const messageOf = (err: unknown): string => {
  try {
    if (err && typeof err === "object") {
      const e = err as { name?: unknown; message?: unknown };
      if (typeof e.message === "string") return `${typeof e.name === "string" ? e.name : "Error"}: ${e.message}`;
    }
  } catch (e) { /* fall through */ }
  return `non-error ${typeof err}: ${safeString(err)}`;
};

const stackOf = (err: unknown): string => {
  try {
    if (err && typeof err === "object" && typeof (err as { stack?: unknown }).stack === "string") return (err as { stack: string }).stack;
  } catch (e) { /* none */ }
  return "";
};

interface ErrorEntry {
  id: string;
  where: string;
  msg: string;
  frames: string[];
  n: number;
  reported: number;
  reportedAt: number;
  sent: boolean;
}

// Errors deduplicated by where + message + top frame. The first of each goes out in full (where, message, top frames,
// client version); repeats are counted and reported as "+N" at most once a minute. At most ERROR_LINES_PER_MINUTE
// lines in any minute; a new error waiting for room keeps its place.
export class ErrorDigest {
  constructor(private readonly version: string = DBO_CLIENT_VERSION, perMinute: number = ERROR_LINES_PER_MINUTE) {
    this.gate = new WindowGate(perMinute, 60000);
  }

  // The full line of an error not seen before (for the local log), else null
  add(where: unknown, err: unknown): string | null {
    try {
      const w = scrubText(where, 32).replace(/\s/g, "_") || "?";
      const msg = scrubText(messageOf(err), ERROR_MESSAGE_MAX);
      const frames = stackFrames(stackOf(err));
      const id = hash8(`${w}|${msg}|${frames[0] || ""}`);
      let e = this.entries.get(id);
      if (!e) {
        if (this.entries.size >= ERROR_KEYS_MAX) { this.overflow++; return null; }
        e = { id, where: w, msg, frames, n: 0, reported: 0, reportedAt: 0, sent: false };
        this.entries.set(id, e);
        this.waiting.push(id);
      }
      e.n++;
      return e.n === 1 ? this.firstLine(e) : null;
    } catch (x) {
      return null;
    }
  }

  // The lines to send now, at most `max`; the minute's limit is counted when they are sent, so call it only to send
  drain(now: number, max: number = Infinity): string[] {
    const out: string[] = [];
    try {
      while (this.waiting.length) {
        if (out.length >= max || !this.gate.take(now)) return out;
        const e = this.entries.get(this.waiting.shift() as string);
        if (!e) continue;
        e.sent = true;
        e.reported = e.n;
        e.reportedAt = now;
        out.push(this.firstLine(e));
      }
      for (const e of Array.from(this.entries.values())) {
        if (!e.sent || e.n <= e.reported || now - e.reportedAt < ERROR_REPEAT_MS) continue;
        if (out.length >= max || !this.gate.take(now)) return out;
        out.push(`cerr v=${this.version} id=${e.id} at=${e.where} n=${e.n} +${e.n - e.reported}`);
        e.reported = e.n;
        e.reportedAt = now;
      }
      if (this.overflow && out.length < max && now - this.overflowAt >= ERROR_REPEAT_MS && this.gate.take(now)) {
        this.overflowAt = now;
        out.push(`cerr v=${this.version} more=${this.overflow} distinct errors past ${ERROR_KEYS_MAX}, counted only`);
        this.overflow = 0;
      }
    } catch (x) { /* never throws */ }
    return out;
  }

  private firstLine(e: ErrorEntry): string {
    const head = `cerr v=${this.version} id=${e.id} at=${e.where} n=${e.n} m=${e.msg}`;
    const frames = e.frames.slice();
    let line = frames.length ? `${head} f=${frames.join("<")}` : head;
    while (line.length > DIAG_LINE_MAX && frames.length > 1) { frames.pop(); line = `${head} f=${frames.join("<")}`; }
    return line.slice(0, DIAG_LINE_MAX);
  }

  private gate: WindowGate;
  private entries = new Map<string, ErrorEntry>();
  private waiting: string[] = [];
  private overflow = 0;
  private overflowAt = 0;
}

// Only the characters a trace line is made of: codes, numbers, hex ids and hashes
export const traceSafe = (text: string): string =>
  safeString(text).replace(/[^A-Za-z0-9 =:,.+\-<>/|#_()]/g, "").replace(/\s+/g, " ").trim();

// The appearance trace: at most TRACE_LINES_PER_MINUTE lines a minute and TRACE_LINES_PER_PROCESS a game process; the same
// line again for the same step (its first two words) within TRACE_REPEAT_MS is counted, not sent
export class TraceGate {
  constructor(perMinute: number = TRACE_LINES_PER_MINUTE, private readonly perProcess: number = TRACE_LINES_PER_PROCESS) {
    this.gate = new WindowGate(perMinute, 60000);
  }

  // The line to send ("apr ..."), or null
  admit(text: string, now: number): string | null {
    try {
      const body = traceSafe(text).slice(0, DIAG_LINE_MAX - 4);
      if (!body) return null;
      const step = body.split(" ").slice(0, 2).join(" ");
      const last = this.last.get(step);
      if (last && last.text === body && now - last.at < TRACE_REPEAT_MS) { this.dup++; return null; }
      if (this.sent >= this.perProcess || !this.gate.take(now)) { this.gated++; return null; }
      this.last.set(step, { text: body, at: now });
      if (this.last.size > 64) this.last.delete(this.last.keys().next().value as string);
      this.sent++;
      return `apr ${body}`;
    } catch (e) {
      return null;
    }
  }

  // What was held back, at most once every TRACE_STATS_MS and only when something was
  stats(now: number): string | null {
    if (!this.gated && !this.dup) return null;
    if (now - this.statsAt < TRACE_STATS_MS) return null;
    this.statsAt = now;
    const line = `apr stats sent=${this.sent} gated=${this.gated} same=${this.dup}`;
    this.gated = 0;
    this.dup = 0;
    return line;
  }

  private gate: WindowGate;
  private last = new Map<string, { text: string; at: number }>();
  private sent = 0;
  private gated = 0;
  private dup = 0;
  private statsAt = 0;
}

// For the services: one trace line ("rmp ask have=-"), through ClientDiagService when it is up. Never throws.
export const trace = (text: string): void => {
  try {
    const t = (globalThis as { __dboTrace?: (text: string) => void }).__dboTrace;
    if (typeof t === "function") t(text);
  } catch (e) { /* diagnostics never break the caller */ }
};

// For the services: an error they caught and carry on after, one cerr line at=<where> through ClientDiagService. Never throws.
export const reportError = (where: string, err: unknown): void => {
  try {
    const r = (globalThis as { __dboReportError?: (where: unknown, err: unknown) => void }).__dboReportError;
    if (typeof r === "function") r(where, err);
  } catch (e) { /* diagnostics never break the caller */ }
};

// A short hex id (form ids, actor ids)
export const hex = (n: unknown): string => {
  const v = Number(n);
  return Number.isFinite(v) ? (v >>> 0).toString(16) : "?";
};
