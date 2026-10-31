// DragonBreak Online: /regendiag, why a player's bars come back as fast as they do (Leader, 31 Oct: magicka regeneration
// reports from the sweep). Staff only, reads and writes nothing in the game.
//
// What the server holds: since rc-1027-regen Actor.SetActorValue sets the server's own copy of the rate mults, and the
// regeneration ceiling (CropRegeneration.cpp) is old + rate x rateMult x seconds with the actor's own rate mult, a 0
// included. So the last value the gameplay layer sent (gamemode.js __dboAvSent) is the rate mult the ceiling uses; none
// sent since the start means the race's base. Two writers set MagickaRateMult: Death's Chill (downed.js, 0 while the bar
// is at its cap) and the vampire blood (supernatural.js). Hunger, the chill and the blood set HealRateMult and
// StaminaRateMult through gamemode.js applyNeedsStage.
//
// It then measures: the three bars now and seconds later (default 6, 3 to 30), as a share of the bar a second, beside
// the most the ceiling allows (the race's rate from its record x regenerationMultiplier x the rate mult) and the
// server-side extra the race gift or a sign adds (racial.js). A STALE line marks a rate mult at 0 with no chill to say so.
//   /regendiag <name or #TAG> [seconds]
'use strict';

module.exports = (api) => {
  const { mp, log, personal, registerChatCommand, findByName, display } = api;
  const STATS = [['health', 'HealRateMult'], ['magicka', 'MagickaRateMult'], ['stamina', 'StaminaRateMult']];
  const call = (name, ...args) => { try { const f = globalThis[name]; return typeof f === 'function' ? f(...args) : undefined; } catch (e) { return undefined; } };
  const get = (a, k) => { try { return mp.get(a, k); } catch (e) { return undefined; } };
  const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : '?');
  const regenMult = () => { try { const v = Number((mp.getServerSettings() || {}).regenerationMultiplier); return Number.isFinite(v) && v >= 0 ? v : 1; } catch (e) { return 1; } };
  const bars = (a) => { const p = get(a, 'percentages') || {}; return { health: Number(p.health), magicka: Number(p.magicka), stamina: Number(p.stamina) }; };

  // Every factor for one actor, now: what each module wants and what the server was last sent
  const snapshot = (a) => {
    const sent = (globalThis.__dboAvSent instanceof Map ? globalThis.__dboAvSent.get(a) : null) || {};
    const chill = get(a, 'private.dboDeathChill');
    const chillMs = chill && Number(chill.leftMs) > 0 ? Number(chill.leftMs) : 0;
    const out = { chillMs, regenMult: regenMult(), stats: {} };
    for (const [stat, av] of STATS) {
      const s = sent[av];
      const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
      out.stats[stat] = {
        av, sent: s ? Number(s.value) : null, sentAgoS: s ? Math.round((Date.now() - Number(s.at)) / 1000) : null,
        chill: num(call('__dboChillRateMult', a, av), 1), blood: num(call('__dboSuperRateMult', a, av), 1),
        frenzy: num(call('__dboFrenzyRateMult', a, av), 1), needs: num(call('__dboNeedsRateMult', a, av), 1),
        racial: call('__dboRacialRegenDiag', a, stat) || null,
      };
    }
    return out;
  };
  // The most a second the server lets the bar come back: the race's rate x regenerationMultiplier x the rate mult held
  // (the last sent, else 100, the vanilla base the change form is seeded with)
  const ceilingPerSecond = (st, regen) => {
    const rate = st.racial && Number(st.racial.raceRate) > 0 ? Number(st.racial.raceRate) : NaN;
    const mult = st.sent === null ? 100 : st.sent;
    return (rate / 100) * regen * (mult / 100);
  };
  const lines = (a, snap, before, after, secs) => {
    const out = [`regendiag ${display(a)}: regenerationMultiplier ${snap.regenMult}, Death's Chill ${snap.chillMs ? `${Math.ceil(snap.chillMs / 60000)} min left` : 'none'}`];
    for (const [stat] of STATS) {
      const st = snap.stats[stat], r = st.racial || {};
      const moved = (after[stat] - before[stat]) / secs;
      const held = st.sent === null ? 'none sent (base)' : `${st.sent} sent ${st.sentAgoS}s ago`;
      out.push(`${stat}: ${pct(before[stat])} -> ${pct(after[stat])}, ${pct(moved)}/s measured, ceiling ${pct(ceilingPerSecond(st, snap.regenMult))}/s`
        + ` | ${st.av} ${held} | chill x${st.chill} blood x${st.blood} frenzy x${st.frenzy} hunger x${st.needs}`
        + ` | race ${r.race || '-'}${r.sign ? `/${r.sign}` : ''} rate ${r.raceRate === undefined ? '?' : r.raceRate} factor x${r.factor === undefined ? '?' : Number(r.factor).toFixed(2)}`
        + ` extra ${pct(Number(r.extraPerSecond))}/s${r.fighting ? ` in combat x${r.combatMult}` : ''}${r.castHeld ? ', cast held' : ''}`);
      if (st.sent === 0 && st.chill !== 0) out.push(`STALE ${stat}: ${st.av} is 0 on the server with no chill freeze to hold it; the bar cannot come back`);
      else if (st.sent !== null && st.sent < 100 && st.chill === 1 && st.blood === 1 && st.frenzy === 1 && st.needs === 1) out.push(`STALE? ${stat}: ${st.av} ${st.sent} with no slowdown in effect`);
      if (after[stat] >= 1) out.push(`(${stat} is full: no rate can be measured)`);
    }
    return out;
  };

  registerChatCommand('regendiag', (a, args) => {
    const parts = String(args || '').trim().split(/\s+/).filter(Boolean);
    let secs = 6;
    if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) secs = Math.min(30, Math.max(3, Number(parts.pop())));
    const t = parts.length ? findByName(parts.join(' ')) : a;
    if (!t) return personal(a, 'No one online by that name or #TAG.');
    const before = bars(t);
    personal(a, `Measuring ${display(t)} for ${secs} s. Ask them not to cast, swing, sprint or drink meanwhile.`);
    setTimeout(() => {
      try {
        const snap = snapshot(t);
        const out = lines(t, snap, before, bars(t), secs);
        for (const l of out) personal(a, l);
        log(out.join(' || '));
      } catch (e) { personal(a, `regendiag failed: ${e.message}`); log('regendiag failed', e.stack || e.message); }
    }, secs * 1000);
  }, { admin: true, help: '<name or #TAG> [seconds]: what slows or speeds their health, magicka and stamina, and how fast each comes back' });

  return { snapshot, lines, ceilingPerSecond };
};
