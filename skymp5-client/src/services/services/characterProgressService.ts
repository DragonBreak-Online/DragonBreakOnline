import { EquipEvent, FormType, Menu } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { logError, logTrace } from "../../logging";
import { RemoteServer } from "./remoteServer";
import { SinglePlayerService } from "./singlePlayerService";
import { getInventory } from "../../sync/inventory";
import { MAP_MARKER_REFS } from "../../data/mapMarkerRefs";
import { parseCustomPacket, sendCustomPacket } from "./customPacketUtil";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { trace } from "../../lib/clientDiag";

// Per-character local replay of discovered map markers and learned ingredient effects, keyed by server and actor id.
// The server keeps the map markers too (mapprogress.js, Nate 12 Oct: "make sure map data ... stays synced"): the local
// file alone was lost with a new server address, a reinstall or another PC. Once a character's restore begins, every
// marker the file holds is reported with dboMapSync, the last batch asking for the whole list back (want); the server's
// dboMapMarkers answer adds what this PC never saw. Each later discovery is reported within REPORT_MS, and at once on a
// disconnect or the main menu.
// A marker only seen is restored with addToMap(false); one the character entered (canFastTravelToMarker) with addToMap(true).

const PLUGIN_NAME = "character-progress-no-load";
const FILE_VERSION = 1;
const STORAGE_KEY = "characterProgressState";
const MARKER_SCAN_MS = 10000;
const INGR_POLL_MS = 5000;
const INGR_EQUIP_DELAY_MS = 700;
const WRITE_DEBOUNCE_MS = 2000;
const ERROR_LOG_MS = 5000;
const RESTORE_DELAY_S = 2.5;
const RESTORE_BATCH = 25;
const SCAN_BATCH = 60;
const INGR_READ_BATCH = 5;
const MAX_CHARACTERS = 30;
const MAX_MARKERS = 3000;
const MAX_INGREDIENTS = 1500;
const MAX_EFFECTS = 4;
const PLAYER_FORM_ID = 0x14;
const REPORT_MS = 3000;
const REPORT_BATCH = 400;
const LIGHT_MOD_HIGH = 0xfe;

interface CharacterEntry {
  name: string;
  updatedAt: number;
  markers: string[];
  // The markers the character entered (none in a file written before 0.3.102)
  visited?: string[];
  ingredients: Record<string, boolean[]>;
}

interface ProgressDoc {
  version: number;
  characters: Record<string, CharacterEntry>;
}

// An ingredient item carries its saved flags; a marker item has none
interface RestoreItem {
  desc: string;
  flags?: boolean[];
}

// Lives in sp.storage so a client hot reload keeps unwritten progress
interface State {
  key: string | null;
  myIdx: number;
  markers: Record<string, true>;
  visited: Record<string, true>;
  ingredients: Record<string, boolean[]>;
  queue: RestoreItem[];
  restored: boolean;
  dirty: boolean;
  // Markers to report to the server (seen, and entered), and whether the last report should ask for the whole list back
  report?: string[];
  reportVisited?: string[];
  want?: boolean;
}

export class CharacterProgressService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("createActorMessage", (e) => {
      if (e.message.isMe) this.onMySpawn();
    });
    this.controller.emitter.on("destroyActorMessage", (e) => {
      if (e.message.idx === this.state.myIdx) this.onMyDespawn();
    });
    this.controller.emitter.on("connectionDisconnect", () => this.flush());
    this.controller.on("update", () => this.onUpdate());
    this.controller.emitter.on("customPacketMessage", (e) => this.onServerMarkers(e));
    this.controller.on("locationDiscovery", () => this.scanSoon());
    this.controller.on("cellFullyLoaded", () => this.scanSoon());
    this.controller.on("equip", (e) => this.onEquip(e));
    this.controller.on("menuClose", (e) => {
      if (e.name === Menu.Crafting) this.ingrPollAt = 0;
    });
    this.controller.on("menuOpen", (e) => {
      if (e.name === Menu.Main) this.flush();
    });
    // A hot reload inside the restore delay resumes the pending restore on the first update
    if (this.state.myIdx !== -1 && !this.state.key) this.restoreArmed = true;
  }

  private restoreArmed = false;
  private reportAt = 0;
  private spawnGen = 0;
  private scanCursor = MAP_MARKER_REFS.length;
  private nextScanAt = 0;
  private ingrPollAt = 0;
  private ingrQueue: string[] = [];
  private writeAt = 0;
  private lastErrorAt = 0;
  private readonly descToId = new Map<string, number>();
  private readonly idToDesc = new Map<number, string | null>();

  private get state(): State {
    let s = this.sp.storage[STORAGE_KEY] as State | undefined;
    if (!s || typeof s !== "object") {
      s = { key: null, myIdx: -1, markers: {}, visited: {}, ingredients: {}, queue: [], restored: false, dirty: false };
      this.sp.storage[STORAGE_KEY] = s;
    }
    // A hot reload over a state kept before 0.3.102
    if (!s.visited) s.visited = {};
    return s;
  }

  private onMySpawn(): void {
    // A report still waiting belongs to the character before: never send it as this one's (the next restore reports
    // everything the file holds again)
    this.dropReport();
    this.flush();
    const s = this.state;
    s.key = null;
    s.restored = false;
    s.queue = [];
    s.myIdx = this.controller.lookupListener(RemoteServer).getMyActorIndex();
    this.restoreArmed = false;
    // Land after the inventory passes remoteServer runs right after spawn
    const gen = ++this.spawnGen;
    this.controller.once("update", () => {
      this.sp.Utility.wait(RESTORE_DELAY_S).then(() => {
        if (gen === this.spawnGen) this.restoreArmed = true;
      });
    });
  }

  private onMyDespawn(): void {
    this.dropReport();
    this.flush();
    const s = this.state;
    s.key = null;
    s.myIdx = -1;
    s.restored = false;
    s.queue = [];
    this.restoreArmed = false;
  }

  private onEquip(e: EquipEvent): void {
    try {
      if (e.actor.getFormID() !== PLAYER_FORM_ID || e.baseObj.getType() !== FormType.Ingredient) return;
      this.ingrPollAt = Math.min(this.ingrPollAt, Date.now() + INGR_EQUIP_DELAY_MS);
    } catch (err) { /* stale event object */ }
  }

  private scanSoon(): void {
    this.nextScanAt = 0;
  }

  private onUpdate(): void {
    try {
      if (this.controller.lookupListener(SinglePlayerService).isSinglePlayer) return;
      const s = this.state;
      if (this.restoreArmed && !s.key) this.beginRestore();
      if (!s.key) return;
      this.sendReport(Date.now(), false);
      if (s.queue.length || !s.restored) {
        this.drainRestore();
        return;
      }
      const now = Date.now();
      this.scanMarkers(now);
      if (this.ingrQueue.length) {
        this.ingrQueue.splice(0, INGR_READ_BATCH).forEach((desc) => this.readIngredient(desc));
      } else if (now >= this.ingrPollAt) {
        this.ingrPollAt = now + INGR_POLL_MS;
        this.pollIngredients();
      }
      if (s.dirty && now >= this.writeAt) this.write();
    } catch (err) {
      if (Date.now() - this.lastErrorAt < ERROR_LOG_MS) return;
      this.lastErrorAt = Date.now();
      logError(this, err);
    }
  }

  private beginRestore(): void {
    const remoteId = this.controller.lookupListener(RemoteServer).getMyRemoteRefrId();
    if (!remoteId || this.sp.Ui.isMenuOpen(Menu.Main)) return;
    const cfg = this.sp.settings["skymp5-client"] || {};
    const s = this.state;
    s.key = `${cfg["server-ip"]}:${cfg["server-port"]}/${remoteId.toString(16)}`;
    s.markers = {};
    s.visited = {};
    s.ingredients = {};
    s.queue = [];
    s.restored = false;
    this.restoreArmed = false;
    s.report = [];
    s.want = true;
    const entry = this.readDoc().characters[s.key];
    if (entry) {
      if (Array.isArray(entry.markers)) {
        const visited = new Set(Array.isArray(entry.visited) ? entry.visited : []);
        entry.markers.forEach((desc) => {
          if (typeof desc !== "string") return;
          s.markers[desc] = true;
          if (visited.has(desc)) s.visited[desc] = true;
          s.queue.push({ desc });
        });
      }
      if (entry.ingredients && typeof entry.ingredients === "object") {
        for (const desc in entry.ingredients) {
          const flags = entry.ingredients[desc];
          if (!Array.isArray(flags)) continue;
          s.ingredients[desc] = flags.map((f) => f === true);
          s.queue.push({ desc, flags: s.ingredients[desc] });
        }
      }
    }
    // Everything this PC kept goes to the server once (it merges), and the server's list comes back
    s.report = Object.keys(s.markers).filter((desc) => !s.visited[desc]);
    s.reportVisited = Object.keys(s.visited);
    this.reportAt = 0;
    logTrace(this, `Restoring ${s.queue.length} items for ${s.key}`);
  }

  // The server's list (dboMapMarkers): markers this PC never saw, or saw while the server has them visited, are restored and kept
  private onServerMarkers(event: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(event);
    if (!content || content["customPacketType"] !== "dboMapMarkers") return;
    const s = this.state;
    if (!s.key || !Array.isArray(content["markers"])) return;
    const visited = new Set(Array.isArray(content["visited"]) ? (content["visited"] as unknown[]) : []);
    let count = Object.keys(s.markers).length;
    let added = 0;
    for (const desc of (content["markers"] as unknown[]).slice(0, MAX_MARKERS)) {
      if (typeof desc !== "string") continue;
      const entered = visited.has(desc) && !s.visited[desc];
      if (s.markers[desc] ? !entered : count >= MAX_MARKERS) continue;
      if (!s.markers[desc]) count++;
      s.markers[desc] = true;
      if (entered) s.visited[desc] = true;
      s.queue.push({ desc });
      added++;
    }
    if (!added) return;
    s.restored = false;
    this.markDirty();
    logTrace(this, `The server added ${added} map marker(s) for ${s.key}`);
  }

  private dropReport(): void {
    const s = this.state;
    s.report = [];
    s.reportVisited = [];
    s.want = false;
  }

  // Sends what is waiting to be reported; force sends it now (a disconnect, the main menu)
  private sendReport(now: number, force: boolean): void {
    const s = this.state;
    if (!s.key || (!force && now < this.reportAt)) return;
    const report = s.report || [];
    const visited = s.reportVisited || [];
    if (!report.length && !visited.length && !s.want) return;
    this.reportAt = now + REPORT_MS;
    // The server reads visited and markers together, at most its perPacket (500) a packet
    const visitedBatch = visited.splice(0, REPORT_BATCH);
    const batch = report.splice(0, REPORT_BATCH - visitedBatch.length);
    const want = !!s.want && !report.length && !visited.length;
    try {
      sendCustomPacket(this.controller, {
        customPacketType: "dboMapSync",
        markers: batch,
        ...(visitedBatch.length ? { visited: visitedBatch } : {}),
        ...(want ? { want: true } : {}),
      });
      if (want) s.want = false;
    } catch (err) {
      report.unshift(...batch);
      visited.unshift(...visitedBatch);
    }
  }

  private drainRestore(): void {
    const s = this.state;
    let calls = 0;
    let done = 0;
    while (done < s.queue.length && calls < RESTORE_BATCH) {
      const item = s.queue[done++];
      calls += item.flags ? this.restoreIngredient(item.desc, item.flags) : this.restoreMarker(item.desc);
    }
    s.queue.splice(0, done);
    if (s.queue.length) return;
    s.restored = true;
    this.scanSoon();
    this.ingrQueue = [];
    this.ingrPollAt = 0;
    logTrace(this, "Restore complete for", s.key);
    trace(`map restore markers=${Object.keys(s.markers).length} visited=${Object.keys(s.visited).length}`);
  }

  // Both restore helpers return the number of native calls made so the frame budget holds
  private restoreMarker(desc: string): number {
    try {
      const ref = this.sp.ObjectReference.from(this.formFromDesc(desc));
      if (!ref) return 1;
      const entered = !!this.state.visited[desc];
      if (entered ? ref.canFastTravelToMarker() : ref.isMapMarkerVisible()) return 2;
      ref.addToMap(entered);
      return 3;
    } catch (err) {
      return 1;
    }
  }

  private restoreIngredient(desc: string, flags: boolean[]): number {
    let calls = 1;
    try {
      const ing = this.sp.Ingredient.from(this.formFromDesc(desc));
      if (!ing) return calls;
      const n = Math.min(MAX_EFFECTS, ing.getNumEffects());
      ++calls;
      for (let i = 0; i < n; ++i) {
        if (!flags[i]) continue;
        ++calls;
        if (ing.getIsNthEffectKnown(i)) continue;
        ing.learnEffect(i);
        ++calls;
      }
    } catch (err) { /* form not loaded on this client */ }
    return calls;
  }

  private scanMarkers(now: number): void {
    const s = this.state;
    if (this.scanCursor >= MAP_MARKER_REFS.length) {
      if (now < this.nextScanAt) return;
      this.scanCursor = 0;
      this.nextScanAt = now + MARKER_SCAN_MS;
    }
    const end = Math.min(this.scanCursor + SCAN_BATCH, MAP_MARKER_REFS.length);
    for (; this.scanCursor < end; ++this.scanCursor) {
      const [localId, plugin] = MAP_MARKER_REFS[this.scanCursor];
      const desc = localId.toString(16) + ":" + plugin;
      if (s.visited[desc]) continue;
      const known = !!s.markers[desc];
      let entered = false;
      try {
        const ref = this.sp.ObjectReference.from(this.formFromDesc(desc));
        if (!ref || (!known && !ref.isMapMarkerVisible())) continue;
        entered = ref.canFastTravelToMarker();
      } catch (err) {
        continue;
      }
      if (known && !entered) continue;
      if (!known) {
        if (Object.keys(s.markers).length >= MAX_MARKERS) return;
        s.markers[desc] = true;
      }
      if (entered) {
        s.visited[desc] = true;
        (s.reportVisited = s.reportVisited || []).push(desc);
      } else {
        (s.report = s.report || []).push(desc);
      }
      this.markDirty();
    }
  }

  // Collects the descs to read; onUpdate then reads INGR_READ_BATCH of them per frame
  private pollIngredients(): void {
    const s = this.state;
    const player = this.sp.Game.getPlayer();
    if (!player) return;
    const seen: Record<string, true> = {};
    getInventory(player).entries.forEach((e) => {
      if (e.count <= 0) return;
      try {
        if (!this.sp.Ingredient.from(this.sp.Game.getFormEx(e.baseId))) return;
        const desc = this.descOf(e.baseId);
        if (desc) seen[desc] = true;
      } catch (err) { /* unloaded base form */ }
    });
    for (const desc in s.ingredients) seen[desc] = true;
    this.ingrQueue = Object.keys(seen);
  }

  private readIngredient(desc: string): void {
    const s = this.state;
    try {
      const ing = this.sp.Ingredient.from(this.formFromDesc(desc));
      if (!ing) return;
      const n = Math.min(MAX_EFFECTS, ing.getNumEffects());
      let saved = s.ingredients[desc];
      for (let i = 0; i < n; ++i) {
        if ((saved && saved[i]) || !ing.getIsNthEffectKnown(i)) continue;
        if (!saved) {
          if (Object.keys(s.ingredients).length >= MAX_INGREDIENTS) return;
          saved = s.ingredients[desc] = [];
        }
        saved[i] = true;
        this.markDirty();
      }
    } catch (err) { /* form not loaded on this client */ }
  }

  private formFromDesc(desc: string) {
    let id = this.descToId.get(desc);
    if (id === undefined) {
      const sep = desc.indexOf(":");
      const form = sep > 0 ? this.sp.Game.getFormFromFile(parseInt(desc.slice(0, sep), 16), desc.slice(sep + 1)) : null;
      id = form ? form.getFormID() : 0;
      this.descToId.set(desc, id);
    }
    return id ? this.sp.Game.getFormEx(id) : null;
  }

  // Runtime form id to "hex:Plugin" using the client's own load order (light plugins live in the 0xFE space)
  private descOf(id: number): string | null {
    let desc = this.idToDesc.get(id);
    if (desc !== undefined) return desc;
    desc = null;
    const high = id >>> 24;
    try {
      if (high === LIGHT_MOD_HIGH) {
        const idx = (id >>> 12) & 0xfff;
        if (idx < this.sp.Game.getLightModCount()) desc = (id & 0xfff).toString(16) + ":" + this.sp.Game.getLightModName(idx);
      } else if (high < this.sp.Game.getModCount()) {
        desc = (id & 0xffffff).toString(16) + ":" + this.sp.Game.getModName(high);
      }
    } catch (err) { /* keep null */ }
    if (desc && desc.endsWith(":")) desc = null;
    this.idToDesc.set(id, desc);
    return desc;
  }

  private markDirty(): void {
    const s = this.state;
    if (!s.dirty) this.writeAt = Date.now() + WRITE_DEBOUNCE_MS;
    s.dirty = true;
  }

  private flush(): void {
    if (this.state.dirty) this.write();
    try { this.sendReport(Date.now(), true); } catch (err) { /* disconnected */ }
  }

  private ownerName(): string {
    if (this.sp.storage["ownerModelSet"] !== true) return "";
    const owner = this.sp.storage["ownerModel"] as Record<string, unknown> | undefined;
    const appearance = owner && (owner["appearance"] as { name?: string } | undefined);
    return (appearance && appearance.name) || "";
  }

  private readDoc(): ProgressDoc {
    try {
      // @ts-expect-error (TODO: Remove in 2.10.0)
      const data = this.sp.getPluginSourceCode(PLUGIN_NAME, "PluginsNoLoad");
      if (data) {
        const parsed = JSON.parse(data.slice(2));
        if (parsed && typeof parsed === "object" && parsed.characters && typeof parsed.characters === "object") {
          return { version: FILE_VERSION, characters: parsed.characters };
        }
      }
    } catch (err) { /* missing or corrupt file, start fresh */ }
    return { version: FILE_VERSION, characters: {} };
  }

  // Merges only this character into a fresh read so another game instance on this PC keeps its entries
  private write(): void {
    const s = this.state;
    if (!s.key) return;
    const doc = this.readDoc();
    const chars = doc.characters;
    const old = chars[s.key];
    const entry: CharacterEntry = {
      name: this.ownerName() || (old && old.name) || "",
      updatedAt: Date.now(),
      markers: Object.keys(s.markers).slice(0, MAX_MARKERS),
      visited: Object.keys(s.visited).slice(0, MAX_MARKERS),
      ingredients: {},
    };
    Object.keys(s.ingredients).slice(0, MAX_INGREDIENTS).forEach((desc) => {
      entry.ingredients[desc] = s.ingredients[desc];
    });
    chars[s.key] = entry;
    const keys = Object.keys(chars);
    if (keys.length > MAX_CHARACTERS) {
      keys.sort((a, b) => (chars[a].updatedAt || 0) - (chars[b].updatedAt || 0));
      keys.slice(0, keys.length - MAX_CHARACTERS).forEach((k) => delete chars[k]);
    }
    try {
      this.sp.writePlugin(
        PLUGIN_NAME,
        "//" + JSON.stringify(doc),
        // @ts-expect-error (TODO: Remove in 2.10.0)
        "PluginsNoLoad"
      );
      s.dirty = false;
    } catch (err) {
      this.writeAt = Date.now() + WRITE_DEBOUNCE_MS;
      logError(this, err);
    }
  }
}
