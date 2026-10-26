// Scripted test for native panels owned by CLIENT-SIDE services (Worker 4, 26 Oct). nativeWidgets.ts has no
// imports and transpiles on its own. Run from skymp5-client:
//
//   ./node_modules/typescript/bin/tsc src/services/services/nativeWidgets.ts --outDir <tmp> --module commonjs --target es2019
//   node tests/native-widgets-harness.js <tmp>/nativeWidgets.js [server dir]
//
// The optional server dir is the GAMEPLAY checkout, and it drives the premise checks in section 1b. Give it
// a worktree that is up to date - PC server\ is behind (see the project memory note), which is exactly how
// the first version of this file came to assert four registry entries, three of which were dead.
//
// Two checks read dboRelayService.ts rather than this module. They are premises, not logic: the 26 Oct
// creature guard passed 64 of 64 against an event name the engine never emits because code and test shared
// an unverified premise, so premises are asserted against the real source.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require(path.resolve(process.argv[2] || path.join(os.tmpdir(), 'nw', 'nativeWidgets.js')));
const SERVER = process.argv[3] ? path.resolve(process.argv[3]) : null;
const read = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const RELAY = read('src/services/services/dboRelayService.ts');
const SERVICE = read('src/services/services/scaleformMenuService.ts');
const at = (hay, needle) => hay.indexOf(needle);

let failures = 0;
let skipped = 0;
const check = (name, fn, got) => {
  let ok = false, err = null;
  try { ok = typeof fn === 'function' ? fn() : fn; } catch (e) { err = e; }
  const extra = err ? '   threw: ' + err.message : (!ok && got !== undefined ? '   ' + JSON.stringify(got) : '');
  console.log(`${ok && !err ? 'ok  ' : 'FAIL'} ${name}${extra}`);
  if (!ok || err) failures++;
};
const skip = (name, why) => { console.log(`skip ${name}   (${why})`); skipped++; };

// ---- 1. the registry and its off switch --------------------------------------------------------------------------
check('every registered type maps to a dbo_ swf',
  () => Object.values(M.NATIVE_WIDGETS).every((s) => /^dbo_[a-z]+$/.test(s)), M.NATIVE_WIDGETS);
check('an absent setting routes a known type natively', M.swfFor('bountyBoard', undefined) === 'dbo_board');
check('...and true does too', M.swfFor('bountyBoard', true) === 'dbo_board');
check('false sends every type back to the browser', M.swfFor('bountyBoard', false) === '');
check('one type can be switched off without the others',
  () => M.swfFor('housing', { housing: false }) === '' && M.swfFor('bountyBoard', { housing: false }) === 'dbo_board');
check('an UNKNOWN type is never routed, whatever the setting',
  () => M.swfFor('journal', undefined) === '' && M.swfFor('journal', true) === '' && M.swfFor('', true) === '');
check('a junk setting does not accidentally disable everything',
  () => M.swfFor('housing', 'yes') === 'dbo_housing' && M.swfFor('housing', 7) === 'dbo_housing');

// ---- 1b. PREMISES about what each registered type actually is ----------------------------------------------------
// The whole point of this section. The first version of this file asserted "the four panels Worker 1 built are
// registered", which tested my own assumption: prayer and decor turned out to arrive as dboScaleform before
// the relay, and bountyBoard and housing never reach the relay at all. Three dead entries, one passing test.
check('a GAMEPLAY-published widget type is never in this registry, or it would be drawn twice', () => {
  // contextMenu is the trap: the gamemode publishes type:'contextMenu' AND playerActionService owns one. It
  // may be here ONLY while nothing routes gameplay widget packets to a native panel.
  return !/takeWidgetPacket|routeWidget/.test(RELAY);
}, RELAY.match(/takeWidgetPacket|routeWidget/g));
check('PREMISE: the relay says in writing why it does not route, so this does not get re-added by accident',
  () => /Deliberately NOT routed to a native panel here/.test(RELAY));

if (!SERVER) {
  skip('PREMISE: every registered type is owned by a client-side service, not the gameplay layer', 'no server dir given');
} else {
  const files = fs.readdirSync(SERVER).filter((f) => f.endsWith('.js'));
  const published = new Set();
  for (const f of files) {
    let src = '';
    try { src = fs.readFileSync(path.join(SERVER, f), 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/type:\s*'([a-zA-Z]+)',\s*id:/g)) published.add(m[1]);
  }
  // A registered type the gameplay layer ALSO publishes is allowed, but only once someone has written down
  // that it is shared and what follows from that. contextMenu is the live example: a generic list renderer
  // used by alchemy, business, charlevel and dungeons as well as by playerActionService.
  check(`PREMISE: every registered type the gameplay layer also publishes is declared shared (${published.size} types seen in ${files.length} files)`,
    () => Object.keys(M.NATIVE_WIDGETS).filter((t) => published.has(t))
      .every((t) => M.SHARED_WITH_GAMEPLAY.indexOf(t) >= 0),
    Object.keys(M.NATIVE_WIDGETS).filter((t) => published.has(t) && M.SHARED_WITH_GAMEPLAY.indexOf(t) < 0));
  check('...and nothing is declared shared that the gameplay layer does not actually publish, so the list cannot rot',
    () => M.SHARED_WITH_GAMEPLAY.every((t) => published.has(t)),
    M.SHARED_WITH_GAMEPLAY.filter((t) => !published.has(t)));
}

// ---- 2. the rule the browser path enforces, which we must match --------------------------------------------------
check('PREMISE: the relay really does drop a non-dbo key, so the report below is worth having',
  /!key\.startsWith\("dbo:"\)\) return;/.test(RELAY));
check('a dbo: key becomes the same server event the browser produces', () => {
  const r = M.replayFor('dbo:pigeonOpen', ['a', 1]);
  return r.length === 1 && r[0].do === 'server' && r[0].event === 'pigeonOpen' && r[0].args[1] === 1;
}, M.replayFor('dbo:pigeonOpen', ['a', 1]));
check('a dbo: key goes to the SERVER even when a service owns the panel', () => {
  const r = M.replayFor('dbo:pigeonOpen', [], true);
  return r.length === 1 && r[0].do === 'server';
}, M.replayFor('dbo:pigeonOpen', [], true));
check('an empty key is reported', () => M.replayFor('', [])[0].do === 'report');

// ---- 3. the owning service's own keys ----------------------------------------------------------------------------
check("a service's namespaced key goes back to it verbatim", () => {
  const r = M.replayFor('bountyBoard:post', ['wanted', 'text'], true);
  return r.length === 1 && r[0].do === 'owner' && r[0].key === 'bountyBoard:post'
    && r[0].args[0] === 'wanted' && r[0].args[1] === 'text';
}, M.replayFor('bountyBoard:post', ['wanted', 'text'], true));
check('...including the prefixes the other services use', () => {
  for (const k of ['housing:claim', 'pa:trade', 'pa:close']) {
    const r = M.replayFor(k, [], true);
    if (r.length !== 1 || r[0].do !== 'owner' || r[0].key !== k) return false;
  }
  return true;
});
check('the key is NOT rewritten, stripped or lowercased on the way back', () => {
  const r = M.replayFor('bountyBoard:Remove', ['X'], true);
  return r[0].key === 'bountyBoard:Remove' && r[0].args[0] === 'X';
});
// This is the regression Worker 1 caught on 3e6531a8: with no owner the board's Post did nothing but log.
check('with NO owner the same key is reported, not silently dropped the way the browser drops it', () => {
  const r = M.replayFor('bountyBoard:post', []);
  return r.length === 1 && r[0].do === 'report' && /no service owns it/.test(r[0].text);
}, M.replayFor('bountyBoard:post', []));

// ---- 4. a bare close must be byte-for-byte what closeFocused sends -----------------------------------------------
// Three live gamemode handlers hang off this packet (dbo-gamemode.js 4224 panel nonces, 4609 pigeon nonces,
// 5400 abandoning a read). A panel that closed without it would leak all three.
check('PREMISE: closeFocused sends the generic close with a reason, which is what we are copying',
  /customPacketType: "dbo", event: "close", args: \[why\]/.test(RELAY));
check('a bare close sends the generic close packet AND takes the menu down', () => {
  const r = M.replayFor('close', ['escape']);
  return r.length === 2
    && r[0].do === 'server' && r[0].event === 'close' && r[0].args.length === 1 && r[0].args[0] === 'escape'
    && r[1].do === 'close';
}, M.replayFor('close', ['escape']));
check('a close with no reason still names one, because closeFocused always does', () => {
  const r = M.replayFor('close', []);
  return r[0].do === 'server' && r[0].args[0] === 'native';
}, M.replayFor('close', []));
check('the packet is sent BEFORE the menu goes down, so a throw cannot swallow it', () => {
  const r = M.replayFor('close', []);
  return r.findIndex((x) => x.do === 'server') < r.findIndex((x) => x.do === 'close');
});
check('an owning service is TOLD about a close, or its menuOpen flag would stay set', () => {
  const r = M.replayFor('close', ['selfClosed'], true);
  return r.length === 3 && r[2].do === 'owner' && r[2].key === 'close' && r[2].args[0] === 'selfClosed';
}, M.replayFor('close', ['selfClosed'], true));
check('...and it is told LAST, because its handler usually calls back in to close the menu', () => {
  const r = M.replayFor('close', [], true);
  return r[r.length - 1].do === 'owner';
});

// ---- 5. the hand-off, which must never be confused with a close --------------------------------------------------
check('a hand-off carries its type and mode', () => {
  const r = M.replayFor('native:handoff', ['housing', 'rename']);
  return r.length === 1 && r[0].do === 'handoff' && r[0].type === 'housing' && r[0].mode === 'rename';
}, M.replayFor('native:handoff', ['housing', 'rename']));
check("...for the board's compose mode too, which carries a tab id", () => {
  const r = M.replayFor('native:handoff', ['bountyBoard', 'compose:wanted']);
  return r[0].do === 'handoff' && r[0].type === 'bountyBoard' && r[0].mode === 'compose:wanted';
}, M.replayFor('native:handoff', ['bountyBoard', 'compose:wanted']));
check('a hand-off with no mode is REFUSED, not treated as a close', () => {
  const r = M.replayFor('native:handoff', ['housing']);
  return r.length === 1 && r[0].do === 'report' && !r.some((x) => x.do === 'close');
}, M.replayFor('native:handoff', ['housing']));
check('...and with no args at all', () => M.replayFor('native:handoff', []).length === 1
  && M.replayFor('native:handoff', [])[0].do === 'report');
check('a hand-off never also closes, because the two do opposite things',
  () => !M.replayFor('native:handoff', ['housing', 'rename']).some((x) => x.do === 'close'));
check('a hand-off is NOT mistaken for an owning service\'s key when one is registered', () => {
  const r = M.replayFor('native:handoff', ['housing', 'rename'], true);
  return r.length === 1 && r[0].do === 'handoff';
}, M.replayFor('native:handoff', ['housing', 'rename'], true));

// ---- 6. the service API the other workers call -------------------------------------------------------------------
// openNative needs sp, so its wiring is asserted against the source. Positions are compared, never distances.
check('openNative exists and takes the options object the services were given',
  () => /public openNative\(opts: NativeOpen\): boolean \{/.test(SERVICE));
check('it returns false for a type with no SWF, so the service draws its own',
  () => /const swf = swfFor\(type, this\.nativePanelsSetting\(\)\);\s*\n\s*if \(!swf\) return false;/.test(SERVICE));
check('it records the owner BEFORE queueing the open, or the first key would arrive unowned', () => {
  const o = at(SERVICE, 'public openNative');
  const own = SERVICE.indexOf('this.owner = {', o);
  const open = SERVICE.indexOf('this.enqueue(planOpen(', o);
  return o > 0 && own > o && open > own;
}, { o: at(SERVICE, 'public openNative'), own: SERVICE.indexOf('this.owner = {', at(SERVICE, 'public openNative')) });
check('a throw in openNative clears the owner and returns false, never leaving a half-open panel', () => {
  const o = at(SERVICE, 'public openNative');
  const end = SERVICE.indexOf('\n  }\n', o);
  const c = SERVICE.indexOf('catch', o);
  const tail = SERVICE.slice(c, end);
  return c > 0 && c < end && /this\.owner = null;/.test(tail) && /return false;/.test(tail);
});
check('closeNative and isNativeOpen exist for the service\'s own closeMenu',
  () => /public closeNative\(type\?: string\): void \{/.test(SERVICE) && /public isNativeOpen\(type\?: string\): boolean \{/.test(SERVICE));
check('closeNative for someone ELSE\'s panel is a no-op, so two services cannot close each other',
  () => /if \(t && this\.owner && this\.owner\.type !== t\) return;/.test(SERVICE));
check('refreshNative exists, so a service can update a panel in place',
  () => /public refreshNative\(widget: unknown, widgetId\?: number\): void \{/.test(SERVICE));
check('openNative calls NO native itself: it may run outside the update tick', () => {
  const o = at(SERVICE, 'public openNative');
  const end = SERVICE.indexOf('\n  }\n', o);
  return !/this\.sp\./.test(SERVICE.slice(o, end));
});
check('replayFor is told whether a service owns the open panel',
  () => /replayFor\(parsed\.key, parsed\.args, !!this\.owner\)/.test(SERVICE));
check('the owner branch delivers the key and survives a throw in the service',
  () => /o\.onKey\(r\.key, r\.args\)/.test(SERVICE) && /threw on key/.test(SERVICE));
check('a key arriving with no owner is reported rather than crashing on a null callback',
  () => /a panel key arrived with no owning service/.test(SERVICE));
check('the owner is cleared on a close key, so a stale callback cannot be called again',
  () => /if \(r\.key === CLOSE_KEY\) this\.owner = null;/.test(SERVICE));
check('the owner is NOT cleared when the panel reports ready, or it would stop receiving keys', () => {
  const r = at(SERVICE, 'parsed.key === "ready"');
  const end = SERVICE.indexOf('return;', r);
  return r > 0 && !/this\.owner = null/.test(SERVICE.slice(r, end));
});

// ---- 6b. the hand-off, wired -------------------------------------------------------------------------------------
// The CustomMenu is modal and pauses the game, so the page cannot be typed into while it is up.
check('a hand-off takes the native panel DOWN before the browser is asked to draw', () => {
  const h = at(SERVICE, 'if (r.do === "handoff")');
  const end = SERVICE.indexOf('\n    }\n', h);
  const body = SERVICE.slice(h, end);
  return h > 0 && body.indexOf('this.enqueue(planClose(') < body.indexOf('o.onKey(HANDOFF_KEY');
}, { h: at(SERVICE, 'if (r.do === "handoff")') });
check('it delivers the type AND the mode, so compose:<tabId> survives',
  () => /o\.onKey\(HANDOFF_KEY, \[r\.type, r\.mode\]\)/.test(SERVICE));
check('the owner is NOT cleared, because the service reopens the panel when the input is done', () => {
  const h = at(SERVICE, 'if (r.do === "handoff")');
  const end = SERVICE.indexOf('\n    }\n', h);
  return !/this\.owner = null/.test(SERVICE.slice(h, end));
});
check('a gamemode panel asking to hand off is reported, having no client-side owner to draw it',
  () => /but only a client-service panel can hand off/.test(SERVICE));
check('a service that throws on the hand-off does not take the client with it',
  () => /threw on the hand-off/.test(SERVICE));

// ---- 7. the failover, and the SWF that closes itself -------------------------------------------------------------
check('a panel that cannot be drawn tells its service to draw its own',
  () => /o\.onKey\(FAILED_KEY, \[why\]\)/.test(SERVICE));
check('the owner is cleared BEFORE the callback, so a callback that reopens cannot loop', () => {
  const f = at(SERVICE, 'private failover(');
  const body = SERVICE.slice(f, f + 900);
  return body.indexOf('this.owner = null;') < body.indexOf('o.onKey(');
});
check('the 5s timeout falls over, instead of just closing',
  () => /this\.exec\(tick\);\s*\n\s*this\.failover\("the panel never reported ready"\);/.test(SERVICE));
check('an open that THROWS falls over at once, without waiting out the timeout', () => {
  const exec = at(SERVICE, 'private exec(actions: Action[]): void {');
  const c = SERVICE.indexOf('} catch (e) {', exec);
  const end = SERVICE.indexOf('\n  }\n', c);
  return exec > 0 && c > exec && /if \(a\.do === "open"\) \{[\s\S]*this\.failover\(/.test(SERVICE.slice(c, end));
});
check('a failover whose service also fails is said out loud, not swallowed',
  () => /could not draw its own panel either/.test(SERVICE));
// Worker 1 hit this: a service that simply reopens on FAILED_KEY called openNative, got true because the type
// was still registered, and looped back into the panel that cannot be drawn. Guarded here, once, rather than
// in every service - which is what this design exists to avoid.
check('a type that failed is refused by openNative, so reopening on FAILED_KEY cannot loop',
  () => /if \(this\.failedTypes\.indexOf\(type\) >= 0\) return false;/.test(SERVICE));
check('...and it is refused BEFORE the swf is looked up, so the registry cannot override it', () => {
  const o = at(SERVICE, 'public openNative');
  const guard = SERVICE.indexOf('this.failedTypes.indexOf(type)', o);
  const swf = SERVICE.indexOf('const swf = swfFor(', o);
  return o > 0 && guard > o && guard < swf;
});
check('the failure is recorded BEFORE the callback, so a reopen from inside it is already refused', () => {
  const f = at(SERVICE, 'private failover(');
  const body = SERVICE.slice(f, f + 1100);
  return body.indexOf('this.failedTypes.push(o.type)') < body.indexOf('o.onKey(');
}, { push: SERVICE.slice(at(SERVICE, 'private failover('), at(SERVICE, 'private failover(') + 1100).indexOf('this.failedTypes.push(o.type)') });
check('resetNative exists, so a service can re-arm a type deliberately',
  () => /public resetNative\(type: string\): void \{/.test(SERVICE));
check('the doc comment tells callers reopening is safe, since that is the trap',
  () => /Reopening from inside FAILED_KEY is SAFE/.test(SERVICE));
// Worker 1's panels close themselves, and nothing reports that.
check('an SWF that closed itself is noticed, through Ui.isMenuOpen',
  () => /if \(this\.state\.phase === "ready" && !this\.menuIsOpen\(\)\)/.test(SERVICE)
     && /this\.sp\.Ui\.isMenuOpen\(MENU_NAME\)/.test(SERVICE));
check('...and it is handled through the SAME close table, not a second copy of the rule',
  () => /replayFor\(CLOSE_KEY, \["selfClosed"\], !!this\.owner\)/.test(SERVICE));
check('a throw from isMenuOpen reports OPEN, so a live panel is never torn down by a failed probe', () => {
  const m = at(SERVICE, 'private menuIsOpen()');
  const end = SERVICE.indexOf('\n  }\n', m);
  const body = SERVICE.slice(m, end);
  return m > 0 && /catch \(e\) \{\s*\n\s*return true;/.test(body);
});

console.log(failures ? `${failures} failed` : `all passed${skipped ? ` (${skipped} skipped)` : ''}`);
process.exit(failures ? 1 : 0);
