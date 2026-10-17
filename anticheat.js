// DragonBreak Online: the anti-cheat flags (Jake, 17 Oct 2026: "Infinite Stamina, Speed Running, Infinite Magicka ... dont
// seem to get flagged"). Loaded by gamemode.js after every module that wraps an engine slot and before playerlog.js, with
// its require cache entry deleted first, so a hot reload picks up an edit here. Design: ANTI-CHEAT DESIGN of 17 Oct
// (ac-core, ac-speed-watch, ac-vitals-interim, ac-fork-bridge).
//
// What it does. Flags only: nothing here kicks or bans, and nothing is said to the flagged player.
//   acFlag(actor, kind, nums, text, opts)  one anchored server-log line per flag, folded to one a minute per (player, kind):
//       [gamemode] ANTICHEAT <kind> [shadow ]<Name> #TAG (profile N[, staff]): <numbers>
//     dbo-monitor reads that line (LINE_RX below, anchored after the logger prefix like BUGREPORT, so chat or /bug text cannot
//     forge it). A kind not in shadowKinds also goes to the player's #player-logs post (sec.signal) and, at most once per
//     10 minutes per (player, kind), to the admin tab of online staff of GM and up. Names come from display(), never who().
//   speed watch  one 1 s timer reads every online player's server-accepted position into a ring of 64 samples and judges the
//     net horizontal displacement over 10 s and 60 s against the real time that passed, with continuity (80% of the
//     window's time in 1 s steps at 0.8x the limit or faster), so a teleport, a launch or a freeze backlog is never a run.
//   vitals (interim, until the fork's vitals budget ships)  magicka_free: costly casts made at full stored magicka after
//     which the stored magicka never dropped; stamina_free: 20 s of foot sprinting at 500 u/s while stored stamina stays full.
//   fork bridge  dormant until the fork natives exist: mp.onAnticheat flags come out through acFlag, gamemode-config
//     anticheat.fork is pushed to mp.setAnticheatConfig on every load, movement classes to mp.setMovementClass on change,
//     and /acstate prints mp.getAnticheatState.
// Switches: gamemode-config.json "anticheat" (DEFAULTS below), hot reload by deploy-batch.sh; at once with
// /anticheat off <part> (Lead GM and above), kept in globalThis over reloads until a restart, and audited.
// Performance: one 1 s timer, two gets per online player per tick (pos, cell) and more only for a player who is fast,
// sprinting or has a pending cast; typed-array rings allocated once per session; constant work per engine event.
'use strict';

const VERSION = 1;
// The kinds this file and the fork raise; the player log's sec.signal enum lists the same (playerlog-rules.js)
const KINDS = ['speed_sustained', 'speed_sustained60', 'speed_blink', 'speed_slow', 'snapback_ignored', 'magicka_free', 'stamina_free',
  'magicka_debt', 'stamina_debt', 'vitals_nonfinite', 'power_unmatched', 'spellhit_nocast'];
const KIND_RX = /^[a-z][a-z0-9_]{0,31}$/;
// What /anticheat off|on takes. 'on' only takes back an 'off': it never turns on what the config keeps off
const PARTS = ['all', 'alerts', 'speed', 'rubberband', 'vitals', 'magicka', 'stamina', 'refusehits', 'fork'];
// The anchored line, after the logger prefix (dbo-monitor's LOGGER, '^\[[^\]]+\] \[\w+\] \[\w+\] '): kind, shadow, name #TAG,
// profile, staff, the numbers
const LINE_RX = /\[gamemode\] ANTICHEAT ([a-z][a-z0-9_]{0,31}) (shadow )?(.{1,80}? #[A-Z0-9?]{4}) \(profile (-?\d{1,9})(, staff)?\): (.*)$/;
const LOGGER_RX_SRC = '^\\[[^\\]]+\\] \\[\\w+\\] \\[\\w+\\] ';

// Defaults: gamemode-config.json "anticheat" overrides any of them (DESIGN section 4). Day 0: flags only, rubberBand false,
// refuseHits false; the kinds and tiers in shadowKinds only log until their measurement gate passes.
const DEFAULTS = {
  enabled: true,
  alerts: { staffInGame: true, minTier: 'gm', staffEveryMinutes: 10, logPerMinute: 1 },
  // A kind, or kind:tier (speed_sustained:foot is the foot tier at 650 u/s; the 850 u/s tier of the same kind alerts)
  shadowKinds: ['speed_sustained:foot', 'speed_sustained60', 'speed_blink', 'speed_slow', 'stamina_free', 'magicka_debt', 'stamina_debt',
    'power_unmatched', 'spellhit_nocast'],
  // the module's own guard against server freezes: a timer this late, or this many players with the same kind this close
  // together, holds flags for holdMs and logs one 'stall-held' line instead; the rings restart for reseedMs
  stall: { lateMs: 1500, burstPlayers: 3, burstMs: 2000, holdMs: 10000, reseedMs: 3000 },
  speed: {
    enabled: true,
    // 10 s sustained above this, any class, alerts from day 0 (no honest window of 2 s or more above 590 measured)
    alertSpeed: 850,
    // 10 s per class (foot 1.3x sprint MOVT 500; mount and beast 1.2 x 1.2 x horse sprint 600, rounded up)
    limit10: { foot: 650, mount: 850, beast: 850, unknown: 850 },
    limit60: { foot: 540, other: 750 },
    continuity: 0.8,
    // a window counts once it spans this share of its length
    minSpan: 0.9,
    blinkUnits: 2000, blinkWithinMs: 1500, blinkCount: 3, blinkWindowMs: 600000,
    // a step this long with a step a third its length or less on each side is a teleport: the windows restart after it
    jumpUnits: 3000,
    slowMinMs: 4000,
    // Whirlwind Sprint cast, or a Voice spell taken: no judging for this long
    dashExemptMs: 10000,
    mountNear: 300, mountFar: 600, mountFarSamples: 3,
    rubberBand: false, rubberBandSpeed: 1000, rubberBandMaxPerMin: 3,
  },
  magicka: {
    enabled: true, minCost: 30, fullAt: 0.995, dropBelow: 0.99,
    holdMs: 6000, concentrationHoldMs: 15000,
    // The client holds its bars while it casts and for 500 ms after (sendInputsService), so a held charge or a chain of
    // casts leaves the stored value unchanged to the bit: while it is, the entry waits up to heldMaxMs before it counts
    heldMaxMs: 30000,
    refillSkipMs: 6000,
    flagCount: 8, flagWindowMs: 600000, flagMinCost: 1200,
    refuseHits: false, refuseMinutes: 10,
  },
  stamina: { enabled: true, sprintSpeed: 500, sprintSeconds: 20, windowSeconds: 30, fullAt: 0.95, dropBy: 0.02 },
  // pushed as-is (only the keys present) to mp.setAnticheatConfig on every load; /anticheat off fork|all pushes enabled false
  fork: {},
  bridge: { pushClasses: false },
};
const merge = (base, over) => {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const [k, v] of Object.entries(over || {})) {
    if (k.startsWith('_')) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  }
  return out;
};
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const RING = 64;
const TICK_MS = 1000;
const FORTIFY_NAME_RX = /Fortify\w*?(Alteration|Conjuration|Destruction|Illusion|Restoration)/i;
const SCHOOL_BY_NAME = { alteration: 18, conjuration: 19, destruction: 20, illusion: 21, restoration: 22 };

module.exports = (api) => {
  const { mp } = api;
  const log = typeof api.log === 'function' ? api.log : () => {};
  const C = merge(DEFAULTS, ((api.cfg || {}).anticheat) || {});
  const SP = C.speed, MG = C.magicka, STA = C.stamina, AL = C.alerts, STALL = C.stall;
  const now = () => (api.clock ? api.clock.now() : Date.now());
  const every = typeof api.every === 'function' ? api.every : () => {};
  const onlineActors = () => { try { return api.onlineActors() || []; } catch (e) { return []; } };
  const profileOf = (a) => { try { return Number(api.profileOf(a)); } catch (e) { return -1; } };
  const tagOf = (a) => { try { return String(api.tagOf(a) || '????'); } catch (e) { return '????'; } };
  // A name as the line carries it: display() with nothing that could read as a mention or a second line
  // Anything written: no line break, no mention, no address and no long number (an id) can come through a name or a text
  const scrub = (v, max) => String(v).replace(/[\u0000-\u001f\u007f<>@]+/g, ' ').replace(/(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/g, '[ip]')
    .replace(/\d{15,}/g, '[id]').replace(/ {2,}/g, ' ').trim().slice(0, max);
  const display = (a) => { let s = ''; try { s = String(api.display(a)); } catch (e) { s = `Stranger #${tagOf(a)}`; } return scrub(s, 80); };
  // through a local name, so tests/playerlog-audit-harness.js pins every audit line of this file
  const audit = (line) => { try { if (typeof api.audit === 'function') api.audit(line); } catch (e) { /* the audit queue is optional */ } };
  const isStaff = (a) => {
    try { if (typeof api.staffTierOf === 'function' && api.staffTierOf(a)) return true; } catch (e) { /* not staff */ }
    try { return typeof api.staffCharOf === 'function' && api.staffCharOf(a) === true; } catch (e) { return false; }
  };
  const TIER_RANK = api.TIER_RANK || { senior: 4, developer: 3, leadgm: 2, gm: 1, trialgm: 0.5 };
  const rankOf = (a) => { try { return TIER_RANK[api.tierOf(a)] || 0; } catch (e) { return 0; } };
  const recordOf = (id) => { try { if (typeof api.recordOf === 'function') return api.recordOf(id >>> 0); const r = mp.lookupEspmRecordById(id >>> 0); return r && r.record ? r : null; } catch (e) { return null; } };
  const personal = (a, text) => { try { api.personal(a, text); } catch (e) { /* offline */ } };
  const errAt = new Map();
  const err = (site, e) => { const t = now(); if (t - (errAt.get(site) || 0) < 60000) return; errAt.set(site, t); log(`anticheat: ${site} failed: ${e && e.message ? e.message : e}`); };

  // ---- state, kept over reloads -----------------------------------------------------------------------------------------
  const prior = globalThis.__dboAnticheat;
  const ST = prior && typeof prior === 'object' && prior.v === VERSION ? prior : (globalThis.__dboAnticheat = {
    v: VERSION, players: new Map(), lim: new Map(), recent: [], counts: { day: '', kinds: new Map() }, burst: new Map(),
    holdAllUntil: 0, holdAllWhy: '', holdKind: new Map(), held: new Map(), lastTick: 0, tickNo: 0, reseedUntil: 0,
    spells: new Map(), gear: new Map(), mgef: new Map(), horses: new Map(), cells: new Map(), modes: new Map(), refuse: new Map(),
  });
  const OV = globalThis.__dboAnticheatOverride && typeof globalThis.__dboAnticheatOverride === 'object' ? globalThis.__dboAnticheatOverride
    : (globalThis.__dboAnticheatOverride = { off: {} });
  if (!OV.off || typeof OV.off !== 'object') OV.off = {};
  const SHADOW = new Set(Array.isArray(C.shadowKinds) ? C.shadowKinds.map(String) : []);
  const offBy = (p) => !!OV.off[p];
  const isOn = (part) => {
    if (C.enabled !== true || offBy('all')) return false;
    switch (part) {
      case 'all': return true;
      case 'alerts': return !offBy('alerts');
      case 'speed': return SP.enabled !== false && !offBy('speed');
      case 'rubberband': return SP.enabled !== false && SP.rubberBand === true && !offBy('speed') && !offBy('rubberband');
      case 'vitals': return (MG.enabled !== false || STA.enabled !== false) && !offBy('vitals');
      case 'magicka': return MG.enabled !== false && !offBy('vitals') && !offBy('magicka');
      case 'stamina': return STA.enabled !== false && !offBy('vitals') && !offBy('stamina');
      case 'refusehits': return MG.enabled !== false && MG.refuseHits === true && !offBy('vitals') && !offBy('magicka') && !offBy('refusehits');
      case 'fork': return !offBy('fork');
      default: return false;
    }
  };

  // ---- per player, allocated once per session ---------------------------------------------------------------------------
  const newPlayer = (a, t) => ({
    a, born: t, seen: 0,
    // per sample: t, x, y, z; the step into it (u/s and ms, 0 for the first after a restart); the stored stamina when read
    ring: new Float64Array(RING * 4), spd: new Float32Array(RING), sdt: new Float32Array(RING), sta: new Float32Array(RING), head: -1, n: 0,
    cell: '', lastStep: 0, pendingJump: 0,
    exemptUntil: 0, slowFrom: 0, slowUntil: 0, slowFactor: 1,
    cls: 'foot', clsAt: 0, horse: 0, horseFar: 0, mounted: false,
    blinks: new Float64Array(16), blinkHead: 0,
    rbTimes: new Float64Array(8), rbHead: 0, rbCount: 0,
    casts: [], pinned: [], lastRefill: 0, gearSkipped: 0,
    pushedCls: '', pushedSlow: 1,
    v1: 0, v10: 0, v60: 0, c10: 0, t60: 0, c60a: 0, c60b: 0, wT: 0, wD: 0, wFastA: 0, wFastB: 0, wStart: 0,
  });
  const playerOf = (a) => ST.players.get(a >>> 0) || null;
  const reset = (st) => { st.n = 0; st.head = -1; st.lastStep = 0; st.pendingJump = 0; };
  const keepLast = (st) => { if (st.n > 1) st.n = 1; if (st.head >= 0) { st.spd[st.head] = 0; st.sdt[st.head] = 0; } };
  const push = (st, t, x, y, z, sta, spd, dt) => {
    st.head = (st.head + 1) % RING; const i = st.head * 4;
    st.ring[i] = t; st.ring[i + 1] = x; st.ring[i + 2] = y; st.ring[i + 3] = z; st.sta[st.head] = sta;
    st.spd[st.head] = st.n > 0 ? spd : 0; st.sdt[st.head] = st.n > 0 ? dt : 0;
    if (st.n < RING) st.n++;
  };
  // the k-th newest sample's slot (k = 0 is the newest)
  const slot = (st, k) => ((st.head - k) % RING + RING) % RING;

  // Over the newest samples spanning W ms: st.wT (ms spanned, 0 when the ring is too short), st.wD (net horizontal units),
  // st.wFastA / st.wFastB (ms spent in steps at thrA / thrB u/s or faster). Allocation-free.
  const windowStats = (st, W, thrA, thrB) => {
    st.wT = 0; st.wD = 0; st.wFastA = 0; st.wFastB = 0; st.wStart = 0;
    if (st.n < 2) return;
    const R = st.ring, i0 = st.head * 4, t0 = R[i0];
    let fastA = 0, fastB = 0, age = 0, si = i0;
    for (let k = 0; k < st.n - 1; k++) {
      const j = slot(st, k);
      const dt = st.sdt[j], v = st.spd[j];
      if (v >= thrA) fastA += dt;
      if (v >= thrB) fastB += dt;
      si = slot(st, k + 1) * 4;
      age = t0 - R[si];
      if (age >= W) break;
    }
    if (age < W * num(SP.minSpan, 0.9)) return;
    const dx = R[i0 + 1] - R[si + 1], dy = R[i0 + 2] - R[si + 2];
    st.wT = age; st.wD = Math.sqrt(dx * dx + dy * dy); st.wFastA = fastA; st.wFastB = fastB; st.wStart = si;
  };

  // ---- cell names (record editor id) and the admin movement modes -------------------------------------------------------
  const cellName = (desc) => {
    const d = String(desc || '');
    if (ST.cells.has(d)) return ST.cells.get(d);
    let n = '';
    try { const id = mp.getIdFromDesc(d) >>> 0; const r = id ? recordOf(id) : null; n = String((r && r.record && r.record.editorId) || ''); } catch (e) { n = ''; }
    n = n.replace(/[^A-Za-z0-9 _'.-]/g, '').slice(0, 48) || 'unnamed';
    if (ST.cells.size > 2000) ST.cells.clear();
    ST.cells.set(d, n);
    return n;
  };
  // Server-granted movement modes only: AdminSystem's NoClip (tcl, GM and up), which reaches the gamemode through its admin
  // log line ("profile N (tier) turned mode noclip on"). Ghost (no collision, the look) and Freecam (the camera) move no one
  // faster, so a Trial GM, who has Ghost and Invisible only, is always judged. Staff without the mode are judged like anyone
  // and marked staff.
  const MOVE_MODES = new Set(['noclip']);
  const exemptMode = (a) => { const m = ST.modes.size ? ST.modes.get(profileOf(a)) : null; return !!(m && m.size); };
  const restrained = (a) => {
    try { if (typeof globalThis.__dboIsDowned === 'function' && globalThis.__dboIsDowned(a)) return true; } catch (e) { /* not downed */ }
    try { const r = mp.get(a, 'private.restrained'); if (r && (r.boundHands || r.carried || r.captorActorId)) return true; } catch (e) { /* free */ }
    return false;
  };

  // ---- the movement class -----------------------------------------------------------------------------------------------
  // beast: beastform.js private.beast; mount: a horse the player activated, within mountNear at the sample (LIKELY until a
  // staff horse test confirms it); unknown: a horse whose place cannot be read; otherwise foot
  const isHorseBase = (baseId) => {
    const id = baseId >>> 0;
    if (!id) return false;
    if (ST.horses.has(id)) return ST.horses.get(id);
    let yes = false;
    try {
      const r = recordOf(id);
      const f = r && String(r.record.type) === 'NPC_' ? (r.record.fields || []).find((x) => x && x.type === 'RNAM' && x.data instanceof Uint8Array && x.data.byteLength >= 4) : null;
      if (f) {
        const local = new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(0, true);
        let g = local; try { if (typeof r.toGlobalRecordId === 'function') g = r.toGlobalRecordId(local) >>> 0; } catch (e) { g = local; }
        const race = recordOf(g);
        yes = !!race && /horse/i.test(String(race.record.editorId || ''));
      }
    } catch (e) { yes = false; }
    if (ST.horses.size > 4000) ST.horses.clear();
    ST.horses.set(id, yes);
    return yes;
  };
  const updateMount = (st, x, y) => {
    if (!st.horse) { st.mounted = false; return; }
    let hp = null; try { hp = mp.get(st.horse, 'pos'); } catch (e) { hp = null; }
    if (!Array.isArray(hp) || !Number.isFinite(Number(hp[0]))) { st.horseFar++; if (st.horseFar >= SP.mountFarSamples) { st.horse = 0; st.mounted = false; } return; }
    const d = Math.hypot(Number(hp[0]) - x, Number(hp[1]) - y);
    if (d <= SP.mountNear) { st.mounted = true; st.horseFar = 0; } else if (d > SP.mountFar) { st.horseFar++; if (st.horseFar >= SP.mountFarSamples) { st.horse = 0; st.mounted = false; } }
  };
  const classOf = (st, a, t) => {
    let cls = 'foot';
    try { const b = mp.get(a, 'private.beast'); if (b && b.form) cls = 'beast'; } catch (e) { cls = 'unknown'; }
    if (cls === 'foot' && st.mounted) cls = 'mount';
    else if (cls === 'foot' && st.horse && st.horseFar > 0) cls = 'unknown';
    st.cls = cls; st.clsAt = t;
    return cls;
  };
  const slowFactorOf = (st, t) => (st.slowUntil > t ? st.slowFactor : 1);

  // ---- holds: the module's own stall guard -------------------------------------------------------------------------------
  // hk: the kind and whether the line is a shadow one, so a burst of shadow lines (a group ride the mount check missed)
  // never holds back the alerting tier of the same kind
  const holding = (hk, t) => ST.holdAllUntil > t || (ST.holdKind.get(hk) || 0) > t;
  const noteHeld = (hk, a, why) => {
    let h = ST.held.get(hk);
    if (!h) ST.held.set(hk, h = { players: new Set(), n: 0, why });
    h.players.add(a); h.n++;
  };
  const flushHeld = (t) => {
    for (const [hk, h] of ST.held) {
      if (holding(hk, t)) continue;
      const [kind, sh] = hk.split('|');
      log(`ANTICHEAT stall-held ${kind}${sh === '1' ? ' (shadow)' : ''} ${h.players.size} players (${h.n} flags held back: ${h.why})`);
      ST.held.delete(hk);
    }
  };
  const burstHit = (kind, a, t) => {
    let list = ST.burst.get(kind);
    if (!list) ST.burst.set(kind, list = []);
    while (list.length && t - list[0].t > STALL.burstMs) list.shift();
    list.push({ t, a });
    if (list.length > 32) list.shift();
    const distinct = new Set(list.map((x) => x.a)).size;
    return distinct >= STALL.burstPlayers;
  };

  // ---- the flag ---------------------------------------------------------------------------------------------------------
  const pad = (n) => String(n).padStart(2, '0');
  let dayFrom = 0, dayTo = 0, dayName = '';
  const dayOf = (t) => {
    if (t >= dayFrom && t < dayTo) return dayName;
    const d = new Date(t);
    dayName = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    dayFrom = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); dayTo = dayFrom + 86400000;
    return dayName;
  };
  const countToday = (kind, a, t, shadow) => {
    const day = dayOf(t);
    if (ST.counts.day !== day) rollDay(day);
    const k = shadow ? `${kind} (shadow)` : kind;
    let c = ST.counts.kinds.get(k);
    if (!c) ST.counts.kinds.set(k, c = { n: 0, players: new Set() });
    c.n++; c.players.add(a);
  };
  // One audit line a day: the counts only (ANTICHEAT-DAILY is excluded from the player log)
  const rollDay = (day) => {
    const was = ST.counts.day;
    if (was) {
      const rows = [...ST.counts.kinds.entries()].map(([k, c]) => `${k} ${c.n} flags ${c.players.size} players`);
      audit(`ANTICHEAT-DAILY ${was}: ${rows.length ? rows.join(', ') : 'no flags'}`);
    }
    ST.counts = { day, kinds: new Map() };
  };
  const SIG_NUMS = ['speed', 'limit', 'ratio', 'window', 'casts', 'cost', 'debt', 'cls'];
  const emitFlag = (L, t) => {
    const a = L.a, folded = L.folded;
    L.folded = 0; L.lastLog = t;
    const prof = profileOf(a), staff = isStaff(a), name = display(a);
    const body = scrub(L.text || '', 600);
    L.text = body;
    const who = `${name} (profile ${prof}${staff ? ', staff' : ''})`;
    log(`ANTICHEAT ${L.kind} ${L.shadow ? 'shadow ' : ''}${who}: ${body}${folded ? ` (${folded} more folded)` : ''}`);
    ST.recent.push({ t, a, kind: L.kind, shadow: L.shadow, tag: tagOf(a), name, text: body.slice(0, 160), folded });
    if (ST.recent.length > 100) ST.recent.shift();
    if (L.shadow || !isOn('alerts')) return;
    const sig = { n: folded + 1, nums: {} };
    for (const k of SIG_NUMS) if (L.nums && L.nums[k] !== undefined) sig.nums[k] = L.nums[k];
    try { const h = globalThis.__dboPlogHook; if (typeof h === 'function') h('anticheat', a, L.kind, sig); } catch (e) { /* the player log is optional */ }
    if (AL.staffInGame === false || typeof api.staffSay !== 'function') return;
    if (L.lastStaff && t - L.lastStaff < num(AL.staffEveryMinutes, 10) * 60000) return;
    L.lastStaff = t;
    const minRank = TIER_RANK[String(AL.minTier || 'gm')] || 1;
    const tag = tagOf(a);
    const line = `Anticheat ${L.kind}: ${who}: ${body.slice(0, 300)}. /tp #${tag}, /acstate #${tag}, /charstats #${tag}, the player log`;
    for (const o of onlineActors()) {
      if ((o >>> 0) === a || rankOf(o) < minRank) continue;
      try { api.staffSay(o, line); } catch (e) { /* offline */ }
    }
  };
  const acFlag = (actor, kind, nums, text, opts) => {
    const a = Number(actor) >>> 0;
    if (!a || !isOn('all')) return false;
    let k = String(kind || '');
    if (!KIND_RX.test(k)) k = 'other';
    const o = opts || {};
    const t = now();
    const shadow = o.shadow === true || SHADOW.has(k) || (!!o.tier && SHADOW.has(`${k}:${o.tier}`));
    const hk = `${k}|${shadow ? 1 : 0}`;
    if (holding(hk, t)) { noteHeld(hk, a, ST.holdAllUntil > t ? ST.holdAllWhy : 'many players at once'); return false; }
    const key = `${a}|${k}|${shadow ? 1 : 0}`;
    let L = ST.lim.get(key);
    // inside the minute: folded, the latest numbers kept as they are (cleaned when they are written)
    if (L && L.lastLog && t - L.lastLog < 60000 / Math.max(0.01, num(AL.logPerMinute, 1))) {
      L.n++; L.folded++; L.text = text; L.nums = nums || null; L.at = t;
      countToday(k, a, t, shadow);
      return true;
    }
    // A burst counts new incidents only (no line for this player and kind in 10 min): a server-wide artefact raises many at
    // once, while a flag that goes on (folded each minute) is one incident and never holds anyone else's back
    if ((!L || !L.lastLog || t - L.lastLog > 600000) && burstHit(hk, a, t)) {
      ST.holdKind.set(hk, t + STALL.holdMs);
      noteHeld(hk, a, `${STALL.burstPlayers} or more players within ${STALL.burstMs / 1000} s`);
      return false;
    }
    if (!L) ST.lim.set(key, L = { a, kind: k, shadow, first: t, lastLog: 0, lastStaff: 0, folded: 0, n: 0, text: '', nums: null, at: 0 });
    L.n++; L.text = text; L.nums = nums || null; L.at = t;
    countToday(k, a, t, shadow);
    emitFlag(L, t);
    return true;
  };
  // the folded flags of the last minute, as one line with the latest numbers
  const flushFolds = (t) => {
    const gap = 60000 / Math.max(0.01, num(AL.logPerMinute, 1));
    for (const [key, L] of ST.lim) {
      if (L.folded > 0 && t - L.lastLog >= gap) emitFlag(L, t);
      else if (!L.folded && t - L.at > 3600000) ST.lim.delete(key);
    }
  };

  // ---- spells: SPIT and the costliest effect's school, read once per spell id ---------------------------------------------
  const u32 = (f, off) => (f && f.data && f.data.byteLength >= off + 4 ? new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(off, true) : 0);
  const f32 = (f, off) => (f && f.data && f.data.byteLength >= off + 4 ? new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getFloat32(off, true) : 0);
  const fieldsOf = (r, type) => ((r && r.record && r.record.fields) || []).filter((f) => f && f.type === type && f.data instanceof Uint8Array);
  const globalOf = (r, local) => { try { return typeof r.toGlobalRecordId === 'function' ? r.toGlobalRecordId(local) >>> 0 : local >>> 0; } catch (e) { return 0; } };
  const spellInfo = (spellId) => {
    const id = spellId >>> 0;
    let s = ST.spells.get(id);
    if (s) return s;
    s = { rtype: '', type: -1, cost: 0, conc: false, school: -1, ws: false, voice: false, edid: '' };
    try {
      const r = recordOf(id);
      if (r) {
        s.rtype = String(r.record.type || '');
        s.edid = String(r.record.editorId || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 48);
        if (s.rtype === 'SPEL') {
          const spit = fieldsOf(r, 'SPIT')[0];
          s.cost = u32(spit, 0); s.type = u32(spit, 8); s.conc = u32(spit, 16) === 2;
          s.voice = s.type === 11;
          s.ws = /WhirlwindSprint/i.test(s.edid);
          // the costliest effect's school (MGEF DATA: base cost f32 at 4, magic skill at 0x0C); EFIT magnitude, duration
          const efids = fieldsOf(r, 'EFID'), efits = fieldsOf(r, 'EFIT');
          let best = -1;
          efids.forEach((f, i) => {
            const m = recordOf(globalOf(r, u32(f, 0)));
            const data = fieldsOf(m, 'DATA')[0];
            if (!data || data.data.byteLength < 0x10) return;
            const base = Math.max(0, f32(data, 4)), mag = Math.max(1, f32(efits[i], 0)), dur = Math.max(1, u32(efits[i], 8) / 10);
            const c = base * Math.pow(mag, 1.1) * dur;
            if (c > best) { best = c; s.school = u32(data, 0x0c) | 0; }
          });
        }
      }
    } catch (e) { err('spell record', e); }
    if (ST.spells.size > 5000) ST.spells.clear();
    ST.spells.set(id, s);
    return s;
  };
  // A Fortify <school> magic effect (Value Modifier or Peak Value Modifier on <School>Mod, AV 108-112, or the editor id says
  // so): a bit per school, 18 -> 1 ... 22 -> 16. Cached per effect id.
  const mgefFortify = (mgefId) => {
    const id = mgefId >>> 0;
    if (ST.mgef.has(id)) return ST.mgef.get(id);
    let bits = 0;
    try {
      const m = recordOf(id);
      if (m && String(m.record.type) === 'MGEF') {
        const data = fieldsOf(m, 'DATA')[0];
        const arch = u32(data, 0x40), av = u32(data, 0x44);
        if ((arch === 0 || arch === 34) && av >= 108 && av <= 112) bits |= 1 << (av - 108);
        const nm = String(m.record.editorId || '').match(FORTIFY_NAME_RX);
        if (nm) bits |= 1 << (SCHOOL_BY_NAME[nm[1].toLowerCase()] - 18);
      }
    } catch (e) { bits = 0; }
    if (ST.mgef.size > 5000) ST.mgef.clear();
    ST.mgef.set(id, bits);
    return bits;
  };
  const enchFortify = (enchId) => {
    const id = enchId >>> 0;
    if (!id) return 0;
    const key = `e${id}`;
    if (ST.gear.has(key)) return ST.gear.get(key);
    let bits = 0;
    try { const r = recordOf(id); if (r && String(r.record.type) === 'ENCH') for (const f of fieldsOf(r, 'EFID')) bits |= mgefFortify(globalOf(r, u32(f, 0))); } catch (e) { bits = 0; }
    ST.gear.set(key, bits);
    return bits;
  };
  const baseFortify = (baseId) => {
    const id = baseId >>> 0;
    const key = `b${id}`;
    if (ST.gear.has(key)) return ST.gear.get(key);
    let bits = 0;
    try { const r = recordOf(id); const t = r ? String(r.record.type) : ''; if (t === 'ARMO' || t === 'WEAP') { const e = fieldsOf(r, 'EITM')[0]; if (e) bits = enchFortify(globalOf(r, u32(e, 0))); } } catch (e) { bits = 0; }
    if (ST.gear.size > 8000) ST.gear.clear();
    ST.gear.set(key, bits);
    return bits;
  };
  // the schools the caster's worn gear fortifies: its own enchantment (EITM), a player-made one (enchantmentId), or the
  // effect list an item carries (enchantmentEffects)
  const wornFortify = (a) => {
    let entries = [];
    try { const eq = mp.get(a, 'equipment'); entries = eq && eq.inv && Array.isArray(eq.inv.entries) ? eq.inv.entries : []; } catch (e) { return 0; }
    let bits = 0;
    for (const e of entries) {
      if (!e || !(e.worn || e.wornLeft)) continue;
      bits |= baseFortify(Number(e.baseId) >>> 0);
      if (e.enchantmentId) bits |= enchFortify(Number(e.enchantmentId) >>> 0);
      if (Array.isArray(e.enchantmentEffects)) for (const x of e.enchantmentEffects.slice(0, 8)) if (x && x.effectId) bits |= mgefFortify(Number(x.effectId) >>> 0);
    }
    return bits;
  };
  const potionFortifies = (a, school) => { try { const f = globalThis.__dboPotionBonus; return typeof f === 'function' && Number(f(a >>> 0, `school:${school}`)) > 0; } catch (e) { return false; } };

  // ---- vitals: magicka_free and stamina_free -------------------------------------------------------------------------------
  const pctOf = (a) => { try { const p = mp.get(a, 'percentages'); return p && typeof p === 'object' ? p : null; } catch (e) { return null; } };
  const refill = (st, t) => { st.lastRefill = t; st.casts.length = 0; };
  const onCast = (a, spellId, t) => {
    const st = playerOf(a);
    if (!st) return;
    const s = spellInfo(spellId);
    if (s.ws) st.exemptUntil = Math.max(st.exemptUntil, t + SP.dashExemptMs);
    if (!isOn('magicka') || s.rtype !== 'SPEL' || s.type !== 0 || s.cost < MG.minCost) return;
    if (t - st.lastRefill < MG.refillSkipMs) return;
    try { const w = globalThis.__dboWellRegen; if (w instanceof Map && (Number(w.get(a)) || 0) + MG.refillSkipMs > t) return; } catch (e) { /* no wells */ }
    const p = pctOf(a);
    const m = p ? Number(p.magicka) : NaN;
    if (!(m >= MG.fullAt)) return;
    if (s.school >= 18 && s.school <= 22 && ((wornFortify(a) & (1 << (s.school - 18))) || potionFortifies(a, s.school))) { st.gearSkipped++; return; }
    st.casts.push({ t, spell: s.edid || (spellId >>> 0).toString(16), cost: s.cost, conc: s.conc, m0: m, min: m, max: m, changed: false });
    if (st.casts.length > 16) st.casts.shift();
  };
  const pinnedFlag = (st, a, t) => {
    while (st.pinned.length && t - st.pinned[0].t > MG.flagWindowMs) st.pinned.shift();
    let cost = 0, lo = 1, hi = 0;
    const names = [];
    for (const e of st.pinned) { cost += e.cost; lo = Math.min(lo, e.min); hi = Math.max(hi, e.max); if (names.length < 4 && !names.includes(e.spell)) names.push(e.spell); }
    if (st.pinned.length < MG.flagCount || cost < MG.flagMinCost) return;
    const action = isOn('refusehits') ? `refusing their spell hits for ${MG.refuseMinutes} min` : 'flag only';
    const text = `${st.pinned.length} costly casts in ${Math.round(MG.flagWindowMs / 60000)} min at full magicka with no drop after (${names.join(', ')}; ${cost} spell cost in all), `
      + `stored magicka ${lo.toFixed(3)}-${hi.toFixed(3)} through each, no Fortify gear of the school worn, ${st.gearSkipped || 0} casts skipped for gear; server: ${action}`;
    const sent = acFlag(a, 'magicka_free', { casts: st.pinned.length, cost }, text, { action });
    if (sent && isOn('refusehits') && !SHADOW.has('magicka_free')) ST.refuse.set(a, t + MG.refuseMinutes * 60000);
  };
  // canPin false while a stall hold runs: the stored value is still watched (a drop clears a cast), nothing is pinned
  const castTick = (st, a, t, canPin) => {
    const p = pctOf(a);
    const m = p ? Number(p.magicka) : NaN;
    if (!Number.isFinite(m)) return;
    for (let i = 0; i < st.casts.length; i++) {
      const e = st.casts[i];
      if (m < e.min) e.min = m;
      if (m > e.max) e.max = m;
      if (m !== e.m0) e.changed = true;
      let done = false;
      if (e.min < MG.dropBelow) done = true;
      else {
        const age = t - e.t, hold = e.conc ? MG.concentrationHoldMs : MG.holdMs;
        if (canPin && age >= hold && (e.changed || age >= MG.heldMaxMs)) { st.pinned.push(e); if (st.pinned.length > 32) st.pinned.shift(); done = true; pinnedFlag(st, a, t); }
      }
      if (done) { st.casts.splice(i, 1); i--; }
    }
  };
  // stamina_free: foot-class seconds at sprintSpeed or faster in the window while every stored stamina read stays full
  const staminaCheck = (st, a, t) => {
    const W = STA.windowSeconds * 1000;
    const R = st.ring, t0 = R[st.head * 4];
    let fast = 0, maxSta = -1, drop = 0, lo = 1, k = 0;
    for (; k < st.n - 1; k++) {
      const j = slot(st, k);
      if (t0 - R[slot(st, k + 1) * 4] > W) break;
      if (Number.isFinite(st.sta[j]) && st.spd[j] >= STA.sprintSpeed) fast += Math.min(st.sdt[j], 2000);
    }
    k++;
    if (fast < STA.sprintSeconds * 1000) return;
    // oldest to newest over the same samples: the stored stamina never under fullAt and never dropBy below its running high
    for (let j = k - 1; j >= 0; j--) {
      const s = st.sta[slot(st, j)];
      if (!Number.isFinite(s)) continue;
      if (s < STA.fullAt) return;
      if (s > maxSta) maxSta = s;
      drop = Math.max(drop, maxSta - s);
      lo = Math.min(lo, s);
    }
    if (maxSta < 0 || drop >= STA.dropBy) return;
    acFlag(a, 'stamina_free', { window: STA.windowSeconds, speed: Math.round((st.v10 || 0)) }, `${Math.round(fast / 1000)} s of foot sprint at ${STA.sprintSpeed} u/s or faster in ${STA.windowSeconds} s, `
      + `stored stamina ${lo.toFixed(3)}-${maxSta.toFixed(3)} (no drop of ${STA.dropBy} or more); server: flag only`, {});
  };

  // ---- the speed watch -----------------------------------------------------------------------------------------------------
  const noteBlink = (st, t) => {
    st.blinks[st.blinkHead] = t; st.blinkHead = (st.blinkHead + 1) % st.blinks.length;
    let n = 0; for (let i = 0; i < st.blinks.length; i++) if (st.blinks[i] > 0 && t - st.blinks[i] <= SP.blinkWindowMs) n++;
    return n;
  };
  const rubberBand = (st, a, t) => {
    if (!isOn('rubberband')) return '';
    let n = 0; for (let i = 0; i < st.rbTimes.length; i++) if (st.rbTimes[i] > 0 && t - st.rbTimes[i] < 60000) n++;
    if (n >= SP.rubberBandMaxPerMin) return `rubber-band skipped (${n} in the last minute)`;
    // the last sample before the run: walk back while the steps are at 0.8x the rubber-band speed or faster; the run must
    // hold that pace for continuity x 10 s, and it never reaches past the ring, which restarts at every cell change
    const R = st.ring, thr = SP.continuity * SP.rubberBandSpeed;
    let target = -1, fast = 0;
    for (let k = 0; k < st.n - 1; k++) {
      const j = slot(st, k);
      if (st.spd[j] < thr) { target = j * 4; break; }
      fast += st.sdt[j];
    }
    if (target < 0) target = slot(st, st.n - 1) * 4;
    if (fast < SP.continuity * 10000) return '';
    if (target === slot(st, 0) * 4) return '';
    let rot = [0, 0, 0]; try { const g = mp.get(a, 'angle'); if (Array.isArray(g)) rot = g; } catch (e) { /* level */ }
    const pos = [R[target + 1], R[target + 2], R[target + 3]];
    try { const h = globalThis.__dboPlogHook; if (typeof h === 'function') h('travel', a, 'anticheat', 0); } catch (e) { /* the player log is optional */ }
    try { mp.set(a, 'locationalData', { cellOrWorldDesc: st.cell, pos, rot }); } catch (e) { err('rubber band', e); return 'rubber-band failed'; }
    st.rbTimes[st.rbHead] = t; st.rbHead = (st.rbHead + 1) % st.rbTimes.length; st.rbCount++;
    const back = Math.round(Math.sqrt((R[st.head * 4 + 1] - pos[0]) ** 2 + (R[st.head * 4 + 2] - pos[1]) ** 2));
    reset(st);
    return `rubber-band ${st.rbCount} (${back} u back, same cell)`;
  };
  const speedFlag = (st, a, t, kind, tier, v, limit, W, cont) => {
    if (exemptMode(a) || restrained(a)) { reset(st); return; }
    const cls = st.cls, f = slowFactorOf(st, t);
    let action = 'flag only';
    if (kind === 'speed_sustained' && W === 10000 && v >= SP.rubberBandSpeed) { const rb = rubberBand(st, a, t); if (rb) action = rb; }
    const ratio = Math.round((v / limit) * 100) / 100;
    const text = `${cls} ${Math.round(v)} u/s over ${W / 1000} s, limit ${Math.round(limit)} (x${ratio.toFixed(2)}); 1 s ${Math.round(st.v1)}, 10 s ${Math.round(st.v10)}, `
      + `60 s ${st.v60 > 0 ? Math.round(st.v60) : '-'}; continuity ${Math.round(cont * 100)}%; cell ${cellName(st.cell)}${f < 1 ? `; slowed x${f.toFixed(2)}` : ''}; server: ${action}`;
    acFlag(a, kind, { speed: Math.round(v), limit: Math.round(limit), ratio, window: W / 1000, cls }, text, { tier, action });
  };
  const judge = (st, a, t) => {
    const L10 = SP.limit10, foot = num(L10.foot, 650), alert = num(SP.alertSpeed, 850), K = SP.continuity;
    // 60 s every fifth tick of the player's own (its flags are shadow; a few seconds more do not matter), and the last result
    // as the context of a 10 s line
    const judge60 = ((ST.tickNo + (a & 7)) % 5) === 0;
    if (judge60) {
      windowStats(st, 60000, K * num(SP.limit60.foot, 540), K * num(SP.limit60.other, 750));
      st.v60 = st.wT > 0 ? (st.wD * 1000) / st.wT : 0;
      st.t60 = st.wT; st.c60a = st.wT > 0 ? st.wFastA / st.wT : 0; st.c60b = st.wT > 0 ? st.wFastB / st.wT : 0;
    }
    const t60 = judge60 ? st.t60 : 0, c60foot = st.c60a, c60other = st.c60b;
    windowStats(st, 10000, K * foot, K * alert);
    const t10 = st.wT;
    st.v10 = t10 > 0 ? (st.wD * 1000) / t10 : 0;
    const cFoot = t10 > 0 ? st.wFastA / t10 : 0, cAlert = t10 > 0 ? st.wFastB / t10 : 0;
    st.c10 = cFoot;
    const minLimit = Math.min(foot, alert, num(L10.mount, 850), num(L10.beast, 850), num(L10.unknown, 850));
    const slowed = st.slowUntil > t && st.slowFactor < 1;
    if (st.v10 <= minLimit && st.v60 <= num(SP.limit60.foot, 540) && !slowed) return;
    const cls = classOf(st, a, t);
    if (t10 > 0) {
      if (st.v10 > alert && cAlert >= K) speedFlag(st, a, t, 'speed_sustained', 'alert', st.v10, alert, 10000, cAlert);
      else {
        const lim = num(L10[cls], alert);
        if (lim < alert && st.v10 > lim) {
          let c = cFoot;
          if (lim !== foot) { windowStats(st, 10000, K * lim, K * lim); c = st.wT > 0 ? st.wFastA / st.wT : 0; }
          if (c >= K) speedFlag(st, a, t, 'speed_sustained', cls, st.v10, lim, 10000, c);
        }
      }
    }
    if (st.n === 0) return;
    if (t60 > 0) {
      const lim60 = cls === 'foot' ? num(SP.limit60.foot, 540) : num(SP.limit60.other, 750);
      const c = cls === 'foot' ? c60foot : c60other;
      if (st.v60 > lim60 && c >= K) speedFlag(st, a, t, 'speed_sustained60', cls, st.v60, lim60, 60000, c);
    }
    if (slowed && st.n > 0) {
      const W = Math.min(10000, t - (st.slowFrom + 1000));
      if (W >= SP.slowMinMs) {
        const lim = num(L10[cls], alert) * st.slowFactor;
        windowStats(st, W, K * lim, K * lim);
        if (st.wT > 0) {
          const v = (st.wD * 1000) / st.wT, c = st.wFastA / st.wT;
          if (v > lim && c >= K) speedFlag(st, a, t, 'speed_slow', cls, v, lim, Math.round(st.wT / 1000) * 1000, c);
        }
      }
    }
  };
  const sample = (st, a, t) => {
    let pos = null, cell = '';
    try { pos = mp.get(a, 'pos'); cell = mp.get(a, 'worldOrCellDesc'); } catch (e) { reset(st); return; }
    if (!Array.isArray(pos) || !Number.isFinite(Number(pos[0])) || !Number.isFinite(Number(pos[1]))) { reset(st); return; }
    const x = Number(pos[0]), y = Number(pos[1]), z = Number(pos[2]) || 0;
    const c = typeof cell === 'string' ? cell : String(cell || '');
    if (c !== st.cell) { st.cell = c; reset(st); }
    if (st.horse) updateMount(st, x, y);
    // a stall just ended, a dash or a shout launch, a server-granted movement mode: start again from here
    if (t < ST.reseedUntil || t < st.exemptUntil || (ST.modes.size && ST.modes.has(profileOf(a)))) { reset(st); push(st, t, x, y, z, NaN, 0, 0); return; }
    let step = 0, dt = 0;
    if (st.n > 0) { const i = st.head * 4; dt = t - st.ring[i]; const dx = x - st.ring[i + 1], dy = y - st.ring[i + 2]; step = Math.sqrt(dx * dx + dy * dy); }
    // the previous step was a long one: with this step far shorter it was a teleport, and the windows restart at its end
    if (st.pendingJump > 0) { if (step < st.pendingJump / 3) keepLast(st); st.pendingJump = 0; }
    let judgeNow = true;
    if (st.n > 0 && step >= SP.jumpUnits && st.lastStep < step / 3) { st.pendingJump = step; judgeNow = false; }
    if (st.n > 0 && step >= SP.blinkUnits && dt > 0 && dt <= SP.blinkWithinMs && isOn('speed')) {
      const n = noteBlink(st, t);
      if (n >= SP.blinkCount) acFlag(a, 'speed_blink', { speed: Math.round((step * 1000) / dt), window: Math.round(SP.blinkWindowMs / 1000), cls: st.cls },
        `${n} steps of ${SP.blinkUnits} u or more within ${SP.blinkWithinMs} ms in ${Math.round(SP.blinkWindowMs / 60000)} min, the last ${Math.round(step)} u in ${Math.round(dt)} ms, same cell ${cellName(st.cell)}; server: flag only`, {});
    }
    st.lastStep = step;
    st.v1 = dt > 0 ? (step * 1000) / dt : 0;
    // stored stamina, read only on a sprint-fast step (class kept fresh every 5 s)
    let sta = NaN;
    if (isOn('stamina') && st.v1 >= STA.sprintSpeed && dt <= 2000) {
      if (t - st.clsAt > 5000) classOf(st, a, t);
      if (st.cls === 'foot') { const p = pctOf(a); if (p && Number.isFinite(Number(p.stamina))) sta = Number(p.stamina); }
    }
    push(st, t, x, y, z, sta, st.v1, dt);
    if (!judgeNow) return;
    if (isOn('speed')) judge(st, a, t);
    if (Number.isFinite(sta) && st.n > 0) staminaCheck(st, a, t);
  };

  // ---- the fork bridge -----------------------------------------------------------------------------------------------------
  const forkConfig = () => {
    const out = {};
    for (const [k, v] of Object.entries(C.fork || {})) if (!k.startsWith('_')) out[k] = v;
    if (!isOn('fork')) out.enabled = false;
    return out;
  };
  const pushFork = () => {
    if (typeof mp.setAnticheatConfig !== 'function') return 'absent';
    try { mp.setAnticheatConfig(JSON.stringify(forkConfig())); return 'pushed'; } catch (e) { err('setAnticheatConfig', e); return 'failed'; }
  };
  const pushClass = (st, a, t) => {
    if (C.bridge.pushClasses !== true || typeof mp.setMovementClass !== 'function') return;
    const f = slowFactorOf(st, t);
    if (st.cls === st.pushedCls && f === st.pushedSlow) return;
    try { mp.setMovementClass(a, st.cls, f); st.pushedCls = st.cls; st.pushedSlow = f; } catch (e) { err('setMovementClass', e); }
  };
  const parseObj = (v) => {
    if (v && typeof v === 'object') return v;
    if (typeof v === 'string' && v.length <= 4096) { try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
    return {};
  };
  // numbers and short words only, never a key that could name an id, an address or a token
  const SECRET_KEY = /^ids?$|[a-z_]ids?$|^id[a-z_]|^ips?$|^ip[A-Z_]|[a-z_]ip$|hwid|token|secret|key$|discord|user|mail|addr/i;
  const safePairs = (o, depth, prefix, out) => {
    for (const [k, v] of Object.entries(o || {})) {
      if (out.length >= 40 || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(k) || SECRET_KEY.test(k)) continue;
      const name = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'number' && Number.isFinite(v)) out.push(`${name}=${Math.round(v * 1000) / 1000}`);
      else if (typeof v === 'boolean') out.push(`${name}=${v}`);
      else if (typeof v === 'string' && /^[a-z][a-z0-9_-]{0,23}$/i.test(v)) out.push(`${name}=${v}`);
      else if (Array.isArray(v)) { const nums = v.filter((x) => typeof x === 'number' && Number.isFinite(x)).slice(0, 8); if (nums.length) out.push(`${name}=[${nums.map((x) => Math.round(x * 100) / 100).join(' ')}]`); }
      else if (v && typeof v === 'object' && depth > 0) safePairs(v, depth - 1, name, out);
    }
    return out;
  };
  const onForkFlag = (actorId, kind, nums) => {
    const a = Number(actorId) >>> 0;
    if (!a || profileOf(a) < 0) return;
    const o = parseObj(nums);
    const k = KIND_RX.test(String(kind || '')) ? String(kind) : 'fork_other';
    const pairs = safePairs(o, 1, '', []);
    const sig = {};
    for (const key of SIG_NUMS) if (typeof o[key] === 'number' && Number.isFinite(o[key])) sig[key] = o[key]; else if (key === 'cls' && typeof o.cls === 'string' && /^[a-z]{1,12}$/.test(o.cls)) sig.cls = o.cls;
    acFlag(a, k, sig, `${pairs.join(', ') || 'no numbers'}; source: fork`, { src: 'fork' });
  };
  if (typeof globalThis.__dboPrevAnticheat === 'undefined') globalThis.__dboPrevAnticheat = typeof mp.onAnticheat === 'function' && !mp.onAnticheat.__dboAc ? mp.onAnticheat : null;
  const anticheatHook = (actorId, kind, nums, ...rest) => {
    try { onForkFlag(actorId, kind, nums); } catch (e) { err('fork flag', e); }
    const prev = globalThis.__dboPrevAnticheat;
    if (prev) { try { return prev(actorId, kind, nums, ...rest); } catch (e) { err('fork flag chain', e); } }
    return undefined;
  };
  anticheatHook.__dboAc = true;
  mp.onAnticheat = anticheatHook;

  // ---- engine slots: observed after the inner handler, whose verdict is returned unchanged ---------------------------------
  // gamemode.js sets each slot afresh on every load before this file runs, so these never stack
  {
    const inner = mp.onSpellCast;
    if (typeof inner === 'function') {
      mp.onSpellCast = function (casterId, spellId, ...rest) {
        const out = inner.call(this, casterId, spellId, ...rest);
        if (out !== false) { try { onCast(Number(casterId) >>> 0, Number(spellId) >>> 0, now()); } catch (e) { err('cast', e); } }
        return out;
      };
    }
  }
  {
    const inner = mp.onSpellHit;
    if (typeof inner === 'function') {
      mp.onSpellHit = function (aggressorId, targetId, spellId, ...rest) {
        const out = inner.call(this, aggressorId, targetId, spellId, ...rest);
        try {
          const st = playerOf(Number(targetId) >>> 0);
          if (st && spellInfo(Number(spellId) >>> 0).voice) st.exemptUntil = Math.max(st.exemptUntil, now() + SP.dashExemptMs);
        } catch (e) { err('spell hit', e); }
        return out;
      };
    }
  }
  {
    const inner = mp.onEatItem;
    if (typeof inner === 'function') {
      mp.onEatItem = function (actorId, baseId, ...rest) {
        const out = inner.call(this, actorId, baseId, ...rest);
        try { const st = playerOf(Number(actorId) >>> 0); if (st && out !== false) refill(st, now()); } catch (e) { err('eat', e); }
        return out;
      };
    }
  }
  {
    const inner = mp.onActivate;
    if (typeof inner === 'function') {
      mp.onActivate = function (targetId, casterId, ...rest) {
        const out = inner.call(this, targetId, casterId, ...rest);
        try {
          const st = out !== false ? playerOf(Number(casterId) >>> 0) : null;
          const tgt = Number(targetId) >>> 0;
          if (st && tgt !== st.a) {
            let base = 0; try { base = mp.getIdFromDesc(String(mp.get(tgt, 'baseDesc') || '')) >>> 0; } catch (e) { base = 0; }
            if (isHorseBase(base)) { st.horse = tgt; st.horseFar = 0; }
          }
        } catch (e) { err('activate', e); }
        return out;
      };
    }
  }
  // magicka refuseHits (default off; Jake's or Nate's GO): a flagged caster's spell hits land on no one for refuseMinutes
  if (MG.refuseHits === true) {
    const inner = mp.onHitDamageAttempt;
    if (typeof inner === 'function') {
      mp.onHitDamageAttempt = function (aggressorId, targetId, sourceId, damage, flags, ...rest) {
        try {
          const until = ST.refuse.size ? ST.refuse.get(Number(aggressorId) >>> 0) : 0;
          if (until && until > now() && isOn('refusehits')) {
            const isSpell = (flags && typeof flags === 'object' && flags.spell === true) || spellInfo(Number(sourceId) >>> 0).rtype === 'SPEL';
            if (isSpell) { globalThis.__dboHitRefusal = 'anticheat'; return false; }
          }
        } catch (e) { err('refuse hits', e); }
        return inner.call(this, aggressorId, targetId, sourceId, damage, flags, ...rest);
      };
    }
  }
  // The admin panel's movement modes: AdminSystem's log line through gamemode.js (set afresh before this file on every load)
  {
    const inner = globalThis.__alduinakAdminLog;
    if (typeof inner === 'function') {
      globalThis.__alduinakAdminLog = (text) => {
        try {
          const m = String(text).match(/^profile (\d+)(?: \([a-z]+\))? turned mode ([a-z]+) (on|off)\b/);
          if (m && MOVE_MODES.has(m[2])) {
            const p = Number(m[1]);
            let s = ST.modes.get(p);
            if (m[3] === 'on') { if (!s) ST.modes.set(p, s = new Set()); s.add(m[2]); } else if (s) { s.delete(m[2]); if (!s.size) ST.modes.delete(p); }
          }
        } catch (e) { err('admin mode', e); }
        return inner(text);
      };
    }
  }
  // The gamemode's own slows (dboStatus speedMult: armour swaps, terror, dismay), seen in its sendPacket
  globalThis.__dboAcStatus = (a, payload) => {
    const st = playerOf(Number(a) >>> 0);
    if (!st || !payload) return;
    const mult = Number(payload.speedMult), secs = Number(payload.seconds);
    if (!(mult < 0) || !(secs > 0)) return;
    const t = now();
    if (!(st.slowUntil > t)) st.slowFrom = t;
    st.slowFactor = Math.max(0.1, 1 + Math.max(-90, mult) / 100);
    st.slowUntil = Math.max(st.slowUntil, t + secs * 1000);
  };

  // ---- the 1 s timer -----------------------------------------------------------------------------------------------------
  const tick = () => {
    const t = now();
    const late = ST.lastTick ? t - ST.lastTick - TICK_MS : 0;
    ST.lastTick = t;
    ST.tickNo++;
    if (late >= STALL.lateMs) {
      ST.holdAllUntil = Math.max(ST.holdAllUntil, t + STALL.holdMs);
      ST.holdAllWhy = `the server timer ran ${(late / 1000).toFixed(1)} s late`;
      ST.reseedUntil = t + STALL.reseedMs;
      // the frozen time is not time a pending cast had to show its drop
      for (const st of ST.players.values()) for (const e of st.casts) e.t += late;
    }
    flushHeld(t);
    flushFolds(t);
    if (ST.counts.day !== dayOf(t)) rollDay(dayOf(t));
    for (const [a, until] of ST.refuse) if (until <= t) ST.refuse.delete(a);
    if (!isOn('all')) return;
    const holdingNow = ST.holdAllUntil > t;
    for (const x of onlineActors()) {
      const a = Number(x) >>> 0;
      if (!a) continue;
      let st = ST.players.get(a);
      if (!st) { st = newPlayer(a, t); ST.players.set(a, st); }
      st.seen = ST.tickNo;
      try {
        if (isOn('speed') || isOn('stamina')) sample(st, a, t);
        if (st.casts.length) castTick(st, a, t, !holdingNow);
        if (C.bridge.pushClasses === true && ((ST.tickNo + (a & 7)) % 5) === 0) { classOf(st, a, t); pushClass(st, a, t); }
      } catch (e) { err('tick', e); }
    }
    for (const [a, st] of ST.players) if (st.seen !== ST.tickNo) ST.players.delete(a);
  };
  every('acSpeedWatch', TICK_MS, tick);

  // ---- staff commands ---------------------------------------------------------------------------------------------------
  const findTarget = (q) => { try { return typeof api.findByName === 'function' ? (Number(api.findByName(String(q || ''))) >>> 0) : 0; } catch (e) { return 0; } };
  const statusLines = () => {
    const parts = PARTS.filter((p) => p !== 'all').map((p) => `${p} ${isOn(p) ? 'on' : 'off'}${OV.off[p] ? ' (runtime off)' : ''}`);
    const out = [`Anticheat ${isOn('all') ? 'on' : 'off'}${OV.off.all ? ' (runtime off)' : ''}: ${parts.join(', ')}.`];
    out.push(`Shadow (log only): ${[...SHADOW].join(', ') || 'none'}. Speed alert ${SP.alertSpeed} u/s for 10 s; foot ${SP.limit10.foot}, mount ${SP.limit10.mount}, beast ${SP.limit10.beast}; 60 s foot ${SP.limit60.foot}, other ${SP.limit60.other}.`);
    let fork = 'fork natives absent';
    if (typeof mp.getAnticheatConfig === 'function') { try { fork = `fork: ${safePairs(parseObj(mp.getAnticheatConfig()), 2, '', []).join(', ') || 'no values'}`; } catch (e) { fork = 'fork: unreadable'; } }
    out.push(fork);
    const counts = [...ST.counts.kinds.entries()].map(([k, c]) => `${k} ${c.n} (${c.players.size} players)`);
    out.push(`Today (${ST.counts.day || dayOf(now())} UTC): ${counts.join(', ') || 'no flags'}. Watching ${ST.players.size} players.`);
    return out;
  };
  if (typeof api.registerChatCommand === 'function') {
    api.registerChatCommand('anticheat', (a, args) => {
      if (typeof api.isLeadStaff === 'function' && !api.isLeadStaff(a)) return personal(a, '/anticheat is for Lead GMs and above.');
      const w = String(args || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
      const sub = w[0] || 'status';
      if (sub === 'status') { for (const l of statusLines()) personal(a, l); return undefined; }
      if (sub === 'off' || sub === 'on') {
        const part = w[1] || '';
        if (!PARTS.includes(part)) return personal(a, `Usage: /anticheat ${sub} <${PARTS.join('|')}>`);
        if (sub === 'off') OV.off[part] = { at: now(), by: profileOf(a) }; else delete OV.off[part];
        audit(`ANTICHEAT ${display(a)} turned ${part} ${sub} (runtime override until a restart)`);
        const forkNote = part === 'all' || part === 'fork' ? `; fork config ${pushFork()}` : '';
        return personal(a, `Anticheat ${part} is ${sub === 'off' ? 'off' : 'back to its config'} until a restart${forkNote}.`);
      }
      if (sub === 'recent') {
        const tag = (w[1] || '').replace(/^#/, '').toUpperCase();
        const rows = ST.recent.filter((r) => !tag || r.tag === tag).slice(-10);
        if (!rows.length) return personal(a, `No anticheat flags${tag ? ` for #${tag}` : ''} since the last restart.`);
        for (const r of rows) personal(a, `${new Date(r.t).toISOString().slice(11, 19)} ${r.kind}${r.shadow ? ' (shadow)' : ''} ${r.name}: ${r.text}`);
        return undefined;
      }
      return personal(a, 'Usage: /anticheat status | off <part> | on <part> | recent [#TAG]');
    }, { admin: true, help: 'status | off <part> | on <part> | recent [#TAG]: the anticheat flags and switches (Lead GM and above)' });
    api.registerChatCommand('acstate', (a, args) => {
      const t0 = findTarget(args);
      if (!t0) return personal(a, 'Usage: /acstate <#TAG|name> (online players)');
      const st = playerOf(t0), t = now();
      const head = `${display(t0)} (profile ${profileOf(t0)}${isStaff(t0) ? ', staff' : ''})`;
      if (!st) { personal(a, `${head}: not watched yet.`); }
      else {
        let blinks = 0; for (let i = 0; i < st.blinks.length; i++) if (st.blinks[i] > 0 && t - st.blinks[i] <= SP.blinkWindowMs) blinks++;
        const pinned = st.pinned.filter((e) => t - e.t <= MG.flagWindowMs);
        personal(a, `${head}: class ${st.cls}${st.mounted ? ' (horse near)' : ''}; speed 1 s ${Math.round(st.v1)}, 10 s ${Math.round(st.v10)}, 60 s ${Math.round(st.v60)} u/s; continuity ${Math.round(st.c10 * 100)}%; `
          + `blinks ${blinks} in ${Math.round(SP.blinkWindowMs / 60000)} min; ${st.slowUntil > t ? `slowed x${st.slowFactor.toFixed(2)}` : 'not slowed'}; ${st.exemptUntil > t ? 'dash exempt' : 'judged'}.`);
        personal(a, `Magicka: ${st.casts.length} casts pending, ${pinned.length} pinned in ${Math.round(MG.flagWindowMs / 60000)} min (${pinned.reduce((s, e) => s + e.cost, 0)} spell cost), ${st.gearSkipped || 0} skipped for gear${ST.refuse.has(t0) ? '; spell hits refused' : ''}.`);
      }
      if (typeof mp.getAnticheatState === 'function') {
        try { personal(a, `Fork: ${safePairs(parseObj(mp.getAnticheatState(t0)), 2, '', []).join(', ') || 'no values'}`); } catch (e) { personal(a, 'Fork: unreadable.'); }
      } else personal(a, 'Fork: natives absent (next restart window).');
      return undefined;
    }, { admin: true, help: '<#TAG|name>: what the anticheat sees of an online player (GM and above)' });
  }

  const forkPush = pushFork();
  globalThis.__dboAcFlag = acFlag;
  log(`anticheat: ${isOn('all') ? 'on' : 'off'} (speed ${isOn('speed') ? 'on' : 'off'}, magicka ${isOn('magicka') ? 'on' : 'off'}, stamina ${isOn('stamina') ? 'on' : 'off'}, `
    + `rubber-band ${isOn('rubberband') ? 'on' : 'off'}, refuse hits ${isOn('refusehits') ? 'on' : 'off'}, shadow ${SHADOW.size}), fork config ${forkPush}, ${ST.players.size} watched`);
  return { C, ST, OV, acFlag, tick, isOn, spellInfo, wornFortify, windowStats, onCast, pushFork, statusLines, anticheatHook };
};
module.exports.DEFAULTS = DEFAULTS;
module.exports.KINDS = KINDS;
module.exports.PARTS = PARTS;
module.exports.LINE_RX = LINE_RX;
module.exports.LOGGER_RX_SRC = LOGGER_RX_SRC;
