// What a hot reload must not keep alive. The 6 Nov reload run on the CT115 dev server found every older generation kept
// whole (~65 MB of heap each): by bank.js's first fee-tick timeout for 5 minutes, by __dboSaves snapshots until the file
// saved again, and the first load for the life of the process by the slot wrappers, listeners, interval and observer
// made once per process. Each check loads twice with a sentinel in the first load's scope, forces a full GC and asks
// whether the first load is gone; each mutant puts the old closure back and must leave it pinned.
//
//   node tests/reload-pins-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const v8 = require('v8');
const vm = require('vm');

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');
const SERVER = path.resolve(__dirname, '..');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'reload-pins-'));
fs.copyFileSync(path.join(SERVER, 'artifacts.json'), path.join(SCRATCH, 'artifacts.json'));
process.chdir(SCRATCH);
process.on('exit', () => { try { process.chdir(os.tmpdir()); fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch (e) { /* best effort */ } });

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};
// The second load's log: made out here, so it keeps no test's sentinel
const quiet = () => {};
const collect = async () => { for (let i = 0; i < 4; i++) { await new Promise((r) => setImmediate(r)); gc(); } };
// A load's log keeps the sentinel, as every gamemode closure keeps the load's state
const tagged = () => { const s = { big: new Array(4096).fill(1) }; return { log: () => s.big.length, ref: new WeakRef(s) }; };
const src = (file) => fs.readFileSync(path.join(SERVER, file), 'utf8').split('\r\n').join('\n');
// A module file, or a mutant of it, loaded fresh as the gamemode does on every reload
const moduleFrom = (file, text) => {
  const p = path.join(SCRATCH, file);
  fs.writeFileSync(p, text);
  delete require.cache[p];
  return require(p);
};
// A gamemode.js slice run in its own scope, as one load; `log` is kept in that scope as the real gamemode keeps it
const slice = (from, to) => {
  const g = src('gamemode.js');
  const a = g.indexOf(from);
  const b = g.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('slice not found: ' + from);
  return g.slice(a, b);
};
const runSlice = (code, env, ret) => new Function(...Object.keys(env), `${code}\nconst __keep = () => log;\nreturn ${ret};`)(...Object.values(env));

// Each case: (text) -> async () => WeakRef of the first load's sentinel, after a second load
const freed = async (makeRef) => { const ref = await makeRef(); await collect(); return ref.deref() === undefined; };
const mutant = async (name, makeRef) => {
  const stillPinned = !(await freed(makeRef));
  check(`mutant pinned: ${name}`, stillPinned);
};

(async () => {
  // ---- bank.js: the first fee tick goes through the gamemode's named once() ----
  {
    const bankText = src('bank.js');
    const permissive = (base) => new Proxy(base, { get: (t, k) => (k in t ? t[k] : () => null) });
    const mp = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => undefined) });
    const named = new Map();
    const once = (n, ms, fn) => { named.set(n, fn); };
    const loadBank = (text, withOnce) => {
      const t = tagged();
      const base = { cfg: {}, mp, log: t.log, TIER_RANK: {} };
      base.once = withOnce ? once : undefined;
      moduleFrom('bank.js', text)(permissive(base));
      return t.ref;
    };
    check('bank.js asks once() for its first fee tick by name', /api\.once\('bankVaultFeesFirst', firstTickMs, firstTick\)/.test(bankText));
    check('bank: a reload leaves the earlier load to the GC', await freed(async () => { const r = loadBank(bankText, true); loadBank(bankText, true); return r; }));
    check('bank: two loads leave one pending first tick', named.size === 1 && named.has('bankVaultFeesFirst'), [...named.keys()]);
    await mutant('bank with a gamemode that has no once() (the raw timeout)', async () => { const r = loadBank(bankText, false); loadBank(bankText, false); return r; });
  }

  // ---- __dboSaves: a written entry drops its snapshot ----
  {
    const code = slice('// ---- debounced saves:', '// Admin tiers');
    const every = new Map();
    const loadSaves = (text, log) => runSlice(text, { mp: {}, log, fs, path, every: (n, ms, fn) => every.set(n, fn), process }, '{ SAVES, saveSoon, saveNow }');
    const file = path.join(SCRATCH, 'probe.json');
    delete globalThis.__dboSaves; globalThis.__dboSigtermHooked = true;
    let g = loadSaves(code, quiet);
    g.saveNow(file, () => '{"a":1}');
    check('saveNow writes the file and lets go of the snapshot', fs.readFileSync(file, 'utf8') === '{"a":1}' && g.SAVES.get(file).snapshot === null);
    g.saveSoon(file, () => '{"a":2}');
    check('a dirty entry keeps its snapshot until it is written', typeof g.SAVES.get(file).snapshot === 'function');
    every.get('saves')();
    check('...and while the write is in flight', g.SAVES.get(file).busy === true && typeof g.SAVES.get(file).snapshot === 'function');
    await new Promise((r) => setTimeout(r, 50));
    check('...and lets go once it lands', fs.readFileSync(file, 'utf8') === '{"a":2}' && g.SAVES.get(file).snapshot === null && !g.SAVES.get(file).dirty);
    const bad = path.join(SCRATCH, 'missing-dir', 'x.json');
    g.saveSoon(bad, () => '{}');
    every.get('saves')();
    await new Promise((r) => setTimeout(r, 50));
    check('a failed write stays dirty with its snapshot, for the next try', g.SAVES.get(bad).dirty === true && typeof g.SAVES.get(bad).snapshot === 'function');
    g.SAVES.delete(bad);

    const pinCase = (text) => async () => {
      delete globalThis.__dboSaves; globalThis.__dboSigtermHooked = true;
      const t = tagged();
      const g1 = loadSaves(text, t.log);
      g1.saveSoon(file, (() => { const keep = t.log; return () => String(keep()); })());
      every.get('saves')();
      await new Promise((r) => setTimeout(r, 50));
      loadSaves(text, quiet);
      return t.ref;
    };
    check('saves: a file saved by an earlier load no longer keeps that load', await freed(pinCase(code)));
    await mutant('saves without settled()', pinCase(code.replace(/settled\(s\);/g, '')));
    await mutant('a reload that does not settle what an older load left clean', async () => {
      // the entry an older generation of the old code left clean but holding its snapshot
      delete globalThis.__dboSaves; globalThis.__dboSigtermHooked = true;
      const t = tagged();
      globalThis.__dboSaves = new Map([[file, { dirty: false, busy: false, seq: 1, snapshot: (() => { const keep = t.log; return () => String(keep()); })() }]]);
      loadSaves(code.replace('  settled(s);\n}', '}'), quiet);
      return t.ref;
    });
    check('saves: a reload lets go of a clean entry an older load left holding its snapshot', await freed(async () => {
      delete globalThis.__dboSaves; globalThis.__dboSigtermHooked = true;
      const t = tagged();
      globalThis.__dboSaves = new Map([[file, { dirty: false, busy: false, seq: 1, snapshot: (() => { const keep = t.log; return () => String(keep()); })() }]]);
      loadSaves(code, quiet);
      return t.ref;
    }));

    // the SIGTERM hook, made once per process in the same block
    const sigCase = (text) => async () => {
      delete globalThis.__dboSaves; delete globalThis.__dboSigtermHooked;
      const before = process.listeners('SIGTERM').length;
      const t = tagged();
      loadSaves(text, t.log);
      loadSaves(text, quiet);
      check(`one SIGTERM hook per process${text === code ? '' : ' (mutant)'}`, process.listeners('SIGTERM').length === before + 1);
      return t.ref;
    };
    check('SIGTERM: the hook kept for the whole process does not keep the first load', await freed(sigCase(code)));
    process.removeAllListeners('SIGTERM');
    await mutant('the SIGTERM hook as a closure of the load', sigCase(code.replace(
      "new Function('return () => { try { globalThis.__dboFlushOnExit(); } finally { process.exit(0); } };')()",
      '() => { try { globalThis.__dboFlushOnExit(); } finally { process.exit(0); } }')));
    process.removeAllListeners('SIGTERM');
  }

  // ---- the GC observer: made once per process, counting into a shared object ----
  {
    const code = slice('// Garbage collection pauses', "every('tickSummary'");
    const caseOf = (text) => async () => {
      delete globalThis.__dboGcStats;
      const t = tagged();
      runSlice(text, { log: t.log, require }, 'gcStats');
      runSlice(text, { log: quiet, require }, 'gcStats');
      return t.ref;
    };
    check('gc observer: the process-long observer does not keep the first load', await freed(caseOf(code)));
    const s = globalThis.__dboGcStats;
    const n0 = s.n;
    gc();
    await new Promise((r) => setTimeout(r, 100));
    check('...and still counts collections', s.n > n0, { before: n0, after: s.n });
    await mutant('the observer callback as a closure of the load', caseOf(code.replace(
      "new Function('s', 'return (list) => { for (const e of list.getEntries()) { s.n++; s.total += e.duration; if (e.duration > s.max) s.max = e.duration; } };')(s)",
      '(list) => { for (const e of list.getEntries()) { s.n++; s.total += e.duration; if (e.duration > s.max) s.max = e.duration; } }')));
  }

  // ---- papyrusguard.js and traps.js: the event slot is wrapped once per process ----
  for (const [file, slot, flag, hook, wrapLine, oldWrap] of [
    ['papyrusguard.js', 'onPapyrusEvent:OnUpdate', '__dboPapyrusGuardWrapped', '__dboPapyrusOnUpdate',
      "mp['onPapyrusEvent:OnUpdate'] = guardSlot(mp['onPapyrusEvent:OnUpdate']);",
      "{ const inner = mp['onPapyrusEvent:OnUpdate']; mp['onPapyrusEvent:OnUpdate'] = (...a) => guardSlot(inner)(...a); }"],
    ['traps.js', 'onPapyrusEvent:OnTriggerEnter', '__dboTrapsWrapped', '__dboTrapsHandles',
      "mp['onPapyrusEvent:OnTriggerEnter'] = trapSlot(mp['onPapyrusEvent:OnTriggerEnter']);",
      "{ const inner = mp['onPapyrusEvent:OnTriggerEnter']; mp['onPapyrusEvent:OnTriggerEnter'] = (...a) => trapSlot(inner)(...a); }"],
  ]) {
    const text = src(file);
    check(`${file}: the wrapper is made at file level`, text.includes(wrapLine));
    const mp = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => undefined), set: (t, k, v) => { t[k] = v; return true; } });
    const caseOf = (body) => async () => {
      delete globalThis[flag];
      mp[slot] = () => 'vanilla';
      const t = tagged();
      const api = (log) => new Proxy({ mp, log, cfg: {} }, { get: (o, k) => (k in o ? o[k] : () => null) });
      moduleFrom(file, body)(api(t.log));
      moduleFrom(file, body)(api(quiet));
      return t.ref;
    };
    check(`${file}: a reload leaves the first load to the GC`, await freed(caseOf(text)));
    const was = globalThis[hook];
    globalThis[hook] = () => true;
    const blocked = mp[slot](1);
    globalThis[hook] = () => false;
    const passed = mp[slot](1);
    globalThis[hook] = was;
    check(`${file}: the slot asks the current load, then runs what was there before`, blocked === false && passed === 'vanilla', { blocked, passed });
    await mutant(`${file} with the wrapper made inside the load`, caseOf(text.replace(wrapLine, oldWrap)));
  }

  // ---- itemguards.js: one flush interval per process ----
  {
    const text = src('itemguards.js');
    const mp = { get: () => undefined, onPutItem: () => true };
    const caseOf = (body) => async () => {
      const prev = globalThis.__dboItemGuards; if (prev && prev.flushTimer) clearInterval(prev.flushTimer);
      delete globalThis.__dboItemGuards;
      const t = tagged();
      moduleFrom('itemguards.js', body)({ mp, log: t.log, who: () => 'P', recordOf: () => null });
      moduleFrom('itemguards.js', body)({ mp, log: quiet, who: () => 'P', recordOf: () => null });
      return t.ref;
    };
    check('itemguards: a reload leaves the first load to the GC', await freed(caseOf(text)));
    check('itemguards: one interval, kept on the shared state', !!globalThis.__dboItemGuards.flushTimer);
    await mutant('itemguards with the interval made inside the load', caseOf(text.replace(
      'S.flushTimer = setInterval(flushTraces, 15000);',
      'S.flushTimer = setInterval(() => { try { if (S.flushTrace) S.flushTrace(); } catch (e) { /* the next tick */ } }, 15000);')));
    clearInterval(globalThis.__dboItemGuards.flushTimer);
  }

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
