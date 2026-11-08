// A notice holds 1,500 characters (#suggestions "Increase text limit for notice board" 1566962734451523657, 8 Nov: pigeon
// letters hold 1,000, so notices at 500 were the shorter). Bundles bountyBoardSystem.ts (settings stubbed) and reads the
// default; server-settings.json bountyBoardMaxTextLen still overrides it.
//   node tests/notice-text-len-harness.js   (from skymp5-server)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require(path.resolve(__dirname, '../node_modules/esbuild'));

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-noticelen-'));
  const out = path.join(dir, 'b.js');
  await esbuild.build({
    entryPoints: [path.resolve(__dirname, '../ts/systems/bountyBoardSystem.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'silent',
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /^\.\.\/settings$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = { __esModule: true, Settings: { get: async () => ({}) } };', loader: 'js' }));
    } }],
  });
  const { BountyBoardSystem } = require(out);
  check('the bundle exports BountyBoardSystem', typeof BountyBoardSystem === 'function');
  const board = new BountyBoardSystem(() => {});
  check('a notice holds 1,500 characters by default (was 500)', board.maxTextLen === 1500, board.maxTextLen);
  const letter = 'a'.repeat(1500);
  check('a 1,500-character notice passes sanitize whole', board.sanitize(letter).length === 1500);
  check('...which is more than a pigeon letter (1,000)', board.maxTextLen > 1000);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `${failures} failed` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL', e); process.exit(1); });
