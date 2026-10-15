// Scripted test for voice hearing lists (security audit F2 with L2-3 and L4-4, 15 Oct): every token could subscribe to every
// voice in the one room and range lived only in the listener's page, so a modified client heard the whole server. The
// server now lists, per voice mode, who may hear each updated client, from its own actor positions; the client's page
// makes that list its LiveKit track subscription permissions. It bundles voiceSystem.ts with esbuild (settings stubbed),
// fakes the native server and LiveKit's RoomService (fetch), and checks: the lists by mode, cell and range with hysteresis,
// Invisible staff heard only by staff who see them, banned and never-asked players on no list, old clients untouched,
// the hearingLists and allowOldClients switches, the report line, and that a slow sweep does not hold up the lists. Part 2
// measures the cost at 30 players. Nothing reaches the network. Run it from skymp5-server with node_modules present:
//
//   node tests/voice-hearing-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-voice-hearing-'));

let failures = 0;
let finished = false;
// A promise that never settles ends node quietly with code 0; that is a failure here
process.on('beforeExit', () => { if (!finished) { console.log('FAIL the harness stopped before its end'); process.exit(1); } });
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 500) : ''}`); if (!ok) failures++; };

const stubSources = { '../settings': 'module.exports = { Settings: { get: async () => globalThis.__voiceHearing.settings } };' };
const voiceSettings = (extra) => ({ allSettings: { voiceChat: Object.assign({ url: 'wss://voice.test', apiKey: 'k', apiSecret: 'test-secret', room: 'r', sweepSeconds: 0 }, extra) } });
globalThis.__voiceHearing = { settings: voiceSettings({}) };
const decode = (jwt) => JSON.parse(Buffer.from(String(jwt).split('.')[1] || '', 'base64url').toString() || 'null');

// The native server: userId -> actor id, actor id -> place and properties
let conns, actors, sent, throwProps;
const mp = {
  isConnected: (u) => conns.has(u),
  getUserActor: (u) => conns.get(u) || 0,
  getUserByActor: (a) => { for (const [u, x] of conns) if (x === a) return u; return 65535; },
  getActorPos: (a) => actors.get(a).pos.slice(),
  getActorCellOrWorld: (a) => actors.get(a).cell,
  get: (a, k) => { if (throwProps.has(k)) throw new Error(`no property ${k}`); const x = actors.get(a); return x ? x.props[k] : undefined; },
  sendCustomPacket: (u, p) => sent.push([u, JSON.parse(p)]),
};
const ctx = { svr: mp, gm: new EventEmitter() };

// LiveKit's RoomService: ListParticipants answers an empty room; hang = never answers (a LiveKit that stopped responding)
let calls, hang;
globalThis.fetch = async (url, opts) => {
  calls.push(String(url).split('/').pop());
  if (hang) return new Promise(() => {});
  if (String(url).endsWith('/ListParticipants')) return { ok: true, status: 200, json: async () => ({ participants: [] }) };
  return { ok: true, status: 200, json: async () => ({}) };
};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
const reset = () => { conns = new Map(); actors = new Map(); sent = []; calls = []; hang = false; throwProps = new Set(); };

let now = 1_700_000_000_000;
const realNow = Date.now;
const W = 0x3c; // Tamriel
const id = (n) => 0xff000000 + n;
const hex = (n) => id(n).toString(16);
// A player on user slot n with actor ff0000nn at x, in a cell
const place = (n, x, cell = W, props = {}) => { conns.set(n, id(n)); actors.set(id(n), { pos: [x, 0, 0], cell, props: Object.assign({ profileId: n }, props) }); };
const move = (n, x, y = 0) => { actors.get(id(n)).pos = [x, y, 0]; };
const packets = (u, type) => sent.filter(([x, p]) => x === u && p.customPacketType === type).map(([, p]) => p);
const lastToken = (u) => packets(u, 'voiceToken').pop() || null;
// No lists (a server without them) reads as empty ones, so every check still runs and reports
const EMPTY = () => ({ whisper: [], talk: [], shout: [] });
const hearersOf = (t) => (t && t.hearers) || EMPTY();
const lastBands = (u) => { const h = packets(u, 'voiceHearers').pop(); return h ? h.bands : hearersOf(lastToken(u)); };

(async () => {
  reset();
  const startDir = process.cwd();
  process.chdir(out);
  await esbuild.build({
    entryPoints: [path.join(root, 'ts', 'systems', 'voiceSystem.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'voice.js'), logLevel: 'error',
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /^\.\.\/settings$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubSources[a.path], loader: 'js' }));
    } }],
  });
  const { VoiceSystem } = require(path.join(out, 'voice.js'));
  Date.now = () => now;
  const banned = new Set();
  const make = async (extra) => {
    globalThis.__voiceHearing.settings = voiceSettings(extra || {});
    const logs = [];
    const sys = new VoiceSystem((...a) => logs.push(a.join(' ')), [(m, u, a) => (banned.has(a) ? 'banned in the admin panel' : '')]);
    await sys.initAsync(ctx);
    return { sys, logs };
  };
  const ask = (sys, u, caps) => { now += 2500; sys.customPacket(u, 'voiceTokenRequest', caps ? { caps } : {}, ctx); };
  const tick = async (sys, ms = 500) => { now += ms; await Promise.race([sys.updateAsync(ctx), new Promise((r) => setTimeout(r, 300))]); await settle(); };
  const UPDATED = { identityV2: true, hearingLists: 1 };

  // ---- an old client: the same token as before ----
  {
    reset();
    const { sys } = await make();
    place(1, 0); place(2, 100);
    ask(sys, 1); ask(sys, 2);
    await tick(sys);
    const t = lastToken(1);
    check('an old client (no hearingLists capability) gets a token with the same grants as before', !!t && JSON.stringify(decode(t.token).video) === JSON.stringify({ roomJoin: true, room: 'r', canPublish: true, canSubscribe: true, canPublishData: true }), t && decode(t.token).video);
    check('...and no lists, in the token or after it', t && !('hearers' in t) && packets(1, 'voiceHearers').length === 0, t && Object.keys(t));
  }

  // ---- an updated client: one list per mode, from the server's positions ----
  reset();
  let h = await make();
  // speaker 1 at 0; whisper reaches 140 x 1.15 + 350 = 511, talk 840 x 1.15 + 350 = 1316, shout 3150 x 1.15 + 350 = 3972.5
  place(1, 0); place(2, 100); place(3, 1000); place(4, 3000); place(5, 5000); place(6, 50, 0x1234); place(7, 60); place(8, 70);
  banned.add(id(8));
  for (const u of [2, 3, 4, 5, 6, 8]) ask(h.sys, u);
  ask(h.sys, 1, UPDATED);
  {
    const t = lastToken(1);
    const b = hearersOf(t);
    check('an updated client\'s token carries its lists, so its page is closed before it publishes', !!(t && t.hearers) && typeof t.hearers === 'object', t && Object.keys(t));
    check('...whisper: only the player 100 units away', !!b && JSON.stringify(b.whisper) === JSON.stringify([hex(2)]), b);
    check('...talk: also the one at 1000', !!b && JSON.stringify(b.talk) === JSON.stringify([hex(2), hex(3)].sort()), b);
    check('...shout: also the one at 3000, not the one at 5000', !!b && JSON.stringify(b.shout) === JSON.stringify([hex(2), hex(3), hex(4)].sort()), b);
    check('...never a player in another cell, however close', !!b && !Object.values(b).some((l) => l.includes(hex(6))), b);
    check('...never one who never asked for voice (no token), nor a banned account', !!b && !Object.values(b).some((l) => l.includes(hex(7)) || l.includes(hex(8))), b);
    check('...and the token grants are unchanged (LiveKit cannot grant per pair from the server)', !!t && JSON.stringify(decode(t.token).video) === JSON.stringify({ roomJoin: true, room: 'r', canPublish: true, canSubscribe: true, canPublishData: true }), t && decode(t.token).video);
  }
  {
    const before = packets(1, 'voiceHearers').length;
    await tick(h.sys);
    check('no change, no packet', packets(1, 'voiceHearers').length === before, packets(1, 'voiceHearers'));
    move(5, 3500);
    now += 100; await h.sys.updateAsync(ctx);
    check('a move is not looked at before hearingTickMs has passed', packets(1, 'voiceHearers').length === before);
    await tick(h.sys);
    const p = packets(1, 'voiceHearers');
    check('the player walking from 5000 to 3500 joins the shout list, in one packet', p.length === before + 1 && p[p.length - 1].bands.shout.includes(hex(5)) && !p[p.length - 1].bands.talk.includes(hex(5)), p.slice(before));
    check('...the other players get no packet for it (they are old clients)', [2, 3, 4, 5].every((u) => packets(u, 'voiceHearers').length === 0));
  }
  {
    // hysteresis: on the shout list at 3500; stays until 3972.5 x 1.2 = 4767
    move(5, 4500); await tick(h.sys);
    check('a listener already on a list stays on it a little past the edge (4500)', lastBands(1).shout.includes(hex(5)), lastBands(1));
    place(9, 4500); ask(h.sys, 9); await tick(h.sys);
    check('...but a new listener at the same distance is not let on', !lastBands(1).shout.includes(hex(9)), lastBands(1));
    move(5, 4800); await tick(h.sys);
    check('...and is taken off past 1.2 x the edge (4800)', !lastBands(1).shout.includes(hex(5)), lastBands(1));
  }
  {
    // the listener at 1000 leaves the game
    conns.delete(3); h.sys.disconnect(3, ctx);
    await tick(h.sys);
    check('a listener who leaves is taken off every list', !Object.values(lastBands(1)).some((l) => l.includes(hex(3))), lastBands(1));
    banned.add(id(2));
    now += 10_000; await tick(h.sys);
    check('a listener banned while online is taken off within 10 s', !Object.values(lastBands(1)).some((l) => l.includes(hex(2))), lastBands(1));
    banned.delete(id(2));
    const n = sent.length;
    conns.delete(1); h.sys.disconnect(1, ctx);
    place(2, 0); await tick(h.sys); await tick(h.sys);
    check('the speaker gone: nothing more is sent to its slot', !sent.slice(n).some(([u]) => u === 1), sent.slice(n));
  }

  // ---- Invisible staff: heard only by staff who may see them ----
  {
    reset();
    const { sys } = await make();
    place(1, 0, W, { ff_adminModes: { invis: true } });
    place(2, 100); place(3, 200, W, { isAdmin: true }); place(4, 300, W, { ff_adminModes: { rank: 3 } });
    for (const u of [2, 3, 4]) ask(sys, u);
    ask(sys, 1, UPDATED);
    let b = hearersOf(lastToken(1));
    check('an Invisible staff member is not on any player\'s list: nobody without staff rank may hear them', !Object.values(b).some((l) => l.includes(hex(2))), b);
    check('...staff (isAdmin, rank 1) and higher ranks hear them', b.talk.includes(hex(3)) && b.talk.includes(hex(4)), b);
    actors.get(id(1)).props.ff_adminModes = { invis: true, rank: 3 };
    await tick(sys);
    b = lastBands(1);
    check('a rank 3 Invisible member is heard only by rank 3 and up', b.talk.includes(hex(4)) && !b.talk.includes(hex(3)) && !b.talk.includes(hex(2)), b);
    actors.get(id(1)).props.ff_adminModes = { invis: false };
    await tick(sys);
    b = lastBands(1);
    check('...and by everyone near once visible again', [2, 3, 4].every((n) => b.talk.includes(hex(n))), b);
    // Invisible staff as listeners still hear the players near them
    actors.get(id(3)).props.ff_adminModes = { invis: true };
    place(5, 50); ask(sys, 5, UPDATED);
    b = hearersOf(lastToken(5));
    check('an Invisible staff member nearby still hears players (is on their lists)', b.talk.includes(hex(3)), b);
  }
  {
    reset();
    const { sys, logs } = await make();
    throwProps.add('ff_adminModes');
    place(1, 0); place(2, 100); ask(sys, 2); ask(sys, 1, UPDATED);
    await tick(sys); await tick(sys);
    check('a property the gamemode never registered is read once, logged once, and the lists still go out', logs.filter((l) => /cannot read ff_adminModes/.test(l)).length === 1 && lastBands(1).whisper.includes(hex(2)), logs);
  }

  // ---- the switches ----
  {
    reset();
    const { sys, logs } = await make({ hearingLists: false });
    place(1, 0); place(2, 100); ask(sys, 2); ask(sys, 1, UPDATED);
    await tick(sys); await tick(sys);
    check('hearingLists false: an updated client gets no lists, its voice is open to the room as before', !('hearers' in lastToken(1)) && packets(1, 'voiceHearers').length === 0, Object.keys(lastToken(1)));
    check('...and the start-up line says so', logs.some((l) => /hearing lists off \(every voice open to the room\)/.test(l)), logs);
  }
  {
    reset();
    const { sys, logs } = await make({ allowOldClients: 'listen' });
    place(1, 0); place(2, 100); ask(sys, 1, UPDATED); ask(sys, 2);
    const old = decode(lastToken(2).token).video;
    check('allowOldClients "listen": an old client may listen but not talk or send data', old.canSubscribe === true && old.canPublish === false && old.canPublishData === false, old);
    await tick(sys);
    check('...it is still on the lists of updated speakers near it, so it hears them', lastBands(1).whisper.includes(hex(2)), lastBands(1));
    check('...an updated client keeps every grant', decode(lastToken(1).token).video.canPublish === true, decode(lastToken(1).token).video);
    check('...and the start-up line says so', logs.some((l) => /old clients listen only/.test(l)), logs);
  }
  {
    reset();
    const { sys, logs } = await make({ allowOldClients: false });
    place(1, 0); place(2, 100); ask(sys, 1, UPDATED); ask(sys, 2);
    check('allowOldClients false: an old client gets "voice off", no token', lastToken(2).enabled === false && !lastToken(2).token, lastToken(2));
    check('...logged with the reason', logs.some((l) => /ff000002\): an old client without hearing lists/.test(l)), logs);
    check('...an updated client still gets voice', lastToken(1).enabled === true && !!lastToken(1).token);
    check('...and the refused old client is on no list', !Object.values(hearersOf(lastToken(1))).some((l) => l.includes(hex(2))), hearersOf(lastToken(1)));
    now += 15 * 60 * 1000; await tick(sys);
    check('every 15 min: how many online players hold a token on updated and on old clients, and old ones refused', logs.some((l) => /online players with a voice token: 1 on updated clients, 0 on old clients \(0 open voice, 0 listen only\); 1 old client\(s\) refused voice in the last 15 min/.test(l)), logs.filter((l) => /online players/.test(l)));
  }
  {
    reset();
    const { sys, logs } = await make({ hearingLists: false, allowOldClients: false });
    place(2, 100); ask(sys, 2);
    check('allowOldClients is ignored while hearing lists are off (nobody would be protected by it)', lastToken(2).enabled === true && decode(lastToken(2).token).video.canPublish === true, lastToken(2) && lastToken(2).enabled);
  }
  {
    reset();
    const { sys, logs } = await make();
    place(1, 0); place(2, 100); place(3, 200); ask(sys, 1, UPDATED); ask(sys, 2); ask(sys, 3);
    now += 15 * 60 * 1000; await tick(sys);
    check('the 15 min line counts open-voice old clients too', logs.some((l) => /1 on updated clients, 2 on old clients \(2 open voice, 0 listen only\)/.test(l)), logs.filter((l) => /online players/.test(l)));
  }

  // ---- a LiveKit that stops answering does not hold up the lists ----
  {
    reset();
    const { sys } = await make({ sweepSeconds: 15 });
    place(1, 0); place(2, 5000); ask(sys, 2); ask(sys, 1, UPDATED);
    hang = true;
    now += 20_000;
    // A real timer: Date.now is faked, setTimeout is not
    const returned = await Promise.race([sys.updateAsync(ctx).then(() => true), new Promise((r) => setTimeout(() => r(false), 300))]);
    await settle();
    check('the voice loop returns while a LiveKit API call hangs (the sweep is not awaited)', returned === true);
    const swept = calls.length;
    move(2, 100);
    await tick(sys); await tick(sys);
    check('a sweep stuck on a LiveKit API call does not stop the lists: a player walking up is let on', swept >= 1 && lastBands(1).whisper.includes(hex(2)), { swept, bands: lastBands(1) });
    now += 20_000;
    await Promise.race([sys.updateAsync(ctx), new Promise((r) => setTimeout(r, 300))]); await settle();
    check('...and no second sweep starts while the first one is stuck', calls.length === swept, calls);
  }

  // ---- part 2: the cost at 30 players ----
  const simulate = async (label, area, cells) => {
    reset();
    const { sys } = await make({ sweepSeconds: 15 });
    const rnd = (() => { let x = 12345; return () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();
    const walkers = [];
    for (let n = 1; n <= 30; n++) {
      place(n, rnd() * area, cells[n % cells.length]);
      actors.get(id(n)).pos[1] = rnd() * area;
      walkers.push({ n, vx: 0, vy: 0, turnAt: 0 });
      ask(sys, n, UPDATED);
    }
    const startPackets = sent.length;
    calls = [];
    const SECONDS = 600;
    let ticks = 0, worst = 0, totalMs = 0, perTickMax = 0, bytes = 0;
    // A page sends LiveKit one permission update when the list for its own mode changes
    const lastKey = { talk: new Map(), shout: new Map() };
    const perms = { talk: 0, shout: 0 };
    // Today: a listener page flips its own subscription when a talking speaker crosses 840 x 1.15
    const wantedToday = new Map();
    let flipsToday = 0;
    for (let t = 0; t < SECONDS * 2; t++) {
      for (const w of walkers) {
        if (now >= w.turnAt) {
          // stand, walk (~120 u/s), run (~370 u/s) or sprint (~560 u/s), turning every 2-10 s
          const speed = [0, 0, 120, 120, 370, 560][Math.floor(rnd() * 6)];
          const a = rnd() * Math.PI * 2;
          w.vx = Math.cos(a) * speed; w.vy = Math.sin(a) * speed; w.turnAt = now + 2000 + rnd() * 8000;
        }
        const p = actors.get(id(w.n)).pos;
        p[0] = Math.min(area, Math.max(0, p[0] + w.vx * 0.5)); p[1] = Math.min(area, Math.max(0, p[1] + w.vy * 0.5));
      }
      const before = sent.length;
      now += 500;
      const t0 = process.hrtime.bigint();
      await sys.updateAsync(ctx);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      await settle();
      ticks++; totalMs += ms; worst = Math.max(worst, ms); perTickMax = Math.max(perTickMax, sent.length - before);
      for (const [u, p] of sent.slice(before)) {
        if (p.customPacketType !== 'voiceHearers') continue;
        bytes += JSON.stringify(p).length;
        for (const m of ['talk', 'shout']) { const k = p.bands[m].join(); if (lastKey[m].has(u) && lastKey[m].get(u) !== k) perms[m]++; lastKey[m].set(u, k); }
      }
      for (const a of walkers) for (const b of walkers) {
        if (a === b) continue;
        const pa = actors.get(id(a.n)), pb = actors.get(id(b.n));
        const want = pa.cell === pb.cell && Math.hypot(pa.pos[0] - pb.pos[0], pa.pos[1] - pb.pos[1]) <= 840 * 1.15;
        const key = a.n * 100 + b.n;
        if (wantedToday.has(key) && wantedToday.get(key) !== want) flipsToday++;
        wantedToday.set(key, want);
      }
    }
    const lists = sent.slice(startPackets).filter(([, p]) => p.customPacketType === 'voiceHearers').length;
    const r = { label, players: 30, seconds: SECONDS, listPacketsPerSecond: +(lists / SECONDS).toFixed(2), listPacketsMaxInOneTick: perTickMax,
      listBytesPerSecond: Math.round(bytes / SECONDS), liveKitApiCallsPerSecond: +(calls.length / SECONDS).toFixed(3),
      permissionUpdatesPerSecondAllTalking: +(perms.talk / SECONDS).toFixed(2), permissionUpdatesPerSecondAllShouting: +(perms.shout / SECONDS).toFixed(2),
      todaySubscribeFlipsPerSecondAllTalking: +(flipsToday / SECONDS).toFixed(2),
      msPerTickAverage: +(totalMs / ticks).toFixed(3), msPerTickWorst: +worst.toFixed(2) };
    console.log('cost ' + JSON.stringify(r));
    return r;
  };
  const town = await simulate('town: 30 players in an 85 m square', 6000, [W]);
  const spread = await simulate('spread: 30 players over 570 m, 3 interiors', 40000, [W, W, W, 0x1001, 0x1002, 0x1003]);
  for (const r of [town, spread]) {
    check(`${r.label}: lists flow (${r.listPacketsPerSecond}/s to the 30 clients, at most ${r.listPacketsMaxInOneTick} in one tick)`, r.listPacketsPerSecond > 0 && r.listPacketsPerSecond < 30, r);
    check(`${r.label}: the lists add no LiveKit API call; only the 15 s sweep calls it (${r.liveKitApiCallsPerSecond}/s)`, r.liveKitApiCallsPerSecond <= 0.15, r);
    check(`${r.label}: a list tick costs under 2 ms of game-server time (average ${r.msPerTickAverage} ms, worst ${r.msPerTickWorst} ms)`, r.msPerTickAverage < 2, r);
  }

  finished = true;
  Date.now = realNow;
  process.chdir(startDir);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL the harness threw', e); try { fs.rmSync(out, { recursive: true, force: true }); } catch (_) { } process.exit(1); });
