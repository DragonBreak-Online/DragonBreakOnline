// What a spell does, shown where it is chosen (the user, 7 Nov: "people need descriptions for spells they picked"): the server
// sends `about` on the spellbook's and the tome shop's rows (gameplay spells.js); the native panels (swf/dbo_spellbook,
// swf/dbo_tomes) and the browser widgets (skymp5-front features/spellbook, features/tomeShop) draw it under the spell. The
// browser half is bundled with esbuild when the fork's is beside this client (or ESBUILD_MODULES names a node_modules with it).
// The mutants at the end must each fail.
//   node tests/spell-about-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('./native-swf-stub');
const T = S.checker();

const ABOUT1 = '8 fire damage a second while you hold it.';
const ABOUT2 = 'Summons a creature to fight at your side for 60 seconds.';
const sp = (id, name, school, prepared, about) => ({ id, name, school, rank: 0, rankName: 'Novice', prepared: !!prepared, about });
const BOOK = { type: 'spellbook', id: 58, nonce: 'b1', max: 3, atCollege: true, hint: '', result: '', resultKind: '',
  prepared: [sp('12fcd:Skyrim.esm', 'Flames', 'Destruction', true, ABOUT1)],
  known: [sp('12fcd:Skyrim.esm', 'Flames', 'Destruction', true, ABOUT1), sp('640b6:Skyrim.esm', 'Conjure Familiar', 'Conjuration', false, ABOUT2), sp('43324:Skyrim.esm', 'Candlelight', 'Alteration', false, '')],
  events: { prepare: 'p', unprepare: 'u', close: 'c' } };
const tome = (i, about) => ({ id: 'b' + i + ':Skyrim.esm', name: 'Spell Tome: Spell ' + i, spell: 'Spell ' + i, school: 'Destruction', rank: 0, rankName: 'Novice', price: 50, canAfford: true, blocked: '', about });
const SHOP = { type: 'tomeShop', id: 60, nonce: 'n9', seller: 'The Synod', title: 'Tomes', gold: 850, canBuy: true, nextPurchaseAt: 0, whyNot: '', skills: [], result: '', resultKind: '',
  tomes: [tome(1, ABOUT1), tome(2, '')], events: { buy: 'b', close: 'c' } };

const textsOf = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids || {})) { if (typeof x.text === 'string') out.push(x.text); if (x.kids) walk(x); } }; walk(t.root.dboPanel); return out.join('|'); };
const native = (c) => {
  const b = S.boot('dbo_spellbook');
  b.push(BOOK);
  const bt = textsOf(b);
  c('native spellbook: each spell shows what it does', bt.includes(ABOUT1) && bt.includes(ABOUT2), bt.slice(0, 400));
  c('native spellbook: ...a spell with none shows no empty line', !/\|\s+\|/.test(bt));
  const s = S.boot('dbo_tomes');
  s.push(SHOP);
  c('native tome shop: each tome shows what its spell does', textsOf(s).includes(ABOUT1), textsOf(s).slice(0, 400));
};
native(T.check);

// The browser widgets
const ROOT = path.resolve(__dirname, '..', '..');
const ES = [process.env.ESBUILD_MODULES || '', path.join(ROOT, 'skymp5-server', 'node_modules'), path.join(ROOT, 'skymp5-front', 'node_modules')].filter(Boolean).find((d) => fs.existsSync(path.join(d, 'esbuild', 'package.json')));
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-about-'));
const bundle = (rel) => {
  const entry = path.join(OUT, `e-${path.basename(path.dirname(rel))}.tsx`);
  const file = path.join(ROOT, rel).replace(/\\/g, '/');
  fs.writeFileSync(entry, `export { default as Widget } from '${file}';\nexport { renderToStaticMarkup } from 'react-dom/server';\nexport { createElement } from 'react';\n`);
  const out = entry.replace(/\.tsx$/, '.js');
  require(path.join(ES, 'esbuild')).buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', loader: { '.js': 'jsx', '.scss': 'empty', '.png': 'empty', '.svg': 'empty' },
    outfile: out, logLevel: 'error', nodePaths: [path.join(ROOT, 'skymp5-front', 'node_modules')] });
  return fs.readFileSync(out, 'utf8');
};
let SB = '', TS = '';
if (ES) { try { SB = bundle('skymp5-front/src/features/spellbook/index.tsx'); TS = bundle('skymp5-front/src/features/tomeShop/index.tsx'); } catch (e) { T.check('the browser widgets bundle', false, String(e.message).slice(0, 300)); } }
const render = (src, data) => { const f = path.join(OUT, `r-${Math.random().toString(36).slice(2)}.js`); fs.writeFileSync(f, src); const M = require(f); return M.renderToStaticMarkup(M.createElement(M.Widget, { data })); };
const front = (sb, ts, c) => {
  const b = render(sb, BOOK);
  c('browser spellbook: each spell shows what it does', b.includes(ABOUT1) && b.includes(ABOUT2) && /tomeShop__about/.test(b), b.slice(0, 300));
  c('browser spellbook: ...and a spell with none shows no empty line', (b.match(/tomeShop__about/g) || []).length === 3, (b.match(/tomeShop__about/g) || []).length);
  const s = render(ts, SHOP);
  c('browser tome shop: each tome shows what its spell does', s.includes(ABOUT1) && (s.match(/tomeShop__about/g) || []).length === 1, s.slice(0, 300));
};
if (SB && TS) front(SB, TS, T.check); else console.log('ok   browser check skipped: no esbuild beside this client');

const read0 = fs.readFileSync;
const AS = { spellbook: path.resolve(__dirname, '..', 'swf', 'dbo_spellbook', 'scripts', 'frame_1', 'DoAction.as'), tomes: path.resolve(__dirname, '..', 'swf', 'dbo_tomes', 'scripts', 'frame_1', 'DoAction.as') };
const MUTANTS = [
  ['native', 'native spellbook: never drawn', AS.spellbook, '      flowHint("    " + s.about);', '      void 0;'],
  ['native', 'native tome shop: never drawn', AS.tomes, '      flowHint(String(t.about));', '      void 0;'],
  ['front', 'browser spellbook: never drawn', 'sb', 's.about ?', 'false ?'],
  ['front', 'browser tome shop: never drawn', 'ts', 't.about ?', 'false ?'],
];
for (const [side, name, file, a, b] of MUTANTS) {
  if (side === 'front' && !(SB && TS)) continue;
  const src = side === 'native' ? read0(file, 'utf8').replace(/\r\n/g, '\n') : file === 'sb' ? SB : TS;
  if (!src.includes(a)) { T.check(`mutant "${name}": its text is there`, false, a); continue; }
  let bad = 0;
  if (side === 'native') {
    fs.readFileSync = function (f, ...rest) { return path.resolve(String(f)) === file ? src.split(a).join(b) : read0.call(fs, f, ...rest); };
    try { native((w, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
    fs.readFileSync = read0;
  } else {
    try { front(file === 'sb' ? src.split(a).join(b) : SB, file === 'ts' ? src.split(a).join(b) : TS, (w, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  }
  T.check(`mutant caught: ${name}`, bad > 0);
}
fs.rmSync(OUT, { recursive: true, force: true });
T.done();
