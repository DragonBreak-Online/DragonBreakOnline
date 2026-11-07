// The panel log (panelLog.ts; Ben, 7 Nov: a Scaleform crash report could not say whether a native panel was up): one
// dbo-diag line when a CustomMenu opens or closes, with its swf, from both places that open one (scaleformMenuService's
// panels and the map legend). The mutants at the end must each fail.
//   node tests/native-panel-log-harness.js        (from skymp5-client)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SVC = path.join(ROOT, 'src', 'services', 'services');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!ok) failures++; };

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-panellog-'));
try {
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), path.join(SVC, 'panelLog.ts'),
    '--outDir', OUT, '--module', 'commonjs', '--target', 'es2019', '--skipLibCheck'], { stdio: 'pipe' });
} catch (e) { /* the emitted file is checked below */ }
const COMPILED = path.join(OUT, 'panelLog.js');
if (!fs.existsSync(COMPILED)) { console.log('FAIL panelLog.ts did not compile'); process.exit(1); }
const SRC = fs.readFileSync(COMPILED, 'utf8');
const load = (src) => { const f = path.join(OUT, `pl-${Math.random().toString(36).slice(2)}.js`); fs.writeFileSync(f, src); return require(f); };

const behaviour = (M, c) => {
  const lines = [];
  const sp = { writeLogs: (name, line) => lines.push([name, line]) };
  const at = new Date('2026-11-07T21:48:55Z');
  M.panelLog(sp, 'open', 'dbo_journal', at);
  M.panelLog(sp, 'close', 'dbo_journal', at);
  c('an open and a close each write one dbo-diag line naming the swf and the time', lines.length === 2 && lines.every(([n]) => n === 'dbo-diag')
    && lines[0][1] === '[panel] open dbo_journal at 21:48:55Z' && lines[1][1] === '[panel] close dbo_journal at 21:48:55Z', lines);
  let threw = false;
  try { M.panelLog({}, 'open', 'dbo_trade', at); } catch (e) { threw = true; }
  c('a platform without writeLogs does not throw', !threw);
  for (let i = 0; i < M.PANEL_LOG_MAX + 20; i++) M.panelLog(sp, 'open', 'dbo_trade', at);
  c(`at most ${M.PANEL_LOG_MAX} lines a session, the last one saying so`, lines.length === M.PANEL_LOG_MAX - 1 && /stops here/.test(lines[lines.length - 1][1]), lines.length);
};
behaviour(load(SRC), check);

const sms = fs.readFileSync(path.join(SVC, 'scaleformMenuService.ts'), 'utf8').replace(/\r\n/g, '\n');
check('the native panels log their open, with the swf, right after openCustomMenu',
  /this\.sp\.Ui\.openCustomMenu\(a\.swf, 0\);\n[^\n]*\n\s*panelLog\(this\.sp, "open", a\.swf\);\n\s*this\.panelUp = a\.swf;/.test(sms));
check('...and their close, naming the swf that was open', /this\.sp\.Ui\.closeCustomMenu\(\);\n\s*panelLog\(this\.sp, "close", this\.panelUp\);/.test(sms));
const mrs = fs.readFileSync(path.join(SVC, 'mapRealmService.ts'), 'utf8');
check('the map legend logs its open and close too',
  /openCustomMenu\(swf, 0\); panelLog\(this\.sp, "open", swf\); \}/.test(mrs) && /closeCustomMenu\(\); panelLog\(this\.sp, "close", LEGEND_SWF\.replace\(\/\\\.swf\$\/i, ""\)\); \}/.test(mrs));

const MUTANTS = [
  ['no cap', 'if (written >= exports.PANEL_LOG_MAX)', 'if (false)'],
  ['the wrong log', '.writeLogs("dbo-diag", line)', '.writeLogs("dbo-other", line)'],
  ['no swf named', '${swf || "?"}', '?'],
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
