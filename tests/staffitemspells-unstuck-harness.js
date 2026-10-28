// staffitemspells.js must leave /unstuck to gamemode.js, so a player keeps their own /unstuck
const path = require('path');
const names = [];
const noop = () => {};
require(path.resolve(__dirname, '..', 'staffitemspells.js'))({
  mp: { get: noop, set: noop }, log: noop, personal: noop, audit: noop, who: String, display: String, nameOf: String,
  tagOf: String, profileOf: noop, onlineActors: () => [], isLeadStaff: () => false, isAdmin: () => false,
  giveItem: noop, registerChatCommand: (n) => names.push(n), officialTarget: noop
});
let fail = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) fail++; };
check(!names.includes('unstuck'), 'staffitemspells does not register /unstuck');
for (const n of ['giveitem', 'takeitem', 'givespell', 'removespell']) check(names.includes(n), `staffitemspells registers /${n}`);
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
