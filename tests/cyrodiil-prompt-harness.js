// The Cyrodiil or Skyrim question after the race menu and the god (gamemode.js "where a new character starts"; Nate 14 Oct:
// "if you pick cyrodiil pale pass spawn, if you choose skyrim you stay in the hub world room and walk through one of the
// hold doors"), with its safety net: no answer, a closed menu, a disconnect, a relog, a restart, characters made before
// it, staff, a gate taken with the question up. Runs the block from gamemode.js against stubs.
//   node tests/cyrodiil-prompt-harness.js
'use strict';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const a0 = src.indexOf('// ---- where a new character starts');
const a1 = src.indexOf('const startLogin = ');
const block = src.slice(a0, src.indexOf('\n};\n', a1) + 4);
let fails = 0; const ok = (c, w, extra) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${w}${!c && extra !== undefined ? '   ' + JSON.stringify(extra) : ''}`); if (!c) fails++; };
const A = 7;
function world(opts = {}) {
  const props = new Map(Object.entries(opts.props || {}));
  const sent = [], timers = [], logs = [];
  const st = { online: true, hub: opts.hub !== false, pending: false };
  const env = {
    cfg: { playtest: opts.playtest || { enabled: true, gatesToArrival: false } },
    creation: new Map(opts.inCreation === false ? [] : [[A, 'open']]),
    mp: { get: (a, k) => (k === 'isOnline' ? st.online : props.get(k)), set: (a, k, v) => props.set(k, v) },
    creationPending: () => st.pending, inHub: () => st.hub, leftRealm: () => sent.push('leftRealm'),
    sendToArrival: () => sent.push('arrival'), creatorSpotRelease: () => {}, setCreatorHidden: () => {}, setFade: () => {},
    display: () => 'P', system: (a, t) => sent.push('system:' + t), log: (t) => logs.push(t),
    openWidget: (a, w, focus) => sent.push(`open:${w.id}:${focus ? 'focus' : ''}`), closeWidget: (a, id) => sent.push('close:' + id),
    setTimeout: (f, ms) => timers.push({ f, ms }), endCreation: () => sent.push('endCreation'),
  };
  globalThis.__dboStartPending = undefined; globalThis.__dboNameHold = null;
  const fn = new Function(...Object.keys(env), block + '\nreturn { leaveRealm, startChoose, startClose, startLogin, gateAnswersStart, askCyrodiil, setStartChoice };');
  const api = fn(...Object.values(env));
  const fire = (ms) => { const due = timers.filter((t) => !ms || t.ms === ms); timers.length = 0; due.forEach((t) => t.f()); };
  return Object.assign(api, { props, sent, timers, logs, st, env, fire, choice: () => props.get('private.dboStartChoice') });
}
const asking = { props: { 'private.dboStartChoice': 'asking' } };
const opens = (w) => w.sent.filter((s) => s.startsWith('open:86')).length;

// ---- the two answers ----
let w = world(asking); w.leaveRealm(A);
ok(w.sent[0] === 'open:86:focus', 'a new character is asked, in a focused panel (widget 86)', w.sent);
ok(w.sent[1] === 'close:36', '...and the god\'s picker closes AFTER the question opened, so the cursor stays', w.sent);
w.startChoose(A, ['cyrodiil']);
ok(w.sent.includes('arrival') && w.choice() === 'cyrodiil', 'Cyrodiil: sent to the Pale Pass arrival, answer kept on the character');
w.leaveRealm(A); ok(opens(w) === 1, 'the deity step\'s 5-minute fallback after an answer does not ask again');
w = world(asking); w.leaveRealm(A); w.startChoose(A, ['skyrim']);
ok(!w.sent.includes('arrival') && w.choice() === 'skyrim' && !w.env.creation.has(A), 'Skyrim: no move, creation ends in the Realm, answer kept');
ok(w.sent.some((s) => /gate of the hold you choose/.test(s)), 'Skyrim: told to walk through a hold gate');
w.leaveRealm(A); ok(opens(w) === 1 && !w.sent.includes('arrival'), 'after Skyrim the fallback neither asks again nor moves them');
// ---- no answer ----
w = world(asking); w.leaveRealm(A); w.startClose(A);
ok(!w.sent.includes('arrival') && w.choice() === 'asking' && w.sent.some((s) => /question will come back in a minute/.test(s)), 'Close decides nothing (Nate: "question comes back"): still asking, told it returns and that a gate works now', w.sent);
ok(!w.env.creation.has(A), '...and creation\'s fade, hiding and noon are already over (nobody is left in the creator state)');
w.sent.length = 0; w.fire(60000);
ok(opens(w) === 1, 'a minute later the question is asked again', w.sent);
w = world(asking); w.leaveRealm(A); w.sent.length = 0; w.fire(3 * 60000);
ok(opens(w) === 1 && !w.sent.some((s) => s.startsWith('close:86')) && w.choice() === 'asking', 'no answer in 3 minutes: sent again with focus, never closed in between (the cursor stays)', w.sent);
ok(w.timers.some((t) => t.ms === 3 * 60000), '...and again 3 minutes later while it is still unanswered');
w.startChoose(A, ['skyrim']); w.sent.length = 0; w.fire(3 * 60000);
ok(opens(w) === 0, 'once answered, the repeat stops');
w = world(asking); w.leaveRealm(A); w.st.online = false; w.fire(3 * 60000);
ok(w.choice() === 'asking' && !w.sent.includes('arrival'), 'disconnected before answering: the question stays open on the character');
// ---- relog / restart ----
w = world(asking); w.leaveRealm(A); globalThis.__dboStartLeave(A); w.fire(3 * 60000);
ok(w.choice() === 'asking', 'a logout drops the session\'s question; its timer then answers nothing');
w.sent.length = 0; w.startLogin(A); w.fire(4000);
ok(w.sent.includes('endCreation'), 'at the next login in the Realm the question comes back (via the god\'s step, which skips itself when a god is chosen)');
w.sent.length = 0; w.leaveRealm(A); ok(opens(w) === 1, '...and opens again');
w = world({ props: { 'private.dboStartChoice': 'skyrim' } }); w.startLogin(A); w.fire();
ok(!w.sent.includes('endCreation'), 'a login after answering Skyrim asks nothing');
w = world(asking); w.st.hub = false; w.startLogin(A); w.fire();
ok(!w.sent.includes('endCreation'), 'a login outside the Realm (a staff /tp out) asks nothing');
// ---- characters made before, staff, the Bruma-only lock ----
w = world({ inCreation: false }); w.leaveRealm(A);
ok(opens(w) === 0 && w.sent[0] === 'arrival', 'a character with no question on it (made before this release) is never asked: the old way out');
w = world({ props: {} }); w.startLogin(A); w.fire(); ok(!w.sent.includes('endCreation'), '...nor at login in the Realm');
ok(!/isAdmin|staffCan|isLeadStaff/.test(block), 'staff are asked like anyone making a character (no staff branch); their /tp works anywhere');
w = world(Object.assign({ playtest: { enabled: true } }, asking)); w.leaveRealm(A);
ok(opens(w) === 0 && w.sent[0] === 'arrival', 'only Bruma open (gates to the arrival): not asked, sent to the arrival as before');
w = world(Object.assign({ playtest: { enabled: true, gatesToArrival: false, askCyrodiil: false } }, asking)); w.leaveRealm(A);
ok(opens(w) === 0 && w.sent[0] === 'arrival', 'askCyrodiil false: not asked');
// ---- a name still to give, a gate taken with the question up ----
w = world(asking); globalThis.__dboNameHold = () => true; w.leaveRealm(A);
ok(opens(w) === 0 && w.timers.some((t) => t.ms === 20000), 'still "Prisoner": not asked until named (naming.js), checked again in 20 s');
w = world(asking); w.leaveRealm(A); w.gateAnswersStart(A);
ok(w.choice() === 'skyrim' && w.sent.includes('close:86'), 'a hold gate taken with the question up answers it: Skyrim');
w.sent.length = 0; w.fire(3 * 60000); ok(opens(w) === 0, '...and the question is not sent again');
// ---- wiring in gamemode.js ----
const hook = src.slice(src.indexOf('const appearanceHook = '), src.indexOf('appearanceHook.__dbo = true'));
ok(/madeNow = !!isAllowed && creationPending\(actorId >>> 0\)/.test(hook) && hook.indexOf('madeNow = !!isAllowed') < hook.indexOf('prev.call(mp, actorId'), 'the question is set only for a character made now, read before spawn.ts finishes creation (not a reroll or /chargen)');
ok(/if \(madeNow && askCyrodiil\(\)\) setStartChoice\(actorId >>> 0, 'asking'\)/.test(hook), '...and only while Skyrim is open');
ok(/__dboNamed = \(a\) => \{ if \(inHubForName\(a\)\) leaveRealm\(a\); \}/.test(src), 'a character named at last leaves the Realm through the same question');
ok(!/setTimeout\(\(\) => sendToArrival\(a\), (wait|DEITY_STEP_MAX_MS)\)/.test(src), 'the deity step and its timeout no longer send straight to the arrival');
ok(/else startLogin\(a\); return; \}/.test(src), 'the client\'s arrival report in the Realm runs startLogin');
ok(/'__dboRacialLeave', '__dboStartLeave'\]/.test(src), 'every logout runs __dboStartLeave');
ok(src.indexOf("onUi('startChoose'") > src.indexOf('const onUi = '), 'the answers are registered below onUi (a top-level call above it fails the whole load)');
const gate = src.slice(src.indexOf('const g = gateOf(targetId >>> 0);'), src.indexOf('const prev = globalThis.__dboPrevActivate;'));
ok(/if \(g && creationPending\(casterId >>> 0\)\) \{ gateCreationTold\(casterId >>> 0\); return false; \}/.test(gate), 'a gate refuses a character still being made, and tells them why');
ok(gate.indexOf('gateAnswersStart') > 0 && /pos: gateSpotFor\(g, casterId >>> 0\)/.test(gate), 'a gate answers the question and lands on one of its spread spots');
ok(/Cyrodiil or Skyrim\?/.test(block) && /Pale Pass/.test(block) && /gate of a hold/.test(block), 'the question names both lands and where each answer leads');
console.log(fails ? `${fails} failure(s)` : 'all checks passed'); process.exit(fails ? 1 : 0);
