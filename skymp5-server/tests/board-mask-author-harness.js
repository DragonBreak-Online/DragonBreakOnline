// A notice pinned while masked is signed with the poster's own name and tag, not "Masked Person" (Nate, 13 Oct).
// Bundles bountyBoardSystem.ts (settings stubbed) and drives its name helpers with a fake mp.
//   node tests/board-mask-author-harness.js   (from skymp5-server)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require(path.resolve(__dirname, '../node_modules/esbuild'));

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-boardmask-'));
  const out = path.join(dir, 'b.js');
  await esbuild.build({
    entryPoints: [path.resolve(__dirname, '../ts/systems/bountyBoardSystem.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'silent',
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /^\.\.\/settings$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = { __esModule: true, Settings: { get: async () => ({}) } };', loader: 'js' }));
    } }],
  });
  const mod = require(out);
  const Board = Object.values(mod).find((v) => typeof v === 'function' && v.prototype && typeof v.prototype.posterNameOf === 'function');
  check('the board has a poster-name helper', !!Board);
  if (!Board) process.exit(1);
  const props = new Map();
  const names = new Map();
  const mp = { get: (a, k) => props.get(`${a}|${k}`), getActorName: (a) => names.get(a) };
  const ctx = { svr: mp };
  const self = Object.create(Board.prototype);
  const A = 0xff000101;
  props.set(`${A}|private.charTag`, 'AB12');

  names.set(A, 'Lucia Varo');
  check('unmasked: the notice is signed with the name and tag', self.posterNameOf(ctx, A) === 'Lucia Varo #AB12', self.posterNameOf(ctx, A));
  names.set(A, 'Masked Person'); props.set(`${A}|maskName`, 'Lucia Varo');
  check('masked: still the poster\'s own name and tag, not the mask', self.posterNameOf(ctx, A) === 'Lucia Varo #AB12', self.posterNameOf(ctx, A));
  check('...and the board log still says they were masked', /"Lucia Varo #AB12" \(as "Masked Person #AB12"\)/.test(self.describeActor(ctx, A)), self.describeActor(ctx, A));
  props.set(`${A}|maskName`, '');
  names.set(A, 'Lucia Varo');
  check('unmasked again: no "as" in the log', !/ \(as /.test(self.describeActor(ctx, A)), self.describeActor(ctx, A));
  const src = fs.readFileSync(path.resolve(__dirname, '../ts/systems/bountyBoardSystem.ts'), 'utf8');
  check('a new notice\'s author comes from posterNameOf', /const author = this\.posterNameOf\(ctx, actorId\)/.test(src));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `${failures} failed` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL', e); process.exit(1); });
