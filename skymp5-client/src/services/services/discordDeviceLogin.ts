// In-game Discord sign-in (backend docs/launcher_login.md): the backend issues the state and a code typed on its page, and only this game's device code collects the result
import { MasterApiAuthStatus } from "../messages_http/masterApiAuthStatus";

export interface DeviceLogin {
  state: string;
  deviceCode: string;
  userCode: string;
  intervalMs: number;
  deadline: number;
}

export type PollOutcome = { kind: "done"; auth: MasterApiAuthStatus } | { kind: "pending" } | { kind: "expired" } | { kind: "retry" };

const SECRET_RE = /^[0-9a-f]{64}$/;
const USER_CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export const startRoute = "/api/users/login-discord/start";
export const pollRoute = "/api/users/login-discord/poll";
export const startBody = (): string => JSON.stringify({ client: "game" });
export const pollBody = (login: DeviceLogin): string => JSON.stringify({ state: login.state, device_code: login.deviceCode });

// The backend's answer to /start, or null when it is not one; the interval is kept between 2 and 10 s
export function parseStart(status: number, body: string, now: number): DeviceLogin | null {
  if (status !== 200) return null;
  let data: any;
  try { data = JSON.parse(body); } catch { return null; }
  if (!data || typeof data.state !== "string" || !SECRET_RE.test(data.state)) return null;
  if (typeof data.deviceCode !== "string" || !SECRET_RE.test(data.deviceCode)) return null;
  if (typeof data.userCode !== "string" || !USER_CODE_RE.test(data.userCode)) return null;
  const interval = Number.isFinite(data.interval) ? Math.min(10, Math.max(2, data.interval)) : 3;
  const expiresIn = Number.isFinite(data.expiresIn) && data.expiresIn > 0 ? data.expiresIn : 600;
  return { state: data.state, deviceCode: data.deviceCode, userCode: data.userCode, intervalMs: interval * 1000, deadline: now + expiresIn * 1000 };
}

// The browser page this login opens; only the state goes into a URL, never the device code
export const loginUrl = (masterUrl: string, login: DeviceLogin): string =>
  `${masterUrl.replace(/\/+$/, "")}/api/users/login-discord?state=${login.state}`;

// One poll's answer: 200 the result, 401 still waiting, 403 expired or unknown, anything else is retried until the deadline
export function pollOutcome(status: number, body: string): PollOutcome {
  if (status === 200) {
    try {
      const auth = JSON.parse(body) as MasterApiAuthStatus;
      if (auth && typeof auth.token === "string" && auth.token) return { kind: "done", auth };
    } catch { /* retried */ }
    return { kind: "retry" };
  }
  if (status === 401) return { kind: "pending" };
  if (status === 403) return { kind: "expired" };
  return { kind: "retry" };
}
