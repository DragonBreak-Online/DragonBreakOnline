// loginSetup (gamemode.js) times its ~50 steps and names any over 100 ms (7 Nov: 1.4-3.9 s logins, 16 s at worst, with
// no line saying where). The timers run inside every login, so one that threw would stop every login part way. This runs
// the real loginSetup body cut from gamemode.js, every name it uses answered by a harmless stand-in, one step made slow
// on purpose: the body must run to its last step, never throw, and name the slow step and only it.
//   node tests/login-steps-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

const head = "  setTimeout(timed('loginSetup', () => {\n";
const start = src.indexOf(head), end = src.indexOf('\n  }), 8000);', start);
if (start < 0 || end < 0) { console.log('FAIL  the loginSetup markers are gone from gamemode.js'); process.exit(1); }
const body = src.slice(start + head.length, end);
ok(/const lap = /.test(body) && (body.match(/\blap\('/g) || []).length >= 40, 'loginSetup times its steps', (body.match(/\blap\('/g) || []).length);

// A name gamemode.js declares at its top level resolves to a stand-in: callable, any property, a string in a template,
// truthy. Any other name is left to node's own globals, so a misspelt one throws here as it would on the server.
const DECLARED = new Set();
for (const m of src.matchAll(/^(?:const|let|var|function|async function)\s+([A-Za-z_$][\w$]*)/gm)) DECLARED.add(m[1]);
for (const k of ['mp', 'cfg', 'userId', 'a']) DECLARED.add(k);   // the server's own, and onCharacterReady's arguments
const REAL = new Set(['performance', 'Math', 'Date', 'JSON', 'Number', 'String', 'Array', 'Object', 'Error', 'Boolean', 'undefined', 'Promise']);
const logs = [], calls = [];
let slowName = '__dboGearSwapLogin';
const busy = (ms) => { const t = performance.now(); while (performance.now() - t < ms) { /* a slow step */ } };
const stand = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 'x' : k === 'length' ? 0 : k === 'then' ? undefined : stand),
  apply: () => stand,
});
const scope = new Proxy({}, {
  has: (t, k) => typeof k === 'string' && !REAL.has(k) && (DECLARED.has(k) || k === 'log' || k === 'globalThis'),
  get: (t, k) => {
    if (k === Symbol.unscopables) return undefined;
    if (k === 'log') return (...m) => { logs.push(m.join(' ')); };
    if (k === 'globalThis') return globalHooks;
    return stand;
  },
});
const globalHooks = new Proxy({}, {
  get: (t, k) => (k === slowName ? (a) => { calls.push(k); busy(150); } : (a) => { calls.push(k); return stand; }),
});
// eslint-disable-next-line no-new-func
const run = new Function('scope', `with (scope) { return () => {\n${body}\n}; }`)(scope);

let threw = null;
try { run(); } catch (e) { threw = e; }
ok(!threw, 'the timed loginSetup runs without throwing', threw && threw.message);
// The free appearance notice after it waits for a character out of creation, which every stand-in reads as in creation
ok(calls.includes('__dboDuelLogin') && calls.length >= 30, '...through its last unconditional step (duel.js)', calls.slice(-3));
const slow = logs.find((l) => /^loginSetup slow steps for /.test(l));
ok(!!slow && /GearSwapLogin \d+ ms/.test(slow), 'a step over 100 ms is named in one line', slow);
ok(!!slow && slow.split(', ').length === 1, '...and only that step', slow);

logs.length = 0; calls.length = 0; slowName = '';
try { run(); threw = null; } catch (e) { threw = e; }
ok(!threw && !logs.some((l) => /slow steps/.test(l)), 'a quick login logs nothing about its steps', logs);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
