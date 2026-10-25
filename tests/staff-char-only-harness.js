// Staff powers only on a staff character (staffguard.js staffCharOnly; the owner's staff-conduct review, 23 Oct 2026): on any
// other character of a staff account the powers are refused with a plain line (teleports, /realnames, invisibility and the
// other F7 modes, the housing and key-ring override, the panel's world-changing actions, item and skill grants), while GM
// calls, the admin chat, /bugs and the panel's moderation still work. The F7 modes are cleared when the profile comes in on
// another character, or on one that is not a staff character. The Owners pass. /staffchar marks the staff characters (Lead
// GM and above, never their own account) and seeds the three named by the review. Also cuts the chat command gate and the
// staffCan rule out of gamemode.js, and checks the wiring in gamemode.js, gmcall.js and the config.
//   node tests/staff-char-only-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, CAST, load, call, check, done } = require('./lib/staffguard-fakes');
const { OWNER, OWNER_RP, LEAD, LEAD_RP, LEAD2, GM, GM_RP, GM2, TRIAL, TRIAL_RP, MIRA, BOB } = Object.fromEntries(Object.entries(CAST).map(([k, v]) => [k, v.id]));

const NOT_HERE = /^Staff powers work only on your staff character\./;
let f = load({});
const G = f.G;

// ---- who carries the powers ----
check('a staff character carries its account\'s powers', G.powersOn(GM) && G.powersOn(LEAD) && G.powersOn(TRIAL));
check('the same account\'s RP character does not', !G.powersOn(GM_RP) && !G.powersOn(LEAD_RP) && !G.powersOn(TRIAL_RP));
check('an Owner carries them on every character (exemptTiers senior)', G.powersOn(OWNER) && G.powersOn(OWNER_RP) && G.exempt(OWNER_RP));
check('__dboIsStaffCharacter reads the flag', globalThis.__dboIsStaffCharacter(GM) === true && globalThis.__dboIsStaffCharacter(GM_RP) === false && globalThis.__dboIsStaffCharacter(MIRA) === false);

// ---- staffCan rights ----
check('tp, invis and realnames are refused on an RP character', ['tp', 'invis', 'realnames'].every((w) => G.rightOk(GM_RP, w) === false && G.rightOk(TRIAL_RP, w) === false));
check('...and pass on the staff character', ['tp', 'invis', 'realnames'].every((w) => G.rightOk(GM, w) && G.rightOk(TRIAL, w)));
check('gmcall, adminchat, bugs and playerinfo pass everywhere', ['gmcall', 'adminchat', 'bugs', 'playerinfo', 'rename'].every((w) => G.rightOk(GM_RP, w) && G.rightOk(TRIAL_RP, w)));

// ---- chat commands ----
const cmd = (a, line) => { const i = line.indexOf(' '); const c = i < 0 ? line : line.slice(0, i); const body = i < 0 ? '' : line.slice(i + 1); return G.command(a, c, `${c} ${(body.split(/\s+/)[0] || '').toLowerCase()}`, body); };
for (const line of ['tp Mira', 'realnames on', 'gm goto 3', 'grantproperty Mira 1234', 'grantappearance Mira', 'manual grant iron Mira', 'smithing teach Mira x', 'schools set Destruction 50 Mira', 'enchant apply 1 x', 'makesuper vampire', 'curse Mira cure', 'beastform Mira werewolf now', 'polymorph fox']) {
  const r = cmd(GM_RP, line);
  check(`/${line} is refused on a GM's RP character, plainly`, !!r && NOT_HERE.test(r.refuse || ''), r);
}
check('...and runs on the staff character', ['tp Mira', 'realnames on', 'gm goto 3', 'curse Mira cure'].every((l) => !(cmd(GM, l) || {}).refuse));
check('GM calls, /bugs, the admin chat, kick and discipline still run on the RP character', ['gm list', 'gm take 3', 'gm close 3 done', 'bugs', 'admin hi', 'kick Bob', 'discipline Bob warn', 'players', 'enchant items', 'smithing list Mira', 'schools Mira'].every((l) => !(cmd(GM_RP, l) || {}).refuse));
check('an Owner\'s RP character runs them all', ['tp Mira', 'realnames on', 'curse Mira cure'].every((l) => !(cmd(OWNER_RP, l) || {}).refuse));
check('a player is never refused by these rules (the admin gate does that)', !(cmd(MIRA, 'tp Bob') || {}).refuse);

// ---- /gm goto through the panel or the command (gmcall.js) ----
check('/gm goto refuses an RP character', NOT_HERE.test(G.gotoRefusal(GM_RP, call(3, 50, null))));
check('...and lets a staff character go', G.gotoRefusal(GM, { n: 3, takenBy: null }) === '');

// ---- the F7 panel (fork AdminSystem asks __dboAdminGate) ----
const gate = globalThis.__dboAdminGate;
for (const [action, info] of [['toggleMode', { mode: 'invis' }], ['toggleMode', { mode: 'ghost' }], ['toggleMode', { mode: 'noclip' }], ['toggleMode', { mode: 'freecam' }],
  ['teleportTo', { target: MIRA }], ['teleportLoc', { location: 'Bruma' }], ['summon', { target: MIRA }], ['npcZoneTp', {}], ['npcZoneAdd', {}], ['giveItem', { target: MIRA }],
  ['masterySetTier', { target: MIRA }], ['setSchool', { target: MIRA }], ['giveCurse', { target: MIRA }], ['beastForm', { target: MIRA }], ['kill', { target: MIRA }], ['rename', { target: MIRA }]]) {
  check(`panel ${action}${info.mode ? ' ' + info.mode : ''} is refused on an RP character`, NOT_HERE.test(gate(LEAD_RP, action, info)), gate(LEAD_RP, action, info));
}
check('panel moderation still works there: kick, ban, temp ban, unban, staffChar', ['kick', 'ban', 'tempBan', 'unban', 'staffChar'].every((x) => gate(LEAD_RP, x, { target: MIRA }) === ''));
check('the panel works on the staff character', ['teleportTo', 'toggleMode', 'giveItem', 'kill'].every((x) => gate(LEAD, x, { target: MIRA, mode: 'invis' }) === ''));
check('an Owner\'s RP character passes the panel', gate(OWNER_RP, 'toggleMode', { mode: 'invis' }) === '' && gate(OWNER_RP, 'teleportLoc', { location: 'x' }) === '');
check('housing: the staff override is refused on an RP character', NOT_HERE.test(gate(LEAD_RP, 'housing', {})));
check('housing: kept on the staff character and for an Owner anywhere', gate(LEAD, 'housing', {}) === '' && gate(OWNER_RP, 'housing', {}) === '');

// ---- item and skill grants through the gameplay tools (target kinds) ----
check('a grant aimed at a player is refused from an RP character (items, skills, powers)', ['items', 'skills', 'powers'].every((k) => NOT_HERE.test(G.target(LEAD_RP, MIRA, k))));
check('...and passes from the staff character', ['items', 'skills', 'powers'].every((k) => G.target(LEAD, MIRA, k) === ''));

// ---- modes cleared at login ----
check('assign: an RP character of a staff account clears the modes', gate(GM_RP, 'assign', { changed: false }) === 'clear');
check('assign: the staff character again keeps them', gate(GM, 'assign', { changed: false }) === '');
check('assign: another staff character of the account clears them', gate(GM, 'assign', { changed: true }) === 'clear');
check('assign: an Owner keeps them', gate(OWNER_RP, 'assign', { changed: true }) === '');

// ---- /staffchar ----
{
  const out = f.run(LEAD, `staffchar set #${CAST.GM_RP.tag}`);
  check('/staffchar set: a Lead GM marks another account\'s character', /is now a staff character/.test(out) && f.props.get(`${GM_RP}|private.dboStaffChar`) === true, out);
  check('...audited', f.audits.some((l) => /^STAFFCHAR GM Leda #LEAD \(profile 20\) marked Katell #KATE \(profile 30\) as a staff character$/.test(l)), f.audits);
  check('...the character is told', f.said.some((x) => x.a === GM_RP && /now your staff character/.test(x.t)));
  const off = f.run(LEAD, 'staffchar clear Katell');
  check('/staffchar clear unmarks it', /no longer a staff character/.test(off) && f.props.get(`${GM_RP}|private.dboStaffChar`) === false, off);
  const own = f.run(LEAD, 'staffchar set Leda the Bold');
  check('a Lead GM cannot mark a character of their own account', /Another Lead GM or an Owner/.test(own) && f.props.get(`${LEAD_RP}|private.dboStaffChar`) === undefined, own);
  const gm = f.run(GM, 'staffchar set Mira');
  check('a GM cannot mark anyone', /Only a Lead GM or above/.test(gm) && f.props.get(`${MIRA}|private.dboStaffChar`) === undefined, gm);
  const owner = f.run(OWNER, 'staffchar set Jarl Jake');
  check('an Owner may mark their own', /is now a staff character/.test(owner), owner);
  check('/staffchar alone says where staff powers work', /is not a staff character\. Staff powers here: off/.test(f.run(GM_RP, 'staffchar')) && /Staff powers here: on/.test(f.run(GM, 'staffchar')));
  check('/staffchar list names who is on a staff character', /Katell #KATE \(gm, NOT a staff character\)/.test(f.run(LEAD, 'staffchar list')));
}
// The seed: #D3EP, #S4PZ and #38XK (one of them offline), Choom and Neem listed as having none
{
  const g = load({});
  g.byId.set(0x70, { id: 0x70, name: 'Skaldgm', tag: 'D3EP', profile: 94, tier: 'gm', online: false });
  g.byId.set(0x71, { id: 0x71, name: 'GM Drakstas', tag: 'S4PZ', profile: 56, tier: 'gm', online: true });
  const out = g.run(LEAD, 'staffchar seed');
  check('/staffchar seed marks #D3EP (offline, by #TAG) and #S4PZ', g.props.get('112|private.dboStaffChar') === true && g.props.get('113|private.dboStaffChar') === true, out);
  check('...#38XK is already one', /#38XK: Helps #38XK is already a staff character/.test(out), out);
  check('...and names Choom (51) and Neem (97) as needing one', /Profile 51 \(Choom\) has no staff character yet/.test(out) && /Profile 97 \(Neem\) has no staff character yet/.test(out), out);
  check('...three audit lines for the two marks', g.audits.filter((l) => /^STAFFCHAR /.test(l)).length === 2, g.audits);
}

// ---- switches ----
{
  const off = load({ staffCharOnly: { enabled: false } }).G;
  check('staffCharOnly.enabled false: an RP character has its powers back', off.powersOn(GM_RP) && !(off.command(GM_RP, 'tp', 'tp mira', 'Mira') || {}).refuse && globalThis.__dboAdminGate(GM_RP, 'toggleMode', { mode: 'invis' }) === '' && globalThis.__dboAdminGate(GM_RP, 'assign', {}) === '');
  const all = load({ enabled: false }).G;
  check('staffPowers.enabled false: every rule is off', all.powersOn(GM_RP) && globalThis.__dboAdminGate(GM_RP, 'housing', {}) === '' && all.target(GM, GM_RP, 'items') === '');
  const noClear = load({ staffCharOnly: { clearModes: false } }).G;
  check('clearModes false: the modes are kept at login (the powers still refused)', globalThis.__dboAdminGate(GM_RP, 'assign', {}) === '' && !noClear.powersOn(GM_RP));
  const ex = load({ exemptProfiles: [30] }).G;
  check('exemptProfiles lets a named account pass', ex.powersOn(GM_RP));
  const noSenior = load({ exemptTiers: [] }).G;
  check('exemptTiers [] holds the Owners to the rules too', !noSenior.powersOn(OWNER_RP));
}
f = load({});

// ---- gamemode.js: staffCan and the chat command gate ----
const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const cut = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a + 1); return a < 0 || b < 0 ? null : src.slice(a, b); };
{
  const code = cut('const staffCanByRank = ', '// The tier for logs and the role sync');
  check('gamemode.js: staffCan asks the staff rules after the rank', !!code && /g\.rightOk\(actorId, what\)/.test(code), code);
  const staffCan = new Function('isAdmin', 'TRIAL_CAN', 'isTrialStaff', `${code}\nreturn staffCan;`)((a) => [GM, GM_RP, LEAD, LEAD_RP].includes(a), new Set(['tp']), (a) => [TRIAL, TRIAL_RP].includes(a));
  check('...staffCan(tp) is false on the RP characters, true on the staff ones', !staffCan(GM_RP, 'tp') && !staffCan(TRIAL_RP, 'tp') && staffCan(GM, 'tp') && staffCan(TRIAL, 'tp'));
  check('...staffCan(adminchat) is unchanged', staffCan(GM_RP, 'adminchat') && !staffCan(TRIAL_RP, 'adminchat'));
  const saved = globalThis.__dboStaffGuard; delete globalThis.__dboStaffGuard;
  check('...without staffguard.js loaded, staffCan is as before', staffCan(GM_RP, 'tp'));
  globalThis.__dboStaffGuard = saved;
}
{
  const gateCode = cut('  const c = commands.get(cmd);', '  try { c.fn(a, body, userId); }');
  check('gamemode.js: the chat command gate asks the staff rules before a command runs', !!gateCode && /g\.command\(a, cmd, sub, body\)/.test(gateCode));
  const ran = [], said = [], logged = [];
  const commands = new Map();
  for (const n of ['tp', 'realnames', 'bugs', 'kick']) commands.set(n, { admin: true, fn: (a, body) => ran.push([a, n, body, globalThis.__dboStaffGuardState.ambient]) });
  for (const n of ['gm', 'faction', 'rename']) commands.set(n, { admin: n === 'rename', fn: (a, body) => ran.push([a, n, body, globalThis.__dboStaffGuardState.ambient]) });
  const run = new Function('commands', 'personal', 'isAdmin', 'staffCan', 'TRIAL_COMMANDS', 'LEAD_ONLY', 'isLeadStaff', 'staffLog', 'display', 'tierOf', 'staffTierOf',
    'staffWho', 'TIER_LABEL', 'log', 'staffGuard', 'a', 'cmd', 'body', 'userId', 'remote', 'dry', `${gateCode}  c.fn(a, body, userId); if (staffRefEnd) staffRefEnd();\n  return 'ran';`);
  const chat = (a, line) => { ran.length = 0; said.length = 0; logged.length = 0; const [c, ...rest] = line.split(' ');
    return run(commands, (x, t) => said.push(t), (x) => [GM, GM_RP, LEAD, LEAD_RP].includes(x), () => true, {}, new Set(), () => false,
      (w, tier, what, detail) => logged.push(detail), String, () => 'gm', () => 'gm', String, { gm: 'GM' }, () => {}, () => globalThis.__dboStaffGuard, a, c, rest.join(' '), 1, undefined, false); };
  check('a GM\'s RP character: /tp is refused with the plain line, never run', chat(GM_RP, 'tp Mira') === 'refused' && ran.length === 0 && NOT_HERE.test(said[0] || ''), said);
  check('...and the refusal reaches the staff log', logged.length === 1 && /REFUSED \(Staff powers work only/.test(logged[0]), logged);
  check('...while /bugs, /kick and /gm list run', chat(GM_RP, 'bugs') === 'ran' && chat(GM_RP, 'kick Bob') === 'ran' && chat(GM_RP, 'gm list') === 'ran');
  check('...and /gm goto is refused', chat(GM_RP, 'gm goto 3') === 'refused');
  check('the staff character runs /tp', chat(GM, 'tp Mira') === 'ran' && ran[0][2] === 'Mira');
  chat(GM, 'rename Mira Mirabel call:3');
  check('a call:<n> word is taken out of the line and held while the command runs', ran.length === 1 && ran[0][2] === 'Mira Mirabel' && ran[0][3] && ran[0][3].ref.n === 3, ran);
  check('...and let go after it', globalThis.__dboStaffGuardState.ambient === null);
  chat(GM, 'faction leader Mira fightersguild ticket:1561234');
  check('a ticket:<id> word likewise (a player command with staff verbs)', ran[0][2] === 'leader Mira fightersguild' && ran[0][3].ref.id === '1561234', ran);
  chat(GM, 'kick Bob call:3');
  check('a command outside callRef.commands keeps its words', ran[0][2] === 'Bob call:3' && ran[0][3] === null, ran);
}

// ---- wiring ----
check('gamemode.js loads staffguard.js with the rank helpers (and the rank rule for panel bans, 25 Oct), and drops its globals when the load fails',
  /require\(STAFFGUARD_JS\)\(\{ mp, log, audit, who, display, personal, profileOf, tierOf, staffTierOf, isLeadStaff, staffCharOf, accountRankOf, rankRefusal: rankRefusalOf,\s*findByName, offlineByTag, registerChatCommand, onlineActors, cfg \}\)/.test(src)
  && /for \(const k of \['__dboStaffGuard', '__dboAdminGate', '__dboStaffCharSet', '__dboIsStaffCharacter'\]\) delete globalThis\[k\]/.test(src));
check('gamemode.js: a staff member on another character is told at login that staff powers are off there', /else if \(staffTierOf\(a\)\) \{ try \{ const g = staffGuard\(\); if \(g && !g\.powersOn\(a\)\) personal\(a, `This is not your staff character/.test(src));
check('gamemode.js: the journal\'s command route asks the rules too', /if \(r && r\.refuse\) return \[r\.refuse\];/.test(src));
const gm = fs.readFileSync(path.join(ROOT, 'gmcall.js'), 'utf8');
check('gmcall.js: /gm goto asks gotoRefusal before it moves anyone', /const goto = \(a, c\) => \{[\s\S]{0,400}g\.gotoRefusal\(a, c\)[\s\S]{0,200}if \(no\) return say\(a, no\);/.test(gm));
const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8')).staffPowers;
check('gamemode-config.json: staffPowers with each part\'s switch; staff characters off (Nate, 23 Oct), the rest on, the Owners exempt', !!conf && conf.enabled === true && conf.staffCharOnly.enabled === false && conf.selfTarget.enabled === true && conf.callRef.enabled === true && conf.trialLimits.enabled === true && conf.exemptTiers.join() === 'senior' && /ROLLBACK/.test(conf._comment), conf);
check('...seeding #D3EP, #S4PZ and #38XK', conf.seedTags.join() === 'D3EP,S4PZ,38XK');
void [LEAD2, GM2, BOB, OWNER];
done();
