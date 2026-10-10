import { Actor, ActorBase, Game, HeadPart, Ui, callNative, writeLogs } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { RemoteServer } from "./remoteServer";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { parseCustomPacket, sendCustomPacket } from "./customPacketUtil";
import { getViewFromStorage } from "../../view/worldViewMisc";
import { queueCopyNiNodeWork, queuePlayerNiNodeWork } from "../../view/niNodeQueue";
import { isGuardedActor, isGuardedRace } from "../../sync/beastRaces";
import { Appearance } from "../../sync/appearance";
import {
  ApplyLedger, ChunkAssembler, FacePreset, applyBlockedBy, boundSculpt, buildJslot, chunkText, decodeFace, encodeFace,
  facePresetFrom, formIdentifierOf, hashText, isEmptyFace, presetFileName, readChunkPacket, PRESET_MAX_CHARS,
} from "../../sync/racemenuPresetPlan";
import { logError, logTrace } from "../../logging";
import { hex, trace } from "../../lib/clientDiag";

// RaceMenu's face sliders, expressions and sculpt (skee) travel only as a .jslot: saved after RaceSexMenu closes and sent to
// the server (racemenupresets.js), then loaded onto each copy and onto the player after a login, face only (flags 0).
// skee's load clears overlays, overrides, transforms and body morphs, so part 1 re-applies them (__dboRaceMenuExtrasReapply).

const PLAYER_ID = 0x14;
const RACE_MENU = "RaceSex Menu";
// remoteServer's settle window after the menu closes, plus a margin for the capture
const RACE_MENU_SETTLE_MS = 3000;
const CAPTURE_DELAY_MS = 3500;
// The player's own face goes back on this long after the character spawns (part 1 waits 5 s too)
const SELF_APPLY_AFTER_SPAWN_MS = 6000;
const SCAN_MS = 1000;
const UPLOAD_CHUNK_MS = 250;
// A copy's preset is asked for again after this long unless a rev notice says it changed sooner
const CACHE_FRESH_MS = 10 * 60 * 1000;
const GET_RETRY_MS = 15000;
// An upload not refused this long after its last chunk is taken as kept by the server
const UPLOAD_CONFIRM_MS = 15000;
const MAX_CACHED = 64;
const DIAG_LOG = "dbo-diag";
const DIAG_MAX_LINES = 60;

interface PresetNatives {
  readPresetFile(name: string): string | undefined;
  writePresetFile(name: string, text: string): void;
  removePresetFile(name: string): boolean;
  getTriVertexCount(triPath: string): number;
}

// What the server holds for one character: face null means none; race is the race the face was made on
interface CacheEntry {
  hash: string;
  race: number;
  face: FacePreset | null;
  at: number;
}

interface Upload {
  seq: number;
  hash: string;
  race: number;
  chunks: string[];
  next: number;
  // The player's own cache entry once the server keeps it
  entry: CacheEntry;
}

interface CopyInfo {
  localId: number;
  remoteId: number;
  appearance: Appearance | null;
}

const normalizeRemote = (id: number): number => (id >= 0x100000000 ? id - 0x100000000 : id) >>> 0;

export class RacemenuPresetService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.on("update", () => this.onUpdate());
    this.controller.emitter.on("customPacketMessage", (e) => this.onCustomPacketMessage(e));
    this.controller.emitter.on("gameLoad", () => this.onGameLoad());
    this.controller.emitter.on("connectionAccepted", () => this.reset());
    this.controller.emitter.on("connectionDisconnect", () => this.reset());
  }

  private natives(): PresetNatives | null {
    const s = this.sp as unknown as Partial<PresetNatives>;
    if (typeof s.readPresetFile !== "function" || typeof s.writePresetFile !== "function"
      || typeof s.removePresetFile !== "function" || typeof s.getTriVertexCount !== "function") {
      if (!this.noNativesNoted) { this.noNativesNoted = true; this.diag("preset: this SkyrimPlatform has no preset file calls, RaceMenu faces stay local"); }
      return null;
    }
    return s as PresetNatives;
  }

  // On connect and disconnect; `off` too, as the server repeats it on every answer while it is off
  private reset(): void {
    this.upload = null;
    this.cache = {};
    this.getSentAt = {};
    this.ledger.clear();
    this.selfRemoteId = 0;
    this.selfSpawnAt = 0;
    this.selfAppliedHash = "";
    this.selfLoadedHash = "";
    this.lastSentHash = undefined;
    this.serverSelf = null;
    this.sentUpload = null;
    this.off = false;
  }

  // A load reverts every skee map; the player's own face is asked of the server again (it marks it sent for this spawn)
  private onGameLoad(): void {
    this.ledger.clear();
    this.selfAppliedHash = "";
    this.selfLoadedHash = "";
    this.forgetSelfFace();
    this.selfSpawnAt = Date.now();
  }

  private forgetSelfFace(): void {
    if (this.selfRemoteId) delete this.cache[this.selfRemoteId];
    delete this.getSentAt[0];
    this.serverSelf = null;
  }

  private raceMenuSettling(now: number): boolean {
    try { if (Ui.isMenuOpen(RACE_MENU)) return true; } catch { return true; }
    return now - (Number((globalThis as any).__dboRaceMenuClosedAt) || 0) < RACE_MENU_SETTLE_MS;
  }

  private onUpdate(): void {
    const now = Date.now();
    if (this.off) return;
    try {
      this.watchRaceMenu(now);
      if (this.captureAt && now >= this.captureAt && !this.raceMenuSettling(now)) {
        this.captureAt = 0;
        this.capture();
      }
      if (this.upload && now - this.lastChunkAt >= UPLOAD_CHUNK_MS) this.pumpUpload(now);
      if (this.sentUpload && now - this.sentUpload.doneAt >= UPLOAD_CONFIRM_MS) {
        // Not refused: the server keeps this face
        this.serverSelf = this.sentUpload.entry;
        this.sentUpload = null;
      }
      if (now - this.lastScanAt >= SCAN_MS) {
        this.lastScanAt = now;
        this.scan(now);
      }
    } catch (e) {
      logError(this, `update failed: ${e}`);
    }
  }

  private watchRaceMenu(now: number): void {
    let open = false;
    try { open = Ui.isMenuOpen(RACE_MENU); } catch { return; }
    if (open) {
      // Each editor close may send once, so a refused face or another character's identical face goes up again
      if (!this.raceMenuWasOpen) this.lastSentHash = undefined;
      this.raceMenuWasOpen = true;
      this.captureAt = 0;
      return;
    }
    if (this.raceMenuWasOpen) {
      this.raceMenuWasOpen = false;
      this.captureAt = now + CAPTURE_DELAY_MS;
    }
  }

  // ---- the player's own face, after RaceMenu ----

  // Why the face may not be sent yet: before the server's face is on the player, a capture would replace the saved sculpt with a stripped one
  private captureHeldBy(player: Actor, now: number): { code: string; text: string } | null {
    if (!this.selfRemoteId) return { code: "noself", text: "no character yet" };
    const own = this.cache[this.selfRemoteId];
    if (!own) return { code: "noanswer", text: "the server's face for this character is not in yet" };
    if (!own.face || own.hash === this.selfLoadedHash) return null;
    if (own.hash === this.selfAppliedHash) return { code: "loadfail", text: "the server's face did not load on this character" };
    const gate = this.gateReason(player, own, now);
    return { code: `notyet${gate ? `-${gate}` : ""}`, text: `the server's face is not back on yet${gate ? ` (${gate})` : ""}` };
  }

  private gateReason(actor: Actor, entry: CacheEntry, now: number): string {
    try { return this.gateFor(actor, entry, now) || ""; } catch { return ""; }
  }

  private capture(): void {
    const natives = this.natives();
    const player = Game.getPlayer();
    if (!natives || !player) return;
    if (isGuardedActor(player)) return;
    const held = this.captureHeldBy(player, Date.now());
    if (held) { this.diag(`preset: capture held, ${held.text}`); trace(`rmp cap held=${held.code}`); return; }
    const race = (player.getRace()?.getFormID() ?? 0) >>> 0;
    const name = presetFileName("self");
    let text: string | undefined;
    try {
      callNative("CharGen", "SaveCharacterPreset", undefined, player, `DBO\\${name}`);
      text = natives.readPresetFile(name);
    } catch (e) {
      this.diag(`preset: save failed: ${e}`);
      trace("rmp cap err=save");
      return;
    } finally {
      try { natives.removePresetFile(name); } catch { /* the next save overwrites it */ }
    }
    if (!text) { this.diag("preset: save wrote no file (RaceMenu missing?)"); trace("rmp cap err=nofile"); return; }
    let face: FacePreset | null = null;
    try { face = facePresetFrom(JSON.parse(text)); } catch { face = null; }
    if (!face) { this.diag(`preset: own preset refused (${text.length} chars)`); trace(`rmp cap err=parse chars=${text.length}`); return; }
    const encoded = isEmptyFace(face) ? "" : encodeFace(face);
    if (encoded.length > PRESET_MAX_CHARS) { this.diag(`preset: own preset too big (${encoded.length} chars)`); trace(`rmp cap err=big chars=${encoded.length}`); return; }
    const hash = encoded ? hashText(encoded) : "";
    // What the player sees now is this face; a login re-apply must not put an older one back, a refusal puts serverSelf back
    const entry: CacheEntry = { hash, race, face: encoded ? face : null, at: Date.now() };
    this.selfAppliedHash = hash;
    this.selfLoadedHash = hash;
    if (this.selfRemoteId) this.cache[this.selfRemoteId] = entry;
    const capLine = `rmp cap chars=${encoded.length} h=${hash || "empty"} cu=${face.custom.length} sc=${face.sculpt.length} race=${hex(race)}`;
    if (hash === this.lastSentHash) { trace(`${capLine} send=same`); return; }
    if (this.serverSelf && this.serverSelf.hash === hash && !this.sentUpload && !this.upload) {
      this.diag(`preset: own face unchanged, ${hash || "empty"}, not sent`);
      trace(`${capLine} send=unchanged`);
      return;
    }
    this.lastSentHash = hash;
    this.upload = { seq: ++this.uploadSeq, hash, race, chunks: encoded ? chunkText(encoded) : [], next: 0, entry };
    trace(`${capLine} send=${Math.max(1, this.upload.chunks.length)}`);
    this.diag(`preset: own face saved, ${face.custom.length} sliders, ${face.sculpt.length} sculpted parts, ${encoded.length} chars, ${hash || "empty"}`);
  }

  private pumpUpload(now: number): void {
    const u = this.upload;
    if (!u) return;
    this.lastChunkAt = now;
    const n = u.chunks.length;
    sendCustomPacket(this.controller, { customPacketType: "dboPresetPut", up: u.seq, i: u.next, n, hash: u.hash, race: u.race, data: n ? u.chunks[u.next] : "" });
    u.next++;
    if (u.next >= Math.max(1, n)) {
      this.upload = null;
      this.sentUpload = { hash: u.hash, entry: u.entry, doneAt: now };
      trace(`rmp up done h=${u.hash || "empty"} n=${Math.max(1, n)}`);
    }
  }

  // ---- what the server sends ----

  private onCustomPacketMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(event);
    const type = content ? content["customPacketType"] : undefined;
    if (!content || typeof type !== "string" || type.indexOf("dboPreset") !== 0) return;
    const now = Date.now();
    if (type === "dboPresetRefused") {
      this.onRefused(String(content["hash"] ?? ""), String(content["reason"] ?? ""), now);
      return;
    }
    const sent = Number(content["actor"]) >>> 0;
    if (!sent) return;
    // An answer about the player is kept under the id remoteServer gives the player
    const actor = content["self"] === true && this.selfRemoteId ? this.selfRemoteId : sent;
    if (type === "dboPresetNone") {
      // The server's switch (racemenuPresets.enabled false): nothing more is sent, saved or loaded this session
      if (content["off"] === true && !this.off) { this.off = true; this.upload = null; this.sentUpload = null; this.diag("preset: switched off by the server"); trace("rmp off"); }
      this.store(actor, { hash: "", race: 0, face: null, at: now });
      if (this.isSelfAnswer(content, actor)) { this.serverSelf = this.cache[actor]; trace(`rmp ans none off=${content["off"] === true ? 1 : 0}`); }
    } else if (type === "dboPresetMeta") {
      const hash = String(content["hash"] || "");
      const known = this.cache[actor];
      if (known && known.hash === hash) known.at = now;
      if (this.isSelfAnswer(content, actor)) trace(`rmp ans meta h=${/^[0-9a-f]{8}$/.test(hash) ? hash : "bad"} known=${known && known.hash === hash ? 1 : 0}`);
    } else if (type === "dboPresetChunk") {
      const chunk = readChunkPacket(content);
      if (!chunk) return;
      const text = this.assembler.push(chunk, now);
      if (text === null) return;
      const face = decodeFace(text);
      const self = this.isSelfAnswer(content, actor);
      if (!face) { this.diag(`preset: the face of ${actor.toString(16)} is refused here`); if (self) trace(`rmp ans bad h=${chunk.hash} n=${chunk.n} chars=${text.length}`); return; }
      this.store(actor, { hash: chunk.hash, race: Number(content["race"]) >>> 0, face, at: now });
      if (self) {
        this.serverSelf = this.cache[actor];
        trace(`rmp ans face h=${chunk.hash} n=${chunk.n} chars=${text.length} cu=${face.custom.length} sc=${face.sculpt.length} race=${hex(content["race"])}`);
      }
    } else if (type === "dboPresetRev") {
      const known = this.cache[actor];
      if (known && known.hash !== String(content["hash"] || "")) { delete this.cache[actor]; delete this.getSentAt[actor]; }
    }
  }

  private isSelfAnswer(content: Record<string, unknown>, actor: number): boolean {
    return content["self"] === true && !!this.selfRemoteId && actor === this.selfRemoteId;
  }

  // The server refused an upload and charged nothing (hash "" is an empty face or not known): send again, put its face back
  private onRefused(hash: string, reasonRaw: string, now: number): void {
    const reason = /^[A-Za-z0-9_.:-]{1,40}$/.test(reasonRaw) ? reasonRaw : "other";
    const ours = hash === this.lastSentHash || (!!this.upload && hash === this.upload.hash)
      || (!!this.sentUpload && hash === this.sentUpload.hash) || hash === "";
    const h = /^[0-9a-f]{8}$/.test(hash) ? hash : (hash ? "bad" : "empty");
    if (this.off || !ours) {
      this.diag(`preset: refusal for ${hash || "empty"} (${reason}) ignored, not the last upload`);
      trace(`rmp refused h=${h} why=${reason} restore=ignored`);
      return;
    }
    this.lastSentHash = undefined;
    if (this.upload && (hash === "" || this.upload.hash === hash)) this.upload = null;
    this.sentUpload = null;
    let restore = "none", code = "noself";
    if (this.selfRemoteId) {
      if (this.serverSelf) {
        this.cache[this.selfRemoteId] = { hash: this.serverSelf.hash, race: this.serverSelf.race, face: this.serverSelf.face, at: now };
        restore = this.serverSelf.face ? "the server's face" : "no face (the server has none)";
        code = this.serverSelf.face ? "face" : "none";
      } else {
        delete this.cache[this.selfRemoteId];
        restore = "asking the server again";
        code = "ask";
      }
      delete this.getSentAt[0];
      this.selfAppliedHash = "";
      this.selfLoadedHash = "";
    }
    this.diag(`preset: the server refused ${hash || "the empty face"} (${reason}); ${restore}`);
    trace(`rmp refused h=${h} why=${reason} restore=${code}`);
  }

  private store(actor: number, entry: CacheEntry): void {
    this.cache[actor] = entry;
    delete this.getSentAt[actor];
    const keys = Object.keys(this.cache);
    if (keys.length <= MAX_CACHED) return;
    keys.sort((a, b) => this.cache[Number(a)].at - this.cache[Number(b)].at);
    for (const k of keys.slice(0, keys.length - MAX_CACHED)) if (Number(k) !== this.selfRemoteId) delete this.cache[Number(k)];
  }

  private ask(remoteId: number, now: number, self: boolean): void {
    const key = self ? 0 : remoteId;
    if (now - (this.getSentAt[key] || 0) < GET_RETRY_MS) return;
    this.getSentAt[key] = now;
    const known = remoteId ? this.cache[remoteId] : undefined;
    sendCustomPacket(this.controller, { customPacketType: "dboPresetGet", actor: self ? 0 : remoteId, have: known ? known.hash : "" });
    if (self) trace(`rmp ask have=${known ? known.hash || "empty" : "-"}`);
  }

  // ---- putting faces on ----

  private scan(now: number): void {
    const natives = this.natives();
    if (!natives) return;
    const remoteServer = this.controller.lookupListener(RemoteServer);
    const me = normalizeRemote(remoteServer.getMyRemoteRefrId() || 0);
    if (me !== this.selfRemoteId && me) {
      // Another character on this connection: nothing of the last one's carries over, a part-sent upload would land on this one
      if (this.selfRemoteId) {
        this.forgetSelfFace();
        if (this.upload) { this.diag("preset: upload dropped, the character changed"); trace(`rmp up drop=character h=${this.upload.hash || "empty"}`); }
        this.upload = null;
        this.sentUpload = null;
        this.lastSentHash = undefined;
      }
      this.selfRemoteId = me;
      delete this.cache[me];
      this.selfSpawnAt = now;
      delete this.getSentAt[0];
      this.selfAppliedHash = "";
      this.selfLoadedHash = "";
    }
    if (!me) return;
    const settling = this.raceMenuSettling(now);

    // The player, once after each spawn
    if (now - this.selfSpawnAt >= SELF_APPLY_AFTER_SPAWN_MS) {
      const own = this.cache[me];
      if (!own) this.ask(me, now, true);
      if (own && own.face && own.hash !== this.selfAppliedHash && !settling) this.applyToPlayer(own, natives, now);
    }

    const copies = this.copies();
    this.ledger.keepOnly(copies.map((c) => c.localId));
    for (const c of copies) {
      const entry = this.cache[c.remoteId];
      if (!entry || now - entry.at > CACHE_FRESH_MS) { this.ask(c.remoteId, now, false); continue; }
      if (!entry.face || this.ledger.isDone(c.localId, entry.hash) || settling) continue;
      this.applyToCopy(c, entry, natives);
    }
  }

  private copies(): CopyInfo[] {
    const out: CopyInfo[] = [];
    const views = getViewFromStorage()?.getFormViews();
    if (!views) return out;
    for (let i = 0; i < views.getFormViewsArrayLength(); i++) {
      const fv = views.getNthFormView(i);
      if (!fv || !fv.isPlayerCharacter()) continue;
      const localId = fv.getLocalRefrId() >>> 0;
      const remoteId = normalizeRemote(fv.getRemoteRefrId() || 0);
      if (localId < 0xff000000 || !remoteId || remoteId === this.selfRemoteId) continue;
      out.push({ localId, remoteId, appearance: fv.getAppearance() });
    }
    return out;
  }

  private stillOwns(localId: number, remoteId: number, hash: string): boolean {
    const current = this.cache[remoteId];
    if (!current || current.hash !== hash || !current.face) return false;
    return this.copies().some((c) => c.localId === localId && c.remoteId === remoteId);
  }

  private gateFor(actor: Actor, entry: CacheEntry, now: number): string | null {
    let raceNow = 0, loaded3D = false, inCombat = false;
    try { raceNow = (actor.getRace()?.getFormID() ?? 0) >>> 0; } catch { return "gone"; }
    try { loaded3D = actor.is3DLoaded(); } catch { loaded3D = false; }
    try { inCombat = actor.isInCombat(); } catch { inCombat = false; }
    // One rule with part 1 for everything skee writes into a 3D: a non-humanoid or unreadable race is refused
    const isBeast = isGuardedActor(actor) || isGuardedRace(entry.race);
    return applyBlockedBy({ raceNow, presetRace: entry.race, isBeast, raceMenuSettling: this.raceMenuSettling(now), loaded3D, inCombat });
  }

  // Main head parts only, as skee's own SaveJsonPreset lists them, named as skee's GetFormIdentifier names forms
  private headPartsOf(ids: number[]): string[] | null {
    const out: string[] = [];
    for (const id of ids) {
      const part = HeadPart.from(Game.getFormEx(id >>> 0));
      if (!part) return null;
      if (part.isExtraPart()) continue;
      const ident = formIdentifierOf(id, (i) => Game.getModName(i), (i) => Game.getLightModName(i));
      if (!ident) return null;
      out.push(ident);
    }
    return out.length ? out : null;
  }

  private applyToCopy(c: CopyInfo, entry: CacheEntry, natives: PresetNatives): void {
    if (!c.appearance || !entry.face) return;
    const actor = Actor.from(Game.getFormEx(c.localId));
    if (!actor) return;
    const blocked = this.gateFor(actor, entry, Date.now());
    if (blocked) return;
    const headParts = this.headPartsOf(c.appearance.headpartIds || []);
    if (!headParts) { this.ledger.markDone(c.localId, entry.hash); this.diag(`preset: ${c.remoteId.toString(16)} head parts unresolved, face skipped`); trace(`rmp copy unresolved id=${hex(c.remoteId)} h=${entry.hash}`); return; }
    const { face, dropped } = boundSculpt(entry.face, (host) => natives.getTriVertexCount(host));
    if (dropped.length) this.diag(`preset: ${c.remoteId.toString(16)} sculpt not applied to ${dropped.join(", ")}`);
    if (isEmptyFace(face)) { this.ledger.markDone(c.localId, entry.hash); return; }
    const jslot = buildJslot(face, headParts, c.appearance.weight);
    const name = presetFileName(c.remoteId);
    const localId = c.localId, hash = entry.hash, remoteId = c.remoteId;
    // Marked now so the scan does not queue it twice; a slot that finds it blocked hands it back
    this.ledger.markDone(localId, hash);
    queueCopyNiNodeWork(localId, (copy) => {
      // The id must still be this player's copy, and the face still theirs: a destroyed copy's id can be reused
      if (!this.stillOwns(localId, remoteId, hash)) return false;
      if (this.gateFor(copy, entry, Date.now())) { this.ledger.forget(localId); return false; }
      if (!this.load(copy, name, jslot, natives)) { trace(`rmp copy fail id=${hex(remoteId)} h=${hash}`); return false; }
      this.afterLoad(localId, `${remoteId.toString(16)} face on ${localId.toString(16)}, ${hash}`);
      return true;
    });
  }

  private applyToPlayer(entry: CacheEntry, natives: PresetNatives, now: number): void {
    const player = Game.getPlayer();
    if (!player || !entry.face || this.selfQueued) return;
    const gate = this.gateFor(player, entry, now);
    if (gate) { trace(`rmp apply wait=${gate} h=${entry.hash}`); return; }
    const base = ActorBase.from(player.getBaseObject());
    if (!base) return;
    const ids: number[] = [];
    for (let i = 0; i < base.getNumHeadParts(); i++) {
      const p = base.getNthHeadPart(i);
      if (p) ids.push(p.getFormID());
    }
    const headParts = this.headPartsOf(ids);
    if (!headParts) { this.selfAppliedHash = entry.hash; this.diag("preset: own head parts unresolved, face skipped"); trace(`rmp apply unresolved h=${entry.hash}`); return; }
    const { face, dropped } = boundSculpt(entry.face, (host) => natives.getTriVertexCount(host));
    if (dropped.length) this.diag(`preset: own sculpt not applied to ${dropped.join(", ")}`);
    const drop = dropped.length;
    const jslot = buildJslot(face, headParts, base.getWeight());
    const hash = entry.hash;
    this.selfQueued = true;
    queuePlayerNiNodeWork((p) => {
      this.selfQueued = false;
      const late = this.gateFor(p, entry, Date.now());
      if (late) { trace(`rmp apply wait=${late} h=${hash}`); return false; }
      // Once per face either way: a load skee refuses is not retried every second
      this.selfAppliedHash = hash;
      if (!this.load(p, presetFileName("self"), jslot, natives)) { trace(`rmp apply fail h=${hash}`); return false; }
      this.selfLoadedHash = hash;
      this.afterLoad(PLAYER_ID, `own face back on, ${hash}, ${headParts.length} head parts`);
      trace(`rmp apply ok h=${hash} hp=${headParts.length} drop=${drop}`);
      this.recheckOwnLook();
      return true;
    });
  }

  // skee reads the file during the call (LoadJsonPreset), so it is removed straight after; flags 0 is the face only
  private load(actor: Actor, name: string, jslot: string, natives: PresetNatives): boolean {
    let ok = false;
    try {
      natives.writePresetFile(name, jslot);
      ok = callNative("CharGen", "LoadCharacterPresetEx", undefined, actor, `DBO\\${name}`, null, 0) === true;
    } catch (e) {
      this.diag(`preset: load failed: ${e}`);
      ok = false;
    } finally {
      try { natives.removePresetFile(name); } catch { /* overwritten next time */ }
    }
    return ok;
  }

  // skee's load must leave the vanilla sliders alone: the look trace reads the base back now and 3 s later
  private recheckOwnLook(): void {
    try {
      const recheck = (globalThis as any).__dboAppearanceRecheck;
      if (typeof recheck === "function") { recheck("rmface"); recheck("rmface", 3); }
    } catch (e) { /* diagnostics only */ }
  }

  private afterLoad(localId: number, line: string): void {
    const g = globalThis as any;
    const stamps = g.__dboRaceMenuPresetAppliedAt = g.__dboRaceMenuPresetAppliedAt || {};
    stamps[localId >>> 0] = Date.now();
    // skee's load clears overlays, overrides, transforms and body morphs on the ref; part 1 puts them back
    try { if (typeof g.__dboRaceMenuExtrasReapply === "function") g.__dboRaceMenuExtrasReapply(localId >>> 0); } catch (e) { logError(this, `extras reapply failed: ${e}`); }
    logTrace(this, line);
    this.diag(`preset: ${line}`);
  }

  private diag(line: string): void {
    if (this.diagLines >= DIAG_MAX_LINES) return;
    this.diagLines++;
    try { writeLogs(DIAG_LOG, line); } catch { /* no writeLogs on this platform build */ }
  }

  private cache: Record<number, CacheEntry> = {};
  private getSentAt: Record<number, number> = {};
  private assembler = new ChunkAssembler();
  private ledger = new ApplyLedger();
  private upload: Upload | null = null;
  private uploadSeq = 0;
  private lastSentHash: string | undefined = undefined;
  private lastChunkAt = 0;
  private lastScanAt = 0;
  private raceMenuWasOpen = false;
  private captureAt = 0;
  private selfRemoteId = 0;
  private selfSpawnAt = 0;
  private selfQueued = false;
  // The face last tried on the player (loaded or not) and the face really on it (loaded or captured)
  private selfAppliedHash = "";
  private selfLoadedHash = "";
  // The server's face for the player this session: its answer, or an upload it did not refuse
  private serverSelf: CacheEntry | null = null;
  private sentUpload: { hash: string; entry: CacheEntry; doneAt: number } | null = null;
  private noNativesNoted = false;
  private off = false;
  private diagLines = 0;
}
