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
check('the summary says whether it ever became ready', () => /never became ready/.test(M.summary(s)), M.summary(s));
check('...and names the frame when it did', () => {
  const t = M.newState(); M.planOpen(t, 'x', {}, 1, 0); M.planReady(t, 3, 50); t.sent = 2; t.foreignEvents = 7;
  const line = M.summary(t);
  return /50ms to ready on frame 3/.test(line) && /sent=2/.test(line) && /ignored 7 mod events/.test(line);
}, (() => { const t = M.newState(); M.planOpen(t, 'x', {}, 1, 0); M.planReady(t, 3, 50); t.sent = 2; t.foreignEvents = 7; return M.summary(t); })());

// ---- 6. the service wiring ----------------------------------------------------------------------------------------
check('data goes in as ONE invokeString of the whole payload', /invokeString\(MENU_NAME, "_root\.dboData", a\.json\)/.test(SVC));
check('a panel message goes out as the SAME packet the browser widgets send',
  /customPacketType: "dbo", event: eventName, args: parsed\.args, widget: this\.state\.widgetId/.test(SVC));
check('an unknown key is logged, not forwarded raw', /Scaleform panel sent an unknown key/.test(SVC));
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
check('the queue is drained BEFORE the closed-phase early return, or a close would never run',
  /this\.exec\(q\);[\s\S]{0,120}?if \(this\.state\.phase === "closed"\) return;/.test(SVC));
check('the reason is written down next to it, not just fixed',
  /g_nativeCallRequirements\.vm only inside OnUpdate/.test(SVC));
check('the frame skse appeared on is logged, since that number was unknown', /ready on frame/.test(SVC));
check('a failed action is reported rather than swallowed', /logError\(this, `Scaleform action '\$\{a\.do\}' failed`/.test(SVC));
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
check('the skse bridge is never assumed anywhere', /function haveSkse\(\)/.test(AS2));
check('the font is a $-name resolved from the player\'s own gfxfontlib, with nothing shipped',
  /\$EverywhereFont/.test(AS2) && !/\.embedFonts/.test(AS2));
check('there is a Close row that closes the movie itself', /function addCloseRow\(\)/.test(AS2) && /_global\.skse\.CloseMenu\(MENU_NAME\)/.test(AS2));
check('the base SWF carries no assets of anyone else: one frame, one empty action tag',
  /actionBytes="00"/.test(XML) && /frameCount="1"/.test(XML) && !/DefineShape|DefineFont|DefineBits/.test(XML));
check('the build verifies the AS2 came back out of the SWF rather than trusting the exit code',
  /-export', 'script', verifyDir/.test(BUILD) && /missing\.length/.test(BUILD));

console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
