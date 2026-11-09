import * as crypto from "crypto";

// Dev server tickets: the backend signs one per launch for a Lead GM or above (skymp5-backend routes/dev-server.js), the dev server checks it offline
// Format: dbodev1.<base64url payload>.<base64url Ed25519 signature over "dbodev1.<payload>">

export const devTicketPrefix = "dbodev1";
export const devTicketAudience = "dbo-dev";
export const devTicketDefaultTiers = ["owner", "dev", "leadgm"];

const maxTicketChars = 4096;
const maxLifetimeSec = 7 * 24 * 3600;
const clockSkewSec = 120;
const b64url = /^[A-Za-z0-9_-]+$/;

export interface DevTicket {
  v: number;
  aud: string;
  p: number;
  d: string;
  u: string;
  t: string;
  r: string[];
  iat: number;
  exp: number;
  n: string;
}

export type DevTicketResult = { ok: true; ticket: DevTicket } | { ok: false; reason: string };

export const looksLikeDevTicket = (v: unknown): boolean => typeof v === "string" && v.startsWith(`${devTicketPrefix}.`);

export function loadDevTicketKey(publicKey: unknown): crypto.KeyObject | null {
  if (typeof publicKey !== "string" || !publicKey.trim()) return null;
  const text = publicKey.trim();
  const key = text.includes("BEGIN PUBLIC KEY")
    ? crypto.createPublicKey(text)
    : crypto.createPublicKey({ key: Buffer.from(text, "base64"), format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`dev ticket key is ${key.asymmetricKeyType}, not ed25519`);
  return key;
}

export function verifyDevTicket(ticket: unknown, key: crypto.KeyObject, nowSec: number, tiers: string[] = devTicketDefaultTiers): DevTicketResult {
  if (typeof ticket !== "string" || ticket.length > maxTicketChars) return { ok: false, reason: "notAString" };
  const parts = ticket.split(".");
  if (parts.length !== 3 || parts[0] !== devTicketPrefix || !b64url.test(parts[1]) || !b64url.test(parts[2])) return { ok: false, reason: "malformed" };
  const sig = Buffer.from(parts[2], "base64url");
  if (sig.length !== 64) return { ok: false, reason: "malformed" };
  let valid = false;
  try { valid = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), key, sig); } catch { valid = false; }
  if (!valid) return { ok: false, reason: "badSignature" };

  let t: DevTicket;
  try { t = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { return { ok: false, reason: "malformed" }; }
  if (!t || typeof t !== "object" || t.v !== 1 || t.aud !== devTicketAudience) return { ok: false, reason: "wrongAudience" };
  if (!Number.isSafeInteger(t.p) || t.p <= 0) return { ok: false, reason: "badProfile" };
  if (typeof t.d !== "string" || !/^\d{5,25}$/.test(t.d)) return { ok: false, reason: "badDiscordId" };
  if (!Number.isSafeInteger(t.iat) || !Number.isSafeInteger(t.exp)) return { ok: false, reason: "badTimes" };
  if (t.iat > nowSec + clockSkewSec || t.exp - t.iat > maxLifetimeSec) return { ok: false, reason: "badTimes" };
  if (t.exp <= nowSec) return { ok: false, reason: "expired" };
  if (typeof t.t !== "string" || !tiers.includes(t.t)) return { ok: false, reason: "tierNotAllowed" };
  const roles = Array.isArray(t.r) ? t.r.filter((r) => typeof r === "string" && /^\d{5,25}$/.test(r)) : [];
  const name = typeof t.u === "string" ? t.u.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 64) : "";
  return { ok: true, ticket: { ...t, r: roles, u: name, n: typeof t.n === "string" ? t.n.slice(0, 64) : "" } };
}
