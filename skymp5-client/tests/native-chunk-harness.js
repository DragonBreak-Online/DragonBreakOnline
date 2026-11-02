// Payloads over one invokeString go to a native panel in pieces (Nat, 2 Nov: the journal's Faction tab, 63,411 characters
// for staff, and Skills, 69,890, fell back to the browser at the old 60,000 cap). scaleformMenu.ts chunkArgs splits the
// JSON; lib dbo.as _root.dboChunk puts it back together, in any order, and hands it to the panel's own dboData; a piece
// of an older set, a duplicate, a bad header or a missing piece draws nothing. Each delivery of 20,000 characters or more
// is reported as dbo:nativeTiming [version, chars, pieces, parse ms, draw ms]. The panel used is dbo_naming.
//   ./node_modules/typescript/bin/tsc src/services/services/scaleformMenu.ts --outDir <tmp> --module commonjs --target es2019
//   node tests/native-chunk-harness.js <tmp>/scaleformMenu.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('./native-swf-stub');
const M = require(path.resolve(process.argv[2] || path.join(os.tmpdir(), 'claude-nate-chunk', 'scaleformMenu.js')));
const T = S.checker();
const check = T.check;
const read = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const SVC = read('src/services/services/scaleformMenuService.ts');

// ---- the client's side ----
check('the hard ceiling is above the old cap, and a piece is smaller than one call', M.MAX_PAYLOAD_CHARS >= 400000 && M.CHUNK_CHARS === 50000);
check('the client names the new cap, so the server knows it may send more', M.CLIENT_CAPS.includes('nativeChunked'));
check('a payload that fits one call is not split', M.chunkArgs('x'.repeat(50000), 1).length === 0);
const big = JSON.stringify({ type: 'namePrompt', id: 68, nonce: 'n1', error: '', pad: 'é'.repeat(63300) });
const pieces = M.chunkArgs(big, 7);
check('63k characters go as two pieces with the set id, index and count', pieces.length === 2 &&
  pieces[0].startsWith('7|0|2\u0001') && pieces[1].startsWith('7|1|2\u0001'), pieces.map((p) => p.slice(0, 8)));
check('...each slice at most one piece long, and together the payload exactly', pieces.every((p) => p.length - p.indexOf('\u0001') - 1 <= 50000) &&
  pieces.map((p) => p.slice(p.indexOf('\u0001') + 1)).join('') === big);
check('the service sends pieces to _root.dboChunk with a fresh id each time, and small ones to dboData as before',
  /chunkArgs\(a\.json, \+\+this\.chunkSeq\)/.test(SVC) && /"_root\.dboChunk", piece/.test(SVC) && /"_root\.dboData", a\.json/.test(SVC));
check('payloadJson keeps a payload up to the new ceiling', M.payloadJson({ s: 'y'.repeat(300000) }) !== 'null' && M.payloadJson({ s: 'y'.repeat(400001) }) === 'null');

// ---- the panel's side ----
const vm = require('vm');
const feed = (t, list) => { for (const p of list) vm.runInContext('_root.dboChunk(' + JSON.stringify(p) + ')', t.ctx); };
const timing = (t) => t.msgs().filter((m) => m.key === 'dbo:nativeTiming');
const drawn = (t) => !!(t.root.dboPanel && t.root.dboPanel.text && t.root.dboPanel.text.title);
{
  const t = S.boot('dbo_naming');
  feed(t, [pieces[1]]);
  check('one piece of two draws nothing', !drawn(t));
  feed(t, [pieces[1]]);
  check('...nor the same piece twice', !drawn(t) && timing(t).length === 0);
  feed(t, [pieces[0]]);
  check('the last piece, in either order, draws the panel from the whole payload', drawn(t));
  const r = timing(t);
  check('...and reports the delivery: version, characters, pieces, parse and draw times', r.length === 1 &&
    r[0].args[0] === 'naming-1' && r[0].args[1] === big.length && r[0].args[2] === 2 && r[0].args[3] >= 0 && r[0].args[4] >= 0, r.map((m) => m.args));
}
{
  const t = S.boot('dbo_naming');
  feed(t, M.chunkArgs(big, 5).slice(0, 1));
  feed(t, M.chunkArgs(big, 6));
  check('a newer set replaces an unfinished older one', drawn(t) && timing(t).length === 1);
  feed(t, M.chunkArgs(big, 5));
  check('...and the older set arriving late, even whole, never redraws the stale payload', timing(t).length === 1);
}
{
  const t = S.boot('dbo_naming');
  for (const bad of ['no separator here', 'x|0|2\u0001{}', '9|2|2\u0001{}', '9|-1|2\u0001{}', '9|0|0\u0001{}', '9|0.5|2\u0001{}']) feed(t, [bad]);
  check('bad headers are dropped', !drawn(t) && timing(t).length === 0);
}
{
  // the clock moves while the panel parses and draws: parse and draw times come from it
  const t = S.boot('dbo_naming');
  const parse = t.ctx.dboParseRaw;
  t.ctx.dboParseRaw = (s) => { t.st.time += 40; return parse(s); };
  feed(t, M.chunkArgs(big, 3));
  const r = timing(t)[0];
  check('the parse time is the parse alone, the draw time the rest', r && r.args[3] === 40 && r.args[4] === 0, r && r.args);
}
{
  const t = S.boot('dbo_naming');
  t.push({ type: 'namePrompt', id: 68, nonce: 'n1', pad: 'z'.repeat(25000) });
  const r = timing(t);
  check('a payload of 20,000 or more sent whole reports its parse, one piece, no draw time', r.length === 1 && r[0].args[2] === 1 && r[0].args[4] === -1, r.map((m) => m.args));
  t.push({ type: 'namePrompt', id: 68, nonce: 'n2' });
  check('...and a small one reports nothing', timing(t).length === 1);
}
T.done();
