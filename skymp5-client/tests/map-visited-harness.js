// Scripted test for map markers seen but never entered (Purr #7DJT, 16 Oct: "every cave is shown as entered on the map";
// server mapprogress.js keeps the visited ones apart in private.mapVisited). It bundles the real characterProgressService.ts
// with esbuild, every import stubbed, over a fake world whose markers hold the engine's two flags: visible
// (isMapMarkerVisible) and can-travel-to (canFastTravelToMarker, the map's entered look). addToMap(abAllowFastTravel) only
// ever adds them, as the engine does. Each session is a new game process over the same character-progress file whose login
// save shows no marker. MAPPROGRESS=<server mapprogress.js> also runs two PCs against the real server half.
// Run it from skymp5-client (esbuild is borrowed from ../skymp5-server/node_modules):
//
//   node tests/map-visited-harness.js            (FORK=<fork tree> to test another tree)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const client = path.resolve(__dirname, '..');
const tree = process.env.FORK ? path.join(path.resolve(process.env.FORK), 'skymp5-client') : client;
const services = path.join(tree, 'src', 'services', 'services');
const esbuild = require(require.resolve('esbuild', { paths: [client, path.resolve(client, '..', 'skymp5-server')] }));

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const REFS = [[0xa001, 'Skyrim.esm'], [0xa002, 'Skyrim.esm'], [0xa003, 'Skyrim.esm'], [0x1234, 'BSHeartland.esm'], [0xa005, 'Skyrim.esm']];
const descOf = ([id, p]) => id.toString(16) + ':' + p;
const [A, B, C, D, E] = REFS.map(descOf);
const FILE_NAME = 'character-progress-no-load';
const KEY = 'srv:7777/ff000abc';

const H = { sent: [], errors: [], traces: [] };
globalThis.__mv = H;
const STUBS = {
  skyrimPlatform: `exports.FormType = { Ingredient: 30 }; exports.Menu = { Main: 'Main Menu', Crafting: 'Crafting Menu' };`,
  './clientListener': `exports.ClientListener = class {};`,
  '../../logging': `exports.logError = (...a) => globalThis.__mv.errors.push(a.slice(1).map(String).join(' ')); exports.logTrace = () => {};`,
  './remoteServer': `exports.RemoteServer = globalThis.__mv.RemoteServer = class {};`,
  './singlePlayerService': `exports.SinglePlayerService = class {};`,
  '../../sync/inventory': `exports.getInventory = () => ({ entries: [] });`,
  '../../data/mapMarkerRefs': `exports.MAP_MARKER_REFS = ${JSON.stringify(REFS)};`,
  './customPacketUtil': `exports.sendCustomPacket = (c, p) => globalThis.__mv.sent.push(JSON.parse(JSON.stringify(p)));
exports.parseCustomPacket = (e) => { try { const c = JSON.parse(e.message.contentJsonDump); return c && typeof c === 'object' ? c : null; } catch (x) { return null; } };`,
  '../../lib/clientDiag': `exports.trace = (t) => globalThis.__mv.traces.push(t);`,
};

async function load(out) {
  const outfile = path.join(out, 'characterProgressService.js');
  await esbuild.build({
    entryPoints: [path.join(services, 'characterProgressService.ts')], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'error',
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (a.kind === 'entry-point' ? undefined : { path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path] || '', loader: 'js' }));
      },
    }],
  });
  return require(outfile).CharacterProgressService;
}

let NOW = 1e9;
Date.now = () => NOW;
const FILE = {};
const readFile = () => { try { return JSON.parse(FILE[FILE_NAME].slice(2)).characters[KEY]; } catch (e) { return null; } };

// One game process: a fresh sp.storage (unless one is handed over, a hot reload) and a login save with no marker shown
function session(Cls, storage) {
  const world = new Map(REFS.map((r, i) => [descOf(r), { id: 0x100 + i, visible: false, travel: false }]));
  const byId = new Map([...world].map(([d, m]) => [m.id, d]));
  const handlers = {}, onces = {}, em = {};
  const ref = (d) => {
    const m = world.get(d);
    return { isMapMarkerVisible: () => m.visible, canFastTravelToMarker: () => m.travel, addToMap: (t) => { m.visible = true; if (t) m.travel = true; } };
  };
  const sp = {
    storage: storage || {},
    settings: { 'skymp5-client': { 'server-ip': 'srv', 'server-port': 7777 } },
    Ui: { isMenuOpen: () => false },
    Utility: { wait: () => Promise.resolve() },
    Game: {
      getFormFromFile: (id, p) => { const d = id.toString(16) + ':' + p; return world.has(d) ? { getFormID: () => world.get(d).id } : null; },
      getFormEx: (id) => (byId.has(id) ? { id } : null),
      getPlayer: () => null,
    },
    ObjectReference: { from: (f) => (f && byId.has(f.id) ? ref(byId.get(f.id)) : null) },
    Ingredient: { from: () => null },
    getPluginSourceCode: (name) => FILE[name] || '',
    writePlugin: (name, text) => { FILE[name] = text; },
  };
  const remote = { getMyActorIndex: () => 0, getMyRemoteRefrId: () => 0xff000abc };
  const controller = {
    on: (ev, fn) => (handlers[ev] = handlers[ev] || []).push(fn),
    once: (ev, fn) => (onces[ev] = onces[ev] || []).push(fn),
    emitter: { on: (ev, fn) => (em[ev] = em[ev] || []).push(fn), emit: () => {} },
    lookupListener: (L) => (L === H.RemoteServer ? remote : { isSinglePlayer: false }),
  };
  new Cls(sp, controller);
  const fire = (table, ev, arg) => (table[ev] || []).slice().forEach((f) => f(arg));
  return {
    sp,
    look: (d) => { const m = world.get(d); return m.travel ? 'entered' : m.visible ? 'seen' : 'hidden'; },
    set: (d, look) => Object.assign(world.get(d), { visible: look !== 'hidden', travel: look === 'entered' }),
    async tick(n = 1, ms = 4000) {
      for (let i = 0; i < n; i++) {
        NOW += ms;
        const o = onces.update || [];
        onces.update = [];
        o.forEach((f) => f());
        fire(handlers, 'update');
        await new Promise((r) => setImmediate(r));
      }
    },
    spawn: () => fire(em, 'createActorMessage', { message: { isMe: true } }),
    answer: (content) => fire(em, 'customPacketMessage', { message: { contentJsonDump: JSON.stringify(Object.assign({ customPacketType: 'dboMapMarkers' }, content)) } }),
    disconnect: () => fire(em, 'connectionDisconnect'),
  };
}

const field = (packets, k) => packets.flatMap((p) => (Array.isArray(p[k]) ? p[k] : []));
const same = (got, want) => JSON.stringify([...got].sort()) === JSON.stringify([...want].sort());

(async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-mapvisited-'));
  const Cls = await load(out);

  // ---- session 1: a cave seen from the road (A), one entered (B) ----
  const s1 = session(Cls);
  s1.spawn();
  await s1.tick(3);
  H.sent = [];
  s1.set(A, 'seen');
  s1.set(B, 'entered');
  await s1.tick(3, 11000);
  check('a cave only seen is reported as a marker, not as visited', field(H.sent, 'markers').includes(A) && !field(H.sent, 'visited').includes(A), H.sent);
  check('a cave entered is reported as visited', field(H.sent, 'visited').includes(B), H.sent);
  check('...and its look is left as the engine set it', s1.look(A) === 'seen' && s1.look(B) === 'entered');
  s1.disconnect();
  const f1 = readFile();
  check('the file keeps both as markers and only the entered one as visited', !!f1 && same(f1.markers, [A, B]) && same(f1.visited || [], [B]), f1);

  // ---- session 2: a new game process over the same file ----
  H.sent = [];
  H.traces = [];
  const s2 = session(Cls);
  s2.spawn();
  await s2.tick(4);
  check('after a relog the cave only seen comes back seen, not entered', s2.look(A) === 'seen', s2.look(A));
  check('...and the cave entered comes back entered', s2.look(B) === 'entered', s2.look(B));
  check('the restore reports the entered one as visited and the seen one as a marker',
    same(field(H.sent, 'visited'), [B]) && field(H.sent, 'markers').includes(A) && !field(H.sent, 'markers').includes(B), H.sent);
  check('...the last report asking for the server\'s list (want)', H.sent.length > 0 && H.sent[H.sent.length - 1].want === true && H.sent.filter((p) => p.want).length === 1, H.sent);
  check('the restore leaves one diag line with the counts', H.traces.includes('map restore markers=2 visited=1'), H.traces);

  // The server's list: C entered and D only seen on another PC, A entered on another PC
  s2.answer({ markers: [A, B, C, D], visited: [A, B, C] });
  await s2.tick(3);
  check('a marker new to this PC that the server lists as visited comes back entered', s2.look(C) === 'entered', s2.look(C));
  check('a marker new to this PC that the server lists only as seen comes back seen', s2.look(D) === 'seen', s2.look(D));
  check('a marker this PC only saw that the server lists as visited is shown entered', s2.look(A) === 'entered', s2.look(A));

  // The player walks into the cave they had only seen
  H.sent = [];
  s2.set(D, 'entered');
  await s2.tick(4, 11000);
  check('a marker seen before and entered now is reported as visited', field(H.sent, 'visited').includes(D), H.sent);
  s2.disconnect();
  const f2 = readFile();
  check('...and the file has it as visited', !!f2 && (f2.visited || []).includes(D) && (f2.visited || []).includes(C), f2);

  // An answer from a server without the visited list changes nothing and throws nothing
  H.errors = [];
  const s2b = session(Cls);
  s2b.spawn();
  await s2b.tick(4);
  s2b.answer({ markers: [A, B, C, D, E] });
  await s2b.tick(3);
  check('an answer with no visited list restores the new marker seen, and keeps the entered ones', s2b.look(E) === 'seen' && s2b.look(D) === 'entered' && s2b.look(C) === 'entered', [s2b.look(E), s2b.look(D), s2b.look(C)]);
  check('...with no client error', H.errors.length === 0, H.errors);

  // ---- a file written by 0.3.101 (markers only) ----
  FILE[FILE_NAME] = '//' + JSON.stringify({ version: 1, characters: { [KEY]: { name: '', updatedAt: 1, markers: [A, B], ingredients: {} } } });
  const s3 = session(Cls);
  s3.spawn();
  await s3.tick(4);
  check('a 0.3.101 file has no visited list: its markers come back seen (the one-time reset)', s3.look(A) === 'seen' && s3.look(B) === 'seen', [s3.look(A), s3.look(B)]);

  // ---- a hot reload over a 0.3.101 state (no visited fields) ----
  H.errors = [];
  const old = { characterProgressState: { key: KEY, myIdx: 0, markers: { [A]: true }, ingredients: {}, queue: [{ desc: A }], restored: false, dirty: false, report: [], want: false } };
  const s4 = session(Cls, old);
  await s4.tick(4, 11000);
  check('a hot reload over the old state shape restores and scans with no client error', H.errors.length === 0 && s4.look(A) === 'seen', [H.errors, s4.look(A)]);

  // A hot reload over a 0.3.101 session: the old client put every marker back entered, so that look proves no visit
  H.sent = [];
  delete FILE[FILE_NAME];
  const old2 = { characterProgressState: { key: KEY, myIdx: 0, markers: { [A]: true, [B]: true }, ingredients: {}, queue: [], restored: true, dirty: false, report: [], want: false } };
  const s4b = session(Cls, old2);
  s4b.set(A, 'entered');
  s4b.set(B, 'entered');
  s4b.set(C, 'entered');
  await s4b.tick(4, 11000);
  check('a hot reload over a 0.3.101 session takes none of its restored markers as visited', !field(H.sent, 'visited').includes(A) && !field(H.sent, 'visited').includes(B), H.sent);
  check('...while a marker the engine discovered this session is reported as visited', field(H.sent, 'visited').includes(C), H.sent);
  s4b.disconnect();
  const f4 = readFile();
  check('...and the file keeps the old markers but none as visited', !!f4 && same(f4.markers, [A, B, C]) && same(f4.visited || [], [C]), f4);

  // ---- big lists stay inside the server's packet limit (perPacket 500 over visited and markers together) ----
  const many = Array.from({ length: 900 }, (_, i) => (0xb000 + i).toString(16) + ':Skyrim.esm');
  FILE[FILE_NAME] = '//' + JSON.stringify({ version: 1, characters: { [KEY]: { name: '', updatedAt: 1, markers: many, visited: many.slice(0, 450), ingredients: {} } } });
  H.sent = [];
  const s5 = session(Cls);
  s5.spawn();
  await s5.tick(12);
  const sizes = H.sent.map((p) => (p.markers || []).length + (p.visited || []).length);
  check('every report holds at most 400 markers and visited together', sizes.length > 1 && sizes.every((n) => n <= 400), sizes);
  check('...each sent once, the visited ones only as visited', same(field(H.sent, 'visited'), many.slice(0, 450)) && same(field(H.sent, 'markers'), many.slice(450)), [field(H.sent, 'visited').length, field(H.sent, 'markers').length]);
  check('...and only the last asks for the list', H.sent.filter((p) => p.want).length === 1 && H.sent[H.sent.length - 1].want === true, H.sent.map((p) => !!p.want));

  // ---- two PCs against the real server half ----
  if (process.env.MAPPROGRESS) {
    const u32 = (x) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, x, true); return b; };
    const PLUG = { 'skyrim.esm': 0, 'bsheartland.esm': 8 };
    const props = new Map();
    const mp = {
      getIdFromDesc: (d) => { const [h, p] = d.split(':'); return ((PLUG[p.toLowerCase()] << 24) | parseInt(h, 16)) >>> 0; },
      lookupEspmRecordById: () => ({ record: { type: 'REFR', fields: [{ type: 'NAME', data: u32(0x10) }] }, toGlobalRecordId: (x) => x >>> 0 }),
      get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, JSON.parse(JSON.stringify(v))),
    };
    let pc = null;
    delete globalThis.__dboMapMarkerChecked;
    require(path.resolve(process.env.MAPPROGRESS))({ mp, log: () => {}, sendPacket: (a, p) => pc.answer(p), cfg: {} });
    const relay = async (s, n) => { for (let i = 0; i < n; i++) { await s.tick(1); H.sent.splice(0).forEach((p) => globalThis.__dboMapSync(0xff000abc, p)); } };
    delete FILE[FILE_NAME];
    H.sent = [];
    pc = session(Cls);
    pc.spawn();
    await relay(pc, 3);
    pc.set(A, 'seen');
    pc.set(B, 'entered');
    await pc.tick(3, 11000);
    await relay(pc, 2);
    check('server: the first PC\'s report keeps A as a marker and B as visited', same(props.get(`${0xff000abc}|private.mapMarkers`) || [], [A, B]) && same(props.get(`${0xff000abc}|private.mapVisited`) || [], [B]), [...props]);
    delete FILE[FILE_NAME];
    pc = session(Cls);
    pc.spawn();
    await relay(pc, 6);
    check('server: a second PC with no file gets A back seen and B back entered', pc.look(A) === 'seen' && pc.look(B) === 'entered', [pc.look(A), pc.look(B)]);
  } else {
    console.log('skip the real server half (set MAPPROGRESS=<server mapprogress.js>)');
  }

  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
