// Runs the native interact menu (swf/dbo_context) on the stub stage with the widget playerActionService publishes.
// The headings are checked against the browser's own groupActions (skymp5-front features/contextMenu), read from its source.
//   node tests/native-context-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

// groupActions without React: the GROUPS table and the function, cut from the browser file and stripped of types
const front = fs.readFileSync(path.resolve(__dirname, '../../skymp5-front/src/features/contextMenu/index.tsx'), 'utf8');
const cut = front.slice(front.indexOf('const GROUPS'), front.indexOf('// Gap from the screen centre'));
const strip = require('module').stripTypeScriptTypes;
const groupJs = strip ? strip(cut) : require('typescript').transpileModule(cut, { compilerOptions: { target: 99 } }).outputText;
const groupActions = new Function(groupJs.replace(/^export /gm, '') + '\nreturn groupActions;')();

const ev = { action: 'pa:action', close: 'pa:close', trade: 'pa:trade' };
const A = (id, label) => ({ id, label: label || id });
const guardMenu = { targetName: 'Lydia', mode: 'menu', lines: [], events: ev,
  actions: [A('trade', 'Trade'), A('party', 'Invite to party'), A('search', 'Search'), A('capture', 'Arrest'), A('faction:invite', 'Invite to the Guard'), A('pickpocket', 'Pickpocket'), A('emote', 'Wave')] };
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const B = (t) => t.root.dboPanel.body;
const rowsOf = (t) => Object.keys(B(t).kids).filter((n) => /^r\d$/.test(n)).map((n) => B(t)[n]);
const headsOf = (t) => Object.keys(B(t).kids).filter((n) => /^head\d+$/.test(n)).map((n) => B(t)[n].text);
const closed = (t) => t.closed();
// the browser's order: headings and labels, flattened
const browserOrder = (actions) => groupActions(actions).reduce((o, g) => o.concat(g.heading ? ['#' + g.heading] : [], g.actions.map((a) => a.label)), []);
const nativeOrder = (t) => Object.keys(B(t).kids).filter((n) => /^(head\d+|r\d)$/.test(n)).sort((x, y) => B(t)[x]._y - B(t)[y]._y || (/^head/.test(x) ? -1 : 1))
  .map((n) => (/^head/.test(n) ? '#' + B(t)[n].text : B(t)[n].label.text));

{
  const t = S.boot('dbo_context');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1, t.msgs());
  t.push(guardMenu);
  check('Interact above the name', B(t).kicker.text === 'Interact' && B(t).title.text === 'Lydia');
  check('the entries under the browser\'s headings, in its order', JSON.stringify(nativeOrder(t)) === JSON.stringify(browserOrder(guardMenu.actions)), { native: nativeOrder(t), browser: browserOrder(guardMenu.actions) });
  check('...an unknown id (trade, emote) first and unheaded', rowsOf(t)[0].label.text === 'Trade' && rowsOf(t)[1].label.text === 'Wave' && headsOf(t)[0] === 'Party');
  check('rows numbered 1-7 at 30%, a Close row', rowsOf(t).length === 7 && rowsOf(t)[6].key.text === '7' && rowsOf(t).every((r) => r._alpha === 30) && B(t).close.label.text === 'Close');
  check('down-right of the crosshair, on the screen', t.root.dboPanel._x === 658 && t.root.dboPanel._y >= 40);
  t.press(53);
  const a = msgs(t, 'pa:action');
  check('key 5 (Search, under Law) sends the widget\'s action event with the entry id', a.length === 1 && a[0].args[0] === 'search', a);
  check('...with the OK sound, and stays up: the owner closes it (Worker 1, 26 Oct)', !closed(t) && t.sounds.includes('PlaySound:UIMenuOK'));
}

{
  const t = S.boot('dbo_context');
  t.push(guardMenu);
  t.press(40); t.press(40); t.press(13);
  check('Down, Down, Enter picks the second entry', msgs(t, 'pa:action')[0].args[0] === 'emote');
  const u = S.boot('dbo_context');
  u.push(Object.assign({}, guardMenu, { events: { action: 'salvage:break', close: 'salvage:close' } }));
  u.root.dboPanel.body.r0.onRollOver();
  check('hover focuses', u.root.dboPanel.body.r0._alpha === 100);
  u.root.dboPanel.body.r0.onRelease();
  check('another widget\'s events are used verbatim', msgs(u, 'salvage:break').length === 1 && msgs(u, 'pa:action').length === 0);
  const c = S.boot('dbo_context');
  c.push(guardMenu);
  c.root.dboPanel.body.close.onRelease();
  check('Close sends the widget close (no bare close) and closes', msgs(c, 'pa:close').length === 1 && msgs(c, 'close').length === 0 && closed(c));
  const e = S.boot('dbo_context');
  e.push(guardMenu);
  e.press(27);
  check('Escape closes the same way', msgs(e, 'pa:close').length === 1 && closed(e) && e.sounds.includes('PlaySound:UIMenuCancel'));
}

{
  const rope = [A('ropelead', 'Lead by the rope'), A('ropecut', 'Cut the rope'), A('super:feed', 'Feed')];
  const t = S.boot('dbo_context');
  t.push(Object.assign({}, guardMenu, { actions: rope }));
  check('law ids without Search are headed Rope, as the browser', headsOf(t).join() === 'Rope,Your nature' && JSON.stringify(nativeOrder(t)) === JSON.stringify(browserOrder(rope)), nativeOrder(t));
  const many = Array.from({ length: 12 }, (_, i) => A('voice:' + i, 'Shout ' + i)).concat([A('c:follow', 'Follow me')]);
  const m = S.boot('dbo_context');
  m.push(Object.assign({}, guardMenu, { actions: many }));
  check('13 entries: nine on the first page, the heading with them', m.root.dboPanel.body.r8 && !m.root.dboPanel.body.r9 && m.root.dboPanel.body.page.text.indexOf('Page 1 of 2') === 0 && m.root.dboPanel.body.r0.label.text === 'Follow me');
  m.press(39);
  check('Right turns to the rest, its heading repeated', !m.root.dboPanel.body.r4 && m.root.dboPanel.body.r0.label.text === 'Shout 8' && headsOf(m).join() === 'Voice', headsOf(m));
  m.press(49);
  check('number keys count on the page shown', msgs(m, 'pa:action')[0].args[0] === 'voice:8');
  m.push(Object.assign({}, guardMenu, { actions: many }));
  check('a re-send for the same target keeps the page (a gameplay menu redraws in place)', m.root.dboPanel.body.r0.label.text === 'Shout 8');
  m.root.dboPanel.body.prev.onRelease();
  check('a clickable Previous turns back', m.root.dboPanel.body.r0.label.text === 'Follow me' && m.root.dboPanel.body.prev.disabled === true);
  m.root.dboPanel.body.next.onRelease();
  check('...and Next forward, greyed on the last page', m.root.dboPanel.body.r0.label.text === 'Shout 8' && m.root.dboPanel.body.next.disabled === true);
  m.push(Object.assign({}, guardMenu, { targetName: 'Faendal', actions: many }));
  check('another target starts on page one', m.root.dboPanel.body.r0.label.text === 'Follow me');
  const l = S.boot('dbo_context');
  l.push({ targetName: 'Gaius Maro of the Imperial Watch', mode: 'inspect', lines: ['A Breton man.', 'He carries a sword.'], actions: [], events: ev });
  check('inspect: Inspect, two lines, no entries', l.root.dboPanel.body.kicker.text === 'Inspect' && l.root.dboPanel.body.line1.text === 'He carries a sword.' && !l.root.dboPanel.body.r0);
  check('a long name gets two lines at a smaller size', l.root.dboPanel.body.title.multiline === true && l.root.dboPanel.body.title.fmt.size === 20);
  // an alchemy-sized inspect list: paged, Close kept on the screen in its footer
  const brew = Array.from({ length: 24 }, (_, i) => `Ingredient ${i}: restores a little health over a few seconds, sold in Bruma.`);
  const q = S.boot('dbo_context');
  q.push({ targetName: 'Alembic', mode: 'inspect', lines: brew });
  const qb = () => q.root.dboPanel.body;
  const shown = Object.keys(qb().kids).filter((k) => /^line\d+$/.test(k)).length;
  check('a long inspect list is paged, each line with room for its wrap', shown > 1 && shown < 24 && qb().line0._height >= Math.ceil(brew[0].length / 34) * 22 && qb().page.text.indexOf('Page 1 of ') === 0, [shown, qb().line0._height]);
  check('...and Close stays on the screen', q.root.dboPanel._y + qb().close._y + 32 <= 680, q.root.dboPanel._y + qb().close._y);
  qb().next.onRelease();
  check('...Next shows the next lines', qb().line0.text === brew[shown]);
  qb().close.onRelease();
  check('an inspect payload without events closes with pa:close', msgs(q, 'pa:close').length === 1 && closed(q));
}

{
  const t = S.boot('dbo_context', true);
  t.tick();
  t.st.time += 8000; t.tick();
  check('without skse nothing is sent', t.sent.length === 0);
  t.arrive(); t.tick();
  check('once skse appears: ready, then the self-close for the missing payload', t.msgs()[0].key === 'ready' && closed(t), t.sent);
  const u = S.boot('dbo_context');
  u.push({ mode: 'menu' });
  check('an unreadable payload is logged, not drawn', u.logs.some((x) => x.indexOf('unreadable payload') >= 0) && !u.root.dboPanel.body);
}

T.done();
