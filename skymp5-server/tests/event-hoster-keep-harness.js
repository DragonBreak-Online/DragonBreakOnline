// Scripted test for the event-hoster keep-alive (W4, 11 Nov 2026): a World Director event's hostile keeps the
// hoster that is driving it when it crosses a grid cell, instead of being unsubscribed, released and re-claimed
// from scratch. Nat's dragon changed hoster 6 times in 61 s and T-posed throughout (ev=d62, W3's measurements in
// _work/dragons-1111/HOSTING-AND-HEALTH-1111.md).
//
//   node tests/event-hoster-keep-harness.js
//
// WHAT THIS IS, AND WHAT IT IS NOT. The logic is C++ and this repository has no C++ unit target -
// skymp5-server/cpp has no unit/ directory and the root CMake's BUILD_UNIT_TESTS finds nothing to build - so
// there is nowhere to put a gtest. This reads the C++ source, the way tests/craft-perk-tiers-harness.js already
// does for the craft check. So:
//   - it CAN fail: remove the call, widen the bound, drop a guard, or widen the grid, and a check below goes red;
//   - it CANNOT prove behaviour. It does not run the server, does not move an actor across a cell, and does not
//     watch a subscription. Only the native build plus an event on dev can do that.
// The change was type-checked with the real toolchain (clang++-15 -fsyntax-only, both touched translation units,
// against CT115's own compile_commands.json) - which is more than this harness proves, and still not behaviour.
'use strict';
const fs = require('fs');
const path = require('path');

const CPP = path.resolve(__dirname, '..', 'cpp', 'server_guest_lib');
const read = (f) => fs.readFileSync(path.join(CPP, f), 'utf8').replace(/\r\n/g, '\n');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!ok) failures++; };

const ref = read('MpObjectReference.cpp');
const refH = read('MpObjectReference.h');
const partOne = read('PartOne.cpp');
const gridH = read('Grid.h');

// ---- the keep-alive is wired into the one place that unsubscribes ---------------------------------------------
const fsu = ref.slice(ref.indexOf('void MpObjectReference::ForceSubscriptionsUpdate()'));
const body = fsu.slice(0, fsu.indexOf('\n}\n') + 3);
check('ForceSubscriptionsUpdate asks for a hoster to keep', /EventHosterToKeep\(pos\)/.test(body));
check('...and skips exactly that listener in the unsubscribe loop',
  /for \(auto listener : toRemove\) \{\s*\n\s*if \(listener == keptHoster\) \{\s*\n\s*continue;/.test(body));
check('...before the Unsubscribe calls, so the kept one is never destroyed on that client',
  body.indexOf('if (listener == keptHoster)') < body.indexOf('Unsubscribe(this, listener)'));
check('the subscribe half is untouched: everything the grid offers is still added',
  /for \(auto listener : toAdd\) \{\s*\n\s*Subscribe\(this, listener\);/.test(body));

// ---- the policy, guard by guard. Each of these is a way for it to stay narrow --------------------------------
const keep = ref.slice(ref.indexOf('MpObjectReference* MpObjectReference::EventHosterToKeep'));
const keepBody = keep.slice(0, keep.indexOf('\n}\n') + 3);
check('EventHosterToKeep is defined', keepBody.length > 200);
check('it is declared in the header', /MpObjectReference\* EventHosterToKeep\(/.test(refH));
check('only an actor qualifies', /auto\* asActor = AsActor\(\);\s*\n\s*if \(!asActor\) \{\s*\n\s*return nullptr;/.test(keepBody));
check('only an actor the gamemode marked: private.dboEventHoster == "true"',
  /GetValueDump\("private\.dboEventHoster"\) != "true"/.test(keepBody));
check('no hoster, or hoster 0, keeps nothing', /hosters\.find\(GetFormId\(\)\)/.test(keepBody) && /hosterIt->second == 0/.test(keepBody));
check('the hoster must still be a reference and an actor', /hoster->AsActor\(\)/.test(keepBody));
check('another cell or worldspace hands off', /hoster->GetCellOrWorld\(\) != GetCellOrWorld\(\)/.test(keepBody));
check('and there is a bounded distance, in cells, past which it hands off',
  /dx > kEventHosterKeepCells \|\| dy > kEventHosterKeepCells/.test(keepBody));
check('the bound is 3 cells', /constexpr int16_t kEventHosterKeepCells = 3;/.test(ref));
check('it returns the hoster only after every guard', keepBody.trimEnd().endsWith('return hoster;\n}'));

// ---- narrowness: nothing server-wide moved --------------------------------------------------------------------
// The alternative fix was a wider grid. It was rejected because +-2 is 5x5, about 2.8x the listeners for every
// actor in the game, to help one flyer. These two checks are what stop that creeping in by the back door.
check('the grid cell is still 4096 units', /int16_t\(pos\.x \/ 4096\), int16_t\(pos\.y \/ 4096\)/.test(ref));
check('the grid neighbourhood is still the 3x3 block (+-1)',
  /x1 <= x2 \+ 1 && x1 >= x2 - 1 && y1 <= y2 \+ 1 && y1 >= y2 - 1/.test(gridH));

// ---- the release path still works for everything else --------------------------------------------------------
check('TickHostReleases still releases an unsubscribed hoster',
  /ReleaseHost\(\*remote, "its hoster no longer has it \(unsubscribed\)"\);/.test(partOne));
check('a disconnect still releases, so the keep-alive cannot outlive a user',
  /ReleaseHostedBy\(actor->GetFormId\(\),\s*\n?\s*"its hoster disconnected"\)/.test(partOne));
check('a destroyed hoster and a character switch still release',
  /"its hoster was destroyed"/.test(partOne) && /"its hoster's user switched character"/.test(partOne));

// ---- the log line that cost W3 an hour -----------------------------------------------------------------------
check('the release line names both grid cells', /\(cells \{3\},\{4\} vs \{5\},\{6\}\)/.test(partOne));
check('...from the shared helper, not a second copy of the arithmetic',
  /MpObjectReference::GridCellOf\(remote\.GetPos\(\)\)/.test(partOne) && /static std::pair<int16_t, int16_t> GridCellOf/.test(refH));

// ---- the contract the gameplay side has to honour, stated where it will be read ------------------------------
check('the marker is documented in the header', /private\.dboEventHoster/.test(refH));

console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
