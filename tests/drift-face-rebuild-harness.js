// Scripted test for gamemode.js's client drift switches, the faceRebuild quick undo (client 0.3.96 driftConfig.ts): every
// npcDriftConfig carries faceRebuild, "load" by default or gamemode-config.json drift.faceRebuild, and /driftset faceRebuild
// switches it for everyone online ("entry" is the per-entry rebuild of 0.3.95; anything else is refused). It cuts the
// block from DRIFT_REPAIRS to the end of /driftset out of the gamemode and runs it with stubs. Run from this folder's parent:
//   node tests/drift-face-rebuild-harness.js
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
const check = (label, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!ok) failures++; };

const load = (cfg) => {
  const sent = [], told = [], cmds = new Map();
  const g = {};
  const run = new Function('cfg', 'globalThis', 'sendPacket', 'registerChatCommand', 'personal', 'audit', 'who', 'onlineActors',
    block + '\nreturn sendDriftConfig;');
  const sendDriftConfig = run(cfg, g, (a, p) => sent.push([a, p]), (n, f) => cmds.set(n, f), (a, t) => told.push(t), () => { }, (a) => String(a), () => [1, 2]);
  return { sent, told, cmds, sendDriftConfig };
};

let t = load({});
t.sendDriftConfig(1);
check('npcDriftConfig carries faceRebuild "load" by default', t.sent[0][1].customPacketType === 'npcDriftConfig' && t.sent[0][1].faceRebuild === 'load', t.sent[0][1]);
t.cmds.get('driftset')(1, 'faceRebuild entry');
check('/driftset faceRebuild entry sends "entry" to everyone online', t.sent.length === 3 && t.sent.slice(1).every((s) => s[1].faceRebuild === 'entry') && t.sent[1][0] === 1 && t.sent[2][0] === 2, t.sent.slice(1).map((s) => [s[0], s[1].faceRebuild]));
t.cmds.get('driftset')(1, 'faceRebuild always');
check('an unknown value is refused and nothing is sent', t.sent.length === 3 && /cannot be "always"/.test(t.told.slice(-1)[0]), t.told.slice(-1));
t.cmds.get('driftset')(1, 'faceRebuild default');
check('/driftset faceRebuild default goes back to "load"', t.sent.slice(-1)[0][1].faceRebuild === 'load');
t = load({ drift: { faceRebuild: 'entry' } });
t.sendDriftConfig(1);
check('gamemode-config.json drift.faceRebuild "entry" is the default', t.sent[0][1].faceRebuild === 'entry');
t = load({ drift: { faceRebuild: 'bogus' } });
t.sendDriftConfig(1);
check('...and a bad config value falls back to "load"', t.sent[0][1].faceRebuild === 'load');
t = load(undefined);
t.sendDriftConfig(1);
check('no config at all is "load"', t.sent[0][1].faceRebuild === 'load');

console.log(failures ? `${failures} FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
