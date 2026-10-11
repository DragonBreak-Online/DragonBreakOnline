// Scripted test for emoteWheelWatch.ts: the emote wheel (B) is taken down when it has been drawn without the cursor for
// UNFOCUSED_CLOSE_MS, and its key closes it again (karta.gina, 10 Oct: the wheel "in my face for the next 5 minutes",
// "couldn't even click on it"). Plus source checks that emoteService.ts uses both. Run it from skymp5-client:
//
//   ./node_modules/typescript/bin/tsc src/services/services/emoteWheelWatch.ts --outDir /tmp/dbo-emotewatch --module commonjs --target es2019
//   node tests/emote-wheel-watch-harness.js /tmp/dbo-emotewatch/emoteWheelWatch.js
'use strict';
const fs = require('fs');
const path = require('path');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

let mod = null;
try { mod = require(path.resolve(process.argv[2] || '/tmp/dbo-emotewatch/emoteWheelWatch.js')); } catch (e) { check('emoteWheelWatch.js loads', false, String(e.message).slice(0, 120)); }
if (mod) {
  const { wheelWatch, wheelKeyAction, OPEN_GRACE_MS, UNFOCUSED_CLOSE_MS } = mod;
  const run = (ticks) => { let since = 0, out = 'keep', at = -1; for (const t of ticks) { const r = wheelWatch(Object.assign({ unfocusedSince: since }, t)); since = r.unfocusedSince; if (r.action === 'close' && at < 0) { out = 'close'; at = t.now; } } return { out, at }; };
  const steps = (from, to, o) => { const a = []; for (let n = from; n <= to; n += 250) a.push(Object.assign({ menuOpen: true, focused: true, openedAt: 0, now: n }, o)); return a; };

  check('a closed wheel is never closed again', wheelWatch({ menuOpen: false, focused: false, openedAt: 0, unfocusedSince: 0, now: 99999 }).action === 'keep');
  check('an open wheel with the cursor stays, for minutes', run(steps(0, 300000, {})).out === 'keep');
  check('the first second after opening, a missing cursor does not count (setFocused lands later)', run(steps(0, OPEN_GRACE_MS - 1, { focused: false })).out === 'keep');
  const lost = run(steps(0, 10000, { focused: false }));
  check(`a wheel never given the cursor closes at ${OPEN_GRACE_MS + UNFOCUSED_CLOSE_MS} ms, not minutes later`, lost.out === 'close' && lost.at <= OPEN_GRACE_MS + UNFOCUSED_CLOSE_MS + 250, lost);
  // Focused at first, then a server panel opens over it and closes: setFocused(false) with the wheel still drawn
  const later = run(steps(0, 5000, {}).concat(steps(5250, 20000, { focused: false })));
  check('a wheel that loses the cursor later closes 1.5 s after', later.out === 'close' && later.at >= 5250 + UNFOCUSED_CLOSE_MS && later.at <= 5250 + UNFOCUSED_CLOSE_MS + 250, later);
  // A blink of lost focus (the page re-taking it) is forgiven
  const blink = run(steps(0, 3000, {}).concat(steps(3250, 3750, { focused: false }), steps(4000, 20000, {})));
  check('a short loss of the cursor that comes back is forgiven', blink.out === 'keep', blink);
  check('the key opens a closed wheel', wheelKeyAction(false) === 'open');
  check('the key closes an open wheel (it was ignored)', wheelKeyAction(true) === 'close');
}

// emoteService.ts uses both
const svc = fs.readFileSync(path.join(__dirname, '..', 'src/services/services/emoteService.ts'), 'utf8');
check('emoteService no longer ignores its key while the wheel is open', !/code !== this\.menuKey \|\| !e\.isDown \|\| this\.menuOpen/.test(svc));
check('emoteService closes on its key through wheelKeyAction', /wheelKeyAction\(this\.menuOpen\) === "close"/.test(svc));
check('emoteService watches the open wheel every update', /controller\.on\("update", \(\) => this\.watchWheel\(\)\)/.test(svc) && /wheelWatch\(\{/.test(svc));
check('the wheel says how long it was open and what closed it', /wheel closed after \$\{Date\.now\(\) - this\.openedAt\} ms by/.test(svc));

console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
