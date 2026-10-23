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
'use strict';

const PROP = 'ff_spellInvis';

module.exports = (api) => {
  const { mp, log, onUi, cfg } = api;
  const C = Object.assign({ enabled: true, minRepeatMs: 1000 }, (cfg && cfg.spellInvis) || {});
  try { mp.makeProperty(PROP, { isVisibleByOwner: true, isVisibleByNeighbors: true, updateOwner: '', updateNeighbor: '' }); } catch (e) { /* registered before a hot reload */ }
  if (!C.enabled) { log('spellinvis: off'); return { enabled: false }; }
  const last = globalThis.__dboSpellInvisLast instanceof Map ? globalThis.__dboSpellInvisLast : (globalThis.__dboSpellInvisLast = new Map());
  const now = () => Date.now();

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
  return { enabled: true, report, PROP };
};
