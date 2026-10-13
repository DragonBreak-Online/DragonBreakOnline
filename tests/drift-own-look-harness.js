// Scripted test for gamemode.js's client drift switch ownLook, the quick undo for the player's own look (client
// fix/tick-context-1013 sync/ownLook.ts, driftConfig.ts): every npcDriftConfig carries ownLook, "apply" by default or
// gamemode-config.json drift.ownLook, /driftset ownLook switches it for everyone online, and a hot reload that changes what
// a client is sent sends it to everyone online at once ("name" puts only a name on, "off" no own look; anything else is
// refused). It cuts the block from DRIFT_REPAIRS to the end of /driftset out of the gamemode and runs it with stubs, a
// reload being the same block run again on the same globalThis. Run from this folder's parent:
//   node tests/drift-own-look-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'gamemode.js'), 'utf8');
const start = src.indexOf("const DRIFT_REPAIRS = ");
const endMark = "}, { admin: true, help: '<key> <value|default> a client drift switch; no key lists them' });";
const end = src.indexOf(endMark, start);
if (start < 0 || end < 0) { console.log('FAIL the drift switch markers are gone from gamemode.js'); process.exit(1); }
const block = src.slice(start, end + endMark.length);

let failures = 0;
const check = (label, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!ok) failures++; };

// One load of the gamemode: g is globalThis, kept across a hot reload; players 1 and 2 are online
const load = (cfg, g = {}) => {
  const sent = [], told = [], logs = [], cmds = new Map();
  const run = new Function('cfg', 'globalThis', 'sendPacket', 'registerChatCommand', 'personal', 'audit', 'who', 'onlineActors', 'log',
    block + '\nreturn sendDriftConfig;');
  const sendDriftConfig = run(cfg, g, (a, p) => sent.push([a, p]), (n, f) => cmds.set(n, f), (a, t) => told.push(t), () => { }, (a) => String(a),
    () => [1, 2], (...a) => logs.push(a.join(' ')));
  return { g, sent, told, logs, cmds, sendDriftConfig };
};
const own = (s) => s.map((x) => [x[0], x[1].ownLook]);

let t = load({});
t.sendDriftConfig(1);
check('npcDriftConfig carries ownLook "apply" by default (the fix on)', t.sent[0][1].customPacketType === 'npcDriftConfig' && t.sent[0][1].ownLook === 'apply', t.sent[0][1]);
check('...beside faceRebuild "load" and the other switches', t.sent[0][1].faceRebuild === 'load' && t.sent[0][1].rehostAfterMs === 2100);
t.cmds.get('driftset')(1, 'ownLook off');
check('/driftset ownLook off sends "off" to everyone online', t.sent.length === 3 && t.sent.slice(1).every((s) => s[1].ownLook === 'off')
  && t.sent[1][0] === 1 && t.sent[2][0] === 2, own(t.sent.slice(1)));
t.cmds.get('driftset')(1, 'ownLook name');
check('/driftset ownLook name sends "name" to everyone online', t.sent.length === 5 && t.sent.slice(3).every((s) => s[1].ownLook === 'name'), own(t.sent.slice(3)));
for (const bad of ['never', 'true', '1', 'Apply']) {
  t.cmds.get('driftset')(1, `ownLook ${bad}`);
  check(`/driftset ownLook ${bad} is refused and nothing is sent`, t.sent.length === 5 && new RegExp(`cannot be "${bad}"`).test(t.told.slice(-1)[0]), t.told.slice(-1));
}
t.cmds.get('driftset')(1, 'ownLook default');
check('/driftset ownLook default goes back to "apply"', t.sent.length === 7 && t.sent.slice(-1)[0][1].ownLook === 'apply');
t.cmds.get('driftset')(1, '');
check('/driftset with no key lists ownLook', /ownLook=apply/.test(t.told.slice(-1)[0]), t.told.slice(-1));

for (const v of ['name', 'off', 'apply']) {
  t = load({ drift: { ownLook: v } });
  t.sendDriftConfig(1);
  check(`gamemode-config.json drift.ownLook "${v}" is the default`, t.sent[0][1].ownLook === v, t.sent[0][1].ownLook);
}
for (const bad of ['never', true, 1, null, ['off']]) {
  t = load({ drift: { ownLook: bad } });
  t.sendDriftConfig(1);
  check(`...a bad config value (${JSON.stringify(bad)}) falls back to "apply"`, t.sent[0][1].ownLook === 'apply', t.sent[0][1].ownLook);
}
for (const cfg of [undefined, { drift: 'off' }]) {
  t = load(cfg);
  t.sendDriftConfig(1);
  check(`...and so does ${JSON.stringify(cfg) || 'no config at all'}`, t.sent[0][1].ownLook === 'apply', t.sent[0][1].ownLook);
}
const shipped = JSON.parse(fs.readFileSync(path.join(root, 'gamemode-config.json'), 'utf8'));
check('the shipped gamemode-config.json has drift.ownLook "apply"', shipped.drift && shipped.drift.ownLook === 'apply', shipped.drift && shipped.drift.ownLook);
t = load(shipped);
t.sendDriftConfig(1);
check('...and the gamemode sends "apply" with it', t.sent[0][1].ownLook === 'apply');

// Hot reloads (the config undo): a reload that changes what a client is sent sends it to everyone online at once
const g = {};
t = load({ drift: { ownLook: 'apply' } }, g);
check('a server start sends nothing before a join', t.sent.length === 0);
t.sendDriftConfig(1);
t = load({ drift: { ownLook: 'off' } }, g);
check('a hot reload with drift.ownLook "off" sends "off" to everyone online at once, and logs it', t.sent.length === 2
  && t.sent.every((s) => s[1].ownLook === 'off') && t.sent[0][0] === 1 && t.sent[1][0] === 2 && /sent to 2 online/.test(t.logs.join('|')), { sent: own(t.sent), logs: t.logs });
t = load({ drift: { ownLook: 'off' } }, g);
check('...a reload that changes nothing sends nothing', t.sent.length === 0 && t.logs.length === 0, own(t.sent));
t = load({ drift: { ownLook: 'name', faceRebuild: 'load' } }, g);
check('...a reload to "name" sends "name"', t.sent.length === 2 && t.sent.every((s) => s[1].ownLook === 'name'), own(t.sent));
t = load({ drift: { ownLook: 'apply' } }, g);
check('...and a reload back to "apply" sends "apply"', t.sent.length === 2 && t.sent.every((s) => s[1].ownLook === 'apply'), own(t.sent));
t = load({ drift: { ownLook: 'apply', faceRebuild: 'entry' } }, g);
check('...a faceRebuild change by reload goes out the same way, ownLook kept', t.sent.length === 2
  && t.sent.every((s) => s[1].faceRebuild === 'entry' && s[1].ownLook === 'apply'), t.sent.map((s) => s[1].faceRebuild));
t = load({ drift: { ownLook: 'off' } }, {});
check('a fresh globalThis (a restart, nobody sent anything yet) sends nothing at load', t.sent.length === 0);

// /driftset wins over the config until "default" or a restart, across reloads
const h = {};
t = load({}, h);
t.sendDriftConfig(1);
t.cmds.get('driftset')(1, 'ownLook off');
t = load({ drift: { ownLook: 'name' } }, h);
check('after /driftset ownLook off a reload with drift.ownLook "name" keeps "off" and sends nothing', t.sent.length === 0, own(t.sent));
t.sendDriftConfig(1);
check('...a join after it is sent "off"', t.sent[0][1].ownLook === 'off');
t.cmds.get('driftset')(1, 'ownLook default');
check('.../driftset ownLook default gives the config\'s "name" to everyone online', t.sent.length === 3 && t.sent.slice(1).every((s) => s[1].ownLook === 'name'), own(t.sent));

console.log(failures ? `${failures} FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
