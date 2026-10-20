// DragonBreak Online: what a spell's element does besides damage (Nate, 15 Oct, after a player's report: "It causes
// frost damage however, the slow doesn't seem to be working"). Loaded by gamemode.js like npcmood.js.
//
// The server decides every hit and applies it as damage, so a spell's other effects - the cold that slows, the shock
// that drains - never reached anyone: nothing was cast on the victim, so the engine had nothing to run. This module
// gives them back, from the server's side, for the elements config names.
//
// Frost today: a player struck by a frost source is slowed for a few seconds. The element of a hit is the game's own
// answer - the MGEF DATA resist value of an effect of the spell, enchantment or scroll (41 fire, 42 shock, 43 frost),
// which gamemode.js already reads for the blessings (fitsElement).
//
// A PLAYER is slowed through { customPacketType: 'dboStatus', kind: 'chill', seconds, speedMult, text }, the packet the
// armour swap and the werewolf's howl already use (client ParalysisService), so this needs no client update.
// An NPC CANNOT be: Papyrus from the server reaches player actors only, and the server is a relay for movement, so a
// slowed enemy has to be slowed by the game of the player hosting it, the way npcmood.js calms and frenzies one
// (dboNpcMood -> client npcMoodService). That half waits on a client that carries it; until then npc.enabled is false
// and only players feel the cold.
//
// Config "elements" in gamemode-config.json, read per hit (hot reload):
//   { enabled, minGapMs, frost: { player: { enabled, speedMult, seconds, text }, npc: { enabled, speedMult, seconds } } }
// speedMult is what the victim's SpeedMult changes by while it lasts (negative; the client clamps it to -90), seconds how
// long. minGapMs is the least time between two packets to the same victim, so a fast caster does not send one a frame.
// ROLLBACK: enabled false (hot reload). Nothing is kept on a character: a slow ends on its own, and on a relog.
'use strict';

const DEFAULTS = {
  enabled: true,
  minGapMs: 1500,
  frost: {
    player: { enabled: true, speedMult: -40, seconds: 6, text: 'The cold bites deep. You are slowed.' },
    npc: { enabled: false, speedMult: -40, seconds: 6 },
  },
};

// Pure: the config for one element, with the defaults under it
const elementConf = (C, element) => {
  const base = DEFAULTS[element] || {};
  const given = (C && C[element]) || {};
  return {
    player: Object.assign({}, base.player || {}, given.player || {}),
    npc: Object.assign({}, base.npc || {}, given.npc || {}),
  };
};
// Pure: a slow the client will take (it clamps to -90..0 and 0..60 s), or null when the config asks for nothing
const slowOf = (conf) => {
  if (!conf || conf.enabled === false) return null;
  const speedMult = Math.max(-90, Math.min(0, Math.round(Number(conf.speedMult) || 0)));
  const seconds = Math.max(1, Math.min(60, Math.round(Number(conf.seconds) || 0)));
  return speedMult < 0 ? { speedMult, seconds } : null;
};

module.exports = (api) => {
  const { mp, log, profileOf, userOf, sendPacket, cfg, fitsElement, display } = api;
  const conf = () => Object.assign({}, DEFAULTS, (cfg && cfg.elements) || {});
  // Kept across hot reloads: victim -> ms of the last packet, so a reload never floods anyone
  const S = globalThis.__dboElements || (globalThis.__dboElements = { sentAt: new Map() });
  if (!(S.sentAt instanceof Map)) S.sentAt = new Map();

  const isPlayer = (id) => profileOf(id) >= 0 || userOf(id) >= 0;
  const isDead = (id) => { try { return mp.get(id, 'isDead') === true; } catch (e) { return true; } };
  const hosterOf = (id) => { try { return Number(mp.getHoster(id)) >>> 0; } catch (e) { return 0; } };

  // The element of this hit's source, or '' (the first the source carries; a spell is one element in practice)
  const elementOf = (src) => {
    if (typeof fitsElement !== 'function') return '';
    for (const element of ['frost', 'fire', 'shock']) {
      try { if (fitsElement(element, src >>> 0)) return element; } catch (e) { /* not a source with effects */ }
    }
    return '';
  };

  const tooSoon = (tgt, now, gap) => {
    const last = S.sentAt.get(tgt >>> 0) || 0;
    if (now - last < gap) return true;
    S.sentAt.set(tgt >>> 0, now);
    return false;
  };

  const onHit = (agg, tgt, src, now = Date.now()) => {
    const C = conf();
    if (C.enabled === false || !src || typeof sendPacket !== 'function') return;
    if (tgt === agg || isDead(tgt)) return;
    const element = elementOf(src);
    if (!element) return;
    const E = elementConf(C, element);
    const player = isPlayer(tgt);
    const slow = slowOf(player ? E.player : E.npc);
    if (!slow) return;
    if (tooSoon(tgt, now, Math.max(0, Number(C.minGapMs) || 0))) return;
    if (player) {
      const text = String((E.player || {}).text || '');
      try { sendPacket(tgt >>> 0, { customPacketType: 'dboStatus', kind: 'chill', seconds: slow.seconds, speedMult: slow.speedMult, text }); }
      catch (e) { /* offline */ }
      return;
    }
    // An NPC: its host's game has to do it. Nothing is sent until a client carries the packet (npc.enabled)
    const host = hosterOf(tgt);
    if (!host || !isPlayer(host)) return;
    try { sendPacket(host, { customPacketType: 'dboNpcChill', refId: tgt >>> 0, seconds: slow.seconds, speedMult: slow.speedMult }); }
    catch (e) { /* offline */ }
  };

  globalThis.__dboElementHit = (agg, tgt, src) => {
    try { onHit(Number(agg) >>> 0, Number(tgt) >>> 0, Number(src) >>> 0); } catch (e) { log('elements: hit failed', e.message); }
  };
  // For the harness
  globalThis.__dboElementsTest = { elementConf, slowOf, onHit, elementOf };
  log(`elements: on (frost slows players ${slowOf(elementConf(conf(), 'frost').player) ? 'yes' : 'no'}, NPCs ${slowOf(elementConf(conf(), 'frost').npc) ? 'yes' : 'no'})`);
  return { onHit, elementOf };
};
module.exports.elementConf = elementConf;
module.exports.slowOf = slowOf;
module.exports.DEFAULTS = DEFAULTS;
