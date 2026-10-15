// Scripted test for ending voice on a kick or ban (security audit F3, 15 Oct): a kick or ban only closed the game
// connection, the LiveKit session stayed in the room and LiveKit kept refreshing its token. It bundles voiceSystem.ts with
// esbuild (settings stubbed with test-only LiveKit values), fakes the native server and LiveKit's RoomService (fetch), and
// checks: the session is removed when its connection ends, a sweep removes every session no online character allowed voice
// holds, a session back after two removals (a replayed token) moves voice to a new room, a banned or suspended account
// gets no token, and a token lives 10 minutes. Part 2 bundles adminSystem.ts to check the panel-ban refusal it hands the
// voice system. Nothing reaches the network. Run it from skymp5-server with node_modules present:
//
//   node tests/voice-revoke-harness.js
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-voice-revoke-'));

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const SECRET = 'test-secret';
const stubSources = {
  '../settings': 'module.exports = { Settings: { get: async () => globalThis.__voiceRevoke.settings } };',
  './npcSpawnSystem': 'module.exports = { NpcSpawnSystem: class {} };',
  './masterySystem': 'module.exports = { MasterySystem: class {}, MAX_GRANT: 0 };',
};
const stubFilter = new RegExp('^(' + Object.keys(stubSources).map((k) => k.replace(/[./-]/g, '\\$&')).join('|') + ')$');
const bundle = (entry, file) => esbuild.build({
  entryPoints: [path.join(root, 'ts', 'systems', entry)],
  bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, file), logLevel: 'error',
  plugins: [{
    name: 'stubs',
    setup(b) {
      b.onResolve({ filter: stubFilter }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubSources[a.path], loader: 'js' }));
    },
  }],
});

const voiceSettings = (extra) => ({ allSettings: { voiceChat: Object.assign({ url: 'wss://voice.test', apiKey: 'k', apiSecret: SECRET, room: 'r' }, extra) } });
globalThis.__voiceRevoke = { settings: voiceSettings({}) };

const decode = (jwt) => JSON.parse(Buffer.from(String(jwt).split('.')[1] || '', 'base64url').toString() || 'null');
const signedWith = (jwt, secret) => { const [h, p, s] = String(jwt).split('.'); return crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url') === s; };

// The native server: userId -> actor id (0 = connected, no character yet)
let conns = new Map();
let sent = [];
const mp = {
  isConnected: (u) => conns.has(u),
  getUserActor: (u) => conns.get(u) || 0,
  getUserByActor: (a) => { for (const [u, x] of conns) if (x === a) return u; return 65535; },
  sendCustomPacket: (u, p) => sent.push([u, JSON.parse(p)]),
};
const ctx = { svr: mp, gm: new EventEmitter() };

// LiveKit's RoomService over Twirp JSON
let calls = [];
// room 'r' (the settings room) and every other room by name
let room = [];
let others = {};
const roomList = (name) => (name === 'r' ? room : (others[name] = others[name] || []));
const setRoom = (name, list) => { if (name === 'r') room = list; else others[name] = list; };
let gone = new Set();
let failMode = '';
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  // auth is kept out of the failure output
  calls.push(Object.defineProperty({ url, method: String(url).split('/').pop(), body }, 'auth', { value: String(opts.headers.Authorization || ''), enumerable: false }));
  if (failMode === 'throw') {
    const e = new TypeError('fetch failed');
    e.cause = Object.assign(new Error('connect ECONNREFUSED voice-host-address'), { code: 'ECONNREFUSED' });
    throw e;
  }
  if (failMode === 'http500') return { ok: false, status: 500, json: async () => ({}) };
  // A wrong API address behind a web proxy: a 404 page, not LiveKit's Twirp not_found
  if (failMode === 'proxy404') return { ok: false, status: 404, json: async () => { throw new SyntaxError('Unexpected token <'); } };
  if (String(url).endsWith('/RemoveParticipant')) {
    if (gone.has(body.identity)) return { ok: false, status: 404, json: async () => ({ code: 'not_found' }) };
    setRoom(body.room, roomList(body.room).filter((i) => i !== body.identity));
    return { ok: true, status: 200, json: async () => ({}) };
  }
  if (String(url).endsWith('/ListParticipants')) return { ok: true, status: 200, json: async () => ({ participants: roomList(body.room).map((identity) => ({ identity, state: 'ACTIVE' })) }) };
  return { ok: false, status: 501, json: async () => ({}) };
};
const removed = () => calls.filter((c) => c.method === 'RemoveParticipant').map((c) => c.body.identity);
const listed = () => calls.filter((c) => c.method === 'ListParticipants').length;
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
const reset = () => { conns = new Map(); sent = []; calls = []; room = []; others = {}; gone = new Set(); failMode = ''; delete globalThis.__dboVoiceRefused; };
// Failure output shows whether a token was sent, never the token
const brief = (p) => (p ? { enabled: p.enabled, token: p.token ? '<token>' : undefined } : p);
const tokenFor = (u) => { const hit = sent.filter(([x, p]) => x === u && p.customPacketType === 'voiceToken').pop(); return hit ? hit[1] : null; };
const roomOf = (u) => { const t = tokenFor(u); const c = t && t.token ? decode(t.token) : null; return c && c.video ? c.video.room : ''; };
const sweep = async (sys) => { if (typeof sys.updateAsync === 'function') await sys.updateAsync(ctx); await settle(); };

let now = 1_700_000_000_000;
const realNow = Date.now;

(async () => {
  // voice-room.json is written to the working directory
  const startDir = process.cwd();
  process.chdir(out);
  await bundle('voiceSystem.ts', 'voice.js');
  await bundle('adminSystem.ts', 'admin.js');
  const { VoiceSystem } = require(path.join(out, 'voice.js'));
  Date.now = () => now;
  const make = async (refusals, settings) => {
    globalThis.__voiceRevoke.settings = settings || voiceSettings({});
    const logs = [];
    const sys = new VoiceSystem((...a) => logs.push(a.join(' ')), refusals);
    await sys.initAsync(ctx);
    return { sys, logs };
  };
  const ask = (sys, u) => { now += 2500; sys.customPacket(u, 'voiceTokenRequest', {}, ctx); };

  // ---- the token ----
  {
    reset();
    const { sys } = await make();
    conns.set(1, 0xff000001);
    ask(sys, 1);
    const t = tokenFor(1);
    const claims = t && decode(t.token);
    check('a player with a character gets a token', !!(t && t.enabled && claims), brief(t));
    check('...signed with the room secret, identity the actor id in hex', !!claims && signedWith(t.token, SECRET) && claims.sub === 'ff000001' && t.identity === 'ff000001', claims);
    check('...with the same grants as before (join, publish, subscribe, data on the one room)', !!claims && JSON.stringify(claims.video) === JSON.stringify({ roomJoin: true, room: 'r', canPublish: true, canSubscribe: true, canPublishData: true }), claims && claims.video);
    check('...living 10 minutes at most, not an hour', !!claims && claims.exp - claims.iat <= 600 && claims.exp - claims.iat >= 300, claims && claims.exp - claims.iat);
  }

  // ---- the session ends with the game connection (every kick and ban ends in a disconnect) ----
  {
    reset();
    const { sys, logs } = await make();
    conns.set(1, 0xff000001);
    ask(sys, 1);
    room = ['ff000001'];
    conns.delete(1);
    sys.disconnect(1, ctx);
    await settle();
    check('a kicked or banned player\'s voice session is removed when the connection ends', removed().join() === 'ff000001', calls);
    const call = calls[0] || {};
    check('...through RoomService RemoveParticipant on the voice host over https', call.url === 'https://voice.test/twirp/livekit.RoomService/RemoveParticipant' && JSON.stringify(call.body) === JSON.stringify({ room: 'r', identity: 'ff000001' }), call);
    const bearer = String(call.auth || '').replace(/^Bearer /, '');
    const admin = bearer ? decode(bearer) : null;
    check('...signed with an admin token for this room alone, which cannot join it and lives a minute', !!admin && signedWith(bearer, SECRET) && admin.iss === 'k'
      && JSON.stringify(admin.video) === JSON.stringify({ roomAdmin: true, room: 'r' }) && admin.exp - admin.nbf <= 70, admin);
    check('...and the removal is logged with the actor id', logs.some((l) => /removed voice participant ff000001/.test(l)), logs);

    calls = [];
    conns.set(2, 0xff000002);
    ask(sys, 2);
    conns.set(5, 0xff000002);
    conns.delete(2);
    sys.disconnect(2, ctx);
    await settle();
    check('a relog that already holds the character on a new connection keeps its voice', removed().length === 0, calls);

    calls = [];
    conns.set(3, 0xff000003);
    conns.delete(3);
    sys.disconnect(3, ctx);
    await settle();
    check('a player who never asked for voice costs no call', calls.length === 0, calls);

    calls = [];
    const before = logs.length;
    conns.set(4, 0xff000004);
    ask(sys, 4);
    gone.add('ff000004');
    conns.delete(4);
    sys.disconnect(4, ctx);
    await settle();
    check('a session that already left (404) is asked for once and not logged as removed', removed().join() === 'ff000004' && !logs.slice(before).some((l) => /removed voice participant/.test(l)), logs.slice(before));
  }

  // ---- the sweep: a kicked or banned player back in voice with an old or LiveKit-refreshed token ----
  {
    reset();
    const refusals = [(_mp, u) => (u === 2 ? 'banned in the admin panel' : '')];
    const { sys, logs } = await make(refusals);
    conns.set(1, 0xff000001);
    conns.set(2, 0xff000002);
    conns.set(6, 0);
    room = ['ff000001', 'ff000002', 'ff000009', 'ff000006'];
    await sweep(sys);
    check('the sweep lists the room', listed() === 1, calls);
    check('...removes a banned player who rejoined with a token they kept (no character online)', removed().includes('ff000009'), removed());
    check('...removes an online player whose account is refused voice', removed().includes('ff000002'), removed());
    check('...removes a session whose player has no character in the world', removed().includes('ff000006'), removed());
    check('...and keeps an online player allowed voice', !removed().includes('ff000001') && room.includes('ff000001'), room);
    check('...each removal logged', ['ff000009', 'ff000002', 'ff000006'].every((i) => logs.some((l) => l.includes(`removed voice participant ${i}`))), logs);

    calls = [];
    await sweep(sys);
    check('the next sweep waits its interval', listed() === 0, calls);
    now += 15000;
    room.push('ff000009');
    await sweep(sys);
    check('...15 s later it runs again and removes the rejoined session again', listed() === 1 && removed().join() === 'ff000009', calls);

    calls = [];
    globalThis.__dboVoiceRefused = (a) => (a === 0xff000001 ? 'suspended' : '');
    now += 15000;
    await sweep(sys);
    check('the gamemode\'s refusal hook (a suspension) is honoured by the sweep', removed().join() === 'ff000001', removed());
  }

  // ---- no token for a banned or suspended account ----
  {
    reset();
    const refusals = [(_mp, u) => (u === 2 ? 'banned in the admin panel' : '')];
    const { sys, logs } = await make(refusals);
    conns.set(1, 0xff000001);
    conns.set(2, 0xff000002);
    conns.set(3, 0xff000003);
    globalThis.__dboVoiceRefused = (a) => (a === 0xff000003 ? 'suspended' : '');
    ask(sys, 1); ask(sys, 2); ask(sys, 3);
    check('an allowed player still gets a token', !!tokenFor(1) && tokenFor(1).enabled === true, brief(tokenFor(1)));
    check('a panel-banned player gets no token, only "voice off"', !!tokenFor(2) && tokenFor(2).enabled === false && !tokenFor(2).token, brief(tokenFor(2)));
    check('a suspended player (the gamemode hook) gets no token, only "voice off"', !!tokenFor(3) && tokenFor(3).enabled === false && !tokenFor(3).token, brief(tokenFor(3)));
    check('...each refusal logged with the reason', logs.some((l) => /ff000002.*banned in the admin panel/.test(l)) && logs.some((l) => /ff000003.*suspended/.test(l)), logs);
    ask(sys, 2);
    check('a refused player asking again is refused again (its refresh)', sent.filter(([u, p]) => u === 2 && p.customPacketType === 'voiceToken').every(([, p]) => p.enabled === false), sent.filter(([u]) => u === 2).map(([, p]) => brief(p)));
    globalThis.__dboVoiceRefused = () => { throw new Error('broken reload'); };
    sent = [];
    ask(sys, 3);
    check('a refusal hook that throws refuses nothing', !!tokenFor(3) && tokenFor(3).enabled === true, brief(tokenFor(3)));
  }

  // ---- a scripted rejoin: LiveKit hands every join a fresh token, so removing alone never ends it; voice moves room ----
  {
    reset();
    const refusals = [(_mp, u) => (u === 4 ? 'banned in the admin panel' : '')];
    const { sys, logs } = await make(refusals);
    [1, 2, 3, 4, 9].forEach((u) => conns.set(u, 0xff000000 + u));
    ask(sys, 1); ask(sys, 2); ask(sys, 9);
    room = ['ff000001', 'ff000002', 'ff000009'];
    conns.delete(9);
    sys.disconnect(9, ctx);
    await settle();
    now += 15000; room.push('ff000009'); await sweep(sys);
    check('a banned player back once is removed again, and voice stays in its room', removed().filter((i) => i === 'ff000009').length === 2 && !logs.some((l) => /voice moved/.test(l)), logs);
    sent = [];
    now += 15000; room.push('ff000009'); await sweep(sys);
    const moved = logs.find((l) => /voice moved from 'r' to/.test(l)) || '';
    const newRoom = (/to '([^']+)'/.exec(moved) || [])[1] || '';
    check('back a second time (a replayed token): voice moves to a new room', /^r-[0-9a-z]+$/.test(newRoom) && /ff000009 keeps rejoining/.test(moved), logs);
    check('...every online player who uses voice is sent a token for it at once', !!newRoom && roomOf(1) === newRoom && roomOf(2) === newRoom && (tokenFor(1) || {}).room === newRoom, [roomOf(1), roomOf(2)]);
    check('...nobody who never asked for voice, nor a refused account, nor the replayer', !tokenFor(3) && !tokenFor(4) && !tokenFor(9), sent.map(([u, p]) => [u, brief(p)]));
    check('...the replayer is removed from the old room', calls.some((c) => c.method === 'RemoveParticipant' && c.body.identity === 'ff000009' && c.body.room === 'r'), calls);
    const kept = (() => { try { return JSON.parse(fs.readFileSync(path.join(out, 'voice-room.json'), 'utf8')); } catch (e) { return null; } })();
    check('...and the new room is kept in voice-room.json', !!kept && kept.base === 'r' && kept.room === newRoom, kept);
    // 2 switched rooms; 1 missed its token and is still in the old room
    others[newRoom] = ['ff000002']; room = ['ff000001'];
    calls = [];
    now += 15000; await sweep(sys);
    const lists = calls.filter((c) => c.method === 'ListParticipants');
    check('the sweep now watches the new room, with an admin token for it', !!newRoom && (lists[0] || {}).body?.room === newRoom && (decode(String((lists[0] || {}).auth || '').replace(/^Bearer /, '')) || {}).video?.room === newRoom, lists.map((c) => c.body));
    check('after a 10 s grace the old room is emptied: a client that missed its token is removed and asks again', calls.some((c) => c.method === 'RemoveParticipant' && c.body.identity === 'ff000001' && c.body.room === 'r'), calls);
    check('...and nobody allowed is removed from the new room', !!newRoom && !calls.some((c) => c.method === 'RemoveParticipant' && c.body.room === newRoom), calls);
    sent = [];
    ask(sys, 1);
    check('a token asked for after the move opens the new room', !!newRoom && roomOf(1) === newRoom, roomOf(1));
    calls = [];
    now += 120000; await sweep(sys);
    check('two minutes on, the old room is left alone', listed() >= 1 && !calls.some((c) => c.body.room === 'r'), calls);
    const again = await make(refusals);
    sent = [];
    ask(again.sys, 2);
    check('after a restart voice stays in the moved room, so the old room\'s tokens stay shut out', !!newRoom && roomOf(2) === newRoom, roomOf(2));
    fs.writeFileSync(path.join(out, 'voice-room.json'), JSON.stringify({ base: 'other', room: 'other-x' }));
    const fresh = await make(refusals);
    sent = [];
    ask(fresh.sys, 2);
    check('...but a file kept for another base room is ignored', roomOf(2) === 'r', roomOf(2));
    fs.rmSync(path.join(out, 'voice-room.json'), { force: true });
  }
  {
    reset();
    const { sys, logs } = await make([], voiceSettings({ moveRoomOnReplay: false }));
    for (let i = 0; i < 4; i++) { now += 15000; room = ['ff000009']; await sweep(sys); }
    check('moveRoomOnReplay false: a replayer is only removed, every time', removed().length === 4 && !logs.some((l) => /voice moved/.test(l)), logs);
  }
  {
    reset();
    const { sys, logs } = await make();
    now += 15000; room = ['ff000005']; await sweep(sys);
    now += 15000; room = ['ff000005']; await sweep(sys);
    conns.set(5, 0xff000005);
    now += 15000; room = ['ff000005']; await sweep(sys);
    conns.delete(5);
    now += 15000; room = ['ff000005']; await sweep(sys);
    check('a player allowed voice again starts with no removals counted: no move', removed().length === 3 && !logs.some((l) => /voice moved/.test(l)), logs);
  }
  // ---- a replayer that steps out of the room around each sweep it expects, timed from its last removal ----
  {
    reset();
    const { sys, logs } = await make();
    let caughtAt = -1, heard = 0, ticks = 0;
    const movedOut = () => logs.some((l) => /voice moved/.test(l));
    for (let t = 0; t < 10 * 60 * 1000 && !movedOut(); t += 250) {
      now += 250; ticks++;
      // Out for a second around every whole sweep interval after its last removal, in the rest of the time
      const phase = caughtAt < 0 ? 7000 : (now - caughtAt) % 15000;
      const wantIn = phase > 500 && phase < 14500;
      if (wantIn && !room.includes('ff000009')) room.push('ff000009');
      if (!wantIn) room = room.filter((i) => i !== 'ff000009');
      const before = removed().length;
      await sweep(sys);
      if (removed().length > before) caughtAt = now;
      if (room.includes('ff000009')) heard++;
    }
    check('a replayer that times its exits around each sweep is still caught: voice moves within 10 minutes', movedOut(), { heardShare: Math.round((heard / ticks) * 100) / 100, removals: removed().length });
    fs.rmSync(path.join(out, 'voice-room.json'), { force: true });
  }
  {
    reset();
    const { sys, logs } = await make();
    for (let i = 0; i < 3; i++) { now += 20 * 60 * 1000; room = ['ff000009']; await sweep(sys); }
    check('a replayer that waits 20 minutes between rejoins is still counted: voice moves on its third', logs.some((l) => /ff000009 keeps rejoining/.test(l)), logs);
    fs.rmSync(path.join(out, 'voice-room.json'), { force: true });
  }

  // ---- settings and failures ----
  {
    reset();
    const { sys } = await make([], voiceSettings({ apiUrl: 'http://livekit.internal:7880/' }));
    conns.set(1, 0xff000001);
    ask(sys, 1);
    conns.delete(1);
    sys.disconnect(1, ctx);
    await settle();
    check('voiceChat.apiUrl sets the server API base', (calls[0] || {}).url === 'http://livekit.internal:7880/twirp/livekit.RoomService/RemoveParticipant', calls);

    reset();
    const off = await make([], voiceSettings({ sweepSeconds: 0 }));
    room = ['ff000009'];
    now += 60000;
    await sweep(off.sys);
    check('sweepSeconds 0 turns the sweep off', calls.length === 0, calls);

    reset();
    const disabled = await make([], voiceSettings({ apiKey: '' }));
    conns.set(1, 0xff000001);
    disabled.sys.customPacket(1, 'voiceTokenRequest', {}, ctx);
    disabled.sys.disconnect(1, ctx);
    now += 60000;
    await sweep(disabled.sys);
    check('with voice off nothing calls LiveKit', calls.length === 0, calls);

    reset();
    const { sys: s2, logs } = await make();
    failMode = 'throw';
    room = ['ff000009'];
    now += 60000;
    let threw = false;
    try { await sweep(s2); now += 15000; await sweep(s2); } catch (e) { threw = true; }
    const fails = logs.filter((l) => /LiveKit server API/.test(l));
    check('an unreachable LiveKit is logged once per outage and never throws', !threw && fails.length === 1 && listed() === 2, { threw, fails, n: listed() });
    check('...the log line names the error code, never the address', fails.length === 1 && /ECONNREFUSED/.test(fails[0]) && !/voice-host-address|voice\.test/.test(fails[0]), fails);
    failMode = '';
    now += 15000;
    await sweep(s2);
    check('...and says when it answers again', logs.some((l) => /answers again/.test(l)) && removed().includes('ff000009'), logs);
    failMode = 'http500';
    now += 15000;
    room = ['ff000009'];
    await sweep(s2);
    check('an HTTP error is logged the same way', logs.filter((l) => /LiveKit server API call ListParticipants answered HTTP 500/.test(l)).length === 1, logs);

    reset();
    const p404 = await make();
    failMode = 'proxy404';
    conns.set(1, 0xff000001);
    ask(p404.sys, 1);
    conns.delete(1);
    p404.sys.disconnect(1, ctx);
    await settle();
    now += 60000; room = ['ff000009']; await sweep(p404.sys);
    check('a 404 that is not LiveKit\'s not_found (a wrong API address) is logged as a failure, not taken as "already left"', p404.logs.filter((l) => /LiveKit server API call (RemoveParticipant|ListParticipants) answered HTTP 404/.test(l)).length === 1, p404.logs);

    reset();
    const first = await make();
    now += 60000; await sweep(first.sys);
    now += 15000; room = ['ff000009']; await sweep(first.sys);
    check('the first answer of the LiveKit server API is logged once, so a restart shows it is reachable', first.logs.filter((l) => /the LiveKit server API answers$/.test(l)).length === 1, first.logs);
  }

  // ---- part 2: the admin panel's ban list refuses voice (adminSystem.ts) and index.ts wires it in ----
  {
    const cwd = process.cwd();
    process.chdir(out);
    fs.writeFileSync(path.join(out, 'admin-powers.json'), JSON.stringify({ spells: [], shouts: [], werewolf: '' }));
    fs.writeFileSync(path.join(out, 'admin-bans.json'), JSON.stringify({ bans: [{ id: 'b1', profileId: 77, name: 'Banned', ip: '', until: now + 3600000, reason: 'test', by: 'test', at: now }] }));
    globalThis.__voiceRevoke.settings = { name: 'test', master: '', masterKey: '', allSettings: {} };
    const { AdminSystem } = require(path.join(out, 'admin.js'));
    const props = { [0xff000077]: { profileId: 77 }, [0xff000078]: { profileId: 78 } };
    const amp = Object.assign({}, mp, {
      getUserIp: () => '',
      get: (a, p) => (props[a] || {})[p],
      set() {},
      kick() {},
      setEnabled() {},
      getIdFromDesc: () => 0,
    });
    const admin = new AdminSystem(() => {}, {}, {});
    await admin.initAsync({ svr: amp, gm: new EventEmitter() });
    const refusal = typeof admin.voiceRefusal === 'function' ? admin.voiceRefusal.bind(admin) : () => 'missing';
    check('AdminSystem refuses voice to a character whose profile is banned in the panel', typeof admin.voiceRefusal === 'function' && /banned/.test(refusal(amp, 7, 0xff000077)), typeof admin.voiceRefusal);
    check('...and not to anyone else', typeof admin.voiceRefusal === 'function' && refusal(amp, 8, 0xff000078) === '', refusal(amp, 8, 0xff000078));
    process.chdir(cwd);
    const index = fs.readFileSync(path.join(root, 'ts', 'index.ts'), 'utf8');
    check('index.ts hands the voice system the same AdminSystem\'s refusal', /const adminSystem = new AdminSystem\(/.test(index) && /systems\.push\([\s\S]*?\n\s+adminSystem,/.test(index)
      && /new VoiceSystem\(log,[\s\S]{0,120}adminSystem\.voiceRefusal\(/.test(index));
  }

  Date.now = realNow;
  process.chdir(startDir);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL the harness threw', e); try { fs.rmSync(out, { recursive: true, force: true }); } catch (_) { } process.exit(1); });
