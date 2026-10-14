// The login-save diagnostic (Worker D, 12 Oct: BGSLoadFormBuffer crashes 2.5-3 s after Play, inside the engine reading the
// save sp.loadGame builds): loadGameDiag.ts's line, and that LoadGameService writes it before the call and on the retry.
// Run from skymp5-client:
//
//   node tests/loadgame-diag-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP loadgame-diag (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

async function main() {
  const tmp = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-lgdiag-'));
  const out = path.join(tmp, 'diag.js');
  try {
    await esbuild.build({ entryPoints: [path.resolve(__dirname, '../src/services/services/loadGameDiag.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error' });
    const { loadGameLine, orderHash } = require(out);
    const order = ['Skyrim.esm', 'Update.esm', 'DragonBreak Online Edits.esp'];
    const npc = { name: 'Jon Grey', raceId: 0x13746, isFemale: false, face: { headPartIds: [0x1, 0x2, 0xff000abc], presets: [1, 2, 3, 4], headTextureSetId: 0x2c, hairColor: 0x10, bodySkinColor: 0x123456 } };
    const line = loadGameLine([1.6, -2.4, 3], [0, 0, 90.2], 0x3c, npc, order, { hours: 9 });
    check('the world, position and angle', /^world 3c pos 2,-2,3 rot 0,0,90; /.test(line), line);
    check('the character: race, sex, name length', /npc race 13746 female false name 8ch;/.test(line), line);
    check('every head part id and the face fields', /headparts 3 \[1,2,ff000abc\] presets 4 texset 2c hair 10 skin 123456;/.test(line), line);
    check('the load order: count, hash and last plugin', new RegExp(`mods 3 hash ${orderHash(order)} last DragonBreak Online Edits\\.esp; hour 9$`).test(line), line);
    check('a name outside plain ASCII is flagged', /name 4ch non-ascii/.test(loadGameLine([], [], 0, { name: 'Jöns' }, [], null)));
    check('no character and no load order still make a line', /npc none; face none; mods 0 hash 811c9dc5 last none; hour none/.test(loadGameLine(null, null, undefined, undefined, undefined, undefined)));
    const many = loadGameLine([0], [0], 1, { face: { headPartIds: Array.from({ length: 20 }, (_, i) => i + 1) } }, order, null);
    check('a long head part list is cut at 16 and says how many more', /headparts 20 \[1,2,3,4,5,6,7,8,9,a,b,c,d,e,f,10,\+4\]/.test(many), many);
    check('the line fits the 400-character relay', line.length < 400, line.length);
    check('the hash tells load orders apart', orderHash(order) !== orderHash(order.slice(0, 2)) && orderHash(order) === orderHash(order.slice()));
    const svc = fs.readFileSync(path.resolve(__dirname, '../src/services/services/loadGameService.ts'), 'utf8');
    const body = (svc.match(/public loadGame\([\s\S]*?\n    \}/) || [''])[0];
    check('LoadGameService writes the line before sp.loadGame', body.indexOf('diagNote("loadGame", line)') >= 0 && body.indexOf('diagNote("loadGame", line)') < body.indexOf('this.sp.loadGame('), body);
    check('...and says so when the call threw and was retried without the character', /threw \([\s\S]*retried without the character[\s\S]*this\.sp\.loadGame\(pos, rot, worldOrCell, undefined/.test(body));
    check('...through the dbo-diag note (file + server relay), guarded', /__dboDiagNote/.test(svc) && /diagnostics only/.test(svc));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
