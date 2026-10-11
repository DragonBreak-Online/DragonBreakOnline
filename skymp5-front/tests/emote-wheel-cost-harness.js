// Emote wheel (B): no filter on a box that holds the animated preview gif. A filter there is re-rastered for every gif
// frame, and the whole stage is most of the screen: karta.gina, 10 Oct, "every time I click on B the UI freezes so hard
// I have that in my face for the next 5 minutes ... while the game in the background is running steady 60fps".
// Measured in headless Chrome, software raster, hovering the ring for 4 s (tests/emote-wheel-measure.js):
//   raster ms per second   1920x1080   2560x1440   3840x2160
//   stage drop-shadow         623        1560        2968
//   without it                112         223         396
// The check compiles the real SCSS and reads the rules: run it from skymp5-front, `node tests/emote-wheel-cost-harness.js`.
'use strict';
const path = require('path');
const sass = require(path.join(__dirname, '..', 'node_modules', 'sass'));
const SRC = path.join(__dirname, '..', 'src');
const css = sass.compile(path.join(SRC, 'features/emoteWheel/styles.scss'), { loadPaths: [SRC, path.join(__dirname, '..', 'node_modules')], quietDeps: true,
  silenceDeprecations: ['import', 'global-builtin', 'slash-div', 'color-functions'] }).css;

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };
// Every top-level rule body for a selector (media queries included), flattened
const rules = (sel) => {
  const out = []; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(css))) if (m[1].split(',').map((s) => s.trim()).includes(sel)) out.push(m[2]);
  return out.join(';');
};
const has = (body, prop) => new RegExp(`(^|[;\\s])${prop}\\s*:`).test(body);

// The boxes the preview gif sits inside: none may carry a filter or backdrop-filter of its own
for (const sel of ['.emote-wheel', '.emote-wheel__stage', '.emote-wheel__preview']) {
  const body = rules(sel);
  check(`${sel} has no filter (a gif inside it repaints it every frame)`, !has(body, 'filter'), body);
  check(`${sel} has no backdrop-filter`, !has(body, 'backdrop-filter'), body);
}
// The ring keeps its own shadow, so the look stays
check('the ring keeps its drop-shadow', /drop-shadow/.test(rules('.emote-wheel__svg')));
check('the preview frame keeps its box-shadow', has(rules('.emote-wheel__preview-frame'), 'box-shadow'));

console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
