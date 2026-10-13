// Scripted test for the hot mic (Nate, 13 Oct, client 0.3.96: "people are talking with nothing pressed").
// Game side (voiceService.ts): a talk key whose key-up never reaches the game (the window lost the keyboard mid-hold)
// is let go once Input.isKeyPressed says it is up, and the page's guard notes reach the server log.
// Page side (skymp5-front utils/VoiceManager.js): every way the mic could stay open with nothing pressed is closed:
// LiveKit's own microphone switched by a press and a release that overlap, a press during a mic restart (it switched
// on LiveKit's microphone beside ours), a mute that failed; and an in-game voice choice is not dropped from the file
// before the launcher's push. Both files are bundled with esbuild on stubs. From skymp5-client with node_modules:
//
//   node tests/hotmic-harness.js            (FORK=<fork tree> to test another tree)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const FORK = process.env.FORK || path.resolve(__dirname, '..', '..');
const client = path.join(FORK, 'skymp5-client');
const here = path.resolve(__dirname, '..');
const esbuild = require(require.resolve('esbuild', { paths: [here, path.resolve(here, '..', 'skymp5-server'), path.join(process.env.HOME, 'dragonbreak', 'fork', 'skymp5-server')] }));
const NM = [path.join(FORK, 'skymp5-front', 'node_modules'), path.join(process.env.HOME, 'dragonbreak', 'fork', 'skymp5-front', 'node_modules')].find((p) => fs.existsSync(p));

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!ok) failures++; };
const tick = () => new Promise((r) => setImmediate(r));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

const KEYBOARD = 0, MOUSE = 1, GAMEPAD = 2;
const PAD_BACK = 0x0020, V = 47, LEFT_ALT = 56;

(async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-hotmic-'));

  // ================= the game side =================
  const stubs = {
    skyrimPlatform: `module.exports = {
      DxScanCode: { V: ${V}, LeftAlt: ${LEFT_ALT}, RightAlt: 184, LeftMouseButton: 256, RightMouseButton: 257, MiddleMouseButton: 258, MouseButton3: 259, MouseButton4: 260, MouseButton7: 263 },
      InputDeviceType: { Keyboard: 0, Mouse: 1, Gamepad: 2 }, Menu: { Loading: "Loading Menu" }, once: () => {}, on: () => {} };`,
    './customPacketUtil': 'module.exports = { sendCustomPacket: () => {} };',
    './widgetMenuUtil': `module.exports = {
      readMenuKeyCode: (sp, name, fallback) => { const s = sp.settings["skymp5-client"]; return s && typeof s[name] === "number" ? s[name] : fallback; },
      isConsoleOpen: () => false };`,
    './systemNotification': 'module.exports = { showSystemNotification: () => {} };',
    './remoteServer': 'module.exports = { RemoteServer: class {} };',
    '../../logging': 'module.exports = { logTrace: () => {}, logError: () => {} };',
  };
  const names = Object.keys(stubs).map((s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|');
  await esbuild.build({
    entryPoints: [path.join(client, 'src', 'services', 'services', 'voiceService.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'vs.js'), logLevel: 'error',
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: new RegExp(`^(${names})$`) }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubs[a.path], loader: 'js' }));
    } }],
  });
  const { VoiceService } = require(path.join(out, 'vs.js'));

  const realNow = Date.now;
  let clock = 1000000;
  Date.now = () => clock;
  const notes = [];
  globalThis.__dboDiagNote = (kind, text) => notes.push(`${kind} ${text}`);

  const make = (talkKey) => {
    const handlers = {};
    let focused = false;
    const pressed = new Set();
    const js = [];
    const sp = {
      browser: { isFocused: () => focused, executeJavaScript: (s) => js.push(s) },
      settings: { 'skymp5-client': talkKey === undefined ? {} : { voicePushToTalkKeyCode: talkKey } },
      Input: { isKeyPressed: (c) => pressed.has(c) },
      getPluginSourceCode: () => '', writePlugin: () => {},
    };
    const controller = {
      emitter: { on: () => {} }, on: (ev, fn) => { handlers[ev] = fn; }, once: () => {},
      lookupListener: () => ({ getMyRemoteRefrId: () => 0xff000001, getWorldModel: () => null }),
    };
    const vs = new VoiceService(sp, controller);
    // connected, so the frame update reaches the talk key and not the token request
    vs.connectedForRefrId = 0xff000001;
    vs.nextPeersAt = Infinity;
    const ev = (device, code, state, heldDuration) => handlers.buttonEvent(Object.assign({ device, code, isDown: false, isUp: false, isHeld: false, heldDuration: heldDuration || 0 }, { [state]: true }));
    const talking = () => { let on = null; for (const s of js) { const m = /setPtt\((true|false)\)/.exec(s); if (m) on = m[1] === 'true'; } return on; };
    const frames = (ms, step = 16) => { for (let t = 0; t < ms; t += step) { clock += step; vs.onUpdate(); } };
    return { vs, ev, talking, frames, pressed, setFocused: (v) => { focused = v; }, browserMsg: (...a) => handlers.browserMessage({ arguments: a }) };
  };

  let t = make();
  t.ev(KEYBOARD, V, 'isDown'); t.pressed.add(V);
  t.frames(1000);
  check('V held (the game says it is down): the mic stays open over a second of frames', t.talking() === true);
  t.pressed.delete(V);
  t.frames(1000);
  check('V up with no key-up event (the window lost the keyboard mid-hold): the mic closes', t.talking() === false);
  check('...and the server log is told', notes.some((n) => /^voice talk key released with no key-up$/.test(n)), notes);

  t = make();
  t.ev(KEYBOARD, V, 'isDown'); t.pressed.add(V);
  t.frames(100); t.pressed.delete(V); t.frames(100); t.pressed.add(V); t.frames(500);
  check('a key that reads up for a moment and down again does not cut the talk', t.talking() === true);
  t.ev(KEYBOARD, V, 'isUp');
  check('...its real key-up still ends it', t.talking() === false);

  t = make(259);
  t.ev(MOUSE, 3, 'isDown');
  t.setFocused(true);
  t.frames(1000);
  check('Mouse 4 held while a window has the browser focus (the button may be hidden then) keeps talking', t.talking() === true);
  t.ev(MOUSE, 3, 'isUp');

  t = make();
  t.ev(GAMEPAD, PAD_BACK, 'isDown', 0); t.ev(GAMEPAD, PAD_BACK, 'isHeld', 0.3);
  t.frames(1000);
  check('the gamepad talk button held is left to its own release', t.talking() === true);

  notes.length = 0;
  t = make();
  t.browserMsg('voice::guard', 'second mic unpublished');
  t.browserMsg('voice::guard', 'Headset (Realtek) device');
  check('the page\'s guard note reaches the server log, nothing else in its place', notes.length === 1 && notes[0] === 'voice guard: second mic unpublished', notes);
  Date.now = realNow;

  // ================= the page =================
  const sent = [];
  const listeners = new Map();
  global.window = {
    skyrimPlatform: { sendMessage: (...a) => sent.push(a) },
    addEventListener: (ev, fn) => { const l = listeners.get(ev) || []; l.push(fn); listeners.set(ev, l); },
    removeEventListener: () => {}, dispatchEvent: (e) => { for (const fn of listeners.get(e.type) || []) fn(e); return true; },
    localStorage: { d: {}, getItem(k) { return this.d[k] === undefined ? null : this.d[k]; }, setItem(k, v) { this.d[k] = String(v); }, removeItem(k) { delete this.d[k]; } },
  };
  global.document = { activeElement: null, body: { appendChild() {} }, createElement: () => ({ style: {} }) };
  global.CustomEvent = class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } };
  Object.defineProperty(global, 'navigator', { value: { mediaDevices: { enumerateDevices: async () => [] } }, configurable: true });
  const realInterval = global.setInterval;
  global.setInterval = () => 0;
  const SRC = path.join(FORK, 'skymp5-front', 'src', 'utils', 'VoiceManager.js');
  await esbuild.build({ entryPoints: [SRC], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'vm.js'), logLevel: 'error', nodePaths: NM ? [NM] : [],
    loader: { '.png': 'empty', '.svg': 'empty' },
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /^livekit-client$/ }, () => ({ path: 'livekit', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = { Room: class {}, RoomEvent: {}, Track: { Kind: { Audio: "audio" }, Source: { Microphone: "microphone" } } };', loader: 'js' }));
    } }] });
  require(path.join(out, 'vm.js'));
  global.setInterval = realInterval;
  const VM = window.__alduinakVoice.constructor;

  // A LiveKit participant: publications whose track carries a MediaStreamTrack; the fallback switch is slow on a press
  const makePub = (mst, muted) => {
    const track = { mediaStreamTrack: mst, isMuted: !!muted };
    const pub = { track, get isMuted() { return track.isMuted; }, failMute: 0,
      mute: async () => { if (pub.failMute > 0) { pub.failMute--; throw new Error('mute failed'); } track.isMuted = true; mst.enabled = false; },
      unmute: async () => { track.isMuted = false; mst.enabled = true; } };
    return pub;
  };
  const makeRoom = () => {
    const pubs = new Map();
    let n = 0;
    const lp = {
      audioTrackPublications: pubs,
      lkMic: null,
      enableDelays: [],
      setMicrophoneEnabled: async (on) => {
        const delay = lp.enableDelays.length ? lp.enableDelays.shift() : 0;
        for (let i = 0; i < delay; i++) await tick();
        if (on && !lp.lkMic) { lp.lkMic = makePub({ enabled: true }, false); pubs.set('lk' + (n++), lp.lkMic); }
        if (lp.lkMic) { if (on) await lp.lkMic.unmute(); else await lp.lkMic.mute(); }
      },
      unpublishTrack: async (track) => { for (const [k, p] of pubs) if (p.track === track) pubs.delete(k); if (lp.lkMic && lp.lkMic.track === track) lp.lkMic = null; },
    };
    return { localParticipant: lp };
  };
  const openPubs = (room) => { let open = 0; room.localParticipant.audioTrackPublications.forEach((p) => { if (!p.isMuted || p.track.mediaStreamTrack.enabled) open++; }); return open; };
  const hasGuard = typeof VM.prototype.guardTick === 'function';
  const guard = (vm) => { if (hasGuard) vm.guardTick(); };

  // ---- the fallback (LiveKit's own microphone): a quick tap, the press still opening when the release comes ----
  {
    const vm = new VM();
    const room = makeRoom();
    vm.room = room;
    room.localParticipant.enableDelays = [20, 0];
    const press = vm.setPtt(true);
    await tick();
    const release = vm.setPtt(false);
    await Promise.all([press, release]); await settle(40);
    check('fallback mic: a release while the press is still opening it leaves it closed', openPubs(room) === 0 && vm.ptt === false,
      { open: openPubs(room), lkMuted: room.localParticipant.lkMic && room.localParticipant.lkMic.isMuted });
    room.localParticipant.enableDelays = [];
    await vm.setPtt(true); await settle();
    check('...a press then opens it', openPubs(room) === 1);
    guard(vm);
    check('...and the guard leaves a held press alone', openPubs(room) === 1);
    await vm.setPtt(false); await settle();
  }

  // ---- our mic restarting (a device change): a press in between ----
  {
    const vm = new VM();
    const room = makeRoom();
    vm.room = room;
    let gate = null;
    vm.startMic = async function () {
      await new Promise((r) => { gate = r; });
      const mst = { enabled: true };
      const pub = makePub(mst, false);
      room.localParticipant.audioTrackPublications.set('ours' + Math.random(), pub);
      await pub.mute();
      this.mic = { track: mst, pub, gain: { gain: {} } };
      this.transmitting = false;
    };
    // unpublishing takes a while (a round trip to the voice server)
    vm.stopMic = async function () { const m = this.mic; this.mic = null; if (m) await room.localParticipant.unpublishTrack(m.pub.track); await settle(10); };
    // a first mic
    const first = vm.openMic(); await tick(); gate(); await first; await settle();
    const restart = vm.restartMic();
    await settle(2);
    const press = vm.setPtt(true);
    await settle(3);
    await settle(20); gate(); await restart; await press; await settle();
    check('a press during a mic restart waits for our mic: LiveKit\'s own microphone is never switched on beside it',
      room.localParticipant.lkMic === null, { lk: !!room.localParticipant.lkMic, pubs: room.localParticipant.audioTrackPublications.size });
    check('...and our mic is open for the press', vm.mic && vm.mic.pub.isMuted === false);
    await vm.setPtt(false); await settle();
    check('...closed on the release', openPubs(room) === 0, openPubs(room));

    // ---- a mute that failed: the guard closes it ----
    await vm.setPtt(true); await settle();
    vm.mic.pub.failMute = 1;
    await vm.setPtt(false); await settle();
    const leftOpen = openPubs(room);
    guard(vm); await settle();
    check('a mute that failed on the release is closed by the guard (it stayed open until the next press)', leftOpen === 1 && openPubs(room) === 0, { leftOpen, after: openPubs(room) });

    // ---- a second microphone beside ours ----
    const stray = makePub({ enabled: true }, false);
    room.localParticipant.audioTrackPublications.set('stray', stray);
    guard(vm); await settle();
    check('a second microphone published beside ours is unpublished', !room.localParticipant.audioTrackPublications.has('stray'));
    check('...and the game is told, once', sent.filter((a) => a[0] === 'voice::guard' && a[1] === 'second mic unpublished').length === 1, sent.filter((a) => a[0] === 'voice::guard'));

    // ---- marked muted but still sending ----
    vm.mic.pub.track.isMuted = true; vm.mic.track.enabled = true;
    guard(vm);
    check('a mic marked muted but still enabled is disabled', vm.mic.track.enabled === false);

    // ---- push-to-talk and voice activation are never fought ----
    await vm.setPtt(true); await settle();
    guard(vm); await settle();
    check('the guard never closes a mic while push-to-talk is held', openPubs(room) === 1);
    await vm.setPtt(false); await settle();
    vm.prefs.activation = 'vad'; vm.echo = 'on'; vm.vadOpenUntil = realNow() + 10000;
    vm.updateTransmit(); await settle();
    guard(vm); await settle();
    check('...nor while voice activation hears you', openPubs(room) === 1);
    vm.vadOpenUntil = 0; vm.updateTransmit(); await settle();
    check('...which closes it again when it stops hearing you', openPubs(room) === 0);
  }

  // ---- an in-game choice before the launcher's push ----
  {
    const vm = new VM();
    window.__alduinakVoice = vm;
    window.__alduinakChatSettings = { ui: { voice: { prefs: { outputVolume: 1.6 }, launcher: { outputVolume: 0.7 } } } };
    sent.length = 0;
    window.dispatchEvent(new CustomEvent('dbo:uiSettings'));
    const f = window.__alduinakChatSettings;
    check('the chat\'s file before the launcher\'s push: an in-game choice made over a launcher value is not dropped from the file',
      f.ui.voice.prefs.outputVolume === 1.6, f.ui.voice);
    vm.setPrefs({ outputVolume: 0.7, activation: 'ptt' });
    check('...and goes back on with the push', vm.getPrefs().outputVolume === 1.6, vm.getPrefs());
    vm.setPrefs({ outputVolume: 0.5 });
    check('...a launcher value changed since still wins and drops it', vm.getPrefs().outputVolume === 0.5 && !('outputVolume' in window.__alduinakChatSettings.ui.voice.prefs));
  }

  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `${failures} failure(s)` : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL', e.stack || e.message); process.exit(1); });
