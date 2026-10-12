// A player copy rebuilt after it was destroyed (invisible and back, another cell and back, a rejoin) gets a fresh base when
// its stored one was aliased by applyTints to the player's own id (#gm-chat 12 Oct: a GM back from invisible wore the look
// of each player watching). Tests sync/appearance.ts needsFreshBase and that formView's base getter uses it. Run from
// skymp5-client:
//
//   node tests/copybase-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP copybase (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };
const STUB = `module.exports = new Proxy({}, { get: (t, k) => (k === '__esModule' ? false : (() => null)) });`;

async function main() {
  const tmp = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-copybase-'));
  const out = path.join(tmp, 'appearance.js');
  try {
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../src/sync/appearance.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /^skyrimPlatform$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: STUB, loader: 'js' }));
      } }],
    });
    const { needsFreshBase } = require(out);
    check('a stored base aliased to the player\'s own id (7) is rebuilt', needsFreshBase(7, 7) === true);
    check('...whatever the high byte of the ids', needsFreshBase(0x00000007, 7 >>> 0) === true);
    check('a base that is gone (no form) is rebuilt', needsFreshBase(null, 7) === true && needsFreshBase(0, 7) === true);
    check('a copy\'s own base (a createNpc id) is kept', needsFreshBase(0xff012345, 7) === false);
    const fv = fs.readFileSync(path.resolve(__dirname, '../src/view/formView.ts'), 'utf8');
    const getter = (fv.match(/private getAppearanceBasedBase\(\): number \{[\s\S]*?\n  \}/) || [''])[0];
    check('formView\'s base getter asks needsFreshBase with the player\'s base id', /needsFreshBase\(/.test(getter) && /getPlayer\(\)/.test(getter), getter);
    const tag = (fv.match(/const isVisibleByPlayer = [\s\S]*?;\n/) || [''])[0];
    check('a name tag stays off someone under an Invisibility spell (#bugs 1 Oct)', /!this\.spellInvisible\(refr\)/.test(tag), tag);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
