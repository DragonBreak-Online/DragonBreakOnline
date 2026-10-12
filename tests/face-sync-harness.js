// The face sync diagnostic (fork skymp5-client/src/view/faceSyncDiag.ts, Nate 12 Oct: other players' faces grey and eyeless
// after a staff teleport): each player copy's face steps, one npcDrift line per copy 10 s after it is built or when it is
// destroyed sooner, at most 40 a session; untracked actors (NPCs) are never counted.
//   node tests/face-sync-harness.js <bundle of faceSyncDiag.ts>
'use strict';
const path = require('path');
const bundle = process.argv[2];
if (!bundle) { console.error('usage: node tests/face-sync-harness.js <bundle of faceSyncDiag.ts>'); process.exit(2); }
const F = require(path.resolve(bundle));

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && got !== undefined ? `: got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };
const A = 0xff000a01, B = 0xff000a02, NPC = 0xff000a03;
let probed = [];
const probe = (id) => { probed.push(id); return { exists: true, loaded: true, headParts: 3, eyes: false, faceTexture: true }; };

F.born(A, 0x14, 'Fink Winky', 5, true, 1000);
F.request(A, 1200); F.skip(A, 'interval'); F.skip(A, 'interval'); F.preset(A, 'loadedInSlot'); F.sent(A, 1300);
F.request(NPC, 1200); F.sent(NPC, 1300); F.dropped(NPC, 'gone');
ok('an untracked actor (an NPC copy) is not counted', F.tracked(NPC) === false && F.tracked(A) === true);
ok('nothing is due before 10 s', F.due(10999, probe).length === 0 && probed.length === 0);
let lines = F.due(11000, probe);
const a = lines[0] || {};
ok('one line at 10 s, with the head read then', lines.length === 1 && probed.length === 1 && probed[0] === A, lines);
ok('the line carries every step', a.kind === 'faceSync' && a.remoteId === '14' && a.name === 'Fink Winky' && a.requests === 1 && a.firstRequestMs === 200
  && a.skipped.interval === 2 && a.sent === 1 && a.firstSentMs === 300 && a.preset.loadedInSlot === 1, a);
ok('...expected against found: 5 head parts and eyes wanted, 3 and no eyes found', a.expectedHeadParts === 5 && a.expectsEyes === true && a.probe.headParts === 3 && a.probe.eyes === false, a);
ok('a copy is reported once', F.due(30000, probe).length === 0);

F.born(B, 0x15, 'Sorec', 4, true, 50000);
F.dropped(B, 'gone'); F.destroyed(B, 50400); F.destroyed(B, 50900);
probed = [];
lines = F.due(50500, probe);
ok('a copy destroyed before 10 s is reported at once, without reading its head', lines.length === 1 && lines[0].destroyedMs === 400 && lines[0].probe.exists === false && lines[0].dropped.gone === 1 && probed.length === 0, lines);

for (let i = 0; i < 60; i++) F.born(0xff100000 + i, i, 'P' + i, 4, true, 60000);
lines = F.due(70000, probe);
ok('at most 40 lines a session', lines.length === 38 && F.faceSyncBudget.sent === 40, [lines.length, F.faceSyncBudget.sent]);
ok('...and the rest are dropped, not kept', F.due(80000, probe).length === 0);

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
