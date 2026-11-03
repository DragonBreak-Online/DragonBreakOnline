// The native panels' size setting (scaleformMenu.ts nativeScaleOf / rootScaleFor; live, 3 Nov: "really zoomed in, harder to
// read"): the setting read and kept in range, the root scaled about the 1280 x 720 stage's centre, and the service applying it
// with every payload. The mutants at the end must each fail.
//   node tests/native-scale-harness.js        (from skymp5-client)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!ok) failures++; };

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-nscale-'));
try {
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), path.join(ROOT, 'src', 'services', 'services', 'scaleformMenu.ts'),
    '--outDir', OUT, '--module', 'commonjs', '--target', 'es2019', '--skipLibCheck'], { stdio: 'pipe' });
} catch (e) { /* the emitted file is checked below */ }
const COMPILED = path.join(OUT, 'scaleformMenu.js');
if (!fs.existsSync(COMPILED)) { console.log('FAIL scaleformMenu.ts did not compile'); process.exit(1); }
const SRC = fs.readFileSync(COMPILED, 'utf8');
const load = (src) => { const f = path.join(OUT, `sm-${Math.random().toString(36).slice(2)}.js`); fs.writeFileSync(f, src); return require(f); };

const behaviour = (M, c) => {
  c('no setting: 0.85', M.nativeScaleOf(undefined) === 0.85);
  c('a number in range is kept, a string read as one', M.nativeScaleOf(0.7) === 0.7 && M.nativeScaleOf('1.1') === 1.1);
  c('kept between 0.6 and 1.2', M.nativeScaleOf(0.2) === 0.6 && M.nativeScaleOf(3) === 1.2);
  c('nonsense gives the default', M.nativeScaleOf('big') === 0.85 && M.nativeScaleOf({}) === 0.85 && M.nativeScaleOf('') === 0.85);
  const r = M.rootScaleFor(0.85);
  c('the root at 85%, its corner moved so the stage centre (640, 360) stays put', r.xscale === 85 && r.yscale === 85 && Math.abs(r.x + 0.85 * 640 - 640) < 1e-9 && Math.abs(r.y + 0.85 * 360 - 360) < 1e-9, r);
  const one = M.rootScaleFor(1);
  c('at 1 the root is left as it was', one.xscale === 100 && one.x === 0 && one.y === 0, one);
};
behaviour(load(SRC), check);

const svc = fs.readFileSync(path.join(ROOT, 'src', 'services', 'services', 'scaleformMenuService.ts'), 'utf8').replace(/\r\n/g, '\n');
check('the service scales the root with every payload, after the screen size and before the data',
  /_root\.dboScreen", screen\);\n[^\n]*\n\s*const local = this\.localUi\(\);\n\s*const r = rootScaleFor\(nativeScaleOf\(local\.nativeScale !== undefined \? local\.nativeScale : this\.clientSetting\("nativeScale"\)\)\);\n(\s*this\.sp\.Ui\.setFloat\(MENU_NAME, "_root\._(xscale|yscale|x|y)", r\.\w+\);\n){4}/.test(svc));

// Nat, 3 Nov: "Native menus" and the size in F3 Settings, saved in the chat-settings file's ui block
check('"Native menus: off" turns every native panel off (the caps go out empty)', /private nativePanelsSetting\(\): unknown \{\n\s*\/\/[^\n]*\n\s*if \(this\.localUi\(\)\.nativeMenus === "off"\) return false;/.test(svc));
check('a change in F3 Settings announces the native panels again (no relaunch)', /public settingsChanged\(\): void \{\n\s*this\.announce\("settings changed"\);/.test(svc)
  && /this\.service\(ScaleformMenuService, \(s\) => s\.settingsChanged\(\)\);/.test(fs.readFileSync(path.join(ROOT, 'src', 'services', 'services', 'settingsNativeService.ts'), 'utf8')));
check('...and so does a save from the web page (chatService calls the hook the service sets)', /__dboUiSettingsSaved = \(\) => this\.settingsChanged\(\);/.test(svc)
  && /if \(typeof f === "function"\) f\(\);/.test(fs.readFileSync(path.join(ROOT, 'src', 'services', 'services', 'chatService.ts'), 'utf8')));
check('the saved size wins over the settings file', /local\.nativeScale !== undefined \? local\.nativeScale : this\.clientSetting\("nativeScale"\)/.test(svc));

const MUTANTS = [
  ['no clamp at the top', 'Math.min(exports.NATIVE_SCALE.max, ', '('],
  ['scaled about the corner', 'x: 640 * (1 - scale)', 'x: 0'],
  ['no default', ': exports.NATIVE_SCALE.default', ': 1'],
];
for (const [name, a, b] of MUTANTS) {
  if (!SRC.includes(a)) { check(`mutant "${name}": its text is in the compiled module`, false, a); continue; }
  let bad = 0;
  try { behaviour(load(SRC.split(a).join(b)), (w, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  check(`mutant caught: ${name}`, bad > 0);
}
fs.rmSync(OUT, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
