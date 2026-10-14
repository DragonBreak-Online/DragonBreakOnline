// Scripted test for gamemode.js's ownLook drift switch (client 0.3.97 sync/ownLook.ts, claude-jake 17d1d719): every
// npcDriftConfig carries ownLook, "apply" by default or gamemode-config.json drift.ownLook, and /driftset ownLook switches it
// for everyone online ("name" puts on only a changed name, "off" no look; anything else is refused). Cuts the drift block
// out of the gamemode as tests/drift-face-rebuild-harness.js does.
//   node tests/drift-own-look-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const start = src.indexOf("const DRIFT_REPAIRS = ");
const endMark = "}, { admin: true, help: '<key> <value|default> a client drift switch; no key lists them' });";
const end = src.indexOf(endMark, start);
if (start < 0 || end < 0) { console.log('FAIL the drift switch markers are gone from gamemode.js'); process.exit(1); }
const block = src.slice(start, end + endMark.length);
let failures = 0;
const check = (label, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!ok) failures++; };
const load = (cfg) => {
  const sent = [], told = [], cmds = new Map();
  const run = new Function('cfg', 'globalThis', 'sendPacket', 'registerChatCommand', 'personal', 'audit', 'who', 'onlineActors', block + '\nreturn sendDriftConfig;');
  const sendDriftConfig = run(cfg, {}, (a, p) => sent.push([a, p]), (n, f) => cmds.set(n, f), (a, t) => told.push(t), () => { }, (a) => String(a), () => [1, 2]);
  return { sent, told, cmds, sendDriftConfig };
};
let t = load({});
t.sendDriftConfig(1);
check('npcDriftConfig carries ownLook "apply" by default', t.sent[0][1].ownLook === 'apply', t.sent[0][1]);
t.cmds.get('driftset')(1, 'ownLook off');
check('/driftset ownLook off sends "off" to everyone online', t.sent.length === 3 && t.sent.slice(1).every((s) => s[1].ownLook === 'off'), t.sent.slice(1));
t.cmds.get('driftset')(1, 'ownLook name');
check('"name" is accepted', t.sent.slice(-1)[0][1].ownLook === 'name');
const n = t.sent.length;
t.cmds.get('driftset')(1, 'ownLook sometimes');
check('anything else is refused and nothing is sent', t.sent.length === n && /cannot be "sometimes"/.test(t.told.slice(-1)[0]), t.told.slice(-1));
t.cmds.get('driftset')(1, 'ownLook default');
check('/driftset ownLook default goes back to "apply"', t.sent.slice(-1)[0][1].ownLook === 'apply');
t = load({ drift: { ownLook: 'name' } }); t.sendDriftConfig(1);
check('gamemode-config.json drift.ownLook "name" is the default', t.sent[0][1].ownLook === 'name');
t = load({ drift: { ownLook: 'bogus' } }); t.sendDriftConfig(1);
check('a bad config value falls back to "apply"', t.sent[0][1].ownLook === 'apply');
console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);
