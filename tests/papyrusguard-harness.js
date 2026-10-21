// Papyrus OnUpdate guard (papyrusguard.js, bug sweep item 4, 21 Oct). Loads the real module against a fake mp and a fake
// clock, with the two looping vanilla scripts modelled the way the fork runs them: RegisterForSingleUpdate sets a timer,
// the timer sends "onPapyrusEvent:OnUpdate" to the gamemode, false blocks the event, anything else runs the script's
// OnUpdate, and these two ask for the next update every time (their bytecode: dunSoljundsBossSCRIPT line 112 divides
// bossCurrent by bossBase, both None, then registers again while BOSSFIGHTING; BYOHHouseTrophyBaseScript line 21 compares
// GetItemCount on None with 0, then GetDistance(None) = 0.0 < 250 registers again).
// Before: the loops log every second for as long as the clock runs. After: the first refused OnUpdate ends each loop,
// including loops already running when the module loads (a hot reload), and nothing else is refused.
//   node tests/papyrusguard-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'papyrusguard.js');

let fails = 0;
const ok = (c, t, g) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${t}${c || g === undefined ? '' : '   ' + JSON.stringify(g)}`); if (!c) fails++; };

// A fake clock: the server's timers (RegisterForSingleUpdate) queue here, run(ms) advances
let now = 1790000000000; let queue = [];
Date.now = () => now;
const later = (ms, fn) => queue.push({ at: now + ms, fn });
const run = (ms) => { const end = now + ms; for (;;) { queue.sort((a, b) => a.at - b.at); const h = queue[0]; if (!h || h.at > end) break; queue.shift(); now = h.at; h.fn(); } now = end; };

// Forms: the Soljund's Sinkhole trigger, a trophy base placed by a mod (plugin 0x49), an ordinary scripted form, a runtime form
const SOLJUND = 0x0006aebe, TROPHY = 0x490bf794, OTHER = 0x00012345, RUNTIME = 0xff00abcd;
const DESC = { [SOLJUND]: '0006AEBE:Skyrim.esm', [TROPHY]: '0bf794:The Great Cities - Minor Cities and Towns.esp', [OTHER]: '12345:Skyrim.esm', [RUNTIME]: 'ff00abcd' };
const BASE = { [SOLJUND]: '6aebd:Skyrim.esm', [TROPHY]: '0000A31E:HearthFires.esm', [OTHER]: '777:Skyrim.esm', [RUNTIME]: 'a31a:HearthFires.esm' };
const asked = { desc: 0, base: 0 };
const mp = {
  getDescFromId: (id) => { asked.desc++; const d = DESC[id >>> 0]; if (d === undefined) throw new Error('no such form'); return d; },
  get: (id, k) => { if (k !== 'baseDesc') return undefined; asked.base++; const b = BASE[id >>> 0]; if (b === undefined) throw new Error('no such form'); return b; },
};

// The server's side (WorldState/PapyrusEventEvent): an OnUpdate goes through the gamemode slot first
const serverLog = [];
const SCRIPTS = {
  [SOLJUND]: () => { serverLog.push('[error] VarValue::operator/ - Wrong type'); return true; },
  [TROPHY]: () => { serverLog.push("[warning] Unable to determine Actor for 'Game.GetPlayer' in 'OnUpdate'", '[error] VarValue::operator> - Wrong type', "[warning] Unable to determine Actor for 'Game.GetPlayer' in 'OnUpdate'"); return true; },
  [OTHER]: () => true, // an unguarded script that also polls every second
  [RUNTIME]: () => true,
};
const ran = new Map();
const registerForSingleUpdate = (id, s) => later(s * 1000, () => {
  const slot = mp['onPapyrusEvent:OnUpdate'];
  const verdict = typeof slot === 'function' ? slot(id) : undefined;
  if (verdict === false) return; // blocked: the script's OnUpdate does not run, so nothing asks for the next one
  ran.set(id, (ran.get(id) || 0) + 1);
  if (SCRIPTS[id]()) registerForSingleUpdate(id, 1.0);
});
const count = (re) => serverLog.filter((l) => re.test(l)).length;

const logs = [];
const load = (cfg) => require(MODULE)({ mp, log: (...x) => logs.push(x.join(' ')), cfg: cfg || {} });
const fresh = () => { delete require.cache[MODULE]; };
delete globalThis.__dboPapyrusGuard; delete globalThis.__dboPapyrusGuardWrapped; delete globalThis.__dboPapyrusOnUpdate;

// ---- BEFORE: no guard, as live on 21 Oct ------------------------------------------------------------------------------
registerForSingleUpdate(SOLJUND, 1.0); // a player walks into Soljund's Sinkhole (OnTriggerEnter)
registerForSingleUpdate(TROPHY, 1.0); // a player activates the trophy base (OnActivate)
run(600000);
ok(count(/operator\//) === 600 && count(/operator>/) === 600 && count(/Unable to determine/) === 1200,
  'before: 10 minutes of both loops log 600 operator/, 600 operator> and 1200 GetPlayer warnings', { div: count(/operator\//), gt: count(/operator>/) });
ok(queue.length === 2, 'before: both loops are still asking for their next update after 10 minutes (until a restart)', queue.length);

// ---- AFTER: the guard loads while both loops run (a hot reload) -------------------------------------------------------
const innerCalls = []; let innerVerdict;
mp['onPapyrusEvent:OnUpdate'] = (id) => { innerCalls.push(id >>> 0); return innerVerdict; }; // whatever had the slot before
fresh(); load();
ok(/papyrus guard on: OnUpdate refused on 1 reference\(s\) and 2 base\(s\); loop report every 10 min at 120\+/.test(logs.join('\n')), 'loads with the Soljund trigger and the two trophy bases', logs);
const before = serverLog.length;
run(600000);
ok(serverLog.length === before, 'after: not one more error line in the next 10 minutes', serverLog.length - before);
ok(queue.length === 0, 'after: both loops have ended, nothing asks for another update');
const S = globalThis.__dboPapyrusGuardTest.state();
ok(S.refused.get(SOLJUND) === 1 && S.refused.get(TROPHY) === 1, 'after: each loop ended at its first refused OnUpdate (one refusal each)', [...S.refused]);
ok(innerCalls.length === 0, 'a refused OnUpdate does not reach the previous handler either');

// A player walks in again / sits again: one refused OnUpdate, no line
registerForSingleUpdate(SOLJUND, 1.0); registerForSingleUpdate(TROPHY, 1.0);
run(5000);
ok(serverLog.length === before && queue.length === 0, 'a new start of either script ends at its first OnUpdate, without a line');

// ---- nothing else is refused ----------------------------------------------------------------------------------------
registerForSingleUpdate(OTHER, 1.0);
run(10500);
ok(ran.get(OTHER) === 10 && innerCalls.filter((x) => x === OTHER).length === 10, 'an unguarded form gets every OnUpdate, through the previous handler', [ran.get(OTHER), innerCalls.length]);
queue = [];
innerVerdict = false;
ok(mp['onPapyrusEvent:OnUpdate'](OTHER) === false, 'the previous handler\'s own verdict on an unguarded form is returned unchanged (false)');
innerVerdict = undefined;
ok(mp['onPapyrusEvent:OnUpdate'](OTHER) === undefined, '...and so is undefined');
// a runtime form whose base is a trophy base is refused too, and asked each time (its id may later be another form's)
const b0 = asked.base;
ok(mp['onPapyrusEvent:OnUpdate'](RUNTIME) === false && mp['onPapyrusEvent:OnUpdate'](RUNTIME) === false && asked.base - b0 === 2, 'a runtime trophy base is refused, its base asked on every OnUpdate', asked.base - b0);

// ---- the desc forms the server may write ----------------------------------------------------------------------------
const { normDesc } = globalThis.__dboPapyrusGuardTest;
ok(normDesc('0006AEBE:Skyrim.esm') === normDesc('6aebe:skyrim.esm') && normDesc('0000A31E:HearthFires.esm') === 'a31e:hearthfires.esm', 'descs match whatever the padding and case');

// ---- a reload: the slot is wrapped once, the lists follow the new config --------------------------------------------
const slot1 = mp['onPapyrusEvent:OnUpdate'];
innerCalls.length = 0;
fresh(); load({ papyrusGuard: { refs: [], bases: ['a31e:HearthFires.esm'] } });
ok(mp['onPapyrusEvent:OnUpdate'] === slot1, 'a reload does not wrap the slot again');
ok(mp['onPapyrusEvent:OnUpdate'](SOLJUND) === undefined && innerCalls.length === 1, 'after a reload with the trigger taken off the list, its OnUpdate runs again, once through the previous handler', innerCalls);
ok(mp['onPapyrusEvent:OnUpdate'](TROPHY) === false, '...and the trophy base, still listed, is still refused');
fresh(); load({ papyrusGuard: { enabled: false } });
ok(mp['onPapyrusEvent:OnUpdate'](TROPHY) === undefined, 'enabled: false refuses nothing');
// a failed load (gamemode.js sets the hook to null): every OnUpdate goes through
globalThis.__dboPapyrusOnUpdate = null;
ok(mp['onPapyrusEvent:OnUpdate'](SOLJUND) === undefined, 'with the hook gone (failed load) every OnUpdate goes through');
// the guard throwing never stops a script
globalThis.__dboPapyrusOnUpdate = () => { throw new Error('boom'); };
ok(mp['onPapyrusEvent:OnUpdate'](SOLJUND) === undefined, 'a guard that throws lets the script run');

// ---- the loop report: one line per window at most, naming the busy forms by desc and base ---------------------------
delete globalThis.__dboPapyrusGuard; logs.length = 0; queue = [];
fresh(); load();
const NEARLY = 0x00054321; DESC[NEARLY] = '54321:Skyrim.esm'; BASE[NEARLY] = '999:Skyrim.esm'; SCRIPTS[NEARLY] = () => true;
registerForSingleUpdate(OTHER, 1.0); // 1 a second: 600 in a window
for (let i = 0; i < 100; i++) mp['onPapyrusEvent:OnUpdate'](NEARLY); // 100: under reportMin
registerForSingleUpdate(SOLJUND, 1.0);
run(600500);
let lines = logs.filter((l) => /^papyrus OnUpdate, last/.test(l));
ok(lines.length === 1 && /refused 1 on 1 guarded form\(s\) \[6aebe:skyrim\.esm x1\]/.test(lines[0]) && /1 other form\(s\) at 120\+ \(a loop\?\): 12345:skyrim\.esm \(base 777:skyrim\.esm\) x\d{3}/.test(lines[0]) && !/54321/.test(lines[0]),
  'after 10 minutes one line: the refusal, and the unguarded form at 1 a second named with its base; the form at 100 is not', lines);
queue = [];
for (let i = 0; i < 10000; i++) mp['onPapyrusEvent:OnUpdate'](OTHER);
run(30000);
lines = logs.filter((l) => /^papyrus OnUpdate, last/.test(l));
ok(lines.length === 1, '10,000 OnUpdates inside one window write no second line (rate limited to one per window)', lines.length);
now += 600000; mp['onPapyrusEvent:OnUpdate'](OTHER);
lines = logs.filter((l) => /^papyrus OnUpdate, last/.test(l));
ok(lines.length === 2 && /x1000[01]\b/.test(lines[1]), 'the next window reports the burst once (the OnUpdate that closed the last window counts in this one)', lines[1]);
now += 600000; mp['onPapyrusEvent:OnUpdate'](OTHER);
ok(logs.filter((l) => /^papyrus OnUpdate, last/.test(l)).length === 2, 'a quiet window (one OnUpdate, nothing refused) writes nothing');
fresh(); load({ papyrusGuard: { report: false } });
now += 600000; for (let i = 0; i < 500; i++) mp['onPapyrusEvent:OnUpdate'](SOLJUND);
now += 600000; mp['onPapyrusEvent:OnUpdate'](OTHER);
ok(logs.filter((l) => /^papyrus OnUpdate, last/.test(l)).length === 2, 'report: false writes no report line');

// ---- cost: constant per event, one desc lookup per plugin form --------------------------------------------------------
delete globalThis.__dboPapyrusGuard; fresh(); load();
const FORMS = []; for (let i = 0; i < 50; i++) { const id = 0x00100000 + i; FORMS.push(id); DESC[id] = `${id.toString(16)}:Skyrim.esm`; BASE[id] = '1:Skyrim.esm'; }
const d0 = asked.desc, bb0 = asked.base; const t0 = process.hrtime.bigint();
for (let i = 0; i < 200000; i++) mp['onPapyrusEvent:OnUpdate'](FORMS[i % 50]);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
ok(asked.desc - d0 === 50 && asked.base - bb0 === 50, '200,000 OnUpdates on 50 plugin forms ask each form\'s desc and base once', [asked.desc - d0, asked.base - bb0]);
ok(ms < 1000, `200,000 OnUpdates in ${ms.toFixed(0)} ms (well under 5 us each)`, ms);
const st = globalThis.__dboPapyrusGuardTest.state();
for (let i = 0; i < 5000; i++) { const id = 0x00200000 + i; DESC[id] = `${id.toString(16)}:Skyrim.esm`; mp['onPapyrusEvent:OnUpdate'](id); }
ok(st.counts.size <= 4096 && st.verdict.size <= 4096 && st.dropped > 0, 'the Maps stay capped at 4096 forms', [st.counts.size, st.verdict.size, st.dropped]);

// ---- gamemode.js loads it after traps.js, and a failed load lets every OnUpdate through ----------------------------
const gm = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const at = gm.indexOf("path.resolve('papyrusguard.js')");
ok(at > gm.indexOf("path.resolve('traps.js')") && /papyrusguard\.js failed to load:[^\n]*globalThis\.__dboPapyrusOnUpdate = null/.test(gm), 'gamemode.js loads papyrusguard.js after traps.js and clears the hook if the load fails');

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
