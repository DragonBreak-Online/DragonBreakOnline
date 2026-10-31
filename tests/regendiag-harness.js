// /regendiag (regendiag.js, Leader 31 Oct): a staff read of every factor on a player's regeneration and a measured rate.
// Pins the STALE call (a rate mult at 0 with no chill freeze), the ceiling sum, the measurement and the wiring.
//   node tests/regendiag-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, what, got) => { if (c) pass++; else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); } };

const STAFF = 0xff000001, P = 0xff000002;
const props = new Map();
const told = [], logged = [], cmds = {}, timers = [];
const savedTimeout = global.setTimeout; global.setTimeout = (fn, ms) => { timers.push([fn, ms]); return 0; };
const mp = { get: (a, k) => props.get(`${a}|${k}`), getServerSettings: () => ({ regenerationMultiplier: 1 }) };
require(path.resolve(ROOT, 'regendiag.js'))({
  mp, log: (...x) => logged.push(x.join(' ')), personal: (a, t) => told.push(t), display: (a) => (a === P ? 'Aldric #AB12' : 'Staff'),
  registerChatCommand: (n, f, o) => { cmds[n] = { f, o }; }, findByName: (q) => (/aldric/i.test(q) ? P : 0),
});
ok(cmds.regendiag && cmds.regendiag.o && cmds.regendiag.o.admin === true, '/regendiag is registered for staff only');

const now = Date.now();
globalThis.__dboAvSent = new Map([[P, { MagickaRateMult: { value: 0, at: now - 120000 }, StaminaRateMult: { value: 100, at: now - 5000 } }]]);
globalThis.__dboChillRateMult = () => 1;
globalThis.__dboRacialRegenDiag = (a, stat) => ({ race: 'altmer', sign: '', raceRate: stat === 'magicka' ? 3 : 1, factor: stat === 'magicka' ? 1.5 : 1, extraPerSecond: stat === 'magicka' ? 0.015 : 0, fighting: false, combatMult: 0.33, castHeld: false });
props.set(`${P}|percentages`, { health: 1, magicka: 0.2, stamina: 0.5 });
const run = (args) => { told.length = 0; cmds.regendiag.f(STAFF, args); };
run('Aldric 5');
ok(/Measuring Aldric #AB12 for 5 s/.test(told[0]), 'it measures the player named, for the seconds asked', told);
ok(timers.length === 1 && timers[0][1] === 5000, '...after that many seconds', timers.map((t) => t[1]));
props.set(`${P}|percentages`, { health: 1, magicka: 0.2, stamina: 0.6 });
timers.shift()[0]();
const all = told.join('\n');
ok(/magicka: 20\.00% -> 20\.00%, 0\.00%\/s measured, ceiling 0\.00%\/s/.test(all), 'magicka: no movement, and a 0 rate mult makes the ceiling 0', all);
ok(/MagickaRateMult 0 sent 120s ago/.test(all), '...the last value sent, and when', all);
ok(/STALE magicka: MagickaRateMult is 0 on the server with no chill freeze/.test(all), 'a 0 with no chill is called STALE', all);
ok(/stamina: 50\.00% -> 60\.00%, 2\.00%\/s measured, ceiling 1\.00%\/s/.test(all), 'stamina: the measured share a second beside the ceiling (rate 1 x 100)', all);
ok(/HealRateMult none sent \(base\)/.test(all) && /health is full/.test(all), 'a rate never sent reads as the base; a full bar says it cannot be measured', all);
ok(/race altmer rate 3 factor x1\.50 extra 1\.50%\/s/.test(all), "the race gift's factor and extra share a second", all);
ok(logged.some((l) => /regendiag Aldric #AB12/.test(l) && /STALE magicka/.test(l)), 'the whole reading goes to the log on one line', logged);

// With the chill freeze in effect the 0 is expected
globalThis.__dboChillRateMult = (a, av) => (av === 'MagickaRateMult' ? 0 : 1);
props.set(`${P}|private.dboDeathChill`, { leftMs: 9 * 60000 });
run('Aldric');
timers.shift()[0]();
ok(!/STALE magicka/.test(told.join('\n')) && /Death's Chill 9 min left/.test(told.join('\n')) && /chill x0/.test(told.join('\n')), "a 0 under Death's Chill at its cap is not stale", told);
ok(timers.length === 0, 'the default wait is one timer');
run('nobody');
ok(/No one online/.test(told[0]) && timers.length === 0, 'an unknown name measures nothing', told);
run('');
ok(/Measuring Staff/.test(told[0]), 'no name: the staff member themself');
timers.length = 0;
run('Aldric 999');
ok(timers[0][1] === 30000, 'at most 30 s', timers[0]);
timers.length = 0;

// Wiring: gamemode records every SetActorValue and loads the module; racial.js offers its view
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const sav = gm.slice(gm.indexOf('const setActorValue = '), gm.indexOf('const applyNeedsStage = '));
ok(/mp\.callPapyrusFunction\('method', 'Actor', 'SetActorValue'[^\n]*\n[\s\S]*sent\[av\] = \{ value, at: Date\.now\(\) \};\s*\n\s*return true;/.test(sav), 'gamemode.js setActorValue records the value sent, after the call');
ok(/require\(REGENDIAG_JS\)\(\{ mp, log, personal, registerChatCommand, findByName, display \}\)/.test(gm), 'gamemode.js loads regendiag.js');
const racial = fs.readFileSync(path.join(ROOT, 'racial.js'), 'utf8');
ok(/globalThis\.__dboRacialRegenDiag = \(a, stat\) =>/.test(racial), 'racial.js exports __dboRacialRegenDiag');

global.setTimeout = savedTimeout;
console.log(`${pass}/${pass + fail}`);
process.exitCode = fail ? 1 : 0;
