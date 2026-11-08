// NpcSpawnSystem loads NPC-Spawns.json again once its file watcher is ready, if the file is newer than the last load
// (Local Leader, 8 Nov). chokidar reports changes only after its initial scan, which runs on node's I/O pool, and that pool
// is starved for about 4 minutes after a boot. So a gameplay write in that window (carriages.js's zones, ~1.6 min after boot
// on dev) was never reported, and the zones waited until someone touched the file.
// Bundles npcSpawnSystem.ts with esbuild: chokidar is a fake watcher whose events the harness fires, and settings,
// placement and the espm helpers are stubbed. It drives load() and watchFile() in a scratch folder. Run it from
// skymp5-server with node_modules present:
//
//   node tests/spawn-ready-reread-harness.js [npcSpawnSystem.ts to test]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const SRC_FILE = path.resolve(process.argv[2] || path.join(root, 'ts', 'systems', 'npcSpawnSystem.ts'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-spawnready-'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-spawnready-cwd-'));
process.on('exit', () => { for (const d of [out, work]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* the OS */ } } });

let fails = 0, passes = 0;
const ok = (c, label, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${label}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (c) passes++; else fails++; };

const stubSources = {
  chokidar: 'module.exports = { watch: (folder, opts) => { const w = new (require("events").EventEmitter)(); globalThis.__watchers.push({ folder, opts, w }); return w; } };',
  '../settings': 'module.exports = { Settings: { get: async () => ({ allSettings: {} }) } };',
  './system': 'module.exports = { WORLD_LOADED_EVENT: "worldLoaded" };',
  './espmEditorIds': 'module.exports = { resolveEditorIds: () => new Map(), isEditorId: () => false };',
  './formIdUtil': 'module.exports = { espmFieldFormIds: () => [] };',
  './npcPlacement': 'module.exports = { placeNpc: () => 0, HOSTILE_PROP: "ff_hostile" };',
  './actorUtil': 'module.exports = { destroyLeftovers: () => 0 };',
};
const stubFilter = new RegExp('^(' + Object.keys(stubSources).map((k) => k.replace(/[./-]/g, '\\$&')).join('|') + ')$');
globalThis.__watchers = [];

const build = async () => {
  const entry = path.join(path.dirname(SRC_FILE), `.spawnready-${process.pid}.ts`);
  fs.writeFileSync(entry, fs.readFileSync(SRC_FILE, 'utf8'));
  const bundle = path.join(out, 'npcspawn.js');
  try {
    await esbuild.build({
      entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: stubFilter }, (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubSources[a.path], loader: 'js' }));
      } }],
    });
  } finally { try { fs.unlinkSync(entry); } catch (e) { /* gone */ } }
  return require(bundle).NpcSpawnSystem;
};

const mp = { get: () => undefined, set: () => {}, getIdFromDesc: () => 0, getDescFromId: () => '', lookupEspmRecordById: () => null };
const FILE = path.join(work, 'NPC-Spawns.json');
// A rename-over save, as wildlife.js, dungeons.js and carriages.js write it, with its mtime set explicitly
const save = (zones, mtimeSec) => {
  fs.writeFileSync(FILE + '.tmp', JSON.stringify({ zones }, null, 1));
  fs.renameSync(FILE + '.tmp', FILE);
  if (mtimeSec) fs.utimesSync(FILE, mtimeSec, mtimeSec);
};
const zone = (name) => ({ Name: name, ID: '3c:Skyrim.esm', POS: [0, 0, 0], Size: 500, NPC: [] });
const settle = () => new Promise((r) => setTimeout(r, 30));

(async () => {
  const NpcSpawnSystem = await build();
  process.chdir(work);
  const T0 = Math.floor(Date.now() / 1000) - 600;
  const fresh = async (zones) => {
    const logs = [];
    globalThis.__watchers = [];
    const s = new NpcSpawnSystem((m) => logs.push(String(m)));
    s.mp = mp;
    save(zones, T0);
    await s.load(mp, 'boot');
    s.watchFile();
    return { s, logs, w: globalThis.__watchers[globalThis.__watchers.length - 1].w };
  };
  const loads = (logs) => logs.filter((l) => /zone\(s\) loaded from|unchanged, kept/.test(l));

  // ---- 1. the boot race: a write after the boot load, before the watcher is armed -------------------------------------
  {
    const { s, logs, w } = await fresh([zone('wild:wolf:0')]);
    ok(loads(logs).length === 1 && /\(boot\)/.test(loads(logs)[0]), 'the boot load reads the file once', loads(logs));
    save([zone('wild:wolf:0'), zone('carriage:whiterun'), zone('carriage:solitude')], T0 + 100);   // before "ready": no event comes
    const before = logs.length;
    w.emit('ready');
    await s.loadChain; await settle();
    const after = logs.slice(before);
    ok(after.some((l) => /written before its watcher was ready; loading it now/.test(l)), 'the watcher becomes ready: the file is newer than the boot load, so it says so...', after);
    ok(loads(after).length === 1 && /written before the watcher was ready/.test(loads(after)[0]) && /zone\(s\) loaded from/.test(loads(after)[0]), '...and loads it (one load, with that reason)', loads(after));
    ok(s.lastZoneText === fs.readFileSync(FILE, 'utf8'), '...the zones it now holds are the file\'s, carriage zones included', s.lastZoneText && s.lastZoneText.length);
  }

  // ---- 2. nothing written before ready: no extra load -------------------------------------------------------------------
  {
    const { s, logs, w } = await fresh([zone('wild:wolf:0')]);
    const before = logs.length;
    w.emit('ready');
    await s.loadChain; await settle();
    ok(loads(logs.slice(before)).length === 0 && !logs.slice(before).some((l) => /before its watcher/.test(l)), 'ready with the file as the boot load read it: nothing is loaded again', logs.slice(before));
  }

  // ---- 3. the file missing at boot, then written before ready ----------------------------------------------------------
  {
    const logs = [];
    globalThis.__watchers = [];
    try { fs.rmSync(FILE); } catch (e) { /* none */ }
    const s = new NpcSpawnSystem((m) => logs.push(String(m)));
    s.mp = mp;
    await s.load(mp, 'boot');
    s.watchFile();
    const w = globalThis.__watchers[globalThis.__watchers.length - 1].w;
    ok(logs.some((l) => /not found, no zones \(boot\)/.test(l)), 'no file at boot: no zones');
    save([zone('carriage:whiterun')], T0 + 200);
    const before = logs.length;
    w.emit('ready');
    await s.loadChain; await settle();
    ok(loads(logs.slice(before)).length === 1, '...the file appears before ready: it is loaded when the watcher is ready', logs.slice(before));
  }

  // ---- 4. after ready, changes still come through the watcher's own events ---------------------------------------------
  {
    const { s, logs, w } = await fresh([zone('wild:wolf:0')]);
    w.emit('ready');
    await s.loadChain; await settle();
    const before = logs.length;
    save([zone('wild:wolf:0'), zone('guard:bruma:1')], T0 + 300);
    w.emit('change', FILE);
    await new Promise((r) => setTimeout(r, 2500));
    await s.loadChain; await settle();
    ok(loads(logs.slice(before)).some((l) => /\(file changed\)/.test(l)), 'after ready, a save is still loaded through its change event (file changed)', logs.slice(before));
    ok(!logs.slice(before).some((l) => /before its watcher/.test(l)), '...and the ready check does not run again', logs.slice(before));
  }

  // ---- 5. the watch is still on the folder (the rename-loss fix, c07e1b8) ------------------------------------------------
  {
    const { s } = await fresh([zone('wild:wolf:0')]);
    const last = globalThis.__watchers[globalThis.__watchers.length - 1];
    ok(path.resolve(last.folder) === path.resolve(work) && last.opts.ignoreInitial === true, 'the watch is on the folder, ignoreInitial', [last.folder, last.opts.ignoreInitial]);
    void s;
  }

  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  harness error', e && e.stack); process.exit(1); });
