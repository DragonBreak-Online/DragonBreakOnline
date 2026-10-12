// Trial GM (Nate, 11 Oct): a staff rank below GM from server-settings adminRoles.trialgm. It is no admin tier: isAdmin,
// isLeadStaff and tierOf stay as they were, and staffCan(a, what) opens an allowlist (rename, chargen, gmcall, tp, invis,
// playerinfo, bugs) in the commands that use it. Cuts the tier code and the chat command gate out of gamemode.js, lifts
// /tp and /chargen, and loads gmcall.js and debugsnap.js with stubs. The panel side is trial-gm-panel-harness.js, the
// extra character slot trial-gm-slot-harness.js.
//   node tests/trial-gm-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!ok) failures++; };
const cut = (from, to, label) => {
  const a = src.indexOf(from), b = src.indexOf(to, a + 1);
  if (a < 0 || b < 0) { console.log(`FAIL the ${label} markers are gone from gamemode.js`); process.exit(1); }
  return src.slice(a, b);
};

// ---- the tiers ---------------------------------------------------------------------------------------------------------
const ROLE = { senior: 's1', leadgm: 'l1', gm: 'g1', trial: 't1', player: 'p1' };
const GM = 0x11, TRIAL = 0x15, BOTH = 0x16, LEAD = 0x12, PLAYER = 0x14, OWNER = 0x10;
const actors = {
  [OWNER]: { profile: 1, roles: [] }, [GM]: { profile: 6, roles: [ROLE.gm] }, [LEAD]: { profile: 7, roles: [ROLE.leadgm] },
  [PLAYER]: { profile: 8, roles: [ROLE.player] }, [TRIAL]: { profile: 9, roles: [ROLE.trial, ROLE.player] }, [BOTH]: { profile: 10, roles: [ROLE.trial, ROLE.gm] },
};
const tierCode = cut('const tierFrom = ', 'const TIER_LABEL', 'tier');
const tiers = (trialRoles) => new Function('ADMIN_PROFILES', 'TIERS', 'tierRoles', 'trialRoles', 'legacyAdminRoles', 'profileOf', 'rolesOf', 'idList',
  'audit', 'who', 'personal', 'userOf', 'mp', 'log', 'setTimeout',
  tierCode + '\nreturn { tierFrom, tierOf, isAdmin, isLeadStaff, isTrialStaff, staffCan, staffTierOf, TRIAL_CAN, TRIAL_COMMANDS, TIER_RANK };')(
  new Set([1]), ['senior', 'developer', 'leadgm', 'gm'], { senior: [ROLE.senior], developer: [], leadgm: [ROLE.leadgm], gm: [ROLE.gm] }, trialRoles, [],
  (x) => actors[x].profile, (x) => actors[x].roles, (v) => (Array.isArray(v) ? v.map(String) : []),
  () => {}, String, () => {}, () => -1, { kick: () => {} }, () => {}, () => {});
const T = tiers([ROLE.trial]);
check('the Trial GM role reads from adminRoles.trialgm in server-settings', /const trialRoles = idList\(\(serverSettings\.adminRoles \|\| \{\}\)\.trialgm\);/.test(src));
check('a Trial GM is no admin tier: tierOf null, isAdmin and isLeadStaff false', T.tierOf(TRIAL) === null && T.isAdmin(TRIAL) === false && T.isLeadStaff(TRIAL) === false, [T.tierOf(TRIAL), T.isAdmin(TRIAL)]);
check('...but is a Trial GM, logged as trialgm', T.isTrialStaff(TRIAL) === true && T.staffTierOf(TRIAL) === 'trialgm', T.staffTierOf(TRIAL));
check('GM and Trial GM roles together give GM', T.tierOf(BOTH) === 'gm' && T.isAdmin(BOTH) && !T.isTrialStaff(BOTH) && T.staffTierOf(BOTH) === 'gm', [T.tierOf(BOTH), T.isTrialStaff(BOTH)]);
check('a GM, a Lead GM, an Owner and a player are unchanged', T.tierOf(GM) === 'gm' && T.tierOf(LEAD) === 'leadgm' && T.tierOf(OWNER) === 'senior' && T.tierOf(PLAYER) === null && !T.isTrialStaff(PLAYER));
check('the rank sits below GM', T.TIER_RANK.trialgm > 0 && T.TIER_RANK.trialgm < T.TIER_RANK.gm);
const ALLOWED = ['rename', 'chargen', 'gmcall', 'tp', 'invis', 'playerinfo', 'bugs', 'adminchat', 'unstuck'];
check('exactly the nine rights are on the allowlist (adminchat: #gm-chat 12 Oct; unstuck: Nate 12 Oct)', [...T.TRIAL_CAN].sort().join() === ALLOWED.slice().sort().join(), [...T.TRIAL_CAN]);
check('a Trial GM has each of them', ALLOWED.every((w) => T.staffCan(TRIAL, w)));
const FORBIDDEN = ['kick', 'ban', 'items', 'gold', 'skills', 'stats', 'housing', 'faction', 'nobility', 'world', 'spawn', 'summon', 'console', 'jail', ''];
check('...and none of the others', FORBIDDEN.every((w) => !T.staffCan(TRIAL, w)), FORBIDDEN.filter((w) => T.staffCan(TRIAL, w)));
check('a player has none, a GM all (the admin checks still decide for staff tiers)', ALLOWED.every((w) => !T.staffCan(PLAYER, w)) && ALLOWED.concat(['kick']).every((w) => T.staffCan(GM, w)));
const NOKEY = tiers([]);
check('without adminRoles.trialgm nobody is a Trial GM and nothing opens', !NOKEY.isTrialStaff(TRIAL) && NOKEY.staffTierOf(TRIAL) === null && ALLOWED.every((w) => !NOKEY.staffCan(TRIAL, w)));

// ---- the chat command gate ---------------------------------------------------------------------------------------------
const LEAD_ONLY = new Function(`return ${cut('const LEAD_ONLY = new Set([', ']);', 'LEAD_ONLY').replace('const LEAD_ONLY = ', '')}]);`)();
check('LEAD_ONLY is read, and /chargen is not in it (every GM, Nate 12 Oct)', !LEAD_ONLY.has('chargen') && LEAD_ONLY.has('wipechars'));
const TIER_LABEL = new Function(`${src.match(/const TIER_LABEL = \{[^}]+\};/)[0]} return TIER_LABEL;`)();
check('the Trial GM has a label in the staff log', TIER_LABEL.trialgm === 'Trial GM');
const gateCode = cut('  const c = commands.get(cmd);', "  try { c.fn(a, body, userId); }", 'command gate') + '  c.fn(a, body, userId);';
const ran = [], said = [], logged = [];
const commands = new Map();
// Every staff command a Trial GM must be refused, beside the five they may run
const STAFF_CMDS = ['rename', 'chargen', 'tp', 'charstats', 'bugs', 'kick', 'fixloc', 'sethunger', 'wipechars', 'announce', 'staffstats', 'stats',
  'settime', 'setweather', 'timescale', 'region', 'warband', 'raid', 'placed', 'placeundo', 'placeexport', 'gearswap', 'feedpair', 'vlremote', 'driftspawn', 'adminhelp'];
for (const n of STAFF_CMDS) commands.set(n, { admin: true, fn: (a, body) => ran.push([a, n, body]) });
for (const n of ['faction', 'manual', 'boost', 'appoint', 'gm']) commands.set(n, { admin: false, fn: (a, body) => ran.push([a, n, body]) });
const gate = new Function('commands', 'personal', 'isAdmin', 'staffCan', 'TRIAL_COMMANDS', 'LEAD_ONLY', 'isLeadStaff', 'staffLog', 'display', 'tierOf', 'staffTierOf',
  'staffWho', 'TIER_LABEL', 'log', 'a', 'cmd', 'body', 'userId', gateCode);
const chat = (a, line) => { ran.length = 0; said.length = 0; logged.length = 0; const [cmd, ...rest] = line.split(' ');
  gate(commands, (x, t) => said.push(t), T.isAdmin, T.staffCan, T.TRIAL_COMMANDS, LEAD_ONLY, T.isLeadStaff, (w, tier, what, detail) => logged.push({ w, tier, what, detail }),
    (x) => `char${x}`, T.tierOf, T.staffTierOf, (x) => `char${x}`, TIER_LABEL, () => {}, a, cmd, rest.join(' '), 1); return ran.length > 0; };
check('the gate admits a Trial GM for exactly /rename /chargen /tp /charstats /bugs', Object.keys(T.TRIAL_COMMANDS).sort().join() === 'bugs,chargen,charstats,rename,tp', Object.keys(T.TRIAL_COMMANDS));
for (const n of ['rename', 'chargen', 'tp', 'charstats', 'bugs']) {
  const ok = chat(TRIAL, `${n} Mira`);
  check(`a Trial GM runs /${n}, staff-logged as Trial GM`, ok && logged.length === 1 && logged[0].tier === 'trialgm' && /\(Trial GM\): \//.test(logged[0].detail), { said, logged });
}
const refused = STAFF_CMDS.filter((n) => !T.TRIAL_COMMANDS[n]).filter((n) => chat(TRIAL, `${n} x`) || !said.includes('Admins only.'));
check('every other staff command refuses a Trial GM with "Admins only."', refused.length === 0, refused);
chat(TRIAL, 'faction leader Mira fightersguild');
check('a player command reaches its own handler, which keeps its own staff checks (no staff log for the Trial GM)', ran.length === 1 && logged.length === 0, logged);
check('a player is refused /rename and /tp', !chat(PLAYER, 'rename Mira Bob') && !chat(PLAYER, 'tp Mira') && said.includes('Admins only.'));
check('a GM runs /chargen and /tp, and is still refused /wipechars (Lead GM and above)', chat(GM, 'chargen Mira') && chat(GM, 'tp Mira') && !chat(GM, 'wipechars Mira') && /Lead GM/.test(said.join()));
check('a GM holding the Trial role too is a GM at the gate', !chat(BOTH, 'wipechars Mira') && chat(BOTH, 'kick Mira'));
check('a Lead GM runs /chargen and /kick', chat(LEAD, 'chargen Mira') && chat(LEAD, 'kick Mira'));
const NG = tiers([]);
const chatNoKey = (a, line) => { ran.length = 0; const [cmd, ...rest] = line.split(' ');
  gate(commands, () => {}, NG.isAdmin, NG.staffCan, NG.TRIAL_COMMANDS, LEAD_ONLY, NG.isLeadStaff, () => {}, String, NG.tierOf, NG.staffTierOf, String, TIER_LABEL, () => {}, a, cmd, rest.join(' '), 1); return ran.length > 0; };
check('without the settings key a Trial GM role opens nothing', !chatNoKey(TRIAL, 'rename Mira Bob') && !chatNoKey(TRIAL, 'tp Mira'));

// ---- /tp and /chargen bodies: no admin check of their own that would refuse a Trial GM --------------------------------
{
  const chargenCode = cut("registerChatCommand('chargen'", 'const NAME_RE = ', '/chargen');
  const tpCode = cut('const staffTeleport = ', '// ---- pigeons', '/tp');
  check('/chargen and /tp do not ask isAdmin themselves', !/isAdmin|isLeadStaff/.test(chargenCode) && !/isAdmin|isLeadStaff/.test(tpCode));
  const cmds = new Map(); const out = []; const sets = []; const menus = [];
  const mp = { setRaceMenuOpen: (t, on) => menus.push([t, on]), set: (a, k, v) => sets.push([a, k, v]), get: (a, k) => (k === 'worldOrCellDesc' ? '3c:Skyrim.esm' : k === 'pos' ? [1, 2, 3] : [0, 0, 0]) };
  new Function('registerChatCommand', 'findByName', 'personal', 'system', 'audit', 'who', 'display', 'nameOf', 'mp', 'log', 'staffTierOf', chargenCode + tpCode)(
    (n, fn) => cmds.set(n, fn), (q) => (q === 'Mira' ? PLAYER : 0), (a, t) => out.push(t), () => {}, () => {}, String, String, () => 'Mira', mp, () => {}, (x) => T.staffTierOf(x));
  cmds.get('chargen')(TRIAL, 'Mira');
  check('/chargen by a Trial GM for another player is refused (their own character only, Nate 12 Oct)', menus.length === 0 && /own character only/.test(out.join()), [menus, out]);
  cmds.get('chargen')(TRIAL, '');
  check('...and with no name opens character creation for themselves', menus.length === 1 && menus[0][0] === TRIAL && menus[0][1] === true, menus);
  cmds.get('chargen')(GM, 'Mira');
  check('a GM still opens it for anyone', menus.length === 2 && menus[1][0] === PLAYER, menus);
  cmds.get('tp')(TRIAL, 'Mira');
  check('/tp by a Trial GM moves them to the player', sets.some(([a, k, v]) => a === TRIAL && k === 'locationalData' && v.cellOrWorldDesc === '3c:Skyrim.esm'), sets);
}
check('the panel\'s rename (fork __dboAdminRename) asks staffCan rename', /globalThis\.__dboAdminRename = \(a, t, name\) => \(staffCan\(Number\(a\) >>> 0, 'rename'\)/.test(src));
check('/charstats lives behind the gate only (journalstats.js asks no isAdmin inside it)', (() => {
  const j = fs.readFileSync(path.join(ROOT, 'journalstats.js'), 'utf8'); const i = j.indexOf("registerChatCommand('charstats'"); const body = j.slice(i, j.indexOf('});', i));
  return i > 0 && !/isAdmin/.test(body) && /admin: true/.test(j.slice(i, i + 800));
})());

// ---- the wiring ------------------------------------------------------------------------------------------------------------
check('gmcall.js and debugsnap.js are given staffCan', /require\(GMCALL_JS\)\(\{[\s\S]*?isAdmin, staffCan, every,/.test(src) && /require\(DEBUGSNAP_JS\)\(\{[^}]*isAdmin, staffCan, cfg \}\)/.test(src));
check('the role sync sees a Trial GM as staff (a lost role logs them out)', /isStaff: \(a\) => staffTierOf\(a\) !== null, staffRolesSeen/.test(src));
check('/whoami says trialgm', /tier \$\{staffTierOf\(a\) \|\| 'player'\}/.test(src));
check('/help admin gives a Trial GM their own list, as private lines', /if \(staffAsk && isTrialStaff\(a\)\) return trialHelp\(a\);/.test(src) && /const trialHelp = \(a\) => \{[\s\S]*?personal\(a,/.test(src));
const trialHelpNames = (src.match(/const TRIAL_HELP = \[([\s\S]*?)\n\];/) || ['', ''])[1].match(/\['(\w+)'/g).map((x) => x.slice(2, -1));
check('...naming gm, tp, rename, chargen, charstats and bugs', trialHelpNames.sort().join() === 'bugs,chargen,charstats,gm,rename,tp', trialHelpNames);
check('a staff character is named in the JOIN line and told so at login', /staffCharOf\(a\) \? ' \(staff character\)' : ''/.test(src) && /if \(staffCharOf\(a\)\) personal\(a, 'This is your GM character/.test(src));

// ---- gmcall.js: a Trial GM answers calls ----------------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-trialgm-'));
const cwd = process.cwd();
process.chdir(tmp);
{
  const P = { [PLAYER]: { name: 'Mira', profile: 8 }, [TRIAL]: { name: 'Tria', profile: 9 }, [GM]: { name: 'Gerd', profile: 6 } };
  const lines = [], tps = [], pk = [];
  const cmds = {};
  delete globalThis.__dboGmCalls; delete globalThis.__dboGmCallsRun;
  const MODULE = path.join(ROOT, 'gmcall.js');
  delete require.cache[MODULE];
  require(MODULE)({
    mp: { get: (a, k) => (k === 'pos' ? [10, 20, 30] : k === 'worldOrCellDesc' ? '3c:Skyrim.esm' : k === 'angle' ? [0, 0, 0] : undefined), getIdFromDesc: () => 0x3c },
    log: () => {}, personal: (a, t) => lines.push([a, 'pm', t]), staffSay: (a, t) => lines.push([a, 'admin', t]), audit: () => {}, staffNote: () => {},
    who: (a) => P[a].name, display: (a) => P[a].name, profileOf: (a) => P[a].profile, discordOf: () => '', rolesOf: () => [],
    onlineActors: () => [PLAYER, TRIAL], registerChatCommand: (n, fn) => { cmds[n] = fn; },
    isAdmin: (a) => a === GM, staffCan: (a, what) => a === GM || (a === TRIAL && what === 'gmcall'), every: () => {},
    saveSoon: () => {}, sendPacket: (a, p) => { pk.push([a, p]); return true; }, zoneOfActor: () => null, zoneById: () => null, recordOf: () => null,
    teleportTo: (a, place) => { tps.push([a, place]); return ''; }, creationPending: () => false, cfg: { gmCalls: { filter: false } },
  });
  cmds.gm(PLAYER, 'I am stuck in a wall');
  check('a Trial GM is told of a GM call (chat line and banner)', lines.some(([a, , t]) => a === TRIAL && /GM call #1/.test(t)) && pk.some(([a, p]) => a === TRIAL && p.customPacketType === 'dboBanner'), lines);
  check('...in private lines, not the admin tab they do not have', !lines.some(([a, tab]) => a === TRIAL && tab === 'admin'));
  lines.length = 0; cmds.gm(TRIAL, 'list');
  check('/gm list works for a Trial GM', lines.some(([a, , t]) => a === TRIAL && /#1 Mira/.test(t)), lines);
  lines.length = 0; cmds.gm(TRIAL, 'take 1');
  check('/gm take works, and the player is told', lines.some(([a, , t]) => a === TRIAL && /You have GM call #1/.test(t)) && lines.some(([a, , t]) => a === PLAYER && /on the way/.test(t)), lines);
  lines.length = 0; cmds.gm(TRIAL, 'goto 1');
  check('/gm goto takes a Trial GM to the caller', tps.length === 1 && tps[0][0] === TRIAL && tps[0][1].cellOrWorldDesc === '3c:Skyrim.esm', [tps, lines]);
  lines.length = 0; cmds.gm(TRIAL, 'close 1 sorted');
  check('/gm close works', lines.some(([a, , t]) => a === PLAYER && /has been closed/.test(t)), lines);
  lines.length = 0; cmds.gm(PLAYER, 'list');
  check('a player\'s "/gm list" is read as a (too short) call, never the staff list', lines.length > 0 && !lines.some(([a, , t]) => a === PLAYER && /#1 Mira/.test(t)), lines);
}

// ---- debugsnap.js /bugs ---------------------------------------------------------------------------------------------------
(async () => {
  const dir = path.join(tmp, 'mon');
  fs.mkdirSync(path.join(dir, 'bugs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bugs', '2026-10-11T10-00-00-AAAA.json'), JSON.stringify({ at: '2026-10-11T10:00:00.000Z', by: 'Ann #AAAA', text: 'wolf floats', log: ['private line'] }));
  fs.writeFileSync(path.join(dir, 'bugs', '2026-10-11T11-00-00-BBBB.json'), JSON.stringify({ at: '2026-10-11T11:00:00.000Z', by: 'Bo #BBBB', text: 'door #{ff0000}red', log: [] }));
  const out = []; const cmds = {};
  delete globalThis.__dboDebugSnap;
  const MODULE = path.join(ROOT, 'debugsnap.js');
  delete require.cache[MODULE];
  const P = { [PLAYER]: 'Mira #MIRA', [TRIAL]: 'Tria #TRIA' };
  require(MODULE)({
    mp: { get: (a, k) => (k === 'worldOrCellDesc' ? '3c:Skyrim.esm' : k === 'pos' ? [0, 0, 0] : k === 'actorNeighbors' ? [] : undefined) },
    log: () => {}, every: () => {}, personal: (a, t) => out.push([a, t]), registerChatCommand: (n, fn, o) => { cmds[n] = { fn, o }; }, onlineActors: () => [],
    display: (a) => P[a], tagOf: () => 'MIRA', profileOf: (a) => a, isAdmin: () => false, staffCan: (a, what) => a === TRIAL && what === 'bugs',
    cfg: { debugSnap: { dir, logFile: path.join(tmp, 'none.log') } },
  });
  check('/bugs is registered as a staff command', cmds.bugs && cmds.bugs.o.admin === true);
  cmds.bugs.fn(PLAYER, '');
  check('a player is refused /bugs inside the command too', out.length === 1 && /Admins only/.test(out[0][1]), out);
  out.length = 0; cmds.bugs.fn(TRIAL, '');
  await new Promise((r) => setTimeout(r, 100));
  check('a Trial GM reads the newest reports, newest first', out.length === 3 && /Bo #BBBB: door/.test(out[1][1]) && /Ann #AAAA: wolf floats/.test(out[2][1]), out);
  check('...with no saved log text and no colour codes', !out.some(([, t]) => /private line/.test(t)) && !out.some(([, t]) => t.includes('#{')), out);
  cmds.bug.fn(PLAYER, 'my horse is on the roof');
  out.length = 0; cmds.bugs.fn(TRIAL, '1');
  check('a report filed since is first, and n limits the list', out.length === 2 && /Mira #MIRA: my horse is on the roof/.test(out[1][1]), out);

  process.chdir(cwd);
  // ---- /ghost and /unstuck (Nate, 12 Oct) --------------------------------------------------------------------------
  check('a Trial GM may unstuck, a player may not', T.staffCan(TRIAL, 'unstuck') && !T.staffCan(PLAYER, 'unstuck') && T.staffCan(GM, 'unstuck'));
  check('there is no gameplay /ghost: Ghost is the panel\'s mode (Nate 12 Oct)', !/registerChatCommand\('ghost'/.test(src));
  check('/unstuck: staff skip the waits and may name a player; a player names nobody', /const admin = staffCan\(by, 'unstuck'\);/.test(src) && /if \(!name \|\| !staffCan\(a, 'unstuck'\)\) return unstuckActor\(a, a\);/.test(src) && /if \(by === a\) mp\.set\(a, 'private\.unstuckAt', Date\.now\(\)\);/.test(src));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('');
  console.log(failures ? `${failures} FAILURES` : 'all checks passed');
  process.exit(failures ? 1 : 0);
})();
