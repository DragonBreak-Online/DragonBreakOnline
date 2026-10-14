// Scripted test for nightEyePlan.ts and nightEyeService.ts: the server's dboNightEye turns the Khajiit's Night Eye look on
// once and off once, a repeat only moves the end, a relog (new connection) takes it off quietly and the next "on" brings it
// back, a lost "off" still ends it, Riddle'Thar's blessing keeps its own look, and nothing is cast, sent or relayed.
// Drives the real service against a stubbed game. Run from skymp5-client:
//
//   node tests/nighteye-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP nighteye (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

const INTRO = 0x6b10a, MAIN = 0x6b108, OUTRO = 0x6b10b, EFFECT = 0x6b10c, SON = 0x7c723, SOFF = 0x7c722;

const STUBS = {
  clientListener: 'class ClientListener {} module.exports = { ClientListener };',
  customPacketUtil: `module.exports = {
    parseCustomPacket: (e) => { try { return JSON.parse(e.message.contentJsonDump); } catch { return null; } },
    sendCustomPacket: () => { globalThis.__ne.sent++; } };`,
  logging: 'module.exports = { logTrace() {}, logError: (...a) => globalThis.__ne.errors.push(a.join(" ")) };',
};
const STUB_OF = { './clientListener': 'clientListener', './customPacketUtil': 'customPacketUtil', '../../logging': 'logging' };

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-nighteye-'));
  try {
    const outPure = path.join(tmp, 'nightEyePlan.js');
    await esbuild.build({ entryPoints: [path.resolve(__dirname, '../src/services/services/nightEyePlan.ts')], bundle: true, platform: 'node',
      format: 'cjs', outfile: outPure, logLevel: 'error' });
    const outSvc = path.join(tmp, 'nightEyeService.js');
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../src/services/services/nightEyeService.ts')], bundle: true, platform: 'node', format: 'cjs',
      outfile: outSvc, logLevel: 'error',
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

function pure({ readNightEyeOrder, NightEyePlan, NIGHT_EYE, NIGHT_EYE_GRACE_MS }) {
  check('the records (Skyrim.esm, read with esplib)', NIGHT_EYE.intro === INTRO && NIGHT_EYE.main === MAIN && NIGHT_EYE.outro === OUTRO
    && NIGHT_EYE.effect === EFFECT && NIGHT_EYE.soundOn === SON && NIGHT_EYE.soundOff === SOFF && NIGHT_EYE.introMs === 960);
  check('reads an on', JSON.stringify(readNightEyeOrder({ customPacketType: 'dboNightEye', on: true, seconds: 42 })) === '{"on":true,"seconds":42}');
  check('reads an off', JSON.stringify(readNightEyeOrder({ customPacketType: 'dboNightEye', on: false })) === '{"on":false,"seconds":0}');
  check('an on without seconds is no order', readNightEyeOrder({ customPacketType: 'dboNightEye', on: true }) === null);
  check('another packet is no order', readNightEyeOrder({ customPacketType: 'dboCastSelf', spell: 1 }) === null && readNightEyeOrder(null) === null);
  check('an order is capped at 600 s', readNightEyeOrder({ customPacketType: 'dboNightEye', on: true, seconds: 1e9 }).seconds === 600);
  const p = new NightEyePlan();
  check('on: start once', JSON.stringify(p.receive({ on: true, seconds: 60 }, 0)) === '["start"]' && p.isOn());
  check('a repeat on: nothing again, the end moves', p.receive({ on: true, seconds: 60 }, 10000).length === 0 && p.endsAt() === 70000);
  check('before the intro is over: nothing', p.tick(500).length === 0);
  check('after the intro: the held look, once', JSON.stringify(p.tick(1000)) === '["main"]' && p.tick(1100).length === 0);
  check('off: end once', JSON.stringify(p.receive({ on: false, seconds: 0 }, 20000)) === '["end"]' && !p.isOn());
  check('a second off: nothing', p.receive({ on: false, seconds: 0 }, 20001).length === 0);
  const q = new NightEyePlan();
  q.receive({ on: true, seconds: 60 }, 0);
  check('a lost off: still on at the end', q.tick(60000).filter((s) => s === 'end').length === 0);
  check('a lost off: it ends after the grace', JSON.stringify(q.tick(60000 + NIGHT_EYE_GRACE_MS)) === '["end"]');
  const r = new NightEyePlan();
  r.receive({ on: true, seconds: 60 }, 0);
  check('reset (disconnect): end once', JSON.stringify(r.reset()) === '["end"]' && r.reset().length === 0);
  check('reset while off: nothing', new NightEyePlan().reset().length === 0);
}

function driven({ NightEyeService }) {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const W = globalThis.__ne = { sent: 0, errors: [] };
    const calls = [];
    let blessing = false;
    const form = (id) => ({ getFormID: () => id });
    const known = new Set([INTRO, MAIN, OUTRO, EFFECT, SON, SOFF]);
    const player = { getFormID: () => 0x14, hasMagicEffect: (e) => blessing && !!e && e.getFormID() === EFFECT,
      // anything that would put a spell on the player or relay it
      addSpell: () => calls.push('addSpell'), dispelSpell: () => calls.push('dispelSpell'), equipSpell: () => calls.push('equipSpell') };
    const imod = (f) => (f ? { apply: (s) => calls.push(`apply ${f.getFormID().toString(16)} ${s}`), remove: () => calls.push(`remove ${f.getFormID().toString(16)}`) } : null);
    const sp = {
      Game: { getPlayer: () => player, getFormEx: (id) => (known.has(id) ? form(id) : null) },
      ImageSpaceModifier: { from: imod },
      MagicEffect: { from: (f) => f },
      Sound: { from: (f) => (f ? { play: (src) => { calls.push(`sound ${f.getFormID().toString(16)}`); return src === player ? 1 : 0; } } : null) },
      Spell: { from: () => { calls.push('Spell.from'); return null; } },
    };
    const handlers = { update: [] };
    const emitter = {};
    const controller = {
      on: (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); },
      once: () => calls.push('once'),
      emitter: { on: (name, fn) => { (emitter[name] = emitter[name] || []).push(fn); } },
    };
    new NightEyeService(sp, controller);
    const frame = (ms = 100) => { now += ms; handlers.update.forEach((fn) => fn()); };
    const packet = (content) => emitter.customPacketMessage.forEach((fn) => fn({ message: { contentJsonDump: JSON.stringify(content) } }));
    const fire = (name) => (emitter[name] || []).forEach((fn) => fn({}));
    const take = () => calls.splice(0);
    const on = (seconds = 60) => packet({ customPacketType: 'dboNightEye', on: true, seconds });
    const off = () => packet({ customPacketType: 'dboNightEye', on: false });

    on();
    check('nothing runs in the packet callback', calls.length === 0);
    frame();
    check('on: the intro and its sound, once', JSON.stringify(take()) === JSON.stringify(['apply 6b10a 1', 'sound 7c723']));
    on(); frame();
    check('a repeated on applies nothing again', take().length === 0);
    frame(1000);
    check('after the intro: intro off, held look on', JSON.stringify(take()) === JSON.stringify(['remove 6b10a', 'apply 6b108 1']));
    frame(1000);
    check('then nothing each frame', take().length === 0);
    off(); frame();
    check('off: the look off once, the outro and its sound', JSON.stringify(take()) === JSON.stringify(['remove 6b10a', 'remove 6b108', 'apply 6b10b 1', 'sound 7c722']));
    off(); frame();
    check('a second off removes nothing', take().length === 0);

    // a relog: the connection drops with the look on, and the server's on after login brings it back
    on(); frame(); frame(1000); take();
    fire('connectionDisconnect'); frame();
    check('disconnect: the look off quietly (no outro, no sound)', JSON.stringify(take()) === JSON.stringify(['remove 6b10a', 'remove 6b108']));
    fire('connectionAccepted'); frame();
    check('the new connection alone applies nothing', take().length === 0);
    on(35); frame();
    check('relog: the server\'s on applies it again', JSON.stringify(take()) === JSON.stringify(['apply 6b10a 1', 'sound 7c723']));
    frame(1000); take();
    // a character switch: the new character has none, the server says off
    off(); frame();
    check('the off for a character without it ends it', take().includes('remove 6b108'));

    // a lost off
    on(2); frame(); frame(1000); take();
    frame(2000);
    check('a lost off: still on just after the end', !take().includes('remove 6b108'));
    frame(3000);
    check('a lost off: it ends after the grace', take().includes('remove 6b108'));

    // Riddle'Thar's blessing already shows the look: the power neither applies nor removes it
    blessing = true;
    on(); frame(); frame(1000); off(); frame();
    check('with the blessing on: no look applied or removed', take().filter((c) => /apply|remove 6b108/.test(c)).length === 0);
    // the blessing comes on while the power shows it: the end leaves the held look to the blessing
    blessing = false;
    on(); frame(); frame(1000); take();
    blessing = true; off(); frame();
    const t = take();
    check('the blessing came on meanwhile: the held look is left to it', !t.includes('remove 6b108') && !t.some((c) => c.startsWith('apply')));
    blessing = false;

    check('no spell was looked up, cast, added or dispelled', calls.length === 0 && !take().length);
    check('nothing was sent to the server (no relay)', W.sent === 0);
    check('no errors', W.errors.length === 0, W.errors);
  } finally {
    Date.now = realNow;
  }
}

function source() {
  const src = (f) => fs.readFileSync(path.resolve(__dirname, '../src', f), 'utf8');
  const svc = src('services/services/nightEyeService.ts');
  check('the service never casts or relays (no cast, sendCustomPacket, SpellCast message)', !/\.cast\(|sendCustomPacket|SpellCast|MsgType/.test(svc));
  check('the vanilla power stays blocked (magicSyncService BLOCKED_POWER_IDS 0xAA01D)', /0x000AA01D, \/\/ PowerKhajiitNightEye/.test(src('services/services/magicSyncService.ts')));
  check('the service is registered (index.ts)', /new NightEyeService\(sp, controller\)/.test(src('index.ts')));
  check('the front tells the server it has it (uiCaps nightEye)', /'nightEye',/.test(fs.readFileSync(path.resolve(__dirname, '../../skymp5-front/src/features/hud/index.tsx'), 'utf8')));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
