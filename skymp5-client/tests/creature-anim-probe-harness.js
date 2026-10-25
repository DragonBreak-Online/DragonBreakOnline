// Scripted test for the creature animation probe: the one measurement the Hagraven's attacks and casts both wait on.
// SendAnimationEventHook's animationSucceeded is "the graph reacted", so ok/failed per event name answers both halves
// of the question - did the input reach the graph, and did the graph take it. creatureAnimProbe.ts has no imports and
// transpiles on its own. Run it from skymp5-client:
//
//   ./node_modules/typescript/bin/tsc src/services/services/creatureAnimProbe.ts --outDir /tmp/claude-nate-probe --module commonjs --target es2019
//   node tests/creature-anim-probe-harness.js /tmp/claude-nate-probe/creatureAnimProbe.js
'use strict';
const fs = require('fs');
const path = require('path');
const { AnimProbe, MAX_NAMES } = require(path.resolve(process.argv[2] || '/tmp/claude-nate-probe/creatureAnimProbe.js'));
const SRC = path.resolve(__dirname, '..', 'src');
const service = fs.readFileSync(path.join(SRC, 'services', 'services', 'creatureAnimProbeService.ts'), 'utf8');

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

// ---- recording -----------------------------------------------------------------------------------------------------
let p = new AnimProbe();
check('a fresh probe has nothing', p.events === 0 && p.names === 0 && !p.anyAccepted());
p.add('attackStart', true);
p.add('attackStart', true);
p.add('attackStart', false);
check('the same event is one name with a tally', p.names === 1 && p.events === 3, [p.names, p.events]);
check('...counted as the graph reacting or not', JSON.stringify(p.list()[0]) === JSON.stringify({ name: 'attackStart', ok: 2, failed: 1 }), p.list()[0]);
check('the graph accepted something', p.anyAccepted());

p = new AnimProbe();
p.add('bashStart', false);
check('nothing accepted when every event was refused', !p.anyAccepted());
check('...which is the case the fallback is for', p.list()[0].failed === 1);

p.add('', true);
check('an empty event name is ignored rather than counted', p.names === 1 && p.events === 1, [p.names, p.events]);

// ---- which events the question is about ----------------------------------------------------------------------------
p = new AnimProbe();
['attackStart', 'attackPowerStartForward', 'AttackStartH2HLeft', 'bashStart', 'MagicCastStart', 'shoutStart',
  'idleChairEnterInstant', 'JumpStandingStart'].forEach((n) => p.add(n, true));
const hot = p.interesting().map((t) => t.name);
check('swings, bashes, casts and shouts are picked out', hot.length === 6, hot);
check('...and the idles are not', !hot.includes('idleChairEnterInstant') && !hot.includes('JumpStandingStart'), hot);
check('...but the idles are still counted', p.events === 8 && p.names === 8, [p.events, p.names]);

// ---- the summary ---------------------------------------------------------------------------------------------------
p = new AnimProbe();
p.add('attackStart', false);
p.add('attackStart', false);
p.add('idleStop', true);
let s = p.summary('131fb');
check('the summary names the race and the totals', /^131fb: 3 events, 2 names/.test(s), s);
check('...puts the attack events first with ok/failed', /attack\/cast: attackStart 0\/2/.test(s), s);
check('...and keeps the rest apart', /other: idleStop 1\/0/.test(s), s);

p = new AnimProbe();
p.add('idleStop', true);
s = p.summary('a919d');
check('a body that emitted NO attack event says so in as many words', /attack\/cast: NONE EMITTED/.test(s), s);

// ---- the cap -------------------------------------------------------------------------------------------------------
p = new AnimProbe();
for (let i = 0; i < MAX_NAMES + 10; i++) p.add('event' + i, true);
check(`past the ${MAX_NAMES}-name cap no new name is kept`, p.names === MAX_NAMES, p.names);
check('...but the events are still counted', p.events === MAX_NAMES + 10, p.events);
check('...and the summary says how many were past it', /past the 40-name cap/.test(p.summary('x')), p.summary('x'));

p.reset();
check('reset clears it for the next body', p.events === 0 && p.names === 0);

// ---- the service: what may run where -------------------------------------------------------------------------------
const hook = service.slice(service.indexOf('sendAnimationEvent.add'), service.indexOf('this.controller.on("update"'));
check('the hook calls NO natives (they throw in a hook context)', !/(Game|Utility|NetImmerse)\./.test(hook),
  (hook.match(/(Game|Utility|NetImmerse)\.\w+/g) || []).slice(0, 4));
check('the hook cannot throw into the animation it watches', /catch \{ \/\* a probe must never break/.test(service));
check('the race is read in update, not in the hook', /controller\.on\("update"/.test(service) && /Game\.getPlayer\(\)/.test(service.slice(service.indexOf('private check('))));
check('it watches the player alone', /PLAYER_ID, PLAYER_ID/.test(service));
check('it only records while in a polymorph body', /if \(!this\.inBody\) return;/.test(service));
check('it summarises rather than noting per event', !/this\.note\(/.test(hook), hook.includes('this.note('));
check('a long body still reports, so a session ending polymorphed is not lost', /REPORT_EVERY/.test(service));
check('the queued report is sent from update, where the diagnostic channel is safe', /if \(this\.pending\)/.test(service));

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
