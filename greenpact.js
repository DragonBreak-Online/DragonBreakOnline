// DragonBreak Online: the Green Pact (Nate, 18 Oct: "yes to all, players need consent"). Loaded by gamemode.js after prayer.js.
//
// The Pact binds the Bosmer to Y'ffre: they may not harm the plants of the forest, they eat only meat, and they eat the
// enemies they slay (UESP Lore:Green Pact; the Meat Mandate). It holds for a wood elf sworn to the Green Pact: the faith
// stored on the character (prayer.js __dboFaithOf sworn), so nobody is bound by a faith they never chose. A wood elf whose
// god was taken before the faiths swears with /greenpact swear.
//
// The taboo: a sworn wood elf is refused at a chopping block (labour.js asks __dboGreenPactRefusal) and when picking a plant
// (FLOR or TREE that is not gold, a hive, a nest or a shell).
//
// The Partaking: E on the body of a humanoid, not undead, they or their party killed within partakeDays game days. A short
// kneeling feed (IdleCannibalFeedCrouching, as supernatural.js), then their hunger is full. Once per death; the next E searches
// the body as usual. A player's body only with that player's consent: they are asked, and answer /partake yes. Eating the
// dead is a crime in the Empire and in Skyrim: it goes into the audit, and anyone of the guard (private.dboLawful) within
// witnessMeters is told what they saw. /partake off turns E-to-eat off for oneself (searching instead), /partake on back.
'use strict';

module.exports = (api) => {
  const { mp, log, personal, audit, who, cfg, registerChatCommand, recordOf, nameOf, profileOf, onlineActors, distanceMeters,
    sendPacket, sate, isGoldFlora } = api;
  const C = Object.assign({ enabled: true, partakeDays: 3, feedSeconds: 8, reachMeters: 3, witnessMeters: 30, askSeconds: 60,
    feedAnim: 'IdleCannibalFeedCrouching', stopAnim: 'IdleForceDefaultState' }, cfg.greenPact || {});
  const PACT = 'greenpact';
  const WOOD_ELF = /^WoodElfRace(Vampire)?$/i;
  const KW_NPC = 0x13794, KW_UNDEAD = 0x13796; // ActorTypeNPC, ActorTypeUndead (Skyrim.esm KYWD, read 18 Oct)
  const NOT_PLANT = /hive|nest|clam|pearl|shell|coin|purse|pouch|egg|barrel|sack|crate|skull|bone|chest|mudcrab/i; // gold flora: isGoldFlora
  // Kept across hot reloads: who killed whom, the feeds running, the consent asked, who turned E-to-eat off
  const S = globalThis.__dboGreenPact || (globalThis.__dboGreenPact = { kills: new Map(), feeds: new Map(), asks: new Map() });

  const isPlayer = (a) => Number(profileOf(a)) > 0;
  const gameDays = () => {
    try { const c = globalThis.__dboClock; const d = c && typeof c.summary === 'function' ? Number(c.summary().gameDays) : NaN; if (Number.isFinite(d)) return d; } catch (e) { /* no clock */ }
    return Date.now() * 6 / 86400000;
  };
  const raceEdid = (a) => { try { const app = mp.get(a, 'appearance'); const r = app && recordOf(Number(app.raceId) >>> 0); return String((r && r.record.editorId) || ''); } catch (e) { return ''; } };
  const sworn = (a) => {
    if (!C.enabled || !isPlayer(a) || !WOOD_ELF.test(raceEdid(a))) return false;
    try { const f = typeof globalThis.__dboFaithOf === 'function' ? globalThis.__dboFaithOf(a) : null; return !!(f && f.sworn === PACT && f.faith === PACT); } catch (e) { return false; }
  };
  const leaderOf = (a) => { try { return typeof globalThis.__dboPartyLeaderOf === 'function' ? globalThis.__dboPartyLeaderOf(a) : null; } catch (e) { return null; } };

  // ---- the taboo ---------------------------------------------------------------------------------------------------
  const TABOO = {
    chop: 'You swore the Green Pact. Y\'ffre forbids you to cut wood; buy what you need from those who are not bound.',
    plant: 'You swore the Green Pact. Y\'ffre forbids you to harm a living plant; leave it to grow.',
  };
  globalThis.__dboGreenPactRefusal = (a, what) => (sworn(Number(a) >>> 0) ? TABOO[what] || '' : '');
  const baseOf = (t) => { try { return recordOf(mp.getIdFromDesc(String(mp.get(t, 'baseDesc'))) >>> 0); } catch (e) { return null; } };
  const isPlant = (t) => {
    const r = baseOf(t);
    const type = r ? String(r.record.type || '') : '';
    if (type !== 'FLOR' && type !== 'TREE') return false;
    if (NOT_PLANT.test(String(r.record.editorId || ''))) return false;
    try { if (isGoldFlora && isGoldFlora(t)) return false; } catch (e) { return false; }
    return true;
  };

  // ---- the kills ---------------------------------------------------------------------------------------------------
  globalThis.__dboGreenPactDeath = (victim, killer) => {
    victim = Number(victim) >>> 0; killer = Number(killer) >>> 0;
    try { mp.set(victim, 'private.dboPartaken', false); } catch (e) { /* not an actor */ }
    if (!killer || !isPlayer(killer)) { S.kills.delete(victim); return; }
    S.kills.set(victim, { killer: Number(profileOf(killer)), leader: leaderOf(killer), day: gameDays() });
    if (S.kills.size > 4096) { const old = gameDays() - C.partakeDays; for (const [k, v] of S.kills) if (v.day < old) S.kills.delete(k); }
  };
  const keywordsOf = (id) => {
    const r = recordOf(id); const out = [];
    for (const f of (r && r.record.fields) || []) {
      if (f.type !== 'KWDA' || !(f.data instanceof Uint8Array)) continue;
      const dv = new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength);
      for (let i = 0; i + 4 <= f.data.byteLength; i += 4) { const local = dv.getUint32(i, true); try { out.push(typeof r.toGlobalRecordId === 'function' ? r.toGlobalRecordId(local) >>> 0 : local); } catch (e) { out.push(local); } }
    }
    return out;
  };
  // A person: the race carries ActorTypeNPC and not ActorTypeUndead (no draugr, no vampire thralls of the dead)
  const isPersonBody = (t) => {
    const r = baseOf(t);
    if (!r || String(r.record.type) !== 'NPC_') return false;
    const rn = (r.record.fields || []).find((f) => f.type === 'RNAM' && f.data instanceof Uint8Array && f.data.byteLength >= 4);
    if (!rn) return false;
    let race = 0; try { const local = new DataView(rn.data.buffer, rn.data.byteOffset, 4).getUint32(0, true); race = typeof r.toGlobalRecordId === 'function' ? r.toGlobalRecordId(local) >>> 0 : local; } catch (e) { return false; }
    const kw = keywordsOf(race);
    return kw.includes(KW_NPC) && !kw.includes(KW_UNDEAD);
  };
  const killedByUs = (a, t) => {
    const k = S.kills.get(t);
    if (!k || gameDays() - k.day > C.partakeDays) return false;
    if (k.killer === Number(profileOf(a))) return true;
    const mine = leaderOf(a);
    return mine !== null && mine !== undefined && k.leader === mine;
  };
  const isDead = (t) => { try { return mp.get(t, 'isDead') === true; } catch (e) { return false; } };
  const partaken = (t) => { try { return mp.get(t, 'private.dboPartaken') === true; } catch (e) { return false; } };
  const eatOff = (a) => { try { return mp.get(a, 'private.dboPartakeOff') === true; } catch (e) { return false; } };

  // ---- the feed ----------------------------------------------------------------------------------------------------
  const playAnim = (a, ev) => { try { mp.callPapyrusFunction('global', 'Debug', 'SendAnimationEvent', null, [{ type: 'form', desc: mp.getDescFromId(a) }, ev]); } catch (e) { log(`greenpact: ${ev} failed: ${e.message}`); } };
  const bodyName = (t) => (isPlayer(t) ? nameOf(t) : 'the fallen');
  const witnesses = (a, t) => {
    const seen = [];
    for (const g of onlineActors()) {
      if (g === a || g === t) continue;
      let lawful = false; try { lawful = mp.get(g, 'private.dboLawful') === true; } catch (e) { lawful = false; }
      if (!lawful) continue;
      let d = Infinity; try { d = distanceMeters(g, a); } catch (e) { d = Infinity; }
      if (d > C.witnessMeters) continue;
      personal(g, `You see ${nameOf(a)} kneel over ${bodyName(t)} and eat of the body. Eating the dead is a crime in the Empire.`);
      seen.push(g);
    }
    return seen;
  };
  const startFeed = (a, t) => {
    if (S.feeds.has(a)) { personal(a, 'You are already partaking.'); return; }
    for (const f of S.feeds.values()) if (f.t === t) { personal(a, 'Someone is already at that body.'); return; }
    S.feeds.set(a, { t, until: Date.now() + C.feedSeconds * 1000 });
    playAnim(a, C.feedAnim);
    try { sendPacket(a, { customPacketType: 'dboBanner', text: 'Partaking...', seconds: Math.ceil(C.feedSeconds) }); } catch (e) { /* old client */ }
    if (isPlayer(t)) personal(t, `${nameOf(a)} kneels over your body, as the Green Pact asks.`);
    setTimeout(() => finishFeed(a), C.feedSeconds * 1000);
  };
  const finishFeed = (a) => {
    const f = S.feeds.get(a); if (!f) return;
    S.feeds.delete(a);
    const t = f.t;
    playAnim(a, C.stopAnim);
    let near = false; try { near = distanceMeters(a, t) <= C.reachMeters + 1; } catch (e) { near = false; }
    if (!onlineActors().includes(a) || !near || !isDead(t) || partaken(t)) { if (onlineActors().includes(a)) personal(a, 'You were pulled away before the rite was done.'); return; }
    try { mp.set(t, 'private.dboPartaken', true); } catch (e) { /* the flag is what stops a second feed */ }
    try { sate(a); } catch (e) { log('greenpact: sating failed', e.message); }
    personal(a, 'You keep the Meat Mandate. Your hunger is gone, and the Pact is kept.');
    const seen = witnesses(a, t);
    audit(`PARTAKE ${who(a)} ate of ${isPlayer(t) ? who(t) : `the body ${t.toString(16)}`} (Green Pact)${seen.length ? `; seen by ${seen.map(who).join(', ')}` : ''}`);
  };

  // A player's body: ask, and wait for /partake yes from them
  const ask = (a, t) => {
    const prev = S.asks.get(t);
    if (prev && prev.until > Date.now()) { personal(a, prev.a === a ? `You have asked. ${nameOf(t)} has not answered yet.` : `Someone else is asking ${nameOf(t)}.`); return; }
    S.asks.set(t, { a, until: Date.now() + C.askSeconds * 1000 });
    personal(t, `${nameOf(a)} of the Green Pact asks to eat of your body, as the Meat Mandate asks of them. Say /partake yes within ${C.askSeconds} seconds to allow it; say nothing to refuse.`);
    personal(a, `You ask ${nameOf(t)}. They have ${C.askSeconds} seconds to allow it.`);
    audit(`PARTAKE ${who(a)} asked ${who(t)} to eat of their body`);
  };

  // Called from the gamemode's activate chain; true means the activation was ours
  globalThis.__dboGreenPactActivate = (t, a) => {
    t = Number(t) >>> 0; a = Number(a) >>> 0;
    if (!C.enabled || !isPlayer(a) || t === a) return false;
    if (S.feeds.has(a) && S.feeds.get(a).t === t) return true;
    if (isDead(t)) {
      if (eatOff(a) || partaken(t) || !sworn(a)) return false;
      if (isPlayer(t)) { ask(a, t); return true; }
      if (!killedByUs(a, t) || !isPersonBody(t)) return false;
      startFeed(a, t);
      return true;
    }
    if (isPlant(t) && sworn(a)) { personal(a, TABOO.plant); return true; }
    return false;
  };

  registerChatCommand('partake', (a, argStr) => {
    a = Number(a) >>> 0;
    const arg = String(argStr || '').trim().toLowerCase();
    if (arg === 'yes') {
      for (const [t, q] of S.asks) {
        if (t !== a) continue;
        S.asks.delete(t);
        if (q.until < Date.now()) return personal(a, 'That moment has passed.');
        if (!onlineActors().includes(q.a) || !isDead(a)) return personal(a, 'That moment has passed.');
        let d = Infinity; try { d = distanceMeters(q.a, a); } catch (e) { d = Infinity; }
        if (d > C.reachMeters + 1) { personal(q.a, `${nameOf(a)} allowed it, but you are too far away now.`); return personal(a, 'They are too far away now.'); }
        personal(a, 'You allow it.');
        audit(`PARTAKE ${who(a)} allowed ${who(q.a)} to eat of their body`);
        return startFeed(q.a, a);
      }
      return personal(a, 'Nobody is asking you.');
    }
    if (arg === 'off' || arg === 'on') {
      try { mp.set(a, 'private.dboPartakeOff', arg === 'off'); } catch (e) { /* not saved */ }
      return personal(a, arg === 'off' ? 'E on the fallen searches them; you will not partake.' : 'E on the fallen you slew partakes of them, as the Pact asks.');
    }
    personal(a, sworn(a)
      ? `You are sworn to the Green Pact. E on a person you or your party slew in the last ${C.partakeDays} days partakes of them; a player only if they allow it. /partake off to search instead${eatOff(a) ? ' (it is off now: /partake on)' : ''}.`
      : 'Only a wood elf sworn to the Green Pact partakes of the fallen.');
  }, { help: 'the Green Pact\'s Meat Mandate: /partake yes to allow it on your body, /partake off|on' });

  registerChatCommand('greenpact', (a, argStr) => {
    a = Number(a) >>> 0;
    const arg = String(argStr || '').trim().toLowerCase();
    if (arg === 'swear') {
      if (!WOOD_ELF.test(raceEdid(a))) return personal(a, 'The Green Pact is the wood elves\' own covenant with Y\'ffre.');
      const why = typeof globalThis.__dboSwearFaith === 'function' ? globalThis.__dboSwearFaith(a, PACT) : 'The faiths are not running.';
      return personal(a, why || 'You swear the Green Pact before Y\'ffre. Harm no living plant; eat the enemies you slay.');
    }
    personal(a, sworn(a)
      ? 'You are sworn to the Green Pact: you may not cut wood or pick plants, and you may eat the people you slay (/partake).'
      : 'The Green Pact binds the wood elves to Y\'ffre: harm no living plant, eat only meat, eat the enemies you slay. A wood elf whose god is of the Pact swears with /greenpact swear; the Deity tab chooses the faith.');
  }, { help: 'the Green Pact: /greenpact swear (wood elves whose god is of the Pact)' });

  log(`greenpact ${C.enabled ? 'on' : 'off'}: partake within ${C.partakeDays} game days, ${C.feedSeconds} s feed, witnesses within ${C.witnessMeters} m`);
};
