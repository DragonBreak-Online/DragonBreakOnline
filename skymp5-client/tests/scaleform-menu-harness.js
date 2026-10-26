// Scripted test for the Scaleform panel logic (Worker 4, 25 Oct). scaleformMenu.ts has no imports and
// transpiles on its own; the service around it needs sp, so its wiring is checked in the source, and the
// AS2 is checked in swf/dbo_testmenu/scripts/frame_1/DoAction.as. Run from skymp5-client:
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

// ---- 1. the SKSE constraints, which are not ours to choose -------------------------------------------------------
check('the menu name is the one SKSE hard-codes', M.MENU_NAME === 'CustomMenu');
check('the swf name matches the folder that builds it', M.SWF_NAME === 'dbo_testmenu');
check('a ready timeout exists, because openCustomMenu is queued and may never arrive', M.READY_TIMEOUT_MS >= 1000);

// ---- 2. parsing mod events, where every other mod in the game also arrives ---------------------------------------
check('our ready event is recognised', () => {
  const r = M.parseMenuEvent('dboTestMenu', 'ready', 0);
  return r && r.kind === 'ready';
});
check('a row click carries its index', () => {
  const r = M.parseMenuEvent('dboTestMenu', 'row:3', 3);
  return r && r.kind === 'row' && r.index === 3;
});
check('close is recognised', () => M.parseMenuEvent('dboTestMenu', 'close', -1).kind === 'close');
// This is the one that matters most: on('modEvent') hears the whole game.
for (const other of ['SKICursorToggle', 'SliderChange', 'RaceChanged', 'TrueHUD_Event', 'dboTestMenuX', '']) {
  check(`another mod's event is ignored: "${other}"`,
    () => M.parseMenuEvent(other, 'row:1', 1) === null, M.parseMenuEvent(other, 'row:1', 1));
}
check('an unknown payload under our own name is ignored', () => M.parseMenuEvent('dboTestMenu', 'wat', 0) === null);
check('the index falls back to numArg when the string is malformed',
  () => { const r = M.parseMenuEvent('dboTestMenu', 'row:x', 4); return r && r.index === 4; });
check('a row index out of range is refused, not clamped',
  () => M.parseMenuEvent('dboTestMenu', 'row:99', 99) === null && M.parseMenuEvent('dboTestMenu', 'row:-1', -1) === null);

// ---- 3. what gets pushed into the movie --------------------------------------------------------------------------
check(`rows are capped at ${M.MAX_ROWS}, because the panel draws that many`,
  () => M.sanitiseRows(new Array(40).fill('x')).length === M.MAX_ROWS);
check('rows are truncated, not dropped', () => M.sanitiseRows(['y'.repeat(500)])[0].length === M.MAX_ROW_CHARS);
check('rows become strings and blanks are dropped',
  () => { const r = M.sanitiseRows([1, null, undefined, '', 'a']); return r.length === 2 && r[0] === '1' && r[1] === 'a'; }, M.sanitiseRows([1, null, undefined, '', 'a']));
check('a non-array rows field is survivable',
  () => M.sanitiseRows('nope').length === 0 && M.sanitiseRows(undefined).length === 0);
check('the title is truncated and never undefined',
  () => M.sanitiseTitle(undefined) === '' && M.sanitiseTitle('t'.repeat(200)).length === M.MAX_TITLE_CHARS);

// ---- 4. the open sequence: nothing may be invoked before the SWF says it is there --------------------------------
let s = M.newState();
let acts = M.planOpen(s, 'Title', ['a', 'b'], 1000);
check('opening asks for the menu and pushes NOTHING yet',
  () => acts.length === 1 && acts[0].do === 'open' && acts[0].swf === 'dbo_testmenu', acts);
check('...and the phase says it is waiting', s.phase === 'opening');
check('a tick before the timeout does nothing', M.planTick(s, 1000 + M.READY_TIMEOUT_MS - 1).length === 0);
acts = M.planReady(s, 1400);
check('ready pushes the title and rows that were waiting',
  () => acts.length === 1 && acts[0].do === 'push' && acts[0].title === 'Title' && acts[0].rows.length === 2, acts);
check('...and records how long the open took', s.readyAt - s.openedAt === 400 && s.phase === 'ready');
acts = M.planOpen(s, 'Second', ['c'], 2000);
check('a second request while open replaces the contents instead of reopening (only one custom menu exists)',
  () => acts.length === 1 && acts[0].do === 'push' && acts[0].title === 'Second', acts);
acts = M.planClose(s);
check('closing closes once', () => acts.length === 1 && acts[0].do === 'close' && s.phase === 'closed');
check('closing again does nothing', M.planClose(s).length === 0);

// The failure this build exists to detect.
s = M.newState();
M.planOpen(s, 'T', ['a'], 5000);
acts = M.planTick(s, 5000 + M.READY_TIMEOUT_MS + 1);
check('an open that never reports ready is REPORTED, not left hanging',
  () => acts.length === 2 && acts[0].do === 'report' && /never reported ready/.test(acts[0].text) && acts[1].do === 'close', acts);
check('...and the state goes back to closed so a retry is possible', s.phase === 'closed');
check('ready arriving after a close is ignored', () => { const t = M.newState(); return M.planReady(t, 1).length === 0; });

check('the summary says whether it ever became ready', () => {
  const t = M.newState(); M.planOpen(t, 'x', [], 0);
  return /never became ready/.test(M.summary(t));
}, M.summary(M.newState()));
check('...and reports clicks and ignored foreign events', () => {
  const t = M.newState(); M.planOpen(t, 'x', ['a'], 0); M.planReady(t, 50); t.clicks = 2; t.foreignEvents = 7;
  const line = M.summary(t);
  return /50ms to ready/.test(line) && /clicks=2/.test(line) && /ignored 7 mod events/.test(line);
}, (() => { const t = M.newState(); M.planOpen(t, 'x', ['a'], 0); M.planReady(t, 50); t.clicks = 2; t.foreignEvents = 7; return M.summary(t); })());

// ---- 5. the service wiring ---------------------------------------------------------------------------------------
check('the service opens with flags 0, which SKSE ignores anyway', /openCustomMenu\(a\.swf, 0\)/.test(SVC));
check('data goes in through invokeString/invokeStringA on the custom menu',
  /invokeString\(MENU_NAME, "_root\.dboSetTitle"/.test(SVC) && /invokeStringA\(MENU_NAME, "_root\.dboSetRows"/.test(SVC));
check('clicks come back out as a custom packet', /customPacketType: "dboScaleform", kind/.test(SVC));
check('it listens for mod events and for the server packet',
  /controller\.on\("modEvent"/.test(SVC) && /customPacketType"\] !== "dboScaleform"/.test(SVC));
check('a failed action is reported rather than swallowed, since this is the first ever openCustomMenu call',
  /logError\(this, `Scaleform action '\$\{a\.do\}' failed`/.test(SVC) && /if \(a\.do === "open"\) this\.state\.phase = "closed";/.test(SVC));
check('it reads the loaded swf version back as a second, pull-based check',
  /getString\(MENU_NAME, "_root\.dboVersion"\)/.test(SVC));
check('the session reports through the diagnostic note', /__dboDiagNote/.test(SVC));
check('the service is registered', /ScaleformMenuService/.test(INDEX));

// ---- 6. the SWF source, which the client cannot be tested without ------------------------------------------------
check('the AS2 answers with "ready" after building, so the client never guesses when the async open finished',
  /send\("ready", 0\);/.test(AS2) && /function build\(\)/.test(AS2));
check('it exposes exactly the API the client drives',
  /_root\.dboSetRows = function\(\)/.test(AS2) && /_root\.dboSetTitle = function/.test(AS2) && /_root\.dboVersion/.test(AS2));
check('dboSetRows reads `arguments`, because invokeStringA passes an array as separate arguments',
  /arguments\.length/.test(AS2) && !/function\s*\(\s*rows\s*\)/.test(AS2));
check('a row click sends the index in BOTH fields, so the session shows which survives the trip',
  /SendModEvent\(DBO_EVENT, what, num\)/.test(AS2) && /send\("row:" \+ this\.idx, this\.idx\)/.test(AS2));
check('the font is a $-name resolved from the player\'s own gfxfontlib, with nothing shipped',
  /\$EverywhereFont/.test(AS2) && !/\.embedFonts/.test(AS2));
// The menu is modal and pauses the game, so a missing exit means a frozen game with no way out.
check('there is a Close row', /function addCloseRow\(\)/.test(AS2));
check('...and it closes from the SWF itself, not only by asking the client',
  /_global\.skse\.CloseMenu\(MENU_NAME\)/.test(AS2));
check('the skse bridge is never assumed; a missing one shows a message instead of freezing silently',
  /function haveSkse\(\)/.test(AS2) && /skse bridge missing/.test(AS2));
check('the base SWF carries no assets of anyone else: one frame, one empty action tag',
  /actionBytes="00"/.test(XML) && /frameCount="1"/.test(XML) && !/DefineShape|DefineFont|DefineBits/.test(XML));
check('the build verifies the AS2 came back out of the SWF rather than trusting the exit code',
  /-export', 'script', verifyDir/.test(BUILD) && /missing\.length/.test(BUILD));
check('...and fails loudly if the SWF has no ActionScript at all', /decompiles to no ActionScript at all/.test(BUILD));

console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
