// Client half of the chopping block (executionService.ts; server execution.js). Source checks; run from skymp5-client:
//   node tests/execution-client-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'services', 'executionService.ts'), 'utf8');
const idx = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8');
let failures = 0;
const check = (name, ok) => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); };
check('index.ts registers ExecutionService', /new ExecutionService\(sp, controller\)/.test(idx) && /import \{ ExecutionService \}/.test(idx));
check('listens for dboExecute only', /content\["customPacketType"\] !== "dboExecute"/.test(src));
check('links the headsman to the victim, then plays both clips on one frame: IdleExecutioneeChop on the victim (Decapitate), IdleHeadChop on the headsman', /victim\.addDependentAnimatedObjectReference\(headsman\);[\s\S]{0,200}victimIdle \? victim\.playIdle\(victimIdle\) : victim\.playIdle\(idle\);\s+const headsmanPlayed = victimIdle \? headsman\.playIdle\(idle\) : false;/.test(src));
check('one\'s own character is the player (0x14), others their local copy', /\? PLAYER_FORM_ID : remoteIdToLocalId\(serverId\)/.test(src));
check('the link is removed afterwards, with fresh native objects', /setTimeout\(\(\) => \{[\s\S]*Actor\.from\(Game\.getFormEx\(victimId\)\)[\s\S]*removeDependentAnimatedObjectReference/.test(src));
check('a missing actor or idle does nothing', /if \(!victim \|\| !headsman \|\| !idle\) \{/.test(src));
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
