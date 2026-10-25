// Scripted test for the creature third-person camera. The camera attaches to "Camera3rd [Cam3]" in the skeleton;
// creature skeletons mostly have no such node, so third person sits in the ground and the fOverShoulder* ini values
// (offsets FROM that node) do nothing. The rule this guards: the ini is written ONLY when the node is really there,
// because a value written without one is inherited by the next body whose camera re-initialises - which is how Nat's
// human camera came back raised on 25 Oct. creatureCamera.ts has no imports and transpiles on its own. Run it from
// skymp5-client:
//
//   ./node_modules/typescript/bin/tsc src/services/services/creatureCamera.ts --outDir /tmp/claude-nate-cam --module commonjs --target es2019
//   node tests/creature-camera-harness.js /tmp/claude-nate-cam/creatureCamera.js
'use strict';
const fs = require('fs');
const path = require('path');
const m = require(path.resolve(process.argv[2] || '/tmp/claude-nate-cam/creatureCamera.js'));
const { CAM3_NODE, OVER_SHOULDER_INI, planForBody, planForLeaving, readOffsets } = m;
const SRC = path.resolve(__dirname, '..', 'src');
const service = fs.readFileSync(path.join(SRC, 'services', 'services', 'creatureCameraService.ts'), 'utf8');

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

// ---- the node name and the ini keys --------------------------------------------------------------------------------
check('the node name is the full bracketed name the skeleton uses', CAM3_NODE === 'Camera3rd [Cam3]', CAM3_NODE);
check('...which is the convention the rest of the client uses for nodes', /^\w[\w ]* \[\w+\]$/.test(CAM3_NODE), CAM3_NODE);
check('the four ini keys are all "fName:Camera"', Object.values(OVER_SHOULDER_INI).every((k) => /^f[A-Za-z]+:Camera$/.test(k)), OVER_SHOULDER_INI);
check('...and they are the over-shoulder pair plus the combat pair',
  JSON.stringify(Object.keys(OVER_SHOULDER_INI)) === JSON.stringify(['x', 'z', 'combatX', 'combatZ']), Object.keys(OVER_SHOULDER_INI));

// ---- entering a body: the safety rule ------------------------------------------------------------------------------
let p = planForBody(false, { z: 50 });
check('NO camera node: first person', p.person === 'first', p);
check('NO camera node: the ini is NOT written even when the server sent offsets', p.offsets === null, p);
check('...and it says why in words a player could be shown', /ground/.test(p.why), p.why);

p = planForBody(true, null);
check('node, no offsets: third person', p.person === 'third', p);
check('...and the ini is left alone', p.offsets === null, p);

p = planForBody(true, { z: 50, combatZ: 40 });
check('node and offsets: third person', p.person === 'third', p);
check('...and the offsets are passed through unchanged', JSON.stringify(p.offsets) === JSON.stringify({ z: 50, combatZ: 40 }), p.offsets);

// ---- what the server may send --------------------------------------------------------------------------------------
check('offsets: a full set is taken', JSON.stringify(readOffsets({ x: 1, z: 2, combatX: 3, combatZ: 4 })) === JSON.stringify({ x: 1, z: 2, combatX: 3, combatZ: 4 }));
check('offsets: a partial set is taken', JSON.stringify(readOffsets({ z: -10 })) === JSON.stringify({ z: -10 }));
check('offsets: unknown keys are dropped', JSON.stringify(readOffsets({ z: 1, nonsense: 9 })) === JSON.stringify({ z: 1 }));
check('offsets: a non-number is dropped rather than written to an ini', readOffsets({ z: 'high' }) === null, readOffsets({ z: 'high' }));
check('offsets: NaN and Infinity are dropped', readOffsets({ z: NaN, x: Infinity }) === null);
check('offsets: zero is a real value, not absent', JSON.stringify(readOffsets({ z: 0 })) === JSON.stringify({ z: 0 }));
check('offsets: nothing usable gives null', readOffsets({}) === null && readOffsets(null) === null && readOffsets('x') === null);

// ---- leaving a body ------------------------------------------------------------------------------------------------
p = planForLeaving(true, null, null);
check('leaving, was in first person: back to first person', p.person === 'first', p);
p = planForLeaving(false, null, null);
check('leaving, was in third person: back to third person', p.person === 'third', p);
p = planForLeaving(false, { z: 50 }, { z: -20 });
check('leaving: the remembered ini values are restored when we wrote any', JSON.stringify(p.offsets) === JSON.stringify({ z: -20 }), p);
p = planForLeaving(false, null, { z: -20 });
check('leaving: nothing is restored when we never wrote (so we cannot invent a value)', p.offsets === null, p);

// ---- the service: where the natives are allowed to run -------------------------------------------------------------
const packetHandler = service.slice(service.indexOf('private onBeastMessage'), service.indexOf('private check('));
check('the packet handler calls NO natives (they throw from a packet handler)',
  !/(Game|NetImmerse|Utility)\./.test(packetHandler), (packetHandler.match(/(Game|NetImmerse|Utility)\.\w+/g) || []).slice(0, 4));
check('the race check is driven from update', /controller\.on\("update", \(\) => this\.check\(\)\)/.test(service));
check('the node is tested with NetImmerse.hasNode before third person is forced', /NetImmerse\.hasNode\([^)]*CAM3_NODE/.test(service));
check('the race, not the dboBeast packet, decides the body (so every ending is caught)', /isPolymorphRaceId\(raceId\)/.test(service));
check('leaving restores before the body race is cleared', service.indexOf('planForLeaving') < service.indexOf('this.bodyRace = 0'));
check('a creature-to-creature change restores the first body first', /if \(this\.bodyRace !== 0\) this\.leave\(\);/.test(service));

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
