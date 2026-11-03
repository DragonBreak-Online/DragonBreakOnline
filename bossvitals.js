'use strict';
// Boss vitals (Nat, 2 Nov): staff raise the maximum Health, Magicka and Stamina of someone who plays a boss at an event.
// The raise is private.dboBossVitals on the character. charlevel.js adds it to private.dboAvBonus (__dboBossVitalBonus), which
// the server adds to the maximum it measures every hit and restore against (fork MpActor::AddLevelBonus; ActionListener's
// targetMax), and which the creation message carries at login. The boss's own client is sent the gain (levelBonusService
// dboAvGain), and everyone else sees the boss's bar as a share of that same maximum.
// Limits from the engine:
//   - the server counts at most NATIVE_MAX above the base per vital in all (level points, race and boss together);
//   - the server cannot read a character's absolute maximum (actor-base-stats-not-readable-server-side), so an amount is
//     added to their usual maximum, not set as a total;
//   - a lowered maximum reaches the boss's own bars at their next login (the client applies gains only).
//   /vitals <player|#TAG|me> health|magicka|stamina <amount> [keep]   the amount above their usual maximum; 0 clears it
//   /vitals <player|#TAG|me> reset | show
// GM and above, on a staff character. A GM sets themselves or a player standing inside an open /event's area
// (warband.js __dboWarbandEventAt); anyone else needs a Lead GM. Cleared at logout and when that event ends, unless "keep".

module.exports = (api) => {
  const { mp, log, personal, audit, who, display, registerChatCommand, findByName, staffTierOf, isLeadStaff, every, cfg } = api;
  // nativeMax: what MpActor::AddLevelBonus counts of a vital's whole bonus, 1000 until the fork's boss-vitals-clamp-1104
  // (10000) is live; cap: the most one raise may be, at most nativeMax. Both go to 10000 in config once it is
  const C = Object.assign({ nativeMax: 1000 }, (cfg && cfg.bossVitals) || {});
  const NATIVE_MAX = Math.max(0, Number(C.nativeMax) || 1000);
  if (C.cap === undefined) C.cap = NATIVE_MAX;
  const PROP = 'private.dboBossVitals';
  const VITALS = { health: 'Health', magicka: 'Magicka', stamina: 'Stamina' };
  const CAP = Math.max(0, Math.min(NATIVE_MAX, Number(C.cap) || 0));

  const stateOf = (a) => { try { const s = mp.get(a >>> 0, PROP); return s && typeof s === 'object' ? s : null; } catch (e) { return null; } };
  const amountOf = (s, k) => Math.max(0, Math.min(CAP, Math.round(Number(s && s[k]) || 0)));
  const isSet = (s) => !!s && Object.keys(VITALS).some((k) => amountOf(s, k) > 0);
  const sync = (a) => { const f = globalThis.__dboCharLevelSyncBonus; if (typeof f !== 'function') return false; f(a >>> 0); return true; };
  const eventAt = (a) => { const f = globalThis.__dboWarbandEventAt; try { return typeof f === 'function' ? f(a >>> 0) || null : null; } catch (e) { return null; } };
  const describe = (s) => Object.keys(VITALS).filter((k) => amountOf(s, k) > 0).map((k) => `+${amountOf(s, k)} ${VITALS[k]}`).join(', ') || 'none';

  // charlevel.js: the raise it adds to the level points and the race's bonus
  globalThis.__dboBossVitalBonus = (a) => { const s = stateOf(a); return s ? { health: amountOf(s, 'health'), magicka: amountOf(s, 'magicka'), stamina: amountOf(s, 'stamina') } : { health: 0 }; };

  const clear = (t, why, by) => {
    const s = stateOf(t);
    if (!s) return false;
    try { mp.set(t >>> 0, PROP, null); } catch (e) { log(`bossvitals: clearing ${display(t)} failed`, e.message); return false; }
    sync(t);
    audit(`VITALS ${who(t)} back to their own maximum (${why}${by ? ` by ${who(by)}` : ''}), was ${describe(s)}`);
    try { personal(t, 'Your Health, Magicka and Stamina are back to your own. Your bars show it after your next login.'); } catch (e) { /* offline */ }
    return true;
  };
  // gamemode.js at logout, warband.js when an event ends: what was not kept goes
  globalThis.__dboBossVitalsLeave = (a) => { const s = stateOf(a); if (s && !s.keep) clear(a, 'logout'); };
  globalThis.__dboBossVitalsEventEnd = (eventId) => {
    for (const a of (typeof api.onlineActors === 'function' ? api.onlineActors() : [])) {
      const s = stateOf(a);
      if (s && !s.keep && s.event && s.event === String(eventId)) clear(a, `event ${eventId} ended`);
    }
  };

  const refusal = (a, t) => {
    if (!['senior', 'developer', 'leadgm', 'gm'].includes(staffTierOf(a))) return 'Only a GM or above sets vitals.';
    const g = globalThis.__dboStaffGuard;
    if (g && typeof g.powersOn === 'function' && !g.powersOn(a)) return g.NOT_HERE;
    if ((t >>> 0) !== (a >>> 0) && !eventAt(t) && !isLeadStaff(a)) return 'A GM sets their own vitals, or a player standing inside an open event\'s area (/event); anyone else needs a Lead GM.';
    return '';
  };

  // The one way a raise is set: changes { health?, magicka?, stamina? } (amounts above the usual maximum; 0 clears that one).
  // Returns what the staff member is told
  const apply = (a, t, changes, keep) => {
    const no = refusal(a, t);
    if (no) return no;
    const keys = Object.keys(changes).filter((k) => VITALS[k]);
    if (!keys.length) return 'Give an amount for Health, Magicka or Stamina.';
    for (const k of keys) {
      const v = Number(changes[k]);
      if (!Number.isInteger(v) || v < 0) return `${VITALS[k]}: a whole number of 0 or more.`;
      if (v > CAP) return `At most +${CAP}: the server counts no more than ${NATIVE_MAX} above a character's base in all.`;
    }
    if (typeof globalThis.__dboCharLevelSyncBonus !== 'function') return 'Character levels (charlevel.js) are not loaded, so a raise cannot be applied.';
    const ev = eventAt(t);
    const before = stateOf(t) || {};
    const s = Object.assign({}, before, { by: who(a), at: new Date().toISOString(), event: ev ? String(ev.id) : (before.event || ''), keep: !!keep || !!before.keep });
    for (const k of keys) s[k] = Number(changes[k]);
    if (!isSet(s)) return clear(t, 'set to 0', a) ? `${display(t)} is back to their own vitals.` : `${display(t)} has no raised vitals.`;
    mp.set(t, PROP, s);
    sync(t);
    const bonus = (() => { try { return mp.get(t, 'private.dboAvBonus') || {}; } catch (e) { return {}; } })();
    const over = keys.filter((k) => (Number(bonus[k]) || 0) > NATIVE_MAX);
    const what = keys.map((k) => `${k} +${s[k]}`).join(', ');
    const until = s.keep ? 'kept until reset' : s.event ? `until ${s.event} ends or they log out` : 'until they log out';
    audit(`VITALS ${who(a)} set ${who(t)} ${what}, ${until}`);
    log(`bossvitals: ${display(t)} ${what}; their whole bonus is now ${JSON.stringify(bonus)}${over.length ? `, of which the server counts ${NATIVE_MAX} for ${over.join(', ')}` : ''}`);
    if ((t >>> 0) !== (a >>> 0)) { try { personal(t, `The staff raised your ${keys.map((k) => VITALS[k]).join(', ')} for the event.`); } catch (e) { /* offline */ } }
    return `${display(t)}: ${keys.map((k) => `${VITALS[k]} +${s[k]}`).join(', ')}${over.length ? ` (with their own bonuses the server counts +${NATIVE_MAX} for ${over.join(', ')})` : ''}, ${until}.`;
  };
  const reset = (a, t) => { const no = refusal(a, t); if (no) return no; return clear(t, 'reset', a) ? `${display(t)} is back to their own vitals.` : `${display(t)} has no raised vitals.`; };

  const run = (a, args) => {
    a >>>= 0;
    const words = String(args || '').trim().split(/\s+/).filter(Boolean);
    const usage = `Use /vitals <player|#TAG|me> health|magicka|stamina <amount above their maximum, up to ${CAP}> [keep], /vitals <player> reset, or /vitals <player> show.`;
    if (words.length < 2) return personal(a, usage);
    const keep = words[words.length - 1].toLowerCase() === 'keep' ? !!words.pop() : false;
    const sub = words[1].toLowerCase();
    const name = words[0].toLowerCase() === 'me' ? '' : words[0];
    const t = name ? (findByName(name) >>> 0) : a;
    if (!t) return personal(a, 'No such player online. Use their name or #TAG.');
    if (sub === 'show') { const s = stateOf(t); return personal(a, `${display(t)}: ${describe(s)}${s && s.keep ? ' (kept)' : s && s.event ? ` (until ${s.event} ends or they log out)` : s ? ' (until they log out)' : ''}.`); }
    if (sub === 'reset') return personal(a, reset(a, t));
    if (!VITALS[sub] || words.length < 3 || !/^\+?\d+$/.test(words[2])) return personal(a, usage);
    return personal(a, apply(a, t, { [sub]: Number(words[2].replace(/^\+/, '')) }, keep));
  };
  // The F7 panel's Vitals row (Players tab): dbo vitalsSet [targetHex, health, magicka, stamina, keep] (a blank amount is
  // left as it is), dbo vitalsReset [targetHex]. The target is the selected player, or the staff member when none is given
  const panelTarget = (a, raw) => { const id = parseInt(String(raw || '').replace(/^0x/i, ''), 16) >>> 0; return id || (a >>> 0); };
  if (typeof api.onUi === 'function') {
    api.onUi('vitalsSet', (a, args) => {
      const x = Array.isArray(args) ? args : [];
      const changes = {};
      ['health', 'magicka', 'stamina'].forEach((k, i) => { const v = String(x[i + 1] === undefined || x[i + 1] === null ? '' : x[i + 1]).trim(); if (v !== '') changes[k] = Number(v); });
      personal(a, apply(a >>> 0, panelTarget(a, x[0]), changes, x[4] === true || x[4] === 'true' || x[4] === 1 || x[4] === '1'));
    });
    api.onUi('vitalsReset', (a, args) => personal(a, reset(a >>> 0, panelTarget(a, (Array.isArray(args) ? args : [])[0]))));
  }
  registerChatCommand('vitals', run, { admin: true, help: '<player|#TAG|me> health|magicka|stamina <amount> [keep] | reset | show: raise a boss\'s maximum vitals for an event (GM+)' });

  // A raise whose event has ended while nobody was told (a restart, a reload without warband.js): cleared on the next pass
  if (typeof every === 'function') every('bossVitals', 60000, () => {
    const open = typeof globalThis.__dboWarbandEventOpen === 'function' ? globalThis.__dboWarbandEventOpen : null;
    if (!open) return;
    for (const a of (typeof api.onlineActors === 'function' ? api.onlineActors() : [])) {
      const s = stateOf(a);
      if (s && !s.keep && s.event && !open(s.event)) clear(a, `event ${s.event} is over`);
    }
  });
};
