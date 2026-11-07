// Previous and Next under a paged native panel (swf/lib/dbo-flow.as flowPager; Argent Dralor, 3 Nov: "my spell book, i cant
// access page 2 of my spell list"): the flow panels turned pages only with Left/Right, so the mouse could not reach page 2.
// Run on the spellbook and the tome shop on the stub stage; every flow panel that turns pages by key must draw the buttons.
// The mutants at the end must each fail.
//   node tests/native-flow-pager-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./native-swf-stub');
const T = S.checker();

const P = (t) => t.root.dboPanel;
const shown = (t) => Object.values(P(t).flowClip.kids).find((p) => p._visible);
const sp = (id, name) => ({ id, name, school: 'Illusion', rank: 0, rankName: 'Novice', prepared: false });
const book = (n) => { const known = []; for (let i = 0; i < n; i++) known.push(sp('m' + i, 'Spell ' + i)); return { type: 'spellbook', id: 58, nonce: 'b1', max: 3,
  atCollege: true, hint: '', prepared: [], known, result: '', resultKind: '', events: { prepare: 'p', unprepare: 'u', close: 'c' } }; };
const tome = (i) => ({ id: 'm' + i, name: 'Spell Tome: Spell ' + i, spell: 'Spell ' + i, school: 'Illusion', rank: i % 2, rankName: i % 2 ? 'Apprentice' : 'Novice', price: 10, canAfford: true, blocked: '' });
const shelf = (n) => { const tomes = []; for (let i = 0; i < n; i++) tomes.push(tome(i)); return { type: 'tomeShop', id: 60, nonce: 'n9', seller: 'The Synod', title: 'Tomes', gold: 850,
  canBuy: true, nextPurchaseAt: 0, whyNot: '', tomes, skills: [], result: '', resultKind: '', events: { buy: 'b', close: 'c' } }; };

const behaviour = (check) => {
  for (const [menu, long, short] of [['dbo_spellbook', book(30), book(2)], ['dbo_tomes', shelf(20), shelf(2)]]) {
    const t = S.boot(menu);
    t.push(long);
    const pg = () => P(t).foot.pager;
    const pages = P(t).flowClip ? Object.keys(P(t).flowClip.kids).length : 0;
    check(`${menu}: a long list has pages, and Previous and Next under it`, pages > 1 && !!pg() && !!pg().prev && !!pg().next, pages);
    check(`${menu}: on page 1 Previous is greyed and Next is not`, !!pg() && pg().prev.disabled === true && pg().next.disabled !== true);
    const first = shown(t);
    const sounds = t.sounds.length;
    if (pg()) pg().next.onRelease();
    check(`${menu}: clicking Next shows page 2, with the page-turn sound`, shown(t) !== first && shown(t) && shown(t).pageNo === 1 && /Page 2 of /.test(P(t).foot.hint.text) && t.sounds.length > sounds, shown(t) && shown(t).pageNo);
    check(`${menu}: ...where Previous works again`, !!pg() && pg().prev.disabled !== true);
    for (let i = 0; i < pages + 2 && pg() && pg().next.disabled !== true; i++) pg().next.onRelease();
    check(`${menu}: Next is greyed on the last page, and a click there stays put`, !!pg() && pg().next.disabled === true && (pg().next.onRelease(), shown(t).pageNo === pages - 1), shown(t) && shown(t).pageNo);
    if (pg()) pg().prev.onRelease();
    check(`${menu}: clicking Previous turns back`, shown(t).pageNo === pages - 2);
    t.press(37);
    check(`${menu}: Left still turns too`, shown(t).pageNo === Math.max(0, pages - 3));
    check(`${menu}: the buttons join the focus order, so Up/Down and Enter reach them`, !!pg() && t.ctx.actions.indexOf(pg().next) >= 0);
    const s = S.boot(menu);
    s.push(short);
    check(`${menu}: one page has no buttons`, !P(s).foot.pager);
  }
  // every flow panel turning by key also draws the buttons in its foot
  const dir = path.resolve(__dirname, '..', 'swf');
  const keyed = fs.readdirSync(dir).filter((d) => /^dbo_/.test(d) && fs.existsSync(path.join(dir, d, 'scripts', 'frame_1', 'DoAction.as')))
    .filter((d) => { const src = fs.readFileSync(path.join(dir, d, 'scripts', 'frame_1', 'DoAction.as'), 'utf8'); return /page\+\+/.test(src) && /flowShow\(page\)/.test(src); });
  const missing = keyed.filter((d) => !/flowPager\(f, /.test(fs.readFileSync(path.join(dir, d, 'scripts', 'frame_1', 'DoAction.as'), 'utf8')));
  check(`every flow panel that pages by key draws Previous and Next (${keyed.length})`, keyed.length >= 12 && missing.length === 0, missing);
};
behaviour(T.check);

// The mutants change dbo-flow.as as the stub reads it
const read0 = fs.readFileSync;
const MUTANTS = [
  ['no buttons', '   var c = parent.createEmptyMovieClip("pager", depth);', '   return null;\n   var c = parent.createEmptyMovieClip("pager", depth);'],
  ['a click does not redraw', '   page = n;\n   draw();', '   page = n;'],
  ['the ends are never greyed', '   if (page >= pages - 1)\n   {\n      disable(nx);\n   }', ''],
  ['Next turns back', 'function() { flowTurn(1); }', 'function() { flowTurn(-1); }'],
];
for (const [name, a, b] of MUTANTS) {
  const src = read0(path.resolve(__dirname, '..', 'swf', 'lib', 'dbo-flow.as'), 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(a)) { T.check(`mutant "${name}": its text is in dbo-flow.as`, false, a); continue; }
  fs.readFileSync = function (f, ...rest) { return /dbo-flow\.as$/.test(String(f)) ? src.split(a).join(b) : read0.call(fs, f, ...rest); };
  let bad = 0;
  try { behaviour((w, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  fs.readFileSync = read0;
  T.check(`mutant caught: ${name}`, bad > 0);
}
T.done();
