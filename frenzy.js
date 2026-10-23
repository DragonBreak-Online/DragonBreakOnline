// DragonBreak Online: the werewolf frenzy (Nate, 23 Oct; config "werewolfFrenzy", OFF until an in-game test passes).
//
// A forced change (feral or the full moon, supernatural.js forcedChange) tips into a frenzy with chance `chance`: for
// minSeconds..maxSeconds the werewolf's own client turns AI-driven (client FrenzyService: Game.setPlayerAIDriven, its
// controls off) and fights the target this file picks: the nearest valid one within rangeMeters, the next one when it
// falls, flees out of range or the client cannot find it. Valid: living NPCs; players only with hitsPlayers, and never
// staff, a player in the character editor, being made, just logged in, in a duel, in a safeZones circle, already down,
// or (sparePartyMembers) the werewolf's party. Every blow goes through the normal hit checks. A player it brings down is
// killed (lethalToPlayers, Nate 23 Oct: "the ai control can kill players"): killDelaySeconds later an ordinary death,
// the temple and Death's Chill through downed.js, never a death duel's or a war's permadeath; permadeath true makes it
// one (supernatural.js permaKill). lethalToPlayers false leaves them down. Its blows on a fallen player do nothing.
// Ends: the time, no target left, the werewolf down, dead or out of the beast, the logout, a staff /frenzy end, or the
// client's own failsafe. Then exhaustedMinutes of slow stamina (exhaustedStaminaMult, through the needs system) and
// cooldownMinutes before the next. Each player the frenzied werewolf kills or downs puts a bounty on it: exposure.js
// decides when it is loaded (__dboExposureBounty), else bountyGold in the hold through outlaws.js (bountyFallback).
// Rollback: enabled false (hot reload); a running frenzy still ends on its own clock.
//   Server -> client: { customPacketType: 'dboFrenzy', on: true, target, seconds, disable } | { ..., on: false }
//   Client -> server: { customPacketType: 'dboFrenzyReport', phase: 'on' | 'miss' | 'off', target?, why? }
'use strict';

module.exports = (api) => {
  const { mp, log, personal, sendPacket, audit, who, display, profileOf, onlineActors, every, registerChatCommand, cfg,
    isAdmin, isLeadStaff, findByName, zoneOfActor, ownNameOf, inEditor, creationPending, inLoginGrace } = api;
  const C = Object.assign({
    enabled: false, chance: 0.3, minSeconds: 20, maxSeconds: 30, startDelaySeconds: 4, rangeMeters: 40,
    hitsPlayers: true, sparePartyMembers: true, cooldownMinutes: 30,
    lethalToPlayers: true, killDelaySeconds: 3, permadeath: false,
    exhaustedMinutes: 5, exhaustedStaminaMult: 0.3,
    bountyGold: 100, bountyFallback: true,
    // The client must answer within ackSeconds or the frenzy is dropped (an older client has no FrenzyService)
    ackSeconds: 5, resendSeconds: 5,
    // Game.DisablePlayerControls flags while frenzied: movement, fighting, camSwitch, looking, sneaking, menu, activate, journalTabs
    disable: [true, false, false, false, true, true, true, true],
    safeZones: [],
  }, cfg.werewolfFrenzy || {});

  const S = globalThis.__dboFrenzy = globalThis.__dboFrenzy || { active: new Map(), cooldown: new Map(), exhausted: new Map() };
  const UNITS_PER_METER = 70;
  const isPlayer = (x) => profileOf(x) >= 0;
  const online = (a) => { try { return onlineActors().map((x) => Number(x) >>> 0).includes(a >>> 0); } catch (e) { return false; } };
  const dead = (a) => { try { return mp.get(a, 'isDead') === true; } catch (e) { return true; } };
  const downed = (a) => { try { return typeof globalThis.__dboIsDowned === 'function' && !!globalThis.__dboIsDowned(a); } catch (e) { return false; } };
  const beastFormOf = (a) => { try { const b = mp.get(a, 'private.beast'); return b && b.form ? String(b.form) : null; } catch (e) { return null; } };
  const sideOf = (a) => { try { const o = Number(mp.get(a, 'ff_companionOf')) >>> 0; return o || a; } catch (e) { return a; } };
  const partyOf = (a) => { try { return typeof globalThis.__dboPartyLeaderOf === 'function' ? globalThis.__dboPartyLeaderOf(a) : null; } catch (e) { return null; } };
  const sameParty = (a, b) => { const p = partyOf(a); return p !== null && p !== undefined && p === partyOf(b); };
  const inDuel = (a) => { try { return typeof globalThis.__dboInDuel === 'function' && !!globalThis.__dboInDuel(a); } catch (e) { return false; } };
  const place = (a) => { try { return { world: String(mp.get(a, 'worldOrCellDesc') || ''), pos: mp.get(a, 'pos') }; } catch (e) { return null; } };
  const meters = (p, q) => (p && q && p.world === q.world && Array.isArray(p.pos) && Array.isArray(q.pos)
    ? Math.hypot(p.pos[0] - q.pos[0], p.pos[1] - q.pos[1], p.pos[2] - q.pos[2]) / UNITS_PER_METER : Infinity);
  const inSafeZone = (a) => {
    try { if (typeof globalThis.__dboSafeZone === 'function' && globalThis.__dboSafeZone(a)) return true; } catch (e) { /* none */ }
    const p = place(a); if (!p) return false;
    return (Array.isArray(C.safeZones) ? C.safeZones : []).some((z) => z && String(z.world) === p.world && Array.isArray(z.pos)
      && Number(z.radius) > 0 && Math.hypot(p.pos[0] - z.pos[0], p.pos[1] - z.pos[1], p.pos[2] - z.pos[2]) <= Number(z.radius));
  };
  const safe = (fn, a) => { try { return typeof fn === 'function' && !!fn(a); } catch (e) { return false; } };
  const pidOf = (a) => Number(profileOf(a));

  // Why a player may not be a frenzied werewolf's target, or '' when they may
  const playerExcluded = (w, t) => {
    if (!C.hitsPlayers) return 'players off';
    if (isAdmin(t)) return 'staff';
    if (safe(inEditor, t) || safe(creationPending, t)) return 'creation';
    if (safe(inLoginGrace, t)) return 'loading';
    if (inDuel(t)) return 'duel';
    if (inSafeZone(t)) return 'safe zone';
    if (C.sparePartyMembers && sameParty(w, t)) return 'party';
    return '';
  };
  // Whether x is a target for werewolf w now; p is w's place (read once per scan)
  const validTarget = (w, x, p = place(w), skip = null) => {
    x = Number(x) >>> 0;
    if (!x || x === w || (skip && skip.has(x))) return false;
    if (dead(x) || downed(x)) return false;
    if (meters(p, place(x)) > C.rangeMeters) return false;
    if (isPlayer(x)) return !playerExcluded(w, x) && online(x);
    const owner = sideOf(x);
    if (owner === w) return false;
    if (owner !== x && isPlayer(owner) && (isAdmin(owner) || (C.sparePartyMembers && sameParty(w, owner)))) return false;
    return true;
  };
  const pickTarget = (w, skip) => {
    const p = place(w); if (!p) return 0;
    const seen = new Set();
    let near = [];
    try { near = mp.get(w, 'actorNeighbors') || []; } catch (e) { near = []; }
    let best = 0, bestD = Infinity;
    for (const id of [...near, ...onlineActors()]) {
      const x = Number(id) >>> 0;
      if (seen.has(x)) continue; seen.add(x);
      if (!validTarget(w, x, p, skip)) continue;
      const d = meters(p, place(x));
      if (d < bestD) { bestD = d; best = x; }
    }
    return best;
  };

  const disableFlags = () => (Array.isArray(C.disable) && C.disable.length === 8 ? C.disable.map((v) => v === true) : [true, false, false, false, true, true, true, true]);
  const send = (w, f) => {
    f.sentAt = Date.now();
    sendPacket(w, { customPacketType: 'dboFrenzy', on: true, target: f.target, seconds: Math.max(1, Math.ceil((f.until - Date.now()) / 1000)), disable: disableFlags() });
  };
  const retarget = (w, f, why) => {
    const t = pickTarget(w, f.skip);
    if (!t) return end(w, 'no target left');
    if (t !== f.target) { f.target = t; f.targets.add(t); log(`frenzy: ${display(w)} turns on ${display(t)}${why ? ` (${why})` : ''}`); }
    send(w, f);
    return true;
  };

  const start = (w, by) => {
    w = Number(w) >>> 0;
    if (S.active.has(w)) return 'already in a frenzy';
    if (beastFormOf(w) !== 'werewolf') return 'not in beast form';
    if (dead(w) || downed(w)) return 'down or dead';
    const lo = Math.max(1, Number(C.minSeconds) || 20), hi = Math.max(lo, Number(C.maxSeconds) || lo);
    const secs = Math.round(lo + Math.random() * (hi - lo));
    const f = { at: Date.now(), until: Date.now() + secs * 1000, target: 0, skip: new Set(), targets: new Set(), acked: false, by: by || 'the beast', downed: new Map(), falls: 0 };
    const t = pickTarget(w, f.skip);
    if (!t) { log(`frenzy: ${display(w)} would frenzy but nothing is in reach`); return 'nothing in reach'; }
    f.target = t; f.targets.add(t);
    S.active.set(w, f);
    S.cooldown.set(pidOf(w), Date.now() + Math.max(0, Number(C.cooldownMinutes) || 0) * 60000);
    send(w, f);
    const text = 'The beast\'s hunger swallows you whole. You are no longer in command of your body.';
    sendPacket(w, { customPacketType: 'dboBanner', text, seconds: 4 });
    personal(w, text);
    audit(`FRENZY ${who(w)} for ${secs} s, first on ${who(t)} (${f.by})`);
    return '';
  };
  const end = (w, why) => {
    w = Number(w) >>> 0;
    const f = S.active.get(w); if (!f) return false;
    S.active.delete(w);
    try { sendPacket(w, { customPacketType: 'dboFrenzy', on: false }); } catch (e) { /* offline */ }
    const real = f.acked && why !== 'logout';
    if (real) {
      S.exhausted.set(w, Date.now() + Math.max(0, Number(C.exhaustedMinutes) || 0) * 60000);
      try { if (typeof globalThis.__dboNeedsRefresh === 'function') globalThis.__dboNeedsRefresh(w); } catch (e) { /* no needs */ }
      personal(w, 'The frenzy drains out of you. Your limbs are heavy, and your breath will be slow to come back.');
    }
    audit(`FRENZY end ${who(w)}: ${why} after ${Math.round((Date.now() - f.at) / 1000)} s, ${f.targets.size} target(s), ${f.falls} player(s) brought down`);
    return true;
  };

  // supernatural.js: a forced change just took this werewolf
  globalThis.__dboFrenzyForced = (a) => {
    a = Number(a) >>> 0;
    if (C.enabled !== true || !isPlayer(a)) return false;
    const cd = S.cooldown.get(pidOf(a)) || 0;
    if (Date.now() < cd) { log(`frenzy: ${display(a)} is on cooldown (${Math.ceil((cd - Date.now()) / 1000)} s)`); return false; }
    if (Math.random() >= Number(C.chance)) return false;
    setTimeout(() => {
      try { const why = start(a, 'a forced change'); if (why) log(`frenzy: ${display(a)} did not frenzy: ${why}`); } catch (e) { log('frenzy: start failed', e.message); }
    }, Math.max(0, Number(C.startDelaySeconds) || 0) * 1000);
    return true;
  };
  globalThis.__dboFrenzyActive = (a) => S.active.has(Number(a) >>> 0);
  globalThis.__dboFrenzyEnd = (a, why) => end(a, why || 'ended');
  globalThis.__dboFrenzyLeave = (a) => { end(a, 'logout'); S.exhausted.delete(Number(a) >>> 0); };
  // gamemode applyNeedsStage multiplies stamina recovery by this after a frenzy
  globalThis.__dboFrenzyRateMult = (a, av) => {
    if (av !== 'StaminaRateMult') return 1;
    const u = S.exhausted.get(Number(a) >>> 0);
    if (!u) return 1;
    if (Date.now() >= u) return 1;
    const m = Number(C.exhaustedStaminaMult);
    return m >= 0 && m <= 1 ? m : 1;
  };
  // client FrenzyService's answers
  globalThis.__dboFrenzyReport = (a, content) => {
    a = Number(a) >>> 0;
    const f = S.active.get(a); if (!f || !content) return;
    const phase = String(content.phase || '');
    if (phase === 'on') { if (!f.acked) { f.acked = true; log(`frenzy: ${display(a)}'s client took control`); } return; }
    if (phase === 'miss') {
      const t = Number(content.target) >>> 0;
      if (t && t === f.target) { f.skip.add(t); retarget(a, f, 'the client could not find the last one'); }
      return;
    }
    if (phase === 'off') { const why = String(content.why || ''); end(a, `client: ${['failsafe', 'dead'].includes(why) ? why : 'released'}`); }
  };

  every('frenzyTick', 1000, () => {
    const now = Date.now();
    for (const [w, u] of S.exhausted) if (now >= u) { S.exhausted.delete(w); try { if (typeof globalThis.__dboNeedsRefresh === 'function') globalThis.__dboNeedsRefresh(w); } catch (e) { /* no needs */ } }
    for (const [w, f] of [...S.active]) {
      if (!online(w)) { end(w, 'logout'); continue; }
      if (dead(w) || downed(w)) { end(w, 'the werewolf fell'); continue; }
      if (beastFormOf(w) !== 'werewolf') { end(w, 'out of the beast'); continue; }
      if (now >= f.until) { end(w, 'time'); continue; }
      if (!f.acked && now - f.at > Math.max(1, Number(C.ackSeconds) || 5) * 1000) { end(w, 'the client never answered'); continue; }
      if (!validTarget(w, f.target)) { retarget(w, f, 'the last one is gone'); continue; }
      if (now - (f.sentAt || 0) >= Math.max(1, Number(C.resendSeconds) || 5) * 1000) send(w, f);
    }
  });

  // ---- hits: a frenzied werewolf never finishes a player, and spares those it may not target -----------------------
  {
    const inner = mp.onHitDamageAttempt;
    if (typeof inner === 'function') {
      const frenzyAttempt = function (aggressorId, targetId, ...rest) {
        if (!S.active.size) return inner.call(this, aggressorId, targetId, ...rest);
        const w = sideOf(Number(aggressorId) >>> 0), t = Number(targetId) >>> 0;
        if (S.active.has(w) && w !== t && isPlayer(t)) {
          if (dead(t) || downed(t)) { globalThis.__dboHitRefusal = 'frenzy_downed'; return false; }
          if (playerExcluded(w, t)) { globalThis.__dboHitRefusal = 'frenzy_spared'; return false; }
        }
        return inner.call(this, aggressorId, targetId, ...rest);
      };
      frenzyAttempt.__dboFrenzy = true;
      mp.onHitDamageAttempt = frenzyAttempt;
    }
  }
  // ---- a player the frenzied werewolf downs puts a bounty on it ------------------------------------------------------
  const bounty = (w, victim) => {
    const reason = C.lethalToPlayers === false ? 'downed someone in a werewolf frenzy' : 'killed someone in a werewolf frenzy';
    if (typeof globalThis.__dboExposureBounty === 'function') {
      let set = false; try { set = !!globalThis.__dboExposureBounty(w, victim, reason); } catch (e) { log('frenzy: exposure bounty failed', e.message); }
      if (set) audit(`FRENZY bounty: ${who(w)} for bringing down ${who(victim)} (exposure.js)`);
      return set;
    }
    if (!C.bountyFallback || typeof globalThis.__dboOutlawDeclare !== 'function') return false;
    const zid = zoneOfActor(w); const pid = pidOf(w);
    if (!zid || !(pid >= 0)) return false;
    let had = 0; try { const o = globalThis.__dboOutlaws; const b = o && o.data && o.data.zones && o.data.zones[zid] && o.data.zones[zid][String(pid)]; had = b ? Math.floor(Number(b.amount) || 0) : 0; } catch (e) { had = 0; }
    let name = ''; try { name = typeof ownNameOf === 'function' ? ownNameOf(w) : display(w); } catch (e) { name = display(w); }
    let set = false; try { set = !!globalThis.__dboOutlawDeclare(zid, pid, had + Math.max(1, Math.floor(Number(C.bountyGold) || 0)), reason, name, 'the hold'); } catch (e) { log('frenzy: bounty failed', e.message); }
    if (set) audit(`FRENZY bounty: ${who(w)} for bringing down ${who(victim)} in ${zid} (outlaws.js)`);
    return set;
  };
  // The frenzy's kill: an ordinary death unless permadeath says so, and only if they are still down (not raised meanwhile)
  const kill = (w, x) => {
    if (!downed(x) && !dead(x)) return false;
    if (C.permadeath === true && typeof globalThis.__dboPermaKill === 'function') {
      audit(`FRENZY permadeath: ${who(x)} killed by ${who(w)}`);
      globalThis.__dboPermaKill(x, 'killed in a werewolf frenzy');
      return true;
    }
    const k = globalThis.__dboDownedKill;
    if (typeof k !== 'function') return false;
    const done = !!k(x, w, 'werewolf frenzy');
    if (done) log(`frenzy: ${display(w)} killed ${display(x)}`);
    return done;
  };
  const killLater = (w, x) => {
    const ms = Math.max(0, Number(C.killDelaySeconds) || 0) * 1000;
    if (!ms) return kill(w, x);
    setTimeout(() => { try { kill(w, x); } catch (e) { log('frenzy: kill failed', e.message); } }, ms);
    return true;
  };
  {
    const inner = mp.onDeath;
    if (typeof inner === 'function') {
      const frenzyDeath = function (actorId, killerId, ...rest) {
        const out = inner.call(this, actorId, killerId, ...rest);
        try {
          const x = Number(actorId) >>> 0, w = sideOf(Number(killerId) >>> 0), f = S.active.get(w);
          // one bounty per fall: the same death reported twice within 10 s counts once
          if (f && w !== x && isPlayer(x) && Date.now() - (f.downed.get(x) || 0) > 10000) {
            f.downed.set(x, Date.now()); f.falls++;
            bounty(w, x);
            if (C.lethalToPlayers !== false) killLater(w, x);
          }
          if (S.active.has(x)) end(x, 'the werewolf fell');
        } catch (e) { log('frenzy: death hook failed', e.message); }
        return out;
      };
      frenzyDeath.__dboFrenzy = true;
      mp.onDeath = frenzyDeath;
    }
  }

  // ---- staff: /frenzy <player|me> start|end|status --------------------------------------------------------------------
  registerChatCommand('frenzy', (a, args) => {
    if (!isLeadStaff(a)) return personal(a, 'Only lead staff can do that.');
    const [name, what] = String(args || '').trim().split(/\s+/);
    const t = !name || name === 'me' ? a : findByName(name);
    if (!t) return personal(a, 'Usage: /frenzy <player|me> start|end|status');
    const w = String(what || 'status').toLowerCase();
    if (w === 'start') { const why = start(t, `GM ${display(a)}`); return personal(a, why ? `No frenzy: ${why}.` : `${display(t)} is in a frenzy.`); }
    if (w === 'end') { const ok = end(t, `staff ${display(a)}`); return personal(a, ok ? `${display(t)}'s frenzy is over.` : `${display(t)} is not in a frenzy.`); }
    const f = S.active.get(Number(t) >>> 0), cd = S.cooldown.get(pidOf(t)) || 0, ex = S.exhausted.get(Number(t) >>> 0) || 0;
    return personal(a, `${display(t)}: ${f ? `frenzied, ${Math.ceil((f.until - Date.now()) / 1000)} s left, on ${display(f.target)}, client ${f.acked ? 'answered' : 'silent'}` : 'not frenzied'}`
      + `${cd > Date.now() ? `, cooldown ${Math.ceil((cd - Date.now()) / 60000)} min` : ''}${ex > Date.now() ? `, exhausted ${Math.ceil((ex - Date.now()) / 60000)} min` : ''}. Auto frenzy ${C.enabled === true ? 'ON' : 'off'}.`);
  }, { admin: true, help: '<player|me> start|end|status: a werewolf frenzy (lead staff)' });

  log(`frenzy ${C.enabled === true ? 'ON' : 'off'}: chance ${C.chance} per forced change, ${C.minSeconds}-${C.maxSeconds} s, range ${C.rangeMeters} m, players ${!C.hitsPlayers ? 'spared' : C.lethalToPlayers === false ? 'downed' : C.permadeath === true ? 'killed for good' : 'killed (ordinary death)'}, party ${C.sparePartyMembers ? 'spared' : 'fair game'}, cooldown ${C.cooldownMinutes} min, exhausted ${C.exhaustedMinutes} min x${C.exhaustedStaminaMult} stamina`);
};
