'use strict';
// RaceMenu extras SkyMP does not sync (client AppearanceExtrasService, fork appearanceExtrasPlan.ts): skee overlays,
// node scales (XPMSE body sliders) and body morphs. A player's client reads them after RaceMenu closes; this keeps them per
// character in appearance-extras.json (written only on a change, off the main thread) and hands them to the owner at
// each spawn and to every client that holds a copy of that player.
//
// Client -> Server: dboAppearanceExtras { f, ov, tr, mo }; dboAppearanceExtrasGet { self?, index?, ids? }
// Server -> Client: dboAppearanceExtras { actor, rev, self?, f, ov, tr, mo }; dboAppearanceExtrasIndex { revs };
//                   dboAppearanceExtrasRev { actor, rev } (rev 0: nothing kept)
// Config "appearanceExtras" (gamemode-config.json) may override DEFAULTS; enabled:false stops saving and serving.
const fs = require('fs');
const path = require('path');

const STORE_FILE = 'appearance-extras.json';
const DEFAULTS = {
  enabled: true,
  // A staff test before everyone (9 Oct): only these profile ids save or are answered; empty: every player
  testProfiles: [],
  // A change is stored only in an editor the server opened, and an /appearance closed with the vanilla look unchanged pays
  // for it then (appearance.js __dboRaceMenuSaveGate); false: every capture is stored (the 7 Oct rule)
  requireEditor: true,
  setMinSeconds: 3,
  // Per client: its own extras answered, the index sent and its revision told to the others at most this often; a request
  // inside the window is answered at the window's end, once, with what is current then
  selfMinSeconds: 5,
  indexMinSeconds: 10,
  announceMinSeconds: 10,
  maxChars: 32000,
  maxIdsPerAsk: 32,
  idsPerMinute: 400,
  writeDelayMs: 5000,
  // A size a sword fight can be won by stays out. Each range bounds the product of every scale along a chain from the root:
  // body (root, spine, neck, legs: the height) within 10%, arms and head within 25%, anything else within 0.5-2
  scale: { body: [0.9, 1.1], limb: [0.8, 1.25], other: [0.5, 2.0] },
  morph: [-1, 2],
};
const MAX_SLOT = 16;
const MAX_OVERRIDES = 160;
const MAX_TRANSFORMS = 128;
const MAX_MORPHS = 96;
const MAX_PATH = 160;

const OVERLAY_NODE = /^(Body|Hands|Feet|Face) \[Ovl([0-9]{1,2})\]$/;
const TRANSFORM_NODE = /^NPC( [A-Za-z0-9 _.\-\[\]]{1,44})?$/i;
const SAFE_KEY = /^[A-Za-z0-9 _.:\-]{1,48}$/;
const MORPH_NAME = /^[A-Za-z0-9 _.\-]{1,48}$/;
const OVERLAY_TEXTURE = /^(textures\\)?actors\\character\\overlays\\[a-z0-9_ \-\\.()&'+]+\.dds$/;
// Bone groups by name, matched case-insensitively (the game's node names compare that way). A child's scale multiplies into
// its parent's, so limits hold for the product along every chain. Without the skeleton's tree here, a chain is bounded by
// every scale of every group it may pass through: the product of all scales above 1, and of all below 1, in those groups.
const BONE_GROUPS = [
  ['root', /^npc$|^npc (root|com|pelvis)\b/],
  ['head', /head|jaw|eye|\bear|brow|\blip|tongue|face|hair|helmet/],
  ['torso', /spine|spn|neck|chest|torso/],
  ['leg', /thigh|thg|calf|clf|knee|foot|toe|leg|ankle/],
  ['arm', /clav|arm|elbow|shoulder|hand|hnd|finger|thumb|wrist|weapon|shield|magic|quiver|bow/],
];
// Every group a name matches (a name in two groups is bounded by both chains), or 'other'
const boneGroups = (node) => { const n = node.toLowerCase(); const gs = BONE_GROUPS.filter(([, re]) => re.test(n)).map(([g]) => g); return gs.length ? gs : ['other']; };
const boneSide = (node) => { const w = node.toLowerCase().split(/\s+/); return w.includes('l') ? 'l' : w.includes('r') ? 'r' : ''; };
// A chain's groups and the range it gets; a sided group counts only that side's bones (and the unsided ones)
const CHAINS = [['body', ['root', 'torso', 'leg']], ['limb', ['root', 'torso', 'arm']], ['limb', ['root', 'torso', 'head']],
  ['other', ['root', 'torso', 'leg', 'arm', 'head', 'other']]];
// skee's override keys (OverrideVariant.h) and the range each may take
const OVERRIDE_KEYS = { 0: 'int', 1: [0, 10], 2: [0, 1000], 3: [0, 100], 7: 'int', 8: [0, 1], 9: 'string' };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (n) => Math.round(n * 10000) / 10000;
const cmp = (a, b) => { const x = JSON.stringify(a), y = JSON.stringify(b); return x < y ? -1 : x > y ? 1 : 0; };

const normalizeTexture = (raw) => {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_PATH) return null;
  const p = raw.replace(/\//g, '\\').replace(/\\{2,}/g, '\\');
  const low = p.toLowerCase();
  if (low.includes('..') || low.includes(':') || !OVERLAY_TEXTURE.test(low) || /\\default\.dds$/.test(low)) return null;
  return p;
};

// Brings a chain's worst case into [lo, hi]: the scales above 1 are shrunk toward 1 (in log space, keeping their ratios)
// until their product is hi, and those below 1 likewise up to lo. Moving a scale toward 1 only helps every other chain,
// so fitting the chains one after another leaves all of them in range.
const fitChain = (entries, lo, hi) => {
  let n = 0;
  for (const [side, limit] of [[1, hi], [-1, lo]]) {
    const part = entries.filter((e) => (side > 0 ? e[2] > 1 : e[2] < 1));
    const sum = part.reduce((t, e) => t + Math.log(e[2]), 0);
    const cap = Math.log(limit);
    if (side > 0 ? sum <= cap + 1e-9 : sum >= cap - 1e-9) continue;
    const k = cap / sum;
    for (const e of part) e[2] = Math.exp(Math.log(e[2]) * k);
    n += part.length;
  }
  return n;
};
// Rounded toward 1, so rounding never takes a fitted chain back out of range. The 1e-6 makes it stable on its own output:
// 1.13 * 10000 is 11299.999999999998 in floating point, and a plain floor took it to 1.1299, then 1.1298, so an unchanged
// /appearance close after a save (the client sends back what it was given, through skee's float32 and a half-up 4-decimal
// rounding) was a change, and charged (10 Oct review 2, item 1). A value that is already on the 4-decimal grid stays put
const roundToward1 = (v) => (v > 1 ? Math.floor(v * 10000 + 1e-6) / 10000 : Math.ceil(v * 10000 - 1e-6) / 10000);

const fitScales = (entries, ranges) => {
  let n = 0;
  const tagged = entries.map((e) => ({ e, g: boneGroups(e[0]), s: boneSide(e[0]) }));
  for (const fp of [0, 1]) {
    for (const side of ['l', 'r']) {
      for (const [range, groups] of CHAINS) {
        const chain = tagged.filter((t) => t.e[3] === fp && t.g.some((g) => groups.includes(g)) && (!t.s || t.s === side)).map((t) => t.e);
        const r = ranges[range] || DEFAULTS.scale[range];
        n += fitChain(chain, r[0], r[1]);
      }
    }
  }
  for (const e of entries) e[2] = roundToward1(e[2]);
  return n;
};

// What may be kept of a client's report. Returns { extras, clamped, dropped }.
const sanitize = (content, opts) => {
  const ranges = (opts && opts.scale) || DEFAULTS.scale;
  const morphRange = (opts && opts.morph) || DEFAULTS.morph;
  let dropped = 0;
  let clamped = 0;
  const f = Number(content && content.f) ? 1 : 0;

  const byNode = new Map();
  const ov = Array.isArray(content && content.ov) ? content.ov : [];
  if (ov.length > MAX_OVERRIDES) dropped += ov.length - MAX_OVERRIDES;
  for (const raw of ov.slice(0, MAX_OVERRIDES)) {
    if (!Array.isArray(raw) || raw.length !== 4) { dropped++; continue; }
    const node = String(raw[0]); const key = Number(raw[1]);
    const m = OVERLAY_NODE.exec(node);
    const rule = OVERRIDE_KEYS[key];
    if (!m || Number(m[2]) >= MAX_SLOT || !rule) { dropped++; continue; }
    let entry = null;
    if (rule === 'string') {
      const index = Number(raw[2]) === 1 ? 1 : 0;
      const tex = normalizeTexture(raw[3]);
      if (tex) entry = [node, key, index, tex];
    } else if (typeof raw[3] === 'number' && Number.isFinite(raw[3])) {
      if (rule === 'int') entry = [node, key, 0, raw[3] >>> 0];
      else { const v = clamp(raw[3], rule[0], rule[1]); if (v !== raw[3]) clamped++; entry = [node, key, 0, round(v)]; }
    }
    if (!entry) { dropped++; continue; }
    const list = byNode.get(node) || [];
    if (list.some((e) => e[1] === entry[1] && e[2] === entry[2])) { dropped++; continue; }
    list.push(entry);
    byNode.set(node, list);
  }
  const outOv = [];
  for (const [, list] of byNode) {
    // A slot without its own texture shows nothing: its other values are noise
    if (!list.some((e) => e[1] === 9 && e[2] === 0)) { dropped += list.length; continue; }
    outOv.push(...list);
  }

  const tr = Array.isArray(content && content.tr) ? content.tr : [];
  if (tr.length > MAX_TRANSFORMS) dropped += tr.length - MAX_TRANSFORMS;
  const outTr = [];
  const seenTr = new Set();
  for (const raw of tr.slice(0, MAX_TRANSFORMS)) {
    if (!Array.isArray(raw) || raw.length !== 4) { dropped++; continue; }
    const node = String(raw[0]); const key = String(raw[1]); const v = Number(raw[2]); const fp = raw[3] ? 1 : 0;
    if (!TRANSFORM_NODE.test(node) || !SAFE_KEY.test(key) || key.toLowerCase() === 'internal' || !Number.isFinite(v) || v <= 0) { dropped++; continue; }
    const id = `${fp}|${node.toLowerCase()}|${key.toLowerCase()}`;
    if (seenTr.has(id)) { dropped++; continue; }
    seenTr.add(id);
    outTr.push([node, key, clamp(v, 0.05, 20), fp]);
  }
  clamped += fitScales(outTr, ranges);

  const mo = Array.isArray(content && content.mo) ? content.mo : [];
  if (mo.length > MAX_MORPHS) dropped += mo.length - MAX_MORPHS;
  const outMo = [];
  const seenMo = new Set();
  for (const raw of mo.slice(0, MAX_MORPHS)) {
    if (!Array.isArray(raw) || raw.length !== 3) { dropped++; continue; }
    const name = String(raw[0]); const key = String(raw[1]); const v = Number(raw[2]);
    if (!MORPH_NAME.test(name) || !SAFE_KEY.test(key) || !Number.isFinite(v) || seenMo.has(`${name}|${key}`)) { dropped++; continue; }
    seenMo.add(`${name}|${key}`);
    const c = clamp(v, morphRange[0], morphRange[1]);
    if (c !== v) clamped++;
    if (Math.abs(c) > 1e-4) outMo.push([name, key, round(c)]);
  }

  return {
    extras: { f, ov: outOv.sort(cmp), tr: outTr.filter((e) => Math.abs(e[2] - 1) > 1e-4).sort(cmp), mo: outMo.sort(cmp) },
    clamped, dropped,
  };
};

const isEmpty = (x) => !x || (!x.ov.length && !x.tr.length && !x.mo.length);
const hex = (a) => (Number(a) >>> 0).toString(16);

module.exports = (ctx) => {
  const { log, cfg, sendPacket, onlineActors, profileOf, display } = ctx;
  const opts = Object.assign({}, DEFAULTS, (cfg && cfg.appearanceExtras) || {});
  const file = path.resolve(STORE_FILE);
  // Kept across hot reloads: the store, a pending write and the rate windows
  const state = globalThis.__dboAppearanceExtras || (globalThis.__dboAppearanceExtras = {});
  // A load that could not read the file is tried again at the next load (a hot reload, or the restart)
  if (!state.store || state.loadFailed) {
    state.store = { v: 1, chars: {} };
    state.loadFailed = false;
    state.noWrite = false;
    // A file that was read but cannot be taken (it does not parse, or is not a store) is set aside as
    // appearance-extras.json.bad-<time>-<pid>-<n> before starting empty, so the next write cannot replace every character's
    // extras with a near-empty store (10 Oct review R6b, F7). The name is never one used before, even for two set-asides in
    // one millisecond (10 Oct review 2, item 4: the second rename replaced the first copy). If it cannot be set aside
    // either, nothing is written over it until a restart, and changes are refused (not charged)
    const setAside = (why) => {
      globalThis.__dboAsideSeq = (Number(globalThis.__dboAsideSeq) || 0) + 1;
      const bad = `${file}.bad-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${globalThis.__dboAsideSeq}`;
      try { fs.renameSync(file, bad); log(`appearance-extras.json unreadable, starting empty: ${why}; kept as ${path.basename(bad)}`); }
      catch (e) { state.noWrite = true; log(`appearance-extras.json unreadable, starting empty: ${why}; it could not be set aside (${e.message}), so nothing is written over it until a restart`); }
    };
    let text = null;
    // A file that is there but could not be read (EMFILE, EIO, EACCES...) is not a bad file: it is left as it is, nothing is
    // written, served or charged until a later load reads it, and every change is refused, not charged (10 Oct review 2,
    // item 3: it was set aside like a broken file, and the server went on with an empty store, writes allowed)
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
      if (e.code !== 'ENOENT') {
        state.noWrite = true;
        state.loadFailed = true;
        log(`appearance-extras.json could not be read (${e.code || e.message}): kept as it is; changes are refused and nothing is served until a reload reads it`);
      }
    }
    if (text !== null) {
      let read = null; let err = 'not a store';
      try { read = JSON.parse(text); } catch (e) { err = e.message; }
      if (read && typeof read.chars === 'object' && read.chars && !Array.isArray(read.chars)) state.store.chars = read.chars;
      else setAside(err);
    }
  }
  if (!(state.lastSet instanceof Map)) state.lastSet = new Map();
  if (!(state.asks instanceof Map)) state.asks = new Map();
  if (typeof state.writing !== 'boolean') state.writing = false;
  if (!(state.sentAt instanceof Map)) state.sentAt = new Map();
  if (!(state.timers instanceof Map)) state.timers = new Map();
  const chars = state.store.chars;
  const TEST = Array.isArray(opts.testProfiles) && opts.testProfiles.length ? new Set(opts.testProfiles.map((x) => Number(x))) : null;
  const inTest = (a) => !TEST || TEST.has(profileOf(a));
  // appearance.js's verdict on storing this change (the RaceMenu save window); no gate loaded: refused
  const gateAllows = (a, first, o) => {
    if (opts.requireEditor === false) return { ok: true };
    const gate = globalThis.__dboRaceMenuSaveGate;
    if (typeof gate !== 'function') return { ok: false, reason: 'appearance.js not loaded' };
    try { return gate(a, 'extras', first, o) || { ok: false, reason: 'no answer' }; } catch (e) { return { ok: false, reason: e.message }; }
  };
  // A change not kept: the player is told why, with nothing charged (appearance.js; 'gold' is told by the gate itself)
  const tellRefused = (a, code) => {
    try { if (typeof globalThis.__dboRaceMenuRefused === 'function') globalThis.__dboRaceMenuRefused(a, 'extras', code); } catch (e) { log(`appearance extras: refusal not told: ${e.message}`); }
  };

  // Async and coalesced: a sync write on this box stalls the server's main loop
  const scheduleWrite = () => {
    state.dirty = true;
    if (state.noWrite) return;
    if (state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      if (state.writing) { scheduleWrite(); return; }
      state.writing = true;
      state.dirty = false;
      const tmp = file + '.tmp';
      fs.promises.writeFile(tmp, JSON.stringify(state.store))
        .then(() => fs.promises.rename(tmp, file))
        // A failed write (ENOSPC, EIO) is tried again after the delay, and the exit flush still writes it: the change was
        // taken (and maybe paid for) and is only in memory until a write lands (10 Oct review 2)
        .catch((e) => { state.dirty = true; log(`appearance-extras.json write failed, tried again in ${Math.round((Number(opts.writeDelayMs) || 5000) / 1000)} s: ${e.message}`); })
        .then(() => { state.writing = false; if (state.dirty) scheduleWrite(); });
    }, Number(opts.writeDelayMs) || 5000);
  };
  // systemd stops the server with SIGTERM: a change still waiting for its write (or one in flight) is written at once,
  // tmp then rename, through gamemode.js __dboFlushOnExit, as the SAVES files are (10 Oct review R6a, F7: a paid extras
  // save restarted away inside the 5 s kept the gold and lost the change). The newest code's flush runs
  const flushNow = () => {
    if (state.noWrite || !(state.dirty || state.timer || state.writing)) return false;
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    const tmp = `${file}.exit.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state.store));
    fs.renameSync(tmp, file);
    // An async write still in flight renames an older copy afterwards: it writes again once it is done
    state.dirty = !!state.writing;
    return true;
  };
  globalThis.__dboAppearanceExtrasFlush = () => { try { return flushNow(); } catch (e) { log(`appearance-extras.json exit write failed: ${e.message}`); return false; } };
  {
    const base = globalThis.__dboFlushOnExit;
    if (typeof base === 'function' && !base.__dboExtrasFlush) {
      const chained = () => { try { base(); } finally { if (typeof globalThis.__dboAppearanceExtrasFlush === 'function') globalThis.__dboAppearanceExtrasFlush(); } };
      chained.__dboExtrasFlush = true;
      // Whatever base already runs stays marked (racemenupresets.js chains its face writes the same way)
      if (base.__dboPresetFlush) chained.__dboPresetFlush = true;
      globalThis.__dboFlushOnExit = chained;
    }
  }

  // A character's entry, if it is still theirs (an actor id handed to someone else's character keeps nothing)
  const entryOf = (a) => {
    const e = chars[hex(a)];
    if (!e) return null;
    const p = profileOf(a);
    return Number.isFinite(p) && p >= 0 && e.p === p ? e : null;
  };
  const packetOf = (a, e, self) => Object.assign({ customPacketType: 'dboAppearanceExtras', actor: a >>> 0, rev: e && !isEmpty(e) ? e.rev : 0 },
    self ? { self: true } : {}, e && !isEmpty(e) ? { f: e.f, ov: e.ov, tr: e.tr, mo: e.mo } : { f: 0, ov: [], tr: [], mo: [] });
  const revOf = (a) => { const e = entryOf(a); return e && !isEmpty(e) ? e.rev : 0; };
  // At most once per window per client and kind; a call inside the window runs once at its end (nothing is lost, so a
  // spawn's request is never left unanswered)
  const throttled = (kind, a, seconds, fn) => {
    const key = `${kind}:${a >>> 0}`;
    const now = Date.now();
    const ms = Number(seconds) * 1000;
    const last = state.sentAt.get(key) || 0;
    if (now - last >= ms) { state.sentAt.set(key, now); fn(); return; }
    if (state.timers.has(key)) return;
    state.timers.set(key, setTimeout(() => {
      state.timers.delete(key);
      state.sentAt.set(key, Date.now());
      try { fn(); } catch (e) { log(`appearance extras ${kind} failed: ${e.message}`); }
    }, Math.max(0, last + ms - now)));
  };
  // The others hear this character's current revision (read when it goes, so a deferred one is never stale)
  const announce = (a) => throttled('announce', a, opts.announceMinSeconds, () => {
    const rev = revOf(a);
    for (const b of onlineActors()) if ((b >>> 0) !== (a >>> 0)) sendPacket(b, { customPacketType: 'dboAppearanceExtrasRev', actor: a >>> 0, rev });
  });
  const answerSelf = (a) => throttled('self', a, opts.selfMinSeconds, () => sendPacket(a, packetOf(a, entryOf(a), true)));

  const prune = (now) => {
    if (state.lastSet.size > 500) for (const [k, t] of state.lastSet) if (now - t > 600000) state.lastSet.delete(k);
    if (state.asks.size > 500) for (const [k, w] of state.asks) if (now - w.since > 120000) state.asks.delete(k);
    if (state.sentAt.size > 1500) for (const [k, t] of state.sentAt) if (now - t > 600000 && !state.timers.has(k)) state.sentAt.delete(k);
  };

  const onSet = (a, content) => {
    const now = Date.now();
    prune(now);
    const last = state.lastSet.get(a >>> 0) || 0;
    if (now - last < Number(opts.setMinSeconds) * 1000) { if (!state.loadFailed) answerSelf(a); return; }
    state.lastSet.set(a >>> 0, now);
    // The file could not be read at load: what is kept is not known, so nothing is taken (or charged) and nothing is sent
    // back (an empty answer would let this client's next capture, made without them, replace them after a reload)
    if (state.loadFailed) { log(`appearance extras from ${display(a)} not saved: the kept extras could not be read`); tellRefused(a, 'unreadable'); return; }
    if (JSON.stringify(content).length > Number(opts.maxChars)) { log(`appearance extras from ${display(a)} refused: too large`); return; }
    const { extras, clamped, dropped } = sanitize(content, opts);
    const p = profileOf(a);
    if (!Number.isFinite(p) || p < 0) return;
    const prev = entryOf(a);
    const before = prev ? JSON.stringify({ f: prev.f, ov: prev.ov, tr: prev.tr, mo: prev.mo }) : JSON.stringify({ f: extras.f, ov: [], tr: [], mo: [] });
    // Nothing kept and nothing sent is no change, whatever the sex flag says
    const changed = before !== JSON.stringify(extras) && !(isEmpty(prev) && isEmpty(extras));
    // Emptying what is kept is a clear: never paid for, so a priced window (an unchanged /appearance) refuses it rather
    // than charging (10 Oct review R4, F4), as faces do
    const clear = changed && !isEmpty(prev) && isEmpty(extras);
    // Only an editor the server opened, and paid for like the look; refused, the stored extras go back to the player
    const verdict = changed ? (state.noWrite ? { ok: false, reason: 'the kept extras could not be read', code: 'unreadable' } : gateAllows(a, !prev, clear ? { clear: true } : undefined)) : null;
    if (verdict && !verdict.ok) { log(`appearance extras from ${display(a)} not saved: ${verdict.reason}`); tellRefused(a, verdict.code || (verdict.reason === 'gold' ? 'gold' : 'gate')); }
    else if (changed) {
      const rev = ((chars[hex(a)] && chars[hex(a)].rev) || 0) + 1;
      chars[hex(a)] = { p, rev, at: new Date(now).toISOString(), f: extras.f, ov: extras.ov, tr: extras.tr, mo: extras.mo };
      scheduleWrite();
      announce(a);
      log(`appearance extras saved for ${display(a)}: ${extras.ov.length} overlay value(s), ${extras.tr.length} scale(s), ${extras.mo.length} morph(s)`
        + `${clamped ? `, ${clamped} clamped` : ''}${dropped ? `, ${dropped} dropped` : ''} (rev ${rev})`);
    }
    answerSelf(a);
  };

  const onGet = (a, content) => {
    // Not answered while the file could not be read (see onSet); the client asks again at its next spawn
    if (state.loadFailed) return;
    if (content.self) {
      answerSelf(a);
      // A spawn: the others learn this character's revision, and this client everyone else's
      if (revOf(a)) announce(a);
    }
    if (content.index) {
      throttled('index', a, opts.indexMinSeconds, () => {
        const revs = [];
        for (const b of onlineActors()) { if ((b >>> 0) === (a >>> 0)) continue; const r = revOf(b); if (r) revs.push([b >>> 0, r]); }
        sendPacket(a, { customPacketType: 'dboAppearanceExtrasIndex', revs });
      });
    }
    if (Array.isArray(content.ids)) {
      const now = Date.now();
      prune(now);
      let w = state.asks.get(a >>> 0);
      if (!w || now - w.since >= 60000) { w = { since: now, n: 0 }; state.asks.set(a >>> 0, w); }
      const ids = [...new Set(content.ids.slice(0, Number(opts.maxIdsPerAsk)).map((x) => Number(x) >>> 0))]
        .filter((x) => x >= 0xff000000 && x !== (a >>> 0));
      for (const id of ids) {
        if (w.n >= Number(opts.idsPerMinute)) break;
        w.n++;
        sendPacket(a, packetOf(id, entryOf(id), false));
      }
    }
  };

  globalThis.__dboAppearanceExtrasPacket = (a, content) => {
    if (!a || !content || opts.enabled === false || !inTest(a)) return;
    if (content.customPacketType === 'dboAppearanceExtras') onSet(a, content);
    else if (content.customPacketType === 'dboAppearanceExtrasGet') onGet(a, content);
  };
  // Go-live, or any switch from off to on, by hot reload (10 Oct review 2-e2e G9, E2): a 0.3.90 client asks for its own
  // extras once per spawn (appearanceExtrasService.ts askedSelf) and captures only once it has an answer, so a player who
  // asked while nothing answered would have no overlays or scales saved all session, silently. Each player online is
  // answered once now, as if they had asked (throttled like any answer). Not while the store could not be read (onGet does
  // not answer then either: an empty answer would let the next capture replace what is kept)
  if (opts.enabled !== false && !state.loadFailed) {
    for (const a of onlineActors()) {
      if (!inTest(a)) continue;
      try { answerSelf(a); } catch (e) { log(`appearance extras: answering ${display(a)} at load failed: ${e.message}`); }
    }
  }
  log(`appearanceextras: ${state.loadFailed ? 'the store could not be read, nothing taken or served until a reload reads it' : `${Object.keys(chars).length} character(s) kept`}${opts.enabled === false ? ' (off)' : ''}`);
};
module.exports.sanitize = sanitize;
module.exports.normalizeTexture = normalizeTexture;
module.exports.DEFAULTS = DEFAULTS;
module.exports.boneGroups = boneGroups;
module.exports.boneSide = boneSide;
module.exports.roundToward1 = roundToward1;
