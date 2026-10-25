// The Spider Imbuing Chamber is Dunmer only (Nat, 2026-10-25). Gated on the BASE, not a placement, so Tel Mithryn's
// own lever and every decor copy Worker 1 places are covered by the one rule.
//
// Why the activate and not the crafting: the chamber's menu is vanilla DLC2 Papyrus running on the player's own
// client, so the only moment the server sees is the activate. Refusing it means the menu never opens.
//
// Base and races are matched by DESC, never by a computed form id: a plugin inserted ahead of Dragonborn.esm or
// Skyrim.esm would shift every id (see memory load-order-shift-breaks-saved-ids), and the desc does not move.
module.exports = ({ mp, log, personal }) => {
  const CHAMBER = /^0*1705f:dragonborn\.esm$/;                    // ACTI DLC2ExpSpiderCraftingLever
  const DUNMER_DESCS = ['13742:Skyrim.esm', '8883d:Skyrim.esm'];  // DarkElfRace, DarkElfRaceVampire
  const REFUSED = 'The chamber does not stir for you. Only Dunmer hands can work it.';

  // Resolved once the plugins are readable and then kept; an empty answer is not cached, so a boot-order miss retries
  let dunmer = null;
  const dunmerRaces = () => {
    if (dunmer) return dunmer;
    const ids = new Set();
    for (const d of DUNMER_DESCS) {
      try { const id = mp.getIdFromDesc(d) >>> 0; if (id) ids.add(id); } catch (e) { /* not loaded yet */ }
    }
    if (ids.size === DUNMER_DESCS.length) dunmer = ids;
    return ids;
  };

  // A beast form rewrites appearance.raceId, so the character's own race comes from beastform.js when one is running
  const ownRace = (actorId) => {
    const a = Number(actorId) >>> 0;
    try {
      if (typeof globalThis.__dboBeastOriginalRace === 'function') {
        const original = Number(globalThis.__dboBeastOriginalRace(a)) >>> 0;
        if (original) return original;
      }
    } catch (e) { /* no beast module */ }
    try { const app = mp.get(a, 'appearance'); return app ? Number(app.raceId) >>> 0 : 0; } catch (e) { return 0; }
  };

  const mayImbue = (raceId) => dunmerRaces().has(Number(raceId) >>> 0);

  // gamemode.js rebuilds its activate chain on every reload before it loads this file, so this never stacks
  const inner = typeof mp.onActivate === 'function' ? mp.onActivate : null;
  mp.onActivate = function (targetId, casterId, ...rest) {
    try {
      const t = Number(targetId) >>> 0, a = Number(casterId) >>> 0;
      let desc = '';
      try { desc = String(mp.get(t, 'baseDesc') || '').toLowerCase(); } catch (e) { desc = ''; }
      if (desc && CHAMBER.test(desc) && Number(mp.get(a, 'profileId')) >= 0 && !mayImbue(ownRace(a))) {
        try { personal(a, REFUSED); } catch (e) { /* offline */ }
        log(`spidermancy: refused the chamber to ${a.toString(16)} (race ${ownRace(a).toString(16)})`);
        return false;
      }
    } catch (e) { log('spidermancy: the chamber gate failed, letting the activate through:', e.message); }
    return inner ? inner.call(this, targetId, casterId, ...rest) : undefined;
  };

  // For the harness and for anything else that needs the same answer
  globalThis.__dboSpidermancyMayImbue = mayImbue;
  globalThis.__dboSpidermancyOwnRace = ownRace;
  log(`spidermancy: chamber gate on, ${dunmerRaces().size} Dunmer race(s) allowed`);
};
