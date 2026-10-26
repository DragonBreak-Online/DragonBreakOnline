// Runs the native emote panel (swf/dbo_emotes) on the stub stage with the widget emoteService publishes.
//   node tests/native-emotes-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
// DBO_MENU names a mutated copy of the panel (never the tracked file) to prove the harness can fail
const MENU = process.env.DBO_MENU || 'dbo_emotes';

// The service's own GROUPS and events, read out of emoteService.ts, so the panel is tested against what it is sent
const svc = fs.readFileSync(path.resolve(__dirname, '..', 'src/services/services/emoteService.ts'), 'utf8').replace(/\r\n/g, '\n');
const groupsSrc = svc.slice(svc.indexOf('const GROUPS: EmoteGroup[] = '), svc.indexOf('\n];', svc.indexOf('const GROUPS')) + 3).replace('const GROUPS: EmoteGroup[] = ', '');
// eslint-disable-next-line no-new-func
const GROUPS = new Function(`return ${groupsSrc.replace(/;\s*$/, '')};`)();
const events = { play: 'emote:play', close: 'emote:close', stop: 'emote:stop' };
check('the service\'s events are the ones the panel is given', /const events = \{\n  play: 'emote:play',\n  close: 'emote:close',\n  stop: 'emote:stop',\n\};/.test(svc));
const widget = { type: 'emoteWheel', id: 24, groups: GROUPS, events };

const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const P = (t) => t.root.dboPanel;
const closed = (t) => t.sent.some((m) => m.e === 'closeMenu');
const rows = (t) => Object.keys(P(t).rows.kids).filter((n) => /^e\d$/.test(n)).map((n) => P(t).rows[n]);
const groupBtns = (t) => Object.keys(P(t).groups.kids).filter((n) => /^g\d$/.test(n)).map((n) => P(t).groups[n]);

{
  const t = S.boot(MENU);
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1);
  t.push(widget);
  check(`every group down the left (${GROUPS.length}), the first bright`, groupBtns(t).length === GROUPS.length && groupBtns(t)[0]._alpha === 100 && groupBtns(t)[1]._alpha === 30 && groupBtns(t).map((b) => b.label.text).join('|') === GROUPS.map((g) => g.label).join('|'));
  check('the first group\'s emotes as rows, in the service\'s order', rows(t).map((r) => r.label.text).join('|') === GROUPS[0].emotes.map((e) => e.label).join('|'), rows(t).map((r) => r.label.text));
  check('each row has its number key', P(t).rows.k0.text === '1' && P(t).rows['k' + (GROUPS[0].emotes.length - 1)].text === String(GROUPS[0].emotes.length));
  check('the centre names the group in spaced capitals and the emote it would play', P(t).centre.category.text === GROUPS[0].label.toUpperCase() && P(t).centre.emote.text === GROUPS[0].emotes[0].label);
  rows(t)[2].onRollOver();
  check('hovering a row previews it by name, as the browser wheel previews', P(t).centre.emote.text === GROUPS[0].emotes[2].label && rows(t)[2]._alpha === 100);
  check('the footer has Cancel Emote and Close', P(t).foot.stop.label.text === 'Cancel Emote' && P(t).foot.close.label.text === 'Close');
  groupBtns(t)[1].onRelease();
  check('a group click shows its emotes and lights it', rows(t)[0].label.text === GROUPS[1].emotes[0].label && groupBtns(t)[1]._alpha === 100 && t.sounds.includes('PlaySound:UIMenuPrevNext'));
  rows(t)[3].onRelease();
  const p = msgs(t, 'emote:play');
  check('a row click plays that emote with its anim, then closes', p.length === 1 && p[0].args[0] === GROUPS[1].emotes[3].anim && closed(t), p);
}

{
  const t = S.boot(MENU);
  t.push(widget);
  t.press(39); t.press(39);
  check('Right twice moves two groups on', rows(t)[0].label.text === GROUPS[2].emotes[0].label);
  t.press(37); t.press(37); t.press(37);
  check('Left wraps from the first to the last group', rows(t)[0].label.text === GROUPS[GROUPS.length - 1].emotes[0].label);
  t.press(50);
  check('key 2 plays the second emote of the group shown', msgs(t, 'emote:play')[0].args[0] === GROUPS[GROUPS.length - 1].emotes[1].anim && closed(t));
  const u = S.boot(MENU);
  u.push(widget);
  u.press(57);
  check('a number past the last row plays nothing', !msgs(u, 'emote:play').length || GROUPS[0].emotes.length >= 9);
  u.press(40); u.press(40); u.press(13);
  check('Down, Down, Enter: the second control in the focus order (the second group)', rows(u)[0].label.text === GROUPS[1].emotes[0].label);
  P(u).foot.stop.onRelease();
  check('Cancel Emote sends stop and closes', msgs(u, 'emote:stop').length === 1 && closed(u));
  const v = S.boot(MENU);
  v.push(widget);
  v.press(27);
  check('Escape sends the widget\'s close and closes', msgs(v, 'emote:close').length === 1 && closed(v) && msgs(v, 'close').length === 0);
  const w = S.boot(MENU);
  w.push(widget);
  P(w).foot.close.onRelease();
  check('Close does the same', msgs(w, 'emote:close').length === 1 && closed(w));
}

{
  const long = { type: 'emoteWheel', id: 24, events, groups: [{ id: 'x', label: 'X', emotes: [{ anim: 'IdleA', label: 'Two Hands Crossed At Attention' }, { anim: 'IdleB', label: 'Short' }] }, { id: 'empty', label: 'Empty', emotes: [] }] };
  const t = S.boot(MENU);
  t.push(long);
  check('a long label is shortened as the browser wheel shortens it', rows(t)[0].label.text === 'Two H. Cross At Attn', rows(t)[0].label.text);
  check('a group with no emotes is left out', groupBtns(t).length === 1);
  const l = S.boot(MENU, true);
  l.tick(); l.st.time += 8000; l.tick();
  check('without skse nothing is sent', l.sent.length === 0);
  l.arrive(); l.tick();
  check('once skse appears: ready, then the self-close for the missing payload', l.msgs()[0].key === 'ready' && closed(l));
  const u = S.boot(MENU);
  u.push({ type: 'emoteWheel', groups: [] });
  check('an unreadable payload is logged, not drawn', u.logs.some((x) => x.indexOf('unreadable payload') >= 0) && !P(u).rows);
}

T.done();
