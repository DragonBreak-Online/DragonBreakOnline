import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Settings } from "../settings";
import { System, Log, SystemContext, Content } from "./system";
import { userOf } from "./actorUtil";

// The ScampServer / `mp` API is untyped here, same convention as spawn.ts.
type Mp = any;

// ── Proximity voice chat (LiveKit) ───────────────────────────────────────────
//
// The client asks for a room token after login; the server mints a LiveKit HS256 access token whose identity is the player's server-side actor id in hex.
// Clients already know every remote player's refrId, so they match LiveKit participants to actors and gate volume by distance; server-side minting means identities cannot be spoofed.
//
// Wire protocol (CustomPacket JSON):
//   Client -> Server: { customPacketType: "voiceTokenRequest", caps?: { hearingLists?: 1 } }
//   Server -> Client: { customPacketType: "voiceToken", enabled, url?, token?,
//                       room?, identity?, modes?, hearers? }
//   Server -> Client: { customPacketType: "voiceHearers", bands: { <mode key>: [identity, ...] } }
// hearers and bands go only to a client that sent caps.hearingLists: who may hear it in each mode, from the server's positions.
// Its page makes the list for its mode its LiveKit track subscription permissions, which LiveKit enforces on every listener.
//
// Settings (server-settings.json "voiceChat" object):
//   { "enabled": true, "url": "ws://host:7880", "apiKey": "...",
//     "apiSecret": "...", "room": "dragonbreak", "rangeUnits": 2000,
//     "apiUrl": "http://host:7880", "sweepSeconds": 15, "moveRoomOnReplay": true,
//     "hearingLists": true, "hearingTickMs": 500, "hearingPadUnits": 350 }
// hearingLists: false = no lists, every voice is open to the whole room as before (the fallback).
// hearingTickMs: how often the lists are worked out; hearingPadUnits: how far past a mode's range a listener is let in early.
// rangeUnits falls back to chatRanges.say, then 2000 game units.
// apiUrl is optional: the LiveKit server API base the game server calls, by default url with ws(s) turned into http(s).
// sweepSeconds: the longest gap between checks of the room for sessions no online character may hold, each gap random from half of it (0 = never).
// moveRoomOnReplay: a removed session back twice moves voice to a new room (kept in voice-room.json); false = only remove it.

// LiveKit keeps a live session supplied with refreshed tokens, so this bounds only a copied token; the disconnect removal and the sweep end sessions
const TOKEN_TTL_SECONDS = 10 * 60;
const ADMIN_TOKEN_TTL_SECONDS = 60;
const API_TIMEOUT_MS = 5000;
const DEFAULT_SWEEP_SECONDS = 15;
const MAX_USER_SLOTS = 1024;
const ROOM_FILE = "voice-room.json";
// Removals before a session seen again counts as a replayed token: an honest client never rejoins after one
const REPLAY_REMOVALS = 2;
// Long, so a replayer cannot wait out its count between short rejoins; an allowed sighting clears it at once
const REPLAY_MEMORY_MS = 24 * 60 * 60 * 1000;
const DRAIN_GRACE_MS = 10 * 1000;
const DRAIN_MS = 2 * 60 * 1000;
const DEFAULT_HEARING_TICK_MS = 500;
const DEFAULT_HEARING_PAD_UNITS = 350;
// A listener's page drops a speaker past its range x 1.15 (VoiceManager UNSUB_HYSTERESIS); a list reaches that plus the pad
const LISTENER_HYSTERESIS = 1.15;
// On a list until this many times the distance that put them on it, so a listener at the edge does not flap
const HEARING_LEAVE_FACTOR = 1.2;
const REFUSAL_CACHE_MS = 10 * 1000;

type Flow = "lists" | "open";
type Bands = Record<string, string[]>;
interface Voice { userId: number; actorId: number; identity: string; cell: number; pos: number[] }

const bandsKey = (bands: Bands): string => Object.keys(bands).map((k) => `${k}:${bands[k].join(",")}`).join("|");
const distance = (a: number[], b: number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function b64url(input: Buffer | string): string {
  return (typeof input === "string" ? Buffer.from(input) : input).toString("base64url");
}

function signHs256(apiSecret: string, payload: Record<string, unknown>): string {
  const body = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.createHmac("sha256", apiSecret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

// Hand-minted LiveKit access token; the payload shape matches livekit-server-sdk.
function mintLiveKitToken(apiKey: string, apiSecret: string, identity: string, room: string): string {
  const now = Math.floor(Date.now() / 1000);
  return signHs256(apiSecret, {
    iss: apiKey,
    sub: identity,
    jti: identity,
    iat: now,
    nbf: now - 10,
    exp: now + TOKEN_TTL_SECONDS,
    name: identity,
    video: { roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true },
  });
}

// Server API token for one RoomService call: admin of this room only, it cannot join it
function mintAdminToken(apiKey: string, apiSecret: string, room: string): string {
  const now = Math.floor(Date.now() / 1000);
  return signHs256(apiSecret, { iss: apiKey, sub: "dragonbreak-game-server", nbf: now - 10, exp: now + ADMIN_TOKEN_TTL_SECONDS, video: { roomAdmin: true, room } });
}

// wss://host/path -> https://host/path, ws:// -> http://
const httpBaseOf = (url: string): string => url.trim().replace(/^ws(s?):\/\//i, "http$1://").replace(/\/+$/, "");

// Error code only: a fetch error's cause carries the address it tried
const errCode = (e: any): string => String(e?.cause?.code || e?.name || "error");

// The room a replay moved voice to, kept across restarts so tokens for the old one stay shut out
function readMovedRoom(base: string): string {
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(ROOM_FILE), "utf8"));
    return raw?.base === base && typeof raw.room === "string" && raw.room.startsWith(`${base}-`) ? raw.room : "";
  } catch {
    return "";
  }
}

function writeMovedRoom(base: string, room: string, log: Log): void {
  const file = path.resolve(ROOM_FILE);
  try {
    fs.writeFileSync(file + ".tmp", JSON.stringify({ base, room, at: new Date().toISOString() }));
    fs.renameSync(file + ".tmp", file);
  } catch (e) {
    log(`VoiceSystem: could not write ${file}: ${e}`);
  }
}

// Why this account may not use voice ("" = it may): a panel ban, wired in index.ts
export type VoiceRefusal = (mp: Mp, userId: number, actorId: number) => string;

export class VoiceSystem implements System {
  systemName = "VoiceSystem";
  constructor(private log: Log, private refusals: VoiceRefusal[] = []) { }

  private enabled = false;
  private url = "";
  private apiKey = "";
  private apiSecret = "";
  private apiBase = "";
  private room = "dragonbreak";
  private baseRoom = "dragonbreak";
  private moveOnReplay = true;
  // identity -> removals while it was not allowed voice, forgotten once it is allowed again
  private removals = new Map<string, { n: number; at: number }>();
  // Rooms voice moved away from -> when to empty them: after a grace for clients to switch, for a while
  private drains = new Map<string, { after: number; until: number }>();
  // userId -> identities minted for that connection; they leave the room when it ends
  private mintedByUser = new Map<number, Set<string>>();
  private apiFailing = false;
  private apiAnswered = false;
  private sweepMs = DEFAULT_SWEEP_SECONDS * 1000;
  private nextSweepAt = 0;
  private sweeping = false;
  private hearingLists = true;
  private hearingTickMs = DEFAULT_HEARING_TICK_MS;
  private hearingPad = DEFAULT_HEARING_PAD_UNITS;
  private nextHearingAt = 0;
  // userId -> how its client asked for voice on this connection
  private flowByUser = new Map<number, Flow>();
  // userId -> the lists last sent to it, for the actor they were worked out for
  private heardBy = new Map<number, { actorId: number; bands: Bands; key: string }>();
  private refusalCache = new Map<number, { actorId: number; at: number; refused: boolean }>();
  // Properties a get failed on once (not registered by the gamemode); a failed get logs a context dump natively, so they are not read again
  private unreadable = new Set<string>();
  // One token per user every 2 s at most (a port of 57503548 without the profile identity): the client asks every 5 s at
  // most (voiceService TOKEN_RETRY_MS), so a faster stream of requests comes from a modified client, and each one signs
  // a token
  private lastMintAt = new Map<number, number>();
  private static readonly MINT_COOLDOWN_MS = 2000;
  // Voice modes cycled in-game with Alt+V; units are game units (70 per meter): whisper 2m, talk 12m, shout 45m by default
  private modes: Array<{ key: string; label: string; units: number }> = [
    { key: "whisper", label: "Whisper", units: 140 },
    { key: "talk", label: "Talk", units: 840 },
    { key: "shout", label: "Shout", units: 3150 },
  ];

  async initAsync(_ctx: SystemContext): Promise<void> {
    const s = await Settings.get();
    const all = s.allSettings as Record<string, any> | null;
    const vc = all?.["voiceChat"];
    if (!vc || typeof vc !== "object") {
      this.log("VoiceSystem: no voiceChat settings, voice disabled");
      return;
    }
    this.url = typeof vc.url === "string" ? vc.url : "";
    this.apiKey = typeof vc.apiKey === "string" ? vc.apiKey : "";
    this.apiSecret = typeof vc.apiSecret === "string" ? vc.apiSecret : "";
    if (typeof vc.room === "string" && vc.room) this.room = vc.room;
    this.baseRoom = this.room;
    this.room = readMovedRoom(this.baseRoom) || this.room;
    this.moveOnReplay = vc.moveRoomOnReplay !== false;
    this.apiBase = httpBaseOf(typeof vc.apiUrl === "string" && vc.apiUrl ? vc.apiUrl : this.url);
    const sweepSeconds = Number(vc.sweepSeconds ?? DEFAULT_SWEEP_SECONDS);
    this.sweepMs = Number.isFinite(sweepSeconds) && sweepSeconds > 0 ? Math.max(5, sweepSeconds) * 1000 : 0;
    this.hearingLists = vc.hearingLists !== false;
    const tick = Number(vc.hearingTickMs ?? DEFAULT_HEARING_TICK_MS);
    this.hearingTickMs = Number.isFinite(tick) ? Math.min(5000, Math.max(200, tick)) : DEFAULT_HEARING_TICK_MS;
    const pad = Number(vc.hearingPadUnits ?? DEFAULT_HEARING_PAD_UNITS);
    this.hearingPad = Number.isFinite(pad) ? Math.min(2000, Math.max(0, pad)) : DEFAULT_HEARING_PAD_UNITS;

    // Optional override: voiceChat.modes = [{ key, label, meters }]
    if (Array.isArray(vc.modes) && vc.modes.length) {
      const parsed: Array<{ key: string; label: string; units: number }> = [];
      for (const m of vc.modes) {
        const key = String(m?.key ?? "");
        const meters = Number(m?.meters);
        const units = Number.isFinite(meters) && meters > 0 ? meters * 70 : Number(m?.units);
        if (key && Number.isFinite(units) && units > 0) {
          parsed.push({ key, label: String(m?.label ?? key), units: Math.round(units) });
        }
      }
      if (parsed.length) this.modes = parsed;
    }

    this.enabled = vc.enabled !== false && !!(this.url && this.apiKey && this.apiSecret);
    (globalThis as any).__dboVoiceEnabled = this.enabled;
    const modeDesc = this.modes.map(m => `${m.label} ${Math.round(m.units / 70)}m`).join(", ");
    this.log(`VoiceSystem: ${this.enabled ? `enabled, room '${this.room}', modes: ${modeDesc}, hearing lists ${this.hearingLists ? "on" : "off (every voice open to the room)"}` : "disabled (missing url/apiKey/apiSecret or enabled=false)"}`);
  }

  // A new connection on the same user slot is not held to the last one's cooldown; every kick and ban ends here too
  disconnect(userId: number, ctx: SystemContext): void {
    this.lastMintAt.delete(userId);
    this.flowByUser.delete(userId);
    this.heardBy.delete(userId);
    this.refusalCache.delete(userId);
    const minted = this.mintedByUser.get(userId);
    this.mintedByUser.delete(userId);
    if (!minted || !this.enabled) return;
    const mp = ctx.svr as Mp;
    for (const identity of minted) {
      // A relog that already holds this character on a new connection keeps its voice
      const other = userOf(mp, parseInt(identity, 16));
      if (other >= 0 && other !== userId) continue;
      void this.removeParticipant(identity, "left the game").then((removed) => { if (removed) this.noteRemoval(identity); });
    }
  }

  async updateAsync(ctx: SystemContext): Promise<void> {
    const now = Date.now();
    if (!this.enabled) return;
    this.hearingTick(ctx.svr as Mp, now);
    if (!this.sweepMs || now < this.nextSweepAt || this.sweeping) return;
    // A random gap of half to one interval: a replayer cannot time its exits around a sweep it cannot predict
    const half = Math.floor(this.sweepMs / 2);
    this.nextSweepAt = now + half + crypto.randomInt(half + 1);
    // Not awaited: LiveKit API calls (5 s timeout each) must not hold up this loop, one sweep at a time
    this.sweeping = true;
    this.sweep(ctx.svr as Mp).catch((e) => this.log(`VoiceSystem: room sweep failed: ${e}`)).finally(() => { this.sweeping = false; });
  }

  // Removes every session whose identity is not an online character allowed voice: a kicked or banned player back with an old or LiveKit-refreshed token
  private async sweep(mp: Mp): Promise<void> {
    const now = Date.now();
    for (const [identity, r] of this.removals) if (now - r.at > REPLAY_MEMORY_MS) this.removals.delete(identity);
    const room = this.room;
    const participants = await this.participants(room);
    const allowed = participants.length ? this.allowedIdentities(mp) : new Set<string>();
    for (const identity of participants) {
      if (allowed.has(identity)) { this.removals.delete(identity); continue; }
      // LiveKit hands every join a fresh token, so removing alone never ends a scripted rejoin; the room move does
      if (this.moveOnReplay && room === this.room && (this.removals.get(identity)?.n || 0) >= REPLAY_REMOVALS) this.moveRoom(mp, identity);
      if (await this.removeParticipant(identity, "not an online character allowed voice", room)) this.noteRemoval(identity);
    }
    await this.drainOldRooms(now);
  }

  // Every token names its room, so the replayed ones and all LiveKit refreshed from them stay in the old room; allowed players get a new token at once
  private moveRoom(mp: Mp, culprit: string): void {
    const old = this.room;
    this.room = `${this.baseRoom}-${Date.now().toString(36)}`;
    writeMovedRoom(this.baseRoom, this.room, this.log);
    this.drains.set(old, { after: Date.now() + DRAIN_GRACE_MS, until: Date.now() + DRAIN_MS });
    let sent = 0;
    for (const [userId, identities] of this.mintedByUser) {
      let actorId = 0;
      try { if (mp.isConnected(userId)) actorId = mp.getUserActor(userId); } catch { }
      if (!actorId || !identities.has(actorId.toString(16)) || this.refusal(mp, userId, actorId)) continue;
      if (this.sendToken(mp, userId, actorId)) sent++;
    }
    this.log(`VoiceSystem: ${culprit} keeps rejoining voice while not allowed (a replayed token): voice moved from '${old}' to '${this.room}', ${sent} player(s) sent a new token`);
  }

  // Whoever is still in the old room after the grace: the replayer, or a client that missed its new token (it asks again)
  private async drainOldRooms(now: number): Promise<void> {
    for (const [room, d] of this.drains) {
      if (now > d.until) { this.drains.delete(room); continue; }
      if (now < d.after) continue;
      for (const identity of await this.participants(room)) await this.removeParticipant(identity, "voice moved to a new room", room);
    }
  }

  private async participants(room: string): Promise<string[]> {
    const res = await this.roomService("ListParticipants", { room });
    const list: any[] = Array.isArray(res?.participants) ? res.participants : [];
    return list.map((p) => String(p?.identity ?? "")).filter(Boolean);
  }

  // Only the sweep reads and expires these
  private noteRemoval(identity: string): void {
    if (!this.sweepMs) return;
    this.removals.set(identity, { n: (this.removals.get(identity)?.n || 0) + 1, at: Date.now() });
  }

  private allowedIdentities(mp: Mp): Set<string> {
    const out = new Set<string>();
    for (let userId = 0; userId < MAX_USER_SLOTS; userId++) {
      try {
        if (!mp.isConnected(userId)) continue;
        const actorId = mp.getUserActor(userId);
        if (actorId && !this.refusal(mp, userId, actorId)) out.add(actorId.toString(16));
      } catch { }
    }
    return out;
  }

  // The checks wired in index.ts, then the gamemode's globalThis.__dboVoiceRefused(actorId) (a suspension); a check that throws refuses nothing
  private refusal(mp: Mp, userId: number, actorId: number): string {
    for (const check of this.refusals) {
      try { const why = check(mp, userId, actorId); if (why) return why; } catch { }
    }
    try {
      const hook = (globalThis as any).__dboVoiceRefused;
      const why = typeof hook === "function" ? hook(actorId) : "";
      if (why) return typeof why === "string" ? why : "refused by the gamemode";
    } catch { }
    return "";
  }

  // Sends each client on hearing lists its lists when they changed; nothing to work out while none is
  private hearingTick(mp: Mp, now: number): void {
    if (!this.hearingLists || now < this.nextHearingAt) return;
    this.nextHearingAt = now + this.hearingTickMs;
    let any = false;
    for (const flow of this.flowByUser.values()) if (flow === "lists") { any = true; break; }
    if (!any) return;
    const voices = this.voices(mp, now);
    for (const speaker of voices) {
      if (this.flowByUser.get(speaker.userId) !== "lists") continue;
      const prev = this.heardBy.get(speaker.userId);
      const bands = this.bandsFor(mp, speaker, voices, prev && prev.actorId === speaker.actorId ? prev.bands : null);
      const key = bandsKey(bands);
      if (prev && prev.actorId === speaker.actorId && prev.key === key) continue;
      this.heardBy.set(speaker.userId, { actorId: speaker.actorId, bands, key });
      try {
        mp.sendCustomPacket(speaker.userId, JSON.stringify({ customPacketType: "voiceHearers", bands }));
      } catch { }
    }
  }

  // The lists for a client on them as its token goes out, so its page is closed to everyone else before it publishes; undefined for any other client
  private firstBands(mp: Mp, userId: number, actorId: number): Bands | undefined {
    if (this.flowByUser.get(userId) !== "lists") return undefined;
    const voices = this.voices(mp, Date.now());
    const speaker = voices.find((v) => v.userId === userId && v.actorId === actorId);
    const bands = speaker ? this.bandsFor(mp, speaker, voices, null) : Object.fromEntries(this.modes.map((m) => [m.key, [] as string[]]));
    this.heardBy.set(userId, { actorId, bands, key: bandsKey(bands) });
    return bands;
  }

  // Online characters holding a token minted for them on this connection and allowed voice, with the server's own positions
  private voices(mp: Mp, now: number): Voice[] {
    const out: Voice[] = [];
    for (const [userId, minted] of this.mintedByUser) {
      try {
        if (!mp.isConnected(userId)) continue;
        const actorId = mp.getUserActor(userId);
        if (!actorId) continue;
        const identity = actorId.toString(16);
        if (!minted.has(identity) || this.refusedNow(mp, userId, actorId, now)) continue;
        const pos = mp.getActorPos(actorId);
        if (!Array.isArray(pos) || pos.length < 3) continue;
        out.push({ userId, actorId, identity, cell: mp.getActorCellOrWorld(actorId), pos: [Number(pos[0]), Number(pos[1]), Number(pos[2])] });
      } catch { }
    }
    return out;
  }

  // Per mode, who in the same cell or worldspace is near enough to hear the speaker; a hidden Invisible speaker lists only staff who see them
  private bandsFor(mp: Mp, speaker: Voice, voices: Voice[], prev: Bands | null): Bands {
    const hiddenRank = this.invisibleRank(mp, speaker.actorId);
    const ranks = new Map<number, number>();
    const seen = (l: Voice): boolean => {
      if (!hiddenRank) return true;
      if (!ranks.has(l.actorId)) ranks.set(l.actorId, this.viewerRank(mp, l.actorId));
      return (ranks.get(l.actorId) || 0) >= hiddenRank;
    };
    const bands: Bands = {};
    for (const m of this.modes) {
      const enter = m.units * LISTENER_HYSTERESIS + this.hearingPad;
      const had = new Set(prev?.[m.key] || []);
      const ids: string[] = [];
      for (const l of voices) {
        if (l.identity === speaker.identity || l.cell !== speaker.cell) continue;
        if (distance(l.pos, speaker.pos) > (had.has(l.identity) ? enter * HEARING_LEAVE_FACTOR : enter) || !seen(l)) continue;
        ids.push(l.identity);
      }
      bands[m.key] = ids.sort();
    }
    return bands;
  }

  // The rank a viewer needs to see this actor, 0 when it is not Invisible (adminCopyPolicy.ts adminViewOfModes on the client)
  private invisibleRank(mp: Mp, actorId: number): number {
    const modes = this.readProp(mp, actorId, "ff_adminModes");
    if (!modes || typeof modes !== "object" || !modes.invis) return 0;
    const r = Number(modes.rank);
    return Number.isFinite(r) && r > 0 ? Math.floor(r) : 1;
  }

  // The client's viewerRankOf: the actor's own mirror rank, else 1 for staff and 0 for a player
  private viewerRank(mp: Mp, actorId: number): number {
    const modes = this.readProp(mp, actorId, "ff_adminModes");
    const r = Number(modes && typeof modes === "object" ? modes.rank : undefined);
    if (Number.isFinite(r) && r > 0) return Math.floor(r);
    return this.readProp(mp, actorId, "isAdmin") === true ? 1 : 0;
  }

  // Undefined once unreadable: without ff_adminModes nobody is hidden, without isAdmin only a mirror rank lets a viewer hear a hidden speaker
  private readProp(mp: Mp, actorId: number, name: string): any {
    if (this.unreadable.has(name)) return undefined;
    try {
      return mp.get(actorId, name);
    } catch (e) {
      this.unreadable.add(name);
      this.log(`VoiceSystem: cannot read ${name} for hearing lists (${e}), not read again`);
      return undefined;
    }
  }

  // refusal() for the lists, checked again at most every 10 s per connection
  private refusedNow(mp: Mp, userId: number, actorId: number, now: number): boolean {
    const hit = this.refusalCache.get(userId);
    if (hit && hit.actorId === actorId && now - hit.at < REFUSAL_CACHE_MS) return hit.refused;
    const refused = !!this.refusal(mp, userId, actorId);
    this.refusalCache.set(userId, { actorId, at: now, refused });
    return refused;
  }

  // A token cannot be revoked and LiveKit re-signs one for a connected session every few minutes, so the session is removed
  private async removeParticipant(identity: string, why: string, room = this.room): Promise<boolean> {
    const res = await this.roomService("RemoveParticipant", { room, identity });
    if (!res || res.notFound) return false;
    this.log(`VoiceSystem: removed voice participant ${identity} from '${room}' (${why})`);
    return true;
  }

  // One LiveKit RoomService call (Twirp JSON) on body.room; null when it failed
  private async roomService(method: string, body: { room: string; identity?: string }): Promise<any | null> {
    try {
      const timeout = (AbortSignal as any).timeout;
      const res = await fetch(`${this.apiBase}/twirp/livekit.RoomService/${method}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${mintAdminToken(this.apiKey, this.apiSecret, body.room)}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: typeof timeout === "function" ? timeout(API_TIMEOUT_MS) : undefined,
      });
      // LiveKit's Twirp not_found means the participant already left; any other 404 is a wrong API address
      const notFound = res.status === 404 && (await res.json().catch(() => null))?.code === "not_found";
      if (!res.ok && !notFound) return this.apiFailed(`${method} answered HTTP ${res.status}`);
      if (this.apiFailing) this.log("VoiceSystem: the LiveKit server API answers again");
      else if (!this.apiAnswered) this.log("VoiceSystem: the LiveKit server API answers");
      this.apiFailing = false;
      this.apiAnswered = true;
      return notFound ? { notFound: true } : await res.json().catch(() => ({}));
    } catch (e) {
      return this.apiFailed(`${method} failed (${errCode(e)})`);
    }
  }

  // Logged once per outage, never with the address
  private apiFailed(what: string): null {
    if (!this.apiFailing) this.log(`VoiceSystem: LiveKit server API call ${what}; voice sessions are not being removed (voiceChat.apiUrl?)`);
    this.apiFailing = true;
    return null;
  }

  customPacket(userId: number, type: string, content: Content, ctx: SystemContext): void {
    if (type !== "voiceTokenRequest") return;
    const mp = ctx.svr as Mp;
    if (!this.enabled) {
      mp.sendCustomPacket(userId, JSON.stringify({ customPacketType: "voiceToken", enabled: false }));
      return;
    }
    let actorId = 0;
    try { actorId = mp.getUserActor(userId); } catch { }
    if (!actorId) return; // not spawned yet; the client re-requests after assign
    const now = Date.now();
    if (now - (this.lastMintAt.get(userId) || 0) < VoiceSystem.MINT_COOLDOWN_MS) return;
    this.lastMintAt.set(userId, now);
    const refused = this.refusal(mp, userId, actorId);
    if (refused) {
      this.log(`VoiceSystem: no voice token for user ${userId} (actor ${actorId.toString(16)}): ${refused}`);
      mp.sendCustomPacket(userId, JSON.stringify({ customPacketType: "voiceToken", enabled: false }));
      return;
    }
    const caps = content?.caps && typeof content.caps === "object" ? content.caps : {};
    this.flowByUser.set(userId, this.hearingLists && caps.hearingLists ? "lists" : "open");
    this.sendToken(mp, userId, actorId);
  }

  private sendToken(mp: Mp, userId: number, actorId: number): boolean {
    const identity = actorId.toString(16);
    try {
      const token = mintLiveKitToken(this.apiKey, this.apiSecret, identity, this.room);
      this.lastMintAt.set(userId, Date.now());
      const minted = this.mintedByUser.get(userId) || new Set<string>();
      this.mintedByUser.set(userId, minted.add(identity));
      mp.sendCustomPacket(userId, JSON.stringify({
        customPacketType: "voiceToken",
        enabled: true,
        url: this.url,
        token,
        room: this.room,
        identity,
        modes: this.modes,
        hearers: this.firstBands(mp, userId, actorId),
      }));
      return true;
    } catch (e) {
      this.log(`VoiceSystem: token mint failed for user ${userId}: ${e}`);
      return false;
    }
  }
}
