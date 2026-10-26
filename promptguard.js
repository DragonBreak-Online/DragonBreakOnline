'use strict';
// Prompts that open unasked wait while a player is busy (Nat, 26 Oct: "Notifications like prompts like that shouldn't appear
// in dungeons because it disrupts people"). Loaded by gamemode.js; globalThis.__dboPromptBusy(a) answers why a player
// should not get an unasked menu now, or '':
//   'downed'      downed.js holds them down;
//   'fighting'    a blow given or taken in the last fightSeconds (gamemode.js __dboCombatAt);
//   'in a dungeon' standing in a dungeon's cell (dungeons.js __dboDungeonCells), lease or not.
// Who asks it: birthsigns.js (the forced picker waits), charlevel.js (the level-points menu does not open by itself),
// schools.js and spells.js and scribing.js (an apprenticeship, a /teach or a ledger lesson, a co-writing request is refused
// to the one offering, with the reason). Not the silver test (a hunter's challenge is meant to interrupt) nor a class's
// spell (the student signed up for it). Config "promptGuard": { enabled, fightSeconds }.

const DEFAULTS = { enabled: true, fightSeconds: 30 };

module.exports = ({ mp, cfg }) => {
  const C = Object.assign({}, DEFAULTS, (cfg && cfg.promptGuard) || {});
  const normDesc = (d) => { const s = String(d || ''); const i = s.indexOf(':'); if (i < 0) return s.toLowerCase(); const n = parseInt(s.slice(0, i), 16); return (Number.isFinite(n) ? n.toString(16) : s.slice(0, i).toLowerCase()) + ':' + s.slice(i + 1).toLowerCase(); };
  const busy = (a) => {
    if (C.enabled === false) return '';
    a = Number(a) >>> 0;
    try { if (typeof globalThis.__dboIsDowned === 'function' && globalThis.__dboIsDowned(a)) return 'downed'; } catch (e) { /* no downed.js */ }
    const fought = globalThis.__dboCombatAt instanceof Map ? Number(globalThis.__dboCombatAt.get(a)) || 0 : 0;
    if (fought > 0 && Date.now() - fought < Math.max(1, Number(C.fightSeconds) || 30) * 1000) return 'fighting';
    const cells = globalThis.__dboDungeonCells;
    if (cells instanceof Set) { try { if (cells.has(normDesc(mp.get(a, 'worldOrCellDesc')))) return 'in a dungeon'; } catch (e) { /* not an actor */ } }
    return '';
  };
  // The words for an offer refused because its target is busy
  const busyLine = (name, why) => `${name} ${why === 'downed' ? 'is down' : why === 'fighting' ? 'is in a fight' : 'is in a dungeon'}. Ask again when they are clear of it.`;
  globalThis.__dboPromptBusy = busy;
  globalThis.__dboPromptBusyLine = busyLine;
  return { busy, busyLine };
};
