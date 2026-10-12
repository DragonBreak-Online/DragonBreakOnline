// After a werewolf or Vampire Lord turns back, first person works again (king_julian_, #bugs 11 Oct: "no longer can go
// into first person" until a relog). beastFormService mirrors vanilla's revert, read from the compiled scripts in
// Skyrim - Misc.bsa: PlayerWerewolfChangeScript ActuallyShiftBackIfNecessary calls SetRace, then
// Game.EnablePlayerControls(False, False, True, False, False, False, False, False, 1) and Game.ShowFirstPersonGeometry(True).
// Source checks; run from skymp5-client:   node tests/beast-firstperson-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'services', 'beastFormService.ts'), 'utf8');
let failures = 0;
const check = (name, ok) => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); };
const fn = src.slice(src.indexOf('private restoreFirstPerson(): void {'), src.indexOf('private restoreFirstPerson(): void {') + 400);
check('restoreFirstPerson exists', fn.length > 40 && src.includes('private restoreFirstPerson(): void {'));
check('...lifts the camera-switch disable of POV type 1, as vanilla does', /enablePlayerControls\(false, false, true, false, false, false, false, false, 1\)/.test(fn));
check('...and shows the first-person geometry again', /showFirstPersonGeometry\(true\)/.test(fn));
check('the race change back calls it (beast stays third person)', /if \(beast\) this\.sp\.Game\.forceThirdPerson\(\);\s+else this\.restoreFirstPerson\(\);/.test(src));
check('the held-race revert calls it too', /if \(!w\.beast\) \{ this\.beastRace = 0; this\.abilities = null; this\.restoreFirstPerson\(\); \}/.test(src));
check('restoreControls still lifts the type-0 disable', /enablePlayerControls\(true, true, true, true, true, true, true, true, 0\)/.test(src));
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
