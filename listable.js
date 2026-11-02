// DragonBreak Online: who may be named in a list of the people near a player (fac-0553, 31 Oct: a menu listed everyone in
// the cell by name and #TAG, invisible GMs too). Each module that offers "pick someone beside you" (decor.js's people,
// jail.js's cell door, mines.js's foreman, spells.js's students, scribing.js's co-writers) filters its list through this.
//
// Hidden from a player's list, as the client hides them from a player's screen (formView adminViewOf):
//   - a staff member in Invisible or Ghost mode (the neighbour-visible ff_adminModes mirror: invis, ghost);
//   - a player under an Invisibility spell, potion or scroll (ff_spellInvis.on, spellinvis.js).
// Staff see them all, as their client draws them as ghosts. A viewer is staff when their own mirror carries a rank
// (AdminSystem writes it at each login and each toggle). The #TAG itself is public: the client draws it under every name.
//   const listable = require('./listable.js')(mp);  listable(viewer, other) -> true when other may be named to viewer
'use strict';

module.exports = (mp) => {
  const prop = (id, key) => { try { const v = mp.get(id >>> 0, key); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } };
  const isStaff = (id) => { const m = prop(id, 'ff_adminModes'); return !!m && Number(m.rank) > 0; };
  const hidden = (id) => {
    const m = prop(id, 'ff_adminModes');
    if (m && (m.invis === true || m.ghost === true)) return true;
    const s = prop(id, 'ff_spellInvis');
    return !!s && s.on === true;
  };
  return (viewer, other) => isStaff(viewer) || !hidden(other);
};
