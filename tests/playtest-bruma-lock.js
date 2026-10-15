// Not a harness (run-all runs *-harness.js only): the Bruma-only region lock as it shipped until the Skyrim release
// (origin/server 38ed04dc), for the harnesses that test the lock itself. The shipped config now opens Skyrim with
// closedPlugins; this rebuilds the old block on a copy of it, so border, arrival and allowedCells stay the real ones.
'use strict';
module.exports = (shipped) => {
  const cfg = JSON.parse(JSON.stringify(shipped));
  const p = cfg.playtest;
  Object.assign(p, { enabled: true, name: 'Bruma', closedPlugins: [], gatesToArrival: true,
    allowedWorlds: ['a764b:BSHeartland.esm', '6ade1:BSHeartland.esm', '7f126:BSHeartland.esm', 'b95a6:BSHeartland.esm'],
    blockedDoors: ['877c2:BSHeartland.esm', '656df:BSHeartland.esm'] });
  delete p.autoDoors; delete p.closedMessage; delete p.askCyrodiil;
  return cfg;
};
