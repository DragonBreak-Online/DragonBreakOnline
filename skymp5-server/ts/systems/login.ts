import { System, Log, Content, SystemContext } from "./system";
import { Settings } from "../settings";
import type { DiscordGuildConfig } from "../settings";
import * as fetchRetry from "fetch-retry";
import { loginsCounter, loginErrorsCounter } from "./metricsSystem";
import { hasDiscordBanRole } from "./discordBanSystem";
import { kickWithReason } from "./kickUtil";
import { bindRolesToProfile } from "./patronTiers";
import { guidOf } from "./actorUtil";

const loginFailedNotInTheDiscordServer = JSON.stringify({ customPacketType: "loginFailedNotInTheDiscordServer" });
const loginFailedBanned = JSON.stringify({ customPacketType: "loginFailedBanned" });
const loginFailedIpMismatch = JSON.stringify({ customPacketType: "loginFailedIpMismatch" });
const loginFailedSessionNotFound = JSON.stringify({ customPacketType: "loginFailedSessionNotFound" });

// Kick reasons for the master api's 403 session refusals (launch gate and access list)
const loginOutdated = "Your game files are out of date. Close the game and start it again from the DragonBreak launcher to update.";
const loginRefusedReasons: Record<string, string> = {
  clientOutdated: loginOutdated,
  launchCheckMissing: loginOutdated,
  loadOrderMismatch: loginOutdated,
  serverLocked: "The server is closed to players right now. Please try again later.",
  notWhitelisted: "Your Discord account does not have access to this server yet.",
  legalNotAccepted: "Please accept the Terms of Service in the launcher. Update the launcher if you don't see them.",
};
const loginRefusedDefault = "The server refused your login. Start the game again from the DragonBreak launcher, and ask staff if this keeps happening.";

// A session is one URL segment of token characters
const sessionShape = /^[A-Za-z0-9_-]{16,256}$/;
// A session is a credential: a log shows its first 6 characters and its length
const redactSession = (v: unknown): string =>
  typeof v === "string" ? `${v.slice(0, 6).replace(/[^A-Za-z0-9_-]/g, "?")}... (${v.length} chars)` : `<${typeof v}>`;
const withoutSession = (gameData: unknown): unknown =>
  gameData && typeof gameData === "object" && "session" in (gameData as object)
    ? { ...(gameData as Record<string, unknown>), session: redactSession((gameData as Record<string, unknown>).session) }
    : gameData;
const clip = (v: unknown, n = 200): string => {
  let s: string;
  try { s = typeof v === "string" ? v : JSON.stringify(v); } catch { s = "<unprintable>"; }
  s = String(s).replace(/[\r\n]+/g, " ");
  return s.length > n ? `${s.slice(0, n)}... (${s.length} chars)` : s;
};

type Mp = any; // TODO

interface UserProfile {
  id: number;
  discordId: string | null;
  // The backend's own guild lookup for this session: true member, false not, null or missing unknown
  discordMember?: boolean | null;
  roles?: string[];
}

// A 429 on the guild member lookup is retried inside this budget, and never past 10 s into the login (the client waits 15 s)
const discordMemberBudgetMs = 6000;
const discordLoginDeadlineMs = 10000;
const discordMemberMaxTries = 4;
const discordRetryJitterMs = 250;
const discordRetryCapMs = 60000;

type DiscordMemberAnswer =
  | { kind: "member"; status: number; roles: string[] }
  | { kind: "notMember"; status: number }
  | { kind: "unanswered"; status: number };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const headerOf = (response: Response, name: string): string | null => {
  try { return response.headers?.get(name) ?? null; } catch { return null; }
};
const secondsToMs = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return NaN;
  const s = Number(v);
  return Number.isFinite(s) && s >= 0 ? Math.min(s * 1000, discordRetryCapMs) : NaN;
};
// How long Discord asked us to wait: body retry_after, else the Retry-After or X-RateLimit-Reset-After header, else 1 s
const discordRetryAfterMs = async (response: Response): Promise<number> => {
  const body = await response.json().catch((): null => null);
  for (const v of [body?.retry_after, headerOf(response, "retry-after"), headerOf(response, "x-ratelimit-reset-after")]) {
    const ms = secondsToMs(v);
    if (!Number.isNaN(ms)) return ms;
  }
  return 1000;
};

// See NetworkingCombined.h: it implements a hack to prevent the soul-transmission bug
// TODO: reimplement Login system. Preferably, in C++ with clear data flow.
export class Login implements System {
  systemName = "Login";

  // One login per connection: each attempt costs master api and Discord calls
  private loginAttempted = new Set<number>();
  private repeatLoggedAt = 0;
  private repeatCount = 0;

  // Shared by every login: after a 429 the next member lookups wait it out instead of all hitting Discord again
  private discordRetryAt = 0;
  private discordGaps = { reportedAt: 0, limited: 0, passedOnBackend: 0, refused: 0, lastStatus: 0 };

  private reportDiscordGaps(): void {
    const now = Date.now();
    const g = this.discordGaps;
    if (now - g.reportedAt < 60000) return;
    this.log(`Login: Discord rate limited ${g.limited} guild member lookup(s) (HTTP 429); logins Discord left unanswered: ${g.passedOnBackend} let in on the backend's membership answer, ${g.refused} refused (last status ${g.lastStatus}), since the last report`);
    this.discordGaps = { reportedAt: now, limited: 0, passedOnBackend: 0, refused: 0, lastStatus: g.lastStatus };
  }

  private async fetchDiscordMember(guildId: string, discordId: string, botToken: string, deadline: number): Promise<DiscordMemberAnswer> {
    for (let attempt = 1; ; attempt++) {
      const waitMs = this.discordRetryAt - Date.now();
      if (waitMs > 0) {
        if (Date.now() + waitMs > deadline) return { kind: "unanswered", status: 429 };
        await sleep(waitMs + Math.random() * discordRetryJitterMs);
      }
      const response = await this.fetchRetry(
        `https://discord.com/api/guilds/${guildId}/members/${discordId}`,
        {
          method: 'GET',
          headers: { 'Authorization': `Bot ${botToken}` },
          ...this.getFetchOptions('discordAuth_multi'),
        },
      );
      if (response.ok) {
        // The bucket is empty: later lookups wait for its reset rather than draw a 429
        if (headerOf(response, "x-ratelimit-remaining") === "0") {
          const resetMs = secondsToMs(headerOf(response, "x-ratelimit-reset-after"));
          if (!Number.isNaN(resetMs)) this.discordRetryAt = Math.max(this.discordRetryAt, Date.now() + resetMs);
        }
        const responseData = await response.json();
        return { kind: "member", status: response.status, roles: (responseData && responseData.roles) || [] };
      }
      if (response.status === 404) return { kind: "notMember", status: 404 };
      if (response.status !== 429) return { kind: "unanswered", status: response.status };

      const retryAfterMs = await discordRetryAfterMs(response);
      this.discordRetryAt = Math.max(this.discordRetryAt, Date.now() + retryAfterMs);
      this.discordGaps.limited++;
      this.reportDiscordGaps();
      if (attempt >= discordMemberMaxTries || this.discordRetryAt + discordRetryJitterMs > deadline) {
        return { kind: "unanswered", status: 429 };
      }
    }
  }

  connect(userId: number): void {
    this.loginAttempted.delete(userId);
  }

  disconnect(userId: number): void {
    this.loginAttempted.delete(userId);
  }

  constructor(
    private log: Log,
    private maxPlayers: number,
    private masterUrl: string | null,
    private serverPort: number,
    private masterKey: string,
    private offlineMode: boolean
  ) { }

  private getFetchOptions(callerFunctionName: string) {
    return {
      // Retry on network errors or 5xx, capped at 10 attempts; the cap must live in retryOn since fetch-retry ignores 'retries' when retryOn is a function
      retryOn: (attempt: number, error: Error | null, response: Response) => {
        const retry = attempt < 10 && (error !== null || response.status >= 500);
        if (retry) {
          console.log(`${callerFunctionName}: retrying request ${JSON.stringify({ attempt, error: error && error.message, status: response ? response.status : null })}`);
        }
        return retry;
      }
    };
  }

  // The master key is public, so the session check proves it is this game server; the backend can then refuse anyone else (MASTER_SESSION_CHECK_TOKEN)
  private masterAuthHeaders(): Record<string, string> {
    const authToken = this.settingsObject?.allSettings?.["masterApiAuthToken"];
    return typeof authToken === "string" && authToken ? { "X-Auth-Token": authToken } : {};
  }

  private async getUserProfile(session: string, userId: number, ctx: SystemContext, assertSameConnection: (op: string) => void): Promise<UserProfile> {
    const response = await this.fetchRetry(
      `${this.masterUrl}/api/servers/${this.masterKey}/sessions/${encodeURIComponent(session)}`,
      { ...this.getFetchOptions('getUserProfile'), headers: this.masterAuthHeaders() }
    );

    if (!response.ok) {
      if (response.status === 404) {
        assertSameConnection("getUserProfile");
        ctx.svr.sendCustomPacket(userId, loginFailedSessionNotFound);
      } else if (response.status === 403) {
        const body = await response.json().catch(() => ({}));
        const error = String(body?.error || "");
        assertSameConnection("getUserProfile");
        if (error === "banned") {
          ctx.svr.sendCustomPacket(userId, loginFailedBanned);
        } else {
          // The client only reconnects on a silent refusal; a kick shows the reason and closes the game
          try { kickWithReason(ctx.svr as unknown as Mp, userId, loginRefusedReasons[error] || loginRefusedDefault); } catch { }
        }
        throw new Error(`getUserProfile: HTTP error 403 ${error}`);
      }
      throw new Error(`getUserProfile: HTTP error ${response.status}`);
    }

    const data = await response.json();

    if (!data || !data.user || !data.user.id) {
      throw new Error(`getUserProfile: bad master-api response ${JSON.stringify(data)}`);
    }

    return data.user as UserProfile;
  }

  // Backend ban check (discordId/hwid/ip); fails OPEN so a backend outage cannot lock everyone out
  private async checkConnectionAllowed(profileId: number, ip: string): Promise<boolean> {
    try {
      const authToken = this.settingsObject.allSettings ? this.settingsObject.allSettings["masterApiAuthToken"] : undefined;
      if (typeof authToken !== "string" || !authToken) {
        console.warn("checkConnectionAllowed: masterApiAuthToken missing, skipping ban check");
        return true;
      }
      const response = await this.fetchRetry(
        `${this.masterUrl}/api/servers/${this.masterKey}/connection-check`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Token': authToken },
          body: JSON.stringify({ profileId, ip }),
          retryOn: (attempt: number, error: Error | null, response: Response) =>
            attempt < 3 && (error !== null || response.status >= 500),
        },
      );
      if (!response.ok) {
        console.warn(`checkConnectionAllowed: HTTP ${response.status}, failing open`);
        return true;
      }
      const data = await response.json();
      return !(data && data.allowed === false);
    } catch (err) {
      console.warn("checkConnectionAllowed: request failed, failing open:", err);
      return true;
    }
  }

  async initAsync(ctx: SystemContext): Promise<void> {
    this.settingsObject = await Settings.get();

    this.log("Login system: master api key configured");
  }

  customPacket(
    userId: number,
    type: string,
    content: Content,
    ctx: SystemContext,
  ): void {
    if (type !== "loginWithSkympIo") {
      return;
    }

    // The client sends it once per connection; a failed login reconnects
    if (this.loginAttempted.has(userId)) {
      this.repeatCount++;
      const now = Date.now();
      if (now - this.repeatLoggedAt > 60000) {
        this.log(`Login: ignored ${this.repeatCount} repeated login packet(s) in the last minute (latest from user ${userId})`);
        this.repeatLoggedAt = now;
        this.repeatCount = 0;
      }
      return;
    }
    this.loginAttempted.add(userId);

    const ip = ctx.svr.getUserIp(userId);
    console.log(`Connecting a user ${userId} with ip ${ip}`);

    let discordAuth = this.settingsObject.discordAuth;

    const gameData = content["gameData"];
    if (this.offlineMode === false && gameData && gameData.session && (typeof gameData.session !== "string" || !sessionShape.test(gameData.session))) {
      this.log(`Login: refused user ${userId}, the session is not a token: ${redactSession(gameData.session)}`);
      ctx.svr.sendCustomPacket(userId, loginFailedSessionNotFound);
      return;
    }
    if (this.offlineMode === true && gameData && gameData.session) {
      this.log("The server is in offline mode, the client is NOT");
    } else if (this.offlineMode === false && gameData && gameData.session) {
      (async () => {
        const loginStartedAt = Date.now();
        this.emit(ctx, "userAssignSession", userId, gameData.session);

        // A dropped connection's userId goes to the next one and every client shares the relay ip, so only the guid tells them apart
        const guidBeforeAsyncOp = ctx.svr.getUserGuid(userId);
        const assertSameConnection = (op: string): void => {
          const guidAfterAsyncOp = guidOf(ctx.svr, userId);
          if (guidBeforeAsyncOp !== guidAfterAsyncOp) {
            console.error(`User ${userId} changed guid from ${guidBeforeAsyncOp} to ${guidAfterAsyncOp} during async ${op}`);
            throw new Error(`Guid mismatch after ${op}`);
          }
        };

        const profile = await this.getUserProfile(gameData.session, userId, ctx, assertSameConnection);

        console.log({ guidBeforeAsyncOp, guidAfterAsyncOp: guidOf(ctx.svr, userId), op: "getUserProfile" });
        assertSameConnection("getUserProfile");

        console.log("getUserProfileId:", profile);

        if (discordAuth && !discordAuth.botToken) {
          discordAuth = undefined;
          console.error("discordAuth.botToken is missing, skipping Discord server integration");
        }

        if (discordAuth && (!discordAuth.guilds || discordAuth.guilds.length === 0)) {
          discordAuth = undefined;
          console.error("discordAuth.guilds array is missing or empty, skipping Discord server integration");
        }

        // Every master session carries a Discord id; without one the Discord gate below would be skipped
        if (discordAuth && !profile.discordId) {
          ctx.svr.sendCustomPacket(userId, loginFailedNotInTheDiscordServer);
          throw new Error("No discordId in the master api profile");
        }

        if ((ctx.svr as any).onLoginAttempt) {
          const isContinue = (ctx.svr as any).onLoginAttempt(profile.id);
          if (!isContinue) {
            ctx.svr.sendCustomPacket(userId, loginFailedBanned);
            throw new Error("Banned by gamemode");
          }
        }

        // Backend ban store check by discordId/hwid/ip; also records the connecting ip
        const connectionAllowed = await this.checkConnectionAllowed(profile.id, ip);
        assertSameConnection("checkConnectionAllowed");
        if (!connectionAllowed) {
          ctx.svr.sendCustomPacket(userId, loginFailedBanned);
          throw new Error("Banned by backend connection-check");
        }


        let roles: string[] = new Array<string>();

        let fetchedRoles: string[] = [];
        let isMemberOfAny = false;
        let shouldHideIp = false;

        if (discordAuth && discordAuth.botToken && discordAuth.guilds && profile.discordId) {
          let isBanned = false;

          const actorId = ctx.svr.getActorsByProfileId(profile.id)[0];
          const mp = ctx.svr as unknown as Mp;
          // The profile index can hold a deleted character's id; a stale entry must not abort the login (delete-then-relog lockout)
          let currentRoles: string[] | null = null;
          if (actorId) {
            try { currentRoles = mp.get(actorId, "private.discordRoles"); }
            catch { /* form destroyed, ignore */ }
          }

          if (currentRoles && currentRoles.length > 0) {
            roles = currentRoles;
          }

          const takeGuildRoles = (guildConfig: DiscordGuildConfig, guildRoles: string[]) => {
            fetchedRoles = [...fetchedRoles, ...guildRoles];
            if (hasDiscordBanRole(guildConfig, guildRoles)) {
              isBanned = true;
            }
            if (guildConfig.hideIpRoleId && guildRoles.indexOf(guildConfig.hideIpRoleId) !== -1) {
              shouldHideIp = true;
            }
          };

          const unanswered: DiscordGuildConfig[] = [];
          let unansweredStatus = 0;
          const discordDeadline = Math.min(Date.now() + discordMemberBudgetMs, loginStartedAt + discordLoginDeadlineMs);
          for (const guildConfig of discordAuth.guilds) {
            const answer = await this.fetchDiscordMember(guildConfig.guildId, profile.discordId, discordAuth.botToken, discordDeadline);

            if (answer.status === 401 || answer.status === 403) {
              console.error(`discordAuth: Discord API returned ${answer.status} for guild ${guildConfig.guildId} - ` +
                `check that the bot token is valid and Server Members Intent is enabled`);
            }

            if (answer.kind === "member") {
              isMemberOfAny = true;
              takeGuildRoles(guildConfig, answer.roles);
            } else if (answer.kind === "unanswered") {
              unanswered.push(guildConfig);
              unansweredStatus = answer.status;
            }
            assertSameConnection("discordAuth guild member fetch");
          }

          // Only a 404 is "not a member"; when Discord gave no answer, the backend's own lookup for this session decides
          if (!isMemberOfAny && unanswered.length > 0) {
            if (profile.discordMember === true) {
              isMemberOfAny = true;
              const backendRoles = Array.isArray(profile.roles) ? profile.roles.map(String) : [];
              // The backend's discord.js list carries @everyone (id = guild id), which Discord's REST answer never does
              for (const guildConfig of unanswered) takeGuildRoles(guildConfig, backendRoles.filter((r) => r !== guildConfig.guildId));
              this.discordGaps.passedOnBackend++;
              this.reportDiscordGaps();
            } else {
              this.discordGaps.refused++;
              this.discordGaps.lastStatus = unansweredStatus;
              this.reportDiscordGaps();
              ctx.svr.sendCustomPacket(userId, loginFailedNotInTheDiscordServer);
              throw new Error(`Discord did not answer the membership check (HTTP ${unansweredStatus})`);
            }
          }

          if (!isMemberOfAny) {
            ctx.svr.sendCustomPacket(userId, loginFailedNotInTheDiscordServer);
            throw new Error("Not in any of the Discord servers");
          }

          if (isBanned) {
            ctx.svr.sendCustomPacket(userId, loginFailedBanned);
            throw new Error("Banned on one of the Discord servers");
          }

          if (ip !== ctx.svr.getUserIp(userId)) {
            // Not a reuse guard: every client arrives from the relay ip, so a reused userId passes; assertSameConnection is the guard
            ctx.svr.sendCustomPacket(userId, loginFailedIpMismatch);
            throw new Error("IP mismatch");
          }
        }

        if (discordAuth && discordAuth.botToken && discordAuth.guilds) {
          const ipToPrint = shouldHideIp ? "hidden" : ip;
          const actorIds = ctx.svr.getActorsByProfileId(profile.id).map(id => id.toString(16));

          for (const guildConfig of discordAuth.guilds) {
            if (guildConfig.eventLogChannelId) {
              this.postServerLoginToDiscord(guildConfig.eventLogChannelId, discordAuth.botToken, {
                userId,
                ipToPrint,
                actorIds,
                profile,
              });
            }
          }
        }

        // Always a fresh array: it is the key bindRolesToProfile ties to this profile, so it must never be shared
        const rolesToAssign = isMemberOfAny ? [...new Set(fetchedRoles)] : [...roles];

        // Mirror master-api faction access into private.skympAccess; account-level, the same payload applies to every character on this profile
        const skympAccess = {
          permissions: (profile as any).permissions || [],
          gameFactions: (profile as any).gameFactions || [],
          factions: (profile as any).factions || [],
        };
        // Nothing may await between this check and the emit; spawnAllowed carries the guid so its listeners can check it too
        assertSameConnection("login");
        // spawn.ts counts this account's earned character slots through this array (patronTiers.ts earnedSlotsFor)
        bindRolesToProfile(rolesToAssign, profile.id);
        this.emit(ctx, "spawnAllowed", userId, profile.id, rolesToAssign, profile.discordId, skympAccess, guidBeforeAsyncOp);
        loginsCounter.inc();
        this.log("Logged as " + profile.id);
      })()
        .catch((err) => {
          loginErrorsCounter.inc({ reason: err?.message || "unknown" });
          console.error("Error logging in client:", clip(withoutSession(gameData)), err)
        });
    } else if (this.offlineMode === true && gameData && typeof gameData.profileId === "number") {
      let profileId = gameData.profileId;
      const isLoopback = !ip || ip === "127.0.0.1" || ip === "::1" || ip === "localhost" || ip.startsWith("127.");
      const rawAdmin = this.settingsObject?.allSettings?.["adminProfileIds"];
      const adminProfiles = Array.isArray(rawAdmin) ? (rawAdmin as number[]).map(Number) : [1];
      if (!isLoopback && adminProfiles.includes(profileId)) {
        this.log(`Refusing admin profileId ${profileId} from non-loopback IP ${ip} in offline mode`);
        profileId = 1000 + userId;
      }
      const offlineRoles: string[] = [];
      bindRolesToProfile(offlineRoles, profileId);
      this.emit(ctx, "spawnAllowed", userId, profileId, offlineRoles, undefined);
      loginsCounter.inc();
      this.log(userId + " logged as " + profileId);
    } else {
      this.log("No credentials found in gameData:", clip(withoutSession(gameData)));
    }
  }

  private postServerLoginToDiscord(eventLogChannelId: string, botToken: string, options: { userId: number, ipToPrint: string, actorIds: string[], profile: UserProfile }) {
    const { userId, ipToPrint, actorIds, profile } = options;

    const loginMessage = `Server Login: Server Slot ${userId}, IP ${ipToPrint}, Actor ID ${actorIds}, Master API ${profile.id}, Discord ID ${profile.discordId} <@${profile.discordId}>`;
    console.log(loginMessage);

    this.fetchRetry(`https://discord.com/api/channels/${eventLogChannelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: loginMessage,
        allowed_mentions: { parse: [] },
      }),
      ... this.getFetchOptions('discordAuth2'),
    }).then((response) => {
      if (!response.ok) {
        throw new Error(`Error sending message to Discord: ${response.statusText}`);
      }
      return response.json();
    }).then((_data): null => {
      return null;
    }).catch((err) => {
      console.error("Error sending message to Discord:", err);
    });
  }

  private emit(ctx: SystemContext, eventName: string, ...args: unknown[]) {
    (ctx.gm as any).emit(eventName, ...args);
  }

  private settingsObject: Settings;
  private fetchRetry = fetchRetry.default(global.fetch);
}
