// Scripted test for catReflexesPlan.ts and catReflexesService.ts: the server's dboCatReflexes gives the Khajiit's
// Cat-like Reflexes its SpeedMult and its jump height once and takes both off once, a repeat only moves the end, a lost
// "off" still ends it, a relog (new connection) takes it off, the jump setting always goes back to what it was, a step
// that found no player is taken off on the next frame, and nothing is cast, sent or relayed.
// Drives the real service against a stubbed game. Run from skymp5-client:
//
//   node tests/catreflexes-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP catreflexes (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

const JUMP = 'fJumpHeightMin';
const BASE_JUMP = 76;   // vanilla; the service reads it rather than assuming it

const STUBS = {
  clientListener: 'class ClientListener {} module.exports = { ClientListener };',
  customPacketUtil: `module.exports = {
    parseCustomPacket: (e) => { try { return JSON.parse(e.message.contentJsonDump); } catch { return null; } },
    sendCustomPacket: () => { globalThis.__cr.sent++; } };`,
  logging: 'module.exports = { logTrace() {}, logError: (...a) => globalThis.__cr.errors.push(a.join(" ")) };',
};
const STUB_OF = { './clientListener': 'clientListener', './customPacketUtil': 'customPacketUtil', '../../logging': 'logging' };

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-catreflexes-'));
  try {
    const outPure = path.join(tmp, 'catReflexesPlan.js');
    await esbuild.build({ entryPoints: [path.resolve(__dirname, '../src/services/services/catReflexesPlan.ts')], bundle: true,
      platform: 'node', format: 'cjs', outfile: outPure, logLevel: 'error' });
    const outSvc = path.join(tmp, 'catReflexesService.js');
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../src/services/services/catReflexesService.ts')], bundle: true, platform: 'node',
      format: 'cjs', outfile: outSvc, logLevel: 'error',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (STUB_OF[a.path] ? { path: STUB_OF[a.path], namespace: 'stub' } : undefined));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
      } }],
    });
    pure(require(outPure));
    driven(require(outSvc));
    source();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exitCode = failures ? 1 : 0;
}

function pure({ readCatReflexesOrder, CatReflexesPlan, CAT_REFLEXES }) {
  const read = (c) => readCatReflexesOrder(c);
  check('the jump is a game setting, not an actor value (JumpingBonus does nothing in vanilla)', CAT_REFLEXES.jumpSetting === JUMP);
  check('reads an on with both numbers', JSON.stringify(read({ customPacketType: 'dboCatReflexes', on: true, seconds: 60, speed: 15, jump: 0.2 }))
    === '{"on":true,"seconds":60,"speed":15,"jump":0.2}');
  check('reads an off', JSON.stringify(read({ customPacketType: 'dboCatReflexes', on: false })) === '{"on":false,"seconds":0,"speed":0,"jump":0}');
  check('an on without seconds is no order', read({ customPacketType: 'dboCatReflexes', on: true, speed: 15 }) === null);
  check('another packet is no order', read({ customPacketType: 'dboNightEye', on: true, seconds: 60 }) === null && read(null) === null);
  check('an order is capped (600 s, 100 speed, 2 jump)', (() => {
    const o = read({ customPacketType: 'dboCatReflexes', on: true, seconds: 1e9, speed: 1e9, jump: 1e9 });
    return o.seconds === 600 && o.speed === 100 && o.jump === 2;
  })());
  check('a negative or missing number is none (never a slow, never a lower jump)', (() => {
    const o = read({ customPacketType: 'dboCatReflexes', on: true, seconds: 60, speed: -50 });
    return o.speed === 0 && o.jump === 0;
  })());
  const p = new CatReflexesPlan();
  check('on: start once, with the order\'s numbers', JSON.stringify(p.receive({ on: true, seconds: 60, speed: 15, jump: 0.2 }, 0))
    === '[{"kind":"start","speed":15,"jump":0.2}]' && p.isOn());
  check('a repeat on: nothing again, the end moves', p.receive({ on: true, seconds: 60, speed: 15, jump: 0.2 }, 10000).length === 0
    && p.endsAt() === 70000);
  check('while it lasts: nothing', p.tick(30000).length === 0);
  check('off: end once', JSON.stringify(p.receive({ on: false, seconds: 0, speed: 0, jump: 0 }, 20000)) === '[{"kind":"end"}]' && !p.isOn());
  check('a second off: nothing', p.receive({ on: false, seconds: 0, speed: 0, jump: 0 }, 20001).length === 0);
  const q = new CatReflexesPlan();
  q.receive({ on: true, seconds: 60, speed: 15, jump: 0.2 }, 0);
  check('a lost off: still on at its end', q.tick(60000).length === 0);
  check('a lost off: it ends after the grace', JSON.stringify(q.tick(60000 + CAT_REFLEXES.graceMs)) === '[{"kind":"end"}]');
  const r = new CatReflexesPlan();
  r.receive({ on: true, seconds: 60, speed: 15, jump: 0.2 }, 0);
  check('reset (disconnect): end once', JSON.stringify(r.reset()) === '[{"kind":"end"}]' && r.reset().length === 0);
  check('reset while off: nothing', new CatReflexesPlan().reset().length === 0);
}

function driven({ CatReflexesService }) {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const W = globalThis.__cr = { sent: 0, errors: [] };
    const calls = [];
    const settings = { [JUMP]: BASE_JUMP };
    let havePlayer = true;
    let avThrows = false;
    const player = { getFormID: () => 0x14,
      modActorValue: (av, v) => { if (avThrows) throw new Error('player not ready'); calls.push(`mod ${av} ${v}`); },
      setActorValue: (av, v) => calls.push(`set ${av} ${v}`),
      addSpell: () => calls.push('addSpell'), dispelSpell: () => calls.push('dispelSpell') };
    const sp = {
      Game: {
        getPlayer: () => (havePlayer ? player : null),
        getFormEx: (id) => { calls.push(`getFormEx ${id.toString(16)}`); return null; },
        getGameSettingFloat: (k) => settings[k],
        setGameSettingFloat: (k, v) => { settings[k] = v; calls.push(`gmst ${k} ${Math.round(v * 100) / 100}`); },
      },
      Spell: { from: () => { calls.push('Spell.from'); return null; } },
      Debug: { notification: (t) => calls.push(`notify ${t}`) },
    };
    const handlers = { update: [] };
    const emitter = {};
    const controller = {
      on: (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); },
      once: () => calls.push('once'),
      emitter: { on: (name, fn) => { (emitter[name] = emitter[name] || []).push(fn); } },
    };
    new CatReflexesService(sp, controller);
    const frame = (ms = 100) => { now += ms; handlers.update.forEach((fn) => fn()); };
    const packet = (content) => emitter.customPacketMessage.forEach((fn) => fn({ message: { contentJsonDump: JSON.stringify(content) } }));
    const fire = (name) => (emitter[name] || []).forEach((fn) => fn({}));
    const take = () => calls.splice(0);
    const on = (seconds = 60, speed = 15, jump = 0.2) => packet({ customPacketType: 'dboCatReflexes', on: true, seconds, speed, jump });
    const off = () => packet({ customPacketType: 'dboCatReflexes', on: false });

    on();
    check('nothing happens in the packet\'s callback', take().length === 0);
    frame();
    const started = take();
    check('the speed goes on with the nudge after it (the engine re-reads movement speed then)',
      JSON.stringify(started.slice(0, 3)) === '["mod SpeedMult 15","mod CarryWeight 0.1","mod CarryWeight -0.1"]', started);
    check('the jump setting is raised by the order\'s share', settings[JUMP] === BASE_JUMP * 1.2);
    frame(1000);
    check('while it lasts nothing is written again', take().length === 0);
    on();
    frame();
    check('a repeat gives neither a second time', take().length === 0 && settings[JUMP] === BASE_JUMP * 1.2);

    off();
    frame();
    const ended = take();
    check('the jump setting goes back to what it was', settings[JUMP] === BASE_JUMP);
    check('the speed is taken off again, with the nudge', ended.includes('mod SpeedMult -15')
      && ended.filter((c) => c === 'mod CarryWeight 0.1').length === 1, ended);
    frame(1000);
    check('and nothing is written after that', take().length === 0);

    // a lost "off": the grace ends it
    on(60);
    frame(); take();
    frame(63000);
    check('a lost off: the grace takes both off', settings[JUMP] === BASE_JUMP && take().includes('mod SpeedMult -15'));

    // a relog while it lasts
    on(60);
    frame(); take();
    fire('connectionDisconnect');
    frame();
    check('a disconnect takes both off', settings[JUMP] === BASE_JUMP && take().includes('mod SpeedMult -15'));
    on(60); frame(); take();
    fire('connectionAccepted');
    frame();
    check('a login takes both off (the server sends it again if it still lasts)',
      settings[JUMP] === BASE_JUMP && take().includes('mod SpeedMult -15'));

    // the speed the server sends is the speed applied
    on(60, 40, 0.5);
    frame();
    check('the order\'s own numbers are used, not any of ours', take().includes('mod SpeedMult 40') && settings[JUMP] === BASE_JUMP * 1.5);
    off(); frame();
    check('and they are taken off by the same amount', settings[JUMP] === BASE_JUMP && take().includes('mod SpeedMult -40'));

    // no player on the frame the end fell on: the next frame takes it off
    on(60); frame(); take();
    havePlayer = false;
    off(); frame();
    check('no player: the jump is still put back', settings[JUMP] === BASE_JUMP);
    check('no player: nothing was written to one', !take().some((c) => c.startsWith('mod ')));
    havePlayer = true;
    frame();
    check('the player is back: the speed comes off on that frame', take().includes('mod SpeedMult -15'));
    frame();
    check('and only once', take().length === 0);

    // an actor value write that throws leaves nothing standing either
    avThrows = true;
    on(60); frame();
    check('a throwing write is no error and no speed', W.errors.length === 0, W.errors);
    avThrows = false;
    off(); frame();
    check('nothing is taken off that never went on', !take().some((c) => c === 'mod SpeedMult -15'));
    check('the jump setting is back where it started', settings[JUMP] === BASE_JUMP);

    check('no spell was looked up, cast, added or dispelled', !calls.some((c) => /Spell|addSpell|dispelSpell|getFormEx/.test(c)));
    check('nothing was sent to the server (no relay)', W.sent === 0);
    check('no errors', W.errors.length === 0, W.errors);
  } finally {
    Date.now = realNow;
  }
}

function source() {
  const src = (f) => fs.readFileSync(path.resolve(__dirname, '../src', f), 'utf8');
  const svc = src('services/services/catReflexesService.ts');
  check('the service never casts or relays (no cast, sendCustomPacket, SpellCast message)',
    !/\.cast\(|sendCustomPacket|SpellCast|MsgType/.test(svc));
  check('the service is registered (index.ts)', /new CatReflexesService\(sp, controller\)/.test(src('index.ts')));
  check('the front tells the server it has it (uiCaps catReflexes)',
    /'catReflexes'/.test(fs.readFileSync(path.resolve(__dirname, '../../skymp5-front/src/features/hud/index.tsx'), 'utf8')));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
