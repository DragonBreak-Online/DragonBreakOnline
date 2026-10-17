// Scripted test for server\gates.js with a mock gamemode api: a known lever plays its gate to everyone with BOTH calls
// for every name, the animation matches what the door became (open or closed), a gate locked to someone else refuses the
// lever with a line to the puller, its owner and a keyholder work it, an unclaimed or unlocked gate is free to anyone,
// an unknown lever is never touched, and the config flag turns the whole thing off. Also checks the wiring in gamemode.js
// and the config default.  Run it from this folder's parent with
//
//   node tests/gates-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GATES = path.join(ROOT, 'gates.js');

let failures = 0;
const check = (label, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!ok) failures++; };

const LEVER = 0x481b5fc3, GATE = 0x481b5fc4, OTHER = 0x40001234;
const OWNER = 0xff000014, KEYED = 0xff000015, STRANGER = 0xff000016;
const DESCS = { '1b5fc3:DragonBreak Online Edits.esp': LEVER, '1b5fc4:DragonBreak Online Edits.esp': GATE };

let gateOpen = false, calls = [], said = [], logs = [];
let record = null, keyOpensFor = new Set();
const mp = {
  getIdFromDesc: (d) => { if (d in DESCS) return DESCS[d]; throw new Error('no such desc'); },
  getDescFromId: (id) => String(id),
  get: (id, p) => { if (p === 'isOpen' && id === GATE) return gateOpen; throw new Error('no such property'); },
  callPapyrusFunction: (kind, cls, fn, target, args) => { calls.push(`${fn}(${args[0]})`); return true; },
};
const api = { mp, log: (...a) => logs.push(a.join(' ')), personal: (a, t) => said.push([a, t]), display: (a) => `#${a.toString(16)}`,
  who: (a) => `#${a.toString(16)}`, audit: () => {}, cfg: { gates: { enabled: true } } };

globalThis.__dboHousing = {
  primaryOf: (ref) => (ref === GATE ? GATE : 0),
  recordOf: () => record,
  keyOpens: (ref, a) => keyOpensFor.has(a >>> 0),
};
delete require.cache[GATES];
const M = require(GATES)(api);
const take = () => calls.splice(0);
const tick = () => new Promise((r) => setTimeout(r, 160));

(async () => {
  // ---- the gate is played for everyone, both calls, matching its new state ----
  record = null;
  gateOpen = true;
  check('a known lever is allowed', M.onLever(LEVER, STRANGER) === true);
  await tick();
  check('...and the gate is played with BOTH calls for the name', JSON.stringify(take()) === '["PlayAnimation(Open)","PlayGamebryoAnimation(Open)"]');
  gateOpen = false;
  M.onLever(LEVER, STRANGER); await tick();
  check('a closed gate plays its close names, not its open ones', JSON.stringify(take()) === '["PlayAnimation(Close)","PlayGamebryoAnimation(Close)"]');
  check('an unknown lever is left to the engine, and plays nothing', M.onLever(OTHER, STRANGER) === true);
  await tick();
  check('...nothing at all', take().length === 0);

  // ---- the gate's own lock governs the lever ----
  record = { owner: 77, locked: true };
  keyOpensFor = new Set([OWNER, KEYED]);
  said.length = 0;
  check('a stranger is refused while the gate is locked', M.onLever(LEVER, STRANGER) === false);
  check('...and told why, once', said.length === 1 && /locked/.test(said[0][1]) && said[0][0] === STRANGER, said);
  await tick();
  check('...and nothing is played for a refused pull', take().length === 0);
  check('the owner works it', M.onLever(LEVER, OWNER) === true);
  check('a keyholder works it', M.onLever(LEVER, KEYED) === true);
  await tick(); take();

  record = { owner: 77, locked: false };
  check('an unlocked gate is free to anyone', M.onLever(LEVER, STRANGER) === true);
  record = { owner: 0, locked: true };
  check('a gate nobody claims is free to anyone', M.onLever(LEVER, STRANGER) === true);
  await tick(); take();

  // ---- without the housing system, nothing is refused ----
  const H = globalThis.__dboHousing; globalThis.__dboHousing = null;
  record = { owner: 77, locked: true };
  check('with no housing system a lever is never refused', M.onLever(LEVER, STRANGER) === true);
  globalThis.__dboHousing = H;
  await tick(); take();

  // ---- the flag ----
  api.cfg.gates.enabled = false;
  check('enabled false: the lever is the engine\'s again (the rollback)', M.onLever(LEVER, STRANGER) === true);
  await tick();
  check('...and nothing is played', take().length === 0);
  api.cfg.gates.enabled = true;

  // ---- the wiring and the shipped config ----
  const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
  check('gamemode.js loads gates.js', /require\(GATES_JS\)\(\{[^}]*\bpersonal\b[^}]*\}\)/.test(gm));
  check('gamemode.js refuses the pull when it says so', /__dboGateLever\(t, c\) === false\) return false/.test(gm));
  check('a failed load leaves no stale delegate', /gates\.js failed to load[\s\S]{0,90}__dboGateLever = null/.test(gm));
  const D = require(GATES).DEFAULTS;
  check('the default names Castle Bruma\'s gate and its lever', D.list.length === 1 && /1b5fc3/.test(D.list[0].lever) && /1b5fc4/.test(D.list[0].gate));
  check('...with an open and a close name to try', D.list[0].open.length >= 1 && D.list[0].close.length >= 1);

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exitCode = failures ? 1 : 0;
})();
