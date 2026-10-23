// Guards set on a known beast (server exposure.js ff_huntedIn, bundle 1023). huntedGuards.ts has no imports and transpiles on
// its own; the wiring in formViewArray.ts and formView.ts is checked in the source. Run it from skymp5-client:
//
//   ./node_modules/typescript/bin/tsc src/view/huntedGuards.ts --outDir /dev/shm/claude-nate-huntedguards --module commonjs --target es2019
//   node tests/huntedguards-harness.js /dev/shm/claude-nate-huntedguards/huntedGuards.js
'use strict';
const fs = require('fs');
const path = require('path');
const { huntedHold, huntTarget, HUNT_RANGE } = require(path.resolve(process.argv[2] || '/dev/shm/claude-nate-huntedguards/huntedGuards.js'));
const SRC = path.resolve(__dirname, '..', 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

check('ff_huntedIn names the hold', huntedHold({ ff_huntedIn: 'bruma' }) === 'bruma');
check('null, missing or not a string is no hunt', huntedHold({ ff_huntedIn: null }) === '' && huntedHold({}) === '' && huntedHold({ ff_huntedIn: true }) === '');
const own = { pos: [100, 0, 0], cell: 7, own: true, localRefrId: 0 };
const copy = { pos: [50, 0, 0], cell: 7, own: false, localRefrId: 0xff000123 };
const far = { pos: [HUNT_RANGE + 1, 0, 0], cell: 7, own: false, localRefrId: 0xff000124 };
const elsewhere = { pos: [10, 0, 0], cell: 8, own: false, localRefrId: 0xff000125 };
check('the nearest hunted player in range', huntTarget([0, 0, 0], 7, [own, copy]) === copy);
check('out of range: nobody', huntTarget([0, 0, 0], 7, [far]) === null);
check('another cell or worldspace: nobody', huntTarget([0, 0, 0], 7, [elsewhere]) === null);
check('an unknown cell compares loosely', huntTarget([0, 0, 0], 0, [elsewhere]) === elsewhere);
check('no hunted players: nobody', huntTarget([0, 0, 0], 7, []) === null);

const arr = read('view/formViewArray.ts'); const fv = read('view/formView.ts');
check('FormViewArray fills huntedPlayers (not from the clone view)', /huntedPlayers\.spots = hunted/.test(arr) && /!isCloneView && form && form\.appearance/.test(arr));
check('formView runs the hunt only on NPCs this client hosts', /!model\.appearance && alreadyHosted && huntedPlayers\.spots\.length\) this\.updateHuntedGuard/.test(fv));
check('only guards, alive, not already fighting', /!ac\.isGuard\(\) \|\| ac\.isDead\(\) \|\| ac\.isInCombat\(\)/.test(fv));
check('the own character or the copy is the target', /spot\.own \? Game\.getPlayer\(\)/.test(fv) && /ac\.startCombat\(target\)/.test(fv));
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
