// Trial GM limits (staffguard.js trialLimits; the owner's staff-conduct review, 23 Oct 2026: about 470 place teleports and 9
// self-reopened character creations by one Trial GM): a Trial GM goes to no place (the F7 Teleport tab), reopens no
// character creation (their own included), and goes to a player (/tp, the F7 TP to, /gm goto) only while holding that
// player's open GM call. GMs and above are unchanged. Also cuts /chargen out of gamemode.js and checks the Trial GM help.
//   node tests/staff-trial-limits-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, CAST, load, call, check, done } = require('./lib/staffguard-fakes');
const { GM, TRIAL, TRIAL_RP, MIRA, BOB } = Object.fromEntries(Object.entries(CAST).map(([k, v]) => [k, v.id]));

let f = load({});
const gate = () => globalThis.__dboAdminGate;
const line = (a, cmd, body) => f.G.command(a, cmd, `${cmd} ${(String(body).split(/\s+/)[0] || '').toLowerCase()}`, body);

check('a Trial GM\'s place teleport is refused', /^A Trial GM goes to players on their GM calls, not to places\./.test(gate()(TRIAL, 'teleportLoc', { trial: true, location: 'Bruma' })));
check('...a GM\'s is not', gate()(GM, 'teleportLoc', { trial: false, location: 'Bruma' }) === '');
check('a Trial GM\'s TP to a player with no call is refused', /^A Trial GM goes only to a player whose GM call they hold/.test(gate()(TRIAL, 'teleportTo', { trial: true, target: MIRA })));
check('/tp likewise', /^A Trial GM goes only to a player whose GM call they hold/.test((line(TRIAL, 'tp', 'Mira') || {}).refuse || ''));
call(4, 50, null);
check('an open call nobody holds is not enough', gate()(TRIAL, 'teleportTo', { trial: true, target: MIRA }) !== '');
globalThis.__dboGmCalls.open[0].takenBy = { name: 'Helps', profile: 40 };
check('holding the player\'s open call, the Trial GM may TP to them', gate()(TRIAL, 'teleportTo', { trial: true, target: MIRA }) === '' && !(line(TRIAL, 'tp', 'Mira') || {}).refuse);
check('...but not to anyone else', gate()(TRIAL, 'teleportTo', { trial: true, target: BOB }) !== '' && !!(line(TRIAL, 'tp', 'Bob') || {}).refuse);
globalThis.__dboGmCalls.open.length = 0;
check('once the call closes, the TP is refused again', gate()(TRIAL, 'teleportTo', { trial: true, target: MIRA }) !== '');
check('a GM\'s TP needs no call', gate()(GM, 'teleportTo', { trial: false, target: MIRA }) === '' && !(line(GM, 'tp', 'Mira') || {}).refuse);

// /gm goto: a call nobody holds (goto takes it) or one the Trial GM holds
check('/gm goto on an untaken call is allowed (it takes the call)', f.G.gotoRefusal(TRIAL, { n: 4, takenBy: null }) === '');
check('/gm goto on a call the Trial GM holds is allowed', f.G.gotoRefusal(TRIAL, { n: 4, takenBy: { name: 'Helps', profile: 40 } }) === '');
check('/gm goto on another staff member\'s call is refused', /held by GM Gemma\. A Trial GM goes only on a call they hold/.test(f.G.gotoRefusal(TRIAL, { n: 4, takenBy: { name: 'GM Gemma', profile: 30 } })));
check('a GM may go on any call', f.G.gotoRefusal(GM, { n: 4, takenBy: { name: 'Helps', profile: 40 } }) === '');
check('the staff-character rule still comes first for a Trial GM on their RP character', /^Staff powers work only/.test(f.G.gotoRefusal(TRIAL_RP, { n: 4, takenBy: null })));

check('/chargen is refused for a Trial GM, their own included', /^A Trial GM does not reopen character creation/.test((line(TRIAL, 'chargen', '') || {}).refuse || '') && !!(line(TRIAL, 'chargen', 'Mira') || {}).refuse);
check('...a GM still opens it for a player', !(line(GM, 'chargen', 'Mira') || {}).refuse);

{
  f = load({ trialLimits: { enabled: false } });
  check('trialLimits.enabled false: places, TP and /chargen as before', gate()(TRIAL, 'teleportLoc', { trial: true }) === '' && gate()(TRIAL, 'teleportTo', { trial: true, target: MIRA }) === ''
    && !(line(TRIAL, 'chargen', '') || {}).refuse && f.G.gotoRefusal(TRIAL, { n: 4, takenBy: { name: 'GM Gemma', profile: 30 } }) === '');
}

// ---- gamemode.js: the Trial GM help leaves out what the rules close ----
const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
check('the Trial GM help skips a tool the staff rules refuse (/chargen)', /const closed = \(n\) => \{ try \{ const g = staffGuard\(\); const r = g \? g\.command\(a, n, n, ''\) : null; return !!\(r && r\.refuse\); \}/.test(src)
  && /if \(commands\.has\(n\) && !closed\(n\)\) personal\(a, `  \/\$\{n\} \$\{text\}`\);/.test(src));
check('...and says /tp is for a player whose call you hold', /\['tp', '<player\|#TAG>: go to a player whose GM call you hold'\]/.test(src));
done();
