// Staff "real names" mode (/realnames, Jake 14 Oct 2026): "an option to see all player names instead of 'stranger' as an
// admin ... a mode that can be toggled on and off". Every staff rank (GM and above, and Trial GMs through staffCan
// 'realnames') sees every player by their own name, and "Aldric (masked)" / "Bryn (Werewolf form)" behind a disguise, on
// their own screen only; off at every login. The server puts a marker on the staff member's own (owner-only) ff_knownIds,
// { reveal: 1, labels }, which the 0.3.97 client reads as "show every name", and keeps their true introductions in
// private.dboKnownStash until the mode ends.
//
// Loads the real playermenu.js with a stub api (as mask-name-harness.js does), and cuts the tier code, the command gate,
// /players and the U panel's player list out of gamemode.js (as trial-gm-harness.js and roster-privacy-harness.js do).
//   node tests/real-names-harness.js                    (from server/)
//   REVEAL_ROOT=<another server/ copy> node tests/real-names-harness.js      the same checks against that copy
//   PLAYERMENU=<file> GAMEMODE=<file> CONFIG=<file>      one file from elsewhere (git show 6b37238cd:playermenu.js > x)
//   FORK=<client tree>                                    also pins the client rule the mode stands on (R21)
// Every check fails on origin/server 6b37238cd (the mode does not exist there) unless it is marked "guard".
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.env.REVEAL_ROOT ? path.resolve(process.env.REVEAL_ROOT) : path.resolve(__dirname, '..');
const FILE = (env, name) => (process.env[env] ? path.resolve(process.env[env]) : path.join(ROOT, name));
const PM_FILE = FILE('PLAYERMENU', 'playermenu.js'), GM_FILE = FILE('GAMEMODE', 'gamemode.js'), CFG_FILE = FILE('CONFIG', 'gamemode-config.json');
const GMSRC = fs.readFileSync(GM_FILE, 'utf8');
let fails = 0, passes = 0;
const ok = (label, cond, got) => { if (cond) passes++; else fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 500) : ''}`); };
// A step that throws is a FAIL line, never a crash
const step = (label, fn) => { try { fn(); } catch (e) { ok(`${label} (threw: ${e.message})`, false); } };
const cut = (from, to) => { const a = GMSRC.indexOf(from), b = a < 0 ? -1 : GMSRC.indexOf(to, a + 1); return a < 0 || b < 0 ? null : GMSRC.slice(a, b); };

// ---- the world -----------------------------------------------------------------------------------------------------------
// GM Gerd and Trial GM Tria are staff; Ulla is a player. Pell walks unmasked and has met nobody; Aldric wears a mask;
// Bryn is a werewolf; Cass put a mask on and then took a beast form; Lost shows the mask's name with no name kept (#7DJT)
const GM = 0xff000011, TRIAL = 0xff000015, PLAYER = 0xff000014, P = 0xff000021, M = 0xff000022, B = 0xff000023, CASS = 0xff000024,
  LOST = 0xff000025, Q = 0xff000026, OFFGM = 0xff000027;
const ROLE = { gm: 'g1', trial: 't1', player: 'p1' };
const actors = {
  [GM]: { profile: 6, roles: [ROLE.gm], tag: 'GERD' }, [TRIAL]: { profile: 9, roles: [ROLE.trial, ROLE.player], tag: 'TRIA' },
  [PLAYER]: { profile: 8, roles: [ROLE.player], tag: 'ULLA' }, [P]: { profile: 21, roles: [], tag: 'PELL' }, [M]: { profile: 22, roles: [], tag: 'AB12' },
  [B]: { profile: 23, roles: [], tag: 'BRYN' }, [CASS]: { profile: 24, roles: [], tag: 'CASS' }, [LOST]: { profile: 25, roles: [], tag: 'LOST' },
  [Q]: { profile: 26, roles: [], tag: 'QUIN' }, [OFFGM]: { profile: 27, roles: [ROLE.gm], tag: 'OFFG' },
};
const props = new Map();
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
let gets = 0;
const sets = [];
const mp = {
  get: (a, k) => { gets++; return clone(props.get(`${a >>> 0}|${k}`)); },
  set: (a, k, v) => { sets.push({ a: a >>> 0, k, v: clone(v) }); props.set(`${a >>> 0}|${k}`, clone(v)); },
  getIdFromDesc: () => 0xfe00b808, getDescFromId: (id) => id.toString(16),
  callPapyrusFunction: () => {}, lookupEspmRecordById: () => ({ record: { editorId: 'NordRace' } }),
};
const P_ = (a, k, v) => props.set(`${a >>> 0}|${k}`, clone(v));
const G_ = (a, k) => clone(props.get(`${a >>> 0}|${k}`));
const here = { cellOrWorldDesc: '3c:Skyrim.esm', pos: [0, 0, 0], rot: [0, 0, 0] };
const NAMES = { [GM]: 'Gerd', [TRIAL]: 'Tria', [PLAYER]: 'Ulla', [P]: 'Pell', [M]: 'Masked Person', [B]: 'Werewolf', [CASS]: 'Werewolf', [LOST]: 'Masked Person', [Q]: 'Quin', [OFFGM]: 'Offa' };
const world = () => {
  props.clear();
  for (const [id, name] of Object.entries(NAMES)) { P_(id, 'appearance', { name, raceId: 1, isFemale: false }); P_(id, 'locationalData', here); P_(id, 'maskName', ''); }
  P_(M, 'maskName', 'Aldric'); P_(CASS, 'maskName', 'Cass');
  P_(B, 'private.beast', { form: 'werewolf', original: { name: 'Bryn' } }); P_(CASS, 'private.beast', { form: 'werewolf', original: { name: 'Masked Person' } });
  // LOST: the mask is on (maskName set) but what it keeps is the mask's own name
  P_(LOST, 'maskName', 'Masked Person');
  // The GM has met Quin, the player has met nobody
  P_(GM, 'ff_knownIds', [Q]); P_(PLAYER, 'ff_knownIds', []); P_(TRIAL, 'ff_knownIds', []);
};
world();
let online = [GM, TRIAL, PLAYER, P, M, B, CASS, LOST, Q];
globalThis.__dboBeastName = (a) => ((a >>> 0) === B || (a >>> 0) === CASS ? 'Werewolf' : '');

// ---- the tiers and the gate, cut out of gamemode.js ------------------------------------------------------------------------
let T = null;
step('the tier code is cut from gamemode.js', () => {
  const tierCode = cut('const tierFrom = ', 'const TIER_LABEL');
  if (!tierCode) throw new Error('tier markers gone');
  T = new Function('ADMIN_PROFILES', 'TIERS', 'tierRoles', 'trialRoles', 'legacyAdminRoles', 'profileOf', 'rolesOf', 'idList', 'audit', 'who', 'personal', 'userOf', 'mp', 'log', 'setTimeout',
    tierCode + '\nreturn { tierOf, isAdmin, isLeadStaff, isTrialStaff, staffCan, staffTierOf, TRIAL_CAN, TRIAL_COMMANDS };')(
    new Set(), ['senior', 'developer', 'leadgm', 'gm'], { senior: [], developer: [], leadgm: [], gm: [ROLE.gm] }, [ROLE.trial], [],
    (x) => (actors[x >>> 0] || { profile: -1 }).profile, (x) => (actors[x >>> 0] || { roles: [] }).roles, (v) => (Array.isArray(v) ? v.map(String) : []),
    () => {}, String, () => {}, () => -1, { kick: () => {} }, () => {}, () => {});
});
if (!T) { console.log(`\n${fails} FAILED`); process.exit(1); }
const TIER_LABEL = (() => { try { return new Function(`${GMSRC.match(/const TIER_LABEL = \{[^}]+\};/)[0]} return TIER_LABEL;`)(); } catch (e) { return {}; } })();
const LEAD_ONLY = (() => { try { return new Function(`return ${cut('const LEAD_ONLY = new Set([', ']);').replace('const LEAD_ONLY = ', '')}]);`)(); } catch (e) { return new Set(); } })();

// ---- playermenu.js, loaded as gamemode.js loads it ---------------------------------------------------------------------
const said = [], logs = [], packets = [], ui = new Map(), timers = new Map(), commands = new Map();
const savedTimeout = global.setTimeout; const later = []; global.setTimeout = (fn) => { later.push(fn); return 0; };
const runLater = () => { while (later.length) later.shift()(); };
let fakeNow = 1_900_000_000_000; const savedNow = Date.now; Date.now = () => fakeNow;
const nameOf = (a) => (G_(a, 'appearance') || {}).name || 'Stranger';
const tagOf = (a) => (actors[a >>> 0] || { tag: '????' }).tag;
const display = (a) => `${nameOf(a)} #${tagOf(a)}`;
// The api's nameOf, counted: the live one reads the appearance, a large native read (R23)
let nameReads = 0;
const countedNameOf = (a) => { nameReads++; return nameOf(a); };
const cfg = { playerMenu: {} };
try { const j = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); cfg.playerMenu = JSON.parse(JSON.stringify(j.playerMenu || {})); } catch (e) { /* defaults */ }
const api = () => ({
  mp, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => said.push({ a: a >>> 0, t: String(t) }), system: (a, t) => said.push({ a: a >>> 0, t: String(t), sys: true }),
  registerChatCommand: (n, fn, o) => commands.set(n, { fn, admin: !!(o && o.admin), help: (o && o.help) || '' }),
  onUi: (n, fn) => ui.set(n, fn), sendPacket: (a, p) => { packets.push({ a: a >>> 0, p }); return true; }, display, nameOf: countedNameOf, tagOf,
  profileOf: (a) => (actors[a >>> 0] || { profile: -1 }).profile, onlineActors: () => online.slice(), isAdmin: T.isAdmin, isLeadStaff: T.isLeadStaff,
  staffCan: T.staffCan, ranksOf: () => [], giveItem: () => true, makeProp: () => {}, runCommand: () => {}, zones: {}, zoneOfActor: () => null, cfg,
  every: (name, ms, fn) => timers.set(name, { ms, fn }),
});
const load = () => { delete require.cache[PM_FILE]; require(PM_FILE)(api()); runLater(); };
step('playermenu.js loads against the stub api', load);
const nameFor = (v, t) => globalThis.__dboNameFor(v >>> 0, t >>> 0);
const cmd = (a, args) => { const c = commands.get('realnames'); if (!c) throw new Error('no /realnames command'); said.length = 0; c.fn(a, args || ''); return said.filter((s) => s.a === (a >>> 0)).map((s) => s.t).join(' | '); };
const sweep = () => { const t = timers.get('realnames'); if (!t) throw new Error('no realnames sweep timer'); t.fn(); };
const known = (a) => G_(a, 'ff_knownIds');
const stash = (a) => G_(a, 'private.dboKnownStash');
const isMarker = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && v.reveal === 1;
const sameSet = (x, y) => Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v) => y.includes(v));
const hex = (a) => (a >>> 0).toString(16);

// ---- R1: the command --------------------------------------------------------------------------------------------------
step('R1', () => {
  const c = commands.get('realnames');
  ok('R1 playermenu.js registers /realnames, admin: true, with an [on|off|status] usage', !!c && c.admin === true && /^\[on\|off\|status\] /.test(c.help), c && { admin: c.admin, help: c.help });
  const forms = require(path.join(ROOT, 'commandforms.js'));
  const f = c && forms.formOf ? forms.formOf(c.help) : null;
  ok('R1 ...the U panel reads its usage as four choices (bare, on, off, status) and nothing more',
    !!f && f.variants.map((v) => v.word === null ? '' : v.word).join() === ',on,off,status' && f.variants.every((v) => v.args.length === 0), f);
  const pmHelp = cut("{ key: 'players', title: 'Players', items: [", '] },');
  ok('R1 ...listed under /help admin players (STAFF_HELP), and in the Trial GM list (TRIAL_HELP)', !!pmHelp && /'realnames'/.test(pmHelp)
    && /\['realnames', '\[on\|off\|status\]: /.test(cut('const TRIAL_HELP = [', '\n];') || ''), pmHelp);
});

// The U panel (press U, or / alone), built by gamemode.js's own help and panel code with the real tiers: the Staff tab
step('R1 panel', () => {
  const section = cut('const commands = new Map();', "registerChatCommand('players'"), panel = cut('// ---- the player panel (U)', 'globalThis.__dboPanelLeave');
  if (!section || !panel) throw new Error('the help or panel markers are gone');
  const run = new Function('personal', 'isAdmin', 'deliver', 'C', 'profileOf', 'ranksOf', 'openWidget', 'closeWidget', 'onUi', 'userOf', 'handleChat',
    'require', 'path', 'log', 'LEAD_ONLY', 'isLeadStaff', 'onlineActors', 'display', 'tagOf', 'mp', 'isTrialStaff', 'staffCan', 'TRIAL_COMMANDS', 'ownNameOf', 'disguisedOf',
    section + panel + '\nreturn { registerChatCommand, panelTabsFor };')(
    () => {}, T.isAdmin, () => {}, { WHITE: 'fafafa', SYS: 'eda841' }, (a) => (actors[a >>> 0] || { profile: -1 }).profile, () => [], () => {}, () => {}, () => {}, (a) => a, () => {},
    require, { resolve: (x) => path.resolve(ROOT, x) }, () => {}, LEAD_ONLY, T.isLeadStaff, () => online.slice(), display, tagOf, { get: () => undefined },
    T.isTrialStaff, T.staffCan, T.TRIAL_COMMANDS, nameOf, () => false);
  for (const [n, c] of commands) run.registerChatCommand(n, c.fn, { admin: c.admin, help: c.help });
  run.registerChatCommand('kick', () => {}, { admin: true, help: '<player>' });
  const staffTab = (a) => run.panelTabsFor(a).filter((t) => t.key === 'staff').flatMap((t) => t.entries);
  const gm = staffTab(GM).find((e) => e.name === 'realnames'), trial = staffTab(TRIAL).find((e) => e.name === 'realnames');
  ok('R1 U panel: /realnames is in a GM\'s Staff tab under Players, with the choices bare, on, off, status', !!gm && gm.section === 'Players' && !!gm.form
    && gm.form.variants.map((v) => v.word === null ? '' : v.word).join() === ',on,off,status', gm);
  ok('R1 ...and in a Trial GM\'s, beside none of the GM-only commands', !!trial && !staffTab(TRIAL).some((e) => e.name === 'kick'), staffTab(TRIAL).map((e) => e.name));
  ok('R1 ...a player has no Staff tab', staffTab(PLAYER).length === 0);
});

// ---- R2/R3: who may ------------------------------------------------------------------------------------------------------
step('R3', () => {
  ok('R3 staffCan(TRIAL, realnames) is true, staffCan(PLAYER, realnames) is false, a GM passes as an admin',
    T.staffCan(TRIAL, 'realnames') === true && T.staffCan(PLAYER, 'realnames') === false && T.staffCan(GM, 'realnames') === true && T.isAdmin(TRIAL) === false,
    [T.staffCan(TRIAL, 'realnames'), T.staffCan(PLAYER, 'realnames')]);
  ok('R3 ...the Trial GM command map opens /realnames to that right', T.TRIAL_COMMANDS && T.TRIAL_COMMANDS.realnames === 'realnames', T.TRIAL_COMMANDS);
});
const gateRun = (() => {
  const g = cut('  const c = commands.get(cmd);', "  try { c.fn(a, body, userId); }");
  if (!g) return null;
  return new Function('commands', 'personal', 'isAdmin', 'staffCan', 'TRIAL_COMMANDS', 'LEAD_ONLY', 'isLeadStaff', 'staffLog', 'display', 'tierOf', 'staffTierOf',
    'staffWho', 'TIER_LABEL', 'log', 'hasPlayerMenu', 'a', 'cmd', 'body', 'userId', 'remote', 'dry', g + '  c.fn(a, body, userId);\n  return \'ran\';');
})();
const staffLines = [];
const gate = (a, line) => {
  if (!gateRun) throw new Error('the command gate markers are gone');
  const i = line.indexOf(' '); const c = i < 0 ? line : line.slice(0, i); const body = i < 0 ? '' : line.slice(i + 1);
  said.length = 0;
  return gateRun(commands, (x, t) => said.push({ a: x >>> 0, t: String(t) }), T.isAdmin, T.staffCan, T.TRIAL_COMMANDS, LEAD_ONLY, T.isLeadStaff,
    (w, tier, what, detail) => staffLines.push({ w, tier, what, detail }), display, T.tierOf, T.staffTierOf, display, TIER_LABEL, () => {}, () => false, a, c, body, 1);
};

// ---- R4: off by default (guard) ----------------------------------------------------------------------------------------
step('R4', () => {
  globalThis.__dboPlayerMenuReady(GM);
  ok('R4 guard: off by default; after load and login the GM sees an unmet player as Stranger, and keeps the same list',
    nameFor(GM, P) === 'Stranger' && nameFor(GM, Q) === 'Quin' && sameSet(known(GM), [Q]) && Array.isArray(known(GM)), [nameFor(GM, P), known(GM)]);
});

// ---- R2: the gate ----------------------------------------------------------------------------------------------------------
step('R2', () => {
  staffLines.length = 0;
  const rg = gate(GM, 'realnames status');
  const gmLines = staffLines.slice(); staffLines.length = 0;
  const rt = gate(TRIAL, 'realnames status');
  const trialLines = staffLines.slice(); staffLines.length = 0;
  const rp = gate(PLAYER, 'realnames on');
  const playerTold = said.map((s) => s.t);
  ok('R2 the gate admits a GM to /realnames, with one #staff-commands line', rg === 'ran' && gmLines.length === 1 && /\(GM\): \/realnames status/.test(gmLines[0].detail), { rg, gmLines });
  ok('R2 ...and a Trial GM, labelled Trial GM', rt === 'ran' && trialLines.length === 1 && trialLines[0].tier === 'trialgm' && /\(Trial GM\): \/realnames/.test(trialLines[0].detail), { rt, trialLines });
  ok('R2 ...a player is refused with "Admins only." and nothing is logged', rp === 'refused' && playerTold.includes('Admins only.') && staffLines.length === 0 && !isMarker(known(PLAYER)), { rp, playerTold });
});

// ---- R5/R6/R7/R8: on -------------------------------------------------------------------------------------------------------
const before = known(GM);
let onText = '';
sets.length = 0;
step('R5', () => {
  onText = cmd(GM, 'on');
  const v = known(GM);
  ok('R5 /realnames on: the GM\'s ff_knownIds becomes { reveal: 1, labels }', isMarker(v) && v.labels && typeof v.labels === 'object' && !Array.isArray(v.labels), v);
  ok('R5 ...and private.dboKnownStash holds the old list exactly', JSON.stringify(stash(GM)) === JSON.stringify(before), [stash(GM), before]);
  ok('R5 ...the GM is told what changes, that only their screen does, and how to stop', /^Real names on: /.test(onText) && /Only your screen/.test(onText) && /\/realnames off/.test(onText), onText);
  ok('R5 ...and the server log says so', logs.some((l) => /^realnames: Gerd #GERD on \(command\)$/.test(l)), logs.slice(-3));
});
step('R6', () => {
  ok('R6 while on: an unmet player by their own name', nameFor(GM, P) === 'Pell', nameFor(GM, P));
  ok('R6 ...a mask as "Aldric (masked)"', nameFor(GM, M) === 'Aldric (masked)', nameFor(GM, M));
  ok('R6 ...a werewolf as "Bryn (Werewolf form)"', nameFor(GM, B) === 'Bryn (Werewolf form)', nameFor(GM, B));
  ok('R6 ...a mask then a beast form as "Cass (masked, Werewolf form)"', nameFor(GM, CASS) === 'Cass (masked, Werewolf form)', nameFor(GM, CASS));
  ok('R6 ...a mask with the own name lost as such, never a guess', nameFor(GM, LOST) === 'Masked Person (masked, own name lost)', nameFor(GM, LOST));
  ok('R6 ...someone introduced, by name as before', nameFor(GM, Q) === 'Quin', nameFor(GM, Q));
});
step('R7', () => {
  ok('R7 privacy: a player in the same world still sees Stranger and Masked Person', nameFor(PLAYER, P) === 'Stranger' && nameFor(PLAYER, M) === 'Masked Person' && nameFor(PLAYER, B) === 'Werewolf', [nameFor(PLAYER, P), nameFor(PLAYER, M)]);
  ok('R7 ...and the display hook names nothing for them', typeof globalThis.__dboRealNamesDisplay === 'function' && globalThis.__dboRealNamesDisplay(PLAYER, M) === '', typeof globalThis.__dboRealNamesDisplay);
  const n0 = sets.length;
  const r = typeof globalThis.__dboRealNamesSet === 'function' ? globalThis.__dboRealNamesSet(PLAYER, true, 'test') : 'missing';
  ok('R7 ...__dboRealNamesSet(PLAYER, true) returns false and writes nothing', r === false && sets.length === n0 && !isMarker(known(PLAYER)), r);
  ok('R7 ...nor does /realnames reach a player who calls the handler directly (second lock)', /Admins only/.test(cmd(PLAYER, 'on')) && !isMarker(known(PLAYER)));
});

// ---- R9/R10: the X menu and introductions while on --------------------------------------------------------------------
step('R9', () => {
  packets.length = 0; ui.get('playerMenu')(GM, [M]);
  const mine = packets.find((x) => x.a === GM && x.p.customPacketType === 'dboPlayerMenu');
  ok('R9 X on the masked player: the menu sent to the GM is titled "Aldric (masked)"', !!mine && mine.p.name === 'Aldric (masked)', mine && mine.p.name);
  ok('R10 ...the X press (ensureKnown) leaves the marker in place', isMarker(known(GM)), known(GM));
  packets.length = 0; ui.get('playerMenu')(PLAYER, [GM]);
  const theirs = packets.find((x) => x.a === PLAYER);
  ok('R9 a player pressing X on the GM is still offered Introduce, and sees the GM as a Stranger', !!theirs && theirs.p.entries.some((e) => e.id === 'introduce') && theirs.p.name === 'Stranger', theirs && theirs.p);
  sets.length = 0;
  ui.get('playerAction')(PLAYER, ['introduce', GM]);
  const wrote = sets.map((s) => `${hex(s.a)}|${s.k}`);
  ok('R9 introducing oneself to the GM writes the GM\'s stash, not the marker', wrote.includes(`${hex(GM)}|private.dboKnownStash`) && !wrote.includes(`${hex(GM)}|ff_knownIds`) && sameSet(stash(GM), [Q, PLAYER]), { wrote, stash: stash(GM) });
  ok('R9 ...the marker stays, and the GM is told who introduced themself', isMarker(known(GM)) && said.some((s) => s.a === GM && /Ulla introduces themself/.test(s.t)), known(GM));
  packets.length = 0; ui.get('playerMenu')(PLAYER, [GM]);
  ok('R9 ...and the next X shows the introduction was kept (no Introduce offered again)', !packets[0].p.entries.some((e) => e.id === 'introduce'), packets[0].p.entries.map((e) => e.id));
});
step('R10', () => {
  sweep();
  ok('R10 a sweep keeps the marker', isMarker(known(GM)) && nameFor(GM, P) === 'Pell');
  said.length = 0;
  load();
  ok('R10 a second module load (a hot reload) keeps the mode: the marker, the stash and the names', isMarker(known(GM)) && sameSet(stash(GM), [Q, PLAYER]) && nameFor(GM, P) === 'Pell' && nameFor(GM, M) === 'Aldric (masked)', known(GM));
  ok('R10 ...and tells the GM nothing', !said.some((s) => s.a === GM));
});

// ---- R17: the labels --------------------------------------------------------------------------------------------------------
step('R17', () => {
  sweep();
  const want = { [hex(M)]: 'Aldric (masked)', [hex(B)]: 'Bryn (Werewolf form)', [hex(CASS)]: 'Cass (masked, Werewolf form)', [hex(LOST)]: 'Masked Person (masked, own name lost)' };
  ok('R17 the labels are exactly the online disguised players, by actor hex', JSON.stringify(known(GM).labels) === JSON.stringify(want), known(GM).labels);
  const n0 = sets.length; sweep(); sweep();
  ok('R17 ...a sweep with nothing changed makes no mp.set', sets.length === n0, sets.slice(n0));
  // The GM puts a mask on himself: never a label of his own
  P_(GM, 'maskName', 'Gerd'); P_(GM, 'appearance', { name: 'Masked Person', raceId: 1 }); sweep();
  ok('R17 ...never the GM himself, masked or not', !(hex(GM) in known(GM).labels), Object.keys(known(GM).labels));
  P_(GM, 'maskName', ''); P_(GM, 'appearance', { name: 'Gerd', raceId: 1 }); sweep();
  // Pell presses H: the labels follow at once (mask()), and again when he takes it off
  fakeNow += 5000; ui.get('maskToggle')(P); runLater();
  ok('R17 a mask put on refreshes the labels at once', known(GM).labels[hex(P)] === 'Pell (masked)' && nameFor(GM, P) === 'Pell (masked)' && nameFor(PLAYER, P) === 'Masked Person', known(GM).labels);
  fakeNow += 5000; ui.get('maskToggle')(P); runLater();
  ok('R17 ...and one taken off drops it', !(hex(P) in known(GM).labels) && nameFor(GM, P) === 'Pell', known(GM).labels);
  const someone = online.filter((x) => ![GM, TRIAL].includes(x)).map(hex);
  ok('R17 ...never an unmasked player (Pell, Quin, Ulla)', ![P, Q, PLAYER].some((x) => hex(x) in known(GM).labels) && someone.length > 0);
});

// ---- R8: every write the mode makes ---------------------------------------------------------------------------------------
// The whole session so far plus off: the mode writes only the GM's own ff_knownIds and stash
const allSets = [];
const realSet = mp.set; mp.set = (a, k, v) => { allSets.push({ a: a >>> 0, k }); realSet(a, k, v); };

// ---- R11: off --------------------------------------------------------------------------------------------------------------
step('R11', () => {
  const t = cmd(GM, 'off');
  ok('R11 /realnames off: the list is the old one plus the introduction made while on', sameSet(known(GM), [Q, PLAYER]), known(GM));
  ok('R11 ...the stash is cleared', stash(GM) === null || stash(GM) === undefined, stash(GM));
  ok('R11 ...the unmet are Strangers again, the introduced are named', nameFor(GM, P) === 'Stranger' && nameFor(GM, PLAYER) === 'Ulla' && nameFor(GM, M) === 'Masked Person', [nameFor(GM, P), nameFor(GM, PLAYER)]);
  ok('R11 ...the GM is told, and the log says so', /^Real names off: /.test(t) && logs.some((l) => /^realnames: Gerd #GERD off \(command\)$/.test(l)), t);
  ok('R11 status says off', /^Real names are off/.test(cmd(GM, 'status')));
});
step('R8', () => {
  const staffSide = allSets.filter((s) => !(s.a === GM && (s.k === 'ff_knownIds' || s.k === 'private.dboKnownStash')));
  ok('R8 privacy: off writes only the GM\'s own ff_knownIds and stash', staffSide.length === 0 && allSets.length > 0, staffSide);
  allSets.length = 0;
  cmd(GM, 'on'); sweep(); ui.get('playerAction')(TRIAL, ['introduce', GM]); sweep(); cmd(GM, 'status');
  const other = allSets.filter((s) => !(s.a === GM && (s.k === 'ff_knownIds' || s.k === 'private.dboKnownStash')));
  ok('R8 ...and on, a sweep and an introduction to the GM likewise: no appearance, no ff_adminModes, no one else\'s list', other.length === 0 && allSets.length > 0, other);
  ok('R8 ...no other actor\'s ff_knownIds changed anywhere in the run', [PLAYER, TRIAL, P, M, B, CASS, LOST, Q].every((x) => !isMarker(known(x))) && sameSet(known(PLAYER), []));
});
mp.set = realSet;

// ---- R12: logout and login --------------------------------------------------------------------------------------------------
step('R12', () => {
  ok('R12 (on before logout)', isMarker(known(GM)), known(GM));
  said.length = 0;
  globalThis.__dboPlayerMenuLeave(GM);
  ok('R12 logout ends the mode and puts the list back, quietly', !isMarker(known(GM)) && sameSet(known(GM), [Q, PLAYER, TRIAL]) && (stash(GM) === null || stash(GM) === undefined) && !said.some((s) => s.a === GM), [known(GM), said]);
  globalThis.__dboPlayerMenuReady(GM);
  ok('R12 ...and after the next login it is off', nameFor(GM, P) === 'Stranger' && /^Real names are off/.test(cmd(GM, 'status')) && logs.some((l) => /realnames: Gerd #GERD off \(logout\)/.test(l)));
});

// ---- R13: crash, restart, rollback leftovers --------------------------------------------------------------------------------
step('R13', () => {
  // A restart: the Map is gone, the persisted marker and stash are not
  P_(GM, 'ff_knownIds', { reveal: 1, labels: { [hex(M)]: 'Aldric (masked)' } }); P_(GM, 'private.dboKnownStash', [Q, PLAYER]);
  if (globalThis.__dboRealNames instanceof Map) globalThis.__dboRealNames.clear();
  globalThis.__dboPlayerMenuReady(GM);
  ok('R13 a login with the marker and a stash and no mode on: the list comes back, the mode is off', sameSet(known(GM), [Q, PLAYER]) && stash(GM) === null && nameFor(GM, P) === 'Stranger', [known(GM), stash(GM)]);
  ok('R13 ...and the log says what was restored', logs.some((l) => /^realnames: restored 2 introductions for Gerd #GERD \(leftover from a crash or restart\)$/.test(l)), logs.slice(-2));
  // A rollback: the old code wrote [] over the marker and took an introduction into it; the stash waited
  P_(GM, 'ff_knownIds', [TRIAL]); P_(GM, 'private.dboKnownStash', [Q, PLAYER]);
  globalThis.__dboPlayerMenuReady(GM);
  ok('R13 a stash next to a list (a rollback) is merged in and cleared', sameSet(known(GM), [Q, PLAYER, TRIAL]) && stash(GM) === null, [known(GM), stash(GM)]);
  // X press on a leftover marker (no login in between)
  P_(GM, 'ff_knownIds', { reveal: 1, labels: {} }); P_(GM, 'private.dboKnownStash', [Q]);
  ui.get('playerMenu')(GM, [P]);
  ok('R13 ...an X press on a leftover marker restores too', sameSet(known(GM), [Q]) && stash(GM) === null, known(GM));
  P_(GM, 'ff_knownIds', [Q, PLAYER]);
});

// ---- R14: fail closed on reload ---------------------------------------------------------------------------------------------
step('R14', () => {
  cmd(GM, 'on');
  ui.get('playerAction')(TRIAL, ['introduce', GM]);
  // Other code (an older playermenu.js) writes a plain list over the marker, then the new code loads again
  P_(GM, 'ff_knownIds', []);
  said.length = 0;
  load();
  ok('R14 a reload finds the marker reset: the mode ends, it is not put back by itself', !isMarker(known(GM)) && !(globalThis.__dboRealNamesOn && globalThis.__dboRealNamesOn(GM)) && nameFor(GM, P) === 'Stranger', known(GM));
  ok('R14 ...the list comes back from the stash, the introduction made while on included', sameSet(known(GM), [Q, PLAYER, TRIAL]) && stash(GM) === null, [known(GM), stash(GM)]);
  ok('R14 ...and the GM is told', said.some((s) => s.a === GM && /^Real names off after a server update/.test(s.t)), said);
  sweep();
  ok('R14 ...nor does the next sweep put it back', !isMarker(known(GM)));
});

// ---- R15: the sweep ----------------------------------------------------------------------------------------------------------
step('R15', () => {
  cmd(GM, 'on');
  actors[GM].roles = [ROLE.player]; said.length = 0;
  sweep();
  ok('R15 the sweep ends the mode within one run when the rights are gone, and says why', !isMarker(known(GM)) && sameSet(known(GM), [Q, PLAYER, TRIAL]) && said.some((s) => s.a === GM && /no longer include them/.test(s.t)), [known(GM), said]);
  ok('R15 ...and /realnames then refuses', /Admins only/.test(cmd(GM, 'on')) && !isMarker(known(GM)));
  actors[GM].roles = [ROLE.gm];
  cmd(GM, 'on');
  online = online.filter((x) => x !== GM); said.length = 0;
  sweep();
  ok('R15 ...and quietly when the staff member is no longer online (a character switch the leave hook missed)', !isMarker(known(GM)) && sameSet(known(GM), [Q, PLAYER, TRIAL]) && !said.some((s) => s.a === GM), [known(GM), said]);
  online.push(GM);
});

// ---- R16: the kill switch ----------------------------------------------------------------------------------------------------
step('R16', () => {
  cmd(GM, 'on'); cmd(TRIAL, 'on');
  ok('R16 (a GM and a Trial GM on)', isMarker(known(GM)) && isMarker(known(TRIAL)));
  cfg.playerMenu.realNames = Object.assign({}, cfg.playerMenu.realNames || {}, { enabled: false });
  said.length = 0;
  load();
  ok('R16 a reload with realNames.enabled false ends every mode on and puts each list back', !isMarker(known(GM)) && !isMarker(known(TRIAL)) && sameSet(known(GM), [Q, PLAYER, TRIAL]) && sameSet(known(TRIAL), []), [known(GM), known(TRIAL)]);
  ok('R16 ...each is told staff switched it off', said.filter((s) => /staff switched the mode off/.test(s.t)).length === 2, said);
  const t = cmd(GM, 'on');
  ok('R16 ...and the command refuses with the switched-off text', /^Real names are switched off on this server just now\.$/.test(t) && !isMarker(known(GM)) && nameFor(GM, P) === 'Stranger', t);
  cfg.playerMenu.realNames.enabled = true;
  load();
});

// ---- R18: what it costs ------------------------------------------------------------------------------------------------------
step('R18', () => {
  ok('R18 (nobody in the mode)', !isMarker(known(GM)) && !isMarker(known(TRIAL)));
  const g1 = gets; const s0 = sets.length;
  sweep();
  ok('R18 with nobody in the mode a sweep makes 0 mp.get and 0 mp.set', gets === g1 && sets.length === s0, [gets - g1, sets.length - s0]);
});
step('R18 reads', () => {
  let g0;
  // As on 6b37238cd (this harness run there reads the same): the mask read and the list read for a player, the mask read
  // alone for a mask (the api's nameOf is not an mp.get here)
  g0 = gets; nameFor(PLAYER, P); const stranger = gets - g0;
  g0 = gets; nameFor(GM, Q); const met = gets - g0;
  g0 = gets; nameFor(GM, M); const mask = gets - g0;
  ok('R18 guard: nameFor for a viewer not in the mode makes the mp.get reads it made on 6b37238cd (2 for a stranger, 2 for someone met, 1 for a mask)', stranger === 2 && met === 2 && mask === 1, { stranger, met, mask });
});

// ---- R19: the remote console ----------------------------------------------------------------------------------------------------
step('R19', () => {
  const s0 = sets.length;
  P_(OFFGM, 'ff_knownIds', [Q]);
  globalThis.__dboTellCapture = { a: OFFGM, all: true, quiet: true, lines: [] };
  let t;
  try { t = cmd(OFFGM, 'on'); } finally { globalThis.__dboTellCapture = null; }
  ok('R19 /realnames on for a character not in the world (the remote console) is refused', /^Real names work only while your character is in the world\.$/.test(t), t);
  ok('R19 ...and writes nothing', sets.length === s0 && sameSet(known(OFFGM), [Q]) && G_(OFFGM, 'private.dboKnownStash') === undefined, sets.slice(s0));
  online.push(OFFGM);
  globalThis.__dboTellCapture = { a: OFFGM, all: true, quiet: false, lines: [] };
  try { cmd(OFFGM, 'on'); } finally { globalThis.__dboTellCapture = null; }
  ok('R19 ...while one in the world may, logged as from the console', isMarker(known(OFFGM)) && logs.some((l) => /^realnames: Offa #OFFG on \(console\)$/.test(l)), logs.slice(-2));
  globalThis.__dboPlayerMenuLeave(OFFGM); online = online.filter((x) => x !== OFFGM);
});

// ---- R20: /players and the U panel's player picker -------------------------------------------------------------------------
step('R20', () => {
  const playersLine = (GMSRC.match(/^registerChatCommand\('players', .*$/m) || [''])[0];
  const panelSrc = cut('const panelPeople = (a) => {', 'const panelTabsFor = ');
  if (!playersLine || !panelSrc) throw new Error('/players or panelPeople markers gone');
  const publicDisplay = (t) => `${(globalThis.__dboPublicName && globalThis.__dboPublicName(t)) || nameOf(t)} #${tagOf(t)}`;
  const runPlayers = (viewer) => {
    const reg = new Map(); const out = [];
    new Function('registerChatCommand', 'onlineActors', 'display', 'ownDisplay', 'publicDisplay', 'personal', playersLine)((n, f) => reg.set(n, f), () => online.slice(), display, publicDisplay, publicDisplay, (a, t) => out.push(t));
    reg.get('players')(viewer, ''); return out.join('\n');
  };
  const runPanel = (viewer) => new Function('onlineActors', 'isAdmin', 'isTrialStaff', 'display', 'tagOf', 'disguisedOf', `${panelSrc}\nreturn panelPeople;`)(
    () => online.slice(), T.isAdmin, T.isTrialStaff, display, tagOf, (t) => !!globalThis.__dboDisguised(t))(viewer);
  // today's answers: the same code with no real-names hook to call
  const hook = globalThis.__dboRealNamesDisplay;
  const asToday = (fn, v) => { globalThis.__dboRealNamesDisplay = undefined; try { return JSON.stringify(fn(v)); } finally { globalThis.__dboRealNamesDisplay = hook; } };
  const playerPlayersToday = asToday(runPlayers, PLAYER), playerPanelToday = asToday(runPanel, PLAYER), gmPanelOff = asToday(runPanel, GM);
  cmd(GM, 'on');
  const gmPlayers = runPlayers(GM), gmPanel = runPanel(GM);
  const am = gmPanel.find((x) => x.value === '#AB12');
  ok('R20 /players for the GM in the mode: "Aldric (masked) #AB12", and a beast by its label', /Aldric \(masked\) #AB12/.test(gmPlayers) && /Bryn \(Werewolf form\) #BRYN/.test(gmPlayers) && /Pell #PELL/.test(gmPlayers), gmPlayers);
  ok('R20 ...the U panel picker labels the mask "Aldric (masked) #AB12" and keeps the value "#AB12"', !!am && am.label === 'Aldric (masked) #AB12', gmPanel);
  ok('R20 ...for a player both are byte-identical to today', JSON.stringify(runPlayers(PLAYER)) === playerPlayersToday && JSON.stringify(runPanel(PLAYER)) === playerPanelToday, [runPlayers(PLAYER)]);
  cmd(GM, 'off');
  ok('R20 ...and for the GM with the mode off, the picker is as today', JSON.stringify(runPanel(GM)) === gmPanelOff);
});

// ---- R22: the sweep's pace stays in range, whatever the config says ---------------------------------------------------------
// Node runs a timer set above 2147483647 ms every 1 ms (TimeoutOverflowWarning), so a big sweepMs would run the sweep
// without pause: the pace is held to 500 ms .. 60 s (the reload review's required change, 14 Oct)
step('R22 pace', () => {
  const saved = cfg.playerMenu.realNames;
  const paceFor = (v) => { cfg.playerMenu.realNames = Object.assign({}, saved || {}, { sweepMs: v }); load(); const t = timers.get('realnames'); return t ? t.ms : undefined; };
  const want = [[1e10, 60000], [99999999999, 60000], [Infinity, 60000], ['1e10', 60000], [2147483648, 60000], [60001, 60000], [60000, 60000],
    [2000, 2000], [500, 500], [100, 500], [-5, 500], ['abc', 2000], [null, 2000]];
  const got = want.map(([v]) => paceFor(v));
  cfg.playerMenu.realNames = saved; load();
  const bad = want.map(([v, w], i) => (got[i] === w ? null : { sweepMs: String(v), want: w, got: got[i] })).filter(Boolean);
  ok('R22 the sweep never runs slower than every 60 s: sweepMs 1e10, 99999999999, Infinity and "1e10" all give 60000', got.slice(0, 7).every((x) => x === 60000), bad);
  ok('R22 ...never faster than every 500 ms, and a value that is not a number is the 2000 default', got.slice(7).join() === '2000,500,500,500,2000,2000', bad);
  ok('R22 ...so no pace reaches Node\'s 2147483647 ms timer limit (above it a timer fires every 1 ms)', got.every((x) => typeof x === 'number' && x >= 500 && x <= 2147483647), { got, bad });
});

// ---- R23: the cost with the mode on (the reload review's recommendations, 14 Oct) --------------------------------------------
step('R23 cost', () => {
  cmd(GM, 'on'); sweep();
  let g0 = gets; sweep(); const one = gets - g0;
  cmd(TRIAL, 'on'); sweep();
  g0 = gets; sweep(); const two = gets - g0;
  ok(`R23 a sweep reads each online player's disguise once, not once per staff member in the mode (a second one adds only its own list read): mp.get ${one} with one in the mode, ${two} with two`,
    one > 0 && two - one <= 2, { oneStaff: one, twoStaff: two });
  let n0 = nameReads; nameFor(GM, P); const plain = nameReads - n0;
  n0 = nameReads; globalThis.__dboRealNamesDisplay(GM, P); const disp = nameReads - n0;
  n0 = nameReads; nameFor(GM, M); const masked = nameReads - n0;
  ok('R23 for a staff viewer in the mode, nameFor and the /players label read a player\'s name once (it was twice for an undisguised one)',
    plain === 1 && disp === 1 && masked === 1, { plain, disp, masked });
  ok('R23 ...and give the same names', nameFor(GM, P) === 'Pell' && globalThis.__dboRealNamesDisplay(GM, P) === 'Pell #PELL' && nameFor(GM, M) === 'Aldric (masked)'
    && globalThis.__dboRealNamesDisplay(GM, B) === 'Bryn (Werewolf form) #BRYN', [nameFor(GM, P), globalThis.__dboRealNamesDisplay(GM, P)]);
  // guard: the labels read once are still each staff member's own: a masked GM is labelled to the Trial GM, never to himself
  P_(GM, 'maskName', 'Gerd'); P_(GM, 'appearance', { name: 'Masked Person', raceId: 1 }); sweep();
  ok('R23 guard: with two in the mode, a masked GM is "Gerd (masked)" in the Trial GM\'s labels and absent from his own, and both hold every other disguise',
    !(hex(GM) in known(GM).labels) && known(TRIAL).labels[hex(GM)] === 'Gerd (masked)' && known(GM).labels[hex(M)] === 'Aldric (masked)' && known(TRIAL).labels[hex(M)] === 'Aldric (masked)'
    && !(hex(TRIAL) in known(TRIAL).labels) && Object.keys(known(TRIAL).labels).length === Object.keys(known(GM).labels).length + 1, [known(GM).labels, known(TRIAL).labels]);
  P_(GM, 'maskName', ''); P_(GM, 'appearance', { name: 'Gerd', raceId: 1 }); sweep();
  ok('R23 guard: ...and unmasked he is gone from the Trial GM\'s labels again', !(hex(GM) in known(TRIAL).labels), known(TRIAL).labels);
  cmd(GM, 'off'); cmd(TRIAL, 'off');
  ok('R23 (both off again)', !isMarker(known(GM)) && !isMarker(known(TRIAL)));
});

// ---- R24: a playermenu.js load that throws part way ends every mode on (fail closed) ------------------------------------------
// gamemode.js's own loader block, cut out and run, with a playermenu.js that throws at its first every() call: after
// __dboNameFor is set, before the realnames sweep is registered (the privacy review's case, 14 Oct). Its catch nulls the
// leave and login hooks, so a mode left on would outlast a logout and lost rights
step('R24 failed load', () => {
  const a0 = GMSRC.indexOf("try {\n  const PLAYERMENU_JS = path.resolve('playermenu.js');");
  const b0 = a0 < 0 ? -1 : GMSRC.indexOf('\n}\n', GMSRC.indexOf('playermenu.js failed to load', a0));
  if (a0 < 0 || b0 < 0) throw new Error('the playermenu.js loader markers are gone');
  const block = GMSRC.slice(a0, b0 + 2);
  const A = api();
  const loader = new Function('path', 'commands', 'isAdmin', 'mp', 'log', 'personal', 'system', 'registerChatCommand', 'onUi', 'sendPacket', 'display', 'nameOf', 'tagOf',
    'profileOf', 'onlineActors', 'isLeadStaff', 'staffCan', 'ranksOf', 'giveItem', 'makeProp', 'ZONES', 'zoneOfActor', 'cfg', 'every', 'require', block);
  cmd(GM, 'on');
  ok('R24 (the GM is in the mode)', isMarker(known(GM)) && nameFor(GM, P) === 'Pell');
  const keepUi = new Map(ui), keepTimers = new Map(timers), prevNameFor = globalThis.__dboNameFor;
  loader({ resolve: () => PM_FILE }, new Map(), T.isAdmin, mp, A.log, A.personal, A.system, A.registerChatCommand, A.onUi, A.sendPacket, display, A.nameOf, tagOf,
    A.profileOf, A.onlineActors, T.isLeadStaff, T.staffCan, A.ranksOf, A.giveItem, A.makeProp, {}, A.zoneOfActor, cfg, () => { throw new Error('boom (harness)'); }, require);
  ok('R24 (the load threw where the review said: the hooks are cleared, __dboNameFor is the new partial load\'s)', globalThis.__dboPlayerMenuReady === null && globalThis.__dboRealNamesOn === null
    && typeof globalThis.__dboNameFor === 'function' && globalThis.__dboNameFor !== prevNameFor && logs.some((l) => /^playermenu\.js failed to load:/.test(l)));
  ok('R24 ...the arrival hook (__dboRealNamesLogin) is cleared with the login hook', globalThis.__dboRealNamesLogin === null, typeof globalThis.__dboRealNamesLogin);
  ok('R24 a load that throws part way ends the mode: the server names an unmet player Stranger to the GM again', nameFor(GM, P) === 'Stranger' && nameFor(GM, M) === 'Masked Person', [nameFor(GM, P), nameFor(GM, M)]);
  ok('R24 ...the server log says whose mode ended', logs.some((l) => /^realnames: Gerd #GERD off \(playermenu\.js failed to load\)$/.test(l)), logs.slice(-3));
  ui.get('playerMenu')(GM, [P]);
  ok('R24 ...and the next X press puts the true list back from the stash', !isMarker(known(GM)) && sameSet(known(GM), [Q, PLAYER, TRIAL]) && (stash(GM) === null || stash(GM) === undefined), [known(GM), stash(GM)]);
  for (const [k, v] of keepUi) ui.set(k, v); for (const [k, v] of keepTimers) timers.set(k, v);
  load();
  ok('R24 ...after a load that works the GM can turn it on again', /^Real names on: /.test(cmd(GM, 'on')) && /^Real names off: /.test(cmd(GM, 'off')) && sameSet(known(GM), [Q, PLAYER, TRIAL]));
});

// ---- R25: a marker a crash or a restart left behind is gone as the character appears, before loginSetup runs ----------------
// The 0.3.98 client draws a marker's labels ("Aldric (masked)") for as long as the list holds one, so gamemode.js's own
// onCharacterReady (cut out, a stub for every other name, as drift-own-look-harness.js does) must replace it at once, not
// loginSetup's 8 s timer (the 0.3.98 client verify's required change, 14 Oct). Fails on origin/server 5cba05cf4
step('R25 login', () => {
  const endMark = '  }), 8000);\n};';
  const a0 = GMSRC.indexOf('const loginStep = (name, fn) => {');
  const b0 = a0 < 0 ? -1 : GMSRC.indexOf(endMark, GMSRC.indexOf('const onCharacterReady = (userId, a) => {'));
  if (a0 < 0 || b0 < 0) throw new Error('the onCharacterReady markers are gone');
  const users = new Map([[1, GM], [2, PLAYER], [3, P]]), waits = [];
  // A stub that can be called, read or put in a string
  const any = new Proxy(function () {}, { get: (o, k) => (k === Symbol.toPrimitive ? () => '' : any), apply: () => undefined });
  const named = { globalThis, mp, cfg: {}, log: (...x) => logs.push(x.join(' ')), performance: { now: () => 0 }, LOGIN_STEP_WARN_MS: 100, timed: (n, fn) => fn,
    setTimeout: (fn, ms) => { waits.push({ ms, fn }); return 0; }, actorOf: (u) => users.get(u) || 0, creationPending: () => false, wornOf: () => [],
    staffCan: T.staffCan, ADMIN_PROP: 'harness.isAdmin', display, undefined, Date, JSON, Object, Array, String, Number, Math, Map, Set };
  const scope = new Proxy(named, { has: (o, k) => typeof k === 'string', get: (o, k) => (k in o ? o[k] : k === Symbol.unscopables ? undefined : any) });
  const onCharacterReady = new Function('scope', `with (scope) {\n${GMSRC.slice(a0, b0 + endMark.length)}\nreturn onCharacterReady;\n}`)(scope);
  const loginSetup = () => { const w = waits.filter((x) => x.ms === 8000); waits.length = 0; for (const x of w) x.fn(); return w.length; };
  const restored = () => logs.filter((l) => /^realnames: restored \d+ introductions for Gerd #GERD \(leftover from a crash or restart\)$/.test(l)).length;
  const listSets = (a, from) => sets.slice(from).filter((s) => s.a === (a >>> 0) && (s.k === 'ff_knownIds' || s.k === 'private.dboKnownStash'));

  // A restart with the GM in the mode: the Map is empty, the saved marker (labels and all) and the stash are not
  P_(GM, 'ff_knownIds', { reveal: 1, labels: { [hex(M)]: 'Aldric (masked)', [hex(B)]: 'Bryn (Werewolf form)' } }); P_(GM, 'private.dboKnownStash', [Q, PLAYER, TRIAL]);
  globalThis.__dboRealNames.clear(); waits.length = 0;
  const r0 = restored(), s0 = sets.length;
  onCharacterReady(1, GM);
  ok('R25 (the login run left loginSetup waiting on its 8 s timer, not yet run)', waits.some((x) => x.ms === 8000), waits.map((x) => x.ms));
  ok('R25 a marker a restart left in the GM\'s list is gone as the character appears, before loginSetup runs: the true list is back and the stash cleared',
    !isMarker(known(GM)) && sameSet(known(GM), [Q, PLAYER, TRIAL]) && stash(GM) == null, [known(GM), stash(GM)]);
  const w0 = listSets(GM, s0).filter((s) => s.k === 'ff_knownIds');
  ok('R25 ...so the client is sent one plain list, no labels', w0.length === 1 && Array.isArray(w0[0].v), w0);
  ok('R25 ...the log says what was restored, and the server names an unmet player Stranger to the GM', restored() === r0 + 1 && nameFor(GM, P) === 'Stranger', logs.slice(-3));
  const s1 = sets.length;
  const ran = loginSetup();
  ok('R25 ...loginSetup 8 s later finds nothing left over: no list written, no second restore, the mode off',
    ran === 1 && listSets(GM, s1).length === 0 && restored() === r0 + 1 && sameSet(known(GM), [Q, PLAYER, TRIAL]) && /^Real names are off/.test(cmd(GM, 'status')), listSets(GM, s1));

  // The leave hook never ran: the Map still holds the GM in the mode and the marker is saved
  cmd(GM, 'on');
  ok('R25 (the GM is in the mode again)', isMarker(known(GM)) && globalThis.__dboRealNamesOn(GM) === true);
  onCharacterReady(1, GM);
  ok('R25 ...a login with the mode still in the Map (a leave hook that never ran) ends it and puts the list back at once',
    !isMarker(known(GM)) && globalThis.__dboRealNamesOn(GM) === false && sameSet(known(GM), [Q, PLAYER, TRIAL]) && stash(GM) == null && nameFor(GM, P) === 'Stranger', [known(GM), stash(GM)]);
  loginSetup();

  // guard: a player's plain list and a new character with none are not written at arrival; loginSetup starts the empty list, as before
  props.delete(`${P >>> 0}|ff_knownIds`);
  const playerList = JSON.stringify(known(PLAYER)), s2 = sets.length;
  onCharacterReady(2, PLAYER); onCharacterReady(3, P);
  const atArrival = sets.slice(s2).filter((s) => s.k === 'ff_knownIds' || s.k === 'private.dboKnownStash');
  ok('R25 guard: the arrival writes no list for a player with a plain one, nor for a new character with none', atArrival.length === 0 && known(P) === undefined, atArrival);
  loginSetup();
  ok('R25 guard: ...and loginSetup then starts the new character\'s empty list and leaves the player\'s as it was', Array.isArray(known(P)) && known(P).length === 0
    && JSON.stringify(known(PLAYER)) === playerList, [known(P), known(PLAYER)]);
});

// ---- the config ------------------------------------------------------------------------------------------------------------
step('config', () => {
  const j = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
  const rn = (j.playerMenu || {}).realNames;
  ok('gamemode-config.json ships playerMenu.realNames on (enabled, labels, chat, sweepMs 2000), with its note', !!rn && rn.enabled === true && rn.labels === true && rn.chat === true && rn.sweepMs === 2000
    && /Jake, 14 Oct/.test(String((j.playerMenu || {})._realNames || '')), rn);
  ok('the sweep runs at the configured pace, never faster than 500 ms', !!timers.get('realnames') && timers.get('realnames').ms === 2000);
  ok('gamemode.js hands staffCan to playermenu.js, and its loader clears the hooks if the module fails', /require\(PLAYERMENU_JS\)\(\{[^}]*\bstaffCan\b/.test(GMSRC)
    && /playermenu\.js failed to load:[\s\S]{0,400}__dboRealNamesOn = null; globalThis\.__dboRealNamesLabel = null; globalThis\.__dboRealNamesDisplay = null; globalThis\.__dboRealNamesSet = null;/.test(GMSRC));
});

// ---- R21: the client rule the mode stands on (guard) -------------------------------------------------------------------------
if (process.env.FORK && fs.existsSync(path.join(process.env.FORK, 'skymp5-client/src/view/formView.ts'))) {
  step('R21', () => {
    const fv = fs.readFileSync(path.join(process.env.FORK, 'skymp5-client/src/view/formView.ts'), 'utf8');
    const ip = fs.readFileSync(path.join(process.env.FORK, 'skymp5-client/src/services/services/interactionPromptService.ts'), 'utf8');
    const tag = fv.slice(fv.indexOf('private tagName('), fv.indexOf('private isSweetHidePerson('));
    const kt = ip.slice(ip.indexOf('private knowsTarget('), ip.indexOf('private doorNameFor('));
    ok('R21 guard: the client nametag shows the real name when the owner\'s ff_knownIds is not an array', /owner\["ff_knownIds"\]/.test(tag) && /if \(!Array\.isArray\(known\)\) \{\s*return name;\s*\}/.test(tag), tag.slice(0, 300));
    ok('R21 guard: the crosshair prompt does the same', /owner\["ff_knownIds"\]/.test(kt) && /if \(!Array\.isArray\(known\)\) return true;/.test(kt), kt.slice(0, 300));
  });
} else console.log('note: no FORK client tree given, the client source checks (R21) are not run');

global.setTimeout = savedTimeout; Date.now = savedNow;
console.log(`\n${passes}/${passes + fails} passed`);
console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
