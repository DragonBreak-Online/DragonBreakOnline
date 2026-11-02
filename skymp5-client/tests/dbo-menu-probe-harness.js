// The tick-safe menu spike's client probe (dboMenuProbeService.ts) against a stand-in SkyrimPlatform: off without the
// setting; with it, from "tick" it opens dbo_menuprobe, invokes _root.ping on "ready", logs the pong and closes; a DLL
// without the API is said once; no answer in 15 s gives up and closes. The C++ side (skyrim-platform DboMenuApi) is
// checked for the calls the probe relies on. Mutants of a copy of the service are compiled and must fail.
//   node tests/dbo-menu-probe-harness.js   (from skymp5-client)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const ts = require(path.resolve(__dirname, '../node_modules/typescript'));

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/services/services/dboMenuProbeService.ts'), 'utf8').replace(/\r\n/g, '\n');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-menuprobe-'));
const logs = [];
const FAKES = {
  './clientListener': { ClientListener: class {} },
  '../../logging': { logTrace: (_s, ...a) => logs.push(a.join(' ')), logError: (_s, ...a) => logs.push('ERROR ' + a.join(' ')) },
};
const realLoad = Module._load;
Module._load = function (req, ...rest) { return FAKES[req] || realLoad.call(this, req, ...rest); };
let n = 0;
const compile = (src) => {
  const f = path.join(tmp, `probe${n++}.js`);
  fs.writeFileSync(f, ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText);
  return require(f).DboMenuProbeService;
};

// One scenario: the stand-in SP, ticks run, what was called and logged
const scenario = (Service, opts) => {
  logs.length = 0;
  const calls = [];
  const ticks = [];
  let now = 1000;
  const realNow = Date.now; Date.now = () => now;
  const queue = [];
  const sp = { settings: { 'skymp5-client': { dboMenuProbe: opts.on } } };
  if (opts.api) {
    Object.assign(sp, {
      dboMenuOpen: (...a) => { calls.push(['open', ...a]); if (opts.answers) queue.push('ready\u00011'); },
      dboMenuClose: () => calls.push(['close']),
      dboMenuIsOpen: () => true,
      dboMenuInvoke: (...a) => { calls.push(['invoke', ...a]); if (opts.answers) queue.push(`pong\u0001${a[1]}`); },
      dboMenuPoll: () => queue.splice(0),
    });
  }
  const controller = { on: (ev, fn) => { if (ev === 'tick') ticks.push(fn); } };
  try {
    new Service(sp, controller);
    for (let i = 0; i < (opts.ticks || 5); i++) { now += opts.step || 100; ticks.forEach((t) => t()); }
  } finally { Date.now = realNow; }
  return { calls, logs: logs.slice(), ticks: ticks.length };
};

const checks = (Service, check) => {
  let r = scenario(Service, { on: false, api: true, answers: true });
  check('off without the setting: no tick handler, nothing opened', r.ticks === 0 && !r.calls.length, r);
  r = scenario(Service, { on: true, api: false });
  check('a SkyrimPlatform without the API is said once, nothing else', r.logs.filter((l) => /no dboMenu API/.test(l)).length === 1 && r.logs.length === 1, r.logs);
  r = scenario(Service, { on: true, api: true, answers: true });
  check('from tick: opens dbo_menuprobe, cursor and menu context (4|8), depth 3, never pausing', JSON.stringify(r.calls[0]) === JSON.stringify(['open', 'dbo_menuprobe', 12, 3]), r.calls);
  check('...on "ready" it pings _root.ping', r.calls.some((c) => c[0] === 'invoke' && c[1] === '_root.ping' && c[2] === 'hello'), r.calls);
  check('...logs the pong as the round trip, then closes', r.logs.some((l) => /round trip done, pong "hello"/.test(l)) && r.calls[r.calls.length - 1][0] === 'close', { calls: r.calls, logs: r.logs });
  check('...once: no second open after it is done', r.calls.filter((c) => c[0] === 'open').length === 1, r.calls);
  r = scenario(Service, { on: true, api: true, answers: false, ticks: 4, step: 6000 });
  check('no answer in 15 s: gives up, says so, closes', r.logs.some((l) => /no answer in 15000 ms/.test(l)) && r.calls[r.calls.length - 1][0] === 'close', { calls: r.calls, logs: r.logs });
};

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!ok) failures++; };
checks(compile(SRC), check);

// ---- the C++ side the probe relies on ----
const CPP = fs.readFileSync(path.join(ROOT, '..', 'skyrim-platform/src/platform_se/skyrim_platform/DboMenuApi.cpp'), 'utf8');
const H = fs.readFileSync(path.join(ROOT, '..', 'skyrim-platform/src/platform_se/skyrim_platform/DboMenuApi.h'), 'utf8');
check('the API exports the five functions the probe calls', ['dboMenuOpen', 'dboMenuClose', 'dboMenuIsOpen', 'dboMenuInvoke', 'dboMenuPoll'].every((f) => H.includes(`exports.Set("${f}"`)));
check('...the movie hears _global.dboNative, set as a member of _global', /GetVariable\(&global, "_global"\)/.test(CPP) && /global\.SetMember\("dboNative", fn\)/.test(CPP));
check('...Invoke runs on the UI thread (AddUITask), never on the JS thread', /tasks->AddUITask\(\[target, arg\]/.test(CPP));
check('...arguments joined by \\u0001, as the probe splits them', /line \+= '\\x01';/.test(CPP));
check('...the menu is registered at kDataLoaded and opened by UIMessageQueue', /ui->Register\(kMenuName, DboMenu::Create\)/.test(CPP) && /AddMessage\(kMenuName, a_type, nullptr\)/.test(CPP));
check('...no Papyrus in it (no callNative, no VM)', !/CallNative|IVirtualMachine|getNativeCallRequirements/.test(CPP));
check('the client registers the probe service', /new DboMenuProbeService\(sp, controller\)/.test(fs.readFileSync(path.join(ROOT, 'src/index.ts'), 'utf8')));

// ---- mutants of a copy of the service ----
const MUTANTS = [
  ['it pauses the game', 'const FLAGS = 4 | 8;', 'const FLAGS = 1 | 4 | 8;'],
  ['it never pings', 'if (key === "ready" && m.dboMenuInvoke) m.dboMenuInvoke("_root.ping", "hello");', ''],
  ['it never closes', '    try { (this.sp as unknown as DboMenuSp).dboMenuClose?.(); } catch { /* the API may be missing */ }\n', ''],
  ['it runs without the setting', 'return !!s && s["dboMenuProbe"] === true;', 'return true;'],
  ['it never gives up', 'if (Date.now() - this.openedAt > GIVE_UP_MS)', 'if (false)'],
];
for (const [name, from, to] of MUTANTS) {
  if (!SRC.includes(from)) { check(`mutant "${name}": its line is still in dboMenuProbeService.ts`, false, from); continue; }
  let bad = 0;
  try { checks(compile(SRC.replace(from, to)), (_n, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  check(`mutant caught: ${name}`, bad > 0);
}

Module._load = realLoad;
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* busy */ }
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
