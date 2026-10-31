// The Character Journal's Settings tab drawn natively (swf/dbo_journal tabs/settings.as), against the browser's SettingsTab:
// Help's problem report (journalReport with the journal nonce, five letters at least, 500 at most), the words of Controls
// and Repairs, and this PC's settings (kept by the overlay) each opening the browser journal at its section; a link to one
// section (X's "Voice settings for <name>") offered first.
//   node tests/native-journal-settings-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const TABS = [{ id: 'profile', label: 'Profile' }, { id: 'settings', label: 'Settings', pinned: true }];
const hub = (settings, extra) => Object.assign({ type: 'journal', id: 50, nonce: 'n1', hub: 1, tabs: TABS, tab: 'settings', opened: 1, clock: { date: 'd', time: 't' }, head: { name: 'Olaf', title: 'J', race: 'N' }, settings }, extra || {});
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const last = (t, key) => msgs(t, key).slice(-1)[0];
const P = (t) => t.root.dboPanel;
const shownPage = (t) => Object.values(P(t).body.flowClip.kids).find((p) => p._visible);
const texts = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (typeof x.text === 'string' && !x.kids) out.push(x.text); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out.join('|'); };
const buttonsOf = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (x.kids && x.label && x.onPick) out.push(x); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out; };
const first = (t) => { for (let i = 0; i < 6; i++) t.press(33); };
const seek = (t, label, test) => { const ok = (b) => (test ? test(b) : b.label.text === label); let b = buttonsOf(t).find(ok); if (b) return b; first(t); for (let i = 0; i < 8 && !(b = buttonsOf(t).find(ok)); i++) { const n = P(t).foot.next; if (!n || n.disabled) break; n.onRelease(); } return b; };
const press = (t, label) => { const b = seek(t, label); if (!b) throw new Error('no button ' + label + ' among ' + buttonsOf(t).map((x) => x.label.text).join('|')); b.onRelease(); };
const everyPage = (t) => { first(t); const out = []; for (let i = 0; i < 8; i++) { out.push(texts(t)); const n = P(t).foot.next; if (!n || n.disabled) break; n.onRelease(); } return out.join('|'); };
const labels = (t) => { first(t); const out = []; for (let i = 0; i < 8; i++) { out.push(...buttonsOf(t).map((b) => b.label.text)); const n = P(t).foot.next; if (!n || n.disabled) break; n.onRelease(); } return out; };
const boxOf = (t) => { let f = null; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.type === 'input') f = k; if (k.kids) walk(k); } }; walk(shownPage(t)); return f; };
const field = (t, label) => seek(t, null, (b) => b.label.text === 'Type...' && b._parent.label && b._parent.label.text.indexOf(label) === 0);
const typeIn = (t, label, text) => { const r = field(t, label); if (!r) throw new Error('no field ' + label); r.onRelease(); boxOf(t).text = text; press(t, 'Done'); };
const focusOf = (m) => JSON.stringify(m.args[2]);

{
  const t = S.boot('dbo_journal');
  t.push(hub({ staff: false }));
  const tx = everyPage(t);
  check('Settings: Help with the report and the launcher\'s repairs', /Help/.test(tx) && /Report a problem/.test(tx) && /Repairing the game files, opening the log folder and resetting every setting are done from the launcher/.test(tx), tx);
  check('...Controls: the game\'s keys are the launcher\'s, read once at start', /Activate, Jump, Sprint, Sneak, Shout, Toggle POV and Invert Y/.test(tx) && /Change these in the launcher \(Settings\), then restart the game\./.test(tx));
  check('...this PC\'s settings, each opening in the overlay; no Voice without voice', /This PC's settings/.test(tx) && ['Keys', 'Camera', 'Mouse', 'Interface'].every((l) => labels(t).includes(l)) && !labels(t).includes('Voice'), labels(t));
  check('drawing it hands nothing to the browser', !msgs(t, 'dbo:journalTab').length);
  press(t, 'Camera');
  const m = last(t, 'dbo:journalTab');
  check('Camera opens the browser journal at Camera', m && m.args[0] === 'n1' && m.args[1] === 'settings' && focusOf(m) === '{"section":"camera"}' && m.args[3] === 'browser', m);
  press(t, 'Keys');
  check('Keys is the overlay\'s General section', focusOf(last(t, 'dbo:journalTab')) === '{"section":"general"}');
}

// ---- the report ----
{
  const t = S.boot('dbo_journal');
  t.push(hub({}));
  press(t, 'Report...');
  check('Report... opens the report: a page of lines, 500 at most, Send greyed', /Report a problem/.test(texts(t)) && seek(t, 'Send the report').disabled === true);
  field(t, 'What went wrong').onRelease();
  check('...the box is several lines holding 500', boxOf(t).multiline === true && boxOf(t).maxChars === 500);
  boxOf(t).text = '  ab  \r '; press(t, 'Done');
  check('fewer than five letters, spaces aside, keeps Send greyed', seek(t, 'Send the report').disabled === true);
  typeIn(t, 'What went wrong', 'the wolf\ris floating');
  check('...five or more and it can go', seek(t, 'Send the report').disabled !== true);
  press(t, 'Send the report');
  const r = last(t, 'dbo:journalReport');
  check('Send sends journalReport with the nonce and the words, the line kept', r && r.args.join('|') === 'n1|the wolf\nis floating', r);
  check('...and waits for the answer', P(t).foot.result.text === '...');
  t.push(hub({}, { nonce: 'n2', result: 'Thanks, the report is with staff.', resultKind: 'ok' }));
  check('the answer lands in the footer', P(t).foot.result.text === 'Thanks, the report is with staff.');
  const ro = S.boot('dbo_journal');
  ro.push(hub({}, { readOnly: 1 }));
  check('a journal read by another cannot report', seek(ro, 'Report...').disabled === true);
}

// ---- a link to one section ----
{
  const t = S.boot('dbo_journal');
  t.push(hub({ voiceOn: true, focusPeer: '1a', nearby: [{ identity: '9', name: 'Bjorn' }, { identity: '1a', name: 'Aria', meters: 4 }] }));
  check('X\'s Voice settings for a player: offered first, by name', texts(t).indexOf('Voice for Aria') >= 0 && texts(t).indexOf('Voice for Aria') < texts(t).indexOf('Help'), texts(t));
  check('...and Voice is among this PC\'s settings', labels(t).includes('Voice'));
  press(t, 'Open');
  check('Open hands the browser journal Voice on that player', focusOf(last(t, 'dbo:journalTab')) === '{"section":"voice","peer":"1a"}' && last(t, 'dbo:journalTab').args[3] === 'browser', last(t, 'dbo:journalTab'));
  const nv = S.boot('dbo_journal');
  nv.push(hub({ voiceOn: false, focusPeer: '1a', nearby: [{ identity: '1a', name: 'Aria' }] }));
  check('no voice, no Voice link', !/Voice for/.test(everyPage(nv)) && !labels(nv).includes('Open'));
  const nvs = S.boot('dbo_journal');
  nvs.push(hub({ voiceOn: false, focusPeer: '1a', section: 'camera' }));
  check('...but the section asked for still is', labels(nvs).includes('Open') && !/Voice for/.test(everyPage(nvs)));
  const sv = S.boot('dbo_journal');
  sv.push(hub({ voiceOn: false, section: 'voice' }));
  check('a link to Voice without voice offers nothing', !labels(sv).includes('Open'));
  const sm = S.boot('dbo_journal');
  sm.push(hub({ section: 'mouse' }));
  check('a link to Mouse is offered first', /^Mouse\|/.test(texts(sm)) || texts(sm).indexOf('Mouse') < texts(sm).indexOf('Help'), texts(sm));
  press(sm, 'Open');
  check('...and opens it', focusOf(last(sm, 'dbo:journalTab')) === '{"section":"mouse"}');
  const hp = S.boot('dbo_journal');
  hp.push(hub({ section: 'help' }));
  check('a link to a native section opens nothing', !labels(hp).includes('Open'));
}

T.done();
