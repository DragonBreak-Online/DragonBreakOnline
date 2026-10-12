'use strict';
// RaceMenu face presets per character: custom sliders, expressions and sculpt, the face part of a skee .jslot. The
// owner's client (fork racemenuPresetService.ts) uploads it after RaceSexMenu closes; watchers' clients and the owner
// after a login fetch it and load it onto the copy (CharGen.LoadCharacterPresetEx, face only). One file per character
// in racemenu-presets/ (gitignored), written only when the face changes. Every upload is checked here (faceFixed), because
// skee adds a sculpt's offsets to the head's vertices with no bounds check: a bad preset could crash every watcher. A
// stored file must match its hash and parse as a face (readDoc), and is then served as it is stored; each client checks
// a face again when it decodes it (racemenuPresetPlan.ts), so a file edited by hand cannot reach skee unchecked.
// Config "racemenuPresets": { enabled, dir, ... }; enabled false answers every request with a plain "none" and ignores
// uploads. Never "off": a 0.3.90 client keeps "off" until Skyrim restarts, so every player online while the module was
// off (or left out of a staff test) would need a full restart after go-live (10 Oct review S1).
//
// Server -> Client: dboPresetNone { actor, self? }; dboPresetMeta / dboPresetChunk { actor, self?, hash, race, ... };
//                   dboPresetRev { actor, hash }; dboPresetRefused { actor, self: true, hash, reason } (10 Oct review S3):
//                   the owner's upload with this hash ('' for a clear) was not stored and nothing was charged for it; the
//                   client forgets that it sent it and puts the server's face back. reason is short and machine-read:
//                   notloaded, otherrace, clear, gold, noeditor, late, unreadable, beast, norace, hash, rules, rate, gate,
//                   write (the file could not be written: anything charged for it is given back), headswap (the editor
//                   had swapped in another race's head, which the server put back: a sculpt made on it would not show)
const fs = require('fs');
const path = require('path');

const MAX_CUSTOM_MORPHS = 1024;
const MAX_MORPH_NAME = 128;
// skee's ranges (FaceMorphInterface.cpp:963-968, 1318-1354): a preset index 0..255 is kept, any other value clamped to +-MAX_SLIDER
const MAX_SLIDER = 10;
const MAX_PRESET_INDEX = 255;
// skee applies a slider once per whole unit of its value on every watcher (FaceMorphInterface.cpp:1156-1167): a face's limit
const MAX_MORPH_REPEATS = 4096;
// A sculpt moves a vertex at most this many units (a head is about 20 across); an offset past it is clamped
const MAX_SCULPT_UNITS = 30;
const MAX_SCULPT_HOSTS = 16;
const MAX_VERTICES = 65535;
const MAX_SCULPT_OFFSET = 10000000;
const MAX_SCULPT_DIVISOR = 1000000;
const MAX_MOD_NAMES = 512;
const MAX_MOD_NAME = 260;
const MAX_TRI_PATH = 200;
// The client's PRESET_MAX_CHARS: the rules drop the largest sculpted parts first to stay under it. An upload still over
// it as the rules give it (sliders and plugin names only, a header put in, escaped names) is refused, never stored
const PRESET_MAX_CHARS = 1000000;
// skee's PresetHeader (PresetInterface.cpp:300-305): "SKSE" byte-swapped, format 3; its loader needs both (:932-946)
const SKEE_SIGNATURE = 0x45534b53;
const SKEE_FORMAT_VERSION = 3;
const HASH_RX = /^[0-9a-f]{8}$/;
const KEY_RX = /^[0-9a-f]{8}$/;

const isObject = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const isUint32 = (x) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 0xffffffff;
const isIntIn = (x, lo, hi) => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
const isCleanString = (x, max) => typeof x === 'string' && x.length > 0 && x.length <= max && !/[\u0000-\u001f\u007f]/.test(x);
// skee's names compare as _stricmp does (StringTable.h SKEEFixedString): ASCII letters only
const asciiLower = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
// ValidateTriPath's rule (platform PresetFiles.cpp) plus the apostrophe of KS Hairdo's; the platform answers -1 there, so that sculpt is dropped
const isTriPath = (x) => typeof x === 'string' && x.length > 0 && x.length <= MAX_TRI_PATH && /^[A-Za-z0-9_\-. \\/']+$/.test(x)
  && !/^[\\/ ]/.test(x) && x.indexOf('..') === -1 && /\.tri$/i.test(x);

// FNV-1a over UTF-16 code units, 8 hex digits, as the client's hashText
const hashText = (text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ('0000000' + h.toString(16)).slice(-8);
};

// The client's morphValueOf: a whole number 0..MAX_PRESET_INDEX as it is, else clamped; null for no finite number
const morphValueOf = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (Number.isInteger(v) && v >= 0 && v <= MAX_PRESET_INDEX) return v;
  return Math.min(MAX_SLIDER, Math.max(-MAX_SLIDER, v));
};

// The client's encodedAtMost: an upper bound of encodeFace's length, so most faces skip the encode
const encodedAtMost = (f) => {
  let n = 400;
  for (const m of f.modNames) n += m.length * 6 + 3;
  for (const m of f.custom) n += m.name.length * 6 + 50;
  for (const h of f.sculpt) n += h.host.length * 6 + 60 + h.data.length * 40;
  return n;
};

// The client's facePresetFixed rule for rule, over its encoded form: { face, fixes }, each bad entry dropped or clamped, null if no object
const faceFixed = (raw) => {
  if (!isObject(raw)) return null;
  const fixes = [];
  const fix = (code, first, n = 1) => { const f = fixes.find((x) => x.code === code); if (f) f.n += n; else fixes.push({ code, n, first: String(first()).slice(0, 120) }); };
  const v = raw.version;
  let version = isObject(v) && isUint32(v.signature) && isUint32(v.formatVersion) && v.formatVersion >= 1
    ? { signature: v.signature, formatVersion: v.formatVersion, skseVersion: isUint32(v.skseVersion) ? v.skseVersion : 0, runtimeVersion: isUint32(v.runtimeVersion) ? v.runtimeVersion : 0 }
    : null;
  if (!version) { fix('version', () => 'version'); version = { signature: SKEE_SIGNATURE, formatVersion: SKEE_FORMAT_VERSION, skseVersion: 0, runtimeVersion: 0 }; }
  const modNames = [];
  for (const n of Array.isArray(raw.modNames) ? raw.modNames : []) if (isCleanString(n, MAX_MOD_NAME) && modNames.length < MAX_MOD_NAMES && !modNames.includes(n)) modNames.push(n);
  if (!modNames.length) modNames.push('Skyrim.esm');
  // Sliders: one value per name (any case), the last one set, as skee's ValueSet (FaceMorphInterface.cpp:450-457)
  const custom = [];
  const customIn = raw.custom;
  if (customIn !== undefined && customIn !== null && !Array.isArray(customIn)) fix('custom-list', () => typeof customIn);
  else if (Array.isArray(customIn)) {
    const byName = new Map();
    for (let i = 0; i < customIn.length; i++) {
      const m = customIn[i];
      if (!isObject(m) || !isCleanString(m.name, MAX_MORPH_NAME)) { fix('custom-name', () => `#${i}`); continue; }
      const value = morphValueOf(m.value);
      if (value === null) { fix('custom-value', () => `${m.name}=${String(m.value)}`); continue; }
      if (value !== m.value) fix('custom-clamp', () => `${m.name}=${String(m.value)}`);
      const key = asciiLower(m.name);
      const had = byName.get(key);
      if (had) { fix('custom-dup', () => m.name); had.value = value; } else byName.set(key, { name: m.name, value });
    }
    let repeats = MAX_MORPH_REPEATS;
    for (const m of byName.values()) {
      if (m.value === 0) continue;
      if (custom.length >= MAX_CUSTOM_MORPHS) { fix('custom-count', () => m.name); continue; }
      const cost = Math.floor(Math.abs(m.value));
      if (cost > repeats) { fix('custom-budget', () => `${m.name}=${m.value}`); continue; }
      repeats -= cost;
      custom.push({ name: m.name, value: m.value });
    }
  }
  // Sculpt: a broken host or vertex is dropped, an offset clamped, a repeated vertex kept once with its last offsets (force_insert)
  const sculptIn = raw.sculpt;
  const hasSculpt = Array.isArray(sculptIn) && sculptIn.some((h) => isObject(h) && Array.isArray(h.data) && h.data.length > 0);
  let sculpt = [];
  if (hasSculpt && !isIntIn(raw.sculptDivisor, 1, MAX_SCULPT_DIVISOR)) fix('sculpt-divisor', () => String(raw.sculptDivisor));
  else if (sculptIn !== undefined && sculptIn !== null && !Array.isArray(sculptIn)) fix('sculpt-list', () => typeof sculptIn);
  else if (Array.isArray(sculptIn)) {
    const maxOffset = Math.min(MAX_SCULPT_OFFSET, MAX_SCULPT_UNITS * (hasSculpt ? raw.sculptDivisor : 10000));
    for (let i = 0; i < sculptIn.length; i++) {
      const h = sculptIn[i];
      if (!isObject(h) || !isTriPath(h.host)) { fix('sculpt-host', () => (isObject(h) ? String(h.host) : `#${i}`)); continue; }
      const host = h.host;
      const data = h.data === undefined || h.data === null ? [] : h.data;
      if (!Array.isArray(data)) { fix('sculpt-data', () => host); continue; }
      // Empty, or a second entry for a host already taken (any case): left out
      if (!data.length || sculpt.some((o) => o.host.toLowerCase() === host.toLowerCase())) continue;
      if (!isIntIn(h.vertices, 1, MAX_VERTICES)) { fix('sculpt-vertices', () => `${host} ${String(h.vertices)}`); continue; }
      const vertices = h.vertices;
      const byIndex = new Map();
      let clamped = 0;
      for (const e of data) {
        if (!Array.isArray(e) || e.length !== 4 || !isIntIn(e[0], 0, vertices - 1)
          || !Number.isInteger(e[1]) || !Number.isInteger(e[2]) || !Number.isInteger(e[3])) { fix('sculpt-vertex', () => host); continue; }
        const out = [e[0]];
        let c = false;
        for (let k = 1; k < 4; k++) { const b = Math.min(maxOffset, Math.max(-maxOffset, e[k])); if (b !== e[k]) c = true; out.push(b); }
        if (c) clamped++;
        if (byIndex.has(out[0])) fix('sculpt-dupvertex', () => host);
        byIndex.set(out[0], out);
      }
      if (clamped) fix('sculpt-offset', () => host, clamped);
      if (!byIndex.size) continue;
      if (sculpt.length >= MAX_SCULPT_HOSTS) { fix('sculpt-count', () => host); continue; }
      sculpt.push({ host, vertices, data: Array.from(byIndex.values()) });
    }
  }
  const face = { version, modNames, custom, sculptDivisor: sculpt.length ? raw.sculptDivisor : 10000, sculpt };
  // Too long to send or keep: the largest sculpted parts go first, the sliders stay
  while (face.sculpt.length && encodedAtMost(face) > PRESET_MAX_CHARS && encodeFace(face).length > PRESET_MAX_CHARS) {
    let big = 0;
    for (let i = 1; i < face.sculpt.length; i++) if (face.sculpt[i].data.length > face.sculpt[big].data.length) big = i;
    const gone = face.sculpt[big];
    fix('sculpt-size', () => gone.host);
    face.sculpt = face.sculpt.filter((_, i) => i !== big);
    if (!face.sculpt.length) face.sculptDivisor = 10000;
  }
  return { face, fixes };
};
const faceFrom = (raw) => { const t = faceFixed(raw); return t ? t.face : null; };
// "code:n,code:n", as the client's trace (no names or paths)
const fixesText = (fixes) => fixes.map((f) => `${f.code}:${f.n}`).join(',');

// The client's encodeFace: one face is always one text
const encodeFace = (f) => JSON.stringify({
  version: { signature: f.version.signature, formatVersion: f.version.formatVersion, skseVersion: f.version.skseVersion, runtimeVersion: f.version.runtimeVersion },
  modNames: f.modNames,
  custom: f.custom.map((m) => ({ name: m.name, value: m.value })),
  sculptDivisor: f.sculptDivisor,
  sculpt: f.sculpt.map((h) => ({ host: h.host, vertices: h.vertices, data: h.data })),
});

// What a face shows, for telling a change from none (10 Oct review R3): the sliders by name, the sculpt by host (any case)
// and vertex, and not the plugin list or the versions skee writes around them, nor the order skee lists its maps in. A
// client with one more plugin, or a skee that lists the same face in another order, closing /appearance unchanged is not
// a new face, so it is neither written nor charged. The stored text stays as the client sent it (its hash is the client's)
const byFirst = (x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0);
const contentOf = (f) => hashText(JSON.stringify({
  custom: f.custom.map((m) => [m.name, m.value]).sort(byFirst),
  sculptDivisor: f.sculpt.length ? f.sculptDivisor : 0,
  sculpt: f.sculpt.map((h) => [h.host.toLowerCase(), h.vertices, h.data.map((e) => e.slice()).sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2] || p[3] - q[3])]).sort(byFirst),
}));

// A race and its vampire variant are one family (racedefaultheads.json lists both ids per race; the DLE's Maormer pair is
// config maormerRace, once both are RACE records). supernatural.js swaps a player between the two at a turn or a cure
const loadFamilies = (mp, cfg, log) => {
  const fam = new Map();
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'racedefaultheads.json'), 'utf8'));
    for (const [edid, r] of Object.entries((j && j.races) || {})) for (const id of (r && Array.isArray(r.ids) ? r.ids : [])) { const n = parseInt(id, 16) >>> 0; if (n) fam.set(n, edid); }
  } catch (e) { log('racemenu presets: racedefaultheads.json could not be read, so a face saved before a vampire turn or cure waits for that race:', e.message); }
  const raceId = (d) => {
    try {
      const id = d && typeof mp.getIdFromDesc === 'function' ? mp.getIdFromDesc(String(d)) >>> 0 : 0;
      const r = id && typeof mp.lookupEspmRecordById === 'function' ? mp.lookupEspmRecordById(id) : null;
      return r && r.record && String(r.record.type) === 'RACE' ? id : 0;
    } catch (e) { return 0; }
  };
  const M = (cfg && cfg.maormerRace) || {};
  const r = raceId(M.race), v = raceId(M.vampire);
  if (r && v) { fam.set(r, 'MaormerRace'); fam.set(v, 'MaormerRace'); }
  return fam;
};

const chunkText = (text, size) => { const out = []; for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size)); return out; };

module.exports = (api) => {
  const { mp, log, sendPacket, onlineActors, actorOf, profileOf, cfg } = api;
  const C = Object.assign({
    enabled: true,
    dir: 'racemenu-presets',
    maxChars: 1000000,          // the client's PRESET_MAX_CHARS
    chunkChars: 12000,          // the client's CHUNK_CHARS
    sendMs: 250,                // one chunk per recipient this often: a sculpted face takes a few seconds, never a burst
    uploadTimeoutMs: 60000,
    uploadsPerHour: 30,         // per character; each one that changes the face is a file write
    getsPerMinute: 120,         // per player; one per copy that spawns, retried every 15 s at most
    // One player is sent the whole of one face at most resendsPerFace times per resendWindowMs in a connection (0: no
    // limit). A client that cannot show a face asks again every 15 s with have '' and was sent all of it each time: 0.3.94
    // refuses a face 0.3.95 saved with the wider values, a 45 KB face 20 times in 5 min (12 Oct review, e2e-mixed.js).
    // Past the limit it gets the header only until the window ends
    resendsPerFace: 2,
    resendWindowMs: 600000,
    cacheEntries: 16,
    cacheChars: 4000000,        // the read cache holds at most this much face text
    queuePerRecipient: 200,     // packets waiting for one player (a few faces); more waits for the client's retry
    // A staff test before everyone (9 Oct): profile ids listed here are the only ones whose faces are saved or served;
    // everyone else is answered "none" and their uploads are ignored. Empty: every player.
    testProfiles: [],
    // A face change is stored only in an editor the server opened, and an /appearance closed with the vanilla look
    // unchanged pays for it then (appearance.js __dboRaceMenuSaveGate). false: every upload is stored (the 7 Oct rule).
    requireEditor: true,
    // A change to a saved face is taken only once the owner was sent it this session (its last chunk, or "none"), and only
    // from an editor opened this long after: a RaceMenu opened before the face was put back captures an empty one (9 Oct)
    loadSettleMs: 10000,
  }, (cfg && cfg.racemenuPresets) || {});
  const DIR = path.resolve(C.dir);
  const MAX_CHUNKS = Math.ceil(Number(C.maxChars) / Number(C.chunkChars));

  // Kept across a hot reload: uploads in flight, send queues, rate counters, the read cache, writes in flight
  const old = globalThis.__dboPresetState;
  const S = old && old.v === 1 ? old : (globalThis.__dboPresetState = { v: 1, uploads: new Map(), queues: new Map(), rates: new Map(), cache: new Map(), writing: new Map() });
  // '<to>:<actor>:<self 0|1>' -> { hash, conn, at, n, told }: how often that player was sent the whole of that face (see answer)
  if (!(S.fullSends instanceof Map)) S.fullSends = new Map();
  // actor -> { at, conn }: when the owner was last sent their own stored face, in which connection (gamemode connectedAt)
  if (!(S.selfSent instanceof Map)) S.selfSent = new Map();
  if (!(S.selfLast instanceof WeakSet)) S.selfLast = new WeakSet();   // the last packet of an answer to the owner
  if (!(S.gen instanceof Map)) S.gen = new Map();   // key -> how many face writes were asked for (see readDoc)
  if (!(S.logRates instanceof Map)) S.logRates = new Map();   // log-only limiters, kept apart from S.rates so they never trip its 5000-key clear

  const keyOf = (a) => ((Number(a) >>> 0).toString(16)).padStart(8, '0');
  const fileOf = (k) => path.join(DIR, `${k}.json`);
  const isPlayer = (a) => profileOf(a) >= 0;
  const TEST = Array.isArray(C.testProfiles) && C.testProfiles.length ? new Set(C.testProfiles.map((x) => Number(x))) : null;
  const inTest = (a) => !TEST || TEST.has(profileOf(a));
  // appearance.js's verdict on storing this face change (the RaceMenu save window); no gate loaded: refused
  const gateAllows = (me, first, opts) => {
    if (C.requireEditor === false) return { ok: true };
    const gate = globalThis.__dboRaceMenuSaveGate;
    if (typeof gate !== 'function') return { ok: false, reason: 'appearance.js not loaded' };
    try { return gate(me, 'face', first, opts) || { ok: false, reason: 'no answer' }; } catch (e) { return { ok: false, reason: e.message }; }
  };
  const connOf = (a) => { try { return Number((globalThis.__dboConnectedAt instanceof Map ? globalThis.__dboConnectedAt : new Map()).get(a >>> 0)) || 0; } catch (e) { return 0; } };
  // Null when the owner's saved face is on their player this session and the editor opened after it, else why not
  const notLoadedYet = (me) => {
    const sent = S.selfSent.get(me >>> 0);
    if (!sent || sent.conn !== connOf(me)) return 'never sent this session';
    const opened = globalThis.__dboRaceMenuOpenedAt instanceof Map ? Number(globalThis.__dboRaceMenuOpenedAt.get(me >>> 0)) || 0 : 0;
    // Every editor the server opens is noted when it opens (appearance.js noteEditorOpened, gamemode.js openCreator). One with
    // no opening in this connection was open before the face went back: the engine keeps RaceMenu open across a relog or
    // a restart and the client reopens it at spawn, so it captures a face that was never put on (10 Oct review R1, F1).
    // With requireEditor false any editor saves (the console's too, never noted), so only the settle check below applies
    if (C.requireEditor !== false && (!opened || opened < sent.conn)) return 'the editor was open from before this session';
    if (opened && opened >= sent.conn && opened < sent.at + Number(C.loadSettleMs)) return 'the editor opened before it was put back';
    return null;
  };
  const raceOf = (a) => { try { const ap = mp.get(a, 'appearance'); return ap && Number.isInteger(ap.raceId) ? ap.raceId >>> 0 : 0; } catch (e) { return 0; } };
  // The look's head parts, in hex, for the 'face saved' line
  const partsOf = (a) => { try { const ap = mp.get(a, 'appearance'); return ap && Array.isArray(ap.headpartIds) ? ap.headpartIds.map((x) => (Number(x) >>> 0).toString(16)).join(' ') : ''; } catch (e) { return ''; } };
  const FAMILY = loadFamilies(mp, cfg, log);
  // The same race, or its vampire or mortal variant
  const sameFamily = (x, y) => { x = Number(x) >>> 0; y = Number(y) >>> 0; if (x === y) return true; const f = FAMILY.get(x); return !!f && f === FAMILY.get(y); };
  // The content key of a stored face (an older file has none; worked out once and kept on the cached doc)
  const contentOfDoc = (d) => {
    if (!d) return '';
    if (typeof d.content !== 'string') { let f = null; try { f = faceFrom(JSON.parse(d.face)); } catch (e) { f = null; } d.content = f ? contentOf(f) : ''; }
    return d.content;
  };
  // The heads a stored face's sculpt is on, in lower case (E5); none when nothing is stored
  const sculptHostsOfDoc = (d) => {
    let f = null;
    try { f = d && typeof d.face === 'string' ? faceFrom(JSON.parse(d.face)) : null; } catch (e) { f = null; }
    return new Set(f ? f.sculpt.map((h) => h.host.toLowerCase()) : []);
  };
  // A RaceMenu-only change not kept: the owner's client is told which upload (S3), the player why (appearance.js, S5)
  const refused = (me, hash, code, line) => {
    log(`racemenu presets: ${line}`);
    // A 0.3.95 client that loses its upload asks for its own face again (racemenuPresetService.ts onRefused): sent in full
    S.fullSends.delete(`${me >>> 0}:${me >>> 0}:1`);
    try { sendPacket(me, { customPacketType: 'dboPresetRefused', actor: me >>> 0, self: true, hash: HASH_RX.test(hash) ? hash : '', reason: code }); } catch (e) { log('racemenu presets: refusal not sent', e.message); }
    try { if (typeof globalThis.__dboRaceMenuRefused === 'function') globalThis.__dboRaceMenuRefused(me, 'face', code); } catch (e) { log('racemenu presets: refusal not told', e.message); }
  };
  // In a beast form the appearance carries the beast race (beastform.js keeps the real one): no face is taken then
  const inBeastForm = (a) => { try { return typeof globalThis.__dboBeastOriginalRace === 'function' && globalThis.__dboBeastOriginalRace(a) > 0; } catch (e) { return true; } };

  // ---- storage: one file per character, the cache in front of it ----
  const remember = (k, doc) => {
    S.cache.delete(k);
    S.cache.set(k, doc);
    const chars = () => { let n = 0; for (const d of S.cache.values()) n += d && d.face ? d.face.length : 0; return n; };
    while (S.cache.size > Number(C.cacheEntries) || (S.cache.size > 1 && chars() > Number(C.cacheChars))) S.cache.delete(S.cache.keys().next().value);
  };
  // A name for a file moved out of the way (<key>.json.bad-..., <key>.json.cleared-...): never one used before, even twice in
  // one millisecond, so a second move never replaces the first copy (10 Oct review 2)
  const asideName = (file, tag) => {
    globalThis.__dboAsideSeq = (Number(globalThis.__dboAsideSeq) || 0) + 1;
    return `${file}.${tag}-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${globalThis.__dboAsideSeq}`;
  };
  // The file operations for one character run one at a time: a face written, a face cleared, a bad file set aside.
  // S.writing: key -> the one under way, { doc, cbs, next, nextCbs, waiters }. doc is the face being written (null: a clear;
  // undefined: a set-aside) and cbs hear how it went; a newer face waits in next (only the newest is written, and the callers
  // of a face it replaced hear how the newest went); waiters (reads) run once nothing is under way. S.gen counts the writes
  // asked for per key, so a read that a write overtook reads again
  const opStart = (k, doc, cbs, waiters) => { const w = { doc, cbs, next: undefined, nextCbs: [], waiters: waiters || [] }; S.writing.set(k, w); return w; };
  const opDone = (k) => {
    const w = S.writing.get(k);
    S.writing.delete(k);
    if (!w) return;
    if (w.next !== undefined) { runWrite(k, w.next, w.nextCbs || [], w.waiters); return; }
    for (const fn of w.waiters || []) { try { fn(); } catch (e) { log('racemenu presets: a read after a write failed', e.message); } }
  };
  // Runs fn once nothing is under way for this key; false when nothing is (an entry an older module left has no waiters:
  // it is read as before)
  const afterOp = (k, fn) => { const w = S.writing.get(k); if (!w || !Array.isArray(w.waiters)) return false; w.waiters.push(fn); return true; };
  const runWrite = (k, d, cbs, waiters) => {
    const w = opStart(k, d, cbs, waiters);
    const file = fileOf(k);
    const tmp = `${file}.tmp`;
    let keptAs = '';
    const done = (err) => {
      if (err) {
        log(`racemenu presets: ${d === null ? 'clear' : 'write'} ${k} failed (${err.code || err.message}), the file on disk is as it was`);
        if (d !== null) fs.unlink(tmp, () => {});
        // The cache goes back to what is on disk, unless a newer face waits to be written (the cache holds that one)
        if (w.next === undefined) S.cache.delete(k);
      }
      const told = w.cbs; w.cbs = [];
      for (const cb of told) { try { cb(err || null, d, keptAs); } catch (e) { log('racemenu presets: after a write', e.message); } }
      opDone(k);
    };
    fs.mkdir(DIR, { recursive: true }, (mkErr) => {
      if (mkErr) return done(mkErr);
      // A clear keeps the face it removes, as <key>.json.cleared-<time>-<pid>-<n> (10 Oct review 2, b): only creation, a
      // reroll or a GM's /chargen clears a face, and one whose capture came back empty by mistake can be put back by hand
      if (d === null) {
        const kept = asideName(file, 'cleared');
        return fs.rename(file, kept, (e) => { if (!e) keptAs = path.basename(kept); done(e && e.code !== 'ENOENT' ? e : null); });
      }
      // Durable before it counts (10 Oct review 2, a): written to a tmp file, flushed to the disk, then renamed over the old
      // one. A failure (ENOSPC, EIO) leaves the old file whole, and the caller gives back what it charged
      fs.writeFile(tmp, JSON.stringify(d), (e) => {
        if (e) return done(e);
        fs.open(tmp, 'r+', (oe, fd) => {
          if (oe) return done(oe);
          fs.fdatasync(fd, (se) => fs.close(fd, (ce) => (se || ce ? done(se || ce) : fs.rename(tmp, file, done))));
        });
      });
    });
  };
  // One write per character at a time; a newer face waits for the one in flight, and only the newest is written.
  // cb(err, written, keptAs): how the write went; written is the face that went to disk (a newer one can replace this one
  // before it is written); keptAs is the copy a clear kept
  const writeDoc = (k, doc, cb) => {
    S.gen.set(k, (S.gen.get(k) || 0) + 1);
    remember(k, doc);
    const w = S.writing.get(k);
    if (w) { w.next = doc; (w.nextCbs || (w.nextCbs = [])).push(cb); return; }
    runWrite(k, doc, [cb]);
  };
  // A file that fails its checks is set aside as <key>.json.bad-<time>-<pid>-<n> before it counts as no face (10 Oct review
  // 2, c): the next capture would otherwise replace it unseen, as a free first save. done(true) once it is out of the way;
  // done(false) when it could not be moved, and then it is not taken as none (nothing may be written over it)
  const setAside = (k, why, done) => {
    const file = fileOf(k);
    const bad = asideName(file, 'bad');
    opStart(k, undefined, []);
    fs.rename(file, bad, (e) => {
      const moved = !e || e.code === 'ENOENT';
      log(`racemenu presets: ${k}.json ${why}, ${moved ? `ignored${e ? '' : `, kept as ${path.basename(bad)}`}` : `and could not be set aside (${e.code || e.message}): not taken as none, nothing written over it`}`);
      try { done(moved); } finally { opDone(k); }
    });
  };
  // doc: { v, actor, profile, race, hash, content, face } or null for none; a file another character's profile wrote is
  // none. cb(doc, bad): bad when the file is there but could not be read (EMFILE, EIO, ...) or set aside: that is not "no
  // face", so it is not cached and nothing may be written over it (10 Oct review R6c, F8)
  const readDoc = (a, cb) => {
    const k = keyOf(a);
    if (!KEY_RX.test(k)) return cb(null, false);
    const check = (doc) => (doc && doc.profile === profileOf(a) ? doc : null);
    if (S.cache.has(k)) return cb(check(S.cache.get(k)), false);
    // A file operation under way (the cache let go of its face): read once the disk has settled
    if (afterOp(k, () => readDoc(a, cb))) return undefined;
    const gen = S.gen.get(k) || 0;
    fs.readFile(fileOf(k), 'utf8', (err, text) => {
      // A write was asked for while this read was under way: the cache holds that newer face (or the disk will)
      if ((S.gen.get(k) || 0) !== gen) return readDoc(a, cb);
      // Another read of the same file began setting it aside meanwhile: read once that is done
      if (afterOp(k, () => readDoc(a, cb))) return undefined;
      if (err && err.code !== 'ENOENT') { log(`racemenu presets: ${k}.json could not be read (${err.code || err.message}), not taken as none`); return cb(null, true); }
      let doc = null;
      let why = '';
      if (!err) {
        try {
          const d = JSON.parse(text);
          const f = d && typeof d.face === 'string' && d.face.length <= Number(C.maxChars) && HASH_RX.test(d.hash) && hashText(d.face) === d.hash ? faceFrom(JSON.parse(d.face)) : null;
          // The content key is worked out from the face, never taken from the file
          if (f) { d.content = contentOf(f); doc = d; } else why = 'fails its checks';
        } catch (e) { why = 'unreadable'; }
      }
      if (!why) { remember(k, doc); return cb(check(doc), false); }
      return setAside(k, why, (moved) => {
        if (!moved) return cb(null, true);
        // A face asked to be written while it was moved is the one that counts (the cache holds it)
        if ((S.gen.get(k) || 0) !== gen) return readDoc(a, cb);
        remember(k, null);
        return cb(null, false);
      });
    });
  };

  // ---- sending, paced per recipient ----
  const enqueue = (to, payloads) => {
    const q = S.queues.get(to) || [];
    // A newer answer about the same character replaces one still waiting
    const about = payloads.length ? payloads[0].actor : 0;
    const kept = q.filter((p) => p.actor !== about);
    if (kept.length + payloads.length > Number(C.queuePerRecipient)) { S.queues.set(to, kept); return false; }
    S.queues.set(to, kept.concat(payloads));
    return true;
  };
  const pump = () => {
    if (!S.queues.size) return;
    const online = new Set(onlineActors().map((x) => x >>> 0));
    for (const [to, q] of S.queues) {
      if (!online.has(to) || !q.length) { S.queues.delete(to); continue; }
      const p = q.shift();
      // Off, only the plain 'none' goes out: a face read that was under way at the switch queues its answer after the
      // queues were emptied (the quick undo below), and that face must not reach anyone either
      if (C.enabled || p.customPacketType === 'dboPresetNone') {
        sendPacket(to, p);
        if (S.selfLast.has(p)) S.selfSent.set(to >>> 0, { at: Date.now(), conn: connOf(to) });
      }
      if (!q.length) S.queues.delete(to);
    }
  };
  if (typeof api.every === 'function') api.every('racemenuPresetSend', Number(C.sendMs), pump);
  else { if (S.timer) clearInterval(S.timer); S.timer = setInterval(pump, Number(C.sendMs)); }

  // An answer to the owner about themselves marks its last packet, so its sending counts as the face put back
  const enqueueAnswer = (to, payloads, self) => { if (self && payloads.length) S.selfLast.add(payloads[payloads.length - 1]); return enqueue(to, payloads); };
  const answer = (to, a, doc, have, self) => {
    const actor = a >>> 0;
    const base = self ? { actor, self: true } : { actor };
    if (!doc) return enqueueAnswer(to, [{ customPacketType: 'dboPresetNone', ...base }], self);
    // The client puts a face on only when the race it is sent with is the character's own (racemenuPresetPlan.ts
    // applyBlockedBy). A face saved before a vampire turn or a cure is sent with the race the character has now, so it
    // still goes on, for the owner and for every watcher (10 Oct review S2). Another race (a beast form, a GM's race change)
    // keeps the stored one, and the client waits
    const now = raceOf(a);
    const race = now && doc.race && now !== (doc.race >>> 0) && sameFamily(now, doc.race) ? now : doc.race;
    const meta = { customPacketType: 'dboPresetMeta', ...base, hash: doc.hash, race };
    if (have === doc.hash) return enqueueAnswer(to, [meta], self);
    // Sent in full resendsPerFace times in this window and connection, and asked for again: that player cannot show it
    // (0.3.94 refuses a face with the wider values, keeps nothing and asks again every 15 s; a client that shows a face
    // keeps it and asks with its hash). The header only, as for a client that has it, until the window ends. A relog,
    // another face, or a refused upload of the owner's (refused above) starts the count again
    const limit = Number(C.resendsPerFace), windowMs = Number(C.resendWindowMs);
    const k = `${to >>> 0}:${actor}:${self ? 1 : 0}`;
    const t = Date.now(), conn = connOf(to);
    let e = S.fullSends.get(k);
    if (e && (e.hash !== doc.hash || e.conn !== conn || !(t - e.at < windowMs))) { S.fullSends.delete(k); e = undefined; }
    if (limit > 0 && e && e.n >= limit) {
      // The rest of a long face may still be on its way (it takes longer than the client's 15 s retry): it goes on
      const q = S.queues.get(to);
      if (q && q.some((p) => p.customPacketType === 'dboPresetChunk' && p.actor === actor && p.hash === doc.hash)) return true;
      if (!e.told) {
        e.told = true;
        log(`racemenu presets: ${keyOf(to)} asked again for ${keyOf(actor)}'s face ${doc.hash}${self ? ' (their own)' : ''}, sent in full ${e.n} times in ${Math.round((t - e.at) / 1000)} s: the header only for ${Math.round((e.at + windowMs - t) / 1000)} s (a client that cannot show it, as 0.3.94)`);
      }
      return enqueueAnswer(to, [meta], self);
    }
    const chunks = chunkText(doc.face, Number(C.chunkChars));
    const queued = enqueueAnswer(to, [meta].concat(chunks.map((data, i) => ({ customPacketType: 'dboPresetChunk', ...base, hash: doc.hash, race, i, n: chunks.length, data }))), self);
    if (queued && limit > 0) {
      if (!e) { e = { hash: doc.hash, conn, at: t, n: 0, told: false }; S.fullSends.set(k, e); }
      e.n++;
      if (S.fullSends.size > 5000) {
        for (const [x, y] of S.fullSends) if (!(t - y.at < windowMs)) S.fullSends.delete(x);
        if (S.fullSends.size > 5000) S.fullSends.clear();
      }
    }
    return queued;
  };

  // ---- rate limits ----
  const allow = (kind, who, perWindow, windowMs, m = S.rates) => {
    const k = `${kind}:${who}`;
    const now = Date.now();
    const r = (m.get(k) || []).filter((t) => now - t < windowMs);
    if (r.length >= perWindow) { m.set(k, r); return false; }
    r.push(now);
    m.set(k, r);
    if (m.size > 5000) m.clear();
    return true;
  };

  // ---- the packets ----
  const onGet = (userId, content) => {
    const me = actorOf(userId); if (!me) return;
    const self = Number(content.actor) === 0;
    // Off, or left out of a staff test: a plain "none", never "off" (S1, see the top), so the client keeps asking and
    // picks the faces up as soon as the module is on for it. Not counted as the owner's face put back
    if (!C.enabled || !inTest(me)) return enqueue(me, [{ customPacketType: 'dboPresetNone', actor: self ? me : (Number(content.actor) >>> 0) || me, ...(self ? { self: true } : {}) }]);
    if (!allow('get', me, Number(C.getsPerMinute), 60000)) return;
    const a = self ? me : Number(content.actor) >>> 0;
    if (!a || !isPlayer(a)) return enqueue(me, [{ customPacketType: 'dboPresetNone', actor: a || me, ...(self ? { self: true } : {}) }]);
    const have = typeof content.have === 'string' ? content.have : '';
    // A file that could not be read is not answered: "none" would let the owner's next capture, made without the face,
    // replace it. The client asks again every 15 s while it has no answer (racemenuPresetService.ts GET_RETRY_MS)
    readDoc(a, (doc, bad) => { if (!bad) answer(me, a, doc, have, self); });
  };

  // The editor close an upload came from, for the log: the save window appearance.js opened at that close, if any
  const windowOf = (me) => {
    const ws = globalThis.__dboRaceMenuSaveWindows;
    const w = ws instanceof Map ? ws.get(me >>> 0) : null;
    if (!w) return 'no editor window';
    return `${w.kind || 'editor'} window${w.charge ? ', priced' : ''}${w.headswap ? ', head swapped' : ''}${Date.now() > w.until ? ', expired' : ''}`;
  };
  // Every finished upload leaves one log line (12 Oct upload gap): an empty face with none stored and an unchanged face
  // were dropped without one, so the log could not tell a client that sent an empty face from one that sent nothing
  // (two /appearance closes, Elaava #Z63J 06:14:56 and Foratus #553K 08:11:16, left no 'racemenu presets' line at all)
  const finishUpload = (me, u) => {
    const k = keyOf(me);
    // The hash the client gave this upload ('' for a clear), handed back in dboPresetRefused
    const upHash = u.n > 0 && typeof u.hash === 'string' ? u.hash : '';
    const refuse = (code, line) => refused(me, upHash, code, line);
    if (inBeastForm(me)) return refuse('beast', `${k} upload in a beast form, refused`);
    const race = raceOf(me);
    if (!race) return refuse('norace', `${k} has no appearance race, upload refused`);
    let doc = null;
    // For the 'face saved' line: the heads the sculpt was made on, with how many vertices each moves (10 Oct review 2-e2e G8,
    // E5). skee shows a sculpt only on a head whose .tri is its host, so staff can check a sculpt that does not show (and
    // the 500 gold it may have cost) against the look's head parts in the same line
    let hosts = [];
    let sculptHosts = [];   // the same heads in lower case, for E5 below
    let fixedText = '';     // what the rules dropped or clamped here, for the same line
    if (u.n > 0) {
      const text = u.parts.join('');
      if (text.length > Number(C.maxChars) || hashText(text) !== u.hash) return refuse('hash', `${k} upload does not match its hash, refused`);
      let taken = null;
      try { taken = faceFixed(JSON.parse(text)); } catch (e) { taken = null; }
      // Only what is not a JSON object is refused: a bad entry is dropped or clamped on its own
      if (!taken) return refuse('rules', `${k} upload breaks the preset rules, refused`);
      const face = taken.face;
      const encoded = encodeFace(face);
      // Never stored over the cap (readDoc would set it aside at the next read, and the owner's next save would be free).
      // No client sends one: its own rules keep its text at most PRESET_MAX_CHARS, and this is the same text (12 Oct review)
      if (encoded.length > Number(C.maxChars)) return refuse('rules', `${k} upload is ${encoded.length} chars as the rules here give it, over ${Number(C.maxChars)}, refused`);
      fixedText = fixesText(taken.fixes);
      // Every client sends a face these rules keep as it is, so a change here is a mismatch to look into; the fixed face is kept
      if (encoded !== text) log(`racemenu presets: ${k} (profile ${profileOf(me)}) client/server rule mismatch: upload ${u.hash} changed by the rules here (${fixedText ? `fixed ${fixedText}` : 'not in their text form'}), kept as ${hashText(encoded)}`);
      if (face.custom.length || face.sculpt.length) doc = { v: 1, actor: k, profile: profileOf(me), race, hash: hashText(encoded), content: contentOf(face), at: new Date().toISOString(), face: encoded };
      hosts = face.sculpt.map((h) => `${h.host} (${h.data.length})`);
      sculptHosts = face.sculpt.map((h) => h.host.toLowerCase());
    }
    readDoc(me, (prev, bad) => {
      const who = `${k} (profile ${profileOf(me)}) face change not saved`;
      if (bad) return refuse('unreadable', `${who}: saved face unreadable, not changed`);
      // No change: the same face content (R3), on the same race or its vampire or mortal variant. A face handed back on
      // another race (a GM's /chargen or a reroll that changed it) is stored again with that race, so it goes on there
      if (!prev && !doc) { log(`racemenu presets: ${k} (profile ${profileOf(me)}) empty face (no RaceMenu slider or sculpt), none stored: nothing to save (${windowOf(me)})`); return; }
      if (prev && doc && contentOfDoc(prev) === doc.content && sameFamily(prev.race, race)) { log(`racemenu presets: ${k} (profile ${profileOf(me)}) face unchanged (${doc.hash}), nothing written (${windowOf(me)})`); return; }
      // A saved face is changed only from an editor opened after it was put back on the player this session; before
      // that the client captures an empty or partial face (9 Oct review). Checked before the gate, so nothing is charged.
      // Only for a close the server gave a save window (appearance.js): with none (the console's showracemenu) the gate's
      // own 'noeditor' answers, not "your saved face was still loading, redo it" (10 Oct review 2-e2e, E4)
      const windows = globalThis.__dboRaceMenuSaveWindows;
      const noWindow = C.requireEditor !== false && windows instanceof Map && !windows.has(me >>> 0);
      if (prev && !noWindow) {
        const why = notLoadedYet(me);
        if (why) return refuse('notloaded', `${who}: saved face not loaded yet (${why})`);
      }
      // Only an editor the server opened, and paid for like the look (appearance.js); checked after the read, so an
      // unchanged face is never charged, a cleared face is never paid for (and never cleared from /appearance), and a
      // stored face of another race is not replaced from /appearance (R2)
      const otherRace = !!(prev && prev.race && !sameFamily(prev.race, race));
      // E5, narrowed (12 Oct re-review, server-data 4): when the editor had swapped in another race's head (appearance.js
      // headswap), only a sculpt on a head the stored face has no sculpt on can have been made on that head, so only such a
      // face is refused there. Sliders are kept by name, on no head, and a sculpt only on heads the stored face is sculpted
      // on is that face's own, carried over; both go through the normal price and first-save rules. (A stored face whose
      // sculpt is itself on a swapped-in head, saved before E5, is not told apart: its heads count as its own.)
      const newSculpt = !!doc && sculptHosts.length > 0 && (() => { const had = sculptHostsOfDoc(prev); return sculptHosts.some((h) => !had.has(h)); })();
      // hold: a charge stands only once the face is on disk (10 Oct review 2, a); the gate hands back settle for it
      const opts = Object.assign({ hold: true }, doc ? {} : { clear: true }, otherRace ? { otherRace: true } : {}, newSculpt ? { newSculpt: true } : {});
      const verdict = gateAllows(me, !prev, opts);
      if (!verdict.ok) {
        const code = typeof verdict.code === 'string' && verdict.code ? verdict.code : verdict.reason === 'gold' ? 'gold' : 'gate';
        return refuse(code, `${who}: ${code === 'otherrace' ? `saved face is for race ${(Number(prev.race) >>> 0).toString(16)}, not changed` : verdict.reason}`);
      }
      const settle = (saved) => { try { if (typeof verdict.settle === 'function') verdict.settle(saved); } catch (e) { log('racemenu presets: settling the charge failed', e.message); } };
      // Saved, paid for and told about only once the file is written; a failed write gives the gold back and tells the
      // owner (their client puts the server's face back) and nobody else
      writeDoc(k, doc, (err, written, keptAs) => {
        if (err) {
          settle(false);
          return refuse('write', `${who}: the file could not be written (${err.code || err.message})${verdict.paid ? `, ${verdict.paid} gold given back` : ''}`);
        }
        settle(true);
        // A newer face replaced this one before it was written: that one is logged and announced
        if (written !== doc) return;
        log(`racemenu presets: ${k} (profile ${profileOf(me)}) ${doc ? `face saved, ${doc.face.length} chars, ${doc.hash}, sculpt hosts [${hosts.join(', ')}], headpartIds [${partsOf(me)}]${fixedText ? `, fixed [${fixedText}]` : ''}` : `face cleared${keptAs ? `, kept as ${keptAs}` : ''}`}`);
        const rev = { customPacketType: 'dboPresetRev', actor: me >>> 0, hash: doc ? doc.hash : '' };
        for (const b of onlineActors()) if ((b >>> 0) !== (me >>> 0)) sendPacket(b, rev);
      });
    });
  };

  const onPut = (userId, content) => {
    if (!C.enabled) return;
    const me = actorOf(userId); if (!me || !isPlayer(me) || !inTest(me)) return;
    const up = Number(content.up), n = Number(content.n), i = Number(content.i);
    const hash = typeof content.hash === 'string' ? content.hash : '';
    const data = typeof content.data === 'string' ? content.data : '';
    // A chunk dropped here, or an upload left unfinished, is logged too (at most 3 lines a minute per character)
    const dropTold = (why) => { if (allow('dropTold', me, 3, 60000, S.logRates)) log(`racemenu presets: ${keyOf(me)} (profile ${profileOf(me)}) upload chunk dropped: ${why()}`); };
    const shown = (x) => (typeof x === 'number' || typeof x === 'boolean' || x === null || x === undefined ? String(x) : typeof x === 'string' ? JSON.stringify(x.slice(0, 16)) : typeof x);
    if (!Number.isInteger(up) || !isIntIn(n, 0, MAX_CHUNKS) || data.length > Number(C.chunkChars)) return dropTold(() => `bad header (up ${shown(content.up)}, n ${shown(content.n)}, ${data.length} chars)`);
    // Told (a log line and a packet) at most 3 times a minute per character: past the hourly limit every new upload start was
    // one log line and one packet, up to the flood guard's 40 a second from one client (10 Oct review 2, item 2)
    const overRate = (h) => { if (allow('rateTold', me, 3, 60000)) refused(me, h, 'rate', `${keyOf(me)} (profile ${profileOf(me)}) face change not saved: over ${Number(C.uploadsPerHour)} uploads an hour`); };
    if (n === 0) {
      if (!allow('put', me, Number(C.uploadsPerHour), 3600000)) return overRate('');
      S.uploads.delete(me);
      return finishUpload(me, { n: 0 });
    }
    if (!HASH_RX.test(hash) || !isIntIn(i, 0, n - 1)) return dropTold(() => `bad hash or index (hash ${shown(content.hash)}, i ${shown(content.i)} of ${n})`);
    const now = Date.now();
    let u = S.uploads.get(me);
    if (u && now - u.at > Number(C.uploadTimeoutMs)) { const old = u; dropTold(() => `upload ${old.up} timed out at ${old.got} of ${old.n} chunks`); u = null; }
    if (!u || u.up !== up || u.n !== n || u.hash !== hash) {
      if (u && u.got < u.n) { const old = u; dropTold(() => `upload ${old.up} left at ${old.got} of ${old.n} chunks, upload ${up} started`); }
      // Told once per upload (its first chunk), not once per chunk
      if (!allow('put', me, Number(C.uploadsPerHour), 3600000)) { S.uploads.delete(me); if (i === 0) overRate(hash); return; }
      u = { up, n, hash, parts: new Array(n), got: 0, at: now };
      S.uploads.set(me, u);
    }
    u.at = now;
    if (u.parts[i] === undefined) { u.parts[i] = data; u.got++; }
    if (u.got < u.n) return;
    S.uploads.delete(me);
    finishUpload(me, u);
  };

  // systemd stops the server with SIGTERM: a face still being written, or waiting to be, is written at once (tmp, flushed,
  // renamed) through gamemode.js __dboFlushOnExit, as appearanceextras.js does (10 Oct review 2, a: a face paid for and
  // restarted away mid-write kept the gold and was lost). Its callers hear how it went. The newest code's flush runs
  const writeNowSync = (k, d) => {
    const file = fileOf(k);
    fs.mkdirSync(DIR, { recursive: true });
    if (d === null) {
      const kept = asideName(file, 'cleared');
      try { fs.renameSync(file, kept); return path.basename(kept); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; }
    }
    const tmp = `${file}.exit.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeFileSync(fd, JSON.stringify(d)); fs.fdatasyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
    return '';
  };
  const flushNow = () => {
    let n = 0;
    for (const [k, w] of S.writing) {
      if (!w || !Array.isArray(w.cbs)) continue;
      const d = w.next !== undefined ? w.next : w.doc;
      if (d === undefined) continue;   // a bad file being set aside: nothing to write
      const cbs = w.cbs.concat(w.nextCbs || []);
      w.cbs = []; w.nextCbs = [];
      let err = null; let keptAs = '';
      try { keptAs = writeNowSync(k, d); n++; } catch (e) { err = e; log(`racemenu presets: exit write ${k} failed (${e.code || e.message})`); }
      // The write under way may still rename an older copy afterwards if the process goes on: the newest goes again after it
      if (!err) w.next = d;
      for (const cb of cbs) { try { cb(err, d, keptAs); } catch (e) { log('racemenu presets: after the exit write', e.message); } }
    }
    return n > 0;
  };
  globalThis.__dboPresetFlush = () => { try { return flushNow(); } catch (e) { log(`racemenu presets: exit flush failed: ${e.message}`); return false; } };
  {
    const base = globalThis.__dboFlushOnExit;
    if (typeof base === 'function' && !base.__dboPresetFlush) {
      const chained = () => { try { base(); } finally { if (typeof globalThis.__dboPresetFlush === 'function') globalThis.__dboPresetFlush(); } };
      chained.__dboPresetFlush = true;
      // Whatever base already runs stays marked, so no module chains itself twice
      if (base.__dboExtrasFlush) chained.__dboExtrasFlush = true;
      globalThis.__dboFlushOnExit = chained;
    }
  }

  globalThis.__dboPresetPacket = (userId, content) => {
    try {
      if (content.customPacketType === 'dboPresetGet') return onGet(userId, content);
      if (content.customPacketType === 'dboPresetPut') return onPut(userId, content);
    } catch (e) { log('racemenu presets: packet failed', e.message); }
  };

  // The quick undo (10 Oct review 2-e2e G10, E1). Off, every client online is told that each other character online has no
  // face now (dboPresetRev, hash ''), so it drops the face it holds for them and asks again (answered none above). A 0.3.90
  // client keeps a fetched face for 10 min (racemenuPresetService.ts CACHE_FRESH_MS) and would go on loading it onto every
  // new copy until then, so turning faces off by hot reload would take up to 10 min or relogs to stop the loads. Nothing
  // on disk changes. Never about the player themselves: their own face stays on their own screen. Told only at the load
  // that turns faces off (12 Oct re-review R1): a gameplay hot reload while off sent all N*(N-1) notices again (1560 with
  // 40 online), and the clients' entries were already 'none'. S.lastEnabled: how the last load of this process left it
  if (!C.enabled) {
    // A face queued before the switch is not sent after it (12 Oct re-review, server-data 3: the rest of a download under way
    // kept going out after the notices below, and the client stored that face for another 10 min)
    S.queues.clear();
    if (S.lastEnabled !== false) {
      let told = 0, failed = 0;
      const on = onlineActors().map((x) => x >>> 0);
      for (const b of on) for (const a of on) {
        if (a === b) continue;
        try { sendPacket(b, { customPacketType: 'dboPresetRev', actor: a, hash: '' }); told++; } catch (e) { failed++; }
      }
      if (told || failed) log(`racemenu presets: off, so ${on.length} player(s) online were told to drop the faces they hold (${told} notice(s)${failed ? `, ${failed} not sent` : ''})`);
    }
  }
  // On again after an off load (12 Oct re-review R2, its S13e): each client online holds the plain 'none' it was answered
  // for its own face while off and never asks again, so its saved face would not go back on, and every change would be
  // refused 'notloaded' until a relog. A dboPresetRev about themselves with a hash no face has ('on') makes it drop that
  // 'none' and ask again (0.3.93 and 0.3.94), and the answer counts as the face put back. Other characters' faces come back
  // when the client's 'none' for them goes stale (10 min) or at a relog
  if (C.enabled && S.lastEnabled === false) {
    let n = 0;
    for (const a of onlineActors()) { try { sendPacket(a, { customPacketType: 'dboPresetRev', actor: a >>> 0, self: true, hash: 'on' }); n++; } catch (e) { /* the next one */ } }
    if (n) log(`racemenu presets: on again, so ${n} player(s) online were told to ask for their own face again`);
  }
  S.lastEnabled = !!C.enabled;

  // What runs, in the log at every load (10 Oct review S4: the module said nothing, so the log could not show it was on)
  log(`racemenupresets ${C.enabled ? 'on' : 'off'}${C.enabled && TEST ? `, staff test only (${TEST.size} profile(s))` : C.enabled ? ', every player' : ''}, `
    + `requireEditor ${C.requireEditor === false ? 'off' : 'on'}, ${FAMILY.size} race ids in vampire families`);
  return { faceFrom, faceFixed, fixesText, encodeFace, hashText, contentOf, isTriPath, state: S, dir: DIR, pump, sameFamily };
};
module.exports.faceFrom = faceFrom;
module.exports.encodeFace = encodeFace;
module.exports.hashText = hashText;
module.exports.contentOf = contentOf;
module.exports.faceFixed = faceFixed;
module.exports.fixesText = fixesText;
module.exports.isTriPath = isTriPath;
