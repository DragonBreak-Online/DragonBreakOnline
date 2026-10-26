// nativeBackdropService: the HUD crosshair faded to a watermark while a native panel (CustomMenu) is open, its own alpha
// given back after. Bundled with its imports stubbed and driven against a fake Ui.
//   node tests/native-backdrop-harness.js      (env ESBUILD_DIR, else the fork's skymp5-server esbuild)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const HERE = path.resolve(__dirname, '..');
const ESB = [process.env.ESBUILD_DIR, path.join(HERE, '../skymp5-server/node_modules/esbuild'), path.join(HERE, '../../../fork/skymp5-server/node_modules/esbuild')].find((d) => d && fs.existsSync(path.join(d, 'package.json')));
if (!ESB) { console.log('SKIP needs ESBUILD_DIR'); process.exit(0); }
const esbuild = require(ESB);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'backdrop-'));

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };

fs.writeFileSync(path.join(TMP, 'stub.js'), `
class ClientListener {}
const logError = (...a) => { globalThis.__errors.push(a.join(' ')); };
module.exports = { ClientListener, logError };
`);

(async () => {
  const out = path.join(TMP, 'svc.js');
  await esbuild.build({
    entryPoints: [path.join(HERE, 'src/services/services/nativeBackdropService.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
    plugins: [{ name: 'stub', setup(b) { b.onResolve({ filter: /.*/ }, (a) => (/\/(clientListener|logging)$/.test(a.path) ? { path: path.join(TMP, 'stub.js') } : undefined)); } }],
  });
  globalThis.__errors = [];
  const { NativeBackdropService, CROSSHAIR_ALPHA, FADED_ALPHA } = require(out);
  const st = { open: false, props: { [CROSSHAIR_ALPHA]: 85 }, writes: [], visible: true, shows: [] };
  const sp = { browser: { isVisible: () => st.visible, setVisible: (v) => { st.visible = v; st.shows.push(v); } }, Ui: {
    isMenuOpen: (m) => m === 'CustomMenu' && st.open,
    getFloat: (m, p) => (m === 'HUD Menu' ? st.props[p] : NaN),
    setFloat: (m, p, v) => { st.writes.push([m, p, v]); st.props[p] = v; },
  } };
  let update;
  const realNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  new NativeBackdropService(sp, { on: (ev, fn) => { if (ev === 'update') update = fn; } });
  const tick = () => { now += 200; update(); };

  tick();
  ok(!st.writes.length, 'with no native panel open nothing is touched');
  st.open = true; tick();
  ok(st.props[CROSSHAIR_ALPHA] === FADED_ALPHA && st.writes[0][0] === 'HUD Menu' && FADED_ALPHA > 0 && FADED_ALPHA <= 20, 'a native panel opening fades the HUD crosshair to a faint watermark', st.writes);
  ok(st.visible === false, 'and hides the browser, which draws over every Scaleform menu (the chat and the hourglass sat on the panel)');
  tick(); tick();
  ok(st.writes.length === 1, 'and leaves it alone while the panel stays up');
  st.visible = true; tick();
  ok(st.visible === false, 'the browser shown again by something else while the panel is up is hidden again');
  st.open = false; tick();
  ok(st.props[CROSSHAIR_ALPHA] === 85, 'closing the panel gives the crosshair back its own alpha (85 here)');
  ok(st.visible === true, '...and shows the browser again');
  st.visible = false; st.shows.length = 0; st.open = true; tick(); st.open = false; tick();
  ok(!st.shows.includes(true), 'a browser that was already hidden (a vanilla menu, the UI toggled off) is not shown by this');
  st.visible = true; st.writes.length = 0; st.open = true; tick(); st.open = false; tick();
  ok(st.props[CROSSHAIR_ALPHA] === 85 && st.writes.length === 2 && st.visible === true, 'again on the next panel');
  now += 50; update();
  ok(st.writes.length === 2, 'it looks at most every 150 ms');
  ok(!globalThis.__errors.length, 'no failure', globalThis.__errors);

  Date.now = realNow;
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e.stack || e.message)); process.exit(1); });
