// Scripted test for the TEST-CLIENT crash guard (Nat, 25 Oct: pressed draw as a Hagraven and the game died in
// RightHandWeaponDrawHandler -> H2H_Equip against HagravenProject). creatureCombat.ts has no imports and
// transpiles on its own; the service around it needs sp, so its wiring is checked in the source. Run from
// skymp5-client:
//
//   ./node_modules/typescript/bin/tsc src/services/services/creatureCombat.ts --outDir <tmp> --module commonjs --target es2019
//   node tests/creature-combat-harness.js <tmp>/creatureCombat.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const mod = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'claude-nate-combat', 'creatureCombat.js'));
const { planFor, GuardLog, CREATURE_ATTACKS, HAGRAVEN_RACE, MAX_TALLIES, HIT_WINDOW_MS } = require(mod);
// PC worktrees are CRLF and a source-grep regex breaks on it, so normalise before matching
const read = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const GUARD = read('src/services/services/creatureInputGuardService.ts');
const INDEX = read('src/index.ts');

let failures = 0;
// Non-throwing: an assertion that dies must not abort the run and under-report the rest
const check = (name, fn, got) => {
  let ok = false, err = null;
  try { ok = typeof fn === 'function' ? fn() : fn; } catch (e) { err = e; }
  const extra = err ? '   threw: ' + err.message : (!ok && got !== undefined ? '   ' + JSON.stringify(got) : '');
  console.log(`${ok && !err ? 'ok  ' : 'FAIL'} ${name}${extra}`);
  if (!ok || err) failures++;
};

// ---- 1. the Hagraven, the only form this test client gives claws to -----------------------------------------------
const CHICKEN = 0x000a919d, FOX = 0x00109c7c; // both read from sync/beastRaceIds.ts, not remembered
check('HAGRAVEN_RACE is the id read out of the plugin (000131FB)', HAGRAVEN_RACE === 0x000131fb);
check('she is the only form with attacks in this test client',
  CREATURE_ATTACKS.size === 1 && !!CREATURE_ATTACKS.get(HAGRAVEN_RACE));

// WeapEquip is the MEASURED name: the 26 Oct session recorded "WeapEquip 3/0 WeapUnEquip 2/0" and
// "attack/cast: NONE EMITTED", while the crash log's "weaponDraw" never fired at all. That is why the first
// build reported "nothing intercepted", so the measured name is the one that must work.
const p = planFor(HAGRAVEN_RACE, 'WeapEquip');
check('the MEASURED draw event becomes her own right-hand attack', () => p && p.kind === 'attack' && p.to === 'attackStart_R', p);
check('the measured sheathe event is intercepted and blanked',
  () => { const q = planFor(HAGRAVEN_RACE, 'WeapUnEquip'); return q && q.kind === 'blank-draw' && q.to === ''; },
  planFor(HAGRAVEN_RACE, 'WeapUnEquip'));
check('the crash-log name is still handled, since it costs nothing',
  () => { const q = planFor(HAGRAVEN_RACE, 'weaponDraw'); return q && q.kind === 'attack' && q.to === 'attackStart_R'; });
check('event names are matched case-insensitively',
  () => { const q = planFor(HAGRAVEN_RACE, 'WEAPEQUIP'); return q && q.kind === 'attack'; });

// Sheathe must be intercepted (it runs the humanoid unequip clip) but must never swing a claw.
const sh = planFor(HAGRAVEN_RACE, 'weapUnEquip');
check('her sheathe is intercepted', () => sh !== null, sh);
check('...and is BLANKED, never rewritten to an attack', () => sh.to === '' && sh.kind === 'blank-draw', sh);

// ---- 2. every other creature body: the guard without the claws ----------------------------------------------------
[['a chicken', CHICKEN], ['a fox', FOX]].forEach(([name, id]) => {
  const d = planFor(id, 'WeapEquip');
  check(`${name} draw is blanked, not translated`, () => d && d.kind === 'blank-draw' && d.to === '', d);
  const s = planFor(id, 'WeapUnEquip');
  check(`${name} sheathe is blanked too`, () => s && s.to === '', s);
});
check('a race id that arrived signed does not throw or match the Hagraven by accident',
  () => { const d = planFor(-1, 'WeapEquip'); return d && d.kind === 'blank-draw'; });

// ---- 3. furniture, which is the same crash class waiting to happen ------------------------------------------------
['IdleChairFrontEnter', 'IdleBlacksmithForgeEnter', 'IdleSitCrossLeggedEnter', 'IdleBedRollEnterStart',
 'IdleWarmHandsStoolEnter', 'IdleThroneEnter', 'IdleKneelStart'].forEach((ev) => {
  const f = planFor(HAGRAVEN_RACE, ev);
  check(`furniture entry is blanked: ${ev}`, () => f && f.kind === 'blank-furniture' && f.to === '', f);
});
['IdleChairFrontExit', 'IdleStop', 'IdleForceDefaultState', 'IdleChairStandUp', 'IdleFurnitureExit'].forEach((ev) => {
  check(`leaving furniture is left alone: ${ev}`, () => planFor(HAGRAVEN_RACE, ev) === null, planFor(HAGRAVEN_RACE, ev));
});

// ---- 4. everything else untouched, because a guard that rewrites too much is its own bug -------------------------
['JumpStandingStart', 'attackStart_L', 'attackStart_R', 'SneakStart', 'bleedOutStart', 'moveStart',
 'IdleCombatStanceToDefault', 'blockStart'].forEach((ev) => {
  check(`untouched: ${ev}`, () => planFor(HAGRAVEN_RACE, ev) === null, planFor(HAGRAVEN_RACE, ev));
});
check('a blank or missing event name is never rewritten',
  () => planFor(HAGRAVEN_RACE, '') === null && planFor(HAGRAVEN_RACE, null) === null &&
        planFor(HAGRAVEN_RACE, undefined) === null);

// ---- 5. the log: what the one dev session has to answer ----------------------------------------------------------
const log = new GuardLog();
check('nothing intercepted yet reads as such', log.summary('131fb').indexOf('nothing intercepted') >= 0, log.summary('131fb'));
const t1 = log.record(p, 'WeapEquip');
const t1again = log.record(p, 'WeapEquip');
check('the same rewrite tallies into one entry', () => t1 === t1again && t1.seen === 2 && log.count === 1, t1);
const t2 = log.record(sh, 'WeapUnEquip');
check('a different source event is its own entry', () => t2 !== t1 && log.count === 2);
t1.ok += 1; t1.failed += 1; t1.hits += 1;
const line = log.summary('131fb');
check('the summary is one line', line.indexOf('\n') < 0, line);
check('...and carries the two answers: did the graph take it, did a hit follow',
  () => /attack "WeapEquip"->"attackStart_R" seen 2 graph 1\/1 hits 1/.test(line), line);
check('...naming the body it came from', line.indexOf('131fb:') === 0, line);
check('a blank rewrite prints readably rather than as nothing', line.indexOf('->"(blank)"') >= 0, line);

const cap = new GuardLog();
for (let i = 0; i < MAX_TALLIES + 5; i++) cap.record(p, `ev${i}`);
check(`the log is capped at ${MAX_TALLIES} entries`, cap.count === MAX_TALLIES, cap.count);
check('...and says how many it dropped rather than silently losing them',
  () => new RegExp(`\\(5 past the ${MAX_TALLIES} cap\\)`).test(cap.summary('131fb')), cap.summary('131fb'));
check('a dropped event returns no tally, so leave() has nothing to credit', cap.record(p, 'evLate') === null);
check('reset clears it for the next body',
  () => { cap.reset(); return cap.count === 0 && cap.summary('x').indexOf('nothing intercepted') >= 0; });
check('the hit window is a swing, not a session', HIT_WINDOW_MS === 1500);

// ---- 6. the service wiring, which cannot run without sp ----------------------------------------------------------
check('the rewrite happens in enter(), before the engine handler runs',
  /enter: \(ctx\) => \{[\s\S]{0,600}?ctx\.animEventName = plan\.to;/.test(GUARD));
check('...and the tally it recorded is kept for leave()', /this\.lastTally = t;/.test(GUARD));
check('leave() credits animationSucceeded to that tally',
  /leave: \(ctx\) => \{[\s\S]{0,300}?if \(ctx\.animationSucceeded\) this\.lastTally\.ok\+\+; else this\.lastTally\.failed\+\+;/.test(GUARD));
check('the hook is registered for the player only',
  /\}, PLAYER_ID, PLAYER_ID\);/.test(GUARD) && /const PLAYER_ID = 0x14;/.test(GUARD));
check('a guard that throws never throws into the animation it guards',
  /catch \{ \/\* a guard must never throw/.test(GUARD));
check('the race is read in update, not in the hook (natives throw in a hook context)',
  /private check\(\): void \{[\s\S]{0,700}?player\.getRace\(\)/.test(GUARD));
check('only a polymorph race arms the guard', /isPolymorphRaceId\(raceId\)/.test(GUARD));
check('the log resets on entering a new body', /this\.guard\.reset\(\);/.test(GUARD));
check('entering a body sheathes, so she never starts drawn', /player\.sheatheWeapon\(\);/.test(GUARD));
check('only the player hits count toward a tally', /if \(agg !== PLAYER_ID\) return;/.test(GUARD));
check('a hit outside the window is not credited', /Date\.now\(\) - this\.pendingAttack\.at > HIT_WINDOW_MS/.test(GUARD));
check('only an attack rewrite waits for a hit', /plan\.kind === "attack"/.test(GUARD));
check('the disablePlayerControls fallback is behind a config flag, flippable without a rebuild',
  /if \(!this\.fallback\(\)\) return;/.test(GUARD) && /cfg\["fallbackDisableFighting"\]/.test(GUARD));
check('...disabling fighting only, leaving movement and looking alone',
  /Game\.disablePlayerControls\(false, true, false, false, false, false, false, false, 0\)/.test(GUARD));
check('...and restoring it on the way out, only if it was taken',
  /private onLeave\(\): void \{\s*\n\s*if \(!this\.disabled\) return;/.test(GUARD) &&
  /Game\.enablePlayerControls\(false, true,/.test(GUARD));
check('the session reports through the diagnostic note, which Report a Problem carries',
  /__dboDiagNote/.test(GUARD) && /logTrace\(this, "Creature input guard"/.test(GUARD));
check('it reports on leaving the body as well as during a long session',
  /this\.report\("left the body"\)/.test(GUARD) && /this\.report\("still in the body"\)/.test(GUARD));
check('the service is registered', /CreatureInputGuardService/.test(INDEX));
check('...after the probe, so the probe sees the ORIGINAL event name',
  INDEX.indexOf('CreatureAnimProbeService') >= 0 &&
  INDEX.indexOf('CreatureAnimProbeService') < INDEX.lastIndexOf('CreatureInputGuardService'));

console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
