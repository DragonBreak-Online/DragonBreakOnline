// Keep the previous sessions' diagnostic logs. SkyrimPlatform's writeLogs truncates
// Data\Platform\Logs\dbo-diag-logs.txt for each new session, so a relaunch destroyed the evidence - which it
// did on 31 Oct, twice in one evening: the log for the session where Nat could not move, and the log for the
// 171-form crowd at 34 ms/frame, were both gone by the time anyone asked. Diagnosing a crash or a freeze
// almost always means relaunching first, so the one log that matters is the one that is always destroyed.
//
// No SkyrimPlatform API renames a file, but the client's JS runtime does have Node's fs (authService,
// profilingService and sweetCameraEnforcementService all use it, with paths relative to the game root), so the
// shift is done directly.
//
// Separated from the fs calls so a node harness can drive it with a fake.

export const DIAG_LOG = "./Data/Platform/Logs/dbo-diag-logs.txt";
// current + this many older copies
export const DIAG_KEEP = 3;

export interface RotateFs {
  existsSync(p: string): boolean;
  statSync(p: string): { size: number };
  renameSync(from: string, to: string): void;
  unlinkSync(p: string): void;
}

// The name of the nth older copy. 1 is the session just finished.
export const prevName = (base: string, n: number): string =>
  base.replace(/\.txt$/, "") + ".prev" + n + ".txt";

export type RotateResult = "rotated" | "empty" | "absent" | "failed";

// Shifts dbo-diag-logs.txt -> .prev1.txt -> .prev2.txt ... dropping the oldest, so the live name is free for
// this session. Call once, before anything writes a line.
export const rotateDiagLogs = (fsLike: RotateFs, base: string = DIAG_LOG, keep: number = DIAG_KEEP): RotateResult => {
  try {
    if (!fsLike.existsSync(base)) {
      return "absent";
    }
    // An empty file is not worth a slot: SkyrimPlatform may have truncated it before this ran, and rotating
    // nothing would push a real previous session out of the window for no gain.
    let size = 0;
    try {
      size = fsLike.statSync(base).size;
    } catch {
      size = 1; // unreadable stat: assume it has something rather than discard it
    }
    if (size <= 0) {
      return "empty";
    }

    const oldest = Math.max(1, keep - 1);
    // drop the one that would fall off the end
    if (fsLike.existsSync(prevName(base, oldest))) {
      try {
        fsLike.unlinkSync(prevName(base, oldest));
      } catch {
        /* a locked old copy must not stop the shift */
      }
    }
    // shift the rest up, oldest first so nothing is overwritten before it moves
    for (let n = oldest - 1; n >= 1; n--) {
      const from = prevName(base, n);
      if (fsLike.existsSync(from)) {
        try {
          fsLike.renameSync(from, prevName(base, n + 1));
        } catch {
          /* leave it where it is rather than lose it */
        }
      }
    }
    // If prev1 could not be shifted out of the way (locked, or the shift above failed), the slot is still
    // occupied and a rename onto an existing name fails on Windows - which would lose THIS session rather
    // than an older one. The newest log is the valuable one, so the stale copy is sacrificed for it.
    if (fsLike.existsSync(prevName(base, 1))) {
      try {
        fsLike.unlinkSync(prevName(base, 1));
      } catch {
        /* fall through: the rename below will fail and the whole thing returns failed */
      }
    }
    fsLike.renameSync(base, prevName(base, 1));
    return "rotated";
  } catch {
    // Diagnostics must never stop the client starting
    return "failed";
  }
};
