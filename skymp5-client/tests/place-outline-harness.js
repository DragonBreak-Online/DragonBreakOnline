// Source checks for the Place tool's outline (placementService.ts, Nate 21 Oct: invisible activators cannot be seen while
// placing them). The drawing itself needs the game; this checks the name filter and that every path cleans the texts up.
//
//   node tests/place-outline-harness.js        (from skymp5-client)
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'services', 'services', 'placementService.ts'), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

// The name filter, lifted from the source and run as JavaScript
const m = /const outlineName = \(name: string\): string => (name\.replace\(.*?\)\.slice\(0, OUTLINE\.nameChars\));/.exec(src);
check('outlineName found', !!m);
if (m) {
  const outlineName = new Function('OUTLINE', 'name', `return ${m[1]};`).bind(null, { nameChars: 48 });
  check('ASCII kept', outlineName('Trigger Box (xMarker)') === 'Trigger Box (xMarker)');
  check('Cyrillic kept', outlineName('Маркер') === 'Маркер');
  check('accents and symbols become ?', outlineName('Café ™ →') === 'Caf? ? ?', outlineName('Café ™ →'));
  check('long names cut to 48', outlineName('x'.repeat(80)).length === 48);
}

const body = (name) => { const i = src.indexOf(`  private ${name}(`); return i < 0 ? '' : src.slice(i, src.indexOf('\n  }\n', i)); };
const draw = body('drawOutline');
check('the projection is the verified SkyrimPlatform call', /worldPointToScreenPoint\(\[at\[0\], at\[1\], at\[2\]\], \[at\[0\], at\[1\], at\[2\] \+ OUTLINE\.nameAbove\]\)/.test(draw));
check('placed from the pose, never waiting on 3D', /const at = this\.ghostAt;/.test(draw) && !/is3DLoaded/.test(draw));
check('hidden behind the camera', /base\[2\] <= 0 \|\| top\[2\] <= 0\) return this\.hideOutline\(\)/.test(draw));
check('hidden in menus and without a copy', /!this\.pick \|\| !this\.ghostId \|\| !at \|\| Utility\.isInMenuMode\(\)\) return this\.hideOutline\(\)/.test(draw));
check('the mark is ASCII [+]', /mark: "\[\+\]"/.test(src));
check('stop() destroys the texts', /this\.hideOutline\(\);/.test(body('stop')));
check('hideOutline destroys both ids', /destroyText\(id\)/.test(body('hideOutline')) && /this\.outlineMarkId = 0;/.test(body('hideOutline')) && /this\.outlineNameId = 0;/.test(body('hideOutline')));
check('drawn every frame, before the 40 ms tick', /this\.drawOutline\(\);\s*const now = Date\.now\(\);\s*if \(now - this\.lastTick < TICK_MS\) return;/.test(src));

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
