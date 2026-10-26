// Scripted test for the Scaleform panel logic (Worker 4, 26 Oct). scaleformMenu.ts has no imports and
// transpiles on its own; the service needs sp, so its wiring is checked in the source, and the SWF is
// checked in swf/dbo_testmenu/scripts/frame_1/DoAction.as. Run from skymp5-client:
//
//   ./node_modules/typescript/bin/tsc src/services/services/scaleformMenu.ts --outDir <tmp> --module commonjs --target es2019
//   node tests/scaleform-menu-harness.js <tmp>/scaleformMenu.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const mod = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'claude-nate-scaleform', 'scaleformMenu.js'));
const M = require(mod);
// PC worktrees are CRLF and a source-grep regex breaks on it
const read = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const SVC = read('src/services/services/scaleformMenuService.ts');
const AS2 = read('swf/dbo_testmenu/scripts/frame_1/DoAction.as');
const XML = read('swf/dbo_testmenu/dbo_testmenu.xml');
const BUILD = read('swf/build-swf.js');
const INDEX = read('src/index.ts');

let failures = 0;
const check = (name, fn, got) => {
  let ok = false, err = null;
  try { ok = typeof fn === 'function' ? fn() : fn; } catch (e) { err = e; }
  const extra = err ? '   threw: ' + err.message : (!ok && got !== undefined ? '   ' + JSON.stringify(got) : '');
  console.log(`${ok && !err ? 'ok  ' : 'FAIL'} ${name}${extra}`);
  if (!ok || err) failures++;
};
const SEP = '\u0001';

// ---- 1. the SKSE constraints, which are not ours to choose -------------------------------------------------------
check('the menu name is the one SKSE hard-codes', M.MENU_NAME === 'CustomMenu');
check('a ready timeout exists, because openCustomMenu is queued and may never arrive', M.READY_TIMEOUT_MS >= 1000);
check('the browser prefix is the one dboRelayService strips, so both paths agree', M.DBO_PREFIX === 'dbo:');

// ---- 2. the wire in, where every other mod in the game also arrives -----------------------------------------------
check('ready is recognised and carries the frame skse appeared on', () => {
  const r = M.parseUiEvent('dboUi', 'ready' + SEP + '[2]', 2);
  return r && r.key === 'ready' && r.frame === 2;
}, M.parseUiEvent('dboUi', 'ready' + SEP + '[2]', 2));
check('a panel message splits into key and args', () => {
  const r = M.parseUiEvent('dboUi', 'dbo:prayer' + SEP + '["n1","picks",17,"v"]', 0);
  return r && r.key === 'dbo:prayer' && r.args.length === 4 && r.args[2] === 17;
}, M.parseUiEvent('dboUi', 'dbo:prayer' + SEP + '["n1","picks",17,"v"]', 0));
check('a key with no args at all is still a message', () => {
  const r = M.parseUiEvent('dboUi', 'close', 0);
  return r && r.key === 'close' && r.args.length === 0;
});
// The one that matters most: on('modEvent') hears the whole game.
for (const other of ['SKICursorToggle', 'SliderChange', 'RaceChanged', 'TrueHUD_Event', 'dboUiX', '']) {
  check(`another mod's event is ignored: "${other}"`,
    () => M.parseUiEvent(other, 'dbo:prayer' + SEP + '[]', 0) === null);
}
check('malformed JSON is refused, not guessed at',
  () => M.parseUiEvent('dboUi', 'dbo:x' + SEP + '{not json', 0) === null);
check('a non-array args payload is wrapped rather than dropped', () => {
  const r = M.parseUiEvent('dboUi', 'dbo:x' + SEP + '{"a":1}', 0);
  return r && r.args.length === 1 && r.args[0].a === 1;
});
check('an empty payload is not a message', () => M.parseUiEvent('dboUi', '', 0) === null);
check('a separator with an empty key is not a message', () => M.parseUiEvent('dboUi', SEP + '[]', 0) === null);
check('a negative or junk frame does not come through', () => {
  const a = M.parseUiEvent('dboUi', 'ready', -5), b = M.parseUiEvent('dboUi', 'ready', NaN);
  return a.frame === 0 && b.frame === 0;
});

// ---- 3. mapping out to the server, which must match the browser exactly -------------------------------------------
check('a dbo: key becomes the server event name, as dboRelayService does with slice(4)',
  M.serverEventName('dbo:prayerStart') === 'prayerStart');
check('ready and close are NOT server events', () => M.serverEventName('ready') === '' && M.serverEventName('close') === '');
check('a key without the prefix is refused rather than sent raw', () => M.serverEventName('prayer') === '');

// ---- 4. the payload in --------------------------------------------------------------------------------------------
check('a payload becomes one JSON string', () => M.payloadJson({ a: 1, b: 'x' }) === '{"a":1,"b":"x"}');
check('undefined becomes null rather than the string "undefined"', M.payloadJson(undefined) === 'null');
check('a circular payload degrades to null instead of throwing', () => {
  const o = { n: 1 }; o.self = o;
  return M.payloadJson(o) === 'null';
});
check('an oversized payload is refused, since strArg and invoke have limits we have not measured',
  () => M.payloadJson({ big: 'x'.repeat(M.MAX_PAYLOAD_CHARS) }) === 'null');

// ---- 5. the open sequence: nothing may be invoked before the SWF says it is up -------------------------------------
let s = M.newState();
let acts = M.planOpen(s, 'dbo_prayer', { widget: 35, mode: 'pick' }, 35, 1000);
check('opening asks for the menu and pushes NOTHING yet',
  () => acts.length === 1 && acts[0].do === 'open' && acts[0].swf === 'dbo_prayer', acts);
check('...and remembers the widget id for the trip back', s.widgetId === 35);
// The 05:02 session: everything worked and the payload was the string "null", silently.
check('a MISSING payload is reported before the open, not pushed silently', () => {
  const t = M.newState();
  const r = M.planOpen(t, 'dbo_prayer', undefined, 35, 1000);
  return r.length === 2 && r[0].do === 'report' && /sent no payload/.test(r[0].text) && r[1].do === 'open';
}, M.planOpen(M.newState(), 'dbo_prayer', undefined, 35, 1000));
check('...and so is an empty object, which is what a wrong packet shape looks like', () => {
  const t = M.newState();
  return M.planOpen(t, 'x', {}, 0, 0)[0].do === 'report';
});
check('a real payload is NOT reported', () => {
  const t = M.newState();
  const r = M.planOpen(t, 'x', { mode: 'pick' }, 1, 0);
  return r.length === 1 && r[0].do === 'open';
});
check('an empty re-send while open is reported too', () => {
  const t = M.newState(); M.planOpen(t, 'x', { a: 1 }, 1, 0); M.planReady(t, 1, 10);
  const r = M.planOpen(t, 'x', null, 1, 20);
  return r.length === 2 && r[0].do === 'report' && /re-sent an empty payload/.test(r[0].text);
});
check('a tick before the timeout does nothing', M.planTick(s, 1000 + M.READY_TIMEOUT_MS - 1).length === 0);
acts = M.planReady(s, 2, 1400);
check('ready pushes the payload that was waiting',
  () => acts.length === 1 && acts[0].do === 'push' && JSON.parse(acts[0].json).mode === 'pick', acts);
check('...and records the round trip and the frame', s.readyAt - s.openedAt === 400 && s.readyFrame === 2);
acts = M.planOpen(s, 'dbo_prayer', { mode: 'pick', verdict: 1 }, 35, 2000);
check('a re-send while open replaces the payload instead of reopening (only one custom menu exists)',
  () => acts.length === 1 && acts[0].do === 'push' && JSON.parse(acts[0].json).verdict === 1, acts);
acts = M.planClose(s);
check('closing closes once', () => acts.length === 1 && acts[0].do === 'close' && s.phase === 'closed');
check('closing again does nothing', M.planClose(s).length === 0);

// The failure this exists to detect, and the one that saved Nat on 26 Oct.
s = M.newState();
M.planOpen(s, 'dbo_testmenu', {}, 0, 5000);
acts = M.planTick(s, 5000 + M.READY_TIMEOUT_MS + 1);
check('an open that never reports ready is REPORTED and CLOSED, not left on screen',
  () => acts.length === 2 && acts[0].do === 'report' && /never reported ready/.test(acts[0].text) && acts[1].do === 'close', acts);
check('...and the state goes back to closed so a retry is possible', s.phase === 'closed');
check('ready arriving after a close is ignored', () => M.planReady(M.newState(), 1, 1).length === 0);
// The live line said "ready on frame 0" whenever the outbox won, which the SWF can never produce.
check('a ready that arrived by MOD EVENT reports its numArg frame',
  M.readyFrameOf({ key: 'ready', args: [], frame: 2, seq: 0 }) === 2);
check('a ready that arrived by OUTBOX reports the frame from its args, not 0',
  M.readyFrameOf({ key: 'ready', args: [1], frame: 0, seq: 7 }) === 1);
check('...and a string arg works too, since JSON from AS2 may quote it',
  M.readyFrameOf({ key: 'ready', args: ['3'], frame: 0, seq: 7 }) === 3);
check('no frame anywhere stays 0 rather than inventing one',
  M.readyFrameOf({ key: 'ready', args: [], frame: 0, seq: 7 }) === 0
  && M.readyFrameOf({ key: 'ready', args: ['x'], frame: 0, seq: 7 }) === 0);
check('numArg wins when both are present, because that is the channel that measured it',
  M.readyFrameOf({ key: 'ready', args: [9], frame: 2, seq: 0 }) === 2);

check('the summary says whether it ever became ready', () => /never became ready/.test(M.summary(s)), M.summary(s));
check('...and names the frame when it did', () => {
  const t = M.newState(); M.planOpen(t, 'x', {}, 1, 0); M.planReady(t, 3, 50); t.sent = 2; t.foreignEvents = 7;
  const line = M.summary(t);
  return /50ms to ready on frame 3/.test(line) && /sent=2/.test(line) && /ignored 7 mod events/.test(line);
}, (() => { const t = M.newState(); M.planOpen(t, 'x', {}, 1, 0); M.planReady(t, 3, 50); t.sent = 2; t.foreignEvents = 7; return M.summary(t); })());

// ---- 5b. the polled outbox, the channel that does not depend on modEvent ------------------------------------------
const RS = '\u001e', US = '\u001f';
const rec = (seq, key, json) => seq + US + key + US + (json || '') + RS;

let box = M.parseOutbox(rec(1, 'ready', '[1]') + rec(2, 'dbo:testRow', '[0]'), 0);
check('a full outbox parses into messages in order',
  () => box.messages.length === 2 && box.messages[0].key === 'ready' && box.messages[1].key === 'dbo:testRow',
  box.messages);
check('...each carrying its sequence', () => box.messages[0].seq === 1 && box.messages[1].seq === 2);
check('...and the cursor lands at the end', box.consumed === rec(1, 'ready', '[1]').length + rec(2, 'dbo:testRow', '[0]').length);

const partial = rec(1, 'ready', '[1]') + '2' + US + 'dbo:half';
box = M.parseOutbox(partial, 0);
check('a half-written record is LEFT for the next read, not parsed',
  () => box.messages.length === 1 && box.consumed === rec(1, 'ready', '[1]').length, box);
check('...and is picked up once it completes', () => {
  const full = partial + US + '[7]' + RS;
  const b2 = M.parseOutbox(full, box.consumed);
  return b2.messages.length === 1 && b2.messages[0].key === 'dbo:half' && b2.messages[0].args[0] === 7;
});
check('nothing new means nothing re-read', () => {
  const all = rec(1, 'a', '[]');
  const b = M.parseOutbox(all, all.length);
  return b.messages.length === 0 && b.consumed === all.length;
});
check('a record with bad JSON is skipped, not fatal', () => {
  const b = M.parseOutbox(rec(1, 'dbo:x', '{bad') + rec(2, 'dbo:y', '[]'), 0);
  return b.messages.length === 1 && b.messages[0].key === 'dbo:y';
});
// The contract the SWF side must hold up (Worker 1's lib escapes every character below 32): a RAW record
// separator inside the JSON would split the record and lose the tail. Encoded here so it is a tested
// assumption rather than a conversation.
check('an ESCAPED separator inside the payload survives the trip', () => {
  const b = M.parseOutbox(rec(1, 'dbo:x', JSON.stringify(['a\u001eb'])), 0);
  return b.messages.length === 1 && b.messages[0].args[0] === 'a\u001eb';
}, M.parseOutbox(rec(1, 'dbo:x', JSON.stringify(['a\u001eb'])), 0).messages);
check('...while a RAW one truncates that record rather than corrupting the next', () => {
  const b = M.parseOutbox(rec(1, 'dbo:x', '["a' + RS + 'b"]') + rec(2, 'dbo:y', '[]'), 0);
  // the first record is unparseable JSON and skipped; the LAST one still arrives intact
  return b.messages.length >= 1 && b.messages[b.messages.length - 1].key === 'dbo:y';
});
check('a missing or empty outbox is survivable',
  () => M.parseOutbox(undefined, 0).messages.length === 0 && M.parseOutbox('', 5).messages.length === 0);

// The whole point of two channels: handle a message once.
let st = M.newState();
M.planOpen(st, 'x', {}, 1, 0);
const viaBox = { key: 'ready', args: [], frame: 0, seq: 1 };
check('the first delivery is new', M.isNew(st, viaBox) === true);
check('...and the same sequence arriving again is not', M.isNew(st, { key: 'ready', args: [], frame: 0, seq: 1 }) === false);
check('...nor is an older one', M.isNew(st, { key: 'ready', args: [], frame: 0, seq: 0.5 }) === false);
check('a mod event copy after the outbox has delivered is dropped',
  M.isNew(st, { key: 'ready', args: [], frame: 2, seq: 0 }) === false);
check('but a mod event is accepted when the outbox has delivered nothing', () => {
  const t = M.newState(); M.planOpen(t, 'x', {}, 1, 0);
  return M.isNew(t, { key: 'ready', args: [], frame: 2, seq: 0 }) === true;
});
check('the cursor resets on a new open, so a second panel does not skip its own messages', () => {
  const t = M.newState(); M.planOpen(t, 'x', {}, 1, 0); t.outRead = 500; t.lastSeq = 9;
  M.planClose(t); M.planOpen(t, 'x', {}, 1, 10);
  return t.outRead === 0 && t.lastSeq === 0;
});
check('the summary says which channel delivered, so one session settles it', () => {
  const t = M.newState(); M.planOpen(t, 'x', {}, 1, 0); M.planReady(t, 1, 10);
  t.viaOutbox = 3; t.viaModEvent = 0;
  return /in=3outbox\/0modevent/.test(M.summary(t));
}, (() => { const t = M.newState(); M.planOpen(t, 'x', {}, 1, 0); M.planReady(t, 1, 10); t.viaOutbox = 3; return M.summary(t); })());

// ---- 6. the service wiring ----------------------------------------------------------------------------------------
check('data goes in as ONE invokeString of the whole payload', /invokeString\(MENU_NAME, "_root\.dboData", a\.json\)/.test(SVC));
check('a panel message goes out as the SAME packet the browser widgets send',
  /customPacketType: "dbo", event: r\.event, args: withClientUiCaps\(r\.event, r\.args\),\s*widget: this\.state\.widgetId/.test(SVC));
// The service used to carry its own copy of the dbo: rule. It now shares nativeWidgets.replayFor with the
// relay-routed panels, so an unknown key is judged by that one table (and tested in
// native-widgets-harness.js) rather than here. What this file still has to see is that the service routes
// through it, and that the report branch says something out loud.
check('key decisions come from the one shared table, not a private copy',
  /for \(const r of replayFor\(parsed\.key, parsed\.args, !!this\.owner\)\) this\.replay\(r\);/.test(SVC)
  && !/serverEventName/.test(SVC));
check('an unknown key is logged, not forwarded raw', /logTrace\(this, "Scaleform panel", r\.text\)/.test(SVC));
check('the service opens with flags 0, which SKSE ignores anyway', /openCustomMenu\(a\.swf, 0\)/.test(SVC));
// The 26 Oct 03:26 failure: natives are only callable inside OnUpdate.
check('the packet handler ENQUEUES and never calls a native itself',
  /this\.enqueue\(planClose/.test(SVC) && /this\.enqueue\(planOpen\(/.test(SVC)
  && !/onCustomPacketMessage[\s\S]{0,400}?this\.(exec|sp\.Ui)/.test(SVC));
check('the mod event handler enqueues too, so there is one code path', /this\.enqueue\(planReady\(/.test(SVC));
check('exec is reachable ONLY from onUpdate', () => {
  const up = SVC.indexOf('private onUpdate()');
  const next = SVC.indexOf('private enqueue(', up);
  if (up < 0 || next < 0) return false;
  let found = 0, m;
  const re = /this\.exec\(/g;
  while ((m = re.exec(SVC)) !== null) { found++; if (m.index < up || m.index > next) return false; }
  return found === 2;
});
// Order, not proximity: a distance-based regex here broke the moment an unrelated line was added between
// the two, while the invariant it guards was perfectly intact.
check('the queue is drained BEFORE the closed-phase early return, or a close would never run', () => {
  const up = SVC.indexOf('private onUpdate()');
  const drain = SVC.indexOf('this.exec(q);', up);
  const early = SVC.indexOf('if (this.state.phase === "closed") return;', up);
  return up >= 0 && drain > up && early > drain;
});
check('the reason is written down next to it, not just fixed',
  /g_nativeCallRequirements\.vm only inside OnUpdate/.test(SVC));
check('the frame skse appeared on is logged, since that number was unknown', /ready on frame/.test(SVC));
check('a failed action is reported rather than swallowed', /logError\(this, `Scaleform action '\$\{a\.do\}' failed`/.test(SVC));
// The fallback switch: the server gates on what we announce, so withholding a cap puts CEF back with no
// rebuild. Absent must mean "all", or an existing settings file silently turns the panels off.
// Counted against NATIVE_CAPS rather than against a hardcoded 2: these all failed the moment the journal's
// fifteen tabs and Worker 2's three panels were added, which is a test breaking on a number rather than on
// the behaviour it is supposed to be watching.
const ALL = M.NATIVE_CAPS.length;
check('an absent setting announces every panel, so no settings file is needed',
  () => M.capsFor(undefined).length === ALL && M.capsFor(null).length === ALL && M.capsFor(true).length === ALL);
check('false announces none, which is the whole-panel CEF fallback', M.capsFor(false).length === 0);
check('one panel can be turned off without the others', () => {
  const c = M.capsFor({ decor: false });
  return c.length === ALL - 1 && c.indexOf('native:decor') < 0 && c.indexOf('native:prayer') >= 0;
}, M.capsFor({ decor: false }));
check('...and the other way round', () => {
  const c = M.capsFor({ prayer: false });
  return c.length === ALL - 1 && c.indexOf('native:prayer') < 0 && c.indexOf('native:decor') >= 0;
});
check('an unrelated key does not turn anything off', M.capsFor({ nonsense: false }).length === ALL);
check('a junk setting falls back to announcing all rather than nothing',
  () => M.capsFor('yes').length === ALL && M.capsFor(7).length === ALL);

// The journal switches surfaces per tab, so each tab is its own cap; turning the journal off has to take its
// tabs with it, or the server is told about fifteen tabs of a shell that is on the browser.
check('every journal tab has its own cap', () => M.JOURNAL_TABS.length === 15
  && M.JOURNAL_TABS.every((t) => M.NATIVE_CAPS.indexOf(`native:journalTab:${t}`) >= 0), M.JOURNAL_TABS);
check('one journal tab can be turned off on its own', () => {
  const c = M.capsFor({ 'journalTab:notes': false });
  return c.length === ALL - 1 && c.indexOf('native:journalTab:notes') < 0
    && c.indexOf('native:journalTab:court') >= 0 && c.indexOf('native:journal') >= 0;
}, M.capsFor({ 'journalTab:notes': false }).length);
check('turning the journal off takes all fifteen tabs with it', () => {
  const c = M.capsFor({ journal: false });
  return c.length === ALL - 16 && !c.some((x) => x.indexOf('native:journal') === 0);
}, M.capsFor({ journal: false }).filter((x) => x.indexOf('native:journal') === 0));
check('...and it leaves the unrelated panels alone',
  () => M.capsFor({ journal: false }).indexOf('native:prayer') >= 0);
// A parent switch must only govern its own children. Turning off a panel that owns no compound caps cannot
// take anyone else's tabs with it.
check('a switch for one panel never takes another panel\'s tabs with it', () => {
  const c = M.capsFor({ prayer: false });
  return M.JOURNAL_TABS.every((t) => c.indexOf(`native:journalTab:${t}`) >= 0);
}, M.capsFor({ prayer: false }).filter((x) => x.indexOf('native:journalTab:') === 0).length);

check('the caps the server gates on are declared, for every panel the workers built', () => {
  const want = ['native:prayer', 'native:decor', 'native:journal',
    'native:deityPicker', 'native:rite', 'native:dungeonGate', 'native:labour', 'native:pigeon'];
  return want.every((c) => M.NATIVE_CAPS.indexOf(c) >= 0);
}, M.NATIVE_CAPS);
check('no cap is announced twice, which would make the server gate on a duplicate',
  () => new Set(M.NATIVE_CAPS).size === M.NATIVE_CAPS.length);
check('they are announced on connect, as their own event so the browser uiCaps is not replaced',
  /connectionAccepted", \(\) => this\.announce/.test(SVC) && /event: "nativeCaps"/.test(SVC));
check('...and announced once more, because a late cap is invisible rather than an error',
  /this\.announces === 1 && this\.announcedAt/.test(SVC) && M.CAPS_RETRY_MS >= 1000);
check('the service is registered', /ScaleformMenuService/.test(INDEX));

// ---- 7. the SWF, which the client cannot be tested without ----------------------------------------------------------
// MEASURED 26 Oct: _global.skse does not exist on frame 1. Every panel must wait for it.
check('the SWF does NOT call skse from frame 1: it polls for it',
  /onEnterFrame/.test(AS2) && /haveSkse\(\)/.test(AS2) && /dboBoot/.test(AS2));
check('...and stops polling once it appears', /delete this\.onEnterFrame/.test(AS2));
check('...and reports the frame it appeared on, which is the number nobody had', /skse appeared on frame/.test(AS2));
check('...and says so on screen if it never appears, rather than sitting silent', /no skse bridge after/.test(AS2));
// The gap that nearly shipped: the service and the SWF are two halves of one wire, and nothing bound them.
check('the SWF implements the function the service invokes', /_root\.dboData = function/.test(AS2)
  && /invokeString\(MENU_NAME, "_root\.dboData"/.test(SVC));
check('the SWF sends under the event name the service listens for', /DBO_EVENT = "dboUi"/.test(AS2)
  && /DBO_UI_EVENT = "dboUi"/.test(read('src/services/services/scaleformMenu.ts')));
check('the SWF uses the same key separator the parser splits on', /DBO_SEP = "\u0001"/.test(AS2));
check('a row click uses the dbo: prefix the server mapping requires', /send\("dbo:testRow"/.test(AS2));
check('the SWF writes the outbox the service reads', /_root\.dboOut \+=/.test(AS2) && /OUT_VAR = "_root\.dboOut"/.test(read('src/services/services/scaleformMenu.ts')));
check('...and both halves use the same record separators', /DBO_RS = "\u001e"/.test(AS2) && /DBO_US = "\u001f"/.test(AS2));
check('every message is numbered, so two channels cannot double-handle it', /dboSeq\+\+/.test(AS2));
check('the skse bridge is never assumed anywhere', /function haveSkse\(\)/.test(AS2));
check('the font is a $-name resolved from the player\'s own gfxfontlib, with nothing shipped',
  /\$EverywhereFont/.test(AS2) && !/\.embedFonts/.test(AS2));
check('there is a Close row that closes the movie itself', /function addCloseRow\(\)/.test(AS2) && /_global\.skse\.CloseMenu\(MENU_NAME\)/.test(AS2));
check('the base SWF carries no assets of anyone else: one frame, one empty action tag',
  /actionBytes="00"/.test(XML) && /frameCount="1"/.test(XML) && !/DefineShape|DefineFont|DefineBits/.test(XML));
check('the build verifies the AS2 came back out of the SWF rather than trusting the exit code',
  /-export', 'script', verifyDir/.test(BUILD) && /missing\.length/.test(BUILD));

// ---- 9. planRefresh: new contents for a panel already on screen, which must never open a second menu ---------------
// The relay routes a non-focus dboWidget for the natively-open widget here. planOpen cannot do this job: with
// the menu still "opening" it would emit a SECOND openCustomMenu.
check('a refresh while READY pushes the new payload and nothing else', () => {
  const t = M.newState(); M.planOpen(t, 'dbo_board', { rows: 1 }, 7, 0); M.planReady(t, 2, 10);
  const r = M.planRefresh(t, { rows: 2 }, 7);
  return r.length === 1 && r[0].do === 'push' && JSON.parse(r[0].json).rows === 2;
}, (() => { const t = M.newState(); M.planOpen(t, 'dbo_board', { rows: 1 }, 7, 0); M.planReady(t, 2, 10); return M.planRefresh(t, { rows: 2 }, 7); })());
check('a refresh while still OPENING invokes nothing, because the movie is not there to invoke on', () => {
  const t = M.newState(); M.planOpen(t, 'dbo_board', { rows: 1 }, 7, 0);
  return M.planRefresh(t, { rows: 2 }, 7).length === 0;
});
check('...but it is the FRESH payload that planReady then pushes, not the stale one', () => {
  const t = M.newState(); M.planOpen(t, 'dbo_board', { rows: 1 }, 7, 0);
  M.planRefresh(t, { rows: 2 }, 7);
  const r = M.planReady(t, 3, 20);
  return r.length === 1 && r[0].do === 'push' && JSON.parse(r[0].json).rows === 2;
}, (() => { const t = M.newState(); M.planOpen(t, 'dbo_board', { rows: 1 }, 7, 0); M.planRefresh(t, { rows: 2 }, 7); return M.planReady(t, 3, 20); })());
check('a refresh NEVER emits an open, whatever the phase', () => {
  const phases = [];
  let t = M.newState(); M.planOpen(t, 'dbo_board', { a: 1 }, 7, 0); phases.push(M.planRefresh(t, { a: 2 }, 7));
  t = M.newState(); M.planOpen(t, 'dbo_board', { a: 1 }, 7, 0); M.planReady(t, 1, 5); phases.push(M.planRefresh(t, { a: 2 }, 7));
  t = M.newState(); phases.push(M.planRefresh(t, { a: 2 }, 7));
  return phases.every((r) => !r.some((x) => x.do === 'open'));
});
check('a refresh with the menu CLOSED does nothing at all', () => M.planRefresh(M.newState(), { a: 1 }, 7).length === 0);
check('...and does not touch the state either, or the next open would inherit a stale payload', () => {
  const t = M.newState();
  M.planRefresh(t, { a: 1 }, 7);
  return t.json === 'null' && t.widgetId === 0 && t.phase === 'closed';
}, (() => { const t = M.newState(); M.planRefresh(t, { a: 1 }, 7); return { json: t.json, widgetId: t.widgetId }; })());

// ---- 9b. planOpen when a DIFFERENT panel is already up ------------------------------------------------------------
// Worker 1 found this on 26 Oct: s.swf was overwritten before the phase was tested, so a journal arriving
// while decor was ready pushed the journal's JSON into dbo_decor and s.swf then named a movie not on screen.
// These four exist because the mutant pass showed the fix had no test at all.
check('a DIFFERENT swf while one is ready closes the old panel and opens the new one', () => {
  const t = M.newState();
  M.planOpen(t, 'dbo_decor', { a: 1 }, 1, 0); M.planReady(t, 2, 10);
  const r = M.planOpen(t, 'dbo_journal', { tab: 'stats' }, 2, 20);
  return r.length === 2 && r[0].do === 'close' && r[1].do === 'open' && r[1].swf === 'dbo_journal';
}, (() => { const t = M.newState(); M.planOpen(t, 'dbo_decor', { a: 1 }, 1, 0); M.planReady(t, 2, 10); return M.planOpen(t, 'dbo_journal', { tab: 'stats' }, 2, 20); })());
check('...and it NEVER pushes the new payload into the panel already on screen', () => {
  const t = M.newState();
  M.planOpen(t, 'dbo_decor', { a: 1 }, 1, 0); M.planReady(t, 2, 10);
  return !M.planOpen(t, 'dbo_journal', { tab: 'stats' }, 2, 20).some((x) => x.do === 'push');
});
check('...the close comes BEFORE the open, since only one CustomMenu exists at a time', () => {
  const t = M.newState();
  M.planOpen(t, 'dbo_decor', { a: 1 }, 1, 0); M.planReady(t, 2, 10);
  const r = M.planOpen(t, 'dbo_journal', { tab: 'stats' }, 2, 20);
  return r.findIndex((x) => x.do === 'close') < r.findIndex((x) => x.do === 'open');
});
check('...and the phase goes back to opening, so the ready timeout guards the new panel', () => {
  const t = M.newState();
  M.planOpen(t, 'dbo_decor', { a: 1 }, 1, 0); M.planReady(t, 2, 10);
  M.planOpen(t, 'dbo_journal', { tab: 'stats' }, 2, 20);
  return t.phase === 'opening' && t.swf === 'dbo_journal' && t.openedAt === 20;
}, (() => { const t = M.newState(); M.planOpen(t, 'dbo_decor', { a: 1 }, 1, 0); M.planReady(t, 2, 10); M.planOpen(t, 'dbo_journal', { tab: 'stats' }, 2, 20); return { phase: t.phase, swf: t.swf }; })());
check('the SAME swf while ready still only replaces the contents, with no close/open flicker', () => {
  const t = M.newState();
  M.planOpen(t, 'dbo_decor', { a: 1 }, 1, 0); M.planReady(t, 2, 10);
  const r = M.planOpen(t, 'dbo_decor', { a: 2 }, 1, 20);
  return r.length === 1 && r[0].do === 'push' && JSON.parse(r[0].json).a === 2;
}, (() => { const t = M.newState(); M.planOpen(t, 'dbo_decor', { a: 1 }, 1, 0); M.planReady(t, 2, 10); return M.planOpen(t, 'dbo_decor', { a: 2 }, 1, 20); })());
check('a different swf while still OPENING also closes first, since that menu may be up already', () => {
  const t = M.newState();
  M.planOpen(t, 'dbo_decor', { a: 1 }, 1, 0);
  const r = M.planOpen(t, 'dbo_journal', { a: 1 }, 2, 5);
  return r.length === 2 && r[0].do === 'close' && r[1].do === 'open';
}, (() => { const t = M.newState(); M.planOpen(t, 'dbo_decor', { a: 1 }, 1, 0); return M.planOpen(t, 'dbo_journal', { a: 1 }, 2, 5); })());
check('the FIRST open of all emits no close, there being nothing to close', () => {
  const r = M.planOpen(M.newState(), 'dbo_decor', { a: 1 }, 1, 0);
  return r.length === 1 && r[0].do === 'open';
});
check('a refresh does not lose the phase, so the outbox keeps being drained', () => {
  const t = M.newState(); M.planOpen(t, 'dbo_board', { a: 1 }, 7, 0); M.planReady(t, 1, 5);
  M.planRefresh(t, { a: 2 }, 7);
  return t.phase === 'ready';
});
check('a refresh does not reset the sequence or the outbox cursor, which would replay old clicks', () => {
  const t = M.newState(); M.planOpen(t, 'dbo_board', { a: 1 }, 7, 0); M.planReady(t, 1, 5);
  t.outRead = 120; t.lastSeq = 4;
  M.planRefresh(t, { a: 2 }, 7);
  return t.outRead === 120 && t.lastSeq === 4;
});
check('an empty refresh payload is REPORTED, because a blanked panel looks like a dead one', () => {
  const t = M.newState(); M.planOpen(t, 'dbo_board', { a: 1 }, 7, 0); M.planReady(t, 1, 5);
  const r = M.planRefresh(t, {}, 7);
  return r.length === 2 && r[0].do === 'report' && r[1].do === 'push';
}, (() => { const t = M.newState(); M.planOpen(t, 'dbo_board', { a: 1 }, 7, 0); M.planReady(t, 1, 5); return M.planRefresh(t, {}, 7); })());
check('a refresh keeps the widget id when the caller does not name one, so replies still carry it', () => {
  const t = M.newState(); M.planOpen(t, 'dbo_board', { a: 1 }, 7, 0); M.planReady(t, 1, 5);
  M.planRefresh(t, { a: 2 }, 0);
  return t.widgetId === 7;
});

console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
