// DragonBreak Online: Grand Healing reaches the players around the caster (Nat via the Leader, 31 Oct).
//
// The record's area is 15 ft (Skyrim.esm b62ee: RestoreHealthFFSelfArea 200, area 15), so the engine heals only those a
// step or two away, and the server heals each actor the caster's client reports hit (fork ActionListener OnSpellHit,
// the area share). Measured on live 25-31 Oct: every reported hit healed, but most players nearby were never reported.
// Now, after a cast, each hurt player within range units of the caster in the same cell or world is healed once by the
// area effect's own magnitude, unless the engine's hit already healed them in this cast. Never the caster (healed on
// cast), the dead, the downed (downed.js raises them), or a heal supernatural.js refuses (a vampire, a vampire's cast).
//
// gamemode-config.json "grandHealing": { enabled: true, range: 600, spells: ["b62ee:Skyrim.esm"] }; hot reload
'use strict';

module.exports = (api) => {
  const { mp, log, recordOf, onlineActors, profileOf, display, cfg } = api;
  const C = Object.assign({ enabled: true, range: 600, spells: ['b62ee:Skyrim.esm'] }, cfg.grandHealing || {});
  const ON = C.enabled !== false;
  const RANGE = Math.max(0, Number(C.range) || 0);
  // The engine's hits arrive just before the cast (live log); the extra heal waits a moment for any that come after
  const SETTLE_MS = 400, HIT_WINDOW_MS = 1500;
  const idOf = (d) => { try { return mp.getIdFromDesc(String(d)) >>> 0; } catch (e) { return 0; } };
  const SPELLS = new Set((Array.isArray(C.spells) ? C.spells : []).map(idOf).filter(Boolean));
  const HOSTILE = 0x1, DETRIMENTAL = 0x4, AV_HEALTH = 24;
  const fieldsOf = (lr, type) => ((lr && lr.record && lr.record.fields) || []).filter((f) => f && f.type === type && f.data instanceof Uint8Array);
  const view = (f) => new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength);
  const globalAt = (lr, local) => { try { return local ? lr.toGlobalRecordId(local) >>> 0 : 0; } catch (e) { return 0; } };
  // The health the spell's area effect restores: its first non-hostile Health effect with an area (EFIT magnitude f32 at 0,
  // area u32 at 4; MGEF DATA flags u32 at 0, primary actor value i32 at 0x44)
  const magnitudeCache = new Map();
  const areaHealthOf = (spellId) => {
    if (magnitudeCache.has(spellId)) return magnitudeCache.get(spellId);
    let mag = 0;
    try {
      const spell = recordOf(spellId);
      const efids = fieldsOf(spell, 'EFID'), efits = fieldsOf(spell, 'EFIT');
      for (let i = 0; i < efids.length && !mag; i++) {
        const it = efits[i]; if (!it || it.data.byteLength < 8 || view(it).getUint32(4, true) === 0) continue;
        const data = fieldsOf(recordOf(globalAt(spell, view(efids[i]).getUint32(0, true))), 'DATA')[0];
        if (!data || data.data.byteLength < 0x48) continue;
        const flags = view(data).getUint32(0, true), av = view(data).getInt32(0x44, true);
        if (av === AV_HEALTH && !(flags & (HOSTILE | DETRIMENTAL))) mag = Math.max(0, view(it).getFloat32(0, true));
      }
    } catch (e) { mag = 0; }
    magnitudeCache.set(spellId, mag);
    return mag;
  };
  // Who the engine healed: caster -> Map(target -> when its hit arrived), kept over a reload
  const hits = globalThis.__dboGrandHealHits instanceof Map ? globalThis.__dboGrandHealHits : (globalThis.__dboGrandHealHits = new Map());
  const get = (a, k) => { try { return mp.get(a, k); } catch (e) { return undefined; } };
  const call = (name, ...args) => { try { const f = globalThis[name]; return typeof f === 'function' ? f(...args) : undefined; } catch (e) { return undefined; } };
  const refused = (caster, t, spellId) => call('__dboVampHealBlocks', caster, t, spellId) === true || call('__dboIsDowned', t) === true;

  const onHit = (caster, target, spellId) => {
    if (!ON || !SPELLS.has(spellId) || caster === target) return;
    let m = hits.get(caster);
    if (!m) { if (hits.size > 500) hits.clear(); hits.set(caster, (m = new Map())); }
    m.set(target, Date.now());
  };
  // The players the cast reaches beyond the engine's own hits, and the heal for each: [{ t, health }]
  const extraTargets = (caster, spellId, castAt) => {
    const mag = areaHealthOf(spellId);
    if (!(mag > 0) || !(RANGE > 0)) return [];
    const cell = get(caster, 'worldOrCellDesc'), pos = get(caster, 'pos');
    if (!cell || !Array.isArray(pos)) return [];
    const healed = hits.get(caster) || new Map();
    const out = [];
    for (const t of onlineActors()) {
      if (t === caster || profileOf(t) < 0) continue;
      const at = healed.get(t);
      if (at !== undefined && at >= castAt - HIT_WINDOW_MS) continue;
      if (get(t, 'worldOrCellDesc') !== cell || get(t, 'isDead')) continue;
      const p = get(t, 'pos');
      if (!Array.isArray(p) || Math.hypot(p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]) > RANGE) continue;
      const pc = get(t, 'percentages');
      if (!pc || !(Number(pc.health) > 0) || !(Number(pc.health) < 1)) continue;
      if (refused(caster, t, spellId)) continue;
      out.push({ t, health: mag });
    }
    return out;
  };
  const heal = (t, points) => mp.callPapyrusFunction('method', 'Actor', 'RestoreActorValue', { type: 'form', desc: mp.getDescFromId(t) }, ['Health', points]);
  const onCast = (caster, spellId) => {
    if (!ON || !SPELLS.has(spellId) || profileOf(caster) < 0) return;
    const castAt = Date.now();
    setTimeout(() => {
      try {
        const list = extraTargets(caster, spellId, castAt);
        for (const { t, health } of list) { try { heal(t, health); } catch (e) { log('grand healing: heal failed', e.message); } }
        if (list.length) log(`grand healing: ${display(caster)} healed ${list.map((x) => display(x.t)).join(', ')} by ${list[0].health} beyond the engine's reach`);
        const m = hits.get(caster); if (m) for (const [t, at] of m) if (at < castAt - HIT_WINDOW_MS) m.delete(t);
      } catch (e) { log('grand healing failed', e.stack || e.message); }
    }, SETTLE_MS);
  };
  globalThis.__dboGrandHealCast = (caster, spellId) => onCast(Number(caster) >>> 0, Number(spellId) >>> 0);
  globalThis.__dboGrandHealHit = (caster, target, spellId) => onHit(Number(caster) >>> 0, Number(target) >>> 0, Number(spellId) >>> 0);
  log(`grand healing: ${ON ? `on, ${RANGE} units` : 'off'}, ${SPELLS.size} spell(s), ${[...SPELLS].map((s) => `${s.toString(16)} heals ${areaHealthOf(s)}`).join(', ')}`);
  return { onCast, onHit, extraTargets, areaHealthOf };
};
