// DragonBreak Online: Harmony and Mayhem, the two staff-granted blades (Nate, 11 Oct). Loaded by gamemode.js.
//
// An NPC hit by Harmony is calm for 20 s, one hit by Mayhem attacks anything near it for 20 s. Players are never touched
// (PvP is damage only) and dead targets are ignored. A new hit refreshes the 20 s, a hit from the other blade switches
// the mode. Papyrus calls from the server only reach player actors, so the NPC's AI is changed by the game of the player
// who hosts it: the server sends { customPacketType: 'dboNpcMood', refId, mode: 'calm' | 'frenzy', seconds } to
// mp.getHoster(target), and when the host changes before the time is up the new host is sent the time left
// (client npcMoodService.ts). Config "npcMood": { enabled (default true), seconds (20) }, read per hit.
'use strict';

const BLADES = { '1cd88:DragonBreak Hub.esp': 'calm', '1cd8a:DragonBreak Hub.esp': 'frenzy' };
const CHECK_MS = 1000;

module.exports = (api) => {
  const { mp, log, every, profileOf, userOf, sendPacket, cfg } = api;
  const conf = () => Object.assign({ enabled: true, seconds: 20 }, (cfg && cfg.npcMood) || {});
  // Kept across hot reloads: target -> { mode, until, host }
  const S = globalThis.__dboNpcMood || (globalThis.__dboNpcMood = { moods: new Map() });
  if (!(S.moods instanceof Map)) S.moods = new Map();

  // Resolved from the plugin name at runtime, so a load-order change never points them at another form
  let blades = null;
  const bladeMode = (src) => {
    if (!blades) {
      const m = new Map();
      for (const [desc, mode] of Object.entries(BLADES)) {
        try { const id = mp.getIdFromDesc(desc) >>> 0; if (id) m.set(id, mode); } catch (e) { log(`npcmood: ${desc} not in the load order`); }
      }
      blades = m;
    }
    return blades.get(src >>> 0) || '';
  };

  const isPlayer = (id) => profileOf(id) >= 0 || userOf(id) >= 0;
  const isDead = (id) => { try { return mp.get(id, 'isDead') === true; } catch (e) { return true; } };
  const hosterOf = (id) => { try { return Number(mp.getHoster(id)) >>> 0; } catch (e) { return 0; } };

  const send = (tgt, m, now) => {
    const host = hosterOf(tgt);
    m.host = host;
    if (!host) return false;
    const seconds = Math.max(0.1, Math.round((m.until - now) / 100) / 10);
    return sendPacket(host, { customPacketType: 'dboNpcMood', refId: tgt, mode: m.mode, seconds });
  };

  const onHit = (agg, tgt, src) => {
    const c = conf();
    if (c.enabled === false) return;
    tgt = Number(tgt) >>> 0;
    if (!tgt || tgt === (Number(agg) >>> 0)) return;
    const mode = bladeMode(Number(src) >>> 0);
    if (!mode || isPlayer(tgt) || isDead(tgt)) return;
    const now = Date.now();
    const m = { mode, until: now + (Number(c.seconds) > 0 ? Number(c.seconds) : 20) * 1000, host: 0 };
    S.moods.set(tgt, m);
    send(tgt, m, now);
  };

  // Expired and dead entries are dropped; an NPC that changed hands is sent the time left
  const check = () => {
    if (!S.moods.size) return;
    const now = Date.now();
    for (const [tgt, m] of S.moods) {
      if (now >= m.until || isDead(tgt)) { S.moods.delete(tgt); continue; }
      const host = hosterOf(tgt);
      if (host && host !== m.host) send(tgt, m, now);
      else if (!host) m.host = 0;
    }
  };

  globalThis.__dboNpcMoodHit = (agg, tgt, src) => { try { onHit(agg, tgt, src); } catch (e) { log('npcmood: hit failed', e.message); } };
  every('npcMood', CHECK_MS, () => { try { check(); } catch (e) { log('npcmood: check failed', e.message); } });
  return { onHit, check, state: S, bladeMode };
};
