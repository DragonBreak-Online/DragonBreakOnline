// The gamepad pointer for browser panels: the client's math and page calls (skymp5-client gamepadPointer.ts) and the page's
// pointer (src/utils/GamepadPointer.js) driving a React panel in headless Chrome: hover, click, scroll and B as Escape.
// CT 115 (puppeteer + Chrome's libraries unpacked in ~/claude-c-layout, memory note front-widgets-measure-in-headless-chrome):
//   LD_LIBRARY_PATH=$(cat ~/claude-c-layout/ldpath) node tests/gamepad-pointer-harness.js .
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const FRONT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const NM = path.join(process.env.HOME, 'dragonbreak/fork/skymp5-front/node_modules');
const ESBUILD = path.join(process.env.HOME, 'dragonbreak/fork/skymp5-server/node_modules/.bin/esbuild');
const OUT = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-padptr-'));
process.on('exit', () => { try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };

// The client half
execFileSync(ESBUILD, [path.join(FRONT, '..', 'skymp5-client/src/services/services/gamepadPointer.ts'), '--bundle', '--platform=node', '--format=cjs', `--outfile=${path.join(OUT, 'ptr.js')}`, '--log-level=error']);
const C = require(path.join(OUT, 'ptr.js'));
ok(C.curve(0.1) === 0 && C.curve(-0.2) === 0, 'a resting stick inside the dead zone moves nothing');
ok(C.curve(1) === 1 && C.curve(-1) === -1 && C.curve(0.6) > 0 && C.curve(0.6) < 0.6, 'full tilt is full speed, half tilt much slower');
const s = C.pointerStep(1, 1, 100);
ok(s.dx === 110 && s.dy === -110, 'stick up moves the pointer up the page (page Y grows down)', s);
ok(C.pageCall(0, 0, 0, '') === '', 'nothing to send is no call');
ok(/p\.move\(5,-3\);p\.click\(\)/.test(C.pageCall(5, -3, 0, 'click')) && /window\.__dboPad/.test(C.pageCall(0, 0, 9, '')), 'moves, scrolls and presses go out as one guarded call');
const svc = fs.readFileSync(path.join(FRONT, '..', 'skymp5-client/src/services/services/gamepadPointerService.ts'), 'utf8');
ok(/isGamepadModifierHeld\(\)/.test(svc) && /this\.sp\.browser\.isFocused\(\)/.test(svc), 'the client only drives it while a panel has focus, never during a Back chord');
const idx = fs.readFileSync(path.join(FRONT, 'src/index.js'), 'utf8');
ok(/import '\.\/utils\/GamepadPointer';/.test(idx) && /e\.key === "Escape"[\s\S]{0,120}menu:escape/.test(idx), 'the page loads the pointer, and its Escape keydown already sends menu:escape');
const idxTs = fs.readFileSync(path.join(FRONT, '..', 'skymp5-client/src/index.ts'), 'utf8');
ok(/new GamepadPointerService\(sp, controller\)/.test(idxTs), 'the client starts the service');

// The page half, in Chrome
let puppeteer = null;
try { puppeteer = require(path.join(process.env.HOME, 'claude-c-layout/node_modules/puppeteer')); } catch (e) { /* no browser here */ }
if (!puppeteer) { console.log('skipped the browser half: no puppeteer in ~/claude-c-layout'); console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0); }
fs.writeFileSync(path.join(OUT, 'entry.jsx'), `
import React, { useState } from 'react'; import ReactDOM from 'react-dom';
import '${path.join(FRONT, 'src/utils/GamepadPointer.js')}';
window.sent = []; window.skyrimPlatform = { sendMessage(...a) { window.sent.push(a); } };
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.skyrimPlatform.sendMessage('menu:escape'); });
const Panel = () => { const [hot, setHot] = useState(false);
  return <div style={{ position: 'absolute', left: 100, top: 100, width: 400 }}>
    <button id="buy" style={{ width: 200, height: 40 }} onMouseEnter={() => setHot(true)} onMouseLeave={() => setHot(false)} onClick={() => window.skyrimPlatform.sendMessage('panel:buy')}><span>Buy {hot ? '(hover)' : ''}</span></button>
    <div id="list" style={{ height: 100, overflowY: 'auto', marginTop: 20 }}><div style={{ height: 1000 }}>rows</div></div>
  </div>; };
ReactDOM.render(<Panel />, document.getElementById('root'));
`);
execFileSync(ESBUILD, [path.join(OUT, 'entry.jsx'), '--bundle', '--format=iife', '--define:process.env.NODE_ENV="production"', '--log-level=error', `--outfile=${path.join(OUT, 'bundle.js')}`], { stdio: 'inherit', env: { ...process.env, NODE_PATH: NM } });
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.setContent(`<!doctype html><html><body style="margin:0"><div id="root"></div><script>${fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8')}</script></body></html>`);
    const run = (js) => page.evaluate(js);
    ok(await run('typeof window.__dboPad === "object"'), 'the page exposes window.__dboPad');
    await run('window.__dboPad.move(0,0)');
    ok(JSON.stringify(await run('window.__dboPad.position()')) === '{"x":640,"y":360}', 'the pointer starts at the centre of the screen');
    ok(await run('getComputedStyle(document.querySelector(".dbo-pad-pointer")).display === "block"'), '...and is drawn');
    await run('window.__dboPad.move(-440,-240)'); // 200,120: on the button
    ok(await run('document.getElementById("buy").textContent.includes("(hover)")'), "moving onto a button hovers it (React's onMouseEnter)");
    await run('window.__dboPad.click()');
    ok(JSON.stringify(await run('window.sent')) === '[["panel:buy"]]', "A clicks it (React's onClick, from the span inside)", await run('window.sent'));
    await run('window.__dboPad.move(0,-200)'); // 200,0: off the button
    ok(!(await run('document.getElementById("buy").textContent.includes("(hover)")')), 'moving off unhovers it');
    await run('window.__dboPad.move(0,180)'); // 200,180: in the list
    await run('window.__dboPad.scroll(120)');
    ok(await run('document.getElementById("list").scrollTop') === 120, 'the left stick scrolls the box under the pointer, not the page');
    await run('window.__dboPad.move(-5000,-5000)');
    ok(JSON.stringify(await run('window.__dboPad.position()')) === '{"x":0,"y":0}', 'the pointer stays on screen');
    await run('window.sent.length = 0; window.__dboPad.back()');
    ok(JSON.stringify(await run('window.sent')) === '[["menu:escape"]]', 'B is Escape: index.js sends menu:escape and the panel closes', await run('window.sent'));
  } finally { await browser.close(); }
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
