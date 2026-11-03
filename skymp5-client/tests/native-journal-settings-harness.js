// The Character Journal's Settings tab drawn natively (swf/dbo_journal tabs/settings.as), against the browser's SettingsTab:
// Help's problem report (journalReport with the journal nonce, five letters at least, 500 at most), the words of Controls
// and Repairs, and this PC's settings (Interface, Keys, Camera, Mouse, Voice) drawn in place from the client's answer
// (settingsNativeService, _root.dboLocal), each control sending the set:* key the client applies; a client that never
// answers leaves the browser journal's section as the way in; a link to one section (X's "Voice settings for <name>")
// opens it.
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
// Back to the first page by the footer's Previous, as the mouse does (a key capture takes PageUp)
const first = (t) => { for (let i = 0; i < 8; i++) { const p = P(t).foot.prev; if (!p || p.disabled || !p._visible) break; p.onRelease(); } };
const seek = (t, label, test) => { const ok = (b) => (test ? test(b) : b.label.text === label); let b = buttonsOf(t).find(ok); if (b) return b; first(t); for (let i = 0; i < 8 && !(b = buttonsOf(t).find(ok)); i++) { const n = P(t).foot.next; if (!n || n.disabled) break; n.onRelease(); } return b; };
const press = (t, label) => { const b = seek(t, label); if (!b) throw new Error('no button ' + label + ' among ' + buttonsOf(t).map((x) => x.label.text).join('|')); b.onRelease(); };
const everyPage = (t) => { first(t); const out = []; for (let i = 0; i < 8; i++) { out.push(texts(t)); const n = P(t).foot.next; if (!n || n.disabled) break; n.onRelease(); } return out.join('|'); };
const labels = (t) => { first(t); const out = []; for (let i = 0; i < 8; i++) { out.push(...buttonsOf(t).map((b) => b.label.text)); const n = P(t).foot.next; if (!n || n.disabled) break; n.onRelease(); } return out; };
const boxOf = (t) => { let f = null; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.type === 'input') f = k; if (k.kids) walk(k); } }; walk(shownPage(t)); return f; };
const field = (t, label) => seek(t, null, (b) => b.label.text === 'Type...' && b._parent.label && b._parent.label.text.indexOf(label) === 0);
const typeIn = (t, label, text) => { const r = field(t, label); if (!r) throw new Error('no field ' + label); r.onRelease(); boxOf(t).text = text; press(t, 'Done'); };
const focusOf = (m) => JSON.stringify(m.args[2]);
// A button on the entry whose text starts with prefix (a stepper's -1 or +5, a key row's Change)
const onEntry = (t, prefix, label) => seek(t, null, (b) => b.label.text === label && b._parent.label && String(b._parent.label.text).indexOf(prefix) === 0);
const pressOn = (t, prefix, label) => { const b = onEntry(t, prefix, label); if (!b) throw new Error('no ' + label + ' on ' + prefix); b.onRelease(); return b; };
const entryText = (t, prefix) => { const b = seek(t, null, (x) => x._parent.label && String(x._parent.label.text).indexOf(prefix) === 0); return b ? b._parent.label.text : ''; };
const local = (t, snap) => t.root.dboLocal(JSON.stringify(snap));
const sent = (t, key) => { const m = last(t, key); return m ? JSON.stringify(m.args) : ''; };

// What the client answers (settingsNativeService push)
const KEYS = { chatKeyCode: 20, freeCursorKeyCode: 66, housingMenuKeyCode: 45, playerActionKeyCode: 45, personalMenuKeyCode: 22, factionMenuKeyCode: 61,
  masteryMenuKeyCode: 37, emoteWheelKeyCode: 48, decorMenuKeyCode: 34, nametagKeyCode: 59, hideUiKeyCode: 60, hideChatKeyCode: 0,
  voicePushToTalkKeyCode: 47, voiceModeKeyCode: 56, maskToggleKeyCode: 35, adminMenuKeyCode: 65,
  warbandFollowKeyCode: 79, warbandHoldKeyCode: 80, warbandAttackKeyCode: 81, warbandNearestKeyCode: 75 };
const NAMES = { 20: 'T', 66: 'F8', 45: 'X', 22: 'U', 61: 'F3', 37: 'K', 48: 'B', 34: 'G', 59: 'F1', 60: 'F2', 47: 'V', 56: 'Left Alt', 35: 'H', 65: 'F7', 79: 'Num 1', 80: 'Num 2', 81: 'Num 3', 75: 'Num 4', 259: 'Mouse 4' };
const SNAP = (o) => Object.assign({
  file: true, ui: { vitals: 'fade', vitalsStyle: 'quiet', vitalsFadeSeconds: 5, chat: 'fade', chatLettering: 'book' },
  chat: { fontSize: 16, chatTransparency: 25, fadeSeconds: 10, hidePlayerNames: false, showFormIds: true, customHighlights: '' },
  mouse: false, fov: { value: 85, launcher: 80, min: 50, max: 140 }, keys: { live: Object.assign({}, KEYS), next: Object.assign({}, KEYS), names: NAMES },
  capture: '', note: '', panelsReset: false, scale: { override: 0, auto: 1, launcher: 0 }, voice: null,
}, o || {});
const open = (section, settings, snap) => { const t = S.boot('dbo_journal'); t.push(hub(settings || {})); press(t, section); if (snap !== null) local(t, snap || SNAP()); return t; };

{
  const t = S.boot('dbo_journal');
  t.push(hub({ staff: false }));
  const tx = everyPage(t);
  check('Settings: Help with the report and the launcher\'s repairs', /Help/.test(tx) && /Report a problem/.test(tx) && /Repairing the game files, opening the log folder and resetting every setting are done from the launcher/.test(tx), tx);
  check('...Controls: the game\'s keys are the launcher\'s, read once at start', /Activate, Jump, Sprint, Sneak, Shout, Toggle POV and Invert Y/.test(tx) && /Change these in the launcher \(Settings\), then restart the game\./.test(tx));
  check('...this PC\'s settings, kept on this PC; no Voice without voice', /This PC's settings/.test(tx) && /kept on this PC/.test(tx) && ['Keys', 'Camera', 'Mouse', 'Interface'].every((l) => labels(t).includes(l)) && !labels(t).includes('Voice'), labels(t));
  check('drawing it hands nothing to the browser and asks the client nothing', !msgs(t, 'dbo:journalTab').length && !msgs(t, 'set:get').length);
  press(t, 'Camera');
  check('Camera opens in place: it asks the client, and never the browser journal', sent(t, 'set:get') === '[[]]' && !msgs(t, 'dbo:journalTab').length, t.msgs());
  check('...a Back button and its heading, while the client is asked', labels(t).includes('Back to Settings') && /Camera/.test(texts(t)) && /Reading this PC's settings/.test(texts(t)), texts(t));
  t.st.time += 3001; t.tick();
  check('no answer in 3 s (an older client): it says so, and offers the overlay', /This game cannot show these settings here yet/.test(texts(t)) && labels(t).includes('Open'), texts(t));
  press(t, 'Open');
  const m = last(t, 'dbo:journalTab');
  check('...Open opens the browser journal at Camera, as before', m && m.args[0] === 'n1' && m.args[1] === 'settings' && focusOf(m) === '{"section":"camera"}' && m.args[3] === 'browser', m);
  press(t, 'Back to Settings');
  check('Back to Settings is the overview again', /This PC's settings/.test(everyPage(t)));
  press(t, 'Keys');
  local(t, SNAP());
  t.press(27);
  check('Escape in a section backs out to the overview, the journal stays open', /This PC's settings/.test(everyPage(t)) && !msgs(t, 'dbo:journalClose').length);
  t.press(27);
  check('...and Escape on the overview closes the journal', msgs(t, 'dbo:journalClose').length === 1);
}

// ---- Interface ----
{
  const t = open('Interface');
  const tx = everyPage(t);
  check('Interface: the browser\'s groups and rows', ['Size', 'Interface size', 'Panel sizes', 'Health, magicka and stamina', 'Show the bars', 'Fade after', 'Style', 'Chat', 'Show the chat', 'Fade delay', 'Lettering', 'Names over heads', 'Player names', 'Form ids'].every((w) => tx.includes(w)), tx);
  check('...the chosen chip is lit: Fade when full, Quiet, Book, Auto', ['Fade when full', 'Quiet', 'Book', 'Auto'].every((l) => seek(t, l).on === true) && seek(t, 'Classic').on === false);
  press(t, 'Fade when full');
  check('...pressing the chosen chip sends nothing', !msgs(t, 'set:ui').length);
  press(t, 'Hidden');
  check('Show the bars: Hidden', sent(t, 'set:ui') === '[{"vitals":"hidden"}]', sent(t, 'set:ui'));
  press(t, '10 s');
  check('Fade after: 10 s', sent(t, 'set:ui') === '[{"vitalsFadeSeconds":10}]');
  press(t, 'Classic');
  check('Style: Classic', sent(t, 'set:ui') === '[{"vitalsStyle":"classic"}]');
  press(t, 'Hidden until T');
  check('Show the chat: Hidden until T', sent(t, 'set:ui') === '[{"chat":"hidden"}]');
  press(t, 'Never');
  check('Fade delay: Never is 0, a chat value', sent(t, 'set:chat') === '[{"fadeSeconds":0}]');
  press(t, 'Plain');
  check('Lettering: Plain', sent(t, 'set:ui') === '[{"chatLettering":"plain"}]');
  check('Text size 16 px with -1 and +1', /^Text size:  16 px/.test(entryText(t, 'Text size')));
  pressOn(t, 'Text size', '+1');
  check('...+1 sends 17', sent(t, 'set:chat') === '[{"fontSize":17}]');
  pressOn(t, 'Transparency', '-5');
  check('Transparency -5 sends 20', sent(t, 'set:chat') === '[{"chatTransparency":20}]');
  press(t, '150%');
  check('Interface size 150%', sent(t, 'set:scale') === '[1.5]');
  // Nat, 3 Nov: the game's own panels on or off, and their size
  check('Game menus: Native menus and Menu size are offered', /Native menus/.test(everyPage(t)) && /Menu size/.test(everyPage(t)));
  press(t, 'Off');
  check('...Off sends nativeMenus off', sent(t, 'set:ui') === '[{"nativeMenus":"off"}]', sent(t, 'set:ui'));
  press(t, '70%');
  check('...70% sends nativeScale 0.7', sent(t, 'set:ui') === '[{"nativeScale":0.7}]', sent(t, 'set:ui'));
  press(t, 'Reset every panel\'s size');
  check('Reset every panel\'s size', msgs(t, 'set:panelReset').length === 1);
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

// ---- Interface: the rows whose chips repeat, the typed highlights, the edges ----
{
  const t = open('Interface', {}, SNAP({ chat: { fontSize: 22, chatTransparency: 0, fadeSeconds: 10, hidePlayerNames: false, showFormIds: true, customHighlights: 'gold' }, scale: { override: 1.3, auto: 1, launcher: 0 }, panelsReset: true }));
  const all = (label) => { first(t); const out = []; for (let i = 0; i < 8; i++) { out.push(...buttonsOf(t).filter((b) => b.label.text === label)); const n = P(t).foot.next; if (!n || n.disabled) break; n.onRelease(); } return out; };
  const hidden = all('Hidden');
  check('three rows offer Hidden: the bars, player names, form ids', hidden.length === 3, hidden.length);
  hidden[1].onRelease();
  check('Player names: Hidden', sent(t, 'set:chat') === '[{"hidePlayerNames":true}]', sent(t, 'set:chat'));
  all('Hidden')[2].onRelease();
  check('Form ids: Hidden', sent(t, 'set:chat') === '[{"showFormIds":false}]', sent(t, 'set:chat'));
  check('a size the launcher set off the list is shown and lit (130%)', seek(t, '130%') && seek(t, '130%').on === true);
  check('at 22 px +1 is greyed, at 0% -5 is', onEntry(t, 'Text size', '+1').disabled === true && onEntry(t, 'Transparency', '-5').disabled === true);
  check('the panels once reset say so and wait', seek(t, 'Every panel is back to its size') && seek(t, 'Every panel is back to its size').disabled === true);
  check('the highlight words are shown', /^Highlight words:  gold/.test(entryText(t, 'Highlight words')));
  pressOn(t, 'Highlight words', 'Change...');
  typeIn(t, 'Words', 'gold, trad*');
  press(t, 'Save');
  check('Change... types them in place and Save sends them', sent(t, 'set:chat') === '[{"customHighlights":"gold, trad*"}]', sent(t, 'set:chat'));
  check('...back on the Interface page', /Highlight words/.test(everyPage(t)));
  const nf = open('Interface', {}, SNAP({ file: false }));
  check('a settings file the client could not read: nothing offered to change', /could not be read/.test(everyPage(nf)) && !labels(nf).includes('Always'));
  const ns = open('Interface', {}, SNAP({ scale: null }));
  check('no interface size from the page: the row is left out', !/Interface size/.test(everyPage(ns)) && /Show the bars/.test(everyPage(ns)));
}

// ---- Keys ----
{
  const t = open('Keys');
  const tx = everyPage(t);
  check('Keys: Menus and View and voice, each key by name', /Menus/.test(tx) && /View and voice/.test(tx) && /Activate chat:  T/.test(tx) && /Journal:  F3/.test(tx) && /Push to talk:  V/.test(tx) && /Hide chat:  None/.test(tx), tx);
  check('...no staff rows for a player', !/Admin panel/.test(tx) && !/Warband/.test(tx));
  pressOn(t, 'Journal', 'Change');
  check('Change asks the client to capture the next key for that row', sent(t, 'set:keyCapture') === '["journal",["factionMenuKeyCode"],false]', sent(t, 'set:keyCapture'));
  pressOn(t, 'Interact', 'Change');
  check('...Interact sets both its settings', sent(t, 'set:keyCapture') === '["interact",["housingMenuKeyCode","playerActionKeyCode"],false]');
  pressOn(t, 'Hide chat', 'Change');
  check('...an optional row says so (Backspace clears it)', sent(t, 'set:keyCapture') === '["hideChat",["hideChatKeyCode"],true]');
  local(t, SNAP({ capture: 'journal' }));
  check('while it waits the row says so, with Cancel', /^Journal:  press a key or a mouse button/.test(entryText(t, 'Journal')) && onEntry(t, 'Journal', 'Cancel'), entryText(t, 'Journal'));
  const tabsBefore = msgs(t, 'dbo:journalTab').length;
  t.press(81); t.press(39); t.press(40);
  check('...the keys pressed go to the capture, not to the journal (Q, Right, Down do nothing)', msgs(t, 'dbo:journalTab').length === tabsBefore && /^Journal:  press/.test(entryText(t, 'Journal')));
  t.press(27);
  check('...Escape cancels the capture and stays on Keys', sent(t, 'set:keyCancel') === '[]' && !msgs(t, 'dbo:journalClose').length && /Journal:/.test(everyPage(t)));
  pressOn(t, 'Journal', 'Cancel');
  check('...Cancel on the row cancels too', msgs(t, 'set:keyCancel').length === 2);
  const next = Object.assign({}, KEYS, { factionMenuKeyCode: 37, emoteWheelKeyCode: 259 });
  local(t, SNAP({ keys: { live: KEYS, next, names: NAMES } }));
  const k2 = everyPage(t);
  check('a key shared by two rows is marked on both', (k2.match(/Shared with another key\./g) || []).length === 2 && /Journal:  K/.test(k2) && /Skills:  K/.test(k2), k2);
  check('...a changed key waits for the next start, a mouse button by name', /Emote wheel:  Mouse 4/.test(k2) && /From your next start\./.test(k2) && /Saved\. Takes effect when you next start the game\./.test(k2));
  local(t, SNAP({ note: 'Enter is kept for the chat and for closing panels.' }));
  check('the client\'s note is shown', /Enter is kept for the chat/.test(everyPage(t)));
  const st = open('Keys', { staff: true });
  check('staff see the admin and warband keys', /Admin panel:  F7/.test(everyPage(st)) && /Warband: hold:  Num 2/.test(everyPage(st)));
  const nk = open('Keys', {}, SNAP({ keys: null }));
  check('keys the client cannot read: said, nothing to change', /cannot be read/.test(everyPage(nk)) && !labels(nk).includes('Change'));
}

// ---- Camera ----
{
  const t = open('Camera');
  check('Camera: the field of view in degrees, with steps', /^Field of view:  85 degrees/.test(entryText(t, 'Field of view')));
  pressOn(t, 'Field of view', '+5');
  check('+5 sends 90', sent(t, 'set:fov') === '["set",90]');
  pressOn(t, 'Field of view', '-1');
  check('-1 sends 84', sent(t, 'set:fov') === '["set",84]');
  press(t, 'Reset');
  check('Reset puts the launcher\'s value back', sent(t, 'set:fov') === '["reset"]' && /80 degrees, from the launcher's settings/.test(everyPage(t)));
  local(t, SNAP({ fov: { value: 80, launcher: 80, min: 50, max: 140 } }));
  check('at the launcher\'s value: In use, greyed', seek(t, 'In use') && seek(t, 'In use').disabled === true);
  local(t, SNAP({ fov: { value: 140, launcher: null, min: 50, max: 140 } }));
  check('at the most +5 is greyed; no launcher value, no reset', onEntry(t, 'Field of view', '+5').disabled === true && /The launcher has not set one/.test(everyPage(t)) && seek(t, 'Reset').disabled === true);
  local(t, SNAP({ fov: null }));
  check('no camera service: set in the launcher', /Set in the launcher \(Settings\) for this version of the game/.test(everyPage(t)));
}

// ---- Mouse ----
{
  const t = open('Mouse');
  check('Mouse: Stay in the game, lit', /Leave the game window/.test(everyPage(t)) && seek(t, 'Stay in the game').on === true);
  press(t, 'May leave');
  check('May leave sends on', sent(t, 'set:mouse') === '["on"]');
  local(t, SNAP({ mouse: true }));
  press(t, 'Stay in the game');
  check('...Stay in the game sends off', sent(t, 'set:mouse') === '["off"]');
}

// ---- Voice ----
{
  const near = [{ identity: '9', name: 'Bjorn', meters: 12 }, { identity: '1a', name: 'Aria', meters: 4 }];
  const voice = { prefs: { inputLabel: '', outputLabel: 'Headset', micGain: 1, outputVolume: 1.5, activation: 'ptt', vadThreshold: 0.06 },
    devices: { inputs: ['Mic A', 'Mic B'], outputs: ['Speakers'] }, peers: { 9: { gain: 1, muted: false }, '1a': { gain: 0.5, muted: true } } };
  const t = open('Voice', { voiceOn: true, nearby: near }, SNAP({ voice }));
  check('Voice asks the client with the players near', msgs(t, 'set:get').some((m) => JSON.stringify(m.args) === '[["9","1a"]]'));
  const tx = everyPage(t);
  check('Voice: devices, volumes and transmit', /Your voice/.test(tx) && /Microphone/.test(tx) && /Speakers/.test(tx) && /Your voice volume:  100%/.test(tx) && /Other players' volume:  150%/.test(tx) && /Transmit/.test(tx), tx);
  check('...the devices, System default first, the one in use lit (Headset kept though not listed)', seek(t, 'Mic A') && seek(t, 'Headset') && seek(t, 'Headset').on === true && labels(t).filter((l) => l === 'System default').length === 2);
  press(t, 'Mic B');
  check('a microphone', sent(t, 'set:voice') === '[{"inputLabel":"Mic B"}]');
  pressOn(t, 'Your voice volume', '+5');
  check('your volume +5', sent(t, 'set:voice') === '[{"micGain":1.05}]', sent(t, 'set:voice'));
  pressOn(t, 'Other players', '-5');
  check('their volume -5', sent(t, 'set:voice') === '[{"outputVolume":1.45}]', sent(t, 'set:voice'));
  press(t, 'Voice activity');
  check('Transmit: Voice activity', sent(t, 'set:voice') === '[{"activation":"vad"}]');
  check('Players near you, each with a volume, mute and reset', /Bjorn  12 m:  100%/.test(everyPage(t)) && /Aria  4 m:  muted/.test(everyPage(t)));
  pressOn(t, 'Bjorn', '-5');
  check('a player\'s -5', sent(t, 'set:peer') === '["9","set","Bjorn",0.95]', sent(t, 'set:peer'));
  pressOn(t, 'Aria', 'Unmute');
  check('Unmute a muted one', sent(t, 'set:peer') === '["1a","unmute","Aria"]');
  pressOn(t, 'Bjorn', 'Mute');
  check('Mute', sent(t, 'set:peer') === '["9","mute","Bjorn"]');
  check('Reset greyed at 100% unmuted, offered when changed', onEntry(t, 'Bjorn', 'Reset').disabled === true && onEntry(t, 'Aria', 'Reset').disabled !== true);
  check('no meter for push to talk', !msgs(t, 'set:level').length);
  local(t, SNAP({ voice: Object.assign({}, voice, { prefs: Object.assign({}, voice.prefs, { activation: 'vad', vadThreshold: 0.06 }) }) }));
  check('Voice activity: Sensitivity 6.0 and the meter asked for', /Sensitivity:  6\.0/.test(everyPage(t)) && sent(t, 'set:level') === '["on"]', everyPage(t));
  pressOn(t, 'Sensitivity', '+5');
  check('Sensitivity +5', sent(t, 'set:voice') === '[{"vadThreshold":0.065}]', sent(t, 'set:voice'));
  t.root.dboLocalLevel('0.25');
  check('the level fills the meter without drawing the page again', (() => { let bar = null; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k._name === 'bar') bar = k; if (k.kids) walk(k); } }; walk(P(t)); return bar && bar._xscale === 50; })());
  press(t, 'Back to Settings');
  check('leaving Voice stops the meter', sent(t, 'set:level') === '["off"]');
  const nv = open('Voice', { voiceOn: true, nearby: [] }, SNAP({ voice: null }));
  check('voice not running in this game: said', /Voice is not running/.test(everyPage(nv)) && /Nobody/.test(everyPage(nv)) === false);
  const none = open('Voice', { voiceOn: true, nearby: [] }, SNAP({ voice }));
  check('nobody near: said', /Nobody is near enough to hear/.test(everyPage(none)));
}

// ---- a link to one section ----
{
  const t = S.boot('dbo_journal');
  t.push(hub({ voiceOn: true, focusPeer: '1a', nearby: [{ identity: '9', name: 'Bjorn' }, { identity: '1a', name: 'Aria', meters: 4 }] }));
  check('X\'s Voice settings for a player: Voice opens at once, headed by name', /Voice for Aria/.test(texts(t)) && msgs(t, 'set:get').length === 1 && !msgs(t, 'dbo:journalTab').length, texts(t));
  local(t, SNAP({ voice: { prefs: {}, devices: { inputs: [], outputs: [] }, peers: {} } }));
  check('...that player first, marked', /Aria  4 m:  100%/.test(everyPage(t)) && everyPage(t).indexOf('Aria') < everyPage(t).indexOf('Bjorn') && /The voice you asked for/.test(everyPage(t)), everyPage(t));
  press(t, 'Back to Settings');
  check('...Back leaves it, and the same payload does not reopen it', /This PC's settings/.test(everyPage(t)));
  t.push(hub({ voiceOn: true, focusPeer: '1a', nearby: [] }));
  check('...nor the same journal sent again', /This PC's settings/.test(everyPage(t)));
  const nv = S.boot('dbo_journal');
  nv.push(hub({ voiceOn: false, focusPeer: '1a', nearby: [{ identity: '1a', name: 'Aria' }] }));
  check('no voice, no Voice', !/Voice for/.test(everyPage(nv)) && /This PC's settings/.test(everyPage(nv)) && !msgs(nv, 'set:get').length);
  const sm = S.boot('dbo_journal');
  sm.push(hub({ section: 'mouse' }));
  check('a link to Mouse opens it', /Mouse/.test(texts(sm)) && labels(sm).includes('Back to Settings') && msgs(sm, 'set:get').length === 1);
  const sv = S.boot('dbo_journal');
  sv.push(hub({ voiceOn: false, section: 'voice' }));
  check('a link to Voice without voice opens nothing', /This PC's settings/.test(everyPage(sv)) && !msgs(sv, 'set:get').length);
  const hp = S.boot('dbo_journal');
  hp.push(hub({ section: 'help' }));
  check('a link to a section drawn on the overview opens nothing', /This PC's settings/.test(everyPage(hp)) && !msgs(hp, 'set:get').length);
}

T.done();
