// Mutants for warband-events-harness.js: break the event code on purpose and require the harness to
// notice. A check that cannot fail proves nothing, and this one guards a sweep that destroys actors.
//
// Every mutation is applied to an UNTRACKED COPY of warband.js inside tests/, never to the tracked file
// (a decor mutation test sed-edited a tracked module in place on 26 Oct, the restore did not run, and the
// mutant was pushed). Both copies are removed afterwards.
//   node tests/warband-events-mutants.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const SRC = path.resolve(HERE, '..', 'warband.js');
const HARNESS = path.join(HERE, 'warband-events-harness.js');
const MUT_MODULE = path.join(HERE, 'zz-mutant-warband.js');
const MUT_HARNESS = path.join(HERE, 'zz-mutant-events-harness.js');

const MUTANTS = [
  {
    label: 'the sweep stops re-reading the tag before destroying',
    from: "    if (tagOf(id) !== ev.id) return 0;",
    to: "    if (false) return 0;",
    expect: "left the one whose tag had changed",
  },
  {
    label: 'the teardown ignores eventRetirePerTick and destroys everything at once',
    from: "    const per = Math.max(1, Number(C.eventRetirePerTick) || 4);",
    to: "    const per = 9999;",
    expect: "not all five",
  },
  {
    label: "attach steals an NPC that already belongs to another event",
    from: "        if (was) continue;",
    to: "        if (false) continue;",
    expect: "never stolen",
  },
  {
    label: 'the watchdog stops ending events past their deadline',
    from: "      if (ev.deadlineAt && ev.deadlineAt <= now) endEvent(ev, 'the watchdog'",
    to: "      if (false && ev.deadlineAt <= now) endEvent(ev, 'the watchdog'",
    expect: "past its deadline",
  },
  {
    label: 'a member is found by stale id only, with no desc recovery',
    from: "    const id = m.id && tagOf(m.id) === ev.id ? m.id >>> 0 : idOfDesc(m.desc);",
    to: "    const id = m.id >>> 0;",
    expect: "found again by desc",
  },
  {
    label: 'the state file is never read, so a restart forgets the event',
    from: "    if (S.eventsLoaded) return;\n    S.eventsLoaded = true;",
    to: "    if (true) return;\n    S.eventsLoaded = true;",
    // Not "still running": with the file never read, the record on disk still SAYS running, so that check
    // passes. What gives it away is the recovery - an event whose deadline passed while the server was down
    // is only noticed by loadEvents.
    expect: "ended on load",
  },
];

const cleanup = () => {
  for (const f of [MUT_MODULE, MUT_HARNESS]) {
    try { fs.rmSync(f, { force: true }); } catch (e) { /* leave it */ }
  }
};
process.on('exit', cleanup);

const source = fs.readFileSync(SRC, 'utf8');
const harness = fs.readFileSync(HARNESS, 'utf8');
const POINT_AT = "const MODULE = path.resolve(__dirname, '..', 'warband.js');";
if (!harness.includes(POINT_AT)) {
  console.log('FAIL  cannot repoint the harness: its MODULE line has changed');
  process.exit(1);
}

let good = 0;
console.log('mutants (each must make the harness fail, and name the check it broke):');
console.log('');
for (const m of MUTANTS) {
  const hits = source.split(m.from).length - 1;
  if (hits !== 1) {
    console.log(`!!    ${m.label}\n        the line to mutate appears ${hits} times, not once — the mutant is stale`);
    continue;
  }
  fs.writeFileSync(MUT_MODULE, source.replace(m.from, m.to));
  fs.writeFileSync(MUT_HARNESS, harness.replace(POINT_AT,
    "const MODULE = path.resolve(__dirname, 'zz-mutant-warband.js');"));
  // A mutant that does not parse proves nothing either
  try {
    execFileSync(process.execPath, ['--check', MUT_MODULE], { stdio: 'pipe' });
  } catch (e) {
    console.log(`!!    ${m.label}\n        the mutant does not parse, so it tests nothing`);
    continue;
  }
  let out = '', rc = 0;
  try {
    out = execFileSync(process.execPath, [MUT_HARNESS], { stdio: 'pipe', encoding: 'utf8' });
  } catch (e) {
    rc = e.status === undefined ? 1 : e.status;
    out = `${e.stdout || ''}${e.stderr || ''}`;
  }
  const failed = rc !== 0;
  const named = out.split('\n').some((l) => l.startsWith('FAIL') && l.includes(m.expect));
  const ok = failed && named;
  if (ok) good++;
  console.log(`${ok ? 'ok   ' : '!!   '} ${m.label}`);
  if (ok) {
    console.log(`        caught by: ${out.split('\n').filter((l) => l.startsWith('FAIL') && l.includes(m.expect))[0].trim()}`);
  } else {
    const fails = out.split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 3);
    console.log(`        exit ${rc}; expected a FAIL naming ${JSON.stringify(m.expect)}; got ${fails.length ? fails.join(' / ') : 'no FAIL lines at all'}`);
  }
}

cleanup();
console.log('');
console.log('='.repeat(78));
console.log(`${good} of ${MUTANTS.length} mutants were caught`);
if (good !== MUTANTS.length) process.exit(1);
console.log('the harness fails when the tag check, the pacing, the theft guard, the watchdog,');
console.log('the desc recovery or the state file is broken');
