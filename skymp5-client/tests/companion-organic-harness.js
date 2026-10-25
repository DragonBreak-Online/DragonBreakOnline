// Scripted test for step 2 of the warband rework (Nat, 25 Oct: "the AI more fluid and organic"), the pure part in
// companionFormation.ts: ranged members on the flanks, each member's small stable jitter, the ripple an order travels
// through the band in (staggerDelayMs), the leash with a gap (1800 out, 1200 back), which hands count as ranged, and step 3's
// glances while holding, boldness (Confidence) and the alias members' vanilla wait.
// Run from skymp5-client:
//
//   node tests/companion-organic-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP companion-organic (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-organic-')), 'formation.js');
esbuild.buildSync({ entryPoints: [path.resolve(__dirname, '../src/services/services/companionFormation.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'silent' });
const m = require(out);

// ---- the formation: rows behind as before, flanks for the ranged -------------------------------------------------------
check('slot 0 keeps the old spot, 128 behind', JSON.stringify(m.formationOffset(0)) === JSON.stringify([0, -128]), m.formationOffset(0));
check('slot 4 is the second row, left column, as before', JSON.stringify(m.formationOffset(4)) === JSON.stringify([-120, -248]), m.formationOffset(4));
const f0 = m.formationOffset(m.flankSlot(0)), f1 = m.formationOffset(m.flankSlot(1)), f2 = m.formationOffset(m.flankSlot(2));
check('the first ranged member stands on the right flank, beside the owner', f0[0] === 240 && f0[1] === -64, f0);
check('the second on the left flank', f1[0] === -240 && f1[1] === -64, f1);
check('the third a rank further out and back on the right', f2[0] === 360 && f2[1] === -124, f2);
// A flank place is off the owner's line of fire ahead: never within 200 units sideways of the owner
check('no flank place in the first 8 is within 200 units sideways of the owner',
  Array.from({ length: 8 }, (_, k) => m.formationOffset(m.flankSlot(k))).every(([x]) => Math.abs(x) >= 200));
check('a flank slot works through formationPoint like any other (owner facing east)',
  (() => { const p = m.formationPoint(m.flankSlot(0), [0, 0, 0], 90); return Math.abs(p[0] - -64) < 1e-6 && Math.abs(p[1] - -240) < 1e-6; })(),
  m.formationPoint(m.flankSlot(0), [0, 0, 0], 90));

// ---- jitter: small, stable, different per member -----------------------------------------------------------------------
const ids = Array.from({ length: 50 }, (_, i) => 0xff000100 + i * 7);
const js = ids.map((id) => m.memberJitter(id));
check('each member is at most 25 units off its point', js.every((j) => Math.abs(j.dx) <= 25 && Math.abs(j.dy) <= 25), js.slice(0, 3));
check('its radii are within 15% of the service\'s', js.every((j) => j.radiusMult >= 0.85 && j.radiusMult <= 1.15));
check('the same member gets the same jitter every time (no flapping)', JSON.stringify(m.memberJitter(ids[3])) === JSON.stringify(js[3]));
check('members differ (50 members, at least 45 distinct offsets)', new Set(js.map((j) => `${j.dx.toFixed(1)},${j.dy.toFixed(1)}`)).size >= 45);
const spread = (xs) => Math.max(...xs) - Math.min(...xs);
check('the jitter uses its range (spread over 30 units on each axis)', spread(js.map((j) => j.dx)) > 30 && spread(js.map((j) => j.dy)) > 30);

// ---- the ripple ------------------------------------------------------------------------------------------------------
const d = ids.slice(0, 10).map((id, n) => m.staggerDelayMs(n, id));
check('the first member takes an order at once', d[0] === 0, d[0]);
check('every delay is under 1150 ms (900 cap + 250 spread)', d.every((x) => x >= 0 && x < 1150), d);
check('the band does not take an order on one tick: the delays of 10 cover over 600 ms', spread(d) > 600, d);
check('a member\'s delay is stable', m.staggerDelayMs(4, ids[4]) === d[4]);
check('the 20th member waits no longer than the cap allows', m.staggerDelayMs(20, ids[0]) < 1150);

// ---- the leash with a gap ----------------------------------------------------------------------------------------------
check('fighting at 1500: not leashed (it was, at the old single cutoff)', m.leashStep(false, 1500) === false);
check('past 1800: leashed', m.leashStep(false, 1801) === true);
check('leashed at 1500: still leashed, it does not turn back to fight', m.leashStep(true, 1500) === true);
check('back within 1200: free to fight again', m.leashStep(true, 1199) === false);
// A member drifting 1700-1900 at the edge of a fight: count how often its state flips over 40 steps
let leashed = false, flips = 0;
for (let i = 0; i < 40; i++) { const dist = 1800 + 100 * Math.sin(i); const n = m.leashStep(leashed, dist); if (n !== leashed) flips++; leashed = n; }
check('at the edge of a fight (1700-1900) the state flips at most once', flips <= 1, flips);

// ---- ranged hands ------------------------------------------------------------------------------------------------------
check('a bow, a staff, a spell or a crossbow in either hand is ranged', m.isRangedHands(7, 0) && m.isRangedHands(0, 8) && m.isRangedHands(9, 10) && m.isRangedHands(0, 12));
check('swords, shields, torches and fists are not', !m.isRangedHands(1, 10) && !m.isRangedHands(0, 11) && !m.isRangedHands(5, 0) && !m.isRangedHands(-1, -1));

// ---- the wiring in companionService.ts (source checks) -----------------------------------------------------------------
const svc = fs.readFileSync(path.resolve(__dirname, '../src/services/services/companionService.ts'), 'utf8').replace(/\r\n/g, '\n');
check('companionService takes ranged members to flank slots', /state\.slot = this\.isRanged\(actor, state, now\) \? flankSlot\(flank\+\+\) : slot\+\+;/.test(svc));
check('...acts on the staggered order, and reports the server\'s', /const c = this\.staggered\(server, state, now\);/.test(svc) && /this\.report\(server, actor, player, state\);/.test(svc));
check('...keeps its jittered offset with its own radii', /keepOffsetFromActor\(player, ox \+ j\.dx, oy \+ j\.dy, 0, 0, 0, angle,\n\s+CompanionService\.catchUpRadius \* j\.radiusMult, CompanionService\.followRadius \* j\.radiusMult\)/.test(svc));
check('...leashes both ordered and engine-picked fights with leashStep', (svc.match(/state\.leashed = leashStep\(state\.leashed, /g) || []).length === 2);
check('...and no longer uses the single 1500 cutoff', !/combatLeashDistance/.test(svc));

// ---- step 3: holding with glances, boldness -------------------------------------------------------------------------
const id0 = ids[0];
const share = Array.from({ length: 2000 }, (_, i) => m.glancing(id0, 1e9 + i * 50)).filter(Boolean).length / 2000;
check('a holding member glances at its owner about 2.5 s in every 8-14 s (between 15% and 32% of the time)', share > 0.15 && share < 0.32, share);
const glanceStarts = (id) => { let n = 0, was = false; for (let t = 0; t < 60000; t += 250) { const g = m.glancing(id, 1e9 + t); if (g && !was) n++; was = g; } return n; };
check('...4 to 8 glances a minute', [ids[0], ids[1], ids[2]].every((id) => { const n = glanceStarts(id); return n >= 4 && n <= 8; }), [ids[0], ids[1], ids[2]].map(glanceStarts));
check('two members do not glance in step (their windows differ)', ids.slice(0, 10).some((id) => Array.from({ length: 200 }, (_, i) => m.glancing(id, 1e9 + i * 300) !== m.glancing(ids[0], 1e9 + i * 300)).some(Boolean)));
const conf = ids.map((id) => m.memberConfidence(id));
check('boldness is Average, Brave or Foolhardy, never Cowardly or Cautious', conf.every((c) => c >= 2 && c <= 4), conf);
check('...all three appear in a band of 50', [2, 3, 4].every((c) => conf.includes(c)), conf);
check('...and a member keeps its own', m.memberConfidence(ids[7]) === conf[7]);
check('companionService sets each member\'s Confidence in prepare()', /actor\.setActorValue\("Confidence", memberConfidence\(remoteId\)\);/.test(svc));
check('an alias member on hold waits through the follower package (WaitingForPlayer 1), and follows again on 0',
  /actor\.setActorValue\("WaitingForPlayer", 1\);/.test(svc) && /actor\.setActorValue\("WaitingForPlayer", 0\);/.test(svc));
check('a hold no longer releases the alias (stay keeps it)', !/private stay\([^)]*\): void \{\n\s+this\.releaseAlias\(state\);/.test(svc));
check('the other members glance at the owner with setLookAt and clearLookAt', /actor\.setLookAt\(player, false\);/.test(svc) && /actor\.clearLookAt\(\);/.test(svc));

// ---- step 3: the quick orders --------------------------------------------------------------------------------------
const kb = fs.readFileSync(path.resolve(__dirname, '../src/services/services/keybindsService.ts'), 'utf8');
const rows = fs.readFileSync(path.resolve(__dirname, '../../skymp5-front/src/features/journal/tabs/SettingsKeys.tsx'), 'utf8');
const KEYS = ['warbandFollowKeyCode', 'warbandHoldKeyCode', 'warbandAttackKeyCode', 'warbandNearestKeyCode'];
check('the four quick-order keys are in the central registry (MENU_KEYS), on Num1-Num4', /warbandFollowKeyCode: DxScanCode\.Num1, warbandHoldKeyCode: DxScanCode\.Num2, warbandAttackKeyCode: DxScanCode\.Num3, warbandNearestKeyCode: DxScanCode\.Num4/.test(kb));
check('...each may be unbound (OPTIONAL_KEYS)', KEYS.every((k) => { const line = (kb.match(/const OPTIONAL_KEYS = new Set\(\[[^\]]*\]\)/) || [''])[0]; return line.includes(`"${k}"`); }));
check('...and each has a staff-only, optional row on the F3 Settings page', KEYS.every((k) => rows.includes(`names: ['${k}'], staff: true, optional: true`)));
check('a press sends the same order the Warband view sends (dbo warband <order>)', /sendCustomPacket\(this\.controller, \{ customPacketType: "dbo", event: "warband", args: \[order\] \}\);/.test(svc));
check('...only while the player leads a warband, never into the chat, at most one in 400 ms',
  /!this\.companions\.some\(\(c\) => c\.kind === "companion"\)\) return;/.test(svc) && /isMenuKeyPressBlocked\(this\.sp, this\.controller, e\)\) return;/.test(svc) && /orderKeyRepeatMs = 400/.test(svc));
check('...and the orders are follow, stay, attacktarget, attacknearest', /"follow"\][\s\S]*"stay"\][\s\S]*"attacktarget"\][\s\S]*"attacknearest"\]/.test(svc));

console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
