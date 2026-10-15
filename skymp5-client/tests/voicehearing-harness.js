// Scripted test for voice hearing lists (security audit F2 with L2-3 and L4-4, 15 Oct): a modified client heard every voice
// on the server, because every listener could subscribe to every track and range lived only in the listener's page. The
// server now sends each updated client who may hear it in each mode; the page makes the list for its mode its LiveKit track
// subscription permissions, which LiveKit enforces on every listener. Game side (voiceService.ts): the token request
// says it can take lists, and lists reach the page. Page side (skymp5-front utils/VoiceManager.js): the permission is set
// before joining and follows every list and mode change, the range goes only to allowed listeners, no lists (an old
// server) leaves everything as before, a made-up range is ignored, and a refused voice is not asked for every 400 ms.
// Both files are bundled with esbuild on stubs; livekit-client is a fake that records calls. From skymp5-client:
//
//   node tests/voicehearing-harness.js            (FORK=<fork tree> to test another tree)
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
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await tick(); };

(async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-voicehearing-'));

  // ================= the game side =================
  const stubs = {
    skyrimPlatform: `module.exports = {
      DxScanCode: { V: 47, LeftAlt: 56, RightAlt: 184, LeftMouseButton: 256, RightMouseButton: 257, MiddleMouseButton: 258, MouseButton3: 259, MouseButton4: 260, MouseButton7: 263 },
      InputDeviceType: { Keyboard: 0, Mouse: 1, Gamepad: 2 }, Menu: { Loading: "Loading Menu" }, once: () => {}, on: () => {} };`,
    './customPacketUtil': 'module.exports = { sendCustomPacket: (c, p) => globalThis.__vhSent.push(p) };',
    './widgetMenuUtil': 'module.exports = { readMenuKeyCode: (sp, name, fallback) => fallback, isConsoleOpen: () => false };',
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
  globalThis.__vhSent = [];
  {
    const handlers = {};
    const emitted = {};
    const js = [];
    const sp = {
      browser: { isFocused: () => false, executeJavaScript: (s) => js.push(s) },
      settings: { 'skymp5-client': {} }, Input: { isKeyPressed: () => false },
      getPluginSourceCode: () => '', writePlugin: () => {}, storage: {},
    };
    const controller = {
      emitter: { on: (ev, fn) => { emitted[ev] = fn; } }, on: (ev, fn) => { handlers[ev] = fn; }, once: () => {},
      lookupListener: () => ({ getMyRemoteRefrId: () => 0xff000001, getWorldModel: () => null }),
    };
    new VoiceService(sp, controller);
    handlers.update();
    const req = globalThis.__vhSent.find((p) => p.customPacketType === 'voiceTokenRequest');
    check('the token request says this client can take hearing lists', !!req && req.caps && req.caps.hearingLists === 1 && req.caps.identityV2 === true, req);
    const packet = (o) => emitted.customPacketMessage({ message: { contentJsonDump: JSON.stringify(o) } });
    const bands = { whisper: ['ff000002'], talk: ['ff000002', 'ff000003'], shout: ['ff000002', 'ff000003', 'ff000004'] };
    packet({ customPacketType: 'voiceToken', enabled: true, url: 'wss://voice.test', token: 'jwt', modes: [{ key: 'talk', label: 'Talk', units: 840 }], hearers: bands });
    const conn = js.filter((s) => /\.connect\(/.test(s)).pop() || '';
    const cfg = (() => { try { return JSON.parse(conn.slice(conn.lastIndexOf(', {') + 2, conn.lastIndexOf(')'))); } catch (e) { return null; } })();
    check('the lists in the token reach the page in connect()\'s cfg', !!cfg && JSON.stringify(cfg.hearers) === JSON.stringify(bands), conn.slice(-300));
    packet({ customPacketType: 'voiceToken', enabled: true, url: 'wss://voice.test', token: 'jwt2', modes: [{ key: 'talk', label: 'Talk', units: 840 }] });
    const conn2 = js.filter((s) => /\.connect\(/.test(s)).pop() || '';
    check('a token without lists (an old server) gives the page no hearers', /jwt2/.test(conn2) && !/hearers/.test(conn2), conn2.slice(-200));
    packet({ customPacketType: 'voiceHearers', bands: { talk: ['ff000009'] } });
    check('a voiceHearers packet reaches the page\'s setHearers', js.some((s) => /setHearers\(\{"talk":\["ff000009"\]\}\)/.test(s)), js.slice(-2));
    const n = js.length;
    packet({ customPacketType: 'voiceHearers', bands: ['ff000009'] });
    check('...a malformed one does not', js.length === n, js.slice(n));
  }

  // ================= the page =================
  const sentToGame = [];
  const listeners = new Map();
  global.window = {
    skyrimPlatform: { sendMessage: (...a) => sentToGame.push(a) },
    addEventListener: (ev, fn) => { const l = listeners.get(ev) || []; l.push(fn); listeners.set(ev, l); },
    removeEventListener: () => {}, dispatchEvent: () => true,
    localStorage: { d: {}, getItem(k) { return this.d[k] === undefined ? null : this.d[k]; }, setItem(k, v) { this.d[k] = String(v); }, removeItem(k) { delete this.d[k]; } },
  };
  global.document = { activeElement: null, body: { appendChild() {} }, createElement: () => ({ style: {}, play: () => Promise.resolve() }) };
  global.CustomEvent = class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } };
  Object.defineProperty(global, 'navigator', { value: { mediaDevices: { enumerateDevices: async () => [] } }, configurable: true });
  // livekit-client: a Room that records, in order, what the page asks of it
  globalThis.__vhRooms = [];
  const fakeLivekit = `
    const RoomEvent = { TrackSubscribed: 'ts', TrackUnsubscribed: 'tu', ParticipantDisconnected: 'pd', ParticipantConnected: 'pc', DataReceived: 'dr', Disconnected: 'd', ActiveSpeakersChanged: 'as' };
    class Room {
      constructor() {
        this.log = []; this.handlers = {}; this.remoteParticipants = new Map(); this.activeSpeakers = []; this.connected = false;
        const room = this;
        this.localParticipant = {
          audioTrackPublications: new Map(),
          setTrackSubscriptionPermissions(all, perms) { room.log.push({ op: 'perm', all, ids: perms.map((p) => p.participantIdentity), allowAll: perms.every((p) => p.allowAll === true), connected: room.connected }); },
          publishData(payload, opts) { room.log.push({ op: 'data', msg: JSON.parse(new TextDecoder().decode(payload)), dest: opts && opts.destinationIdentities }); return Promise.resolve(); },
          setMicrophoneEnabled: async () => {}, publishTrack: async () => { throw new Error('no mic in the test'); }, unpublishTrack: async () => {},
        };
        globalThis.__vhRooms.push(this);
      }
      on(ev, fn) { this.handlers[ev] = fn; return this; }
      async connect(url, token) { this.log.push({ op: 'connect', token }); this.connected = true; }
      async startAudio() {}
      async disconnect() { this.connected = false; }
    }
    module.exports = { Room, RoomEvent, Track: { Kind: { Audio: 'audio' }, Source: { Microphone: 'microphone' } } };`;
  const realInterval = global.setInterval;
  global.setInterval = () => 0;
  const SRC = path.join(FORK, 'skymp5-front', 'src', 'utils', 'VoiceManager.js');
  await esbuild.build({ entryPoints: [SRC], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'vm.js'), logLevel: 'error', nodePaths: NM ? [NM] : [],
    loader: { '.png': 'empty', '.svg': 'empty' },
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /^livekit-client$/ }, () => ({ path: 'livekit', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: fakeLivekit, loader: 'js' }));
    } }] });
  require(path.join(out, 'vm.js'));
  global.setInterval = realInterval;
  const VM = window.__alduinakVoice.constructor;
  const MODES = [{ key: 'whisper', label: 'Whisper', units: 140 }, { key: 'talk', label: 'Talk', units: 840 }, { key: 'shout', label: 'Shout', units: 3150 }];
  const BANDS = { whisper: ['ff000002'], talk: ['ff000002', 'ff000003'], shout: ['ff000002', 'ff000003', 'ff000004'] };
  const perms = (room) => room.log.filter((e) => e.op === 'perm');
  // A page without setHearers (before this change) fails the checks after it instead of stopping the run
  const setHearers = (v, b) => (typeof v.setHearers === 'function' ? v.setHearers(b) : undefined);
  const data = (room) => room.log.filter((e) => e.op === 'data');

  // ---- connect with lists ----
  const vm = new VM();
  await vm.connect('wss://voice.test', 'jwt-a', { modes: MODES, mode: 'talk', hearers: BANDS });
  await settle();
  const room = globalThis.__vhRooms[globalThis.__vhRooms.length - 1];
  {
    const first = room.log.findIndex((e) => e.op === 'perm');
    const joined = room.log.findIndex((e) => e.op === 'connect');
    check('with lists, the page closes its voice to everyone but the talk list before it joins the room', first >= 0 && first < joined && perms(room)[0].all === false && JSON.stringify(perms(room)[0].ids) === JSON.stringify(BANDS.talk) && perms(room)[0].allowAll, room.log);
    check('...and gives LiveKit the list again once joined', perms(room).length === 2 && perms(room)[1].connected === true && JSON.stringify(perms(room)[1].ids) === JSON.stringify(BANDS.talk), perms(room));
    const d = data(room);
    check('...its range goes only to the listeners on the list', d.length >= 1 && d.every((e) => Array.isArray(e.dest) && JSON.stringify(e.dest.slice().sort()) === JSON.stringify(BANDS.talk)), d);
  }
  {
    room.log.length = 0;
    vm.setMode('whisper');
    check('whisper: the permission shrinks to the whisper list at once', perms(room).length === 1 && JSON.stringify(perms(room)[0].ids) === JSON.stringify(BANDS.whisper), perms(room));
    check('...and the new range goes to that list only', data(room).length === 1 && data(room)[0].msg.r === 140 && JSON.stringify(data(room)[0].dest) === JSON.stringify(BANDS.whisper), data(room));
    room.log.length = 0;
    vm.setMode('shout');
    check('shout: it grows to the shout list at once, no server round trip', perms(room).length === 1 && JSON.stringify(perms(room)[0].ids) === JSON.stringify(BANDS.shout), perms(room));
  }
  {
    room.log.length = 0;
    setHearers(vm, Object.assign({}, BANDS, { shout: BANDS.shout.concat('ff000005') }));
    check('a new list from the server: the permission follows', perms(room).length === 1 && perms(room)[0].ids.includes('ff000005'), perms(room));
    check('...and the newcomer alone is sent my range', data(room).length === 1 && JSON.stringify(data(room)[0].dest) === JSON.stringify(['ff000005']), data(room));
    room.log.length = 0;
    setHearers(vm, Object.assign({}, BANDS, { shout: BANDS.shout.concat('ff000005') }));
    check('...the same list again sends LiveKit nothing', room.log.length === 0, room.log);
    room.log.length = 0;
    setHearers(vm, ['not', 'a', 'list']);
    check('a malformed list closes my voice to everyone (it never opens it)', perms(room).length === 1 && perms(room)[0].ids.length === 0 && perms(room)[0].all === false, perms(room));
    vm.publishRange();
    check('...and with nobody allowed my range goes to nobody (an empty destination list would mean everyone)', data(room).length === 0, data(room));
    setHearers(vm, BANDS);
  }

  // ---- a peer's range must be one of the modes ----
  {
    const ranges = (r) => { room.handlers.dr(new TextEncoder().encode(JSON.stringify({ t: 'voiceRange', r })), { identity: 'ff000007' }); return vm.peerRanges.ff000007; };
    check('a speaker\'s range that is a mode is used', ranges(3150) === 3150);
    check('a made-up range (1e9: heard at full volume to the edge) is ignored', ranges(1e9) === 3150, vm.peerRanges);
    check('an odd range that skipped the whisper cone (141) is ignored', ranges(141) === 3150, vm.peerRanges);
  }

  // ---- a voice the speaker has not let me hear ----
  {
    const realNow = Date.now;
    let clock = 5_000_000;
    Date.now = () => clock;
    const pub = (o) => { const p = Object.assign({ calls: [], isSubscribed: false, permissionStatus: 'allowed' }, o); p.setSubscribed = (v) => { p.calls.push(v); p.isDesired = v; if (v && p.permissionStatus !== 'not_allowed' && p.deliver) p.isSubscribed = true; }; return p; };
    const refused = pub({ isDesired: true, permissionStatus: 'not_allowed' });
    const lost = pub({ isDesired: true });
    const far = pub({ isDesired: true });
    room.remoteParticipants = new Map([
      ['ff000002', { identity: 'ff000002', audioTrackPublications: new Map([['a', refused]]) }],
      ['ff000003', { identity: 'ff000003', audioTrackPublications: new Map([['b', lost]]) }],
      ['ff000004', { identity: 'ff000004', audioTrackPublications: new Map([['c', far]]) }],
    ]);
    for (let i = 0; i < 10; i++) { clock += 400; vm.setPeers({ ff000002: 100, ff000003: 100, ff000004: 99999 }); }
    check('a wanted voice LiveKit refused (not on that speaker\'s list) is not asked for again on every update', refused.calls.length === 0, refused.calls);
    check('...a wanted voice LiveKit allows but has not delivered is asked for again, every 3 s, not every 400 ms', lost.calls.length >= 1 && lost.calls.length <= 2 && lost.calls.every((v) => v === true), lost.calls);
    check('...a voice out of range is let go once', JSON.stringify(far.calls) === JSON.stringify([false]), far.calls);
    Date.now = realNow;
  }

  // ---- no lists: everything as before ----
  {
    const old = new VM();
    await old.connect('wss://voice.test', 'jwt-b', { modes: MODES, mode: 'talk' });
    await settle();
    const r = globalThis.__vhRooms[globalThis.__vhRooms.length - 1];
    check('without lists (an old server) the page never limits who may subscribe', perms(r).length === 0, perms(r));
    old.setMode('shout');
    check('...and its range goes to the whole room as before', data(r).length >= 2 && data(r).every((e) => e.dest === undefined), data(r));
  }

  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `${failures} failure(s)` : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL', e.stack || e.message); process.exit(1); });
