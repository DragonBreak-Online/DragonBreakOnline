// Scripted test for the widget-to-SWF router's decisions (Worker 4, 26 Oct). nativeWidgets.ts has no
// imports and transpiles on its own. Run from skymp5-client:
//
//   ./node_modules/typescript/bin/tsc src/services/services/nativeWidgets.ts --outDir <tmp> --module commonjs --target es2019
//   node tests/native-widgets-harness.js <tmp>/nativeWidgets.js
//
// Two of these checks read dboRelayService.ts rather than the router. They are there because the router's
// whole contract is "produce what the browser path produces", and that is a PREMISE: the 26 Oct creature
// guard passed 64 of 64 checks against an event name the engine never emits, because code and test shared an
// unverified premise. So the premises are asserted against the real relay, not restated here.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require(path.resolve(process.argv[2] || path.join(os.tmpdir(), 'nw', 'nativeWidgets.js')));
const read = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const RELAY = read('src/services/services/dboRelayService.ts');

let failures = 0;
const check = (name, fn, got) => {
  let ok = false, err = null;
  try { ok = typeof fn === 'function' ? fn() : fn; } catch (e) { err = e; }
  const extra = err ? '   threw: ' + err.message : (!ok && got !== undefined ? '   ' + JSON.stringify(got) : '');
  console.log(`${ok && !err ? 'ok  ' : 'FAIL'} ${name}${extra}`);
  if (!ok || err) failures++;
};
const widget = (over) => Object.assign(
  { type: 'bountyBoard', id: 7, events: { close: 'dbo:boardClose', post: 'dbo:boardPost' } }, over || {});

// ---- 1. the registry and its off switch --------------------------------------------------------------------------
check('every registered type maps to a dbo_ swf',
  () => Object.values(M.NATIVE_WIDGETS).every((s) => /^dbo_[a-z]+$/.test(s)), M.NATIVE_WIDGETS);
check('the four panels Worker 1 built are registered',
  () => ['prayer', 'decor', 'bountyBoard', 'housing'].every((t) => M.NATIVE_WIDGETS[t]));
check('an absent setting routes a known type natively', M.swfFor('housing', undefined) === 'dbo_housing');
check('...and true does too', M.swfFor('housing', true) === 'dbo_housing');
check('false sends every type back to the browser', M.swfFor('housing', false) === '');
check('one type can be switched off without the others',
  () => M.swfFor('housing', { housing: false }) === '' && M.swfFor('decor', { housing: false }) === 'dbo_decor');
check('an UNKNOWN type is never routed, whatever the setting',
  () => M.swfFor('journal', undefined) === '' && M.swfFor('journal', true) === '' && M.swfFor('', true) === '');
check('a junk setting does not accidentally disable everything',
  () => M.swfFor('decor', 'yes') === 'dbo_decor' && M.swfFor('decor', 7) === 'dbo_decor');

// ---- 2. the rule the browser path enforces, which we must match --------------------------------------------------
check('PREMISE: the relay really does drop a non-dbo key, so this is worth guarding',
  /!key\.startsWith\("dbo:"\)\) return;/.test(RELAY));
check('a dbo: key becomes the same server event the browser produces', () => {
  const r = M.replayFor('dbo:boardPost', ['a', 1]);
  return r.length === 1 && r[0].do === 'server' && r[0].event === 'boardPost' && r[0].args[1] === 1;
}, M.replayFor('dbo:boardPost', ['a', 1]));
check('a key WITHOUT the prefix is reported, not dropped the way the browser drops it', () => {
  const r = M.replayFor('bountyBoard:post', []);
  return r.length === 1 && r[0].do === 'report' && /no dbo: prefix/.test(r[0].text);
}, M.replayFor('bountyBoard:post', []));
check('an empty key is reported', () => M.replayFor('', [])[0].do === 'report');
check('the widget\'s own close key is just another dbo: key, not a special case', () => {
  const r = M.replayFor(widget().events.close, []);
  return r.length === 1 && r[0].do === 'server' && r[0].event === 'boardClose' && !r.some((x) => x.do === 'close');
}, M.replayFor('dbo:boardClose', []));

// ---- 3. a bare close must be byte-for-byte what closeFocused sends -----------------------------------------------
// Three live gamemode handlers hang off this packet (dbo-gamemode.js 4224 panel nonces, 4609 pigeon nonces,
// 5400 abandoning a read). A native panel that closed without it would leak all three.
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
check('a bare close never fires the widget\'s events.close as well, which would close it twice', () => {
  const r = M.replayFor('close', []);
  return !r.some((x) => x.do === 'server' && x.event === 'boardClose');
});

// ---- 4. the hand-off, which must never be confused with a close --------------------------------------------------
check('a hand-off carries its type and mode', () => {
  const r = M.replayFor('native:handoff', ['housing', 'rename']);
  return r.length === 1 && r[0].do === 'handoff' && r[0].type === 'housing' && r[0].mode === 'rename';
}, M.replayFor('native:handoff', ['housing', 'rename']));
check('a hand-off with no mode is REFUSED, not treated as a close', () => {
  const r = M.replayFor('native:handoff', ['housing']);
  return r.length === 1 && r[0].do === 'report' && !r.some((x) => x.do === 'close');
}, M.replayFor('native:handoff', ['housing']));
check('...and with no args at all', () => {
  const r = M.replayFor('native:handoff', []);
  return r.length === 1 && r[0].do === 'report';
});
check('a hand-off never also closes, because the two do opposite things',
  () => !M.replayFor('native:handoff', ['housing', 'rename']).some((x) => x.do === 'close'));

check('typeOf reads the published type and nothing else',
  () => M.typeOf(widget()) === 'bountyBoard' && M.typeOf({}) === '' && M.typeOf(undefined) === '');

// ---- 5. routeWidget: which UI draws the packet -------------------------------------------------------------------
const route = (p, nativeId, setting) => M.routeWidget(p, nativeId === undefined ? 0 : nativeId, setting);

check('a focused native widget opens the SWF', () => {
  const r = route({ widget: widget(), focus: true });
  return r.to === 'native' && r.action === 'open' && r.swf === 'dbo_board' && r.id === 7 && r.widget.type === 'bountyBoard';
}, route({ widget: widget(), focus: true }));
check('a focused widget of an unknown type goes to the browser untouched',
  () => route({ widget: widget({ type: 'journal' }), focus: true }).to === 'browser');
check('...and so does one whose type is switched off',
  () => route({ widget: widget(), focus: true }, 0, { bountyBoard: false }).to === 'browser');
check('a refresh for the widget open natively goes native', () => {
  const r = route({ widget: widget() }, 7);
  return r.to === 'native' && r.action === 'refresh' && r.id === 7;
}, route({ widget: widget() }, 7));
check('a refresh for a DIFFERENT widget is the browser\'s, even though its type is native',
  () => route({ widget: widget({ id: 9 }) }, 7).to === 'browser', route({ widget: widget({ id: 9 }) }, 7));
check('a refresh with nothing open natively is the browser\'s',
  () => route({ widget: widget() }, 0).to === 'browser');

// Worker 1's requirement, verbatim: a close for a type that is open natively must take the CustomMenu down,
// never reach the browser's closeFormMenu (which hands focus back to the page through takeDeferredFocus).
check('a server close for the NATIVE widget closes the CustomMenu', () => {
  const r = route({ close: 7 }, 7);
  return r.to === 'native' && r.action === 'close' && r.id === 7;
}, route({ close: 7 }, 7));
check('a server close for some OTHER widget stays with the browser',
  () => route({ close: 9 }, 7).to === 'browser');
check('a server close with nothing open natively stays with the browser',
  () => route({ close: 7 }, 0).to === 'browser');
check('a close is never mistaken for an open: it carries no swf',
  () => route({ close: 7 }, 7).swf === undefined);

check('refocusing the panel already open natively is a refresh, not a reopen that would reset the SWF', () => {
  const r = route({ widget: widget(), focus: true }, 7);
  return r.to === 'native' && r.action === 'refresh';
}, route({ widget: widget(), focus: true }, 7));
check('a widget open natively STAYS native even if the setting now says browser, so it cannot split in two',
  () => route({ widget: widget() }, 7, false).to === 'native', route({ widget: widget() }, 7, false));

check('a packet with no widget and no close is ignored with a reason', () => {
  const r = route({});
  return r.to === 'ignore' && /no widget object/.test(r.why);
}, route({}));
check('a widget with a junk id is ignored with a reason, not routed to id NaN', () => {
  const r = route({ widget: widget({ id: 'seven' }), focus: true });
  return r.to === 'ignore' && /not a positive number/.test(r.why);
}, route({ widget: widget({ id: 'seven' }), focus: true }));
check('a close id of 0 is not a close',
  () => route({ close: 0, widget: widget(), focus: true }, 0).to === 'native');

// ---- 6. the wiring, which the pure tests above cannot see ---------------------------------------------------------
// The service needs sp, so its wiring is asserted against the source. Positions are compared, never
// distances: an earlier version of this file used a regex spanning both lines and broke the moment an
// unrelated line moved between them, which is a test failing for a reason that is not a fault.
const SERVICE = read('src/services/services/scaleformMenuService.ts');
const INDEX = read('src/index.ts');
const at = (hay, needle) => hay.indexOf(needle);

// Matched on the call and its arguments, not on where the line happens to wrap: the first version of these
// four pinned "takeWidgetPacket(content)" exactly and all four broke the moment the call grew a second
// argument, which is a test failing for a reason that is not a fault.
check('the relay offers every dboWidget packet to the native path',
  () => /lookupListener\(ScaleformMenuService\)\s*\.\s*takeWidgetPacket\(\s*content\s*,/.test(RELAY));
check('...and hands over the browser failover with it, or a dead SWF would lose the panel',
  () => /takeWidgetPacket\(\s*content\s*,\s*\(w, id\) => this\.drawInBrowser\(w, id\)\)/.test(RELAY));
check('...and returns straight away when the native path takes it, so the browser never also draws it',
  () => /takeWidgetPacket\([^;]*\)\) return;/.test(RELAY));
check('...BEFORE it reads close or opens a browser menu, or both UIs would answer one packet', () => {
  const hook = at(RELAY, 'takeWidgetPacket(');
  const close = at(RELAY, 'const closeId = Number(content["close"]);');
  const open = at(RELAY, 'this.drawInBrowser(w, wid);');
  return hook > 0 && close > hook && open > hook;
}, { hook: at(RELAY, 'takeWidgetPacket('), close: at(RELAY, 'const closeId = Number(content["close"]);'), open: at(RELAY, 'this.drawInBrowser(w, wid);') });
check('the hook sits inside the dboWidget branch, not above the packet type check', () => {
  const guard = at(RELAY, 'if (type !== "dboWidget") return;');
  return guard > 0 && at(RELAY, 'takeWidgetPacket(') > guard;
});
check('the service is actually constructed, or lookupListener would throw on the first widget',
  () => /new ScaleformMenuService\(sp, controller\)/.test(INDEX));

check('takeWidgetPacket calls NO native: it runs in a packet handler, where none can be called', () => {
  const body = SERVICE.slice(at(SERVICE, 'public takeWidgetPacket'));
  const end = body.indexOf('\n  }\n');
  return end > 0 && !/this\.sp\./.test(body.slice(0, end));
});
check('...and queues through the plans instead', () => {
  const body = SERVICE.slice(at(SERVICE, 'public takeWidgetPacket'));
  const end = body.indexOf('\n  }\n');
  const b = body.slice(0, end);
  return /this\.enqueue\(planOpen\(/.test(b) && /this\.enqueue\(planClose\(/.test(b) && /this\.enqueue\(planRefresh\(/.test(b);
});
check('a refresh uses planRefresh, NOT planOpen, which would open a second CustomMenu while opening', () => {
  const body = SERVICE.slice(at(SERVICE, 'public takeWidgetPacket'));
  const end = body.indexOf('\n  }\n');
  const b = body.slice(0, end);
  // planOpen appears once, for the open action, and the refresh tail uses planRefresh
  return b.split('planOpen(').length === 2 && b.split('planRefresh(').length === 2;
});
check('a routing failure falls back to the browser rather than leaving the player with no panel', () => {
  const body = SERVICE.slice(at(SERVICE, 'public takeWidgetPacket'));
  const end = body.indexOf('\n  }\n');
  const b = body.slice(0, end);
  const c = b.indexOf('catch');
  return c > 0 && /return false;/.test(b.slice(c));
});

check('the panel message path runs through replayFor, so there is ONE decision table, not two',
  () => /for \(const r of replayFor\(parsed\.key, parsed\.args\)\) this\.replay\(r\);/.test(SERVICE));
check('the old private copy of the dbo: rule is gone from the service',
  () => !/serverEventName/.test(SERVICE), SERVICE.match(/serverEventName/g));
check('the replayed packet carries withClientUiCaps, exactly as the browser path does',
  () => /args: withClientUiCaps\(r\.event, r\.args\)/.test(SERVICE));
check('the replayed packet is the same shape the relay sends',
  () => /customPacketType: "dbo", event: r\.event/.test(SERVICE) && /widget: this\.state\.widgetId/.test(SERVICE));
check('a hand-off is reported rather than dropped, since it is parsed but not yet routed',
  () => /not wired yet/.test(SERVICE));

// focusedId gates the browser overlay's Escape and its hidden-UI close. A native panel must not be in it:
// the CustomMenu is modal and pauses the game, handles its own Escape, and reports a bare "close".
check('the relay does not claim focus for a native panel, which would close it twice', () => {
  const hook = at(RELAY, 'takeWidgetPacket(');
  const ret = RELAY.indexOf('return;', hook);
  return hook > 0 && ret > hook && !/focusedId/.test(RELAY.slice(hook, ret));
});

// ---- 7. the failover: a routed panel whose SWF never comes up ----------------------------------------------------
// Only two of the four SWFs are installed in the dev game today (dbo_prayer, dbo_decor), so this is the
// difference between a missing file costing a delay and costing the panel.
check('the service remembers what to fall back to when it routes a widget natively',
  () => /this\.pending = \{ widget: route\.widget, id: route\.id, swf: route\.swf, draw: drawInBrowser \}/.test(SERVICE));
check('ready clears the fallback, so a working panel can never be second-guessed later', () => {
  const r = at(SERVICE, 'parsed.key === "ready"');
  const clear = SERVICE.indexOf('this.pending = null;', r);
  const planReady = SERVICE.indexOf('planReady(this.state', r);
  return r > 0 && clear > r && clear < planReady;
});
check('the 5s timeout falls over to the browser instead of just closing',
  () => /this\.exec\(tick\);\s*\n\s*this\.failover\("the panel never reported ready"\);/.test(SERVICE));
// Anchored on exec's catch, not on the first 'if (a.do === "open")' - that one is the try branch, and
// matching it made this check look for the failover in the wrong half of the method.
check('an open that THROWS falls over at once, without waiting out the timeout', () => {
  const exec = at(SERVICE, 'private exec(actions: Action[]): void {');
  const c = SERVICE.indexOf('} catch (e) {', exec);
  const end = SERVICE.indexOf('\n  }\n', c);
  const tail = SERVICE.slice(c, end);
  return exec > 0 && c > exec && /if \(a\.do === "open"\) \{[\s\S]*this\.failover\(/.test(tail);
});
check('the failover draws the widget the relay gave it, through the relay',
  () => /p\.draw\(p\.widget, p\.id\)/.test(SERVICE));
check('a failover that itself fails is said out loud, not swallowed',
  () => /browser failover ALSO failed/.test(SERVICE));
check('the fallback is consumed, so one bad open cannot draw the widget twice', () => {
  const f = at(SERVICE, 'private failover(');
  const body = SERVICE.slice(f, f + 700);
  return body.indexOf('this.pending = null;') < body.indexOf('p.draw(');
});
check('a gamemode-driven dboScaleform panel has no fallback, having no browser widget to fall back to', () => {
  // planOpen is reached from onCustomPacketMessage without touching pending
  const p = at(SERVICE, 'private onCustomPacketMessage');
  const end = SERVICE.indexOf('\n  }\n', p);
  return p > 0 && !/this\.pending/.test(SERVICE.slice(p, end));
});
check('the relay exposes drawInBrowser and the focus branch uses it, so there is one path, not two',
  () => /private drawInBrowser\(w: unknown, wid: number\): void \{/.test(RELAY)
     && /if \(content\["focus"\]\) \{\s*\n\s*this\.drawInBrowser\(w, wid\);/.test(RELAY));

console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
