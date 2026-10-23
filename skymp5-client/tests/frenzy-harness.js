// Scripted test for frenzyService.ts: a dboFrenzy packet (server frenzy.js) makes the player AI-driven with the flagged
// controls off and starts combat on the server's target; a new target switches; "off", death, a disconnect, a game load
// and the local failsafe always give control back. Drives the real service against a stubbed game. Run from skymp5-client:
//
//   node tests/frenzy-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP frenzy (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };
const STUBS = {
  skyrimPlatform: 'module.exports = {};',
  clientListener: 'class ClientListener {} module.exports = { ClientListener };',
  customPacketUtil: `module.exports = {
    parseCustomPacket: (e) => { try { return JSON.parse(e.message.contentJsonDump); } catch { return null; } },
    sendCustomPacket: (c, o) => globalThis.__frenzy.sent.push(o) };`,
  remoteServer: 'class RemoteServer {} module.exports = { RemoteServer };',
  worldViewMisc: 'module.exports = { remoteIdToLocalId: (id) => globalThis.__frenzy.local.get(id) || 0 };',
};
const STUB_OF = { skyrimPlatform: 'skyrimPlatform', './clientListener': 'clientListener', './customPacketUtil': 'customPacketUtil',
  './remoteServer': 'remoteServer', '../../view/worldViewMisc': 'worldViewMisc' };

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-frenzy-'));
  const out = path.join(tmp, 'frenzyService.js');
  try {
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../src/services/services/frenzyService.ts')], bundle: true, platform: 'node', format: 'cjs',
      outfile: out, logLevel: 'error',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (STUB_OF[a.path] ? { path: STUB_OF[a.path], namespace: 'stub' } : undefined));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
      } }],
    });
    const { readFrenzy, deadlineFor, FrenzyService, MAX_TOTAL_S } = require(out);

    // ---- the packet
    const on = readFrenzy({ customPacketType: 'dboFrenzy', on: true, target: 0xff000005, seconds: 25, disable: [true, true, false, false, true, true, true, true] });
    check('an order reads target, seconds and the eight flags', on && on.on && on.target === 0xff000005 && on.seconds === 25 && on.disable[1] === true, on);
    check('no or bad flags: the defaults', JSON.stringify(readFrenzy({ customPacketType: 'dboFrenzy', on: true, target: 5, seconds: 5, disable: [1] }).disable) === '[true,false,false,false,true,true,true,true]');
    check('seconds are held to 60', readFrenzy({ customPacketType: 'dboFrenzy', on: true, target: 5, seconds: 999 }).seconds === 60);
    check('"off" reads as off', readFrenzy({ customPacketType: 'dboFrenzy', on: false }).on === false);
    check('another packet, no target or no seconds is ignored', readFrenzy({ customPacketType: 'dboShake' }) === null && readFrenzy({ customPacketType: 'dboFrenzy', on: true, seconds: 5 }) === null
      && readFrenzy({ customPacketType: 'dboFrenzy', on: true, target: 5, seconds: 0 }) === null && readFrenzy(null) === null);
    check('the failsafe: seconds + 5 s, never past 90 s from the start', deadlineFor(1000, 1000, 25) === 1000 + 30000 && deadlineFor(80000, 0, 25) === MAX_TOTAL_S * 1000);

    // ---- the service
    const W = globalThis.__frenzy = { sent: [], local: new Map([[0xff000005, 0xff000a05], [0xff000006, 0xff000a06]]) };
    const calls = [];
    let inCombat = false, playerDead = false;
    const actors = new Map([[0xff000a05, { id: 'foe5', isDead: () => false }], [0xff000a06, { id: 'foe6', isDead: () => false }]]);
    const PLAYER = { isInCombat: () => inCombat, isDead: () => playerDead, startCombat: (a) => { calls.push(['startCombat', a.id]); inCombat = true; }, stopCombat: () => { calls.push(['stopCombat']); inCombat = false; } };
    const sp = {
      Game: { getPlayer: () => PLAYER, setPlayerAIDriven: (v) => calls.push(['ai', v]), getFormEx: (id) => actors.get(id) || null,
        disablePlayerControls: (...f) => calls.push(['off', f.join(',')]), enablePlayerControls: (...f) => calls.push(['on', f.join(',')]) },
      Actor: { from: (f) => f },
    };
    const handlers = {}, onUpdate = [], perFrame = [];
    const controller = {
      emitter: { on: (ev, fn) => { handlers[ev] = fn; } },
      once: (ev, fn) => { if (ev === 'update') onUpdate.push(fn); },
      on: (ev, fn) => { if (ev === 'update') perFrame.push(fn); },
      lookupListener: () => ({ getMyRemoteRefrId: () => 0xff000001 }),
    };
    new FrenzyService(sp, controller);
    const send = (o) => handlers.customPacketMessage({ message: { contentJsonDump: JSON.stringify(o) } });
    const flush = () => { while (onUpdate.length) onUpdate.shift()(); };
    const frame = () => perFrame.forEach((f) => f());
    const has = (k, v) => calls.some((c) => c[0] === k && (v === undefined || c[1] === v));

    send({ customPacketType: 'dboFrenzy', on: true, target: 0xff000005, seconds: 25 });
    check('nothing runs before the next update', calls.length === 0 && onUpdate.length === 1);
    flush();
    check('AI-driven, the flagged controls off, combat on the target', has('ai', true) && has('off', 'true,false,false,false,true,true,true,true,0') && has('startCombat', 'foe5'), calls);
    check('the server hears it took control', W.sent.some((p) => p.customPacketType === 'dboFrenzyReport' && p.phase === 'on'));
    calls.length = 0;
    send({ customPacketType: 'dboFrenzy', on: true, target: 0xff000005, seconds: 20 }); flush();
    check('a resend of the same target while fighting does nothing more', calls.length === 0, calls);
    send({ customPacketType: 'dboFrenzy', on: true, target: 0xff000006, seconds: 15 }); flush();
    check('a new target: combat switches, AI and controls untouched', has('startCombat', 'foe6') && !has('ai') && !has('off'), calls);
    send({ customPacketType: 'dboFrenzy', on: true, target: 0xff000099, seconds: 15 }); flush();
    check('a target not in this game: the server is told (miss)', W.sent.some((p) => p.phase === 'miss' && p.target === 0xff000099));
    send({ customPacketType: 'dboFrenzy', on: true, target: 0xff000001, seconds: 15 }); flush();
    check('never itself', W.sent.some((p) => p.phase === 'miss' && p.target === 0xff000001));
    calls.length = 0;
    send({ customPacketType: 'dboFrenzy', on: false }); flush();
    check('"off": combat stops, AI-driven off, the same controls back on', has('stopCombat') && has('ai', false) && has('on', 'true,false,false,false,true,true,true,true,0'), calls);
    calls.length = 0; send({ customPacketType: 'dboFrenzy', on: false }); flush();
    check('a second "off" does nothing', calls.length === 0);

    // the failsafe: a lost "off"
    send({ customPacketType: 'dboFrenzy', on: true, target: 0xff000005, seconds: 1 }); flush();
    calls.length = 0; W.sent.length = 0;
    frame();
    check('before the failsafe nothing happens', calls.length === 0);
    const realNow = Date.now; Date.now = () => realNow() + 7000;
    frame();
    Date.now = realNow;
    check('past seconds + 5 s with no "off": control comes back by itself', has('ai', false) && has('on'), calls);
    check('...and the server is told why', W.sent.some((p) => p.phase === 'off' && p.why === 'failsafe'));
    // death
    send({ customPacketType: 'dboFrenzy', on: true, target: 0xff000005, seconds: 20 }); flush();
    calls.length = 0; playerDead = true; frame(); playerDead = false;
    check('the player dies or falls: control comes back', has('ai', false));
    // disconnect and game load
    send({ customPacketType: 'dboFrenzy', on: true, target: 0xff000005, seconds: 20 }); flush();
    calls.length = 0; handlers.connectionDisconnect(); flush();
    check('a disconnect gives control back', has('ai', false));
    send({ customPacketType: 'dboFrenzy', on: true, target: 0xff000005, seconds: 20 }); flush();
    calls.length = 0; handlers.gameLoad(); flush();
    check('a game load gives control back', has('ai', false));
    // natives that throw never leave it half way
    send({ customPacketType: 'dboFrenzy', on: true, target: 0xff000005, seconds: 20 }); flush();
    sp.Game.setPlayerAIDriven = () => { throw new Error('ctx'); };
    calls.length = 0;
    let threw = false; try { send({ customPacketType: 'dboFrenzy', on: false }); flush(); } catch { threw = true; }
    check('a throwing native is swallowed and the controls still come back', !threw && has('on'), calls);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
