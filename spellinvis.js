// DragonBreak Online: who is really invisible, for every watcher (Nate, 23 Oct: "players watch others unseen"). Loaded
// by gamemode.js after onUi.
//
// An Invisibility potion, spell or scroll reaches the copies other players keep of a player (the server makes the copies
// drink the potion; magicSyncService replays the spell), but an attack or an activation ends it on the player's own
// screen only: the copies stayed invisible for the effect's full 30-50 s. The player's own client now reports its state
// (client SpellInvisReportService), this mirrors it in the neighbour-visible ff_spellInvis { on, n }, and a watcher hides
// a player copy only while that says on and n changed within its bound (client spellInvisPolicy.ts). n grows with
// every accepted report, so a repeated "on" (the client's heartbeat) still reaches the watchers as a change.
//
//   Client -> Server: { customPacketType: "dbo", event: "spellInvis", args: [on] }
//   Neighbours:       ff_spellInvis { on: boolean, n: number }
//
// A changed state is mirrored at once; the same state again at most once per minRepeatMs (a heartbeat is 3 s). Config
// "spellInvis": { enabled, minRepeatMs }. Off: no handler, so a client hides no player copy for this at all.
//
// isInvisible(a) is the server's answer for npcdirector.js, which runs the NPCs near an invisible player on that player's
// own game (NPC AI runs on one host client, and another client's copy of the player may never have had the effect). It
// needs both: the server saw the player cast or drink an Invisibility effect (gamemode.js castHook and eatHook call
// noteSource) within sourceMult x its duration + sourceGraceMs, and the player's own report says on, at most freshMs old.
// Config adds { freshMs, sourceMult, sourceGraceMs }.
'use strict';

const PROP = 'ff_spellInvis';
const INVISIBILITY_ARCHETYPE = 11;

module.exports = (api) => {
  const { mp, log, onUi, cfg } = api;
  const C = Object.assign({ enabled: true, minRepeatMs: 1000, freshMs: 8000, sourceMult: 3, sourceGraceMs: 5000 }, (cfg && cfg.spellInvis) || {});
  try { mp.makeProperty(PROP, { isVisibleByOwner: true, isVisibleByNeighbors: true, updateOwner: '', updateNeighbor: '' }); } catch (e) { /* registered before a hot reload */ }
  if (!C.enabled) { globalThis.__dboSpellInvisible = null; globalThis.__dboSpellInvisSource = null; log('spellinvis: off'); return { enabled: false }; }
  const last = globalThis.__dboSpellInvisLast instanceof Map ? globalThis.__dboSpellInvisLast : (globalThis.__dboSpellInvisLast = new Map());
  // actor -> until when a cast or drink the server saw can still keep them invisible
  const until = globalThis.__dboSpellInvisUntil instanceof Map ? globalThis.__dboSpellInvisUntil : (globalThis.__dboSpellInvisUntil = new Map());
  const now = () => Date.now();

  // Longest Invisibility effect of a spell, potion, scroll or enchantment in seconds (MGEF DATA archetype at 0x40, EFIT duration at 8)
  const secondsCache = new Map();
  const fieldsOf = (r, type) => ((r && r.record && r.record.fields) || []).filter((f) => f.type === type && f.data instanceof Uint8Array);
  const u32At = (f, off) => (f && f.data.byteLength >= off + 4 ? new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(off, true) : 0);
  const recordOf = (id) => { try { const r = mp.lookupEspmRecordById(id >>> 0); return r && r.record ? r : null; } catch (e) { return null; } };
  const globalAt = (r, local) => { try { return local ? r.toGlobalRecordId(local) >>> 0 : 0; } catch (e) { return 0; } };
  const invisSeconds = (id) => {
    id = id >>> 0;
    if (secondsCache.has(id)) return secondsCache.get(id);
    let seconds = 0;
    const r = recordOf(id);
    const efits = fieldsOf(r, 'EFIT');
    fieldsOf(r, 'EFID').forEach((f, i) => {
      const data = fieldsOf(recordOf(globalAt(r, u32At(f, 0))), 'DATA')[0];
      if (u32At(data, 0x40) === INVISIBILITY_ARCHETYPE) seconds = Math.max(seconds, u32At(efits[i], 8));
    });
    if (secondsCache.size > 4096) secondsCache.clear();
    secondsCache.set(id, seconds);
    return seconds;
  };
  const noteSource = (a, id) => {
    a = a >>> 0;
    const seconds = a ? invisSeconds(id) : 0;
    if (!(seconds > 0)) return false;
    const t = now() + seconds * 1000 * C.sourceMult + C.sourceGraceMs;
    if ((until.get(a) || 0) < t) until.set(a, t);
    if (until.size > 2000) { const n = now(); for (const [k, v] of until) if (v <= n) until.delete(k); }
    return true;
  };
  const isInvisible = (a) => {
    a = a >>> 0;
    const t = now();
    if (!((until.get(a) || 0) > t)) return false;
    const at = last.get(a);
    if (at === undefined || t - at > C.freshMs) return false;
    let cur = null;
    try { cur = mp.get(a, PROP); } catch (e) { return false; }
    return !!cur && cur.on === true;
  };
  globalThis.__dboSpellInvisible = isInvisible;
  globalThis.__dboSpellInvisSource = noteSource;

  const report = (a, args) => {
    a = a >>> 0;
    if (!a) return false;
    const on = Array.isArray(args) && args[0] === true;
    let cur = null;
    try { cur = mp.get(a, PROP); } catch (e) { cur = null; }
    const was = cur && typeof cur === 'object' ? cur : null;
    const t = now();
    const prev = last.get(a);
    if (was && was.on === on && prev !== undefined && t - prev < C.minRepeatMs) return false;
    const n = ((Number(was && was.n) || 0) + 1) % 1000000;
    try { mp.set(a, PROP, { on, n }); } catch (e) { log('spellinvis: set failed', e.message); return false; }
    last.set(a, t);
    if (last.size > 2000) for (const k of last.keys()) { last.delete(k); if (last.size <= 1000) break; }
    return true;
  };

  onUi('spellInvis', (a, args) => { report(a, args); });
  log(`spellinvis: on (repeat >= ${C.minRepeatMs} ms)`);
  return { enabled: true, report, PROP, invisSeconds, noteSource, isInvisible };
};
