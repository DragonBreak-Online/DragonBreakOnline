// Runs the native player menu (swf/dbo_menu) on the stub stage with the widget gamemode.js publishes (widget 52), against the
// browser menu's own rules (skymp5-front features/playerMenu): tabs and sections, the search across tabs and the commands a key
// reaches, forms built from usage (variants, choices, names with the people you know, numbers), asked fields, a bare command
// and its extra words, dbo:menuRun with the nonce, Switch character, Escape and Close.
//   node tests/native-menu-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const held = (t) => t.sent.reduce((n, m) => n + (m.e === 'allowTextInput' ? (m.on ? 1 : -1) : 0), 0);
const lowest = (t) => t.sent.reduce((s, m) => { if (m.e === 'allowTextInput') { s.n += m.on ? 1 : -1; s.min = Math.min(s.min, s.n); } return s; }, { n: 0, min: 0 }).min;

const P = (t) => t.root.dboPanel;
const visible = (c) => { for (let k = c; k; k = k._parent) if (k._visible === false) return false; return true; };
const buttons = (t) => { const out = []; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.label && k.onRelease && visible(k)) out.push(k); if (k.kids) walk(k); } }; walk(P(t)); return out; };
const btn = (t, label) => buttons(t).find((b) => b.label.text === label);
const press = (t, label) => { const b = btn(t, label); if (!b) throw new Error('no button ' + label + ' among ' + buttons(t).map((x) => x.label.text).join('|')); b.onRelease(); };
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const runs = (t) => msgs(t, 'dbo:menuRun');
const lastRun = (t) => runs(t).slice(-1)[0];
// the command buttons on the shown page, top to bottom
const cmds = (t) => { const out = []; for (const pg of Object.values(P(t).flowClip.kids)) { if (!pg._visible) continue; for (const r of Object.values(pg.kids)) if (r.run && r.desc) out.push(r); } return out.sort((a, b) => a._y - b._y).map((r) => r.run.label.text); };
const descOf = (t, label) => { for (const pg of Object.values(P(t).flowClip.kids)) for (const r of Object.values(pg.kids)) if (r.run && r.run.label.text === label) return r.desc.text; return null; };
const texts = (t) => { const out = []; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (typeof k.text === 'string' && visible(k)) out.push(k.text); if (k.kids) walk(k); } }; walk(P(t)); return out.join(' | '); };
const boxOf = (t) => { let f = null; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.type === 'input' && visible(k)) f = k; if (k.kids) walk(k); } }; walk(P(t)); return f; };
const typeOn = (t, label, text) => { const r = buttons(t).find((b) => b.label.text === 'Type...' && b._parent.label && b._parent.label.text === label); if (!r) throw new Error('no field ' + label); r.onRelease(); boxOf(t).text = text; t.press(13); };
const search = (t, text) => { press(t, 'Search...'); boxOf(t).text = text; t.press(13); };

const entry = (name, label, desc, extra) => Object.assign({ name, label, desc, usage: '/' + name }, extra || {});
const party = { key: 'party', title: 'Party', hints: ['Your party shares the kill.'], entries: [
  entry('invite', 'Invite', 'Ask someone to join your party; they pay nothing.', { form: { variants: [{ word: null, args: [{ label: 'player', kind: 'player' }] }] } }),
  entry('leave', 'Leave', 'Leave your party.', { form: { variants: [{ word: null, args: [] }] } }),
  entry('loot', 'Loot rule', 'How the party shares loot.', { form: { variants: [{ word: 'set', args: [{ label: 'rule', kind: 'enum', options: ['free', 'round', 'leader'] }] }, { word: 'show', args: [] }] } }),
  entry('roll', 'Roll', 'Roll dice for the party.', { form: { variants: [{ word: null, args: [{ label: 'sides', kind: 'number', optional: true }] }] } }),
] };
const trade = { key: 'trade', title: 'Trade', hints: [], entries: [
  entry('pay', 'Pay', 'Give gold to someone.', { ask: [{ label: 'Who' }, { label: 'How much' }] }),
  entry('stuck', 'Stuck', 'Free yourself when stuck.'),
] };
const staffTab = { key: 'staff', title: 'Staff', hints: [], entries: [
  entry('kick', 'Kick', 'Remove a player.', { section: 'Players', form: { variants: [{ word: null, args: [{ label: 'player', kind: 'player' }, { label: 'reason', kind: 'text', rest: true }] }] } }),
  entry('tp', 'Teleport', 'Go to a player.', { section: 'Players' }),
  entry('weather', 'Weather', 'Set the weather.', { section: 'World' }),
] };
const people = [{ label: 'Lydia', value: 'Lydia' }, { label: 'Olaf One-Eye', value: '#OLAF' }, { label: 'Faendal', value: 'Faendal' }];
const base = { type: 'playerMenu', id: 52, nonce: 'p1', tab: '', staff: false, tabs: [party, trade], people, searchOnly: [entry('sit', 'Sit', 'Sit on a chair (or press E at one).'), entry('leave', 'Leave', 'Leave your party.')], search: '' };
const w = (o) => Object.assign({}, base, o);

{
  const t = S.boot('dbo_menu');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1);
  t.push(base);
  check('the title and the line under it', P(t).head.title.text === 'WHAT YOU CAN DO' && /A lone \/ opens this page\./.test(P(t).head.sub.text));
  check('the first tab is shown: its commands in order, then its hints', cmds(t).join('|') === 'Invite|Leave|Loot rule|Roll' && /Your party shares the kill\./.test(texts(t)), cmds(t));
  check('each command says what it does', descOf(t, 'Leave') === 'Leave your party.');
  press(t, 'Leave');
  check('a form with nothing to fill in runs at once', runs(t).length === 1 && lastRun(t).args.join('|') === 'p1|leave|');
  check('one run in flight: the buttons greyed (the server closes the menu)', btn(t, 'Invite').disabled === true);
  t.push(base);
  press(t, 'Invite');
  check('a form opens under its command, nothing sent', runs(t).length === 1 && /player/.test(texts(t)) && !!btn(t, 'Run'));
  check('Run is greyed until the name is filled in', btn(t, 'Run').disabled === true);
  check('a name offers the people you know', !!btn(t, 'Lydia') && !!btn(t, 'Olaf One-Eye') && !!btn(t, 'Faendal'));
  typeOn(t, 'player', 'ol');
  check('typing narrows them by name', !!btn(t, 'Olaf One-Eye') && !btn(t, 'Lydia'));
  typeOn(t, 'player', '#OL');
  check('...or by tag', !!btn(t, 'Olaf One-Eye') && !btn(t, 'Lydia'));
  press(t, 'Olaf One-Eye');
  check('picking one fills in their tag, and the list goes', !btn(t, 'Olaf One-Eye') && /Invite #OLAF/.test(texts(t)));
  press(t, 'Run');
  check('Run sends the command and its words', lastRun(t).args.join('|') === 'p1|invite|#OLAF');
  t.push(base);
  press(t, 'Invite'); press(t, 'Invite');
  check('pressing the command again closes its form', !btn(t, 'Run'));
  press(t, 'Loot rule');
  check('variants are a row of choices, the first chosen', !!btn(t, 'set') && !!btn(t, 'show') && !!btn(t, 'free'));
  check('an enum argument is a row of choices; Run waits for one', btn(t, 'Run').disabled === true);
  press(t, 'round');
  press(t, 'Run');
  check('...and sends the variant word with the choice', lastRun(t).args.join('|') === 'p1|loot|set round');
  t.push(base);
  press(t, 'Loot rule'); press(t, 'round'); press(t, 'show'); press(t, 'set');
  check('changing the variant clears what was chosen', btn(t, 'Run').disabled === true);
  press(t, 'show');
  check('another variant changes the fields (none here)', !btn(t, 'free') && btn(t, 'Run').disabled !== true);
  press(t, 'Run');
  check('...and sends just its word', lastRun(t).args.join('|') === 'p1|loot|show');
  t.push(base);
  press(t, 'Roll');
  check('an optional argument does not hold Run back', btn(t, 'Run').disabled !== true && /sides \(optional\)/.test(texts(t)));
  buttons(t).find((b) => b.label.text === 'Type...' && b._parent.label.text === 'sides (optional)').onRelease();
  check('a number takes digits and a minus only', boxOf(t).restrict === '0-9\\-' && boxOf(t).maxChars === 300);
  boxOf(t).text = '20'; t.press(13);
  press(t, 'Run');
  check('...and is sent', lastRun(t).args.join('|') === 'p1|roll|20');
}

// ---- other tabs: asked fields, a bare command, sections ----
{
  const t = S.boot('dbo_menu');
  t.push(base);
  press(t, 'Trade');
  check('a tab button shows its commands', cmds(t).join('|') === 'Pay|Stuck');
  press(t, 'Pay');
  check('asked fields open with Send greyed until all are filled', btn(t, 'Send').disabled === true);
  typeOn(t, 'Who', 'Lydia');
  check('...still greyed with one left', btn(t, 'Send').disabled === true);
  typeOn(t, 'How much', ' 50 ');
  press(t, 'Send');
  check('Send joins the fields, trimmed', lastRun(t).args.join('|') === 'p1|pay|Lydia 50');
  t.push(w({ tab: 'trade' }));
  check('a re-sent panel naming a tab shows it', cmds(t).join('|') === 'Pay|Stuck');
  press(t, 'Stuck');
  check('a bare command runs on its own', lastRun(t).args.join('|') === 'p1|stuck|');
  t.push(w({ tab: 'trade' }));
  buttons(t).find((b) => b.label.text === '+' && b._parent.run.label.text === 'Stuck').onRelease();
  typeOn(t, 'Words after Stuck', '  please  ');
  press(t, 'Run');
  check('its + adds words after it, trimmed', lastRun(t).args.join('|') === 'p1|stuck|please');
  const s = S.boot('dbo_menu');
  s.push(w({ staff: true, tabs: [party, trade, staffTab], tab: 'staff' }));
  check('a sectioned tab shows its headings', /Players/.test(texts(s)) && /World/.test(texts(s)) && texts(s).indexOf('Players') < texts(s).indexOf('World'));
  press(s, 'Kick');
  check('a free-text argument is a typed box like the rest', !!buttons(s).find((b) => b.label.text === 'Type...' && b._parent.label.text === 'reason'));
}

// ---- the search ----
{
  const t = S.boot('dbo_menu');
  t.push(base);
  search(t, 'party');
  check('a search runs across every tab, a name starting with it first', cmds(t)[0] !== undefined && /\[Party\]/.test(descOf(t, cmds(t)[0])), cmds(t));
  check('the tabs hide while searching', !btn(t, 'Trade'));
  search(t, 'sit chair');
  check('every word must match; the key-reached commands are found too', cmds(t).join('|') === 'Sit' && /\[By key or place\]/.test(descOf(t, 'Sit')));
  search(t, 'GOLD');
  check('case aside', cmds(t).join('|') === 'Pay');
  search(t, 'gold zzz');
  check('every word, not any word', /No command matches/.test(texts(t)));
  search(t, 'leave');
  check('a command found in a tab and by key is listed once', cmds(t).filter((c) => c === 'Leave').length === 1, cmds(t));
  search(t, 'pay');
  check('a command whose name starts with the query comes before one that only mentions it', cmds(t).join('|') === 'Pay|Invite', cmds(t));
  search(t, 'l');
  check('a name starting with the query comes first', cmds(t)[0] === 'Leave' || cmds(t)[0] === 'Loot rule', cmds(t));
  search(t, 'zzz');
  check('no match says so', /No command matches "zzz"\./.test(texts(t)));
  press(t, 'Clear');
  check('Clear brings the tabs back', !!btn(t, 'Trade') && cmds(t).join('|') === 'Invite|Leave|Loot rule|Roll');
  press(t, 'Search...');
  check('the search box takes the keys and sixty characters', boxOf(t).maxChars === 60 && held(t) === 1);
  t.press(40);
  check('arrow keys are typing while it is open', !!boxOf(t));
  t.press(27);
  check('Escape leaves the box, not the menu', !boxOf(t) && !t.closed() && held(t) === 0);
  t.push(w({ search: 'invite' }));
  check('a search asked by name (another panel\'s button) opens that command\'s form', /\[Party\]/.test(descOf(t, 'Invite')) && !!btn(t, 'Run'));
  t.press(27);
  check('Escape closes an open form first', !btn(t, 'Run') && !t.closed());
  const many = [];
  for (let i = 0; i < 30; i++) many.push(entry('c' + i, 'Command ' + i, 'Does thing ' + i + '.'));
  const g = S.boot('dbo_menu');
  g.push(w({ tabs: [{ key: 'all', title: 'All', hints: [], entries: many }] }));
  const where = () => (g.root.dboPanel.foot.pager ? g.root.dboPanel.foot.pager.where.text : '');
  const gp = (x) => g.root.dboPanel.foot.pager[x];
  check('a long tab pages', /^Page 1 of /.test(where()) && gp('prev').disabled === true, where());
  const total = Number(where().split(' of ')[1]);
  const p1 = cmds(g);
  g.press(39);
  check('Right turns the page', /^Page 2 of /.test(where()) && cmds(g)[0] !== p1[0], where());
  // 3 Nov polish: a clickable footer and the wheel; a turn shows a page already drawn rather than drawing them all
  const heads = g.root.dboPanel.head, flowRoot = g.root.dboPanel.flowClip;
  gp('prev').onRelease();
  check('clicking Previous turns back, to the same commands', where() === 'Page 1 of ' + total && cmds(g).join() === p1.join(), where());
  gp('next').onRelease();
  check('clicking Next turns on', where() === 'Page 2 of ' + total, where());
  g.wheel(3);
  check('the wheel up turns back', where() === 'Page 1 of ' + total, where());
  g.wheel(3);
  check('...and stops at the first page', where() === 'Page 1 of ' + total, where());
  g.wheel(-3);
  check('the wheel down turns on', where() === 'Page 2 of ' + total, where());
  check('a turn redraws neither the head nor the pages', g.root.dboPanel.head === heads && g.root.dboPanel.flowClip === flowRoot);
  {
    const shown = buttons(g).filter((b) => b.label.text.indexOf('Command ') === 0);
    check('only the commands on the shown page take the focus, in order', shown.length > 0 && shown.every((b) => g.ctx.actions.includes(b)) && g.ctx.actions.every((b, i) => b.idx === i) && !g.ctx.actions.some((b) => !visible(b)), shown.length);
    g.ctx.setFocus(shown[0].idx);
    g.press(13);
    check('Enter on a shown command still runs it', lastRun(g) && lastRun(g).args[1] === shown[0].entry.name, lastRun(g));
  }
  const tabsMany = [];
  for (let i = 0; i < 14; i++) tabsMany.push({ key: 'k' + i, title: 'Topic number ' + i, hints: [], entries: [entry('x' + i, 'X' + i, 'd')] });
  const r = S.boot('dbo_menu');
  r.push(w({ tabs: tabsMany }));
  const t13 = r.root.dboPanel.tabs.t13;
  check('a long tab row wraps onto a second line inside the panel', t13._y > r.root.dboPanel.tabs.t0._y && t13._x + 100 <= 1160);
}

// ---- leaving ----
{
  const t = S.boot('dbo_menu');
  t.push(base);
  press(t, 'Invite');
  typeOn(t, 'player', 'x');
  buttons(t).find((b) => b.label.text === 'Type...' && b._parent.label.text === 'player').onRelease();
  press(t, 'Trade');
  check('a box whose row is gone gives the keys back', !boxOf(t) && held(t) === 0 && lowest(t) === 0);
  t.push(base);
  press(t, 'Party'); press(t, 'Invite');
  buttons(t).find((b) => b.label.text === 'Type...' && b._parent.label.text === 'player').onRelease();
  t.push(w({ tabs: [trade] }));
  check('...and so does a box whose command a re-sent panel dropped', !boxOf(t) && held(t) === 0 && lowest(t) === 0);
  press(t, 'Switch character');
  check('Switch character closes the menu and asks for the switch', msgs(t, 'dbo:menuClose').length === 1 && msgs(t, 'dbo:menuSwitchChar').length === 1 && t.closed());
  const c = S.boot('dbo_menu');
  c.push(base);
  press(c, 'Close');
  check('Close sends menuClose and closes', msgs(c, 'dbo:menuClose').length === 1 && c.closed());
  const e = S.boot('dbo_menu');
  e.push(base);
  e.press(27);
  check('Escape closes with menuClose', msgs(e, 'dbo:menuClose').length === 1 && e.closed());
  const nt = S.boot('dbo_menu', false, { noTyping: true });
  nt.push(base);
  check('a game without typed input offers no Search', !btn(nt, 'Search...') && cmds(nt).length === 4);
  const n = S.boot('dbo_menu');
  n.push({ type: 'playerMenu', id: 52 });
  check('an unreadable payload draws nothing', !n.root.dboPanel.head);
  n.st.time += 8000; n.tick();
  check('...and with no payload the panel closes itself', n.closed());
}

T.done();
