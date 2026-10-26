// Runs the native decor panel (swf/dbo_decor) on the stub stage with payloads shaped as server decor.js panelFor builds them.
//   node tests/native-decor-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const base = {
  type: 'decor', id: 171, nonce: 'p1', home: "Olaf's home", owner: true, undo: 0,
  budget: [{ label: 'Pieces', used: 2, of: 3 }, { label: 'Lights', used: 1, of: 1 }, { label: 'Workbenches', used: 0, of: 1 }, { label: 'Containers', used: 0, of: 1 }],
  groups: [{ id: 'beds', label: 'Beds' }, { id: 'storage', label: 'Storage' }, { id: 'lights', label: 'Lights' }], group: 'beds', page: 0, pages: 2, nearby: [],
};
const catalog = Object.assign({}, base, { view: 'catalog', rows: [
  { key: '9001:Skyrim.esm', name: 'Bed', cost: [{ name: 'Firewood', n: 4, have: 6 }, { name: 'Iron Ingot', n: 1, have: 0 }], why: '' },
  { key: '9006:Skyrim.esm', name: 'Double Bed', cost: [{ name: 'Firewood', n: 8, have: 6 }], why: '' },
  { key: '9007:Skyrim.esm', name: 'Lantern Bed', cost: [{ name: 'Iron Ingot', n: 1, have: 3 }], why: 'This home has its 1 lights already.' },
] });
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const list = (t) => t.root.dboPanel.list;
const rowsOf = (t) => Object.keys(list(t).kids).filter((n) => /^r\d$/.test(n)).map((n) => list(t)[n]);

{
  const t = S.boot('dbo_decor');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1, t.msgs());
  t.push(catalog);
  const h = t.root.dboPanel.head;
  check('the header names the home', h.title.text === "Olaf's home", h.title.text);
  check('a meter with one slot left of several is amber, a full one red, a lone empty slot plain', h.m0.textColor === 0xC9A86A && h.m1.textColor === 0xB23A3A && h.m2.textColor === 0x999999, [h.m0.textColor, h.m1.textColor, h.m2.textColor]);
  check('the owner sees three tabs, the open one bright', h.tab0 && h.tab2 && h.tab0._alpha === 100 && h.tab1._alpha === 30);
  const r = rowsOf(t);
  check('one row per catalogue piece', r.length === 3, r.length);
  check('a row shows its cost against what is held', r[0].sub.text === 'Firewood 6/4    Iron Ingot 0/1', r[0].sub.text);
  check('a row short of a material has a red cost line', r[0].sub.textColor === 0xB23A3A && r[1].sub.textColor === 0xB23A3A);
  check('a blocked row shows why, greyed, with no key number', r[2].sub.text.indexOf('lights already') > 0 && r[2].label.textColor === 0x606060 && r[2].num.text === '' && r[2]._alpha === 50, r[2].sub.text);
  check('the groups are listed, the open one bright', list(t).g0._alpha === 100 && list(t).g1._alpha === 30);
  r[1].onRelease();
  const pl = msgs(t, 'dbo:decorPlace');
  check('clicking a row sends decorPlace with the nonce and the piece', pl.length === 1 && pl[0].args[0] === 'p1' && pl[0].args[1] === '9006:Skyrim.esm', pl);
  t.press(49);
  check('key 1 places the first row', msgs(t, 'dbo:decorPlace').length === 2 && msgs(t, 'dbo:decorPlace')[1].args[1] === '9001:Skyrim.esm');
  t.press(51);
  check('key 3 on a blocked row does nothing', msgs(t, 'dbo:decorPlace').length === 2);
  r[2].onRelease && r[2].onRelease();
  check('nor does clicking it', msgs(t, 'dbo:decorPlace').length === 2);
  list(t).g1.onRelease();
  const v = msgs(t, 'dbo:decorView').pop();
  check('a group sends decorView catalog <group> page 0', v && v.args.join('|') === 'p1|catalog|storage|0', v);
  t.press(39);
  check('Right asks for the next page', msgs(t, 'dbo:decorView').pop().args.join('|') === 'p1|catalog||1');
  t.press(82);
  check('R goes to the next tab', msgs(t, 'dbo:decorView').pop().args[1] === 'placed');
  t.press(40); t.press(40); t.press(13);
  check('Down, Down, Enter chooses the second row', msgs(t, 'dbo:decorPlace').pop().args[1] === '9006:Skyrim.esm');
  check('focus plays UIMenuFocus, a choice UIMenuOK', t.sounds.includes('PlaySound:UIMenuFocus') && t.sounds.includes('PlaySound:UIMenuOK'), t.sounds);
}

{
  const t = S.boot('dbo_decor');
  t.push(Object.assign({}, base, { view: 'placed', undo: 42, pages: 1, rows: [
    { key: 'ff0000a0', name: 'Bed', group: 'beds', state: '', refund: '2 Firewood' },
    { key: 'ff0000a1', name: 'Planter', group: 'garden', state: 'growing, 3 hours left', refund: '1 Firewood' },
  ] }));
  const r = rowsOf(t);
  check('placed rows show the refund preview', r[0].sub.text === 'taking it down gives back 2 Firewood', r[0].sub.text);
  check('and a planter its state', r[1].sub.text.indexOf('growing, 3 hours left') === 0, r[1].sub.text);
  r[1].mv.onRelease();
  check('Move sends the ref', msgs(t, 'dbo:decorMove').pop().args.join('|') === 'p1|ff0000a1');
  r[0].rm.onRelease();
  check('Remove sends the ref', msgs(t, 'dbo:decorRemove').pop().args.join('|') === 'p1|ff0000a0');
  check('the undo button counts down from the payload', t.root.dboPanel.head.undo.label.text === 'Undo (42 s)');
  t.root.dboPanel.head.undo.onRelease();
  check('Undo sends decorUndo', msgs(t, 'dbo:decorUndo').length === 1);
  check('one page: no paging arrows', !t.root.dboPanel.foot.prev && !t.root.dboPanel.foot.next);
}

{
  const t = S.boot('dbo_decor');
  t.push(Object.assign({}, base, { view: 'people', pages: 1, rows: [{ key: '9', name: 'Stray' }], nearby: [{ key: '10', name: 'Gemma' }] }));
  const r = rowsOf(t);
  check('people: the named, then who is here', r.length === 2 && r[0].label.text === 'Stray' && r[1].label.text === 'Gemma');
  r[0].rv.onRelease();
  r[1].gr.onRelease();
  check('Revoke and Grant send the profile', msgs(t, 'dbo:decorRevoke').pop().args[1] === '9' && msgs(t, 'dbo:decorGrant').pop().args[1] === '10');
  t.push(Object.assign({}, catalog, { owner: false }));
  check('a decorator who is not the owner has no People tab', !t.root.dboPanel.head.tab2);
  t.push(Object.assign({}, catalog, { page: 1 }));
  check('page 2 of 2: back arrow only', t.root.dboPanel.foot.prev && !t.root.dboPanel.foot.next && t.root.dboPanel.foot.page.text === 'Page 2 of 2');
  t.press(27);
  check('Escape sends close and closes from the SWF', msgs(t, 'close').length === 1 && t.sent.some((m) => m.e === 'closeMenu'));
}

{
  const t = S.boot('dbo_decor', true);
  t.tick();
  t.st.time += 8000; t.tick();
  check('without skse nothing is sent, and the close waits for it', t.sent.length === 0);
  t.arrive(); t.tick();
  check('once skse appears: ready, then the self-close for the missing payload', t.msgs()[0].key === 'ready' && t.sent.some((m) => m.e === 'closeMenu'), t.sent);
  const u = S.boot('dbo_decor');
  u.push({ nonce: 'x' });
  check('an unreadable payload is logged, not drawn', u.logs.some((l) => l.indexOf('unreadable payload') >= 0) && !u.root.dboPanel.list);
}

T.done();
