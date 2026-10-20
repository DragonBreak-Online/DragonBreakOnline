// DragonBreak Online: duels between two players (mestreugway's suggestion, 11 Oct; Nate picked it 19 Oct). Loaded by
// gamemode.js after downed.js, whose hit, death, cast and eat hooks it wraps from outside.
//
// X on another player offers Challenge to a Duel (playermenu.js asks __dboDuelEntries, __dboDuelAction answers). The
// challenger sets the duel in a panel (DUEL_MENU_ID): the type, the format (one round, best of three, best of five), the
// rules (no magic, no potions, both) and a wager in gold each. The challenged player is shown the type first and accepts
// or refuses that duel as set, in a panel of their own (OFFER_MENU_ID; closing it or answerSeconds passing refuses).
// Both must agree to the type (Nate, 19 Oct: "players can choose what they do ... both must agree to the duel type"):
//   Practice fight  rounds as chosen, no wager, no winner recorded
//   Friendly duel   a winner, no wager
//   Wager duel      a winner, and a wager each that the winner takes
//   Death duel      one round, a wager optional, no guard. Each side confirms a second warning before it begins; both
//                   agreements and every result are audited. Two readings, by config deathDuelPermadeath:
//                   false  the losing blow lands: the loser dies as in any fight, under downed.js's rules
//                                    (the down state, a revive, the temple and Death's Chill, the body searched),
//                                    with no kneel and no heal. The wager goes to the winner.
//                   true (default)   the loser's character ends for good (supernatural.js __dboPermaKill). The losing
//                                    blow is refused like any duel's and the loser is ended standing, as the chopping
//                                    block does (execution.js), so no revive, crash forgiveness or temple can race it;
//                                    a blow that got past the guard ends the fallen body the same way. Nobody offline
//                                    is ever ended.
//                   Only the other's blow decides it: a broken rule forfeits without death; a yield, a logout, leaving
//                   the ground or anything but the other's blow ends it with no winner and the stakes back.
//                   Config deathDuels: false takes the type away and ends a running one without death.
// To begin, both stand within challengeMeters, at full health, up, unbound, in their own form, free of Death's Chill and
// out of any PvP fight for combatSeconds, and each carries the wager. The wagers are taken at the start and held on each
// character (private.dboDuelEscrow), so a restart or a crash returns them at the next login: the winner gets both, a duel
// with no winner gives each their own back. No gold is made or lost.
// A round is lost when a blow from the other side would bring health to loseAt or below: the blow is refused, the loser
// kneels (the essential bleed-out pose, as after a revive in downed.js) for pauseSeconds, nobody dies, then both stand at
// full health and the next round counts down. A blow the engine would make lethal but the gameplay's scaling would not is
// refused and its scaled share taken off here instead. Breaking a rule loses the round: a spell cast with magic barred, a
// potion with potions barred; a spell, scroll or staff hit on the other is refused too.
// Others stay out: no other player (or their summon) can hurt a duelist, and a duelist cannot hurt any other player. NPCs
// and creatures still can; falling to one, or to anything but the other duelist, ends the duel with no winner.
// The duel also ends with no winner after maxMinutes, or when one logs out (disconnect 'forfeit' gives it to the one who
// stayed); stepping arenaMeters from where it began for leaveSeconds forfeits it (both out: no winner).
//
// gamemode-config.json "duel" (every key optional); enabled: false takes the menu entry away and ends no running duel.
'use strict';

module.exports = (api) => {
  const { mp, log, personal, audit, who, display, profileOf, onlineActors, every, registerChatCommand, cfg, openWidget,
    closeWidget, onUi, sendPacket, takeGold, giveItem, goldOf, recordOf, findByName, isAdmin, staffLog } = api;
  const C = Object.assign({
    enabled: true, challengeMeters: 8, arenaMeters: 25, leaveSeconds: 3, answerSeconds: 30, countdownSeconds: 3,
    pauseSeconds: 6, loseAt: 0.05, fullHealth: 0.99, combatSeconds: 30, maxMinutes: 15, maxWager: 5000,
    wagerSteps: [0, 10, 25, 50, 100, 250, 500, 1000], formats: ['single', 'bo3', 'bo5'], disconnect: 'refund',
    deathDuels: true, deathDuelPermadeath: true, minMaxHealth: 150, outsiderNoticeSeconds: 5,
  }, cfg.duel || {});
  const DUEL_MENU_ID = 121;
  const OFFER_MENU_ID = 122;
  const GOLD = 0x0000000f;
  const UNITS = 70; // per metre
  const ESCROW = 'private.dboDuelEscrow';

  const FORMATS = {
    single: { wins: 1, label: 'a single round' },
    bo3: { wins: 2, label: 'best of three' },
    bo5: { wins: 3, label: 'best of five' },
  };
  const RULES = [
    { id: 'none', label: 'anything goes', magic: true, potions: true },
    { id: 'nomagic', label: 'no magic', magic: false, potions: true },
    { id: 'nopotions', label: 'no potions', magic: true, potions: false },
    { id: 'both', label: 'no magic, no potions', magic: false, potions: false },
    // Beast forms may be taken mid-fight (Purr, 20 Oct: a werewolf duel lost the round on the turn); both still start in their own form
    { id: 'beasts', label: 'anything goes, beast forms too', magic: true, potions: true, beasts: true },
  ];
  const TYPES = {
    practice: { label: 'Practice fight', winner: false, wager: false },
    friendly: { label: 'Friendly duel', winner: true, wager: false },
    wager: { label: 'Wager duel', winner: true, wager: true },
    death: { label: 'Death duel', winner: true, wager: 'optional', death: true },
  };
  const permadeath = () => C.deathDuelPermadeath !== false;
  const deathWarning = () => (permadeath() ? "The loser's character dies for good: no revive, no temple, no way back."
    : 'Nothing holds the last blow back: the loser falls as in any fight, to be finished, raised or sent to the temple with the chill of the grave.');
  const deathOn = () => C.deathDuels !== false && (!permadeath() || typeof globalThis.__dboPermaKill === 'function');
  const typeList = () => Object.keys(TYPES).filter((t) => !TYPES[t].death || deathOn());
  const isDeath = (d) => !!(d && TYPES[d.type] && TYPES[d.type].death);
  const formatList = () => (Array.isArray(C.formats) ? C.formats : []).filter((f) => FORMATS[f]);

  // Kept across hot reloads: running duels by id and by duelist, the challengers' drafts, open offers by the challenged
  const S = globalThis.__dboDuels || (globalThis.__dboDuels = { duels: new Map(), by: new Map(), drafts: new Map(), offers: new Map(), told: new Map(), seq: 0 });

  const get = (a, prop, fallback) => { try { const v = mp.get(a, prop); return v === undefined || v === null ? fallback : v; } catch (e) { return fallback; } };
  const isPlayer = (a) => { try { return Number(profileOf(a)) >= 0; } catch (e) { return false; } };
  const online = (a) => onlineActors().includes(a >>> 0);
  const dead = (a) => get(a, 'isDead', false) === true;
  const downed = (a) => { try { return typeof globalThis.__dboIsDowned === 'function' && !!globalThis.__dboIsDowned(a); } catch (e) { return false; } };
  const recovering = (a) => { const d = globalThis.__dboDownedState; return !!(d && d.recovering instanceof Map && d.recovering.has(a >>> 0)); };
  const restrained = (a) => { const r = get(a, 'private.restrained', null) || {}; return !!(r.boundHands || r.carried); };
  const beast = (a) => { const s = get(a, 'private.beast', null); return !!(s && s.form); };
  const chilled = (a) => { try { return typeof globalThis.__dboDeathChillLeft === 'function' && globalThis.__dboDeathChillLeft(a) > 0; } catch (e) { return false; } };
  const inFight = (a) => { const m = globalThis.__dboPvpAt; return m instanceof Map && Date.now() - (m.get(a >>> 0) || 0) < C.combatSeconds * 1000; };
  const pct = (a) => { const p = get(a, 'percentages', null); return p && typeof p.health === 'number' ? p : null; };
  const health = (a) => { const p = pct(a); return p ? p.health : 0; };
  const setPct = (a, v) => { const p = pct(a); if (p) { try { mp.set(a, 'percentages', Object.assign({ health: p.health, magicka: p.magicka, stamina: p.stamina }, v)); } catch (e) { /* not an actor */ } } };
  const placeOf = (a) => ({ cell: get(a, 'worldOrCellDesc', ''), pos: get(a, 'pos', null) });
  const gap = (p, q) => (p.cell && p.cell === q.cell && Array.isArray(p.pos) && Array.isArray(q.pos)
    ? Math.hypot(p.pos[0] - q.pos[0], p.pos[1] - q.pos[1], p.pos[2] - q.pos[2]) : Infinity);
  // A companion or summon fights for its owner (downed.js sideOf)
  const sideOf = (a) => { const o = Number(get(a, 'ff_companionOf', 0)) >>> 0; return o || a; };
  // The name a player sees for another: introduced, Stranger or Masked Person (playermenu.js)
  const nameTo = (viewer, x) => {
    try { return typeof globalThis.__dboNameFor === 'function' ? globalThis.__dboNameFor(viewer >>> 0, x >>> 0) : display(x); } catch (e) { return display(x); }
  };
  const banner = (a, text, seconds) => {
    try { sendPacket(a, { customPacketType: 'dboBanner', text, seconds: seconds || 4 }); } catch (e) { /* offline */ }
    try { personal(a, text); } catch (e) { /* offline */ }
  };
  const anim = (a, ev) => { try { mp.callPapyrusFunction('global', 'Debug', 'SendAnimationEvent', null, [{ type: 'form', desc: mp.getDescFromId(a) }, ev]); } catch (e) { log(`duel: ${ev} failed for ${display(a)}: ${e.message}`); } };

  // ---- what counts as magic and as a potion ----------------------------------------------------------------------------
  // SPEL SPIT: u32 cost, u32 flags, u32 type at offset 8, 0 = Spell (libespm SPEL.h SPITData). Powers, abilities and shouts
  // are not spells. ALCH ENIT flag 0x2 marks food (gamemode.js alchIsFood): any other ALCH is a potion.
  const kindCache = new Map();
  const kindOf = (id) => {
    id = Number(id) >>> 0;
    if (kindCache.has(id)) return kindCache.get(id);
    let kind = '';
    const r = recordOf ? recordOf(id) : null;
    const type = r ? String(r.record.type) : '';
    const field = (name, size) => (r.record.fields || []).find((x) => x && x.type === name && x.data instanceof Uint8Array && x.data.byteLength >= size);
    const u32 = (f, at) => new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(at, true);
    if (type === 'SPEL') { const f = field('SPIT', 12); kind = f && u32(f, 8) === 0 ? 'spell' : ''; }
    else if (type === 'SCRL') kind = 'scroll';
    else if (type === 'ENCH') kind = 'enchantment';
    else if (type === 'ALCH') { const f = field('ENIT', 8); kind = f && (u32(f, 4) & 0x2) !== 0 ? 'food' : 'potion'; }
    if (kindCache.size > 4096) kindCache.clear();
    kindCache.set(id, kind);
    return kind;
  };
  const isMagicHit = (src) => { const k = kindOf(src); return k === 'spell' || k === 'scroll' || k === 'enchantment'; };
  const isMagicCast = (src) => { const k = kindOf(src); return k === 'spell' || k === 'scroll'; };

  // ---- the duel itself -------------------------------------------------------------------------------------------------
  const duelOf = (a) => { const id = S.by.get(a >>> 0); const d = id && S.duels.get(id); return d || null; };
  const other = (d, a) => ((a >>> 0) === d.a ? d.b : d.a);
  const idx = (d, a) => ((a >>> 0) === d.a ? 0 : 1);
  const score = (d) => `${d.wins[0]}-${d.wins[1]}`;
  const describe = (o) => `${TYPES[o.type].label}: ${TYPES[o.type].death ? 'one round' : FORMATS[o.format] ? FORMATS[o.format].label : o.format}, ${RULES[o.rules] ? RULES[o.rules].label : o.rules}, ${o.wager > 0 ? `${o.wager} gold each` : 'no wager'}`;
  const inArea = (d, x) => gap(placeOf(x), d.anchor) <= C.arenaMeters * UNITS;
  // True for the two duelists of one running duel (downed.js: no friendly-fire cut between party members who duel)
  globalThis.__dboDuelPair = (x, y) => { const d = duelOf(Number(x) >>> 0); return !!d && other(d, Number(x) >>> 0) === (Number(y) >>> 0); };
  globalThis.__dboInDuel = (a) => !!duelOf(Number(a) >>> 0);

  // Why these two cannot duel now ('' when they can), worded for a
  const refusal = (a, t, wager) => {
    if (!C.enabled) return 'Duels are not allowed right now.';
    if (!t || t === a || !isPlayer(t) || !online(t)) return 'There is no one there to duel.';
    if (duelOf(a)) return 'You are already in a duel.';
    if (duelOf(t)) return `${nameTo(a, t)} is already in a duel.`;
    if (gap(placeOf(a), placeOf(t)) > C.challengeMeters * UNITS) return `Stand within ${C.challengeMeters} m of ${nameTo(a, t)} to duel.`;
    for (const x of [a, t]) {
      const you = x === a;
      const n = you ? 'You' : nameTo(a, t), are = you ? 'are' : 'is';
      if (dead(x) || downed(x) || recovering(x)) return `${n} ${are} down.`;
      if (restrained(x)) return `${n} ${are} bound.`;
      if (beast(x)) return `${n} ${are} in a beast form.`;
      if (chilled(x)) return `${n} still ${you ? 'feel' : 'feels'} the chill of the grave.`;
      if (inFight(x)) return `${n} ${are} in a fight.`;
      if (health(x) < C.fullHealth) return `${n} must be at full health to duel.`;
      if (wager > 0 && goldOf(x) < wager) return `${n} ${you ? 'do' : 'does'} not carry ${wager} gold.`;
    }
    return '';
  };

  // ---- the wagers --------------------------------------------------------------------------------------------------------
  // A record on the character holds what is owed to them: { id, gold }. While its id is a running duel it is held; any
  // other record is paid out (settle) at the end, and again at a login or a sweep if a payment failed or a restart came
  const record = (a) => { const r = get(a, ESCROW, null); return r && typeof r === 'object' && Number(r.gold) > 0 ? r : null; };
  const hold = (a, id, gold) => { try { mp.set(a, ESCROW, { id: String(id), gold: Math.round(gold), at: Date.now() }); return true; } catch (e) { log(`duel: escrow for ${display(a)} not written: ${e.message}`); return false; } };
  const clear = (a) => { try { mp.set(a, ESCROW, null); } catch (e) { /* not an actor */ } };
  const settle = (a, why) => {
    const r = record(a);
    if (!r) return 0;
    const gold = Math.round(Number(r.gold));
    if (!giveItem(a, GOLD, gold)) { log(`duel: ${gold} gold for ${display(a)} not paid, kept for the next login`); return -1; }
    clear(a);
    audit(`DUEL ${who(a)} paid ${gold} gold (${why || r.id})`);
    return gold;
  };
  // Leftovers: a record for no running duel (a restart, a failed payment)
  const settleLeftover = (a) => {
    const r = record(a);
    if (!r || S.duels.has(String(r.id))) return;
    if (settle(a, `returned after ${String(r.id).startsWith('payout:') || String(r.id).startsWith('refund:') ? 'a failed payment' : 'a duel the server lost'}`) > 0) {
      personal(a, `${Math.round(Number(r.gold))} gold held for a duel was returned to you.`);
    }
  };

  // ---- rounds ----------------------------------------------------------------------------------------------------------
  const restore = (d, x) => {
    if (!online(x) || dead(x) || recovering(x)) return;
    const p = pct(x); if (!p) return;
    const snap = d.snap[idx(d, x)] || {};
    setPct(x, { health: 1, magicka: Math.max(p.magicka, Number(snap.magicka) || 0), stamina: Math.max(p.stamina, Number(snap.stamina) || 0) });
  };
  // Damage over time between the two stops with the round (spelldot.js keys agg|tgt|src)
  const clearDots = (d) => {
    const dots = globalThis.__dboSpellDots;
    if (!(dots instanceof Map)) return;
    for (const k of [...dots.keys()]) {
      const [x, y] = String(k).split('|').map((v) => Number(v) >>> 0);
      if ((sideOf(x) === d.a && y === d.b) || (sideOf(x) === d.b && y === d.a)) dots.delete(k);
    }
  };
  const kneel = (x, seconds) => {
    if (health(x) > C.loseAt) setPct(x, { health: C.loseAt });
    anim(x, 'BleedOutStart');
    try { sendPacket(x, { customPacketType: 'dboParalyse', seconds, quiet: true }); } catch (e) { /* offline */ }
  };
  const stand = (x) => { if (online(x) && !dead(x)) anim(x, 'BleedOutStop'); };
  const startRound = (d) => {
    d.round++;
    d.phase = 'countdown';
    d.until = Date.now() + C.countdownSeconds * 1000;
    d.kneeling = 0;
    for (const x of [d.a, d.b]) restore(d, x);
    const of = FORMATS[d.format].wins > 1 ? ` (${FORMATS[d.format].label}, ${score(d)})` : '';
    for (const x of [d.a, d.b]) banner(x, `Round ${d.round}${of}. Ready yourself: ${C.countdownSeconds} seconds.`, C.countdownSeconds);
    if (d.owed) { const x = d.owed; d.owed = 0; roundLost(d, x, 'broke the rules between rounds'); }
  };
  const roundLost = (d, loser, why) => {
    if (d.phase === 'over') return;
    if (d.phase === 'pause') { if (!d.owed && d.kneeling !== loser) d.owed = loser; return; }
    const winner = other(d, loser);
    if (isDeath(d)) {
      // Only the other's blow ends a life; a broken rule forfeits the duel without death
      if (why === 'beaten') return deathBlow(d, winner, loser);
      return award(d, winner, `${display(loser)} ${why}, a forfeit without death`);
    }
    d.wins[idx(d, winner)]++;
    d.phase = 'pause';
    d.until = Date.now() + C.pauseSeconds * 1000;
    d.kneeling = loser;
    if (d.wins[idx(d, winner)] >= FORMATS[d.format].wins) d.winner = winner;
    clearDots(d);
    kneel(loser, C.pauseSeconds);
    const last = !!d.winner;
    banner(loser, `${nameTo(loser, winner)} wins the ${last ? 'duel' : 'round'}${why === 'beaten' ? '' : `: you ${why}`}. You yield.`, 5);
    banner(winner, `You win the ${last ? 'duel' : 'round'}${why === 'beaten' ? '' : `: ${nameTo(winner, loser)} ${why}`}.`, 5);
    audit(`DUEL ${who(winner)} won round ${d.round} against ${who(loser)} (${why}), ${score(d)}`);
  };
  // The end of every duel, with a winner (0 for none). Pays the wagers, heals both, and stands the loser up.
  const finish = (d, winner, why) => {
    if (d.closed) return;
    // A practice fight records no winner and has no wager: its score is all it leaves
    if (winner && !TYPES[d.type].winner) { practiceOver(d, why); winner = 0; why = 'practice over'; }
    d.closed = true;
    d.phase = 'over';
    d.winner = winner || 0;
    S.duels.delete(d.id);
    for (const x of [d.a, d.b]) if (S.by.get(x) === d.id) S.by.delete(x);
    if (d.kneeling) stand(d.kneeling);
    clearDots(d);
    // They fought as duellists, not as enemies: each may raise the other afterwards (downed.js hostile)
    if (!isDeath(d)) try { const ds = globalThis.__dboDownedState; if (ds && ds.fought instanceof Map) ds.fought.delete(d.a < d.b ? `${d.a}:${d.b}` : `${d.b}:${d.a}`); } catch (e) { /* no down state */ }
    if (d.wager > 0) {
      if (winner) {
        const loser = other(d, winner);
        if (hold(winner, `payout:${d.id}`, d.wager * 2)) clear(loser);
        settle(winner, `duel ${d.id} won`);
      } else {
        for (const x of [d.a, d.b]) { hold(x, `refund:${d.id}`, d.wager); settle(x, `duel ${d.id} without a winner`); }
      }
    }
    // A death duel is a real fight: nobody is healed at its end
    if (!isDeath(d)) for (const x of [d.a, d.b]) restore(d, x);
    if (why === 'practice over') { audit(`DUEL practice fight of ${who(d.a)} and ${who(d.b)} over, ${score(d)}, ${describe(d)}`); return; }
    const purse = d.wager > 0 ? (winner ? ` and the ${d.wager * 2} gold wagered` : '. Each wager goes back') : '';
    for (const x of [d.a, d.b]) {
      if (!online(x)) continue;
      const y = other(d, x);
      if (!winner) banner(x, `The duel with ${nameTo(x, y)} ends with no winner (${why})${purse}.`, 5);
      else if (x === winner) banner(x, `You win the duel against ${nameTo(x, y)}, ${score(d)}${purse}.`, 5);
      else if (!isDeath(d) || !permadeath()) banner(x, `${nameTo(x, y)} wins the ${isDeath(d) ? 'death duel' : 'duel'}, ${score(d)}.`, 5);
    }
    audit(`DUEL ${isDeath(d) ? `DEATH result (${permadeath() ? 'permadeath' : 'a normal death'}): ` : ''}${winner ? `${who(winner)} beat ${who(other(d, winner))}` : `${who(d.a)} and ${who(d.b)}: no winner`} (${why}), ${score(d)}, ${describe(d)}`);
  };
  const practiceOver = (d, why) => {
    for (const x of [d.a, d.b]) if (online(x)) banner(x, `The practice fight with ${nameTo(x, other(d, x))} is over, ${d.wins[idx(d, x)]}-${d.wins[idx(d, other(d, x))]}${/yield|left/.test(why) ? ` (${why})` : ''}.`, 5);
  };
  // A death duel decided by the other's blow. The loser is ended standing (permaKill), never offline, never off the ground,
  // never with death duels switched off; else the duel ends with no winner. The wager is paid before the death.
  const deathBlow = (d, winner, loser) => {
    d.phase = 'deathblow';
    d.wins[idx(d, winner)] = 1;
    setTimeout(() => {
      if (d.closed) return;
      const why = !deathOn() ? 'death duels are switched off' : !online(loser) || !online(winner) ? 'one of them is gone'
        : dead(loser) ? `${display(loser)} fell already` : !inArea(d, loser) || !inArea(d, winner) ? 'one of them left the ground' : '';
      if (why) return finish(d, 0, why);
      finish(d, winner, 'the death blow');
      endLife(d, winner, loser, 'the death blow');
    }, 0);
  };
  const endLife = (d, winner, loser, how) => {
    banner(loser, `${nameTo(loser, winner)} wins the death duel.`, 6);
    try { globalThis.__dboPermaKill(loser, `killed by ${display(winner)} in a death duel they both agreed to`); } catch (e) { log(`duel: permaKill failed: ${e.message}`); }
    const gone = get(loser, 'private.permaDead', false) === true;
    const line = `${display(winner)} killed ${display(loser)} in a death duel (PK, ${how}), agreed by ${display(d.a)} at ${d.agreed[0]} and ${display(d.b)} at ${d.agreed[1]}`;
    audit(`DUEL DEATH ${who(winner)} killed ${who(loser)} in a death duel (${how}); agreed ${d.agreed[0]} and ${d.agreed[1]}${gone ? '' : '; the permadeath DID NOT take'}`);
    try { if (typeof staffLog === 'function') staffLog(display(winner), '', 'death duel', gone ? line : `${line}; the permadeath did not take`, false); } catch (e) { /* the audit line stands */ }
  };
  // The duel goes to y outright: a yield, a forfeit, a killing blow
  const award = (d, y, why) => { d.wins[idx(d, y)] = Math.max(d.wins[idx(d, y)], FORMATS[d.format].wins); finish(d, y, why); };
  const begin = (a, b, o) => {
    const id = `${Date.now().toString(36)}-${(++S.seq).toString(36)}`;
    if (o.wager > 0) {
      if (!takeGold(a, o.wager)) return `${display(a)} no longer carries the wager.`;
      hold(a, id, o.wager);
      if (!takeGold(b, o.wager)) { hold(a, `refund:${id}`, o.wager); settle(a, 'duel not begun'); return `${display(b)} no longer carries the wager.`; }
      hold(b, id, o.wager);
    }
    const pa = placeOf(a), pb = placeOf(b);
    const d = {
      id, a, b, type: o.type, agreed: [o.agreedA || '', o.agreedB || ''], format: TYPES[o.type].death ? 'single' : o.format, rules: o.rules, wager: o.wager, wins: [0, 0], round: 0, phase: 'countdown', until: 0,
      anchor: { cell: pa.cell, pos: pa.pos.map((v, i) => (v + pb.pos[i]) / 2) }, startedAt: Date.now(), out: [0, 0],
      snap: [pct(a), pct(b)], kneeling: 0, winner: 0, owed: 0, closed: false,
    };
    S.duels.set(id, d);
    S.by.set(a, id); S.by.set(b, id);
    audit(`DUEL ${who(a)} and ${who(b)} began a duel: ${describe(o)}${o.wager > 0 ? ` (${o.wager * 2} gold held)` : ''}`);
    startRound(d);
    return '';
  };

  // ---- the hit, death, cast and eat hooks (outside downed.js's) ------------------------------------------------------
  const throttledTell = (a, text) => {
    const now = Date.now();
    if (now - (S.told.get(a) || 0) < C.outsiderNoticeSeconds * 1000) return;
    S.told.set(a, now);
    if (S.told.size > 256) for (const [k, t] of S.told) if (now - t > 60000) S.told.delete(k);
    personal(a, text);
  };
  const clearPending = () => {
    globalThis.__dboMasteryPending = null;
    globalThis.__dboSuperPending = null;
    const ds = globalThis.__dboDownedState; if (ds) ds.pending = null;
  };
  {
    const inner = mp.onHitDamageAttempt;
    if (typeof inner === 'function') {
      const duelAttempt = function (aggressorId, targetId, sourceId, damage, ...rest) {
        if (!S.by.size) return inner.call(this, aggressorId, targetId, sourceId, damage, ...rest);
        const agg = Number(aggressorId) >>> 0, tgt = Number(targetId) >>> 0, src = Number(sourceId) >>> 0, dmg = Number(damage) || 0;
        const side = sideOf(agg);
        const dt = duelOf(tgt), da = duelOf(side);
        if ((!dt && !da) || side === tgt) return inner.call(this, aggressorId, targetId, sourceId, damage, ...rest);
        if (dt && other(dt, tgt) === side) {
          // A blow between the two: only while a round is fought, and within the rules
          if (dt.phase !== 'fight') { globalThis.__dboHitRefusal = 'duel_pause'; return false; }
          if (!RULES[dt.rules].magic && isMagicHit(src)) {
            throttledTell(agg, 'No magic in this duel: the spell does nothing.');
            globalThis.__dboHitRefusal = 'duel_rules';
            return false;
          }
          if (inner.call(this, aggressorId, targetId, sourceId, damage, ...rest) === false) return false;
          // A death duel without permadeath has no guard: the losing blow lands and downed.js takes the fall
          if (isDeath(dt) && !permadeath()) return true;
          if (!(dmg > 0)) return true;
          const p = pct(tgt);
          if (!p || !(p.health > 0)) return true;
          const flags = rest[0] && typeof rest[0] === 'object' ? rest[0] : {};
          const ds = globalThis.__dboDownedState;
          const max = Number(flags.targetMaxHealth) > 0 ? Number(flags.targetMaxHealth)
            : (ds && ds.maxHp instanceof Map && ds.maxHp.get(tgt) > 0 ? ds.maxHp.get(tgt) : C.minMaxHealth);
          // The gameplay's own scaling of this blow (mastery, Defense, the supernatural), noted by the inner chain
          let mult = 1;
          for (const pend of [globalThis.__dboMasteryPending, globalThis.__dboSuperPending]) {
            if (pend && pend.agg === agg && pend.tgt === tgt && Number(pend.mult) > 0) mult *= Number(pend.mult);
          }
          const after = p.health - (dmg * mult) / max;
          if (after <= C.loseAt) {
            clearPending();
            globalThis.__dboHitRefusal = 'duel_beaten';
            roundLost(dt, tgt, 'beaten');
            return false;
          }
          if (p.health - dmg / max <= 0.001) {
            // The engine's full blow would kill where the scaled one does not: refused, and the scaled share taken here
            clearPending();
            setTimeout(() => { try { if (dt.phase === 'fight' && !dead(tgt)) { const q = pct(tgt); if (q) setPct(tgt, { health: Math.max(C.loseAt + 0.001, q.health - (dmg * mult) / max) }); } } catch (e) { /* gone */ } }, 0);
            globalThis.__dboHitRefusal = 'duel_scaled';
            return false;
          }
          return true;
        }
        // Someone else's blow on a duelist, or a duelist's on someone else: only between players (and what fights for them)
        if (dt && isPlayer(side)) { throttledTell(side, `${nameTo(side, tgt)} is fighting a duel. Stay out of it.`); globalThis.__dboHitRefusal = 'duel_outsider'; return false; }
        if (da && isPlayer(tgt)) { throttledTell(side, 'You are in a duel: your fight is with your opponent alone.'); globalThis.__dboHitRefusal = 'duel_outsider'; return false; }
        return inner.call(this, aggressorId, targetId, sourceId, damage, ...rest);
      };
      duelAttempt.__dboDuel = true;
      mp.onHitDamageAttempt = duelAttempt;
    }
  }
  {
    const inner = mp.onDeath;
    if (typeof inner === 'function') {
      mp.onDeath = function (actorId, killerId, ...rest) {
        const out = inner.call(this, actorId, killerId, ...rest);
        try {
          const x = Number(actorId) >>> 0, d = duelOf(x);
          if (d) {
            const y = other(d, x), by = sideOf(Number(killerId) >>> 0);
            if (by === y && isDeath(d) && !permadeath()) {
              // The losing blow of a death duel: the loser is down like anyone killed (downed.js), the winner paid
              d.wins[idx(d, y)] = 1;
              finish(d, y, 'the killing blow');
            } else if (by === y && isDeath(d)) {
              // The engine's blow got past the guard in a death duel: the same end, on the fallen body, while both are here
              if (deathOn() && online(x) && online(y) && inArea(d, x) && inArea(d, y)) {
                d.wins[idx(d, y)] = 1;
                finish(d, y, 'a killing blow');
                try { const ds = globalThis.__dboDownedState; if (ds && ds.downed instanceof Map) ds.downed.delete(x); closeWidget(x, 62); } catch (e) { /* no down state */ }
                endLife(d, y, x, 'a killing blow');
              } else finish(d, 0, `${display(x)} fell, but the death could not be given`);
            } else if (by === y) {
              // A blow that got past the guard: the duel is lost, and the winner raises the fallen at once
              award(d, y, 'a killing blow');
              setTimeout(() => {
                try {
                  if (dead(x) && typeof globalThis.__dboReviveWith === 'function') globalThis.__dboReviveWith(x, y, 'mercy at the end of the duel');
                  const rs = Number((cfg.downed || {}).recoverSeconds);
                  setTimeout(() => restore(d, x), ((Number.isFinite(rs) ? rs : 15) + 1.5) * 1000);
                } catch (e) { log(`duel: raising ${display(x)} failed: ${e.message}`); }
              }, 500);
            } else finish(d, 0, `${display(x)} fell to another`);
          }
        } catch (e) { log(`duel: death handling failed: ${e.message}`); }
        return out;
      };
    }
  }
  const breach = (a, why) => {
    const d = duelOf(a);
    if (d && d.phase !== 'over') roundLost(d, a, why);
  };
  {
    const inner = mp.onSpellCast;
    if (typeof inner === 'function') {
      mp.onSpellCast = function (casterId, spellId, ...rest) {
        const out = inner.call(this, casterId, spellId, ...rest);
        try {
          const a = Number(casterId) >>> 0, d = S.by.size ? duelOf(a) : null;
          if (d && !RULES[d.rules].magic && isMagicCast(spellId)) breach(a, 'cast a spell');
        } catch (e) { log(`duel: cast check failed: ${e.message}`); }
        return out;
      };
    }
  }
  {
    const inner = mp.onEatItem;
    if (typeof inner === 'function') {
      mp.onEatItem = function (actorId, baseId, ...rest) {
        const out = inner.call(this, actorId, baseId, ...rest);
        try {
          const a = Number(actorId) >>> 0, d = S.by.size ? duelOf(a) : null;
          if (d && !RULES[d.rules].potions && kindOf(baseId) === 'potion') breach(a, 'drank a potion');
        } catch (e) { log(`duel: potion check failed: ${e.message}`); }
        return out;
      };
    }
  }

  // ---- the panels --------------------------------------------------------------------------------------------------------
  const nonceFor = (a) => `${(a >>> 0).toString(16)}-${Date.now().toString(36)}`;
  const iso = () => new Date(Date.now()).toISOString();
  const wagerSteps = () => (Array.isArray(C.wagerSteps) ? C.wagerSteps : [0]).map((n) => Math.max(0, Math.round(Number(n) || 0))).filter((n) => n <= C.maxWager);
  // The steps this challenger can afford for this type: a Wager duel has no "none", the others without a wager only "none"
  const stepsFor = (a, type) => {
    const w = TYPES[type].wager;
    if (!w) return [0];
    const l = wagerSteps().filter((n) => n === 0 || n <= goldOf(a));
    return w === true ? l.filter((n) => n > 0) : l;
  };
  const draftPanel = (a) => {
    const d = S.drafts.get(a);
    if (!d) return;
    const T = TYPES[d.type];
    if (d.step === 'confirm') {
      return openWidget(a, {
        type: 'contextMenu', id: DUEL_MENU_ID, mode: 'menu',
        targetName: `DEATH DUEL with ${nameTo(a, d.target)}. ${deathWarning()} That may be you. Are you sure?`,
        actions: [{ id: `${d.nonce}|confirm`, label: 'Yes: to the death. Send the challenge' }, { id: `${d.nonce}|back`, label: 'No, go back' }],
        events: { action: 'dbo:duelDraft', close: 'dbo:duelDraftClose' },
      }, true);
    }
    const actions = [{ id: `${d.nonce}|type`, label: `Type: ${T.label}` }];
    if (!T.death) actions.push({ id: `${d.nonce}|format`, label: `Format: ${FORMATS[d.format].label}` });
    actions.push({ id: `${d.nonce}|rules`, label: `Rules: ${RULES[d.rules].label}` });
    if (T.wager) actions.push({ id: `${d.nonce}|wager`, label: d.wager > 0 ? `Wager: ${d.wager} gold each, the winner takes both` : 'Wager: none' });
    actions.push({ id: `${d.nonce}|send`, label: 'Send the challenge' }, { id: `${d.nonce}|cancel`, label: 'Cancel' });
    const note = T.death ? deathWarning() : T.winner ? 'Nobody dies: a beaten duellist kneels.' : 'Nobody dies, and no winner is kept.';
    openWidget(a, {
      type: 'contextMenu', id: DUEL_MENU_ID, mode: 'menu',
      targetName: `Challenge ${nameTo(a, d.target)}: ${T.label.toUpperCase()}. Choose a line to change it. ${note}`,
      actions, events: { action: 'dbo:duelDraft', close: 'dbo:duelDraftClose' },
    }, true);
  };
  const openDraft = (a, t) => {
    const why = refusal(a, t, 0);
    if (why) return personal(a, why);
    if (!formatList().length) return personal(a, 'Duels are not allowed right now.');
    S.drafts.set(a, { target: t, type: 'friendly', format: formatList()[0], rules: 0, wager: 0, nonce: nonceFor(a), step: 'settings', agreedAt: '' });
    draftPanel(a);
  };
  const closeDraft = (a) => { S.drafts.delete(a); closeWidget(a, DUEL_MENU_ID); };
  const offerFor = (a) => { for (const [t, o] of S.offers) if (o.from === (a >>> 0)) return { t, o }; return null; };
  const offerPanel = (t, o) => {
    const a = o.from, T = TYPES[o.type];
    if (o.step === 'confirm') {
      return openWidget(t, {
        type: 'contextMenu', id: OFFER_MENU_ID, mode: 'menu',
        targetName: `DEATH DUEL with ${nameTo(t, a)}. ${deathWarning()} That may be you. Are you sure?`,
        actions: [{ id: `${o.nonce}|confirm`, label: 'Yes: to the death' }, { id: `${o.nonce}|refuse`, label: 'No, refuse' }],
        events: { action: 'dbo:duelOffer', close: 'dbo:duelOfferClose' },
      }, true);
    }
    const note = T.death ? deathWarning() : T.winner ? 'Nobody dies: a beaten duellist kneels.' : 'Nobody dies, and no winner is kept.';
    openWidget(t, {
      type: 'contextMenu', id: OFFER_MENU_ID, mode: 'menu',
      targetName: `${T.label.toUpperCase()}: ${nameTo(t, a)} challenges you. ${describe(o)}${o.wager > 0 ? ', the winner takes both' : ''}. ${note} You must be at full health.`,
      actions: [{ id: `${o.nonce}|accept`, label: `Accept the ${T.label.toLowerCase()}` }, { id: `${o.nonce}|refuse`, label: 'Refuse' }],
      events: { action: 'dbo:duelOffer', close: 'dbo:duelOfferClose' },
    }, true);
  };
  const sendOffer = (a, d) => {
    const t = d.target, T = TYPES[d.type];
    if (!T || (T.death && !deathOn())) return personal(a, 'Death duels are not allowed right now.');
    if (T.death && !d.agreedAt) return personal(a, 'A death duel must be confirmed first.');
    if (T.wager === true && !(d.wager > 0)) return personal(a, 'A wager duel needs a wager: choose one, or make it a friendly duel.');
    const why = refusal(a, t, d.wager);
    if (why) return personal(a, why);
    if (S.offers.has(t)) return personal(a, `${nameTo(a, t)} is answering another challenge.`);
    const mine = offerFor(a); if (mine) withdraw(mine.t, 'replaced');
    const o = { from: a, type: d.type, format: T.death ? 'single' : d.format, rules: d.rules, wager: T.wager ? d.wager : 0, nonce: nonceFor(t),
      until: Date.now() + C.answerSeconds * 1000, step: 'offer', agreedA: d.agreedAt, agreedB: '' };
    S.offers.set(t, o);
    offerPanel(t, o);
    personal(a, `You challenge ${nameTo(a, t)} (${describe(o)}). They have ${C.answerSeconds} seconds to answer.`);
    log(`duel: ${display(a)} challenged ${display(t)} (${describe(o)})`);
    if (T.death) audit(`DUEL DEATH ${who(a)} confirmed a death duel challenge to ${who(t)} at ${d.agreedAt} (${describe(o)})`);
  };
  // An open challenge goes away: refused, timed out, replaced or one of them gone
  const withdraw = (t, why) => {
    const o = S.offers.get(t);
    if (!o) return;
    S.offers.delete(t);
    closeWidget(t, OFFER_MENU_ID);
    if (why === 'refused') { if (online(o.from)) personal(o.from, `${nameTo(o.from, t)} refuses your ${TYPES[o.type].label.toLowerCase()}.`); }
    else if (why === 'timeout') { if (online(o.from)) personal(o.from, `${nameTo(o.from, t)} did not answer your challenge.`); personal(t, 'The challenge lapses.'); }
    if (TYPES[o.type].death) audit(`DUEL DEATH ${who(t)} did not take the death duel from ${who(o.from)} (${why}${o.step === 'confirm' ? ', at the second warning' : ''})`);
    log(`duel: challenge ${display(o.from)} -> ${display(t)} ended (${why})`);
  };
  const answer = (t, accept) => {
    const o = S.offers.get(t);
    if (!o) return;
    if (!accept || Date.now() > o.until) return withdraw(t, accept ? 'timeout' : 'refused');
    S.offers.delete(t);
    closeWidget(t, OFFER_MENU_ID);
    const a = o.from;
    if (TYPES[o.type].death && !deathOn()) { personal(a, 'Death duels are not allowed right now.'); personal(t, 'Death duels are not allowed right now.'); return; }
    const why = refusal(a, t, o.wager);
    if (why) {
      personal(a, why);
      personal(t, `The duel cannot begin: ${why.charAt(0).toLowerCase() + why.slice(1)}`);
      return;
    }
    if (TYPES[o.type].death) audit(`DUEL DEATH agreed: ${who(a)} at ${o.agreedA} and ${who(t)} at ${o.agreedB} (${describe(o)})`);
    const failed = begin(a, t, o);
    if (failed) { personal(a, `The duel cannot begin: ${failed}`); personal(t, `The duel cannot begin: ${failed}`); }
  };

  if (typeof onUi === 'function') {
    onUi('duelDraft', (a, args) => {
      const d = S.drafts.get(a >>> 0);
      const raw = String((args || [])[0] || ''), cut = raw.indexOf('|');
      if (!d || cut < 0 || raw.slice(0, cut) !== d.nonce) return;
      const what = raw.slice(cut + 1);
      if (d.step === 'confirm') {
        if (what === 'back') { d.step = 'settings'; return draftPanel(a); }
        if (what !== 'confirm') return;
        d.agreedAt = iso();
        closeDraft(a);
        return sendOffer(a, d);
      }
      if (what === 'type') {
        const l = typeList();
        d.type = l[(l.indexOf(d.type) + 1) % l.length];
        const steps = stepsFor(a, d.type);
        if (!steps.includes(d.wager)) d.wager = steps.length ? steps[0] : 0;
        return draftPanel(a);
      }
      if (what === 'format') { const l = formatList(); d.format = l[(l.indexOf(d.format) + 1) % l.length]; return draftPanel(a); }
      if (what === 'rules') { d.rules = (d.rules + 1) % RULES.length; return draftPanel(a); }
      if (what === 'wager') {
        const steps = stepsFor(a, d.type);
        const next = steps.find((n) => n > d.wager);
        d.wager = next === undefined ? (steps[0] || 0) : next;
        return draftPanel(a);
      }
      // The first agreement to a death duel: the challenger reads the warning and confirms it
      if (what === 'send' && TYPES[d.type].death) { d.step = 'confirm'; return draftPanel(a); }
      if (what !== 'send' && what !== 'cancel') return;
      closeDraft(a);
      if (what === 'send') sendOffer(a, d);
    });
    onUi('duelDraftClose', (a) => closeDraft(a >>> 0));
    onUi('duelOffer', (t, args) => {
      const o = S.offers.get(t >>> 0);
      const raw = String((args || [])[0] || ''), cut = raw.indexOf('|');
      if (!o || cut < 0 || raw.slice(0, cut) !== o.nonce) return;
      const what = raw.slice(cut + 1);
      if (what === 'refuse') return answer(t >>> 0, false);
      // A death duel's accept shows the warning again; only its confirm agrees
      if (TYPES[o.type].death) {
        if (what === 'accept' && o.step === 'offer') { o.step = 'confirm'; return offerPanel(t >>> 0, o); }
        if (what !== 'confirm' || o.step !== 'confirm') return;
        o.agreedB = iso();
        return answer(t >>> 0, true);
      }
      if (what === 'accept') answer(t >>> 0, true);
    });
    onUi('duelOfferClose', (t) => { if (S.offers.has(t >>> 0)) answer(t >>> 0, false); });
  }

  // ---- the X menu --------------------------------------------------------------------------------------------------------
  globalThis.__dboDuelEntries = (a, t) => {
    if (!isPlayer(t)) return [];
    const d = duelOf(a);
    if (d) return other(d, a) === (t >>> 0) ? [{ id: 'duel:yield', label: isDeath(d) ? 'End the death duel (no winner)' : 'Yield the duel' }] : [];
    if (!C.enabled || duelOf(t)) return [];
    return [{ id: 'duel:challenge', label: 'Challenge to a Duel' }];
  };
  const yieldDuel = (a) => {
    const d = duelOf(a);
    if (!d) return personal(a, 'You are not in a duel.');
    if ((d.phase === 'pause' && d.winner) || d.phase === 'deathblow') return; // already decided, ending in a moment
    // Nobody yields their life: a death duel given up ends with no winner
    if (isDeath(d)) return finish(d, 0, `${display(a)} called it off`);
    award(d, other(d, a), `${display(a)} yielded`);
  };
  globalThis.__dboDuelAction = (a, id, t) => {
    if (id === 'duel:challenge') { openDraft(a >>> 0, t >>> 0); return true; }
    if (id === 'duel:yield') { yieldDuel(a >>> 0); return true; }
    return false;
  };

  // ---- the watch: phases, distance, leaving ------------------------------------------------------------------------------
  const leave = (a, why) => {
    a = a >>> 0;
    if (S.drafts.has(a)) S.drafts.delete(a);
    if (S.offers.has(a)) withdraw(a, why);
    const mine = offerFor(a); if (mine) withdraw(mine.t, why);
    const d = duelOf(a);
    if (!d) return;
    const y = other(d, a);
    if (C.disconnect === 'forfeit' && !isDeath(d)) award(d, y, `${display(a)} left`);
    else finish(d, 0, `${display(a)} left`);
  };
  const watch = () => {
    const now = Date.now();
    for (const [t, o] of [...S.offers]) {
      if (now > o.until) withdraw(t, 'timeout');
      else if (!online(o.from) || !online(t)) withdraw(t, 'gone');
    }
    for (const d of [...S.duels.values()]) {
      if (d.closed) continue;
      const gone = [d.a, d.b].find((x) => !online(x));
      if (gone) { leave(gone, 'gone'); continue; }
      const fallen = [d.a, d.b].find((x) => dead(x));
      if (fallen) { finish(d, 0, `${display(fallen)} fell`); continue; }
      const bound = [d.a, d.b].find((x) => restrained(x));
      if (bound) { finish(d, 0, `${display(bound)} was bound`); continue; }
      if (now - d.startedAt > C.maxMinutes * 60000) { finish(d, 0, 'time ran out'); continue; }
      if (isDeath(d) && !deathOn()) { finish(d, 0, 'death duels are switched off'); continue; }
      // Out of the ground for leaveSeconds forfeits; both out, no winner
      const outs = [d.a, d.b].map((x, i) => {
        if (gap(placeOf(x), d.anchor) <= C.arenaMeters * UNITS) { d.out[i] = 0; return false; }
        if (!d.out[i]) d.out[i] = now;
        return now - d.out[i] >= C.leaveSeconds * 1000;
      });
      if (outs[0] && outs[1]) { finish(d, 0, 'both left the ground'); continue; }
      if ((outs[0] || outs[1]) && isDeath(d)) { finish(d, 0, `${display(outs[0] ? d.a : d.b)} left the ground`); continue; }
      if (outs[0] || outs[1]) {
        const x = outs[0] ? d.a : d.b;
        award(d, other(d, x), `${display(x)} left the ground`);
        continue;
      }
      if (d.phase === 'deathblow') continue;
      if (!(RULES[d.rules] || {}).beasts && [d.a, d.b].some((x) => beast(x))) { const x = beast(d.a) ? d.a : d.b; if (d.phase !== 'pause') roundLost(d, x, 'took a beast form'); }
      if (d.phase === 'countdown' && now >= d.until) {
        d.phase = 'fight';
        for (const x of [d.a, d.b]) banner(x, 'Fight!', 2);
      } else if (d.phase === 'pause' && now >= d.until) {
        if (d.kneeling) stand(d.kneeling);
        if (d.winner) finish(d, d.winner, 'won');
        else startRound(d);
      }
    }
  };
  every('duels', 500, watch);
  // Wagers a restart or a failed payment left behind, for everyone online (a login settles its own at once)
  every('duelEscrow', 15000, () => { for (const a of onlineActors()) settleLeftover(a); });
  globalThis.__dboDuelLogin = (a) => settleLeftover(Number(a) >>> 0);
  globalThis.__dboDuelLeave = (a) => leave(Number(a) >>> 0, 'gone');

  // ---- /duel -------------------------------------------------------------------------------------------------------------
  registerChatCommand('duel', (a, args) => {
    const parts = String(args || '').trim().split(/\s+/).filter(Boolean);
    const sub = (parts[0] || '').toLowerCase();
    if (sub === 'yield') return yieldDuel(a);
    if (sub === 'stop') {
      if (!isAdmin(a)) return personal(a, 'Admins only.');
      const t = typeof findByName === 'function' ? findByName(parts.slice(1).join(' ')) : 0;
      const d = t ? duelOf(t) : null;
      if (!d) return personal(a, 'They are not in a duel.');
      finish(d, 0, `stopped by staff ${display(a)}`);
      return personal(a, `The duel of ${display(d.a)} and ${display(d.b)} is stopped; each wager goes back.`);
    }
    const d = duelOf(a);
    if (!d) return personal(a, 'You are not in a duel. Press X on another player and choose Challenge to a Duel.');
    personal(a, `Duel with ${nameTo(a, other(d, a))}: round ${d.round}, ${describe(d)}, you ${d.wins[idx(d, a)]} - ${d.wins[idx(d, other(d, a))]}. /duel yield to concede.`);
  }, { help: '[yield] your duel; challenge someone with X > Challenge to a Duel. Staff: /duel stop <name>' });

  // Wagers left by a restart, for whoever is online as this loads
  try { for (const a of onlineActors()) settleLeftover(a); } catch (e) { log(`duel: escrow sweep failed: ${e.message}`); }
};
