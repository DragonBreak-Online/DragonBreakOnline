// Why another player's face comes up grey or eyeless (Nate, 12 Oct, after a staff teleport): each player copy's face steps,
// reported once to the server, REPORT_AFTER_MS after the copy was built (or when it is destroyed sooner). Import-free.
//   Client -> Server: npcDrift { kind: "faceSync", ... } at most FACE_SYNC_MAX a session

export const REPORT_AFTER_MS = 10000;
export const FACE_SYNC_MAX = 40;

export interface FaceProbe { exists: boolean; loaded?: boolean; headParts?: number; eyes?: boolean; faceTexture?: boolean }

interface Track {
  remoteId: number; name: string; bornAt: number; expectedHeadParts: number; expectsEyes: boolean;
  requests: number; firstRequestMs: number; skipped: Record<string, number>;
  sent: number; firstSentMs: number; dropped: Record<string, number>; preset: Record<string, number>;
  destroyedMs: number;
}

const tracks = new Map<number, Track>();
export const faceSyncBudget = { sent: 0 };
const bump = (o: Record<string, number>, k: string): void => { o[k] = (o[k] || 0) + 1; };

export const born = (localId: number, remoteId: number, name: string, expectedHeadParts: number, expectsEyes: boolean, now: number): void => {
  tracks.set(localId >>> 0, { remoteId: remoteId >>> 0, name, bornAt: now, expectedHeadParts, expectsEyes, requests: 0, firstRequestMs: -1,
    skipped: {}, sent: 0, firstSentMs: -1, dropped: {}, preset: {}, destroyedMs: -1 });
};
export const tracked = (localId: number): boolean => tracks.has(localId >>> 0);
export const request = (localId: number, now: number): void => {
  const t = tracks.get(localId >>> 0); if (!t) return;
  t.requests++; if (t.firstRequestMs < 0) t.firstRequestMs = now - t.bornAt;
};
export const skip = (localId: number, reason: string): void => { const t = tracks.get(localId >>> 0); if (t) bump(t.skipped, reason); };
export const sent = (localId: number, now: number): void => {
  const t = tracks.get(localId >>> 0); if (!t) return;
  t.sent++; if (t.firstSentMs < 0) t.firstSentMs = now - t.bornAt;
};
export const dropped = (localId: number, reason: string): void => { const t = tracks.get(localId >>> 0); if (t) bump(t.dropped, reason); };
export const preset = (localId: number, what: string): void => { const t = tracks.get(localId >>> 0); if (t) bump(t.preset, what); };
export const destroyed = (localId: number, now: number): void => { const t = tracks.get(localId >>> 0); if (t && t.destroyedMs < 0) t.destroyedMs = now - t.bornAt; };

// The lines due now: a copy REPORT_AFTER_MS old, or destroyed; each once, and none once the session's budget is spent
export const due = (now: number, probe: (localId: number) => FaceProbe): Record<string, unknown>[] => {
  const out: Record<string, unknown>[] = [];
  const ready: number[] = [];
  tracks.forEach((t, id) => { if (t.destroyedMs >= 0 || now - t.bornAt >= REPORT_AFTER_MS) ready.push(id); });
  for (const id of ready) {
    const t = tracks.get(id) as Track;
    tracks.delete(id);
    if (faceSyncBudget.sent >= FACE_SYNC_MAX) continue;
    faceSyncBudget.sent++;
    const p = t.destroyedMs >= 0 ? { exists: false } : probe(id);
    out.push({
      kind: "faceSync", remoteId: t.remoteId.toString(16), localId: id.toString(16), name: t.name, ageMs: now - t.bornAt,
      requests: t.requests, firstRequestMs: t.firstRequestMs, skipped: t.skipped, sent: t.sent, firstSentMs: t.firstSentMs,
      dropped: t.dropped, preset: t.preset, destroyedMs: t.destroyedMs,
      expectedHeadParts: t.expectedHeadParts, expectsEyes: t.expectsEyes, probe: p,
    });
  }
  return out;
};
