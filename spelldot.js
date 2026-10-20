// DragonBreak Online: damage over time from a player's spell (Marcus, 18 Oct: Toxic Volley "doesn't even do damage").
// Loaded by gamemode.js.
//
// The server's spell formula deals an effect's magnitude once and never its duration: a "6 poison damage a second for 10 s"
// spell (BSKToxicMissile) took 6, a tenth of the spell. Here the rest is dealt as ticks, one a second for duration - 1
// seconds, each as large as the hit that landed (every damage multiplier already counted in it). A Damage Health effect is
// a value modifier (MGEF DATA archetype at 64 = 0) on Health (actor value at 68 = 24), hostile (flags 0x1), with an EFIT
// duration over 1 s. Only a player's spell or scroll: creatures' poison bites, dragon breath and hazards keep their numbers.
// A recast or the next second of a concentration spell starts the ticks over, as the game refreshes the effect rather than
// stacking it; a concentration spell's ticks wait until the hits stop. A tick never kills (minHealth): the next blow does.
'use strict';

module.exports = (api) => {
  const { mp, log, cfg, every, recordOf, profileOf, display } = api;
  const C = Object.assign({ enabled: true, minHealth: 0.01, tickMs: 1000, log: true }, cfg.spellDot || {});
  const DOTS = globalThis.__dboSpellDots instanceof Map ? globalThis.__dboSpellDots : (globalThis.__dboSpellDots = new Map()); // agg|tgt|src -> dot
  const PENDING = globalThis.__dboSpellDotPending instanceof Map ? globalThis.__dboSpellDotPending : (globalThis.__dboSpellDotPending = new Map()); // agg|tgt|src -> health before
  const cache = new Map();
  const u32 = (f, at) => new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(at, true);
  const i32 = (f, at) => new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getInt32(at, true);
  const pct = (a) => { try { const p = mp.get(a, 'percentages'); return p && typeof p.health === 'number' ? p : null; } catch (e) { return null; } };

  // The longest Damage Health duration of a spell or scroll (seconds), and whether it is a concentration spell; null for none
  const dotOf = (src) => {
    if (cache.has(src)) return cache.get(src);
    let out = null;
    const r = recordOf(src);
    const type = r ? String(r.record.type) : '';
    if (type === 'SPEL' || type === 'SCRL') {
      let effect = 0, seconds = 0;
      for (const f of r.record.fields || []) {
        if (!f || !(f.data instanceof Uint8Array)) continue;
        if (f.type === 'EFID' && f.data.byteLength >= 4) { try { effect = typeof r.toGlobalRecordId === 'function' ? r.toGlobalRecordId(u32(f, 0)) >>> 0 : u32(f, 0); } catch (e) { effect = 0; } continue; }
        if (f.type !== 'EFIT' || f.data.byteLength < 12 || !effect) continue;
        const m = recordOf(effect); effect = 0;
        const data = m && String(m.record.type) === 'MGEF' && (m.record.fields || []).find((x) => x && x.type === 'DATA' && x.data instanceof Uint8Array && x.data.byteLength >= 72);
        if (!data || !(u32(data, 0) & 0x1) || u32(data, 64) !== 0 || i32(data, 68) !== 24) continue;
        const dur = u32(f, 8);
        if (dur > 1 && new DataView(f.data.buffer, f.data.byteOffset, 4).getFloat32(0, true) > 0) seconds = Math.max(seconds, dur);
      }
      const spit = type === 'SPEL' && (r.record.fields || []).find((x) => x && x.type === 'SPIT' && x.data instanceof Uint8Array && x.data.byteLength >= 20);
      if (seconds > 1) out = { seconds, conc: !!spit && u32(spit, 16) === 2 };
    }
    cache.set(src, out);
    return out;
  };

  // From the hit judge, before the hit lands: the target's health now, for a player's damage-over-time spell
  globalThis.__dboSpellDotAttempt = (agg, tgt, src, healthBefore) => {
    if (!C.enabled || agg === tgt || !(Number(profileOf(agg)) > 0) || !(healthBefore > 0) || !dotOf(src >>> 0)) return;
    PENDING.set(`${agg >>> 0}|${tgt >>> 0}|${src >>> 0}`, { health: healthBefore, at: Date.now() });
    if (PENDING.size > 256) for (const [k, v] of PENDING) if (Date.now() - v.at > 5000) PENDING.delete(k);
  };
  // From onHitDamage, after every multiplier: the share this hit took is what each later second takes
  globalThis.__dboSpellDotLanded = (agg, tgt, src) => {
    const key = `${agg >>> 0}|${tgt >>> 0}|${src >>> 0}`;
    const p = PENDING.get(key); PENDING.delete(key);
    const d = dotOf(src >>> 0);
    const now = pct(tgt);
    if (!p || !d || !now || !(now.health > 0)) return null;
    const per = p.health - now.health;
    if (!(per > 0)) return null;
    // A beam's hits come about a second apart: its first tick waits half a second longer, so none falls between two hits
    const dot = { agg: agg >>> 0, tgt: tgt >>> 0, src: src >>> 0, per, left: d.seconds - 1, next: Date.now() + C.tickMs * (d.conc ? 1.5 : 1) };
    DOTS.set(key, dot);
    return dot;
  };
  const run = () => {
    const t = Date.now();
    for (const [k, d] of DOTS) {
      if (t < d.next) continue;
      const p = pct(d.tgt);
      let dead = false; try { dead = mp.get(d.tgt, 'isDead') === true; } catch (e) { dead = true; }
      if (!p || dead || !(p.health > C.minHealth)) { DOTS.delete(k); continue; }
      const health = Math.max(C.minHealth, p.health - d.per);
      try { mp.set(d.tgt, 'percentages', { health, magicka: p.magicka, stamina: p.stamina }); } catch (e) { DOTS.delete(k); continue; }
      d.next += C.tickMs;
      if (--d.left <= 0) {
        DOTS.delete(k);
        if (C.log) { const r = recordOf(d.src); log(`spell dot ${display(d.agg)} ${r ? r.record.editorId : d.src.toString(16)} on ${display(d.tgt)}: done (${(d.per * 100).toFixed(1)}% a second)`); }
      }
    }
  };
  globalThis.__dboSpellDotRun = run;
  globalThis.__dboSpellDotOf = dotOf;
  every('spellDot', 250, () => { if (DOTS.size) run(); });
  log(`spelldot ${C.enabled ? 'on' : 'off'}: a player's damage-over-time spell ticks for its duration, floor ${C.minHealth * 100}%`);
};
